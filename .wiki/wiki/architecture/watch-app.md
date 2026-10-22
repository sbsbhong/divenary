# Watch 앱 구조

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Watch underwater runtime lifecycle implementation and device boundary, 2026-07-18; Watch live ascent-rate smoothing boundary, 2026-07-18; Watch 기록 내구성과 경로 복구 경계, 2026-07-18; Watch callback, retry, re-entry, navigation hardening, 2026-07-18; 워치 UX 리뷰 3종 및 소유자 백로그 승인, 2026-10-22
Raw: [Pre-Karpathy: Watch 앱 구조](../../raw/architecture/watch-app.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Watch underwater runtime lifecycle implementation and device boundary](../../raw/architecture/2026-07-18-watch-underwater-runtime-lifecycle.md); [Watch live ascent-rate smoothing boundary](../../raw/architecture/2026-07-18-watch-live-ascent-rate-smoothing.md); [Watch 기록 내구성과 경로 복구 경계](../../raw/architecture/2026-07-18-watch-recording-durability-and-route-recovery.md); [Watch callback, retry, re-entry, navigation hardening](../../raw/architecture/2026-07-18-watch-callback-retry-reentry-navigation.md); [2026-10-22 워치 UX 리뷰와 소유자 백로그 승인](../../raw/design/2026-10-22-watch-ux-review.md)
Sources: Mobile-authoritative Watch log deletion implementation and physical verification, 2026-08-02; Watch Wet Ready and automatic local save, 2026-09-01; 2026-10-21 프로젝트 리뷰 후속 수정 경계, 2026-10-21
Raw: [Mobile-authoritative Watch log deletion implementation and physical verification](../../raw/architecture/2026-08-02-mobile-authoritative-watch-log-deletion.md); [Watch Wet Ready and automatic local save](../../raw/architecture/2026-09-01-watch-wet-ready-auto-save.md); [2026-10-21 프로젝트 리뷰 후속 수정 경계](../../raw/architecture/2026-10-21-review-remediation.md)
Sources: 2026-10-22 성능 정리와 플랫폼 중립 Watch link 경계, 2026-10-22
Raw: [2026-10-22 성능 정리와 플랫폼 중립 Watch link 경계](../../raw/architecture/2026-10-22-performance-and-watch-link-boundary.md)
Sources: 2026-10-22 로그북 페이지 로딩, 저장 형식 정리, 폰-워치 메시지 contract, 2026-10-22
Raw: [2026-10-22 로그북 페이지 로딩, 저장 형식 정리, 폰-워치 메시지 contract](../../raw/architecture/2026-10-22-logbook-paging-and-contract-messages.md)
Sources: 2026-10-22 모바일·워치 UI/UX 개편, 2026-10-22
Raw: [2026-10-22 모바일·워치 UI/UX 개편](../../raw/design/2026-10-22-ui-ux-overhaul.md)
Sources: 워치 복구·실시간 값 후속 리뷰와 현재 구현, 2026-10-22
Raw: [워치 복구·실시간 값 후속 리뷰](../../raw/architecture/2026-10-22-watch-review-recovery-and-live-values.md)
Sources: 워치 수정 커밋 2df2bd1·90d3874와 현재 코드 대조, 2026-10-22
Raw: [2026-10-22 워치 기록 정확도와 화면 흐름 수정](../../raw/architecture/2026-10-22-watch-accuracy-and-flow-fixes.md)
Updated: 2026-10-22

## 요약

`apps/mobile/ios/DivenaryWatchApp`는 `apps/mobile/ios/Divenary.xcodeproj`의 `DivenaryWatchApp` target이 소유하는 SwiftUI watchOS companion이다. real recording은 watchOS underwater extended runtime lifecycle을 따르고, demo/debug recording은 별도의 view-scoped simulation 흐름을 유지한다. 이 앱은 다이빙 기록과 사후 리뷰 companion이며 인증된 다이브 컴퓨터나 안전 판단 시스템이 아니다.

2026-10-22부터 Action Button은 단계를 아는 intent 하나로 처리한다. 대기·Wet Ready·요약에서는 시작하고, 실제 기록 중에는 Live ↔ 세부 화면을 넘기며, 물 밖에서 180초가 지나면 순환 끝에 종료 화면이 생기고 그 화면에서 누를 때만 기존 종료 경로를 탄다. 크라운 회전도 화면을 넘긴다. 자동 화면 전환은 햅틱을 울리지 않는다.

## 모바일 삭제 명령 처리

Watch에는 사용자용 삭제 UI나 gesture가 없다. iPhone의 `watchSessionDeletionCommand`를 받으면 Watch는 `localSessionId`를 deleted-session ledger에 먼저 기록하고, 같은 session의 outstanding file transfer, manifest entry, canonical/legacy artifact와 saved-session row를 제거한 뒤 acknowledgement를 보낸다. 대상이 이미 없어도 idempotent success로 응답한다.

