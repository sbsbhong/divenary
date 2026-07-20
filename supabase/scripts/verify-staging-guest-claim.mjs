import {spawnSync} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  STAGING_PROJECT_REF,
  assertStagingProjectRef,
  buildStagingEnvironment,
} from './staging-project.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const supabaseCli = path.join(repositoryRoot, 'node_modules/.bin/supabase');
const stagingApiUrl = `https://${STAGING_PROJECT_REF}.supabase.co`;
const profileBucket = 'dive-profiles';

function keyValue(entry) {
  if (entry === null || typeof entry !== 'object') {
    return undefined;
  }

  const value = entry.api_key ?? entry.apiKey ?? entry.key;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function collectApiKeyEntries(value, entries = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectApiKeyEntries(item, entries);
    }
    return entries;
  }

  if (value === null || typeof value !== 'object') {
    return entries;
  }

  if (keyValue(value)) {
    entries.push(value);
  }

  for (const [name, nested] of Object.entries(value)) {
    if (
      typeof nested === 'string' &&
      /^(publishable|anon|secret|service_role)$/i.test(name)
    ) {
      entries.push({name, key: nested});
    } else {
      collectApiKeyEntries(nested, entries);
    }
  }

  return entries;
}

function jwtRole(value) {
  const segments = value.split('.');
  if (segments.length !== 3 || segments.some(segment => segment.length === 0)) {
    return undefined;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], 'base64url').toString('utf8'),
    );
    return typeof payload?.role === 'string' ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

export function parseStagingApiKeys(value) {
  let publishableKey;
  let secretKey;
  let anonJwt;
  let serviceRoleJwt;

  for (const entry of collectApiKeyEntries(value)) {
    const label = `${entry.name ?? ''} ${entry.type ?? ''}`.toLowerCase();
    const value = keyValue(entry);

    if (!publishableKey && value.startsWith('sb_publishable_')) {
      publishableKey = value;
    }
    if (!secretKey && value.startsWith('sb_secret_')) {
      secretKey = value;
    }
    if (!anonJwt && label.includes('anon') && jwtRole(value) === 'anon') {
      anonJwt = value;
    }
    if (
      !serviceRoleJwt &&
      label.includes('service_role') &&
      jwtRole(value) === 'service_role'
    ) {
      serviceRoleJwt = value;
    }
  }

  const publicApiKey = publishableKey ?? anonJwt;
  const adminApiKey = secretKey ?? serviceRoleJwt;
  if (!publicApiKey || !adminApiKey) {
    throw new Error('Required staging API credential is unavailable.');
  }

  return {publicApiKey, adminApiKey};
}

