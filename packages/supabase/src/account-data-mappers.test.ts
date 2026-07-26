import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {
  fromDiveLogRow,
  fromDivePlanRow,
  type DiveLogRow,
  type DivePlanRow,
} from './account-data-mappers.ts';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const LOG_ID = '00000000-0000-4000-8000-000000000010';
const PLAN_ID = '00000000-0000-4000-8000-000000000020';

function logRow(overrides: Partial<DiveLogRow> = {}): DiveLogRow {
  return {
    id: LOG_ID,
    user_id: USER_ID,
    local_id: 'local-log',
    revision: 1,
    payload_sha256: 'a'.repeat(64),
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
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-19T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function planRow(overrides: Partial<DivePlanRow> = {}): DivePlanRow {
  return {
    id: PLAN_ID,
    user_id: USER_ID,
    local_id: 'local-plan',
    revision: 1,
    payload_sha256: 'b'.repeat(64),
    status: 'planned',
    planned_at: '2026-07-19T10:00:00.000Z',
    dive_mode: null,
    site_name: null,
    plan_data: {},
    converted_log_id: null,
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-19T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('account data mappers', () => {
  test('canonicalizes equivalent PostgREST log timestamps with offsets and microseconds', () => {
    const mapped = fromDiveLogRow(
      logRow({
        started_at: '2026-07-19T19:00:00.123000+09:00',
        ended_at: '2026-07-19T10:00:01.987000+00:00',
      }),
    );

    assert.equal(mapped.payload.started_at, '2026-07-19T10:00:00.123Z');
    assert.equal(mapped.payload.ended_at, '2026-07-19T10:00:01.987Z');
  });

  test('canonicalizes a PostgREST plan timestamp while preserving null', () => {
    assert.equal(
      fromDivePlanRow(
        planRow({planned_at: '2026-07-19T19:00:00.123000+09:00'}),
      ).payload.planned_at,
      '2026-07-19T10:00:00.123Z',
    );
    assert.equal(
      fromDivePlanRow(planRow({planned_at: null})).payload.planned_at,
      null,
    );
  });

  test('rejects precision that cannot be represented without data loss', () => {
    assert.throws(
      () =>
        fromDiveLogRow(
          logRow({started_at: '2026-07-19T10:00:00.123456+00:00'}),
        ),
      TypeError,
    );
  });
});