Artifact cleanup이 실패하면 ACK하지 않고 ledger를 유지해 다음 launch나 반복 명령에서 정리를 재개한다. Load, migration과 save는 ledger에 있는 session을 복원하지 않는다. 이 삭제는 finalized history만 대상으로 하며 active underwater recording을 원격에서 중단하지 않는다.

## 앱 범위와 소유권

`DiveAppServices`는 watch process의 composition root다. 하나의 `DiveSessionStore`, `WaterSubmersionCoordinator`, `DiveRuntimeSessionController`, real `DiveSessionRecorder`, `RealDiveSessionCoordinator`, Action Button bridge를 유지한다. SwiftUI navigation, system auto-launch, App Intent가 각각 sensor, runtime, recorder를 새로 만들지 않는다.

`WaterSubmersionCoordinator`는 production에서 유일하게 `CMWaterSubmersionManager`를 만든다. 이 coordinator는 valid depth/pressure sample, optional temperature, submersion event, error, authorized `maximumDepth`를 앱 범위에서 전달한다. `RealDepthSensorProvider`는 manager owner가 아니라 real recorder의 sample subscription adapter다.

Apple의 현재 온라인 delegate 문서는 callback이 anonymous background queue에서 온다고 명시하지만, 설치된 watchOS 26.5 SDK header는 main queue라고 적는다. 구현은 더 엄격한 온라인 계약을 따라 callback executor에서 Core Motion object를 Sendable scalar와 error text로 snapshot한 뒤 실제 `Task { @MainActor ... }` hop으로 state를 바꾼다. manager, event, measurement, temperature object와 `Error` existential은 executor 경계를 넘지 않고 state mutation은 MainActor에 격리된다.

`DivenaryWatchApplicationDelegate.handle(_:)`는 watchOS가 준 `WKExtendedRuntimeSession`을 runtime controller로 즉시 넘긴다. controller는 `handle(_:)`가 끝나기 전에 concrete delegate를 붙이고, adopted session에는 `start()`를 다시 호출하지 않는다.

## 라이브 상승 속도 추정 범위

이전 live 값은 인접한 두 raw callback의 수심 차를 경과 시간으로 나눴다. callback은 대략 초당 세 번 들어올 수 있어 작은 jitter가 callback마다 spike와 0을 번갈아 보이게 할 수 있었다.

`DisplayAscentRateEstimator`는 newest accepted raw sample 기준으로 5초보다 오래된 sample을 버리고, 남은 oldest와 newest의 usable span이 3초 이상일 때만 값을 낸다. strict 상승 조건과 값은 다음과 같다.

```text
oldest.depthMeters > newest.depthMeters + 0.15
netDepthDecrease = oldest.depthMeters - newest.depthMeters
rateMetersPerMinute = netDepthDecrease / elapsedSeconds * 60
```

따라서 순수 수심 감소가 `<=0.15m`이거나 구간이 3초보다 짧으면 0이다. invalid/non-finite sample, duplicate timestamp, out-of-order timestamp는 0을 반환하고 기존 window를 손상시키지 않는다. recorder start와 cancel/completed-session reset은 estimator history, live value, transient warning을 함께 초기화하므로 session 사이에 sample이 남지 않는다.

2026-07-18 변경은 `DiveSessionRecorder.latestAscentRateMetersPerMinute`와 이를 strict `>9m/min`으로 읽는 `ascentWarningActive`만 대상으로 했고, `ScubaDiveEngine`의 historical `latestAscentRateMetersPerMinute`·`maxAscentRateMetersPerMinute`은 raw 연속 sample 차이로 남겼다. 2026-10-21부터는 1초 sensor 튐이 저장 최댓값이 되지 않도록 저장·요약 값도 같은 estimator 출력의 최근값과 최댓값을 쓴다. 요약(`DiveSessionSummary`)과 persistence sanitizer fallback도 저장 sample을 `DisplayAscentRateEstimator.rates(for:)`로 재생한다. raw callback 처리, `lastRawSample`, 1Hz `OneHertzProfileSampler` artifact, sync schema와 version은 그대로다. 화면의 `Ascent` metric은 recorder의 live field에 계속 binding한다.

smoothed rate와 transient warning은 기록 화면의 비인증 보조 reference다. 감압 의무, 안전한 상승 판단, underwater instruction을 계산하지 않으며 인증된 다이브 컴퓨터나 훈련을 대체하지 않는다.

## 실시간 수심 상태

`WaterSubmersionCoordinator`는 measurement마다 depth state를 sample보다 먼저 전달하고, `RealDepthSensorProvider`는 이를 `DepthSensorCondition`(`normal`, `sensorError`, `beyondSensorRange`)으로 바꾼다. recorder는 `LiveDepthSignal`(`awaitingFirstSample`, `live`, `stale`, `sensorError`, `beyondSensorRange`)을 publish하며, 유효 sample이 5초 넘게 없으면 `stale`이다.