function readStagingApiKeys({spawnSyncImpl, environment}) {
  let result;
  try {
    result = spawnSyncImpl(
      supabaseCli,
      [
        'projects',
        'api-keys',
        '--project-ref',
        STAGING_PROJECT_REF,
        '--reveal',
        '--output',
        'json',
      ],
      {
        cwd: repositoryRoot,
        env: buildStagingEnvironment(environment),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch {
    throw new Error('Unable to read staging API keys.');
  }

  if (result.error || result.status !== 0) {
    throw new Error('Unable to read staging API keys.');
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('Staging API keys returned invalid JSON.');
  }

  return parseStagingApiKeys(parsed);
}

function requestHeaders(apiKey, bearer, extra = {}) {
  return {
    apikey: apiKey,
    ...(bearer === undefined ? {} : {Authorization: `Bearer ${bearer}`}),
    'Content-Type': 'application/json',
    ...extra,
  };
}

function adminHeaders(adminApiKey, extra = {}) {
  const bearer = jwtRole(adminApiKey) === 'service_role'
    ? adminApiKey
    : undefined;
  return requestHeaders(adminApiKey, bearer, extra);
}

async function request(fetchImpl, pathname, options, label) {
  let response;
  try {
    response = await fetchImpl(`${stagingApiUrl}${pathname}`, options);
  } catch {
    throw new Error(`Staging request failed (${label}).`);
  }

  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error(`Staging response was unreadable (${label}).`);
  }

  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {status: response.status, body, headers: response.headers};
}

function assertStatus(result, expected, label) {
  if (!expected.includes(result.status)) {
    throw new Error(`${label}: unexpected HTTP status ${result.status}.`);
  }
}

function assertRows(result, label) {
  assertStatus(result, [200], label);
  if (!Array.isArray(result.body)) {
    throw new Error(`${label}: expected a row array.`);
  }
  return result.body;
}

function assertSingleRow(result, label) {
  assertStatus(result, [200, 201], label);
  if (!Array.isArray(result.body) || result.body.length !== 1) {
    throw new Error(`${label}: expected exactly one row.`);
  }
  return result.body[0];
}

function assertNoStore(result, label) {
  if (result.headers?.get('cache-control') !== 'no-store') {
    throw new Error(`${label}: response must disable caching.`);
  }
}

function assertFinalizerFailure(result, status, code, label) {
  assertStatus(result, [status], label);
  if (
    result.body === null ||
    typeof result.body !== 'object' ||
    Array.isArray(result.body) ||
    result.body.code !== code
  ) {
    throw new Error(`${label}: unexpected failure contract.`);
  }
  assertNoStore(result, label);
}

function assertJwtRejected(result, label) {
  assertStatus(result, [401], label);
}

function sha256(cryptoImpl, bytes) {
  if (typeof cryptoImpl.sha256 === 'function') {
    return cryptoImpl.sha256(bytes);
  }
  return cryptoImpl.createHash('sha256').update(bytes).digest('hex');
}

function payloadDigest(cryptoImpl, payload) {
  return sha256(cryptoImpl, Buffer.from(JSON.stringify(payload)));
}

function createCredentials(cryptoImpl) {
  return {
    email: `guest-claim-${cryptoImpl.randomUUID()}@example.invalid`,
    password: cryptoImpl.randomBytes(24).toString('base64url'),
  };
}

async function createVerifiedUser(
  fetchImpl,
  adminApiKey,
  credentials,
) {
  const result = await request(
    fetchImpl,
    '/auth/v1/admin/users',
    {
      method: 'POST',
      headers: adminHeaders(adminApiKey),
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
        email_confirm: true,
      }),
    },
    'create disposable user',
  );
  assertStatus(result, [200, 201], 'create disposable user');
  if (typeof result.body?.id !== 'string') {
    throw new Error('create disposable user: missing user identifier.');
  }
  return result.body.id;
}

async function signIn(fetchImpl, publicKey, credentials) {
  const result = await request(
    fetchImpl,
    '/auth/v1/token?grant_type=password',
    {
      method: 'POST',
      headers: requestHeaders(publicKey, undefined),
      body: JSON.stringify(credentials),
    },
    'sign in disposable user',
  );
  assertStatus(result, [200], 'sign in disposable user');
  if (typeof result.body?.access_token !== 'string') {
    throw new Error('sign in disposable user: missing access token.');
  }
  return result.body.access_token;
}

async function readOnboardingStatus(context) {
  const result = await request(
    context.fetchImpl,
    '/rest/v1/rpc/get_onboarding_status',
    {
      method: 'POST',
      headers: requestHeaders(context.publicKey, context.accessToken),
      body: '{}',
    },
    'read onboarding status',
  );
  assertStatus(result, [200], 'read onboarding status');
  const required = result.body?.requiredDocuments;
  if (
    !Array.isArray(required) ||
    required.length !== 2 ||
    !required.every(document =>
      document !== null &&
      typeof document === 'object' &&
      typeof document.kind === 'string' &&
      typeof document.version === 'string'
    )
  ) {
    throw new Error('read onboarding status: invalid required documents.');
  }
  return required.map(({kind, version}) => ({kind, version}));
}

async function completeOnboarding(context) {
  const requestedDocuments = await readOnboardingStatus(context);
  const result = await request(
    context.fetchImpl,
    '/rest/v1/rpc/complete_onboarding',
    {
      method: 'POST',
      headers: requestHeaders(context.publicKey, context.accessToken),
      body: JSON.stringify({requested_documents: requestedDocuments}),
    },
    'complete onboarding',
  );
  assertStatus(result, [200], 'complete onboarding');
  if (result.body?.isComplete !== true) {
    throw new Error('complete onboarding: membership was not activated.');
  }
}

