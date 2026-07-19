import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const supabaseCli = path.join(
  repositoryRoot,
  'node_modules',
  '.bin',
  'supabase',
);
const digest = character => character.repeat(64);

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

  return {status: response.status, body};
}

function assertStatus(result, expected, label) {
  assert.ok(
    expected.includes(result.status),
    `${label}: expected ${expected.join('/')} but received ${result.status}`,
  );
}

function logCheck(label) {
  console.log(`PASS ${label}`);
}

function createDisposableCredentials() {
  return {
    email: `guest-claim-${randomUUID()}@example.invalid`,
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

async function insertRow(apiUrl, publishableKey, accessToken, table, row) {
  return request(`${apiUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(publishableKey, accessToken, {
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(row),
  });
}

async function readRows(apiUrl, publishableKey, accessToken, table, query) {
  return request(`${apiUrl}/rest/v1/${table}?${query}`, {
    headers: headers(publishableKey, accessToken),
  });
}

async function updateRows(
  apiUrl,
  apiKey,
  accessToken,
  table,
  query,
  values,
) {
  return request(`${apiUrl}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: headers(apiKey, accessToken, {
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(values),
  });
}

async function uploadProfile(
  apiUrl,
  publishableKey,
  accessToken,
  objectPath,
  profile,
  upsert = false,
) {
  return request(
    `${apiUrl}/storage/v1/object/dive-profiles/${objectPath}`,
    {
      method: 'POST',
      headers: headers(publishableKey, accessToken, {
        'x-upsert': String(upsert),
      }),
      body: JSON.stringify(profile),
    },
  );
}

async function downloadProfile(
  apiUrl,
  publishableKey,
  accessToken,
  objectPath,
) {
  return request(
    `${apiUrl}/storage/v1/object/authenticated/dive-profiles/${objectPath}`,
    {headers: headers(publishableKey, accessToken)},
  );
}

async function deleteProfiles(apiUrl, secretKey, objectPaths) {
  if (objectPaths.length === 0) {
    return;
  }

  const result = await request(
    `${apiUrl}/storage/v1/object/dive-profiles`,
    {
      method: 'DELETE',
      headers: headers(secretKey),
      body: JSON.stringify({prefixes: objectPaths}),
    },
  );

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
const credentials = [
  createDisposableCredentials(),
  createDisposableCredentials(),
];
const userIds = [];
const objectPaths = [];

try {
  for (const credential of credentials) {
    userIds.push(
      await createVerifiedUser(status.API_URL, status.SECRET_KEY, credential),
    );
  }

  const accessTokens = await Promise.all(
    credentials.map(credential =>
      signIn(status.API_URL, status.PUBLISHABLE_KEY, credential),
    ),
  );

  const anonymousRead = await readRows(
    status.API_URL,
    status.PUBLISHABLE_KEY,
    status.PUBLISHABLE_KEY,
    'dive_plans',
    'select=id',
  );
  assertStatus(anonymousRead, [401, 403], 'anonymous account data denial');
  logCheck('anonymous account data denial');

  const preOnboardingInsert = await insertRow(
    status.API_URL,
    status.PUBLISHABLE_KEY,
    accessTokens[0],
    'dive_plans',
    {
      user_id: userIds[0],
      local_id: 'pre-onboarding-plan',
      status: 'planned',
      plan_data: {version: 1},
      payload_sha256: digest('a'),
    },
  );
  assertStatus(preOnboardingInsert, [401, 403], 'pre-onboarding data denial');
  logCheck('pre-onboarding data denial');

  await Promise.all(
    accessTokens.map(accessToken =>
      completeOnboarding(
        status.API_URL,
        status.PUBLISHABLE_KEY,
        accessToken,
      ),
    ),
  );

  const committedBatchInsert = await insertRow(
    status.API_URL,
    status.PUBLISHABLE_KEY,
    accessTokens[0],
    'guest_claim_batches',
    {
      user_id: userIds[0],
      client_batch_id: 'client-created-committed-batch',
      manifest_sha256: digest('1'),
      expected_plan_count: 0,
      expected_log_count: 0,
      status: 'committed',
    },
  );
  assertStatus(
    committedBatchInsert,
    [403],
    'client committed-batch creation denial',
  );

  const timestampedBatchInsert = await insertRow(
    status.API_URL,
    status.PUBLISHABLE_KEY,
    accessTokens[0],
    'guest_claim_batches',
    {
      user_id: userIds[0],
      client_batch_id: 'client-created-timestamped-batch',
      manifest_sha256: digest('2'),
      expected_plan_count: 0,
      expected_log_count: 0,
      committed_at: new Date().toISOString(),
    },
  );
  assertStatus(
    timestampedBatchInsert,
    [403],
    'client committed-at creation denial',
  );
  logCheck('client claim batch lifecycle enforcement');

  const ownerRecords = [];
  for (let index = 0; index < userIds.length; index += 1) {
    const plan = await insertRow(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      accessTokens[index],
      'dive_plans',
      {
        user_id: userIds[index],
        local_id: `owner-${index}-plan`,
        status: 'planned',
        planned_at: `2026-07-1${index + 1}T01:00:00Z`,
        plan_data: {version: 1, owner: index},
        payload_sha256: digest(index === 0 ? 'b' : 'c'),
      },
    );
    assertStatus(plan, [201], 'insert owner plan');
    assert.equal(plan.body?.length, 1);

    const log = await insertRow(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      accessTokens[index],
      'dive_logs',
      {
        user_id: userIds[index],
        local_id: `owner-${index}-log`,
        source_plan_id: plan.body[0].id,
        source: 'manual',
        started_at: `2026-07-1${index + 1}T02:00:00Z`,
        manual_data: {version: 1},
        mobile_data: {version: 1},
        provenance: {source: 'manual'},
        payload_sha256: digest(index === 0 ? 'd' : 'e'),
      },
    );
    assertStatus(log, [201], 'insert owner log');
    assert.equal(log.body?.length, 1);

    const batch = await insertRow(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      accessTokens[index],
      'guest_claim_batches',
      {
        user_id: userIds[index],
        client_batch_id: `owner-${index}-batch`,
        manifest_sha256: digest(index === 0 ? 'f' : '0'),
        expected_plan_count: 1,
        expected_log_count: 0,
      },
    );
    assertStatus(batch, [201], 'insert owner claim batch');
    assert.equal(batch.body?.length, 1);

    const staged = await insertRow(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      accessTokens[index],
      'guest_claim_records',
      {
        batch_id: batch.body[0].id,
        user_id: userIds[index],
        entity_kind: 'plan',
        client_record_id: `owner-${index}-staged-plan`,
        payload_sha256: digest(index === 0 ? '1' : '2'),
        payload: {version: 1},
      },
    );
    assertStatus(staged, [201], 'insert owner claim record');
    assert.equal(staged.body?.length, 1);

    ownerRecords.push({
      plan: plan.body[0],
      log: log.body[0],
      batch: batch.body[0],
      staged: staged.body[0],
    });
  }
  logCheck('owner rows and claim staging writes');

  const uploadingBatchUpdate = await updateRows(
    status.API_URL,
    status.PUBLISHABLE_KEY,
    accessTokens[0],
    'guest_claim_records',
    `id=eq.${ownerRecords[0].staged.id}`,
    {payload: {version: 2}},
  );
  assertStatus(uploadingBatchUpdate, [200], 'update uploading claim record');
  assert.deepEqual(uploadingBatchUpdate.body, [
    {...ownerRecords[0].staged, payload: {version: 2}},
  ]);
  ownerRecords[0].staged = uploadingBatchUpdate.body[0];
  logCheck('uploading claim record update');

  const committedBatch = await updateRows(
    status.API_URL,
    status.SECRET_KEY,
    status.SECRET_KEY,
    'guest_claim_batches',
    `id=eq.${ownerRecords[0].batch.id}`,
    {
      status: 'committed',
      committed_at: new Date().toISOString(),
    },
  );
  assertStatus(committedBatch, [200], 'service claim batch commit fixture');
  assert.equal(committedBatch.body?.length, 1);

  const postCommitInsert = await insertRow(
    status.API_URL,
    status.PUBLISHABLE_KEY,
    accessTokens[0],
    'guest_claim_records',
    {
      batch_id: ownerRecords[0].batch.id,
      user_id: userIds[0],
      entity_kind: 'plan',
      client_record_id: 'post-commit-insert',
      payload_sha256: digest('3'),
      payload: {version: 1},
    },
  );
  assertStatus(postCommitInsert, [403], 'post-commit claim record insert denial');

  const postCommitUpdate = await updateRows(
    status.API_URL,
    status.PUBLISHABLE_KEY,
    accessTokens[0],
    'guest_claim_records',
    `id=eq.${ownerRecords[0].staged.id}`,
    {payload: {version: 3}},
  );
  assertStatus(
    postCommitUpdate,
    [200, 403],
    'post-commit claim record update denial',
  );
  if (postCommitUpdate.status === 200) {
    assert.deepEqual(postCommitUpdate.body, []);
  }

  const unchangedRecord = await readRows(
    status.API_URL,
    status.PUBLISHABLE_KEY,
    accessTokens[0],
    'guest_claim_records',
    `select=payload&id=eq.${ownerRecords[0].staged.id}`,
  );
  assertStatus(unchangedRecord, [200], 'read committed claim record');
  assert.deepEqual(unchangedRecord.body, [{payload: {version: 2}}]);
  logCheck('post-commit claim record immutability');

  for (let index = 0; index < userIds.length; index += 1) {
    const otherIndex = index === 0 ? 1 : 0;
    for (const table of [
      'dive_plans',
      'dive_logs',
      'guest_claim_batches',
      'guest_claim_records',
    ]) {
      const ownRows = await readRows(
        status.API_URL,
        status.PUBLISHABLE_KEY,
        accessTokens[index],
        table,
        `select=id,user_id&user_id=eq.${userIds[index]}`,
      );
      assertStatus(ownRows, [200], `read owned ${table}`);
      assert.equal(ownRows.body.length, 1);

      const crossOwnerRows = await readRows(
        status.API_URL,
        status.PUBLISHABLE_KEY,
        accessTokens[index],
        table,
        `select=id,user_id&user_id=eq.${userIds[otherIndex]}`,
      );
      assertStatus(crossOwnerRows, [200], `cross-owner ${table} query`);
      assert.deepEqual(crossOwnerRows.body, []);
    }
  }
  logCheck('cross-owner row isolation');

  for (let index = 0; index < userIds.length; index += 1) {
    const stagedId = `owner-${index}-staged-plan`;
    for (const table of ['dive_plans', 'dive_logs']) {
      const normalRows = await readRows(
        status.API_URL,
        status.PUBLISHABLE_KEY,
        accessTokens[index],
        table,
        `select=id&local_id=eq.${stagedId}`,
      );
      assertStatus(normalRows, [200], `staging isolation from ${table}`);
      assert.deepEqual(normalRows.body, []);
    }
  }
  logCheck('staging isolation from account rows');

  for (let index = 0; index < userIds.length; index += 1) {
    const namespace = index === 0 ? 'claims' : 'logs';
    const objectPath = `${userIds[index]}/${namespace}/${randomUUID()}.json`;
    objectPaths.push(objectPath);

    const upload = await uploadProfile(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      accessTokens[index],
      objectPath,
      {samples: [{elapsedSeconds: 0, depthMeters: index + 1}]},
    );
    assertStatus(upload, [200], 'upload owner profile');

    const ownDownload = await downloadProfile(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      accessTokens[index],
      objectPath,
    );
    assertStatus(ownDownload, [200], 'download owner profile');

    const otherIndex = index === 0 ? 1 : 0;
    const crossOwnerDownload = await downloadProfile(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      accessTokens[otherIndex],
      objectPath,
    );
    assertStatus(
      crossOwnerDownload,
      [400, 403, 404],
      'cross-owner private profile denial',
    );

    const overwrite = await uploadProfile(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      accessTokens[index],
      objectPath,
      {samples: []},
      true,
    );
    assertStatus(overwrite, [400, 403, 409], 'immutable profile overwrite');

    const unchangedDownload = await downloadProfile(
      status.API_URL,
      status.PUBLISHABLE_KEY,
      accessTokens[index],
      objectPath,
    );
    assertStatus(unchangedDownload, [200], 'download immutable owner profile');
    assert.deepEqual(unchangedDownload.body, {
      samples: [{elapsedSeconds: 0, depthMeters: index + 1}],
    });
  }
  logCheck('private immutable profile objects');

  for (let index = 0; index < userIds.length; index += 1) {
    const hardDelete = await request(
      `${status.API_URL}/rest/v1/dive_logs?id=eq.${ownerRecords[index].log.id}`,
      {
        method: 'DELETE',
        headers: headers(status.PUBLISHABLE_KEY, accessTokens[index]),
      },
    );
    assertStatus(hardDelete, [401, 403], 'client hard-delete denial');
  }
  logCheck('client hard-delete denial');
} finally {
  const cleanupResults = await Promise.allSettled([
    deleteProfiles(status.API_URL, status.SECRET_KEY, objectPaths),
    ...userIds.map(userId =>
      deleteUser(status.API_URL, status.SECRET_KEY, userId),
    ),
  ]);
  const cleanupFailure = cleanupResults.find(result => result.status === 'rejected');

  if (cleanupFailure) {
    throw cleanupFailure.reason;
  }
}
