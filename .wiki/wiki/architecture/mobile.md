# 모바일 구조

Sources: pre-Karpathy wiki page, 2026-06-28; Mobile native reverse geocoder implementation, 2026-07-10; Watch session UI and sync startup fixes, 2026-07-10; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15; Guest data account claim implementation evidence, 2026-07-19; Guest data account claim staging promotion evidence, 2026-07-20; Mobile claim bootstrap and theme recovery, 2026-07-22; Guest claim profile quarantine, 2026-07-22; Watch profile digest recovery and list badges design, 2026-07-24
Raw: [Pre-Karpathy: 모바일 구조](../../raw/architecture/mobile.md); [Mobile native reverse geocoder implementation](../../raw/architecture/2026-07-10-mobile-native-reverse-geocoder.md); [Watch session UI and sync startup fixes](../../raw/architecture/2026-07-10-watch-session-ui-sync-fixes.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md); [Guest data account claim implementation evidence](../../raw/architecture/2026-07-19-guest-data-account-claim-implementation.md); [Guest data account claim staging promotion evidence](../../raw/architecture/2026-07-20-guest-data-account-claim-staging-promotion.md); [Mobile claim bootstrap and theme recovery](../../raw/architecture/2026-07-22-mobile-claim-bootstrap-theme-recovery.md); [Guest claim profile quarantine](../../raw/architecture/2026-07-22-guest-claim-profile-quarantine.md); [Watch profile digest recovery and list badges design](../../raw/architecture/2026-07-24-watch-profile-digest-recovery.md)
Updated: 2026-07-24

## 요약

`apps/mobile`은 watch에서 기록한 레크리에이션 다이빙 로그를 확인하고 모바일에서 수동 로그를 작성하기 위한 bare React Native 앱이며, iPhone app과 embedded watchOS companion target을 함께 소유한다. React Navigation, React Query, principal-partitioned persistent repository, account local-first outbox/sync, resumable guest data claim, generated watch contract, Gluestack UI v4/NativeWind와 Supabase/Auth client 경계를 사용한다. Production cloud backup과 account deletion은 아직 없다.

## 현재 상태

앱 package는 `@repo/mobile`이다. 현재 의존성은 React Native `0.85.3`, React `19.2.3`, TypeScript, Jest, Metro, `react-native-safe-area-context`, `@react-native-async-storage/async-storage`, `@notifee/react-native`, `@repo/supabase`, `react-native-keychain`, native Google/Apple sign-in package, Gluestack UI v4 alpha package, NativeWind, Tailwind CSS, Reanimated, Worklets, React Native SVG를 포함한다. `@supabase/supabase-js`는 mobile이 직접 소유하지 않고 `packages/supabase` 경계 안에 둔다.

주요 source 경계는 다음과 같다.

