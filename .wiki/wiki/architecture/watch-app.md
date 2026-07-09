# Watch 앱 구조

Sources: pre-Karpathy wiki page, 2026-06-28; Diving App repository implementation, 2026-07-05; Diving App repository implementation, 2026-07-07; pre-device depth safety sync readiness implementation, 2026-07-09
Raw: [Pre-Karpathy: Watch 앱 구조](../../raw/architecture/watch-app.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md); [Watch real-device readiness and explicit demo mode](../../raw/architecture/2026-07-05-watch-real-device-readiness.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md); [Pre-device depth safety sync readiness](../../raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md)
Updated: 2026-07-09

## 요약

`apps/mobile/ios/DiveWatchApp`는 현재 동작하는 SwiftUI watchOS companion 앱 source를 담는다. Xcode project는 `apps/mobile/ios/DiveMobile.xcodeproj`이고, watch target과 기본 scheme은 `DiveWatchApp`이다. `DiveWatchAppDebug`는 같은 target과 bundle identity를 쓰는 shared debug scheme이며, DEBUG 환경에서만 watch Home의 테스트 시작 control을 연다. Watch 기록은 공통 session shell과 `freedive`/`scuba` mode-specific payload로 나뉘며, freedive 세션은 여러 dive segment를 담을 수 있고 scuba는 rule-based safety stop reminder 상태를 기록한다. Watch recording은 현재 수심이 Apple Watch 기반 지원 범위인 40m를 넘으면 restrained unsupported-depth warning을 보여주고, 저장/sync payload에는 optional unsupported-depth metadata를 포함한다. 실기기 기록 경로는 `CMWaterSubmersionManager` 기반 real sensor provider를 사용하고, fake sample은 명시적인 demo/debug mode에서만 쓴다.

## 현재 상태

현재 watch 앱 source는 `apps/mobile/ios/DiveWatchApp`이다. App entry는 `DiveSessionStore`를 만들고 `HomeView`를 render한다. 저장 model은 `DiveSessionRecord`이며 legacy `DiveSession`은 decode 후 record로 adapter된다.

Watch 앱은 더 이상 별도 Yarn workspace나 standalone Xcode project를 사용하지 않는다. iPhone app 설치와 함께 배포될 companion embed 구조를 유지하기 위해 watch target membership은 `apps/mobile/ios/DiveMobile.xcodeproj`에서 관리한다.

`DiveWatchAppDebug` scheme은 debug controls를 노출하기 위한 실행 환경만 다르게 둔다. 별도 watch target을 만들지 않고, bundle identifier, signing, provisioning, entitlement도 바꾸지 않는다.

## 상세

현재 source 영역은 다음과 같다.

- `Models`: `DepthSample`, legacy `DiveSession`, `DiveSessionRecord`, `DiveSessionPayload`, `FreeDiveSession`, `FreeDiveSegment`, `ScubaDiveSession`, `SafetyStopRecord`, `DiveSessionSummary`, sync payload helper, dive mode, water condition, sync status, pre-dive plan, location type.
- `Sensors`: `DepthSensorProvider`, `MockDepthSensorProvider`, `RealDepthSensorProvider`, `DemoDepthSensorProvider`, `DepthSensorAvailability`.
- `Recording`: `DiveSessionRecorder`, `FreeDiveSessionEngine`, `SafetyStopController`, `ScubaDiveEngine`.
- `Storage`: `DiveSessionStore`.
- `Sync`: `WatchSyncEnvelope`, `WatchSyncTransport`.
- `Views`: home, recording, summary, saved session, detail view, formatter, `DepthGaugeRail`, 재사용 watch UI.

현재 watch flow는 다음과 같다.

