# Knowledge Base Index

## project

프로젝트 수준의 개요와 위키 운영 규칙을 담는다.

| Article                                                               | Summary                                                                                                                                                                                                            | Updated    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| [Diving App / Overview](project/diving-app-overview.md)               | Apple Watch Ultra급 워치를 중심으로 프리다이빙, Air-only safety-stop 리마인더를 포함한 레크리에이션 스쿠버, 로그 앱의 제품 방향을 정리하되, 현재 구현 상태와 certified dive-computer 기능을 분리한다.                                                                       | 2026-06-28 |
| [Diving App / Product Roadmap](project/diving-app-product-roadmap.md) | 추천 제품 범위는 v1 Apple Watch 기반 40m 이하 Gauge + Freedive + Air-only safety stop + Log에서 시작하고, 40m 초과 값은 보존하되 unsupported warning 없이 정상 지원처럼 표시하지 않는다.                                                               | 2026-07-09 |
| [Diving App / QA and Test Plan](project/diving-app-qa-test-plan.md)   | 자동 검증과 signed-device/얕은 물 underwater runtime gate를 분리하고, 15cm manual sampling이 `When Submerged` pass가 아님을 포함한 물리 QA 기준을 정리한다.                                                                                                                | 2026-09-01 |
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
| [구현 우선순위 기록](architecture/implementation-priorities.md)                      | Google·claim 실기기, Watch 회귀, account deletion과 개인정보 최소화 device-local 진단 기반을 P0로 두고 원격 수집을 별도 2단계로 분리한다. | 2026-08-02 |
| [모바일 로그북 로드맵](architecture/mobile-logbook-roadmap.md)                        | Auth, remote schema, principal outbox/claim과 hosted staging 완료를 physical·lifecycle 후속과 단계별로 분리한다. | 2026-07-20 |
| [모바일 구조](architecture/mobile.md) | 앱 코드는 `WatchLink`로만 watch와 통신하고, 로그북은 고정 헤더 아래 목록만 20개씩 무한 스크롤하며 전체 개수를 보이고, 저장소는 같은 bytes를 재검증하지 않으며 schema 4로 미리보기를 한 번만 저장한다. | 2026-10-22 |
| [1Hz 프로파일 파일 저장과 동기화](architecture/profile-file-sync.md) | Watch inbox는 bounded descriptor/preview만 JS에 전달하고 prepared profile을 native file로 채택하며, Watch 기록 journal은 열어 둔 채 1Hz 줄을 쓰고 10 sample마다 flush한다. | 2026-10-22 |
| [Monorepo 구조](architecture/monorepo.md) | Yarn 1 app/package와 local/staging account migration, owner RLS, private Storage, claim Function 책임을 관리하고, contracts에 session과 폰-워치 제어 메시지 schema를 둔다. | 2026-10-22 |
| [Supabase 구조](architecture/supabase.md)                                      | 삭제된 Watch session을 포함한 noncommitted claim은 staging의 idempotent abandonment 경계로 stale finalization을 차단한다. | 2026-08-02 |
| [동기화 흐름 구조](architecture/sync-flow.md) | 폰-워치 메시지는 `packages/contracts` schema가 기준이고, account hydrate는 원격 행을 최신순 페이지마다 바로 로컬에 적용하며, durable JSON은 원자적 단일 key 쓰기를 쓴다. | 2026-10-22 |
| [Watch 앱 구조](architecture/watch-app.md) | Watch는 journal을 열어 둔 채 쓰고 실패 뒤 디스크에서 다시 읽어 복구하며, manifest·ledger 디코딩을 재사용하고 바뀐 값만 publish하며, 다이빙이 끝나면 저장 중 화면을 먼저 그린 뒤 저장한다. | 2026-10-22 |

## domains

다이빙 로그, 계획, 용어, 안전 경계를 설명한다.