async function insertRow(context, table, row, label = `insert ${table}`) {
  const result = await request(
    context.fetchImpl,
    `/rest/v1/${table}`,
    {
      method: 'POST',
      headers: requestHeaders(context.publicKey, context.accessToken, {
        Prefer: 'return=representation',
      }),
      body: JSON.stringify(row),
    },
    label,
  );
  return assertSingleRow(result, label);
}

async function readRows(context, table, query, label = `read ${table}`) {
  const result = await request(
    context.fetchImpl,
    `/rest/v1/${table}?${query}`,
    {headers: requestHeaders(context.publicKey, context.accessToken)},
    label,
  );
  return assertRows(result, label);
}

async function updateRow(context, table, id, values, label) {
  const result = await request(
    context.fetchImpl,
    `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: requestHeaders(context.publicKey, context.accessToken, {
        Prefer: 'return=representation',
      }),
      body: JSON.stringify(values),
    },
    label,
  );
  return assertSingleRow(result, label);
}

async function expectDeniedInsert(
  attacker,
  targetOwner,
  table,
  row,
  uniqueColumn,
  uniqueValue,
) {
  const label = `cross-owner table write denial (${table})`;
  const result = await request(
    attacker.fetchImpl,
    `/rest/v1/${table}`,
    {
      method: 'POST',
      headers: requestHeaders(attacker.publicKey, attacker.accessToken, {
        Prefer: 'return=representation',
      }),
      body: JSON.stringify(row),
    },
    label,
  );
  assertStatus(
    result,
    [200, 201, 204, 400, 401, 403, 404, 409, 422],
    label,
  );
  const attackerVisible = await readRows(
    attacker,
    table,
    `select=id&${uniqueColumn}=eq.${encodeURIComponent(uniqueValue)}`,
    `${label} attacker re-query`,
  );
  if (attackerVisible.length !== 0) {
    throw new Error(`${label}: attacker re-query found a visible row.`);
  }
  const persisted = await readRows(
    targetOwner,
    table,
    `select=id&${uniqueColumn}=eq.${encodeURIComponent(uniqueValue)}`,
    `${label} owner re-query`,
  );
  if (persisted.length !== 0) {
    throw new Error(`${label}: owner re-query found a persisted row.`);
  }
}

async function expectDeniedUpdate(
  attacker,
  targetOwner,
  table,
  row,
  column,
  attemptedValue,
) {
  const label = `cross-owner table update denial (${table})`;
  const originalValue = JSON.stringify(row[column]);
  const result = await request(
    attacker.fetchImpl,
    `/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`,
    {
      method: 'PATCH',
      headers: requestHeaders(attacker.publicKey, attacker.accessToken, {
        Prefer: 'return=representation',
      }),
      body: JSON.stringify({[column]: attemptedValue}),
    },
    label,
  );
  assertStatus(
    result,
    [200, 204, 400, 401, 403, 404, 409, 422],
    label,
  );
  const attackerVisible = await readRows(
    attacker,
    table,
    `select=id&id=eq.${encodeURIComponent(row.id)}`,
    `${label} attacker re-query`,
  );
  if (attackerVisible.length !== 0) {
    throw new Error(`${label}: attacker re-query found a visible row.`);
  }
  const persisted = await readRows(
    targetOwner,
    table,
    `select=id,${column}&id=eq.${encodeURIComponent(row.id)}`,
    `${label} owner re-query`,
  );
  if (
    persisted.length !== 1 ||
    JSON.stringify(persisted[0][column]) !== originalValue
  ) {
    throw new Error(`${label}: owner re-query found a changed row.`);
  }
}

async function createOwnerFixture(context, cryptoImpl, index) {
  const planLocalId = `owner-${index}-plan-${cryptoImpl.randomUUID()}`;
  const logLocalId = `owner-${index}-log-${cryptoImpl.randomUUID()}`;
  const stagedLocalId = `owner-${index}-staged-${cryptoImpl.randomUUID()}`;
  const planPayload = {schemaVersion: 1, owner: index};
  const logPayload = {schemaVersion: 1, owner: index};
  const plan = await insertRow(context, 'dive_plans', {
    user_id: context.userId,
    local_id: planLocalId,
    status: 'planned',
    planned_at: '2026-07-20T01:00:00.000Z',
    dive_mode: 'scuba',
    site_name: `owner-${index}`,
    plan_data: planPayload,
    payload_sha256: payloadDigest(cryptoImpl, planPayload),
  });
  const log = await insertRow(context, 'dive_logs', {
    user_id: context.userId,
    local_id: logLocalId,
    source_plan_id: plan.id,
    source: 'manual',
    started_at: '2026-07-20T02:00:00.000Z',
    manual_data: logPayload,
    mobile_data: logPayload,
    provenance: {source: 'manual'},
    payload_sha256: payloadDigest(cryptoImpl, logPayload),
  });
  const batch = await insertRow(context, 'guest_claim_batches', {
    user_id: context.userId,
    client_batch_id: `owner-${index}-batch-${cryptoImpl.randomUUID()}`,
    manifest_sha256: payloadDigest(cryptoImpl, {owner: index}),
    expected_plan_count: 1,
    expected_log_count: 0,
  });
  const staged = await insertRow(context, 'guest_claim_records', {
    batch_id: batch.id,
    user_id: context.userId,
    entity_kind: 'plan',
    client_record_id: stagedLocalId,
    payload_sha256: payloadDigest(cryptoImpl, {staged: index}),
    payload: {status: 'planned', plan_data: {owner: index}},
  });
  return {batch, log, plan, staged};
}

async function createBatch(context, cryptoImpl, label, planCount, logCount) {
  return insertRow(context, 'guest_claim_batches', {
    user_id: context.userId,
    client_batch_id: `${label}-${cryptoImpl.randomUUID()}`,
    manifest_sha256: payloadDigest(cryptoImpl, {label}),
    expected_plan_count: planCount,
    expected_log_count: logCount,
  });
}

async function invokeFinalizer(
  context,
  batchId,
  {bearer = context.accessToken, includeAuthorization = true} = {},
) {
  return request(
    context.fetchImpl,
    '/functions/v1/finalize-guest-claim',
    {
      method: 'POST',
      headers: requestHeaders(
        context.publicKey,
        includeAuthorization ? bearer : undefined,
      ),
      body: JSON.stringify({batchId}),
    },
    'invoke guest claim finalizer',
  );
}

async function uploadProfile(context, objectPath, bytes) {
  const result = await request(
    context.fetchImpl,
    `/storage/v1/object/${profileBucket}/${objectPath}`,
    {
      method: 'POST',
      headers: requestHeaders(context.publicKey, context.accessToken, {
        'Content-Type': 'application/json',
        'x-upsert': 'false',
      }),
      body: bytes,
    },
    'upload claim profile',
  );
  assertStatus(result, [200], 'upload claim profile');
}

async function downloadProfile(context, objectPath) {
  return request(
    context.fetchImpl,
    `/storage/v1/object/authenticated/${profileBucket}/${objectPath}`,
    {headers: requestHeaders(context.publicKey, context.accessToken)},
    'download claim profile',
  );
}

async function deleteProfiles(
  fetchImpl,
  adminApiKey,
  objectPaths,
) {
  if (objectPaths.length === 0) {
    return;
  }
  const result = await request(
    fetchImpl,
    `/storage/v1/object/${profileBucket}`,
    {
      method: 'DELETE',
      headers: adminHeaders(adminApiKey),
      body: JSON.stringify({prefixes: objectPaths}),
    },
    'delete disposable profiles',
  );
  assertStatus(result, [200], 'delete disposable profiles');
}

async function deleteUser(fetchImpl, adminApiKey, userId) {
  const result = await request(
    fetchImpl,
    `/auth/v1/admin/users/${userId}`,
    {
      method: 'DELETE',
      headers: adminHeaders(adminApiKey),
    },
    'delete disposable user',
  );
  assertStatus(result, [200, 204], 'delete disposable user');
}

async function findUserIdByEmail(
  fetchImpl,
  adminApiKey,
  email,
) {
  const perPage = 100;
  for (let page = 1; page <= 100; page += 1) {
    const result = await request(
      fetchImpl,
      `/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      {headers: adminHeaders(adminApiKey)},
      'list disposable users for cleanup',
    );
    assertStatus(result, [200], 'list disposable users for cleanup');
    const users = result.body?.users;
    if (!Array.isArray(users)) {
      throw new Error('list disposable users for cleanup: invalid response.');
    }

    const match = users.find(user =>
      user !== null &&
      typeof user === 'object' &&
      user.email === email &&
      typeof user.id === 'string'
    );
    if (match) {
      return match.id;
    }
    if (users.length < perPage) {
      return undefined;
    }
  }

  throw new Error('list disposable users for cleanup: pagination limit exceeded.');
}

