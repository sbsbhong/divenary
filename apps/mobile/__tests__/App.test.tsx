/**
 * @format
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo, Alert, AppState, type AlertButton } from 'react-native';
import metadataRichFixture from '../../../packages/contracts/fixtures/metadata-rich-watch-sync-message.json';
import App from '../src/App';
import { resolveAuthLoginSheetAllowedDetents } from '../src/components/navigation';
import {AppErrorBoundary} from '../src/components/app-error-boundary';
import {GluestackUIProvider} from '../src/components/ui/gluestack-ui-provider';
import i18n from '../src/i18n';

type MockAuthState =
  | { status: 'bootstrapping' }
  | { status: 'guest' }
  | { status: 'authenticating'; provider: 'google' | 'apple' }
  | {
      status: 'pendingOnboarding';
      userId: string;
      documents: Array<{
        kind: 'terms' | 'privacy';
        version: string;
        effectiveAt: string;
        documentUrl: string;
      }>;
    }
  | { status: 'authenticated'; userId: string }
  | { status: 'authenticatedOffline'; userId: string };

const nonGuestHomeStateFixtures: ReadonlyArray<Exclude<MockAuthState, { status: 'guest' }>> = [
  { status: 'bootstrapping' },
  { status: 'authenticating', provider: 'google' },
  { status: 'authenticated', userId: 'authenticated-member-user' },
  { status: 'authenticatedOffline', userId: 'offline-member-user' },
  {
    status: 'pendingOnboarding',
    userId: 'pending-member-user',
    documents: [
      {
        kind: 'terms',
        version: '2026-07-13',
        effectiveAt: '2026-07-13T00:00:00Z',
        documentUrl: 'https://legal.example.com/terms/2026-07-13',
      },
      {
        kind: 'privacy',
        version: '2026-07-13',
        effectiveAt: '2026-07-13T00:00:00Z',
        documentUrl: 'https://legal.example.com/privacy/2026-07-13',
      },
    ],
  },
];

let mockAuthState: MockAuthState = { status: 'guest' };
let mockAuthConfigured = false;
let mockAuthProviders: Array<'google' | 'apple'> = [];
const mockCancelOnboarding = jest.fn(async () => {
  mockAuthState = { status: 'guest' };
});

jest.mock('../src/states/auth', () => {
  const ReactModule = require('react') as typeof import('react');

  return {
    AuthProvider: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children),
    useAuth: () => ({
      state: mockAuthState,
      isConfigured: mockAuthConfigured,
      availableProviders: mockAuthProviders,
      recentProvider: undefined,
      signIn: jest.fn(async () => undefined),
      completeOnboarding: jest.fn(async () => undefined),
      cancelOnboarding: mockCancelOnboarding,
      signOut: jest.fn(async () => undefined),
    }),
  };
});

const readRepoFile = (path: string) => {
  const nodeRequire = require as (moduleName: string) => {
    readFileSync: (filePath: string, encoding: 'utf8') => string;
  };
  const fs = nodeRequire('fs');
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

  return fs.readFileSync(`${cwd}/../../${path}`, 'utf8');
};

const waitForTestID = async (root: ReactTestRenderer.ReactTestInstance, testID: string) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (root.findAllByProps({ testID }).length > 0) {
      return;
    }

    await ReactTestRenderer.act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
  }
};

type RenderedNode = {
  children?: unknown;
  props?: Record<string, unknown>;
};

const findRenderedNodesByTestID = (tree: ReturnType<ReactTestRenderer.ReactTestRenderer['toJSON']>, testID: string): RenderedNode[] => {
  const matches: RenderedNode[] = [];

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (node === null || typeof node !== 'object') {
      return;
    }

    const renderedNode = node as RenderedNode;
    if (renderedNode.props?.testID === testID) {
      matches.push(renderedNode);
    }
    visit(renderedNode.children);
  };

  visit(tree);
  return matches;
};

const waitForRenderedTestID = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (findRenderedNodesByTestID(renderer.toJSON(), testID).length > 0) {
      return;
    }

    await ReactTestRenderer.act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
  }
};

const waitForWatchLinkSubscription = async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (mockWatchLinkHandler) {
      return;
    }

    await ReactTestRenderer.act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
  }
};

const mockDrainPendingWatchPayloads = jest.fn();
const mockDiscardWatchPayloads = jest.fn();
const mockAcknowledgeImportedWatchPayloads = jest.fn();
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];
let mockNotificationForegroundHandler:
  | ((event: { type: number; detail: { notification: { data: Record<string, string> } } }) => void)
  | undefined;
let mockWatchLinkHandler:
  | ((payload: { payloadId?: string; payloadJson: string; localSessionId?: string; receivedAt?: number }) => void)
  | undefined;
let mockSafeAreaMetrics = {
  frame: { width: 320, height: 640, x: 0, y: 0 },
  insets: { left: 0, right: 0, bottom: 0, top: 0 },
};

jest.mock('../src/companion/default-watch-link', () => ({
  defaultWatchLink: {
    ...jest.requireActual('../src/companion/watch-link').createUnavailableWatchLink(),
    acknowledgeImportedPayloads: (payloadIds: readonly string[]) =>
      mockAcknowledgeImportedWatchPayloads(payloadIds),
    discardPayloads: (payloadIds: readonly string[]) => mockDiscardWatchPayloads(payloadIds),
    drainPendingPayloads: () => mockDrainPendingWatchPayloads(),
    getLinkedWatchInfo: () =>
      Promise.resolve({
        isSupported: true,
        isPaired: true,
        isWatchAppInstalled: true,
        isReachable: true,
        name: 'Test Apple Watch',
      }),
    isAvailable: () => true,
    subscribeToPayloads: (
      handler: (payload: { payloadId?: string; payloadJson: string; localSessionId?: string; receivedAt?: number }) => void,
    ) => {
      mockWatchLinkHandler = handler;
      return { remove: jest.fn() };
    },
    updatePlannedDives: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react') as typeof import('react');
  const actual = jest.requireActual('react-native-safe-area-context');

  return {
    ...actual,
    initialWindowMetrics: mockSafeAreaMetrics,
    useSafeAreaFrame: jest.fn(() => mockSafeAreaMetrics.frame),
    useSafeAreaInsets: jest.fn(() => mockSafeAreaMetrics.insets),
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('nativewind', () => {
  const actual = jest.requireActual('nativewind');

  return {
    ...actual,
    useColorScheme: jest.fn(() => ({
      colorScheme: 'light',
      setColorScheme: jest.fn(),
    })),
  };
});

describe('App navigation', () => {
  beforeEach(async () => {
    const asyncStorageMock = jest.requireMock('@react-native-async-storage/async-storage') as {
      __resetAsyncStorageMock: () => void;
    };

    asyncStorageMock.__resetAsyncStorageMock();
    mockDrainPendingWatchPayloads.mockResolvedValue([]);
    mockDiscardWatchPayloads.mockResolvedValue(undefined);
    mockAcknowledgeImportedWatchPayloads.mockResolvedValue(undefined);
    mockWatchLinkHandler = undefined;
    mockNotificationForegroundHandler = undefined;
    mockAuthState = { status: 'guest' };
    mockAuthConfigured = false;
    mockAuthProviders = [];
    mockCancelOnboarding.mockClear();
    const notifeeMock = jest.requireMock('@notifee/react-native') as {
      default: {
        onForegroundEvent: jest.Mock;
      };
    };
    notifeeMock.default.onForegroundEvent.mockReset();
    notifeeMock.default.onForegroundEvent.mockImplementation((handler: NonNullable<typeof mockNotificationForegroundHandler>) => {
      mockNotificationForegroundHandler = handler;
      return jest.fn();
    });
    mockSafeAreaMetrics = {
      frame: { width: 320, height: 640, x: 0, y: 0 },
      insets: { left: 0, right: 0, bottom: 0, top: 0 },
    };
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });

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
  });

  test('renders correctly', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    expect(renderer!.root.findAllByProps({ children: '대기 중' })).toHaveLength(0);
  });

  test('replaces an unexpected render failure with a preserve-data recovery screen', async () => {
    let shouldThrow = true;
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const ThrowOnce = () => {
      if (shouldThrow) {
        throw new Error('render failed');
      }
      return React.createElement('recovered-app', {testID: 'recovered-app'});
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <GluestackUIProvider mode="light">
          <AppErrorBoundary>
            <ThrowOnce />
          </AppErrorBoundary>
        </GluestackUIProvider>,
      );
    });

    expect(
      renderer!.root.findByProps({testID: 'app-error-recovery-screen'}),
    ).toBeTruthy();
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('로그아웃');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('삭제');

    shouldThrow = false;
    await ReactTestRenderer.act(async () => {
      renderer!.root.findByProps({testID: 'recovery-retry'}).props.onPress();
    });
    expect(renderer!.root.findByProps({testID: 'recovered-app'})).toBeTruthy();
    renderer!.unmount();
    consoleError.mockRestore();
  });

  test('keeps four top-level tabs and opens Settings', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;

    expect(root.findByProps({ testID: 'nav-tab-home' })).toBeTruthy();
    expect(root.findByProps({ testID: 'nav-tab-logbook' })).toBeTruthy();
    expect(root.findByProps({ testID: 'nav-tab-planning' })).toBeTruthy();
    expect(root.findByProps({ testID: 'nav-tab-settings' })).toBeTruthy();
    expect(() => root.findByProps({ testID: 'nav-tab-memory' })).toThrow();
    expect(root.findByProps({ testID: 'nav-tab-home' }).props.accessibilityRole).toBe('tab');
    expect(root.findByProps({ testID: 'nav-tab-home' }).props.accessibilityState).toEqual({ selected: true });
    expect(root.findByProps({ testID: 'nav-tab-logbook' }).props.accessibilityState).toEqual({ selected: false });
    // Auth is not configured in this build, so Home offers no login entry.
    expect(root.findAllByProps({ testID: 'home-login-action' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'language-menu-trigger' })).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'nav-tab-settings' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'settings-screen-title' }).props.children).toBe('설정');
  });

  test('uses React Navigation as the top-level navigation container', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    expect(renderer!.root.findByType(NavigationContainer)).toBeTruthy();
  });

  test('routes detail and create screens through the native iOS stack', () => {
    const navigationSource = readRepoFile('apps/mobile/src/components/navigation/index.tsx');
    const packageJson = readRepoFile('apps/mobile/package.json');

    expect(packageJson).toContain('"@react-navigation/native-stack"');
    expect(packageJson).toContain('"react-native-screens"');
    expect(navigationSource).toContain("from '@react-navigation/native-stack'");
    expect(navigationSource).toContain('StackActions.popToTop()');
    expect(navigationSource).toContain('createNativeStackNavigator<RootStackParamList>()');
    expect(navigationSource).toContain('gestureEnabled: true');
    expect(navigationSource).toContain('rootStackNavigationRef.getRootState()');
    expect(navigationSource).toContain('logbookCreate');
    expect(navigationSource).toContain('planningCreate');
    expect(navigationSource).not.toContain('type AppDetailRoute');
    expect(navigationSource).not.toContain('detailRoute');
  });

  test('defines guest-preserving login and non-dismissible consent routes', () => {
    const navigationSource = readRepoFile('apps/mobile/src/components/navigation/index.tsx');

    expect(navigationSource).toContain('authLogin: undefined');
    expect(navigationSource).toContain('authOnboarding: undefined');
    expect(navigationSource).toMatch(/<Stack\.Screen\s+name="authLogin"/);
    expect(navigationSource).toContain("presentation: 'formSheet'");
    expect(navigationSource).toContain('sheetAllowedDetents: AUTH_LOGIN_SHEET_ALLOWED_DETENTS');
    expect(navigationSource).not.toContain('sheetAllowedDetents: [0.62, 0.9]');
    expect(navigationSource).toContain('sheetGrabberVisible: true');
    expect(navigationSource).toContain('sheetCornerRadius: 28');
    expect(navigationSource).toContain('function AuthLoginRoute');
    expect(navigationSource).toContain("usePreventRemove(state.status === 'authenticating'");
    expect(navigationSource).toMatch(/<Stack\.Screen\s+name="authOnboarding"/);
    expect(navigationSource).toContain('gestureEnabled: false');
    expect(navigationSource).toContain('usePreventRemove');
    expect(navigationSource).toContain("state.status === 'pendingOnboarding'");
    expect(navigationSource).toContain('onOpenLogin={openAuthLogin}');
  });

  test('falls back to the medium login sheet detent below iOS 16', () => {
    expect(resolveAuthLoginSheetAllowedDetents('ios', 15.1)).toEqual([0.5, 1]);
    expect(resolveAuthLoginSheetAllowedDetents('ios', '15.7.1')).toEqual([0.5, 1]);
    expect(resolveAuthLoginSheetAllowedDetents('ios', 'unknown')).toEqual([0.5, 1]);
    expect(resolveAuthLoginSheetAllowedDetents('ios', 16)).toBe('fitToContents');
    expect(resolveAuthLoginSheetAllowedDetents('android', 36)).toBe('fitToContents');
  });

  test('moves a configured guest through login and required consent, then returns an explicit cancellation to the same local tabs', async () => {
    mockAuthConfigured = true;
    // Settings offers sign-in only when a provider is usable, like Home.
    mockAuthProviders = ['apple'];
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'nav-tab-settings' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-account-action' }).props.onPress();
    });
    await waitForRenderedTestID(renderer!, 'auth-login-screen');
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'auth-login-screen')).toHaveLength(1);

    mockAuthState = {
      status: 'pendingOnboarding',
      userId: 'navigation-test-user',
      documents: [
        {
          kind: 'terms',
          version: '2026-07-13',
          effectiveAt: '2026-07-13T00:00:00Z',
          documentUrl: 'https://legal.example.com/terms/2026-07-13',
        },
        {
          kind: 'privacy',
          version: '2026-07-13',
          effectiveAt: '2026-07-13T00:00:00Z',
          documentUrl: 'https://legal.example.com/privacy/2026-07-13',
        },
      ],
    };
    await ReactTestRenderer.act(async () => {
      renderer!.update(<App />);
    });
    await waitForRenderedTestID(renderer!, 'auth-onboarding-screen');

    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'auth-onboarding-screen')).toHaveLength(1);
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'auth-login-screen')).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      renderer!.update(<App />);
    });
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'auth-onboarding-screen')).toHaveLength(1);

    const cancelAction = findRenderedNodesByTestID(renderer!.toJSON(), 'auth-onboarding-cancel')[0]?.props?.onClick as
      | (() => Promise<void>)
      | undefined;
    expect(cancelAction).toEqual(expect.any(Function));
    await ReactTestRenderer.act(async () => {
      await cancelAction?.();
      renderer!.update(<App />);
    });

    expect(mockCancelOnboarding).toHaveBeenCalledTimes(1);
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'auth-onboarding-screen')).toHaveLength(0);
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'settings-screen-title')).toHaveLength(1);
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'nav-tab-logbook')).toHaveLength(1);
  });

  test('shows restored pending consent once and returns authenticated membership to tabs', async () => {
    mockAuthConfigured = true;
    mockAuthProviders = [];
    mockAuthState = {
      status: 'pendingOnboarding',
      userId: 'restored-pending-user',
      documents: [
        {
          kind: 'terms',
          version: '2026-07-13',
          effectiveAt: '2026-07-13T00:00:00Z',
          documentUrl: 'https://legal.example.com/terms/2026-07-13',
        },
        {
          kind: 'privacy',
          version: '2026-07-13',
          effectiveAt: '2026-07-13T00:00:00Z',
          documentUrl: 'https://legal.example.com/privacy/2026-07-13',
        },
      ],
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    await waitForRenderedTestID(renderer!, 'auth-onboarding-screen');
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'auth-onboarding-screen')).toHaveLength(1);

    await ReactTestRenderer.act(async () => {
      renderer!.update(<App />);
    });
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'auth-onboarding-screen')).toHaveLength(1);

    mockAuthState = {
      status: 'authenticated',
      userId: 'restored-pending-user',
    };
    await ReactTestRenderer.act(async () => {
      renderer!.update(<App />);
    });

    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'auth-onboarding-screen')).toHaveLength(0);
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'nav-tab-home')).toHaveLength(1);
  });

  test('keeps required consent above foreground notification routes until the user completes or cancels it', async () => {
    mockAuthConfigured = true;
    mockAuthState = {
      status: 'pendingOnboarding',
      userId: 'pending-notification-user',
      documents: [
        {
          kind: 'terms',
          version: '2026-07-13',
          effectiveAt: '2026-07-13T00:00:00Z',
          documentUrl: 'https://legal.example.com/terms/2026-07-13',
        },
        {
          kind: 'privacy',
          version: '2026-07-13',
          effectiveAt: '2026-07-13T00:00:00Z',
          documentUrl: 'https://legal.example.com/privacy/2026-07-13',
        },
      ],
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });
    await waitForRenderedTestID(renderer!, 'auth-onboarding-screen');
    expect(mockNotificationForegroundHandler).toEqual(expect.any(Function));

    await ReactTestRenderer.act(async () => {
      mockNotificationForegroundHandler?.({
        type: 1,
        detail: {
          notification: {
            data: {
              source: 'watch-sync-import',
              entryLocalId: 'missing-pending-notification-entry',
            },
          },
        },
      });
    });

    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'auth-onboarding-screen')).toHaveLength(1);
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'navigation-missing-route')).toHaveLength(0);
  });

  test('planning actions preserve the requested tab when returning to tabs', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;

    // Home no longer repeats the tab bar with a large planning button.
    expect(root.findAllByProps({ testID: 'home-open-planning-action' })).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'nav-tab-planning' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'planning-create-action' })).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'planning-open-logbook-action' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'logbook-create-action' })).toBeTruthy();
  });

  const openRoutedPlanCreate = async (root: ReactTestRenderer.ReactTestInstance) => {
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'nav-tab-planning' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'planning-create-action' }).props.onPress();
    });
    await waitForTestID(root, 'planning-editor-plan-title');
  };

  const typePlanTitle = async (root: ReactTestRenderer.ReactTestInstance, title: string) => {
    await ReactTestRenderer.act(async () => {
      root
        .findAll(node => node.props.testID === 'planning-editor-plan-title' && typeof node.props.onChangeText === 'function')[0]
        .props.onChangeText(title);
    });
  };

  test('saves a draft from the full-screen plan editor and opens its detail in its place', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;
    await openRoutedPlanCreate(root);
    // The sticky save bar belongs to the editor screen, not to a scroll view around it.
    expect(root.findAllByProps({ testID: 'routed-editor-anchor' })).toHaveLength(0);
    await typePlanTitle(root, '주말 리프');
    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'planning-editor-save-draft' }).props.onPress();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
    await waitForTestID(root, 'planning-detail-title');

    expect(
      root.findAll(node => node.props.testID === 'planning-detail-title' && typeof node.type === 'string')[0].props.children,
    ).toBe('주말 리프');
    expect(root.findAllByProps({ testID: 'planning-editor-plan-title' })).toHaveLength(0);
  });

  test('asks before discarding unsaved edits in the routed plan editor', async () => {
    const alertCalls: Array<{ title: string; buttons: AlertButton[] }> = [];
    jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
      alertCalls.push({ title, buttons: buttons ?? [] });
    });
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;
    await openRoutedPlanCreate(root);
    await typePlanTitle(root, '버릴 계획');
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'planning-editor-back' }).props.onPress();
    });

    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0].title).toBe('변경 사항을 버릴까요?');

    await ReactTestRenderer.act(async () => {
      alertCalls[0].buttons.find(button => button.style === 'destructive')?.onPress?.();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    expect(root.findAllByProps({ testID: 'planning-editor-plan-title' })).toHaveLength(0);
    jest.restoreAllMocks();
  });

  test('completes a routed plan with its checklist and links the log written from it', async () => {
    const alertCalls: Array<{ title: string; buttons: AlertButton[] }> = [];
    jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
      alertCalls.push({ title, buttons: buttons ?? [] });
    });
    const { defaultWatchLink } = jest.requireMock('../src/companion/default-watch-link') as {
      defaultWatchLink: { updatePlannedDives: jest.Mock };
    };
    const { toWatchPlannedDivePayloads } = jest.requireActual('../src/companion/watch-link') as typeof import('../src/companion/watch-link');
    const watchPlanTitles = () => {
      const calls = defaultWatchLink.updatePlannedDives.mock.calls;
      return toWatchPlannedDivePayloads(calls[calls.length - 1]?.[0] ?? []).map(payload => payload.title);
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;
    const pressID = async (testID: string) => {
      await ReactTestRenderer.act(async () => {
        await root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0].props.onPress();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });
    };
    const typeInto = async (testID: string, value: string) => {
      await ReactTestRenderer.act(async () => {
        root.findAll(node => node.props.testID === testID && typeof node.props.onChangeText === 'function')[0].props.onChangeText(value);
      });
    };
    const pickValue = async (testID: string, value: string) => {
      await pressID(`${testID}-trigger`);
      await pressID(`${testID}-input-trigger`);
      await typeInto(`${testID}-input`, value);
      await ReactTestRenderer.act(async () => {
        root
          .findAll(node => node.props.testID === `${testID}-input` && typeof node.props.onSubmitEditing === 'function')[0]
          .props.onSubmitEditing();
      });
      await pressID(`${testID}-done`);
    };
    const pickDate = async (testID: string, value: Date) => {
      await pressID(`${testID}-trigger`);
      await ReactTestRenderer.act(async () => {
        root
          .findAll(node => node.props.testID === `${testID}-picker` && typeof node.props.onValueChange === 'function')[0]
          .props.onValueChange({ nativeEvent: { timestamp: value.getTime(), utcOffset: 0 } }, value);
      });
      await pressID(`${testID}-done`);
    };
    const hostText = (testID: string) =>
      root.findAll(node => node.props.testID === testID && typeof node.type === 'string')[0]?.props.children;

    // A complete plan confirmed in the routed editor reaches the watch payload.
    await openRoutedPlanCreate(root);
    await typePlanTitle(root, '주말 리프');
    await pickDate('planning-editor-planned-at', new Date(2030, 5, 20, 9, 30));
    await typeInto('planning-editor-site-name', '블루 코너');
    await pickValue('planning-editor-planned-max-depth', '18');
    await pickValue('planning-editor-planned-duration', '40');
    await pressID('planning-editor-save-planned');
    await waitForTestID(root, 'planning-detail-complete');
    expect(watchPlanTitles()).toContain('주말 리프');

    // A checklist tap is stored, completing keeps it, and the completed plan leaves the watch payload.
    await pressID('planning-detail-checklist-site');
    await pressID('planning-detail-complete');
    await waitForTestID(root, 'planning-detail-create-log');
    expect(hostText('planning-detail-checklist-progress')).toBe('1/3');
    expect(root.findAllByProps({ testID: 'planning-detail-complete' })).toHaveLength(0);
    expect(watchPlanTitles()).not.toContain('주말 리프');

    // One tap on the completion prompt opens a log editor that carries the dive site.
    expect(alertCalls).toHaveLength(1);
    await ReactTestRenderer.act(async () => {
      alertCalls[0].buttons.find(button => button.style !== 'cancel')?.onPress?.();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
    await waitForTestID(root, 'log-entry-editor-site-name');
    expect(
      root.findAll(node => node.props.testID === 'log-entry-editor-site-name' && typeof node.props.onChangeText === 'function')[0]
        .props.value,
    ).toBe('블루 코너');

    // Saving the log links it to the plan, so the plan opens that log instead of offering another.
    await pickDate('log-entry-editor-started-at', new Date(2026, 5, 20, 9, 30));
    await pickValue('log-entry-editor-duration', '45:00');
    await pickValue('log-entry-editor-max-depth', '18.6');
    await pressID('log-entry-editor-save');
    await waitForTestID(root, 'log-entry-detail-back');
    await pressID('log-entry-detail-back');
    // Back from the new log lands on the Logbook tab.
    expect(root.findAllByProps({ testID: 'logbook-create-action' }).length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'nav-tab-planning' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root
        .findAll(
          node =>
            typeof node.props.testID === 'string' &&
            node.props.testID.startsWith('planning-plan-row-') &&
            typeof node.props.onPress === 'function',
        )[0]
        .props.onPress();
    });
    await waitForTestID(root, 'planning-detail-open-log');
    expect(root.findAllByProps({ testID: 'planning-detail-create-log' })).toHaveLength(0);

    // Deleting the plan goes back to a list without it.
    await pressID('planning-detail-delete');
    await ReactTestRenderer.act(async () => {
      alertCalls[alertCalls.length - 1].buttons.find(button => button.style === 'destructive')?.onPress?.();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
    await waitForTestID(root, 'planning-empty-state');
    expect(root.findAllByProps({ testID: 'planning-detail-title' })).toHaveLength(0);
    jest.restoreAllMocks();
  });

  const openRoutedLogCreate = async (root: ReactTestRenderer.ReactTestInstance) => {
    // A fresh app has no logs, so Home offers its empty-state write action.
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'home-latest-empty-create-action' }).props.onPress();
    });
    await waitForTestID(root, 'log-entry-editor-site-name');
  };

  test('asks before discarding unsaved edits in the routed log editor', async () => {
    const alertCalls: Array<{ title: string; message?: string; buttons: AlertButton[] }> = [];
    jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
      alertCalls.push({ title, message, buttons: buttons ?? [] });
    });
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;
    await openRoutedLogCreate(root);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'log-entry-editor-site-name' }).props.onChangeText('Blue Hole');
    });
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'log-entry-editor-back' }).props.onPress();
    });

    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0].title).toBe('변경 사항을 버릴까요?');
    expect(alertCalls[0].message).toBe('저장하지 않은 입력은 사라집니다.');
    expect(alertCalls[0].buttons.map(button => [button.text, button.style])).toEqual([
      ['계속 편집', 'cancel'],
      ['버리기', 'destructive'],
    ]);
    expect(root.findAllByProps({ testID: 'log-entry-editor-site-name' }).length).toBeGreaterThan(0);

    await ReactTestRenderer.act(async () => {
      alertCalls[0].buttons.find(button => button.style === 'destructive')?.onPress?.();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    expect(root.findAllByProps({ testID: 'log-entry-editor-site-name' })).toHaveLength(0);
    jest.restoreAllMocks();
  });

  test('leaves the routed log editor without asking when nothing changed', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;
    await openRoutedLogCreate(root);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'log-entry-editor-back' }).props.onPress();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    expect(alert).not.toHaveBeenCalled();
    expect(root.findAllByProps({ testID: 'log-entry-editor-site-name' })).toHaveLength(0);
    jest.restoreAllMocks();
  });

  test('scrolls the routed log editor to the first invalid field on a failed save', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;
    await openRoutedLogCreate(root);

    // The editor is the whole screen: it scrolls its own body to the measured section anchor.
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'log-entry-editor-body' }).props.onLayout({ nativeEvent: { layout: { y: 16 } } });
      root.findByProps({ testID: 'log-entry-editor-essentials-anchor' }).props.onLayout({ nativeEvent: { layout: { y: 210 } } });
    });
    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'log-entry-editor-save' }).props.onPress();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    // body y + anchor y - 16 pt above the section.
    expect(root.findByProps({ testID: 'log-entry-editor-scroll-target' }).props.children).toBe('210');
    expect(root.findByProps({ testID: 'log-entry-editor-actions' }).findAllByProps({ testID: 'log-entry-editor-save' }).length).toBeGreaterThan(0);
  });

  test('opens login from Home while the user is a guest', async () => {
    mockAuthConfigured = true;
    mockAuthProviders = ['apple'];
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;
    const loginAction = root.findByProps({ testID: 'home-login-action' });
    const loginActionClassNames = root
      .findAllByProps({ testID: 'home-login-action' })
      .map(node => node.props.className)
      .filter((className): className is string => typeof className === 'string');

    expect(loginActionClassNames.some(className => className.includes('min-h-11'))).toBe(true);
    expect(loginActionClassNames.some(className => className.includes('min-w-[52px]'))).toBe(true);
    expect(loginActionClassNames.some(className => className.includes('bg-transparent'))).toBe(true);
    expect(root.findAllByProps({ testID: 'home-login-action-icon' })).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      loginAction.props.onPress();
    });
    await waitForRenderedTestID(renderer!, 'auth-login-screen');

    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'auth-login-screen')).toHaveLength(1);
  });

  test.each(nonGuestHomeStateFixtures)('hides the Home login action for $status membership', async authState => {
    mockAuthState = authState;
    mockAuthConfigured = true;
    mockAuthProviders = ['apple'];
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    expect(renderer!.root.findAllByProps({ testID: 'home-login-action' })).toHaveLength(0);
  });

  test('hides the Home login action when Auth has no usable sign-in method', async () => {
    mockAuthConfigured = true;
    mockAuthProviders = [];
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    expect(renderer!.root.findByProps({ testID: 'nav-tab-home' })).toBeTruthy();
    expect(renderer!.root.findAllByProps({ testID: 'home-login-action' })).toHaveLength(0);
  });

  test('keeps the start shell instead of guest tabs while Auth restores a session', async () => {
    mockAuthState = { status: 'bootstrapping' };
    mockAuthConfigured = true;
    mockAuthProviders = ['apple'];
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    expect(renderer!.root.findByProps({ testID: 'account-data-loading-screen' })).toBeTruthy();
    expect(renderer!.root.findAllByProps({ testID: 'nav-tab-home' })).toHaveLength(0);
  });

  test('shows the missing-item screen, not the loading skeleton, once the logbook has loaded', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
    await ReactTestRenderer.act(async () => {
      mockNotificationForegroundHandler?.({
        type: 1,
        detail: {
          notification: {
            data: {
              source: 'watch-sync-import',
              entryLocalId: 'missing-loaded-entry',
            },
          },
        },
      });
    });
    await waitForRenderedTestID(renderer!, 'navigation-missing-route');

    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'navigation-missing-route')).toHaveLength(1);
    expect(findRenderedNodesByTestID(renderer!.toJSON(), 'navigation-route-loading')).toHaveLength(0);
  });

  test('shows a tappable toast for automatic watch imports and opens the imported log', async () => {
    const fixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'app-toast-session',
        siteName: 'Toast Reef',
        endedAt: 1781357600,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'app-toast-session',
        })),
      },
    };
    const announceForAccessibility = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    const root = renderer!.root;
    await waitForWatchLinkSubscription();
    expect(mockWatchLinkHandler).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      mockWatchLinkHandler?.({
        payloadId: 'app-toast-payload',
        payloadJson: JSON.stringify(fixture),
        localSessionId: 'app-toast-session',
        receivedAt: 1781357600,
      });
    });
    await waitForTestID(root, 'watch-auto-import-toast');

    expect(root.findByProps({ testID: 'watch-auto-import-toast' })).toBeTruthy();
    // VoiceOver reaches both buttons instead of one merged element, and hears the toast once.
    expect(root.findByProps({ testID: 'watch-auto-import-toast' }).props.accessible).toBe(false);
    expect(announceForAccessibility.mock.calls.filter(([message]) => message === '워치 기록 저장됨')).toHaveLength(1);
    expect(root.findByProps({ testID: 'watch-auto-import-message' }).props.children).toBe('워치 기록 저장됨');
    // The inverted app-feedback surface, so the toast never blends into the white list rows below.
    expect(root.findByProps({ testID: 'watch-auto-import-toast' }).props.className).toContain('bg-foreground');
    expect(root.findByProps({ testID: 'watch-auto-import-message' }).props.className).toContain('text-background');
    expect(root.findAll(node => node.props.children === '워치 다이브 기록이 이 기기에 저장되었습니다.')).toHaveLength(0);
    // The button opens the saved log's detail, so it says so.
    expect(root.findByProps({ testID: 'watch-auto-import-open-log' }).props.label).toBe('기록 보기');
    expect(root.findByProps({ testID: 'watch-auto-import-dismiss' }).props.label).toBe('닫기');

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'watch-auto-import-open-log' }).props.onPress();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    expect(root.findByProps({ testID: 'log-entry-detail-note' }).props.children).toBe(
      'Easy recreational checkout dive. Not for decompression planning.',
    );
    expect(root.findByProps({ testID: 'log-entry-detail-depth-profile' })).toBeTruthy();
    announceForAccessibility.mockRestore();
  });

  test('keeps automatic watch import toasts inside the safe-area overlay', async () => {
    mockSafeAreaMetrics = {
      frame: { width: 393, height: 852, x: 0, y: 0 },
      insets: { left: 0, right: 0, bottom: 34, top: 59 },
    };
    const fixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'app-safe-area-toast-session',
        endedAt: 1781357600,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'app-safe-area-toast-session',
        })),
      },
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    const root = renderer!.root;
    await waitForWatchLinkSubscription();

    await ReactTestRenderer.act(async () => {
      mockWatchLinkHandler?.({
        payloadId: 'app-safe-area-toast-payload',
        payloadJson: JSON.stringify(fixture),
        localSessionId: 'app-safe-area-toast-session',
        receivedAt: 1781357600,
      });
    });
    await waitForTestID(root, 'watch-auto-import-toast');

    expect(root.findByProps({ testID: 'watch-auto-import-toast-safe-area' }).props.style).toEqual(
      expect.objectContaining({
        bottom: 34,
        left: 0,
        right: 0,
        top: 59,
      }),
    );

    const toastStyle = root.findByProps({ testID: 'watch-auto-import-toast' }).props.style({ pressed: false })[0];
    expect(toastStyle).toEqual(expect.objectContaining({ bottom: 84 }));
  });

  test('does not auto-dismiss automatic watch import toasts on a timer', () => {
    expect(readRepoFile('apps/mobile/src/components/navigation/index.tsx')).not.toMatch(
      /setTimeout\(\s*\(\)\s*=>\s*\{\s*setAutoImportToast\(undefined\)/,
    );
  });

});
