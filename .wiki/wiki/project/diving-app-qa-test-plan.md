# Diving App / QA and Test Plan

Sources: user pasted hardening request, 2026-06-28; user requested v1 Air-only safety stop scope, 2026-06-28; user requested depth/safety stop/deco pending work, 2026-07-08
Raw: [Diving app wiki hardening request](../../raw/algorithms/2026-06-28-diving-app-wiki-hardening-request.md); [v1 Air-only scuba safety stop scope](../../raw/project/2026-06-28-v1-air-only-scuba-safety-stop.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md)
Updated: 2026-07-08
Status: Draft / Needs Validation
Owner: local product/dev agent
Last reviewed: 2026-07-08
Change policy: test cases can be expanded freely, but safety-critical expected outputs require review
Related pages: [Diving App / Overview](diving-app-overview.md); [Diving App / Immutable Algorithm Reference](../algorithms/diving-app-algorithm-reference.md); [Diving App / Scuba Mode](../domains/diving-app-scuba-mode.md); [Diving App / Freediving Mode](../domains/diving-app-freediving-mode.md); [Diving App / State Management](../architecture/diving-app-state-management.md); [Diving App / Non-Negotiable Safety Rules](../domains/diving-app-non-negotiable-safety-rules.md); [Diving App / Product Roadmap](diving-app-product-roadmap.md)
Slug: diving-app-qa-test-plan

## 요약

이 문서는 앱 내부 화면이 아니라 출시 전에 Mobile app, Watch app, shared algorithm core, cross-device sync, failure fallback이 통과해야 하는 개발용 QA 기준이다. NDL, ceiling, tissue loading, CNS, MOD 같은 safety-critical 계산은 UI 테스트와 별도로 deterministic algorithm test를 가져야 한다.

## 현재 상태

현재 저장소에는 Bühlmann tissue model, NDL, ceiling, CNS, OTU, gas remaining 계산 module이 구현되어 있지 않다. v1 Air-only safety stop은 별도 스쿠버 계산 모델이 아니라 rule-based reminder/timer로 검증한다. Apple Watch 기반 v1은 40m 이하 지원을 기준으로 검증한다. 이 문서는 구현 전 검증 기준이며, expected output은 canonical source 확정 전까지 Needs Validation 상태다.

## Shared Algorithm Core Tests

대상은 iOS app과 watchOS app이 공통으로 쓰는 계산 로직 또는 서버 없이 로컬에서 돌아가는 dive calculation module이다. 수심, 압력, 기체, 조직 부하, 감압, 산소 노출, 가스 계산을 UI와 분리해 deterministic하게 검증한다.

