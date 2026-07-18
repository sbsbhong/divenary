# Watch 앱 구조

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Watch underwater runtime lifecycle implementation and device boundary, 2026-07-18
Raw: [Pre-Karpathy: Watch 앱 구조](../../raw/architecture/watch-app.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Watch underwater runtime lifecycle implementation and device boundary](../../raw/architecture/2026-07-18-watch-underwater-runtime-lifecycle.md)
Updated: 2026-07-18

## 요약

`apps/mobile/ios/DivenaryWatchApp`는 `apps/mobile/ios/Divenary.xcodeproj`의 `DivenaryWatchApp` target이 소유하는 SwiftUI watchOS companion이다. real recording은 watchOS underwater extended runtime lifecycle을 따르고, demo/debug recording은 별도의 view-scoped simulation 흐름을 유지한다. 이 앱은 다이빙 기록과 사후 리뷰 companion이며 인증된 다이브 컴퓨터나 안전 판단 시스템이 아니다.

## 앱 범위와 소유권

`DiveAppServices`는 watch process의 composition root다. 하나의 `DiveSessionStore`, `WaterSubmersionCoordinator`, `DiveRuntimeSessionController`, real `DiveSessionRecorder`, `RealDiveSessionCoordinator`, Action Button bridge를 유지한다. SwiftUI navigation, system auto-launch, App Intent가 각각 sensor, runtime, recorder를 새로 만들지 않는다.

`WaterSubmersionCoordinator`는 production에서 유일하게 `CMWaterSubmersionManager`를 만든다. 이 coordinator는 valid depth/pressure sample, optional temperature, submersion event, error, authorized `maximumDepth`를 앱 범위에서 전달한다. `RealDepthSensorProvider`는 manager owner가 아니라 real recorder의 sample subscription adapter다.

`DivenaryWatchApplicationDelegate.handle(_:)`는 watchOS가 준 `WKExtendedRuntimeSession`을 runtime controller로 즉시 넘긴다. controller는 `handle(_:)`가 끝나기 전에 concrete delegate를 붙이고, adopted session에는 `start()`를 다시 호출하지 않는다.

## 시작 규칙

- manual start는 사용자가 고른 명시적 `PreDivePlan`으로 recorder를 시작하고 Divenary가 runtime session을 시작한다.
- system auto-launch는 `Settings > General > Auto-Launch > When Submerged`에서 선택된 Divenary에 watchOS가 runtime session을 제공할 때 시작한다. coordinator는 `DiveSessionStore.preferredDiveMode`로 plan을 만든다.
- Action Button start도 같은 preferred mode로 app-scoped coordinator를 시작한다. `StartDiveIntent`는 다음 Action Button action으로 end intent를 donate한다.
- automatic과 Action Button start는 selected planned dive를 저장하거나 추론하지 않는다. manual start만 explicit plan을 유지한다.
- 이전의 app-local `3m` sensor auto-start monitor는 제거됐다. `When Submerged`는 local depth threshold가 아니라 watchOS runtime handoff가 기준이다.

## 종료와 결과 규칙

real recording에는 touch end control이 없다. 다음 신호는 runtime invalidation을 거쳐 하나의 idempotent finalizer로 수렴한다.

1. surface 뒤 Digital Crown을 길게 눌러 Water Lock을 해제하면 watchOS가 runtime을 invalidate한다.
2. Action Button end는 latest state가 `notSubmerged`이고 elapsed time이 `>=3m`일 때만 runtime invalidation을 요청한다. 수중 또는 너무 이른 요청은 recording을 유지한다.
3. watchOS는 계속 out-of-water 상태가 `>10m`이면 runtime을 invalidate한다.

단일 `notSubmerged` event는 종료하지 않고, Divenary에는 app-side 10-minute timer가 없다. 10분 전에 resubmerge하면 기존 recorder와 local session ID가 계속 사용된다.

valid depth sample이 있으면 invalidation 뒤 summary를 하나만 만든다. manual/Action Button start가 sample 없이 끝나면 저장하지 않고 compact no-sample result를 한 번 보인다. system auto-launch no-sample attempt는 저장하거나 UI를 남기지 않고 조용히 취소한다.

demo/debug는 `DemoDepthSensorProvider`, Digital Crown depth simulation, `SurfaceEndDiveGate`, surface-gated touch end를 유지한다. 이 경로는 `WKExtendedRuntimeSession`, Water Lock, real Action Button ending, 10분 규칙을 사용하지 않는다.

## Signing과 실기기 경계

watch `Info.plist`는 `WKBackgroundModes`의 `underwater-depth`를 유지하고, target entitlement는 공개 shallow capability인 `com.apple.developer.submerged-shallow-depth-and-pressure`를 선언한다. repository metadata, simulator compile, Xcode Easy Submersion은 signed bundle/profile 또는 물리 behavior의 증거가 아니다.

signed device build에서 code-signing entitlement와 embedded profile 모두를 검사해야 한다. 공개 shallow capability는 manager가 승인한 얕은 범위 접근만 뜻한다. 더 깊은 sensor access는 Apple managed entitlement와 provisioning의 외부 승인 gate이며, 현재 build를 40m sensor-authorized로 설명할 수 없다.

15cm bag/tank test는 manually started real session의 shallow sample(예: 약 `0.1m`)과 Water Lock만 검증한다. `When Submerged` automatic launch는 Xcode Easy Submersion 또는 안전하게 통제한 `>1m`에서 `handle(_:)` adoption을 별도로 검증해야 한다. Digital Crown, timeout, Action Button도 지원 hardware에서 독립적으로 확인해야 한다.

## 관련 문서

- [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
- [열린 질문](../questions/open-questions.md)
- [실기기 검증 체크리스트](../../../docs/2026-07-18-watch-underwater-runtime-device-checklist.md)
- [안전 규칙](../domains/safety-rules.md)