async function cleanupUser(
  fetchImpl,
  adminApiKey,
  target,
) {
  const userId = target.userId ?? await findUserIdByEmail(
    fetchImpl,
    adminApiKey,
    target.email,
  );
  if (userId) {
    await deleteUser(fetchImpl, adminApiKey, userId);
  }
}

async function verifyMemberships(contexts) {
  for (const [index, context] of contexts.entries()) {
    const ownRows = await readRows(
      context,
      'app_memberships',
      `select=user_id&user_id=eq.${context.userId}`,
      'active membership owner query',
    );
    if (ownRows.length !== 1 || ownRows[0].user_id !== context.userId) {
      throw new Error('active membership owner query: unexpected rows.');
    }

    const other = contexts[index === 0 ? 1 : 0];
    const crossRows = await readRows(
      context,
      'app_memberships',
      `select=user_id&user_id=eq.${other.userId}`,
      'cross-owner membership query',
    );
    if (crossRows.length !== 0) {
      throw new Error('cross-owner membership query must return no rows.');
    }
  }
}

async function verifyOwnerIsolation(contexts, fixtures, cryptoImpl) {
  const owner = contexts[0];
  const other = contexts[1];
  const otherFixture = fixtures[1];
  const tableRows = [
    ['dive_plans', otherFixture.plan],
    ['dive_logs', otherFixture.log],
    ['guest_claim_batches', otherFixture.batch],
    ['guest_claim_records', otherFixture.staged],
  ];

  for (const [table, row] of tableRows) {
    const owned = await readRows(
      other,
      table,
      `select=id,user_id&id=eq.${row.id}`,
      `owner read (${table})`,
    );
    if (owned.length !== 1) {
      throw new Error(`owner read (${table}): expected one row.`);
    }
    const cross = await readRows(
      owner,
      table,
      `select=id,user_id&user_id=eq.${other.userId}`,
      `cross-owner table read denial (${table})`,
    );
    if (cross.length !== 0) {
      throw new Error(`cross-owner table read denial (${table}): rows were visible.`);
    }
  }

  const crossPlanId = `cross-plan-${cryptoImpl.randomUUID()}`;
  const crossLogId = `cross-log-${cryptoImpl.randomUUID()}`;
  const crossBatchId = `cross-batch-${cryptoImpl.randomUUID()}`;
  const crossStagedId = `cross-staged-${cryptoImpl.randomUUID()}`;
  await expectDeniedInsert(
    owner,
    other,
    'dive_plans',
    {
      user_id: other.userId,
      local_id: crossPlanId,
      status: 'planned',
      plan_data: {cross: true},
      payload_sha256: payloadDigest(cryptoImpl, {crossPlanId}),
    },
    'local_id',
    crossPlanId,
  );
  await expectDeniedInsert(
    owner,
    other,
    'dive_logs',
    {
      user_id: other.userId,
      local_id: crossLogId,
      source_plan_id: otherFixture.plan.id,
      source: 'manual',
      started_at: '2026-07-20T02:00:00.000Z',
      manual_data: {},
      mobile_data: {},
      provenance: {source: 'manual'},
      payload_sha256: payloadDigest(cryptoImpl, {crossLogId}),
    },
    'local_id',
    crossLogId,
  );
  await expectDeniedInsert(
    owner,
    other,
    'guest_claim_batches',
    {
      user_id: other.userId,
      client_batch_id: crossBatchId,
      manifest_sha256: payloadDigest(cryptoImpl, {crossBatch: true}),
      expected_plan_count: 0,
      expected_log_count: 0,
    },
    'client_batch_id',
    crossBatchId,
  );
  await expectDeniedInsert(
    owner,
    other,
    'guest_claim_records',
    {
      batch_id: otherFixture.batch.id,
      user_id: other.userId,
      entity_kind: 'plan',
      client_record_id: crossStagedId,
      payload_sha256: payloadDigest(cryptoImpl, {crossStaged: true}),
      payload: {status: 'planned', plan_data: {}},
    },
    'client_record_id',
    crossStagedId,
  );

  for (const [table, row, column, attemptedValue] of [
    ['dive_plans', otherFixture.plan, 'site_name', 'cross-owner change'],
    [
      'dive_logs',
      otherFixture.log,
      'started_at',
      '2026-07-21T02:00:00.000Z',
    ],
    [
      'guest_claim_batches',
      otherFixture.batch,
      'manifest_sha256',
      payloadDigest(cryptoImpl, {crossUpdate: 'batch'}),
    ],
    [
      'guest_claim_records',
      otherFixture.staged,
      'payload_sha256',
      payloadDigest(cryptoImpl, {crossUpdate: 'record'}),
    ],
  ]) {
    await expectDeniedUpdate(
      owner,
      other,
      table,
      row,
      column,
      attemptedValue,
    );
  }
}

