# 모바일 구조

Sources: pre-Karpathy wiki page, 2026-06-28; Mobile native reverse geocoder implementation, 2026-07-10; Watch session UI and sync startup fixes, 2026-07-10; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15; Guest data account claim implementation evidence, 2026-07-19; Guest data account claim staging promotion evidence, 2026-07-20; Mobile claim bootstrap and theme recovery, 2026-07-22; Guest claim profile quarantine, 2026-07-22; Watch profile digest recovery and list badges design, 2026-07-24; Physical device cold start and data integrity, 2026-07-26; Local log import performance and reliability evidence, 2026-07-28; Local log import review hardening evidence, 2026-07-28; Cross-device guest claim reconciliation evidence, 2026-07-29; Cross-device guest claim final hardening evidence, 2026-07-29; Cross-device guest claim deployment chronology, 2026-07-29
Raw: [Pre-Karpathy: 모바일 구조](../../raw/architecture/mobile.md); [Mobile native reverse geocoder implementation](../../raw/architecture/2026-07-10-mobile-native-reverse-geocoder.md); [Watch session UI and sync startup fixes](../../raw/architecture/2026-07-10-watch-session-ui-sync-fixes.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md); [Guest data account claim implementation evidence](../../raw/architecture/2026-07-19-guest-data-account-claim-implementation.md); [Guest data account claim staging promotion evidence](../../raw/architecture/2026-07-20-guest-data-account-claim-staging-promotion.md); [Mobile claim bootstrap and theme recovery](../../raw/architecture/2026-07-22-mobile-claim-bootstrap-theme-recovery.md); [Guest claim profile quarantine](../../raw/architecture/2026-07-22-guest-claim-profile-quarantine.md); [Watch profile digest recovery and list badges design](../../raw/architecture/2026-07-24-watch-profile-digest-recovery.md); [Physical device cold start and data integrity](../../raw/architecture/2026-07-26-physical-device-cold-start-data-integrity.md); [Local log import performance and reliability evidence](../../raw/architecture/2026-07-28-local-log-import-reliability.md); [Local log import review hardening evidence](../../raw/architecture/2026-07-28-local-log-import-review-hardening.md); [Cross-device guest claim reconciliation evidence](../../raw/architecture/2026-07-29-cross-device-guest-claim-reconciliation.md); [Cross-device guest claim final hardening evidence](../../raw/architecture/2026-07-29-cross-device-guest-claim-final-hardening.md); [Cross-device guest claim deployment chronology](../../raw/architecture/2026-07-29-cross-device-guest-claim-deployment-chronology.md)
Sources: Guest claim semantic canonical reuse evidence, 2026-07-30
Raw: [Guest claim semantic canonical reuse evidence](../../raw/architecture/2026-07-30-guest-claim-semantic-canonical-reuse.md)
Sources: Guest claim semantic canonical reuse staging promotion evidence, 2026-07-30
Raw: [Guest claim semantic canonical reuse staging promotion evidence](../../raw/architecture/2026-07-30-guest-claim-semantic-canonical-reuse-staging.md)
Sources: 2026-10-22 성능 정리와 플랫폼 중립 Watch link 경계, 2026-10-22
Raw: [2026-10-22 성능 정리와 플랫폼 중립 Watch link 경계](../../raw/architecture/2026-10-22-performance-and-watch-link-boundary.md)
Sources: Guest claim semantic canonical reuse physical verification evidence, 2026-07-30
Raw: [Guest claim semantic canonical reuse physical verification evidence](../../raw/architecture/2026-07-30-guest-claim-semantic-canonical-reuse-physical-verification.md)
Sources: Mobile-authoritative Watch log deletion implementation and physical verification, 2026-08-02
Raw: [Mobile-authoritative Watch log deletion implementation and physical verification](../../raw/architecture/2026-08-02-mobile-authoritative-watch-log-deletion.md)
Sources: 2026-10-21 프로젝트 리뷰 후속 수정 경계, 2026-10-21
Raw: [2026-10-21 프로젝트 리뷰 후속 수정 경계](../../raw/architecture/2026-10-21-review-remediation.md)
Sources: 2026-10-22 로그북 페이지 로딩, 저장 형식 정리, 폰-워치 메시지 contract, 2026-10-22
Raw: [2026-10-22 로그북 페이지 로딩, 저장 형식 정리, 폰-워치 메시지 contract](../../raw/architecture/2026-10-22-logbook-paging-and-contract-messages.md)
Sources: 2026-10-22 모바일·워치 UI/UX 개편, 2026-10-22
Raw: [2026-10-22 모바일·워치 UI/UX 개편](../../raw/design/2026-10-22-ui-ux-overhaul.md)
Updated: 2026-10-22

