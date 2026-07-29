import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const supabaseCli = path.join(
  repositoryRoot,
  'node_modules',
  '.bin',
  'supabase',
);
const profileBucket = 'dive-profiles';

function readLocalStatus() {
  const localEnvironment = {...process.env};

  for (const name of [
    'PINTERNET_SUPABASE_PROJECT_ID',
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_PROJECT_ID',
  ]) {
    delete localEnvironment[name];
  }

  const stdout = execFileSync(supabaseCli, ['status', '-o', 'json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: localEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const status = JSON.parse(stdout);

  assert.equal(typeof status.API_URL, 'string');
  assert.equal(typeof status.PUBLISHABLE_KEY, 'string');
  assert.equal(typeof status.SECRET_KEY, 'string');
  return status;
}

function headers(apiKey, bearer = apiKey, extra = {}) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function request(url, options) {
  const response = await fetch(url, options);
  const responseText = await response.text();
  let body = null;

  if (responseText.length > 0) {
    try {
      body = JSON.parse(responseText);
    } catch {
      body = responseText;
    }
  }

  return {status: response.status, body, headers: response.headers};
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function payloadDigest(payload) {
  return sha256(Buffer.from(JSON.stringify(payload)));
}

function assertStatus(result, expected, label) {
  assert.ok(
    expected.includes(result.status),
    `${label}: expected ${expected.join('/')} but received ${result.status}`,
  );
}

function assertNoStore(result, label) {
  assert.equal(
    result.headers.get('cache-control'),
    'no-store',
    `${label}: response must disable caching`,
  );
}

function assertFailure(result, statusCode, code, label) {
  assertStatus(result, [statusCode], label);
  assert.deepEqual(result.body, {code}, `${label}: stable failure body`);
  assertNoStore(result, label);
}

function logCheck(label) {
  console.log(`PASS ${label}`);
}

function createDisposableCredentials() {
  return {
    email: `finalize-claim-${randomUUID()}@example.invalid`,
    password: randomBytes(24).toString('base64url'),
  };
}

async function createVerifiedUser(apiUrl, secretKey, credentials) {
  const result = await request(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: headers(secretKey),
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
      email_confirm: true,
    }),
  });

  assertStatus(result, [200, 201], 'create verified test user');
  assert.equal(typeof result.body?.id, 'string');
  return result.body.id;
}

