# 안전 규칙

Sources: pre-Karpathy wiki page, 2026-06-28; user pasted request, 2026-06-28; user pasted hardening request, 2026-06-28; user requested v1 Air-only safety stop scope, 2026-06-28; mobile form validation and pressure metadata, 2026-06-28; Diving App repository implementation, 2026-07-05; Diving App repository implementation, 2026-07-07; user requested depth/safety stop/deco pending work, 2026-07-08; pre-device depth safety sync readiness implementation, 2026-07-09
Raw: [Pre-Karpathy: 안전 규칙](../../raw/domains/safety-rules.md); [Diving app technical wiki request](../../raw/algorithms/2026-06-28-diving-app-technical-wiki-request.md); [Diving app wiki hardening request](../../raw/algorithms/2026-06-28-diving-app-wiki-hardening-request.md); [v1 Air-only scuba safety stop scope](../../raw/project/2026-06-28-v1-air-only-scuba-safety-stop.md); [Mobile form validation and pressure metadata](../../raw/domains/2026-06-28-mobile-form-validation-pressure-metadata.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md); [Watch real-device readiness and explicit demo mode](../../raw/architecture/2026-07-05-watch-real-device-readiness.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md); [Pre-device depth safety sync readiness](../../raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md)
Updated: 2026-07-09
Status: Reference / Safety Critical
Owner: local product/dev agent
Last reviewed: 2026-07-09
Change policy: safety rules require explicit review
Related pages: [Diving App / Non-Negotiable Safety Rules](diving-app-non-negotiable-safety-rules.md); [Diving App / Safety UX and Legal Notes](diving-app-safety-ux-legal-notes.md)

## 요약

이 앱은 레크리에이션 다이빙 로그 companion 앱이다. Certified dive computer, 감압 컴퓨터, 의료기기, 비상 판단 시스템, certified dive equipment replacement가 아니다. Apple Watch 기반 v1 범위는 40m 이하로 제한하고, v1 safety stop은 감압 의무가 아닌 권장 리마인더로 다룬다.

## 현재 상태

현재 앱 화면은 dive log 기록과 확인, 과거 기록 요약, watch에서 기록한 activity data import, 비중요 계획 알림과 Planbook 작성을 제공할 수 있다. Sensor data, 계획값, derived summary를 안전 판단의 근거처럼 표시하면 안 된다. Apple Watch 기반 기록과 계획 지원 범위는 40m 이하로 제한한다. 40m보다 깊은 값은 raw record/review context로 보존할 수 있지만, warning 없이 정상 지원 범위처럼 표시하거나 certified device output처럼 다루지 않는다.

## 상세

이 앱을 다음처럼 설명하지 않는다.

- 감압 의무 계산
- 조직 loading 계산
- gas switching safety decision 제공
- life-critical underwater instruction 제공
- certified dive computer 또는 certified dive equipment 대체
- medical, legal, emergency recommendation 제공
- 검증되지 않은 Apple Watch sensor data를 authoritative safety data로 취급

허용되는 설명 방식은 다음과 같다.

- recreational dive logging
- companion recording
- post-dive review
- historical summary
- watch-captured activity sync
- non-certified planning reminder
- non-certified ascent/safety-stop assistant status

현재 watch/mobile 화면은 ascent, safety stop, surface interval, no-fly concept을 assistant, 확인 상태, 수동 계획 알림으로만 언급한다. Planbook의 planned max depth, planned duration, water condition, visibility expectation 같은 값은 사용자의 의도와 준비 메모이지 실제 측정값이나 안전 계산 결과가 아니다. 이 경계는 UI copy와 documentation에서 명시적으로 유지해야 한다.

Scuba UX는 air scuba reference assistant를 둘 수 있지만, 이는 세이프티 스톱과 상승 속도를 참고 상태로 보여주는 범위에 한정한다. v1에는 Air-only 레크리에이션 스쿠버 safety-stop 리마인더와 타이머를 포함하되, 이는 감압 모델 기반 의무 정지가 아니라 비인증 참고 기능이다. 현재 구현 constant는 max depth 10m에서 arm, target 5m, displayed stop zone 3-6m, counting zone 2.7-6.3m, duration 180초, counting zone 밖 연속 30초 뒤 reset이다. Countdown은 counting zone 안에서만 누적하며, 너무 얕거나 너무 깊으면 timer를 pause한다. Too-deep 상태에서는 전용 safety-stop UI를 계속 보여주지 않고 일반 scuba live instrument로 돌아간다. 완료 문구도 `권장 스탑 완료`처럼 권장 reminder 완료만 뜻해야 한다.

현재 safety 영역 또는 safety-stop trigger를 벗어난 경우 세이프티 스톱을 권장하는 동작은 유지한다. 다만 권장 상태와 필수 상태는 같은 색이나 같은 severity로 보이면 안 된다. v1 safety stop은 권장 리마인더 색상과 문구를 사용하고, user-facing copy에는 `필수`, `required`, `mandatory`에 해당하는 강한 표현을 쓰지 않는다. Contract compatibility 때문에 `safetyStop.required` field가 남아 있더라도 제품 의미는 optional `recommendationType: "recommended"`와 권장 copy로 제한한다.

