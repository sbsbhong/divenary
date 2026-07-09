# Knowledge Base Index

## project

프로젝트 수준의 개요와 위키 운영 규칙을 담는다.

| Article                                                               | Summary                                                                                                                                                                                                            | Updated    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| [Diving App / Overview](project/diving-app-overview.md)               | Apple Watch Ultra급 워치를 중심으로 프리다이빙, Air-only safety-stop 리마인더를 포함한 레크리에이션 스쿠버, 로그 앱의 제품 방향을 정리하되, 현재 구현 상태와 certified dive-computer 기능을 분리한다.                                                                       | 2026-06-28 |
| [Diving App / Product Roadmap](project/diving-app-product-roadmap.md) | 추천 제품 범위는 v1 Apple Watch 기반 40m 이하 Gauge + Freedive + Air-only safety stop + Log에서 시작하고, decompression stop과 gas integration은 단계별 검증 뒤 다룬다.                                                               | 2026-07-08 |
| [Diving App / QA and Test Plan](project/diving-app-qa-test-plan.md)   | Mobile app, Watch app, v1 Air-only safety-stop reminder, 40m depth cap, safety/deco terminology, shared algorithm core, cross-device sync, failure fallback이 출시 전에 통과해야 하는 QA 기준과 regression policy를 정리한다.                                                 | 2026-07-08 |
| [Diving App / References](project/diving-app-references.md)           | 알고리즘과 제품 요구사항을 검증할 때 먼저 확인할 Apple, Oceanic+, NOAA, PADI, DAN, DecoTengu, Shearwater, Subsurface reference를 used-for, confidence, notes 기준으로 정리한다.                                                                  | 2026-06-28 |
| [프로젝트 개요](project/overview.md)                                        | `diving-app`은 레크리에이션 다이빙 로그 보조 앱을 위한 Yarn 1/Turborepo monorepo다. 현재 구현은 bare React Native 모바일 앱, 모바일 iOS project 안의 embedded SwiftUI watchOS companion target, 공유 watch 동기화 계약, 비어 있는 공유 utility package를 함께 관리한다. | 2026-06-28 |
| [위키 운영 방식](project/wiki-workflow.md)                                  | 이 저장소의 장기 지식 저장소는 Karpathy LLM Wiki 방식으로 관리한다. 이 저장소에서는 project root 대신 `.wiki/`를 wiki root로 보고, immutable source는 `.wiki/raw/`, compiled article은 `.wiki/wiki/`에 둔다.                                              | 2026-06-28 |

## algorithms

수심, 기체, tissue loading, NDL, oxygen exposure, gas management 계산 reference를 담는다.

| Article | Summary | Updated |
|---|---|---|
| [Diving App / Immutable Algorithm Reference](algorithms/diving-app-algorithm-reference.md) | 프리다이빙/스쿠버 제품 검토에서 반복 참조할 공식과 한계를 보존하고, Current Formula, Needs Validation, Future Extension 같은 status label과 Bühlmann coefficient 검증 TODO를 둔다. | 2026-06-28 |

## architecture

모노레포, 모바일 앱, watch 앱, 동기화, Supabase 경계를 설명한다.

| Article | Summary | Updated |
|---|---|---|
| [Diving App / State Management](architecture/diving-app-state-management.md) | 향후 스쿠버 계산 기능에서는 tissue state 유실이 가장 위험한 오류 중 하나이며, compact state와 1초 로그 저장, crash/reboot 복구, gauge fallback 정책이 필요하다. | 2026-06-28 |
| [구현 우선순위 기록](architecture/implementation-priorities.md) | 모바일 영구 저장소, WatchConnectivity PoC, watch debug/demo UX, scuba safety-stop reminder, local import acknowledgement, mobile cloud-pending status 표시는 구현됐고, 40m depth cap, safety/deco 용어와 색상 분리, 실기기 검증, cloud sync는 아직 남아 있다. | 2026-07-08 |
| [모바일 로그북 로드맵](architecture/mobile-logbook-roadmap.md) | 모바일 앱은 로그북의 중심이 되고, watch 앱은 측정 가능한 세션 데이터를 제공하는 캡처 source가 된다. 승인된 방향은 local-first 모바일 로그북을 먼저 만들고, 이후 로그인과 Supabase 동기화를 같은 저장소 경계 위에 붙이는 것이다. | 2026-06-28 |
| [모바일 구조](architecture/mobile.md) | `apps/mobile`은 watch에서 기록한 레크리에이션 다이빙 로그를 확인하고 모바일에서 수동 로그를 작성하기 위한 bare React Native 앱이며, iPhone app과 embedded watchOS companion target을 함께 소유한다. 현재는 server와 database 없이 React Navigation, React Query, AsyncStorage 기반 persistent repository, generated watch contract TypeScript type, Gluestack UI v4/NativeWind styling stack을 사용한다. | 2026-06-28 |
| [Monorepo 구조](architecture/monorepo.md) | 이 저장소는 Turborepo로 관리되는 Yarn 1 workspace monorepo다. 앱 workspace는 `apps/` 아래에 있고, 공유 package는 `packages/` 아래에 있다. | 2026-06-28 |
| [Supabase 구조](architecture/supabase.md) | 현재 저장소에는 구현된 Supabase 영역이 없다. | 2026-06-28 |
| [동기화 흐름 구조](architecture/sync-flow.md) | WatchConnectivity import acknowledgement는 local repository 저장/수신 확인이며 future cloud sync와 분리된다. Cloud sync가 없으므로 imported watch log의 visible cloud status는 현재 `pending`이고, demo capture도 같은 import/ack/dedupe 경로를 탄다. | 2026-07-07 |
| [Watch 앱 구조](architecture/watch-app.md) | `apps/mobile/ios/DiveWatchApp`는 SwiftUI watchOS companion 앱 source를 담는다. 같은 target/bundle identity의 `DiveWatchAppDebug` scheme은 DEBUG 전용 테스트 controls를 열고, demo/debug recording은 기존 `captureMode: demo`, Crown-controlled depth, full-height depth gauge, surface-gated end action을 사용한다. | 2026-07-07 |