## 요약

`apps/mobile`은 watch에서 기록한 레크리에이션 다이빙 로그를 확인하고 모바일에서 수동 로그를 작성하기 위한 bare React Native 앱이며, iPhone app과 embedded watchOS companion target을 함께 소유한다. React Navigation, React Query, principal-partitioned persistent repository, account local-first outbox/sync, resumable guest data claim, generated watch contract, Gluestack UI v4/NativeWind와 Supabase/Auth client 경계를 사용한다. Durable Logbook/Planbook은 fail-closed로 읽고, 자동 Watch drain과 account hydration은 로컬 화면 공개와 첫 상호작용 뒤에 시작한다. Watch full profile과 claim profile evidence는 metadata envelope 밖 파일 sidecar에 둔다. Production cloud backup과 account deletion은 아직 없다.

모바일은 Watch 로그 삭제의 유일한 사용자 조작 지점이다. `src/deletion/`은 `localSessionId` 기반 device-wide 묘비와 삭제 coordinator를 소유한다. 묘비 readback이 repository delete보다 먼저 끝나야 하며, 이후 실패가 있어도 화면·import·hydration에서 해당 session을 다시 게시하지 않는다. 수동 로그 삭제는 Watch command를 만들지 않는다.

## 2026-10-21 리뷰 후속 경계

- Auth 구독은 event를 함께 전달하고, 로컬 세션은 `SIGNED_OUT`일 때만 닫는다. 만료 세션을 오프라인에서 갱신하지 못한 null `INITIAL_SESSION`은 복원 흐름에 맡겨 guest로 바꾸지 않는다. signOut이 실패하면 Keychain 세션을 직접 지운다.
- `isPrincipalSettled`(guest, authenticated, authenticatedOffline)가 참이 된 뒤에만 Watch payload 구독·drain과 계획 전송을 시작하고, 계획 목록을 처음 읽기 전에는 Watch로 보내지 않는다.
- 로그·계획 삭제는 `confirmDestructiveAction` 시스템 Alert로 확인하고, root editor route는 `usePreventRemove`로 저장하지 않은 변경 폐기를 확인한다.
- 형식이 맞지 않거나 세 번 연속 import에 실패한 Watch payload는 `watch-rejected-payload-store`에 세션 ID·사유·시각만 남기고 Settings 기기 화면에 보인다.
- 충돌 행은 상세 화면 `SyncConflictBanner`에서 해결하고, 원격 삭제 전파와 삭제 충돌 규칙은 [동기화 흐름 구조](sync-flow.md)를 따른다.
- Home, 상태 색, 목록 상태, 접근성, 폼 검증 번역 규칙은 [Mobile/Watch UI 언어](../design/mobile-watch-ui-language.md)에 정리했다.

## 2026-10-22 UI/UX 개편 경계

화면 모양, 문구, 로딩 표시 규칙은 [Mobile/Watch UI 언어](../design/mobile-watch-ui-language.md)에 두고, 여기에는 구조와 동작 경계만 적는다.

