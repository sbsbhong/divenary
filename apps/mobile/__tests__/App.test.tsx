/**
 * @format
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, AppState, type AlertButton } from 'react-native';
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

const waitForWatchConnectivitySubscription = async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (mockWatchConnectivityHandler) {
      return;
    }

    await ReactTestRenderer.act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
  }
};

const mockDrainPendingWatchConnectivityPayloads = jest.fn();
const mockAcknowledgeWatchConnectivityPayloads = jest.fn();
const mockAcknowledgeImportedWatchConnectivityPayloads = jest.fn();
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];
let mockNotificationForegroundHandler:
  | ((event: { type: number; detail: { notification: { data: Record<string, string> } } }) => void)
  | undefined;
let mockWatchConnectivityHandler:
  | ((payload: { payloadId?: string; payloadJson: string; localSessionId?: string; receivedAt?: number }) => void)
  | undefined;
let mockSafeAreaMetrics = {
  frame: { width: 320, height: 640, x: 0, y: 0 },
  insets: { left: 0, right: 0, bottom: 0, top: 0 },
};

jest.mock('../src/native/watch-connectivity', () => ({
  acknowledgeImportedWatchConnectivityPayloads: (payloadIds: readonly string[]) =>
    mockAcknowledgeImportedWatchConnectivityPayloads(payloadIds),
  acknowledgeWatchConnectivityPayloads: (payloadIds: readonly string[]) => mockAcknowledgeWatchConnectivityPayloads(payloadIds),
  drainPendingWatchConnectivityPayloads: () => mockDrainPendingWatchConnectivityPayloads(),
  getLinkedWatchInfo: () =>
    Promise.resolve({
      isSupported: true,
      isPaired: true,
      isWatchAppInstalled: true,
      isReachable: true,
      name: 'Test Apple Watch',
    }),
  isWatchConnectivityAvailable: () => true,
  subscribeToWatchConnectivityPayloads: (
    handler: (payload: { payloadId?: string; payloadJson: string; localSessionId?: string; receivedAt?: number }) => void,
  ) => {
    mockWatchConnectivityHandler = handler;
    return { remove: jest.fn() };
  },
  updatePlannedWatchDives: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native-reanimated', () => {
  const createAnimation = () => {
    const animation = {} as {
      duration: jest.Mock;
      withInitialValues: jest.Mock;
    };

    animation.duration = jest.fn(() => animation);
    animation.withInitialValues = jest.fn(() => animation);

    return animation;
  };

  return {
    __esModule: true,
    default: {
      createAnimatedComponent: (component: React.ComponentType) => component,
    },
    FadeOut: createAnimation(),
    ZoomIn: createAnimation(),
  };
});

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
    mockDrainPendingWatchConnectivityPayloads.mockResolvedValue([]);
    mockAcknowledgeWatchConnectivityPayloads.mockResolvedValue(undefined);
    mockAcknowledgeImportedWatchConnectivityPayloads.mockResolvedValue(undefined);
    mockWatchConnectivityHandler = undefined;
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
    expect(root.findByProps({ testID: 'home-login-action' })).toBeTruthy();
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
    mockAuthProviders = [];
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

  test('home and planning actions preserve the requested tab when returning to tabs', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'home-open-planning-action' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'planning-create-action' })).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'planning-open-logbook-action' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'logbook-create-action' })).toBeTruthy();
  });

  const openRoutedLogCreate = async (root: ReactTestRenderer.ReactTestInstance) => {
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'home-open-planning-action' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'planning-open-logbook-action' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'logbook-create-action' }).props.onPress();
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

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'routed-editor-anchor' }).props.onLayout({ nativeEvent: { layout: { y: 24 } } });
      root.findByProps({ testID: 'log-entry-editor-body' }).props.onLayout({ nativeEvent: { layout: { y: 96 } } });
      root.findByProps({ testID: 'log-entry-editor-site-name-anchor' }).props.onLayout({ nativeEvent: { layout: { y: 210 } } });
    });
    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'log-entry-editor-save' }).props.onPress();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    expect(root.findByProps({ testID: 'routed-editor-scroll-target' }).props.children).toBe('314');
  });

  test('opens login from Home while the user is a guest', async () => {
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
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    expect(renderer!.root.findAllByProps({ testID: 'home-login-action' })).toHaveLength(0);
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
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    const root = renderer!.root;
    await waitForWatchConnectivitySubscription();
    expect(mockWatchConnectivityHandler).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      mockWatchConnectivityHandler?.({
        payloadId: 'app-toast-payload',
        payloadJson: JSON.stringify(fixture),
        localSessionId: 'app-toast-session',
        receivedAt: 1781357600,
      });
    });
    await waitForTestID(root, 'watch-auto-import-toast');

    expect(root.findByProps({ testID: 'watch-auto-import-toast' })).toBeTruthy();
    expect(root.findByProps({ testID: 'watch-auto-import-message' }).props.children).toBe('워치 기록 저장됨');
    expect(root.findAll(node => node.props.children === '워치 다이브 기록이 이 기기에 저장되었습니다.')).toHaveLength(0);
    expect(root.findByProps({ testID: 'watch-auto-import-open-log' }).props.label).toBe('로그 작성');
    expect(root.findByProps({ testID: 'watch-auto-import-dismiss' }).props.label).toBe('닫기');

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'watch-auto-import-open-log' }).props.onPress();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    expect(root.findByProps({ testID: 'log-entry-detail-note' }).props.children).toBe(
      'Easy recreational checkout dive. Not for decompression planning.',
    );
    expect(root.findByProps({ testID: 'log-entry-detail-depth-profile' })).toBeTruthy();
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
    await waitForWatchConnectivitySubscription();

    await ReactTestRenderer.act(async () => {
      mockWatchConnectivityHandler?.({
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