- `src/App.tsx`: 앱 UI entry.
- `src/providers.tsx`: app-owned `QueryClientProvider`, `SafeAreaProvider`, `AppPreferencesProvider`, `GluestackUIProvider`, render error boundary, `AuthProvider`, `AccountDataProvider`, `StatusBar`. App root가 unmount되면 하위 observer cleanup 뒤 QueryClient cache/timer를 정리한다.
- `src/auth/`: Keychain session adapter, native Google/Apple credential adapter, membership cache, recent-provider preference와 mobile Auth assembly.
- `src/claim/`: immutable guest snapshot/manifest, exact profile-byte verification, resumable claim service와 persistent claim store.
- `src/states/account-data.tsx`: 현재 Auth principal에 맞는 repository publication, account/guest row composition, account sync와 claim lifecycle, user/cache isolation.
- `src/sync/account-outbox.ts`, `src/sync/account-sync-coordinator.ts`: local-first account operation durability, retry와 revision conflict 보존.
- `src/storage/data-principal.ts`, `src/repositories/principal-repositories.ts`: `guest`와 `user:<uuid>` namespace와 principal-bound repository 구성.
- `src/states/auth.tsx`: stored evidence, online claims/user/status 검증, foreground revalidation, bounded offline state와 sign-in concurrency를 관리한다.
- `src/screens/auth`: guest-preserving login과 versioned terms/privacy exact set을 제출하는 non-dismissible onboarding 화면.
- `src/components/navigation/index.tsx`: `@react-navigation/native` 기반 top-level `NavigationContainer`와 custom tab router. 현재 선택된 tab을 다시 누르면 해당 화면을 refresh하고 scroll top을 요청한다. Logbook detail/edit, Plan detail/create/edit, Settings detail은 tab 내부 local route가 아니라 root detail route 상태로 렌더링해 나중에 deep link를 route name과 params로 연결할 수 있게 했다.
- `src/components/ui/`: 재사용 UI primitive, instrument control, session card, profile chart, tone type.
- `components/ui/gluestack-ui-provider/`: generated Gluestack provider, color-mode script, token bridge.
- `global.css`, `tailwind.config.js`: NativeWind/Tailwind entrypoint와 semantic token configuration.
- `src/conditions/home-conditions.ts`: Home 위치 조건을 위한 provider-neutral type, static mock provider, snapshot model.
- `src/conditions/location-service.ts`: `@react-native-community/geolocation`로 foreground 좌표를 얻는다. 이 package는 reverse geocoding이 아니라 좌표 획득을 담당한다.
- `src/conditions/open-meteo-home-conditions-provider.ts`: Open-Meteo weather/marine API adapter. 기온과 해안 수온을 가져오고, 도시명은 repo-local native reverse geocoder 결과를 timezone city보다 우선한다.
- `src/native/reverse-geocoder.ts`: React Native `NativeModules.ReverseGeocoderModule` wrapper. Native module이 없거나 실패하면 `undefined`를 반환해 Open-Meteo timezone fallback을 유지한다.
- `src/notifications/watch-sync-notification-service.ts`: Notifee permission request, local notification display, notification press bootstrap/event mapping을 다루는 watch sync notification 경계.
- `src/screens/home`, `src/screens/logbook`, `src/screens/planning`, `src/screens/settings`: route-level 화면 container. Logbook과 Planning 목록은 root navigation callback이 있으면 detail/editor route를 상위로 위임하고, isolated component test에서는 기존 internal route fallback을 유지한다. Settings의 theme, language, device management도 별도 detail route로 열린다.
- `src/screens/memory`: 이전 memory/share preview source가 남아 있지만 현재 bottom tab route에는 연결되어 있지 않다.
- `src/storage/`: `PersistentKeyValueStore`, AsyncStorage adapter, in-memory test store, versioned JSON store, storage key를 둔다.
- `src/states/app-preferences.tsx`, `src/states/app-preferences-storage.ts`: 앱 표시 선호를 관리하고 `themePreference`, `language`, `watchSyncNotificationsEnabled`를 저장한다.
- `src/states/use-dive-logbook.ts`: React Query 기반 로그북 hook, search filter, pending WatchConnectivity sync action, 기존 화면을 위한 `MobileDiveSession` 호환 view.
- `src/states/use-dive-logbook-queries.ts`: `DiveLogRepository`를 호출하는 list/detail/save/delete/watch import query와 mutation hook.
- `src/states/watch-connectivity-sync.tsx`: iOS native WatchConnectivity payload event를 먼저 구독한 뒤 durable inbox를 drain하고, runtime validator를 통과한 payload만 로그북 repository에 import한다. 저장 성공 payload는 import 완료 acknowledge로 watch에 되돌려 보내고, 무효 payload drop은 native inbox에서만 acknowledge한다. 자동 import로 새 로그가 저장되면 root navigation에 imported entry를 알려 tappable toast를 띄우고, Settings opt-in이 켜진 background/killed 상태에서는 Notifee local notification을 요청할 수 있게 notification service callback을 호출한다.
- `src/states/use-dive-plans.ts`, `src/states/use-dive-plan-queries.ts`: React Query 기반 Planbook hook과 list/save/delete mutation. 실행하지 않은 planned 상태의 모바일 계획을 watch companion에 전달한다.
- `src/native/watch-connectivity.ts`: React Native에서 iOS `WatchConnectivityModule` event, pending drain method, payload acknowledge method, import 완료 acknowledge method, planned dive update, linked watch status query를 typed wrapper로 다룬다.
- `ios/Divenary.xcodeproj`: iPhone app target `Divenary`과 embedded watchOS companion target `DivenaryWatchApp`를 함께 관리한다. iPhone target에는 WatchConnectivity bridge와 `CLGeocoder` 기반 `ReverseGeocoderModule`이 포함된다.
- `ios/Divenary/ReverseGeocoderModule.swift`, `ios/Divenary/ReverseGeocoderModuleBridge.m`: iOS `CoreLocation.CLGeocoder`를 React Native promise method로 노출한다.
- `ios/DivenaryWatchApp`: SwiftUI watchOS companion source. Watch 기록, 로컬 저장, WatchConnectivity enqueue PoC를 담당한다.
- `android/app/src/main/java/com/divemobile/ReverseGeocoderModule.kt`, `ReverseGeocoderPackage.kt`: Android platform `android.location.Geocoder`를 repo-local React Native package로 노출한다. Autolink 대상 npm package가 아니므로 `MainApplication.kt`에서 수동 등록한다.
- `src/repositories/`: `DiveLogRepository`/`DivePlanRepository` 인터페이스, in-memory `LocalDiveLogRepository`/`LocalDivePlanRepository`, AsyncStorage 기반 `PersistentDiveLogRepository`/`PersistentDivePlanRepository`, app default repository export.
- `src/types/dive-log-entry.ts`: 모바일 로그북 항목인 `DiveLogEntry`와 source/provenance/sync status type.
- `src/types/dive-plan.ts`: 모바일 계획 항목인 `DivePlan`, `DivePlanStatus`, `DiveEntryStyle`, 계획값, checklist type.
- `src/types/dive-session.ts`: generated watch contract type 기반 compatibility type.
- `src/utils/`: formatter, watch fixture 가져오기, 세션 summary 계산.

