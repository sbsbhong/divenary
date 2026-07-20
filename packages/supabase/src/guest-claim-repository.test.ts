import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {
  createGuestClaimRemoteRepository,
  GuestClaimRepositoryError,
} from './guest-claim-repository.ts';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const BATCH_ID = '00000000-0000-4000-8000-000000000010';
const STAGING_ID = '00000000-0000-4000-8000-000000000020';
const TARGET_ID = '00000000-0000-4000-8000-000000000030';
const PLAN_ID = '00000000-0000-4000-8000-000000000040';
const OTHER_ID = '00000000-0000-4000-8000-000000000050';
const DIGEST = 'c'.repeat(64);
const PLAN_DIGEST = 'd'.repeat(64);

type Response = {data: unknown; error?: unknown; status?: number};

function builder(response: Response, calls: unknown[]) {
  const query = {
    insert(value: unknown) { calls.push({method: 'insert', value}); return query; },
    upsert(value: unknown, options?: unknown) { calls.push({method: 'upsert', value, options}); return query; },
    update(value: unknown) { calls.push({method: 'update', value}); return query; },
    select(columns?: string) { calls.push({method: 'select', columns}); return query; },
    eq(column: string, value: unknown) { calls.push({method: 'eq', column, value}); return query; },
    is(column: string, value: unknown) { calls.push({method: 'is', column, value}); return query; },
    in(column: string, values: unknown[]) { calls.push({method: 'in', column, values}); return query; },
    order(column: string, options?: unknown) { calls.push({method: 'order', column, options}); return query; },
    maybeSingle() { calls.push({method: 'maybeSingle'}); return Promise.resolve(response); },
    then(resolve: (value: Response) => unknown) { return Promise.resolve(response).then(resolve); },
  };
  return query;
}

function batchRow(overrides: Record<string, unknown> = {}) {
  return {id: BATCH_ID, user_id: USER_ID, client_batch_id: 'batch-1', manifest_sha256: DIGEST, expected_plan_count: 1, expected_log_count: 1, status: 'uploading', ...overrides};
}

function stagingRow(overrides: Record<string, unknown> = {}) {
  return {id: STAGING_ID, target_record_id: TARGET_ID, user_id: USER_ID, batch_id: BATCH_ID, entity_kind: 'log', client_record_id: 'log-1', payload_sha256: DIGEST, payload: {source: 'manual', started_at: '2026-07-19T10:00:00.000Z', manual_data: {}, mobile_data: {}, provenance: {}}, source_plan_client_record_id: null, converted_log_client_record_id: null, profile_path: null, profile_content_revision: null, profile_sha256: null, profile_byte_count: null, profile_sample_count: null, ...overrides};
}

function planStagingRow(overrides: Record<string, unknown> = {}) {
  return stagingRow({
    entity_kind: 'plan',
    client_record_id: 'plan-1',
    payload_sha256: PLAN_DIGEST,
    target_record_id: PLAN_ID,
    payload: {status: 'planned', plan_data: {}},
    ...overrides,
  });
}

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    user_id: USER_ID,
    local_id: 'log-1',
    revision: 1,
    payload_sha256: DIGEST,
    source: 'manual',
    started_at: '2026-07-19T10:00:00.000Z',
    ended_at: null,
    duration_seconds: null,
    max_depth_meters: null,
    site_name: null,
    title: null,
    rating: null,
    manual_data: {},
    mobile_data: {},
    watch_metadata: null,
    provenance: {},
    profile_path: null,
    profile_content_revision: null,
    profile_sha256: null,
    profile_byte_count: null,
    profile_sample_count: null,
    profile_preview: null,
    dive_mode: null,
    source_plan_id: null,
    ...overrides,
  };
}

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    user_id: USER_ID,
    local_id: 'plan-1',
    revision: 1,
    payload_sha256: PLAN_DIGEST,
    status: 'planned',
    planned_at: null,
    dive_mode: null,
    site_name: null,
    plan_data: {},
    converted_log_id: null,
    ...overrides,
  };
}

function createClient(responses: Response[]) {
  const calls: Array<{table: string; calls: unknown[]}> = [];
  const storageCalls: unknown[] = [];
  const client = {
    from(table: string) {
      const tableCalls: unknown[] = [];
      calls.push({table, calls: tableCalls});
      return builder(responses.shift() ?? {data: null, error: null}, tableCalls);
    },
    storage: {from(bucket: string) {
      return {
        async upload(path: string, bytes: Uint8Array, options: unknown) {
          storageCalls.push({bucket, method: 'upload', path, bytes, options});
          return responses.shift() ?? {data: {path}, error: null};
        },
        async download(path: string) {
          storageCalls.push({bucket, method: 'download', path});
          return responses.shift() ?? {data: new Blob([new Uint8Array([1, 2])]), error: null};
        },
      };
    }},
    functions: {async invoke(name: string, options: unknown) {
      storageCalls.push({method: 'invoke', name, options});
      return responses.shift() ?? {data: {batchId: BATCH_ID, status: 'committed', planCount: 1, logCount: 1}, error: null};
    }},
  };
  return {client, calls, storageCalls};
}

