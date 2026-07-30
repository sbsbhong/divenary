# Mobile-Authoritative Watch Log Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a mobile deletion of a Watch-created log durable across guest/account state, guest claim retry, Supabase, iPhone WatchConnectivity, and the paired Watch so the deleted session cannot reappear.

**Architecture:** A device-wide mobile tombstone keyed by `localSessionId` is persisted before any delete. A small deletion coordinator serializes claim invalidation and repository deletion, filters stale imports/hydration, and queues a durable native command. Supabase gains an idempotent privileged `uploading → abandoned` claim transition; Watch gains a persistent deleted-session ledger and removes manifest/artifact state before acknowledging.

**Tech Stack:** TypeScript/Jest, React Native 0.85.3, AsyncStorage-compatible persistent stores, Swift/WatchConnectivity, SwiftUI/watchOS, Supabase Postgres/RLS/Storage/Edge Functions, Yarn 1.

## Global Constraints

- Mobile is the only user-facing deletion initiator; do not add Watch delete UI or gestures.
- Use `localSessionId` as deletion authority; keep revision/digest as evidence.
- Persist and read back the mobile tombstone before deleting a repository row.
- Preserve normal Watch import acknowledgement as iPhone-local commit or intentional tombstone discard, never account-cloud completion.
- Preserve existing account local-first/outbox soft-delete behavior.
- Production Supabase remains untouched; deploy only to staging `mclvhwzsuvsxjerdouka`.
- Do not infer and auto-delete the existing resurrected 15 records.
- Do not modify generated outputs directly; regenerate Supabase types through the repository script.
- Use Yarn 1 only.
- Stop and request physical iPhone/Watch connection before the real-device gate.
- If the same verification gate fails three times for the same root cause, stop and report the blocker.

---

### Task 1: Persistent mobile deletion tombstones

**Files:**
- Create: `apps/mobile/src/deletion/watch-log-deletion-store.ts`
- Test: `apps/mobile/__tests__/watch-log-deletion-store.test.ts`
- Modify: `apps/mobile/src/storage/storage-keys.ts`

**Interfaces:**
- Produces:
  - `WatchLogDeletionIdentity`
  - `WatchLogDeletionTombstone`
  - `WatchLogDeletionStore`
  - `createWatchLogDeletionStore(storage)`
- Store methods:

```ts
type WatchLogDeletionStore = {
  list(): Promise<WatchLogDeletionTombstone[]>;
  get(localSessionId: string): Promise<WatchLogDeletionTombstone | undefined>;
  record(input: WatchLogDeletionIdentity & {
    sourceLocalId: string;
    requestedAt: number;
  }): Promise<WatchLogDeletionTombstone>;
  acknowledge(localSessionId: string, acknowledgedAt: number): Promise<void>;
};
```

- [ ] **Step 1: Write failing store tests**

Cover merge-by-session, artifact evidence fallback, duplicate local IDs, ACK retention, malformed storage fail-closed, and concurrent mutation serialization.

```ts
it('keeps a permanent tombstone after Watch acknowledgement', async () => {
  const store = createWatchLogDeletionStore(storage);
  await store.record({
    localSessionId: 'watch-session-1',
    sourceLocalId: 'log-1',
    contentRevision: 'revision-1',
    artifactSha256: 'a'.repeat(64),
    requestedAt: 100,
  });
  await store.acknowledge('watch-session-1', 110);

  expect(await store.get('watch-session-1')).toMatchObject({
    localSessionId: 'watch-session-1',
    sourceLocalIds: ['log-1'],
    watchAcknowledgedAt: 110,
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
yarn workspace @repo/mobile test watch-log-deletion-store.test.ts --runInBand
```

Expected: FAIL because `watch-log-deletion-store` does not exist.

- [ ] **Step 3: Implement schema-validated serialized storage**