기록 화면은 `live`일 때만 수심, depth rail, 상승 속도 숫자를 보인다. 그 밖에는 `--.- m`와 Waiting for depth, Depth unavailable, Depth sensor error, Outside sensor-authorized depth 중 맞는 상태를 보이고, 물 밖이면 At surface를 보인다. 마지막 유효 값을 현재 값처럼 남기지 않는다.

sensor range를 넘었거나 sample 공백이 30초를 넘은 기록은 저장할 때 권장 스탑을 `unknown`으로 남긴다. 공백에는 기록 시작부터 첫 측정, 마지막 측정부터 종료까지도 포함한다. 실시간 수심이 없으면 권장 스탑 타이머를 일시정지로 표시하고, 저장 결과가 `unknown`이면 요약·상세의 완료 여부·남은 시간·구간 내 시간은 `--`로 보인다. 이는 비인증 보조 알림의 관측 불확실성 표시이며 안전 판단이 아니다. `unsupportedDepth`에는 sensor가 알려준 한계와 처음 넘은 시각을 기록한다. 권장 스탑의 진행·일시정지·미완료 상태는 caution 앰버 색과 Recommended stop 문구를 쓰고 `danger` 빨강이나 action 파랑은 쓰지 않으며, 완료는 보조 회색이다.

프리다이빙의 잠수 구간에서 수심이 실시간 상태가 아니면 큰 숫자는 계속 흐르는 전체 기록 시간이다. 상태 표시는 `Dive active`를 유지해 큰 숫자의 기록 시간 라벨을 반복하지 않는다. 마지막 관측 잠수 시간은 짧은 표시명 `마지막 확인`(`Last seen`)으로 보조 항목에 남기며, 새 측정 없이 수심이나 수면 휴식 구간을 만들지 않는다. 실시간 수온은 센서의 실제 수온 측정 시각부터 60초가 되면 `--`로 바뀐다. 수심 측정에 같은 수온이 다시 실려 와도 유효 시간을 연장하지 않으며, 이 시각은 실시간 provider 경로에만 있고 저장·동기화 payload에는 추가하지 않는다.

## 시작 규칙

- manual start는 사용자가 고른 명시적 `PreDivePlan`으로 recorder를 시작하고 Divenary가 runtime session을 시작한다. 계획을 선택하지 않은 기본 시작에는 계획 목표 수심·시간과 `planned-<n>m` 태그가 없다. 목표 수심 없는 모바일 계획도 `nil`을 유지하며 예전의 18 m 대체값을 쓰지 않는다. 목표 수심 태그는 유한한 양수이며 정수 변환 가능한 값에만 붙인다. 모바일 계획의 `buddyIds`는 `plannedBuddyIds` 배열로 보존한다.
- 물 감지가 `submerged`가 되면 recorder를 시작하지 않고 `wetReady(mode:)`를 표시한다. 마지막 `preferredDiveMode`를 기본값으로 쓰며 Digital Crown 회전으로 Freedive/Scuba armed mode를 즉시 바꾼다. Crown press는 Water Lock의 watchOS system action이며 앱 입력이나 확인으로 쓰지 않는다.
- Wet Ready는 자동 실행 권한이 `.active`여도 아직 기록 중이라는 뜻이 아니다. 모든 권한 상태에서 미기록 안내와 홈 화면 복귀를 제공하며, 복귀 뒤 마를 때까지 같은 물 감지로 다시 열리지 않게 한다.
- system auto-launch는 `Settings > General > Auto-Launch > When Submerged`에서 선택된 Divenary에 watchOS가 runtime session을 제공할 때만 시작한다. Wet Ready가 먼저 있으면 armed mode를 `PreDivePlan`에 고정하고, runtime event가 water UI event보다 먼저 오면 `preferredDiveMode`를 fallback으로 쓴다. app-local depth threshold나 elapsed-time trigger는 recording start 조건이 아니다.
- Action Button start도 같은 preferred mode(Wet Ready면 armed mode)로 app-scoped coordinator를 시작한다. Action Button intent chain은 아래 "Action Button과 기록 화면"을 따른다.
- automatic과 Action Button start는 selected planned dive를 저장하거나 추론하지 않는다. manual start만 explicit plan을 유지한다.
- recording이 시작된 뒤에는 armed mode나 active `PreDivePlan`을 바꾸지 않는다.
- 다이빙이 끝나면 저장 중 단계로 바꾼 뒤 한 frame쯤 지나서 저장해 저장 중 화면이 먼저 그려지게 한다. 같은 기록이 아직 저장 중일 때만 저장하며, 저장 실패 화면을 벗어나 다음 다이빙을 시작하는 경로는 즉시 저장한다.
- saved summary, no-sample, 저장 실패 상태가 남아 있어도 다음 시작은 거부되지 않는다. `prepareForNewSession()`이 summary를 닫고 no-sample·시작 실패 recording을 취소한다. 저장 실패 기록은 저장 재시도가 성공하거나 recorder의 completed state만 정리하고 journal은 남긴다. 다시 물에 들어가면 saved summary를 닫고 Wet Ready로 간다.
- demo/debug 시작은 선택한 계획의 연결(`sourcePlanLocalId`, 계획 title, `plan-` tag)을 떼고, 저장할 때 계획을 실행됨으로 표시하는 것은 real 기록뿐이다.

