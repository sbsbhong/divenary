# Watch 앱 구조

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Watch underwater runtime lifecycle implementation and device boundary, 2026-07-18; Watch live ascent-rate smoothing boundary, 2026-07-18; Watch 기록 내구성과 경로 복구 경계, 2026-07-18; Watch callback, retry, re-entry, navigation hardening, 2026-07-18
Raw: [Pre-Karpathy: Watch 앱 구조](../../raw/architecture/watch-app.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Watch underwater runtime lifecycle implementation and device boundary](../../raw/architecture/2026-07-18-watch-underwater-runtime-lifecycle.md); [Watch live ascent-rate smoothing boundary](../../raw/architecture/2026-07-18-watch-live-ascent-rate-smoothing.md); [Watch 기록 내구성과 경로 복구 경계](../../raw/architecture/2026-07-18-watch-recording-durability-and-route-recovery.md); [Watch callback, retry, re-entry, navigation hardening](../../raw/architecture/2026-07-18-watch-callback-retry-reentry-navigation.md)
Sources: Mobile-authoritative Watch log deletion implementation and physical verification, 2026-08-02; Watch Wet Ready and automatic local save, 2026-09-01; 2026-10-21 프로젝트 리뷰 후속 수정 경계, 2026-10-21
Raw: [Mobile-authoritative Watch log deletion implementation and physical verification](../../raw/architecture/2026-08-02-mobile-authoritative-watch-log-deletion.md); [Watch Wet Ready and automatic local save](../../raw/architecture/2026-09-01-watch-wet-ready-auto-save.md); [2026-10-21 프로젝트 리뷰 후속 수정 경계](../../raw/architecture/2026-10-21-review-remediation.md)
Updated: 2026-10-21

## 요약

`apps/mobile/ios/DivenaryWatchApp`는 `apps/mobile/ios/Divenary.xcodeproj`의 `DivenaryWatchApp` target이 소유하는 SwiftUI watchOS companion이다. real recording은 watchOS underwater extended runtime lifecycle을 따르고, demo/debug recording은 별도의 view-scoped simulation 흐름을 유지한다. 이 앱은 다이빙 기록과 사후 리뷰 companion이며 인증된 다이브 컴퓨터나 안전 판단 시스템이 아니다.

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

sensor range를 넘었거나 sample 공백이 30초를 넘은 기록은 저장할 때 권장 스탑을 `unknown`으로 남긴다. `unsupportedDepth`에는 sensor가 알려준 한계와 처음 넘은 시각을 기록한다. 권장 스탑의 일시정지·미완료 상태는 caution 앰버 색과 Recommended stop 문구를 쓰고 `danger` 빨강은 쓰지 않는다.

## 시작 규칙

- manual start는 사용자가 고른 명시적 `PreDivePlan`으로 recorder를 시작하고 Divenary가 runtime session을 시작한다.
- 물 감지가 `submerged`가 되면 recorder를 시작하지 않고 `wetReady(mode:)`를 표시한다. 마지막 `preferredDiveMode`를 기본값으로 쓰며 Digital Crown 회전으로 Freedive/Scuba armed mode를 즉시 바꾼다. Crown press는 Water Lock의 watchOS system action이며 앱 입력이나 확인으로 쓰지 않는다.
- system auto-launch는 `Settings > General > Auto-Launch > When Submerged`에서 선택된 Divenary에 watchOS가 runtime session을 제공할 때만 시작한다. Wet Ready가 먼저 있으면 armed mode를 `PreDivePlan`에 고정하고, runtime event가 water UI event보다 먼저 오면 `preferredDiveMode`를 fallback으로 쓴다. app-local depth threshold나 elapsed-time trigger는 recording start 조건이 아니다.
- Action Button start도 같은 preferred mode로 app-scoped coordinator를 시작한다. `StartDiveIntent`는 다음 Action Button action으로 end intent를 donate한다.
- automatic과 Action Button start는 selected planned dive를 저장하거나 추론하지 않는다. manual start만 explicit plan을 유지한다.
- recording이 시작된 뒤에는 armed mode나 active `PreDivePlan`을 바꾸지 않는다.
- saved summary, no-sample, 저장 실패 상태가 남아 있어도 다음 시작은 거부되지 않는다. `prepareForNewSession()`이 summary를 닫고 no-sample·시작 실패 recording을 취소한다. 저장 실패 기록은 저장 재시도가 성공하거나 recorder의 completed state만 정리하고 journal은 남긴다. 다시 물에 들어가면 saved summary를 닫고 Wet Ready로 간다.
- demo/debug 시작은 선택한 계획의 연결(`sourcePlanLocalId`, 계획 title, `plan-` tag)을 떼고, 저장할 때 계획을 실행됨으로 표시하는 것은 real 기록뿐이다.

