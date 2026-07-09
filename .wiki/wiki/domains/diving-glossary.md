# 다이빙 용어

Sources: pre-Karpathy wiki page, 2026-06-28; user requested depth/safety stop/deco pending work, 2026-07-08; pre-device depth safety sync readiness implementation, 2026-07-09
Raw: [Pre-Karpathy: 다이빙 용어](../../raw/domains/diving-glossary.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md); [Pre-device depth safety sync readiness](../../raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md)
Updated: 2026-07-09

## 요약

이 glossary는 현재 앱에서 오래 유지할 domain 용어를 정의한다. 정의 범위는 레크리에이션 기록과 확인이며, certified dive-computer behavior가 아니다. Safety stop과 decompression stop은 같은 의미로 쓰지 않는다.

## 현재 상태

앱은 watch capture, 모바일 확인, 계획 알림, sync contract에서 아래 용어를 사용한다.

## 상세

- Dive log: 레크리에이션 다이빙 세션의 과거 기록.
- Watch capture: watch에서 기록한 세션 데이터. Real sensor provider와 명시적 demo/debug provider를 구분하며, demo capture는 실측 로그와 다르게 표시해야 한다.
- Depth sample: meter 단위 depth와 timestamp를 가진 측정값. Shared contract에서는 optional pressure와 water temperature를 포함할 수 있다.
- Bottom time: 확인용 elapsed session duration. 감압 계산이 아니다.
- Max depth: 세션에서 기록된 가장 깊은 depth sample.
- Average depth: 기록된 depth sample의 arithmetic average.
- Water temperature: sample에 붙거나 review summary로 계산되는 temperature value.
- Ascent-rate reminder: depth sample 변화에서 파생되는 non-certified assistant state.
- Supported depth cap: Apple Watch 기반 v1에서 앱이 지원 대상으로 다루는 최대 수심. 현재 기준은 40m 이하이며, 40m보다 깊은 수심은 값 자체를 삭제하지 않고 unsupported-depth warning/marker와 함께 보존한다.
- Unsupported depth: 기록 또는 계획 값이 Apple Watch 기반 v1 지원 범위인 40m를 넘는 상태. 이 marker는 지원 범위 밖임을 알리는 review/planning metadata이지 수중 행동 지시가 아니다.
- Safety stop: 얕은 수심에서 머무르도록 권장하는 레크리에이션 스쿠버 리마인더. 현재 앱의 v1 safety stop은 감압 의무가 아니라 non-certified reminder/timer다.
- Safety-stop assistant: shallow-depth stop window 주변의 non-certified reminder state. Mandatory safety guidance가 아니다.
- Recommended stop: 현재 v1 safety stop처럼 권장으로 표시하는 정지 상태. UI는 보조적인 권장 색과 문구를 사용한다.
- Decompression stop: 감압 모델, 감압표, 또는 다이브 컴퓨터가 의무 정지로 다루는 정지. 현재 앱은 이를 계산하거나 지시하지 않으며, future design에서는 safety stop과 별도 data model, 색상, source provenance를 가져야 한다.
- Mandatory stop: 사용자가 필수 정지로 이해할 수 있는 상태. 현재 v1 safety stop에는 쓰지 않고, 향후 감압 정지나 인증된 외부 source 기반 상태를 설계할 때만 사용한다.
- Surface interval: 이전 logged dive 이후 elapsed time. Planning context로만 사용한다.
- No-fly reminder: manual planning reminder. Medical 또는 certified aviation/diving recommendation이 아니다.
- Sync status: 세션이 `pending`, `synced`, `failed` 중 어디에 있는지 나타내는 local state.
- Dive mode: 현재 active session category는 `scuba`와 `freedive`다.
- Water condition: `calm`, `mild`, `choppy`, `surge`, `current`, `unknown` 같은 subjective post-dive condition.

## 관련 문서

- [다이브 로그 도메인](dive-log.md)
- [안전 규칙](safety-rules.md)
- [동기화 흐름 구조](../architecture/sync-flow.md)
