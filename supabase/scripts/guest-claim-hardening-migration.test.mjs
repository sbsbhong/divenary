import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../migrations/20260729210000_harden_guest_claim_canonical_candidates.sql',
  import.meta.url,
);

test('locks every matching plan before every matching log and before finalization', async () => {
  const source = await readFile(migrationUrl, 'utf8');
  const batchLock = source.match(
    /select batch\.id[\s\S]*?for update of batch;/i,
  )?.[0];
  const recordLock = source.match(
    /for v_record_id in\s+select record\.id[\s\S]*?end loop;/i,
  )?.[0];
  const planLock = source.match(
    /for v_candidate_id in\s+select plan\.id[\s\S]*?end loop;/i,
  )?.[0];
  const logLock = source.match(
    /for v_candidate_id in\s+select log\.id[\s\S]*?end loop;/i,
  )?.[0];

  assert.ok(batchLock, 'batch lock is required before fixing the candidate set');
  assert.ok(recordLock, 'record locks are required before candidate lookup');
  assert.ok(planLock, 'plan candidate lock loop is required');
  assert.ok(logLock, 'log candidate lock loop is required');
  assert.match(
    source,
    /Lock order starts with the batch, then records by \(entity_kind, client_record_id, id\)\./,
  );
  assert.match(
    source,
    /Lock order: all plans by \(local_id, id\), then all logs by \(local_id, id\)\./,
  );
  assert.ok(source.indexOf(batchLock) < source.indexOf(recordLock));
  assert.ok(source.indexOf(recordLock) < source.indexOf(planLock));
  assert.ok(source.indexOf(planLock) < source.indexOf(logLock));
  assert.ok(
    source.indexOf(logLock) <
      source.indexOf('v_result := private.finalize_guest_claim'),
  );

  assert.match(recordLock, /record\.batch_id = p_batch_id/);
  assert.match(recordLock, /record\.user_id = p_user_id/);
  assert.match(
    recordLock,
    /order by record\.entity_kind, record\.client_record_id, record\.id\s+for update of record/i,
  );

  assert.match(planLock, /record\.entity_kind = 'plan'/);
  assert.match(planLock, /plan\.user_id = p_user_id/);
  assert.match(planLock, /plan\.local_id = record\.client_record_id/);
  assert.match(planLock, /order by plan\.local_id, plan\.id\s+for update of plan/i);
  assert.doesNotMatch(planLock, /deleted_at/);

  assert.match(logLock, /record\.entity_kind = 'log'/);
  assert.match(logLock, /log\.user_id = p_user_id/);
  assert.match(logLock, /log\.local_id = record\.client_record_id/);
  assert.match(logLock, /order by log\.local_id, log\.id\s+for update of log/i);
  assert.doesNotMatch(logLock, /deleted_at/);
});

test('uses only active canonical rows after private finalization', async () => {
  const source = await readFile(migrationUrl, 'utf8');
  const afterPrivate = source.slice(
    source.indexOf('v_result := private.finalize_guest_claim'),
  );

  assert.ok(
    (afterPrivate.match(/plan\.deleted_at is null/gi) ?? []).length >= 2,
    'plan remap and invariant must both require an active row',
  );
  assert.ok(
    (afterPrivate.match(/log\.deleted_at is null/gi) ?? []).length >= 2,
    'log remap and invariant must both require an active row',
  );
  assert.match(source, /security definer/i);
  assert.match(source, /set search_path = ''/i);
  assert.match(
    source,
    /revoke all on function public\.finalize_guest_claim\(uuid, uuid, jsonb\)[\s\S]*from public, anon, authenticated;/i,
  );
  assert.match(
    source,
    /grant execute on function public\.finalize_guest_claim\(uuid, uuid, jsonb\)[\s\S]*to service_role;/i,
  );
});
