# Wiki Log

## [2026-07-30] ingest | Guest claim semantic canonical reuse physical verification

- Added: Guest claim semantic canonical reuse physical verification evidence raw source
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: 모바일 구조
- Updated: 열린 질문
- Updated: Knowledge Base Index
- 근거:
  - 원래 15건 batch와 뒤따른 별도 1건 batch가 모두 staging에서 committed 상태다.
  - 표현만 달랐던 Watch log는 기존 canonical ID를 재사용했고 obsolete staged target은 account row로 생성되지 않았다.
  - 실기기 local account 26건과 remote 26건의 local/remote ID가 모두 일치하며 중복 local ID가 없다.
  - guest log 0건, snapshot 없는 compact checkpoint, outbox/conflict 0건을 확인했다.
- 요약:
  - UI의 `15/15 → 1개 → 성공`은 보존 checkpoint finalization/cleanup 뒤 별도 live guest 1건을 새 inventory로 가져온 정상적인 두 claim 순서였다.

## [2026-07-30] lint | 0 issues found, 0 auto-fixed

## [2026-07-30] ingest | Guest claim semantic canonical reuse staging promotion

- Added: Guest claim semantic canonical reuse staging promotion evidence raw source
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: 모바일 구조
- Updated: 열린 질문
- 근거:
  - guarded dry run은 `20260730111944` migration 하나만 선택했고 staging push 뒤 local/remote migration history가 일치했다.
  - Edge Function source는 변경되지 않아 재배포하지 않았고, 기존 hosted Function이 새 public wrapper를 호출했다.
  - hosted verifier가 실제 다른 staged digest의 semantic canonical reuse, canonical target-ID remap, 사용자 의미 divergence rollback, RLS와 fixture cleanup을 통과했다.
- 요약:
  - Semantic canonical reuse는 hosted staging까지 승격·검증됐다. 원래 보존된 iPhone 15-item batch의 물리 retry만 다음 gate로 남는다.

## [2026-07-30] lint | 0 issues found, 0 auto-fixed

## [2026-07-30] ingest | Guest claim semantic canonical reuse

- Added: Guest claim semantic canonical reuse physical/root-cause evidence raw source
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: 모바일 구조
- Updated: 열린 질문
- Updated: Knowledge Base Index
- 근거:
  - 물리 iPhone 보존 claim 15건 중 14건은 새 log, 1건은 같은 immutable Watch profile과 사용자 content를 가진 canonical row
  - digest 차이는 동등한 timestamp 표기, source-derived float readback과 세 import bookkeeping timestamp
  - phase-one canonical lock 안의 좁은 normalization 뒤 기존 strict private finalization과 phase-two revalidation 유지
  - local reset, Function integration, pgTAP 109개, concurrency 2개, Supabase 70개, mobile hydration 80개와 보안 advisor 통과
- 요약:
  - Payload hash mismatch를 일반 허용하지 않는다. 동일 profiled Watch log의 표현 차이만 원자적으로 staged digest에 맞추고 canonical ID를 재사용하며, 의미 차이는 whole-batch rollback한다. Hosted staging과 원래 iPhone 15-item retry는 아직 pending이다.

## [2026-07-30] lint | 0 issues found, 0 auto-fixed

## [2026-07-28] lint | 0 issues found, 0 auto-fixed

## [2026-07-28] ingest | Local log import review hardening

- Added: Local log import review hardening evidence raw source
- Updated: 모바일 구조
- Updated: 1Hz 프로파일 파일 저장과 동기화
- Updated: 동기화 흐름 구조
- Updated: Knowledge Base Index
- Corrected: native prepared profile은 JavaScriptCore `JSON.stringify`를 사용해 mobile profile digest와 number encoding을 일치시킨다.
- Corrected: prepared derived-file 무결성 실패는 raw Watch artifact를 drop-ACK하지 않고 다음 시도에 재생성한다.
- Corrected: compact receipt의 historical identities를 Watch retransmission lookup에 포함하고 legacy committed snapshot도 재업로드 없이 compact receipt로 전환한다.

## [2026-07-28] lint | 0 issues found, 0 auto-fixed

## [2026-07-28] ingest | Local log import performance and reliability
- Added: Local log import performance and reliability evidence raw source
- Updated: 모바일 구조
- Updated: 1Hz 프로파일 파일 저장과 동기화
- Updated: 동기화 흐름 구조
- Updated: Knowledge Base Index
- 근거:
  - claim inventory 한 번과 entity별 조건부 bulk delete, 성공 guest 원본/profile sidecar cleanup, compact committed receipt
  - claim upload/finalize count와 indeterminate local cleanup UI 분리
  - native bounded descriptor 8개, utility-queue prepared profile, 160 sample preview와 JS canonical sample SHA
  - malformed drop-ACK, I/O/repository 미ACK retry, 첫 실패 뒤 다음 payload 처리와 `failedCount`
- 요약:
  - 과거 claim snapshot의 `15 / 15`와 대형 profile 반복 parse가 현재 live inventory/cleanup을 대표하지 않도록 분리했다. Watch full sample은 JS import 경로에서 제거하고 native file로 채택한다. Local ACK와 cloud 완료 경계는 유지하며 paired 8,000 sample과 background/relaunch는 실기기 gate로 남는다.

## [2026-07-18] ingest | Staging/local Auth fail-closed correction
- Added: Staging/local Auth fail-closed 보정 raw source
- Updated: Supabase 구조
- Updated: Knowledge Base Index

## [2026-07-18] ingest | Wave 3A staging and local Auth development
- Added: Staging/local Auth 개발 경계와 승격 증거 raw source
- Updated: Supabase 구조
- Updated: 열린 질문
- Updated: Knowledge Base Index
- 근거:
  - explicit local/staging/release mobile mode, local-only password composition, social Auth omission 경계
  - local Docker Supabase password fixture, ignored `apps/mobile/.env.local`, dedicated Metro port와 one-way cache fingerprint
  - staging project `mclvhwzsuvsxjerdouka`의 applied migration `20260713135707`, legal version `2026-07-18-staging.1`, immutable promotion URL verifier
  - exact legal row/effective time/URL, `get_onboarding_status() -> jsonb`, anonymous `42501`, Google/Apple enabled flag 검증
- 요약:
  - local password fixture와 hosted staging provider callback을 fail-closed mode로 분리했다. 같은 promotion commit의 seed retry는 idempotent하고 이후 promotion은 새 legal version과 URL이 필요하다. staging은 production이 아니며 Google/Apple native token exchange, cancellation/repeat, signed callback, restore는 signed physical device 수동 gate로 남는다. Guest Logbook/Planbook의 local-only 경계와 비안전-critical 기록 제품 범위는 유지한다.

## [2026-07-16] ingest | Google iOS client and callback correction
- Added: Google iOS client and callback correction raw source
- Updated: Supabase 구조
- Updated: 구현 우선순위 기록
- Updated: 열린 질문
- Updated: Knowledge Base Index
- 근거:
  - 사용자가 Google iOS Client ID가 main checkout에 있음을 정정
  - ignored `.env.development`가 별도 Git worktree에 복사되지 않아 발생한 이전 누락 판정 오류를 확인
  - Client ID에서 산출한 reversed scheme을 Divenary iPhone Debug/Release에 설정하고 Watch에는 넣지 않음
- 요약:
  - Google iOS client/callback 준비는 완료됐지만 hosted provider/legal, physical Auth/re-consent와 post-Auth Watch regression은 계속 3B 전 gate다.

## [2026-07-15] ingest | Divenary Auth promotion readiness
- Added: Divenary Auth promotion readiness evidence raw source
- Updated: Supabase 구조
- Updated: 구현 우선순위 기록
- Updated: 열린 질문
- Updated: Knowledge Base Index
- 근거:
  - Divenary iPhone/embedded Watch generic device build, automatic provisioning, strict signature verification과 embedded binary validation 통과
  - Signed iPhone에만 Apple Sign In entitlement가 있고 Watch에는 없음을 확인
  - Local Supabase 67 pgTAP, REST smoke, lint/advisor, generated type drift, Supabase 20 tests, mobile 40 suite/418 tests와 typecheck 재검증
  - Google iOS client ID와 reversed callback scheme이 비어 있어 physical Google Auth가 차단됨을 확인
- 요약:
  - App ID와 signed provisioning은 승격됐지만 Google iOS client/callback, hosted provider/legal과 physical Auth/re-consent, post-Auth Watch regression은 계속 3B 전 gate다.

## [2026-07-15] ingest | Wave 3A Supabase Auth foundation implementation
- Added: Wave 3A Supabase Auth foundation 구현 증거 raw source
- Updated: 프로젝트 개요
- Updated: Monorepo 구조
- Updated: 모바일 구조
- Updated: 모바일 로그북 로드맵
- Updated: Supabase 구조
- Updated: 1Hz 프로파일 파일 저장과 동기화
- Updated: 동기화 흐름 구조
- Updated: 구현 우선순위 기록
- Updated: 열린 질문
- Updated: Knowledge Base Index
- 근거:
  - 구현: local Supabase Auth schema/RLS/RPC, typed package, Keychain-compatible session, native Google/Apple credential adapter, Auth state/UI와 immutable current legal consent
  - 자동 검증: pgTAP 67개, Supabase package 20개, mobile 40 suite/418개, typecheck, unsigned iOS/watch builds와 `codex:check`
  - 범위 확인: guest Logbook/Planbook은 local-only와 `notConfigured`를 유지하고 Watch target에는 account/provider/Supabase 책임을 추가하지 않음
- 요약:
  - Wave 3A automated checkpoint는 완료됐다. Hosted provider/legal/signing, physical Auth/re-consent와 post-Auth Watch regression은 3B 전 승격 gate로 남고, 3B remote data, 3C principal sync, 3D account lifecycle은 구현되지 않았다. 3A build는 3D 앱 내 계정 삭제 전에는 release하지 않는다.

## [2026-07-15] ingest | Supabase Auth 2.110.2 lock strategy correction
- Added: Supabase Auth 2.110.2 lock strategy correction raw source
- Updated: Supabase 구조
- Updated: Knowledge Base Index
- 근거:
  - 설치된 `@supabase/auth-js@2.110.2` source에서 custom `auth.lock`와 `processLock`이 deprecated이고 v3 제거 예정임을 확인
  - SDK 기본 경로가 lockless single-flight와 commit guard로 동시 refresh/session commit을 조정함을 확인
  - 셸에 주입된 무관한 hosted Supabase project 환경 변수가 local CLI context를 오염시키는 것을 확인하고 전용 local wrapper로 격리
