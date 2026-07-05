# Watch Freedive Segments And Scuba Safety Stop Design

## Context

Dive Watch is a supplemental recreational dive log and reminder tool. It is not a certified dive computer, decompression computer, medical device, emergency decision system, or life-support system.

The current watch app has a single `DiveSession` model, a `DiveSessionRecorder` that owns most recording state, and SwiftUI views that render one live recording surface. Freediving currently behaves like one session equals one dive. Scuba has a minimal safety stop countdown but does not model stop status, pause reasons, completion, or persistence.

This design upgrades the watch architecture, state model, sync contract, mobile import path, and watch UI so:

- A freediving session can contain multiple dive segments.
- Scuba mode has a rule-based recommended safety stop reminder/timer.
- The app never implies decompression safety, NDL, tissue loading, deco ceiling, gas planning, or "safe to ascend" decisions.
- Korean UI copy is first-class while the existing `.xcstrings` source language remains English.

## Decisions

- Scope: implement watch engines/UI, watch sync contract changes, generated TypeScript/Swift contracts, mobile validator/import/detail compatibility, migration adapters, and tests in one effort.
- Architecture: use mode-specific core models and engines with a common shell for storage, lists, summaries, and sync.
- Testing: add a real Swift XCTest target for watch engine tests.
- Safety stop settings: use centralized fixed defaults for this version: target 5m, duration 180 seconds, display zone 3m-6m, arm depth 10m.
- Depth provider: keep `MockDepthSensorProvider` as the recording default for this PoC. Real underwater sensor behavior remains a separate hardware validation task.
- Localization: keep English source keys in `.xcstrings`, add complete Korean translations for new user-facing strings.
- Visual direction: use Deep Blue gradient depth gauge with a Minimal Scale design. Safety stop overlays a clear rounded zone box on that scale.

## Goals

- Model freediving as a session with multiple dive segments and surface intervals.
- Show surface rest time prominently between freedive segments.
- Add a scuba safety stop reminder/timer that starts after a 10m or deeper dive and counts down only inside the accepted stop zone.
- Persist freedive segment metadata and scuba safety stop result in watch logs and sync payloads.
- Keep existing logs loadable through migration/adaptation.
- Move state transition logic out of SwiftUI views and into testable engines/controllers.
- Add unit tests for the freedive and safety stop state machines.
- Preserve the existing dark, rounded, blue-accent watch style while making underwater screens feel like instruments rather than card feeds.

## Non-Goals

- No decompression obligation, tissue loading, NDL, deco ceiling, gas switching safety, or gas planning.
- No "safe to ascend", "deco clear", "ceiling clear", "감압 완료", "상승 가능", "이제 안전합니다", or equivalent copy.
- No claim that Dive Watch replaces a certified dive computer.
- No real Apple Watch underwater sensor validation in this implementation.
- No new safety stop customization UI in this version.
- No unrelated mobile Logbook redesign.

## Relevant Files

- `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`
- `apps/mobile/ios/DiveWatchApp/Models/DiveSession.swift`
- `apps/mobile/ios/DiveWatchApp/Models/DepthSample.swift`
- `apps/mobile/ios/DiveWatchApp/Models/DiveSessionSummary.swift`
- `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/DiveFormatters.swift`
- `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
- `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
- `packages/contracts/schemas/watch-session.schema.json`
- `packages/contracts/generated/typescript/index.ts`
- `packages/contracts/generated/swift/WatchContracts.swift`
- `apps/mobile/src/utils/watch-sync-message-validation.ts`
- `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
- `apps/mobile/src/utils/session-summary.ts`
- `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
- `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`

## Architecture

The watch app should use mode-specific core logic behind a common session shell.

`DiveSessionRecorder` becomes an orchestration object. It subscribes to `DepthSensorProvider`, stores the shared sample stream, updates elapsed time, delegates mode-specific transitions, and returns a completed session record. It should not own freedive segmentation or safety stop rules directly.

New core units:

- `FreeDiveSessionEngine`
  - Owns freedive session state transitions.
  - Creates and closes `FreeDiveSegment` values.
  - Computes current surface interval, active segment metrics, session max depth, dive count, and longest segment.
- `ScubaDiveEngine`
  - Owns scuba active state, max depth, ascent-rate reference, and final scuba session payload.
  - Delegates safety stop countdown and pause/completion logic to `SafetyStopController`.
- `SafetyStopController`
  - Owns arm, active, paused, completed, skipped/incomplete, and remaining-time state.
  - Has no decompression or tissue-loading dependency.
