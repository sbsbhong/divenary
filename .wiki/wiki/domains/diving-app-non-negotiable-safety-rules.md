# Diving App / Non-Negotiable Safety Rules

Sources: user pasted hardening request, 2026-06-28; user requested v1 Air-only safety stop scope, 2026-06-28; user requested depth/safety stop/deco pending work, 2026-07-08; pre-device depth safety sync readiness implementation, 2026-07-09
Raw: [Diving app wiki hardening request](../../raw/algorithms/2026-06-28-diving-app-wiki-hardening-request.md); [v1 Air-only scuba safety stop scope](../../raw/project/2026-06-28-v1-air-only-scuba-safety-stop.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md); [Pre-device depth safety sync readiness](../../raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md)
Updated: 2026-07-09
Status: Reference / Safety Critical
Owner: local product/dev agent
Last reviewed: 2026-07-09
Change policy: rules can only be relaxed with explicit review and documented rationale
Related pages: [Diving App / Safety UX and Legal Notes](diving-app-safety-ux-legal-notes.md); [Diving App / State Management](../architecture/diving-app-state-management.md); [Diving App / Scuba Mode](diving-app-scuba-mode.md); [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md); [Diving App / Product Roadmap](../project/diving-app-product-roadmap.md)
Slug: diving-app-non-negotiable-safety-rules

## 요약

이 문서는 제품 구현에서 절대 위반하면 안 되는 안전 규칙을 정리한다. 앱은 certified dive computer, 감압 컴퓨터, 의료기기, 생명 유지 장치가 아니며, 이 규칙은 제품 범위를 보수적으로 유지하기 위한 release gate다. Apple Watch 기반 v1은 40m 이하 범위와 권장 safety-stop reminder로 제한한다.

## 현재 상태

현재 저장소에는 v2 이상의 스쿠버 계산 기능이 구현되어 있지 않다. 아래 규칙은 향후 구현 전후에 모두 적용하며, 완화하려면 명시적인 검토와 근거 문서가 필요하다.

## 규칙

