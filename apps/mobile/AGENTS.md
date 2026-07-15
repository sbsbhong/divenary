# Mobile App Agent Guide

이 파일은 `apps/mobile` 아래의 React Native 모바일 앱에 적용된다. 루트 `AGENTS.md` 지침도 함께 따른다.

## 앱 목적

`apps/mobile`은 다이빙 로그를 탐색하고 watch-captured 세션을 리뷰하는 모바일 surface이자 iPhone/watch companion bundle의 소유자다. 현재 production remote data/backend는 없지만, generated watch contract type, AsyncStorage 기반 local persistence, iOS WatchConnectivity receiver/import acknowledgement PoC, mobile-to-watch planned dive 전달 PoC, embedded watchOS companion target과 Wave 3A native social Auth foundation을 사용해 앱 구조와 UX boundary를 잡고 있다.

모바일 앱은 현재 authentication과 mandatory consent를 소유하며, 장기적으로 user profile, dive log list/detail, manual dive creation, Supabase data sync, statistics, search, planning, memory/share, backup flow의 중심이 된다. watch 앱에서 온 원본 기록은 손실 없이 보존하고, server/user data 연결은 3B/3C의 mobile/backend layer에서 처리한다. 별도 watch workspace를 다시 만들지 않고, watch source와 target membership은 `ios/DiveWatchApp`와 `ios/DiveMobile.xcodeproj`에서 관리한다.

## 현재 Stack

- Bare React Native app, React Native `0.85.3`
- React `19.2.3`
- TypeScript, Jest, ESLint, Metro
- `react-native-safe-area-context`
- `@react-native-async-storage/async-storage`
- `@tanstack/react-query`
- `@react-navigation/native`
- `@repo/supabase`, `react-native-keychain`
- `@react-native-google-signin/google-signin`, `@invertase/react-native-apple-authentication`
- Gluestack UI v4 alpha, NativeWind, Tailwind CSS
- React Navigation 기반 custom bottom-tab navigator
- iOS native WatchConnectivity bridge, import acknowledgement, embedded watchOS companion target

새 dependency나 UI framework를 추가하려면 명시적 필요성과 기존 패턴으로 해결할 수 없는 이유가 있어야 한다.

## Source 구조

- `src/App.tsx`: app UI entry
- `src/providers.tsx`: app-owned `QueryClient`, `SafeAreaProvider`, preferences/Auth provider와 top-level status bar
- `src/auth/`: Keychain session, native Google/Apple credential adapter, membership cache, recent provider와 mobile Auth assembly
- `src/states/auth.tsx`: restore/revalidation/concurrency를 포함한 Auth state provider
- `src/screens/auth/`: guest-preserving login과 versioned mandatory-consent 화면
- `src/components/navigation/index.tsx`: React Navigation 기반 custom bottom-tab navigator
- `src/components/ui/`: reusable primitives, instruments, cards, session profile, theme tokens
- `src/screens/home/screen.tsx`: latest session과 high-level metrics
- `src/screens/logbook/screen.tsx`: imported session list, search/filter, detail review
- `src/screens/planning/screen.tsx`: non-certified planning reminder UI
- `src/screens/memory/screen.tsx`: static memory/share preview
- `src/states/use-dive-logbook.ts`: React Query 기반 logbook state와 WatchConnectivity pending inbox sync action
- `src/states/use-dive-plans.ts`: React Query 기반 Planbook state와 실행하지 않은 planned dive의 watch companion 전달
- `src/states/watch-connectivity-sync.tsx`: iOS WatchConnectivity payload drain/subscribe와 validated repository import
- `src/native/watch-connectivity.ts`: React Native WatchConnectivity wrapper
- `src/types/dive-session.ts`: generated watch contract type 기반 mobile session type
- `src/utils/`: formatter, watch fixture helper, summary 계산
- `ios/DiveMobile.xcodeproj`: iPhone app target `DiveMobile`과 companion watch target `DiveWatchApp`
- `ios/DiveWatchApp`: SwiftUI watchOS companion app source
- `ios/`, `android/`: native projects

## 책임 범위

모바일 앱이 담당한다.

- 로그인과 mandatory consent, 향후 사용자 profile과 session ownership
- dive log list/detail, review, search, filtering
- manual dive log creation과 future editing flow
- watch sync payload import와 imported values 보존
- 실행하지 않은 planned dive를 watch companion에 전달
- iOS WatchConnectivity receiver와 companion watch target embed 구조
- 3B/3C에서 추가될 Supabase data sync orchestration
- non-certified planning reminder, memory/share preview, statistics