| Test name | Purpose | Inputs | Expected output | Tolerance | Source/reference | Notes | Safety critical |
|---|---|---|---|---|---|---|---|
| Pressure depth round trip | pressure ↔ depth 변환 검증 | `P_surface`, `ρ_water`, `g`, `d` | pressure 계산 뒤 depth 역산이 원래 depth와 일치 | Needs Validation | Algorithm Reference; NOAA pressure | 고도/담수 조건 별도 case 필요 | yes |
| Average depth weighted by time | 시간가중 평균 수심 검증 | depth samples, `Δt_i` | `Σ(d_i · Δt_i) / ΣΔt_i` | Needs Validation | Algorithm Reference | 불규칙 sample interval 포함 | no |
| Ascent/descent rate | 상승/하강 속도 부호와 단위 검증 | `Δd`, `Δt` | ascent/descent rate, m/min 변환 | Needs Validation | Algorithm Reference | 수심 증가/감소 convention 고정 필요 | yes |
| Ascent rate smoothing | smoothing이 급상승 warning을 과도하게 지연하지 않는지 검증 | noisy depth series | filtered rate와 raw spike handling | Needs Validation | Open Questions | filter 방식 확정 전 expected output 고정 금지 | yes |
| Gas partial pressure | gas fraction과 절대압 partial pressure 계산 | `FO2`, `FN2`, `FHe`, `P_abs` | ppO2, ppN2, ppHe | Needs Validation | Algorithm Reference | fraction 합 검증 포함 | yes |
| ppO2 | ppO2 limit 비교 검증 | `FO2`, `P_abs`, `ppO2_limit` | ppO2와 limit exceeded state | Needs Validation | DAN oxygen toxicity | 기본 limit 정책은 제품 결정 필요 | yes |
| MOD | maximum operating depth 계산 검증 | `ppO2_limit`, `FO2`, `P_surface` | MOD(m) | Needs Validation | Algorithm Reference; DAN oxygen toxicity | EAN32 예시 regression 포함 | yes |
| EAD | equivalent air depth 계산 검증 | depth, `FN2` | EAD(m) | Needs Validation | Algorithm Reference; Subsurface | 10m 근사와 정확 압력 모델 분리 | no |
| END | equivalent narcotic depth 계산 검증 | depth, `FHe`, `FN2`, narcotic oxygen policy | END(m) | Needs Validation | Algorithm Reference | 산소 마취성 policy 필요 | no |
| Gas density | gas density threshold 계산 검증 | gas fractions, surface density, `P_abs`, temperature | gas density and threshold state | Needs Validation | DAN gas density/performance | threshold 정책은 reference 재확인 필요 | yes |
| Bühlmann single compartment | 단일 compartment tissue loading 검증 | half-time, initial pressure, inspired pressure, time | tissue pressure | Needs Validation | DecoTengu; canonical coefficient TODO | coefficient source 확정 전 Current Formula 승격 금지 | yes |
| Constant depth exposure | 일정 수심 exposure update 검증 | state, depth, gas, time | updated tissue pressures | Needs Validation | DecoTengu | known profile fixture 필요 | yes |
| Schreiner ascent/descent | 선형 압력 변화 구간 계산 검증 | `P_alv0`, `R`, `t`, `k`, `P_tissue0` | tissue pressure | Needs Validation | DecoTengu | sign convention 검증 필요 | yes |
| N2/He mixed tissue pressure | N2/He pressure와 mixed coefficient 계산 검증 | `P_N2_i`, `P_He_i`, gas coefficients | `P_i`, mixed `a`, mixed `b` | Needs Validation | DecoTengu | Trimix는 Future Extension | yes |
| GF ceiling | Gradient Factor ceiling 계산 검증 | tissue pressure, `a`, `b`, GF, surface pressure | allowed ambient pressure, ceiling | Needs Validation | DecoTengu; Shearwater GF | 가장 깊은 compartment 선택 포함 | yes |
| GF interpolation | first stop과 surface에서 GF 보간 검증 | `P_amb`, `P_surface`, `P_first_stop`, GF low/high | `GF_current` | Needs Validation | Algorithm Reference; Shearwater GF | endpoint assertions 필수 | yes |
| Surface GF | surface GF 계산 검증 | tissue pressure, target pressure, coefficients | surface GF percent | Needs Validation | Subsurface | warning copy는 Safety UX 기준 따름 | yes |
| NDL binary search | NDL search monotonicity와 boundary 검증 | state, current depth, ascent profile | NDL or max-search marker | Needs Validation | Algorithm Reference; DAN NDL | previous dive state 포함 case 필수 | yes |
| v1 Air-only safety stop reminder | Air-only safety stop trigger/countdown 검증 | dive type, max/current depth, rate, `Δt` | reminder state and countdown state | Needs Validation | PADI; DAN NDL | 감압 의무가 아니라 reminder로만 표시 | yes |
| v1 Apple Watch depth cap | 40m 이하 지원 제한 검증 | manual max depth, planned max depth, watch/imported samples around 40m | 40m 초과는 정상 지원처럼 표시하지 않음 | Needs Validation | Apple Watch depth guidance | reject, unsupported marker, or source-specific behavior는 제품 결정 필요 | yes |
| Safety stop vs decompression stop copy | 권장 safety stop과 mandatory/decompression stop 표현 분리 검증 | safety stop states, future decompression state fixtures | 권장과 필수 색상/문구가 다르고 v1 safety stop은 `필수`로 번역되지 않음 | Needs Validation | Safety UX | `safetyStop.required` field의 사용자-facing 오역 방지 | yes |
| Model-integrated safety stop requirement | v2 이상 safety stop trigger/countdown 검증 | dive type, gas setting, max/current depth, rate, `Δt`, model state | stop state and countdown state | Needs Validation | PADI; DAN NDL | NDL/ceiling/tissue state와 함께 검증 | yes |
| Mandatory decompression occurrence | mandatory deco 발생 감지 검증 | state/profile causing ceiling | ceiling/deco obligation state | Needs Validation | DecoTengu; Subsurface | v2 제품 처리 정책 미확정 | yes |
| TTS | time to surface 계산 검증 | ascent time, stop times, final ascent | TTS | Needs Validation | Subsurface | gas remaining과 결합 case는 v3 | yes |
| CNS accumulation | CNS 누적 검증 | ppO2, exposure time, table limit | CNS percent | Needs Validation | Shearwater CNS; NOAA table TODO | NOAA table source 고정 필요 | yes |
| CNS surface decay | 90분 half-time 감소 검증 | CNS before surface, surface interval | decayed CNS percent | Needs Validation | Shearwater CNS | half-time policy source 확인 필요 | yes |
| OTU accumulation | OTU/UPTD 누적 검증 | ppO2, exposure time | OTU total | Needs Validation | DANSA ESOT | threshold와 unit 재확인 필요 | yes |
| SAC/RMV | gas consumption 계산 검증 | start/end pressure, cylinder volume, time, avg pressure | RMV and SAC | Needs Validation | DAN air consumption | pressure unit validation 포함 | no |
| Gas remaining | reserve 도달 시간 계산 검증 | tank pressure, reserve, cylinder volume, RMV, depth pressure | time to reserve | Needs Validation | Algorithm Reference | v3 release gate | yes |
| Turn pressure | turn pressure rule 검증 | start pressure, reserve, rule | turn pressure | Needs Validation | PADI | planning reference, safety guarantee 아님 | no |
| No-fly rule minimum | rule-based no-fly minimum 검증 | dive category | minimum wait time | Needs Validation | DAN flying after diving | reminder 표현만 허용 | yes |
| Model-based no-fly simulation | cabin pressure와 surface GF simulation 검증 | tissue state, cabin pressure, allowed GF | model wait time | Needs Validation | Algorithm Reference; Subsurface | medical/aviation guarantee 아님 | yes |

