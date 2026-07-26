# Device Claim Live Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 삭제된 device-only 데이터가 persisted claim snapshot에서 다시 `15`개로 나타나지 않게 하고, Settings와 claim sheet가 현재 guest inventory만 표시하며, claim 작업 중에도 sheet를 닫고 탭을 전환할 수 있게 한다.

**Architecture:** `guestRepositories`의 현재 row 수를 Settings와 자동 sheet routing의 단일 기준으로 사용한다. `GuestClaimSnapshot`은 transaction checkpoint로만 유지하며, remote progress가 없는 snapshot의 source membership이 현재 inventory와 다르면 retry 전에 폐기·재생성한다. Composed guest mutation은 inventory revision을 발행하고 provider가 claim presentation을 재계산한다.

**Tech Stack:** React Native 0.85.3, React 19.2.3, TypeScript 5.8, React Navigation 7, TanStack Query 5, Jest 29, React Test Renderer, gluestack-ui v4/NativeWind, i18next, Yarn 1.22.22

## Global Constraints

- Yarn 1만 사용하고 lockfile이나 dependency를 변경하지 않는다.
- Supabase schema, migration, RLS, Storage policy, Edge Function과 remote repository contract를 변경하지 않는다.
- 현재 guest Logbook/Planbook inventory만 `기기 데이터` count로 사용한다.
- Snapshot item/retained/failure total을 Settings device-data count fallback으로 사용하지 않는다.
- `remoteBatchId`가 있는 snapshot과 `running`, `finalizing`, `cleanupPending` checkpoint를 강제 삭제하지 않는다.
- Remote progress가 없는 stale snapshot은 삭제된 source payload를 retry로 업로드하지 않는다.
- 기존 immutable snapshot 뒤 변경된 row의 account promotion/outbox 규칙은 유지한다.
- Claim sheet dismissal은 claim Promise나 persistent checkpoint를 취소하지 않는다.
- 데이터가 `0`이면 Settings import row를 숨긴다.
- 기존 사용자 미커밋 watch/Xcode 변경을 수정하거나 branch에 포함하지 않는다.
- 구현은 테스트를 먼저 작성하고 예상한 이유로 실패하는 것을 확인한 뒤 production code를 변경한다.

---

### Task 1: Reject Stale Local-Only Claim Checkpoints

**Files:**
- Modify: `apps/mobile/src/claim/guest-claim-store.ts`
- Modify: `apps/mobile/src/claim/guest-claim-service.ts`
- Modify: `apps/mobile/__tests__/guest-claim-store.test.ts`
- Modify: `apps/mobile/__tests__/guest-claim-service.test.ts`

**Interfaces:**
- Produces: `guestRecordSetMatchesClaimSnapshot(options: {snapshot: GuestClaimSnapshot; logs: DiveLogEntry[]; plans: DivePlan[]}): boolean`
- Consumes: snapshot `manifest.items`, `retainedItems`, current guest repository lists
- Preserves: `retainedGuestRecordsMatchClaimSnapshot` exact digest comparison for terminal retained state

- [ ] **Step 1: Write failing source-membership tests**

Add unit coverage in `guest-claim-store.test.ts`:

```ts
expect(
  guestRecordSetMatchesClaimSnapshot({
    snapshot,
    logs: [diveLog('log-a')],
    plans: [],
  }),
).toBe(true);

expect(
  guestRecordSetMatchesClaimSnapshot({
    snapshot,
    logs: [],
    plans: [],
  }),
).toBe(false);

expect(
  guestRecordSetMatchesClaimSnapshot({
    snapshot,
    logs: [diveLog('log-a'), diveLog('log-b')],
    plans: [],
  }),
).toBe(false);
```

The helper compares the exact `entityKind:localId` set represented by both manifest items and retained items. It does not compare record content, so the existing immutable-snapshot-plus-changed-row-promotion contract remains intact.

- [ ] **Step 2: Write failing service regression tests**

Add to `guest-claim-service.test.ts`:

```ts
it('drops a deferred local-only snapshot after its guest sources are deleted', async () => {
  const guest = repositories([diveLog('log-a')], []);
  const store = new GuestClaimStore({storage: new InMemoryKeyValueStore(), userId});
  const remote = remoteRepository(store);
  const service = claimService({
    store,
    guest,
    account: repositories([], []),
    profile: profileStorage(),
    remote,
  });

  await service.defer();
  await guest.logbook.delete('log-a');

  await expect(service.retry()).resolves.toBeUndefined();
  await expect(store.read()).resolves.toBeUndefined();
  expect(remote.createOrLoadBatch).not.toHaveBeenCalled();
  expect(remote.stageRecord).not.toHaveBeenCalled();
  expect(remote.finalize).not.toHaveBeenCalled();
});
```

Add a second test that creates a `failed` snapshot with `remoteBatchId`, deletes the guest source, and expects `service.prepare()` to return the existing snapshot without calling `store.remove()`.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH \
/Users/hongseongbin/Projects/diving-app/node_modules/.bin/jest --runInBand \
  __tests__/guest-claim-store.test.ts \
  __tests__/guest-claim-service.test.ts
```

Working directory: `apps/mobile`

Expected: FAIL because `guestRecordSetMatchesClaimSnapshot` does not exist and `prepare()` reuses the deleted deferred snapshot.

- [ ] **Step 4: Implement exact source-set comparison**

In `guest-claim-store.ts`, build current and snapshot identity sets:

```ts
export function guestRecordSetMatchesClaimSnapshot(options: {
  snapshot: GuestClaimSnapshot;
  logs: DiveLogEntry[];
  plans: DivePlan[];
}): boolean {
  const current = new Set([
    ...options.logs.map(log => `log:${log.localId}`),
    ...options.plans.map(plan => `plan:${plan.localId}`),
  ]);
  const expected = new Set([
    ...options.snapshot.manifest.items.map(item => item.key),
    ...options.snapshot.retainedItems.map(
      item => `${item.entityKind}:${item.clientRecordId}`,
    ),
  ]);
  return (
    current.size === expected.size &&
    [...expected].every(key => current.has(key))
  );
}
```

Use item `key` only after strict snapshot parsing has already validated it equals its entity/local identity.

- [ ] **Step 5: Reconcile local-only snapshots in `prepare()`**

Refactor `GuestClaimService.prepare()`:

```ts
let existing = await this.readOwned();
if (
  existing !== undefined &&
  isReplaceableLocalCheckpoint(existing)
) {
  const [logs, plans] = await Promise.all([
    this.options.guestRepositories.logbook.list(),
    this.options.guestRepositories.planbook.list(),
  ]);
  if (
    !guestRecordSetMatchesClaimSnapshot({snapshot: existing, logs, plans})
  ) {
    if (!this.options.store.remove) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    await this.options.store.remove();
    existing = undefined;
  }
}
```

Define `isReplaceableLocalCheckpoint` as:

```ts
function isReplaceableLocalCheckpoint(snapshot: GuestClaimSnapshot): boolean {
  return (
    snapshot.manifest.remoteBatchId === undefined &&
    (snapshot.manifest.status === 'prepared' ||
      snapshot.manifest.status === 'deferred' ||
      snapshot.manifest.status === 'failed')
  );
}
```

Continue into `createFreshSnapshot()` when `existing` becomes `undefined`. Leave terminal `committed`/`retained` exact comparison and all remote-progress states unchanged.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 3.

Expected: both suites PASS, including the pre-existing test that an unchanged deferred snapshot uploads its immutable original and later promotes a changed guest row.

- [ ] **Step 7: Commit Task 1**

```bash
git add \
  apps/mobile/src/claim/guest-claim-store.ts \
  apps/mobile/src/claim/guest-claim-service.ts \
  apps/mobile/__tests__/guest-claim-store.test.ts \
  apps/mobile/__tests__/guest-claim-service.test.ts
