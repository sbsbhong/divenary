import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import i18n from '../src/i18n';
import { HStack } from '../src/components/ui/hstack';
import { Icon } from '../src/components/ui/icon';
import { AppPreferencesProvider } from '../src/states/app-preferences';
import SettingsScreen, { type SettingsRoute } from '../src/screens/settings/screen';
import type { LinkedWatchInfo } from '../src/native/watch-connectivity';
import type { AuthContextValue } from '../src/states/auth';
import type { GuestClaimViewState } from '../src/claim/guest-claim-types';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import {
  createWatchRejectedPayloadStore,
  type WatchRejectedPayloadStore,
} from '../src/storage/watch-rejected-payload-store';

const mockUseAuth = jest.fn<AuthContextValue, []>();

jest.mock('../src/states/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

const createAuthContext = (overrides?: Partial<AuthContextValue>): AuthContextValue => ({
  state: { status: 'guest' },
  isConfigured: false,
  availableProviders: [],
  recentProvider: undefined,
  isDevelopmentSignInAvailable: false,
  signIn: jest.fn(async () => undefined),
  signInForDevelopment: jest.fn(async () => undefined),
  completeOnboarding: jest.fn(async () => undefined),
  cancelOnboarding: jest.fn(async () => undefined),
  signOut: jest.fn(async () => undefined),
  ...overrides,
});

const linkedWatchInfo: LinkedWatchInfo = {
  isSupported: true,
  isPaired: true,
  isWatchAppInstalled: true,
  isReachable: true,
  name: 'Seongbin Apple Watch',
};

const renderSettings = async (options?: {
  loadLinkedWatchInfo?: () => Promise<LinkedWatchInfo>;
  onBack?: () => void;
  onOpenLogin?: () => void;
  onOpenRoute?: (route: Exclude<SettingsRoute, 'index'>) => void;
  requestWatchSyncNotificationPermission?: () => Promise<boolean>;
  hasWatchSyncNotificationPermission?: () => Promise<boolean>;
  openNotificationSettings?: () => Promise<void>;
  route?: SettingsRoute;
  accountClaim?: {
    isOnline: boolean;
    eligible: { logCount: number; planCount: number };
    state: GuestClaimViewState;
  };
  onOpenAccountClaim?: () => void;
  rejectedWatchPayloadStore?: WatchRejectedPayloadStore;
}) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <AppPreferencesProvider>
        <SettingsScreen
          rejectedWatchPayloadStore={
            options?.rejectedWatchPayloadStore ??
            createWatchRejectedPayloadStore({ storage: new InMemoryKeyValueStore() })
          }
          loadLinkedWatchInfo={options?.loadLinkedWatchInfo ?? (() => Promise.resolve(linkedWatchInfo))}
          requestWatchSyncNotificationPermission={options?.requestWatchSyncNotificationPermission}
          hasWatchSyncNotificationPermission={options?.hasWatchSyncNotificationPermission}
          openNotificationSettings={options?.openNotificationSettings}
          route={options?.route}
          onBack={options?.onBack}
          onOpenLogin={options?.onOpenLogin}
          onOpenRoute={options?.onOpenRoute}
          accountClaim={options?.accountClaim}
          onOpenAccountClaim={options?.onOpenAccountClaim}
        />
      </AppPreferencesProvider>,
    );
  });

  return renderer!;
};

