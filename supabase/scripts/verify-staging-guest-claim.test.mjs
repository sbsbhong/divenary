import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseStagingApiKeys,
  runStagingGuestClaimVerificationCli,
  verifyStagingGuestClaim,
} from './verify-staging-guest-claim.mjs';

const publicKey = 'sb_publishable_public-test-value';
const secretKey = 'sb_secret_private-test-value';
const anonJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.anon-signature';
const serviceRoleJwt =
  'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.service-signature';
const stagingApiUrl = 'https://mclvhwzsuvsxjerdouka.supabase.co';

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async text() {
      if (body === null || body === undefined) {
        return '';
      }
      if (body instanceof Uint8Array) {
        return new TextDecoder().decode(body);
      }
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function createCrypto() {
  let next = 1;
  return {
    randomUUID() {
      const suffix = `${next++}`.padStart(12, '0');
      return `10000000-0000-4000-8000-${suffix}`;
    },
    randomBytes(size) {
      return Buffer.alloc(size, 7);
    },
    sha256() {
      return 'a'.repeat(64);
    },
  };
}

function readJsonBody(options) {
  if (typeof options?.body === 'string') {
    return JSON.parse(options.body);
  }
  return options?.body;
}

function bearer(options) {
  const authorization = options?.headers?.Authorization;
  return typeof authorization === 'string'
    ? authorization.replace(/^Bearer /, '')
    : undefined;
}

function eqFilter(url, name) {
  const value = url.searchParams.get(name);
  return value?.startsWith('eq.') ? decodeURIComponent(value.slice(3)) : undefined;
}

function createStagingApi({
  allowCrossOwnerWrite = false,
  crossOwnerDenialStatus = 403,
  persistDeniedCrossOwnerWrite = false,
  crossOwnerUpdateDenialStatus = 403,
  persistDeniedCrossOwnerUpdate = false,
  leakRollbackPlan = false,
  changeRepeatedFinalizer = false,
  failOnFirstClaimRecord = false,
  loseFirstCreateResponseId = false,
  paginateCleanupLookup = false,
} = {}) {
  const users = [];
  const memberships = new Set();
  const rows = {
    dive_plans: [],
    dive_logs: [],
    guest_claim_batches: [],
    guest_claim_records: [],
  };
  const objects = new Map();
  const cleanup = {users: [], profiles: [], listCalls: 0};
  const calls = [];
  let databaseId = 1;
  let finalizerCalls = 0;
  let failedClaimRecord = false;
  let rollbackPlanInsertAttempts = 0;

  function nextDatabaseId() {
    const suffix = `${databaseId++}`.padStart(12, '0');
    return `20000000-0000-4000-8000-${suffix}`;
  }

  function userFor(options) {
    const token = bearer(options);
    return users.find(user => user.token === token);
  }

  function isService(options) {
    return options?.headers?.apikey === secretKey && bearer(options) === undefined;
  }

  function visibleRows(table, url, currentUser) {
    if (table === 'app_memberships') {
      const requestedUserId = eqFilter(url, 'user_id');
      return memberships.has(currentUser?.id) && requestedUserId === currentUser.id
        ? [{user_id: currentUser.id}]
        : [];
    }

    let result = rows[table].filter(row => row.user_id === currentUser?.id);
    for (const field of [
      'id',
      'user_id',
      'local_id',
      'client_batch_id',
      'client_record_id',
    ]) {
      const expected = eqFilter(url, field);
      if (expected !== undefined) {
        result = result.filter(row => String(row[field]) === expected);
      }
    }
    return result;
  }

  async function fetchImpl(input, options = {}) {
    const url = new URL(input);
    const method = options.method ?? 'GET';
    const requestBody = readJsonBody(options);
    calls.push({
      method,
      pathname: url.pathname,
      search: url.search,
      requestBody,
      apiKey: options.headers?.apikey,
      bearer: bearer(options),
    });

    if (url.origin !== stagingApiUrl) {
      throw new Error('unexpected project URL');
    }

    if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
      assert.equal(isService(options), true);
      const index = users.length + 1;
      const user = {
        id: `30000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
        email: requestBody.email,
        token: `access-token-${index}`,
      };
      users.push(user);
      if (loseFirstCreateResponseId && users.length === 1) {
        return jsonResponse(201, {created: true});
      }
      return jsonResponse(201, {id: user.id});
    }

    if (url.pathname === '/auth/v1/admin/users' && method === 'GET') {
      assert.equal(isService(options), true);
      cleanup.listCalls += 1;
      const page = Number(url.searchParams.get('page') ?? 1);
      const perPage = Number(url.searchParams.get('per_page') ?? 50);
      if (paginateCleanupLookup && page === 1) {
        return jsonResponse(200, {
          users: Array.from({length: perPage}, (_, index) => ({
            id: `40000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
            email: `unrelated-${index}@example.invalid`,
          })),
        });
      }
      if (paginateCleanupLookup && page === 2) {
        return jsonResponse(200, {users});
      }
      const start = (page - 1) * perPage;
      return jsonResponse(200, {users: users.slice(start, start + perPage)});
    }

    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
      assert.equal(isService(options), true);
      const userId = url.pathname.split('/').at(-1);
      cleanup.users.push(userId);
      for (const table of Object.keys(rows)) {
        rows[table] = rows[table].filter(row => row.user_id !== userId);
      }
      return jsonResponse(204, null);
    }

    if (url.pathname === '/auth/v1/token' && method === 'POST') {
      assert.equal(options.headers.apikey, publicKey);
      assert.equal(bearer(options), undefined);
      const user = users.find(candidate => candidate.email === requestBody.email);
      return jsonResponse(user ? 200 : 400, user ? {access_token: user.token} : {});
    }

    const currentUser = userFor(options);
    if (url.pathname === '/rest/v1/rpc/get_onboarding_status' && method === 'POST') {
      assert.match(bearer(options), /^access-token-/);
      return jsonResponse(200, {
        isComplete: memberships.has(currentUser?.id),
        requiredDocuments: [
          {kind: 'terms', version: 'staging-current'},
          {kind: 'privacy', version: 'staging-current'},
        ],
        acceptedDocuments: [],
      });
    }

    if (url.pathname === '/rest/v1/rpc/complete_onboarding' && method === 'POST') {
      assert.deepEqual(requestBody.requested_documents, [
        {kind: 'terms', version: 'staging-current'},
        {kind: 'privacy', version: 'staging-current'},
      ]);
      memberships.add(currentUser.id);
      return jsonResponse(200, {isComplete: true});
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.slice('/rest/v1/'.length);
      if (method === 'GET') {
        return jsonResponse(200, visibleRows(table, url, currentUser));
      }

      if (method === 'PATCH') {
        const id = eqFilter(url, 'id');
        const row = rows[table].find(candidate => candidate.id === id);
        if (!memberships.has(currentUser?.id) || !row) {
          return jsonResponse(403, {code: '42501'});
        }
        if (row.user_id !== currentUser.id) {
          if (persistDeniedCrossOwnerUpdate) {
            Object.assign(row, requestBody);
          }
          return jsonResponse(
            crossOwnerUpdateDenialStatus,
            crossOwnerUpdateDenialStatus === 200 ? [] : {code: '42501'},
          );
        }
        Object.assign(row, requestBody);
        return jsonResponse(200, [row]);
      }

      if (method === 'POST') {
        if (!memberships.has(currentUser?.id)) {
          return jsonResponse(403, {code: '42501'});
        }
        if (requestBody.user_id !== currentUser.id && !allowCrossOwnerWrite) {
          if (persistDeniedCrossOwnerWrite) {
            rows[table].push({
              ...requestBody,
              id: nextDatabaseId(),
              ...(table === 'guest_claim_records'
                ? {target_record_id: nextDatabaseId()}
                : {}),
            });
          }
          return jsonResponse(
            crossOwnerDenialStatus,
            crossOwnerDenialStatus === 200 ? [] : {code: '42501'},
          );
        }
        if (
          failOnFirstClaimRecord &&
          table === 'guest_claim_records' &&
          !failedClaimRecord
        ) {
          failedClaimRecord = true;
          throw new Error('network payload with private-token-value');
        }

        const row = {
          ...requestBody,
          id: requestBody.id ?? nextDatabaseId(),
          ...(table === 'guest_claim_records'
            ? {target_record_id: requestBody.target_record_id ?? nextDatabaseId()}
            : {}),
          ...(table === 'guest_claim_batches'
            ? {status: 'uploading', committed_at: null}
            : {}),
        };
        rows[table].push(row);
        return jsonResponse(201, [row]);
      }
    }

    if (
      url.pathname.startsWith('/storage/v1/object/authenticated/dive-profiles/') &&
      method === 'GET'
    ) {
      const objectPath = decodeURIComponent(
        url.pathname.slice('/storage/v1/object/authenticated/dive-profiles/'.length),
      );
      if (!currentUser || !objectPath.startsWith(`${currentUser.id}/`)) {
        return jsonResponse(404, {message: 'not found'});
      }
      return objects.has(objectPath)
        ? jsonResponse(200, objects.get(objectPath))
        : jsonResponse(404, {message: 'not found'});
    }

    if (url.pathname === '/storage/v1/object/dive-profiles' && method === 'DELETE') {
      assert.equal(isService(options), true);
      for (const prefix of requestBody.prefixes) {
        cleanup.profiles.push(prefix);
        objects.delete(prefix);
      }
      return jsonResponse(200, {message: 'deleted'});
    }

    if (url.pathname.startsWith('/storage/v1/object/dive-profiles/') && method === 'POST') {
      const objectPath = decodeURIComponent(
        url.pathname.slice('/storage/v1/object/dive-profiles/'.length),
      );
      if (!currentUser || !objectPath.startsWith(`${currentUser.id}/`)) {
        return jsonResponse(403, {message: 'denied'});
      }
      objects.set(objectPath, options.body);
      return jsonResponse(200, {Key: objectPath});
    }

    if (url.pathname === '/functions/v1/finalize-guest-claim' && method === 'POST') {
      if (!currentUser) {
        return jsonResponse(401, {message: 'Invalid JWT'});
      }

      const batch = rows.guest_claim_batches.find(
        candidate => candidate.id === requestBody.batchId && candidate.user_id === currentUser.id,
      );
      if (!batch) {
        return jsonResponse(404, {code: 'batch_not_found'}, {'cache-control': 'no-store'});
      }

      const staged = rows.guest_claim_records.filter(row => row.batch_id === batch.id);
      if (batch.client_batch_id.includes('rollback-after-plan')) {
        const planRecord = staged.find(row => row.entity_kind === 'plan');
        const logRecord = staged.find(row => row.entity_kind === 'log');
        assert.equal(logRecord.payload.started_at, 'not-a-timestamp');
        rows.dive_plans.push({
          id: planRecord.target_record_id,
          user_id: currentUser.id,
          local_id: planRecord.client_record_id,
          payload_sha256: planRecord.payload_sha256,
        });
        rollbackPlanInsertAttempts += 1;
        if (!leakRollbackPlan) {
          rows.dive_plans.pop();
        }
        return jsonResponse(
          409,
          {code: 'claim_validation_failed'},
          {'cache-control': 'no-store'},
        );
      }

      const responseBody = {
        batchId: batch.id,
        status: 'committed',
        planCount: 1,
        logCount: 1,
      };
      if (batch.status === 'committed') {
        finalizerCalls += 1;
        return jsonResponse(
          200,
          changeRepeatedFinalizer
            ? {...responseBody, logCount: 2}
            : responseBody,
          {'cache-control': 'no-store'},
        );
      }

      const planRecord = staged.find(row => row.entity_kind === 'plan');
      const logRecord = staged.find(row => row.entity_kind === 'log');
      rows.dive_plans.push({
        id: planRecord.target_record_id,
        user_id: currentUser.id,
        local_id: planRecord.client_record_id,
        converted_log_id: logRecord.target_record_id,
        payload_sha256: planRecord.payload_sha256,
      });
      rows.dive_logs.push({
        id: logRecord.target_record_id,
        user_id: currentUser.id,
        local_id: logRecord.client_record_id,
        source_plan_id: planRecord.target_record_id,
        profile_path: logRecord.profile_path,
        profile_sha256: logRecord.profile_sha256,
        payload_sha256: logRecord.payload_sha256,
      });
      batch.status = 'committed';
      finalizerCalls += 1;
      return jsonResponse(200, responseBody, {'cache-control': 'no-store'});
    }

    throw new Error(`unexpected request ${method} ${url.pathname}`);
  }

  return {
    calls,
    cleanup,
    fetchImpl,
    get finalizerCalls() { return finalizerCalls; },
    get rollbackPlanInsertAttempts() { return rollbackPlanInsertAttempts; },
  };
}