async function verifyAtomicRollback(context, cryptoImpl) {
  const batch = await createBatch(
    context,
    cryptoImpl,
    'rollback-after-plan',
    1,
    1,
  );
  const planLocalId = `rollback-plan-${cryptoImpl.randomUUID()}`;
  const logLocalId = `rollback-log-${cryptoImpl.randomUUID()}`;
  const planPayload = {
    status: 'planned',
    planned_at: '2026-07-20T01:00:00.000Z',
    plan_data: {schemaVersion: 1},
  };
  const logPayload = {
    source: 'manual',
    started_at: 'not-a-timestamp',
    manual_data: {schemaVersion: 1},
    mobile_data: {schemaVersion: 1},
    provenance: {source: 'manual'},
  };
  await insertRow(context, 'guest_claim_records', {
    batch_id: batch.id,
    user_id: context.userId,
    entity_kind: 'plan',
    client_record_id: planLocalId,
    payload_sha256: payloadDigest(cryptoImpl, planPayload),
    payload: planPayload,
  });
  await insertRow(context, 'guest_claim_records', {
    batch_id: batch.id,
    user_id: context.userId,
    entity_kind: 'log',
    client_record_id: logLocalId,
    payload_sha256: payloadDigest(cryptoImpl, logPayload),
    payload: logPayload,
  });

  for (const [table, localId] of [
    ['dive_plans', planLocalId],
    ['dive_logs', logLocalId],
  ]) {
    const before = await readRows(
      context,
      table,
      `select=id&local_id=eq.${encodeURIComponent(localId)}`,
      'atomic rollback pre-finalization isolation',
    );
    if (before.length !== 0) {
      throw new Error('atomic rollback rows must be hidden before finalization.');
    }
  }

  const finalized = await invokeFinalizer(context, batch.id);
  assertFinalizerFailure(
    finalized,
    409,
    'claim_validation_failed',
    'later log cast rejection',
  );
  for (const [table, localId] of [
    ['dive_plans', planLocalId],
    ['dive_logs', logLocalId],
  ]) {
    const after = await readRows(
      context,
      table,
      `select=id&local_id=eq.${encodeURIComponent(localId)}`,
      'atomic rollback verification',
    );
    if (after.length !== 0) {
      throw new Error('atomic rollback must not publish account rows.');
    }
  }
}