## 상세

현재 모바일 UI는 네 영역으로 구성된다.

- Home: 위치 권한이 허용되면 device 좌표를 얻고, Open-Meteo provider로 local time, 기온, 해안 수온을 가져온다. 도시명은 iOS `CLGeocoder` 또는 Android `Geocoder` 기반 repo-local native module 결과를 우선 사용하고, native module이 없거나 실패하면 Open-Meteo timezone city로 fallback한다. 이 band는 dive suitability, tide/current/weather warning, route planning, safety recommendation을 제공하지 않는다.
- Logbook: manual/watch 로그 목록, 검색, 수동 로그 작성과 수정, watch sync action, dive mode별 입력 section, 상세 지표, provenance 표시, 수심 profile, 수온 profile, notes, tags. 로그인 후 account row와 claim에서 defer/retained 된 guest row를 함께 합성하며 같은 `localId`에서는 account copy를 우선한다. 로그인 중 `ownerUserId`가 없는 예외 row만 `이 기기에만 저장` warning 배지를 보이고 account row와 signed-out guest 목록에는 저장 위치 배지를 붙이지 않는다. Watch `captureMode: 'demo'`는 저장 위치와 독립적으로 `데모` 배지를 보일 수 있다.
- Planning: persistent Planbook으로 다음 다이브 계획을 작성, 수정, 완료하고 완료된 계획에서 Logbook 초안을 열 수 있다. 로그인 후 account 계획과 defer된 guest 계획을 같은 흐름으로 합성하며, `ownerUserId`가 없는 예외 계획 행과 active plan panel에만 `이 기기에만 저장` 배지를 표시한다.
- Settings: 테마, 언어, watch sync notification opt-in 같은 앱 표시 선호와 paired watch 상태를 grouped list로 관리한다.

Settings는 현재 다음 범위로 제한된다.