active metadata와 NDJSON journal 준비는 모든 recording start의 선행 조건이다. `DiveSessionRecorder.startSession`이 실패하면 sensor, timer, engine을 시작하지 않고 active session도 만들지 않는다. manual과 Action Button 경로는 runtime start와 end action 제공을 중단한다. 이미 watchOS가 넘긴 system session은 adopted 상태를 유지한 채 runtime invalidation을 한 번만 요청한다.

manual runtime acquisition은 명시적으로 성공 또는 실패를 반환한다. 실패는 기존 active adapter가 남아 있다는 뜻이므로 recorder cleanup 뒤 `awaitingRuntimeInvalidation`으로 전환하고 runtime invalidation을 요청한다. 이 동안 dismiss와 모든 새 start를 거부하고, runtime controller가 matching adapter를 지운 뒤 invalidation event를 전달해야 compact error가 dismissible해진다. cleanup 실패는 dismiss에서 다시 시도하며 stale adapter callback은 replacement recording을 finalize하지 않는다. Adopted recorder setup failure도 같은 waiting gate를 사용한다.

## 기록 저널 내구성과 복구

pending sidecar가 생기기 전 append가 실패할 수 있으므로 recorder는 finalized 1Hz sample을 ordered `ArraySlice` queue에 보관한다. later sample과 final flush는 항상 oldest unconfirmed sample부터 재시도하고, 성공한 head는 `popFirst()`로 O(1)에 제거한다. queue 전체가 비어야 persistence error를 지우며, new start, completed reset, intentional cancellation은 queue를 함께 초기화한다.

1Hz append 전에 `recording-pending.json`에 expected journal offset과 완전한 NDJSON line을 atomic하게 기록한다. append 뒤 cleanup이 실패해도 retry는 journal suffix를 확인하고 decoded `DepthSample` value를 retry와 비교해 이미 완전히 기록된 sample을 중복하지 않는다. partial suffix가 sidecar line의 prefix와 일치하면 expected offset까지 잘라내고 line 전체를 다시 기록한 뒤 pending state를 제거한다. 해결되지 않은 pending append는 다음 sample보다 먼저 처리한다.

Recovery는 session별로 격리한다. newline으로 끝난 record는 모두 strict decode하고, newline 없는 마지막 record가 decode되지 않을 때만 앞선 durable prefix를 보존한다. decode 가능한 마지막 record에는 newline을 보완한다. metadata mismatch나 interior corruption처럼 복구할 수 없는 active state는 `Sessions/<localSessionId>/Quarantine/<UUID>/`로 active metadata, journal, pending sidecar만 옮긴다. 같은 directory의 canonical `session-<revision>.json`과 manifest identity는 유지하므로 canonical save retry와 다른 interrupted session recovery가 영향을 받지 않는다.

recording 중 append가 불확실하면 화면 하단에 compact storage retry 상태를 표시하고, pending append가 실제로 해결된 뒤에만 해당 상태를 지운다. raw callback, 1Hz sampling boundary, generated sync contract, canonical artifact와 historical ascent field는 바꾸지 않는다.

## 종료와 결과 규칙

real recording에는 touch end control이 없다. 다음 신호는 runtime invalidation을 거쳐 하나의 idempotent finalizer로 수렴한다.

1. surface 뒤 Digital Crown을 길게 눌러 Water Lock을 해제하면 watchOS가 runtime을 invalidate한다.
2. Action Button end는 latest state가 `notSubmerged`이고 elapsed time이 `>=180s (3 minutes)`일 때만 runtime invalidation을 요청한다. 수중, unknown state, `180s` 미만 rejection은 diver interaction이 아니라 `RealDiveSessionCoordinatorTests.testActionButtonEndRejectsSubmergedUnknownAndTooShortRecordings`와 `testActionButtonEndRejectsUnknownWaterStateEvenNearTheSurface`로 확인한다. 2026-10-21 전 코드는 unknown state에서 마지막 수심이 1m 이하면 허용했지만, 이 계약에 맞춰 지웠다.
3. watchOS는 계속 out-of-water 상태가 `>600s (10 minutes)`이면 runtime을 invalidate한다.

단일 `notSubmerged` event는 종료하지 않고, Divenary에는 app-side `600-second (10-minute)` timer가 없다. 이 부재는 `RealDiveSessionCoordinator.swift`의 timer-symbol static search와 `RealDiveSessionCoordinatorTests.testWaterStateChangesDoNotStopOrReplaceRecording`으로 감사한다. `600s (10 minutes)` 전에 resubmerge하면 기존 recorder와 local session ID가 계속 사용된다.

valid depth sample이 있으면 invalidation 뒤 finalized `DiveSessionRecord`를 Watch local store에 먼저 저장한다. 성공 뒤에만 recorder completed state를 정리하고 read-only `Saved` summary를 표시한다. save 실패는 record와 local session ID를 유지하며 foreground 복귀 또는 명시적 Retry가 같은 record를 다시 저장한다. real completion에는 post-dive metadata, Save/Discard/Delete 입력이 없다. manual/Action Button start가 sample 없이 끝나면 저장하지 않고 compact no-sample result를 한 번 보인다. system auto-launch no-sample attempt는 저장하거나 UI를 남기지 않고 조용히 취소한다.

