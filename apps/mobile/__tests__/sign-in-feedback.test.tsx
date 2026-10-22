import React from 'react';
import { AccessibilityInfo } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { AppFeedbackProvider } from '../src/components/feedback/app-feedback';
import { SignInFeedback } from '../src/components/feedback/sign-in-feedback';
import i18n from '../src/i18n';
import type { AuthState } from '../src/states/auth';

let mockAuthState: AuthState = { status: 'bootstrapping' };

jest.mock('../src/states/auth', () => ({
  useAuth: () => ({ state: mockAuthState }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const userId = '00000000-0000-4000-8000-000000000001';
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];
const pendingOnboarding: AuthState = { status: 'pendingOnboarding', userId, documents: [] };

function host() {
  return (
    <AppFeedbackProvider>
      <SignInFeedback />
    </AppFeedbackProvider>
  );
}

/** Renders each Auth status in turn and returns the messages that were announced. */
async function walk(statuses: AuthState[]): Promise<{ announced: string[]; renderer: ReactTestRenderer.ReactTestRenderer }> {
  // React Native's Jest setup already mocks this, so clear calls left by earlier tests.
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  announce.mockClear();
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  for (const [index, status] of statuses.entries()) {
    mockAuthState = status;
    await ReactTestRenderer.act(async () => {
      if (index === 0) {
        renderer = ReactTestRenderer.create(host());
        renderers.push(renderer);
      } else {
        renderer!.update(host());
      }
    });
  }
  return { announced: announce.mock.calls.map(([message]) => message), renderer: renderer! };
}

describe('SignInFeedback', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount();
      }
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('says signed in once when a sign-in finishes', async () => {
    const { announced, renderer } = await walk([
      { status: 'guest' },
      { status: 'authenticating', provider: 'apple' },
      { status: 'authenticated', userId },
      { status: 'authenticated', userId },
    ]);

    expect(announced).toEqual(['로그인했습니다']);
    expect(renderer.root.findByProps({ testID: 'app-feedback-message' }).props.children).toBe('로그인했습니다');
  });

  it('says signed in after required consent completes', async () => {
    const { announced } = await walk([
      { status: 'authenticating', provider: 'google' },
      pendingOnboarding,
      { status: 'authenticated', userId },
    ]);

    expect(announced).toEqual(['로그인했습니다']);
  });

  it('stays quiet for a restored session and for offline and online flips', async () => {
    const { announced } = await walk([
      { status: 'bootstrapping' },
      { status: 'authenticated', userId },
      { status: 'authenticatedOffline', userId },
      { status: 'authenticated', userId },
    ]);

    expect(announced).toEqual([]);
  });

  it('stays quiet when a sign-in is cancelled', async () => {
    const { announced } = await walk([
      { status: 'guest' },
      { status: 'authenticating', provider: 'apple' },
      { status: 'guest' },
    ]);

    expect(announced).toEqual([]);
  });

  it('uses the current language', async () => {
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
    });
    const { announced } = await walk([
      { status: 'authenticating', provider: 'apple' },
      { status: 'authenticated', userId },
    ]);

    expect(announced).toEqual(['Signed in']);
  });
});
