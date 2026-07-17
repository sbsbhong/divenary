# Login Entry Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the heavy Home login CTA and uneven native provider controls with a guest-only text action and a content-fit, layout-stable unified login sheet.

**Architecture:** `RootNavigation` continues to own auth-state routing and selects a content-fit sheet with iOS 15 system medium/large detents. `HomeScreen` renders a local text pressable from existing props. `LoginScreen` keeps orchestration while a screen-local `SocialLoginButton` owns compliant provider artwork, typography, and spinner presentation; recent-provider metadata stays outside the branded button.

**Tech Stack:** React Native 0.85.3, React Navigation native stack, gluestack-ui v4 primitives, NativeWind, react-i18next, Jest with react-test-renderer, existing Google/Apple credential adapters

## Global Constraints

- Keep Yarn 1.22.22 and add no dependency.
- Keep `auth.signIn(provider)`, provider availability, session persistence, recent-provider storage, Supabase repository behavior, and guest local-data semantics unchanged.
- Show Home login only for `guest`; keep it hidden for authenticated, authenticated-offline, bootstrap, signing-in, and onboarding states.
- Home login target is at least 52pt wide and 44pt high with no capsule, background, border, or icon.
- Both provider rows are 44pt high with 8pt radius, provider-correct artwork proportions, a flexible title, and symmetric icon/status columns.
- Use official Google multicolor G and Apple-provided logo-only artwork; do not draw either brand logo manually.
- Keep a visible `최근 사용` / `Recently used` label outside the branded button and include it in the recent provider's accessibility label.
- Keep the status/error row at least 44pt high so sheet height does not change.
- Keep legal consent, Auth error handling, and the repository safety boundary unchanged.

## Review Amendment

The pre-merge review identified provider-brand and iOS 15 compatibility constraints that supersede the initial 54pt/internal-status proposal:

- Apple logo-only PNG artwork is rendered at its supported 44pt size, and the Apple title uses the corresponding 19pt system proportion.
- Google artwork preserves its 20pt aspect ratio and the title uses bundled Google Sans Medium at 14/20.
- Recent-provider metadata remains visible above the ordered provider list instead of adding non-brand content inside either button.
- Provider labels stay on one line, use `adjustsFontSizeToFit`, and cap scaling at 1.5 to avoid clipping in the fixed brand geometry.
- `fitToContents` is used on iOS 16+ and Android; iOS 15 uses system medium/large detents because `react-native-screens` rejects content-fit detents below iOS 16. Unknown iOS version strings take the compatible fallback.

---

### Task 1: Unified Social Login Button

**Files:**
- Create: `apps/mobile/src/assets/auth/google-g-logo.png`
- Create: `apps/mobile/src/assets/auth/apple-sign-in-logo.png`
- Create: `apps/mobile/src/screens/auth/social-login-button.tsx`
- Create: `apps/mobile/__tests__/social-login-button.test.tsx`

**Interfaces:**
- Consumes: `SocialProvider = 'google' | 'apple'` from `src/auth/native-social-auth`
- Produces: `SocialLoginButton(props: SocialLoginButtonProps): React.JSX.Element`
- Produces props: `provider`, `label`, `accessibilityLabel`, `busyLabel`, `recentLabel?`, `busy`, `disabled`, and `onPress`

- [x] **Step 1: Add failing geometry, status, busy, and accessibility tests**

Create `apps/mobile/__tests__/social-login-button.test.tsx` with focused renders for both providers:

