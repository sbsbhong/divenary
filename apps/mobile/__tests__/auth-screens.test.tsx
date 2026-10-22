let mockAuth: AuthContextValue;

jest.mock('../src/states/auth', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../src/states/app-preferences', () => ({
  useAppPreferences: () => ({resolvedTheme: 'light'}),
}));

import { AuthRepositoryError, type RequiredLegalDocument } from '@repo/supabase';
import React from 'react';
import { AccessibilityInfo, Image as NativeImage, Linking, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';

import i18n from '../src/i18n';
import { ScrollView } from '../src/components/ui/scroll-view';
import LoginScreen from '../src/screens/auth/login-screen';
import OnboardingScreen from '../src/screens/auth/onboarding-screen';
import { SocialLoginButton } from '../src/screens/auth/social-login-button';
import { NativeSocialAuthError, type SocialProvider } from '../src/auth/native-social-auth';
import type { AuthContextValue, AuthState } from '../src/states/auth';

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const userId = '00000000-0000-4000-8000-000000000001';
const requiredDocuments: RequiredLegalDocument[] = [
  {
    kind: 'terms',
    version: '2026-07-01',
    effectiveAt: '2026-07-01T00:00:00Z',
    documentUrl: 'https://legal.example.com/terms/2026-07-01',
  },
  {
    kind: 'privacy',
    version: '2026-07-02',
    effectiveAt: '2026-07-02T00:00:00Z',
    documentUrl: 'https://legal.example.com/privacy/2026-07-02',
  },
];

const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createAuthFixture(options?: {
  state?: AuthState;
  isConfigured?: boolean;
  availableProviders?: SocialProvider[];
  recentProvider?: SocialProvider;
  signIn?: (provider: SocialProvider) => Promise<void>;
  isDevelopmentSignInAvailable?: boolean;
  signInForDevelopment?: AuthContextValue['signInForDevelopment'];
  completeOnboarding?: AuthContextValue['completeOnboarding'];
}) {
  const signIn = jest.fn(options?.signIn ?? (async (_provider: SocialProvider) => undefined));
  const completeOnboarding = jest.fn(
    options?.completeOnboarding ??
      (async (
        _documents: Array<{
          kind: 'terms' | 'privacy';
          version: string;
        }>,
      ) => undefined),
  );
  const cancelOnboarding = jest.fn(async () => undefined);
  const signOut = jest.fn(async () => undefined);
  const signInForDevelopment = jest.fn(
    options?.signInForDevelopment ?? (async () => undefined),
  );

  mockAuth = {
    state: options?.state ?? { status: 'guest' },
    isConfigured: options?.isConfigured ?? true,
    availableProviders: options?.availableProviders ?? ['google', 'apple'],
    recentProvider: options?.recentProvider,
    isDevelopmentSignInAvailable:
      options?.isDevelopmentSignInAvailable ?? false,
    signIn,
    signInForDevelopment,
    completeOnboarding,
    cancelOnboarding,
    signOut,
  };

  return {
    cancelOnboarding,
    completeOnboarding,
    signIn,
    signInForDevelopment,
    signOut,
  };
}

async function render(element: React.ReactElement) {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={safeAreaMetrics}>{element}</SafeAreaProvider>);
  });
  mountedRenderers.push(renderer!);

  return renderer!;
}

async function rerender(renderer: ReactTestRenderer.ReactTestRenderer, element: React.ReactElement) {
  await ReactTestRenderer.act(async () => {
    renderer.update(<SafeAreaProvider initialMetrics={safeAreaMetrics}>{element}</SafeAreaProvider>);
  });
}

async function advance(milliseconds: number) {
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
}

async function flush() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
}

function findProviderButton(root: ReactTestRenderer.ReactTestInstance, provider: SocialProvider) {
  return root.findAllByProps({ testID: `auth-login-${provider}` })[0];
}