active metadata와 NDJSON journal 준비는 모든 recording start의 선행 조건이다. `DiveSessionRecorder.startSession`이 실패하면 sensor, timer, engine을 시작하지 않고 active session도 만들지 않는다. manual과 Action Button 경로는 runtime start와 다이빙 동작 intent donation을 중단한다. 이미 watchOS가 넘긴 system session은 adopted 상태를 유지한 채 runtime invalidation을 한 번만 요청한다.

manual runtime acquisition은 명시적으로 성공 또는 실패를 반환한다. 실패는 기존 active adapter가 남아 있다는 뜻이므로 recorder cleanup 뒤 `awaitingRuntimeInvalidation`으로 전환하고 runtime invalidation을 요청한다. 이 동안 dismiss와 모든 새 start를 거부하고, runtime controller가 matching adapter를 지운 뒤 invalidation event를 전달해야 compact error가 dismissible해진다. cleanup 실패는 dismiss에서 다시 시도하며 stale adapter callback은 replacement recording을 finalize하지 않는다. Adopted recorder setup failure도 같은 waiting gate를 사용한다.

## 기록 저널 내구성과 복구

append가 실패할 수 있으므로 recorder는 finalized 1Hz sample을 ordered `ArraySlice` queue에 보관한다. later sample과 final flush는 항상 oldest unconfirmed sample부터 재시도하고, 성공한 head는 `popFirst()`로 O(1)에 제거한다. queue 전체가 비어야 persistence error를 지우며, new start, completed reset, intentional cancellation은 queue를 함께 초기화한다.

NDJSON journal은 recording 동안 열어 두고 sample마다 한 줄을 쓰며, 10 sample마다 storage로 flush한다. 앱만 종료되면 쓴 bytes는 OS cache에 남으므로 잃지 않고, OS crash에서는 마지막 flush 뒤 몇 초를 잃을 수 있다. 쓰기가 실패하면 열린 journal을 닫고 다음 append가 디스크에서 다시 읽는다. 이때 decode되지 않는 마지막 줄은 잘라내고, 마지막 durable sample과 같은 재시도 sample은 다시 쓰지 않는다. 이전 build의 `recording-pending.json` sidecar는 다시 열 때 지운다.

Manifest와 deleted-session ledger는 파일 수정 시각과 크기가 같으면 디코딩 결과를 재사용한다. Launch는 manifest나 session directory에 아직 남은 삭제만 다시 실행한다. Sync status 변경은 한 번에 모아 `sessions` publish 한 번과 manifest 쓰기 한 번으로 반영하고, 바뀌지 않은 status는 쓰지 않는다. Recorder와 수중 센서 coordinator는 바뀐 값만 publish하고, 앱 root와 Home은 전달만 하는 recorder와 센서 객체를 관찰하지 않는다.

Recovery는 session별로 격리한다. newline으로 끝난 record는 모두 strict decode하고, newline 없는 마지막 record가 decode되지 않을 때만 앞선 durable prefix를 보존한다. decode 가능한 마지막 record에는 newline을 보완한다. metadata mismatch나 interior corruption처럼 복구할 수 없는 active state는 `Sessions/<localSessionId>/Quarantine/<UUID>/`로 active metadata, journal, pending sidecar만 옮긴다. 같은 directory의 canonical `session-<revision>.json`과 manifest identity는 유지하므로 canonical save retry와 다른 interrupted session recovery가 영향을 받지 않는다.

History 재시도는 manifest뿐 아니라 중단된 기록의 디렉터리 읽기와 저장 실패도 다시 처리한다. 프로세스 전체에 등록한 현재 실행 중 시작 기록은 store를 다시 만들어도 복구 대상으로 삼지 않는다. 개별 journal을 읽지 못했거나 보존된 격리 자료가 있으면 정상 기록을 보여 주면서도 읽기 실패 상태를 유지한다.

recording 중 append가 불확실하면 화면 하단에 compact storage retry 상태를 표시하고, pending append가 실제로 해결된 뒤에만 해당 상태를 지운다. raw callback, 1Hz sampling boundary, generated sync contract, canonical artifact와 historical ascent field는 바꾸지 않는다.

## Action Button과 기록 화면