- 로딩 피드백의 공유 코드는 `src/constants/async-feedback.ts`(`ASYNC_FEEDBACK_TIMING` 1초/4초/10초, `CONTENT_LOADING_FEEDBACK`), `src/hooks/use-loading-feedback.ts`(`useLoadingFeedback`), `src/components/ui/skeleton-block.tsx`(`SkeletonBlock`, `useContentLoading`), `src/components/ui/detail-skeleton.tsx`다. 버튼·행·목록 오류 카드의 진행 상태는 `InstrumentButton` `pending`, grouped-list `Row` `pending`, `ListStateCard` `actionPending`으로 표시한다. React Query 기본값은 `retry: 1`이라 두 번째 실패에서 오류와 다시 시도를 보인다.
- 결과 배너 host `AppFeedbackProvider`는 `AuthProvider` 안, `AccountDataProvider` 위에 둔다. 로그인·로그아웃으로 데이터 소유자가 바뀌면 `AccountDataProvider`가 navigation 전체를 시작 shell로 바꾸므로, 그 아래 두면 배너가 함께 사라진다. 배너는 `APP_FEEDBACK_DISMISS_MS`(4초) 뒤 닫히고 action이 없는 결과에만 쓴다. 같은 위치의 `SignInFeedback`이 Auth 상태가 로그인 진행 상태에서 `authenticated`로 바뀔 때 로그인 배너를 한 번 띄우며, `bootstrapping`에서 온 세션 복원은 알리지 않는다. 로그북의 워치 기록 가져오기 결과도 이 배너다. 워치 자동 가져오기 토스트는 `기록 보기` action이 있어 다이버가 닫을 때까지 남고, navigation이 토스트 높이를 재서 배너를 그 위에 둔다.
- 시작 shell: Auth가 `bootstrapping`인 동안 account-data는 principal을 공개하지 않고 `RecoveryScreen kind="loading"`을 유지한다. 로그인된 사용자가 앱을 열 때 guest 기록이 잠깐 보이지 않게 하기 위해서다. shell은 기다리기 시작한 시각(`waitStartedAt`)부터 1초 indicator, 4초 문구, 10초 오래 걸린다는 문구를 보이고, Auth 확인이 끝난 뒤에는 10초에 `retryBootstrap`에 연결된 다시 시도 하나를 보인다. Auth 확인 중에는 다시 시작할 시도가 없어 문구만 보이며, 아래 Auth 시간 제한 때문에 Auth는 약 10초 안에 `bootstrapping`을 벗어난다. 최소 표시 시간은 없다.
- Auth 재검증 시간 제한: `src/states/auth.tsx`의 network 단계는 `settleWithin`으로 `ASYNC_FEEDBACK_TIMING.longRunning`(10초) 안에 끝나지 않으면 network 실패로 취급한다. 시간 초과는 `clearInvalidSession`이나 로그아웃을 부르지 않고, 버려진 단계의 늦은 응답은 무시한다. 앱 시작 때 claims, server user, 동의 확인 단계는 mount 뒤 10초에 끝나는 예산 하나를 나눠 쓰고, 저장 세션 읽기(만료 세션의 network 갱신 포함)는 따로 10초를 받는다. claims·server user의 network 실패나 시간 초과는 `restoreOfflineMembership`(만료 전 저장 세션과 같은 사용자의 membership cache가 있으면 `authenticatedOffline`, 아니면 guest)으로 간다. 동의 확인(`getOnboardingStatus`)의 실패나 시간 초과는 offline 계정이 아니라 guest로 연다([Supabase 구조](supabase.md)의 규칙 유지). 저장 세션 읽기 시간 초과도 guest로 열되 세션과 cache는 남겨 이후 `TOKEN_REFRESHED`나 foreground 확인이 계정을 되살린다. 대화형 로그인 직후(`authenticating`)의 확인은 제한하지 않는다. 잠긴 로그인 sheet가 토큰 교환 단계(`phase: 'exchanging'`)에서 4초·10초 문구를 직접 보이기 때문이다.
- 편집기 route: 로그 작성·수정과 계획 작성·수정은 `logbookCreate`, `logbookEdit`, `planningCreate`, `planningEdit` root route의 전체 화면 편집기(`RoutedLogEditor`, `RoutedPlanEditor`)이고, 저장하지 않은 변경 폐기 확인은 `useDiscardChangesGuard` 하나를 함께 쓴다. 편집기는 화면 전체의 root라 고정 저장 바가 목록 scroll 안에 들어가지 않는다. 새 항목 저장은 편집기를 상세로 바꾸고, 수정 저장은 아래의 상세로 돌아간다. 계획에서 기록 작성은 `StackActions.replace('logbookCreate', …)`로 계획 상세 자리에 편집기를 둔다. `LogbookScreen`과 `PlanningScreen` 안의 화면 내 작성·상세·수정 route는 지웠다.
- 상세·편집 route fallback(`MissingRouteScreen`): 목록 조회가 실패하면 해당 목록의 불러오기 실패 문구, pending이 되는 다시 시도, 목록으로 돌아가기를 보인다. 목록이 아직 처음 불러오는 중이면 `DetailSkeleton`(1초 뒤 보임)을 보인다. 삭제됐거나 없는 항목이라는 안내는 목록이 성공적으로 불러졌는데 항목이 없을 때만 보인다.
- 워치 가져오기 표시 전용 규칙: 가져오기가 저장하는 기본 사이트 `워치 다이브`(`DEFAULT_WATCH_LOG_SITE_NAME`), 스쿠버 기본 시작 압력 150 bar(`DEFAULT_WATCH_SCUBA_START_PRESSURE_BAR`), 워치 내부 태그(`watch-capture`, `debug-test-capture`, `planned-<n>m`, `plan-<id>`)는 저장값을 바꾸지 않는다. guest claim 재사용이 `site_name`과 `manual_data`를 정확히 비교하고, `plan-<id>`가 기록과 계획을 잇기 때문이다. 화면에서는 `hasDefaultWatchSiteName`이면 `워치 기록 · 날짜`(목록은 `워치 기록`) 대체 제목을 쓰고 편집기 사이트 칸을 비워 필수 표시 없이 연다. 사이트를 비운 채 저장하면 저장된 이름을 그대로 둔다. `isUntouchedWatchPressureDefault`(출처가 워치, 압력 provenance 없음, bar 단위 시작 150, 종료 없음)이면 상세에서 압력 행을 숨기고 편집기는 `-- bar`로 연다. `getVisibleLogTags`는 워치가 보낸 내부 태그만 목록·상세·편집기·검색에서 빼고, 편집기는 저장할 때 숨긴 태그를 다시 붙인다. 다이버가 직접 입력한 태그는 같은 모양이어도 보인다.
- 계획의 워치 행: `isWatchVisiblePlan`(`planned`이고 연결된 기록이 없음)인 계획만 워치로 보내며 초안은 보내지 않는다. `useDivePlans`는 마지막으로 성공한 `updatePlannedDives`가 실어 보낸 계획별 `updatedAt`을 `plannedWatchSentVersions`로 기록하고, 실패한 호출은 이전 기록을 남긴다. `getPlanWatchState`는 bridge 사용 가능·지원·paired·워치 앱 설치·`activated`이고 context 오류가 없으며 그 계획의 현재 `updatedAt`이 정확히 그 기록에 있을 때만 `sent`(워치 전송 요청됨)다. 보낼 계획인데 그렇지 않으면 `needsConnection`(워치 전송 미확인), 보내지 않는 계획은 `phoneOnly`(iPhone에서만), 상태가 아직 없으면 행을 숨긴다. planned dive context는 수신 확인이 없는 최신값 전달이라 "요청됨"까지만 말한다. 체크리스트를 바꾸면 `updatedAt`이 바뀌어 다음 전송까지 잠깐 미확인으로 보인다.
- 로그북 목록 행은 보더 없는 카드 하나에 제목·최대 수심, `날짜 시간 · 다이빙 종류 · 다이빙 시간`, 다이버 태그, 표식을 줄마다 두고 접근성 라벨 하나를 갖는다. 처음 불러오기에는 1초 뒤 행 모양 스켈레톤 3개, 클라우드 페이지가 실제로 오는 동안에만 목록 끝 2행 스켈레톤을 보이고, 메모리에서 20개씩 자르는 페이지에는 표시하지 않는다. 처음 불러오기 실패 때는 개수 줄을 비우고, 기록이 있는 상태의 새로고침 실패는 목록을 유지한 채 안내를 붙인다.
- Settings는 계정 행을 첫 group에 두고 로그인 상태에서 `account` 상세 route(로그인 방법, 기록 백업 대기 수, 로그인 전 기록 옮기기, 로그아웃)로 들어간다. 로그인 방법은 이 기기의 `recentProvider` 힌트로만 보이며 없으면 `로그인됨`이다. 기록 백업 대기 수는 outbox 항목과 충돌 항목을 함께 세고, 계정 기록을 내려받는 중이라는 문구는 1초 뒤에 보인다. 로그아웃 확인 Alert는 계정에 백업된 기록은 남고 이 기기에서는 로그인 전 기록만 보인다고 알리며, 아직 백업하지 못한 변경 수를 함께 알린다. 로그아웃 때 기기의 계정 사본을 지우는 정리는 아직 구현되지 않았고([모바일 로그북 로드맵](mobile-logbook-roadmap.md)), Alert 문구는 그 정리가 생기면 바꿔야 한다. 알림 설정은 하위 화면 대신 목록 안 스위치이며 `notifications` route는 없다. 정보 group의 앱 버전은 `apps/mobile/package.json`의 version을 읽어 native `MARKETING_VERSION`과 다를 수 있다.
- Home 로그인 링크는 guest이고 Auth가 설정되어 쓸 수 있는 로그인 방법(provider 또는 개발용 로그인)이 있을 때만 보이며, Settings도 같은 조건을 쓴다.