function expectAtLeast44Points(node: ReactTestRenderer.ReactTestInstance) {
  const style = StyleSheet.flatten(node.props.style) ?? {};
  const styleHeight = Math.max(
    typeof style.height === 'number' ? style.height : 0,
    typeof style.minHeight === 'number' ? style.minHeight : 0,
  );
  const className = typeof node.props.className === 'string' ? node.props.className : '';
  const usesAccessibleHeightToken = /(?:^|\s)(?:h-11|h-12|min-h-11|min-h-12)(?:\s|$)/.test(className);

  expect(styleHeight >= 44 || usesAccessibleHeightToken).toBe(true);
}

function expectAccessibleControl(node: ReactTestRenderer.ReactTestInstance, role: 'button' | 'checkbox' | 'link') {
  expect(node.props.accessibilityRole).toBe(role);
  expect(node.props.accessibilityLabel).toEqual(expect.any(String));
  expect(node.props.accessibilityLabel.length).toBeGreaterThan(0);
  expectAtLeast44Points(node);
}

async function setDocumentChecked(root: ReactTestRenderer.ReactTestInstance, kind: 'terms' | 'privacy', checked: boolean) {
  await ReactTestRenderer.act(async () => {
    root.findByProps({ testID: `auth-onboarding-document-${kind}` }).props.onChange(checked);
  });
}