- 요약:
  - 새 React Native client는 deprecated custom lock을 전달하지 않고 SDK 기본 concurrency path를 사용한다. Local CLI/type generation은 hosted project 환경 변수를 제거한 독립 context를 사용한다. Keychain persistence, online claims/user 검증, foreground auto-refresh와 bounded offline trust 정책은 유지한다.

## [2026-07-13] ingest | Wave 3 Supabase/Auth 승인 결정
- Added: Wave 3 Supabase/Auth 승인 결정 raw source
- Updated: Supabase 구조
- Updated: 구현 우선순위 기록
- Updated: 모바일 로그북 로드맵
- Updated: 열린 질문
- Updated: Knowledge Base Index
- 근거:
  - 사용자 실기기 보고: 약 4분 foreground pairing, Watch session 자동 import, 모바일 local save 뒤 Watch `synced` 확인
  - 사용자 결정: iOS native Google/Apple, mandatory versioned consent, guest/account 분리, explicit guest claim, cursor pagination, detail-only private profile Storage, revision conflict, logout account-cache purge, 즉시 영구 삭제
  - 기술 검토: manual provider linking UI는 제공하지 않고, 같은 verified email에는 Supabase Auth의 automatic linking 기본 동작을 수용
  - 사용자 결정: 7일 유예 soft deletion/recovery, nickname/profile/friends, Android native Auth는 후속
- 요약:
  - Wave 3을 3A Auth foundation, 3B remote data, 3C local-first sync, 3D account lifecycle로 나눴다. Watch local acknowledgement와 cloud 성공을 분리하고, 남은 Wave 1/2 물리 gate는 완료로 과장하지 않는다.

## [2026-07-12] ingest | Pre-real-dive P0 readiness and QA boundary
- Added: Pre-real-dive readiness scope and immediate hardening raw source
- Updated: 구현 우선순위 기록
- Updated: Diving App / QA and Test Plan
- Updated: Knowledge Base Index
- 근거:
  - 사용자 결정: 실제 프리다이빙·스쿠버만 제외하고 건식 실기기, 얕은 물 센서, Supabase/Auth, Memory/share와 출시 준비를 모두 P0로 유지
  - 구현: Watch import 직렬화, optional 수온, cloud/Watch status 분리, DEBUG large payload fixture
- 요약:
  - 코드 hardening과 자동 검증은 완료됐지만 Watch 설치와 물리 검증은 미완료다. QA 문서에서 감압·조직·gas safety 계산을 제거하고 자동, 건식, 얕은 물, cloud/product, 출시, 실제 잠수 gate를 분리했다.

## [2026-07-10] ingest | Watch home launch sensor deferral
- Added: Watch home launch sensor deferral raw source
- Updated: Watch 앱 구조
- Updated: 구현 우선순위 기록
- Updated: Knowledge Base Index
- 근거:
  - 사용자 실기기 보고: watch 앱 실행 후 system time만 보이고 Home UI가 표시되지 않음
  - 구현: `DepthSensorAvailability.launchPlaceholder`, `HomeView.loadInitialSensorAvailability()`, `DiveAutoStartMonitor.startMonitoringIfAvailable(sensorProvider:)`
- 요약:
  - watch Home 첫 frame이 CoreMotion underwater depth availability check나 `RealDepthSensorProvider` 생성에 막히지 않도록 sensor 초기화를 deferred path로 옮겼다. 실제 underwater sensor, auto-launch, WatchConnectivity 실기기 검증은 별도 후속 항목으로 남는다.

## [2026-07-10] ingest | Watch session UI and sync startup fixes
- Added: Watch session UI and sync startup fixes raw source
- Updated: 모바일 구조
- Updated: Watch 앱 구조
- Updated: 동기화 흐름 구조
- Updated: 구현 우선순위 기록
- Updated: Knowledge Base Index
- 근거:
  - 사용자 실기기 보고: watch session list sync badge clipping, end-dive button 표시 시 recording 화면 압축, watch session 저장 후 mobile sync 실패
  - 구현: compact session sync badge, compact end-dive overlay, `WatchConnectivitySyncProvider` subscribe-before-drain startup order
- 요약:
  - 작은 watch 화면에서 session status와 recording instrument가 사라지거나 줄어드는 문제를 문서화했고, mobile local import acknowledgement 경로의 startup race 보강을 기록했다. 실제 disconnect/reconnect crash 재현과 background delivery 검증은 여전히 실기기 후속 항목이다.

## [2026-07-10] ingest | Mobile native reverse geocoder implementation
- Updated: 모바일 구조
- Updated: 구현 우선순위 기록
- Updated: Knowledge Base Index

## [2026-07-08] ingest | Depth cap, safety stop color, decompression stop terminology pending work
- Updated: Diving App / Product Roadmap
- Updated: Diving App / QA and Test Plan
- Updated: 구현 우선순위 기록
- Updated: Diving App / Non-Negotiable Safety Rules
- Updated: Diving App / Safety UX and Legal Notes
- Updated: Diving App / Scuba Mode
- Updated: 다이브 로그 도메인
- Updated: 다이빙 용어
- Updated: 안전 규칙
- Updated: Mobile/Watch UI 언어
- Updated: Diving App / Open Questions
- Updated: 열린 질문
- Updated: 동기화 흐름 구조

## [2026-07-07] ingest | Watch debug demo sync logbook UX
- Added: Watch debug demo sync logbook UX raw source
- Updated: Watch 앱 구조
- Updated: 동기화 흐름 구조
- Updated: 다이브 로그 도메인
- Updated: 안전 규칙
- Updated: Mobile/Watch UI 언어
- Updated: 구현 우선순위 기록
- Updated: 열린 질문
- Updated: Diving App / Open Questions
- Updated: Knowledge Base Index
- 근거:
  - 사용자 결정: 같은 target을 쓰는 `DiveWatchAppDebug` scheme, DEBUG-only `Test Freedive`/`Test Scuba`, 기존 `captureMode: demo`, Crown-controlled demo/debug depth, surface-gated end button
  - 구현: safety-stop constant, too-deep routing, future cloud sync와 분리된 local WatchConnectivity acknowledgement, 현재 visible cloud status pending, low-chroma status chip, pressure start/end metadata 표시
- 요약:
  - Watch debug/demo UX와 mobile logbook sync/status 표시를 문서화했다. Native import acknowledgement는 local save 확인이고 cloud sync가 아니며, Air-only safety stop과 pressure metadata는 non-certified logging/reminder 범위로 유지한다.

## [2026-07-05] ingest | Watch real-device readiness and explicit demo mode
- Added: Watch real-device readiness and explicit demo mode raw source
- Updated: Watch 앱 구조
- Updated: 동기화 흐름 구조
- Updated: 구현 우선순위 기록
- Updated: 다이브 로그 도메인
- Updated: 안전 규칙
- Updated: Diving App / Open Questions
- Updated: 열린 질문
- Updated: Knowledge Base Index
- 근거:
  - 사용자 결정: 명시적 테스트 모드에서만 테스트 데이터 사용
  - 사용자 결정: 일반 기록은 수심 최우선 계기판형, 세이프티 스톱 때만 전용 화면
  - 구현: `RealDepthSensorProvider`, `DemoDepthSensorProvider`, `captureMode`, watch target `Info.plist`, mobile demo marker, profile downsampling
- 요약:
  - Real recording은 `CMWaterSubmersionManager` 기반 provider로, fake sample은 explicit demo mode로 분리했다. Watch Home은 plan 생성/편집을 제거하고 모바일 계획 선택만 유지한다. 실기기 underwater sensor, auto-launch, store-level Ultra-only install filtering은 검증 항목으로 남겼다.

## [2026-07-05] ingest | Watch freedive segments and scuba safety stop implementation
- Added: Watch freedive segments and scuba safety stop implementation raw source
- Updated: Watch 앱 구조
- Updated: 동기화 흐름 구조
- Updated: 구현 우선순위 기록
- Updated: 다이브 로그 도메인
- Updated: 안전 규칙
- Updated: Diving App / Scuba Mode
- Updated: Diving App / Freediving Mode
- Updated: Diving App / Open Questions
- Updated: 열린 질문

## [2026-06-28] ingest | Mobile form validation and pressure metadata
- Added: Mobile form validation and pressure metadata raw source
- Updated: 다이브 로그 도메인
- Updated: 다이브 계획 도메인
- Updated: 안전 규칙
- Updated: Knowledge Base Index
- 근거:
  - 사용자 요청: Logbook/Planbook form validation, date picker, numeric sliders, star ratings, Air-only scuba gas, badge inputs, scuba pressure metadata
- 요약:
  - 수동 로그와 계획의 scuba pressure를 start/end + `bar`/`psi` metadata로 기록할 수 있음을 문서화했다. Pressure는 로그/계획 맥락일 뿐 gas remaining, reserve, turn pressure, emergency instruction, certified dive-computer behavior가 아니며, 계획 depth/duration은 실제 로그 measured value로 복사하지 않는 경계를 유지했다.

## [2026-06-28] ingest | Diving App / Product Roadmap
- Updated: Diving App / Overview
- Updated: Diving App / QA and Test Plan
- Updated: Diving App / Scuba Mode
- Updated: Diving App / Safety UX and Legal Notes
- Updated: Diving App / Non-Negotiable Safety Rules
- Updated: 안전 규칙
- Updated: Diving App / Open Questions
- Updated: 열린 질문

## [2026-06-28] ingest | Diving App / QA and Test Plan
- Updated: Diving App / Non-Negotiable Safety Rules
- Updated: Diving App / Immutable Algorithm Reference
- Updated: Diving App / Overview
- Updated: Diving App / Freediving Mode
- Updated: Diving App / Scuba Mode
- Updated: Diving App / State Management
- Updated: Diving App / Product Roadmap
- Updated: Diving App / Safety UX and Legal Notes
- Updated: Diving App / References
- Updated: Diving App / Open Questions
- Updated: 안전 규칙

## [2026-06-28] ingest | Diving App / Immutable Algorithm Reference
- Updated: Diving App / Overview
- Updated: Diving App / Freediving Mode
- Updated: Diving App / Scuba Mode
- Updated: Diving App / State Management
- Updated: Diving App / Product Roadmap
- Updated: Diving App / Safety UX and Legal Notes
- Updated: Diving App / References
- Updated: Diving App / Open Questions
- Updated: 안전 규칙
- Updated: 열린 질문

