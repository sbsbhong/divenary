# 안전 규칙

Sources: pre-Karpathy wiki page, 2026-06-28; user pasted request, 2026-06-28; user pasted hardening request, 2026-06-28; user requested v1 Air-only safety stop scope, 2026-06-28; mobile form validation and pressure metadata, 2026-06-28; Diving App repository implementation, 2026-07-05; Diving App repository implementation, 2026-07-07; user requested depth/safety stop/deco pending work, 2026-07-08; pre-device depth safety sync readiness implementation, 2026-07-09; Debug test capture provenance, 2026-07-12; pre-real-dive readiness scope and immediate hardening, 2026-07-12; 2026-10-21 프로젝트 리뷰 후속 수정 경계, 2026-10-21; 2026-10-22 모바일·워치 UI/UX 개편, 2026-10-22; 워치 UX 리뷰 3종 및 소유자 백로그 승인, 2026-10-22
Raw: [Pre-Karpathy: 안전 규칙](../../raw/domains/safety-rules.md); [Diving app technical wiki request](../../raw/algorithms/2026-06-28-diving-app-technical-wiki-request.md); [Diving app wiki hardening request](../../raw/algorithms/2026-06-28-diving-app-wiki-hardening-request.md); [v1 Air-only scuba safety stop scope](../../raw/project/2026-06-28-v1-air-only-scuba-safety-stop.md); [Mobile form validation and pressure metadata](../../raw/domains/2026-06-28-mobile-form-validation-pressure-metadata.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md); [Watch real-device readiness and explicit demo mode](../../raw/architecture/2026-07-05-watch-real-device-readiness.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md); [Pre-device depth safety sync readiness](../../raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md); [Debug test capture provenance](../../raw/architecture/2026-07-12-debug-test-capture-provenance.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [2026-10-21 프로젝트 리뷰 후속 수정 경계](../../raw/architecture/2026-10-21-review-remediation.md); [2026-10-22 모바일·워치 UI/UX 개편](../../raw/design/2026-10-22-ui-ux-overhaul.md); [2026-10-22 워치 UX 리뷰와 소유자 백로그 승인](../../raw/design/2026-10-22-watch-ux-review.md)
Updated: 2026-10-22
Status: Reference / Safety Critical
Owner: local product/dev agent
Last reviewed: 2026-10-22
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

`safe to ascend`, `no decompression required`, `required stop`처럼 certified dive computer나 감압 판단처럼 읽히는 문구는 쓰지 않는다. Watch UI guard는 active Swift source와 `Localizable.xcstrings`에서 `safe to ascend`, `상승 가능`, `이제 안전합니다`, `안전 확보`, `감압 완료`, `deco clear`, `ceiling clear` 같은 문구를 금지한다. 2026-10-22부터는 권장 스탑이 필수 정지처럼 읽히지 않도록 한국어 catalog 값의 `세이프티`·`스톱`과 영어 값의 `safety stop`도 금지하고, 모바일 `i18n.test.ts`는 권장 스탑 상태 문구에 required, mandatory, decompression, safety stop, danger에 해당하는 말이 없는지 검사한다. Freedive UX도 training reference와 log review 범위에 머물러야 한다.

Manual scuba pressure entry는 로그/계획 metadata로만 허용된다. 사용자가 start/end pressure와 `bar` 또는 `psi` 단위를 입력할 수 있고, watch-sourced scuba log도 편집 뒤 start/end pressure를 함께 표시할 수 있다. 앱은 이 값으로 gas remaining, reserve, turn pressure, out-of-air risk, emergency action, ascent permission, dive continuation decision을 계산하거나 제안하지 않는다. Tank transmitter, air integration, gas management 계산은 별도 high-risk 범위이며 제품/검증 결정 전에는 구현하지 않는다.

Home 위치 조건 UI는 도시명, local time, 기온, 해안 수온 같은 현재 맥락을 보여주는 mock/provider interface다. 이 정보로 dive suitability score, weather alert, tide/current warning, route planning, no-fly 판단, emergency recommendation을 제공하지 않는다.

Watch sync notification은 local repository 저장 결과를 알려주는 기능이다. Supabase sync, cloud backup, certified dive computer data verification, 안전 검증 완료처럼 표현하지 않는다.

Watch는 app-local 수심 trigger로 기록을 시작하지 않는다. 물 감지는 Wet Ready 표시까지만 하고, 기록은 수동 시작, watchOS `When Submerged` auto-launch, Action Button으로만 시작한다. 어떤 시작 경로도 다이빙 시작 여부의 certified 판단, 안전 안내, 비상 판단, 감압 계산과 연결하지 않는다. (2026-07 이전 문서의 Home 3m 자동 시작 설명은 2026-09-01 Wet Ready 도입으로 대체됐다.)

Watch 기록 화면은 유효 depth sample이 5초 넘게 없거나 sensor 오류·sensor 허가 범위 초과 상태이면 수심과 상승 속도 숫자 대신 `--.- m`와 상태 문구를 보인다. 마지막으로 받은 값을 현재 값처럼 남기지 않는다. sensor 범위를 넘었거나 sample 공백이 30초를 넘은 기록의 권장 스탑은 `unknown`으로 저장하고, sample 사이 5초를 넘는 시간은 권장 스탑 시간으로 적립하지 않는다.

권장 스탑의 진행·일시정지·미완료 상태는 caution 앰버 색과 "권장 스탑" 문구를 쓴다(워치의 완료 상태는 보조 회색). 오류나 위험을 뜻하는 `danger` 빨강이나 action 파랑은 쓰지 않는다. 일시정지는 색만이 아니라 "타이머 일시정지" 문구로도 구별한다. Always-On 화면에서도 권장 스탑 라벨과 일시정지 문구, 수심 상태 chip, Demo/Test 표식은 숨기지 않는다.

Watch 햅틱은 다이버가 한 조작을 확인하는 데만 쓴다(시작, 동작 버튼·크라운으로 화면 넘김, 거부된 누르기, 종료 요청, 실제 기록 저장 완료). 자동 화면 전환(10초 무입력 복귀, 프리다이빙 하강·수면, 권장 스탑 시작, 수심 신호 변화, Always-On 진입)과 센서 오류·권장 스탑·상승 상태 변화에는 햅틱이 없다. 센서 오류·권장 스탑·상승에 햅틱을 붙이면 수중 행동 신호처럼 읽힐 수 있어 별도 안전 검토 전에는 추가하지 않는다. 햅틱은 `WatchDiveHaptics` 한 곳에서만 울리고, test가 권장 스탑 진입 때 햅틱이 없음을 검사한다.

실제 기록은 터치로 끝나지 않는다. 종료는 수면에서 수중 잠금 해제, watchOS의 물 밖 10분 규칙, 또는 물 밖 180초 뒤 순환에 생기는 종료 화면에서 동작 버튼을 누르는 경로뿐이며, 종료 화면에도 탭 대상이 없다. 동작 버튼 종료는 두 번 이상의 의도된 누르기이고 `notSubmerged`와 180초 guard는 그대로다. 크라운 회전은 화면만 넘기고 종료에 연결하지 않는다. 기록 중 세부 화면에는 상승 참고값을 넣지 않는다.

Fake depth sample은 명시적인 demo capture mode에서만 허용된다. Demo capture는 로그 리뷰에서 `demo`로 표시되어야 하며, 실측 watch log나 안전 근거처럼 취급하지 않는다. `captureMode`가 없는 옛 저장 기록은 real provider가 생기기 전 기록이므로 `demo`로 읽는다. Demo·debug 기록은 모바일 계획과 연결하지 않고 계획을 실행됨으로 표시하지 않는다.

수온이 아직 측정되지 않았으면 unknown으로 보존한다. `0°C` 같은 임의 fallback을 실측값처럼 저장하거나 표시하지 않는다. 60초보다 오래된 수온과 recording 시작 전·이전 다이빙의 수온은 sample에 붙이지 않는다. 얕은 물통·수영장 검증은 sensor integration 확인일 뿐 실제 프리다이빙·스쿠버 correctness 증거가 아니다.

`DiveWatchAppDebug`의 `Test Freedive`와 `Test Scuba`도 기존 `captureMode: demo`를 사용하고 `debug-test-capture` tag로 일반 demo와 구분한다. Watch와 mobile은 이를 `Test`로 표시한다. Debug/test recording은 개발 검증 경로이며 실측 기록처럼 표시하지 않고, sync contract에 안전 의미가 있는 별도 상태를 추가하지 않는다.

실제 underwater Apple Watch sensor behavior는 공개 배포 전에 지원되는 hardware에서 수동 검증해야 한다. Simulator, mock sensor, demo mode behavior는 실제 underwater correctness의 증거가 아니다.

40m 초과 수심은 공개 배포 전까지 Apple Watch 기반 지원 범위가 아니다. 모바일 수동 로그, Planbook, watch import는 40m 초과 값을 보존할 수 있지만, 화면은 unsupported-depth warning이나 marker를 함께 보여야 한다. Watch recording 중 현재 수심이 40m를 넘으면 `Outside supported depth`처럼 짧고 제한적인 warning만 표시하며, 사용자의 수중 행동을 지시하는 문구를 붙이지 않는다.

Decompression planning, air integration, tank pressure, emergency decision, certified dive-computer behavior는 별도 high-risk work다. 구현 전 명시적인 제품, 검증, 책임 범위 결정이 필요하다.

Apple Watch Ultra급 프리다이빙/스쿠버 제품 reference는 향후 v1 Gauge + Freedive + Air-only Safety Stop + Log에서 시작하고, v2 이상의 NDL, ceiling, TTS, CNS, OTU, gas remaining, no-fly, repetitive dive carry-over는 고위험 검증 범위로 분리한다. 특히 스쿠버에서 tissue loading state를 앱의 source of truth로 둘 경우, 이전 다이브 state 유실은 가장 위험한 오류 중 하나다. State corruption이 의심되면 NDL/ceiling을 계속 표시하지 말고 gauge fallback과 persistent warning을 사용해야 한다.

## 2026-10-22 워치 UX 리뷰의 미결 경계

이 앱은 인증된 다이브 컴퓨터가 아니며 사실 기록·사후 리뷰와 비중요 계획 리마인더에 한정한다. 소유자는 D·E의 백로그 등록을 승인했으며 안전 정책 변경을 승인한 것은 아니다.

- **E1:** 이 문서와 [Watch 앱 구조](../architecture/watch-app.md)의 비인증 라이브 상승 속도 표시 설명은 benchmark의 상승 지시 회피 원칙과 충돌한다. 유지·숨김·수면 후 리뷰만 표시 중 [소유자 결정](../questions/open-questions.md)이 필요하다. 현재 표시를 새로 승인하거나 안전 판단으로 격상하지 않는다.
- **E2:** [과거 안전 UX·법률 문서](diving-app-safety-ux-legal-notes.md)의 센서 이상 햅틱·화면·지속 표시 약속은 현재의 자동 햅틱 금지와 충돌한다. [E2 결정](../questions/open-questions.md) 전에는 최신 금지를 유지한다. 과거 약속을 미구현 자동 경보의 승인으로 해석하지 않는다.
- **D1·D2·D6:** 배터리는 기록 도구 상태, 수면 카드는 관찰 뒤 경과 시간의 카운트업만 표시한다. 다음 입수 권고·준비 판정은 없다. 약 6 m의 공개 shallow 접근과 40 m 제품 경계를 구분하며, 범위 밖 수심을 추정해 채우거나 수중 행동을 지시하지 않는다. [승인 백로그](../architecture/implementation-priorities.md)는 실제 수중 검증 완료의 증거가 아니다.

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
