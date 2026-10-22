import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, AppState, type AlertButton, type AppStateStatus } from 'react-native';
import i18n from '../src/i18n';
import { CheckIcon } from '../src/components/ui/icon';
import { Switch } from '../src/components/ui/switch';
import { AppPreferencesProvider } from '../src/states/app-preferences';
import SettingsScreen, { type SettingsRoute } from '../src/screens/settings/screen';
import type { LinkedWatchInfo } from '../src/companion/watch-link';
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

const signedIn = (overrides?: Partial<AuthContextValue>) =>
  createAuthContext({ isConfigured: true, state: { status: 'authenticated', userId: 'user-id' }, ...overrides });

const linkedWatchInfo: LinkedWatchInfo = {
  isSupported: true,
  isPaired: true,
  isWatchAppInstalled: true,
  isReachable: true,
  name: 'Seongbin Apple Watch',
};

type RenderOptions = {
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
  loadPendingChangeCount?: () => Promise<number>;
  syncPendingChanges?: () => Promise<unknown>;
  isCloudRefreshing?: boolean;
  appVersion?: string;
};

const renderSettings = async (options?: RenderOptions) => {
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
          loadPendingChangeCount={options?.loadPendingChangeCount}
          syncPendingChanges={options?.syncPendingChanges}
          isCloudRefreshing={options?.isCloudRefreshing}
          appVersion={options?.appVersion}
        />
      </AppPreferencesProvider>,
    );
  });

  return renderer!;
};

/** All visible copy under a node, joined, for "this row says X" checks. */
function renderedText(node: ReactTestRenderer.ReactTestInstance): string {
  return node
    .findAll(child => (child.type as string) === 'Text')
    .map(child =>
      [child.props.children]
        .flat()
        .filter(part => typeof part === 'string' || typeof part === 'number')
        .join(''),
    )
    .join(' | ');
}

/** The pressable element behind a grouped row (it carries the accessibility state). */
function findControl(root: ReactTestRenderer.ReactTestInstance, testID: string) {
  const control = root.findAll(node => node.props.testID === testID && node.props.accessibilityState !== undefined)[0];
  if (!control) {
    throw new Error(`No control with testID ${testID}`);
  }
  return control;
}

function notificationSwitch(root: ReactTestRenderer.ReactTestInstance) {
  return root.findByProps({ testID: 'settings-row-notifications' }).findByType(Switch);
}