async function verifyCompleteClaim(context, other, cryptoImpl, objectPaths) {
  const batch = await createBatch(context, cryptoImpl, 'complete-claim', 1, 1);
  const planLocalId = `claimed-plan-${cryptoImpl.randomUUID()}`;
  const logLocalId = `claimed-log-${cryptoImpl.randomUUID()}`;
  const planPayload = {
    status: 'planned',
    planned_at: '2026-07-20T03:00:00.000Z',
    dive_mode: 'scuba',
    site_name: 'staging claim',
    plan_data: {schemaVersion: 1},
  };
  const logPayload = {
    dive_mode: 'scuba',
    source: 'watch',
    started_at: '2026-07-20T04:00:00.000Z',
    ended_at: '2026-07-20T04:40:00.000Z',
    duration_seconds: 2400,
    max_depth_meters: 18.4,
    site_name: 'staging claim',
    title: 'staging claim',
    rating: 4,
    manual_data: {schemaVersion: 1},
    mobile_data: {schemaVersion: 1},
    watch_metadata: {schemaVersion: 1},
    provenance: {source: 'watch'},
    profile_preview: [{elapsedSeconds: 0, depthMeters: 0}],
  };
  const planRecord = await insertRow(context, 'guest_claim_records', {
    batch_id: batch.id,
    user_id: context.userId,
    entity_kind: 'plan',
    client_record_id: planLocalId,
    converted_log_client_record_id: logLocalId,
    payload_sha256: payloadDigest(cryptoImpl, planPayload),
    payload: planPayload,
  });
  const logRecord = await insertRow(context, 'guest_claim_records', {
    batch_id: batch.id,
    user_id: context.userId,
    entity_kind: 'log',
    client_record_id: logLocalId,
    source_plan_client_record_id: planLocalId,
    payload_sha256: payloadDigest(cryptoImpl, logPayload),
    payload: logPayload,
  });
  const profileBytes = new TextEncoder().encode(JSON.stringify([
    {elapsedSeconds: 0, depthMeters: 0},
    {elapsedSeconds: 10, depthMeters: 2.1},
  ]));
  const profilePath =
    `${context.userId}/claims/${batch.id}/${logRecord.id}/profile-v1.json`;
  const profileSha256 = sha256(cryptoImpl, profileBytes);
  objectPaths.push(profilePath);
  await uploadProfile(context, profilePath, profileBytes);
  await updateRow(context, 'guest_claim_records', logRecord.id, {
    profile_path: profilePath,
    profile_content_revision: 'profile-v1',
    profile_sha256: profileSha256,
    profile_byte_count: profileBytes.byteLength,
    profile_sample_count: 2,
  }, 'attach claim profile metadata');

  const ownerDownload = await downloadProfile(context, profilePath);
  assertStatus(ownerDownload, [200], 'owner private profile read');
  const crossDownload = await downloadProfile(other, profilePath);
  assertStatus(
    crossDownload,
    [400, 403, 404],
    'cross-owner private profile read denial',
  );

  for (const [table, localId] of [
    ['dive_plans', planLocalId],
    ['dive_logs', logLocalId],
  ]) {
    const before = await readRows(
      context,
      table,
      `select=id&local_id=eq.${encodeURIComponent(localId)}`,
      'complete claim pre-finalization isolation',
    );
    if (before.length !== 0) {
      throw new Error('complete claim must not expose account rows before finalization.');
    }
  }

  const finalized = await invokeFinalizer(context, batch.id);
  assertStatus(finalized, [200], 'complete claim finalization');
  assertNoStore(finalized, 'complete claim finalization');
  const expected = {
    batchId: batch.id,
    status: 'committed',
    planCount: 1,
    logCount: 1,
  };
  if (JSON.stringify(finalized.body) !== JSON.stringify(expected)) {
    throw new Error('complete claim finalization: unexpected response.');
  }

  const plans = await readRows(
    context,
    'dive_plans',
    `select=id,converted_log_id,payload_sha256&local_id=eq.${encodeURIComponent(planLocalId)}`,
    'read published claim plan',
  );
  const logs = await readRows(
    context,
    'dive_logs',
    `select=id,source_plan_id,profile_path,profile_sha256,payload_sha256&local_id=eq.${encodeURIComponent(logLocalId)}`,
    'read published claim log',
  );
  if (
    plans.length !== 1 ||
    logs.length !== 1 ||
    plans[0].id !== planRecord.target_record_id ||
    logs[0].id !== logRecord.target_record_id ||
    plans[0].converted_log_id !== logs[0].id ||
    logs[0].source_plan_id !== plans[0].id ||
    logs[0].profile_path !== profilePath ||
    logs[0].profile_sha256 !== profileSha256
  ) {
    throw new Error('complete claim finalization: published metadata is invalid.');
  }

  const repeated = await invokeFinalizer(context, batch.id);
  assertStatus(repeated, [200], 'repeated finalization');
  assertNoStore(repeated, 'repeated finalization');
  if (JSON.stringify(repeated.body) !== JSON.stringify(expected)) {
    throw new Error('repeated finalization must be idempotent.');
  }
  const repeatedPlans = await readRows(
    context,
    'dive_plans',
    `select=id&local_id=eq.${encodeURIComponent(planLocalId)}`,
    'repeated finalization plan count',
  );
  const repeatedLogs = await readRows(
    context,
    'dive_logs',
    `select=id&local_id=eq.${encodeURIComponent(logLocalId)}`,
    'repeated finalization log count',
  );
  if (repeatedPlans.length !== 1 || repeatedLogs.length !== 1) {
    throw new Error('repeated finalization must not create duplicates.');
  }
}

