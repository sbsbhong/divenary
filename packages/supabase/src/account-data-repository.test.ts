import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {
  AccountDataRepositoryError,
  createAccountDataRepository,
} from './account-data-repository.ts';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
const LOG_ID = '00000000-0000-4000-8000-000000000010';
const PLAN_ID = '00000000-0000-4000-8000-000000000020';
const STARTED_AT = '2026-07-19T10:00:00.000Z';
const UPDATED_AT = '2026-07-19T11:00:00.000Z';
const MICROSECOND_STARTED_AT = '2026-07-19T10:00:00.123Z';

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
    not(column: string, operator: string, value: unknown) {
      calls.push({method: 'not', column, operator, value});
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
    user_id: USER_ID,
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
    created_at: STARTED_AT,
    updated_at: UPDATED_AT,
    deleted_at: null,
    ...overrides,
  };
}

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    user_id: USER_ID,
    local_id: 'local-plan',
    revision: 2,
    payload_sha256: 'b'.repeat(64),
    status: 'planned',
    planned_at: STARTED_AT,
    dive_mode: null,
    site_name: null,
    plan_data: {},
    converted_log_id: null,
    created_at: STARTED_AT,
    updated_at: UPDATED_AT,
    deleted_at: null,
    ...overrides,
  };
}

function remoteLog(overrides: Record<string, unknown> = {}) {
  return {
    id: LOG_ID,
    localId: 'local-log',
    revision: 1,
    payloadSha256: 'a'.repeat(64),
    payload: {
      source: 'manual',
      started_at: STARTED_AT,
      manual_data: {},
      mobile_data: {},
      provenance: {},
    },
    ...overrides,
  };
}

function remotePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    localId: 'local-plan',
    revision: 1,
    payloadSha256: 'b'.repeat(64),
    payload: {status: 'planned', planned_at: STARTED_AT, plan_data: {}},
    ...overrides,
  };
}