모바일 앱에 넣지 않는다.

- direct SQL
- duplicated Supabase schema type
- watch-only sensor capture logic
- raw watch sample을 삭제하거나 재계산해 원본 의미를 잃는 rewrite
- 별도 watch workspace 재도입
- 감압, 조직 loading, gas switching safety, emergency dive decision 계산
- certified dive computer 또는 medical/emergency recommendation copy
- guest Logbook/Planbook을 Wave 3A login만으로 claim, upload, delete, partition하거나 영구히 숨기는 동작
- Watch target의 Supabase client, account id, Auth entitlement 또는 provider callback

## 작업 지침

- React Native UI 작업 전 실제 framework, component 구조, styling token, package script를 확인한다.
- 현재 앱은 React Navigation custom tab navigator와 local UI primitive를 쓴다. 새 navigation/UI/styling library는 승인 없이 추가하지 않는다.
- 화면 변경은 `src/screens/<area>/screen.tsx`에 두고, 재사용되는 표현만 `src/components/ui/`로 올린다.
- app-wide provider 변경은 `src/providers.tsx`에서 처리한다.
- watch sync contract type은 `packages/contracts/generated/typescript`에서 가져온다. generated output은 직접 수정하지 않는다.
- Supabase나 auth를 변경할 때 mobile 코드에 직접 SQL을 넣지 말고 `packages/supabase`의 typed package/repository boundary를 사용한다.
- Wave 3A Auth 변경은 기존 guest Logbook/Planbook repository와 `cloudSyncStatus: notConfigured`를 유지해야 한다. Remote data, principal partition, guest claim, account-local purge는 각각 3B, 3C, 3D 전에는 추가하지 않는다.
- 안전 관련 copy는 항상 non-certified assistant, reminder, review wording으로 제한한다.

## Skill 사용

- React Native component, state, performance, native bridge 관련 작업에는 `vercel-react-native-skills`를 사용한다.
- React component API나 architecture refactor가 중심이면 Vercel React skill을 추가로 사용한다.
- iOS native project, CocoaPods, Xcode build, signing, native module 관련 작업에는 `xcode-harness`를 사용한다.
- Supabase/auth/RLS/repository 변경에는 `supabase` skill을 사용한다.
- app boundary, sync behavior, domain model, safety wording이 바뀌면 `karpathy-llm-wiki`를 기준으로 `.wiki/raw/`와 `.wiki/wiki/`를 함께 갱신하고, 저장소별 한국어 작성 스타일과 안전 경계는 `wiki-writing`에서 확인한다.

## Commands

루트에서 실행한다.

- `yarn workspace @repo/mobile start`
- `yarn workspace @repo/mobile typecheck`
- `yarn workspace @repo/mobile test`
- `yarn workspace @repo/mobile lint`
- `yarn workspace @repo/mobile ios`
- `yarn workspace @repo/mobile android`
- `yarn workspace @repo/mobile watch:build`
- `yarn workspace @repo/mobile watch:list`
- `yarn workspace @repo/mobile watch:ui:check`

루트 alias:

- `yarn mobile:typecheck`
- `yarn ios:build`
- `yarn watch:build`

iOS native build 전 CocoaPods workspace가 필요하다.

- `yarn workspace @repo/mobile ios:pods`
- `yarn workspace @repo/mobile ios:xcode`

Xcode를 열 때는 full iOS app 작업 기준으로 `ios/DiveMobile.xcworkspace`를 사용한다. `ios/DiveMobile.xcodeproj`는 `DiveWatchApp` target membership과 watch-only CLI build 확인에 사용하지만, full React Native iOS app build에서는 React pod module resolution이 필요하다.

## Verification

- TypeScript/mobile-only 변경: `yarn mobile:typecheck`
- mobile test 대상 변경: `yarn workspace @repo/mobile test`
- watchOS companion 변경: `yarn watch:build`
- watch UI localization/style boundary 변경: `yarn workspace @repo/mobile watch:ui:check`
- iOS native 변경: `yarn ios:build`를 실행하되, Pods나 local Xcode setup이 없으면 그 상태를 정확히 보고한다.
- cross-package contract import 변경: 먼저 `yarn check:quick`, 그 다음 `yarn mobile:typecheck`