## 현재 상태

앱 package는 `@repo/mobile`이다. 현재 의존성은 React Native `0.85.3`, React `19.2.3`, TypeScript, Jest, Metro, `react-native-safe-area-context`, `@react-native-async-storage/async-storage`, `@notifee/react-native`, `@repo/supabase`, `react-native-keychain`, native Google/Apple sign-in package, Gluestack UI v4 alpha package, NativeWind, Tailwind CSS, Reanimated, Worklets, React Native SVG를 포함한다. `@supabase/supabase-js`는 mobile이 직접 소유하지 않고 `packages/supabase` 경계 안에 둔다.

주요 source 경계는 다음과 같다.

- `src/App.tsx`: 앱 UI entry.
- `src/providers.tsx`: app-owned `QueryClientProvider`(`retry: 1`), `SafeAreaProvider`, `AppPreferencesProvider`, `GluestackUIProvider`, render error boundary, `AuthProvider`, `AppFeedbackProvider`와 `SignInFeedback`, `AccountDataProvider`, `StatusBar`. App root가 unmount되면 하위 observer cleanup 뒤 QueryClient cache/timer를 정리한다.
- `src/auth/`: Keychain session adapter, native Google/Apple credential adapter, membership cache, recent-provider preference와 mobile Auth assembly.
- `src/claim/`: immutable guest snapshot/manifest, exact profile-byte verification, resumable claim service와 persistent claim store.
- `src/deletion/`: Watch log deletion tombstone, claim/repository/native command reconciliation과 stale import visibility filter.
- `src/states/account-data.tsx`: 현재 Auth principal에 맞는 repository publication, account/guest row composition, account sync와 claim lifecycle, user/cache isolation.
- `src/sync/account-outbox.ts`, `src/sync/account-sync-coordinator.ts`: local-first account operation durability, retry와 revision conflict 보존.
- `src/storage/data-principal.ts`, `src/repositories/principal-repositories.ts`: `guest`와 `user:<uuid>` namespace와 principal-bound repository 구성.
- `src/states/auth.tsx`: stored evidence, online claims/user/status 검증, foreground revalidation, bounded offline state와 sign-in concurrency를 관리한다. 재검증 network 단계마다 10초 제한이 있다(위 2026-10-22 경계).
- `src/screens/auth`: guest-preserving login과 versioned terms/privacy exact set을 제출하는 non-dismissible onboarding 화면.
- `src/components/navigation/index.tsx`: `@react-navigation/native` 기반 top-level `NavigationContainer`와 custom tab router. 현재 선택된 tab을 다시 누르면 해당 화면을 refresh하고 scroll top을 요청한다. Logbook create/detail/edit, Plan create/detail/edit, Settings detail은 tab 내부 local route가 아니라 root route 상태로 렌더링해 나중에 deep link를 route name과 params로 연결할 수 있게 했다. 작성·수정 route는 전체 화면 편집기다.
- `src/components/ui/`: 재사용 UI primitive, instrument control, session card, profile chart, tone type.
- `components/ui/gluestack-ui-provider/`: generated Gluestack provider, color-mode script, token bridge.
- `global.css`, `tailwind.config.js`: NativeWind/Tailwind entrypoint와 semantic token configuration.
- `src/conditions/home-conditions.ts`: Home 위치 조건을 위한 provider-neutral type, static mock provider, snapshot model.
- `src/conditions/location-service.ts`: `@react-native-community/geolocation`로 foreground 좌표를 얻는다. 이 package는 reverse geocoding이 아니라 좌표 획득을 담당한다.
- `src/conditions/open-meteo-home-conditions-provider.ts`: Open-Meteo weather/marine API adapter. 기온과 해안 수온을 가져오고, 도시명은 repo-local native reverse geocoder 결과를 timezone city보다 우선한다.
- `src/native/reverse-geocoder.ts`: React Native `NativeModules.ReverseGeocoderModule` wrapper. Native module이 없거나 실패하면 `undefined`를 반환해 Open-Meteo timezone fallback을 유지한다.
- `src/notifications/watch-sync-notification-service.ts`: Notifee permission request, local notification display, notification press bootstrap/event mapping을 다루는 watch sync notification 경계.
- `src/screens/home`, `src/screens/logbook`, `src/screens/planning`, `src/screens/settings`: route-level 화면 container. Logbook과 Planning 목록은 작성·상세 열기를 항상 root navigation callback(`onCreateEntry`, `onOpenEntry`, `onCreatePlan`, `onOpenPlan`)으로 넘기며 화면 내 route fallback은 없다. 편집기·상세 test는 해당 component를 직접 그리는 harness를 쓴다. Settings의 account, theme, language, device management도 별도 detail route로 열린다.
- `src/screens/memory`: 이전 memory/share preview source가 남아 있지만 현재 bottom tab route에는 연결되어 있지 않다.
- `src/storage/`: `PersistentKeyValueStore`, AsyncStorage adapter, in-memory test store, versioned JSON store, storage key를 둔다.
- `src/states/app-preferences.tsx`, `src/states/app-preferences-storage.ts`: 앱 표시 선호를 관리하고 `themePreference`, `language`, `watchSyncNotificationsEnabled`를 저장한다.
- `src/states/use-dive-logbook.ts`: React Query 기반 로그북 hook, search filter, pending Watch sync action, 기존 화면을 위한 `MobileDiveSession` 호환 view.
- `src/states/use-dive-logbook-queries.ts`: `DiveLogRepository`를 호출하는 list/detail/save/delete/watch import query와 mutation hook.
- `src/states/watch-sync.tsx`: `WatchLink` payload event를 먼저 구독한 뒤 durable inbox를 drain하고, runtime validator를 통과한 payload만 로그북 repository에 import한다. 저장 성공 payload는 import 완료 acknowledge로 watch에 되돌려 보내고, 무효 payload drop은 native inbox에서만 acknowledge한다. 자동 import로 새 로그가 저장되면 root navigation에 imported entry를 알려 tappable toast를 띄우고, Settings opt-in이 켜진 background/killed 상태에서는 Notifee local notification을 요청할 수 있게 notification service callback을 호출한다.
- `src/states/use-dive-plans.ts`, `src/states/use-dive-plan-queries.ts`: React Query 기반 Planbook hook과 list/save/delete mutation. 실행하지 않은 planned 상태의 모바일 계획을 watch companion에 전달한다.
- `src/companion/watch-link.ts`: 앱 코드가 companion watch와 통신하는 유일한 경계인 `WatchLink` 인터페이스. pending drain, payload 준비·채택·폐기, import 완료 acknowledge, 삭제 명령과 receipt, planned dive update, linked watch 상태, payload event 구독을 정의한다. Platform module이 없으면 조용한 unavailable link를 쓴다.
- `src/companion/native-watch-link.ts`, `src/companion/default-watch-link.ts`: native module 계약(`NativeWatchLinkModule`)을 `WatchLink`로 바꾸는 adapter와 앱 기본 link. iOS는 `WatchConnectivityModule`, Android는 같은 계약의 `WearableCompanionModule`(예정)을 찾는다. `src/companion` 밖의 코드는 platform module이나 event 이름을 참조하지 않으며 `__tests__/watch-link.test.ts`가 이를 검사한다. 메시지 규격은 `docs/architecture/watch-link-protocol.md`에 있다.
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
- Planning: persistent Planbook으로 다음 다이브 계획을 작성, 수정, 완료하고 완료된 계획에서 Logbook 초안을 열 수 있다. 로그인 후 account 계획과 defer된 guest 계획을 같은 흐름으로 합성하며, `ownerUserId`가 없는 예외 계획 행에만 `이 기기에만 저장` 배지를 표시한다. 예전 active plan panel은 다가오는 계획이 있을 때만 보이는 `다음 다이빙` 행으로 바뀌었다.
- Settings: 계정 행, 워치 기록 도착 알림 스위치, 테마, 언어, paired watch 상태, 앱 정보를 grouped list로 관리한다.

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

