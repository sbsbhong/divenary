# Diving App / Freediving Mode

Sources: user pasted request, 2026-06-28; user pasted hardening request, 2026-06-28; Diving App repository implementation, 2026-07-05
Raw: [Diving app technical wiki request](../../raw/algorithms/2026-06-28-diving-app-technical-wiki-request.md); [Diving app wiki hardening request](../../raw/algorithms/2026-06-28-diving-app-wiki-hardening-request.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md)
Updated: 2026-07-05
Status: Draft / Needs Validation
Owner: local product/dev agent
Last reviewed: 2026-06-28
Change policy: mode requirements can change with documented rationale
Related pages: [Diving App / Safety UX and Legal Notes](diving-app-safety-ux-legal-notes.md); [Diving App / Non-Negotiable Safety Rules](diving-app-non-negotiable-safety-rules.md); [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
Slug: diving-app-freediving-mode

## 요약

Freedive mode의 핵심은 압축공기 호흡 기반 NDL 계산이 아니라 수심, 시간, 속도, 회복, 반복 다이브 부하, 로그, 행동 경고다. 워치 센서만으로 산소 잔량, 블랙아웃 가능성, 저산소 위험을 신뢰성 있게 계산할 수 없다.

## 현재 상태

현재 저장소의 watch 앱은 `scuba`와 `freedive` 모드를 구분한다. Watch freedive recording은 한 `FreeDiveSession` 안에 여러 `FreeDiveSegment`를 저장하는 model과 `FreeDiveSessionEngine`을 갖는다. 실제 underwater sensor behavior는 아직 지원 hardware에서 검증되지 않았고, 현재 engine 검증은 simulated depth sample 기반이다.

## 기능 표

| 기능 | 기준 | 한계 |
|---|---|---|
| 자동 다이브 감지 | `d > 1m`가 3~5초 지속되면 시작, `d < 0.5~1m`가 일정 시간 지속되면 종료 | 센서 노이즈와 수면 움직임 때문에 hysteresis와 debounce가 필요하다. |
| 세션 안의 다중 segment | 사용자가 프리 세션을 시작하면 각 sustained descent/ascent가 `FreeDiveSegment`로 기록된다. | 얕은 수면 휴식이나 젖은 watch noise는 새 segment가 아니어야 한다. |
| 현재 수심 | 최신 filtered depth 표시 | 검증되지 않은 센서값은 안전-critical truth가 아니다. |
| 최대 수심 | session 중 최대 filtered depth | 이상치 제거 정책이 필요하다. |
| 평균 수심 | 시간가중 평균 수심 | sample 누락 구간은 품질 표시가 필요하다. |
| 다이브 시간 | underwater interval 기준 elapsed time | 자동 시작/종료 기준에 영향을 받는다. |
| 수면 휴식 시간 | dive 종료 뒤 surface interval | 회복 보조 지표이며 blackout 위험 예측이 아니다. |
| 하강/상승 속도 | `Δd / Δt`, m/min 표시 | smoothing과 지연 tradeoff가 있다. |
| 목표 수심 알림 | planned depth 초과 또는 접근 표시 | 훈련/계획 reminder다. |
| 목표 시간 알림 | planned time 초과 또는 접근 표시 | 개인 한계를 보장하지 않는다. |
| 상승 속도 알림 | 지정 limit 초과 시 표시 | 센서 지연과 필터링을 고려한다. |
| 수면 회복 타이머 | `SI_required = 2 × dive_time` 기본 | 더 깊거나 반복 세션은 보수적으로 확장한다. |
| 30초 post-surface check timer | surface 복귀 직후 확인 timer | buddy 절차를 대체하지 않는다. |
| 반복 다이브 부하 지표 | total apnea time, total vertical, depth-time index | 생리학적 위험 예측값이 아니다. |
| 로그 저장 | depth profile, 시간, summary 저장 | 로그는 사후 리뷰 자료다. |

## 회복 타이머와 반복 부하

현재 watch implementation에서 surface interval은 이전 segment end와 다음 segment start 사이에서 계산한다. Live surface interval 화면에서는 현재 얕은 수심보다 수면 휴식 시간이 우선 표시된다. 이 값은 회복 맥락을 기록하고 보여주는 보조 지표이며 blackout이나 저산소 위험 예측값이 아니다.

기본 규칙:

```txt
SI_required = 2 × dive_time
```

더 깊거나 반복 세션이면 보수적으로:

```txt
SI_required = 3 × dive_time
```

별도 옵션:

```txt
SI_required = max_depth / 5 minutes
```

반복 부하 지표:

```txt
total_apnea_time = Σ dive_time
total_vertical = Σ |Δd|
depth_time_index = Σ(max_depth_i × dive_time_i)
```

이 지표들은 행동 reminder와 로그 review에 쓰며, 블랙아웃이나 저산소 위험을 확정 계산하지 않는다.

## UX 경고 예

```txt
if surface_interval < required_surface_interval:
    show "회복 시간 부족"

if dive_time > personal_best * 0.9:
    show "개인 한계 접근"

if max_depth > planned_depth:
    show "계획 수심 초과"

if repeated_deep_dives_count over threshold:
    show "반복 심수 다이브 증가"
```

경고는 haptic, visual, persistent state를 함께 고려한다. 프리다이빙은 혼자 하지 않는다는 안전 문구를 별도 UX/legal 흐름에서 함께 다룬다.

## 관련 문서

- [Diving App / Overview](../project/diving-app-overview.md)
- [Diving App / Safety UX and Legal Notes](diving-app-safety-ux-legal-notes.md)
- [Diving App / Non-Negotiable Safety Rules](diving-app-non-negotiable-safety-rules.md)
- [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
- [Diving App / Product Roadmap](../project/diving-app-product-roadmap.md)
- [안전 규칙](safety-rules.md)
