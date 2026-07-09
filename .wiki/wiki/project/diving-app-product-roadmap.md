# Diving App / Product Roadmap

Sources: user pasted request, 2026-06-28; user pasted hardening request, 2026-06-28; user requested v1 Air-only safety stop scope, 2026-06-28; user requested depth/safety stop/deco pending work, 2026-07-08
Raw: [Diving app technical wiki request](../../raw/algorithms/2026-06-28-diving-app-technical-wiki-request.md); [Diving app wiki hardening request](../../raw/algorithms/2026-06-28-diving-app-wiki-hardening-request.md); [v1 Air-only scuba safety stop scope](../../raw/project/2026-06-28-v1-air-only-scuba-safety-stop.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md)
Updated: 2026-07-08
Status: Draft / Needs Validation
Owner: local product/dev agent
Last reviewed: 2026-07-08
Change policy: roadmap can change with documented rationale
Related pages: [Diving App / Overview](diving-app-overview.md); [Diving App / QA and Test Plan](diving-app-qa-test-plan.md); [Diving App / Non-Negotiable Safety Rules](../domains/diving-app-non-negotiable-safety-rules.md); [Diving App / State Management](../architecture/diving-app-state-management.md)
Slug: diving-app-product-roadmap

## 요약

추천 제품 범위는 v1 → v2 → v3 → v4 순서다. v1은 Apple Watch 기반 40m 이하 Gauge + Freedive + Log에 Air-only 레크리에이션 스쿠버 safety-stop 리마인더를 포함한다. 스쿠버 계산, decompression stop, gas integration은 검증 조건을 통과한 뒤 단계적으로 다룬다.

## Roadmap Principle

v1은 Apple Watch 기반 40m 이하 gauge/freedive/log 중심이지만, 스쿠버 앱으로서의 최소 의미를 위해 Air-only 레크리에이션 스쿠버 safety-stop 리마인더와 타이머를 포함한다. 이 v1 safety stop은 NDL, ceiling, tissue loading, no-fly, gas remaining과 연결하지 않는 비인증 참고 기능이다. 40m보다 깊은 수심은 Apple Watch sensor behavior와 책임 범위 검토 뒤 별도 결정한다. v2부터 사용자가 사실상 dive computer로 받아들일 수 있으므로 algorithm validation과 state recovery가 release gate가 된다. v3는 가스 연동 신뢰성이 release gate가 된다. v4는 MVP 범위가 아니며 별도 제품/검증/책임 범위로 다룬다.

## 단계

| 버전  | 이름                                  | 목표                                | 제품 범위                                                                                                                                      |
| --- | ----------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| v1  | Gauge + Freedive + Air Scuba Safety Stop + Log | 스쿠버 앱의 최소 의미를 갖는 40m 이하 Air-only 시작점 | Apple Watch 기반 40m 이하 현재 수심, 최대 수심, 평균 수심, 다이브 시간, 수온, 상승/하강 속도, 프리다이빙 surface interval, 30초 post-surface timer, 목표 수심/시간 알림, 로그/profile, Air-only 스쿠버 gauge mode, 비인증 safety-stop 리마인더/타이머 |
| v2  | Recreational Scuba No-Decompression | 레크리에이션 Air/Nitrox 다이브 컴퓨터에 가까운 기능 | Air/Nitrox, ppO2, MOD, Bühlmann ZHL-16C + Gradient Factors, NDL, ceiling, model-integrated safety stop, TTS, CNS, no-fly, repetitive dive tissue carry-over |
| v3  | Gas-integrated Scuba                | 무선 압력 송신기 또는 수동 입력 기반 가스 관리       | tank pressure, SAC/RMV, gas time remaining, turn pressure, reserve warning, gas planning                                                   |
| v4  | Technical / Trimix / Deco           | 미래 확장 후보, MVP 제외                  | Trimix, multiple gas switch, accelerated deco, helium tissue loading, END, gas density, mandatory deco planning                            |

## v1: Gauge + Freedive + Air Scuba Safety Stop + Log

v1 기능:

- 40m 이하 Apple Watch 기반 현재 수심
- 최대 수심
- 평균 수심
- 다이브 시간
- 수온
- 상승/하강 속도
- 프리다이빙 surface interval
- 30초 post-surface timer
- 목표 수심/시간 알림
- 로그/profile
- Air-only 스쿠버 gauge mode
- Air-only 레크리에이션 스쿠버 safety-stop 리마인더/타이머
- safety-stop countdown pause/resume
- safety-stop 상태와 이탈 marker
- 권장 safety stop과 future mandatory/decompression stop의 색상/용어 분리

v1에서 하지 않는다.