demo/debug는 `DemoDepthSensorProvider`, Digital Crown depth simulation, `SurfaceEndDiveGate`, surface-gated touch end를 유지한다. 이 경로는 `WKExtendedRuntimeSession`, Water Lock, real Action Button ending, 10분 규칙을 사용하지 않는다.

demo/debug의 system back은 recording, summary, unresolved cleanup 동안 lifecycle이 숨긴다. summary는 Save 또는 Discard 성공 뒤에만 dismiss하며, 실패하면 같은 retry 화면에 남는다. external real flow가 route를 가릴 때 unfinished simulated state cleanup이 성공하면, route가 다시 보이는 즉시 Home dismissal을 요청한다. cleanup이 실패하면 completed로 표시하지 않고 summary 또는 별도 cleanup retry state를 유지한다. simulated recorder start 실패도 recording 화면으로 가장하지 않고 retry 또는 Home dismissal을 제공한다.

## 기록 정확도와 저장 복구

- 권장 스탑 타이머는 sample 간격마다 최대 5초만 적립한다. sensor가 보지 못한 시간은 스탑 시간이 아니다.
- 수온은 측정 시각과 함께 보관하고 60초 이내 값만 sample에 붙인다. `notSubmerged` event와 real provider 시작 때 비운다.
- `captureMode`가 없는 저장 기록과 legacy `DiveSession` 변환은 `demo`로 읽는다. real provider는 `captureMode`가 생긴 2026-07-05 커밋 전까지 stub이었다.
- 실행 시 삭제 복구(`resumePendingDeletions`)가 실패하면 저장 직전, companion 새로고침·activation, 앱 활성화 때 다시 시도한다. 늦게 성공하면 저장 목록만 다시 읽고, 끊긴 recording 복구는 진행 중 recording을 건드리지 않도록 다음 실행으로 미룬다.

## 저장 기록과 계획 화면

- Home은 Dive Plans 행 하나로 선택된 계획을 보여 주고, Dive Plans 화면에서 계획을 누르면 다음 다이브에 쓰고 다시 누르면 해제한다. 수심이 없는 계획은 `--.- m`로 보인다.
- 동기화 상태 값(`pending`, `synced`, `failed`)은 sync 계약에 있어 그대로 두고, 표시만 Waiting for iPhone, Saved on iPhone, Not sent to iPhone으로 한다. 실패한 세션 상세 화면의 Send Again은 그 artifact 하나를 다시 enqueue한다. 전송 완료와 iPhone 수신 확인 대기를 나누는 표시는 paired hardware 검증 전에는 하지 않는다.
- 요약, 목록, 상세는 지원 수심을 넘은 기록에 Outside watch support 표식을 붙이고 리뷰용으로만 보관한다고 알린다.

## Signing과 실기기 경계

watch `Info.plist`는 `WKBackgroundModes`의 `underwater-depth`를 유지하고, target entitlement는 공개 shallow capability인 `com.apple.developer.submerged-shallow-depth-and-pressure`를 선언한다. Xcode Easy Submersion은 simulator system-session delivery/adoption과 UI navigation만 확인한다. signed bundle/profile, physical sensor delivery, actual hardware `When Submerged` selection/auto-launch, Water Lock, device release readiness의 증거는 아니다.

signed device build에서 code-signing entitlement와 embedded profile 모두를 검사해야 한다. 공개 shallow capability는 manager가 승인한 얕은 범위 접근만 뜻한다. 더 깊은 sensor access는 Apple managed entitlement와 provisioning의 외부 승인 gate이며, 현재 build를 40m sensor-authorized로 설명할 수 없다. physical sensor delivery, signing/profile, `When Submerged`, Water Lock/Crown, Action Button hardware behavior와 watchOS timeout은 모두 계속 미검증 상태다.

15cm bag/tank test는 manually started real session의 shallow sample(예: 약 `0.1 m`)과 Water Lock만 검증한다. Xcode Easy Submersion은 simulator adoption 확인으로만 기록한다. physical `When Submerged` automatic launch는 지원 hardware에서 Wet Ready와 Crown selection을 확인한 뒤 watchOS가 제공하는 threshold의 `handle(_:)` adoption과 실제 selection을 별도로 검증해야 한다. Digital Crown, timeout, surfaced eligible Action Button end도 지원 hardware에서 독립적으로 확인해야 한다.

## 관련 문서

- [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
- [열린 질문](../questions/open-questions.md)
- [실기기 검증 체크리스트](../../../docs/2026-07-18-watch-underwater-runtime-device-checklist.md)
- [안전 규칙](../domains/safety-rules.md)
