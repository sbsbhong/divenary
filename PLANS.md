# Epic Planning Template

Use this template before starting large features, cross-package work, native project changes, or any task with unclear sequencing.

## Stop Rule

Every phase must have a verification gate. If the same gate fails three times with the same root cause, stop implementation and report a blocker with:

- Failing command or manual gate
- Short error summary
- Fixes already attempted
- Suspected owner or environment dependency
- Safest next action for a human

## Epic: <name>

### Phase 0 Investigation

- Goal:
- Files to inspect:
- Implementation notes:
- Verification gate:
- Risk:

### Phase 1 Contract

- Goal:
- Files to create or update:
- Implementation notes:
- Verification gate:
- Risk:

### Phase 2 Core Implementation

- Goal:
- Files to create or update:
- Implementation notes:
- Verification gate:
- Risk:

### Phase 3 Integration

- Goal:
- Files to create or update:
- Implementation notes:
- Verification gate:
- Risk:

### Phase 4 Cleanup/Review

- Goal:
- Files to review:
- Implementation notes:
- Verification gate:
- Risk:

## Reporting Checklist

- Completed phases:
- Commands run and results:
- Failed or skipped gates:
- Remaining risks:
- Manual setup required:

## Epic: Mobile-authoritative Watch log deletion

### Phase 0 Investigation