## [2026-06-27] 기록 | WatchConnectivity 재연결 crash blocker

- 수정:
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md`
  - `.wiki/wiki/log.md`
- 근거:
  - 사용자 보고: 모바일과 watch 연결이 끊긴 상태에서 watch로 다이빙 기록을 만든 뒤 재연결 후 앱에서 동기화를 시도하면 crash 발생
- 요약:
  - 실기기 검증 전에 해결해야 하는 WatchConnectivity blocker로 기록했다. 기본 자동 동기화와 Logbook `워치 동기화` 버튼 기반 수동 재시도가 모두 pending watch 기록을 crash 없이 import해야 한다.

## [2026-06-26] 구현 | pre-device priorities

- 수정:
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/domains/dive-planning.md`
  - `.wiki/wiki/domains/safety-rules.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `packages/contracts/schemas/watch-session.schema.json`
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/src/notifications/watch-sync-notification-service.ts`
  - `apps/mobile/src/conditions/home-conditions.ts`
  - `apps/mobile/ios/DiveWatchApp/Models/DiveSession.swift`
  - `docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md`
- 요약:
  - `scuba`/`freedive` 두 모드 reset, Notifee 기반 local watch sync notification, Home 위치 조건 mock interface를 구현된 사실로 기록했다. WatchConnectivity paired-device/background delivery, 실제 underwater sensor behavior, Home real API/location policy는 아직 수동 검증 또는 후속 구현이 필요한 항목으로 남겼다.

## [2026-06-26] 설계 | pre-device readiness specs

- 수정:
  - `.wiki/wiki/project/overview.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/domains/dive-planning.md`
  - `.wiki/wiki/domains/safety-rules.md`
  - `.wiki/wiki/questions/open-questions.md`
- 근거:
  - 사용자 지시: 실기기 검증 전 Watch sync notification, two-mode dive UX, Home location conditions를 별도 spec으로 분리
  - `docs/superpowers/specs/2026-06-26-watch-sync-notifications-design.md`
  - `docs/superpowers/specs/2026-06-26-two-mode-dive-contract-and-ux-design.md`
  - `docs/superpowers/specs/2026-06-26-home-location-conditions-design.md`
- 요약:
  - Notifee 기반 watch sync notification, `scuba`/`freedive` 두 모드 축소와 local storage reset, Home 위치/기온/해안 수온 provider-neutral interface를 승인된 다음 작업으로 기록했다. 오래된 in-memory 저장소 설명을 현재 AsyncStorage persistent repository 기준으로 바로잡았다.

## [2026-06-25] 구조 | planned watch log completion

- 수정:
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/domains/dive-planning.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/src/utils/enrich-watch-log-with-plan.ts`
  - `apps/mobile/ios/DiveWatchApp/Models/DiveSession.swift`
  - `packages/contracts/schemas/watch-session.schema.json`
- 요약:
  - 모바일 계획으로 시작한 watch session이 `sourcePlanLocalId`와 `planTitle`을 유지하고, 모바일 import 시 원본 계획 metadata를 로그 manual overlay에 합친 뒤 원본 계획을 완료 상태와 `convertedLogLocalId`로 갱신하는 흐름을 기록했다.

## [2026-06-25] 구조 | watch preferred dive mode and auto start

- 수정:
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/domains/safety-rules.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
  - `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
  - `apps/mobile/ios/DiveWatchApp/Sensors/RealDepthSensorProvider.swift`
- 요약:
  - Watch Home의 선호 다이빙 형태 저장과 fallback, 수심 3m 이상 자동 기록 시작 trigger, 그리고 이 trigger가 safety 판단이 아니라 기록 편의 기능이라는 경계를 기록했다.

## [2026-06-25] 구조 | compact watch pre-dive plan card

- 수정:
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
  - `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
- 요약:
  - watch Home의 pre-dive metadata 입력 카드는 기본적으로 접힌 요약 상태로 표시되고, 사용자가 펼칠 때만 세부 입력 필드를 보여준다.

## [2026-06-25] 구조 | watch visible unexecuted plans

- 수정:
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/src/native/watch-connectivity.ts`
  - `apps/mobile/__tests__/watch-connectivity-plans.test.ts`
- 요약:
  - 모바일에서 watch로 보내는 계획 목록을 `planned` 상태로만 제한하지 않고, 아직 완료되지 않았고 로그로 전환되지 않은 `draft`와 `planned` 계획으로 확장했다. `completed` 상태와 `convertedLogLocalId`가 있는 계획은 watch Home 후보에서 제외한다.

## [2026-06-25] 구조 | planned dive context activation retry

- 수정:
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
  - `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`
  - `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
- 요약:
  - 모바일의 planned dive context가 `WCSession` activation 전 전송 시도에서 유실되지 않도록 최신 JSON을 보관했다가 activation/reachability 뒤 다시 application context로 보낸다. Watch 앱도 activation 완료 시 저장된 `receivedApplicationContext`를 읽어 앱 시작 전에 도착한 planned dive 목록을 반영한다.

## [2026-06-25] 구조 | pre-device mobile/watch readiness

- 수정:
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/mobile-logbook-roadmap.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/src/components/navigation/index.tsx`
  - `apps/mobile/src/native/watch-connectivity.ts`
  - `apps/mobile/src/states/use-dive-logbook.ts`
  - `apps/mobile/src/states/use-dive-plans.ts`
  - `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
  - `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
  - `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`
  - `apps/mobile/src/screens/settings/screen.tsx`
  - `apps/mobile/src/screens/home/screen.tsx`
- 요약:
  - React Navigation 기반 tab 구조, 로그북의 WatchConnectivity pending inbox 수동 동기화, mobile-to-watch planned dive 전달, watch Home의 planned dive 시작, Settings의 linked watch 상태 표시, Home의 워치 리마인더 상태 문구를 현재 코드 기준으로 기록했다. 공개 API 한계로 사용자가 설정한 Apple Watch 이름은 아직 확인되지 않았고 fallback 이름을 쓰는 점을 열린 질문으로 남겼다.

## [2026-06-25] 구조 | WatchConnectivity live retry and acknowledgement

- 수정:
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`
  - `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
  - `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
  - `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
- 요약:
  - WatchConnectivity `transferUserInfo`만 쓰던 전송 경로에 reachable `sendMessage`를 병행하는 동작을 기록했다. Watch 앱은 activation/reachability 이후 pending 세션을 재전송하고, 모바일 import acknowledgement도 live message와 durable transfer를 병행한다. 활성 simulator에서는 watch 세션 import와 watch `syncStatus: "synced"` acknowledgement가 확인됐지만, background delivery와 실기기 paired-device 검증은 남은 항목으로 유지했다.

## [2026-06-24] 구조 | WatchConnectivity import acknowledgement

- 수정:
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/src/states/use-dive-logbook.ts`
  - `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
  - `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`
  - `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
  - `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
- 요약:
  - WatchConnectivity `transferUserInfo` 완료와 모바일 import 완료를 분리했다. Watch local session은 전송 성공만으로 `synced`가 되지 않고, 모바일 repository 저장 뒤 돌아오는 `watchSyncAcknowledgement`를 받은 뒤에만 `synced`가 된다. Logbook import action은 pending WatchConnectivity native inbox를 수동 drain하며, native module이 없는 환경에서만 fixture import로 fallback한다.

## [2026-06-24] 구조 | WatchConnectivity durable inbox and status

- 수정:
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
  - `apps/mobile/ios/DiveMobile/WatchConnectivityModule.swift`
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`
  - `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
  - `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- 요약:
  - 모바일 WatchConnectivity 수신 payload가 durable inbox에 저장되고 JS import 뒤 acknowledge되는 사실을 기록했다. Watch transfer 완료 callback이 watch local session의 `syncStatus`를 갱신하고, 모바일 수신 성공 항목은 top-level `syncStatus`를 `synced`로 보정한다. Paired-device delivery, entitlement, background delivery, retry/backoff behavior, 실기기 전송 검증은 아직 남은 항목으로 유지했다.

## [2026-06-24] 구조 | watch app mobile migration

- 수정:
  - `.wiki/wiki/project/overview.md`
  - `.wiki/wiki/architecture/monorepo.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/decisions/adr-local-first-mobile-logbook.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
  - `apps/mobile/ios/DiveWatchApp/`
  - `apps/mobile/package.json`
  - `package.json`
- 요약:
  - Watch source와 build ownership을 모바일 iOS project로 이관한 사실을 기록했다. 활성 watch source는 `apps/mobile/ios/DiveWatchApp`이고, `DiveWatchApp` target/scheme은 `apps/mobile/ios/DiveMobile.xcodeproj` 안에서 iPhone app의 embedded companion app으로 관리된다. Pairing, entitlement, background delivery, retry behavior, 실기기 전송 검증은 아직 남은 항목으로 유지했다.

## [2026-06-24] 구조 | WatchConnectivity transport PoC

- 수정:
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/mobile-logbook-roadmap.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncEnvelope.swift`
  - `apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift`
  - `apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift`
  - `apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift`
  - `apps/mobile/ios/DiveMobile/WatchConnectivityModule.swift`
  - `apps/mobile/src/native/watch-connectivity.ts`
  - `apps/mobile/src/states/watch-connectivity-sync.tsx`
  - `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- 요약:
  - Watch 앱이 저장된 세션 JSON을 WatchConnectivity `transferUserInfo`로 enqueue하고, 모바일 iOS native/JS가 payload를 받아 validator와 repository import로 넘기는 PoC 경계를 기록했다. Pairing, entitlement, app embedding, background delivery, retry behavior, 실기기 전송 검증은 아직 남은 항목으로 유지했다.

## [2026-06-24] 구조 | watch sync JSON validation

- 수정:
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/architecture/mobile-logbook-roadmap.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/src/utils/watch-sync-message-validation.ts`
  - `apps/mobile/src/utils/watch-fixtures.ts`
  - `apps/mobile/__tests__/watch-sync-message-validation.test.ts`
  - `packages/contracts/fixtures/metadata-rich-watch-sync-message.json`
- 요약:
  - 모바일 앱이 원시 watch sync JSON을 실행 시점에 검증한 뒤 `WatchSyncMessage`로 좁혀 기존 `DiveLogEntry` import 흐름으로 넘길 수 있다는 사실을 기록했다. WatchConnectivity 전송과 generated Swift contract target membership은 아직 남은 항목으로 유지했다.

## [2026-06-23] 구조 | mobile persistent storage

- 수정:
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/mobile-logbook-roadmap.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/src/storage/`
  - `apps/mobile/src/repositories/persistent-dive-log-repository.ts`
  - `apps/mobile/src/repositories/persistent-dive-plan-repository.ts`
  - `apps/mobile/src/states/app-preferences-storage.ts`
  - `apps/mobile/src/states/app-preferences.tsx`
