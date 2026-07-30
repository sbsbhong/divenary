import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../migrations/20260730111944_reconcile_semantic_guest_claim_log_reuse.sql',
  import.meta.url,
);
const abandonmentMigrationUrl = new URL(
  '../migrations/20260730130838_abandon_deleted_guest_claim_logs.sql',
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

test('normalizes only semantically identical profiled logs before strict finalization', async () => {
  const source = await readFile(migrationUrl, 'utf8');
  const privateCallAt = source.indexOf(
    'v_result := private.finalize_guest_claim',
  );
  const normalizationAt = source.indexOf(
    '-- Normalize a representation-only canonical mismatch while phase 1 locks are held.',
  );
  const normalization = source.slice(normalizationAt, privateCallAt);
  const normalizationSet = normalization.match(
    /update public\.dive_logs as log\s+set([\s\S]*?)\s+from public\.guest_claim_records/i,
  )?.[1];

  assert.ok(normalizationAt >= 0, 'semantic normalization must be explicit');
  assert.ok(normalizationAt < privateCallAt);
  assert.match(
    normalization,
    /private\.guest_claim_log_semantically_equal\(\s*log,\s*record,\s*source_plan\.id\s*\)/i,
  );
  assert.match(normalization, /log\.payload_sha256 <> record\.payload_sha256/i);
  assert.match(normalization, /log\.deleted_at is null/i);
  assert.match(normalization, /set[\s\S]*payload_sha256 = record\.payload_sha256/i);
  assert.ok(normalizationSet, 'normalization SET clause must be detectable');
  assert.doesNotMatch(normalizationSet, /profile_path\s*=/i);
  assert.doesNotMatch(normalizationSet, /profile_content_revision\s*=/i);
  assert.doesNotMatch(normalizationSet, /\bid\s*=/i);
  assert.doesNotMatch(normalizationSet, /\buser_id\s*=/i);
  assert.doesNotMatch(normalizationSet, /\blocal_id\s*=/i);
});

test('semantic equivalence is narrow, profile-bound, and relation-aware', async () => {
  const source = await readFile(migrationUrl, 'utf8');
  const helper = source.match(
    /create or replace function private\.guest_claim_log_semantically_equal[\s\S]*?\$\$;/i,
  )?.[0];

  assert.ok(helper, 'private semantic log helper must exist');
  assert.match(helper, /p_log\.source = p_record\.payload->>'source'/i);
  assert.match(helper, /p_log\.started_at = \(p_record\.payload->>'started_at'\)::timestamptz/i);
  assert.match(helper, /p_log\.ended_at is not distinct from[\s\S]*::timestamptz/i);
  assert.match(
    helper,
    /private\.account_float_readback_equal\(\s*p_log\.duration_seconds/i,
  );
  assert.match(
    helper,
    /private\.account_float_readback_equal\(\s*p_log\.max_depth_meters/i,
  );
  assert.match(helper, /p_log\.site_name is not distinct from p_record\.payload->>'site_name'/i);
  assert.match(helper, /p_log\.title is not distinct from p_record\.payload->>'title'/i);
  assert.match(helper, /p_log\.rating is not distinct from[\s\S]*::integer/i);
  assert.match(helper, /p_log\.mobile_data = p_record\.payload->'mobile_data'/i);
  assert.match(helper, /p_log\.provenance = p_record\.payload->'provenance'/i);
  assert.match(helper, /p_log\.profile_preview is not distinct from\s+p_record\.payload->'profile_preview'/i);
  assert.match(helper, /#- '\{_local_record,createdAt\}'/i);
  assert.match(helper, /#- '\{_local_record,updatedAt\}'/i);
  assert.match(helper, /#- '\{importedAt\}'/i);
  assert.match(
    helper,
    /p_log\.profile_content_revision is not distinct from\s+p_record\.profile_content_revision/i,
  );
  assert.match(helper, /p_log\.profile_sha256 is not distinct from p_record\.profile_sha256/i);
  assert.match(
    helper,
    /p_log\.profile_byte_count is not distinct from p_record\.profile_byte_count/i,
  );
  assert.match(
    helper,
    /p_log\.profile_sample_count is not distinct from\s+p_record\.profile_sample_count/i,
  );
  assert.match(
    helper,
    /p_log\.source_plan_id is not distinct from p_source_plan_id/i,
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
  assert.match(
    source,
    /revoke all on function private\.account_float_readback_equal\(\s*double precision,\s*double precision\s*\)[\s\S]*from public, anon, authenticated, service_role;/i,
  );
  assert.match(
    source,
    /revoke all on function private\.guest_claim_log_semantically_equal\(\s*public\.dive_logs,\s*public\.guest_claim_records,\s*uuid\s*\)[\s\S]*from public, anon, authenticated, service_role;/i,
  );
});

test('makes abandonment terminal, owner-scoped, and service-role-only', async () => {
  const source = await readFile(abandonmentMigrationUrl, 'utf8');
  const privateFunction = source.match(
    /create function private\.abandon_guest_claim[\s\S]*?\$\$;/i,
  )?.[0];

  assert.ok(privateFunction, 'private abandonment transition must exist');
  assert.match(source, /status in \('uploading', 'committed', 'abandoned'\)/i);
  assert.match(
    source,
    /status = 'abandoned'[\s\S]*committed_at is null[\s\S]*abandoned_at is not null/i,
  );
  assert.match(privateFunction, /batch\.user_id = p_user_id/i);
  assert.match(privateFunction, /for update of batch/i);
  assert.match(
    privateFunction,
    /status = 'abandoned'[\s\S]*abandoned_at = pg_catalog\.transaction_timestamp\(\)/i,
  );
  assert.match(
    privateFunction,
    /batch\.status = 'uploading'/i,
  );
  assert.match(
    source,
    /revoke all on function private\.abandon_guest_claim\(uuid, uuid\)[\s\S]*from public, anon, authenticated, service_role;/i,
  );
  assert.match(
    source,
    /revoke all on function public\.abandon_guest_claim\(uuid, uuid\)[\s\S]*from public, anon, authenticated;/i,
  );
  assert.match(
    source,
    /grant execute on function public\.abandon_guest_claim\(uuid, uuid\)[\s\S]*to service_role;/i,
  );
});