async function signIn(apiUrl, publishableKey, credentials) {
  const result = await request(
    `${apiUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: headers(publishableKey),
      body: JSON.stringify(credentials),
    },
  );

  assertStatus(result, [200], 'sign in disposable test user');
  assert.equal(typeof result.body?.access_token, 'string');
  return result.body.access_token;
}

async function completeOnboarding(apiUrl, publishableKey, accessToken) {
  const result = await request(
    `${apiUrl}/rest/v1/rpc/complete_onboarding`,
    {
      method: 'POST',
      headers: headers(publishableKey, accessToken),
      body: JSON.stringify({
        requested_documents: [
          {kind: 'terms', version: '2026-07-13'},
          {kind: 'privacy', version: '2026-07-13'},
        ],
      }),
    },
  );

  assertStatus(result, [200], 'complete onboarding');
  assert.equal(result.body?.isComplete, true);
}

async function insertRow(context, table, row) {
  const result = await request(`${context.apiUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(context.publishableKey, context.accessToken, {
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(row),
  });

  assertStatus(result, [201], `insert ${table}`);
  assert.equal(result.body?.length, 1);
  return result.body[0];
}

async function updateRow(context, table, id, values) {
  const result = await request(
    `${context.apiUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: headers(context.publishableKey, context.accessToken, {
        Prefer: 'return=representation',
      }),
      body: JSON.stringify(values),
    },
  );

  assertStatus(result, [200], `update ${table}`);
  assert.equal(result.body?.length, 1);
  return result.body[0];
}

async function readRows(context, table, query) {
  const result = await request(
    `${context.apiUrl}/rest/v1/${table}?${query}`,
    {headers: headers(context.publishableKey, context.accessToken)},
  );

  assertStatus(result, [200], `read ${table}`);
  assert.ok(Array.isArray(result.body));
  return result.body;
}

async function createBatch(
  context,
  {label, expectedPlanCount, expectedLogCount},
) {
  return insertRow(context, 'guest_claim_batches', {
    user_id: context.userId,
    client_batch_id: `${label}-${randomUUID()}`,
    manifest_sha256: sha256(Buffer.from(`${label}-${randomUUID()}`)),
    expected_plan_count: expectedPlanCount,
    expected_log_count: expectedLogCount,
  });
}

async function stageRecord(context, batchId, input) {
  return insertRow(context, 'guest_claim_records', {
    batch_id: batchId,
    user_id: context.userId,
    entity_kind: input.entityKind,
    client_record_id: input.clientRecordId,
    payload_sha256: input.payloadSha256 ?? payloadDigest(input.payload),
    payload: input.payload,
    ...(input.sourcePlanClientRecordId === undefined
      ? {}
      : {source_plan_client_record_id: input.sourcePlanClientRecordId}),
    ...(input.convertedLogClientRecordId === undefined
      ? {}
      : {converted_log_client_record_id: input.convertedLogClientRecordId}),
    ...(input.profile === undefined
      ? {}
      : {
          profile_path: input.profile.path,
          profile_content_revision: input.profile.contentRevision,
          profile_sha256: input.profile.sha256,
          profile_byte_count: input.profile.byteCount,
          profile_sample_count: input.profile.sampleCount,
        }),
  });
}

async function uploadProfile(context, objectPath, bytes) {
  const result = await request(
    `${context.apiUrl}/storage/v1/object/${profileBucket}/${objectPath}`,
    {
      method: 'POST',
      headers: headers(context.publishableKey, context.accessToken, {
        'Content-Type': 'application/json',
        'x-upsert': 'false',
      }),
      body: bytes,
    },
  );

  assertStatus(result, [200], 'upload claim profile');
}

async function invokeFinalizer(context, batchId, bearer = context.accessToken) {
  return request(
    `${context.apiUrl}/functions/v1/finalize-guest-claim`,
    {
      method: 'POST',
      headers: headers(context.publishableKey, bearer),
      body: JSON.stringify({batchId}),
    },
  );
}

function planPayload(label) {
  return {
    status: 'planned',
    planned_at: '2026-07-20T01:00:00.000Z',
    dive_mode: 'scuba',
    site_name: label,
    plan_data: {schemaVersion: 1, label},
  };
}

function logPayload(label) {
  return {
    dive_mode: 'scuba',
    source: 'watch',
    started_at: '2026-07-20T02:00:00.000Z',
    ended_at: '2026-07-20T02:40:00.000Z',
    duration_seconds: 2400,
    max_depth_meters: 18.4,
    site_name: label,
    title: label,
    rating: 4,
    manual_data: {schemaVersion: 1},
    mobile_data: {schemaVersion: 1},
    watch_metadata: {schemaVersion: 1},
    provenance: {source: 'watch'},
    profile_preview: [{elapsedSeconds: 0, depthMeters: 0}],
  };
}

function profileExpectation(pathname, bytes, sampleCount) {
  return {
    path: pathname,
    contentRevision: 'profile-v1',
    sha256: sha256(bytes),
    byteCount: bytes.byteLength,
    sampleCount,
  };
}

function claimProfilePath(context, batchId) {
  return `${context.userId}/claims/${batchId}/${randomUUID()}/profile-v1.json`;
}

async function assertFinalCounts(context, planCount, logCount, label) {
  const [plans, logs] = await Promise.all([
    readRows(context, 'dive_plans', 'select=id,local_id,payload_sha256'),
    readRows(context, 'dive_logs', 'select=id,local_id,payload_sha256'),
  ]);

  assert.equal(plans.length, planCount, `${label}: plan count`);
  assert.equal(logs.length, logCount, `${label}: log count`);
  return {plans, logs};
}

async function deleteProfiles(apiUrl, secretKey, objectPaths) {
  if (objectPaths.length === 0) {
    return;
  }

  const result = await request(`${apiUrl}/storage/v1/object/${profileBucket}`, {
    method: 'DELETE',
    headers: headers(secretKey),
    body: JSON.stringify({prefixes: objectPaths}),
  });

  assertStatus(result, [200], 'delete disposable profiles');
}

async function deleteUser(apiUrl, secretKey, userId) {
  const result = await request(`${apiUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: headers(secretKey),
  });

  assertStatus(result, [200, 204], 'delete disposable test user');
}

const status = readLocalStatus();
const credentials = [createDisposableCredentials(), createDisposableCredentials()];
const contexts = [];
const objectPaths = [];

try {
  for (const credential of credentials) {
    const userId = await createVerifiedUser(
      status.API_URL,
      status.SECRET_KEY,
      credential,
    );
    const accessToken = await signIn(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      credential,
    );
    await completeOnboarding(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      accessToken,
    );
    contexts.push({
      apiUrl: status.API_URL,
      publishableKey: status.PUBLISHABLE_KEY,
      userId,
      accessToken,
    });
  }

  const owner = contexts[0];
  const otherOwner = contexts[1];

  const invalidJwt = await invokeFinalizer(owner, randomUUID(), 'not-a-jwt');
  assertStatus(invalidJwt, [401], 'invalid JWT denial');
  logCheck('invalid JWT denial');

  const foreignBatch = await createBatch(otherOwner, {
    label: 'cross-owner',
    expectedPlanCount: 0,
    expectedLogCount: 0,
  });
  const crossOwner = await invokeFinalizer(owner, foreignBatch.id);
  assertFailure(crossOwner, 404, 'batch_not_found', 'cross-owner batch denial');
  logCheck('cross-owner batch denial');

  const traversalBatch = await createBatch(owner, {
    label: 'profile-path-traversal',
    expectedPlanCount: 0,
    expectedLogCount: 1,
  });
  await stageRecord(owner, traversalBatch.id, {
    entityKind: 'log',
    clientRecordId: 'profile-path-traversal-log',
    payload: logPayload('profile-path-traversal'),
    profile: {
      path: `${owner.userId}/claims/${traversalBatch.id}/../profile-v1.json`,
      contentRevision: 'profile-v1',
      sha256: sha256(Buffer.from('not-read')),
      byteCount: 8,
      sampleCount: 1,
    },
  });
  const traversal = await invokeFinalizer(owner, traversalBatch.id);
  assertFailure(
    traversal,
    409,
    'claim_validation_failed',
    'profile path traversal denial',
  );
  await assertFinalCounts(owner, 0, 0, 'profile path traversal rollback');
  logCheck('profile path traversal denial with no final rows');

  const missingBatch = await createBatch(owner, {
    label: 'missing-profile',
    expectedPlanCount: 0,
    expectedLogCount: 1,
  });
  const missingPath = claimProfilePath(owner, missingBatch.id);
  await stageRecord(owner, missingBatch.id, {
    entityKind: 'log',
    clientRecordId: 'missing-profile-log',
    payload: logPayload('missing-profile'),
    profile: {
      path: missingPath,
      contentRevision: 'profile-v1',
      sha256: sha256(Buffer.from('missing')),
      byteCount: 7,
      sampleCount: 1,
    },
  });
  const missingProfile = await invokeFinalizer(owner, missingBatch.id);
  assertFailure(missingProfile, 409, 'profile_missing', 'missing profile denial');
  await assertFinalCounts(owner, 0, 0, 'missing profile rollback');
  logCheck('missing profile denial with no final rows');

  const profileBytes = new TextEncoder().encode(
    JSON.stringify([
      {elapsedSeconds: 0, depthMeters: 0},
      {elapsedSeconds: 10, depthMeters: 2.1},
    ]),
  );

  const digestBatch = await createBatch(owner, {
    label: 'digest-mismatch',
    expectedPlanCount: 0,
    expectedLogCount: 1,
  });
  const digestPath = claimProfilePath(owner, digestBatch.id);
  objectPaths.push(digestPath);
  await uploadProfile(owner, digestPath, profileBytes);
  await stageRecord(owner, digestBatch.id, {
    entityKind: 'log',
    clientRecordId: 'digest-mismatch-log',
    payload: logPayload('digest-mismatch'),
    profile: {
      ...profileExpectation(digestPath, profileBytes, 2),
      sha256: sha256(Buffer.from('different-profile')),
    },
  });
  const digestMismatch = await invokeFinalizer(owner, digestBatch.id);
  assertFailure(
    digestMismatch,
    409,
    'profile_digest_mismatch',
    'profile digest mismatch denial',
  );
  await assertFinalCounts(owner, 0, 0, 'digest mismatch rollback');
  logCheck('profile digest mismatch with no final rows');

  const byteBatch = await createBatch(owner, {
    label: 'byte-count-mismatch',
    expectedPlanCount: 0,
    expectedLogCount: 1,
  });
  const bytePath = claimProfilePath(owner, byteBatch.id);
  objectPaths.push(bytePath);
  await uploadProfile(owner, bytePath, profileBytes);
  await stageRecord(owner, byteBatch.id, {
    entityKind: 'log',
    clientRecordId: 'byte-count-mismatch-log',
    payload: logPayload('byte-count-mismatch'),
    profile: {
      ...profileExpectation(bytePath, profileBytes, 2),
      byteCount: profileBytes.byteLength + 1,
    },
  });
  const byteMismatch = await invokeFinalizer(owner, byteBatch.id);
  assertFailure(
    byteMismatch,
    409,
    'profile_byte_count_mismatch',
    'profile byte count mismatch denial',
  );
  await assertFinalCounts(owner, 0, 0, 'byte count mismatch rollback');
  logCheck('profile byte count mismatch with no final rows');

  const sampleBatch = await createBatch(owner, {
    label: 'sample-count-mismatch',
    expectedPlanCount: 0,
    expectedLogCount: 1,
  });
  const samplePath = claimProfilePath(owner, sampleBatch.id);
  objectPaths.push(samplePath);
  await uploadProfile(owner, samplePath, profileBytes);
  await stageRecord(owner, sampleBatch.id, {
    entityKind: 'log',
    clientRecordId: 'sample-count-mismatch-log',
    payload: logPayload('sample-count-mismatch'),
    profile: profileExpectation(samplePath, profileBytes, 3),
  });
  const sampleMismatch = await invokeFinalizer(owner, sampleBatch.id);
  assertFailure(
    sampleMismatch,
    409,
    'profile_sample_count_mismatch',
    'profile sample count mismatch denial',
  );
  await assertFinalCounts(owner, 0, 0, 'sample count mismatch rollback');
  logCheck('profile sample count mismatch with no final rows');

  const relationshipBatch = await createBatch(owner, {
    label: 'relationship-mismatch',
    expectedPlanCount: 1,
    expectedLogCount: 1,
  });
  await stageRecord(owner, relationshipBatch.id, {
    entityKind: 'plan',
    clientRecordId: 'relationship-plan',
    convertedLogClientRecordId: 'missing-relationship-log',
    payload: planPayload('relationship-mismatch'),
  });
  await stageRecord(owner, relationshipBatch.id, {
    entityKind: 'log',
    clientRecordId: 'relationship-log',
    sourcePlanClientRecordId: 'relationship-plan',
    payload: logPayload('relationship-mismatch'),
  });
  const relationshipMismatch = await invokeFinalizer(
    owner,
    relationshipBatch.id,
  );
  assertFailure(
    relationshipMismatch,
    409,
    'claim_validation_failed',
    'relationship mismatch denial',
  );
  await assertFinalCounts(owner, 0, 0, 'relationship mismatch rollback');
  logCheck('relationship mismatch with no final rows');

  const countBatch = await createBatch(owner, {
    label: 'count-mismatch',
    expectedPlanCount: 2,
    expectedLogCount: 0,
  });
  await stageRecord(owner, countBatch.id, {
    entityKind: 'plan',
    clientRecordId: 'count-mismatch-plan',
    payload: planPayload('count-mismatch'),
  });
  const countMismatch = await invokeFinalizer(owner, countBatch.id);
  assertFailure(
    countMismatch,
    409,
    'claim_validation_failed',
    'record count mismatch denial',
  );
  await assertFinalCounts(owner, 0, 0, 'count mismatch rollback');
  logCheck('record count mismatch with no final rows');

  await assertFinalCounts(owner, 0, 0, 'pre-success isolation');
  logCheck('zero final rows before successful publication');

  const successBatch = await createBatch(owner, {
    label: 'success',
    expectedPlanCount: 1,
    expectedLogCount: 1,
  });
  const successPlanPayload = planPayload('success');
  const successLogPayload = logPayload('success');
  const successProfilePath = claimProfilePath(owner, successBatch.id);
  objectPaths.push(successProfilePath);
  await uploadProfile(owner, successProfilePath, profileBytes);
  const successPlan = await stageRecord(owner, successBatch.id, {
    entityKind: 'plan',
    clientRecordId: 'success-plan',
    convertedLogClientRecordId: 'success-log',
    payload: successPlanPayload,
  });
  const successLog = await stageRecord(owner, successBatch.id, {
    entityKind: 'log',
    clientRecordId: 'success-log',
    sourcePlanClientRecordId: 'success-plan',
    payload: successLogPayload,
    profile: profileExpectation(successProfilePath, profileBytes, 2),
  });

  const success = await invokeFinalizer(owner, successBatch.id);
  assertStatus(success, [200], 'successful publication');
  assert.deepEqual(success.body, {
    batchId: successBatch.id,
    status: 'committed',
    planCount: 1,
    logCount: 1,
  });
  assertNoStore(success, 'successful publication');

  const published = await assertFinalCounts(owner, 1, 1, 'successful publication');
  assert.equal(published.plans[0].id, successPlan.target_record_id);
  assert.equal(published.logs[0].id, successLog.target_record_id);
  const [publishedPlan] = await readRows(
    owner,
    'dive_plans',
    'select=id,converted_log_id&local_id=eq.success-plan',
  );
  const [publishedLog] = await readRows(
    owner,
    'dive_logs',
    'select=id,source_plan_id,profile_sha256&local_id=eq.success-log',
  );
  assert.equal(publishedPlan.converted_log_id, publishedLog.id);
  assert.equal(publishedLog.source_plan_id, publishedPlan.id);
  assert.equal(publishedLog.profile_sha256, sha256(profileBytes));
  logCheck('atomic plan, log, relationship, and profile publication');

  const repeated = await invokeFinalizer(owner, successBatch.id);
  assertStatus(repeated, [200], 'repeated finalization');
  assert.deepEqual(repeated.body, success.body);
  assertNoStore(repeated, 'repeated finalization');
  await assertFinalCounts(owner, 1, 1, 'repeated finalization');
  logCheck('repeated finalization without duplicates');

  const sameDigestBatch = await createBatch(owner, {
    label: 'same-digest',
    expectedPlanCount: 1,
    expectedLogCount: 1,
  });
  const sameDigestProfilePath = claimProfilePath(owner, sameDigestBatch.id);
  objectPaths.push(sameDigestProfilePath);
  await uploadProfile(owner, sameDigestProfilePath, profileBytes);
  await stageRecord(owner, sameDigestBatch.id, {
    entityKind: 'plan',
    clientRecordId: 'success-plan',
    convertedLogClientRecordId: 'success-log',
    payloadSha256: payloadDigest(successPlanPayload),
    payload: successPlanPayload,
  });
  await stageRecord(owner, sameDigestBatch.id, {
    entityKind: 'log',
    clientRecordId: 'success-log',
    sourcePlanClientRecordId: 'success-plan',
    payloadSha256: payloadDigest(successLogPayload),
    payload: successLogPayload,
    profile: profileExpectation(sameDigestProfilePath, profileBytes, 2),
  });
  const sameDigest = await invokeFinalizer(owner, sameDigestBatch.id);
  assertStatus(sameDigest, [200], 'same digest cross-device reconciliation');
  assert.deepEqual(sameDigest.body, {
    batchId: sameDigestBatch.id,
    status: 'committed',
    planCount: 1,
    logCount: 1,
  });

  const reconciledRecords = await readRows(
    owner,
    'guest_claim_records',
    `select=entity_kind,target_record_id&batch_id=eq.${sameDigestBatch.id}`,
  );
  assert.equal(
    reconciledRecords.find(row => row.entity_kind === 'plan').target_record_id,
    successPlan.target_record_id,
  );
  assert.equal(
    reconciledRecords.find(row => row.entity_kind === 'log').target_record_id,
    successLog.target_record_id,
  );
  await assertFinalCounts(owner, 1, 1, 'same digest idempotency');
  logCheck('same digest cross-device claim reuses canonical target ids');

  await deleteProfiles(status.API_URL, status.SECRET_KEY, [
    successProfilePath,
  ]);
  const replayWithoutProfile = await invokeFinalizer(owner, successBatch.id);
  assertStatus(replayWithoutProfile, [200], 'committed replay without profile');
  assert.deepEqual(replayWithoutProfile.body, success.body);
  assertNoStore(replayWithoutProfile, 'committed replay without profile');
  await assertFinalCounts(owner, 1, 1, 'committed replay without profile');
  logCheck('committed replay does not depend on raw profile availability');

  const conflictBatch = await createBatch(owner, {
    label: 'different-digest',
    expectedPlanCount: 2,
    expectedLogCount: 0,
  });
  await stageRecord(owner, conflictBatch.id, {
    entityKind: 'plan',
    clientRecordId: 'atomic-new-plan',
    payload: planPayload('atomic-new-plan'),
  });
  await stageRecord(owner, conflictBatch.id, {
    entityKind: 'plan',
    clientRecordId: 'success-plan',
    payload: planPayload('different-digest'),
  });
  const differentDigest = await invokeFinalizer(owner, conflictBatch.id);
  assertFailure(
    differentDigest,
    409,
    'claim_validation_failed',
    'different payload digest conflict',
  );
  await assertFinalCounts(owner, 1, 1, 'payload conflict rollback');
  const rolledBackPlans = await readRows(
    owner,
    'dive_plans',
    'select=id&local_id=eq.atomic-new-plan',
  );
  assert.deepEqual(rolledBackPlans, []);
  logCheck('different digest conflict rolls back the whole batch');

  const deletedAt = '2026-07-29T12:00:00.000Z';
  await updateRow(owner, 'dive_plans', successPlan.target_record_id, {
    deleted_at: deletedAt,
  });
  await updateRow(owner, 'dive_logs', successLog.target_record_id, {
    deleted_at: deletedAt,
  });
  const softDeletedBatch = await createBatch(owner, {
    label: 'soft-deleted-collision',
    expectedPlanCount: 1,
    expectedLogCount: 1,
  });
  const softDeletedProfilePath = claimProfilePath(
    owner,
    softDeletedBatch.id,
  );
  objectPaths.push(softDeletedProfilePath);
  await uploadProfile(owner, softDeletedProfilePath, profileBytes);
  await stageRecord(owner, softDeletedBatch.id, {
    entityKind: 'plan',
    clientRecordId: 'success-plan',
    convertedLogClientRecordId: 'success-log',
    payloadSha256: payloadDigest(successPlanPayload),
    payload: successPlanPayload,
  });
  await stageRecord(owner, softDeletedBatch.id, {
    entityKind: 'log',
    clientRecordId: 'success-log',
    sourcePlanClientRecordId: 'success-plan',
    payloadSha256: payloadDigest(successLogPayload),
    payload: successLogPayload,
    profile: profileExpectation(softDeletedProfilePath, profileBytes, 2),
  });

  const softDeletedCollision = await invokeFinalizer(
    owner,
    softDeletedBatch.id,
  );
  assertFailure(
    softDeletedCollision,
    409,
    'claim_validation_failed',
    'soft-deleted equivalent collision',
  );
  const [softDeletedBatchReadback] = await readRows(
    owner,
    'guest_claim_batches',
    `select=status&id=eq.${softDeletedBatch.id}`,
  );
  assert.equal(softDeletedBatchReadback.status, 'uploading');
  const [plansAfterSoftDeletedCollision, logsAfterSoftDeletedCollision] =
    await Promise.all([
      readRows(
        owner,
        'dive_plans',
        'select=id,deleted_at&local_id=eq.success-plan',
      ),
      readRows(
        owner,
        'dive_logs',
        'select=id,deleted_at&local_id=eq.success-log',
      ),
    ]);
  assert.equal(plansAfterSoftDeletedCollision.length, 1);
  assert.equal(logsAfterSoftDeletedCollision.length, 1);
  assert.ok(plansAfterSoftDeletedCollision[0].deleted_at);
  assert.ok(logsAfterSoftDeletedCollision[0].deleted_at);
  logCheck('soft-deleted equivalent collision remains resumable and inactive');
} finally {
  await deleteProfiles(status.API_URL, status.SECRET_KEY, objectPaths);

  const cleanupResults = await Promise.allSettled(
    contexts.map(context =>
      deleteUser(status.API_URL, status.SECRET_KEY, context.userId),
    ),
  );
  const cleanupFailure = cleanupResults.find(result => result.status === 'rejected');

  if (cleanupFailure) {
    throw cleanupFailure.reason;
  }
}
