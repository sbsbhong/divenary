# Pre-Device Depth Safety Sync Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before real-device pool validation, preserve depths above 40m while marking them as outside Apple Watch v1 support, remove mandatory wording from v1 safety-stop UX, and harden WatchConnectivity import behavior.
**Architecture:** Keep mobile manual/plan storage stable and derive unsupported-depth review state from existing values plus optional watch contract metadata. Extend the watch sync contract from schema, regenerate outputs, and keep WatchConnectivity durable-inbox semantics: acknowledge invalid drops and successful imports only.
**Tech Stack:** Yarn 1 workspaces, React Native 0.85.3, TypeScript, Jest, SwiftUI watchOS, Xcode CLI, JSON Schema with generated TypeScript/Swift contract outputs.

---

## File Map

- `docs/superpowers/specs/2026-07-09-pre-device-depth-safety-sync-readiness-design.md`: accepted design source.
- `apps/mobile/src/utils/unsupported-depth.ts`: new shared mobile helper with `SUPPORTED_WATCH_DEPTH_LIMIT_METERS = 40`.
- `apps/mobile/__tests__/unsupported-depth.test.ts`: new helper tests for manual, plan, watch metadata, and sample fallback.
- `apps/mobile/src/screens/logbook/log-entry-editor.tsx`: max-depth helper warning below the depth wheel.
- `apps/mobile/src/screens/logbook/screen.tsx`: compact unsupported-depth marker in list rows.
- `apps/mobile/src/screens/logbook/log-entry-detail.tsx`: detail warning below max-depth review metrics.
- `apps/mobile/src/screens/planning/plan-mode-fields.tsx`: planned-depth helper warning below the depth wheel.
- `apps/mobile/src/screens/planning/plan-detail.tsx`: compact unsupported-depth marker in plan details.
- `apps/mobile/src/i18n/resources.ts`: Korean/English unsupported-depth strings.
- `apps/mobile/__tests__/logbook-manual-entry.test.tsx`: red tests for logbook warning, save behavior, list/detail markers.
- `apps/mobile/__tests__/planning-screen.test.tsx`: red tests for plan warning, save behavior, detail marker.
- `packages/contracts/schemas/watch-session.schema.json`: add optional `unsupportedDepth` and safety-stop `recommendationType`.
- `packages/contracts/fixtures/*.json`: update representative fixtures with optional fields.
- `packages/contracts/generated/typescript/index.ts`: regenerated output only.
- `packages/contracts/generated/swift/WatchContracts.swift`: regenerated output only.
- `apps/mobile/src/utils/watch-sync-message-validation.ts`: allow and parse `unsupportedDepth` and `recommendationType`.
- `apps/mobile/__tests__/watch-sync-message-validation.test.ts`: red tests for accepted/rejected unsupported-depth and recommendation metadata.
- `apps/mobile/src/utils/session-summary.ts`: helper fallback for unsupported-depth sample detection if needed.
- `apps/mobile/src/states/watch-connectivity-sync.tsx`: small import hardening only if red tests expose a gap.
- `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`: red tests for missing `payloadId`, open-to-ended import-key behavior, and manual drain path parity.
- `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`: watch model, sync payload, and sanitized persistence support for unsupported-depth plus recommendation metadata.
- `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`: expose current unsupported-depth state if UI needs a recorder-level value.
- `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`: compact watch warning when current depth exceeds 40m.
- `apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift`: remove `Required` user-facing safety-stop row.
- `apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift`: replace `Required` user-facing safety-stop row with recommendation-oriented row.
- `apps/mobile/ios/DiveWatchApp/Recording/SafetyStopController.swift`: encode `recommendationType: .recommended` and avoid “Stop not required” mandatory framing if needed.
- `apps/mobile/ios/DiveWatchApp/Localizable.xcstrings`: add watch strings, remove only unused required-facing strings if the file stays valid.
- `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`: red source-contract tests for watch warning, payload fields, and safety-stop wording.
- `.wiki/raw/...` and `.wiki/wiki/...`: wiki ingest/update after implementation, citing accepted design and changed source files.

## Step 1: Mobile Unsupported-Depth Helper

- [ ] Add failing tests in `apps/mobile/__tests__/unsupported-depth.test.ts`:
  - `SUPPORTED_WATCH_DEPTH_LIMIT_METERS` equals `40`.
  - Manual log with `manual.measuredValues.maxDepthMeters = 42.3` returns `{ exceeded: true, source: "manual", limitMeters: 40, maxDepthMeters: 42.3 }`.
  - Plan with `plannedValues.plannedMaxDepthMeters = 41` returns source `"planned"`.
  - Watch log uses explicit `watchCapture.session.unsupportedDepth` when present.
  - Watch log falls back to watch summary/samples when metadata is missing.
  - Depth exactly `40` does not exceed.
