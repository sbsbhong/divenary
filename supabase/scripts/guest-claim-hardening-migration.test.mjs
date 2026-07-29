import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../migrations/20260729220000_revalidate_guest_claim_canonical_candidates.sql',
  import.meta.url,
);

function lockLoops(source, relation) {
  return [
    ...source.matchAll(
      new RegExp(
        `for v_candidate_id in\\s+select ${relation}\\.id[\\s\\S]*?end loop;`,
        'gi',
      ),
    ),
  ].map(match => ({text: match[0], index: match.index}));
}

test('locks canonical plans then logs both before and after private finalization', async () => {
  const source = await readFile(migrationUrl, 'utf8');
  const batchLock = source.match(
    /select batch\.id[\s\S]*?for update of batch;/i,
  )?.[0];
  const recordLock = source.match(
    /for v_record_id in\s+select record\.id[\s\S]*?end loop;/i,
  )?.[0];
  const planLocks = lockLoops(source, 'plan');
  const logLocks = lockLoops(source, 'log');
  const privateCallAt = source.indexOf(
    'v_result := private.finalize_guest_claim',
  );

  assert.ok(batchLock, 'batch lock must fix the claim transaction first');
  assert.ok(recordLock, 'record locks must fix the staged manifest');
  assert.equal(planLocks.length, 2, 'plan candidates need two lock phases');
  assert.equal(logLocks.length, 2, 'log candidates need two lock phases');
  assert.ok(source.indexOf(batchLock) < source.indexOf(recordLock));
  assert.ok(source.indexOf(recordLock) < planLocks[0].index);
  assert.ok(planLocks[0].index < logLocks[0].index);
  assert.ok(logLocks[0].index < privateCallAt);
  assert.ok(privateCallAt < planLocks[1].index);
  assert.ok(planLocks[1].index < logLocks[1].index);

  assert.match(
    recordLock,
    /order by record\.entity_kind, record\.client_record_id, record\.id\s+for update of record/i,
  );
  for (const planLock of planLocks) {
    assert.match(planLock.text, /record\.entity_kind = 'plan'/);
    assert.match(planLock.text, /plan\.user_id = p_user_id/);
    assert.match(planLock.text, /plan\.local_id = record\.client_record_id/);
    assert.match(
      planLock.text,
      /order by plan\.local_id, plan\.id\s+for update of plan/i,
    );
    assert.doesNotMatch(planLock.text, /deleted_at/);
  }
  for (const logLock of logLocks) {
    assert.match(logLock.text, /record\.entity_kind = 'log'/);
    assert.match(logLock.text, /log\.user_id = p_user_id/);
    assert.match(logLock.text, /log\.local_id = record\.client_record_id/);
    assert.match(
      logLock.text,
      /order by log\.local_id, log\.id\s+for update of log/i,
    );
    assert.doesNotMatch(logLock.text, /deleted_at/);
  }
});

test('fully revalidates locked final rows before canonical remap', async () => {
  const source = await readFile(migrationUrl, 'utf8');
  const planLocks = lockLoops(source, 'plan');
  const logLocks = lockLoops(source, 'log');
  const validationAt = source.indexOf(
    '-- Revalidate every now-materialized candidate while phase 2 locks are held.',
  );
  const remapAt = source.indexOf(
    '-- Remap only after locked equivalence validation succeeds.',
  );
  const validation = source.slice(validationAt, remapAt);

  assert.ok(logLocks[1].index < validationAt);
  assert.ok(validationAt < remapAt);
  assert.match(validation, /plan\.deleted_at is not null/i);
  assert.match(
    validation,
    /plan\.payload_sha256 <> record\.payload_sha256/i,
  );
  assert.match(
    validation,
    /plan\.converted_log_id is distinct from converted_log\.id/i,
  );
  assert.match(validation, /log\.deleted_at is not null/i);
  assert.match(
    validation,
    /log\.payload_sha256 <> record\.payload_sha256/i,
  );
  assert.match(
    validation,
    /log\.profile_content_revision is distinct from\s+record\.profile_content_revision/i,
  );
  assert.match(
    validation,
    /log\.profile_sha256 is distinct from record\.profile_sha256/i,
  );
  assert.match(
    validation,
    /log\.profile_byte_count is distinct from record\.profile_byte_count/i,
  );
  assert.match(
    validation,
    /log\.profile_sample_count is distinct from record\.profile_sample_count/i,
  );
  assert.match(
    validation,
    /log\.source_plan_id is distinct from source_plan\.id/i,
  );
  assert.match(
    source.slice(remapAt),
    /set target_record_id = plan\.id[\s\S]*plan\.deleted_at is null/i,
  );
  assert.match(
    source.slice(remapAt),
    /set target_record_id = log\.id[\s\S]*log\.deleted_at is null/i,
  );
});

test('keeps the privileged wrapper owner-scoped and service-role-only', async () => {
  const source = await readFile(migrationUrl, 'utf8');

  assert.match(source, /security definer/i);
  assert.match(source, /set search_path = ''/i);
  assert.match(source, /batch\.user_id = p_user_id/i);
  assert.match(source, /record\.user_id = p_user_id/i);
  assert.match(source, /plan\.user_id = p_user_id/i);
  assert.match(source, /log\.user_id = p_user_id/i);
  assert.match(
    source,
    /revoke all on function public\.finalize_guest_claim\(uuid, uuid, jsonb\)[\s\S]*from public, anon, authenticated;/i,
  );
  assert.match(
    source,
    /grant execute on function public\.finalize_guest_claim\(uuid, uuid, jsonb\)[\s\S]*to service_role;/i,
  );
});
