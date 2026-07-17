jest.mock('@react-native-google-signin/google-signin', () => {
  const ReactModule = require('react') as typeof import('react');

  const GoogleSigninButton = (props: Record<string, unknown>) => ReactModule.createElement('mock-google-signin-button', props);

  Object.assign(GoogleSigninButton, {
    Color: { Dark: 'dark', Light: 'light' },
    Size: { Icon: 0, Standard: 1, Wide: 2 },
  });

  return {
    GoogleSignin: {
      configure: jest.fn(),
      signIn: jest.fn(),
    },
    GoogleSigninButton,
    isCancelledResponse: (response: { type?: string }) => response.type === 'cancelled',
    isSuccessResponse: (response: { type?: string }) => response.type === 'success',
  };
});

jest.mock('@invertase/react-native-apple-authentication', () => {
  const ReactModule = require('react') as typeof import('react');

  const AppleButton = (props: Record<string, unknown>) => ReactModule.createElement('mock-apple-button', props);

  Object.assign(AppleButton, {
    Style: { BLACK: 'Black', DEFAULT: 'Default', WHITE: 'White', WHITE_OUTLINE: 'WhiteOutline' },
    Type: { CONTINUE: 'Continue', DEFAULT: 'Default', SIGN_IN: 'SignIn' },
  });

  const appleAuth = {
    isSupported: true,
    performRequest: jest.fn(),
    Error: { CANCELED: '1001' },
    Operation: { LOGIN: 1 },
    Scope: { EMAIL: 0, FULL_NAME: 1 },
  };

  return {
    __esModule: true,
    AppleButton,
    appleAuth,
    default: appleAuth,
  };
});

let mockAuth: AuthContextValue;

jest.mock('../src/states/auth', () => ({
  useAuth: () => mockAuth,
}));

import type { RequiredLegalDocument } from '@repo/supabase';
import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import i18n from '../src/i18n';
import LoginScreen from '../src/screens/auth/login-screen';
import OnboardingScreen from '../src/screens/auth/onboarding-screen';
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

  mockAuth = {
    state: options?.state ?? { status: 'guest' },
    isConfigured: options?.isConfigured ?? true,
    availableProviders: options?.availableProviders ?? ['google', 'apple'],
    recentProvider: options?.recentProvider,
    signIn,
    completeOnboarding,
    cancelOnboarding,
    signOut,
  };

  return { cancelOnboarding, completeOnboarding, signIn, signOut };
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

function findNativeProviderButton(root: ReactTestRenderer.ReactTestInstance, provider: SocialProvider) {
  const hostType = provider === 'google' ? 'mock-google-signin-button' : 'mock-apple-button';

  return root.findAll(node => (node.type as unknown) === hostType)[0];
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

    expect(findNativeProviderButton(renderer.root, 'google')).toBeTruthy();
    expect(findNativeProviderButton(renderer.root, 'apple')).toBeUndefined();

    createAuthFixture({ isConfigured: false, availableProviders: [] });
    await ReactTestRenderer.act(async () => {
      renderer.update(<LoginScreen />);
    });

    expect(findNativeProviderButton(renderer.root, 'google')).toBeUndefined();
    expect(findNativeProviderButton(renderer.root, 'apple')).toBeUndefined();
    expect(renderer.root.findByProps({ testID: 'auth-login-screen' })).toBeTruthy();
  });

  test('starts exactly the selected Google or Apple action', async () => {
    const fixture = createAuthFixture();
    const renderer = await render(<LoginScreen />);

    await ReactTestRenderer.act(async () => {
      await findNativeProviderButton(renderer.root, 'google').props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      await findNativeProviderButton(renderer.root, 'apple').props.onPress();
    });

    expect(fixture.signIn).toHaveBeenNthCalledWith(1, 'google');
    expect(fixture.signIn).toHaveBeenNthCalledWith(2, 'apple');
    expect(fixture.signIn).toHaveBeenCalledTimes(2);
  });

  test('renders the recent-provider label without exposing account data', async () => {
    createAuthFixture({ recentProvider: 'apple' });
    const renderer = await render(<LoginScreen />);

    const recentMarker = renderer.root.findByProps({ testID: 'auth-login-recent-apple' });
    const appleButton = findNativeProviderButton(renderer.root, 'apple');
    expect(recentMarker.props.className).toContain('absolute');
    expect(recentMarker.props.pointerEvents).toBe('none');
    expect(recentMarker.props.accessible).toBe(false);
    expect(appleButton.props.accessibilityLabel).toBe('Apple로 계속하기, 최근 사용');
    expect(recentMarker.props.children).toBeUndefined();
    expect(renderer.root.findAllByProps({ testID: 'auth-login-recent-google' })).toHaveLength(0);
  });

  test('applies only the bottom safe area inside the navigation form sheet', async () => {
    createAuthFixture();
    const renderer = await render(<LoginScreen />);

    expect(renderer.root.findByProps({ testID: 'auth-login-safe-area' }).props.edges).toEqual(['bottom']);
  });

  test('uses one light visual grammar for both provider controls', async () => {
    createAuthFixture();
    const renderer = await render(<LoginScreen />);
    const google = findNativeProviderButton(renderer.root, 'google');
    const apple = findNativeProviderButton(renderer.root, 'apple');

    expect(StyleSheet.flatten(google.props.style)).toMatchObject({ height: 52, width: '100%' });
    expect(StyleSheet.flatten(apple.props.style)).toMatchObject({ height: 52, width: '100%' });
    expect(google.props.color).toBe('light');
    expect(apple.props.buttonStyle).toBe('White');
    expect(apple.props.cornerRadius).toBe(8);
  });

  test('keeps cancellation neutral and leaves the login screen usable', async () => {
    const fixture = createAuthFixture({
      signIn: async (_provider: SocialProvider) => undefined,
    });
    const renderer = await render(<LoginScreen />);

    await ReactTestRenderer.act(async () => {
      await findNativeProviderButton(renderer.root, 'google').props.onPress();
    });

    expect(fixture.signIn).toHaveBeenCalledWith('google');
    expect(renderer.root.findAllByProps({ testID: 'auth-login-error' })).toHaveLength(0);
    expect(findNativeProviderButton(renderer.root, 'google').props.disabled).toBe(false);
  });

  test('locks both actions while signing in and replaces provider errors with retry copy', async () => {
    const deferred = createDeferred<void>();
    const fixture = createAuthFixture({
      signIn: async (_provider: SocialProvider) => deferred.promise,
    });
    const renderer = await render(<LoginScreen />);

    await ReactTestRenderer.act(async () => {
      findNativeProviderButton(renderer.root, 'google').props.onPress();
      await Promise.resolve();
    });

    expect(fixture.signIn).toHaveBeenCalledTimes(1);
    expect(findNativeProviderButton(renderer.root, 'google').props.disabled).toBe(true);
    expect(findNativeProviderButton(renderer.root, 'apple').props.disabled).toBe(true);

    deferred.reject(new Error('raw-provider-payload@example.com'));
    await flush();

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('다시 시도');
    expect(rendered).not.toContain('raw-provider-payload@example.com');
    expect(findNativeProviderButton(renderer.root, 'google').props.disabled).toBe(false);
  });

  test('gives both native provider buttons accessible 44-point targets', async () => {
    createAuthFixture();
    const renderer = await render(<LoginScreen />);

    expectAccessibleControl(findNativeProviderButton(renderer.root, 'google'), 'button');
    expectAccessibleControl(findNativeProviderButton(renderer.root, 'apple'), 'button');
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
