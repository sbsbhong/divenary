# Guest Claim Profile Quarantine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정상 guest 항목은 계정으로 가져오고 검증할 수 없는 watch profile 항목은 원본 그대로 기기에 보류해 `0 / N` 결정적 실패 반복을 제거한다.

**Architecture:** Local snapshot preparation이 claimable items와 retained items를 함께 생성한다. Remote manifest와 cleanup에는 claimable items만 포함하며, retained metadata는 user-scoped local sidecar에 저장한다. Account state와 form sheet는 partial-complete/retained terminal state를 표현하고 명시적인 recheck만 새 preflight를 수행한다.

**Tech Stack:** TypeScript, React Native 0.85.3, React 19, Jest, react-i18next, AsyncStorage-compatible persistent store, existing Supabase guest-claim repository.

## Global Constraints

- Guest record와 profile bytes를 수정, 축약, 재작성, 삭제하지 않는다.
- Remote expected counts와 upload progress에는 claimable items만 포함한다.
- `profile_missing`/`profile_corrupt`만 item-level retention으로 완화하고 malformed manifest, principal mismatch, invalid relationship은 hard failure로 유지한다.
- 관계가 있는 plan/log는 절반만 claim하지 않는다.
- Unchanged retained-only 상태는 자동 retry 또는 로그인 직후 sheet 표시를 유발하지 않는다.
- Supabase schema/RLS/Edge Function, watchOS contract와 dependency는 변경하지 않는다.
- Korean/English copy는 `apps/mobile/src/i18n/resources.ts`의 기존 inline resource 구조를 사용한다.

---

### Task 1: Persist claimable and retained snapshot sets

**Files:**
- Modify: `apps/mobile/src/claim/guest-claim-types.ts`
- Modify: `apps/mobile/src/claim/guest-claim-store.ts`
- Test: `apps/mobile/__tests__/guest-claim-store.test.ts`

**Interfaces:**
- Produces: `GuestClaimRetainedReason`, `GuestClaimRetainedItem`, `GuestClaimSnapshot.retainedItems`.
- Produces: manifest local terminal status `retained`.
- Preserves: existing remote manifest digest and `GuestClaimSnapshot` schema version 1 compatibility.

- [ ] **Step 1: Write failing snapshot classification tests**

Add tests that build two manual logs plus one watch log whose referenced profile is absent, then assert:

```ts
expect(snapshot.manifest.items.map(item => item.key)).toEqual([
  'log:manual-a',
  'log:manual-b',
]);
expect(snapshot.retainedItems).toEqual([
  expect.objectContaining({
    entityKind: 'log',
    clientRecordId: 'watch-a',
    reason: 'profile_missing',
  }),
]);
```

Add cases for corrupt profile verification, a converted plan linked to a retained log, invalid relationship hard failure, all-retained `manifest.status === 'retained'`, and parsing a legacy snapshot without `retainedItems` as an empty list.

- [ ] **Step 2: Run the focused store test and verify RED**

Run: `yarn workspace @repo/mobile test --runInBand __tests__/guest-claim-store.test.ts`

Expected: FAIL because retained types/state and classification do not exist.

- [ ] **Step 3: Add retained types and deterministic parsers**

Define:

```ts
export type GuestClaimRetainedReason =
  | 'profile_missing'
  | 'profile_corrupt'
  | 'related_item_retained';

export type GuestClaimRetainedItem = {
  entityKind: 'plan' | 'log';
  clientRecordId: string;
  localRecordSha256: string;
  label?: string;
  reason: GuestClaimRetainedReason;
  relatedClientRecordId?: string;
};
```

Add `retained` to local manifest status and `retainedItems` to the sidecar. Update strict parsing to accept the optional stored key, normalize absent legacy values to `[]`, validate bounded strings/digests/reasons, reject duplicate or claimable-overlapping keys, and require `retained` snapshots to have zero manifest items, at least one retained item, and no remote batch.

- [ ] **Step 4: Partition profile failures before manifest construction**

