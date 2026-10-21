# Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every non-device-dependent issue from the 2026-10-21 project review: watch dive-loss and stale-sensor paths, irreversible mobile actions without confirmation, auth/principal leaks, silent watch payload drops, terminal sync conflicts, watch accuracy bugs, UI/UX gaps, and red verification gates.

**Architecture:** Keep every existing boundary (contracts schema unchanged, principal partitions, tombstones, claim ordering). Fixes stay inside the owning layer: watch runtime/recorder in Swift, auth/sync in `apps/mobile/src/states|sync|auth`, remote mapping in `packages/supabase`. Spec: `docs/superpowers/specs/2026-10-21-review-remediation-design.md`.

**Tech Stack:** SwiftUI/XCTest (watchOS), React Native 0.85 + Jest + react-test-renderer, TypeScript, supabase-js, Node test runner, Xcode string catalog.

## Global Constraints

- Work only in worktree `.worktrees/review-remediation` on branch `fix/review-remediation`; never touch the user's main checkout WIP (`HomeView.swift` 64→32, `Localizable.xcstrings`).
- Do not change `packages/contracts/schemas/*` in this plan (version-skew risk with strict mobile validation).
- Do not change bundle IDs, signing, entitlements, or provisioning.
- No Supabase migrations deployed; staging commands are out of scope.
- Safety copy stays within review / reminder / non-certified wording; recommended safety stop never uses `danger` styling.
- Every behavior change starts with a failing test (Jest or XCTest); source-string tests are updated only to reflect approved behavior.
- Commit only after the user approves committing.

---

## Phase 1 — Verification baseline