- 요약:
  - 모바일 Logbook, Planbook, 설정 선호가 AsyncStorage 기반 versioned JSON 저장소를 통해 앱 재시작 뒤에도 유지되는 구조를 기록했다.

## [2026-06-23] 구조 | follow-up implementation priorities

- 수정:
  - `.wiki/wiki/index.md`
  - `.wiki/wiki/architecture/implementation-priorities.md`
  - `.wiki/wiki/log.md`
- 근거:
  - 사용자 지시: 1번만 진행하고 2~10번은 위키에 작성
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/questions/open-questions.md`
- 요약:
  - 모바일 영구 저장소 이후의 Watch sync 검증, WatchConnectivity, 실제 watch sensor provider, 모바일 리뷰 고도화, Planbook 연계, Memory/share, Auth/Supabase, 문서 정리, 안전/실기기 검증 항목을 후속 확인 우선순위로 기록했다.

## [2026-06-23] 구조 | mobile Planbook local flow

- 수정:
  - `.wiki/wiki/index.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/domains/dive-planning.md`
  - `.wiki/wiki/domains/safety-rules.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/src/types/dive-plan.ts`
  - `apps/mobile/src/repositories/local-dive-plan-repository.ts`
  - `apps/mobile/src/states/use-dive-plans.ts`
  - `apps/mobile/src/screens/planning/screen.tsx`
  - `apps/mobile/src/utils/dive-plan-to-log-entry.ts`
  - `apps/mobile/src/screens/logbook/log-entry-editor.tsx`
- 요약:
  - 모바일 Planbook이 `DivePlan`, in-memory repository, React Query hook, local route editor/detail/complete flow를 사용한다는 사실을 기록했다. 계획값은 의도와 준비 맥락이고, 완료된 계획에서 Logbook 초안을 만들 때 실제 measured value로 복사하지 않는 안전 경계도 명시했다.

## [2026-06-22] 구조 | mobile logbook edit and mode-specific forms

- 수정:
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/mobile-logbook-roadmap.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/src/screens/logbook/screen.tsx`
  - `apps/mobile/src/screens/logbook/log-entry-editor.tsx`
  - `apps/mobile/src/screens/logbook/log-entry-mode-fields.tsx`
  - `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
  - `apps/mobile/src/types/dive-log-entry.ts`
- 요약:
  - 당시 모바일 로그북이 기존 수동/watch 기반 항목을 수정할 수 있고, mode별 입력 section과 metadata를 다르게 저장하던 구현 사실을 기록했다. 이후 active mode는 두 모드로 축소됐다. Watch 기반 항목 수정은 raw watch capture와 `source: 'watch'`를 보존하고 manual overlay를 pending 상태로 둔다.

## [2026-06-22] 구조 | mobile local-first logbook Phase 2

- 수정:
  - `.wiki/wiki/project/overview.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/architecture/mobile-logbook-roadmap.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/src/types/dive-log-entry.ts`
  - `apps/mobile/src/repositories/dive-log-repository.ts`
  - `apps/mobile/src/repositories/local-dive-log-repository.ts`
  - `apps/mobile/src/states/use-dive-logbook.ts`
  - `apps/mobile/src/states/use-dive-logbook-queries.ts`
  - `apps/mobile/src/screens/logbook/screen.tsx`
  - `apps/mobile/src/screens/logbook/log-entry-editor.tsx`
  - `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
- 요약:
  - 모바일 로그북이 `DiveLogEntry`, `DiveLogRepository`, React Query hook을 사용하고, 로그인 없이 수동 로그를 작성해 watch import와 같은 목록에 표시하는 현재 구현 사실을 기록했다. 현재 저장소는 production persistence가 아니라 in-memory `LocalDiveLogRepository`라는 제한도 함께 명시했다.

## [2026-06-21] 결정 | React Query for mobile logbook data access

- 수정:
  - `.wiki/wiki/architecture/mobile-logbook-roadmap.md`
  - `.wiki/wiki/decisions/adr-local-first-mobile-logbook.md`
  - `.wiki/wiki/log.md`
- 근거:
  - 사용자 승인: React Query는 사용하는 방향으로 잡고, Zustand는 당장 불필요하다는 판단
  - `docs/superpowers/specs/2026-06-21-mobile-logbook-local-first-design.md`
  - `docs/superpowers/plans/2026-06-21-mobile-logbook-local-first.md`
- 요약:
  - 모바일 로그북 조회와 변경은 React Query cache/mutation 계층으로 다루고, 실제 저장 책임은 local repository와 future Supabase repository에 둔다. Zustand는 첫 구현 범위에서 제외하고 편집 상태가 복잡해질 때 재검토한다.

## [2026-06-21] 결정 | local-first mobile logbook roadmap

- 수정:
  - `.wiki/wiki/index.md`
  - `.wiki/wiki/project/overview.md`
  - `.wiki/wiki/architecture/mobile-logbook-roadmap.md`
  - `.wiki/wiki/architecture/supabase.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/decisions/adr-index.md`
  - `.wiki/wiki/decisions/adr-local-first-mobile-logbook.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- 근거:
  - 사용자 승인: local-first 모바일 로그북을 먼저 만들고 Supabase sync를 나중에 붙이는 방향
  - `apps/mobile/src/states/use-dive-logbook.ts`
  - `apps/mobile/src/types/dive-session.ts`
  - `apps/mobile/src/utils/import-watch-session.ts`
  - `apps/mobile/ios/DiveWatchApp/Models/DiveSession.swift`
  - `packages/contracts/schemas/watch-session.schema.json`
  - `docs/superpowers/specs/2026-06-21-mobile-logbook-local-first-design.md`
  - `docs/superpowers/plans/2026-06-21-mobile-logbook-local-first.md`
- 요약:
  - 모바일 로그북을 local-first로 만들고, 수동 로그와 watch 기반 로그를 모두 `DiveLogEntry`로 다루며, 이후 로그인과 Supabase sync를 저장소 경계 뒤에 붙이는 승인된 방향을 기록했다.

## [2026-06-21] 구조 | mobile settings tab

- 수정:
  - `.wiki/wiki/project/overview.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/src/components/navigation/index.tsx`
  - `apps/mobile/src/providers.tsx`
  - `apps/mobile/src/states/app-preferences.tsx`
  - `apps/mobile/src/screens/settings/screen.tsx`
  - `apps/mobile/src/i18n/resources.ts`
  - `apps/mobile/src/types/dive-session.ts`
- 요약:
  - 모바일 앱의 활성 bottom tab이 Home, Logbook, Planning, Settings로 바뀐 사실을 기록했다. Settings는 테마와 언어 선호를 관리하지만, 현재 값은 실행 중인 React state에만 저장되고 production persistence는 아직 없다.

## [2026-06-20] 디자인 | mobile/watch UI 언어

- 수정:
  - `.wiki/wiki/design/mobile-watch-ui-language.md`
  - `.wiki/wiki/index.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/log.md`
- 근거:
  - 사용자가 승인한 `iOS grouped base + dive instrument accent` 방향
  - `DESIGN.md`
  - `apps/mobile/src/screens/`
  - `apps/mobile/src/components/ui/`
  - `apps/mobile/ios/DiveWatchApp/Views/`
  - `.wiki/wiki/domains/safety-rules.md`
- 요약:
  - 모바일과 watchOS가 공유할 UI look and feel을 기록했다. 모바일은 iOS grouped 화면을 기본으로 하고, watchOS는 black canvas와 compact instrument card로 번역한다. 다이빙 도메인감은 수심, 시간, profile, 상태 같은 계기 요소에만 집중하며 safety copy는 review/reminder/non-certified assistant 범위에 둔다.

## [2026-06-20] 문서화 | wiki 영어 사용 축소

- 수정:
  - `.agents/skills/wiki-writing/SKILL.md`
  - `.wiki/wiki/index.md`
  - `.wiki/wiki/project/overview.md`
  - `.wiki/wiki/architecture/monorepo.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/supabase.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/domains/safety-rules.md`
  - `.wiki/wiki/domains/diving-glossary.md`
  - `.wiki/wiki/decisions/adr-index.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- 근거:
  - wiki 설명에서 영어 사용을 줄이라는 사용자 지시
  - `.agents/skills/wiki-writing/SKILL.md`
  - `.wiki/wiki/`
- 요약:
  - 설명 문장에서 한국어로 자연스럽게 옮길 수 있는 영어를 줄였다. 변수명, 함수명, package name, file path, schema/type/field name, product name처럼 그대로 써야 하는 식별자는 유지했다.

## [2026-06-20] 문서화 | wiki 한국어 재작성

- 수정:
  - `.wiki/wiki/index.md`
  - `.wiki/wiki/project/overview.md`
  - `.wiki/wiki/architecture/monorepo.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/supabase.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/domains/safety-rules.md`
  - `.wiki/wiki/domains/diving-glossary.md`
  - `.wiki/wiki/decisions/adr-index.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- 근거:
  - user instruction to write wiki pages in Korean
  - `.agents/skills/wiki-writing/SKILL.md`
  - `package.json`
  - `turbo.json`
  - `README.md`
  - `apps/mobile/AGENTS.md`
  - `apps/mobile/package.json`
  - `apps/mobile/src/`
  - `apps/mobile/components/ui/gluestack-ui-provider/`
  - `apps/mobile/tailwind.config.js`
  - `apps/mobile/AGENTS.md`
  - `apps/mobile/package.json`
  - `apps/mobile/ios/DiveWatchApp/`
  - `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
  - `packages/contracts/package.json`
  - `packages/contracts/schemas/`
  - `packages/contracts/generated/`
- 요약:
  - 기존 wiki 구조와 오래 유지할 사실을 보존하면서 `.wiki/wiki/` 본문을 한국어로 재작성했다. 기술 identifier와 file path는 영어로 유지했고, mobile guide와 current Gluestack UI v4/NativeWind code의 불일치를 open question으로 기록했다.

## [2026-06-20] 구조 | mobile Gluestack styling stack