## Watch App Runtime Tests

대상은 Apple Watch Ultra급 기기에서 실제 수중 또는 수중 시뮬레이션 환경으로 검증해야 하는 watchOS 동작이다.

| Test area | Required coverage |
|---|---|
| Depth sensor sampling | depth sensor sampling 안정성, pressure 값 이상치 처리, pressure spike/flatline 처리 |
| Supported depth cap | 40m 부근과 40m 초과 상황에서 watch runtime, import, review가 정상 지원처럼 보이지 않는지 확인 |
| Dive lifecycle | 수심 1m 진입 후 자동 다이브 시작 조건, 수면 복귀 후 자동 다이브 종료 조건 |
| Underwater interaction | 수중 화면 표시 가독성, water lock/touch 제한, Digital Crown 또는 버튼 기반 조작 가능성 |
| Warnings | haptic warning 전달성, MOD 초과 critical warning 지속성, ascent rate warning 지속성, ceiling violation warning 지속성, NDL 임박 warning |
| Safety stop | v1 Air-only safety stop trigger, countdown pause/resume, 이탈 marker, 비인증 reminder copy |
| Power/lifecycle | 배터리 부족 경고, 저전력 모드 동작, app foreground/background 전환 |
| Recovery/fallback | watch reboot/crash 이후 state recovery, depth sensor dropout 발생 시 fallback |
| Logging | 로그 샘플링 유실 여부, 다이빙 중 iPhone 연결이 끊긴 상태에서 독립 동작 가능 여부 |

## Mobile App Tests

대상은 iPhone companion app의 로그 조회, 설정 관리, 동기화, export, 사용자 설명 UI다.

