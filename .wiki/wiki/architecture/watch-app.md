# Watch 앱 구조

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Watch underwater runtime lifecycle implementation and device boundary, 2026-07-18; Watch live ascent-rate smoothing boundary, 2026-07-18; Watch 기록 내구성과 경로 복구 경계, 2026-07-18; Watch callback, retry, re-entry, navigation hardening, 2026-07-18
Raw: [Pre-Karpathy: Watch 앱 구조](../../raw/architecture/watch-app.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Watch underwater runtime lifecycle implementation and device boundary](../../raw/architecture/2026-07-18-watch-underwater-runtime-lifecycle.md); [Watch live ascent-rate smoothing boundary](../../raw/architecture/2026-07-18-watch-live-ascent-rate-smoothing.md); [Watch 기록 내구성과 경로 복구 경계](../../raw/architecture/2026-07-18-watch-recording-durability-and-route-recovery.md); [Watch callback, retry, re-entry, navigation hardening](../../raw/architecture/2026-07-18-watch-callback-retry-reentry-navigation.md)
Updated: 2026-07-18

## 요약

`apps/mobile/ios/DivenaryWatchApp`는 `apps/mobile/ios/Divenary.xcodeproj`의 `DivenaryWatchApp` target이 소유하는 SwiftUI watchOS companion이다. real recording은 watchOS underwater extended runtime lifecycle을 따르고, demo/debug recording은 별도의 view-scoped simulation 흐름을 유지한다. 이 앱은 다이빙 기록과 사후 리뷰 companion이며 인증된 다이브 컴퓨터나 안전 판단 시스템이 아니다.

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

이 변경은 `DiveSessionRecorder.latestAscentRateMetersPerMinute`와 이를 strict `>9m/min`으로 읽는 `ascentWarningActive`만 대상으로 한다. raw callback 처리와 `lastRawSample`, 1Hz `OneHertzProfileSampler` artifact/local persistence, sync schema와 version, `ScubaDiveEngine`의 historical `latestAscentRateMetersPerMinute` 및 `maxAscentRateMetersPerMinute`은 그대로다. 화면의 `Ascent` metric은 recorder의 이 live field에 계속 binding한다.

smoothed rate와 transient warning은 기록 화면의 비인증 보조 reference다. 감압 의무, 안전한 상승 판단, underwater instruction을 계산하지 않으며 인증된 다이브 컴퓨터나 훈련을 대체하지 않는다.

## 시작 규칙

- manual start는 사용자가 고른 명시적 `PreDivePlan`으로 recorder를 시작하고 Divenary가 runtime session을 시작한다.
- system auto-launch는 `Settings > General > Auto-Launch > When Submerged`에서 선택된 Divenary에 watchOS가 runtime session을 제공할 때 시작한다. coordinator는 `DiveSessionStore.preferredDiveMode`로 plan을 만든다.
- Action Button start도 같은 preferred mode로 app-scoped coordinator를 시작한다. `StartDiveIntent`는 다음 Action Button action으로 end intent를 donate한다.
- automatic과 Action Button start는 selected planned dive를 저장하거나 추론하지 않는다. manual start만 explicit plan을 유지한다.
- 이전의 app-local `3 m` sensor auto-start monitor는 제거됐다. `When Submerged`는 local depth threshold가 아니라 watchOS runtime handoff가 기준이다.

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
2. Action Button end는 latest state가 `notSubmerged`이고 elapsed time이 `>=180s (3 minutes)`일 때만 runtime invalidation을 요청한다. 수중, unknown state, `180s` 미만 rejection은 diver interaction이 아니라 `RealDiveSessionCoordinatorTests.testActionButtonEndRejectsSubmergedUnknownAndTooShortRecordings`로 확인한다.
3. watchOS는 계속 out-of-water 상태가 `>600s (10 minutes)`이면 runtime을 invalidate한다.

단일 `notSubmerged` event는 종료하지 않고, Divenary에는 app-side `600-second (10-minute)` timer가 없다. 이 부재는 `RealDiveSessionCoordinator.swift`의 timer-symbol static search와 `RealDiveSessionCoordinatorTests.testWaterStateChangesDoNotStopOrReplaceRecording`으로 감사한다. `600s (10 minutes)` 전에 resubmerge하면 기존 recorder와 local session ID가 계속 사용된다.

valid depth sample이 있으면 invalidation 뒤 summary를 하나만 만든다. manual/Action Button start가 sample 없이 끝나면 저장하지 않고 compact no-sample result를 한 번 보인다. system auto-launch no-sample attempt는 저장하거나 UI를 남기지 않고 조용히 취소한다.

demo/debug는 `DemoDepthSensorProvider`, Digital Crown depth simulation, `SurfaceEndDiveGate`, surface-gated touch end를 유지한다. 이 경로는 `WKExtendedRuntimeSession`, Water Lock, real Action Button ending, 10분 규칙을 사용하지 않는다.

demo/debug의 system back은 recording, summary, unresolved cleanup 동안 lifecycle이 숨긴다. summary는 Save 또는 Discard 성공 뒤에만 dismiss하며, 실패하면 같은 retry 화면에 남는다. external real flow가 route를 가릴 때 unfinished simulated state cleanup이 성공하면, route가 다시 보이는 즉시 Home dismissal을 요청한다. cleanup이 실패하면 completed로 표시하지 않고 summary 또는 별도 cleanup retry state를 유지한다. simulated recorder start 실패도 recording 화면으로 가장하지 않고 retry 또는 Home dismissal을 제공한다.

## Signing과 실기기 경계

watch `Info.plist`는 `WKBackgroundModes`의 `underwater-depth`를 유지하고, target entitlement는 공개 shallow capability인 `com.apple.developer.submerged-shallow-depth-and-pressure`를 선언한다. Xcode Easy Submersion은 simulator system-session delivery/adoption과 UI navigation만 확인한다. signed bundle/profile, physical sensor delivery, actual hardware `When Submerged` selection/auto-launch, Water Lock, device release readiness의 증거는 아니다.

signed device build에서 code-signing entitlement와 embedded profile 모두를 검사해야 한다. 공개 shallow capability는 manager가 승인한 얕은 범위 접근만 뜻한다. 더 깊은 sensor access는 Apple managed entitlement와 provisioning의 외부 승인 gate이며, 현재 build를 40m sensor-authorized로 설명할 수 없다. physical sensor delivery, signing/profile, `When Submerged`, Water Lock/Crown, Action Button hardware behavior와 watchOS timeout은 모두 계속 미검증 상태다.

15cm bag/tank test는 manually started real session의 shallow sample(예: 약 `0.1 m`)과 Water Lock만 검증한다. Xcode Easy Submersion은 simulator adoption 확인으로만 기록한다. physical `When Submerged` automatic launch는 지원 hardware의 안전하게 통제한 `>1 m`에서 `handle(_:)` adoption과 실제 selection을 별도로 검증해야 한다. Digital Crown, timeout, surfaced eligible Action Button end도 지원 hardware에서 독립적으로 확인해야 한다.

## 관련 문서

- [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
- [열린 질문](../questions/open-questions.md)
- [실기기 검증 체크리스트](../../../docs/2026-07-18-watch-underwater-runtime-device-checklist.md)
- [안전 규칙](../domains/safety-rules.md)