```tsx
import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SocialLoginButton } from '../src/screens/auth/social-login-button';

test.each(['google', 'apple'] as const)('renders a fixed unified %s row', provider => {
  const renderer = ReactTestRenderer.create(
    <SocialLoginButton
      provider={provider}
      label={`Continue with ${provider}`}
      accessibilityLabel={`Continue with ${provider}`}
      busyLabel="Signing in"
      busy={false}
      disabled={false}
      onPress={jest.fn()}
    />,
  );
  const button = renderer.root.findByProps({ testID: `auth-login-${provider}` });
  const style = StyleSheet.flatten(button.props.style);

  expect(style).toMatchObject({ height: 54, borderRadius: 8 });
  expect(renderer.root.findByProps({ testID: `auth-login-${provider}-icon-slot` }).props.className).toContain('w-11');
  expect(renderer.root.findByProps({ testID: `auth-login-${provider}-status-slot` }).props.className).toContain('w-11');
  expect(button.props.accessibilityRole).toBe('button');
});

test('uses the fixed status slot for recent and busy states', () => {
  const renderer = ReactTestRenderer.create(
    <SocialLoginButton
      provider="google"
      label="Google로 계속"
      accessibilityLabel="Google로 계속하기, 최근 사용"
      busyLabel="로그인 중"
      recentLabel="최근"
      busy={false}
      disabled={false}
      onPress={jest.fn()}
    />,
  );

  expect(renderer.root.findByProps({ testID: 'auth-login-recent-google' }).props.children).toBe('최근');
  renderer.update(
    <SocialLoginButton
      provider="google"
      label="Google로 계속"
      accessibilityLabel="Google로 계속하기, 최근 사용"
      busyLabel="로그인 중"
      recentLabel="최근"
      busy
      disabled
      onPress={jest.fn()}
    />,
  );
  expect(renderer.root.findAllByProps({ testID: 'auth-login-recent-google' })).toHaveLength(0);
  expect(renderer.root.findByProps({ testID: 'auth-login-spinner-google' })).toBeTruthy();
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
yarn workspace @repo/mobile test social-login-button.test.tsx --runInBand
```

Expected: FAIL because `social-login-button.tsx` does not exist.

- [x] **Step 3: Download official provider artwork**

Create the asset directory, download the official Google G, and generate Apple's official white logo-only artwork:

```bash
mkdir -p apps/mobile/src/assets/auth
curl -L "https://developers.google.com/static/identity/images/g-logo.png" -o apps/mobile/src/assets/auth/google-g-logo.png
curl --get "https://appleid.cdn-apple.com/appleid/button/logo" -d "size=44" -d "color=white" -d "border=false" -d "border_radius=0" -d "scale=3" -o apps/mobile/src/assets/auth/apple-sign-in-logo.png
```

Verify both are nonempty PNG files:

```bash
file apps/mobile/src/assets/auth/google-g-logo.png apps/mobile/src/assets/auth/apple-sign-in-logo.png
```

Expected: both lines report `PNG image data`.

- [x] **Step 4: Implement the screen-local provider row**

Create `apps/mobile/src/screens/auth/social-login-button.tsx` with this public shape and fixed layout:

```tsx
import React from 'react';
import { Box } from '../../components/ui/box';
import { Image } from '../../components/ui/image';
import { Pressable } from '../../components/ui/pressable';
import { Spinner } from '../../components/ui/spinner';
import { Text } from '../../components/ui/text';
import type { SocialProvider } from '../../auth/native-social-auth';

export type SocialLoginButtonProps = {
  provider: SocialProvider;
  label: string;
  accessibilityLabel: string;
  busyLabel: string;
  recentLabel?: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
};

const providerLogo = {
  google: require('../../assets/auth/google-g-logo.png'),
  apple: require('../../assets/auth/apple-sign-in-logo.png'),
} as const;

export function SocialLoginButton(props: SocialLoginButtonProps): React.JSX.Element {
  return (
    <Pressable
      testID={`auth-login-${props.provider}`}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: props.busy, disabled: props.disabled }}
      className="w-full flex-row items-center border bg-white px-2 active:opacity-70"
      disabled={props.disabled}
      onPress={props.onPress}
      style={{ height: 54, borderColor: '#747775', borderRadius: 8 }}>
      <Box testID={`auth-login-${props.provider}-icon-slot`} className="w-11 items-center justify-center">
        <Image
          accessible={false}
          source={providerLogo[props.provider]}
          size="none"
          className="h-6 w-6"
        />
      </Box>
      <Text className="flex-1 text-center text-sm font-semibold text-black">{props.label}</Text>
      <Box testID={`auth-login-${props.provider}-status-slot`} className="w-11 items-center justify-center">
        {props.busy ? (
          <Spinner
            testID={`auth-login-spinner-${props.provider}`}
            aria-label={props.busyLabel}
            color="#007aff"
            size="small"
          />
        ) : props.recentLabel ? (
          <Text testID={`auth-login-recent-${props.provider}`} className="text-[11px] font-bold text-primary">
            {props.recentLabel}
          </Text>
        ) : null}
      </Box>
    </Pressable>
  );
}
```