Account-data bootstrap은 `loading`, `ready`, `degraded`, `recoveryRequired`를 구분한다. 선택된 principal의 Logbook/Planbook은 공개 전에 검증하며, durable JSON 오류는 빈 배열로 바꾸지 않고 원본 bytes를 digest-addressed quarantine에 그대로 보존한다. 이전 build가 남긴 recovery journal과 quarantine은 복구 증거이지 현재 로그나 계획 inventory가 아니다. 검증 실패는 `recoveryRequired`로 전환하고 remote hydration, outbox reconciliation, claim inspection/cleanup과 저장·삭제를 시작하지 않는다. 검증된 local repositories를 먼저 publish한 뒤 자동 account hydration을 첫 상호작용 뒤 예약하고, remote row 사이에 cooperative yield를 둔다. Optional 단계 실패는 이미 공개한 로컬 데이터를 철회하지 않고 Home recovery banner에서 재시도하게 한다. 선택된 principal의 local repository 구성 자체가 실패하면 다른 principal로 fallback하지 않고 preserve-data recovery screen을 표시한다. 예상하지 못한 render error도 같은 비파괴적 recovery screen으로 전환한다.

로컬 저장소는 같은 bytes를 다시 검증하지 않는다. `PersistentJsonStore`는 저장된 text가 바뀔 때까지 parse·검증한 값을 재사용하고, 쓰기는 key 하나를 원자적으로 바꾸는 `setString`과 readback 한 번이다. 이전 build의 pending/commit journal은 처음 읽거나 쓰기 전에 한 번만 마무리하며, commit marker 없는 pending 값은 버린다. Repository는 호출자에게 넘기는 값만 복사한다. Claim store는 sidecar마다 내용 검증 결과를 그 입력과 함께 기억해 진행 상태만 바뀐 쓰기에서는 진행 field만 검사하고, 입력이 바뀌면 다시 검증한다. 검증된 사본이 메모리에 없으면 sidecar를 하나씩 검사하며 사이마다 JS thread를 양보한 뒤 전체 parse가 그 결과를 재사용한다. 삭제된 워치 세션으로 claim을 무효화할 때는 저장된 text에 session id가 없으면 전체 읽기를 건너뛴다. Hash 입력을 만드는 `canonicalJson`은 `src/utils/canonical-json.ts` 하나이며 key 순서를 key 목록마다 한 번만 계산하고 출력 bytes는 바꾸지 않는다. Auth 재검증이 같은 상태로 끝나면 상태 객체를 유지하고, account-data는 data owner마다 principal 객체를 하나만 써서 bootstrap을 다시 실행하지 않는다. Home 날씨 요청은 JS thread 정지로 마감 timer가 먼저 실행될 수 있어 한 번 더 시도한 뒤 오류를 보인다. 로그북 schema 4는 워치 로그의 미리보기가 `watchCapture.samples`와 `watchCapture.session.samples`에 같을 때 session 쪽을 저장하지 않고 읽을 때 되돌리며, schema 3도 읽는다. 원격 payload와 claim digest는 바뀌지 않는다.