- [ ] Run red test: `yarn workspace @repo/mobile test unsupported-depth.test.ts`.
- [ ] Implement `apps/mobile/src/utils/unsupported-depth.ts` with small pure helpers:
  - `getUnsupportedDepthForLogEntry(entry: DiveLogEntry)`.
  - `getUnsupportedDepthForPlan(plan: DivePlan)`.
  - `getUnsupportedDepthForWatchSession(session: Pick<WatchSession, ...>)`.
- [ ] Run green test: `yarn workspace @repo/mobile test unsupported-depth.test.ts`.

## Step 2: Mobile Logbook And Planbook Warnings

- [ ] Add failing logbook tests in `apps/mobile/__tests__/logbook-manual-entry.test.tsx`:
  - Entering `42.3m` in manual editor shows `log-entry-editor-unsupported-depth-warning` and still saves.
  - A saved/manual entry above 40m shows `logbook-list-unsupported-depth-<site>` and `log-entry-detail-unsupported-depth-warning`.
  - A watch entry whose session metadata or samples exceed 40m shows the same list/detail markers.
- [ ] Add failing planning tests in `apps/mobile/__tests__/planning-screen.test.tsx`:
  - Entering planned max depth `42m` shows `planning-editor-unsupported-depth-warning` and still saves.
  - Plan detail shows `planning-detail-unsupported-depth-warning`.
- [ ] Run red tests:
  - `yarn workspace @repo/mobile test logbook-manual-entry.test.tsx`.
  - `yarn workspace @repo/mobile test planning-screen.test.tsx`.
- [ ] Update `apps/mobile/src/i18n/resources.ts` with subdued Korean/English strings:
  - Long editor/detail warning.
  - Compact marker: `Outside watch support` / `지원 수심 밖`.
- [ ] Update `LogEntryEditor`, `LogbookScreen`, `LogEntryDetail`, `PlanModeFields`, and `PlanDetail` using the helper. Keep existing `60m` wheel/schema limits unchanged.
- [ ] Run green tests:
  - `yarn workspace @repo/mobile test logbook-manual-entry.test.tsx`.
  - `yarn workspace @repo/mobile test planning-screen.test.tsx`.

## Step 3: Contract Schema And Runtime Validator

- [ ] Add failing tests in `apps/mobile/__tests__/watch-sync-message-validation.test.ts`:
  - Accept a watch session with `unsupportedDepth: { exceeded: true, limitMeters: 40, maxDepthMeters: 42.3, firstExceededAt: 1781352605 }`.
  - Reject unknown fields inside `unsupportedDepth`.
  - Reject non-boolean `unsupportedDepth.exceeded`.
  - Accept `safetyStop.recommendationType = "recommended"`.
  - Reject unknown `recommendationType`.
- [ ] Run red test: `yarn workspace @repo/mobile test watch-sync-message-validation.test.ts`.
- [ ] Update `packages/contracts/schemas/watch-session.schema.json`:
  - Add definition `unsupportedDepthRecord`.
  - Add optional root property `unsupportedDepth`.
  - Add optional `recommendationType` enum with `"recommended"` to `safetyStopRecord`.
- [ ] Update representative fixtures:
  - `packages/contracts/fixtures/scuba-safety-stop-watch-sync-message.json` with `recommendationType`.
  - `packages/contracts/fixtures/metadata-rich-watch-sync-message.json` with both `recommendationType` and an optional `unsupportedDepth` only if sample values are adjusted above 40m.
- [ ] Update `apps/mobile/src/utils/watch-sync-message-validation.ts`:
  - Add allowed keys.
  - Parse strict `unsupportedDepth`.
  - Parse optional `recommendationType`.
  - Add `recommendationType: "recommended"` to legacy scuba fallback.
- [ ] Run generation: `yarn check:quick`.
- [ ] Run green validator test: `yarn workspace @repo/mobile test watch-sync-message-validation.test.ts`.

## Step 4: Watch Unsupported-Depth Recording And Payload

- [ ] Add failing source-contract tests in `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`:
  - `DiveSessionRecord.swift` contains `supportedWatchDepthLimitMeters = 40`, `UnsupportedDepthRecord`, `unsupportedDepth`, `RecordUnsupportedDepthPayload`, and `firstExceededAt`.
  - `RecordingView.swift` contains `UnsupportedDepthWarning`, `currentDepthMeters > DiveDepthSupport.supportedWatchDepthLimitMeters`, and localized `Outside supported depth`.
  - Sync payload includes `unsupportedDepth = RecordUnsupportedDepthPayload(record: session.unsupportedDepth)`.
- [ ] Run red test: `yarn workspace @repo/mobile test watch-connectivity-native-source.test.ts`.
- [ ] Implement watch domain support:
  - Add `enum DiveDepthSupport { static let supportedWatchDepthLimitMeters = 40.0 }`.
  - Add `UnsupportedDepthRecord: Codable, Equatable`.
  - Add optional `unsupportedDepth` to `DiveSessionRecord`, defaulting legacy decode to `nil`.
  - In `sanitizedForPersistence()`, recompute unsupported-depth from safe samples plus payload max depth.
  - In `RecordWatchSessionPayload`, encode optional unsupported-depth object.
  - Add a compact `UnsupportedDepthWarning` view in `RecordingView.swift` and render it in live instruments when current depth exceeds 40m.
