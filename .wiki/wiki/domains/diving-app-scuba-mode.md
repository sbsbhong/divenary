# Diving App / Scuba Mode

Sources: user pasted request, 2026-06-28; user pasted hardening request, 2026-06-28; user requested v1 Air-only safety stop scope, 2026-06-28; Diving App repository implementation, 2026-07-05
Raw: [Diving app technical wiki request](../../raw/algorithms/2026-06-28-diving-app-technical-wiki-request.md); [Diving app wiki hardening request](../../raw/algorithms/2026-06-28-diving-app-wiki-hardening-request.md); [v1 Air-only scuba safety stop scope](../../raw/project/2026-06-28-v1-air-only-scuba-safety-stop.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md)
Updated: 2026-07-05
Status: Draft / Needs Validation / Safety Critical
Owner: local product/dev agent
Last reviewed: 2026-06-28
Change policy: scuba requirements require explicit safety review
Related pages: [Diving App / Immutable Algorithm Reference](../algorithms/diving-app-algorithm-reference.md); [Diving App / State Management](../architecture/diving-app-state-management.md); [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md); [Diving App / Non-Negotiable Safety Rules](diving-app-non-negotiable-safety-rules.md)
Slug: diving-app-scuba-mode

## 요약

Scuba mode는 사용자가 다이브 컴퓨터로 인식할 수 있으므로 가장 엄격하게 설계해야 한다. v1은 Air-only gauge/log에 기본 safety-stop 리마인더를 포함하지만, NDL, ceiling, TTS, CNS, gas remaining은 충분한 검증 전 제품 기능으로 다루지 않는다.

## 현재 상태

현재 앱은 certified dive computer가 아니며 감압 판단, 생명-critical underwater instruction, 의료 판단을 제공하지 않는다. v1의 스쿠버 범위는 Air-only gauge/log와 rule-based safety-stop 리마인더까지 포함하고, v2 이상의 스쿠버 계산 기능은 별도 검증 기준으로 다룬다. Watch implementation은 `SafetyStopController`와 `ScubaDiveEngine`으로 reminder state를 testable logic에 둔다.

## 필수 역할

| 번호 | 역할 | 기준 |
|---|---|---|
| 1 | 현재 수심, 최대 수심, 평균 수심 | sensor filtering과 이상치 처리 필요 |
| 2 | 다이브 시간, bottom time | elapsed time summary |
| 3 | 상승 속도 경고 | depth별 limit 적용 |
| 4 | Air/Nitrox gas setting | gas fraction 입력 검증 |
| 5 | ppO2 | `FO2 · P_abs` |
| 6 | MOD | ppO2 limit 기반 maximum operating depth |
| 7 | Bühlmann ZHL-16C tissue loading | gas별 16 compartment state |
| 8 | Gradient Factor | GF low/high, 보수성 정책 |
| 9 | NDL | 이전 다이브 tissue state 포함 |
| 10 | ceiling | 모든 조직 중 가장 깊은 ceiling |
| 11 | safety stop | v1은 Air-only rule-based reminder, v2 이상은 no-decompression model-integrated reminder |
| 12 | mandatory decompression stop | 기본 제품 범위 밖, 고위험 처리 |
| 13 | TTS | 상승 시간 + stop time |
| 14 | CNS | NOAA table 또는 검증 source 필요 |
| 15 | OTU | oxygen exposure reference metric |
| 16 | surface interval | repetitive dive carry-over 입력 |
| 17 | no-fly time | non-certified reminder |
| 18 | repetitive dive carry-over | tissue state persistence |
| 19 | 로그 | raw samples와 computed metrics 저장 |
| 20 | sensor/app failure handling | gauge fallback과 persistent warning |

## 상승 속도 기준 예

```txt
if d > 18m:
    limit = 12 m/min
elif d > 6m:
    limit = 9 m/min
else:
    limit = 6 m/min
```

절대 초과 경고 기준:

