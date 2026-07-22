# Knowledge Base Index

## project

프로젝트 수준의 개요와 위키 운영 규칙을 담는다.

| Article                                                               | Summary                                                                                                                                                                                                            | Updated    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| [Diving App / Overview](project/diving-app-overview.md)               | Apple Watch Ultra급 워치를 중심으로 프리다이빙, Air-only safety-stop 리마인더를 포함한 레크리에이션 스쿠버, 로그 앱의 제품 방향을 정리하되, 현재 구현 상태와 certified dive-computer 기능을 분리한다.                                                                       | 2026-06-28 |
| [Diving App / Product Roadmap](project/diving-app-product-roadmap.md) | 추천 제품 범위는 v1 Apple Watch 기반 40m 이하 Gauge + Freedive + Air-only safety stop + Log에서 시작하고, 40m 초과 값은 보존하되 unsupported warning 없이 정상 지원처럼 표시하지 않는다.                                                               | 2026-07-09 |
| [Diving App / QA and Test Plan](project/diving-app-qa-test-plan.md)   | 자동 검증과 signed-device/얕은 물 underwater runtime gate를 분리하고, 15cm manual sampling이 `When Submerged` pass가 아님을 포함한 물리 QA 기준을 정리한다.                                                                                                                | 2026-07-18 |
| [Diving App / References](project/diving-app-references.md)           | 알고리즘과 제품 요구사항을 검증할 때 먼저 확인할 Apple, Oceanic+, NOAA, PADI, DAN, DecoTengu, Shearwater, Subsurface reference를 used-for, confidence, notes 기준으로 정리한다.                                                                  | 2026-06-28 |
| [프로젝트 개요](project/overview.md)                                        | React Native/iPhone-watch companion, 공유 contract, staging-verified account data/guest claim과 physical·production 승격 gate를 분리한다. | 2026-07-20 |
| [위키 운영 방식](project/wiki-workflow.md)                                  | 이 저장소의 장기 지식 저장소는 Karpathy LLM Wiki 방식으로 관리한다. 이 저장소에서는 project root 대신 `.wiki/`를 wiki root로 보고, immutable source는 `.wiki/raw/`, compiled article은 `.wiki/wiki/`에 둔다.                                              | 2026-06-28 |

## algorithms

수심, 기체, tissue loading, NDL, oxygen exposure, gas management 계산 reference를 담는다.

| Article | Summary | Updated |
|---|---|---|
| [Diving App / Immutable Algorithm Reference](algorithms/diving-app-algorithm-reference.md) | 프리다이빙/스쿠버 제품 검토에서 반복 참조할 공식과 한계를 보존하고, Current Formula, Needs Validation, Future Extension 같은 status label과 Bühlmann coefficient 검증 TODO를 둔다. | 2026-06-28 |

## architecture

모노레포, 모바일 앱, watch 앱, 동기화, Supabase 경계를 설명한다.

| Article                                                                      | Summary                                                                                                                                                                                                                                                                                                                                                                | Updated    |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [Diving App / State Management](architecture/diving-app-state-management.md) | 향후 스쿠버 계산 기능에서는 tissue state 유실이 가장 위험한 오류 중 하나이며, compact state와 1초 로그 저장, crash/reboot 복구, gauge fallback 정책이 필요하다.                                                                                                                                                                                                                                                  | 2026-06-28 |
| [구현 우선순위 기록](architecture/implementation-priorities.md)                      | Hosted staging 승격 뒤 Google·claim 실기기, Watch 회귀, claim evidence lifecycle과 account deletion을 우선 gate로 둔다. | 2026-07-20 |
| [모바일 로그북 로드맵](architecture/mobile-logbook-roadmap.md)                        | Auth, remote schema, principal outbox/claim과 hosted staging 완료를 physical·lifecycle 후속과 단계별로 분리한다. | 2026-07-20 |
| [모바일 구조](architecture/mobile.md)                                             | `apps/mobile`은 principal local publication을 optional remote bootstrap보다 먼저 수행하고, claim·render 실패를 비파괴 recovery UI로 격리한다. | 2026-07-22 |
| [1Hz 프로파일 파일 저장과 동기화](architecture/profile-file-sync.md) | Watch/mobile local profile, staging-verified remote object와 auth user deletion 뒤에도 남는 Storage cleanup gate를 기록한다. | 2026-07-20 |
| [Monorepo 구조](architecture/monorepo.md)                                      | Yarn 1 app/package와 local/staging account migration, owner RLS, private Storage, claim Function 책임을 관리한다. | 2026-07-20 |
| [Supabase 구조](architecture/supabase.md)                                      | Staging-verified account schema, owner RLS, private profile Storage와 target ID 재사용을 rollback하는 claim finalizer를 정리한다. | 2026-07-20 |
| [동기화 흐름 구조](architecture/sync-flow.md)                                       | Watch local ACK, account outbox, claim preflight·failure context와 remote finalize/cleanup 경계를 분리한다. | 2026-07-22 |
| [Watch 앱 구조](architecture/watch-app.md)                                      | Core Motion scalar actor hop, ordered O(1) 1Hz retry, runtime invalidation/re-entry gate와 managed simulated summary dismissal을 one app-scoped graph, canonical artifact, physical hardware gate와 분리한다. | 2026-07-18 |

