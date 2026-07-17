# Mobile Apple Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shared iOS/Android native splash, a guest-only Home login entry, a cohesive native login sheet, and a service-wide visible-copy reduction.

**Architecture:** Native launch resources own the first frame without a JavaScript delay. Root navigation owns authentication routing and passes a render decision into the pure Home screen. Existing native social adapters and provider preference storage stay unchanged while the login surface and visible copy are simplified.

**Tech Stack:** React Native 0.85.3, React Navigation native stack 7, Gluestack UI v4 local components, react-i18next, Jest, iOS storyboard/asset catalog, Android resources.

## Global Constraints

- Keep guest Logbook/Planbook local-only; login must not upload, delete, claim, or partition local data.
- Keep one non-certified safety statement on Home, Logbook, Planning, and Memory.
- Keep legal consent labels and unsupported-depth warnings.
- Add no dependency and no artificial splash delay.
- Use semantic Gluestack color tokens in React Native UI.
- Preserve unrelated dirty worktree files and stage only files from this plan.

---

### Task 1: Shared native splash

**Files:**
- Create: `apps/mobile/__tests__/native-splash.test.ts`
- Create: `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/Contents.json`
- Create: `apps/mobile/ios/Divenary/Images.xcassets/SplashMark.imageset/splash-mark.svg`
- Modify: `apps/mobile/ios/Divenary/LaunchScreen.storyboard`
- Create: `apps/mobile/android/app/src/main/res/values/colors.xml`
- Create: `apps/mobile/android/app/src/main/res/values-night/colors.xml`
- Create: `apps/mobile/android/app/src/main/res/drawable/splash_mark.xml`
- Create: `apps/mobile/android/app/src/main/res/drawable/launch_screen.xml`
- Create: `apps/mobile/android/app/src/main/res/values-v31/styles.xml`
- Modify: `apps/mobile/android/app/src/main/res/values/styles.xml`

**Interfaces:**
- Consumes: iOS asset catalog image name `SplashMark`; Android `AppTheme`.
- Produces: matching native first frames with `#F5F5F7` light background and the shared blue `D` geometry.

- [x] **Step 1: Write the failing native-resource test**

```ts
test('uses the same minimal Divenary splash language on iOS and Android', () => {
  expect(storyboard).toContain('image="SplashMark"');
  expect(storyboard).not.toContain('Powered by React Native');
  expect(iosMark).toContain('#0066CC');
  expect(androidMark).toContain('#0066CC');
  expect(androidTheme).toContain('@drawable/launch_screen');
  expect(android31Theme).toContain('windowSplashScreenAnimatedIcon');
});
```

- [x] **Step 2: Run it and verify RED**

Run: `yarn workspace @repo/mobile test native-splash.test.ts --runInBand`

Expected: FAIL because the image set and Android splash resources do not exist and the storyboard still contains framework copy.

- [x] **Step 3: Implement the native resources**

Use a 96x96 mark with a blue circle and an even-odd white `D` path on both platforms. Replace the storyboard labels with one centered 96x96 image and use `systemGroupedBackgroundColor`. Configure pre-31 `android:windowBackground` and v31 `android:windowSplashScreenBackground`, `android:windowSplashScreenAnimatedIcon`, and a 500ms system animation duration.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `yarn workspace @repo/mobile test native-splash.test.ts --runInBand`

Expected: PASS.

### Task 2: Guest-only Home login entry

**Files:**
- Modify: `apps/mobile/__tests__/App.test.tsx`
- Modify: `apps/mobile/src/screens/home/screen.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`

**Interfaces:**
- Consumes: `AuthState.status`, existing `openAuthLogin()`.
- Produces: `HomeScreen` props `showLogin?: boolean` and `onOpenLogin?: () => void`.

- [x] **Step 1: Replace the language-menu expectation with failing auth-entry tests**

```tsx
expect(root.findByProps({ testID: 'home-login-action' })).toBeTruthy();
expect(root.findAllByProps({ testID: 'language-menu-trigger' })).toHaveLength(0);
await act(() => root.findByProps({ testID: 'home-login-action' }).props.onPress());
await waitForRenderedTestID(renderer, 'auth-login-screen');

mockAuthState = { status: 'authenticated', userId: 'member' };
renderer.update(<App />);
expect(renderer.root.findAllByProps({ testID: 'home-login-action' })).toHaveLength(0);
```

- [x] **Step 2: Run the App tests and verify RED**

Run: `yarn workspace @repo/mobile test App.test.tsx --runInBand`

Expected: FAIL because Home still renders `language-menu-trigger` and has no login action.

- [x] **Step 3: Implement the navigation-owned decision**

Delete `LanguageMenu`, its state, and language menu imports from Home. Render a compact primary `InstrumentButton` with `testID="home-login-action"` only when `showLogin === true`. Pass `showLogin={state.status === 'guest'}` and `onOpenLogin={openAuthLogin}` from `RootNavigation`. Add `home.login` translations (`로그인`, `Log in`).

- [x] **Step 4: Run App tests and verify GREEN**

Run: `yarn workspace @repo/mobile test App.test.tsx --runInBand`

Expected: PASS.

### Task 3: Cohesive native login sheet

**Files:**
- Modify: `apps/mobile/__tests__/auth-screens.test.tsx`
- Modify: `apps/mobile/__tests__/App.test.tsx`
- Modify: `apps/mobile/src/screens/auth/login-screen.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`

**Interfaces:**
- Consumes: native `GoogleSigninButton`, native `AppleButton`, `recentProvider`.
- Produces: equal 52pt provider geometry, light variants, overlay recent marker, native form sheet.