- 테마 선호는 `system`, `light`, `dark`를 지원한다. `system`은 device color scheme이 `dark`일 때만 dark mode로 해석하고, 그 외에는 light mode로 해석한다.
- `AppPreferencesProvider`가 `resolvedTheme`을 계산하지만 Gluestack/NativeWind override에는 저장된 `themePreference` 자체를 전달한다. `system`으로 돌아가면 manual override를 해제하고, `resolvedTheme`은 `StatusBar`와 React Navigation의 light/dark base를 정하는 데만 사용한다. Navigation과 native form sheet의 uncovered area는 semantic background를 명시한다.
- 언어 선호는 `ko`, `en`만 지원한다. 선택 변경은 `i18next.changeLanguage`를 사용하며, 실패하면 이전 언어 상태를 유지한다.
- 설정 값 중 `themePreference`, `language`, `watchSyncNotificationsEnabled`는 AsyncStorage 기반 versioned JSON store에 저장된다. `resolvedTheme`은 저장하지 않고 device color scheme과 `themePreference`에서 파생한다.
- Watch sync notification은 사용자가 켤 때 Notifee permission을 요청한다. Permission이 거부되면 preference를 켜지 않고, foreground import toast와 repository import는 계속 동작한다. 알림 문구는 local repository 저장 결과만 뜻하며 cloud upload나 Supabase sync를 의미하지 않는다.
- 기기 관리는 iOS `WCSession`의 공개 상태인 지원 여부, paired 여부, watch app 설치 여부, reachable 여부를 보여준다. 공개 WatchConnectivity API는 사용자가 설정한 Apple Watch 이름을 제공하지 않으므로 native layer가 이름을 줄 수 없는 경우 `Apple Watch` fallback을 표시한다.
- 계정 영역은 환경이 구성되지 않으면 guest/local-only 상태를 설명한다. 구성된 빌드에서는 사용 가능한 native Google/Apple provider만 표시하고, identity 이후 current terms/privacy 동의가 완료되기 전에는 onboarding route를 벗어날 수 없다. Guest claim은 로그인 자체와 분리된 명시적 선택이며, claim 또는 기기에 유지 결정을 내리기 전 source data를 삭제하지 않는다.

Styling rule은 현재 코드 기준으로 다음과 같다.

