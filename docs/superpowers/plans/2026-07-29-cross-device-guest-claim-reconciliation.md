# Cross-device Guest Claim Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover an already-uploaded guest claim when another device previously committed an equivalent row under a different remote ID, without losing immutable snapshot data or showing a stale `15/15` upload phase.

**Architecture:** A Supabase migration lets the existing private finalizer perform all payload/profile/relation checks and then remaps each staging `target_record_id` to the canonical account row ID inside the same transaction. The mobile claim service accepts the server-verified canonical IDs only after full committed-batch validation, persists them before account publication, and enters `finalizing` directly when every upload receipt is already complete.

**Tech Stack:** PostgreSQL/PLpgSQL, Supabase Edge Function verifier, `@supabase/supabase-js`, React Native/TypeScript, Jest, Node test runner, Karpathy repository wiki.

## Global Constraints

- Preserve every immutable claim snapshot until verified remote commit, account local readback, and exact guest cleanup complete.
- Equivalent means the existing private finalizer accepts the same payload digest, profile revision/digest/count, and plan/log relationships.
- Divergent payload, profile, or relationship data remains fail closed and atomically rolls back.
- Do not add dependencies or change generated database types.
- Staging project `mclvhwzsuvsxjerdouka` is the only hosted deployment target; production remains out of scope.
- Do not modify the unrelated `.turbo/cache/9580327c5bf65fa3-manifest.json` worktree change.

---

### Task 1: Canonicalize equivalent cross-device claim targets on the server

**Files:**
- Create: `supabase/migrations/20260729200000_reconcile_guest_claim_target_reuse.sql`
- Modify: `supabase/tests/functions/finalize-guest-claim.mjs`
- Modify: `supabase/scripts/verify-staging-guest-claim.mjs`
- Modify: `supabase/scripts/verify-staging-guest-claim.test.mjs`

**Interfaces:**
- Consumes: `private.finalize_guest_claim(uuid, uuid, jsonb) -> jsonb`
- Produces: `public.finalize_guest_claim(uuid, uuid, jsonb) -> jsonb` with canonical `guest_claim_records.target_record_id` values after a successful commit

- [ ] **Step 1: Change the function integration test to require equivalent target reuse reconciliation**

Replace the current same-digest `409` expectation with:

```js
const sameDigest = await invokeFinalizer(owner, sameDigestBatch.id);
assertStatus(sameDigest, [200], 'same digest cross-device reconciliation');
assert.deepEqual(sameDigest.body, {
  batchId: sameDigestBatch.id,
  status: 'committed',
  planCount: 1,
  logCount: 1,
});

const reconciledRecords = await readRows(
  owner,
  'guest_claim_records',
  `select=entity_kind,target_record_id&batch_id=eq.${sameDigestBatch.id}`,
);
assert.equal(
  reconciledRecords.find(row => row.entity_kind === 'plan').target_record_id,
  successPlan.target_record_id,
);
assert.equal(
  reconciledRecords.find(row => row.entity_kind === 'log').target_record_id,
  successLog.target_record_id,
);
```

Keep the existing different-digest and changed-profile rollback assertions.

- [ ] **Step 2: Run the function test and verify the new expectation fails**

Run:

```bash
yarn supabase:start
node supabase/tests/functions/finalize-guest-claim.mjs
```

Expected: the same-digest batch returns `409 claim_validation_failed`.

- [ ] **Step 3: Add the migration that remaps only after private validation succeeds**

Create a replacement public wrapper with this transaction order:

```sql
v_result := private.finalize_guest_claim(
  p_user_id,
  p_batch_id,
  p_verified_profiles
);

update public.guest_claim_records as record
set target_record_id = plan.id
from public.dive_plans as plan
where record.batch_id = p_batch_id
  and record.user_id = p_user_id
  and record.entity_kind = 'plan'
  and plan.user_id = p_user_id
  and plan.local_id = record.client_record_id
  and record.target_record_id <> plan.id;

update public.guest_claim_records as record
set target_record_id = log.id
from public.dive_logs as log
where record.batch_id = p_batch_id
  and record.user_id = p_user_id
  and record.entity_kind = 'log'
  and log.user_id = p_user_id
  and log.local_id = record.client_record_id
  and record.target_record_id <> log.id;
```