Use one JSON envelope under a device-wide storage key. Parse exact allowed keys, validate non-empty IDs and lowercase 64-character optional SHA, clone public results, serialize writes by storage key, and read back the just-written record before returning.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/deletion/watch-log-deletion-store.ts apps/mobile/__tests__/watch-log-deletion-store.test.ts apps/mobile/src/storage/storage-keys.ts
git commit -m "feat: persist watch log deletion tombstones"
```

### Task 2: Mobile deletion coordinator and import filtering

**Files:**
- Create: `apps/mobile/src/deletion/watch-log-deletion-coordinator.ts`
- Test: `apps/mobile/__tests__/watch-log-deletion-coordinator.test.ts`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Modify: `apps/mobile/src/states/use-dive-logbook-queries.ts`
- Modify: `apps/mobile/src/states/watch-connectivity-sync.tsx`
- Modify: `apps/mobile/src/native/watch-connectivity.ts`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Test: `apps/mobile/__tests__/account-data-state.test.tsx`
- Test: `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- Test: `apps/mobile/__tests__/watch-connectivity-native.test.ts`

**Interfaces:**
- Consumes: Task 1 tombstone store.
- Produces:

```ts
type WatchSessionDeletionCommand = {
  commandId: string;
  localSessionId: string;
  requestedAt: number;
  contentRevision?: string;
  artifactSha256?: string;
};

type WatchLogDeletionCoordinator = {
  delete(entry: DiveLogEntry): Promise<void>;
  reconcile(): Promise<void>;
  isDeleted(localSessionId: string): Promise<boolean>;
};
```

- Native bridge functions:

```ts
queueWatchSessionDeletion(command: WatchSessionDeletionCommand): Promise<void>;
listWatchSessionDeletionAcknowledgements(): Promise<Array<{
  commandId: string;
  localSessionId: string;
  acknowledgedAt: number;
}>>;
```

- [ ] **Step 1: Write failing deletion-order and visibility tests**

Prove tombstone write/readback precedes repository delete, manual logs use the existing path, repository failure leaves the Watch log hidden, duplicate deletion is idempotent, and an account-backed row queues the existing delete outbox.

```ts
it('persists the Watch tombstone before deleting the composed row', async () => {
  const calls: string[] = [];
  const coordinator = createWatchLogDeletionCoordinator(fixture({
    recordTombstone: async () => { calls.push('tombstone'); },
    deleteRow: async () => { calls.push('delete'); },
  }));

  await coordinator.delete(watchLog);

  expect(calls).toEqual(['tombstone', 'delete']);
});
```

- [ ] **Step 2: Run coordinator/account tests and verify RED**

```bash
yarn workspace @repo/mobile test watch-log-deletion-coordinator.test.ts account-data-state.test.tsx --runInBand
```

Expected: FAIL on missing coordinator/tombstone-aware repository behavior.

- [ ] **Step 3: Implement coordinator and composed-repository filtering**

Capture Watch identity from the selected entry, record the tombstone, enter the user claim mutation gate supplied in Task 3, delete through the current composed repository, queue the native command, and request account sync. Filter tombstoned sessions from composed `list/get` and keep manual delete unchanged.

- [ ] **Step 4: Write failing stale-import tests**

Test native descriptors and legacy inline payloads. A tombstoned descriptor must be consumed without calling profile preparation or repository import.

```ts
expect(preparePendingPayload).not.toHaveBeenCalled();
expect(repository.importWatchMessages).not.toHaveBeenCalled();
expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['payload-1']);
expect(queueDeletion).toHaveBeenCalledWith(
  expect.objectContaining({localSessionId: 'watch-session-1'}),
);
```

- [ ] **Step 5: Run import/native tests and verify RED**

```bash
yarn workspace @repo/mobile test watch-connectivity-sync.test.tsx watch-connectivity-native.test.ts --runInBand
```

Expected: FAIL because deleted sessions are still imported and native deletion methods are absent.

- [ ] **Step 6: Implement early import filtering and bridge types**

Check descriptor `localSessionId` before native preparation, check parsed legacy payload before repository mutation, enqueue the deletion command, acknowledge as imported/consumed, and exclude the item from `importedCount`. Add native method guards that are no-ops only on unsupported non-iOS runtimes; malformed native ACK data fails validation.

- [ ] **Step 7: Run all Task 2 tests and typecheck**