- Goal: Preserve the physical-device evidence for the 15-to-26 resurrection and map every mobile, claim, Supabase, iPhone native, and watchOS deletion boundary before editing.
- Files to inspect:
  - `docs/superpowers/specs/2026-07-30-mobile-authoritative-watch-log-deletion-design.md`
  - `apps/mobile/src/claim/guest-claim-service.ts`
  - `apps/mobile/src/states/account-data.tsx`
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/src/native/watch-connectivity.ts`
  - `apps/mobile/ios/Divenary/WatchConnectivityInbox.swift`
  - `apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift`
  - `apps/mobile/ios/DivenaryWatchApp/Storage/DiveProfileArtifactStore.swift`
  - `apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift`
  - `packages/supabase/src/guest-claim-repository.ts`
  - `supabase/functions/finalize-guest-claim/index.ts`
  - `supabase/migrations/20260719130604_create_account_data_and_guest_claim.sql`
- Implementation notes:
  - The resurrection came from a retained noncommitted claim snapshot, not a Watch retransmission.
  - Preserve normal Watch import ACK as iPhone-local commit/intentional discard evidence; do not redefine it as cloud completion.
  - Preserve the user-authorized scope: deletion is initiated only on mobile; no Watch delete gesture or button.
- Verification gate: the design spec and task plan identify the exact 15-to-26 regression fixture, deletion ordering, claim abandonment race, and physical-device gate.
- Risk: Previously lost deletion intent cannot be inferred safely for every existing account row; do not automatically delete the current 15 resurrected records.

### Phase 1 Contract

- Goal: Define persistent mobile/watch tombstones, idempotent WatchConnectivity deletion request/ACK envelopes, and privileged guest claim abandonment without weakening current RLS.
- Files to create or update:
  - `apps/mobile/src/deletion/watch-log-deletion-store.ts`
  - `apps/mobile/src/deletion/watch-log-deletion-coordinator.ts`
  - `apps/mobile/src/native/watch-connectivity.ts`
  - `apps/mobile/ios/Divenary/WatchConnectivityModule.swift`
  - `apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m`
  - `apps/mobile/ios/Divenary/WatchConnectivityInbox.swift`
  - `apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncEnvelope.swift`
  - `packages/supabase/src/account-data-types.ts`
  - `packages/supabase/src/guest-claim-repository.ts`
  - `supabase/migrations/*_abandon_deleted_guest_claim_logs.sql`
  - `supabase/functions/abandon-guest-claim/index.ts`
- Implementation notes:
  - Mobile and Watch tombstones are keyed by `localSessionId`; revision and artifact digest remain evidence, not delete authority.
  - Authenticated clients keep select/insert-only batch grants. A JWT-authenticated Edge Function calls a service-role-only abandonment function.
  - Write failing Jest, Node migration-harness, and Swift source-boundary tests before production changes.
- Verification gate: focused contract/store/repository tests pass, migration hardening tests pass, and generated Supabase types match the new status.
- Risk: Finalize and abandon can race; `committed` must be handled as a post-commit account soft-delete rather than an attempted rollback.

### Phase 2 Core Implementation

- Goal: Make mobile deletion durable and resurrection-proof across guest/account repositories, imports, hydration, and claim retry.
- Files to create or update:
  - `apps/mobile/src/deletion/watch-log-deletion-store.ts`
  - `apps/mobile/src/deletion/watch-log-deletion-coordinator.ts`
  - `apps/mobile/src/states/account-data.tsx`
  - `apps/mobile/src/states/use-dive-logbook-queries.ts`
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/src/claim/guest-claim-service.ts`
  - `apps/mobile/src/claim/guest-claim-store.ts`
  - `apps/mobile/src/i18n/resources.ts`
  - focused suites under `apps/mobile/__tests__/`
- Implementation notes:
  - Tombstone write/readback must happen before repository deletion.
  - Tombstoned logs are filtered immediately and reconciliation retries incomplete local/account/Watch work.
  - Any intersecting noncommitted claim batch is abandoned before a fresh snapshot can finalize.
  - Direct and native Watch imports check tombstones before storing large profile data.
- Verification gate: focused RED/GREEN Jest suites reproduce the retained 15-item snapshot regression and pass after implementation; `yarn mobile:typecheck` passes.
- Risk: Account/guest composition and claim publication share large state files; keep new logic behind small focused store/coordinator modules and serialized mutation gates.

### Phase 3 Integration

- Goal: Deliver durable iPhone-to-Watch deletion, remove Watch manifest/artifact state idempotently, deploy the abandonment boundary to staging, and run hosted verification.
- Files to create or update:
  - `apps/mobile/ios/Divenary/WatchConnectivityInbox.swift`
  - `apps/mobile/ios/Divenary/WatchConnectivityModule.swift`
  - `apps/mobile/ios/DivenaryWatchApp/Storage/DiveProfileArtifactStore.swift`
  - `apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift`
  - `apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift`
  - `apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncEnvelope.swift`
  - native/source-boundary test scripts under `apps/mobile/scripts/`
  - `supabase/scripts/verify-staging-guest-claim.mjs`
  - `supabase/tests/database/guest_data_claim.test.sql`
  - `supabase/tests/functions/abandon-guest-claim.mjs`
- Implementation notes:
  - Watch persists its session tombstone before canceling transfers and removing manifest/artifact state.
  - Duplicate/already-absent commands ACK successfully.
  - Deploy only to staging `mclvhwzsuvsxjerdouka`; production remains untouched.
- Verification gate: focused native tests, Supabase local tests/advisors, `yarn ios:build`, `yarn watch:build`, staging migration/function deployment, and hosted verifier all pass.
- Risk: Paired-device delivery and artifact removal still require the explicit physical iPhone/Watch gate after automated builds.

### Phase 4 Cleanup/Review

- Goal: Verify the physical deletion matrix, update durable wiki knowledge, review the full diff, merge to main, re-run merged gates, and shut down the PC.
- Files to review or update:
  - `.wiki/raw/architecture/2026-07-30-mobile-authoritative-watch-log-deletion.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/supabase.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/index.md`
  - `.wiki/wiki/log.md`
  - every file in `git diff main...HEAD`
- Implementation notes:
  - Stop and ask the user to connect iPhone/Watch before the physical gate.
  - Preserve unrelated dirty `.turbo` cache files in main.
  - The user already selected local merge to `main`; no additional branch-disposition prompt is needed.
  - Shut down only after merge and post-merge verification succeed.
- Verification gate: physical online/offline deletion matrix passes, focused/full automated gates and `yarn codex:check` pass on the feature branch and merged main, and `git diff --check` is clean.
- Risk: OS shutdown ends the session immediately; it is the final action after reporting the merge commit and verification evidence.

## Epic: Pre-device two-mode, notifications, and validation readiness

### Phase 0 Investigation

- Goal: Confirm current contract, mobile Logbook/Planning/Home/Settings, WatchConnectivity, watchOS source, and documentation state before implementation.
- Files to inspect:
  - `docs/superpowers/specs/2026-06-26-two-mode-dive-contract-and-ux-design.md`
  - `docs/superpowers/specs/2026-06-26-watch-sync-notifications-design.md`
  - `docs/superpowers/specs/2026-06-26-home-location-conditions-design.md`
  - `packages/contracts/schemas/watch-session.schema.json`
  - `apps/mobile/src/utils/watch-sync-message-validation.ts`
  - `apps/mobile/src/screens/logbook/**`
  - `apps/mobile/src/screens/planning/**`
  - `apps/mobile/src/screens/home/screen.tsx`
  - `apps/mobile/src/screens/settings/screen.tsx`
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/ios/DiveWatchApp/**`
  - `.wiki/wiki/architecture/*.md`
  - `.wiki/wiki/domains/*.md`
  - `.wiki/wiki/questions/open-questions.md`
- Implementation notes:
  - Preserve the safety boundary: no decompression, no certified dive-computer claims, no emergency instruction.
  - Treat paired iPhone/Watch hardware checks as manual gates only; do not claim physical-device validation from simulator or local builds.
  - Keep local sync notification wording tied to mobile local repository storage, not Supabase/cloud backup.
- Verification gate: plan file exists at `docs/superpowers/plans/2026-06-26-pre-device-priorities.md` and contains task-level gates.
- Risk: Existing wiki/spec changes are uncommitted in the starting workspace; preserve them and do not revert unrelated edits.

### Phase 1 Contract

- Goal: Reduce watch sync `diveMode` to `scuba | freedive` and reset local Logbook/Planbook storage namespace for the PoC reset.
- Files to create or update:
  - `packages/contracts/schemas/watch-session.schema.json`
  - `packages/contracts/generated/typescript/index.ts`
  - `packages/contracts/generated/swift/WatchContracts.swift`
  - `packages/contracts/fixtures/*.json`
  - `apps/mobile/src/utils/watch-sync-message-validation.ts`
  - `apps/mobile/src/storage/storage-keys.ts`
  - `apps/mobile/__tests__/watch-sync-message-validation.test.ts`
  - `apps/mobile/__tests__/persistent-dive-log-repository.test.ts`
  - `apps/mobile/__tests__/persistent-dive-plan-repository.test.ts`
- Implementation notes:
  - Write failing tests before changing validator/storage behavior.
  - Regenerate generated contract output through `yarn check:quick`; do not hand-edit generated files except as generation output.
- Verification gate: `yarn check:quick` and focused mobile tests for validator/storage.
- Risk: Removed mode values in old local v1 data are intentionally not migrated; this must remain documented as a reset.

### Phase 2 Core Implementation

- Goal: Align mobile and watch UX around two dive modes, add watch sync notification preference/service, and add Home conditions mock interface.
- Files to create or update:
  - `apps/mobile/src/screens/logbook/**`
  - `apps/mobile/src/screens/planning/**`
  - `apps/mobile/src/screens/home/screen.tsx`
  - `apps/mobile/src/screens/settings/screen.tsx`
  - `apps/mobile/src/states/app-preferences.tsx`
  - `apps/mobile/src/states/app-preferences-storage.ts`
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/src/notifications/watch-sync-notification-service.ts`
  - `apps/mobile/src/conditions/home-conditions.ts`
  - `apps/mobile/src/i18n/resources.ts`
  - `apps/mobile/ios/DiveWatchApp/Models/DiveSession.swift`
  - `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
  - `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
  - `apps/mobile/package.json`
  - `yarn.lock`
- Implementation notes:
  - Use TDD for behavior changes where Jest can cover them.
  - Add Notifee as a mobile workspace dependency with Yarn 1.
  - Keep Notifee usage behind an adapter/no-op fallback so tests and unsupported environments do not block local import.
  - Use semantic UI tokens and existing Gluestack/NativeWind primitives.
- Verification gate: focused Jest suites, `yarn mobile:typecheck`, `yarn workspace @repo/mobile watch:ui:check`, and `yarn watch:build`.
- Risk: Adding a native notification dependency may require CocoaPods install for full iOS app builds; report if local pods are not refreshed.

### Phase 3 Integration

- Goal: Document manual real-device validation steps and update durable wiki facts after implementation.
- Files to create or update:
  - `docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md`
  - `docs/2026-06-26-pre-device-priorities/index.html`
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/domains/dive-planning.md`
  - `.wiki/wiki/domains/safety-rules.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- Implementation notes:
  - Separate completed implementation facts from remaining physical-device validation.
  - The HTML handoff should summarize commits, gates, manual checks, and residual risks.
- Verification gate: documentation/source search for stale removed-mode and unsafe sync wording, then `yarn codex:check`.
- Risk: Wiki must not overstate background delivery or real Apple Watch underwater sensor behavior.

### Phase 4 Cleanup/Review

- Goal: Verify all relevant gates, create logical commits, and preserve the branch for user review.
- Files to review:
  - `git status --short`
  - `git diff --stat`
  - `docs/superpowers/plans/2026-06-26-pre-device-priorities.md`
  - touched source, tests, generated contracts, docs, wiki, `package.json`, `yarn.lock`
- Implementation notes:
  - Commit by requirement unit: two-mode contract/UX, notification service, Home conditions, handoff/wiki/checklist, pre-existing pending-work skill/specs if appropriate.
  - Do not merge, push, or discard without explicit user choice after verification.
- Verification gate: `yarn check:quick`, `yarn workspace @repo/mobile test --runInBand`, `yarn mobile:typecheck`, `yarn workspace @repo/mobile watch:ui:check`, `yarn watch:build`, `yarn codex:check`, `git diff --check`.
- Risk: Physical paired-device verification remains a manual gate outside this environment.

## Epic: Pre-device-test mobile and watch readiness

### Phase 0 Investigation

- Goal: Map the current mobile navigation, form/input, logbook import, refresh, watch planning, device management, and home status surfaces before editing.
- Files to inspect:
  - `apps/mobile/package.json`
  - `apps/mobile/src/App.tsx`
  - `apps/mobile/src/providers.tsx`
  - `apps/mobile/src/components/navigation/index.tsx`
  - `apps/mobile/src/screens/home/screen.tsx`
  - `apps/mobile/src/screens/logbook/screen.tsx`
  - `apps/mobile/src/screens/planning/screen.tsx`
  - `apps/mobile/src/screens/memory/screen.tsx`
  - `apps/mobile/src/states/use-dive-logbook.ts`
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/src/native/watch-connectivity.ts`
  - `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
  - `apps/mobile/ios/DiveWatchApp/**`
- Implementation notes:
  - Keep the existing UI primitives and visual language unless a requirement directly asks for a UX change.
  - Use `@react-navigation/native` as the new navigation state container while preserving the custom tab bar styling.
  - Treat manual import as a user-facing sync affordance, not a second source of truth.
  - Do not introduce Supabase, auth, certified dive-computer copy, or physical-device-only verification gates.
- Verification gate: `yarn workspace @repo/mobile test --runInBand` for focused touched tests and `yarn mobile:typecheck`.
- Risk: React Navigation may require additional peer dependencies for a richer navigator; the first pass should avoid adding extra packages unless the build requires them.

### Phase 1 Contract

- Goal: Define the app-level behavior contracts for navigation, refresh, keyboard avoidance, manual watch sync, formatting, planned dives, and linked watch display.
- Files to create or update:
  - `apps/mobile/__tests__/*.test.tsx`
  - `apps/mobile/__tests__/*.test.ts`
  - `apps/mobile/src/types/*.ts`
  - `apps/mobile/src/native/watch-connectivity.ts`
- Implementation notes:
  - Add or extend tests before behavior changes where the existing Jest setup can exercise the code.
  - Keep native contracts explicit for linked watch metadata and manual sync status.
  - Round display numbers at formatting boundaries so stored/raw watch values remain intact.
- Verification gate: Each requirement gets a focused red/green test run before its commit when testable, then `yarn mobile:typecheck`.
- Risk: Some UI behavior such as keyboard avoidance and pull-to-refresh is partly platform behavior and may need simulator/manual validation after type/test gates.

### Phase 2 Core Implementation

- Goal: Implement requirements 1 through 10 in separate commits.
- Files to create or update:
  - `apps/mobile/package.json`
  - `yarn.lock`
  - `apps/mobile/src/components/navigation/index.tsx`
  - `apps/mobile/src/screens/home/screen.tsx`
  - `apps/mobile/src/screens/logbook/screen.tsx`
  - `apps/mobile/src/screens/planning/screen.tsx`
  - `apps/mobile/src/screens/memory/screen.tsx`
  - `apps/mobile/src/states/use-dive-logbook.ts`
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/src/native/watch-connectivity.ts`
  - `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
  - `apps/mobile/ios/DiveWatchApp/**`
- Implementation notes:
  - Commit messages must start with `feat:`, `fix:`, `refactor:`, or `chore:` and use lowercase after the prefix.
  - Keep one requirement per implementation commit so rollback remains practical.
  - Prefer `KeyboardAvoidingView`, `ScrollView`/`FlatList` keyboard props, and `RefreshControl` before custom gesture code.
  - Let active tab reselection trigger refresh and scroll-to-top through a shared route registry instead of duplicated per-tab hacks.
- Verification gate: Focused Jest/typecheck after each high-risk requirement; broader gate in Phase 4.
- Risk: Requirement 8 crosses mobile planning and watch UI; avoid safety-critical planning semantics and frame it as a non-certified reminder.

### Phase 3 Integration

- Goal: Wire the changed app behavior into native/mobile boundaries and durable project knowledge.
- Files to create or update:
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/log.md`
  - `README.md`
  - `apps/mobile/README.md`
  - `AGENTS.md`
  - `apps/mobile/AGENTS.md`
- Implementation notes:
  - Update durable docs only for architecture, sync behavior, planning/watch boundary, or recurring pitfalls that actually changed.
  - Keep README/AGENTS concise and focused on active developer workflow.
- Verification gate: Search docs for stale statements after code changes and run `yarn codex:check`.
- Risk: Documentation can overstate simulator or physical-device verification; explicitly separate verified simulator behavior from unverified real-device behavior.

### Phase 4 Cleanup/Review

- Goal: Run final verification, review commit boundaries, and report remaining risks before real-device testing.
- Files to review:
  - `git log --oneline`
  - `git status --short`
  - `git diff --stat main...HEAD`
  - touched source, native, test, and docs files
- Implementation notes:
  - Run `yarn mobile:typecheck`, focused Jest suites, `yarn watch:build`, and `yarn codex:check`.
  - Run `yarn ios:build` if CocoaPods/native workspace is available.
  - Run `git diff --check` before final reporting.
- Verification gate: Final command outputs and exit codes are recorded in the handoff.
- Risk: Physical Apple Watch behavior remains unverified until the user runs real-device testing.

## Epic: Watch app mobile migration

### Phase 0 Investigation

- Goal: Confirm the current standalone watch workspace, mobile iOS workspace, scripts, and docs that will change when watch ownership moves to mobile.
- Files to inspect:
  - `AGENTS.md`
  - `README.md`
  - `package.json`
  - `apps/mobile/AGENTS.md`
  - `apps/mobile/README.md`
  - `apps/mobile/package.json`
  - `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
  - retired standalone watch workspace files
  - `.wiki/wiki/architecture/*.md`
  - `.wiki/wiki/questions/open-questions.md`
- Implementation notes:
  - Treat the retired standalone watch app source as active only for pre-migration comparison.
  - Treat the old standalone `Sources` area as inactive legacy source that should not remain active.
  - Use local Xcode watch app templates and `xcodeproj` structure to avoid unusual project settings.
- Verification gate: `xcodebuild -list -project apps/mobile/ios/DiveMobile.xcodeproj`; pre-migration standalone project listing was used only to compare target/scheme settings.
- Risk: The local Xcode runtime currently reports CoreSimulator/platform warnings; separate environment failures from project structure failures.

### Phase 1 Contract

- Goal: Define the new ownership contract: mobile owns the watch app source, target, scripts, and docs.
- Files to create or update:
  - `docs/superpowers/specs/2026-06-24-watch-app-mobile-migration-design.md`
  - `docs/superpowers/plans/2026-06-24-watch-app-mobile-migration.md`
  - `PLANS.md`
- Implementation notes:
  - Active watch source becomes `apps/mobile/ios/DiveWatchApp`.
  - Active watch target becomes `DiveWatchApp` inside `apps/mobile/ios/DiveMobile.xcodeproj`.
  - Root `watch:build` points to mobile workspace scripts.
  - The standalone watch workspace stops being active.
- Verification gate: Spec and plan exist and contain no placeholder markers.
- Risk: Removing the standalone workspace before mobile-owned watch build is stable could make rollback harder; use git status and focused diffs throughout.

### Phase 2 Core Implementation

- Goal: Move source files and add the watch target/embed structure to the mobile Xcode project.
- Files to create or update:
  - `apps/mobile/ios/DiveWatchApp/**`
  - `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
  - `apps/mobile/ios/DiveMobile.xcodeproj/xcshareddata/xcschemes/DiveWatchApp.xcscheme`
  - `apps/mobile/scripts/check-watch-ui-language.mjs`
  - `apps/mobile/package.json`
  - `package.json`
- Implementation notes:
  - Add the watch target as a watchOS app target in `DiveMobile.xcodeproj`.
  - Add a target dependency from `DiveMobile` to `DiveWatchApp`.
  - Add `Embed Watch Content` to `DiveMobile`.
  - Keep WatchConnectivity code in the same files after moving.
  - Do not change developer team or provisioning settings.
- Verification gate: `yarn workspace @repo/mobile watch:list`, then `yarn watch:build`.
- Risk: Xcode project mutation may produce noisy diffs; review target/product/build phase settings before running broad gates.

### Phase 3 Integration

- Goal: Update repository guides and wiki so future agents no longer use the retired standalone watch workspace as active watch ownership.
- Files to create or update:
  - `AGENTS.md`
  - `README.md`
  - `apps/mobile/AGENTS.md`
  - `apps/mobile/README.md`
  - `.wiki/wiki/index.md`
  - `.wiki/wiki/overview.md`
  - `.wiki/wiki/architecture/monorepo.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- Implementation notes:
  - Explain that the mobile iOS project owns both iOS and companion watch targets.
  - Remove active references to the retired standalone watch workspace package.
  - Keep historical/migration references only where explicitly labeled.
- Verification gate: search active docs and package scripts for stale standalone watch workspace references.
- Risk: Some historical docs may intentionally mention old paths; do not rewrite unrelated old specs unless they would mislead active workflow.

### Phase 4 Cleanup/Review

- Goal: Verify tests/builds and remove stale standalone workspace artifacts from active source.
- Files to review:
  - retired standalone watch workspace deletion
  - `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
  - `apps/mobile/ios/DiveMobile.xcodeproj/xcshareddata/xcschemes/`
  - `package.json`
  - `apps/mobile/package.json`
- Implementation notes:
  - Run focused Jest tests for WatchConnectivity import.
  - Run mobile typecheck.
  - Run mobile-owned watch build.
  - Run `codex:check`.
  - Run `ios:build` as best effort and report Xcode runtime/platform blockers separately.
- Verification gate: `yarn codex:check`
- Risk: `yarn ios:build` may continue to fail due local `iOS 26.5 Platform Not Installed`; do not treat that as proof of watch project failure unless compile errors point to migrated files.

## Epic: Mobile logbook local-first foundation

### Phase 0 Investigation

- Goal: Confirm the first executable boundary for mobile manual log creation and choose the local persistence approach.
- Files to inspect:
  - `apps/mobile/src/states/use-dive-logbook.ts`
  - `apps/mobile/src/types/dive-session.ts`
  - `apps/mobile/src/utils/import-watch-session.ts`
  - `apps/mobile/src/screens/logbook/screen.tsx`
  - `apps/mobile/src/components/navigation/index.tsx`
  - `apps/mobile/package.json`
  - `packages/contracts/schemas/*.schema.json`
  - `apps/mobile/ios/DiveWatchApp/Models/DiveSession.swift`
- Implementation notes:
  - Compare a simple key-value JSON local store against a structured local database before adding dependencies.
  - Confirm whether `@tanstack/react-query` is present in the mobile workspace and plan the smallest provider/dependency addition if absent.
  - Confirm the first manual-log field set.
  - Confirm whether watch fixture import should become a repository action in the same phase.
  - Write the exact touched-file list for Phase 1 before coding.
- Verification gate: `yarn mobile:typecheck`
- Risk: Selecting a storage dependency before the data model is stable can create unnecessary native setup and migration work.

### Phase 1 Contract

- Goal: Introduce the mobile logbook domain model and repository interface without adding auth or Supabase.
- Files to create or update:
  - `apps/mobile/src/types/dive-log-entry.ts`
  - `apps/mobile/src/repositories/dive-log-repository.ts`
  - `apps/mobile/src/repositories/local-dive-log-repository.ts`
  - `apps/mobile/src/states/use-dive-logbook-queries.ts`
  - `apps/mobile/src/providers.tsx`
  - `apps/mobile/src/utils/create-dive-log-entry.ts`
  - `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
  - `apps/mobile/src/states/use-dive-logbook.ts`
  - relevant mobile tests
- Implementation notes:
  - Add `DiveLogEntry`, `DiveLogSource`, `DiveFieldSource`, and `DiveLogSyncStatus`.
  - Keep `WatchSession` as the watch sync contract, not the final mobile logbook item.
  - Preserve watch-captured values and provenance.
  - Add repository methods for list/get/save/delete/import watch session.
  - Use React Query for logbook reads, mutations, invalidation, loading states, and errors.
  - Keep React Query cache as cache only; local storage and future Supabase remain durable stores.
  - Do not add Zustand in the first pass unless editor state complexity proves it is needed.
- Verification gate: `yarn workspace @repo/mobile test` for touched tests, then `yarn mobile:typecheck`
- Risk: Over-modeling future Supabase tables at this stage can make the local app harder to ship.

### Phase 2 Core Implementation

- Goal: Add login-free local manual log creation in the mobile app.
- Files to create or update:
  - `apps/mobile/src/screens/logbook/*`
  - `apps/mobile/src/states/use-dive-logbook.ts`
  - `apps/mobile/src/repositories/local-dive-log-repository.ts`
  - `apps/mobile/src/i18n/resources.ts`
  - relevant mobile tests
- Implementation notes:
  - Add a Logbook create action and manual editor.
  - Use React Query mutations for save/delete/import and invalidate relevant logbook queries.
  - Save manual logs with `source: 'manual'` and `syncStatus: 'localOnly'`.
  - Display manual and watch-sourced entries in one logbook.
  - Keep mobile-assisted location optional and editable.
  - Do not add login, Supabase, cloud backup, or account UI in this phase.
- Verification gate: `yarn workspace @repo/mobile test` for touched tests, then `yarn mobile:typecheck`
- Risk: The editor can expand quickly; defer media, advanced taxonomy, and complex validation until the save/list/detail path is stable.

### Phase 3 Integration

- Goal: Validate watch data movement into mobile and then support watch-based log authoring.
- Files to create or update:
  - `packages/contracts/schemas/*.schema.json` only if the contract must change
  - `apps/mobile/ios/DiveWatchApp/*` transport-related files
  - `apps/mobile/src/utils/import-watch-session.ts`
  - `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
  - `apps/mobile/src/screens/logbook/*`
- Implementation notes:
  - Decide whether the validation path is WatchConnectivity, debug JSON export/import, or both.
  - Confirm contract-valid payload parsing on mobile.
  - Lock watch-captured measured values in mobile editing.
  - Let the user add missing context such as buddy, gear, notes, tags, and observed marine life.
- Verification gate: `yarn check:quick`, `yarn mobile:typecheck`, and `yarn watch:build` if watchOS or contract files change.
- Risk: WatchConnectivity and underwater sensor behavior may need physical device validation.

### Phase 4 Cleanup/Review

- Goal: Prepare the local-first logbook for auth and Supabase without implementing cloud sync prematurely.
- Files to review:
  - `docs/superpowers/specs/2026-06-21-mobile-logbook-local-first-design.md`
  - `docs/superpowers/plans/2026-06-21-mobile-logbook-local-first.md`
  - `.wiki/wiki/architecture/mobile-logbook-roadmap.md`
  - `.wiki/wiki/decisions/adr-local-first-mobile-logbook.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/architecture/supabase.md`
- Implementation notes:
  - Confirm guest/local-only behavior.
  - Confirm future signed-in local-plus-Supabase sync behavior.
  - Record unresolved storage, transport, and Supabase schema decisions before starting auth work.
- Verification gate: `yarn codex:check`
- Risk: Adding auth before the local domain model stabilizes can force avoidable rewrites.

## Epic: Wave 3 Supabase Auth and Local-First Cloud Sync

### Phase 0 Investigation

- Goal: Fix the approved product, data, security, and delivery boundaries before creating cloud code or native Auth configuration.
- Files:
  - `docs/superpowers/specs/2026-07-13-supabase-auth-cloud-sync-design.md`
  - `apps/mobile/package.json`
  - `apps/mobile/src/repositories/**`
  - `apps/mobile/src/types/**`
  - `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
  - `packages/contracts/**`
  - `.wiki/wiki/architecture/**`
- Implementation:
  - Preserve guest local-only use and separate `guest` from `user:<uuid>` local namespaces.
  - Use native Google and Apple ID-token exchange on iOS; exclude email/password, magic link, SMS, Android native Auth, profile, nickname, friends, and app-provided manual identity linking. Accept Supabase automatic linking for the same verified email.
  - Require versioned terms/privacy consent after first social identity creation and before active membership.
  - Keep Watch local import acknowledgement independent from cloud sync.
  - Use keyset pagination and detail-only immutable private Storage objects for full 1Hz profiles.
  - Use optimistic server revisions, an idempotent outbox, explicit conflict state, immediate permanent account deletion, and a deferred 7-day soft-delete feature.
- Gate: The design spec is approved, contains no unresolved product decision, and `git diff --check` passes.
- Risk: The reported four-minute foreground physical test confirms pairing, import, local save, and Watch acknowledgement only; reconnect, background, killed-app, and large-transfer evidence remains incomplete.

### Phase 1 Contract: Wave 3A Supabase and Auth Foundation

- Goal: Produce a local Supabase development boundary, generated database types, secure native social login, mandatory legal consent, and a stable Auth state machine while leaving Logbook/Planbook local-only.
- Files:
  - `package.json`
  - `yarn.lock`
  - `supabase/config.toml`
  - `supabase/migrations/**`
  - `supabase/seed.sql`
  - `supabase/tests/database/**`
  - `packages/supabase/**`
  - `apps/mobile/package.json`
  - `apps/mobile/src/auth/**`
  - `apps/mobile/src/states/auth.tsx`
  - `apps/mobile/src/screens/auth/**`
  - `apps/mobile/src/components/navigation/index.tsx`
  - `apps/mobile/src/screens/settings/screen.tsx`
  - `apps/mobile/src/i18n/resources.ts`
  - `apps/mobile/ios/DiveMobile/**`
  - `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
  - `apps/mobile/ios/Podfile.lock`
  - `docs/superpowers/plans/2026-07-13-supabase-auth-foundation.md`
- Implementation:
  - Pin `supabase@2.109.1`, `@supabase/supabase-js@2.110.2`, `@react-native-google-signin/google-signin@16.1.2`, `@invertase/react-native-apple-authentication@2.5.1`, `react-native-keychain@10.0.0`, and `react-native-url-polyfill@3.0.0` with Yarn 1 exact versions.
  - Add `app_memberships`, immutable `legal_documents`, `current_legal_documents`, `consent_records`, explicit Data API grants, RLS policies, a snapshot `get_onboarding_status()` RPC, and an idempotent exact-set `complete_onboarding()` RPC that derives ownership from `auth.uid()`.
  - Generate database types instead of maintaining handwritten schema types.
  - Store Supabase sessions in Keychain, validate restored claims and server user identity, use the `auth-js@2.110.2` default single-flight/commit-guard concurrency path plus foreground auto-refresh, exchange Google native ID tokens directly, and exchange Apple ID tokens with the Invertase response's raw nonce through `signInWithIdToken`.
  - Implement `bootstrapping`, `guest`, `authenticating`, `pendingOnboarding`, `authenticated`, and `authenticatedOffline` states.
  - Boot the existing guest app without constructing a client when public Supabase configuration is absent, and keep provider/server errors free of token/email values.
  - Keep current local repositories and `cloudSyncStatus: notConfigured` unchanged throughout 3A.
- Gate: local reset, pgTAP plus REST privilege smoke tests, database lint/advisors, generated type drift, focused mobile Auth/native-config tests, `yarn mobile:typecheck`, `yarn ios:build`, `yarn watch:build`, and `yarn codex:check` pass. The automated checkpoint may be recorded separately, but native Google/Apple login, current consent/re-consent, guest preservation, and signed entitlements must be verified on a physical iPhone before leaving 3A for 3B.
- Risk: owned immutable legal URLs, stable App ID/bundle ID, Google OAuth clients, hosted Supabase provider configuration, Apple capability/signing, and real-device credentials are external prerequisites. Wave 3A is an internal checkpoint and is not releasable before Wave 3D in-app deletion.

### Phase 2 Core Implementation: Wave 3B Remote Data Foundation

- Goal: Add owner-isolated remote Logbook/Planbook metadata, cursor pagination, and immutable private 1Hz profile Storage without yet switching local writes to an outbox.
- Files:
  - `supabase/migrations/**`
  - `supabase/tests/database/**`
  - `packages/supabase/src/database.types.ts`
  - `packages/supabase/src/logbook/**`
  - `packages/supabase/src/planbook/**`
  - `packages/supabase/src/profiles/**`
  - `apps/mobile/src/repositories/**`
  - `apps/mobile/src/states/use-dive-logbook-queries.ts`
  - `apps/mobile/src/states/use-dive-plan-queries.ts`
  - focused mobile and package tests
- Implementation:
  - Add `dive_logs` and `dive_plans` with `(user_id, local_id)` uniqueness, server `revision`, tombstones, typed list columns, and versioned JSONB payloads.
  - Enforce owner RLS and Storage path ownership through `auth.uid()` plus current-consent active membership, so a pre-onboarding session cannot access app data.
  - Page Logbook by `(started_at desc, id desc)` and Planbook by `(planned_at desc, id desc)` with page size 30.
  - Keep full profiles out of list rows and signed URLs; upload immutable objects to `dive-profiles/<user_id>/<dive_log_id>/<content_revision>.json` and download them only for detail.
  - Verify digest, byte count, and sample count before accepting a profile.
- Gate: Local database reset, RLS/Storage owner-isolation tests, pagination no-gap/no-duplicate tests, profile integrity tests, generated type drift check, package tests, and `yarn mobile:typecheck` pass.
- Risk: Storage policy path parsing and cursor behavior under equal timestamps can leak or duplicate data unless tested with adversarial fixtures.

### Phase 3 Integration: Wave 3C Local-First Sync

- Goal: Introduce principal-scoped local persistence, explicit guest claim, idempotent outbox delivery, retry, and revision conflict handling while preserving Watch import semantics.
- Files:
  - `apps/mobile/src/repositories/**`
  - `apps/mobile/src/sync/**`
  - `apps/mobile/src/types/dive-log-entry.ts`
  - `apps/mobile/src/types/dive-plan.ts`
  - `apps/mobile/src/providers.tsx`
  - `apps/mobile/src/screens/**`
  - focused mobile tests
  - `supabase/migrations/**`
  - `supabase/tests/database/**`
- Implementation:
  - Migrate existing unscoped AsyncStorage envelopes exactly once into the `guest` namespace.
  - Store current account data only under `user:<uuid>` and never combine principal partitions in a query result.
  - Write locally first, enqueue immutable operation snapshots, and drain with bounded exponential backoff plus jitter on launch, foreground, network recovery, and manual retry.
  - Extend cloud state to `pending | synced | failed | conflict` only after the backend is active.
  - Claim guest records only after explicit consent using a persistent manifest, bounded resumable batches, copy, remote/profile verification, and source removal; refusal signs out and returns to guest.
  - Reject stale revisions, preserve the local mutation as a conflict, fetch remote latest, and require explicit local-or-remote resolution.
  - Preserve the invariant that Watch `session.syncStatus: synced` acknowledges iPhone local import and never waits for Supabase.
- Gate: Namespace migration, cross-account visibility, interrupted guest claim, outbox idempotency/retry, revision conflict, and Watch acknowledgement independence tests pass with `yarn mobile:typecheck`, focused Jest, `yarn ios:build`, and `yarn codex:check`.
- Risk: Local source deletion during guest claim is irreversible; it may happen only after both account-local and remote artifacts are verified.

### Phase 4 Cleanup/Review: Wave 3D Account Lifecycle

- Goal: Complete privacy-safe logout, immediate permanent account deletion, integration regression, and durable documentation.
- Files:
  - `supabase/functions/delete-account/**`
  - `supabase/migrations/**`
  - `supabase/tests/database/**`
  - `apps/mobile/src/auth/**`
  - `apps/mobile/src/repositories/**`
  - `apps/mobile/src/screens/settings/**`
  - `apps/mobile/src/i18n/resources.ts`
  - `.wiki/raw/architecture/**`
  - `.wiki/wiki/architecture/**`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/index.md`
  - `.wiki/wiki/log.md`
- Implementation:
  - On logout, request server sign-out but always remove the Keychain session, current user partition, downloaded profile files, and account React Query cache locally; preserve guest data.
  - Delete account data through a caller-authenticated privileged server boundary and remove Storage, database ownership, Auth user, and local credentials idempotently.
  - Show irreversible deletion scope and require explicit reconfirmation in Settings.
  - Record 7-day soft deletion/recovery, manual identity management UI, Android native Auth, profile/nickname/friends, and marketing consent as deferred work.
  - Re-run foreground Watch pairing/import/local acknowledgement regression and retain the rest of Wave 1 and Wave 2 as physical gates.
- Gate: Logout privacy tests, deletion authorization/idempotency tests, manual shared-device check, manual account deletion, long-profile/infinite-scroll integration, `yarn mobile:typecheck`, focused Jest, `yarn ios:build`, `yarn watch:build`, `yarn codex:check`, and `git diff --check` pass.
- Risk: Auth-user deletion and Storage cleanup cross privileged systems; retries must never leave an active session that can access partially deleted data.

## Epic: Guest Data Account Claim and Visible Progress

### Phase 0 Investigation

- Goal: Freeze the approved login-to-account-claim behavior and align it with the existing Wave 3 data boundary, Apple modal/progress guidance, Gluestack tokens, and current local repositories.
- Files:
  - `docs/superpowers/specs/2026-07-19-guest-data-account-claim-design.md`
  - `docs/superpowers/specs/2026-07-13-supabase-auth-cloud-sync-design.md`
  - `apps/mobile/src/components/navigation/index.tsx`
  - `apps/mobile/src/components/ui/progress/index.tsx`
  - `apps/mobile/src/repositories/**`
  - `apps/mobile/src/storage/**`
  - `apps/mobile/src/states/auth.tsx`
  - `packages/supabase/src/**`
  - `supabase/migrations/**`
- Implementation:
  - Preserve the approved choices: one combined Logbook/Planbook claim, explicit import or keep-on-device choice, visible `기기 저장` source, Settings retry, persistent resume, and determinate `completed / total` progress.
  - Use one native form sheet whose content transitions through choice, running, failed, and completion states; do not stack an alert or second modal.
  - Treat profile upload as part of its log item and increment progress only after remote storage and digest/sample verification.
  - Keep Watch local acknowledgement independent from Supabase success.
- Gate: The design spec and detailed plan exist, contain no unresolved product decision, and `git diff --check` passes.
- Risk: The feature crosses remote schema, private Storage, Edge Functions, local persistence, Auth transitions, and UI; implementation must remain phase-gated and must not start from the dirty main worktree.

### Phase 1 Contract: Remote Claim Boundary

- Goal: Create owner-isolated remote Logbook/Planbook models, private profile Storage, claim staging records, and an atomic publication contract.
- Files:
  - `supabase/migrations/**`
  - `supabase/tests/database/guest_data_claim.test.sql`
  - `supabase/tests/rest/guest-data-claim.mjs`
  - `supabase/functions/finalize-guest-claim/**`
  - `packages/supabase/src/database.types.ts`
- Implementation:
  - Add `dive_logs`, `dive_plans`, `guest_claim_batches`, and `guest_claim_records` with explicit grants, active-membership checks, owner RLS, uniqueness, revisions, tombstones, and indexes.
  - Create private `dive-profiles` Storage policies with immutable owner paths and no overwrite.
  - Keep staged records outside normal data tables so partial claims cannot appear in account lists.
  - Authenticate the Edge Function caller, verify profile bytes, digest, and sample count server-side, then invoke a service-role-only transaction that validates counts and plan-log relations before publication.
- Gate: local reset, pgTAP, REST isolation smoke tests, Edge Function tests, database lint/advisors, and generated type drift all pass.
- Risk: A public or authenticated execute grant on the privileged finalizer would bypass server verification; its execute privilege must remain `service_role` only.

### Phase 2 Core Implementation: Principal Storage and Sync

- Goal: Partition local data by principal, migrate legacy data to guest exactly once, add account-local outbox delivery, and expose provider-independent remote repositories.
- Files:
  - `packages/supabase/src/data/**`
  - `apps/mobile/src/storage/**`
  - `apps/mobile/src/repositories/**`
  - `apps/mobile/src/sync/**`
  - `apps/mobile/src/types/dive-log-entry.ts`
  - `apps/mobile/src/types/dive-plan.ts`
  - focused package/mobile tests
- Implementation:
  - Use `guest` and `user:<uuid>` namespaces for metadata, profile files, claim manifests, and outbox items.
  - Preserve original guest envelopes and profile files until a committed remote batch and account-local copy are both verified.
  - Add idempotent account mutations keyed by `(user_id, local_id)`, optimistic revisions, retry metadata, and conflict state.
  - Clear React Query data for the previous principal before exposing the next principal.
- Gate: package tests and mobile tests for legacy migration, cross-user isolation, outbox retry/idempotency, conflict preservation, and Watch ACK independence pass with `yarn mobile:typecheck`.
- Risk: A principal switch can briefly leak prior-user cache if repository identity and query scope are not changed atomically.

### Phase 3 Integration: Claim Orchestration and UI

- Goal: Deliver the resumable claim workflow and the Apple-style progress sheet across iOS and Android.
- Files:
  - `apps/mobile/src/claim/**`
  - `apps/mobile/src/states/account-data.tsx`
  - `apps/mobile/src/screens/account-claim/**`
  - `apps/mobile/src/components/navigation/index.tsx`
  - `apps/mobile/src/screens/logbook/screen.tsx`
  - `apps/mobile/src/screens/planning/screen.tsx`
  - `apps/mobile/src/screens/settings/screen.tsx`
  - `apps/mobile/src/i18n/resources.ts`
  - relevant mobile tests
- Implementation:
  - Snapshot plan records before log records, persist per-item completion, resume the same batch after background/termination, and defer without deleting guest originals.
  - Render exact `3 / 32` progress with a determinate semantic progressbar and tabular numerals; prevent interactive dismiss only while running/finalizing.
  - Show retained guest rows with `기기 저장`, and expose `기기 데이터 가져오기` in Settings while eligible records remain.
  - Respect Dynamic Type, dark mode, Reduce Motion, Korean/English text expansion, and 320pt width.
- Gate: focused UI/state tests, `yarn workspace @repo/mobile test --runInBand`, `yarn mobile:typecheck`, `yarn ios:build`, and Android manual layout inspection pass.
- Risk: Native form-sheet behavior differs by iOS version and Android; progress content must fit without relying on one fixed detent height.

### Phase 4 Cleanup/Review: Staging Promotion

- Goal: Verify interruption safety, publish the remote boundary to the existing staging project, update durable architecture knowledge, and prepare an isolated merge.
- Files:
  - `README.md`
  - `apps/mobile/AGENTS.md`
  - `.wiki/raw/architecture/**`
  - `.wiki/wiki/architecture/**`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/log.md`
  - `docs/superpowers/plans/2026-07-19-guest-data-account-claim.md`
- Implementation:
  - Run dry-run before staging migration push, deploy the Edge Function, and verify two-user RLS plus profile isolation against staging.
  - Manually test Apple login, keep-on-device, 32-item progress, forced termination/resume, corrupt profile failure, retry, cleanup, second-account isolation, and existing Watch local ACK.
  - Capture screenshots on iPhone and Android at choice, `3 / 32`, failure, and retained-device badge states; review text clipping and overlap before merge.
  - Update wiki facts only after implementation and gates establish them.
- Gate: staging verifier, full focused Jest/package/pgTAP gates, `yarn codex:check`, `git diff --check`, review, and clean feature-branch diff pass before merge to `main`.
- Risk: Google physical login remains unverified today; do not report the full provider matrix as passing until that manual gate is executed.
