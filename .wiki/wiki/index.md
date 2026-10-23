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
| [구현 우선순위 기록](architecture/implementation-priorities.md)                      | 기존 P0를 유지하고 소유자가 승인한 워치 UX D1–D6를 Wave 2·4에 배치하며 구현 가능·결정·하드웨어 상태를 구분한다. | 2026-10-22 |
| [모바일 로그북 로드맵](architecture/mobile-logbook-roadmap.md)                        | Auth, remote schema, principal outbox/claim과 hosted staging 완료를 physical·lifecycle 후속과 단계별로 분리한다. | 2026-07-20 |
| [모바일 구조](architecture/mobile.md) | 작성·수정은 전체 화면 routed 편집기이고 목록 로딩 전 상세 route는 `DetailSkeleton`을 보이며, 시작 shell은 Auth 확인 동안 guest를 열지 않고 Auth 단계마다 10초 제한이 있고, 결과 배너는 account-data gate 위에 두며, 워치 가져오기 기본값·내부 태그는 저장값을 두고 화면에서만 숨긴다. | 2026-10-22 |
| [1Hz 프로파일 파일 저장과 동기화](architecture/profile-file-sync.md) | 1Hz 파일 동기화, 이관 원본의 내용 충돌 보존과 최종 manifest 검증, 재전송 실패 안내를 정리한다. | 2026-10-22 |
| [Monorepo 구조](architecture/monorepo.md) | Yarn 1 app/package와 local/staging account migration, owner RLS, private Storage, claim Function 책임을 관리하고, contracts에 session과 폰-워치 제어 메시지 schema를 둔다. | 2026-10-22 |
| [Supabase 구조](architecture/supabase.md) | 삭제된 Watch session을 포함한 noncommitted claim은 staging의 idempotent abandonment 경계로 stale finalization을 차단하고, mobile Auth 단계의 10초 시간 초과는 로그아웃 없이 transport failure로 다루되 onboarding 실패는 guest로 연다. | 2026-10-22 |
| [동기화 흐름 구조](architecture/sync-flow.md) | 폰-워치 메시지는 `packages/contracts` schema가 기준이고, account hydrate는 원격 행을 최신순 페이지마다 바로 로컬에 적용하며, durable JSON은 원자적 단일 key 쓰기를 쓴다. | 2026-10-22 |
| [Watch 앱 구조](architecture/watch-app.md) | 워치 기록·복구 구조, 계획값과 선택 수명, 저장 실패 후 홈 복귀·재시도, 중복 종료 방지, Always-On 화면 이동 제한, 첫 하강 전 종류 바꾸기와 번호 있는 재전송 피드백, Plumb 리디자인의 화면 표현 계층(`DiveDesignSystem.swift`, `DivePostDive.swift`, 판단 로직 불변)을 정리한다. | 2026-10-23 |

## domains

다이빙 로그, 계획, 용어, 안전 경계를 설명한다.

| Article | Summary | Updated |
|---|---|---|
| [Diving App / Freediving Mode](domains/diving-app-freediving-mode.md) | Freedive mode는 압축공기 기반 NDL 계산이 아니라 수심, 시간, 속도, 수면 회복, 반복 부하, 로그, 행동 경고를 중심으로 하며, watch 구현은 한 `FreeDiveSession` 안에 여러 `FreeDiveSegment`를 저장한다. | 2026-07-05 |
| [Diving App / Non-Negotiable Safety Rules](domains/diving-app-non-negotiable-safety-rules.md) | 제품 구현에서 절대 위반하면 안 되는 safety-critical 규칙을 정리하고, Apple Watch 기반 v1 40m 지원 범위, 40m 초과 값 보존+unsupported 표시, v1 Air-only safety stop을 감압 의무처럼 표현하지 않는 규칙을 포함한다. | 2026-07-09 |
| [Diving App / Safety UX and Legal Notes](domains/diving-app-safety-ux-legal-notes.md) | 과거 센서 이상 햅틱·화면·지속 표시 약속과 최신 자동 햅틱 금지의 충돌을 표시하고 E2 결정 전 금지를 유지한다. | 2026-10-22 |
| [Diving App / Scuba Mode](domains/diving-app-scuba-mode.md) | Scuba mode v1은 Apple Watch 기반 40m 이하 Air-only gauge/log와 rule-based safety stop reminder를 포함하고, 40m 초과 값은 지원 범위 밖 warning과 함께 보존하지만 NDL, ceiling, TTS, CNS, gas remaining, decompression stop은 고위험 검증 범위로 분리한다. | 2026-08-02 |
| [다이브 로그 도메인](domains/dive-log.md) | Watch session 삭제 identity는 `localSessionId`이고, 워치가 잰 값은 편집기에서 잠금(직접 수정·되돌리기)이며, import 기본 사이트·150 bar·내부 태그는 claim 재사용 때문에 저장값을 두고 화면에서만 숨긴다. | 2026-10-22 |
| [다이브 계획 도메인](domains/dive-planning.md) | Planbook은 비중요 계획 알림이며, 초안은 제목이나 포인트만 요구하고 `계획 확정`과 `planned` 계획 저장만 전체 검사하며, `planned` 계획만 워치로 보내고 현재 버전의 전송 여부를 표시하며, 워치 선택은 Home 시작에만 적용하고 실행·제거 뒤 해제하며 없는 목표값을 만들지 않는다. | 2026-10-22 |
| [다이빙 용어](domains/diving-glossary.md) | 이 glossary는 현재 앱의 domain 용어를 정의하며, Apple Watch 기반 40m supported depth cap, unsupported depth, safety stop 권장 리마인더, decompression stop/mandatory stop의 구분을 포함한다. | 2026-07-09 |
| [안전 규칙](domains/safety-rules.md) | 비인증 기록 경계를 유지하고 E1 상승 표시·E2 과거 자동 햅틱 약속의 충돌과 결정 대기, D 배터리·수면·센서 범위 제한, 워치 모션이 안전·권장 스탑 완료 신호가 아니라는 경계를 명시한다. | 2026-10-23 |

## design

모바일과 watchOS의 제품 UI 언어를 설명한다.

| Article | Summary | Updated |
|---|---|---|
| [Mobile/Watch UI 언어](design/mobile-watch-ui-language.md) | 다이버 언어와 개념당 한 용어, naver-ad-bidder 로딩 전략, 모바일 편집기·상세·목록 패턴과 함께 워치 Plumb · 측심 규칙(색 역할, 수심 고정 게이지 그라데이션, 모양 문법, 고정 기록 계기와 세로 힌트 점, 물속 크로스페이드·다이버만 이동 모션, 실제 로고만, 문구 C1–C15, 실기기 미검증 항목)을 둔다. | 2026-10-23 |

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
| [열린 질문](questions/open-questions.md) | 워치 UX E1 상승 속도 표시·E2 센서 이상 알림·E3 계획 수신 확인을 소유자 결정 대기로 기록하고, Plumb 리디자인의 실기기 확인 항목과 기존 실기기·계정 후속 질문을 유지한다. | 2026-10-23 |