| Test area | Required coverage |
|---|---|
| Log review | dive log 목록 표시, dive profile chart 표시, current/max/avg depth 표시 |
| Settings validation | gas setting 관리, FO2 입력 validation, ppO2 limit 설정 validation, GF 설정 validation |
| Depth validation | Logbook/Planbook 입력에서 Apple Watch 기반 40m cap과 40m 초과 unsupported 정책을 검증 |
| Watch sync settings | Watch app으로 설정 sync |
| History and state | previous dive history 관리, no-fly time 표시, surface interval 표시, CNS/OTU 표시 |
| Import quality | Watch app에서 넘어온 로그 검증, incomplete dive log 처리, corrupted log 처리 |
| Export | export format 검증, CSV export, JSON export, future UDDF 또는 Subsurface-compatible export 검토 |
| Safety copy | v1 Air-only safety stop copy, safety copy 표시 위치 검증 |
| Safety/deco terminology | v1 safety stop 권장 상태가 필수 감압 정지처럼 표시되지 않는지, mandatory/decompression 색상과 분리됐는지 검증 |

## Cross-device Sync Tests

대상은 Watch app ↔ iPhone app 간 상태 동기화, 다이빙 중/후 연결 끊김, 설정/로그 충돌 처리다.

| Test area | Required coverage |
|---|---|
| Pre-dive settings | 다이빙 전 iPhone 설정이 Watch에 반영되는지, FO2 변경 반영, GF 설정 변경 반영 |
| Offline watch recording | 다이빙 중 iPhone 연결이 끊긴 경우 Watch 독립 기록 |
| Post-dive sync | 다이빙 후 연결 복구 시 로그 동기화, Watch에만 로그가 있고 iPhone에는 없는 경우 |
| Conflict handling | iPhone에는 설정 변경이 있고 Watch는 이전 설정으로 다이빙을 시작하려는 경우, 중복 로그 merge |
| Persistence compatibility | 앱 재설치 후 기존 dive history 복구, 앱 업데이트 후 기존 dive state 호환성 |
| User-visible sync state | 충돌 발생 시 사용자가 이해할 수 있는 상태 표시, sync 실패를 조용히 무시하지 않는지 |

## Failure and Fallback Tests

대상은 위험 상황에서 앱이 잘못된 값을 확정적으로 보여주지 않는지, 계산 불가능하거나 상태가 불완전할 때 gauge fallback으로 전환되는지 검증하는 것이다.

| Failure condition | Expected fallback behavior |
|---|---|
| tissue state 손상 또는 누락 | NDL/ceiling 숨김, gauge fallback, persistent warning |
| 이전 다이브 기록 누락 | `based on available dive history` 제한 copy, NDL 신뢰 경고 |
| gas setting 누락 또는 FO2 비정상값 | ppO2, MOD, CNS, NDL 숨김 또는 Needs Review |
| GF 비정상값 | ceiling, NDL, TTS 계산 중단 |
| depth sensor 값 끊김, pressure spike, pressure flatline, 비정상 수심값 | computed decompression metrics 숨김, current depth 품질 warning |
| 배터리 부족, app crash, watch reboot | immediate persist/recovery marker 확인, fallback state 기록 |
| 로그 저장 실패 | 조용히 무시하지 않고 persistent 상태와 retry 경로 제공 |
| NDL/ceiling/CNS/gas remaining 계산 실패 | 해당 계산값 숨김, computation unavailable copy 표시 |
| gauge fallback 동작 | current depth, elapsed time, ascent rate, warning copy는 가능한 범위에서 유지 |
| fallback 상태에서 safety-critical warning 표시 | haptic + visual + persistent state 유지 |

## Regression Test Policy

- 알고리즘 공식이 바뀌면 regression test를 반드시 업데이트한다.
- coefficient table이 바뀌면 known dive profile 결과를 다시 검증한다.
- GF 기본값이 바뀌면 NDL, ceiling, TTS 결과 차이를 문서화한다.
- 앱 업데이트가 기존 dive state와 호환되는지 검증한다.
- release build에서는 debug-only 계산값이 사용자에게 노출되지 않도록 검증한다.

## 관련 문서

- [Diving App / Immutable Algorithm Reference](../algorithms/diving-app-algorithm-reference.md)
- [Diving App / State Management](../architecture/diving-app-state-management.md)
- [Diving App / Non-Negotiable Safety Rules](../domains/diving-app-non-negotiable-safety-rules.md)
- [Diving App / Product Roadmap](diving-app-product-roadmap.md)