## domains

다이빙 로그, 계획, 용어, 안전 경계를 설명한다.

| Article | Summary | Updated |
|---|---|---|
| [Diving App / Freediving Mode](domains/diving-app-freediving-mode.md) | Freedive mode는 압축공기 기반 NDL 계산이 아니라 수심, 시간, 속도, 수면 회복, 반복 부하, 로그, 행동 경고를 중심으로 하며, watch 구현은 한 `FreeDiveSession` 안에 여러 `FreeDiveSegment`를 저장한다. | 2026-07-05 |
| [Diving App / Non-Negotiable Safety Rules](domains/diving-app-non-negotiable-safety-rules.md) | 제품 구현에서 절대 위반하면 안 되는 safety-critical 규칙을 정리하고, Apple Watch 기반 v1 40m 제한과 v1 Air-only safety stop을 감압 의무처럼 표현하지 않는 규칙을 포함한다. | 2026-07-08 |
| [Diving App / Safety UX and Legal Notes](domains/diving-app-safety-ux-legal-notes.md) | 안전 copy, warning hierarchy, 책임 관련 UX 원칙을 정리하고, v1 Air-only safety stop 권장을 mandatory/decompression stop과 다른 색상과 문구로 제한한다. | 2026-07-08 |
| [Diving App / Scuba Mode](domains/diving-app-scuba-mode.md) | Scuba mode v1은 Apple Watch 기반 40m 이하 Air-only gauge/log와 rule-based safety stop reminder를 포함하지만, NDL, ceiling, TTS, CNS, gas remaining, decompression stop은 고위험 검증 범위로 분리한다. | 2026-07-08 |
| [다이브 로그 도메인](domains/dive-log.md) | Dive log domain은 watch/import/manual 로그를 model하며, watch-origin log는 capture mode, freedive segment payload, scuba safety stop reminder 결과를 보존하되 safety stop과 future decompression stop을 같은 구조로 섞지 않는다. | 2026-07-08 |
| [다이브 계획 도메인](domains/dive-planning.md) | 모바일 Planbook은 비중요 계획 알림이며, optional planned pressure는 준비 맥락 metadata일 뿐 실제 측정값이나 안전 계산 결과가 아니다. | 2026-06-28 |
| [다이빙 용어](domains/diving-glossary.md) | 이 glossary는 현재 앱의 domain 용어를 정의하며, Apple Watch 기반 40m cap, safety stop 권장 리마인더, decompression stop/mandatory stop의 구분을 포함한다. | 2026-07-08 |
| [안전 규칙](domains/safety-rules.md) | 이 앱은 레크리에이션 다이빙 로그 companion 앱이며, Apple Watch 기반 v1은 40m 이하로 제한하고 Air-only safety-stop reminder와 pressure metadata를 gas/deco/safety decision으로 해석하지 않는다. | 2026-07-08 |

## design

모바일과 watchOS의 제품 UI 언어를 설명한다.

| Article | Summary | Updated |
|---|---|---|
| [Mobile/Watch UI 언어](design/mobile-watch-ui-language.md) | `diving-app`의 모바일과 watchOS UI는 **iOS grouped base + dive instrument accent**를 공통 방향으로 삼고, v1 safety stop 권장 상태와 future mandatory/decompression 상태를 같은 색상 severity로 표시하지 않는다. | 2026-07-08 |

## decisions

승인된 architecture decision record를 관리한다.

| Article | Summary | Updated |
|---|---|---|
| [ADR 목록](decisions/adr-index.md) | 이 문서는 accepted architecture decision record 목록을 관리한다. | 2026-06-28 |
| [ADR: Local-first mobile logbook with future Supabase sync](decisions/adr-local-first-mobile-logbook.md) | 모바일 로그북은 Supabase와 인증을 먼저 붙이지 않고 local-first 저장소 경계 위에서 구현한다. 수동 로그와 watch 기반 로그를 모두 `DiveLogEntry`로 다루고, React Query는 저장소가 아니라 조회/변경 orchestration 계층으로만 사용한다. | 2026-06-28 |

## questions

구현되지 않았거나 검증되지 않은 열린 질문을 추적한다.

| Article | Summary | Updated |
|---|---|---|
| [Diving App / Open Questions](questions/diving-app-open-questions.md) | Apple Watch Ultra급 프리다이빙/스쿠버 제품 방향에서 GF 기본값, v2 Air/Nitrox 범위, 40m depth cap, safety/deco 용어와 색상 분리, mandatory deco 처리, tank transmitter, export format을 열린 질문으로 둔다. | 2026-07-08 |
| [열린 질문](questions/open-questions.md) | 이 문서는 완료된 동작처럼 쓰면 안 되는 오래 유지할 미확정 사항과 미구현 영역을 기록하며, 40m depth cap, safety stop 권장/필수 분리, decompression stop 설계, 실기기 검증을 남긴다. | 2026-07-08 |