로그북 탭은 제목, 기록 작성·워치 기록 가져오기 버튼, 검색창, 전체 개수 줄을 위에 고정하고 그 아래 `FlatList` 목록만 스크롤한다. 전체 개수는 로컬 로그북 개수이며 검색 중에는 검색 결과 수와 함께 보이고, 클라우드에서 받는 중이면 그 상태를 함께 보인다. 목록은 20개씩 이어서 보이며 새 검색은 첫 페이지부터 다시 보인다. 활성 로그북 탭을 다시 누르면 목록을 맨 위로 올리고 새로고침한다. 당겨서 새로고침 표시는 당기는 동작에만 붙이고, 훅의 `isRefreshing`은 사용자가 요청한 새로고침만 뜻한다. iOS에서 백그라운드 새로고침에 그 표시를 켜면 코드로 스크롤한 목록 위에 빈 여백이 남았기 때문이다. 이전 개발 빌드가 남긴 `dive-app:debug:bootstrap-trace` key는 시작 때 지운다.

Watch import는 `localSessionId`와 `endedAt` 기반 `importKey`로 deduplicate하고, 기존 manual/mobile field와 `importedAt`을 보존하며, watch capture와 sync status를 최신 payload로 갱신한다. 결과는 watch 시작 시간, 수동 입력 시작 시간, 생성 시간 기준으로 최신 항목이 먼저 오도록 정렬한다. Persistent 저장소와 in-memory 저장소는 같은 clone, sort, watch merge helper를 사용해 이 동작을 맞춘다.