describe('LoginScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      for (const renderer of mountedRenderers.splice(0)) {
        renderer.unmount();
      }
    });
    jest.useRealTimers();
  });

  test('renders only configured and platform-available provider buttons', async () => {
    createAuthFixture({ availableProviders: ['google'] });
    const renderer = await render(<LoginScreen />);

    expect(findProviderButton(renderer.root, 'google')).toBeTruthy();
    expect(findProviderButton(renderer.root, 'apple')).toBeUndefined();

    createAuthFixture({ isConfigured: false, availableProviders: [] });
    await rerender(renderer, <LoginScreen />);

    expect(findProviderButton(renderer.root, 'google')).toBeUndefined();
    expect(findProviderButton(renderer.root, 'apple')).toBeUndefined();
    expect(renderer.root.findByProps({ testID: 'auth-login-screen' })).toBeTruthy();
  });

  test('starts exactly the selected Google or Apple action', async () => {
    const fixture = createAuthFixture();
    const renderer = await render(<LoginScreen />);

    await ReactTestRenderer.act(async () => {
      await findProviderButton(renderer.root, 'google').props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      await findProviderButton(renderer.root, 'apple').props.onPress();
    });

    expect(fixture.signIn).toHaveBeenNthCalledWith(1, 'google');
    expect(fixture.signIn).toHaveBeenNthCalledWith(2, 'apple');
    expect(fixture.signIn).toHaveBeenCalledTimes(2);
  });

  test('renders the local development action only when local credentials are available', async () => {
    createAuthFixture({
      availableProviders: [],
      isDevelopmentSignInAvailable: true,
    });
    const renderer = await render(<LoginScreen />);

    expect(
      renderer.root.findByProps({testID: 'auth-login-development'}).props
        .accessibilityLabel,
    ).toBe('로컬 테스트 계정');
    expect(findProviderButton(renderer.root, 'google')).toBeUndefined();
    expect(findProviderButton(renderer.root, 'apple')).toBeUndefined();

    createAuthFixture({availableProviders: []});
    await rerender(renderer, <LoginScreen />);

    expect(
      renderer.root.findAllByProps({testID: 'auth-login-development'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findByProps({testID: 'auth-login-screen'}),
    ).toBeTruthy();
  });

  test('renders no social fallback when local composition has no valid credentials', async () => {
    createAuthFixture({
      availableProviders: [],
      isDevelopmentSignInAvailable: false,
    });
    const renderer = await render(<LoginScreen />);

    expect(findProviderButton(renderer.root, 'google')).toBeUndefined();
    expect(findProviderButton(renderer.root, 'apple')).toBeUndefined();
    expect(
      renderer.root.findAllByProps({testID: 'auth-login-development'}),
    ).toHaveLength(0);
    expect(renderer.root.findByProps({testID: 'auth-login-screen'})).toBeTruthy();
  });

  test('gives the local development action an accessible 44-point target', async () => {
    createAuthFixture({
      availableProviders: [],
      isDevelopmentSignInAvailable: true,
    });
    const renderer = await render(<LoginScreen />);

    expectAccessibleControl(
      renderer.root.findByProps({testID: 'auth-login-development'}),
      'button',
    );
  });

  test('locks the local development action, prevents close, and displays generic retry copy on failure', async () => {
    jest.useFakeTimers();
    const deferred = createDeferred<void>();
    const fixture = createAuthFixture({
      availableProviders: [],
      isDevelopmentSignInAvailable: true,
      signInForDevelopment: async () => deferred.promise,
    });
    const onClose = jest.fn();
    const renderer = await render(<LoginScreen onClose={onClose} />);
    const developmentButton = () =>
      renderer.root.findByProps({testID: 'auth-login-development'});

    await ReactTestRenderer.act(async () => {
      developmentButton().props.onPress();
      await Promise.resolve();
    });

    expect(fixture.signInForDevelopment).toHaveBeenCalledTimes(1);
    expect(developmentButton().props.disabled).toBe(true);
    expect(renderer.root.findByProps({testID: 'auth-login-close'}).props.disabled).toBe(true);
    // Busy and disabled at 0 ms; the spinner waits for the shared 1 s delay.
    expect(renderer.root.findAllByProps({testID: 'auth-login-spinner-development'})).toHaveLength(0);
    await advance(1000);
    expect(renderer.root.findByProps({testID: 'auth-login-spinner-development'})).toBeTruthy();

    deferred.reject(new Error('raw-password@example.com'));
    await flush();

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('다시 시도');
    expect(rendered).not.toContain('raw-password@example.com');
    expect(developmentButton().props.disabled).toBe(false);
  });

  test('orders the recent provider first and keeps its visible label outside the branded button', async () => {
    createAuthFixture({ recentProvider: 'apple' });
    const renderer = await render(<LoginScreen />);

    const providerRows = renderer.root.findAllByType(SocialLoginButton);
    const appleButton = findProviderButton(renderer.root, 'apple');

    expect(providerRows.map(node => node.props.provider)).toEqual(['apple', 'google']);
    expect(renderer.root.findByProps({ testID: 'auth-login-recent-provider' }).props.children).toBe('최근 사용');
    expect(appleButton.props.accessibilityLabel).toBe('Apple로 계속하기, 최근 사용');
    expect(renderer.root.findAllByProps({ testID: 'auth-login-recent-apple' })).toHaveLength(0);
  });

  test('applies only the bottom safe area inside the navigation form sheet', async () => {
    createAuthFixture();
    const renderer = await render(<LoginScreen />);

    expect(renderer.root.findByProps({ testID: 'auth-login-safe-area' }).props.edges).toEqual(['bottom']);
  });

  test('renders a compact non-scrolling sheet body without an idle footer', async () => {
    createAuthFixture();
    const renderer = await render(<LoginScreen />);

    expect(renderer.root.findAllByType(ScrollView)).toHaveLength(0);
    const brandMark = renderer.root
      .findAllByType(NativeImage)
      .find(node => node.props.testID === 'auth-login-brand-mark');
    const heading = renderer.root.findByProps({ accessibilityRole: 'header' });
    expect(brandMark?.props.accessibilityElementsHidden).toBe(true);
    expect(brandMark?.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(brandMark?.props.className).toContain('h-11');
    expect(brandMark?.props.className).toContain('w-11');
    expect(heading.props.maxFontSizeMultiplier).toBe(1.5);
    expect(renderer.root.findByProps({ testID: 'auth-login-screen' }).props).toMatchObject({ space: 'md' });
    expect(renderer.root.findAllByProps({ testID: 'auth-login-status-row' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'auth-login-progress' })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('"children":["D"]');
  });

  test('says why to sign in and that records on this device stay until the user imports them', async () => {
    createAuthFixture();
    const renderer = await render(<LoginScreen />);

    expect(renderer.root.findByProps({ testID: 'auth-login-benefit' }).props.children).toBe(
      '기록을 백업하고 여러 기기에서 동기화합니다.',
    );
    expect(renderer.root.findByProps({ testID: 'auth-login-device-records' }).props.children).toBe(
      '이 기기의 기록은 직접 가져오기 전까지 유지됩니다.',
    );
  });

  test('passes the resolved app theme to the provider buttons', async () => {
    createAuthFixture();
    const renderer = await render(<LoginScreen />);

    expect(renderer.root.findAllByType(SocialLoginButton).map(node => node.props.theme)).toEqual(['light', 'light']);
  });

  test.each([
    ['offline', new AuthRepositoryError('network', { operation: 'sign-in' }), '네트워크에 연결할 수 없습니다. 연결을 확인한 뒤 다시 시도하세요.'],
    ['a server problem', new AuthRepositoryError('server', { operation: 'sign-in', status: 500 }), '로그인 서버에 문제가 있습니다. 잠시 후 다시 시도하세요.'],
    ['a provider failure', new NativeSocialAuthError('provider'), '이 방법으로 로그인하지 못했습니다. 다시 시도하거나 다른 방법으로 로그인하세요.'],
    ['an unknown failure', new Error('raw-provider-payload@example.com'), '로그인하지 못했습니다. 다시 시도하세요.'],
  ])('explains %s and announces it', async (_caseName, error, message) => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    createAuthFixture({
      signIn: async (_provider: SocialProvider) => {
        throw error;
      },
    });
    const renderer = await render(<LoginScreen />);

    await ReactTestRenderer.act(async () => {
      await findProviderButton(renderer.root, 'apple').props.onPress();
    });

    expect(renderer.root.findByProps({ testID: 'auth-login-error' }).props.children).toBe(message);
    expect(announce).toHaveBeenCalledWith(message);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('raw-provider-payload@example.com');
    announce.mockRestore();
  });

  test('adds a short line at 4 s and a network hint at 10 s while Auth is still exchanging the token', async () => {
    jest.useFakeTimers();
    createAuthFixture({ state: { status: 'authenticating', provider: 'apple' } });
    const renderer = await render(<LoginScreen />);
    const progress = () => renderer.root.findAllByProps({ testID: 'auth-login-progress' });

    await advance(3999);
    expect(progress()).toHaveLength(0);

    await advance(1);
    expect(progress()[0]?.props.children).toBe('로그인을 확인하는 중입니다.');

    await advance(6000);
    expect(progress()[0]?.props.children).toBe('시간이 오래 걸리고 있습니다. 네트워크 연결을 확인하세요.');

    createAuthFixture({ state: { status: 'guest' } });
    await rerender(renderer, <LoginScreen />);
    expect(progress()).toHaveLength(0);
  });

  test('keeps cancellation neutral and leaves the login screen usable', async () => {
    const fixture = createAuthFixture({
      signIn: async (_provider: SocialProvider) => undefined,
    });
    const renderer = await render(<LoginScreen />);

    await ReactTestRenderer.act(async () => {
      await findProviderButton(renderer.root, 'google').props.onPress();
    });

    expect(fixture.signIn).toHaveBeenCalledWith('google');
    expect(renderer.root.findAllByProps({ testID: 'auth-login-error' })).toHaveLength(0);
    expect(findProviderButton(renderer.root, 'google').props.disabled).toBe(false);
  });

  test('locks both actions while signing in and replaces provider errors with retry copy', async () => {
    jest.useFakeTimers();
    const deferred = createDeferred<void>();
    const fixture = createAuthFixture({
      signIn: async (_provider: SocialProvider) => deferred.promise,
    });
    const renderer = await render(<LoginScreen />);

    await ReactTestRenderer.act(async () => {
      findProviderButton(renderer.root, 'google').props.onPress();
      await Promise.resolve();
    });

    expect(fixture.signIn).toHaveBeenCalledTimes(1);
    expect(findProviderButton(renderer.root, 'google').props.disabled).toBe(true);
    expect(findProviderButton(renderer.root, 'apple').props.disabled).toBe(true);
    // Locked at 0 ms, spinner only after the shared 1 s delay.
    expect(renderer.root.findAllByProps({ testID: 'auth-login-spinner-google' })).toHaveLength(0);
    await advance(1000);
    expect(renderer.root.findByProps({ testID: 'auth-login-spinner-google' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ testID: 'auth-login-status-row' })).toHaveLength(0);

    deferred.reject(new Error('raw-provider-payload@example.com'));
    await flush();

    const rendered = JSON.stringify(renderer.toJSON());
    const error = renderer.root.findByProps({ testID: 'auth-login-error' });
    expect(rendered).toContain('다시 시도');
    expect(rendered).not.toContain('raw-provider-payload@example.com');
    expect(renderer.root.findByProps({ testID: 'auth-login-status-row' })).toBeTruthy();
    expect(error.props.maxFontSizeMultiplier).toBe(1.5);
    expect(findProviderButton(renderer.root, 'google').props.disabled).toBe(false);
  });

  test('gives both provider buttons accessible 44-point targets', async () => {
    createAuthFixture();
    const renderer = await render(<LoginScreen />);

    expectAccessibleControl(findProviderButton(renderer.root, 'google'), 'button');
    expectAccessibleControl(findProviderButton(renderer.root, 'apple'), 'button');
  });
});

describe('OnboardingScreen', () => {
  let openUrlSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  afterEach(async () => {
    openUrlSpy.mockRestore();
    await ReactTestRenderer.act(async () => {
      for (const renderer of mountedRenderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  test('starts every required document unchecked and disables submission', async () => {
    createAuthFixture({
      state: {
        status: 'pendingOnboarding',
        userId,
        documents: requiredDocuments,
      },
    });
    const renderer = await render(<OnboardingScreen />);

    for (const kind of ['terms', 'privacy'] as const) {
      const control = renderer.root.findByProps({
        testID: `auth-onboarding-document-${kind}`,
      });
      expect(control.props.isChecked).toBe(false);
      expect(control.props.accessibilityState.checked).toBe(false);
    }
    expect(renderer.root.findByProps({ testID: 'auth-onboarding-submit' }).props.disabled).toBe(true);
  });

  test('submits exactly the rendered kind and version pairs after all are checked', async () => {
    const fixture = createAuthFixture({
      state: {
        status: 'pendingOnboarding',
        userId,
        documents: requiredDocuments,
      },
    });
    const renderer = await render(<OnboardingScreen />);

    await setDocumentChecked(renderer.root, 'terms', true);
    expect(renderer.root.findByProps({ testID: 'auth-onboarding-submit' }).props.disabled).toBe(true);
    await setDocumentChecked(renderer.root, 'privacy', true);

    const submit = renderer.root.findByProps({
      testID: 'auth-onboarding-submit',
    });
    expect(submit.props.disabled).toBe(false);
    await ReactTestRenderer.act(async () => {
      await submit.props.onPress();
    });

    expect(fixture.completeOnboarding).toHaveBeenCalledTimes(1);
    expect(fixture.completeOnboarding).toHaveBeenCalledWith([
      { kind: 'terms', version: '2026-07-01' },
      { kind: 'privacy', version: '2026-07-02' },
    ]);
  });

  test('explicit cancel delegates to the session-ending onboarding action', async () => {
    const fixture = createAuthFixture({
      state: {
        status: 'pendingOnboarding',
        userId,
        documents: requiredDocuments,
      },
    });
    const renderer = await render(<OnboardingScreen />);

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'auth-onboarding-cancel' }).props.onPress();
    });

    expect(fixture.cancelOnboarding).toHaveBeenCalledTimes(1);
  });

  test('opens only parsed HTTPS legal-document links', async () => {
    createAuthFixture({
      state: {
        status: 'pendingOnboarding',
        userId,
        documents: requiredDocuments,
      },
    });
    const renderer = await render(<OnboardingScreen />);

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'auth-onboarding-link-terms' }).props.onPress();
      await renderer.root.findByProps({ testID: 'auth-onboarding-link-privacy' }).props.onPress();
    });

    expect(openUrlSpy).toHaveBeenNthCalledWith(1, 'https://legal.example.com/terms/2026-07-01');
    expect(openUrlSpy).toHaveBeenNthCalledWith(2, 'https://legal.example.com/privacy/2026-07-02');
    expect(openUrlSpy).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['plain HTTP', 'http://legal.example.com/terms'],
    ['a non-URL value', 'not a legal document URL'],
  ])('rejects %s legal links with generic retry copy', async (_caseName, url) => {
    const documents: RequiredLegalDocument[] = [{ ...requiredDocuments[0], documentUrl: url }, requiredDocuments[1]];
    createAuthFixture({
      state: { status: 'pendingOnboarding', userId, documents },
    });
    const renderer = await render(<OnboardingScreen />);
    const invalidLinks = renderer.root.findAllByProps({
      testID: 'auth-onboarding-link-terms',
    });

    if (invalidLinks[0]) {
      await ReactTestRenderer.act(async () => {
        await invalidLinks[0].props.onPress();
      });
    }

    const rendered = JSON.stringify(renderer.toJSON());
    expect(openUrlSpy).not.toHaveBeenCalledWith(url);
    expect(rendered).toContain('다시 시도');
    expect(rendered).not.toContain(url);
  });

  test('locks duplicate completion attempts and hides raw submission errors', async () => {
    const deferred = createDeferred<void>();
    const fixture = createAuthFixture({
      state: {
        status: 'pendingOnboarding',
        userId,
        documents: requiredDocuments,
      },
      completeOnboarding: async () => deferred.promise,
    });
    const renderer = await render(<OnboardingScreen />);
    await setDocumentChecked(renderer.root, 'terms', true);
    await setDocumentChecked(renderer.root, 'privacy', true);

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'auth-onboarding-submit' }).props.onPress();
      await Promise.resolve();
    });

    expect(fixture.completeOnboarding).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ testID: 'auth-onboarding-submit' }).props.disabled).toBe(true);

    deferred.reject(new Error('raw-consent-rpc-payload'));
    await flush();

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('다시 시도');
    expect(rendered).not.toContain('raw-consent-rpc-payload');
    expect(renderer.root.findByProps({ testID: 'auth-onboarding-submit' }).props.disabled).toBe(false);
  });

  test('checks and clears every required document from the agree-all row', async () => {
    createAuthFixture({
      state: { status: 'pendingOnboarding', userId, documents: requiredDocuments },
    });
    const renderer = await render(<OnboardingScreen />);
    const allRow = () => renderer.root.findByProps({ testID: 'auth-onboarding-all' });

    expect(allRow().props.accessibilityRole).toBe('checkbox');
    expect(allRow().props.isChecked).toBe(false);

    await ReactTestRenderer.act(async () => {
      allRow().props.onChange(true);
    });
    for (const kind of ['terms', 'privacy'] as const) {
      expect(renderer.root.findByProps({ testID: `auth-onboarding-document-${kind}` }).props.isChecked).toBe(true);
    }
    expect(allRow().props.isChecked).toBe(true);
    expect(renderer.root.findByProps({ testID: 'auth-onboarding-submit' }).props.disabled).toBe(false);

    await setDocumentChecked(renderer.root, 'privacy', false);
    expect(allRow().props.isChecked).toBe(false);

    await ReactTestRenderer.act(async () => {
      allRow().props.onChange(false);
    });
    expect(renderer.root.findByProps({ testID: 'auth-onboarding-document-terms' }).props.isChecked).toBe(false);
    expect(renderer.root.findByProps({ testID: 'auth-onboarding-submit' }).props.disabled).toBe(true);
  });

  test('marks each document as required and shows its effective date in the active language', async () => {
    createAuthFixture({
      state: { status: 'pendingOnboarding', userId, documents: requiredDocuments },
    });
    const renderer = await render(<OnboardingScreen />);
    let rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('[필수] 이용약관');
    expect(rendered).toContain('[필수] 개인정보 처리방침');
    expect(rendered).toContain('2026년 7월 1일 시행');
    expect(rendered).toContain('2026년 7월 2일 시행');
    expect(rendered).not.toContain('2026-07-01');

    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
    });
    rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('[Required] Terms of service');
    expect(rendered).toContain('Effective July 1, 2026');
  });

  test('keeps the agree label while saving instead of swapping it', async () => {
    const deferred = createDeferred<void>();
    createAuthFixture({
      state: { status: 'pendingOnboarding', userId, documents: requiredDocuments },
      completeOnboarding: async () => deferred.promise,
    });
    const renderer = await render(<OnboardingScreen />);
    await setDocumentChecked(renderer.root, 'terms', true);
    await setDocumentChecked(renderer.root, 'privacy', true);

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'auth-onboarding-submit' }).props.onPress();
      await Promise.resolve();
    });

    const submit = renderer.root.findByProps({ testID: 'auth-onboarding-submit' });
    expect(submit.props.pending).toBe(true);
    expect(submit.props.label).toBe('동의하고 계속');
    expect(renderer.root.findByProps({ testID: 'auth-onboarding-cancel' }).props.disabled).toBe(true);

    await ReactTestRenderer.act(async () => {
      deferred.resolve();
      await deferred.promise;
    });
  });

  test('lets the user retry a legal document that failed to open', async () => {
    createAuthFixture({
      state: { status: 'pendingOnboarding', userId, documents: requiredDocuments },
    });
    openUrlSpy.mockRejectedValueOnce(new Error('no handler')).mockResolvedValue(undefined);
    const renderer = await render(<OnboardingScreen />);

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'auth-onboarding-link-terms' }).props.onPress();
    });

    expect(renderer.root.findByProps({ testID: 'auth-onboarding-error' }).props.children).toBe(
      '문서를 열지 못했습니다. 다시 시도해 주세요.',
    );

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'auth-onboarding-retry' }).props.onPress();
      await Promise.resolve();
    });

    expect(openUrlSpy).toHaveBeenCalledTimes(2);
    expect(openUrlSpy).toHaveBeenLastCalledWith('https://legal.example.com/terms/2026-07-01');
    expect(renderer.root.findAllByProps({ testID: 'auth-onboarding-error' })).toHaveLength(0);
  });

  test('explains missing documents and leaves cancel as the way out', async () => {
    createAuthFixture({
      state: { status: 'pendingOnboarding', userId, documents: [] },
    });
    const renderer = await render(<OnboardingScreen />);

    expect(renderer.root.findByProps({ testID: 'auth-onboarding-error' }).props.children).toBe(
      '필수 문서를 불러오지 못했습니다. 로그인을 취소한 뒤 다시 시도해 주세요.',
    );
    expect(renderer.root.findByProps({ testID: 'auth-onboarding-submit' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ testID: 'auth-onboarding-cancel' }).props.disabled).toBe(false);
  });

  test('makes consent, legal links, submit, and cancel accessible 44-point controls', async () => {
    createAuthFixture({
      state: {
        status: 'pendingOnboarding',
        userId,
        documents: requiredDocuments,
      },
    });
    const renderer = await render(<OnboardingScreen />);

    for (const kind of ['terms', 'privacy'] as const) {
      expectAccessibleControl(
        renderer.root.findByProps({
          testID: `auth-onboarding-document-${kind}`,
        }),
        'checkbox',
      );
      expectAccessibleControl(
        renderer.root.findByProps({
          testID: `auth-onboarding-link-${kind}`,
        }),
        'link',
      );
    }
    expectAccessibleControl(renderer.root.findByProps({ testID: 'auth-onboarding-all' }), 'checkbox');
    expectAccessibleControl(renderer.root.findByProps({ testID: 'auth-onboarding-submit' }), 'button');
    expectAccessibleControl(renderer.root.findByProps({ testID: 'auth-onboarding-cancel' }), 'button');
  });
});