describe('GuestClaimRemoteRepository', () => {
  test('loads a duplicate batch only after immutable manifest verification', async () => {
    const {client, calls} = createClient([
      {data: null, error: {code: '23505'}},
      {data: batchRow(), error: null},
    ]);
    const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});

    assert.deepEqual(await repository.createOrLoadBatch({clientBatchId: 'batch-1', manifestSha256: DIGEST, expectedPlanCount: 1, expectedLogCount: 1}), {id: BATCH_ID, status: 'uploading'});
    assert.deepEqual(calls[0], {table: 'guest_claim_batches', calls: [
      {method: 'insert', value: {user_id: USER_ID, client_batch_id: 'batch-1', manifest_sha256: DIGEST, expected_plan_count: 1, expected_log_count: 1}},
      {method: 'select', columns: undefined}, {method: 'maybeSingle'},
    ]});
    assert.deepEqual(calls[1], {table: 'guest_claim_batches', calls: [
      {method: 'select', columns: undefined}, {method: 'eq', column: 'user_id', value: USER_ID}, {method: 'eq', column: 'client_batch_id', value: 'batch-1'}, {method: 'maybeSingle'},
    ]});
  });

  test('classifies network, expired-session, and local validation failures without leaking details', async () => {
    const cases = [
      {
        name: 'network',
        response: {data: null, error: {message: 'private upstream detail', status: 503}},
        expectedKind: 'network_unavailable',
      },
      {
        name: 'session',
        response: {data: null, error: {message: 'private auth detail', status: 401}},
        expectedKind: 'session_expired',
      },
      {
        name: 'remote constraint',
        response: {data: null, error: {message: 'private constraint detail', code: '23514'}},
        expectedKind: 'remote_conflict',
      },
    ];

    for (const item of cases) {
      const {client} = createClient([item.response]);
      const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});
      await assert.rejects(
        () => repository.createOrLoadBatch({
          clientBatchId: 'batch-1',
          manifestSha256: DIGEST,
          expectedPlanCount: 1,
          expectedLogCount: 1,
        }),
        error => {
          assert.ok(error instanceof GuestClaimRepositoryError, item.name);
          assert.equal(Reflect.get(error, 'kind'), item.expectedKind);
          assert.equal(error.message, 'Guest claim operation failed');
          return true;
        },
      );
    }

    const {client} = createClient([]);
    const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});
    await assert.rejects(
      () => repository.createOrLoadBatch({
        clientBatchId: '',
        manifestSha256: DIGEST,
        expectedPlanCount: 1,
        expectedLogCount: 1,
      }),
      error => {
        assert.ok(error instanceof GuestClaimRepositoryError);
        assert.equal(Reflect.get(error, 'kind'), 'claim_validation_failed');
        return true;
      },
    );
  });

  test('stages a log idempotently and bounds profile previews before upsert', async () => {
    const preview = Array.from({length: 161}, (_, index) => ({index}));
    const payload = {...stagingRow().payload, profile_preview: preview};
    const normalizedPayload = {...stagingRow().payload, profile_preview: preview.slice(0, 160)};
    const {client, calls} = createClient([
      {data: null, error: null},
      {data: stagingRow({payload: normalizedPayload}), error: null},
    ]);
    const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});

    const result = await repository.stageRecord({batchId: BATCH_ID, entityKind: 'log', clientRecordId: 'log-1', payloadSha256: DIGEST, payload});

    assert.deepEqual(result, {stagingRecordId: STAGING_ID, targetRecordId: TARGET_ID});
    assert.deepEqual(calls[0], {table: 'guest_claim_records', calls: [
      {method: 'upsert', value: {user_id: USER_ID, batch_id: BATCH_ID, entity_kind: 'log', client_record_id: 'log-1', payload_sha256: DIGEST, payload: normalizedPayload}, options: {onConflict: 'batch_id,entity_kind,client_record_id', ignoreDuplicates: true}},
    ]});
    assert.deepEqual(calls[1], {table: 'guest_claim_records', calls: [
      {method: 'select', columns: undefined}, {method: 'eq', column: 'batch_id', value: BATCH_ID}, {method: 'eq', column: 'entity_kind', value: 'log'}, {method: 'eq', column: 'client_record_id', value: 'log-1'}, {method: 'maybeSingle'},
    ]});
  });

  test('attaches a profile only once and confirms the persisted metadata', async () => {
    const profile = {path: `${USER_ID}/claims/${BATCH_ID}/${STAGING_ID}/profile.json`, contentRevision: 'etag', sha256: DIGEST, byteCount: 12, sampleCount: 2};
    const {client, calls} = createClient([{data: stagingRow({profile_path: profile.path, profile_content_revision: profile.contentRevision, profile_sha256: profile.sha256, profile_byte_count: profile.byteCount, profile_sample_count: profile.sampleCount}), error: null}]);
    const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});

    await repository.attachProfile({stagingRecordId: STAGING_ID, ...profile});

    assert.deepEqual(calls[0], {table: 'guest_claim_records', calls: [
      {method: 'update', value: {profile_path: profile.path, profile_content_revision: 'etag', profile_sha256: DIGEST, profile_byte_count: 12, profile_sample_count: 2}},
      {method: 'eq', column: 'id', value: STAGING_ID}, {method: 'eq', column: 'user_id', value: USER_ID}, {method: 'is', column: 'profile_path', value: null}, {method: 'select', columns: undefined}, {method: 'maybeSingle'},
    ]});
  });

  test('uses no-overwrite profile uploads and maps unsafe finalize failures', async () => {
    const secret = 'internal failure for diver@example.invalid';
    const {client, storageCalls} = createClient([{data: {path: 'ok'}, error: null}, {data: null, error: {message: secret, status: 500}}]);
    const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});

    await repository.uploadProfile(`${USER_ID}/claims/${BATCH_ID}/${STAGING_ID}/profile.json`, new Uint8Array([1, 2]));
    await assert.rejects(() => repository.finalize(BATCH_ID), error => {
      assert.ok(error instanceof GuestClaimRepositoryError);
      assert.equal(error.message, 'Guest claim operation failed');
      assert.equal(Reflect.get(error, 'kind'), 'network_unavailable');
      assert.notEqual(error.message, secret);
      return true;
    });

    assert.deepEqual(storageCalls, [
      {bucket: 'dive-profiles', method: 'upload', path: `${USER_ID}/claims/${BATCH_ID}/${STAGING_ID}/profile.json`, bytes: new Uint8Array([1, 2]), options: {upsert: false, contentType: 'application/json'}},
      {method: 'invoke', name: 'finalize-guest-claim', options: {body: {batchId: BATCH_ID}}},
    ]);
  });

  test('accepts a duplicate profile upload only when the stored bytes match', async () => {
    const path = `${USER_ID}/claims/${BATCH_ID}/${STAGING_ID}/profile.json`;
    const bytes = new Uint8Array([1, 2, 3]);
    const {client, storageCalls} = createClient([
      {data: null, error: {status: 409}},
      {data: new Blob([bytes]), error: null},
    ]);
    const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});

    await repository.uploadProfile(path, bytes);

    assert.deepEqual(storageCalls, [
      {bucket: 'dive-profiles', method: 'upload', path, bytes, options: {upsert: false, contentType: 'application/json'}},
      {bucket: 'dive-profiles', method: 'download', path},
    ]);
  });

  test('rejects a duplicate profile upload when the stored bytes differ', async () => {
    const path = `${USER_ID}/claims/${BATCH_ID}/${STAGING_ID}/profile.json`;
    const {client, storageCalls} = createClient([
      {data: null, error: {code: '23505'}},
      {data: new Blob([new Uint8Array([9, 9])]), error: null},
    ]);
    const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});

    await assert.rejects(() => repository.uploadProfile(path, new Uint8Array([1, 2])), error => {
      assert.ok(error instanceof GuestClaimRepositoryError);
      assert.equal(error.operation, 'profile');
      assert.equal(Reflect.get(error, 'kind'), 'remote_conflict');
      assert.equal(error.message, 'Guest claim operation failed');
      return true;
    });
    assert.deepEqual(storageCalls.map(call => (call as {method: string}).method), ['upload', 'download']);
  });

  test('rejects a non-duplicate profile upload error without downloading a profile', async () => {
    const path = `${USER_ID}/claims/${BATCH_ID}/${STAGING_ID}/profile.json`;
    const {client, storageCalls} = createClient([{data: null, error: {message: 'storage unavailable', status: 500}}]);
    const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});

    await assert.rejects(() => repository.uploadProfile(path, new Uint8Array([1, 2])), error => {
      assert.ok(error instanceof GuestClaimRepositoryError);
      assert.equal(error.operation, 'profile');
      assert.equal(Reflect.get(error, 'kind'), 'network_unavailable');
      assert.equal(error.message, 'Guest claim operation failed');
      return true;
    });
    assert.deepEqual(storageCalls.map(call => (call as {method: string}).method), ['upload']);
  });

  test('lists committed records by target id, verifies them, and retains staging order', async () => {
    const secondPlanId = '00000000-0000-4000-8000-000000000041';
    const secondLogId = '00000000-0000-4000-8000-000000000031';
    const secondPlanDigest = 'e'.repeat(64);
    const secondLogDigest = 'f'.repeat(64);
    const {client, calls} = createClient([
      {data: batchRow({status: 'committed'}), error: null},
      {data: [
        stagingRow(),
        stagingRow({target_record_id: secondLogId, client_record_id: 'log-2', payload_sha256: secondLogDigest}),
        planStagingRow(),
        planStagingRow({target_record_id: secondPlanId, client_record_id: 'plan-2', payload_sha256: secondPlanDigest}),
      ], error: null},
      {data: [planRow(), planRow({id: secondPlanId, local_id: 'plan-2', payload_sha256: secondPlanDigest})], error: null},
      {data: [logRow(), logRow({id: secondLogId, local_id: 'log-2', payload_sha256: secondLogDigest})], error: null},
    ]);
    const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});

    const result = await repository.listCommittedBatch(BATCH_ID);

    assert.deepEqual(result.plans.map(plan => plan.id), [PLAN_ID, secondPlanId]);
    assert.deepEqual(result.logs.map(log => log.id), [TARGET_ID, secondLogId]);
    assert.deepEqual(calls[1], {table: 'guest_claim_records', calls: [
      {method: 'select', columns: undefined}, {method: 'eq', column: 'batch_id', value: BATCH_ID}, {method: 'eq', column: 'user_id', value: USER_ID},
      {method: 'order', column: 'entity_kind', options: {ascending: true}}, {method: 'order', column: 'client_record_id', options: {ascending: true}},
    ]});
    assert.deepEqual(calls[2], {table: 'dive_plans', calls: [
      {method: 'select', columns: undefined}, {method: 'in', column: 'id', values: [PLAN_ID, secondPlanId]}, {method: 'eq', column: 'user_id', value: USER_ID}, {method: 'is', column: 'deleted_at', value: null},
    ]});
    assert.deepEqual(calls[3], {table: 'dive_logs', calls: [
      {method: 'select', columns: undefined}, {method: 'in', column: 'id', values: [TARGET_ID, secondLogId]}, {method: 'eq', column: 'user_id', value: USER_ID}, {method: 'is', column: 'deleted_at', value: null},
    ]});
  });

  test('rejects foreign batches and mismatched committed records', async () => {
    const cases: Array<{name: string; responses: Response[]}> = [
      {name: 'foreign batch', responses: [{data: batchRow({user_id: OTHER_ID, status: 'committed'}), error: null}]},
      {name: 'foreign staging record', responses: [{data: batchRow({status: 'committed'}), error: null}, {data: [stagingRow({user_id: OTHER_ID})], error: null}, {data: [], error: null}, {data: [logRow()], error: null}]},
      {name: 'missing final record', responses: [{data: batchRow({status: 'committed'}), error: null}, {data: [stagingRow()], error: null}, {data: [], error: null}, {data: [], error: null}]},
      {name: 'duplicate final record', responses: [{data: batchRow({status: 'committed'}), error: null}, {data: [stagingRow()], error: null}, {data: [], error: null}, {data: [logRow(), logRow()], error: null}]},
      {name: 'extraneous final record', responses: [{data: batchRow({status: 'committed'}), error: null}, {data: [stagingRow()], error: null}, {data: [], error: null}, {data: [logRow(), logRow({id: OTHER_ID, local_id: 'other-log'})], error: null}]},
      {name: 'foreign final record', responses: [{data: batchRow({status: 'committed'}), error: null}, {data: [stagingRow()], error: null}, {data: [], error: null}, {data: [logRow({user_id: OTHER_ID})], error: null}]},
      {name: 'digest mismatch', responses: [{data: batchRow({status: 'committed'}), error: null}, {data: [stagingRow()], error: null}, {data: [], error: null}, {data: [logRow({payload_sha256: PLAN_DIGEST})], error: null}]},
      {name: 'local id mismatch', responses: [{data: batchRow({status: 'committed'}), error: null}, {data: [stagingRow()], error: null}, {data: [], error: null}, {data: [logRow({local_id: 'other-log'})], error: null}]},
      {name: 'target id mismatch', responses: [{data: batchRow({status: 'committed'}), error: null}, {data: [stagingRow()], error: null}, {data: [], error: null}, {data: [logRow({id: OTHER_ID})], error: null}]},
    ];

    for (const item of cases) {
      const {client} = createClient(item.responses);
      const repository = createGuestClaimRemoteRepository(client as never, {userId: USER_ID});
      await assert.rejects(() => repository.listCommittedBatch(BATCH_ID), error => {
        assert.ok(error instanceof GuestClaimRepositoryError, item.name);
        assert.equal(error.operation, 'list');
        assert.equal(Reflect.get(error, 'kind'), 'remote_conflict');
        return true;
      });
    }
  });
});
