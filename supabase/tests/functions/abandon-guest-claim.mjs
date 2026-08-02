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

function localStatus() {
  const environment = {...process.env};
  for (const name of [
    'PINTERNET_SUPABASE_PROJECT_ID',
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_PROJECT_ID',
  ]) {
    delete environment[name];
  }
  return JSON.parse(
    execFileSync(supabaseCli, ['status', '-o', 'json'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
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
  const text = await response.text();
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

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function createUser(status, label) {
  const credentials = {
    email: `abandon-${label}-${randomUUID()}@example.invalid`,
    password: randomBytes(24).toString('base64url'),
  };
  const created = await request(`${status.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: headers(status.SECRET_KEY),
    body: JSON.stringify({
      ...credentials,
      email_confirm: true,
    }),
  });
  assert.ok([200, 201].includes(created.status));
  const signedIn = await request(
    `${status.API_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: headers(status.PUBLISHABLE_KEY),
      body: JSON.stringify(credentials),
    },
  );
  assert.equal(signedIn.status, 200);
  const context = {
    apiUrl: status.API_URL,
    publishableKey: status.PUBLISHABLE_KEY,
    userId: created.body.id,
    accessToken: signedIn.body.access_token,
  };
  const onboarding = await request(
    `${status.API_URL}/rest/v1/rpc/complete_onboarding`,
    {
      method: 'POST',
      headers: headers(context.publishableKey, context.accessToken),
      body: JSON.stringify({
        requested_documents: [
          {kind: 'terms', version: '2026-07-13'},
          {kind: 'privacy', version: '2026-07-13'},
        ],
      }),
    },
  );
  assert.equal(onboarding.status, 200);
  return context;
}

async function insert(context, table, value) {
  const result = await request(`${context.apiUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(context.publishableKey, context.accessToken, {
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(value),
  });
  assert.equal(result.status, 201);
  return result.body[0];
}

async function createBatch(context, label, logCount = 0) {
  return insert(context, 'guest_claim_batches', {
    user_id: context.userId,
    client_batch_id: `${label}-${randomUUID()}`,
    manifest_sha256: digest(`${label}-${randomUUID()}`),
    expected_plan_count: 0,
    expected_log_count: logCount,
  });
}

async function invoke(context, functionName, batchId) {
  return request(`${context.apiUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: headers(context.publishableKey, context.accessToken),
    body: JSON.stringify({batchId}),
  });
}

async function deleteUser(status, userId) {
  const result = await request(`${status.API_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: headers(status.SECRET_KEY),
  });
  assert.ok([200, 204, 404].includes(result.status));
}

const status = localStatus();
const users = [];

try {
  const owner = await createUser(status, 'owner');
  const stranger = await createUser(status, 'stranger');
  users.push(owner.userId, stranger.userId);

  const batch = await createBatch(owner, 'delete-watch-log', 1);
  const targetId = randomUUID();
  const profilePath =
    `${owner.userId}/claims/${batch.id}/${targetId}/revision-1.json`;
  const profileBytes = Buffer.from(
    JSON.stringify([
      {
        localSessionId: 'watch-session-1',
        timestamp: 1,
        depthMeters: 2,
      },
    ]),
  );
  await insert(owner, 'guest_claim_records', {
    batch_id: batch.id,
    user_id: owner.userId,
    entity_kind: 'log',
    client_record_id: 'watch-log-1',
    target_record_id: targetId,
    payload_sha256: digest('{}'),
    payload: {},
    profile_path: profilePath,
    profile_content_revision: 'revision-1',
    profile_sha256: digest(profileBytes),
    profile_byte_count: profileBytes.length,
    profile_sample_count: 1,
  });
  const uploaded = await request(
    `${owner.apiUrl}/storage/v1/object/dive-profiles/${profilePath}`,
    {
      method: 'POST',
      headers: headers(owner.publishableKey, owner.accessToken, {
        'Content-Type': 'application/json',
        'x-upsert': 'false',
      }),
      body: profileBytes,
    },
  );
  assert.equal(uploaded.status, 200);

  const abandoned = await invoke(owner, 'abandon-guest-claim', batch.id);
  assert.equal(
    abandoned.status,
    200,
    `abandon function response: ${JSON.stringify(abandoned.body)}`,
  );
  assert.deepEqual(abandoned.body, {
    batchId: batch.id,
    status: 'abandoned',
    storageCleanupPending: false,
  });
  assert.equal(abandoned.headers.get('cache-control'), 'no-store');

  const readback = await request(
    `${owner.apiUrl}/rest/v1/guest_claim_batches?select=status,abandoned_at&id=eq.${batch.id}`,
    {headers: headers(owner.publishableKey, owner.accessToken)},
  );
  assert.deepEqual(readback.body.map(({status: value}) => value), ['abandoned']);
  assert.equal(typeof readback.body[0].abandoned_at, 'string');

  const missingProfile = await request(
    `${owner.apiUrl}/storage/v1/object/dive-profiles/${profilePath}`,
    {headers: headers(owner.publishableKey, owner.accessToken)},
  );
  assert.ok([400, 404].includes(missingProfile.status));

  const staleFinalize = await invoke(owner, 'finalize-guest-claim', batch.id);
  assert.equal(staleFinalize.status, 409);
  assert.deepEqual(staleFinalize.body, {code: 'claim_validation_failed'});

  const replay = await invoke(owner, 'abandon-guest-claim', batch.id);
  assert.deepEqual(replay.body, abandoned.body);

  const foreign = await invoke(stranger, 'abandon-guest-claim', batch.id);
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.body, {code: 'batch_not_found'});

  const committedBatch = await createBatch(owner, 'committed-race');
  const committed = await invoke(
    owner,
    'finalize-guest-claim',
    committedBatch.id,
  );
  assert.equal(committed.status, 200);
  const committedRace = await invoke(
    owner,
    'abandon-guest-claim',
    committedBatch.id,
  );
  assert.deepEqual(committedRace.body, {
    batchId: committedBatch.id,
    status: 'committed',
    storageCleanupPending: false,
  });

  console.log('PASS abandon guest claim integration');
} finally {
  const cleanup = await Promise.allSettled(
    users.map(userId => deleteUser(status, userId)),
  );
  const failure = cleanup.find(result => result.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
}