Keep `validateRelationships()` as a fail-closed first step. Prepare every log and catch only `GuestClaimProfileError` codes `profile_missing`/`profile_corrupt`; convert them to retained log entries. Add a fixed relationship closure that marks each plan whose `convertedLogLocalId` is retained as `related_item_retained`. Build plan-first `items`/`snapshots` only from the remaining set and calculate plan/log counts from that set.

- [ ] **Step 5: Run store tests and typecheck**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/guest-claim-store.test.ts
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the snapshot boundary**

```bash
git add apps/mobile/src/claim/guest-claim-types.ts apps/mobile/src/claim/guest-claim-store.ts apps/mobile/__tests__/guest-claim-store.test.ts
git commit -m "fix: quarantine unverifiable guest claim profiles"
```

### Task 2: Make retained claim lifecycle terminal and explicitly recheckable

**Files:**
- Modify: `apps/mobile/src/claim/guest-claim-store.ts`
- Modify: `apps/mobile/src/claim/guest-claim-service.ts`
- Test: `apps/mobile/__tests__/guest-claim-service.test.ts`

**Interfaces:**
- Consumes: `GuestClaimSnapshot.retainedItems` and status `retained`.
- Produces: `GuestClaimService.recheckRetained(): Promise<GuestClaimSnapshot | undefined>`.
- Produces: exact retained-source matching helper used to suppress automatic loops.

- [ ] **Step 1: Write failing service lifecycle tests**

Cover these cases:

```ts
expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(1); // valid subset
expect(remote.stageRecord).toHaveBeenCalledTimes(13);
await expect(guest.logbook.get('broken-log')).resolves.toBeDefined();
```

Also assert all-retained calls create/stage/finalize zero times, unchanged terminal snapshot survives `prepare()` without a new profile read, a changed source replaces the terminal snapshot, and `recheckRetained()` imports an item after its profile is restored.

- [ ] **Step 2: Run the focused service test and verify RED**

Run: `yarn workspace @repo/mobile test --runInBand __tests__/guest-claim-service.test.ts`

Expected: FAIL because terminal retention and explicit recheck are not implemented.

- [ ] **Step 3: Add exact retained-source matching**

Export a helper from the store that compares current guest records against retained `entityKind`, `clientRecordId`, and canonical `localRecordSha256`. It returns true only when the current guest set exactly equals the retained set after committed claimable items have been cleaned up.

- [ ] **Step 4: Update prepare/start/resume behavior**

Implement these transitions:

```ts
if (terminalSnapshotStillMatchesGuest) return existing;
if (snapshot.manifest.status === 'retained') return snapshot;
if (snapshot.manifest.items.length === 0) return snapshot;
```

Persist retained-only snapshots before returning. Do not call the remote repository for them. Keep transient failed batches and `cleanupPending` behavior unchanged.

- [ ] **Step 5: Add explicit recheck**

`recheckRetained()` must be single-flight, require a terminal snapshot with retained items, remove only the user-scoped claim sidecar, rebuild from current guest data, persist it, and run a remote claim only when the rebuilt snapshot has claimable items. It must never delete guest rows merely to clear retention state.

- [ ] **Step 6: Run service/store tests and typecheck**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/guest-claim-service.test.ts __tests__/guest-claim-store.test.ts
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit lifecycle behavior**

```bash
git add apps/mobile/src/claim/guest-claim-store.ts apps/mobile/src/claim/guest-claim-service.ts apps/mobile/__tests__/guest-claim-service.test.ts
git commit -m "fix: make retained guest claims explicitly recheckable"
```

### Task 3: Publish partial-complete and retained account states

**Files:**
- Modify: `apps/mobile/src/claim/guest-claim-types.ts`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Test: `apps/mobile/__tests__/account-data-state.test.tsx`

**Interfaces:**
- Produces: `GuestClaimViewState` variants `retained` and extended `complete`.
- Produces: `AccountClaimController.recheckRetained()`.

- [ ] **Step 1: Write failing provider/presentation tests**