- [x] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
yarn workspace @repo/mobile test social-login-button.test.tsx --runInBand
```

Expected: 1 suite passes with all provider geometry and state tests green.

- [x] **Step 6: Commit Task 1**

```bash
git add apps/mobile/src/assets/auth apps/mobile/src/screens/auth/social-login-button.tsx apps/mobile/__tests__/social-login-button.test.tsx
git commit -m "feat: add unified social login control"
```

---

### Task 2: Content-Fit Login Screen

**Files:**
- Modify: `apps/mobile/src/screens/auth/login-screen.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: `apps/mobile/__tests__/auth-screens.test.tsx`
- Modify: `apps/mobile/__tests__/i18n.test.ts`

**Interfaces:**
- Consumes: `SocialLoginButton` from Task 1
- Keeps: `auth.signIn(provider: SocialProvider): Promise<void>`
- Produces: ordered provider rows with stable recent, busy, and error status slots

- [x] **Step 1: Replace native-control expectations with failing unified-screen tests**

Remove the Google and Apple native button mocks and replace `findNativeProviderButton` with:

```tsx
function findProviderButton(root: ReactTestRenderer.ReactTestInstance, provider: SocialProvider) {
  return root.findByProps({ testID: `auth-login-${provider}` });
}
```

Add assertions for provider order, visible recent label, content-only structure, and fixed error space:

```tsx
test('orders the recent provider first and keeps its visible fixed-slot label', async () => {
  createAuthFixture({ recentProvider: 'apple' });
  const renderer = await render(<LoginScreen />);
  const providerRows = renderer.root.findAll(
    node => typeof node.props.testID === 'string' && /^auth-login-(google|apple)$/.test(node.props.testID),
  );

  expect(providerRows.map(node => node.props.testID)).toEqual(['auth-login-apple', 'auth-login-google']);
  expect(renderer.root.findByProps({ testID: 'auth-login-recent-apple' }).props.children).toBe('최근');
  expect(findProviderButton(renderer.root, 'apple').props.accessibilityLabel).toContain('최근 사용');
});

test('renders a compact non-scrolling sheet body with stable status space', async () => {
  createAuthFixture();
  const renderer = await render(<LoginScreen />);

  expect(renderer.root.findAllByType(require('../src/components/ui/scroll-view').ScrollView)).toHaveLength(0);
  expect(renderer.root.findByProps({ testID: 'auth-login-brand-mark' })).toBeTruthy();
  expect(renderer.root.findByProps({ testID: 'auth-login-status-row' }).props.className).toContain('min-h-11');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('기존 기록은 이 기기에 유지됩니다.');
});
```

Update the busy test to expect `auth-login-spinner-google` and the fixed status row without changing its class.

- [x] **Step 2: Run Auth and i18n tests and verify RED**

Run:

```bash
yarn workspace @repo/mobile test auth-screens.test.tsx i18n.test.ts --runInBand
```

Expected: FAIL on native controls, old order, old title/copy, ScrollView, and missing fixed status row.

- [x] **Step 3: Implement ordered unified provider rows**

In `login-screen.tsx`, remove native button imports, `ScrollView`, `ProviderControl`, and `nativeProviderButtonStyle`. Add:

```tsx
function orderProviders(providers: SocialProvider[], recentProvider?: SocialProvider): SocialProvider[] {
  if (!recentProvider || !providers.includes(recentProvider)) {
    return [...providers];
  }

  return [recentProvider, ...providers.filter(provider => provider !== recentProvider)];
}
```

Track the selected provider independently from the global lock:

```tsx
const [busyProvider, setBusyProvider] = React.useState<SocialProvider>();
const orderedProviders = orderProviders(providers, auth.recentProvider);

const signIn = React.useCallback(async (provider: SocialProvider) => {
  if (actionInFlight.current) return;
  actionInFlight.current = true;
  setBusyProvider(provider);
  setHasError(false);
  try {
    await auth.signIn(provider);
  } catch {
    setHasError(true);
  } finally {
    actionInFlight.current = false;
    setBusyProvider(undefined);
  }
}, [auth]);
```

