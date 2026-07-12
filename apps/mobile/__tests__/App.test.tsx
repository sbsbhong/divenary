/**
 * @format
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import ReactTestRenderer from 'react-test-renderer';
import metadataRichFixture from '../../../packages/contracts/fixtures/metadata-rich-watch-sync-message.json';
import App from '../src/App';
import { Menu } from '../src/components/ui/menu';
import i18n from '../src/i18n';
import { defaultDiveLogRepository } from '../src/repositories/default-dive-log-repository';

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
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
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
    mockSafeAreaMetrics = {
      frame: { width: 320, height: 640, x: 0, y: 0 },
      insets: { left: 0, right: 0, bottom: 0, top: 0 },
    };

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
    expect(root.findByProps({ testID: 'language-menu-trigger' })).toBeTruthy();

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

  test('switches language from the restored Home language menu', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    const root = renderer!.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'language-menu-trigger' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'language-menu-option-en' })).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'language-menu-option-en' }).props.onPress();
    });

    expect(i18n.language).toBe('en');
    expect(root.findByProps({ testID: 'nav-tab-home' }).props.children[1].props.children).toBe('Home');
  });

  test('renders the Home language selector with the gluestack Menu component', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      renderers.push(renderer);
    });

    expect(renderer!.root.findByType(Menu)).toBeTruthy();
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

    const importedToastEntry = (await defaultDiveLogRepository.list()).find(
      entry => entry.watchCapture?.session.localSessionId === 'app-toast-session',
    );
    expect(importedToastEntry?.cloudSyncStatus).toBe('notConfigured');

    expect(root.findByProps({ testID: 'watch-auto-import-toast' })).toBeTruthy();
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

  test('uses the persistent default logbook repository', async () => {
    const entries = await defaultDiveLogRepository.list();

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].watchCapture?.importKey).toBeTruthy();
  });
});