git commit -m "fix: reject stale local claim checkpoints"
```

---

### Task 2: Refresh Live Inventory After Guest Mutations

**Files:**
- Modify: `apps/mobile/src/states/account-data.tsx`
- Modify: `apps/mobile/__tests__/account-data-state.test.tsx`

**Interfaces:**
- Extends internal `createComposedAccountRepositories` options with `onGuestInventoryChanged(): void`
- Produces provider-local `guestInventoryRevision: number`
- Consumes existing `refreshClaim(publication, {resumeActive: false})`

- [ ] **Step 1: Write the deletion-to-zero regression test**

In `account-data-state.test.tsx`, mount `AccountDataProviderCore` as an authenticated user with one guest log and capture both `data.logbookRepository` and `data.claim`.

```ts
await waitFor(() =>
  expect(capture?.claim.eligible).toEqual({logCount: 1, planCount: 0}),
);

await ReactTestRenderer.act(async () => {
  await capture!.logbookRepository.delete('guest-log');
  await flushPromises();
});

await waitFor(() => {
  expect(capture?.claim.eligible).toEqual({logCount: 0, planCount: 0});
  expect(capture?.claim.state).toEqual({status: 'hidden'});
});
```

Seed a deferred local-only snapshot for the same row before deletion and assert the state still becomes hidden after the live inventory reaches zero.

- [ ] **Step 2: Write save/delete routing coverage**

Add focused assertions that:

- saving an existing device-only guest row publishes one inventory revision;
- deleting a device-only guest log publishes a revision;
- deleting a device-only guest plan publishes a revision;
- account-owned save/delete does not publish a guest inventory revision.

Exercise behavior through the provider and resulting claim count rather than exporting the callback.

- [ ] **Step 3: Run the account-data suite and verify RED**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH \
/Users/hongseongbin/Projects/diving-app/node_modules/.bin/jest --runInBand \
  __tests__/account-data-state.test.tsx
```

Working directory: `apps/mobile`

Expected: FAIL because composed repository mutations only invalidate React Query and never refresh claim eligibility.

- [ ] **Step 4: Publish guest inventory revisions**

Add provider state and a stable notifier:

```ts
const [guestInventoryRevision, setGuestInventoryRevision] = React.useState(0);
const notifyGuestInventoryChanged = React.useCallback(() => {
  setGuestInventoryRevision(value => value + 1);
}, []);
```

Pass the notifier into `createComposedAccountRepositories`.

For each composed method that actually routes to `guestRepositories`, await the guest operation, call `onGuestInventoryChanged()`, then return the original result. Cover logbook `save`, `delete`, `deleteIf`, optional `saveLocalOnly`, and planbook equivalents. Account-routed operations must not notify.

- [ ] **Step 5: Refresh claim presentation without auto-resume**

Add an effect that ignores initial revision `0`, validates the current publication/generation through the existing `refreshClaim` guards, and invokes:

```ts
void refreshClaim(published, {resumeActive: false}).catch(error => {
  if (publishedRef.current === published) {
    console.warn('Failed to refresh guest inventory after mutation', error);
  }
});
```

Do not call `resume()` from a mutation refresh. Do not replace the existing initial/auth/AppState refresh effects.

- [ ] **Step 6: Run the account-data suite and verify GREEN**

Run the command from Step 3.

Expected: PASS with deletion changing eligible `1 → 0` and the presentation becoming hidden.

- [ ] **Step 7: Commit Task 2**

```bash
git add \
  apps/mobile/src/states/account-data.tsx \
  apps/mobile/__tests__/account-data-state.test.tsx
git commit -m "fix: refresh device inventory after mutations"
```

---

### Task 3: Make Settings and Claim Sheet Use Live Inventory