Then assert every staged plan/log target matches exactly one same-owner final row before returning `v_result`. Preserve revoke/grant and `search_path = ''`.

- [ ] **Step 4: Update the hosted verifier contract**

Change `verifyCompleteClaim` so an equivalent second batch must:

```js
assertFinalizerSuccess(targetReuse, 'cross-device equivalent claim');
```

Then read the second batch records and require their target IDs to equal the first batch's canonical plan/log IDs. Keep a separate divergent payload case that must still return `409`.

- [ ] **Step 5: Update verifier unit-test fakes**

Replace `allowTargetReuseCommit` with a corruption option such as `failTargetReconciliation`. The normal fake finalizer must commit and remap equivalent target IDs; the corruption option leaves different IDs so `verifyStagingGuestClaim` rejects the result.

- [ ] **Step 6: Run server tests**

Run:

```bash
node --test supabase/scripts/verify-staging-guest-claim.test.mjs
yarn supabase:reset
yarn supabase:test:db
node supabase/tests/functions/finalize-guest-claim.mjs
```

Expected: equivalent reuse passes with canonical IDs; divergent payload/profile cases still pass their denial assertions.

- [ ] **Step 7: Commit Task 1**

```bash
git add supabase/migrations/20260729200000_reconcile_guest_claim_target_reuse.sql \
  supabase/tests/functions/finalize-guest-claim.mjs \
  supabase/scripts/verify-staging-guest-claim.mjs \
  supabase/scripts/verify-staging-guest-claim.test.mjs
git commit -m "fix(supabase): reconcile equivalent guest claim targets"
```

### Task 2: Persist canonical readback IDs and skip stale upload progress

**Files:**
- Modify: `apps/mobile/__tests__/guest-claim-service.test.ts`
- Modify: `apps/mobile/src/claim/guest-claim-service.ts`
- Modify if presentation coverage requires it: `apps/mobile/__tests__/account-claim-screen.test.tsx`

**Interfaces:**
- Consumes: `GuestClaimRemoteRepository.listCommittedBatch(batchId)`
- Produces: a verified snapshot whose `manifest.items[*].targetRecordId` equals the canonical remote row ID
- Produces: retry progress phase `finalizing` when `remoteBatchId` exists and every item has `completedAt`

- [ ] **Step 1: Add a failing canonical-ID reconciliation service test**

Build a one-log snapshot whose stage call returns `TARGET_ID`, while committed readback returns `OTHER_ID` with the same `localId` and payload digest. Require:

```ts
expect(result).toMatchObject({
  manifest: {
    status: 'committed',
    items: [{targetRecordId: OTHER_ID}],
  },
});
await expect(account.logbook.get('log-a')).resolves.toMatchObject({
  localId: 'log-a',
  remoteId: OTHER_ID,
  cloudSyncStatus: 'synced',
});
```

Also add a divergent payload digest case that remains `remote_conflict`.

- [ ] **Step 2: Run the focused Jest test and verify it fails**

Run:

```bash
yarn workspace @repo/mobile test guest-claim-service.test.ts --runInBand
```

Expected: the equivalent case fails because `verifyCommittedBatch` currently requires `remote.id === item.targetRecordId`.

- [ ] **Step 3: Verify all committed rows before mutating target IDs**

Refactor `verifyCommittedBatch` into two passes:

```ts
const canonicalTargets = new Map<string, string>();

// Pass 1: validate counts, local IDs, payload digests, uniqueness and relations.
canonicalTargets.set(item.key, remote.id);

// Pass 2, only after all checks passed:
for (const item of snapshot.manifest.items) {
  item.targetRecordId = canonicalTargets.get(item.key)!;
}
```

Relation checks must compare `source_plan_id`/`converted_log_id` against the canonical remote maps, not stale staged IDs.

- [ ] **Step 4: Persist canonical IDs before account publication**

In `finalize`, after `verifyCommittedBatch` succeeds:

```ts
const verified = verifyCommittedBatch(snapshot, committed);
await this.persist(snapshot);
await this.writeAccountSnapshot(snapshot, verified);
```

This makes a process interruption resume with canonical receipts.

- [ ] **Step 5: Add a failing finalizing-progress retry test**

Create a failed/deferred snapshot with `remoteBatchId` and every item `completedAt`. Capture progress callbacks and require the first retry progress phase to be:

```ts
expect(progress[0]).toMatchObject({phase: 'finalizing'});
expect(progress).not.toContainEqual(
  expect.objectContaining({phase: 'uploading'}),
);
```

- [ ] **Step 6: Run the focused test and verify it fails**

Expected: current `retry()` sets `running` and `run()` emits `uploading` with all items completed.

- [ ] **Step 7: Start completed retries directly in finalizing**

Add a predicate:

```ts
function uploadReceiptIsComplete(snapshot: GuestClaimSnapshot): boolean {
  return (
    snapshot.manifest.remoteBatchId !== undefined &&
    snapshot.manifest.items.every(item => item.completedAt !== undefined)
  );
}
```

Use it in `retry()` and `run()` so a fully uploaded checkpoint persists `finalizing` and skips the uploading emit while still invoking remote finalize/readback.

- [ ] **Step 8: Run focused mobile tests**

Run:

```bash
yarn workspace @repo/mobile test guest-claim-service.test.ts account-claim-screen.test.tsx --runInBand
yarn mobile:typecheck
```

Expected: all selected tests and typecheck pass.

- [ ] **Step 9: Commit Task 2**

```bash
git add apps/mobile/src/claim/guest-claim-service.ts \
  apps/mobile/__tests__/guest-claim-service.test.ts \
  apps/mobile/__tests__/account-claim-screen.test.tsx
git commit -m "fix(mobile): resume uploaded claims at finalization"
```

### Task 3: Document, verify, deploy to staging, and exercise the original batch

**Files:**
- Create: `.wiki/raw/architecture/2026-07-29-cross-device-guest-claim-reconciliation.md`
- Modify: `.wiki/wiki/architecture/mobile.md`
- Modify: `.wiki/wiki/architecture/supabase.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/questions/open-questions.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

**Interfaces:**
- Consumes: verified Task 1 and Task 2 behavior
- Produces: durable documentation and staging/device evidence

- [ ] **Step 1: Capture immutable implementation evidence**

Create the raw source with the observed device counts, the canonical-ID collision, the selected reconciliation rule, touched source paths, and actual verification/deployment results. Do not include account email, access token, or full UUIDs.

- [ ] **Step 2: Update compiled wiki articles**

Record:

- same-owner/same-local/same-content cross-device claims reuse the canonical remote ID;
- divergent data still rolls back;
- completed upload receipts enter finalizing without replaying `15/15`;
- physical claim remains unverified until the original batch succeeds after deployment.

Update the index summaries/dates and append the ingest log.

- [ ] **Step 3: Run repository gates**

Run:

```bash
yarn mobile:typecheck
yarn codex:check
```

Run:

```bash
node --test supabase/scripts/verify-staging-guest-claim.test.mjs
yarn supabase:reset
yarn supabase:test:db
node supabase/tests/functions/finalize-guest-claim.mjs
```

Record every command and exit status.

- [ ] **Step 4: Deploy only the new migration and current finalize function to staging**

Use the repository's isolated staging wrapper. Confirm the linked project is exactly `mclvhwzsuvsxjerdouka` before mutation. Do not deploy to production.

- [ ] **Step 5: Run the automated staging verifier**

Expected: equivalent cross-device batch remaps to canonical IDs, divergent claims are denied, both test users are cleaned up.

- [ ] **Step 6: Rebuild/run the mobile app and retry the original physical batch**

Confirm:

1. retry opens `계정 데이터를 확인하는 중`, not stale `15/15`;
2. batch reaches cleanup and committed;
3. account local/remote list contains the recovered non-duplicate rows;
4. the one remaining live guest log is offered separately;
5. a second retry does not duplicate rows.

- [ ] **Step 7: Request code review and address all critical/important findings**

Provide the design, this plan, base SHA `a856dc4^`, and final SHA to the reviewer. Re-run affected tests after fixes.

- [ ] **Step 8: Commit documentation and final corrections**

```bash
git add .wiki docs/superpowers/plans/2026-07-29-cross-device-guest-claim-reconciliation.md
git commit -m "docs(wiki): record cross-device claim reconciliation"
```

- [ ] **Step 9: Verify main and hand off**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
git branch --contains HEAD
```

Report the exact staging/device results and any remaining manual gate. Do not claim the physical bug is fixed without the original-device retry evidence.