function successfulCli() {
  return {
    status: 0,
    stdout: JSON.stringify([
      {name: 'public client', type: 'publishable', api_key: publicKey},
      {name: 'server cleanup', type: 'secret', api_key: secretKey},
      {name: 'anon', type: 'legacy', api_key: anonJwt},
      {name: 'service_role', type: 'legacy', api_key: serviceRoleJwt},
    ]),
    stderr: '',
  };
}

function verificationOptions(api) {
  return {
    assertProjectRef: async () => {},
    spawnSyncImpl: successfulCli,
    fetchImpl: api.fetchImpl,
    cryptoImpl: createCrypto(),
    environment: {
      SUPABASE_ACCESS_TOKEN: 'management-token-that-must-not-be-logged',
      SUPABASE_PROJECT_ID: 'unrelated-project',
    },
  };
}

test('parses current and legacy API key response shapes without returning metadata', () => {
  assert.deepEqual(
    parseStagingApiKeys([
      {name: 'default', type: 'publishable', api_key: publicKey},
      {name: 'server', type: 'secret', api_key: secretKey},
      {name: 'anon', type: 'legacy', api_key: anonJwt},
      {name: 'service_role', type: 'legacy', api_key: serviceRoleJwt},
    ]),
    {
      publicApiKey: publicKey,
      adminApiKey: secretKey,
    },
  );

  assert.deepEqual(
    parseStagingApiKeys({
      result: {
        keys: [
          {name: 'anon', key: anonJwt},
          {name: 'service_role', key: serviceRoleJwt},
        ],
      },
    }),
    {
      publicApiKey: anonJwt,
      adminApiKey: serviceRoleJwt,
    },
  );

  assert.deepEqual(
    parseStagingApiKeys({
      publishable: publicKey,
      secret: secretKey,
      service_role: serviceRoleJwt,
    }),
    {
      publicApiKey: publicKey,
      adminApiKey: secretKey,
    },
  );
});