WatchConnectivity 수신 PoC는 iOS native code에서 시작된다. Native inbox의 file materialization, JSON encode와 UserDefaults 접근은 전용 serial queue에서 실행하고, 작은 immutable event 전달만 main queue로 넘긴다. JS provider는 event를 먼저 구독하되 자동 drain을 첫 상호작용 뒤 예약하며 payload 사이에 cooperative yield를 둔다. Native inbox와 module은 pending payload, event, acknowledge, planned dive, linked watch 상태를 관리한다. JS provider와 Logbook 수동 action은 같은 `WatchImportCoordinator`를 사용해 concurrent import를 직렬화한다. 저장이 끝난 payload만 imported acknowledge하고 실패 payload는 재시도할 수 있게 남긴다. Foreground toast와 opt-in notification은 local 저장 결과만 뜻한다.

Home 위치 조건은 app state가 `active`일 때 시작한다. Core Location code `2`인 `POSITION_UNAVAILABLE`은 최대 세 번의 bounded retry 안에서 처리하고, permission denial과 다른 오류는 즉시 기존 terminal 상태로 분류한다. 이 위치·날씨 정보는 화면 맥락일 뿐 다이빙 적합성이나 안전 신호가 아니다.

Guest 수동 로그는 `source: 'manual'`, `cloudSyncStatus: 'notConfigured'`로 저장한다. Account mutation은 outbox 상태에 맞춰 cloud status를 전이한다. 비어 있거나 유효하지 않은 수치 field는 `undefined`로 유지한다. Watch 기반 항목을 수정하면 raw watch capture와 `source: 'watch'`를 유지한다. Raw `watchCapture.session.syncStatus`는 Watch 전송 provenance이고 top-level `cloudSyncStatus`와 별개다.