Render a fixed non-scrolling VStack with decorative D mark, heading, close control, mapped `SocialLoginButton` rows, and an always-present status row:

```tsx
<SafeAreaView testID="auth-login-safe-area" edges={['bottom']} className="bg-background">
  <VStack testID="auth-login-screen" space="lg" className="px-5 pb-5 pt-4">
    <Box className="relative min-h-11 justify-center">
      <Box testID="auth-login-brand-mark" accessible={false} className="mx-auto h-11 w-11 items-center justify-center rounded-xl bg-primary">
        <Text className="text-xl font-bold text-white">D</Text>
      </Box>
      {onClose ? (
        <Button
          testID="auth-login-close"
          accessibilityLabel={t('auth.login.close')}
          accessibilityRole="button"
          accessibilityState={{ disabled: busyProvider !== undefined }}
          className="absolute right-0 h-11 w-11 rounded-full bg-muted"
          disabled={busyProvider !== undefined}
          onPress={onClose}
          size="icon"
          variant="ghost">
          <ButtonIcon as={CloseIcon} className="text-foreground" />
        </Button>
      ) : null}
    </Box>
    <Text accessibilityRole="header" className="text-center text-2xl font-semibold text-foreground">
      {t('auth.login.title')}
    </Text>
    <VStack space="sm">
      {orderedProviders.map(provider => (
        <SocialLoginButton
          key={provider}
          provider={provider}
          label={t(`auth.login.${provider}`)}
          accessibilityLabel={getProviderAccessibilityLabel(
            t(`auth.login.${provider}AccessibilityLabel`),
            auth.recentProvider === provider,
            t('auth.login.recent'),
          )}
          busyLabel={t('auth.login.signingIn')}
          recentLabel={auth.recentProvider === provider ? t('auth.login.recentShort') : undefined}
          busy={busyProvider === provider}
          disabled={busyProvider !== undefined}
          onPress={() => signIn(provider)}
        />
      ))}
    </VStack>
    <Box testID="auth-login-status-row" className="min-h-11 justify-center">
      {hasError ? (
        <Text
          testID="auth-login-error"
          accessibilityRole="alert"
          className="text-center text-sm leading-5 text-destructive">
          {t('auth.login.error')}
        </Text>
      ) : null}
    </Box>
  </VStack>
</SafeAreaView>
```

Keep the existing unavailable state in place of the provider VStack and retain the close control.

- [x] **Step 4: Update exact localized copy**

In both Korean and English resources:

```ts
title: 'Divenary 로그인',
google: 'Google로 계속',
apple: 'Apple로 계속',
recent: '최근 사용',
recentShort: '최근',
signingIn: '로그인 중',
```

```ts
title: 'Log in to Divenary',
google: 'Continue with Google',
apple: 'Continue with Apple',
recent: 'Recently used',
recentShort: 'Recent',
signingIn: 'Signing in',
```

Remove `guestBoundaryNote` in both languages and update `i18n.test.ts` to assert the new title and short recent label.

- [x] **Step 5: Run Auth and i18n tests and verify GREEN**

Run:

```bash
yarn workspace @repo/mobile test auth-screens.test.tsx i18n.test.ts social-login-button.test.tsx --runInBand
```

Expected: all 3 suites pass.

- [x] **Step 6: Commit Task 2**

```bash
git add apps/mobile/src/screens/auth/login-screen.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__/auth-screens.test.tsx apps/mobile/__tests__/i18n.test.ts
git commit -m "feat: rebuild login sheet layout"
```

---

### Task 3: Lightweight Home Action And Sheet Presentation

**Files:**
- Modify: `apps/mobile/src/screens/home/screen.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/__tests__/App.test.tsx`
- Modify: `apps/mobile/__tests__/apple-design-system.test.tsx`

**Interfaces:**
- Keeps: `HomeScreenProps.showLogin?: boolean` and `onOpenLogin?: () => void`
- Changes: `authLogin` sheet detents from `[0.62, 0.9]` to `'fitToContents'`