test('accepts new opaque keys without requiring legacy JWT keys', () => {
  assert.deepEqual(
    parseStagingApiKeys([
      {name: 'default', type: 'publishable', api_key: publicKey},
      {name: 'server', type: 'secret', api_key: secretKey},
    ]),
    {publicApiKey: publicKey, adminApiKey: secretKey},
  );
});

test('refuses a project mismatch before reading keys or making requests', async () => {
  let cliCalls = 0;
  let fetchCalls = 0;

  await assert.rejects(
    verifyStagingGuestClaim({
      assertProjectRef: async () => {
        throw new Error('linked project mismatch');
      },
      spawnSyncImpl: () => {
        cliCalls += 1;
        return {status: 0, stdout: '[]'};
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('unexpected network request');
      },
    }),
    /linked project mismatch/,
  );

  assert.equal(cliCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('verifies owner RLS, private profiles, atomic claim publication, and idempotency', async () => {
  const api = createStagingApi();
  let cliInvocation;
  const options = verificationOptions(api);
  options.spawnSyncImpl = (...arguments_) => {
    cliInvocation = arguments_;
    return successfulCli();
  };

  assert.deepEqual(
    await verifyStagingGuestClaim(options),
    {status: 'passed'},
  );

  assert.deepEqual(cliInvocation[1], [
    'projects',
    'api-keys',
    '--project-ref',
    'mclvhwzsuvsxjerdouka',
    '--reveal',
    '--output',
    'json',
  ]);
  assert.equal(cliInvocation[2].env.SUPABASE_PROJECT_ID, undefined);
  assert.equal(
    cliInvocation[2].env.SUPABASE_ACCESS_TOKEN,
    'management-token-that-must-not-be-logged',
  );
  assert.equal(api.finalizerCalls, 2);
  assert.equal(api.rollbackPlanInsertAttempts, 1);
  assert.equal(api.cleanup.users.length, 2);
  assert.equal(api.cleanup.profiles.length, 1);
  assert.ok(
    api.calls
      .filter(call => call.pathname.startsWith('/rest/v1/'))
      .every(call => /^access-token-/.test(call.bearer)),
  );
  assert.ok(
    api.calls
      .every(call => call.bearer !== serviceRoleJwt && call.bearer !== secretKey),
  );
  assert.ok(
    api.calls.some(call =>
      call.method === 'POST' && call.pathname === '/rest/v1/guest_claim_records'
    ),
  );
});

test('fails when a cross-owner table write is accepted', async () => {
  const api = createStagingApi({allowCrossOwnerWrite: true});

  await assert.rejects(
    verifyStagingGuestClaim(verificationOptions(api)),
    /cross-owner table write denial/i,
  );
  assert.equal(api.cleanup.users.length, 2);
});

test('fails when a denial response still leaves a cross-owner row', async () => {
  const api = createStagingApi({persistDeniedCrossOwnerWrite: true});

  await assert.rejects(
    verifyStagingGuestClaim(verificationOptions(api)),
    /cross-owner table write denial/i,
  );
  assert.equal(api.cleanup.users.length, 2);
});

test('accepts a PostgREST denial response variation only after owner re-query', async () => {
  const api = createStagingApi({
    crossOwnerDenialStatus: 200,
    crossOwnerUpdateDenialStatus: 200,
  });

  assert.deepEqual(
    await verifyStagingGuestClaim(verificationOptions(api)),
    {status: 'passed'},
  );
  assert.ok(
    api.calls.some(call =>
      call.method === 'GET' &&
      call.pathname === '/rest/v1/dive_plans' &&
      call.search.includes('local_id=eq.cross-plan-') &&
      call.bearer === 'access-token-2'
    ),
  );
});

test('fails when a denial response still changes a cross-owner row', async () => {
  const api = createStagingApi({persistDeniedCrossOwnerUpdate: true});

  await assert.rejects(
    verifyStagingGuestClaim(verificationOptions(api)),
    /cross-owner table update denial/i,
  );
  assert.equal(api.cleanup.users.length, 2);
});

test('fails when a later log cast error leaves the transaction plan visible', async () => {
  const api = createStagingApi({leakRollbackPlan: true});

  await assert.rejects(
    verifyStagingGuestClaim(verificationOptions(api)),
    /atomic rollback must not publish account rows/i,
  );
  assert.equal(api.rollbackPlanInsertAttempts, 1);
  assert.equal(api.cleanup.users.length, 2);
});

test('fails when repeated finalization is not idempotent', async () => {
  const api = createStagingApi({changeRepeatedFinalizer: true});

  await assert.rejects(
    verifyStagingGuestClaim(verificationOptions(api)),
    /repeated finalization/i,
  );
  assert.equal(api.cleanup.users.length, 2);
});

test('cleans both users after a mid-flow network failure', async () => {
  const api = createStagingApi({failOnFirstClaimRecord: true});

  await assert.rejects(
    verifyStagingGuestClaim(verificationOptions(api)),
    /staging request failed/i,
  );
  assert.equal(api.cleanup.users.length, 2);
});

test('finds and deletes a created user when the create response loses its ID', async () => {
  const api = createStagingApi({
    loseFirstCreateResponseId: true,
    paginateCleanupLookup: true,
  });

  await assert.rejects(
    verifyStagingGuestClaim(verificationOptions(api)),
    error => {
      assert.match(error.message, /missing user identifier/i);
      assert.doesNotMatch(error.message, /guest-claim-|example\.invalid/i);
      return true;
    },
  );

  assert.equal(api.cleanup.listCalls, 2);
  assert.deepEqual(api.cleanup.users, [
    '30000000-0000-4000-8000-000000000001',
  ]);
});

test('does not expose CLI stderr or secrets in failures and command output', async () => {
  const leakedSecret = 'service-role-value-that-must-stay-private';
  const api = createStagingApi();

  await assert.rejects(
    verifyStagingGuestClaim({
      ...verificationOptions(api),
      spawnSyncImpl: () => ({
        status: 1,
        stdout: '',
        stderr: `remote error ${leakedSecret}`,
      }),
    }),
    error => {
      assert.doesNotMatch(error.message, new RegExp(leakedSecret));
      return true;
    },
  );

  await assert.rejects(
    verifyStagingGuestClaim({
      ...verificationOptions(api),
      spawnSyncImpl: () => {
        throw new Error(`CLI exception ${leakedSecret}`);
      },
    }),
    error => {
      assert.doesNotMatch(error.message, new RegExp(leakedSecret));
      return true;
    },
  );

  let stdout = '';
  let stderr = '';
  const passed = await runStagingGuestClaimVerificationCli({
    verify: async () => {
      throw new Error(`network rejected ${leakedSecret}`);
    },
    stdout: {write(value) { stdout += value; }},
    stderr: {write(value) { stderr += value; }},
  });

  assert.equal(passed, false);
  assert.equal(stdout, '');
  assert.equal(stderr, 'FAIL staging guest claim verification\n');
  assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(leakedSecret));
});
