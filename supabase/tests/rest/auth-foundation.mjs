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

function readLocalStatus() {
  const stdout = execFileSync(supabaseCli, ['status', '-o', 'json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const status = JSON.parse(stdout);

  assert.equal(typeof status.API_URL, 'string');
  assert.equal(typeof status.PUBLISHABLE_KEY, 'string');
  assert.equal(typeof status.SECRET_KEY, 'string');

  return status;
}

function headers(apiKey, bearer = apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json',
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

  return {status: response.status, body};
}

function assertStatus(result, expected, label) {
  assert.ok(
    expected.includes(result.status),
    `${label}: expected ${expected.join('/')} but received ${result.status}`,
  );
}

function createDisposableCredentials() {
  return {
    email: `wave3-${randomUUID()}@example.invalid`,
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
  assert.equal(typeof result.body?.refresh_token, 'string');
  return result.body.access_token;
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
const userIds = [];

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

  const anonLegalDocuments = await request(
    `${status.API_URL}/rest/v1/legal_documents?select=kind,version`,
    {headers: headers(status.PUBLISHABLE_KEY)},
  );
  assertStatus(anonLegalDocuments, [200], 'anon legal document read');
  assert.equal(anonLegalDocuments.body.length, 2);

  const anonCurrentDocuments = await request(
    `${status.API_URL}/rest/v1/current_legal_documents?select=kind,document_version`,
    {headers: headers(status.PUBLISHABLE_KEY)},
  );
  assertStatus(anonCurrentDocuments, [200], 'anon current document read');
  assert.equal(anonCurrentDocuments.body.length, 2);

  const anonMemberships = await request(
    `${status.API_URL}/rest/v1/app_memberships?select=user_id`,
    {headers: headers(status.PUBLISHABLE_KEY)},
  );
  assertStatus(anonMemberships, [401, 403], 'anon membership read denial');

  const anonStatusRpc = await request(
    `${status.API_URL}/rest/v1/rpc/get_onboarding_status`,
    {
      method: 'POST',
      headers: headers(status.PUBLISHABLE_KEY),
      body: '{}',
    },
  );
  assertStatus(anonStatusRpc, [401, 403], 'anon status RPC denial');

  const directMembershipInsert = await request(
    `${status.API_URL}/rest/v1/app_memberships`,
    {
      method: 'POST',
      headers: headers(status.PUBLISHABLE_KEY, accessTokens[0]),
      body: JSON.stringify({
        user_id: userIds[0],
        onboarding_completed_at: new Date().toISOString(),
      }),
    },
  );
  assertStatus(
    directMembershipInsert,
    [401, 403],
    'authenticated direct membership DML denial',
  );

  const statusBeforeCompletion = await request(
    `${status.API_URL}/rest/v1/rpc/get_onboarding_status`,
    {
      method: 'POST',
      headers: headers(status.PUBLISHABLE_KEY, accessTokens[0]),
      body: '{}',
    },
  );
  assertStatus(statusBeforeCompletion, [200], 'owner status RPC');
  assert.equal(statusBeforeCompletion.body.isComplete, false);
  assert.equal(statusBeforeCompletion.body.requiredDocuments.length, 2);

  for (const accessToken of accessTokens) {
    const completion = await request(
      `${status.API_URL}/rest/v1/rpc/complete_onboarding`,
      {
        method: 'POST',
        headers: headers(status.PUBLISHABLE_KEY, accessToken),
        body: JSON.stringify({
          requested_documents: [
            {kind: 'terms', version: '2026-07-13'},
            {kind: 'privacy', version: '2026-07-13'},
          ],
        }),
      },
    );

    assertStatus(completion, [200], 'owner completion RPC');
    assert.equal(completion.body.isComplete, true);
    assert.equal(completion.body.acceptedDocuments.length, 2);
  }

  for (let index = 0; index < accessTokens.length; index += 1) {
    const ownMembership = await request(
      `${status.API_URL}/rest/v1/app_memberships?select=user_id`,
      {
        headers: headers(status.PUBLISHABLE_KEY, accessTokens[index]),
      },
    );
    assertStatus(ownMembership, [200], 'owner membership read');
    assert.deepEqual(ownMembership.body, [{user_id: userIds[index]}]);

    const otherIndex = index === 0 ? 1 : 0;
    const crossOwnerMembership = await request(
      `${status.API_URL}/rest/v1/app_memberships?select=user_id&user_id=eq.${userIds[otherIndex]}`,
      {
        headers: headers(status.PUBLISHABLE_KEY, accessTokens[index]),
      },
    );
    assertStatus(crossOwnerMembership, [200], 'cross-owner membership query');
    assert.deepEqual(crossOwnerMembership.body, []);
  }

  const directConsentInsert = await request(
    `${status.API_URL}/rest/v1/consent_records`,
    {
      method: 'POST',
      headers: headers(status.PUBLISHABLE_KEY, accessTokens[0]),
      body: JSON.stringify({
        user_id: userIds[0],
        document_kind: 'terms',
        document_version: '2026-07-13',
      }),
    },
  );
  assertStatus(
    directConsentInsert,
    [401, 403],
    'authenticated direct consent DML denial',
  );

  console.log('Auth foundation REST smoke test passed.');
} finally {
  const cleanupResults = await Promise.allSettled(
    userIds.map(userId => deleteUser(status.API_URL, status.SECRET_KEY, userId)),
  );
  const cleanupFailure = cleanupResults.find(result => result.status === 'rejected');

  if (cleanupFailure) {
    throw cleanupFailure.reason;
  }
}
