import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {
  AccountDataRepositoryError,
  createAccountDataRepository,
} from './account-data-repository.ts';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const LOG_ID = '00000000-0000-4000-8000-000000000010';
const PLAN_ID = '00000000-0000-4000-8000-000000000020';
const STARTED_AT = '2026-07-19T10:00:00.000Z';

type QueryResponse = {data: unknown; error?: unknown; status?: number};

function query(response: QueryResponse, calls: unknown[]) {
  const builder = {
    select(columns?: string) {
      calls.push({method: 'select', columns});
      return builder;
    },
    order(column: string, options?: unknown) {
      calls.push({method: 'order', column, options});
      return builder;
    },
    limit(value: number) {
      calls.push({method: 'limit', value});
      return builder;
    },
    is(column: string, value: unknown) {
      calls.push({method: 'is', column, value});
      return builder;
    },
    or(value: string) {
      calls.push({method: 'or', value});
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.push({method: 'eq', column, value});
      return builder;
    },
    insert(value: unknown) {
      calls.push({method: 'insert', value});
      return builder;
    },
    update(value: unknown) {
      calls.push({method: 'update', value});
      return builder;
    },
    maybeSingle() {
      calls.push({method: 'maybeSingle'});
      return Promise.resolve(response);
    },
    then(resolve: (value: QueryResponse) => unknown) {
      return Promise.resolve(response).then(resolve);
    },
  };

  return builder;
}

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LOG_ID,
    local_id: 'local-log',
    revision: 4,
    payload_sha256: 'a'.repeat(64),
    source: 'manual',
    started_at: STARTED_AT,
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
    local_id: 'local-plan',
    revision: 2,
    payload_sha256: 'b'.repeat(64),
    status: 'planned',
    planned_at: STARTED_AT,
    dive_mode: null,
    site_name: null,
    plan_data: {},
    converted_log_id: null,
    ...overrides,
  };
}

function createClient(responses: QueryResponse[]) {
  const calls: Array<{table: string; calls: unknown[]}> = [];
  const client = {
    from(table: string) {
      const tableCalls: unknown[] = [];
      calls.push({table, calls: tableCalls});
      return query(responses.shift() ?? {data: [], error: null}, tableCalls);
    },
    storage: {
      from() {
        throw new Error('lists must not access Storage');
      },
    },
  };

  return {client, calls};
}

describe('AccountDataRepository', () => {
  test('lists logs by strict descending keyset without downloading profiles', async () => {
    const {client, calls} = createClient([{data: [logRow({dive_mode: 'scuba'}), logRow({id: '00000000-0000-4000-8000-000000000011'})], error: null}]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    const page = await repository.listLogs({
      cursor: {sortTime: STARTED_AT, id: LOG_ID},
      limit: 1,
    });

    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.payload.dive_mode, 'scuba');
    assert.deepEqual(page.nextCursor, {
      sortTime: STARTED_AT,
      id: LOG_ID,
    });
    assert.deepEqual(calls[0], {
      table: 'dive_logs',
      calls: [
        {method: 'select', columns: undefined},
        {method: 'is', column: 'deleted_at', value: null},
        {method: 'or', value: `started_at.lt.${STARTED_AT},and(started_at.eq.${STARTED_AT},id.lt.${LOG_ID})`},
        {method: 'order', column: 'started_at', options: {ascending: false}},
        {method: 'order', column: 'id', options: {ascending: false}},
        {method: 'limit', value: 2},
      ],
    });
  });

  test('uses the expected revision and soft deletion for log removal', async () => {
    const {client, calls} = createClient([{data: logRow({revision: 5, deleted_at: STARTED_AT}), error: null}]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    const result = await repository.deleteLog(LOG_ID, 4);

    assert.equal(result.status, 'saved');
    assert.equal(calls[0]?.table, 'dive_logs');
    assert.deepEqual(calls[0]?.calls.slice(1), [
      {method: 'eq', column: 'id', value: LOG_ID},
      {method: 'eq', column: 'revision', value: 4},
      {method: 'select', columns: undefined},
      {method: 'maybeSingle'},
    ]);
    assert.deepEqual(calls[0]?.calls[0], {
      method: 'update',
      value: {deleted_at: (calls[0]?.calls[0] as {value: {deleted_at: string}}).value.deleted_at, revision: 5},
    });
    assert.match((calls[0]?.calls[0] as {value: {deleted_at: string}}).value.deleted_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('preserves dive mode when saving a log', async () => {
    const {client, calls} = createClient([
      {data: logRow({revision: 5, dive_mode: 'scuba'}), error: null},
    ]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    const result = await repository.saveLog({
      id: LOG_ID,
      localId: 'local-log',
      revision: 4,
      payloadSha256: 'a'.repeat(64),
      payload: {
        source: 'manual',
        started_at: STARTED_AT,
        dive_mode: 'scuba',
        manual_data: {},
        mobile_data: {},
        provenance: {},
      },
    }, 4);

    assert.equal(result.status, 'saved');
    if (result.status === 'saved') {
      assert.equal(result.value.payload.dive_mode, 'scuba');
    }
    const update = calls[0]?.calls[0] as {method: string; value: Record<string, unknown>};
    assert.equal(update.method, 'update');
    assert.equal(update.value.dive_mode, 'scuba');
  });

  test('returns the current remote plan when a revision update affects no rows', async () => {
    const {client, calls} = createClient([
      {data: null, error: null},
      {data: planRow({revision: 8}), error: null},
    ]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    const result = await repository.savePlan({
      id: PLAN_ID,
      localId: 'local-plan',
      revision: 4,
      payloadSha256: 'b'.repeat(64),
      payload: {status: 'planned', planned_at: STARTED_AT, plan_data: {}},
    }, 4);

    assert.deepEqual(result, {
      status: 'conflict',
      remote: {
        id: PLAN_ID,
        localId: 'local-plan',
        revision: 8,
        payloadSha256: 'b'.repeat(64),
        payload: {
          status: 'planned',
          planned_at: STARTED_AT,
          dive_mode: null,
          site_name: null,
          plan_data: {},
          converted_log_id: null,
        },
      },
    });
    assert.deepEqual(calls[0], {
      table: 'dive_plans',
      calls: [
        {method: 'update', value: {
          local_id: 'local-plan',
          payload_sha256: 'b'.repeat(64),
          revision: 5,
          status: 'planned',
          planned_at: STARTED_AT,
          plan_data: {},
        }},
        {method: 'eq', column: 'id', value: PLAN_ID},
        {method: 'eq', column: 'revision', value: 4},
        {method: 'select', columns: undefined},
        {method: 'maybeSingle'},
      ],
    });
    assert.deepEqual(calls[1], {
      table: 'dive_plans',
      calls: [
        {method: 'select', columns: undefined},
        {method: 'eq', column: 'id', value: PLAN_ID},
        {method: 'maybeSingle'},
      ],
    });
  });

  test('returns a stable sanitized error instead of backend details', async () => {
    const secret = 'postgres failure for diver@example.invalid';
    const {client} = createClient([{data: null, error: {message: secret, code: 'PGRST999', status: 500}}]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    await assert.rejects(() => repository.listPlans(), error => {
      assert.ok(error instanceof AccountDataRepositoryError);
      assert.equal(error.message, 'Account data operation failed');
      assert.equal(error.operation, 'list');
      assert.notEqual(error.message, secret);
      return true;
    });
  });
});