```bash
yarn workspace @repo/mobile test watch-log-deletion-coordinator.test.ts account-data-state.test.tsx watch-connectivity-sync.test.tsx watch-connectivity-native.test.ts --runInBand
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Commit all Task 2 files with:

```bash
git commit -m "feat: coordinate mobile watch log deletion"
```

### Task 3: Claim invalidation and Supabase abandonment

**Files:**
- Modify: `apps/mobile/src/claim/guest-claim-types.ts`
- Modify: `apps/mobile/src/claim/guest-claim-store.ts`
- Modify: `apps/mobile/src/claim/guest-claim-service.ts`
- Modify: `packages/supabase/src/account-data-types.ts`
- Modify: `packages/supabase/src/guest-claim-repository.ts`
- Modify: `packages/supabase/src/database.types.ts` through generation
- Create with `supabase migration new`: `supabase/migrations/*_abandon_deleted_guest_claim_logs.sql`
- Create: `supabase/functions/abandon-guest-claim/index.ts`
- Modify: `supabase/config.toml`
- Test: `apps/mobile/__tests__/guest-claim-service.test.ts`
- Test: `apps/mobile/__tests__/guest-claim-store.test.ts`
- Test: `packages/supabase/src/guest-claim-repository.test.ts`
- Test: `supabase/tests/database/guest_data_claim.test.sql`
- Create: `supabase/tests/functions/abandon-guest-claim.mjs`
- Create or modify: `supabase/scripts/guest-claim-hardening-migration.test.mjs`

**Interfaces:**
- Remote repository gains:

```ts
abandon(batchId: string): Promise<{
  status: 'abandoned' | 'committed';
  storageCleanupPending: boolean;
}>;
```

- Claim service receives:

```ts
isWatchSessionDeleted(localSessionId: string): Promise<boolean>;
withMutationGate<T>(operation: () => Promise<T>): Promise<T>;
```

- [ ] **Step 1: Add the exact 15-item resurrection regression test**

Construct a failed/finalizing snapshot with complete upload receipts, remove one Watch source from live guest storage, mark its session tombstoned, call retry, and assert:

```ts
expect(remote.abandon).toHaveBeenCalledWith(remoteBatchId);
expect(remote.finalize).not.toHaveBeenCalledWith(remoteBatchId);
expect(accountLogbook.get(deletedLocalId)).resolves.toBeUndefined();
```

Also cover no-remote-batch local discard and finalize/abandon returning committed, which must call account `saveLocalOnly` then account delete without visible publication.

- [ ] **Step 2: Run claim tests and verify RED**

```bash
yarn workspace @repo/mobile test guest-claim-service.test.ts guest-claim-store.test.ts --runInBand
```

Expected: FAIL because claim snapshots do not consult tombstones and the remote repository has no `abandon`.

- [ ] **Step 3: Implement user-scoped claim mutation gate and snapshot rebuild**

Reuse one keyed promise queue for claim run/delete reconciliation. Before finalize and before account-local publication, scan Watch snapshot items through `isWatchSessionDeleted`. Abandon the whole remote batch before deleting its local checkpoint; remove profile sidecars; rebuild only from live non-tombstoned rows. Treat `committed` as hidden account publication plus immediate delete outbox.

- [ ] **Step 4: Write remote repository and migration tests**

Verify parsing of `abandoned`, function invocation authorization errors, direct authenticated batch update denial, idempotent abandonment, committed race result, and abandoned-finalize rejection.

- [ ] **Step 5: Run repository/migration tests and verify RED**

```bash
yarn workspace @repo/supabase test guest-claim-repository.test.ts --runInBand
node --test supabase/scripts/guest-claim-hardening-migration.test.mjs
```

Expected: FAIL because schema/function support is missing.

- [ ] **Step 6: Create and implement the migration via Supabase CLI**

First inspect CLI:

```bash
yarn supabase migration new --help
```

Then create:

```bash
yarn supabase migration new abandon_deleted_guest_claim_logs
```

Implement the `abandoned` status/check constraints, `abandoned_at` invariant, private locked transition, service-role-only public wrapper, explicit revoke/grant, and finalizer rejection. Do not grant authenticated update/delete on claim batches.

- [ ] **Step 7: Implement the authenticated Edge Function**

Follow the current finalizer's JWT extraction. Validate `batchId`, resolve the current user, call the service-role wrapper with exact user/batch IDs, list staged profile paths from the locked batch, validate the owner/batch prefix, and call Storage remove. Return abandonment status even if cleanup remains pending.

- [ ] **Step 8: Generate Supabase types and run local gates**

```bash
yarn generate:supabase
yarn workspace @repo/supabase test --runInBand
node --test supabase/scripts/guest-claim-hardening-migration.test.mjs
yarn supabase:test:db
yarn supabase:lint:db
yarn supabase:advisors
```

Expected: PASS. If local Docker services are unavailable, start them through `yarn supabase:start` and rerun once.

- [ ] **Step 9: Run Task 3 mobile regressions and typecheck**

```bash
yarn workspace @repo/mobile test guest-claim-service.test.ts guest-claim-store.test.ts account-data-state.test.tsx --runInBand
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git commit -m "feat: abandon claims containing deleted watch logs"
```

### Task 4: Durable iPhone-to-Watch deletion protocol

**Files:**
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityModule.swift`
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m`
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityInbox.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncEnvelope.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Storage/DiveProfileArtifactStore.swift`
- Modify: `apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift`
- Modify: existing Swift test harness scripts under `apps/mobile/scripts/`
- Test: native boundary tests under `apps/mobile/__tests__/`

**Interfaces:**
- iPhone native persists request/ACK dictionaries matching Task 2.
- Watch transport adds:

```swift
var onSessionDeletionRequested: ((WatchSessionDeletionCommand) -> Void)? { get set }
func cancelTransfers(localSessionId: UUID)
func acknowledgeDeletion(_ result: WatchSessionDeletionResult)
```

- Artifact store adds:

```swift
func deleteSession(localSessionId: UUID) throws -> DeletedDiveSessionArtifact?
func resumePendingDeletions() throws
func isSessionDeleted(_ localSessionId: UUID) -> Bool
```

- [ ] **Step 1: Write failing native/source-boundary tests**

Assert request/ACK kind constants, UserDefaults persistence before transfer, duplicate-command dedupe, exact session-ID matching, transfer cancellation, manifest rewrite before ACK, artifact absence verification, and already-absent ACK.

- [ ] **Step 2: Run focused native tests and verify RED**

Run the repository's matching native boundary Jest/Node scripts plus:

```bash
yarn workspace @repo/mobile watch:ui:check
```

Expected: the new source assertions fail because deletion protocol code is absent.

- [ ] **Step 3: Implement iPhone durable command queue**

Persist pending commands and ACK receipts on the existing state queue. Queue via `transferUserInfo`, dedupe against `outstandingUserInfoTransfers`, retry on activation/reachability, validate Watch ACK, remove only the exact command, and expose queue/list methods through the React Native module.

- [ ] **Step 4: Implement Watch ledger and artifact removal**

Persist the session ID before mutation. Cancel transfers, remove manifest entries atomically, remove only the entry's resolved artifact beneath the artifact root, verify absence, update the observable session list, then ACK. On launch, resume incomplete ledger entries. Reject tombstoned IDs from migration/save.

- [ ] **Step 5: Run native tests, mobile typecheck, and builds**

```bash
yarn workspace @repo/mobile test watch-connectivity-native.test.ts --runInBand
yarn mobile:typecheck
yarn ios:build
yarn watch:build
```

Expected: PASS; simulator permission warnings are environmental only when exit code is zero.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: delete paired watch sessions from mobile"
```

### Task 5: Staging promotion and integrated regression

**Files:**
- Modify: `package.json`
- Modify: `supabase/scripts/verify-staging-guest-claim.mjs`
- Modify: `supabase/scripts/guest-claim-hardening-migration.test.mjs`
- Modify: any focused tests needed by failures found during integration

**Interfaces:**
- Adds a staging deploy script for `abandon-guest-claim`.

- [ ] **Step 1: Extend hosted verifier tests before script behavior**

Add disposable-user coverage for abandonment, stale finalizer rejection, fresh replacement batch commit, committed race response, cross-owner denial, exact Storage cleanup, and fixture cleanup.

- [ ] **Step 2: Run local verifier harness and verify RED**

```bash
node --test supabase/scripts/verify-staging-guest-claim.test.mjs
```

Expected: FAIL on missing abandonment verifier flow.

- [ ] **Step 3: Implement verifier and deploy script**

Keep project-ref guards exact. Never read mobile development credentials into local database commands.

- [ ] **Step 4: Run full pre-deployment gates**

```bash
node --test supabase/scripts/guest-claim-hardening-migration.test.mjs supabase/scripts/verify-staging-guest-claim.test.mjs
yarn check:quick
yarn mobile:typecheck
yarn workspace @repo/mobile test --runInBand
yarn ios:build
yarn watch:build
yarn codex:check
git diff --check
```

Expected: all pass with zero test failures and build exit code zero.

- [ ] **Step 5: Promote to staging only**

```bash
yarn supabase:staging:push:dry-run
yarn supabase:staging:push
yarn supabase:staging:deploy:guest-claim
yarn supabase:staging:deploy:abandon-guest-claim
yarn supabase:staging:verify:guest-claim
yarn supabase:staging:migrations
```

Expected: migration history matches local and hosted verifier passes. Production is not linked or modified.

- [ ] **Step 6: Commit**

```bash
git commit -m "test: verify deleted watch claim abandonment"
```

### Task 6: Physical-device gate, durable docs, review, and merge

**Files:**
- Create: `.wiki/raw/architecture/2026-07-30-mobile-authoritative-watch-log-deletion.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/architecture/mobile.md`
- Modify: `.wiki/wiki/architecture/watch-app.md`
- Modify: `.wiki/wiki/architecture/supabase.md`
- Modify: `.wiki/wiki/domains/dive-log.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

**Interfaces:** None; this task verifies and records the completed behavior.

- [ ] **Step 1: Stop and request connected iPhone/Watch**

Do not claim device behavior from simulator builds.

- [ ] **Step 2: Run the physical matrix**

Create/sync/delete an online Watch demo session; confirm immediate iPhone hide, remote soft-delete, Watch removal, and no restoration after both apps relaunch. Repeat with Watch offline, reconnect, and verify eventual Watch removal. Deliver a stale artifact for the deleted session and verify no mobile recreation. Exercise deletion from a noncommitted claim and verify old batch abandonment and corrected total.

- [ ] **Step 3: Capture durable implementation evidence and update wiki**

Preserve source material in `.wiki/raw/architecture/`, update the smallest affected compiled articles, refresh index dates, and append the Karpathy log entry.

- [ ] **Step 4: Run final feature-branch verification**

```bash
yarn check:quick
yarn mobile:typecheck
yarn workspace @repo/mobile test --runInBand
yarn ios:build
yarn watch:build
yarn codex:check
git diff --check
git status --short --branch
```

Expected: all gates pass and only intended tracked changes exist.

- [ ] **Step 5: Commit docs and request code review**

Commit with:

```bash
git commit -m "docs: record watch log deletion verification"
```

Review `main...HEAD` against the design and this plan. Fix every Critical/Important issue and rerun affected gates.

- [ ] **Step 6: Merge locally to main**

The user already selected local merge. From the main repository root:

```bash
git checkout main
git merge --no-ff feat/watch-log-deletion-propagation
```

Preserve the two pre-existing unrelated `.turbo/cache/*-manifest.json` modifications.

- [ ] **Step 7: Verify merged main**

Run the same Step 4 commands from main. Record the merge commit SHA and migration/function staging state.

- [ ] **Step 8: Clean the owned worktree and shut down**

From main, remove the `.worktrees/watch-log-deletion-propagation` worktree, prune registrations, and delete the merged feature branch. Then send the final handoff containing the merge SHA and verification evidence. The final system action is:

```bash
sudo shutdown -h now
```

Request privilege escalation for shutdown if required. Do not run shutdown before the final handoff data is prepared.
