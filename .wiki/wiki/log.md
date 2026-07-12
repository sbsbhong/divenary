# Wiki Log

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