**Files:**
- Modify: `apps/mobile/src/screens/settings/screen.tsx`
- Modify: `apps/mobile/src/screens/account-claim/screen.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: `apps/mobile/__tests__/settings-screen.test.tsx`
- Modify: `apps/mobile/__tests__/account-claim-screen.test.tsx`
- Modify: `apps/mobile/__tests__/i18n.test.ts`

**Interfaces:**
- Settings consumes only `accountClaim.eligible`
- Claim sheet consumes existing `claim.refresh()` and `claim.keepOnDevice()`
- Adds translation key `accountClaim.closeAction`: Korean `닫기`, English `Close`

- [ ] **Step 1: Write Settings live-count tests**

Replace snapshot-total expectations with:

```ts
it.each([
  {status: 'deferred', logCount: 0, planCount: 0},
  {status: 'failed', completed: 0, total: 15, errorCode: 'claim_validation_failed'},
  {status: 'retained', retainedItems: retainedItems(15)},
])('hides import when live inventory is empty', async state => {
  // authenticated, eligible {logCount: 0, planCount: 0}
  expect(
    renderer.root.findAllByProps({testID: 'settings-row-account-claim'}),
  ).toHaveLength(0);
});
```

Add a case with `eligible = {logCount: 1, planCount: 0}` and failed `total: 15`; expect the row value to be `1`, not `15`.

- [ ] **Step 2: Write sheet dismissal tests**

Update `account-claim-screen.test.tsx` to assert:

- `claim.refresh()` is called once for `choice`, `deferred`, `failed`, and `hidden` initial states;
- rerendering with `eligible = {logCount: 0, planCount: 0}` and hidden state calls `goBack`;
- `usePreventRemove` is never required by the screen;
- a pending `claim.start()` still allows `account-claim-close` to call `goBack`;
- `account-claim-keep` calls `goBack` before a pending `keepOnDevice()` resolves.

Use the existing `deferred<void>()` helper to prove navigation does not wait for persistence.

- [ ] **Step 3: Run Settings, sheet, and i18n tests and verify RED**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH \
/Users/hongseongbin/Projects/diving-app/node_modules/.bin/jest --runInBand \
  __tests__/settings-screen.test.tsx \
  __tests__/account-claim-screen.test.tsx \
  __tests__/i18n.test.ts
```

Working directory: `apps/mobile`

Expected: FAIL because Settings uses retained/failed totals, refresh only runs for hidden state, removal is prevented while busy, and there is no close action.

- [ ] **Step 4: Simplify Settings visibility and value**

Replace snapshot-derived count logic with:

```ts
const eligibleAccountClaimCount =
  (accountClaim?.eligible.logCount ?? 0) +
  (accountClaim?.eligible.planCount ?? 0);
const showsAccountClaimRow = Boolean(
  (auth.state.status === 'authenticated' ||
    auth.state.status === 'authenticatedOffline') &&
    accountClaim &&
    eligibleAccountClaimCount > 0 &&
    onOpenAccountClaim,
);
```

Pass `` `${eligibleAccountClaimCount}` `` as the row value. Remove `settingsRetainedCount` if no remaining caller or test uses it.

- [ ] **Step 5: Detach sheet dismissal from claim lifecycle**

In `AccountClaimScreen`:

- remove the `usePreventRemove` import and call;
- call `claim.refresh()` once on mount for every initial state;
- close the route when the latest controller has eligible total `0`, state is `hidden`, and no action is starting;
- for `keep`, call `navigation.goBack()` before starting `claim.keepOnDevice()`;
- expose `navigation.goBack()` as `onClose` in preparing and running content;
- keep import/retry/recheck buttons single-flight through `busyAction`;
- do not cancel or replace provider claim operations when closing.

Add a link-style `account-claim-close` button under `PreparingContent` and `ProgressContent`, using `accountClaim.closeAction`.

- [ ] **Step 6: Run Settings, sheet, and i18n tests and verify GREEN**

Run the command from Step 3.

Expected: all selected suites PASS.

- [ ] **Step 7: Run navigation and combined claim regression suites**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH \
/Users/hongseongbin/Projects/diving-app/node_modules/.bin/jest --runInBand \
  __tests__/navigation.test.ts \
  __tests__/guest-claim-store.test.ts \
  __tests__/guest-claim-service.test.ts \
  __tests__/account-data-state.test.tsx \
  __tests__/account-claim-screen.test.tsx \
  __tests__/settings-screen.test.tsx \
  __tests__/i18n.test.ts
```

Expected: all selected suites PASS and auto-route remains gated by live eligible count.

- [ ] **Step 8: Commit Task 3**

```bash
git add \
  apps/mobile/src/screens/settings/screen.tsx \
  apps/mobile/src/screens/account-claim/screen.tsx \
  apps/mobile/src/i18n/resources.ts \
  apps/mobile/__tests__/settings-screen.test.tsx \
  apps/mobile/__tests__/account-claim-screen.test.tsx \
  apps/mobile/__tests__/i18n.test.ts