- 수정:
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `apps/mobile/package.json`
  - `apps/mobile/src/providers.tsx`
  - `apps/mobile/src/components/ui/`
  - `apps/mobile/components/ui/gluestack-ui-provider/`
  - `apps/mobile/global.css`
  - `apps/mobile/tailwind.config.js`
- 요약:
  - Mobile app의 Gluestack UI v4 alpha와 NativeWind setup, provider boundary, semantic-token styling rule을 기록했다.

## [2026-06-20] 문서화 | 초기 프로젝트 snapshot

- 수정:
  - `.wiki/wiki/index.md`
  - `.wiki/wiki/project/overview.md`
  - `.wiki/wiki/architecture/monorepo.md`
  - `.wiki/wiki/architecture/mobile.md`
  - `.wiki/wiki/architecture/watch-app.md`
  - `.wiki/wiki/architecture/supabase.md`
  - `.wiki/wiki/architecture/sync-flow.md`
  - `.wiki/wiki/domains/dive-log.md`
  - `.wiki/wiki/domains/safety-rules.md`
  - `.wiki/wiki/domains/diving-glossary.md`
  - `.wiki/wiki/decisions/adr-index.md`
  - `.wiki/wiki/questions/open-questions.md`
  - `.wiki/wiki/log.md`
- 근거:
  - `AGENTS.md`
  - `README.md`
  - `package.json`
  - `turbo.json`
  - `apps/mobile/package.json`
  - `apps/mobile/README.md`
  - `apps/mobile/src/`
  - `apps/mobile/scripts/ios-build.mjs`
  - `apps/mobile/package.json`
  - `apps/mobile/README.md`
  - `apps/mobile/ios/DiveWatchApp/`
  - `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
  - `packages/contracts/package.json`
  - `packages/contracts/schemas/`
  - `packages/contracts/scripts/`
  - `packages/contracts/generated/`
  - `docs/watch-dive-product-plan.md`
  - `docs/watch-dive-implementation-notes.md`
- 요약:
  - Monorepo, mobile app, watchOS app, contracts/sync flow, absent Supabase layer, dive-log domain model, safety boundary, ADR index state, open question의 첫 wiki snapshot을 추가했다.

## [2026-06-28] ingest | Karpathy wiki migration
- Updated: 위키 운영 방식
- Updated: 프로젝트 개요
- Updated: 구현 우선순위 기록
- Updated: 모바일 로그북 로드맵
- Updated: 모바일 구조
- Updated: Monorepo 구조
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: Watch 앱 구조
- Updated: 다이브 로그 도메인
- Updated: 다이브 계획 도메인
- Updated: 다이빙 용어
- Updated: 안전 규칙
- Updated: Mobile/Watch UI 언어
- Updated: ADR 목록
- Updated: ADR: Local-first mobile logbook with future Supabase sync
- Updated: 열린 질문

## [2026-06-28] ingest | 동기화 흐름 구조
- Updated: planned dive application context delivery
- Updated: planned dive context breakpoint hardening

## [2026-07-09] ingest | 동기화 흐름 구조
- Updated: watch session persistence sanitizer

## [2026-07-09] ingest | 동기화 흐름 구조
- Updated: watch session file storage

## [2026-07-09] ingest | pre-device depth safety sync readiness
- Updated: 구현 우선순위 기록
- Updated: 동기화 흐름 구조
- Updated: Watch 앱 구조
- Updated: 다이브 로그 도메인
- Updated: 안전 규칙
- Updated: Diving App / Scuba Mode
- Updated: Diving App / Non-Negotiable Safety Rules
- Updated: Diving App / Product Roadmap
- Updated: Diving App / QA and Test Plan
- Updated: 다이빙 용어
- Updated: Mobile/Watch UI 언어
- Updated: Diving App / Open Questions
- Updated: 열린 질문

## [2026-07-11] ingest | 동기화 흐름 구조
- Updated: large watch session file transfer

## [2026-07-12] ingest | Watch 앱 구조
- Updated: 안전 규칙

## [2026-07-12] ingest | 구현 우선순위 기록
- Updated: 동기화 흐름 구조
- Updated: 모바일 구조
- Updated: Watch 앱 구조
- Updated: Supabase 구조
- Updated: 모바일 로그북 로드맵
- Updated: 다이브 로그 도메인
- Updated: ADR: Local-first mobile logbook with future Supabase sync
- Updated: Mobile/Watch UI 언어
- Updated: 안전 규칙
- Updated: 열린 질문
## [2026-07-12] ingest | 1Hz 프로파일 파일 저장과 동기화
- Updated: ADR 목록
- Updated: ADR: 1Hz immutable profile과 file-only session sync
- Reliability follow-up: iPhone profile body를 Application Support native file store로 분리하고, activation-gated ACK를 `didFinish userInfoTransfer`까지 durable하게 유지하며, interrupted Watch journal 복구와 실기기 알림 권한 재동기화를 명시했다.
- Updated: Diving App / QA and Test Plan
- Updated: 열린 질문

## [2026-07-13] ingest | Supabase 구조
- Updated: 구현 우선순위 기록
- Updated: 모바일 로그북 로드맵
- Updated: 열린 질문

## [2026-07-18] ingest | Watch underwater runtime lifecycle implementation and device boundary
- Updated: Watch 앱 구조
- Updated: Diving App / QA and Test Plan
- Updated: 열린 질문
- Updated: Knowledge Base Index

## [2026-07-18] ingest | Watch underwater runtime verification review correction
- Updated: Watch 앱 구조
- Updated: Diving App / QA and Test Plan
- Updated: 열린 질문

## [2026-07-18] ingest | Watch live ascent-rate smoothing boundary
- Updated: Watch 앱 구조

## [2026-07-18] ingest | Watch 기록 내구성과 경로 복구 경계
- Updated: Watch 앱 구조

## [2026-07-18] ingest | Watch callback, retry, re-entry, navigation hardening
- Updated: Watch 앱 구조
- Updated: Knowledge Base Index

## [2026-07-20] ingest | Guest data account claim implementation evidence
- Updated: Supabase 구조
- Updated: 모바일 구조
- Updated: 동기화 흐름 구조
- Updated: 다이브 로그 도메인
- Updated: 열린 질문
- Updated: Knowledge Base Index

## [2026-07-20] lint | 1 issues found, 0 auto-fixed

## [2026-07-20] ingest | Guest claim lifecycle boundary correction
- Updated: 프로젝트 개요
- Updated: 구현 우선순위 기록
- Updated: 모바일 로그북 로드맵
- Updated: 모바일 구조
- Updated: 1Hz 프로파일 파일 저장과 동기화
- Updated: Monorepo 구조
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: 다이브 로그 도메인
- Updated: 열린 질문
- Updated: Knowledge Base Index
- Corrected: finalizer는 committed claim rows/profile objects를 보존하고, local manifest는 account publication/readback과 `cleanupPending` cleanup 완료 뒤에만 `committed`가 된다.

## [2026-07-20] lint | 0 issues found, 0 auto-fixed

## [2026-07-20] ingest | Claim profile retention correction
- Updated: Supabase 구조
- Updated: 1Hz 프로파일 파일 저장과 동기화
- Updated: 열린 질문
- Updated: Knowledge Base Index
- Corrected: auth user deletion은 database claim row만 cascade하며 remote Storage profile object cleanup은 account deletion/privileged cleanup 구현 전까지 future release gate다.

## [2026-07-20] ingest | Guest data account claim staging promotion
- Updated: 프로젝트 개요
- Updated: 구현 우선순위 기록
- Updated: 모바일 로그북 로드맵
- Updated: 모바일 구조
- Updated: 1Hz 프로파일 파일 저장과 동기화
- Updated: Monorepo 구조
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: 열린 질문
- Updated: Knowledge Base Index
- Verified: staging `mclvhwzsuvsxjerdouka`에 account-data migrations와 `finalize-guest-claim`을 배포하고 Auth/guest-claim automated verifier를 통과했다. Physical claim과 production 승격은 별도 gate로 남는다.

## [2026-07-20] lint | 0 issues found, 0 auto-fixed

## [2026-07-20] ingest | Guest claim target ID and verifier correction
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: 열린 질문
- Updated: Knowledge Base Index
- Verified: staging finalizer는 같은 local row를 다른 target ID로 확정하지 않으며 verifier는 published payload digest와 해당 rollback을 확인한다.

## [2026-07-20] lint | 0 issues found, 0 auto-fixed

## [2026-07-22] ingest | Mobile claim bootstrap and theme recovery
- Updated: 모바일 구조
- Updated: 동기화 흐름 구조
- Updated: Mobile/Watch UI 언어
- Updated: Knowledge Base Index

## [2026-07-22] ingest | Guest claim profile quarantine
- Updated: 모바일 구조
- Updated: 동기화 흐름 구조
- Updated: 다이브 로그 도메인
- Updated: Knowledge Base Index

## [2026-07-24] ingest | Watch profile digest recovery
- Updated: Mobile architecture
- Updated: Dive log domain

## [2026-07-26] ingest | Device claim live inventory
- Updated: 동기화 흐름 구조

## [2026-07-26] ingest | Home conditions and device inventory performance hardening
- Updated: 동기화 흐름 구조
- Updated: Knowledge Base Index
- Corrected: live guest inventory가 0이면 과거 claim snapshot을 읽지 않으며, 겹친 refresh는 최신 결과만 publish한다.
- Recorded: Home conditions는 locale별 ready cache, in-flight 공유, 병렬 enrichment와 bounded deadline을 사용한다.

## [2026-07-26] ingest | Device inventory checkpoint hint hardening
- Updated: 동기화 흐름 구조
- Updated: Knowledge Base Index
- Corrected: zero-inventory 경로는 full snapshot을 inline으로 읽지 않지만, recoverable hint와 deferred legacy audit로 active transaction 복구를 유지한다.
- Recorded: checkpoint hint는 advisory이며 live count나 authoritative transaction status로 사용하지 않는다.

## [2026-07-26] ingest | Account sync and claim recovery
- Added: Account sync and claim recovery evidence raw source
- Updated: 동기화 흐름 구조
- Updated: Knowledge Base Index
- Corrected: PostgREST timestamp 표현 차이는 timestamp field에만 canonical instant로 비교하며 claim committed readback도 normal remote parser를 재사용한다.
- Corrected: relation UUID와 `/claims/` profile path를 가진 finalized claim row를 generic account hydration이 검증 후 수용한다.
- Corrected: foreground pull은 엄격히 재검증한 unchanged Watch profile cache만 재사용하고 누락·손상 cache는 remote download로 복구한다.
- Recorded: foreground와 explicit refresh는 coalesced remote pull을 수행하고, equivalent historical conflict만 자동 복구하며 divergent conflict는 보존한다.

## [2026-07-26] ingest | Account float roundtrip recovery
- Added: Account float roundtrip recovery evidence raw source
- Updated: 동기화 흐름 구조
- Updated: Knowledge Base Index
- Corrected: Supabase가 반환한 5개 중 Watch row 하나가 binary64 one-ULP 표현 차이로 digest validation에서 격리되어 4개만 보이던 원인을 기록했다.
- Recorded: typed floating summary는 embedded source와 exact neighbor이고 restored payload가 stored SHA-256과 정확히 일치할 때만 복구한다.
- Corrected: one-ULP 호환 범위는 `double precision`인 duration/depth로 제한하고 `integer` rating은 exact comparison을 유지한다.
- Clarified: Home generic recovery는 stale device-import 표시가 아니라 같은 `remoteHydration` 실패였으며 성공한 pull이 matching issue를 해제한다.

## [2026-07-26] lint | 0 issues found, 0 auto-fixed

## [2026-07-26] ingest | React Native profile download recovery
- Added: React Native profile download recovery evidence raw source
- Updated: 동기화 흐름 구조
- Updated: Knowledge Base Index
- Corrected: React Native native `Blob`의 profile bytes는 `FileReader` fallback으로 읽고 global `TextDecoder`가 없으면 RFC 3629와 BOM 동작을 보존하는 strict UTF-8 decoder를 사용한다.
- Verified: remote list 5개와 HTTP 200인 1,585-byte/6-sample profile의 SHA-256·descriptor가 일치했고, correction 뒤 account partition 5개와 native Watch profile 6 samples로 hydrate됐다.
- Clarified: 단일 Watch row의 runtime hydration 실패가 정상 account row 4개 publication 뒤 Home `remoteHydration` 안내를 남겼으며 schema, RLS, integrity contract와 UI는 변경하지 않았다.

## [2026-07-26] ingest | Physical device cold start and data integrity
- Updated: 모바일 구조
- Updated: 동기화 흐름 구조
- Updated: 1Hz 프로파일 파일 저장과 동기화

## [2026-07-26] lint | 0 issues found, 0 auto-fixed

## [2026-07-27] ingest | Account float readback precision recovery

- Added: Account float readback precision recovery evidence raw source
- Updated: 동기화 흐름 구조
- Updated: Knowledge Base Index
- Corrected: typed duration/depth의 REST readback은 one-ULP를 넘더라도 embedded source의 exact 15-significant-digit representation이고 restored payload가 stored SHA-256과 정확히 일치할 때만 복구한다.
- Verified: remote 10개 중 새 Watch row 2개를 격리하던 12/4/11-ULP digest failure를 회귀 테스트로 재현하고 package 70개와 mobile coordinator 80개가 통과했다. Rating과 일반 numeric divergence는 계속 fail-closed다.

## [2026-07-29] ingest | Cross-device guest claim reconciliation

- Added: Cross-device guest claim reconciliation evidence raw source
- Updated: 모바일 구조
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: 열린 질문
- Updated: Knowledge Base Index
- Verified: staging `20260729200000` migration 적용 뒤 equivalent cross-device batch의 canonical-ID 조정과 divergent batch denial verifier가 통과했다.
- Pending: 원래 iPhone의 보존된 15-item batch 물리 retry와 두 번째 retry 중복 방지는 아직 검증하지 않았다.

## [2026-07-29] ingest | Cross-device guest claim final hardening

- Added: Cross-device guest claim final hardening evidence raw source
- Updated: 모바일 구조
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: Knowledge Base Index
- Corrected: mobile은 원래 staged profile receipt와 다른 기기가 먼저 확정한 canonical profile path를 독립 검증하며, 허용된 account log/claim namespace 밖의 경로는 fail closed다.
- Corrected: finalizer wrapper는 batch와 record 뒤 active·soft-deleted canonical candidate를 plan/log 순서와 안정된 ID 순서로 잠그고 active row만 재사용한다.
- Verified: staging `20260729210000` migration 적용 뒤 soft-deleted equivalent collision은 batch를 uploading으로 유지하고 active row를 만들지 않는 hosted verifier를 통과했다. Edge Function source는 바뀌지 않아 재배포하지 않았다.
- Pending: Docker 기반 local DB·Function·실제 2-session concurrency와 원래 iPhone 15-item batch 물리 retry는 아직 검증하지 않았다.

## [2026-07-29] lint | 0 issues found, 0 auto-fixed

## [2026-07-29] ingest | Cross-device guest claim deployment chronology

- Added: Cross-device guest claim deployment chronology raw source
- Updated: 모바일 구조
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: Knowledge Base Index
- Corrected: `20260729200000` 적용 직후에는 Function을 재배포하지 않았고, 이후 commit `fa68f0f`의 guarded command로 unchanged source를 staging에 재배포했으며 `20260729210000`과 `20260729220000` 적용 때는 추가 재배포하지 않은 순서를 기록했다.
- Corrected: finalizer wrapper는 private publication 전후로 active·soft-deleted plan/log candidate를 deterministic order로 잠그고, 두 번째 lock을 보유한 채 payload/profile/relation equivalence를 다시 검증한 뒤 remap한다.
- Verified: local reset, 21 static/contract tests, 109 pgTAP tests, 16 Function checks와 explicit barrier를 사용한 multi-session concurrency 2개 scenario가 통과했다.
- Verified: staging list/dry-run에서 `20260729220000`만 pending임을 확인해 해당 migration만 적용했고 post-list와 hosted guest-claim verifier가 통과했다. Edge Function과 production은 변경하지 않았다.
- Pending: 원래 iPhone의 보존된 15-item batch 물리 retry와 두 번째 retry 중복 방지 관찰은 아직 검증하지 않았다.

## [2026-07-29] lint | 0 issues found, 0 auto-fixed

## [2026-08-02] ingest | Mobile-authoritative Watch log deletion implementation and physical verification
- Added: Mobile-authoritative Watch log deletion implementation and physical verification raw source
- Updated: 모바일 구조
- Updated: Supabase 구조
- Updated: 동기화 흐름 구조
- Updated: Watch 앱 구조
- Updated: 다이브 로그 도메인
- Updated: Knowledge Base Index
- Verified: 로그인 전 생성한 Watch log가 로그인 뒤 기기 가져오기 1개와 `1/1` progress로 처리됐고, 모바일 삭제 후 Watch session도 제거됐다.
- Verified: Guest 삭제 ACK가 native pending queue를 정리했고 양쪽 앱 재실행 뒤 삭제 session이 부활하지 않았다.
- Recorded: Background transfer outstanding은 reachable `sendMessage`를 막지 않으며 paired-Watch state change도 durable deletion queue를 flush한다.
- Recorded: Release는 staging Auth를 차단하고, physical Debug 검증은 feature Metro를 별도 포트와 explicit `RCT_jsLocation`으로 고정해야 다른 worktree JS와 섞이지 않는다.

## [2026-08-02] lint | 0 issues found, 0 auto-fixed

## [2026-08-02] ingest | Safety stop rearm after redescent
- Added: Safety stop rearm after redescent raw source
- Updated: Diving App / Scuba Mode
- Updated: Knowledge Base Index
- Recorded: completed 권장 스탑 뒤 현재 수심이 10m에 다시 도달하면 같은 recording에서 180초 리마인더를 재무장한다.
- Clarified: 이 동작은 감압·조직 포화 계산이 아닌 고정 리마인더 규칙이며 기존 completed/armed contract를 재사용한다.

## [2026-08-02] ingest | 개인정보 최소화 Mobile/Watch 진단 설계
- Added: 개인정보 최소화 모바일·Watch 진단 결정 raw source
- Added: ADR: 개인정보 최소화 device-local 진단 파이프라인
- Updated: ADR 목록
- Updated: 구현 우선순위 기록
- Updated: 열린 질문
- Updated: Knowledge Base Index
- Recorded: 모든 build의 진단 journal에서 계정·Auth·위치·사용자 콘텐츠·다이빙 수치와 원본 payload를 제외한다.
- Recorded: 1단계는 Watch 3일/1MB와 iPhone 14일/10MB local journal, 전용 Watch diagnostic transfer/ACK, 고정 분류 incident marker, 수동 JSONL export와 cross-device purge다.
- Pending: 공통 schema와 journal 구현, paired-device background/reconnect/retention/purge 검증, 원격 provider·동의·privacy policy·native crash 수집은 아직 완료되지 않았다.

## [2026-09-01] ingest | Watch Wet Ready and automatic local save
- Added: Watch Wet Ready and automatic local save raw source
- Updated: Watch 앱 구조
- Updated: Diving App / QA and Test Plan
- Updated: Knowledge Base Index
- Recorded: 물 감지 뒤 Wet Ready에서 Crown으로 Freedive/Scuba를 선택하고 watchOS runtime adoption 순간 mode와 plan을 고정한다.
- Recorded: sample이 있는 real completion은 Watch local save 성공 뒤에만 Saved summary를 표시하며 실패 시 같은 local session ID를 유지해 재시도한다.
- Clarified: app-local 1m/3m/30초 start trigger와 active-session mode change, wet post-dive metadata 입력, immediate delete는 구현하지 않는다.
- Pending: physical Water Lock Crown focus, actual When Submerged ordering, touchless save, forced save-retry는 지원 hardware evidence가 필요하다.

## [2026-09-01] lint | 0 issues found, 0 auto-fixed

## [2026-10-21] ingest | 2026-10-21 프로젝트 리뷰 후속 수정 경계
- Added: 2026-10-21 프로젝트 리뷰 후속 수정 경계 raw source
- Updated: Watch 앱 구조
- Updated: 동기화 흐름 구조
- Updated: 모바일 구조
- Updated: Mobile/Watch UI 언어
- Updated: 안전 규칙
- Updated: 열린 질문
- Updated: Knowledge Base Index
- Recorded: 실시간 수심은 유효 sample이 5초 안에 있을 때만 숫자로 보이고, sensor 범위 초과·30초 넘는 공백 기록의 권장 스탑은 `unknown`이다.
- Recorded: 저장 상승 속도는 실시간과 같은 estimator로 계산하고(2026-07-18 결정 변경), 권장 스탑은 sample 간격마다 최대 5초만 적립하며, 수온은 60초 이내 값만 붙인다.
- Recorded: `captureMode` 없는 옛 기록은 demo로 읽고, demo 기록은 계획을 실행됨으로 표시하지 않으며, Action Button 종료는 `notSubmerged`에서만 허용한다.
- Recorded: Auth는 `SIGNED_OUT`에서만 로컬 세션을 닫고, 충돌 배너·삭제 충돌·원격 삭제 전파와 claim 오류 status 분류 규칙을 정했다.
- Clarified: 안전 규칙의 Home 3m 자동 시작 설명은 2026-09-01 Wet Ready 도입으로 대체된 내용이라 바로잡았다.
- Pending: Watch 체크리스트 D14-D19와 claim 체크리스트의 2026-10-21 항목은 실기기·staging 증거가 필요하다.


## [2026-10-22] ingest | 2026-10-22 성능 정리와 플랫폼 중립 Watch link 경계
- Added: 2026-10-22 성능 정리와 플랫폼 중립 Watch link 경계 raw source
- Added: ADR: 플랫폼 중립 Watch link
- Updated: 모바일 구조
- Updated: 동기화 흐름 구조
- Updated: Watch 앱 구조
- Updated: 1Hz 프로파일 파일 저장과 동기화
- Updated: ADR 목록
- Updated: Knowledge Base Index
- Recorded: 모바일 앱 코드는 `WatchLink` 인터페이스로만 watch와 통신하고 메시지 규격은 `docs/architecture/watch-link-protocol.md`에 둔다.
- Recorded: durable JSON은 journal 없이 원자적 단일 key 쓰기와 readback을 쓰고, 이전 build의 journal은 한 번만 마무리한다. 저장 text가 같으면 검증 결과를 재사용한다.
- Recorded: claim sidecar 내용 검증은 입력별로 재사용하고, canonical JSON 출력 bytes는 바꾸지 않는다.
- Recorded: Watch journal은 열어 둔 채 쓰고 10 sample마다 flush하며, 실패 뒤 디스크에서 다시 읽어 잘린 줄과 중복 재시도를 처리한다.
- Pending: claim snapshot 첫 검증 비용, preview sample 중복, Watch 저장 직전 화면 갱신, envelope의 contract schema화는 남은 일이다.

## [2026-10-22] ingest | 2026-10-22 로그북 페이지 로딩, 저장 형식 정리, 폰-워치 메시지 contract
- Added: 2026-10-22 로그북 페이지 로딩, 저장 형식 정리, 폰-워치 메시지 contract raw source
- Updated: 모바일 구조
- Updated: 동기화 흐름 구조
- Updated: Watch 앱 구조
- Updated: Monorepo 구조
- Updated: ADR: 플랫폼 중립 Watch link
- Updated: Knowledge Base Index
- Recorded: account hydrate는 원격 행을 페이지마다 바로 적용하고 목록을 갱신하며, 모든 원격 행을 로컬에 저장하는 구조는 유지한다.
- Recorded: 로그북은 고정 헤더 아래 목록만 스크롤하고 20개씩 이어서 보이며, 전체 개수와 클라우드 로딩 상태를 보이고, 탭 재선택은 맨 위로 이동한다.
- Recorded: 로그북 schema 4는 같은 미리보기를 한 번만 저장하고, claim은 무관한 삭제 세션에 전체 읽기를 건너뛰며 첫 검증 중 JS thread를 양보한다.
- Recorded: Watch는 다이빙 종료 시 저장 중 화면을 먼저 그린 뒤 저장한다.
- Recorded: 폰-워치 제어 메시지와 계획 다이브는 `packages/contracts` schema가 기준이고 contract test가 보내는 쪽 key 철자를 검사한다.

## [2026-10-22] ingest | 2026-10-22 모바일·워치 UI/UX 개편
- Added: 2026-10-22 모바일·워치 UI/UX 개편 raw source
- Updated: Mobile/Watch UI 언어
- Updated: Watch 앱 구조
- Updated: 모바일 구조
- Updated: 안전 규칙
- Updated: 다이브 계획 도메인
- Updated: 다이브 로그 도메인
- Updated: Supabase 구조
- Updated: 열린 질문
- Updated: Knowledge Base Index
- Recorded: 화면 문구는 다이버가 자연스럽게 읽는 말로 쓰고 개발자·시스템 용어를 내보내지 않으며 개념 하나에 용어 하나만 쓴다. 압력은 시작 압력·종료 압력·탱크 압력, 워치 조작부는 동작 버튼·수중 잠금이다.
- Recorded: 로딩은 naver-ad-bidder 전략(1초 전 표시 없음, 1초 스켈레톤·spinner, 4초 문구, 10초 재시도, 실제 모양의 정적 스켈레톤, 최소 표시 시간 없음, 재조회는 내용 유지, 버튼·행은 0ms busy와 1초 뒤 spinner)을 따른다.
- Recorded: 결과 배너는 account-data gate 위에 두고 4초 뒤 닫히며 action 없는 결과에만 쓴다. 워치 자동 가져오기 토스트는 다이버가 닫을 때까지 남는다.
- Recorded: 시작 shell은 Auth 확인 동안 guest를 열지 않고, Auth network 단계는 10초로 제한하되 로그아웃하지 않는다. claims·server 시간 초과는 기존 offline 조건(만료 전 저장 세션과 같은 사용자의 membership cache)을 따르고, 동의 확인 실패·시간 초과는 guest로 연다.
- Recorded: 워치 가져오기의 기본 사이트·150 bar·내부 태그는 claim 재사용과 계획 연결 때문에 저장값을 두고 화면과 검색에서만 숨긴다.
- Recorded: `planned` 계획만 워치로 보내고, 상세 워치 행은 그 계획의 현재 버전이 마지막 성공 전송에 있을 때만 전송 요청됨이다.
- Recorded: Apple·Google 로그인 버튼은 같은 50pt pill 한 쌍이고 최근 provider를 먼저 두며 모서리 표시를 단다(2026-07-17 라벨 결정 대체).
- Recorded: Action Button은 단계를 아는 intent 하나로 시작·화면 넘김·물 밖 180초 뒤 종료 화면 종료를 처리한다. 크라운은 실제 기록에서 화면만 넘기고, 자동 전환에는 햅틱이 없으며, 실제 기록은 터치로 끝나지 않는다.
- Clarified: watch-app.md의 `SurfaceEndDiveGate` 설명은 2026-07-27 커밋 `748c515`에서 이미 지워진 코드라 바로잡았고, dive-log.md의 "import는 압력을 만들지 않는다"는 2026-07-05부터 150 bar 기본값을 넣은 코드와 달라 바로잡았다.
- Pending: Ultra Action Button 동작, 수중 잠금 중 크라운, 웻슈트 너머 햅틱, Always-On 갱신, 41/46/49mm 배치, Ultra 모델 식별자, 한국어 watchOS 메뉴 이름, auto-launch 상태 값은 하드웨어 검증이 필요하다. Open-Meteo 이용 조건은 공개 배포 전에 결정해야 한다.

## [2026-10-22] ingest | 구현 우선순위 기록
- Updated: 열린 질문
- Updated: Watch 앱 구조
- Updated: 안전 규칙
- Updated: Diving App / Safety UX and Legal Notes
- Updated: Knowledge Base Index
- Recorded: 워치 UX benchmark·inventory·docs-gap 보고서 요약, 12개 채택 가능 패턴·피할 패턴·원문 URL과 소유자 결정을 `raw/design/2026-10-22-watch-ux-review.md`에 먼저 보존했다.
- Recorded: A(기록 정확성)·B(막힌 흐름)는 소유자가 현재 수정 중이라고 알렸고, D1–D6 기능과 E1–E3 결정을 승인된 백로그로 등록했다. D6는 P0 Wave 2, D1–D5는 Wave 4이며 안전 검토는 Wave 5, E3 계약 결정 뒤 계획 전달 검증은 Wave 1에 연결한다.
- Pending: 상승 속도 표시·센서 이상 알림·계획 수신 확인은 결정 대기다. 북마크 입력 역할·contract와 실제 하드웨어 검증도 완료로 표시하지 않는다. 기존 자동 안전 관련 햅틱 금지와 사실 기록·비인증 경계를 유지한다.

## [2026-10-22] ingest | Watch 앱 구조
- Updated: 1Hz 프로파일 파일 저장과 동기화

## [2026-10-22] ingest | Watch 앱 구조
- Added: 2026-10-22 워치 기록 정확도와 화면 흐름 수정 raw source
- Updated: 다이브 계획 도메인
- Updated: Knowledge Base Index
- Recorded: 커밋 `2df2bd1`·`90d3874`와 현재 코드로 계획값 부재·선택 해제, 실제 저장 실패 후 홈 복귀와 동작 버튼 의미, 실패 안내 배치, 즉시 종료 중 표시·중복 종료 방지, Always-On 이동 제한, 방향 있는 크라운 안내와 번호 있는 재전송 피드백을 확인했다.
- Recorded: 관측 공백의 시작·끝 포함, 권장 스탑의 불확실성 표시, 중단 후 복구 표식과 프리다이빙 라벨 정리를 보완했다. 비인증 보조 경계를 유지하며 실기기 검증 완료를 주장하지 않는다.

## [2026-10-22] ingest | Mobile/Watch UI 언어
- Updated: 기록 화면의 11pt 하한, 짧은 비인증 표식과 전체 문장 유지 위치, 허용 수심 게이지, 종료 안내 위계, 권장 스탑의 총 기록 시간·완료 표식.
- Updated: 저장 목록·상세의 배치, Dynamic Type와 VoiceOver 요약, 작은 화면의 상태·오류 문구 배치.
- Recorded: 사용자 요구사항을 raw에 보존했다. 입력·햅틱·종료 가드는 유지하며 실제 화면 검증과 native build/XCTest 통과는 주장하지 않는다.

## [2026-10-22] ingest | 워치 종류 바꾸기와 가변 게이지
- Added: 2026-10-22 워치 종류 바꾸기·상태 chip·가변 게이지 raw source
- Updated: Watch 앱 구조
- Updated: Mobile/Watch UI 언어
- Updated: Knowledge Base Index
- Recorded: 커밋 `0ea5433`·`509e43d`·`a1e8d9c`로 첫 하강(1 m) 전 Action Button 종류 바꾸기, 바꾸기·종료 화면을 한 순환에 두지 않는 규칙, 취소·재시작 실패 시 runtime 종료와 시작 오류 화면 정리, 크라운의 Live·세부 한정, 프리다이빙 단계 chip의 상태 줄 이동, 하단 안전 영역 사용과 한 줄씩 쌓는 보조 값을 기록했다.
- Recorded: 허용 최대 수심(Ultra 40 m)에 고정했던 게이지 범위를 소유자 요청대로 30 m에서 10 m씩 넓어지는 범위와 권장 스탑 0–10 m로 되돌렸다. 허용 최대 수심은 계속 상한이다.
- Clarified: 첫 구현의 터치 `바꾸기` 버튼은 기록 화면 탭 대상 금지 규칙과 수중 잠금 때문에 쓸 수 없어 지웠다.
- Pending: `기록용 · 인증 장비 아님` 표식을 다이빙 중에도 계속 보일지는 소유자 결정 대기다. 실기기 Action Button 바꾸기, 수중 1 m 판정, 하단 여백과 둥근 모서리, 41/46mm 배치는 검증하지 않았다.

## [2026-10-22] decision | 기록 화면 비인증 표식
- Updated: Mobile/Watch UI 언어
- Updated: Knowledge Base Index
- Updated: 2026-10-22 워치 종류 바꾸기·게이지 raw source에 결정과 후속 수정 추가
- Recorded: 소유자 결정으로 기록 화면의 `기록용 · 인증 장비 아님` 표식을 뺐다. 전체 비인증 문장은 Home, Wet Ready, 저장 요약과 상세에 남고 권장 스탑 문구는 그대로다. 앞선 Pending 항목을 닫는다.
- Recorded: 49mm 홈 최근 기록 배지 줄바꿈 수정과 수중 조작 안내의 종류 바꾸기 문장(커밋 `a2929af`).

## [2026-10-22] ingest | 종류 바꾸기 누르기 안내
- Updated: Mobile/Watch UI 언어
- Recorded: 종류 바꾸기 칩을 `동작 버튼 ▸ …` 형식으로 바꾸고, 누르기 안내에는 누를 대상을 항상 밝힌다는 규칙을 더했다. 동작 버튼 길게 누르기는 Ultra 사이렌이다.

## [2026-10-22] ingest | 실기기 크라운 화면 넘김
- Updated: 2026-10-22 워치 종류 바꾸기·게이지 raw source
- Recorded: 실기기에서 크라운 회전이 화면을 넘기지 못하던 원인(회전값의 소수 변화를 매번 반올림해 0칸 처리)과 누적 칸 계산 수정. 감도와 체감은 실기기 재확인이 필요하다.

## [2026-10-22] decision | 크라운이 모든 기록 화면을 오감
- Updated: Watch 앱 구조
- Recorded: 동작 버튼이 있을 것 같은 기기에서는 크라운이 페이지 점이 보여 주는 모든 화면(종류 바꾸기·종료 포함)을 오가고, 실행은 동작 버튼 누르기로만 한다(소유자 선택 1번). 동작 버튼이 없는 기기는 Live·세부만 오간다. 수중 조작 안내 문구도 맞췄다.

## [2026-10-23] ingest | Mobile/Watch UI 언어
- Added: 2026-10-23 워치 리디자인 Plumb · 측심 raw source(소유자 요청과 결정, D1–D20, C1–C15, 모션 규칙, 구현 커밋, 디자인 캔버스 링크)
- Updated: Watch 앱 구조
- Updated: 안전 규칙
- Updated: 열린 질문
- Updated: Knowledge Base Index
- Recorded: 워치 watchOS 번역을 Plumb 기준으로 다시 썼다. 색 역할(흰 큰 숫자, 앰버는 권장 스탑만, 파랑은 누르기·선택과 `다이빙 중` chip만, 회색 저장 재시도 표시), 수심에 고정된 게이지 그라데이션을 정보로 보는 규칙, 게이지 구성(지시선, 표시선, tide marks, 스탑 띠, 상한선, Always-On 외곽선), 모양 문법, 기록 화면 골격(상태 띠, 아래 칸의 수중 잠금 줄과 D20, 세로 힌트 점, 종료 칩 문구), 모션(다이버 넘김만 이동, 자동 변화는 크로스페이드, P3 보간 예외, 숫자 굴리지 않음, Always-On 정착, 동작 줄이기), Home·Wet Ready·안내·계획·요약·목록·상세 패턴, 실제 로고만·`water.waves` 금지, 문구 C1–C15.
- Superseded: 가로 페이지 점, 파란 큰 숫자, 칩 아래 수중 잠금 안내, 게이지 단색 채움(장식 그라데이션 금지 해석), `가상 수심`·`디지털 크라운으로 수심 조절`, 기록 화면 `시간`·`기록 시간`과 스쿠버 저장 화면 `총 기록 시간`, 워치 300 굵기 허용.
- Recorded: Watch 앱 구조에 `DiveDesignSystem.swift`·`DivePostDive.swift`·`RecordingGaugeGeometry`의 책임과 `RecordingPageModel`·햅틱·guard 불변을 적었다. 안전 규칙에 모션이 안전 상태나 권장 스탑 완료를 알리는 신호가 아니라는 교차 참조를 더했다.
- Clarified: Watch 앱 구조의 프리다이빙 보조 표시명은 `확인된 시간`(`Observed time`)이고(`마지막 확인`은 카탈로그에서 stale), 종료 화면의 큰 글자는 경과 시간이 아니라 종료·저장 안내다. 안전 규칙의 "워치 완료 상태는 회색"은 저장 기록에 한정하고 실시간 완료는 앰버와 체크로 바로잡았다.
- Pending: 리디자인 마지막 단계(시뮬레이터·캔버스 비교, 상태 띠 36/31pt 위치의 40/41/44/46mm 확인)와 실기기 항목(한글 폭, 게이지 따라감, 물속 가독성, Always-On, 크기별 배치, 크라운·동작 버튼, Liquid Glass)은 검증하지 않았다.

## [2026-10-23] ingest | Mobile/Watch UI 언어
- Added: 2026-10-23 워치 Plumb polish 리뷰 raw source(D20·C6·C12·C15 원문과 소유자 수정 요청 14개)
- Updated: Watch 앱 구조
- Updated: Knowledge Base Index
- Recorded: 종료 화면의 수중 잠금 줄은 동작 버튼 힌트가 있는 기기에서만 남고, 없으면 `RecordingHint.showsWaterLockLine(on:)`이 숨긴다. 종료 중 화면은 기록 계기를 30 %로 남기고 그 위에 spinner와 `기록을 종료하고 있습니다.`를 페이드로 올린다(RC-END). 권장 스탑 기록의 한 칸짜리 행은 전체 폭을 쓰고 `시작` | `완료 시각`만 한 줄에 둔다(C6). 한국어 `Divenary` 뒤 조사 앞에는 단어 결합 문자 U+2060을 넣는다.
- Recorded: 구현 커밋 `c57f311`(fix(watch): polish the Plumb redesign after review). 빌드, XCTest(Apple Watch Ultra 3 49mm와 Series 11 42mm 각 442개 통과), 문구 검사, jest(1305개 통과)까지 확인했다. 시작 오류 배너 여백과 종료 중 30 % 계기의 시뮬레이터 캡처는 하지 않았다.

## [2026-10-23] ingest | Mobile/Watch UI 언어
- Added: 2026-10-23 저장 뒤 마무리 로고 뒤집기 결정 raw source(D16a 원문)
- Recorded: 저장 뒤 마무리에서 선 끝을 따라가는 로고만 좌우로 뒤집어 가오리 머리가 진행 방향을 향하게 했다(`LogoRiderHeading`, 원본 로고 기준 머리 방향 약 -120°, 뒤집은 뒤 약 -57°에서 회전). 다른 로고 자리는 원본 방향 그대로다.
- Recorded: Ultra 3 49mm 임시 하네스로 선의 하강·바닥·상승 지점(진행률 0.2, 0.5, 0.8, 1.0)의 로고 방향을 캡처해 확인했다. 실제 애니메이션 속도의 프레임 캡처는 하지 않았다.

## [2026-10-23] ingest | Mobile/Watch UI 언어
- Added: 2026-10-23 모바일 워치 연결 상태와 빈 로그북 수정 raw source(소유자 보고 3건, 원인, 결정)
- Recorded: 설정의 Apple Watch는 연동 + Divenary 설치면 `연결됨`이고 `isReachable`은 보이지 않는다(`지금은 연결되지 않음` 삭제). 연결 기기 페이지 진입과 앱 복귀 때 다시 읽고, `연결 상태 확인`이 끝나면 상태 행이 흐려졌다 돌아오며 VoiceOver가 결과를 읽는다.
- Superseded: 빈 로그북 카드 안의 `기록 작성`·`워치 기록 가져오기` 버튼. 두 action은 머리 줄 버튼이 맡는다.
- Recorded: jest가 `react-native-reanimated/mock`과 `react-native-worklets/src/mock`을 전역으로 쓰게 했고, 테스트 파일 3개의 부분 reanimated stub을 걷어냈다.

## [2026-10-23] ingest | Mobile/Watch UI 언어
- Added: 2026-10-23 모바일 모션 raw source(소유자 요청, M1–M6 결정 요약, 커밋, 시뮬레이터 녹화 확인과 미확인 항목)
- Updated: Knowledge Base Index
- Recorded: `모바일 모션` 절을 새로 두었다. 값은 `src/constants/motion.ts` 한 곳, 누름 0.95(버튼)·0.97(카드 행) spring, 탭 아이콘 한 번 튐, 배너·토스트 8 pt 상승 등장과 흐려지는 퇴장, 첫 불러오기·늦은 블록 180 ms 투명도, 새 로그북 행만 등장, Home 첫 등장 40 ms 간격, 차트 clip 그리기와 뒤집힌 실제 로고(화면 좌표 기울기 + 57°, 22 pt), 동작 줄이기 투명도만, 쓰지 않는 모션.
- Superseded: 공통 원칙의 "누르는 행과 버튼은 `scale(0.95)`로 반응한다". 버튼 0.95, 카드 행 0.97, grouped 행은 배경 강조다.
- Recorded: 구현 커밋 `6ad0496`, `74e6163`, `f9740ff`. 실기기의 움직임 느낌, 동작 줄이기 실제 설정, 워치 가져오기 중 새 행 등장은 확인하지 않았다.