### Task 1.1: Repair stale tests
- Files: `apps/mobile/__tests__/ios-auth-configuration.test.ts`, `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
- [x] Watch configurations may reference only `DivenaryWatchApp/DivenaryWatchApp.entitlements`; that file contains only `com.apple.developer.submerged-shallow-depth-and-pressure` and never `com.apple.developer.applesignin`.
- [x] For each of the 13 failing source-contract tests, compare against the 9/01–9/02 specs and current source; update assertions to the approved behavior (no production change).
- [x] `yarn workspace @repo/mobile test` → 0 failures.

### Task 1.2: Lint to zero errors
- Files: unused vendored dirs under `apps/mobile/src/components/ui/` (delete only if never imported), `src/screens/common/form/badge-list-field.tsx`, `src/storage/persistent-json-store.ts`, `src/states/account-data.tsx`, `__tests__/home-conditions-controller.test.tsx`
- [x] `rg` each vendored component import before deleting (deleted tabs, bottomsheet, popover, accordion, image-viewer; kept calendar for the web date picker).
- [x] `yarn workspace @repo/mobile lint` → 0 errors (`ignoreRestSiblings` + `^_` pattern for the omit-by-destructuring idiom).

### Task 1.3: Gates and CI
- Files: `package.json`, `.github/workflows/ci.yml`, `AGENTS.md` (verification section)
- [x] `codex:check` = `check:quick && mobile:typecheck && mobile test && mobile lint && watch:ui:check && supabase test && watch:build`.
- [x] CI on ubuntu: install (frozen lockfile), typecheck, jest, lint, supabase test.
- [ ] AGENTS.md verification section (Phase 9).

## Phase 2 — Watch P0

### Task 2.1: Consecutive dives are never ignored
- Files: `Runtime/RealDiveSessionCoordinator.swift`, `DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift`
- [x] Failing tests: adoption / Action Button start while `savedSummary`, `noSamples`, `startPersistenceError` → recorder starts, phase `.recording`.
- [x] Failing test: `savePersistenceError` + adoption → retries save; on second failure releases recorder without clearing journal and starts the new session.
- [x] Failing test: `.submerged` while `savedSummary` → `.wetReady`.
- [x] Implement `prepareForNewSession()` used by every start path.

### Task 2.2: Live depth signal status
- Files: `Sensors/DepthSensorProvider.swift`, `Sensors/RealDepthSensorProvider.swift`, `Sensors/MockDepthSensorProvider.swift`, `Sensors/DemoDepthSensorProvider.swift`, `Sensors/WaterSubmersionCoordinator.swift`, `Recording/DiveSessionRecorder.swift`, `Views/RecordingView.swift`, `Localizable.xcstrings`, tests in `DiveSessionRecorderAscentRateTests.swift` / new `LiveDepthSignalTests.swift`, `WaterSubmersionCoordinatorTests.swift`
- [x] Coordinator forwards depth state (`onDepthState`) and errors; the real provider reports `DepthSensorCondition` through the separate `DepthSensorConditionReporting` protocol (demo/mock providers unchanged).
- [x] Recorder publishes `liveDepthSignal` (`awaitingFirstSample`, `live`, `stale`, `sensorError`, `beyondSensorRange`); stale after 5 s without a valid sample (checked on the 1 Hz timer). Samples with depth values are never dropped (40 m preservation rule).
- [x] Sessions record `unsupportedDepth(limitMeters: sensorLimit)` when beyond range occurred; scuba safety stop becomes `unknown` when beyond range or a sample gap > 30 s occurred.
- [x] `RecordingView` shows `--` depth/ascent and a muted status line when not `live` ("At surface" when the water state is not submerged); also caution-tone "Recommended stop", persistent Demo/Test marker, restored non-certified disclaimer line.

## Phase 3 — Mobile destructive actions

### Task 3.1: Delete confirmation
- Files: `src/screens/logbook/log-entry-detail.tsx`, `src/screens/planning/plan-detail.tsx`, `src/i18n/resources.ts`, tests in `__tests__/logbook-manual-entry.test.tsx`, `__tests__/planning-screen.test.tsx`
- [x] Failing tests: pressing delete calls `Alert.alert` with destructive button; `onDelete` only runs on confirm; watch-imported / account-synced logs say what else is removed.

### Task 3.2: Unsaved-changes guard and scroll-to-error in routed editors
- Files: `src/components/navigation/index.tsx`, `src/screens/logbook/log-entry-editor.tsx`, `src/screens/planning/plan-editor.tsx`, i18n, tests
- [x] Editors report dirty state; routed screens use `usePreventRemove(isDirty)` with discard Alert; Cancel uses the same guard; save navigation bypasses it.
- [x] Routed editors pass `onFieldLayout`/`onInvalidSubmit` to the routed scroll view.

## Phase 4 — Auth and principal

### Task 4.1: Auth event semantics
- Files: `packages/supabase/src/auth-repository.ts` (+ test), `apps/mobile/src/states/auth.tsx`, `__tests__/auth-state.test.tsx`
- [x] `subscribe` passes `(session, event)`; only `SIGNED_OUT` closes the session; a null session with any other event is left to revalidation.
- [x] ~~5xx during restore → offline membership path.~~ Dropped: the 2026-07-13 design and its test deliberately fail closed on generic server errors.
- [x] `signOut` failure → remove persisted session from the Keychain.

### Task 4.2: Gate watch import and plan push on settled auth
- Files: `src/states/watch-connectivity-sync.tsx`, `src/states/use-dive-plans.ts`, `src/states/account-data.tsx` (expose `isPrincipalSettled`), tests in `__tests__/watch-connectivity-sync.test.tsx`, `__tests__/planned-watch-dive-push.test.tsx`
- [x] No subscription or drain while auth is `bootstrapping`/`authenticating`/`pendingOnboarding`; both start once settled.
- [x] Plans pushed only after the first plans load completes and the principal is settled.

## Phase 5 — Phone-side watch connectivity

### Task 5.1: Rejected payload ledger and Settings visibility
- Files: new `src/storage/watch-rejected-payload-store.ts`, `src/states/watch-connectivity-sync.tsx`, `src/screens/settings/screen.tsx`, i18n, tests
- [x] Invalid payloads recorded (sessionId, reason, at; max 20; no content) before local drop.
- [x] Settings device screen lists count + guidance; refresh action; load failure ≠ "bridge unavailable".

### Task 5.2: Drain head-of-line
- Files: `src/states/watch-connectivity-sync.tsx` (+ native only if unavoidable), tests
- [x] A batch of 8 previously-failed payloads must not stop later payloads from importing. Solved in JS: a payload that fails import three times in a row is recorded and set aside, so the native `prefix(8)` window moves on.

## Phase 6 — Account sync

### Task 6.1: Conflict resolution
- Files: `src/sync/account-sync-coordinator.ts`, `src/sync/account-outbox.ts`, `src/states/account-data.tsx`, `src/screens/logbook/log-entry-detail.tsx`, `src/screens/planning/plan-detail.tsx`, i18n, tests in `__tests__/account-sync-coordinator.test.ts`, `__tests__/account-data-state.test.tsx`
- [x] `resolveConflict(kind, localId, 'keepLocal' | 'useRemote')`; deleting a conflicted row rebases onto the remote revision. An ordinary delete conflict still surfaces as a conflict instead of overwriting the other device's edit.
- [x] Detail banner with two actions.

### Task 6.2: Remote deletion propagation
- Files: `packages/supabase/src/account-data-repository.ts` (+ test), `src/sync/account-sync-coordinator.ts`, tests
- [x] Verify RLS allows owners to read soft-deleted rows; hydrate removes synced local copies without pending ops.

### Task 6.3: Remote error classification
- Files: `packages/supabase/src/guest-claim-repository.ts`, `packages/supabase/src/account-data-repository.ts` (+ tests)
- [x] Use `result.status`: 0/5xx → network/transient, `PGRST303`/401 → session expired. `account-data-repository.ts` needs no classifier: the coordinator reschedules every delivery error.

## Phase 7 — Watch accuracy

### Task 7.1: Recording math and provenance
- Files: `Recording/ScubaDiveEngine.swift`, `Recording/SafetyStopController.swift`, `Sensors/WaterSubmersionCoordinator.swift`, `Models/DiveSessionRecord.swift`, `Runtime/RealDiveSessionCoordinator.swift`, `Views/HomeView.swift`, `Storage/DiveSessionStore.swift`, matching tests
- [x] Stored max ascent = max smoothed estimator output. Summary and sanitizer fallbacks replay samples through the same estimator.
- [x] Safety stop credits ≤ 5 s per sample interval (matches the 5 s stale-depth threshold); tests now hold depth at 1 Hz.
- [x] Temperature reset on session start / notSubmerged; ignore > 60 s old.
- [x] Missing `captureMode` decodes as `.demo`. Verified in git history: the real provider was a stub until the commit that added `captureMode` (e667202).
- [x] Action Button end only when `notSubmerged`, matching the lifecycle spec, wiki, and device checklist.
- [x] Demo sessions never carry `sourcePlanLocalId` nor mark plans executed.
- [x] Deletion recovery retried before save, on companion refresh/activation, and when the app becomes active. A late success reloads saved sessions only; interrupted-recording recovery waits for the next launch so it cannot touch a live recording.

## Phase 8 — UI/UX

### Task 8.1: Watch UI
- [ ] Caution color token; safety stop paused/incomplete uses caution + "Recommended stop" label.
- [ ] Persistent Demo marker on live screen; unsupported marker in summary/list/detail.
- [ ] Dive Plans screen; `--` for missing plan depth.
- [ ] Sync status labels (waiting / awaiting confirmation / synced / failed) + resend on failed rows.
- [ ] VoiceOver labels for safety-stop timer, metrics, custom back.

### Task 8.2: Mobile UI
- [ ] Home: latest dive first, count not primary, provenance/unsupported markers, tap to detail; padding via `contentContainerStyle`.
- [ ] Safety stop incomplete → warning tone + recommended wording.
- [ ] Chart colors from theme tokens.
- [ ] Sync toast shows partial failures; claim refresh failure state; error vs empty vs no-results.
- [ ] Accessibility: tab/pill selected state, star label, profile summary label, wheel increment/decrement, 44 pt targets.
- [ ] Hardcoded strings → i18n.

## Phase 9 — Docs and wiki

- [ ] AGENTS.md (root, mobile) and wiki UI doc: Memory tab → current state; verification commands.
- [ ] `.wiki/raw/architecture/2026-10-21-review-remediation.md`; update `watch-app.md`, `sync-flow.md`, `mobile.md`, `design/mobile-watch-ui-language.md`, `domains/safety-rules.md`, `index.md`, `log.md`.
- [ ] Device checklist rows: consecutive dive without dismissing summary, beyond-sensor-range display, offline cold start auth.
- [ ] `.DS_Store` untracked + `.gitignore`.

## Phase 10 — Full verification

- [ ] typecheck, jest, lint, watch:ui:check, supabase test, watch build, watch XCTest; iOS build if native iPhone code changed.