- [x] **Step 1: Write failing provider and route assertions**

```tsx
expect(StyleSheet.flatten(google.props.style)).toMatchObject({ height: 52, width: '100%' });
expect(StyleSheet.flatten(apple.props.style)).toMatchObject({ height: 52, width: '100%' });
expect(apple.props.buttonStyle).toBe(AppleButton.Style.WHITE);
expect(apple.props.cornerRadius).toBe(8);
expect(recent.props.className).toContain('absolute');
expect(recent.props.accessibilityLabel).toBe('최근 사용');
expect(navigationSource).toContain("presentation: 'formSheet'");
expect(navigationSource).toContain('sheetGrabberVisible: true');
```

- [x] **Step 2: Run Auth/App tests and verify RED**

Run: `yarn workspace @repo/mobile test auth-screens.test.tsx App.test.tsx --runInBand`

Expected: FAIL on 48pt geometry, black Apple style, text recent row, and modal presentation.

- [x] **Step 3: Implement the sheet and provider grammar**

Use a centered title row with a 44pt close icon, remove the eyebrow/subtitle and guest-boundary card, render providers in an unframed vertical stack, use `WHITE` Apple and `Light` Google buttons at 52pt, and replace the recent text row with an absolute 12pt semantic-primary dot. Keep one centered `guestBoundaryNote` caption. Set route options to `formSheet`, `[0.62, 0.9]`, visible grabber, and 28pt sheet corner radius.

- [x] **Step 4: Run Auth/App tests and verify GREEN**

Run: `yarn workspace @repo/mobile test auth-screens.test.tsx App.test.tsx --runInBand`

Expected: PASS.

### Task 4: Visible copy audit

**Files:**
- Create: `apps/mobile/__tests__/ui-copy-density.test.ts`
- Modify: `apps/mobile/src/screens/auth/onboarding-screen.tsx`
- Modify: `apps/mobile/src/screens/home/screen.tsx`
- Modify: `apps/mobile/src/screens/logbook/screen.tsx`
- Modify: `apps/mobile/src/screens/planning/screen.tsx`
- Modify: `apps/mobile/src/screens/memory/screen.tsx`
- Modify: `apps/mobile/src/screens/settings/screen.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: affected Jest expectations in `apps/mobile/__tests__/preview-metric-placeholders.test.tsx` and `apps/mobile/__tests__/settings-screen.test.tsx`

**Interfaces:**
- Consumes: existing action/state/legal/safety translation keys.
- Produces: the visible-copy policy from the design spec.

- [x] **Step 1: Add a failing copy-policy source test**

```ts
expect(home).not.toContain("t('home.subtitle')");
expect(home).not.toContain('home-reminder-alert');
expect(login).not.toContain('StatusPill');
expect(onboarding).not.toContain("t('auth.onboarding.subtitle')");
expect(logbook).not.toContain("t('logbook.emptyBody')");
expect(planning).not.toContain("t('planning.subtitle')");
expect(memory).not.toContain("t('memory.exportStatus')");
expect(settings).not.toContain("t('settings.subtitle')");
```

- [x] **Step 2: Run the copy test and verify RED**

Run: `yarn workspace @repo/mobile test ui-copy-density.test.ts --runInBand`

Expected: FAIL for all existing explanatory surfaces.

- [x] **Step 3: Remove redundant visible copy**

Remove Home subtitle/status/reminder card/empty-state body and non-actionable condition error bodies. Remove Onboarding subtitle. Remove Logbook review eyebrow and empty body. Remove Planning status pills/subtitle and completion body. Remove Memory status pills/subtitle/future-workflow card/repeated review footer/no-op save action. Remove Settings page and section subtitles plus obvious choice descriptions; retain status explanations only when they explain unavailable or offline recovery. Remove translation keys that have no remaining call sites in both Korean and English.

- [x] **Step 4: Run copy and affected screen tests**

Run: `yarn workspace @repo/mobile test ui-copy-density.test.ts preview-metric-placeholders.test.tsx settings-screen.test.tsx home-conditions.test.tsx --runInBand`

Expected: PASS.

### Task 5: Verification and integration

**Files:**
- Modify: `apps/mobile/__tests__/apple-design-system.test.tsx`
- Modify: `docs/superpowers/plans/2026-07-17-mobile-apple-polish.md`

**Interfaces:**
- Consumes: complete implementation.
- Produces: green mobile gates and scoped main commits.

- [x] **Step 1: Repair the pre-existing Keychain test harness failure**

Mock `../src/states/auth` in `apple-design-system.test.tsx` with a fragment `AuthProvider`; the test validates theme wiring and does not need a real Supabase/Auth client.

- [x] **Step 2: Run formatting and static validation**

Run: `yarn mobile:typecheck`

Expected: exit 0.

- [x] **Step 3: Run the complete mobile test suite**

Run: `yarn workspace @repo/mobile test --runInBand`

Expected: all suites PASS with no Keychain native-module errors.

- [x] **Step 4: Run native build gates**

Run: `yarn ios:build`

Expected: exit 0 when CocoaPods/Xcode simulator infrastructure is available; otherwise report the exact environment failure without claiming a pass.

Run: `cd apps/mobile/android && ./gradlew assembleDebug`

Expected: `BUILD SUCCESSFUL` and Android resource compilation confirms both splash resource paths.

- [x] **Step 5: Review, mark this plan complete, and commit only scoped files**

Run `git diff --check`, inspect `git diff --stat`, stage explicit paths, and create focused implementation commits on `main`. Confirm `git branch --show-current` is `main` and unrelated dirty files remain unstaged.