Assert mappings:

```ts
{ status: 'committed', retainedItems: [broken] }
// => { status: 'complete', imported: 13, retainedItems: [broken] }

{ status: 'retained', retainedItems: [broken] }
// => { status: 'retained', retainedItems: [broken] }
```

Verify foreground resume does not call `resume()` for retained state, controller recheck delegates once, and partial completion still invalidates account queries while retained guest rows remain visible.

- [ ] **Step 2: Run the focused state test and verify RED**

Run: `yarn workspace @repo/mobile test --runInBand __tests__/account-data-state.test.tsx`

Expected: FAIL on missing view states/controller method.

- [ ] **Step 3: Extend view/controller state**

Use:

```ts
| { status: 'retained'; retainedItems: GuestClaimRetainedItem[] }
| {
    status: 'complete';
    imported: number;
    retainedItems: GuestClaimRetainedItem[];
  }
```

Map the snapshot statuses in `presentationForSnapshot()`. Add `recheckRetained` to live and hidden controllers and route it through the same generation/principal guards as start/retry/defer.

- [ ] **Step 4: Preserve automatic-resume boundaries**

Do not add `retained` or committed-with-retained to transient resume. Continue cleanup resume only when imported snapshot ids are still hidden. Keep auto-route restricted to `choice`, so retained-only state never opens at login.

- [ ] **Step 5: Run state/service tests and typecheck**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/account-data-state.test.tsx __tests__/guest-claim-service.test.ts
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit account state behavior**

```bash
git add apps/mobile/src/claim/guest-claim-types.ts apps/mobile/src/states/account-data.tsx apps/mobile/__tests__/account-data-state.test.tsx
git commit -m "fix: expose retained guest claim results"
```

### Task 4: Render non-looping Apple-style recovery results

**Files:**
- Modify: `apps/mobile/src/screens/account-claim/screen.tsx`
- Modify: `apps/mobile/src/screens/settings/screen.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Test: `apps/mobile/__tests__/account-claim-screen.test.tsx`
- Test: `apps/mobile/__tests__/settings-screen.test.tsx`
- Test: `apps/mobile/__tests__/navigation.test.ts`
- Test: `apps/mobile/__tests__/i18n.test.ts`

**Interfaces:**
- Consumes: partial `complete`, `retained`, and `recheckRetained()`.
- Preserves: existing semantic colors, form-sheet background, safe-area coverage, depth-trace progress, and `useTranslation()` resource lookup.

- [ ] **Step 1: Write failing result and Settings tests**

Test partial copy/counts, retained reason copy, `완료` close action, `다시 검사` delegation, no generic `0 / N` failure, VoiceOver announcement containing imported and retained counts, and Settings value `확인 필요 1`. Verify navigation auto-route still returns undefined for `retained` and `complete`.

- [ ] **Step 2: Run focused UI/i18n tests and verify RED**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/account-claim-screen.test.tsx __tests__/settings-screen.test.tsx __tests__/navigation.test.ts __tests__/i18n.test.ts
```

Expected: FAIL on missing terminal result UI and copy.

- [ ] **Step 3: Implement result content**

Add focused `CompleteContent` and `RetainedContent` components using existing `VStack`, `Text`, `Button`, and semantic classes. Full success may keep automatic accessible dismissal; partial completion remains visible until `완료`. Retained-only primary action closes and its secondary `다시 검사` calls `claim.recheckRetained()`.

- [ ] **Step 4: Add localized Korean and English resources**

Add keys for partial title/summary, retained notice/title/description, retained reasons, done, recheck, and Settings retained count. Use plain interpolation via `t()`; do not add `Trans` because no embedded component is needed.

- [ ] **Step 5: Update Settings and recovery affordances**

Show the row for `retained` and partial `complete`, and render `확인 필요 {{count}}` rather than a bare eligible total. Keep the home recovery banner quiet for terminal retained data and keep login auto-navigation restricted to `choice`.