1. Home은 로그 브라우저보다 launchpad 역할을 우선한다. `scuba`와 `freedive`만 active mode로 두고, 스쿠버 시작과 프리 세션 시작을 주요 action으로 보여준다. 스쿠버 시작 copy는 stop reminder 범위로 제한한다. Watch Home은 watch-side plan 생성/편집을 제공하지 않고, 모바일에서 전달된 실행하지 않은 planned dive를 선택해 현재 plan에 반영한다. DEBUG build에서 `DIVE_WATCH_DEBUG_CONTROLS=1`이면 `Test Freedive`와 `Test Scuba` 버튼이 추가되며, 이 버튼은 `.debugTest` recording mode로 들어간다. 사용자가 선택한 mode는 `UserDefaults`에 선호 다이빙 형태로 저장되고, 아직 선택한 적이 없거나 제거된 legacy mode를 읽으면 `.scuba`를 fallback으로 사용한다.
2. Home은 `RealDepthSensorProvider`를 통해 자동 시작을 감시한다. 수심 sample이 3m 이상이면 현재 pre-dive plan으로 `RecordingView`를 열어 기록을 시작한다. 이 동작은 기록 편의를 위한 trigger이며 safety 판단이 아니다.
3. `RecordingView`가 나타나면 기록이 자동으로 시작된다. 일반 real recording은 `RealDepthSensorProvider`를 사용하고, 명시적인 demo/debug action만 `DemoDepthSensorProvider`를 사용한다. Demo/debug recording은 Digital Crown으로 controlled depth를 조절하고, provider가 수심 기반 압력과 생성된 수온 sample을 만든다. 저장 record와 sync payload에는 기존 `captureMode: demo`가 남아 모바일 review에서도 demo capture를 구분할 수 있다. Debug/test 전용 enum은 sync contract에 추가하지 않는다.
4. Recorder는 sample, current depth, max depth, water temperature, elapsed time을 공통으로 추적하고, mode별 상태 전이는 pure Swift engine에 위임한다. `FreeDiveSessionEngine`은 sustained descent와 surface confirmation threshold로 segment 시작/종료를 결정한다. `ScubaDiveEngine`은 sample summary와 ascent rate를 추적하고 `SafetyStopController`를 통해 stop reminder 상태를 갱신한다. SwiftUI는 snapshot을 렌더링한다.
5. Freedive recording 화면은 surface ready, active segment, surface interval, summary 상태를 구분한다. Active segment에서는 현재 수심과 현재 dive time이 가장 크고, surface interval에서는 수면 휴식 시간이 가장 크다. 같은 freedive session 안에서 두 번째 하강은 새 `FreeDiveSegment`를 만들며 새 session을 만들지 않는다.
6. Recording 화면은 full-height left depth gauge와 오른쪽 live value 영역을 기본 구조로 삼고, live metric을 card처럼 반복하지 않는다. Scuba recording 화면은 수심 최우선 계기판형으로 현재 수심, 경과 시간, 최대 수심, 상승 속도 참고값, 수온을 보여준다. 현재 수심이 `DiveDepthSupport.supportedWatchDepthLimitMeters`인 40m를 넘으면 `Outside supported depth` warning을 표시한다. 이 상태는 지원 범위 밖 marker이며 상승 지시, 비상 판단, 인증된 dive-computer warning이 아니다. Safety stop이 active, paused-too-shallow, completed 상태면 safety stop instrument가 live screen을 차지하고, 3-6m stop zone과 현재 수심을 `DepthGaugeRail`에도 표시한다. Too-deep 상태는 전용 safety-stop UI에서 빠져 일반 scuba live instrument를 보여준다. Stop zone 이탈은 설명 문구 대신 경고성 visual band로 표시한다.
7. 기록을 끝내면 post-dive rating, exertion, visibility를 별점 컨트롤로 남기고, water condition과 note field가 있는 summary를 보여준다. Summary와 detail은 freedive segment list와 scuba safety stop 상태를 mode별로 보여준다. Scuba safety stop summary/detail은 `Required`가 아니라 recommendation wording을 사용한다.
8. 저장된 세션은 file-backed `DiveSessionStore`에 저장되고 list/detail view에서 확인한다.
9. `DiveSessionStore`는 저장 시 `WatchSyncTransport`를 통해 `DiveSessionRecord.syncMessageData()` 결과를 WatchConnectivity `transferUserInfo` envelope로 enqueue한다. `WCSession.isReachable`이면 같은 payload를 `sendMessage`로도 보낸다. activation 완료와 reachability 변경 시 아직 `synced`가 아닌 저장 세션을 다시 enqueue한다. WatchConnectivity transfer 오류가 나면 저장된 세션의 `syncStatus`를 `failed`로 갱신하고, 모바일 앱이 repository import 뒤 보낸 `watchSyncAcknowledgement`를 받으면 `synced`로 갱신한다.
10. 모바일 계획에서 시작한 세션은 `plan-<localId>` tag로 source plan을 보존하고, 저장 후 해당 planned dive를 watch Home에서 숨긴다.

`End Dive` 버튼은 active depth에서 숨긴다. 수심이 `<= 1.0m`로 3초 이상 안정되면 버튼이 보이고, 다시 `>= 1.2m`로 내려가면 버튼을 숨겨 수중에서 실수로 종료하지 않도록 한다. 이 gate는 기록 UX 제어일 뿐 안전 판단이 아니다.