async function rejectsWithOperation(
  run: () => Promise<unknown>,
  operation: 'list' | 'save' | 'delete',
) {
  await assert.rejects(run, error => {
    assert.ok(error instanceof AccountDataRepositoryError);
    assert.equal(error.message, 'Account data operation failed');
    assert.equal(error.operation, operation);
    return true;
  });
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
        {method: 'eq', column: 'user_id', value: USER_ID},
        {method: 'is', column: 'deleted_at', value: null},
        {method: 'or', value: `started_at.lt.${STARTED_AT},and(started_at.eq.${STARTED_AT},id.lt.${LOG_ID})`},
        {method: 'order', column: 'started_at', options: {ascending: false}},
        {method: 'order', column: 'id', options: {ascending: false}},
        {method: 'limit', value: 2},
      ],
    });
  });

  test('includes undated draft plans in a created-at keyset page', async () => {
    const nextPlanId = '00000000-0000-4000-8000-000000000021';
    const {client, calls} = createClient([{data: [
      planRow({status: 'draft', planned_at: null}),
      planRow({id: nextPlanId, created_at: '2026-07-18T10:00:00.000Z'}),
    ], error: null}]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    const page = await repository.listPlans({
      cursor: {sortTime: STARTED_AT, id: PLAN_ID},
      limit: 1,
    });

    assert.equal(page.items[0]?.payload.status, 'draft');
    assert.equal(page.items[0]?.payload.planned_at, null);
    assert.deepEqual(page.nextCursor, {sortTime: STARTED_AT, id: PLAN_ID});
    assert.deepEqual(calls[0], {
      table: 'dive_plans',
      calls: [
        {method: 'select', columns: undefined},
        {method: 'eq', column: 'user_id', value: USER_ID},
        {method: 'is', column: 'deleted_at', value: null},
        {method: 'or', value: `created_at.lt.${STARTED_AT},and(created_at.eq.${STARTED_AT},id.lt.${PLAN_ID})`},
        {method: 'order', column: 'created_at', options: {ascending: false}},
        {method: 'order', column: 'id', options: {ascending: false}},
        {method: 'limit', value: 2},
      ],
    });
  });

  test('keeps an existing repository bound to its verified owner after a client session switch', async () => {
    const {client, calls} = createClient([
      {data: [logRow()], error: null},
      {data: [logRow({user_id: OTHER_USER_ID})], error: null},
    ]);
    const identity = {userId: USER_ID};
    const repository = createAccountDataRepository(client as never, identity);

    assert.equal((await repository.listLogs()).items.length, 1);
    identity.userId = OTHER_USER_ID;
    await rejectsWithOperation(() => repository.listLogs(), 'list');

    for (const call of calls) {
      assert.deepEqual(call.calls.slice(0, 3), [
        {method: 'select', columns: undefined},
        {method: 'eq', column: 'user_id', value: USER_ID},
        {method: 'is', column: 'deleted_at', value: null},
      ]);
    }
  });

  test('reads one owned log together with its soft-deletion state', async () => {
    const {client, calls} = createClient([{data: logRow({revision: 6, deleted_at: UPDATED_AT}), error: null}]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    const result = await repository.getLog?.(LOG_ID);

    assert.equal(result?.deleted, true);
    assert.equal(result?.value.id, LOG_ID);
    assert.equal(result?.value.revision, 6);
    assert.deepEqual(calls[0], {
      table: 'dive_logs',
      calls: [
        {method: 'select', columns: undefined},
        {method: 'eq', column: 'user_id', value: USER_ID},
        {method: 'eq', column: 'id', value: LOG_ID},
        {method: 'maybeSingle'},
      ],
    });
  });

  test('returns no log when the owned row does not exist', async () => {
    const {client} = createClient([{data: null, error: null}]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    assert.equal(await repository.getLog?.(LOG_ID), undefined);
  });

  test('lists soft-deleted logs by remote and local identity', async () => {
    const {client, calls} = createClient([{data: [logRow({revision: 7, deleted_at: UPDATED_AT})], error: null}]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    const page = await repository.listDeletedLogs?.({limit: 10});

    assert.deepEqual(page?.items, [{id: LOG_ID, localId: 'local-log', revision: 7}]);
    assert.deepEqual(calls[0], {
      table: 'dive_logs',
      calls: [
        {method: 'select', columns: undefined},
        {method: 'eq', column: 'user_id', value: USER_ID},
        {method: 'not', column: 'deleted_at', operator: 'is', value: null},
        {method: 'order', column: 'started_at', options: {ascending: false}},
        {method: 'order', column: 'id', options: {ascending: false}},
        {method: 'limit', value: 11},
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
      {method: 'eq', column: 'user_id', value: USER_ID},
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

  test('accepts duplicate and empty insert responses only after owner-bound replay verification', async () => {
    const {client, calls} = createClient([
      {data: null, error: {code: '23505', message: 'duplicate details'}},
      {data: logRow({revision: 1}), error: null},
      {data: null, error: null},
      {data: planRow({revision: 1}), error: null},
    ]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    assert.deepEqual(await repository.saveLog(remoteLog()), {
      status: 'saved',
      value: remoteLog({
        payload: {
          source: 'manual',
          started_at: STARTED_AT,
          ended_at: null,
          duration_seconds: null,
          max_depth_meters: null,
          site_name: null,
          title: null,
          rating: null,
          dive_mode: null,
          manual_data: {},
          mobile_data: {},
          watch_metadata: null,
          provenance: {},
          profile_preview: null,
          profile_content_revision: null,
          profile_sha256: null,
          profile_byte_count: null,
          profile_sample_count: null,
          source_plan_id: null,
        },
      }),
    });
    assert.equal((await repository.savePlan(remotePlan())).status, 'saved');

    assert.deepEqual(calls[1], {
      table: 'dive_logs',
      calls: [
        {method: 'select', columns: undefined},
        {method: 'eq', column: 'user_id', value: USER_ID},
        {method: 'eq', column: 'id', value: LOG_ID},
        {method: 'maybeSingle'},
      ],
    });
    assert.deepEqual(calls[3], {
      table: 'dive_plans',
      calls: [
        {method: 'select', columns: undefined},
        {method: 'eq', column: 'user_id', value: USER_ID},
        {method: 'eq', column: 'id', value: PLAN_ID},
        {method: 'maybeSingle'},
      ],
    });
  });

  test('accepts an already-applied update only at the exact next revision', async () => {
    const {client} = createClient([
      {data: null, error: null},
      {data: planRow({revision: 5}), error: null},
    ]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    assert.equal((await repository.savePlan(remotePlan({revision: 4}), 4)).status, 'saved');
  });

  test('accepts equivalent PostgREST log timestamp readback as saved', async () => {
    const {client} = createClient([
      {
        data: logRow({
          revision: 1,
          started_at: '2026-07-19T19:00:00.123000+09:00',
          ended_at: '2026-07-19T10:00:01.987000+00:00',
        }),
        error: null,
      },
    ]);
    const repository = createAccountDataRepository(client as never, {
      userId: USER_ID,
    });

    const result = await repository.saveLog(
      remoteLog({
        payload: {
          source: 'manual',
          started_at: MICROSECOND_STARTED_AT,
          ended_at: '2026-07-19T10:00:01.987Z',
          manual_data: {},
          mobile_data: {},
          provenance: {},
        },
      }),
    );

    assert.equal(result.status, 'saved');
    if (result.status === 'saved') {
      assert.equal(result.value.payload.started_at, MICROSECOND_STARTED_AT);
      assert.equal(
        result.value.payload.ended_at,
        '2026-07-19T10:00:01.987Z',
      );
    }
  });

  test('accepts one-binary64-neighbor readback for typed numeric log summaries', async () => {
    const {client} = createClient([
      {
        data: logRow({
          revision: 1,
          duration_seconds: 120,
          max_depth_meters: 11.6,
          rating: 4,
        }),
        error: null,
      },
    ]);
    const repository = createAccountDataRepository(client as never, {
      userId: USER_ID,
    });

    const result = await repository.saveLog(
      remoteLog({
        payload: {
          source: 'manual',
          started_at: STARTED_AT,
          duration_seconds: 120.00000000000001,
          max_depth_meters: 11.600000000000001,
          rating: 4,
          manual_data: {},
          mobile_data: {},
          provenance: {},
        },
      }),
    );

    assert.equal(result.status, 'saved');
  });

  test('accepts an observed 15-significant-digit readback for a typed numeric log summary', async () => {
    const {client} = createClient([
      {
        data: logRow({
          revision: 1,
          duration_seconds: 13.8907051086426,
        }),
        error: null,
      },
    ]);
    const repository = createAccountDataRepository(client as never, {
      userId: USER_ID,
    });

    const result = await repository.saveLog(
      remoteLog({
        payload: {
          source: 'manual',
          started_at: STARTED_AT,
          duration_seconds: 13.890705108642578,
          manual_data: {},
          mobile_data: {},
          provenance: {},
        },
      }),
    );

    assert.equal(result.status, 'saved');
  });

  test('keeps a numeric log summary outside the 15-significant-digit readback in conflict', async () => {
    const {client} = createClient([
      {
        data: logRow({
          revision: 1,
          duration_seconds: 120,
          max_depth_meters: 11.6,
          rating: 4,
        }),
        error: null,
      },
    ]);
    const repository = createAccountDataRepository(client as never, {
      userId: USER_ID,
    });

    const result = await repository.saveLog(
      remoteLog({
        payload: {
          source: 'manual',
          started_at: STARTED_AT,
          duration_seconds: 120.000000000003,
          max_depth_meters: 11.600000000000001,
          rating: 4,
          manual_data: {},
          mobile_data: {},
          provenance: {},
        },
      }),
    );

    assert.equal(result.status, 'conflict');
  });

  test('does not treat an adjacent fractional rating as a floating readback', async () => {
    const {client} = createClient([
      {
        data: logRow({
          revision: 1,
          rating: 4,
        }),
        error: null,
      },
    ]);
    const repository = createAccountDataRepository(client as never, {
      userId: USER_ID,
    });

    const result = await repository.saveLog(
      remoteLog({
        payload: {
          source: 'manual',
          started_at: STARTED_AT,
          rating: 4.000000000000001,
          manual_data: {},
          mobile_data: {},
          provenance: {},
        },
      }),
    );

    assert.equal(result.status, 'conflict');
  });

  test('accepts equivalent PostgREST plan timestamp readback as saved', async () => {
    const {client} = createClient([
      {
        data: planRow({
          revision: 1,
          planned_at: '2026-07-19T19:00:00.123000+09:00',
        }),
        error: null,
      },
    ]);
    const repository = createAccountDataRepository(client as never, {
      userId: USER_ID,
    });

    const result = await repository.savePlan(
      remotePlan({
        payload: {
          status: 'planned',
          planned_at: MICROSECOND_STARTED_AT,
          plan_data: {},
        },
      }),
    );

    assert.equal(result.status, 'saved');
    if (result.status === 'saved') {
      assert.equal(result.value.payload.planned_at, MICROSECOND_STARTED_AT);
    }
  });

  test('keeps a genuinely different persisted timestamp in conflict', async () => {
    const {client} = createClient([
      {
        data: logRow({
          revision: 1,
          started_at: '2026-07-19T10:00:00.124000+00:00',
        }),
        error: null,
      },
    ]);
    const repository = createAccountDataRepository(client as never, {
      userId: USER_ID,
    });

    assert.equal(
      (
        await repository.saveLog(
          remoteLog({
            payload: {
              source: 'manual',
              started_at: MICROSECOND_STARTED_AT,
              manual_data: {},
              mobile_data: {},
              provenance: {},
            },
          }),
        )
      ).status,
      'conflict',
    );
  });

  test('fails closed for timestamp precision that cannot be represented', async () => {
    const {client} = createClient([
      {
        data: logRow({
          revision: 1,
          started_at: '2026-07-19T10:00:00.123456+00:00',
        }),
        error: null,
      },
    ]);
    const repository = createAccountDataRepository(client as never, {
      userId: USER_ID,
    });

    await rejectsWithOperation(
      () =>
        repository.saveLog(
          remoteLog({
            payload: {
              source: 'manual',
              started_at: MICROSECOND_STARTED_AT,
              manual_data: {},
              mobile_data: {},
              provenance: {},
            },
          }),
        ),
      'save',
    );
  });

  test('excludes soft-deleted rows from log and plan update predicates', async () => {
    const {client, calls} = createClient([
      {data: logRow({revision: 5}), error: null},
      {data: planRow({revision: 5}), error: null},
    ]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    assert.equal((await repository.saveLog(remoteLog({revision: 4}), 4)).status, 'saved');
    assert.equal((await repository.savePlan(remotePlan({revision: 4}), 4)).status, 'saved');

    for (const call of calls) {
      assert.deepEqual(call.calls.filter(item => (
        item as {method?: string}
      ).method === 'is'), [
        {method: 'is', column: 'deleted_at', value: null},
      ]);
    }
  });

  test('never accepts soft-deleted rows as saved upsert results or replays', async () => {
    const direct = createClient([
      {data: logRow({revision: 5, deleted_at: UPDATED_AT}), error: null},
    ]);
    const directRepository = createAccountDataRepository(direct.client as never, {userId: USER_ID});
    assert.equal(
      (await directRepository.saveLog(remoteLog({revision: 4}), 4)).status,
      'conflict',
    );

    const replay = createClient([
      {data: null, error: {code: '23505'}},
      {data: planRow({revision: 1, deleted_at: UPDATED_AT}), error: null},
    ]);
    const replayRepository = createAccountDataRepository(replay.client as never, {userId: USER_ID});
    assert.equal((await replayRepository.savePlan(remotePlan())).status, 'conflict');
  });

  test('returns a conflict when replay content or revision does not match', async () => {
    const {client} = createClient([
      {data: null, error: {code: '23505'}},
      {data: logRow({revision: 1, payload_sha256: 'c'.repeat(64)}), error: null},
      {data: null, error: null},
      {data: planRow({revision: 6}), error: null},
    ]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    assert.equal((await repository.saveLog(remoteLog())).status, 'conflict');
    assert.equal((await repository.savePlan(remotePlan({revision: 4}), 4)).status, 'conflict');
  });

  test('accepts only the exact already-applied soft delete as a replay', async () => {
    const {client} = createClient([
      {data: null, error: null},
      {data: logRow({revision: 5, deleted_at: UPDATED_AT}), error: null},
      {data: null, error: null},
      {data: planRow({revision: 5, deleted_at: null}), error: null},
    ]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    assert.equal((await repository.deleteLog(LOG_ID, 4)).status, 'saved');
    assert.equal((await repository.deletePlan(PLAN_ID, 4)).status, 'conflict');
  });

  test('returns a conflict when persisted dive mode differs despite the same hash', async () => {
    const {client, calls} = createClient([
      {data: logRow({revision: 5, dive_mode: 'freedive'}), error: null},
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

    assert.equal(result.status, 'conflict');
    if (result.status === 'conflict') {
      assert.equal(result.remote.payload.dive_mode, 'freedive');
    }
    const update = calls[0]?.calls[0] as {method: string; value: Record<string, unknown>};
    assert.equal(update.method, 'update');
    assert.equal(update.value.dive_mode, 'scuba');
  });

  test('returns conflicts for mismatched nested plan data and log profile paths', async () => {
    const plan = createClient([
      {data: null, error: null},
      {data: planRow({revision: 5, plan_data: {gas: {name: 'air'}}}), error: null},
    ]);
    const planRepository = createAccountDataRepository(plan.client as never, {userId: USER_ID});
    const planResult = await planRepository.savePlan(remotePlan({
      revision: 4,
      payload: {
        status: 'planned',
        planned_at: STARTED_AT,
        plan_data: {gas: {name: 'nitrox'}},
      },
    }), 4);
    assert.equal(planResult.status, 'conflict');

    const expectedPath = `${USER_ID}/logs/${LOG_ID}/expected.json`;
    const log = createClient([
      {data: null, error: {code: '23505'}},
      {data: logRow({revision: 1, profile_path: `${USER_ID}/logs/${LOG_ID}/other.json`}), error: null},
    ]);
    const logRepository = createAccountDataRepository(log.client as never, {userId: USER_ID});
    const logResult = await logRepository.saveLog(remoteLog({profilePath: expectedPath}));
    assert.equal(logResult.status, 'conflict');
  });

  test('does not write plan pagination timestamps during updates', async () => {
    const {client, calls} = createClient([
      {data: planRow({revision: 5}), error: null},
    ]);
    const repository = createAccountDataRepository(client as never, {userId: USER_ID});

    assert.equal((await repository.savePlan(remotePlan({revision: 4}), 4)).status, 'saved');
    const update = calls[0]?.calls[0] as {method: string; value: Record<string, unknown>};
    assert.equal(update.method, 'update');
    assert.equal('created_at' in update.value, false);
    assert.equal('updated_at' in update.value, false);
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
        {method: 'eq', column: 'user_id', value: USER_ID},
        {method: 'eq', column: 'id', value: PLAN_ID},
        {method: 'eq', column: 'revision', value: 4},
        {method: 'is', column: 'deleted_at', value: null},
        {method: 'select', columns: undefined},
        {method: 'maybeSingle'},
      ],
    });
    assert.deepEqual(calls[1], {
      table: 'dive_plans',
      calls: [
        {method: 'select', columns: undefined},
        {method: 'eq', column: 'user_id', value: USER_ID},
        {method: 'eq', column: 'id', value: PLAN_ID},
        {method: 'maybeSingle'},
      ],
    });
  });

  test('fails closed when a write query returns a row for another owner', async () => {
    const cases: Array<{
      operation: 'save' | 'delete';
      run: (repository: ReturnType<typeof createAccountDataRepository>) => Promise<unknown>;
      response: QueryResponse;
    }> = [
      {
        operation: 'save',
        run: repository => repository.saveLog(remoteLog({revision: 4}), 4),
        response: {data: logRow({user_id: OTHER_USER_ID, revision: 5}), error: null},
      },
      {
        operation: 'delete',
        run: repository => repository.deletePlan(PLAN_ID, 4),
        response: {data: planRow({user_id: OTHER_USER_ID, revision: 5, deleted_at: UPDATED_AT}), error: null},
      },
    ];

    for (const item of cases) {
      const {client, calls} = createClient([item.response]);
      const repository = createAccountDataRepository(client as never, {userId: USER_ID});
      await rejectsWithOperation(() => item.run(repository), item.operation);
      assert.deepEqual(calls[0]?.calls.slice(1, 2), [
        {method: 'eq', column: 'user_id', value: USER_ID},
      ]);
    }
  });

  test('rejects foreign insert and replay rows before mapping them', async () => {
    const insert = createClient([
      {data: logRow({user_id: OTHER_USER_ID, revision: 1}), error: null},
    ]);
    const insertRepository = createAccountDataRepository(insert.client as never, {userId: USER_ID});
    await rejectsWithOperation(() => insertRepository.saveLog(remoteLog()), 'save');
    assert.equal(
      (insert.calls[0]?.calls[0] as {value: {user_id: string}}).value.user_id,
      USER_ID,
    );

    const replay = createClient([
      {data: null, error: null},
      {data: planRow({user_id: OTHER_USER_ID, revision: 5}), error: null},
    ]);
    const replayRepository = createAccountDataRepository(replay.client as never, {userId: USER_ID});
    await rejectsWithOperation(
      () => replayRepository.savePlan(remotePlan({revision: 4}), 4),
      'save',
    );
    assert.deepEqual(replay.calls[1]?.calls.slice(0, 3), [
      {method: 'select', columns: undefined},
      {method: 'eq', column: 'user_id', value: USER_ID},
      {method: 'eq', column: 'id', value: PLAN_ID},
    ]);
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