- [ ] Add localized watch string entries if generated by Xcode-style manual update is necessary.
- [ ] Run green source-contract test: `yarn workspace @repo/mobile test watch-connectivity-native-source.test.ts`.

## Step 5: Safety-Stop Recommendation Wording

- [ ] Add failing source-contract assertions:
  - `SummaryView.swift` and `SessionDetailView.swift` no longer contain `String(localized: "Required")`.
  - `RecordWatchSafetyStopPayload` contains `recommendationType`.
  - `SafetyStopRecord` has `recommendationType` defaulting to `.recommended`.
  - `SafetyStopController.swift` no longer displays `"Stop not required"`.
- [ ] Run red test: `yarn workspace @repo/mobile test watch-connectivity-native-source.test.ts`.
- [ ] Implement:
  - Add `SafetyStopRecommendationType` enum with `.recommended`.
  - Add `recommendationType` to `SafetyStopRecord`, `.legacyUnknown`, sanitizer, payload encoder, and previews.
  - Replace watch summary/detail `Required` row with either no row or `Recommendation` row.
  - Replace `"Stop not required"` with non-mandatory copy such as `"No reminder recorded"`.
- [ ] Run green source-contract test and validator fixture tests:
  - `yarn workspace @repo/mobile test watch-connectivity-native-source.test.ts`.
  - `yarn workspace @repo/mobile test watch-sync-message-validation.test.ts`.

## Step 6: WatchConnectivity Hardening Tests

- [ ] Add failing tests in `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`:
  - A valid subscription payload without `payloadId` imports and never calls acknowledgement functions.
  - Draining an open session and a later ended session keeps explicit import-key behavior: open row remains `localSessionId:open`, ended row becomes `localSessionId:<endedAt>`.
  - The Logbook manual `Sync Watch` button uses the same import path by asserting drained payload import, imported acknowledgement, and repository row update.
- [ ] Run red test: `yarn workspace @repo/mobile test watch-connectivity-sync.test.tsx`.
- [ ] Implement only if a red test exposes a behavior gap; otherwise keep production code unchanged and let tests document the current safe path.
- [ ] Run green test: `yarn workspace @repo/mobile test watch-connectivity-sync.test.tsx`.

## Step 7: Wiki Ingest And Documentation

- [ ] Read `.wiki/wiki/index.md` and touched articles:
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/domains/safety-rules.md`
  - `.wiki/wiki/domains/diving-app-scuba-mode.md`
  - `.wiki/wiki/domains/diving-app-non-negotiable-safety-rules.md`
- [ ] Create immutable raw source under `.wiki/raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md` citing user instruction, accepted design doc, and key source paths.
- [ ] Update the smallest relevant compiled wiki articles:
  - Move the 40m policy from open question to accepted preserve-plus-marker behavior.
  - Keep real underwater sensor behavior, auto-launch, haptics, background delivery, pairing, and pool validation unresolved.
  - Record that safety-stop UX is a recommendation-only non-certified reminder.
  - Record WatchConnectivity manual drain and automatic import share the same validated path.
- [ ] Update `.wiki/wiki/index.md` and append `.wiki/wiki/log.md`.

## Step 8: Verification And Merge

- [ ] Run focused tests:
  - `yarn workspace @repo/mobile test unsupported-depth.test.ts`.
  - `yarn workspace @repo/mobile test logbook-manual-entry.test.tsx`.
  - `yarn workspace @repo/mobile test planning-screen.test.tsx`.
  - `yarn workspace @repo/mobile test watch-sync-message-validation.test.ts`.
  - `yarn workspace @repo/mobile test watch-connectivity-sync.test.tsx`.
  - `yarn workspace @repo/mobile test watch-connectivity-native-source.test.ts`.
- [ ] Run contract and type/build gates:
  - `yarn check:quick`.
  - `yarn mobile:typecheck`.
  - `yarn workspace @repo/mobile watch:ui:check`.
  - `yarn watch:build`.
  - `yarn codex:check`.
- [ ] Inspect `git status --short` and `git diff --stat`.
- [ ] Commit the feature branch.
- [ ] Merge `feature/pre-device-depth-safety-sync` into `main` from `/Users/hongseongbin/Projects/diving-app`.
- [ ] Run a final sanity status check on `main` and report major changes, current status, and remaining concerns.

## Self-Review Checklist

- [ ] No generated contract output is edited before schema/generator changes.
- [ ] No depth value above 40m is rejected, clamped, or deleted solely because it is above 40m.
- [ ] Warning copy describes Apple Watch v1 support scope and review-only safety boundary.
- [ ] No UI copy claims certified dive computer, decompression, emergency, medical, or life-support behavior.
- [ ] WatchConnectivity acknowledgements remain after valid import or intentional invalid drop only.
- [ ] Wiki changes cite durable source material and keep unresolved real-device validation questions open.
