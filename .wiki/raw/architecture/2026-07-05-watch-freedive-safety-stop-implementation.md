Source URL: docs/superpowers/specs/2026-07-05-watch-freedive-segments-scuba-safety-stop-design.md; docs/superpowers/plans/2026-07-05-watch-freedive-segments-scuba-safety-stop.md; apps/mobile/ios/DiveWatchApp; packages/contracts/schemas/watch-session.schema.json; apps/mobile/src/utils/watch-sync-message-validation.ts
Collected: 2026-07-05
Published: Unknown

# Watch freedive segments and scuba safety stop implementation

This source captures the repository implementation state after the watchOS freedive/scuba recording upgrade on 2026-07-05.

Relevant source paths:

- `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/FreeDiveSessionEngine.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/SafetyStopController.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/ScubaDiveEngine.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`
- `apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift`
- `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift`
- `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
- `packages/contracts/schemas/watch-session.schema.json`
- `packages/contracts/scripts/generate-typescript.mjs`
- `apps/mobile/src/utils/watch-sync-message-validation.ts`
- `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
- `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
- `apps/mobile/scripts/check-watch-ui-language.mjs`

Implemented watch architecture:

- Watch local session storage now centers on `DiveSessionRecord`, a common session shell with mode-specific payloads.
- `DiveSessionPayload` distinguishes `freedive` and `scuba`.
- Legacy watch `DiveSession` records remain decodable and are adapted into `DiveSessionRecord`. Old freedive sessions become a single `FreeDiveSegment`. Old scuba sessions default safety stop data to unknown or not required instead of corrupting old logs.
- `DepthSample` remains the shared watch sample type.
- Recording state transitions live in pure Swift engines/controllers rather than in SwiftUI views.
- `FreeDiveSessionEngine` owns freedive session segmentation.
- `SafetyStopController` owns scuba safety stop reminder state and countdown.
- `ScubaDiveEngine` owns scuba sample aggregation and delegates stop state to `SafetyStopController`.
- SwiftUI views render snapshots and mode-specific records.

Implemented freedive behavior:

- A freedive session can contain multiple `FreeDiveSegment` records.
- A segment starts only after meaningful sustained descent beyond the configured threshold.
- Shallow/wet-watch noise near the surface does not create fake dives.
- Returning near the surface for the configured confirmation duration closes the active segment.
- A later descent creates the next segment inside the same `FreeDiveSession`.
- Current surface interval is computed from the previous segment end to the current time and is shown as the dominant value during the surface interval state.
- Session summary includes total time, dive count, max depth, longest segment, and segment list/profile information where available.

Implemented scuba safety stop behavior:

- This is a rule-based safety stop reminder/timer, not a decompression model.
- If scuba max depth reaches the configured arm threshold, the safety stop is armed.
- The default reminder target is 5 m for 180 seconds, with a displayed stop zone of 3 m to 6 m.
- Countdown only accrues while depth is inside the accepted zone.
- Too deep and too shallow states pause the timer.
- Re-entering the zone resumes countdown.
- Completion status is recorded as completed.
- Surfacing before completion records skipped or incomplete status.
- The log preserves whether a stop was required, whether it completed, stop start/completion time, remaining time, max depth, and time in zone.

Implemented watch UI behavior:

- Home is a launchpad focused on starting scuba and free sessions.
- Scuba start copy frames the feature as a stop reminder with no safety calculation.
- Freedive live states render surface ready, active segment, surface interval, and summary.
- Scuba live state renders current depth, time, max depth, ascent rate, temperature, and compact non-certified safety copy.
- Safety stop state takes over the main live instrument when active, paused, or complete.
- A `DepthGaugeRail` shows current depth with a deep-blue depth gradient and a boxed stop zone when applicable.
- SwiftUI debug previews cover free surface ready, free active, free surface interval, scuba active, safety stop inside zone, safety stop too deep, safety stop too shallow, and stop complete.

Implemented sync and mobile behavior:

- `packages/contracts/schemas/watch-session.schema.json` is mode-aware and enforces matching nested payloads.
- Generated TypeScript contracts are post-processed into a stricter `WatchSession` discriminated union.
- Mobile runtime validation rejects mismatched mode payloads.
- Mobile import preserves mode-specific freedive segment metadata and scuba safety stop metadata in `watchCapture.session`.
- Mobile log detail renders freedive segment and scuba safety stop sections.

Safety copy guard:

- `apps/mobile/scripts/check-watch-ui-language.mjs` scans active watch Swift source and `Localizable.xcstrings` for banned safety guarantee phrases.
- Banned copy includes `safe to ascend`, `상승 가능`, `이제 안전합니다`, `안전 확보`, `감압 완료`, `deco clear`, and `ceiling clear`.
- Allowed copy frames the app as supplemental logging and reminder behavior: `보조 로그`, `안전계산 없음`, `인증 다이브 컴퓨터 아님`, `권장 세이프티 스탑`, `스탑 리마인더`, `권장 스탑 완료`.

Verification state on 2026-07-05:

- `yarn check:quick` passed.
- `yarn mobile:typecheck` passed.
- `yarn workspace @repo/mobile test` passed 227 tests.
- `yarn workspace @repo/mobile watch:ui:check` passed.
- `yarn watch:build` passed.
- `xcodebuild -project apps/mobile/ios/DiveMobile.xcodeproj -scheme DiveWatchAppTests -configuration Debug -destination 'platform=watchOS Simulator,name=Apple Watch Series 11 (46mm)' -derivedDataPath /private/tmp/DiveWatchAppTestsDerivedData CODE_SIGNING_ALLOWED=NO test` passed 44 tests.
- `yarn codex:check` passed.

Remaining validation limits:

- The watch recording flow still uses mock/simulated depth input in this repository state.
- `RealDepthSensorProvider` remains a real-device integration boundary.
- Apple Watch underwater sensor behavior, wet controls, haptics, readability, and WatchConnectivity paired-device/background delivery still need support-hardware validation.
- The app remains a supplemental dive log and reminder tool, not a certified dive computer, decompression computer, medical device, emergency system, or certified equipment replacement.
