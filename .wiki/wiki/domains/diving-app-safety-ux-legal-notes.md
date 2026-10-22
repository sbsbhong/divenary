# Diving App / Safety UX and Legal Notes

Sources: user pasted request, 2026-06-28; user pasted hardening request, 2026-06-28; user requested v1 Air-only safety stop scope, 2026-06-28; user requested depth/safety stop/deco pending work, 2026-07-08; 워치 UX 리뷰 3종 및 소유자 백로그 승인, 2026-10-22
Raw: [Diving app technical wiki request](../../raw/algorithms/2026-06-28-diving-app-technical-wiki-request.md); [Diving app wiki hardening request](../../raw/algorithms/2026-06-28-diving-app-wiki-hardening-request.md); [v1 Air-only scuba safety stop scope](../../raw/project/2026-06-28-v1-air-only-scuba-safety-stop.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md); [2026-10-22 워치 UX 리뷰와 소유자 백로그 승인](../../raw/design/2026-10-22-watch-ux-review.md)
Updated: 2026-10-22
Status: Reference / Safety Critical
Owner: local product/dev agent
Last reviewed: 2026-10-22
Change policy: safety wording changes require explicit review
Related pages: [Diving App / Non-Negotiable Safety Rules](diving-app-non-negotiable-safety-rules.md); [Diving App / Scuba Mode](diving-app-scuba-mode.md); [Diving App / Freediving Mode](diving-app-freediving-mode.md); [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
Slug: diving-app-safety-ux-legal-notes

## 요약

이 문서는 safety copy, warning hierarchy, liability-related UX를 정리한다. 앱은 훈련, 인증, 전문 다이브 컴퓨터, 백업 수심계, 타이머, 감압표를 대체하지 않는다. v1 safety stop 권장 상태는 mandatory/decompression stop처럼 보이면 안 된다.

## 2026-10-22 현행 정책과의 충돌

아래 UX 원칙·경고 계층·Critical Warning UX의 센서 이상 햅틱·화면·지속 표시 조합은 과거 문서의 약속이다. 최신 [안전 규칙](safety-rules.md)과 [2026-10-22 개편 설계](../../../docs/superpowers/specs/2026-10-22-ui-ux-overhaul-design.md)는 센서·권장 스탑·상승 자동 햅틱을 사용자 안전 검토 전까지 금지한다. 현재 조작 확인 햅틱과 자동 이상 알림은 다른 기능이다.

소유자는 이 충돌을 [E2 결정 대기 백로그](../questions/open-questions.md)로 등록하도록 승인했다. 방향을 정하기 전에는 최신 금지를 유지하며 과거 경고 표를 구현 지시로 사용하지 않는다. 이 앱은 인증된 다이브 컴퓨터·비상 판단 시스템이 아니다. 감압 계산·안전 판정·생명에 중요한 수중 행동 지시를 구현하지 않으며, 남아 있는 고위험 계산·경고 예시는 현재 제품 범위의 승인이 아니다.

## 필수 메시지

- 이 앱은 훈련과 인증을 대체하지 않는다.
- 워치 앱은 전문 다이브 컴퓨터, 백업 수심계, 타이머, 감압표를 대체하지 않는다.
- 프리다이빙은 혼자 하지 않는다.
- 앱은 블랙아웃, DCS, 산소 독성, 질소 마취, CO2 retention을 확정 예측하지 못한다.
- 센서/배터리/앱 상태 이상 시 즉시 보수적인 절차를 따른다.
- 스쿠버에서 NDL/ceiling을 표시하는 경우, 이전 다이브 정보가 누락되면 값이 틀릴 수 있다.
- 다른 다이브 앱/컴퓨터와 혼용하면 residual nitrogen/tissue loading이 일치하지 않을 수 있다.

## UX 원칙

- 위험 경고는 haptic + visual + persistent state로 제공한다.
- critical warning은 사용자가 실수로 dismiss해도 상태가 해결되기 전까지 계속 남긴다.
- NDL, ceiling, TTS, CNS, gas remaining은 항상 단위와 기준을 함께 표시한다.
- `safe`라는 단어를 함부로 쓰지 않는다.
- `within model limit`, `no mandatory deco obligation currently shown`처럼 제한된 표현을 사용한다.
- v1 Air-only safety stop은 `reminder`, `timer`, `reference`처럼 제한된 표현을 사용하고, 감압 의무나 상승 안전 보장처럼 표현하지 않는다.
- Safety stop 권장은 낮은 severity의 reminder 색상을 사용하고, decompression stop 또는 mandatory stop은 별도 설계 전까지 앱 UI에 표시하지 않는다.
- `required`라는 data field 이름이 있어도 사용자-facing copy에서는 `필수`로 번역하지 않는다. v1 safety stop은 `권장`, `리마인더`, `참고` 표현을 사용한다.

## 경고 계층

| 계층 | 예 | UX 처리 |
|---|---|---|
| Critical | MOD 초과, 상승속도 초과, ceiling violation, 센서/배터리/app failure | haptic + visual + persistent state, dismiss 후에도 상태가 해결될 때까지 유지 |
| Important | NDL 임박, safety stop 이탈, CNS 높음, gas 부족 | 명확한 단위와 기준 표시, 로그 marker |
| Context | 저수온, 장시간 노출, 짧은 surface interval, residual load 높음 | 보수성 reminder와 사후 review |

v1 Air-only safety stop 권장 상태는 위 표의 Critical warning처럼 보이면 안 된다. 향후 decompression stop을 추가한다면 safety stop 권장과 같은 chip, 같은 색상, 같은 문구를 재사용하지 않는다.

## 표현 제한

`safe`, `guaranteed`, `medically safe`, `certified`, `emergency recommendation`처럼 생명안전 보장으로 읽힐 수 있는 표현을 피한다. 계산값은 `model-based`, `currently shown`, `reference`, `reminder` 같은 제한 표현과 함께 표시한다.

금지 표현:

- `safe`
- `guaranteed`
- `no risk`
- `prevents blackout`
- `prevents DCS`
- `medical-grade`
- `professional dive computer replacement`

권장 표현:

- `currently within configured model limits`
- `no mandatory decompression obligation currently shown`
- `based on available dive history`
- `based on current sensor data`
- `verify with training and backup instruments`
- `use conservative procedures`
- `computation unavailable, fallback to gauge information`

## Critical Warning UX

- haptic + visual + persistent state를 함께 사용한다.
- dismiss 가능하더라도 resolved 전까지 warning state를 유지한다.
- warning 발생과 해제를 모두 로그에 기록한다.
- 수중에서는 긴 문장보다 짧고 명확한 문구를 사용한다.
- iPhone companion app에는 사후 설명과 세부 로그를 제공한다.

## 관련 문서

- [안전 규칙](safety-rules.md)
- [Diving App / Scuba Mode](diving-app-scuba-mode.md)
- [Diving App / Freediving Mode](diving-app-freediving-mode.md)
- [Diving App / Non-Negotiable Safety Rules](diving-app-non-negotiable-safety-rules.md)
- [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
- [Diving App / Immutable Algorithm Reference](../algorithms/diving-app-algorithm-reference.md)