Scuba safety-stop reminder의 현재 rule constant는 max depth 10m에서 arm, target 5m, displayed zone 3-6m, counting zone 2.7-6.3m, duration 180초, counting zone 밖 연속 30초 뒤 reset이다. 이는 non-certified reminder/timer이며 감압, 조직 loading, gas safety, 상승 허가 계산이 아니다.

Watch session record는 samples와 mode-specific payload에서 40m 초과 여부를 계산해 optional `UnsupportedDepthRecord`를 저장한다. Sync payload도 `unsupportedDepth` object를 포함할 수 있으며, 이는 모바일 review에서 unsupported-depth marker를 그리기 위한 metadata다. Raw sample은 보존하고, 40m 초과 값을 40m로 clamp하지 않는다.

모바일에서 전달된 planned dive는 `watchPlannedDives` envelope의 JSON으로 수신된다. `WatchSyncTransport`는 `didReceiveApplicationContext`와 `didReceiveMessage` 양쪽에서 이를 처리하고, `WCSession` activation 완료 시 `receivedApplicationContext`도 다시 읽는다. `DiveSessionStore`는 `savedWatchPlannedDives`와 `executedWatchPlanIds`를 `UserDefaults`에 저장한다. 실행 전 planned dive는 watch Home에서 선택하며, 실행된 plan id는 이후 planned dive 목록에서 제외한다.

`RealDepthSensorProvider`는 `CMWaterSubmersionManager` delegate를 사용해 underwater depth/pressure sample을 받는다. Watch target `Info.plist`에는 `NSMotionUsageDescription`과 `WKBackgroundModes`의 `underwater-depth`가 들어가며, Home은 `WKExtendedRuntimeSession.requestAutoLaunchAuthorizationStatus` 결과를 표시한다. 실제 underwater sensor behavior, auto-launch prompt, haptics, wet control, readability는 지원되는 Apple Watch Ultra hardware에서 수동 검증이 필요하다. Store-level Ultra-only install filtering은 App Store/TestFlight 검증이 남아 있으며, 현재 code boundary는 `waterSubmersionAvailable` runtime gate와 watch target metadata로 지원 범위를 제한한다.

watch 앱은 local Swift model과 동기화 가능한 JSON을 만들기 위한 `DiveSessionRecord.syncMessageData` encoder를 갖는다. WatchConnectivity 전송 PoC는 이 encoder 결과를 base64 payload로 감싸며, generated Swift contract를 직접 compile하지 않는다. `packages/contracts/generated/swift` 아래 generated Swift contract는 현재 Xcode project에서 참조되지 않는다. `SafetyStopRecord`는 compatibility를 위해 `required`를 encode/decode하지만, v1 payload 의미는 `recommendationType: "recommended"`로 표현한다.

WatchConnectivity 전송 PoC는 build 가능한 code boundary이며, companion embed 구조도 Xcode project에 포함되어 있다. Watch local session status는 `didFinishUserInfoTransfer`의 오류 callback과 모바일 import acknowledgement 수신을 통해 갱신된다. 활성 simulator에서 watch-to-mobile import와 mobile-to-watch acknowledgement는 확인됐지만, entitlement, background delivery, 장시간 retry behavior, 실기기 paired iPhone 전달은 아직 지원 hardware에서 검증되지 않았다.

Watch `DiveMode`는 현재 `scuba`와 `freedive` 두 모드로 축소됐다. Scuba recording 화면은 현재 수심, 경과 시간, 최대 수심, 상승 속도 참고값, 세이프티 스톱 리마인더 상태, 비인증 참고 문구를 보여준다. Freedive recording 화면은 현재 수심, active dive time, 수면 휴식, 최대 수심, segment count를 중심으로 구성하고 scuba-only gas/safety-stop 정보는 숨긴다.

Watch UI safety copy는 `check-watch-ui-language.mjs`로 guard한다. Active watch Swift source와 `Localizable.xcstrings`에 `safe to ascend`, `상승 가능`, `이제 안전합니다`, `안전 확보`, `감압 완료`, `deco clear`, `ceiling clear` 같은 safety guarantee 표현이 들어가면 `watch:ui:check`가 실패한다.

## 관련 문서

- [동기화 흐름 구조](sync-flow.md)
- [다이브 로그 도메인](../domains/dive-log.md)
- [안전 규칙](../domains/safety-rules.md)
- [Mobile/Watch UI 언어](../design/mobile-watch-ui-language.md)
- [열린 질문](../questions/open-questions.md)