Guest data claim은 현재 guest Logbook/Planbook과 전체 profile bytes를 immutable snapshot/manifest로 먼저 보존한다. 관계와 profile bytes/digest/sample count를 원격 batch 생성 전에 검사한다. 실패 snapshot은 digest-covered manifest 밖의 strict optional detail에 `checking`/`uploading`/`finalizing`/`cleanup` phase와 bounded item id/label만 보존하며 payload나 profile bytes를 진단 정보에 복제하지 않는다. 각 항목의 원격 write/readback과 검증이 끝난 뒤에만 진행 수를 올린다. 전체 batch의 remote finalize와 committed readback을 검증한 뒤 이미 commit된 snapshot을 base account local repository에 `synced` copy로 직접 publish/readback하고, 그 다음 `cleanupPending`을 저장한다. Snapshot과 같은 guest row는 exact delete하고, snapshot 뒤 바뀐 row는 normal account local-first/outbox에 `pending` update로 저장·readback한 뒤 guest copy를 삭제한다. 이 local cleanup이 모두 끝나야 manifest를 `committed`로 저장하며 중단되면 `cleanupPending`에서 재개한다. Deferred guest data의 기본 합성은 account-copy-wins다. User generation과 principal-scoped cache key는 이전 account callback이 새 account 상태를 publish하지 못하게 한다.

Cross-device claim committed readback은 같은 owner와 `localId`의 동등한 row가 이미 다른 기기에서 확정된 경우 서버가 검증한 canonical remote ID를 사용한다. Immutable staged profile receipt는 원래 batch/target과 revision/digest/byte/sample metadata로 독립 검증하고, committed canonical profile은 account log 또는 유효한 이전 claim namespace에서 owner, canonical remote ID와 encoded revision이 정확히 일치해야 한다. 서버는 profiled Watch log가 같은 immutable profile과 사용자 의미 content를 가지면서 timestamp 표기, source-derived float readback, 세 import bookkeeping timestamp만 다른 경우에만 locked canonical row를 staged digest 표현으로 정규화한다. Mobile은 기존 timestamp canonicalization과 watch/manual measured-value float recovery로 이 strict staged digest를 읽는다. Foreign owner, soft deletion, title/site/rating/notes, profile, relation, 다른 namespace와 ID/revision 불일치는 계속 fail closed다. Mobile은 전체 payload/profile/관계 검증이 끝난 뒤에만 snapshot item의 target ID를 갱신하고 그 snapshot을 account local publication 전에 저장한다. `remoteBatchId`와 모든 item의 completed upload receipt가 있는 retry는 `uploading` 진행률을 다시 emit하지 않고 `finalizing`으로 시작하므로 이미 끝난 `15/15`를 재생하지 않는다.

Claim 선택/진행 화면은 로그인 뒤 native form sheet로 통합됐다. 준비, 항목별 진행, finalizing, cleanup, 실패 상태가 모두 비어 있지 않은 내용을 렌더링한다. 확인할 수 없는 watch profile 항목은 정상 항목과 분리해 guest에 보류하고, 부분 완료는 가져온 수와 기기에 유지한 수를 함께 보여준다. Retained-only 결과는 자동 반복하지 않으며 Settings에서만 명시적으로 다시 검사한다. Settings는 owned account의 eligible/running/failed/deferred/retained 상태를 online/offline에서도 다시 열 수 있고, Home은 degraded bootstrap 또는 failed/deferred claim에 compact recovery banner 하나를 표시한다. 항목별 remote write/readback만 정확한 진행 count와 progress bar를 사용하고, remote/account 저장 뒤 local cleanup은 indeterminate 상태로 분리한다. Cleanup은 inventory 한 번과 entity별 조건부 bulk delete로 수행하며 성공한 guest 원본/profile sidecar를 제거하고 historical Watch identity만 가진 compact receipt를 남긴다. Legacy committed snapshot도 재업로드 없이 이 receipt로 전환하며 account historical lookup은 비어 있는 full snapshot 대신 receipt identity를 읽는다. Reduce Motion과 screen reader progress value를 지원한다. Semantic canonical reuse는 local Function integration, mobile float hydration regression, hosted staging verifier와 원래 iPhone 15-item retry를 통과했다. 첫 checkpoint cleanup 뒤 live inventory가 별도 1건으로 갱신됐고 두 번째 claim도 성공했다. 최종 실기기 local account 26건이 remote와 일치하고 guest 0건, snapshot 없는 compact receipt와 empty outbox를 확인했다. Android physical claim과 background/force-quit resume는 아직 확인하지 않았다.

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
