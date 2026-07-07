Source URL: user request, 2026-07-07; docs/superpowers/plans/2026-07-07-watch-debug-demo-sync-logbook-ux.md; apps/mobile/ios/DiveWatchApp; apps/mobile/src; packages/contracts/schemas/watch-session.schema.json
Collected: 2026-07-07
Published: Unknown

# Watch debug demo sync logbook UX

이 source는 2026-07-07 watch debug/demo, scuba safety-stop reminder, mobile logbook sync status, pressure metadata, badge styling 변경 뒤의 구현 결정과 사실을 보존한다.

관련 source path:

- `apps/mobile/ios/DiveMobile.xcodeproj/xcshareddata/xcschemes/DiveWatchAppDebug.xcscheme`
- `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- `apps/mobile/ios/DiveWatchApp/Sensors/DemoDepthSensorProvider.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/SafetyStopController.swift`
- `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
- `apps/mobile/src/utils/dive-log-sync-status.ts`
- `apps/mobile/src/states/watch-connectivity-sync.tsx`
- `apps/mobile/src/screens/logbook/log-entry-form-schema.ts`
- `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
- `apps/mobile/src/components/ui/instrument.tsx`
- `packages/contracts/schemas/watch-session.schema.json`

Watch debug/demo와 UX 결정:

- `DiveWatchAppDebug` shared scheme은 같은 watch target과 bundle identity로 debug controls를 노출한다. 새 watch target이 아니며 bundle identifier, signing, provisioning, entitlement를 바꾸지 않는다.
- Watch Home debug button인 `Test Freedive`와 `Test Scuba`는 DEBUG build에서 `DIVE_WATCH_DEBUG_CONTROLS=1`일 때만 존재한다.
- Debug/test session은 demo session과 같은 recording, store, sync path를 사용하고 기존 `captureMode: demo`로 serialize한다. Sync contract에 새 debug enum을 추가하지 않는다.
- Demo/debug session은 Digital Crown으로 제어하는 depth를 사용한다. `DemoDepthSensorProvider`는 controlled depth, pressure formula, generated water temperature로 sample을 만든다.
- Recording screen은 왼쪽 full-height depth gauge와 오른쪽 live value 영역을 사용한다. 이전 live metric card-style UI를 피한다.
- `End Dive`는 active depth에서 숨긴다. Surface depth가 `<= 1.0m`로 3초 안정된 뒤에만 보이고, 다시 `>= 1.2m`가 되면 숨긴다.

Scuba safety-stop reminder 결정:

- Air-only safety stop은 rule-based non-certified reminder로 유지한다.
- 현재 constant는 max depth 10m에서 arm, target 5m, displayed stop zone 3-6m, counting zone 2.7-6.3m, duration 180초, counting zone 밖 연속 30초 뒤 reset이다.
- Countdown은 counting zone 안에서만 누적한다.
- Safety stop 중 too-deep 상태가 되면 전용 safety-stop UI에서 벗어나 일반 scuba live instrument를 보여준다.
- 이 기능은 감압, tissue loading, gas safety, ascent permission, certified dive-computer calculation이 아니다.

Mobile logbook sync/status 결정:

- Cloud sync는 구현되어 있지 않다. Imported watch log는 현재 cloud `pending` 상태로 저장되고 표시된다.
- Native WatchConnectivity import acknowledgement는 future cloud sync와 분리한다. Payload는 local save 뒤 watch로 acknowledge될 수 있지만, mobile log는 여전히 pending cloud sync로 표시될 수 있다.
- `synced`는 future cloud sync를 위해 model type에 남아 있지만, 현재 visible non-local log는 pending으로 접는다.
- Demo capture log는 real watch log와 같은 방식으로 import/acknowledge되고 Logbook/detail에 남는다.
- Duplicate native payload는 acknowledge될 수 있지만 repository row는 dedupe된다.

Mobile UI/log detail 결정:

- Status badge는 primary-filled button-like pill이 아니라 low-chroma chip이다.
- Scuba pressure metadata는 start pressure와 end pressure를 지원한다.
- Edited watch-sourced scuba log는 사용자가 값을 제공했을 때 start/end pressure를 함께 표시한다.
- Pressure는 metadata로만 남는다. Air integration, gas remaining, reserve calculation, emergency instruction, gas management가 아니다.

Safety boundary:

- 이 앱은 supplemental recreational dive log와 companion recording tool이다.
- Certified dive computer, decompression computer, medical device, emergency system, gas management system, certified dive equipment replacement가 아니다.
