/**
 * Detail routes open by id, so their item can be missing while its list is still loading or after
 * the list failed to load. These tests pin what the routed screen shows in each case, and how the
 * watch import toast and app feedback share the bottom edge.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState } from 'react-native';
import App from '../src/App';
import i18n from '../src/i18n';
import { CONTENT_LOADING_FEEDBACK } from '../src/constants/async-feedback';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import { createBlankDivePlan } from '../src/utils/create-dive-plan';

// Partial overrides of the list hooks. `undefined` keeps the real hook result.
let mockLogbookOverride: Record<string, unknown> | undefined;
let mockPlanningOverride: Record<string, unknown> | undefined;
let mockNotificationForegroundHandler:
  | ((event: { type: number; detail: { notification: { data: Record<string, string> } } }) => void)
  | undefined;
let mockWatchLinkHandler:
  | ((payload: { payloadId?: string; payloadJson: string; localSessionId?: string; receivedAt?: number }) => void)
  | undefined;

jest.mock('../src/states/auth', () => {
  const ReactModule = require('react') as typeof import('react');

  return {
    AuthProvider: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children),
    useAuth: () => ({
      state: { status: 'guest' },
      isConfigured: false,
      availableProviders: [],
      recentProvider: undefined,
      signIn: jest.fn(async () => undefined),
      completeOnboarding: jest.fn(async () => undefined),
      cancelOnboarding: jest.fn(async () => undefined),
      signOut: jest.fn(async () => undefined),
    }),
  };
});

jest.mock('../src/states/use-dive-logbook', () => {
  const actual = jest.requireActual<typeof import('../src/states/use-dive-logbook')>('../src/states/use-dive-logbook');

  return {
    ...actual,
    useDiveLogbook: (...args: Parameters<typeof actual.useDiveLogbook>) => ({
      ...actual.useDiveLogbook(...args),
      ...mockLogbookOverride,
    }),
  };
});

jest.mock('../src/states/use-dive-plans', () => {
  const actual = jest.requireActual<typeof import('../src/states/use-dive-plans')>('../src/states/use-dive-plans');

  return {
    ...actual,
    useDivePlans: (...args: Parameters<typeof actual.useDivePlans>) => ({
      ...actual.useDivePlans(...args),
      ...mockPlanningOverride,
    }),
  };
});

jest.mock('../src/companion/default-watch-link', () => ({
  defaultWatchLink: {
    ...jest.requireActual('../src/companion/watch-link').createUnavailableWatchLink(),
    acknowledgeImportedPayloads: jest.fn(async () => undefined),
    discardPayloads: jest.fn(async () => undefined),
    drainPendingPayloads: jest.fn(async () => []),
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
  const metrics = {
    frame: { width: 320, height: 640, x: 0, y: 0 },
    insets: { left: 0, right: 0, bottom: 0, top: 0 },
  };

  return {
    ...actual,
    initialWindowMetrics: metrics,
    useSafeAreaFrame: jest.fn(() => metrics.frame),
    useSafeAreaInsets: jest.fn(() => metrics.insets),
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('nativewind', () => {
  const actual = jest.requireActual('nativewind');

  return {
    ...actual,
    useColorScheme: jest.fn(() => ({ colorScheme: 'light', setColorScheme: jest.fn() })),
  };
});

const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !check(); attempt += 1) {
    await flush();
  }
}

function exists(renderer: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return renderer.root.findAll(node => node.props.testID === testID).length > 0;
}

async function renderApp(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    renderers.push(renderer);
  });
  await waitFor(() => exists(renderer!, 'nav-tab-home') && mockNotificationForegroundHandler !== undefined);
  expect(exists(renderer!, 'nav-tab-home')).toBe(true);
  return renderer!;
}

async function openLogFromNotification(entryLocalId: string): Promise<void> {
  await ReactTestRenderer.act(async () => {
    mockNotificationForegroundHandler?.({
      type: 1,
      detail: { notification: { data: { source: 'watch-sync-import', entryLocalId } } },
    });
  });
}

/** Re-renders the app so the list hooks read the current overrides. */
async function rerender(renderer: ReactTestRenderer.ReactTestRenderer): Promise<void> {
  await ReactTestRenderer.act(async () => {
    renderer.update(<App />);
  });
}

// Real time: mixing fake timers into a full app render leaves React's act queue stuck. The exact
// 999/1000 ms boundary is pinned in use-loading-feedback.test.tsx; here it is enough that the
// skeleton is hidden at first and shows once the shared delay has passed.
async function waitPastSkeletonDelay(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, CONTENT_LOADING_FEEDBACK.indicatorMs + 50));
  });
}

function skeletonTitleState(renderer: ReactTestRenderer.ReactTestRenderer): string {
  const [title] = renderer.root.findAll(
    node => node.props.testID === 'navigation-route-loading-title' && typeof node.props.visible === 'boolean',
  );
  return title!.props.visible ? 'visible' : 'hidden';
}