async function flush() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
}

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

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('renders grouped Settings rows with current values and neutral icons', async () => {
    const renderer = await renderSettings();
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-screen-title' }).props.children).toBe('설정');
    expect(root.findByProps({ testID: 'settings-screen-title' }).props.accessibilityRole).toBe('header');
    expect(root.findByProps({ testID: 'settings-current-theme' }).props.children).toBe('시스템 기본값');
    expect(root.findByProps({ testID: 'settings-current-language' }).props.children).toBe('한국어');
    expect(notificationSwitch(root).props.value).toBe(false);
    expect(root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe('연결됨');

    const themeRow = findControl(root, 'settings-row-theme');
    expect(themeRow.props.accessibilityRole).toBe('button');
    const iconBubbles = themeRow.findAll(
      node => typeof node.props.className === 'string' && node.props.className.includes('rounded-full'),
    );
    expect(iconBubbles.length).toBeGreaterThan(0);
    expect(iconBubbles[0].props.className).toContain('bg-muted');
    expect(iconBubbles[0].props.className).not.toContain('bg-primary');
  });

  test('shows only that records are saved on this device when Auth is not configured', async () => {
    const onOpenLogin = jest.fn();
    const renderer = await renderSettings({ onOpenLogin });
    const root = renderer.root;

    expect(renderedText(root.findByProps({ testID: 'settings-section-account' }))).toContain('계정');
    expect(renderedText(root.findByProps({ testID: 'settings-account-status' }))).toBe('이 기기에만 저장');
    expect(root.findByProps({ testID: 'settings-account-status' }).props.onPress).toBeUndefined();
    expect(root.findAllByProps({ testID: 'settings-account-action' })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('로그인');
    expect(onOpenLogin).not.toHaveBeenCalled();
    expect(root.findByProps({ testID: 'settings-row-theme' })).toBeTruthy();
  });

  test('opens social login from a configured guest account row with a one-line benefit', async () => {
    const onOpenLogin = jest.fn();
    mockUseAuth.mockReturnValue(createAuthContext({ isConfigured: true, availableProviders: ['google', 'apple'] }));
    const renderer = await renderSettings({ onOpenLogin });
    const root = renderer.root;
    const accountRow = root.findByProps({ testID: 'settings-account-action' });

    expect(renderedText(accountRow)).toBe('로그인 | 기록을 백업하고 다른 기기에서도 볼 수 있습니다.');
    await ReactTestRenderer.act(async () => {
      accountRow.props.onPress();
    });

    expect(onOpenLogin).toHaveBeenCalledTimes(1);
  });

  test('treats a configured build without a usable sign-in method like a local-only build', async () => {
    mockUseAuth.mockReturnValue(createAuthContext({ isConfigured: true, availableProviders: [] }));
    const renderer = await renderSettings({ onOpenLogin: jest.fn() });

    expect(renderedText(renderer.root.findByProps({ testID: 'settings-account-status' }))).toBe('이 기기에만 저장');
    expect(renderer.root.findAllByProps({ testID: 'settings-account-action' })).toHaveLength(0);

    mockUseAuth.mockReturnValue(
      createAuthContext({ isConfigured: true, availableProviders: [], isDevelopmentSignInAvailable: true }),
    );
    const development = await renderSettings({ onOpenLogin: jest.fn() });
    expect(development.root.findByProps({ testID: 'settings-account-action' })).toBeTruthy();
  });

  test('shows required-consent account status without exposing account actions', async () => {
    mockUseAuth.mockReturnValue(
      createAuthContext({
        isConfigured: true,
        state: { status: 'pendingOnboarding', userId: 'user-id', documents: [] },
      }),
    );
    const renderer = await renderSettings();
    const root = renderer.root;

    expect(renderedText(root.findByProps({ testID: 'settings-account-status' }))).toBe('이용약관·개인정보 동의 필요');
    expect(root.findAllByProps({ testID: 'settings-account-action' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'settings-row-account' })).toHaveLength(0);
  });

  test.each([
    ['apple', 'Apple로 로그인됨'],
    ['google', 'Google로 로그인됨'],
    [undefined, '로그인됨'],
  ] as const)('labels the signed-in account from the %s provider hint and opens account detail', async (recentProvider, label) => {
    const onOpenRoute = jest.fn();
    mockUseAuth.mockReturnValue(signedIn({ recentProvider }));
    const renderer = await renderSettings({ onOpenRoute });
    const accountRow = renderer.root.findByProps({ testID: 'settings-row-account' });

    expect(renderedText(accountRow)).toBe(label);
    await ReactTestRenderer.act(async () => {
      accountRow.props.onPress();
    });
    expect(onOpenRoute).toHaveBeenCalledWith('account');
  });

  test('shows sync status in account detail and confirms sign-out with what stays and what is unsent', async () => {
    const signOut = jest.fn(async () => undefined);
    let alertButtons: AlertButton[] | undefined;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      alertButtons = buttons;
    });
    mockUseAuth.mockReturnValue(signedIn({ recentProvider: 'apple', signOut }));
    const renderer = await renderSettings({ route: 'account', loadPendingChangeCount: async () => 2 });
    const root = renderer.root;
    await flush();

    expect(root.findByProps({ testID: 'settings-detail-title' }).props.children).toBe('계정');
    expect(renderedText(root.findByProps({ testID: 'settings-account-identity' }))).toBe('Apple로 로그인됨');
    expect(root.findByProps({ testID: 'settings-account-sync-status' }).props.children).toBe('백업 대기 2건');

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'settings-account-sign-out' }).props.onPress();
    });

    expect(signOut).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message] = alert.mock.calls[0];
    expect(title).toBe('로그아웃할까요?');
    expect(message).toContain(i18n.t('settings.account.signOutMessage'));
    expect(message).toContain('기록은 그대로 남습니다.');
    expect(message).toContain('아직 백업하지 못한 변경 2건');
    expect(message).not.toMatch(/클라우드|게스트/);
    expect(alertButtons?.map(button => button.style)).toEqual(['cancel', 'destructive']);

    await ReactTestRenderer.act(async () => {
      alertButtons?.find(button => button.style === 'destructive')?.onPress?.();
      await Promise.resolve();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test('leaves the unsent-changes sentence out when nothing is waiting', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockUseAuth.mockReturnValue(signedIn());
    const renderer = await renderSettings({ route: 'account', loadPendingChangeCount: async () => 0 });
    await flush();

    expect(renderer.root.findByProps({ testID: 'settings-account-sync-status' }).props.children).toBe('백업 대기 없음');
    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'settings-account-sign-out' }).props.onPress();
    });

    expect(alert.mock.calls[0][1]).not.toContain('백업하지 못한');
  });

  test('warns that changes may be waiting when the count cannot be read', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockUseAuth.mockReturnValue(signedIn());
    const renderer = await renderSettings({
      route: 'account',
      loadPendingChangeCount: async () => {
        throw new Error('storage unavailable');
      },
    });
    await flush();

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'settings-account-sign-out' }).props.onPress();
    });

    expect(alert.mock.calls[0][1]).toContain('아직 백업하지 못한 변경이 있을 수 있습니다.');
  });

  test('counts waiting changes again once the backup pass started on open settles', async () => {
    let finishSync: (() => void) | undefined;
    const syncPendingChanges = jest.fn(
      () =>
        new Promise<void>(resolve => {
          finishSync = resolve;
        }),
    );
    const loadPendingChangeCount = jest.fn().mockResolvedValueOnce(1).mockResolvedValue(0);
    mockUseAuth.mockReturnValue(signedIn());
    const renderer = await renderSettings({ route: 'account', loadPendingChangeCount, syncPendingChanges });
    await flush();
    const status = () => renderer.root.findByProps({ testID: 'settings-account-sync-status' }).props.children;

    expect(syncPendingChanges).toHaveBeenCalledTimes(1);
    expect(status()).toBe('백업 대기 1건');

    await ReactTestRenderer.act(async () => {
      finishSync?.();
    });
    await flush();

    expect(status()).toBe('백업 대기 없음');
  });

  test('does not start a backup pass while signed in offline', async () => {
    const syncPendingChanges = jest.fn(async () => undefined);
    mockUseAuth.mockReturnValue(signedIn({ state: { status: 'authenticatedOffline', userId: 'user-id' } }));
    await renderSettings({ route: 'account', loadPendingChangeCount: async () => 0, syncPendingChanges });
    await flush();

    expect(syncPendingChanges).not.toHaveBeenCalled();
  });

  test('keeps sign-out busy while it runs and shows its spinner only after 1 s', async () => {
    jest.useFakeTimers();
    let finishSignOut: (() => void) | undefined;
    const signOut = jest.fn(
      () =>
        new Promise<void>(resolve => {
          finishSignOut = resolve;
        }),
    );
    let alertButtons: AlertButton[] | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      alertButtons = buttons;
    });
    mockUseAuth.mockReturnValue(signedIn({ signOut }));
    const renderer = await renderSettings({ route: 'account', loadPendingChangeCount: async () => 0 });
    const signOutRow = () => renderer.root.findByProps({ testID: 'settings-account-sign-out' });

    await ReactTestRenderer.act(async () => {
      await signOutRow().props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      alertButtons?.find(button => button.style === 'destructive')?.onPress?.();
      await Promise.resolve();
    });

    expect(signOutRow().props.accessibilityState).toEqual({ busy: true, disabled: true });
    expect(renderer.root.findAllByProps({ testID: 'settings-account-sign-out-spinner' })).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(renderer.root.findAllByProps({ testID: 'settings-account-sign-out-spinner' }).length).toBeGreaterThan(0);

    await ReactTestRenderer.act(async () => {
      finishSignOut?.();
      await Promise.resolve();
    });
    expect(signOutRow().props.accessibilityState).toEqual({ busy: false, disabled: false });
  });

  test('shows the eligible device-data count in account detail and opens the claim sheet', async () => {
    const onOpenAccountClaim = jest.fn();
    mockUseAuth.mockReturnValue(signedIn());
    const renderer = await renderSettings({
      route: 'account',
      accountClaim: {
        isOnline: true,
        eligible: { logCount: 3, planCount: 2 },
        state: { status: 'choice', logCount: 3, planCount: 2 },
      },
      onOpenAccountClaim,
    });

    expect(renderedText(renderer.root.findByProps({ testID: 'settings-row-account-claim' }))).toContain('로그인 전 기록 옮기기');
    expect(renderer.root.findByProps({ testID: 'settings-account-claim-count' }).props.children).toBe('기록 5개');
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'settings-row-account-claim' }).props.onPress();
    });
    expect(onOpenAccountClaim).toHaveBeenCalledTimes(1);
  });

  test('uses the live device-data count after a partial import', async () => {
    mockUseAuth.mockReturnValue(signedIn());
    const retainedItem = {
      entityKind: 'log' as const,
      clientRecordId: 'log-a',
      localRecordSha256: 'a'.repeat(64),
      label: '위치 다이브',
      reason: 'profile_missing' as const,
    };
    const renderer = await renderSettings({
      route: 'account',
      accountClaim: {
        isOnline: true,
        eligible: { logCount: 1, planCount: 0 },
        state: { status: 'complete', imported: 13, retainedItems: [retainedItem] },
      },
      onOpenAccountClaim: jest.fn(),
    });

    expect(renderer.root.findByProps({ testID: 'settings-account-claim-count' }).props.children).toBe('기록 1개');
  });

  const staleClaimStates: GuestClaimViewState[] = [
    { status: 'deferred', logCount: 0, planCount: 0 },
    { status: 'failed', completed: 0, total: 15, errorCode: 'claim_validation_failed' },
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
    mockUseAuth.mockReturnValue(signedIn());
    const renderer = await renderSettings({
      route: 'account',
      accountClaim: { isOnline: true, eligible: { logCount: 0, planCount: 0 }, state: claimState },
      onOpenAccountClaim: jest.fn(),
    });

    expect(renderer.root.findAllByProps({ testID: 'settings-row-account-claim' })).toHaveLength(0);
  });

  test('does not replace a live count with a failed snapshot total', async () => {
    mockUseAuth.mockReturnValue(signedIn());
    const renderer = await renderSettings({
      route: 'account',
      accountClaim: {
        isOnline: true,
        eligible: { logCount: 1, planCount: 0 },
        state: { status: 'failed', completed: 0, total: 15, errorCode: 'claim_validation_failed' },
      },
      onOpenAccountClaim: jest.fn(),
    });

    expect(renderer.root.findByProps({ testID: 'settings-account-claim-count' }).props.children).toBe('기록 1개');
  });

  test.each([
    ['guest', { status: 'guest' } as const, { logCount: 1, planCount: 1 }, { status: 'choice', logCount: 1, planCount: 1 } as const],
    ['zero eligible rows', { status: 'authenticated', userId: 'user-id' } as const, { logCount: 0, planCount: 0 }, { status: 'hidden' } as const],
    ['isolated foreign manifest', { status: 'authenticated', userId: 'user-id' } as const, { logCount: 0, planCount: 0 }, { status: 'hidden' } as const],
  ])('hides device-data import for %s', async (_label, authState, eligible, claimState) => {
    mockUseAuth.mockReturnValue(createAuthContext({ isConfigured: true, state: authState }));
    for (const route of ['index', 'account'] as const) {
      const renderer = await renderSettings({
        route,
        accountClaim: { isOnline: true, eligible, state: claimState },
        onOpenAccountClaim: jest.fn(),
      });

      expect(renderer.root.findAllByProps({ testID: 'settings-row-account-claim' })).toHaveLength(0);
    }
  });

  test.each([
    { status: 'running', completed: 1, total: 2 } as const,
    { status: 'failed', completed: 1, total: 2, errorCode: 'network_unavailable' } as const,
    { status: 'hidden' } as const,
    { status: 'deferred', logCount: 1, planCount: 0 } as const,
  ])('keeps device-data import available for an eligible non-running claim', async claimState => {
    mockUseAuth.mockReturnValue(signedIn());
    const renderer = await renderSettings({
      route: 'account',
      accountClaim: { isOnline: true, eligible: { logCount: 1, planCount: 0 }, state: claimState },
      onOpenAccountClaim: jest.fn(),
    });

    expect(renderer.root.findByProps({ testID: 'settings-row-account-claim' })).toBeTruthy();
  });

  test('keeps account claim status visible while the account is offline', async () => {
    mockUseAuth.mockReturnValue(signedIn({ state: { status: 'authenticatedOffline', userId: 'user-id' } }));
    const renderer = await renderSettings({
      route: 'account',
      accountClaim: {
        isOnline: false,
        eligible: { logCount: 1, planCount: 1 },
        state: { status: 'choice', logCount: 1, planCount: 1 },
      },
      onOpenAccountClaim: jest.fn(),
    });

    expect(renderer.root.findByProps({ testID: 'settings-row-account-claim' })).toBeTruthy();
  });

  test('labels offline membership as local-only and still allows sign-out', async () => {
    mockUseAuth.mockReturnValue(signedIn({ state: { status: 'authenticatedOffline', userId: 'user-id' } }));
    const index = await renderSettings();

    expect(index.root.findByProps({ testID: 'settings-account-value' }).props.children).toBe('오프라인');

    const detail = await renderSettings({ route: 'account', loadPendingChangeCount: async () => 0 });
    const syncRow = detail.root.findByProps({ testID: 'settings-row-sync' });
    expect(detail.root.findByProps({ testID: 'settings-account-sync-status' }).props.children).toBe('오프라인');
    expect(renderedText(syncRow)).toContain('이 기기에 저장된 기록은 계속 볼 수 있습니다.');
    expect(renderedText(syncRow)).toContain('백업 상태는 인터넷에 연결되면 확인할 수 있습니다.');
    expect(detail.root.findByProps({ testID: 'settings-account-sign-out' })).toBeTruthy();
  });

  test('shows cloud downloading in the sync row', async () => {
    mockUseAuth.mockReturnValue(signedIn());
    const renderer = await renderSettings({ route: 'account', isCloudRefreshing: true, loadPendingChangeCount: async () => 0 });
    await flush();

    expect(renderer.root.findByProps({ testID: 'settings-account-sync-status' }).props.children).toBe('계정의 기록을 불러오는 중');
  });

  test('shows an unknown pending count as -- instead of zero', async () => {
    mockUseAuth.mockReturnValue(signedIn());
    const renderer = await renderSettings({
      route: 'account',
      loadPendingChangeCount: async () => {
        throw new Error('storage unavailable');
      },
    });
    await flush();

    expect(renderer.root.findByProps({ testID: 'settings-account-sync-status' }).props.children).toBe('--');
  });

  test('shows the linked watch as a name, status and chevron row', async () => {
    const renderer = await renderSettings();
    const root = renderer.root;

    expect(renderedText(root.findByProps({ testID: 'settings-section-devices' }))).toContain('연결 기기');
    expect(renderedText(root.findByProps({ testID: 'settings-row-devices' }))).toContain('Seongbin Apple Watch');
    expect(root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe('연결됨');
    expect(findControl(root, 'settings-row-devices').props.accessibilityRole).toBe('button');
  });

  test('waits 1 s before saying the watch status is being checked', async () => {
    jest.useFakeTimers();
    const renderer = await renderSettings({ loadLinkedWatchInfo: () => new Promise<LinkedWatchInfo>(() => undefined) });

    expect(renderer.root.findAllByProps({ testID: 'settings-linked-watch-status' })).toHaveLength(0);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(renderer.root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe('확인 중');
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

    expect(onOpenRoute).toHaveBeenNthCalledWith(1, 'theme');
    expect(onOpenRoute).toHaveBeenNthCalledWith(2, 'devices');
    expect(root.findAllByProps({ testID: 'settings-detail-title' })).toHaveLength(0);
  });

  test('turns watch sync notifications on from the inline switch after permission is granted', async () => {
    const onOpenRoute = jest.fn();
    const requestWatchSyncNotificationPermission = jest.fn().mockResolvedValue(true);
    const renderer = await renderSettings({
      onOpenRoute,
      requestWatchSyncNotificationPermission,
      hasWatchSyncNotificationPermission: jest.fn().mockResolvedValue(true),
    });
    const root = renderer.root;

    expect(notificationSwitch(root).props.value).toBe(false);
    await ReactTestRenderer.act(async () => {
      notificationSwitch(root).props.onValueChange(true);
    });
    await flush();

    expect(requestWatchSyncNotificationPermission).toHaveBeenCalledTimes(1);
    expect(notificationSwitch(root).props.value).toBe(true);
    expect(onOpenRoute).not.toHaveBeenCalled();
  });

  test('keeps watch sync notifications off when permission is denied', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const requestWatchSyncNotificationPermission = jest.fn().mockResolvedValue(false);
    const renderer = await renderSettings({ requestWatchSyncNotificationPermission });
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      notificationSwitch(root).props.onValueChange(true);
    });
    await flush();

    expect(requestWatchSyncNotificationPermission).toHaveBeenCalledTimes(1);
    expect(notificationSwitch(root).props.value).toBe(false);
  });

  test('uses platform-neutral English copy when notification permission is denied', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const renderer = await renderSettings({
      requestWatchSyncNotificationPermission: jest.fn().mockResolvedValue(false),
    });
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
    });
    await ReactTestRenderer.act(async () => {
      notificationSwitch(root).props.onValueChange(true);
    });
    await flush();

    expect(alert).toHaveBeenCalledWith(
      'Allow watch log notifications',
      'Allow notifications for this app in device Settings, then return to turn this on automatically.',
      [
        { text: 'Cancel', style: 'cancel' },
        expect.objectContaining({ text: 'Open Settings' }),
      ],
    );
  });

  test('enables the switch after a physical-device permission change in iOS Settings', async () => {
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
      requestWatchSyncNotificationPermission: jest.fn().mockResolvedValue(false),
      hasWatchSyncNotificationPermission,
      openNotificationSettings,
    });
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      notificationSwitch(root).props.onValueChange(true);
    });
    await flush();
    await ReactTestRenderer.act(async () => {
      settingsAction?.();
      await Promise.resolve();
    });
    expect(openNotificationSettings).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      appStateListener?.('active');
      await Promise.resolve();
    });
    await flush();

    expect(hasWatchSyncNotificationPermission).toHaveBeenCalled();
    expect(notificationSwitch(root).props.value).toBe(true);
  });

  test('renders detail back navigation as an accessible icon control', async () => {
    const renderer = await renderSettings({ route: 'theme' });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-back' }).props.accessibilityLabel).toBe('뒤로');
    expect(root.findByProps({ testID: 'settings-back-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'settings-detail-title' }).props.accessibilityRole).toBe('header');
  });

  test('renders device management as a detail screen', async () => {
    const renderer = await renderSettings({ route: 'devices' });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-detail-title' }).props.children).toBe('연결 기기');
    expect(renderedText(root.findByProps({ testID: 'settings-linked-watch' }))).toContain('Seongbin Apple Watch');
    expect(root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe('연결됨');
  });

  test('lists watch recordings the phone set aside and lets the user clear them', async () => {
    const rejectedWatchPayloadStore = createWatchRejectedPayloadStore({ storage: new InMemoryKeyValueStore() });
    await rejectedWatchPayloadStore.recordRejection({ payloadId: 'p1', localSessionId: 's1', reason: 'invalidMessage' });
    await rejectedWatchPayloadStore.recordRejection({ payloadId: 'p2', localSessionId: 's2', reason: 'repeatedImportFailure' });
    const renderer = await renderSettings({ route: 'devices', rejectedWatchPayloadStore });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'settings-rejected-watch-title' }).props.children).toBe(
      '가져오지 못한 워치 기록 2개',
    );
    expect(root.findByProps({ testID: 'settings-rejected-watch-guidance' }).props.children).toBe(
      '원본 기록은 워치에 남아 있습니다. 두 기기의 Divenary를 업데이트한 뒤 워치에서 기록을 다시 보내 주세요.',
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

  test('keeps the refresh button busy while the watch lookup runs', async () => {
    let resolveLookup: ((info: LinkedWatchInfo) => void) | undefined;
    const loadLinkedWatchInfo = jest
      .fn<Promise<LinkedWatchInfo>, []>()
      .mockResolvedValueOnce(linkedWatchInfo)
      .mockImplementation(
        () =>
          new Promise<LinkedWatchInfo>(resolve => {
            resolveLookup = resolve;
          }),
      );
    const renderer = await renderSettings({ route: 'devices', loadLinkedWatchInfo });
    const refresh = () => renderer.root.findByProps({ testID: 'settings-linked-watch-refresh' });

    await ReactTestRenderer.act(async () => {
      void refresh().props.onPress();
      await Promise.resolve();
    });
    expect(refresh().props.pending).toBe(true);

    await ReactTestRenderer.act(async () => {
      resolveLookup?.(linkedWatchInfo);
      await Promise.resolve();
    });
    expect(refresh().props.pending).toBe(false);
  });

  test('explains when no watch is paired', async () => {
    const renderer = await renderSettings({
      loadLinkedWatchInfo: () =>
        Promise.resolve({ isSupported: true, isPaired: false, isWatchAppInstalled: false, isReachable: false }),
    });
    const root = renderer.root;

    expect(renderedText(root.findByProps({ testID: 'settings-row-devices' }))).toContain('Apple Watch');
    expect(root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe('연동된 워치 없음');
  });

  test('shows a concise status when the companion watch app is missing', async () => {
    const renderer = await renderSettings({
      loadLinkedWatchInfo: () =>
        Promise.resolve({ isSupported: true, isPaired: true, isWatchAppInstalled: false, isReachable: false }),
    });

    expect(renderer.root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe('워치에 Divenary 설치 필요');
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

    expect(renderer.root.findByProps({ testID: 'settings-linked-watch-status' }).props.children).toBe(
      '워치 연동을 사용할 수 없음',
    );
  });

  test('shows the app version and the non-certified safety note in About', async () => {
    const renderer = await renderSettings({ appVersion: '9.8.7' });
    const root = renderer.root;

    expect(renderedText(root.findByProps({ testID: 'settings-section-about' }))).toContain('정보');
    expect(root.findByProps({ testID: 'settings-app-version' }).props.children).toBe('9.8.7');
    expect(renderedText(root.findByProps({ testID: 'settings-row-safety' }))).toContain(
      '인증된 다이브 컴퓨터가 아닙니다.',
    );
  });

  test('marks the selected theme with one checkmark and applies the choice in memory', async () => {
    const renderer = await renderSettings();
    const root = renderer.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-row-theme' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'settings-detail-title' }).props.children).toBe('테마');
    expect(findControl(root, 'settings-option-theme-system').props.accessibilityState.selected).toBe(true);
    expect(root.findAllByType(CheckIcon)).toHaveLength(1);
    expect(findControl(root, 'settings-option-theme-system').findAllByType(CheckIcon)).toHaveLength(1);
    // Selection is the checkmark alone: no tinted row, no blue label, no radio.
    for (const option of ['system', 'light', 'dark']) {
      const row = findControl(root, `settings-option-theme-${option}`);
      expect(row.props.className ?? '').not.toContain('bg-primary');
      expect(row.findAll(node => String(node.props.className ?? '').includes('text-primary') && (node.type as string) === 'Text')).toHaveLength(0);
    }

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'settings-option-theme-dark' }).props.onPress();
    });

    expect(findControl(root, 'settings-option-theme-dark').props.accessibilityState.selected).toBe(true);
    expect(findControl(root, 'settings-option-theme-dark').findAllByType(CheckIcon)).toHaveLength(1);
    expect(root.findAllByType(CheckIcon)).toHaveLength(1);

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
    expect(findControl(root, 'settings-option-language-ko').props.accessibilityState.selected).toBe(true);

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'settings-option-language-en' }).props.onPress();
    });

    expect(i18n.language).toBe('en');
    expect(root.findByProps({ testID: 'settings-detail-title' }).props.children).toBe('Language');
    expect(findControl(root, 'settings-option-language-en').props.accessibilityState.selected).toBe(true);
  });
});