Action Button의 모든 누르기는 단계를 아는 intent 하나로 처리한다. `DivenaryStartDiveIntent`(Action Button에 Divenary를 지정했을 때의 첫 누르기)와 `DivenaryDiveActionIntent`(그 뒤의 누르기)는 같은 `DiveActionButtonBridge.performDiveAction()`을 실행하고, 결과가 종료 요청이 아니면 `DivenaryDiveActionIntent`를 다음 Action Button intent로 돌려준다. 종료가 요청되면 버튼은 다시 시작 intent로 돌아간다. 수동 시작, system auto-launch, demo/debug 시작은 `DiveActionButtonDonor.donateDiveAction()`으로 `DivenaryStartDiveIntent`의 result가 `DivenaryDiveActionIntent`인 chain을 donate한다. 2026-10-22 전의 end intent(`DivenaryEndDiveIntent`)와 end donation은 없어졌다.

`RealDiveSessionCoordinator.handleActionButtonPress()`는 단계에 따라 결과를 고른다.

- 대기, Wet Ready, 저장 요약, no-sample, 시작·저장 실패 화면: 기존 Action Button start를 실행한다(`.started` 또는 `.rejected(.startFailed)`).
- 저장 중(`completing`)과 runtime 전환 대기(`awaitingRuntimeInvalidation`): `.rejected(.busy)`.
- 실제 기록 중: 다음 화면으로 넘긴다. 종료 화면에서 누를 때만 아래 종료 규칙의 `requestActionButtonEnd()`를 호출하고, guard가 거부하면 Live로 돌아가며 `.rejected(.endUnavailable)`이다.
- demo/debug 기록은 bridge에 자체 종료 override를 설치해 누르기를 그쪽으로 보내고 화면을 넘기지 않는다. 저장 실패 화면에서는 같은 기록의 저장을 재시도하며, 이 화면이 다시 나타나도 연결을 복원한다. 홈 화면 복귀는 보류 기록을 앱 범위에 넘기고 journal을 유지한다.

`RecordingPageModel`(`coordinator.recordingPages`)은 실제 기록의 화면 `live`, `details`, `end`를 관리한다. `end`는 water state가 `notSubmerged`이고 기록이 `minimumHardwareEndElapsedSeconds`(180초) 이상일 때만 Action Button 순환에 들어간다. 물 밖이지만 180초 전이면 남은 시간을 센다. 크라운 회전은 `live`와 `details` 사이만 움직이고 종료 화면을 고르거나 종료하지 않는다. 다음 경우에는 다이버의 조작 없이 Live로 돌아간다: 10초 동안 누르지 않음, 프리다이빙 단계 변화(하강·수면), 권장 스탑이 `active`가 됨, 실시간 수심 신호가 `live`에서 벗어남, Always-On 진입, 종료 화면에 있는 동안 종료 조건이 사라짐. 크라운 화면 넘김은 실제 기록에만 연결하며 demo/debug는 크라운으로 수심을 흉내 낸다.

햅틱은 `WatchDiveHaptics`(`Runtime/DiveHaptics.swift`) 하나만 울리며 이벤트는 `start`(수동·Action Button 시작), `pageChange`(동작 버튼·크라운으로 화면을 넘김), `rejected`(거부된 누르기), `endRequested`(종료 요청), `saved`(실제 기록 저장 성공) 다섯 가지다. 자동 Live 복귀와 system auto-launch 시작은 햅틱이 없고, 센서 오류·권장 스탑·상승에 연결된 햅틱은 없다. view는 `WKInterfaceDevice.play`나 `sensoryFeedback`을 쓰지 않으며 실제 기록 화면(`RealRecordingPager`)의 크라운 detent 햅틱도 끈다. demo의 크라운 수심 조절과 Wet Ready의 크라운 모드 선택은 시스템 detent 햅틱을 그대로 쓴다. jest source pin과 XCTest가 이 경계와 권장 스탑 진입 시 햅틱 없음을 검사한다.

기록 화면(`RealRecordingPager`)은 다음을 따른다.