- `className`과 semantic token을 우선 사용한다. 예: `bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `border-border`, `text-muted-foreground`, `bg-primary`, `bg-secondary`, `bg-accent`, `bg-destructive`.
- 재사용 component 상태와 tone variant에는 local `tva` variant를 사용한다.
- Inline `style`은 safe-area inset, chart bar height, pressed-state transform처럼 runtime value가 필요한 경우로 제한한다.
- Mobile UI code에 raw hex color, numbered gray/slate/neutral palette, `typography-*` token, opacity utility를 다시 늘리지 않는다.

앱 기본 Logbook/Planbook 저장소는 principal namespace에 묶인 persistent repository다. Legacy unscoped data는 durable migration lock 아래 한 번만 guest namespace로 복사·검증한 뒤 source를 제거한다. Account mutation은 local repository 저장과 durable outbox enqueue를 먼저 완료하고, coordinator가 remote revision을 확인해 재시도하거나 conflict를 보존한다. `LocalDiveLogRepository`와 `LocalDivePlanRepository`는 테스트와 집중된 동작 검증용으로 남아 있다.

Account-data bootstrap은 `loading`, `ready`, `degraded`, `recoveryRequired`를 구분한다. 선택된 principal의 local repositories를 먼저 publish한 뒤 claim inspection, outbox reconciliation, remote hydrate/drain을 수행한다. Optional 단계 실패는 이미 공개한 로컬 데이터를 철회하지 않고 Home recovery banner에서 재시도하게 한다. 선택된 principal의 local repository 구성 자체가 실패하면 다른 principal로 fallback하지 않고 preserve-data recovery screen을 표시한다. 예상하지 못한 render error도 같은 비파괴적 recovery screen으로 전환한다.

Watch import는 `localSessionId`와 `endedAt` 기반 `importKey`로 deduplicate하고, 기존 manual/mobile field와 `importedAt`을 보존하며, watch capture와 sync status를 최신 payload로 갱신한다. 결과는 watch 시작 시간, 수동 입력 시작 시간, 생성 시간 기준으로 최신 항목이 먼저 오도록 정렬한다. Persistent 저장소와 in-memory 저장소는 같은 clone, sort, watch merge helper를 사용해 이 동작을 맞춘다.

WatchConnectivity 수신 PoC는 iOS native code에서 시작된다. Native inbox와 module은 pending payload, event, acknowledge, planned dive, linked watch 상태를 관리한다. JS provider와 Logbook 수동 action은 같은 `WatchConnectivityImportCoordinator`를 사용해 concurrent import를 직렬화한다. 저장이 끝난 payload만 imported acknowledge하고 실패 payload는 재시도할 수 있게 남긴다. Foreground toast와 opt-in notification은 local 저장 결과만 뜻한다.

Guest 수동 로그는 `source: 'manual'`, `cloudSyncStatus: 'notConfigured'`로 저장한다. Account mutation은 outbox 상태에 맞춰 cloud status를 전이한다. 비어 있거나 유효하지 않은 수치 field는 `undefined`로 유지한다. Watch 기반 항목을 수정하면 raw watch capture와 `source: 'watch'`를 유지한다. Raw `watchCapture.session.syncStatus`는 Watch 전송 provenance이고 top-level `cloudSyncStatus`와 별개다.

Guest data claim은 현재 guest Logbook/Planbook과 전체 profile bytes를 immutable snapshot/manifest로 먼저 보존한다. 관계와 profile bytes/digest/sample count를 원격 batch 생성 전에 검사한다. 실패 snapshot은 digest-covered manifest 밖의 strict optional detail에 `checking`/`uploading`/`finalizing`/`cleanup` phase와 bounded item id/label만 보존하며 payload나 profile bytes를 진단 정보에 복제하지 않는다. 각 항목의 원격 write/readback과 검증이 끝난 뒤에만 진행 수를 올린다. 전체 batch의 remote finalize와 committed readback을 검증한 뒤 이미 commit된 snapshot을 base account local repository에 `synced` copy로 직접 publish/readback하고, 그 다음 `cleanupPending`을 저장한다. Snapshot과 같은 guest row는 exact delete하고, snapshot 뒤 바뀐 row는 normal account local-first/outbox에 `pending` update로 저장·readback한 뒤 guest copy를 삭제한다. 이 local cleanup이 모두 끝나야 manifest를 `committed`로 저장하며 중단되면 `cleanupPending`에서 재개한다. Deferred guest data의 기본 합성은 account-copy-wins다. User generation과 principal-scoped cache key는 이전 account callback이 새 account 상태를 publish하지 못하게 한다.

Claim 선택/진행 화면은 로그인 뒤 native form sheet로 통합됐다. 준비, 항목별 진행, finalizing, cleanup, 실패 상태가 모두 비어 있지 않은 내용을 렌더링한다. 확인할 수 없는 watch profile 항목은 정상 항목과 분리해 guest에 보류하고, 부분 완료는 가져온 수와 기기에 유지한 수를 함께 보여준다. Retained-only 결과는 자동 반복하지 않으며 Settings에서만 명시적으로 다시 검사한다. Settings는 owned account의 eligible/running/failed/deferred/retained 상태를 online/offline에서도 다시 열 수 있고, Home은 degraded bootstrap 또는 failed/deferred claim에 compact recovery banner 하나를 표시한다. 항목별 remote write/readback 뒤 정확한 진행 count와 progress bar를 갱신하고, Reduce Motion과 screen reader progress value를 지원한다. Hosted staging automated verifier는 통과했지만 이 partial claim의 iPhone/Android 실기기 검증과 background/force-quit resume는 아직 확인하지 않았다.

앱 기본 Planbook 저장소는 `PersistentDivePlanRepository`다. 이 저장소는 `DivePlan[]`를 `dive-app:planbook:v2` key에 저장하고, `LocalDivePlanRepository`와 같은 계획 정렬 helper를 사용한다. v2 key는 two-mode reset을 위해 기존 local v1 Planbook data와 분리한다. 계획 화면은 `draft`, `planned`, `completed` 상태만 사용하고, 새로 선택 가능한 `diveMode`는 scuba와 freedive 두 가지다. 완료로 전환할 때 Logbook 초안을 만들지 나중에 할지 선택하게 한다. 계획에서 로그를 만들 때는 navigation 계층이 임시 `pendingDraft`를 Logbook editor로 넘기며, 자동으로 완료 로그를 저장하지 않는다. `planned` 상태이고 아직 로그로 전환되지 않은 계획은 `watchPlannedDives` envelope로 watch companion에 전달되어 watch Home에서 선택한 뒤 시작할 수 있다.

Home/Memory 같은 preview surface와 summary helper도 알 수 없는 duration/depth를 실제 `0`으로 집계하지 않는다. Manual log에 duration만 있고 `endedAt`이 없으면 compatibility `MobileDiveSession`에서 `endedAt`을 파생해 기존 preview가 입력된 duration을 표시할 수 있게 한다.

상세 화면은 manual value와 watch-captured value의 provenance를 표시한다. Watch 측정값은 raw `WatchSession`과 별도로 보존되며, 사용자가 수동으로 입력한 값과 같은 방식으로 보이지 않게 한다. 문구는 review/logging 범위에 머물고 인증된 dive computer 표현을 쓰지 않는다.

현재 제한은 다음과 같다.

- Stable App ID, staging provider/legal verifier와 signed entitlement 기반은 준비됐다. 사용자는 physical iPhone에서 Apple login 성공을 확인했지만 Google physical login, re-consent와 session restore는 아직 검증되지 않았다. Local `.invalid` legal URL은 fixture다.
- Supabase remote Logbook/Planbook schema, private profile Storage 경계, principal partition, outbox/conflict와 guest claim service는 구현됐고 hosted staging migration/Edge Function automated verifier를 통과했다. Physical claim은 아직 검증되지 않았다.
- Production Supabase, production legal documents와 앱 내 즉시 영구 account deletion은 후속이다. 이 gate 전에는 release하지 않는다.
- Direct SQL 없음.
- WatchConnectivity code boundary, companion embed 구조, durable native inbox, JS acknowledge 경로, Logbook import action의 pending inbox drain, mobile-to-watch planned dive 전달, linked watch status 표시, Notifee notification opt-in 경계가 있지만 paired-device delivery, entitlement, background delivery, retry/backoff policy, background/killed notification 표시 검증은 아직 없음.
- Home city label은 native reverse geocoder 결과가 우선이지만, 실제 표시 품질은 platform geocoder backend와 locale에 의존한다. Native module 실패, Android `Geocoder.isPresent()` false, geocoder 빈 결과에서는 Open-Meteo timezone city로 fallback할 수 있으며, 이 경우 광역 timezone city인 `Seoul`처럼 보일 수 있다.
- 공개 API 한계로 Settings의 watch name은 사용자가 Watch 앱에서 지정한 이름이 아니라 `Apple Watch` fallback일 수 있다.
- Logbook/Planbook AsyncStorage key는 two-mode reset을 위해 v2 namespace를 사용한다. App preferences store는 version 1 envelope에 `watchSyncNotificationsEnabled`를 추가하고, 누락된 legacy 값은 `false`로 normalize한다. 향후 schema 변경에는 migration behavior를 추가해야 한다.
- Certified dive-computer behavior 없음.

최근 반영된 모바일 변경은 다음과 같다.

- Watch sync notification: Notifee를 사용하고 Settings에서 사용자가 켤 때 permission을 요청한다. Watch payload가 local repository에 저장된 뒤에만 알림을 요청하며, foreground에서는 사용자가 닫기 전까지 유지되는 toast를 사용한다. 이 알림은 Supabase나 cloud sync 완료를 뜻하지 않는다.
- Two-mode dive UX: Logbook과 Planning은 `scuba`와 `freedive`만 새로 만들 수 있다. 기존 local v1 Logbook/Planbook 데이터는 v2 key reset으로 분리됐다.
- Home location conditions: Home 상단에 위치 기반 시간, 도시명, 기온, 해안 수온을 표시할 provider-neutral interface와 UI가 있다. 기본 provider는 Open-Meteo weather/marine API를 사용하고, 도시명은 repo-local iOS/Android native reverse geocoder module을 우선 사용한다. 새 npm native dependency는 추가하지 않았다.

iOS project는 `apps/mobile/ios/Divenary.xcworkspace`와 `apps/mobile/ios/Divenary.xcodeproj`에 있다. Full iPhone app build는 CocoaPods workspace를 사용하고, watch-only CLI build는 `Divenary.xcodeproj`의 `DivenaryWatchApp` scheme을 사용한다. Android native project file은 `apps/mobile/android` 아래에 있다.

## 관련 문서

- [동기화 흐름 구조](sync-flow.md)
- [Supabase 구조](supabase.md)
- [다이브 로그 도메인](../domains/dive-log.md)
- [안전 규칙](../domains/safety-rules.md)
- [Mobile/Watch UI 언어](../design/mobile-watch-ui-language.md)
