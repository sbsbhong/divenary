import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const config = readFileSync(
  path.join(repositoryRoot, 'supabase/config.toml'),
  'utf8',
);
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"$/m)?.[1];

assert.ok(projectId, 'local Supabase project_id must exist');
const databaseContainer = `supabase_db_${projectId}`;
const psqlArguments = [
  'exec',
  '-i',
  databaseContainer,
  'psql',
  '-X',
  '-q',
  '-A',
  '-t',
  '-v',
  'ON_ERROR_STOP=1',
  '-U',
  'postgres',
  '-d',
  'postgres',
];

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function query(sql) {
  return execFileSync('docker', [...psqlArguments, '-c', sql], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function openSession() {
  const child = spawn('docker', psqlArguments, {
    cwd: repositoryRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const session = {
    child,
    stdout: '',
    stderr: '',
    exit: new Promise(resolve => {
      child.once('exit', (code, signal) => resolve({code, signal}));
    }),
  };
  child.stdout.on('data', chunk => {
    session.stdout += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    session.stderr += chunk.toString();
  });
  return session;
}

function runSession(sql) {
  const session = openSession();
  session.child.stdin.end(`${sql}\n`);
  return session;
}

async function waitForText(session, text, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (!session.stdout.includes(text)) {
    const exit = await Promise.race([
      session.exit,
      new Promise(resolve => setTimeout(() => resolve(undefined), 50)),
    ]);
    if (exit !== undefined) {
      if (session.stdout.includes(text)) {
        return;
      }
      assert.fail(
        `session exited before ${text}: ${session.stderr || session.stdout}`,
      );
    }
    if (Date.now() - startedAt >= timeoutMs) {
      assert.fail(`timed out waiting for ${text}: ${session.stderr}`);
    }
  }
}

async function finishSession(session, expectedCode = 0) {
  const result = await session.exit;
  assert.equal(
    result.code,
    expectedCode,
    `unexpected psql exit: ${session.stderr || session.stdout}`,
  );
  return session.stdout.trim();
}

async function waitForDatabaseWait(applicationName, predicate, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const wait = query(`
      select pg_catalog.concat_ws('|', wait_event_type, wait_event)
      from pg_catalog.pg_stat_activity
      where application_name = ${sqlLiteral(applicationName)}
    `);
    if (predicate(wait)) {
      return wait;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${label}`);
}

function barrierKey() {
  return BigInt(`0x${randomBytes(6).toString('hex')}`).toString();
}

async function acquireBarrier(key, label) {
  const session = openSession();
  session.child.stdin.write(`
    set application_name = ${sqlLiteral(`guest-claim-barrier-${label}`)};
    select pg_catalog.pg_advisory_lock(${key});
    \\echo BARRIER_READY_${label}
  `);
  await waitForText(session, `BARRIER_READY_${label}`);
  return session;
}

async function releaseBarrier(session, key, label) {
  session.child.stdin.end(`
    select pg_catalog.pg_advisory_unlock(${key});
    \\echo BARRIER_RELEASED_${label}
    \\q
  `);
  await waitForText(session, `BARRIER_RELEASED_${label}`);
  await finishSession(session);
}

function createDisposableUser() {
  const userId = randomUUID();
  query(`
    insert into auth.users (id)
    values (${sqlLiteral(userId)}::uuid);
  `);
  return userId;
}

function deleteUser(userId) {
  query(`
    delete from auth.users
    where id = ${sqlLiteral(userId)}::uuid;
  `);
}

function planPayload(label) {
  return {
    status: 'planned',
    planned_at: '2026-07-29T01:00:00.000Z',
    dive_mode: 'scuba',
    site_name: label,
    plan_data: {schemaVersion: 1, label},
  };
}

function fixture(userId, label) {
  const payload = planPayload(label);
  return {
    userId,
    label,
    localId: `${label}-${randomUUID()}`,
    batchId: randomUUID(),
    recordId: randomUUID(),
    stagedTargetId: randomUUID(),
    winnerId: randomUUID(),
    payload,
    payloadSha256: sha256(JSON.stringify(payload)),
    divergentSha256: sha256(`divergent-${randomUUID()}`),
  };
}

function createFixture(value) {
  query(`
    insert into public.guest_claim_batches (
      id, user_id, client_batch_id, manifest_sha256,
      expected_plan_count, expected_log_count
    ) values (
      ${sqlLiteral(value.batchId)}::uuid,
      ${sqlLiteral(value.userId)}::uuid,
      ${sqlLiteral(value.label)},
      ${sqlLiteral(sha256(value.label))},
      1,
      0
    );

    insert into public.guest_claim_records (
      id, batch_id, user_id, entity_kind, client_record_id,
      target_record_id, payload_sha256, payload
    ) values (
      ${sqlLiteral(value.recordId)}::uuid,
      ${sqlLiteral(value.batchId)}::uuid,
      ${sqlLiteral(value.userId)}::uuid,
      'plan',
      ${sqlLiteral(value.localId)},
      ${sqlLiteral(value.stagedTargetId)}::uuid,
      ${sqlLiteral(value.payloadSha256)},
      ${sqlLiteral(JSON.stringify(value.payload))}::jsonb
    );
  `);
}

function winnerInsert(value) {
  return `
    insert into public.dive_plans (
      id, user_id, local_id, status, planned_at, dive_mode,
      site_name, plan_data, payload_sha256
    ) values (
      ${sqlLiteral(value.winnerId)}::uuid,
      ${sqlLiteral(value.userId)}::uuid,
      ${sqlLiteral(value.localId)},
      ${sqlLiteral(value.payload.status)},
      ${sqlLiteral(value.payload.planned_at)}::timestamptz,
      ${sqlLiteral(value.payload.dive_mode)},
      ${sqlLiteral(value.payload.site_name)},
      ${sqlLiteral(JSON.stringify(value.payload.plan_data))}::jsonb,
      ${sqlLiteral(value.payloadSha256)}
    );
  `;
}

async function openUncommittedWinner(value, label) {
  const session = openSession();
  session.child.stdin.write(`
    set application_name = ${sqlLiteral(`guest-claim-winner-${label}`)};
    begin;
    ${winnerInsert(value)}
    \\echo WINNER_READY_${label}
  `);
  await waitForText(session, `WINNER_READY_${label}`);
  return session;
}

async function commitWinner(session, label) {
  session.child.stdin.end(`
    commit;
    \\echo WINNER_COMMITTED_${label}
    \\q
  `);
  await waitForText(session, `WINNER_COMMITTED_${label}`);
  await finishSession(session);
}

function startFinalizer(value, label) {
  return runSession(`
    set application_name = ${sqlLiteral(`guest-claim-finalizer-${label}`)};
    select public.finalize_guest_claim(
      ${sqlLiteral(value.userId)}::uuid,
      ${sqlLiteral(value.batchId)}::uuid,
      '[]'::jsonb
    );
  `);
}

function installRemapBarrier(key) {
  query(`
    create or replace function private.test_guest_claim_remap_barrier()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      perform pg_catalog.pg_advisory_xact_lock(${key});
      return new;
    end;
    $$;

    drop trigger if exists test_guest_claim_remap_barrier
      on public.guest_claim_records;
    create trigger test_guest_claim_remap_barrier
    before update of target_record_id on public.guest_claim_records
    for each row execute function private.test_guest_claim_remap_barrier();
  `);
}

function installBatchBarrier(key) {
  query(`
    create or replace function private.test_guest_claim_batch_barrier()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      if old.status = 'uploading' and new.status = 'committed' then
        perform pg_catalog.pg_advisory_xact_lock(${key});
      end if;
      return new;
    end;
    $$;

    drop trigger if exists test_guest_claim_batch_barrier
      on public.guest_claim_batches;
    create trigger test_guest_claim_batch_barrier
    before update of status on public.guest_claim_batches
    for each row execute function private.test_guest_claim_batch_barrier();
  `);
}

function dropBarrierObjects() {
  query(`
    drop trigger if exists test_guest_claim_remap_barrier
      on public.guest_claim_records;
    drop trigger if exists test_guest_claim_batch_barrier
      on public.guest_claim_batches;
    drop function if exists private.test_guest_claim_remap_barrier();
    drop function if exists private.test_guest_claim_batch_barrier();
  `);
}

function divergentUpdate(value, label, rollback) {
  return runSession(`
    set application_name = ${sqlLiteral(`guest-claim-updater-${label}`)};
    begin;
    update public.dive_plans
    set payload_sha256 = ${sqlLiteral(value.divergentSha256)}
    where id = ${sqlLiteral(value.winnerId)}::uuid
      and user_id = ${sqlLiteral(value.userId)}::uuid;
    ${rollback ? 'rollback' : 'commit'};
  `);
}

function readFixtureState(value) {
  const row = query(`
    select pg_catalog.concat_ws(
      '|',
      batch.status,
      record.target_record_id::text,
      plan.payload_sha256
    )
    from public.guest_claim_batches as batch
    join public.guest_claim_records as record
      on record.batch_id = batch.id
      and record.user_id = batch.user_id
    join public.dive_plans as plan
      on plan.user_id = batch.user_id
      and plan.local_id = record.client_record_id
    where batch.id = ${sqlLiteral(value.batchId)}::uuid
      and batch.user_id = ${sqlLiteral(value.userId)}::uuid
  `);
  const [status, targetRecordId, payloadSha256] = row.split('|');
  return {status, targetRecordId, payloadSha256};
}

async function equivalentCommitBlocksDivergentUpdate(userId) {
  const label = 'post-lock';
  const value = fixture(userId, label);
  const key = barrierKey();
  createFixture(value);
  installRemapBarrier(key);
  const barrier = await acquireBarrier(key, label);
  const winner = await openUncommittedWinner(value, label);
  const finalizer = startFinalizer(value, label);
  let barrierReleased = false;
  let updater;

  try {
    await waitForDatabaseWait(
      `guest-claim-finalizer-${label}`,
      wait => wait.startsWith('Lock|'),
      'finalizer to wait for the concurrent equivalent insert',
    );
    await commitWinner(winner, label);
    await waitForDatabaseWait(
      `guest-claim-finalizer-${label}`,
      wait => wait === 'Lock|advisory',
      'finalizer remap barrier after post-private candidate lock',
    );

    updater = divergentUpdate(value, label, true);
    const earlyUpdaterExit = await Promise.race([
      updater.exit,
      new Promise(resolve => setTimeout(() => resolve(undefined), 250)),
    ]);
    assert.equal(
      earlyUpdaterExit,
      undefined,
      'divergent updater must remain blocked behind the finalizer row lock',
    );
    await waitForDatabaseWait(
      `guest-claim-updater-${label}`,
      wait => wait.startsWith('Lock|'),
      'divergent updater to wait behind the post-private row lock',
    );

    await releaseBarrier(barrier, key, label);
    barrierReleased = true;
    const finalizerOutput = await finishSession(finalizer);
    await finishSession(updater);
    assert.match(finalizerOutput, /"status": "committed"/);
    assert.deepEqual(readFixtureState(value), {
      status: 'committed',
      targetRecordId: value.winnerId,
      payloadSha256: value.payloadSha256,
    });
    console.log(
      'PASS post-private row lock makes the divergent updater wait while the equivalent winner commits',
    );
  } finally {
    if (!barrierReleased) {
      await releaseBarrier(barrier, key, label);
      await finalizer.exit;
      if (updater !== undefined) {
        await updater.exit;
      }
    }
  }
}

async function divergentWinnerRollsBackFinalizer(userId) {
  const label = 'post-validate';
  const value = fixture(userId, label);
  const key = barrierKey();
  createFixture(value);
  installBatchBarrier(key);
  const barrier = await acquireBarrier(key, label);
  const winner = await openUncommittedWinner(value, label);
  const finalizer = startFinalizer(value, label);
  let barrierReleased = false;

  try {
    await waitForDatabaseWait(
      `guest-claim-finalizer-${label}`,
      wait => wait.startsWith('Lock|'),
      'finalizer to wait for the concurrent equivalent insert',
    );
    await commitWinner(winner, label);
    await waitForDatabaseWait(
      `guest-claim-finalizer-${label}`,
      wait => wait === 'Lock|advisory',
      'private finalizer commit barrier',
    );

    const updater = divergentUpdate(value, label, false);
    await finishSession(updater);
    await releaseBarrier(barrier, key, label);
    barrierReleased = true;
    const finalizerResult = await finalizer.exit;
    assert.notEqual(finalizerResult.code, 0);
    assert.match(finalizer.stderr, /claim validation failed/);
    assert.deepEqual(readFixtureState(value), {
      status: 'uploading',
      targetRecordId: value.stagedTargetId,
      payloadSha256: value.divergentSha256,
    });
    console.log(
      'PASS post-private locked revalidation rolls back a newly divergent canonical winner',
    );
  } finally {
    if (!barrierReleased) {
      await releaseBarrier(barrier, key, label);
      await finalizer.exit;
    }
  }
}

let userId;

try {
  userId = createDisposableUser();
  await equivalentCommitBlocksDivergentUpdate(userId);
  dropBarrierObjects();
  await divergentWinnerRollsBackFinalizer(userId);
} finally {
  try {
    dropBarrierObjects();
  } catch {
    // The local reset gate is responsible for cleaning a broken test hook.
  }
  if (userId !== undefined) {
    deleteUser(userId);
  }
}