| # | Rule | Why it matters | Product behavior | Test coverage | Related warning copy |
|---|---|---|---|---|---|
| 1 | tissue state가 없거나 손상되었는데 NDL을 표시하지 않는다. | NDL은 이전 다이브와 현재 tissue state에 의존한다. | NDL 숨김, gauge fallback, persistent warning. | Failure and Fallback: tissue state 손상/누락. | `computation unavailable, fallback to gauge information` |
| 2 | 이전 다이브 정보가 누락되었는데 `safe`라고 표현하지 않는다. | residual nitrogen/tissue loading이 누락되면 값이 틀릴 수 있다. | 제한 copy와 Needs Review 표시. | Mobile history, cross-device sync, failure fallback. | `based on available dive history` |
| 3 | 센서 값이 불안정한 상태에서 ceiling/NDL을 확정값처럼 표시하지 않는다. | sensor dropout/spike는 pressure 기반 계산을 오염시킨다. | computed decompression metrics 숨김. | Watch sensor sampling, pressure anomaly tests. | `based on current sensor data` |
| 4 | MOD 초과 경고는 사용자가 dismiss해도 상태가 해결되기 전까지 유지한다. | ppO2 limit 초과는 critical warning이다. | haptic + visual + persistent state. | Watch warning persistence, UX warning tests. | `MOD exceeded / ppO2 limit exceeded` |
| 5 | ppO2, CNS, ceiling, TTS, gas remaining은 항상 단위와 기준을 함께 표시한다. | 단위와 기준 없는 수치는 오해를 만든다. | 값 옆에 unit, configured model, limit 표시. | Mobile display and algorithm output tests. | `currently within configured model limits` |
| 6 | deco obligation 발생 시 앱은 사용자를 안심시키는 표현을 쓰지 않는다. | mandatory deco는 high-risk 상태다. | `safe` 금지, 제한적 상태 문구 사용. | Mandatory decompression occurrence tests. | `mandatory decompression obligation currently shown` |
| 7 | 프리다이빙에서 블랙아웃 위험을 숫자로 예측한다고 주장하지 않는다. | watch sensor만으로 blackout risk를 신뢰성 있게 계산할 수 없다. | 행동 reminder와 buddy/surface check copy만 사용. | Freedive mode and safety copy tests. | `verify with training and backup procedures` |
| 8 | Apple Watch Ultra를 전문 다이브 컴퓨터의 완전 대체재로 표현하지 않는다. | 제품 범위와 책임 경계를 흐린다. | companion/logging/support 표현 유지. | Legal/safety copy review. | `does not replace training, certification, or backup instruments` |
| 9 | 로그 저장 실패를 조용히 무시하지 않는다. | 사후 review와 state recovery에 직접 영향을 준다. | persistent status, retry path, log marker. | Watch logging, mobile import, failure fallback. | `log save failed / review required` |
| 10 | 앱 업데이트 후 알고리즘 변경이 있으면 기존 dive state와의 호환성을 검증한다. | 기존 state를 새 알고리즘으로 해석하면 결과가 달라질 수 있다. | migration/recalculation policy와 regression 결과 기록. | Regression Test Policy. | `updated calculation model / review previous state` |
| 11 | state corruption이 의심되면 NDL/ceiling을 계속 표시하지 않고 gauge fallback으로 전환한다. | 손상된 state 기반 계산은 false confidence를 만든다. | NDL/ceiling 숨김, current depth/time/rate 중심 fallback. | Failure and Fallback: state corruption. | `computation unavailable, fallback to gauge information` |
| 12 | gas setting이 불명확하면 ppO2, MOD, CNS, NDL을 신뢰 가능한 값처럼 표시하지 않는다. | gas fraction 오류는 산소 노출과 tissue 계산 전체를 오염시킨다. | gas setting required 상태 표시, 계산값 숨김. | Mobile gas validation, watch sync settings. | `gas setting unavailable / calculation unavailable` |
| 13 | 사용자가 다른 다이브 앱/컴퓨터와 혼용한 경우 residual nitrogen/tissue loading 불일치를 경고한다. | 서로 다른 source of truth는 NDL/ceiling 차이를 만든다. | app switching warning과 history completeness 표시. | Cross-device sync and history tests. | `based on this app's available dive history` |
| 14 | critical warning은 단순 toast로 끝내지 않고 persistent 상태로 유지한다. | 수중에서는 일시적 메시지를 놓칠 수 있다. | haptic + visual + persistent state, resolved log. | Warning hierarchy tests. | `critical warning active` |
| 15 | 수중에서 앱이 죽거나 센서가 끊기면 보수적인 fallback UX를 제공한다. | 계산값보다 사용자가 상태 이상을 아는 것이 중요하다. | gauge fallback, warning copy, event persist. | Watch reboot/crash/dropout tests. | `sensor unavailable / use conservative procedures` |
| 16 | v1 Air-only safety stop을 감압 의무나 상승 안전 보장처럼 표현하지 않는다. | v1 safety stop은 스쿠버 앱의 기본 참고 기능이지만 NDL/ceiling/tissue state를 계산하지 않는다. | reminder/timer copy만 사용하고 `required stop`, `safe to ascend`, `no decompression required` 표현을 금지한다. | v1 safety-stop copy review, countdown pause/resume tests. | `safety stop reminder / verify with training and backup instruments` |
| 17 | Apple Watch 기반 v1 수심 지원을 40m 이하로 제한한다. | 40m보다 깊은 수심에서 Apple Watch sensor behavior와 제품 책임 범위가 검증되지 않았다. | Logbook/Planbook/watch import는 40m 초과 값을 보존하되 warning/marker 없이 정상 지원처럼 표시하지 않는다. Watch runtime도 40m 초과 중 unsupported-depth warning을 보여준다. | Depth cap validation, unsupported-depth import/review tests. | `unsupported depth / review source` |
| 18 | Safety stop과 decompression stop을 같은 용어, 색상, data model로 합치지 않는다. | 권장 리마인더와 의무 감압 정지는 사용자가 다르게 이해해야 한다. | v1 safety stop은 권장 색상과 copy를 쓰고, mandatory/decompression 상태는 별도 설계 전 노출하지 않는다. | Safety/deco copy guard, contract compatibility tests. | `recommended stop / mandatory decompression stop unavailable` |

## 관련 문서

- [Diving App / Safety UX and Legal Notes](diving-app-safety-ux-legal-notes.md)
- [Diving App / State Management](../architecture/diving-app-state-management.md)
- [Diving App / Scuba Mode](diving-app-scuba-mode.md)
- [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
- [Diving App / Product Roadmap](../project/diving-app-product-roadmap.md)