Safety stop과 decompression stop은 같은 의미로 쓰지 않는다. Safety stop은 현재 앱에서 비인증 권장 리마인더이며, decompression stop 또는 감압 정지는 감압 모델, 다이브 테이블, 인증된 다이브 컴퓨터 같은 source에서 나온 의무 정지로 사용자가 이해할 수 있다. 이 앱은 감압 정지를 계산하거나 지시하지 않는다. 감압 정지를 추가하려면 용어, 색상, data model, source provenance, failed/unknown 상태, safety copy를 먼저 설계해야 한다.

`safe to ascend`, `no decompression required`, `required stop`처럼 certified dive computer나 감압 판단처럼 읽히는 문구는 쓰지 않는다. Watch UI guard는 active Swift source와 `Localizable.xcstrings`에서 `safe to ascend`, `상승 가능`, `이제 안전합니다`, `안전 확보`, `감압 완료`, `deco clear`, `ceiling clear` 같은 문구를 금지한다. Freedive UX도 training reference와 log review 범위에 머물러야 한다.

Manual scuba pressure entry는 로그/계획 metadata로만 허용된다. 사용자가 start/end pressure와 `bar` 또는 `psi` 단위를 입력할 수 있고, watch-sourced scuba log도 편집 뒤 start/end pressure를 함께 표시할 수 있다. 앱은 이 값으로 gas remaining, reserve, turn pressure, out-of-air risk, emergency action, ascent permission, dive continuation decision을 계산하거나 제안하지 않는다. Tank transmitter, air integration, gas management 계산은 별도 high-risk 범위이며 제품/검증 결정 전에는 구현하지 않는다.

Home 위치 조건 UI는 도시명, local time, 기온, 해안 수온 같은 현재 맥락을 보여주는 mock/provider interface다. 이 정보로 dive suitability score, weather alert, tide/current warning, route planning, no-fly 판단, emergency recommendation을 제공하지 않는다.

Watch sync notification은 local repository 저장 결과를 알려주는 기능이다. Supabase sync, cloud backup, certified dive computer data verification, 안전 검증 완료처럼 표현하지 않는다.

Watch Home의 수심 3m 이상 자동 기록 시작은 사용자가 시작 버튼을 누르지 못했을 때 기록을 시작하기 위한 편의 trigger다. 이 trigger는 다이빙 시작 여부의 certified 판단, 안전 안내, 비상 판단, 감압 계산과 연결하지 않는다.

Fake depth sample은 명시적인 demo capture mode에서만 허용된다. Demo capture는 로그 리뷰에서 `demo`로 표시되어야 하며, 실측 watch log나 안전 근거처럼 취급하지 않는다.

`DiveWatchAppDebug`의 `Test Freedive`와 `Test Scuba`도 기존 `captureMode: demo`를 사용한다. Debug/test recording은 개발과 데모를 위한 경로이며, sync contract에 안전 의미가 있는 별도 상태를 추가하지 않는다.

실제 underwater Apple Watch sensor behavior는 공개 배포 전에 지원되는 hardware에서 수동 검증해야 한다. Simulator, mock sensor, demo mode behavior는 실제 underwater correctness의 증거가 아니다.

40m 초과 수심은 공개 배포 전까지 Apple Watch 기반 지원 범위가 아니다. 모바일 수동 로그, Planbook, watch import는 40m 초과 값을 보존할 수 있지만, 화면은 unsupported-depth warning이나 marker를 함께 보여야 한다. Watch recording 중 현재 수심이 40m를 넘으면 `Outside supported depth`처럼 짧고 제한적인 warning만 표시하며, 사용자의 수중 행동을 지시하는 문구를 붙이지 않는다.

Decompression planning, air integration, tank pressure, emergency decision, certified dive-computer behavior는 별도 high-risk work다. 구현 전 명시적인 제품, 검증, 책임 범위 결정이 필요하다.

Apple Watch Ultra급 프리다이빙/스쿠버 제품 reference는 향후 v1 Gauge + Freedive + Air-only Safety Stop + Log에서 시작하고, v2 이상의 NDL, ceiling, TTS, CNS, OTU, gas remaining, no-fly, repetitive dive carry-over는 고위험 검증 범위로 분리한다. 특히 스쿠버에서 tissue loading state를 앱의 source of truth로 둘 경우, 이전 다이브 state 유실은 가장 위험한 오류 중 하나다. State corruption이 의심되면 NDL/ceiling을 계속 표시하지 말고 gauge fallback과 persistent warning을 사용해야 한다.

## 관련 문서

- [프로젝트 개요](../project/overview.md)
- [Watch 앱 구조](../architecture/watch-app.md)
- [모바일 구조](../architecture/mobile.md)
- [다이브 계획 도메인](dive-planning.md)
- [다이브 로그 도메인](dive-log.md)
- [Diving App / Safety UX and Legal Notes](diving-app-safety-ux-legal-notes.md)
- [Diving App / Non-Negotiable Safety Rules](diving-app-non-negotiable-safety-rules.md)
- [Diving App / Scuba Mode](diving-app-scuba-mode.md)
- [Diving App / Immutable Algorithm Reference](../algorithms/diving-app-algorithm-reference.md)
- [열린 질문](../questions/open-questions.md)