- [x] **Step 1: Write failing Home-action and sheet-option tests**

Update `App.test.tsx` assertions:

```tsx
const loginAction = root.findByProps({ testID: 'home-login-action' });
expect(loginAction.props.className).toContain('min-h-11');
expect(loginAction.props.className).toContain('min-w-[52px]');
expect(loginAction.props.className).toContain('bg-transparent');
expect(root.findAllByProps({ testID: 'home-login-action-icon' })).toHaveLength(0);

expect(navigationSource).toContain("sheetAllowedDetents: 'fitToContents'");
expect(navigationSource).not.toContain('sheetAllowedDetents: [0.62, 0.9]');
```

Update `apple-design-system.test.tsx` to require the Home login source to use `Pressable` and reject an `InstrumentButton` with `testID="home-login-action"`.

- [x] **Step 2: Run App and design tests and verify RED**

Run:

```bash
yarn workspace @repo/mobile test App.test.tsx apple-design-system.test.tsx --runInBand
```

Expected: FAIL because Home still renders a filled `InstrumentButton` and navigation still uses two numeric detents.

- [x] **Step 3: Implement the text action and content-fit sheet**

Import `Pressable` in Home and replace only the login action:

```tsx
<Pressable
  testID="home-login-action"
  accessibilityLabel={t('home.login')}
  accessibilityRole="button"
  className="min-h-11 min-w-[52px] items-center justify-center bg-transparent px-1 active:opacity-60"
  onPress={props.onOpenLogin}>
  <Text className="text-base font-semibold text-primary">{t('home.login')}</Text>
</Pressable>
```

In `RootNavigation`, keep the form sheet options and change only the detent:

```tsx
options={{
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  sheetCornerRadius: 28,
}}
```

- [x] **Step 4: Run App and design tests and verify GREEN**

Run:

```bash
yarn workspace @repo/mobile test App.test.tsx apple-design-system.test.tsx --runInBand
```

Expected: both suites pass.

- [x] **Step 5: Commit Task 3**

```bash
git add apps/mobile/src/screens/home/screen.tsx apps/mobile/src/components/navigation/index.tsx apps/mobile/__tests__/App.test.tsx apps/mobile/__tests__/apple-design-system.test.tsx
git commit -m "feat: refine login entry presentation"
```

---

### Task 4: Integrated Verification And Review

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-login-entry-redesign.md`

**Interfaces:**
- Verifies all Task 1-3 deliverables without changing Auth contracts or native provider adapters

- [x] **Step 1: Run focused regression tests**

```bash
yarn workspace @repo/mobile test social-login-button.test.tsx auth-screens.test.tsx App.test.tsx apple-design-system.test.tsx i18n.test.ts --runInBand
```

Result: 4 focused suites passed with 43 tests after the review amendment.

- [x] **Step 2: Run complete static and test gates**

```bash
yarn mobile:typecheck
yarn workspace @repo/mobile test --runInBand
```

Result: TypeScript exited 0; 43 Jest suites passed with 429 tests.

- [x] **Step 3: Run native mobile build gates**

```bash
yarn ios:build
cd apps/mobile/android && ./gradlew assembleDebug
```

Result: iOS reported `BUILD SUCCEEDED`; Android reported `BUILD SUCCESSFUL`. The font was also verified in both the iOS app bundle and Android APK.

- [x] **Step 4: Review the final diff**

Confirm all of the following:

```text
- No native credential adapter, Supabase repository, consent, or guest-data code changed.
- No unrelated dirty file is staged.
- Both brand assets came from the official URLs recorded in Task 1.
- Provider rows stay 44pt with compliant provider artwork and a symmetric busy-status slot.
- Home login remains guest-only and has no filled InstrumentButton styling.
- Login sheet has no ScrollView, guest boundary copy, or layout-shifting overlay dot; only iOS 15 receives the required medium/large fallback detents.
```

- [x] **Step 5: Mark plan complete and commit verification metadata**

Change every completed checkbox in this plan to `[x]`, then:

```bash
git add docs/superpowers/plans/2026-07-17-login-entry-redesign.md
git commit -m "docs: complete login entry redesign plan"
```