describe('routed detail fallbacks', () => {
  beforeEach(async () => {
    const asyncStorageMock = jest.requireMock('@react-native-async-storage/async-storage') as {
      __resetAsyncStorageMock: () => void;
    };
    asyncStorageMock.__resetAsyncStorageMock();
    mockLogbookOverride = undefined;
    mockPlanningOverride = undefined;
    mockWatchLinkHandler = undefined;
    mockNotificationForegroundHandler = undefined;
    const notifeeMock = jest.requireMock('@notifee/react-native') as {
      default: { onForegroundEvent: jest.Mock };
    };
    notifeeMock.default.onForegroundEvent.mockReset();
    notifeeMock.default.onForegroundEvent.mockImplementation((handler: NonNullable<typeof mockNotificationForegroundHandler>) => {
      mockNotificationForegroundHandler = handler;
      return jest.fn();
    });
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });

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

  test('a log detail waits behind a delayed skeleton during the first list load, then shows the log', async () => {
    const renderer = await renderApp();
    const entry = { ...createBlankDiveLogEntry({ now: 1781353000 }), localId: 'log-loading-route' };

    mockLogbookOverride = { isLoading: true, entries: [], listError: null };
    await openLogFromNotification(entry.localId);

    expect(exists(renderer, 'navigation-route-loading')).toBe(true);
    expect(exists(renderer, 'navigation-missing-route')).toBe(false);
    expect(skeletonTitleState(renderer)).toBe('hidden');
    await waitPastSkeletonDelay();
    expect(skeletonTitleState(renderer)).toBe('visible');

    mockLogbookOverride = { isLoading: false, entries: [entry], listError: null };
    await rerender(renderer);

    expect(exists(renderer, 'navigation-route-loading')).toBe(false);
    expect(exists(renderer, 'log-entry-detail')).toBe(true);
  });

  test('a plan detail waits behind a delayed skeleton during the first list load', async () => {
    const plan = { ...createBlankDivePlan({ now: 1781353000, localId: 'plan-loading-route' }), title: 'Loading route plan' };
    mockPlanningOverride = { isLoading: false, plans: [plan], listError: null };
    const renderer = await renderApp();

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'nav-tab-planning' }).props.onPress();
    });
    await waitFor(() => exists(renderer, `planning-plan-row-${plan.localId}`));
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: `planning-plan-row-${plan.localId}` }).props.onPress();
    });
    await waitFor(() => exists(renderer, 'planning-detail-edit'));
    expect(exists(renderer, 'planning-detail-edit')).toBe(true);

    mockPlanningOverride = { isLoading: true, plans: [], listError: null };
    await rerender(renderer);

    expect(exists(renderer, 'navigation-route-loading')).toBe(true);
    expect(skeletonTitleState(renderer)).toBe('hidden');
    await waitPastSkeletonDelay();
    expect(skeletonTitleState(renderer)).toBe('visible');

    mockPlanningOverride = { isLoading: false, plans: [plan], listError: null };
    await rerender(renderer);

    expect(exists(renderer, 'navigation-route-loading')).toBe(false);
    expect(exists(renderer, 'planning-detail-edit')).toBe(true);
  });

  test('a failed first list load shows the load error with a retry instead of the deleted-item message', async () => {
    const renderer = await renderApp();
    const refresh = jest.fn(async () => undefined);

    mockLogbookOverride = { isLoading: false, entries: [], listError: new Error('storage unavailable'), refresh };
    await openLogFromNotification('log-failed-route');
    await waitFor(() => exists(renderer, 'navigation-route-load-failed'));

    expect(exists(renderer, 'navigation-route-load-failed')).toBe(true);
    expect(exists(renderer, 'navigation-missing-route')).toBe(false);
    expect(exists(renderer, 'navigation-route-loading')).toBe(false);
    expect(renderer.root.findAll(node => node.props.children === i18n.t('logbook.loadFailed')).length).toBeGreaterThan(0);

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'navigation-route-retry' }).props.onPress();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('bottom toasts', () => {
  beforeEach(() => {
    const asyncStorageMock = jest.requireMock('@react-native-async-storage/async-storage') as {
      __resetAsyncStorageMock: () => void;
    };
    asyncStorageMock.__resetAsyncStorageMock();
    mockLogbookOverride = undefined;
    mockPlanningOverride = undefined;
    mockWatchLinkHandler = undefined;
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  test('app feedback stacks above a watch import toast instead of covering its buttons', async () => {
    const fixture = jest.requireActual('../../../packages/contracts/fixtures/metadata-rich-watch-sync-message.json');
    const renderer = await renderApp();
    await waitFor(() => mockWatchLinkHandler !== undefined);

    await ReactTestRenderer.act(async () => {
      mockWatchLinkHandler?.({
        payloadId: 'stack-toast-payload',
        payloadJson: JSON.stringify({
          ...fixture,
          session: {
            ...fixture.session,
            localSessionId: 'stack-toast-session',
            endedAt: 1781357600,
            samples: fixture.session.samples.map((sample: Record<string, unknown>) => ({
              ...sample,
              localSessionId: 'stack-toast-session',
            })),
          },
        }),
        localSessionId: 'stack-toast-session',
        receivedAt: 1781357600,
      });
    });
    await waitFor(() => exists(renderer, 'watch-auto-import-toast'));
    await ReactTestRenderer.act(async () => {
      renderer.root
        .findByProps({ testID: 'watch-auto-import-toast' })
        .props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 288, height: 120 } } });
    });

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'nav-tab-logbook' }).props.onPress();
    });
    await waitFor(() => exists(renderer, 'logbook-import-action'));
    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'logbook-import-action' }).props.onPress();
    });
    await waitFor(() => exists(renderer, 'app-feedback'));

    // Edge gap 16 + tab bar 68 + toast 120 + stack gap 8, with no bottom inset in this test.
    let banner: ReactTestRenderer.ReactTestInstance | null = renderer.root.findByProps({ testID: 'app-feedback' });
    while (banner && typeof banner.props.style?.bottom !== 'number') {
      banner = banner.parent;
    }
    expect(banner?.props.style.bottom).toBe(212);
    expect(exists(renderer, 'watch-auto-import-open-log')).toBe(true);
  });
});