- 모든 화면은 depth gauge, 수심 상태 chip과 Demo/Test 표식, 지원 수심 밖 경고를 유지한다. 화면마다 큰 숫자는 하나다. 스쿠버 Live·세부 화면과 프리다이빙 하강 중 화면(`DepthOrTimeMetric`)에서는 `liveDepthSignal == .live`일 때만 수심이고 그 밖에는 경과 시간이다. 권장 스탑 화면은 남은 스탑 시간, 프리다이빙 수면 대기는 기록 시간, 수면 휴식·요약은 수면 휴식 시간, 프리다이빙 세부 화면은 다이빙 횟수, 종료 화면은 경과 시간을 큰 숫자로 쓴다.
- 한 줄 안내 chip(`RecordingHint`)이 다음 누르기가 무엇을 하는지 말한다. 물 밖 180초 전에는(Ultra 힌트가 있을 때) 종료 가능까지 남은 시간, 종료 화면에서는 기록 종료·저장을 말한다. 거부된 누르기 뒤 2초 동안 종료할 수 없다는 안내를 보인다. 수중 잠금 안내는 `notSubmerged`일 때만 보인다. chip과 종료 화면에는 탭 대상이 없다. 문구 규칙은 [Mobile/Watch UI 언어](../design/mobile-watch-ui-language.md)를 따른다.
- Always-On(`isLuminanceReduced`)이면 `RecordingPageModel` 자체를 Live로 돌리고 그 상태를 유지하며, 동작 버튼·크라운의 화면 이동 요청을 무시한다. 화면은 항상 `pages.page`를 그리므로 보이는 화면과 입력 대상이 일치한다. `setAlwaysOn(false)` 뒤에 화면 이동을 다시 허용한다. 권장 스탑 라벨과 일시정지 문구, 상태 chip, Demo/Test 표식은 남긴다.
- `ActionButtonHint`는 모델 식별자(`hw.machine`, 시뮬레이터는 `SIMULATOR_MODEL_IDENTIFIER`)가 `Watch6,18`, `Watch7,5`, `Watch7,12` 중 하나면 Ultra 계열로 본다. 이 판단은 힌트일 뿐이다. Divenary가 Action Button에 지정됐는지는 알 수 없으므로 문구는 조건형이고, Ultra 힌트가 없으면 안내 chip은 회전 방향까지 명시한 크라운 안내를 쓴다(`크라운 앞으로 ▸ 상세`, `크라운 뒤로 ▸ 실시간`). 식별자 목록은 실기기 확인 대상이다.
- `DepthAutoLaunchAuthorization`은 `WKExtendedRuntimeSession.requestAutoLaunchAuthorizationStatus` 결과를 `DepthAutoLaunchStatus`(`active`, `inactive`, `unknown`)로 읽고 오류는 `unknown`으로 둔다. Wet Ready 시작 안내는 이 상태와 Ultra 힌트로 고르며, `unknown`이거나 `inactive`인데 Ultra 힌트가 없으면 입수 전에 직접 시작하라는 안내를 쓴다.

## 종료와 결과 규칙

real recording에는 touch end control이 없다. 종료 화면에도 탭 대상이 없다. 다음 신호는 runtime invalidation을 거쳐 하나의 idempotent finalizer로 수렴한다.

1. surface 뒤 Digital Crown을 길게 눌러 Water Lock을 해제하면 watchOS가 runtime을 invalidate한다.
2. Action Button end는 종료 화면에서 누를 때만 요청된다. 종료 화면은 물 밖·180초 조건에서만 순환에 들어가므로 종료는 항상 두 번 이상의 의도된 누르기다. `requestActionButtonEnd()`는 latest state가 `notSubmerged`이고 elapsed time이 `>=180s (3 minutes)`일 때만 runtime invalidation을 요청한다. 수중, unknown state, `180s` 미만 rejection은 diver interaction이 아니라 `RealDiveSessionCoordinatorTests.testActionButtonEndRejectsSubmergedUnknownAndTooShortRecordings`와 `testActionButtonEndRejectsUnknownWaterStateEvenNearTheSurface`로 확인한다. 2026-10-21 전 코드는 unknown state에서 마지막 수심이 1m 이하면 허용했지만, 이 계약에 맞춰 지웠다. 2026-10-22 개편은 `minimumHardwareEndElapsedSeconds = 180`과 이 guard를 바꾸지 않았다.
3. watchOS는 계속 out-of-water 상태가 `>600s (10 minutes)`이면 runtime을 invalidate한다.

종료 조건을 만족한 누르기는 runtime invalidation 전에 `isEnding`을 설정해 즉시 종료 중 화면을 보인다. 같은 종료 요청은 재실행하지 않으며, 종료 대기 중 동작 버튼 누르기는 `.rejected(.busy)`와 잠시 기다리라는 안내로 처리한다.

단일 `notSubmerged` event는 종료하지 않고, Divenary에는 app-side `600-second (10-minute)` timer가 없다. 이 부재는 `RealDiveSessionCoordinator.swift`의 timer-symbol static search와 `RealDiveSessionCoordinatorTests.testWaterStateChangesDoNotStopOrReplaceRecording`으로 감사한다. `600s (10 minutes)` 전에 resubmerge하면 기존 recorder와 local session ID가 계속 사용된다.

valid depth sample이 있으면 invalidation 뒤 finalized `DiveSessionRecord`를 Watch local store에 먼저 저장한다. 성공 뒤에만 recorder completed state를 정리하고 read-only `Saved` summary를 표시한다. save 실패는 record와 local session ID를 유지하며 foreground 복귀 또는 명시적 Retry가 같은 record를 다시 저장한다. real completion에는 post-dive metadata, Save/Discard/Delete 입력이 없다. manual/Action Button start가 sample 없이 끝나면 저장하지 않고 compact no-sample result를 한 번 보인다. system auto-launch no-sample attempt는 저장하거나 UI를 남기지 않고 조용히 취소한다.