- `DepthGaugeRail`
  - SwiftUI instrument component for live depth position.
  - Displays numeric depth alongside a visual scale. It does not replace numeric values.

Storage, list display, and sync use a common wrapper, such as `DiveSessionRecord`, with a mode-specific payload:

```swift
enum DiveSessionPayload: Codable {
    case freedive(FreeDiveSession)
    case scuba(ScubaDiveSession)
}
```

The exact Codable shape can be implemented as tagged structs if that better fits schema generation and migration.

## Data Model

The common session shell contains:

- `id`
- `schemaVersion`
- `diveMode`
- site, plan, buddy, gear, tags, notes, review metadata, sync status
- `startedAt`
- `endedAt`
- `samples`
- mode-specific payload

Scuba-specific fields such as `gasLabel` live in the scuba payload. During migration, old top-level `gasLabel` values map into `ScubaDiveSession.gasLabel`.

`FreeDiveSession` contains:

- `id`
- `startTime`
- `endTime`
- `totalDurationSeconds`
- `maxDepthMeters`
- `diveCount`
- `longestDiveDurationSeconds`
- `segments`
- optional notes/sync metadata if the surrounding shell does not already carry them

`FreeDiveSegment` contains:

- `id`
- `index`
- `startTime`
- `endTime`
- `durationSeconds`
- `maxDepthMeters`
- `minDepthMeters`
- `sampleStartIndex`
- `sampleEndIndex`
- `descentRateMetersPerSecond` when cheap to compute
- `ascentRateMetersPerSecond` when cheap to compute

Segments reference ranges in the session-level sample stream. They should not duplicate full sample arrays unless a future sync requirement forces that change.

`ScubaDiveSession` contains:

- `id`
- `startTime`
- `endTime`
- `durationSeconds`
- `maxDepthMeters`
- `averageDepthMeters`
- `waterTemperatureCelsius`
- `gasLabel`
- `latestAscentRateMetersPerMinute`
- `maxAscentRateMetersPerMinute`
- `safetyStop`

`SafetyStopRecord` contains:

- `status`
- `required`
- `completed`
- `targetDepthMeters`
- `minDepthMeters`
- `maxDepthMeters`
- `durationSeconds`
- `startedAt`
- `completedAt`
- `remainingSeconds`
- `timeInZoneSeconds`

`SafetyStopStatus` values:

- `unknown`
- `notRequired`
- `armed`
- `active`
- `pausedTooDeep`
- `pausedTooShallow`
- `completed`
- `skippedOrIncomplete`

`unknown` exists for legacy scuba logs that do not have a safety stop record.

## Sync Contract

`packages/contracts/schemas/watch-session.schema.json` should become mode-aware. The preferred JSON shape is one common top-level object with `diveMode` and one nested mode payload:

```json
{
  "localSessionId": "uuid",
  "schemaVersion": 2,
  "diveMode": "freedive",
  "startedAt": 1783225525,
  "endedAt": 1783225725,
  "samples": [],
  "freedive": {
    "diveCount": 3,
    "maxDepthMeters": 22.1,
    "longestDiveDurationSeconds": 46,
    "segments": []
  }
}
```

```json
{
  "localSessionId": "uuid",
  "schemaVersion": 2,
  "diveMode": "scuba",
  "startedAt": 1783225525,
  "endedAt": 1783228045,
  "samples": [],
  "scuba": {
    "gasLabel": "Air",
    "maxDepthMeters": 21.2,
    "averageDepthMeters": 12.4,
    "waterTemperatureCelsius": 24,
    "safetyStop": {
      "status": "completed",
      "required": true,
      "completed": true,
      "targetDepthMeters": 5,
      "minDepthMeters": 3,
      "maxDepthMeters": 6,
      "durationSeconds": 180,
      "remainingSeconds": 0
    }
  }
}
```

The schema must require the matching nested payload for the selected `diveMode`. Generated TypeScript and Swift outputs must be regenerated, not edited by hand.

The mobile runtime validator should reject malformed mode payloads and unknown additional fields in new watch sync messages. Legacy local data is handled by adapters, not by loosening the new sync contract.

## Freedive State Machine

States:

- `freeIdle`
- `freeSurfaceReady`
- `freeDiveActive`
- `freeSurfaceInterval`
- `freeSummary`

Session start moves to `freeSurfaceReady`. No segment is created at this point.

A segment starts only when depth is greater than `diveStartDepthThreshold` and descent is sustained for the configured duration. A wet watch or shallow water noise near the surface must not start a segment.