| Article | Summary | Updated |
|---|---|---|
| [Diving App / Freediving Mode](domains/diving-app-freediving-mode.md) | Freedive mode는 압축공기 기반 NDL 계산이 아니라 수심, 시간, 속도, 수면 회복, 반복 부하, 로그, 행동 경고를 중심으로 하며, watch 구현은 한 `FreeDiveSession` 안에 여러 `FreeDiveSegment`를 저장한다. | 2026-07-05 |
| [Diving App / Non-Negotiable Safety Rules](domains/diving-app-non-negotiable-safety-rules.md) | 제품 구현에서 절대 위반하면 안 되는 safety-critical 규칙을 정리하고, Apple Watch 기반 v1 40m 지원 범위, 40m 초과 값 보존+unsupported 표시, v1 Air-only safety stop을 감압 의무처럼 표현하지 않는 규칙을 포함한다. | 2026-07-09 |
| [Diving App / Safety UX and Legal Notes](domains/diving-app-safety-ux-legal-notes.md) | 안전 copy, warning hierarchy, 책임 관련 UX 원칙을 정리하고, v1 Air-only safety stop 권장을 mandatory/decompression stop과 다른 색상과 문구로 제한한다. | 2026-07-08 |
| [Diving App / Scuba Mode](domains/diving-app-scuba-mode.md) | Scuba mode v1은 Apple Watch 기반 40m 이하 Air-only gauge/log와 rule-based safety stop reminder를 포함하고, 40m 초과 값은 지원 범위 밖 warning과 함께 보존하지만 NDL, ceiling, TTS, CNS, gas remaining, decompression stop은 고위험 검증 범위로 분리한다. | 2026-08-02 |
| [다이브 로그 도메인](domains/dive-log.md) | Watch session 삭제 identity는 `localSessionId`이며 mobile tombstone, account/claim과 Watch artifact 제거는 별도 완료 경계다. | 2026-08-02 |
| [다이브 계획 도메인](domains/dive-planning.md) | 모바일 Planbook은 비중요 계획 알림이며, optional planned pressure는 준비 맥락 metadata일 뿐 실제 측정값이나 안전 계산 결과가 아니다. | 2026-06-28 |
| [다이빙 용어](domains/diving-glossary.md) | 이 glossary는 현재 앱의 domain 용어를 정의하며, Apple Watch 기반 40m supported depth cap, unsupported depth, safety stop 권장 리마인더, decompression stop/mandatory stop의 구분을 포함한다. | 2026-07-09 |
| [안전 규칙](domains/safety-rules.md) | stale·오류 수심을 실측값처럼 표시하지 않고, 보지 못한 시간을 권장 스탑으로 적립하지 않으며, 권장 스탑 미완료는 caution 앰버로, captureMode 없는 옛 기록은 demo로 다룬다. | 2026-10-21 |

## design

모바일과 watchOS의 제품 UI 언어를 설명한다.

| Article | Summary | Updated |
|---|---|---|
| [Mobile/Watch UI 언어](design/mobile-watch-ui-language.md) | amber warning은 확인이 필요한 상태에만 쓰고 권장 스탑 미완료를 빨강으로 표시하지 않으며, 목록 상태 구분, 삭제 확인, 접근성(selected·44pt·VoiceOver)과 Watch Dive Plans·동기화 라벨 규칙을 둔다. | 2026-10-21 |

## decisions

승인된 architecture decision record를 관리한다.

| Article | Summary | Updated |
|---|---|---|
| [ADR 목록](decisions/adr-index.md) | 이 문서는 accepted architecture decision record 목록을 관리한다. | 2026-10-22 |
| [ADR: 1Hz immutable profile과 file-only session sync](decisions/adr-one-hertz-file-sync.md) | raw live callback과 bounded profile을 분리하고 session body를 immutable file 하나로 전달한다. | 2026-07-12 |
| [ADR: Local-first mobile logbook with future Supabase sync](decisions/adr-local-first-mobile-logbook.md) | Local-first 저장소를 유지하고, guest 로그 연결 동의 뒤 Supabase outbox를 추가한다. 현재 cloud 상태는 `notConfigured`다. | 2026-07-12 |
| [ADR: 개인정보 최소화 device-local 진단 파이프라인](decisions/adr-privacy-minimized-diagnostics.md) | 모든 build에서 사용자 콘텐츠를 제외한 Mobile/Watch local journal과 수동 export를 먼저 구현하고, 원격 수집을 별도 동의 단계로 남긴다. | 2026-08-02 |
| [ADR: 플랫폼 중립 Watch link](decisions/adr-platform-neutral-watch-link.md) | 모바일 앱 코드는 `WatchLink` 인터페이스로만 watch와 통신하고, 메시지 field는 `packages/contracts` schema가 기준이며, iOS와 Android adapter가 같은 native module 계약을 구현한다. | 2026-10-22 |

## questions

구현되지 않았거나 검증되지 않은 열린 질문을 추적한다.

| Article | Summary | Updated |
|---|---|---|
| [Diving App / Open Questions](questions/diving-app-open-questions.md) | Apple Watch Ultra급 프리다이빙/스쿠버 제품 방향에서 GF 기본값, v2 Air/Nitrox 범위, unsupported-depth warning 실기기 UX, safety/deco 장기 migration, mandatory deco 처리, tank transmitter, export format을 열린 질문으로 둔다. | 2026-07-09 |
| [열린 질문](questions/open-questions.md) | 남은 claim·Watch·production gate와 진단 단계에 더해 오프라인 membership 신뢰 기한, Watch 수신 확인 대기 표시, 2026-10-21 리뷰의 실기기 항목(D14-D19)을 추적한다. | 2026-10-21 |