## domains

다이빙 로그, 계획, 용어, 안전 경계를 설명한다.

| Article | Summary | Updated |
|---|---|---|
| [Diving App / Freediving Mode](domains/diving-app-freediving-mode.md) | Freedive mode는 압축공기 기반 NDL 계산이 아니라 수심, 시간, 속도, 수면 회복, 반복 부하, 로그, 행동 경고를 중심으로 하며, watch 구현은 한 `FreeDiveSession` 안에 여러 `FreeDiveSegment`를 저장한다. | 2026-07-05 |
| [Diving App / Non-Negotiable Safety Rules](domains/diving-app-non-negotiable-safety-rules.md) | 제품 구현에서 절대 위반하면 안 되는 safety-critical 규칙을 정리하고, Apple Watch 기반 v1 40m 지원 범위, 40m 초과 값 보존+unsupported 표시, v1 Air-only safety stop을 감압 의무처럼 표현하지 않는 규칙을 포함한다. | 2026-07-09 |
| [Diving App / Safety UX and Legal Notes](domains/diving-app-safety-ux-legal-notes.md) | 안전 copy, warning hierarchy, 책임 관련 UX 원칙을 정리하고, v1 Air-only safety stop 권장을 mandatory/decompression stop과 다른 색상과 문구로 제한한다. | 2026-07-08 |
| [Diving App / Scuba Mode](domains/diving-app-scuba-mode.md) | Scuba mode v1은 Apple Watch 기반 40m 이하 Air-only gauge/log와 rule-based safety stop reminder를 포함하고, 40m 초과 값은 지원 범위 밖 warning과 함께 보존하지만 NDL, ceiling, TTS, CNS, gas remaining, decompression stop은 고위험 검증 범위로 분리한다. | 2026-07-09 |
| [다이브 로그 도메인](domains/dive-log.md) | Guest/account ownership과 Watch provenance를 분리하고 exact snapshot delete와 changed-guest outbox reconciliation로 원본 의미를 보존한다. | 2026-07-20 |
| [다이브 계획 도메인](domains/dive-planning.md) | 모바일 Planbook은 비중요 계획 알림이며, optional planned pressure는 준비 맥락 metadata일 뿐 실제 측정값이나 안전 계산 결과가 아니다. | 2026-06-28 |
| [다이빙 용어](domains/diving-glossary.md) | 이 glossary는 현재 앱의 domain 용어를 정의하며, Apple Watch 기반 40m supported depth cap, unsupported depth, safety stop 권장 리마인더, decompression stop/mandatory stop의 구분을 포함한다. | 2026-07-09 |
| [안전 규칙](domains/safety-rules.md) | 이 앱은 레크리에이션 다이빙 로그 companion 앱이며, debug sample과 미수신 수온을 실측값처럼 표시하지 않는다. | 2026-07-12 |

## design

모바일과 watchOS의 제품 UI 언어를 설명한다.

| Article | Summary | Updated |
|---|---|---|
| [Mobile/Watch UI 언어](design/mobile-watch-ui-language.md) | system appearance와 native sheet background를 일관되게 적용하고, 복구는 compact banner와 비파괴 retry 화면으로 표시한다. | 2026-07-22 |

## decisions

승인된 architecture decision record를 관리한다.

| Article | Summary | Updated |
|---|---|---|
| [ADR 목록](decisions/adr-index.md) | 이 문서는 accepted architecture decision record 목록을 관리한다. | 2026-06-28 |
| [ADR: 1Hz immutable profile과 file-only session sync](decisions/adr-one-hertz-file-sync.md) | raw live callback과 bounded profile을 분리하고 session body를 immutable file 하나로 전달한다. | 2026-07-12 |
| [ADR: Local-first mobile logbook with future Supabase sync](decisions/adr-local-first-mobile-logbook.md) | Local-first 저장소를 유지하고, guest 로그 연결 동의 뒤 Supabase outbox를 추가한다. 현재 cloud 상태는 `notConfigured`다. | 2026-07-12 |

## questions

구현되지 않았거나 검증되지 않은 열린 질문을 추적한다.

| Article | Summary | Updated |
|---|---|---|
| [Diving App / Open Questions](questions/diving-app-open-questions.md) | Apple Watch Ultra급 프리다이빙/스쿠버 제품 방향에서 GF 기본값, v2 Air/Nitrox 범위, unsupported-depth warning 실기기 UX, safety/deco 장기 migration, mandatory deco 처리, tank transmitter, export format을 열린 질문으로 둔다. | 2026-07-09 |
| [열린 질문](questions/open-questions.md) | 자동 검증이 완료된 claim 무결성과 별개로 Watch·센서, Google·claim physical UX, Storage cleanup, production/account deletion gate를 기록한다. | 2026-07-20 |