실제 저장 실패 화면은 `Retry Save`와 `Back to Home`을 제공하고, 동작 버튼은 저장 재시도 뒤 새 기록을 시작한다고 안내한다. 재저장도 실패하면 기존 기록을 보류한 채 새 시작 경로로 넘어간다. 홈 복귀는 완료 기록을 앱 범위 `pendingRecords`에 보관하고 recorder 메모리만 정리하며 미저장 저널을 취소·삭제하지 않는다. Home 표시와 앱 활성화 때 자동 저장 재시도를 실행하고 성공한 기록만 보류 목록에서 제거한다.

실제·데모 저장 실패 안내는 스크롤 본문의 버튼 위에 배치하고 자동으로 숨기지 않아 재시도 버튼을 덮지 않는다. 연속 실패는 번호로 구분한다. 이는 `90d3874`에서 하단 inset 안내를 바꾼 결과다.

demo/debug는 `DemoDepthSensorProvider`와 Digital Crown depth simulation을 유지하고, Action Button bridge에 설치한 자체 종료 override로 끝낸다. demo는 toolbar의 xmark(`End demo`)로도 끝낼 수 있다. 예전 문서의 `SurfaceEndDiveGate`와 수면 조건 touch end는 2026-07-27 커밋 `748c515`에서 이미 지워졌다. 이 경로는 `WKExtendedRuntimeSession`, Water Lock, real Action Button ending, 화면 순환, 10분 규칙을 사용하지 않는다. demo/debug 요약에는 저장 완료 햅틱과 다음 다이빙 시작 안내가 없다.

demo/debug의 system back은 recording, summary, unresolved cleanup 동안 lifecycle이 숨긴다. 종료하면 바로 저장하고 저장이 성공해야 summary를 보이며, 실패하면 같은 retry 화면에 남는다. external real flow가 route를 가릴 때 unfinished simulated state cleanup이 성공하면, route가 다시 보이는 즉시 Home dismissal을 요청한다. cleanup이 실패하면 completed로 표시하지 않고 summary 또는 별도 cleanup retry state를 유지한다. simulated recorder start 실패도 recording 화면으로 가장하지 않고 retry 또는 Home dismissal을 제공한다.

## 기록 정확도와 저장 복구

- 권장 스탑 타이머는 sample 간격마다 최대 5초만 적립한다. sensor가 보지 못한 시간은 스탑 시간이 아니다.
- 수온은 측정 시각과 함께 보관하고 60초 이내 값만 sample에 붙인다. `notSubmerged` event와 real provider 시작 때 비운다.
- `captureMode`가 없는 저장 기록과 legacy `DiveSession` 변환은 `demo`로 읽는다. real provider는 `captureMode`가 생긴 2026-07-05 커밋 전까지 stub이었다.
- 실행 시 삭제 복구(`resumePendingDeletions`)가 실패하면 저장 직전, companion 새로고침·activation, 앱 활성화 때 다시 시도한다. 늦게 성공하면 저장 목록만 다시 읽고, 끊긴 recording 복구는 진행 중 recording을 건드리지 않도록 다음 실행으로 미룬다.

## 저장 기록과 계획 화면

- Home은 Dive Plans 행 하나로 선택된 계획을 보여 주고, 계획 화면은 선택이 Home에서 시작할 때만 적용되며 다시 누르면 해제된다고 안내한다. Home 표시, 계획 목록 변경, 시작 직전에 선택 ID를 현재 목록과 대조한다. 실제 기록 저장 성공으로 실행된 계획이나 목록에서 제거된 계획은 선택을 해제하고 모드만 남긴 기본 계획으로 되돌린다. 선택 계획과 다른 모드로 시작할 때도 기본 계획을 쓴다. 수심이 없는 계획은 `--.- m`로 보인다. 도메인 경계는 [다이브 계획 도메인](../domains/dive-planning.md)을 따른다.
- Home의 실제 시작 카드는 프리다이빙과 스쿠버 두 개다. `DepthSensorAvailability` 확인이 끝나기 전(`sensorAvailability == nil`)에는 placeholder 없이 카드를 비활성으로 그리고, 지원하지 않는 기기는 빨간 오류 카드 대신 neutral 안내를 보인다. `수중 조작` 행은 자동 실행 상태를 보이고 `UnderwaterControlsView`(자동 실행 설정, 동작 버튼 지정 방법, 크라운 안내)로 들어간다. Demo는 시작 카드가 아니라 아래쪽 보조 행이다. 이전의 `launchPlaceholder`는 지웠다.
- 저장 요약은 최대 수심과 시간을 먼저 두고 sample 수는 상세 화면에만 남긴다. 실제 기록의 요약이 보이면 `saved` 햅틱을 한 번 울리고, Ultra 힌트가 있으면 다음 누르기로 다음 다이빙을 시작한다는 안내를 보인다.
- 동기화 상태 값(`pending`, `synced`, `failed`)은 sync 계약에 있어 그대로 두고, 표시만 Waiting for iPhone, Saved on iPhone, Not sent to iPhone으로 한다. 실패한 세션 상세 화면의 Send Again은 그 artifact 하나를 다시 enqueue한다. 수동 재전송마다 세션별 시도 번호를 늘리고 manifest 읽기 실패·즉시 전송 실패·비동기 전송 실패를 번호와 함께 상세 화면에 표시한다. 전송 대기나 동기화 완료가 되면 실패 안내를 지우며, iPhone이 이미 확인한 기록을 늦은 실패로 되돌리지 않는다. 전송 완료와 iPhone 수신 확인 대기를 나누는 표시는 paired hardware 검증 전에는 하지 않는다.
- 요약, 목록, 상세는 지원 수심을 넘은 기록에 Outside watch support 표식을 붙이고 리뷰용으로만 보관한다고 알린다. 기존 `profile.interrupted == true`인 기록에는 `중단 후 복구됨`(`Recovered after interruption`) 표식도 붙인다.