export async function verifyStagingGuestClaim({
  assertProjectRef = assertStagingProjectRef,
  spawnSyncImpl = spawnSync,
  environment = process.env,
  fetchImpl = fetch,
  cryptoImpl = {createHash, randomBytes, randomUUID},
} = {}) {
  await assertProjectRef();
  const {publicApiKey, adminApiKey} = readStagingApiKeys({
    spawnSyncImpl,
    environment,
  });
  const credentials = [createCredentials(cryptoImpl), createCredentials(cryptoImpl)];
  const contexts = [];
  const cleanupTargets = [];
  const objectPaths = [];
  let verificationError;

  try {
    for (const credential of credentials) {
      const cleanupTarget = {email: credential.email, userId: undefined};
      cleanupTargets.push(cleanupTarget);
      const userId = await createVerifiedUser(
        fetchImpl,
        adminApiKey,
        credential,
      );
      cleanupTarget.userId = userId;
      const accessToken = await signIn(fetchImpl, publicApiKey, credential);
      contexts.push({
        fetchImpl,
        publicKey: publicApiKey,
        accessToken,
        userId,
      });
    }

    const preOnboarding = await request(
      fetchImpl,
      '/rest/v1/dive_plans',
      {
        method: 'POST',
        headers: requestHeaders(publicApiKey, contexts[0].accessToken, {
          Prefer: 'return=representation',
        }),
        body: JSON.stringify({
          user_id: contexts[0].userId,
          local_id: `pre-onboarding-${cryptoImpl.randomUUID()}`,
          status: 'planned',
          plan_data: {},
          payload_sha256: payloadDigest(cryptoImpl, {preOnboarding: true}),
        }),
      },
      'pre-onboarding owner write denial',
    );
    assertStatus(preOnboarding, [401, 403], 'pre-onboarding owner write denial');

    await Promise.all(contexts.map(completeOnboarding));
    await verifyMemberships(contexts);

    const fixtures = [];
    for (const [index, context] of contexts.entries()) {
      fixtures.push(await createOwnerFixture(context, cryptoImpl, index));
    }
    await verifyOwnerIsolation(contexts, fixtures, cryptoImpl);

    const missingJwt = await invokeFinalizer(
      contexts[0],
      cryptoImpl.randomUUID(),
      {includeAuthorization: false},
    );
    assertJwtRejected(missingJwt, 'missing finalizer JWT rejection');
    const invalidJwt = await invokeFinalizer(
      contexts[0],
      cryptoImpl.randomUUID(),
      {bearer: 'invalid-jwt'},
    );
    assertJwtRejected(invalidJwt, 'invalid finalizer JWT rejection');

    await verifyAtomicRollback(contexts[0], cryptoImpl);
    await verifyCompleteClaim(
      contexts[0],
      contexts[1],
      cryptoImpl,
      objectPaths,
    );
  } catch (error) {
    verificationError = error;
  } finally {
    const cleanupResults = await Promise.allSettled([
      deleteProfiles(
        fetchImpl,
        adminApiKey,
        objectPaths,
      ),
      ...cleanupTargets.map(target =>
        cleanupUser(
          fetchImpl,
          adminApiKey,
          target,
        )
      ),
    ]);
    if (cleanupResults.some(result => result.status === 'rejected')) {
      throw new Error('Staging cleanup failed.');
    }
  }

  if (verificationError) {
    throw verificationError;
  }

  return {status: 'passed'};
}

export async function runStagingGuestClaimVerificationCli({
  verify = verifyStagingGuestClaim,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    await verify();
    stdout.write('PASS staging guest claim verification\n');
    return true;
  } catch {
    stderr.write('FAIL staging guest claim verification\n');
    return false;
  }
}

async function main() {
  const passed = await runStagingGuestClaimVerificationCli();
  if (!passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