git commit -m "fix: detach claim sheet from stale snapshot state"
```

---

### Task 4: Record the Durable Claim Boundary and Verify the App

**Files:**
- Create: `.wiki/raw/architecture/2026-07-26-device-claim-live-inventory.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

**Interfaces:**
- Consumes: accepted design spec and verified implementation commits
- Produces: durable documentation for live inventory versus transaction checkpoint semantics

- [ ] **Step 1: Capture immutable implementation evidence**

Create `.wiki/raw/architecture/2026-07-26-device-claim-live-inventory.md` using the repository raw template. Include:

- Source: accepted design and implementation paths
- Collected: `2026-07-26`
- Published: `2026-07-26`
- original concise evidence describing the reproduced stale `0 → 15` transition, source code cause, chosen B boundary, tests, and verification commands

Do not modify an existing raw file.

- [ ] **Step 2: Update compiled sync knowledge**

Update `.wiki/wiki/architecture/sync-flow.md`:

- add the new raw source to `Sources` and `Raw`;
- set `Updated: 2026-07-26`;
- state that current guest repository inventory is the only device-data count;
- state that claim snapshot totals are checkpoint diagnostics, not Settings inventory;
- document local-only stale source-set invalidation and remote-progress preservation;
- document that the native sheet can close while provider-owned claim work continues.

Update the `sync-flow.md` row in `.wiki/wiki/index.md` with date `2026-07-26` and a summary mentioning live inventory/checkpoint separation. Append:

```md
## [2026-07-26] ingest | Device claim live inventory
- Updated: 동기화 흐름 구조
```

to `.wiki/wiki/log.md`.

- [ ] **Step 3: Run formatting and type verification**

Run:

```bash
git diff --check
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH yarn mobile:typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 4: Run the full mobile Jest suite**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH \
/Users/hongseongbin/Projects/diving-app/node_modules/.bin/jest --runInBand
```

Working directory: `apps/mobile`

Expected: all suites and tests PASS with `0` failures.

- [ ] **Step 5: Run iOS and repository gates**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH yarn ios:build
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH yarn codex:check
```

Expected: both commands exit `0`. Environment-only Yarn cache/global-folder or CoreSimulator permission warnings are acceptable only when the command exit code is `0`.

- [ ] **Step 6: Review the final diff against the accepted spec**

Verify:

- no Supabase migration/Edge Function/native Watch file changed;
- no snapshot total is used as Settings device-data count;
- deleted local-only source set cannot be uploaded by retry;
- remote-progress checkpoint behavior remains covered;
- sheet dismissal leaves provider work running;
- no user dirty main-worktree file appears in the branch diff.

- [ ] **Step 7: Commit Task 4**

```bash
git add \
  .wiki/raw/architecture/2026-07-26-device-claim-live-inventory.md \
  .wiki/wiki/architecture/sync-flow.md \
  .wiki/wiki/index.md \
  .wiki/wiki/log.md
git commit -m "docs: record live claim inventory boundary"
```

- [ ] **Step 8: Request final code review**

Provide the reviewer:

- requirements: `docs/superpowers/specs/2026-07-26-device-claim-live-inventory-design.md`
- plan: `docs/superpowers/plans/2026-07-26-device-claim-live-inventory.md`
- base: `0ac977f`
- head: current feature branch HEAD

Fix every Critical or Important finding, rerun the affected focused tests, `yarn mobile:typecheck`, full mobile Jest, `yarn ios:build`, and `yarn codex:check` before merge.

---

## Plan Self-Review

- Every accepted spec requirement maps to a task: stale snapshot protection (Task 1), mutation refresh (Task 2), Settings/sheet behavior (Task 3), durable documentation and full gates (Task 4).
- Snapshot freshness compares source membership, not row bytes, so the existing immutable snapshot and changed-row promotion contract is not contradicted.
- Remote-progress snapshots are preserved; remote cancellation and OS background execution remain explicit non-goals.
- All production changes have a preceding RED test and a focused GREEN command.
- No placeholder, future implementation note, dependency addition, Supabase change, or Watch native change is included.