## Signing과 실기기 경계

watch `Info.plist`는 `WKBackgroundModes`의 `underwater-depth`를 유지하고, target entitlement는 공개 shallow capability인 `com.apple.developer.submerged-shallow-depth-and-pressure`를 선언한다. Xcode Easy Submersion은 simulator system-session delivery/adoption과 UI navigation만 확인한다. signed bundle/profile, physical sensor delivery, actual hardware `When Submerged` selection/auto-launch, Water Lock, device release readiness의 증거는 아니다.

signed device build에서 code-signing entitlement와 embedded profile 모두를 검사해야 한다. 공개 shallow capability는 manager가 승인한 얕은 범위 접근만 뜻한다. 더 깊은 sensor access는 Apple managed entitlement와 provisioning의 외부 승인 gate이며, 현재 build를 40m sensor-authorized로 설명할 수 없다. physical sensor delivery, signing/profile, `When Submerged`, Water Lock/Crown, Action Button hardware behavior와 watchOS timeout은 모두 계속 미검증 상태다.

15cm bag/tank test는 manually started real session의 shallow sample(예: 약 `0.1 m`)과 Water Lock만 검증한다. Xcode Easy Submersion은 simulator adoption 확인으로만 기록한다. physical `When Submerged` automatic launch는 지원 hardware에서 Wet Ready와 Crown selection을 확인한 뒤 watchOS가 제공하는 threshold의 `handle(_:)` adoption과 실제 selection을 별도로 검증해야 한다. Digital Crown, timeout, surfaced eligible Action Button end도 지원 hardware에서 독립적으로 확인해야 한다.

2026-10-22 수중 입력 모델의 실기기 동작도 검증되지 않았다. 실제 Ultra의 Action Button chain·화면 넘김·종료 화면 종료, 수중 잠금 중 크라운 회전 전달, 수중 runtime 중 햅틱 전달과 웻슈트 너머 체감, Always-On 진입과 갱신 주기, 손목을 내린 상태의 10초 복귀, 41/46/49mm 배치, Ultra 모델 식별자, 한국어 watchOS 메뉴 이름, 실제 auto-launch 상태 값은 [열린 질문](../questions/open-questions.md)에 남긴다. simulator, XCTest와 build 성공은 이 행동의 증거가 아니다.

## 2026-10-22 UX 리뷰 백로그와 미결 표시 정책

소유자가 수정 중이라고 알렸던 A(기록 정확성)·B(막힌 흐름) 가운데 위에서 코드로 확인한 수정은 2026-10-22 커밋 `2df2bd1`·`90d3874`에 반영됐다. D 기능은 [구현 우선순위의 승인 백로그](implementation-priorities.md), E 결정은 [열린 질문](../questions/open-questions.md)에 남기도록 했다. 이 문서의 라이브 상승 속도 참고값 설명은 benchmark의 상승 지시 회피 원칙과 충돌하며 E1에서 유지·숨김·수면 후 리뷰만 표시 중 결정한다. 기존 표시 설명은 새로운 안전 판단 승인이 아니다.

동작 버튼의 현행 화면 넘김은 D5 북마크 제안과 같은 입력을 쓰므로 역할·저장 contract 결정이 먼저다. D6는 약 6 m의 공개 shallow 허가 범위 밖에서도 기록 상태를 이해하는 화면 설계이며, 아래 40 m 제품 경계가 실제 센서 권한을 보장하지 않는다. D·E 등록만으로 동작·계약을 바꾸거나 실기기 통과를 선언하지 않는다.

## 관련 문서

- [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
- [열린 질문](../questions/open-questions.md)
- [실기기 검증 체크리스트](../../../docs/2026-07-18-watch-underwater-runtime-device-checklist.md)
- [안전 규칙](../domains/safety-rules.md)