- [ ] **Step 6: Run focused UI tests and typecheck**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/account-claim-screen.test.tsx __tests__/settings-screen.test.tsx __tests__/navigation.test.ts __tests__/i18n.test.ts
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the recovery UI**

```bash
git add apps/mobile/src/screens/account-claim/screen.tsx apps/mobile/src/screens/settings/screen.tsx apps/mobile/src/components/navigation/index.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__/account-claim-screen.test.tsx apps/mobile/__tests__/settings-screen.test.tsx apps/mobile/__tests__/navigation.test.ts apps/mobile/__tests__/i18n.test.ts
git commit -m "fix: show retained guest claim results"
```

### Task 5: Record durable sync behavior and run full verification

**Files:**
- Create: `.wiki/raw/architecture/2026-07-22-guest-claim-profile-quarantine.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/architecture/mobile.md`
- Modify: `.wiki/wiki/domains/dive-log.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

**Interfaces:**
- Documents: retained local sidecar, valid-subset remote claim, exact cleanup exclusion, explicit recheck, and physical-device evidence gap.

- [ ] **Step 1: Capture the accepted design as immutable raw source**

Use the Karpathy raw metadata header with source path `docs/superpowers/specs/2026-07-22-guest-claim-profile-quarantine-design.md`, collected/published date `2026-07-22`, then summarize the accepted decision without copying temporary debugging output or secrets.

- [ ] **Step 2: Update the smallest durable article set**

Update `sync-flow.md` with valid/retained partition and remote-count semantics, `mobile.md` with terminal recheck UI state, and `dive-log.md` with retained guest ownership/cleanup behavior. Refresh Updated dates and index summaries, then append:

```md
## [2026-07-22] ingest | Guest claim profile quarantine
- Updated: 모바일 구조
- Updated: 다이브 로그 도메인
```

- [ ] **Step 3: Run focused and full mobile verification**

Run:

```bash
yarn workspace @repo/mobile test --runInBand __tests__/guest-claim-store.test.ts __tests__/guest-claim-service.test.ts __tests__/account-data-state.test.tsx __tests__/account-claim-screen.test.tsx __tests__/settings-screen.test.tsx __tests__/navigation.test.ts __tests__/i18n.test.ts
yarn workspace @repo/mobile test --runInBand
yarn mobile:typecheck
yarn ios:build
yarn supabase:staging:verify:guest-claim
yarn codex:check
```

Expected: all commands PASS. Environment-only cache/CoreSimulator warnings are allowed only when the command exits successfully.

- [ ] **Step 4: Review diff and commit documentation**

Run `git diff --check`, inspect `git status --short`, and confirm no Supabase schema, generated contract, watchOS, lockfile, or unrelated user file changed.

```bash
git add .wiki/raw/architecture/2026-07-22-guest-claim-profile-quarantine.md .wiki/wiki/architecture/sync-flow.md .wiki/wiki/architecture/mobile.md .wiki/wiki/domains/dive-log.md .wiki/wiki/index.md .wiki/wiki/log.md
git commit -m "docs: record guest claim profile quarantine"
```

- [ ] **Step 5: Complete and integrate the branch**

Use `requesting-code-review`, `verification-before-completion`, and `finishing-a-development-branch`. After all gates pass, merge `fix/guest-claim-profile-quarantine` into `main` without overwriting the user's existing dirty watchOS/Xcode changes. Confirm `main` contains the branch commits and preserves the pre-existing dirty paths.

## Plan Self-Review

- Spec coverage: retained classification, relationship closure, remote exclusion, terminal persistence, explicit recheck, partial UI, Settings, localization, wiki, verification, and safe integration all have tasks.
- Placeholder scan: no TBD/TODO/“implement later” steps.
- Type consistency: `GuestClaimRetainedItem`, `retainedItems`, status `retained`, and `recheckRetained()` names are identical across tasks.
- Scope: no Supabase schema, watchOS, dependency, generated contract, or unrelated UI change.
- Safety: only exact claimable items are cleaned up; retained guest data and profile artifacts remain untouched.