A segment closes only when depth returns near the surface and remains stable for the surface confirmation duration.

After a segment closes, the engine moves to `freeSurfaceInterval`. Current surface interval is computed from the previous segment end time to now. A second sustained descent creates the next `FreeDiveSegment` inside the same `FreeDiveSession`.

Manual session end finalizes the open segment if needed and produces `freeSummary`.

Default configuration:

- `diveStartDepthThreshold`: 1.2m
- `surfaceDepthThreshold`: 0.8m
- `sustainedDescentDuration`: 3 seconds
- `surfaceConfirmDuration`: 4 seconds

These values must live in a central `FreeDiveSegmentationConfiguration`.

## Scuba Safety Stop State Machine

Scuba recording starts in `scubaActive`.

If max depth reaches at least 10m, the safety stop becomes `armed`. When the diver ascends into the stop zone and remains stable long enough, the controller enters `active`.

Inside accepted counting tolerance, the timer counts down. Too deep or too shallow pauses the timer and records a clear status. Re-entering the zone resumes from the remaining time. Timer reaching zero marks `completed`. Surfacing before completion marks `skippedOrIncomplete`.

Default `SafetyStopConfiguration`:

- `armDepthMeters`: 10
- `targetDepthMeters`: 5
- `displayMinDepthMeters`: 3
- `displayMaxDepthMeters`: 6
- `countingMinDepthMeters`: 2.7
- `countingMaxDepthMeters`: 6.3
- `durationSeconds`: 180
- `stableTransitionDuration`: 2 seconds

The controller must not compute NDL, decompression obligation, tissue loading, ceilings, or safe ascent decisions.

## Watch UI

Home should work as a launchpad:

- Header: `Dive Watch`
- Compact safety positioning: `보조 로그 · 안전계산 없음`
- Primary action: `스쿠버 시작`
- Scuba subtext: `Air · Stop 5m/3:00`
- Secondary action: `프리 세션 시작`
- Selected/active plan summary if present
- Recent log summary
- Settings/sync status below higher priority actions

Live underwater screens should use full-screen instrument layouts, not scrollable card feeds.

Freedive:

- Surface ready: dominant timer/surface state, count 0, instruction that descent starts recording automatically.
- Dive active: dominant current depth and current dive time, smaller max depth and ascent/descent rate.
- Surface interval: dominant surface rest time, last segment duration/depth, session max, count. Shallow current depth must not dominate this screen.
- Summary: total session time, dive count, max depth, longest dive, recent segment list, saved/sync state.

Scuba:

- Active: current depth, elapsed time, max depth, ascent rate, temperature, compact `안전계산 없음`.
- Safety stop: takes over the main live screen. It is not a small row.
- Inside zone: `권장 스탑 · 보조 기능`, `3-6m 구간 내`.
- Too deep: `정지 구간보다 깊음`, `타이머 일시정지`.
- Too shallow: `정지 구간보다 얕음`, `타이머 일시정지`.
- Complete: `권장 스탑 완료`, `천천히 상승`, `안전계산 없음`.

Depth gauge:

- Use a Deep Blue gradient from lower depth to deeper depth.
- Use the selected Minimal Scale style: thin vertical scale, outside ticks, white chevron, blue glow dot.
- Keep the numeric depth larger than the gauge.
- In safety stop mode, overlay a rounded rectangular `3m-6m` stop-zone box on the same minimal scale.
- Mark the 5m target with a subtle line or tick inside the box.
- Do not rely on color alone. Ticks, labels, marker, and status text must carry meaning.

## Localization And Copy

Keep `.xcstrings` source language as English and provide Korean translations for all new strings.

Preferred Korean copy:

- `보조 로그`
- `안전계산 없음`
- `인증 다이브 컴퓨터 아님`
- `권장 세이프티 스탑`
- `스탑 리마인더`
- `정지 구간 내`
- `타이머 일시정지`
- `권장 스탑 완료`
- `수면 휴식`
- `프리 세션`
- `다이브 #01`

Forbidden copy:

- `안전 확보`
- `상승 가능`
- `이제 안전합니다`
- `감압 완료`
- `deco clear`
- `ceiling clear`
- `safe to ascend`

## Mobile Import And Log Detail

`watch-sync-message-validation.ts` becomes mode-aware:

- `diveMode = freedive` requires `freedive`.
- `diveMode = scuba` requires `scuba`.
- Malformed mode payloads fail validation.
- New payloads preserve raw samples.

`watch-session-to-dive-log-entry.ts` keeps common watch measured values and adds mode-specific preserved data:

- Freedive: segment count, segment list, surface intervals, longest segment, session max depth.
- Scuba: safety stop required/completed/status, remaining time, start/completion timestamps, time in zone if present.

Mobile Logbook detail remains sample-profile based for common review and adds mode-specific sections:

- Freedive section: `프리 세션`, dive count, longest dive, segment list, surface interval values.
- Scuba section: `권장 세이프티 스탑`, completed/incomplete/not required/unknown status, remaining time if incomplete.

Existing mobile logs without the new payload should still display through sample-based summary fallbacks. New watch sync messages should use the new contract.

## Migration And Backward Compatibility

Watch local persistence should first read the new record shape. If unavailable, it should attempt to decode the old `[DiveSession]` storage and adapt each session:

- Old freedive session becomes `FreeDiveSession` with one segment derived from the old session start/end and samples.
- Old scuba session becomes `ScubaDiveSession` with `SafetyStopRecord.status = unknown` unless a reliable old safety stop status exists.
- Existing samples remain unchanged.
- Existing log display should not break.

No destructive local reset is part of this design.

## Testing

Add `DiveWatchAppTests` to `apps/mobile/ios/DiveMobile.xcodeproj`.

Swift unit tests:

- `FreeDiveSessionEngineTests`
  - Starting a free session creates no segment until meaningful descent.
  - Crossing the start threshold with sustained descent starts Dive #1.
  - Returning to surface closes Dive #1.
  - A second descent creates Dive #2 in the same session.
  - Surface interval timer is computed correctly.
  - Shallow water or wet watch noise does not create fake dives.
  - Manual end finalizes the session.
- `SafetyStopControllerTests`
  - Max depth below 10m means safety stop is not required.
  - Max depth at or above 10m arms the stop.
  - Entering 3m-6m starts the countdown.
  - Staying inside the zone decrements the timer.
  - Going deeper pauses the timer.
  - Going shallower pauses the timer.
  - Re-entering resumes the timer.
  - Countdown reaching zero marks completed.
  - Surfacing before completion marks skipped/incomplete.
  - Status text never exposes banned safety phrases.
- `ScubaDiveEngineTests`
  - Engine integrates max depth, ascent rate, and safety stop record.
- `DiveSessionRecordMigrationTests`
  - Old freedive logs adapt to one segment.
  - Old scuba logs adapt with unknown safety stop status.

Mobile tests:

- Contract generation output changes compile through TypeScript.
- Runtime validator accepts valid freedive and scuba payloads.
- Runtime validator rejects missing or mismatched mode payloads.
- Import adapter preserves segments and safety stop metadata.
- Log detail renders mode-specific sections.
- Source scan rejects banned safety copy.

SwiftUI previews or fixture states:

- Free surface ready
- Free dive active
- Free surface interval
- Scuba active
- Safety stop inside zone
- Safety stop too deep
- Safety stop too shallow
- Stop complete

## Verification

Run the smallest relevant gates first:

- `yarn check:quick`
- Swift XCTest command for `DiveWatchAppTests`
- `yarn workspace @repo/mobile test`
- `yarn mobile:typecheck`
- `yarn watch:build`
- `yarn workspace @repo/mobile watch:ui:check`
- `yarn codex:check`

Only commands actually run should be reported as passing.

## Risks And Assumptions

- Xcode project editing is required to add the watch test target. This is higher-risk than code-only tests.
- The JSON schema generator may not produce ideal discriminated union types from a complex schema. If needed, use a generator-friendly nested payload shape while preserving the product model.
- The first implementation uses mock depth input. Real Apple Watch underwater behavior remains unverified.
- Safety stop is a recommended reminder, not a safety guarantee.
- Depth gauge rendering must be checked on actual watch simulator sizes because text overlap is easy on small displays.
- Mobile detail should avoid over-designing analysis views; detailed planning and deep review remain iPhone responsibilities.

## Acceptance Criteria

- A freediving session can contain multiple dive segments.
- Surface interval is shown prominently between freedives.
- Scuba mode has a safety stop reminder/timer.
- Safety stop is triggered after a dive deeper than the configured threshold.
- Timer only counts down in the stop zone.
- Timer pauses when too deep or too shallow.
- Completion says `권장 스탑 완료`, not a safety guarantee.
- The app never claims to be a certified dive computer.
- Existing logs are not broken.
- Core logic is testable with simulated depth samples.
- Watch live screens include numeric depth plus a Deep Blue Minimal Scale depth gauge.