```txt
18 m/min보다 빠른 상승은 강한 경고로 처리한다.
```

이 기준은 제품 정책 후보이며, 실제 threshold는 reference 검증과 사용자 copy 검토가 필요하다.

## v1 Air-only safety stop 범위

v1 스쿠버는 Air-only로 시작한다. Safety stop은 스쿠버 앱의 기본 사용성을 위해 포함하되, 감압 모델이나 tissue state 기반 판단이 아니라 rule-based 리마인더와 타이머로 제한한다. 현재 기본값은 max depth threshold 도달 후 stop reminder를 arm하고, 5m/180초 target과 3-6m displayed zone을 사용한다. Countdown은 stop zone 안에서만 줄고, 너무 깊거나 얕으면 pause된다.

v1 safety stop에서 허용한다.

- Air-only 스쿠버 기록 중 safety-stop 참고 상태 표시
- rule-based trigger와 countdown
- countdown pause/resume
- safety-stop 이탈 marker와 사후 로그 표시
- 비인증 참고 기능임을 나타내는 짧은 copy
- completed/incomplete 상태의 로그 저장
- `권장 스탑 완료`, `타이머 일시정지`, `안전계산 없음` 같은 제한된 copy

v1 safety stop에서 하지 않는다.

- NDL, ceiling, TTS와 연결한 안전 판단
- `required stop`, `safe to ascend`, `no decompression required` 같은 표현
- `상승 가능`, `이제 안전합니다`, `안전 확보`, `감압 완료`, `deco clear`, `ceiling clear` 같은 표현
- Nitrox/FO2, ppO2, CNS, tissue loading 기반 계산
- mandatory deco obligation 처리

## 경고 우선순위

| 우선순위 | 조건 | 처리 방향 |
|---|---|---|
| 1 | MOD 초과: `ppO2 > ppO2_limit` | 강한 visual/haptic warning, 상태 해결 전 persistent |
| 1 | 상승속도 초과: `ascent_rate > limit(depth)` | 강한 warning, log marker |
| 1 | 감압 ceiling 위반: `current_depth < ceiling - tolerance` | certified instruction처럼 표현하지 않도록 copy 검토 필요 |
| 1 | 앱/센서 이상: 수심값 끊김, 압력 비정상, 배터리 위험 | NDL/ceiling 숨김 또는 gauge fallback |
| 2 | NDL 임박: `NDL < 5min`, `3min`, `1min` | 단위와 모델 기준 표시 |
| 2 | Safety stop 필요 | reminder로 표시 |
| 2 | Safety stop 이탈 | countdown pause 또는 warning |
| 2 | CNS 높음: `CNS > 80%`, `CNS >= 100%` | 산소 노출 warning |
| 2 | 가스 부족: `time_to_reserve < TTS + margin` | v3 gas integration 검증 후 사용 |
| 3 | 저수온/장시간 노출 | context warning |
| 3 | 반복 다이브 보수성 경고 | residual load 기준 표시 |
| 3 | surface interval 짧음 | non-certified reminder |
| 3 | residual load 높음 | tissue state 기반 warning |

## 안전 경계

Scuba mode에서 `safe`라는 단어를 함부로 쓰지 않는다. `within model limit`, `no mandatory deco obligation currently shown`처럼 모델과 현재 표시 범위가 제한된 표현을 사용한다. 이전 다이브 state가 누락되거나 앱/센서 오류가 있으면 NDL/ceiling/TTS를 계속 표시하지 않는다.

## 관련 문서

- [Diving App / Immutable Algorithm Reference](../algorithms/diving-app-algorithm-reference.md)
- [Diving App / State Management](../architecture/diving-app-state-management.md)
- [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
- [Diving App / Safety UX and Legal Notes](diving-app-safety-ux-legal-notes.md)
- [Diving App / Non-Negotiable Safety Rules](diving-app-non-negotiable-safety-rules.md)
- [안전 규칙](safety-rules.md)