- Nitrox/FO2 설정
- NDL 표시
- tissue loading 계산
- decompression ceiling 표시
- decompression 기반 stop obligation 계산
- mandatory deco 계산
- decompression stop 또는 감압 정지를 v1 safety stop과 같은 의미로 표시
- 40m보다 깊은 Apple Watch 수심을 정상 지원 범위로 표시
- no-fly 계산
- gas remaining 계산

v1 release blockers:

- depth sensor sampling 안정성 검증 전 출시 금지
- 수중 화면 잠금/터치/크라운 UX 검증 전 출시 금지
- 로그 유실 가능성 검증 전 출시 금지
- 저전력/배터리 경고 UX 검증 전 출시 금지
- 프리다이빙 surface interval timer 검증 전 출시 금지
- post-surface 30초 timer 검증 전 출시 금지
- v1 Air-only safety-stop trigger와 countdown pause/resume 검증 전 출시 금지
- safety-stop copy가 certified dive computer나 감압 판단처럼 읽히지 않는지 검토 전 출시 금지
- Watch 단독 로그 저장 검증 전 출시 금지

## v2: Recreational Scuba No-Decompression

v2 기능 후보:

- Air/Nitrox
- ppO2
- MOD
- Bühlmann ZHL-16C + Gradient Factors
- NDL
- ceiling
- model-integrated safety stop
- TTS
- CNS
- no-fly
- repetitive dive tissue carry-over

v2 진입 조건:

- tissue model unit test 완료
- known dive profile regression test 완료
- 앱 재시작 후 tissue state 복구 검증
- sensor failure fallback 검증
- battery/screen lock/background behavior 검증

v2 release blockers:

- Bühlmann coefficient source 확정 전 출시 금지
- tissue loading regression test 통과 전 출시 금지
- NDL/ceiling known profile 테스트 통과 전 출시 금지
- 앱 재시작 후 tissue state recovery 검증 전 출시 금지
- 잘못된 tissue state에서 NDL 표시 방지 검증 전 출시 금지
- ppO2/MOD/CNS 계산 테스트 통과 전 출시 금지
- model-integrated safety stop countdown 테스트 통과 전 출시 금지
- no-fly calculation 정책 확정 전 출시 금지
- 다른 다이브 앱/컴퓨터와 혼용 시 경고 UX 확정 전 출시 금지

## v3: Gas-integrated Scuba

v3 기능 후보:

- tank pressure
- SAC/RMV
- gas time remaining
- turn pressure
- reserve warning
- gas planning

v3 진입 조건:

- pressure transmitter integration 안정화
- tank profile 설정 UX 완성
- reserve pressure 경고 검증
- TTS + gas remaining 통합 검증

v3 release blockers:

- tank pressure transmitter reliability 검증 전 출시 금지
- pressure dropout 처리 검증 전 출시 금지
- tank profile 설정 UX 검증 전 출시 금지
- reserve pressure 경고 검증 전 출시 금지
- gas remaining이 TTS보다 부족한 상황의 critical warning 검증 전 출시 금지
- SAC/RMV 계산 regression test 통과 전 출시 금지

## v4: Technical / Trimix / Deco

v4 기능 후보:

- Trimix
- multiple gas switch
- accelerated deco
- helium tissue loading
- END
- gas density
- mandatory deco planning

Apple Watch Ultra급 40m 레크리에이션 제한과 제품 리스크를 고려하면 v4는 기본 제품 범위에서 제외하고, 별도 제품/별도 인증/별도 검증 대상으로 다룬다.

v4 release blockers:

- 별도 기술 다이빙 검증 계획 없이 출시 금지
- multiple gas switch 검증 전 출시 금지
- helium tissue loading 검증 전 출시 금지
- accelerated deco planning 검증 전 출시 금지
- END/gas density 정책 확정 전 출시 금지
- mandatory decompression planning을 사용자가 어떻게 이해할지 UX 검증 전 출시 금지
- Apple Watch Ultra급 40m 제한과 제품 리스크를 다시 검토하기 전 출시 금지

## 관련 문서

- [Diving App / Overview](diving-app-overview.md)
- [Diving App / Freediving Mode](../domains/diving-app-freediving-mode.md)
- [Diving App / Scuba Mode](../domains/diving-app-scuba-mode.md)
- [Diving App / State Management](../architecture/diving-app-state-management.md)
- [Diving App / QA and Test Plan](diving-app-qa-test-plan.md)
- [Diving App / Non-Negotiable Safety Rules](../domains/diving-app-non-negotiable-safety-rules.md)
- [Diving App / Open Questions](../questions/diving-app-open-questions.md)
