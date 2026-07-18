import assert from 'node:assert/strict';
import test from 'node:test';

import {prepareLocalMobileAuth} from './local-mobile-auth-fixture.mjs';

const email = 'divenary-local@development.invalid';
const apiUrl = 'http://127.0.0.1:54321';
const publishableKey = 'local-publishable-key';
const secretKey = 'local-secret-key';
const password = Buffer.alloc(32, 7).toString('base64url');
const envPath = '/repo/apps/mobile/.env.local';
const temporaryEnvPath = `${envPath}.fixture-tmp`;

function jsonResponse(status, body) {
  return {
    status,
    async text() {
      return body === undefined ? '' : JSON.stringify(body);
    },
  };
}

function createFixture(options = {}) {
  const requests = [];
  const fileOperations = [];
  const logs = [];
  const responses = [
    jsonResponse(200, {users: [{id: 'previous-user', email}]}),
    jsonResponse(204),
    jsonResponse(201, {id: 'replacement-user', email, email_confirmed_at: '2026-07-18T00:00:00.000Z'}),
    jsonResponse(200, {access_token: 'local-session-token'}),
    jsonResponse(200, {
      isComplete: false,
      requiredDocuments: [
        {kind: 'terms', version: '2026-07-13'},
        {kind: 'privacy', version: '2026-07-13'},
      ],
    }),
  ];

  return {
    requests,
    fileOperations,
    logs,
    options: {
      readLocalStatus: async () => ({
        API_URL: apiUrl,
        PUBLISHABLE_KEY: publishableKey,
        SECRET_KEY: secretKey,
      }),
      fetchImpl: async (url, request = {}) => {
        requests.push({url, ...request});
        const response = responses.shift();
        assert.ok(response, `unexpected request: ${url}`);
        return response;
      },
      randomBytesImpl: size => {
        assert.equal(size, 32);
        return Buffer.alloc(32, 7);
      },
      writeFile: async (...args) => fileOperations.push(['writeFile', ...args]),
      rename: async (...args) => fileOperations.push(['rename', ...args]),
      envPath,
      temporaryEnvPath,
      log: value => logs.push(value),
      ...options,
    },
  };
}

test('recreates a confirmed local user, verifies pending onboarding, and atomically writes mobile environment', async () => {
  const fixture = createFixture();

  const result = await prepareLocalMobileAuth(fixture.options);

  assert.deepEqual(result, {email, envPath});
  assert.deepEqual(
    fixture.requests.map(({url, method}) => ({url, method})),
    [
      {url: `${apiUrl}/auth/v1/admin/users?page=1&per_page=1000`, method: 'GET'},
      {url: `${apiUrl}/auth/v1/admin/users/previous-user`, method: 'DELETE'},
      {url: `${apiUrl}/auth/v1/admin/users`, method: 'POST'},
      {url: `${apiUrl}/auth/v1/token?grant_type=password`, method: 'POST'},
      {url: `${apiUrl}/rest/v1/rpc/get_onboarding_status`, method: 'POST'},
    ],
  );

  const adminHeaders = fixture.requests[2].headers;
  assert.equal(adminHeaders.apikey, secretKey);
  assert.equal(adminHeaders.Authorization, `Bearer ${secretKey}`);
  assert.deepEqual(JSON.parse(fixture.requests[2].body), {
    email,
    password,
    email_confirm: true,
  });
  assert.equal(fixture.requests[3].headers.apikey, publishableKey);
  assert.equal(
    fixture.requests[3].headers.Authorization,
    `Bearer ${publishableKey}`,
  );
  assert.deepEqual(JSON.parse(fixture.requests[3].body), {email, password});
  assert.equal(fixture.requests[4].headers.apikey, publishableKey);
  assert.equal(
    fixture.requests[4].headers.Authorization,
    'Bearer local-session-token',
  );
  assert.deepEqual(JSON.parse(fixture.requests[4].body), {});

  assert.deepEqual(fixture.fileOperations, [
    [
      'writeFile',
      temporaryEnvPath,
      [
        `SUPABASE_URL=${apiUrl}`,
        'SUPABASE_ANDROID_URL=http://10.0.2.2:54321',
        `SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
        `LOCAL_AUTH_EMAIL=${email}`,
        `LOCAL_AUTH_PASSWORD=${password}`,
        '',
      ].join('\n'),
      {encoding: 'utf8', mode: 0o600},
    ],
    ['rename', temporaryEnvPath, envPath],
  ]);
  assert.deepEqual(fixture.logs, []);
});

test('does not write an environment file when onboarding verification fails', async () => {
  const fixture = createFixture();
  fixture.options.fetchImpl = async (url, request = {}) => {
    fixture.requests.push({url, ...request});
    const status = fixture.requests.length === 4 ? 500 : 200;
    const body =
      fixture.requests.length === 1
        ? {users: []}
        : fixture.requests.length === 2
          ? {id: 'replacement-user', email, email_confirmed_at: '2026-07-18T00:00:00.000Z'}
          : fixture.requests.length === 3
            ? {access_token: 'local-session-token'}
            : {message: 'onboarding status failed'};
    return jsonResponse(status, body);
  };

  await assert.rejects(
    prepareLocalMobileAuth(fixture.options),
    /get_onboarding_status.*500/,
  );

  assert.deepEqual(fixture.fileOperations, []);
  assert.deepEqual(fixture.logs, []);
});

test('rejects a recreated user that is not confirmed', async () => {
  const fixture = createFixture();
  const responses = [
    jsonResponse(200, {users: []}),
    jsonResponse(201, {id: 'replacement-user', email}),
  ];
  fixture.options.fetchImpl = async (url, request = {}) => {
    fixture.requests.push({url, ...request});
    return responses.shift();
  };

  await assert.rejects(
    prepareLocalMobileAuth(fixture.options),
    /not confirmed/,
  );

  assert.equal(fixture.requests.length, 2);
  assert.deepEqual(fixture.fileOperations, []);
  assert.deepEqual(fixture.logs, []);
});