describe('SettingsScreen', () => {
  beforeEach(async () => {
    const asyncStorageMock = jest.requireMock('@react-native-async-storage/async-storage') as {
      __resetAsyncStorageMock: () => void;
    };

    asyncStorageMock.__resetAsyncStorageMock();
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(createAuthContext());

    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  test('renders grouped Settings rows with current values', async () => {
    const renderer = await renderSettings();
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-screen-title' }).props.children).toBe('설정');
    expect(root.findByProps({ testID: 'settings-current-theme' }).props.children).toBe('시스템 기본값');
    expect(root.findByProps({ testID: 'settings-current-language' }).props.children).toBe('한국어');
    expect(root.findByProps({ testID: 'settings-current-watch-sync-notifications' }).props.children).toBe('꺼짐');
    expect(root.findByProps({ testID: 'settings-row-theme-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'settings-row-language-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'settings-row-notifications-icon' })).toBeTruthy();
    const rowIconClassName = root.findByProps({
      testID: 'settings-row-theme-icon',
    }).props.className;
    const linkedWatchIcon = root.findByProps({
      testID: 'settings-linked-watch-icon',
    });
    expect(linkedWatchIcon.props.className).toBe(rowIconClassName);
    expect(linkedWatchIcon.findByType(Icon).props.size).toBe('sm');
    expect(root.findByProps({ testID: 'settings-row-theme-disclosure' })).toBeTruthy();
    expect(root.findByProps({ testID: 'settings-row-devices-disclosure' })).toBeTruthy();
  });

  test('keeps local Settings usable when social sign-in is not configured', async () => {
    const onOpenLogin = jest.fn();
    const renderer = await renderSettings({ onOpenLogin });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-section-account' }).props.children).toBe('계정');
    expect(root.findByProps({ testID: 'settings-account-status' }).props.children).toBe('로그인 설정 필요');
    expect(root.findByProps({ testID: 'settings-account-description' }).props.children).toContain('로컬 기록');
    expect(root.findAllByProps({ testID: 'settings-account-action' })).toHaveLength(0);
    expect(onOpenLogin).not.toHaveBeenCalled();
    expect(root.findByProps({ testID: 'settings-row-theme' })).toBeTruthy();
  });

  test('opens social login from a configured guest account row', async () => {
    const onOpenLogin = jest.fn();
    mockUseAuth.mockReturnValue(
      createAuthContext({
        isConfigured: true,
        availableProviders: ['google', 'apple'],
      }),
    );
    const renderer = await renderSettings({ onOpenLogin });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-account-status' }).props.children).toBe('게스트로 사용 중');
    expect(root.findAllByProps({ testID: 'settings-account-description' })).toHaveLength(0);
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-account-action' }).props.onPress();
    });

    expect(onOpenLogin).toHaveBeenCalledTimes(1);
  });

  test('shows required-consent account status without exposing account actions', async () => {
    mockUseAuth.mockReturnValue(
      createAuthContext({
        isConfigured: true,
        state: {
          status: 'pendingOnboarding',
          userId: 'user-id',
          documents: [],
        },
      }),
    );
    const renderer = await renderSettings();
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-account-status' }).props.children).toBe('필수 동의 필요');
    expect(root.findAllByProps({ testID: 'settings-account-action' })).toHaveLength(0);
  });

  test('signs out an authenticated account explicitly', async () => {
    const signOut = jest.fn(async () => undefined);
    mockUseAuth.mockReturnValue(
      createAuthContext({
        isConfigured: true,
        state: { status: 'authenticated', userId: 'user-id' },
        signOut,
      }),
    );
    const renderer = await renderSettings();
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-account-status' }).props.children).toBe('로그인됨');
    expect(root.findAllByProps({ testID: 'settings-account-description' })).toHaveLength(0);
    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'settings-account-action' }).props.onPress();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test('shows the eligible device-data count and opens the claim sheet', async () => {
    const onOpenAccountClaim = jest.fn();
    mockUseAuth.mockReturnValue(
      createAuthContext({
        isConfigured: true,
        state: { status: 'authenticated', userId: 'user-id' },
      }),
    );
    const renderer = await renderSettings({
      accountClaim: {
        isOnline: true,
        eligible: { logCount: 3, planCount: 2 },
        state: { status: 'choice', logCount: 3, planCount: 2 },
      },
      onOpenAccountClaim,
    });

    expect(renderer.root.findByProps({ testID: 'settings-row-account-claim' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'settings-account-claim-count' }).props.children).toBe('5');
    expect(renderer.root.findByProps({ testID: 'settings-row-account-claim-icon' })).toBeTruthy();
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'settings-row-account-claim' }).props.onPress();
    });
    expect(onOpenAccountClaim).toHaveBeenCalledTimes(1);
  });

  test('uses the live device-data count after a partial import', async () => {
    mockUseAuth.mockReturnValue(
      createAuthContext({
        isConfigured: true,
        state: {status: 'authenticated', userId: 'user-id'},
      }),
    );
    const retainedItem = {
      entityKind: 'log' as const,
      clientRecordId: 'log-a',
      localRecordSha256: 'a'.repeat(64),
      label: '위치 다이브',
      reason: 'profile_missing' as const,
    };
    const renderer = await renderSettings({
      accountClaim: {
        isOnline: true,
        eligible: {logCount: 1, planCount: 0},
        state: {
          status: 'complete',
          imported: 13,
          retainedItems: [retainedItem],
        },
      },
      onOpenAccountClaim: jest.fn(),
    });

    expect(
      renderer.root.findByProps({testID: 'settings-row-account-claim'}),
    ).toBeTruthy();
    expect(
      renderer.root.findByProps({testID: 'settings-account-claim-count'}).props
        .children,
    ).toBe('1');
  });

  const staleClaimStates: GuestClaimViewState[] = [
    {
      status: 'deferred',
      logCount: 0,
      planCount: 0,
    },
    {
      status: 'failed',
      completed: 0,
      total: 15,
      errorCode: 'claim_validation_failed',
    },
    {
      status: 'retained',
      retainedItems: [
        {
          entityKind: 'log',
          clientRecordId: 'log-a',
          localRecordSha256: 'a'.repeat(64),
          reason: 'profile_missing',
        },
      ],
    },
  ];

  test.each(staleClaimStates)('hides stale $status claim state when live inventory is empty', async claimState => {
    mockUseAuth.mockReturnValue(
      createAuthContext({
        isConfigured: true,
        state: {status: 'authenticated', userId: 'user-id'},
      }),
    );
    const renderer = await renderSettings({
      accountClaim: {
        isOnline: true,
        eligible: {logCount: 0, planCount: 0},
        state: claimState,
      },
      onOpenAccountClaim: jest.fn(),
    });

    expect(
      renderer.root.findAllByProps({testID: 'settings-row-account-claim'}),
    ).toHaveLength(0);
  });

  test('does not replace a live count with a failed snapshot total', async () => {
    mockUseAuth.mockReturnValue(
      createAuthContext({
        isConfigured: true,
        state: {status: 'authenticated', userId: 'user-id'},
      }),
    );
    const renderer = await renderSettings({
      accountClaim: {
        isOnline: true,
        eligible: {logCount: 1, planCount: 0},
        state: {
          status: 'failed',
          completed: 0,
          total: 15,
          errorCode: 'claim_validation_failed',
        },
      },
      onOpenAccountClaim: jest.fn(),
    });

    expect(
      renderer.root.findByProps({testID: 'settings-account-claim-count'}).props
        .children,
    ).toBe('1');
  });

  test.each([
    ['guest', { status: 'guest' } as const, true, { logCount: 1, planCount: 1 }, { status: 'choice', logCount: 1, planCount: 1 } as const],
    ['zero eligible rows', { status: 'authenticated', userId: 'user-id' } as const, true, { logCount: 0, planCount: 0 }, { status: 'hidden' } as const],
    ['isolated foreign manifest', { status: 'authenticated', userId: 'user-id' } as const, true, { logCount: 0, planCount: 0 }, { status: 'hidden' } as const],
  ])('hides device-data import for %s', async (_label, authState, isOnline, eligible, claimState) => {
    mockUseAuth.mockReturnValue(createAuthContext({ isConfigured: true, state: authState }));
    const renderer = await renderSettings({
      accountClaim: { isOnline, eligible, state: claimState },
      onOpenAccountClaim: jest.fn(),
    });

    expect(renderer.root.findAllByProps({ testID: 'settings-row-account-claim' })).toHaveLength(0);
  });

  test.each([
    { status: 'running', completed: 1, total: 2 } as const,
    { status: 'failed', completed: 1, total: 2, errorCode: 'network_unavailable' } as const,
    { status: 'hidden' } as const,
    { status: 'deferred', logCount: 1, planCount: 0 } as const,
  ])('keeps device-data import available for an eligible non-running claim', async claimState => {
    mockUseAuth.mockReturnValue(
      createAuthContext({ isConfigured: true, state: { status: 'authenticated', userId: 'user-id' } }),
    );
    const renderer = await renderSettings({
      accountClaim: { isOnline: true, eligible: { logCount: 1, planCount: 0 }, state: claimState },
      onOpenAccountClaim: jest.fn(),
    });

    expect(renderer.root.findByProps({ testID: 'settings-row-account-claim' })).toBeTruthy();
  });

  test('keeps account claim status visible while the account is offline', async () => {
    mockUseAuth.mockReturnValue(
      createAuthContext({
        isConfigured: true,
        state: {status: 'authenticatedOffline', userId: 'user-id'},
      }),
    );
    const renderer = await renderSettings({
      accountClaim: {
        isOnline: false,
        eligible: {logCount: 1, planCount: 1},
        state: {status: 'choice', logCount: 1, planCount: 1},
      },
      onOpenAccountClaim: jest.fn(),
    });

    expect(
      renderer.root.findByProps({testID: 'settings-row-account-claim'}),
    ).toBeTruthy();
  });

  test('labels offline membership as local-only and still allows logout', async () => {
    const signOut = jest.fn(async () => undefined);
    mockUseAuth.mockReturnValue(
      createAuthContext({
        isConfigured: true,
        state: { status: 'authenticatedOffline', userId: 'user-id' },
        signOut,
      }),
    );
    const renderer = await renderSettings();
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-account-status' }).props.children).toBe('오프라인 계정');
    expect(root.findByProps({ testID: 'settings-account-description' }).props.children).toContain('로컬 데이터');
    expect(root.findByProps({ testID: 'settings-account-description' }).props.children).toContain('확인할 수 없습니다');
    expect(root.findByProps({ testID: 'settings-account-action' })).toBeTruthy();
  });

  test('shows linked watch in device management with icon and status', async () => {
    const renderer = await renderSettings();
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-section-devices' }).props.children).toBe('기기 관리');
    expect(root.findByProps({ testID: 'settings-linked-watch-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'settings-linked-watch-name' }).props.children).toBe('Seongbin Apple Watch');
    expect(root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe('연결됨');
  });

  test('delegates setting detail opening to the app route when provided', async () => {
    const onOpenRoute = jest.fn();
    const renderer = await renderSettings({ onOpenRoute });
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-row-theme' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-row-devices' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-row-notifications' }).props.onPress();
    });

    expect(onOpenRoute).toHaveBeenNthCalledWith(1, 'theme');
    expect(onOpenRoute).toHaveBeenNthCalledWith(2, 'devices');
    expect(onOpenRoute).toHaveBeenNthCalledWith(3, 'notifications');
    expect(root.findAllByProps({ testID: 'settings-detail-title' })).toHaveLength(0);
  });

  test('opens notification detail and enables watch sync notifications after permission is granted', async () => {
    const requestWatchSyncNotificationPermission = jest.fn().mockResolvedValue(true);
    const renderer = await renderSettings({
      requestWatchSyncNotificationPermission,
      hasWatchSyncNotificationPermission: jest.fn().mockResolvedValue(true),
    });
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-row-notifications' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'settings-detail-title' }).props.children).toBe('알림');
    expect(root.findByProps({ testID: 'settings-option-watch-sync-notifications' }).props.accessibilityState.selected).toBe(false);

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'settings-option-watch-sync-notifications' }).props.onPress();
    });

    expect(requestWatchSyncNotificationPermission).toHaveBeenCalledTimes(1);
    expect(root.findByProps({ testID: 'settings-option-watch-sync-notifications' }).props.accessibilityState.selected).toBe(true);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-back' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'settings-current-watch-sync-notifications' }).props.children).toBe('켜짐');
  });

  test('renders detail back navigation as an accessible icon control', async () => {
    const renderer = await renderSettings({ route: 'theme' });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-back' }).props.accessibilityLabel).toBe('설정');
    expect(root.findByProps({ testID: 'settings-back-icon' })).toBeTruthy();
  });

  test('keeps watch sync notifications disabled when permission is denied', async () => {
    const requestWatchSyncNotificationPermission = jest.fn().mockResolvedValue(false);
    const renderer = await renderSettings({
      requestWatchSyncNotificationPermission,
      route: 'notifications',
    });
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'settings-option-watch-sync-notifications' }).props.onPress();
    });

    expect(requestWatchSyncNotificationPermission).toHaveBeenCalledTimes(1);
    expect(root.findByProps({ testID: 'settings-option-watch-sync-notifications' }).props.accessibilityState.selected).toBe(false);
  });

  test('uses platform-neutral English copy when notification permission is denied', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const renderer = await renderSettings({
      requestWatchSyncNotificationPermission: jest.fn().mockResolvedValue(false),
      route: 'notifications',
    });
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
    });
    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'settings-option-watch-sync-notifications' }).props.onPress();
    });

    expect(alert).toHaveBeenCalledWith(
      'Notification permission needed',
      'Allow notifications for this app in device Settings, then return to turn this on automatically.',
      [
        { text: 'Cancel', style: 'cancel' },
        expect.objectContaining({ text: 'Open Settings' }),
      ],
    );
  });

  test('enables the toggle after a physical-device permission change in iOS Settings', async () => {
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    });
    let settingsAction: (() => void) | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      settingsAction = buttons?.find(button => button.text === '설정 열기')?.onPress;
    });
    const openNotificationSettings = jest.fn().mockResolvedValue(undefined);
    const hasWatchSyncNotificationPermission = jest.fn().mockResolvedValue(true);
    const renderer = await renderSettings({
      route: 'notifications',
      requestWatchSyncNotificationPermission: jest.fn().mockResolvedValue(false),
      hasWatchSyncNotificationPermission,
      openNotificationSettings,
    });
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'settings-option-watch-sync-notifications' }).props.onPress();
      settingsAction?.();
      await Promise.resolve();
    });
    expect(openNotificationSettings).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      appStateListener?.('active');
      await Promise.resolve();
    });

    expect(hasWatchSyncNotificationPermission).toHaveBeenCalled();
    expect(root.findByProps({ testID: 'settings-option-watch-sync-notifications' }).props.accessibilityState.selected).toBe(true);
  });

  test('renders device management as a detail screen', async () => {
    const renderer = await renderSettings({ route: 'devices' });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-detail-title' }).props.children).toBe('기기 관리');
    expect(root.findByProps({ testID: 'settings-linked-watch-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'settings-linked-watch-name' }).props.children).toBe('Seongbin Apple Watch');
  });

  test('lists watch recordings the phone set aside and lets the user clear them', async () => {
    const rejectedWatchPayloadStore = createWatchRejectedPayloadStore({ storage: new InMemoryKeyValueStore() });
    await rejectedWatchPayloadStore.recordRejection({ payloadId: 'p1', localSessionId: 's1', reason: 'invalidMessage' });
    await rejectedWatchPayloadStore.recordRejection({ payloadId: 'p2', localSessionId: 's2', reason: 'repeatedImportFailure' });
    const renderer = await renderSettings({ route: 'devices', rejectedWatchPayloadStore });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-rejected-watch-title' }).props.children).toBe(
      '가져오지 못한 워치 기록 2건',
    );
    expect(root.findByProps({ testID: 'settings-rejected-watch-guidance' }).props.children).toBe(
      '워치에는 원본이 남아 있습니다. iPhone과 워치 앱을 최신 버전으로 업데이트한 뒤 워치에서 다시 동기화하세요.',
    );

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'settings-rejected-watch-clear' }).props.onPress();
    });

    expect(root.findAllByProps({ testID: 'settings-rejected-watch-title' })).toHaveLength(0);
    await expect(rejectedWatchPayloadStore.list()).resolves.toEqual([]);
  });

  test('reports a watch status lookup failure and retries it on refresh', async () => {
    const loadLinkedWatchInfo = jest
      .fn<Promise<LinkedWatchInfo>, []>()
      .mockRejectedValueOnce(new Error('bridge busy'))
      .mockResolvedValue(linkedWatchInfo);
    const renderer = await renderSettings({ route: 'devices', loadLinkedWatchInfo });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe(
      '워치 상태를 확인하지 못했습니다',
    );

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'settings-linked-watch-refresh' }).props.onPress();
    });

    expect(loadLinkedWatchInfo).toHaveBeenCalledTimes(2);
    expect(root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe('연결됨');
  });

  test('explains when no watch is paired', async () => {
    const renderer = await renderSettings({
      loadLinkedWatchInfo: () =>
        Promise.resolve({
          isSupported: true,
          isPaired: false,
          isWatchAppInstalled: false,
          isReachable: false,
        }),
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-linked-watch-name' }).props.children).toBe('Apple Watch');
    expect(root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe('연동된 워치 없음');
  });

  test('shows a concise status when the companion watch app is missing', async () => {
    const renderer = await renderSettings({
      loadLinkedWatchInfo: () =>
        Promise.resolve({
          isSupported: true,
          isPaired: true,
          isWatchAppInstalled: false,
          isReachable: false,
        }),
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe('워치 앱 없음');
  });

  test('explains when the iOS native watch bridge is missing from the installed app', async () => {
    const renderer = await renderSettings({
      loadLinkedWatchInfo: () =>
        Promise.resolve({
          nativeBridgeAvailable: false,
          isSupported: false,
          isPaired: false,
          isWatchAppInstalled: false,
          isReachable: false,
        }),
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe(
      '워치 연동을 사용하려면 앱을 업데이트하세요',
    );
  });

  test('stretches index row content so labels and values sit at opposite edges', async () => {
    const renderer = await renderSettings();
    const root = renderer.root;

    const indexRows = root
      .findAllByType(HStack)
      .filter(node => typeof node.props.className === 'string' && node.props.className.includes('justify-between'));

    expect(indexRows).toHaveLength(3);
    indexRows.forEach(row => {
      expect(row.props.className).toEqual(expect.stringContaining('flex-1'));
    });
  });

  test('opens theme detail and applies the selected theme in memory', async () => {
    const renderer = await renderSettings();
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-row-theme' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'settings-detail-title' }).props.children).toBe('테마');
    expect(root.findByProps({ testID: 'settings-option-theme-system' }).props.accessibilityState.selected).toBe(true);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-option-theme-dark' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'settings-option-theme-dark' }).props.accessibilityState.selected).toBe(true);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-back' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'settings-current-theme' }).props.children).toBe('다크');
  });

  test('opens language detail and changes the active language', async () => {
    const renderer = await renderSettings();
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-row-language' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'settings-detail-title' }).props.children).toBe('언어');
    expect(root.findByProps({ testID: 'settings-option-language-ko' }).props.accessibilityState.selected).toBe(true);

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'settings-option-language-en' }).props.onPress();
    });

    expect(i18n.language).toBe('en');
    expect(root.findByProps({ testID: 'settings-detail-title' }).props.children).toBe('Language');
    expect(root.findByProps({ testID: 'settings-option-language-en' }).props.accessibilityState.selected).toBe(true);
  });
});
