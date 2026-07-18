let mockAuth: AuthContextValue;

jest.mock('../src/states/auth', () => ({
  useAuth: () => mockAuth,
}));

import type { RequiredLegalDocument } from '@repo/supabase';
import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import i18n from '../src/i18n';
import { ScrollView } from '../src/components/ui/scroll-view';
import LoginScreen from '../src/screens/auth/login-screen';
import OnboardingScreen from '../src/screens/auth/onboarding-screen';
import { SocialLoginButton } from '../src/screens/auth/social-login-button';
import type { SocialProvider } from '../src/auth/native-social-auth';
import type { AuthContextValue, AuthState } from '../src/states/auth';

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
    renderer = ReactTestRenderer.create(element);
  });
  mountedRenderers.push(renderer!);

  return renderer!;
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
  });

  test('renders only configured and platform-available provider buttons', async () => {
    createAuthFixture({ availableProviders: ['google'] });
    const renderer = await render(<LoginScreen />);

    expect(findProviderButton(renderer.root, 'google')).toBeTruthy();
    expect(findProviderButton(renderer.root, 'apple')).toBeUndefined();

    createAuthFixture({ isConfigured: false, availableProviders: [] });
    await ReactTestRenderer.act(async () => {
      renderer.update(<LoginScreen />);
    });

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
    await ReactTestRenderer.act(async () => {
      renderer.update(<LoginScreen />);
    });

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
    const brandMark = renderer.root.findByProps({ testID: 'auth-login-brand-mark' });
    const heading = renderer.root.findByProps({ accessibilityRole: 'header' });
    expect(brandMark.props.accessibilityElementsHidden).toBe(true);
    expect(brandMark.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(heading.props.maxFontSizeMultiplier).toBe(1.5);
    expect(renderer.root.findByProps({ testID: 'auth-login-screen' }).props).toMatchObject({ space: 'md' });
    expect(renderer.root.findAllByProps({ testID: 'auth-login-status-row' })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('기존 기록은 이 기기에 유지됩니다.');
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
    expectAccessibleControl(renderer.root.findByProps({ testID: 'auth-onboarding-submit' }), 'button');
    expectAccessibleControl(renderer.root.findByProps({ testID: 'auth-onboarding-cancel' }), 'button');
  });
});
