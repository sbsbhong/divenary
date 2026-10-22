let mockClaim: import('../src/states/account-data').AccountClaimController;
let mockIsOnline = true;
const mockGoBack = jest.fn();
const mockPreventRemove = jest.fn();

jest.mock('../src/states/account-data', () => ({
  useAccountData: () => ({ claim: mockClaim, isOnline: mockIsOnline }),
}));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');

  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack }),
    usePreventRemove: (preventRemove: boolean) =>
      mockPreventRemove(preventRemove),
  };
});

import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import i18n from '../src/i18n';
import AccountClaimScreen from '../src/screens/account-claim/screen';
import type { AccountClaimController } from '../src/states/account-data';

const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function claimFixture(
  state: AccountClaimController['state'],
  eligible = { logCount: 24, planCount: 8 },
): AccountClaimController {
  return {
    eligible,
    state,
    start: jest.fn(async () => undefined),
    retry: jest.fn(async () => undefined),
    recheckRetained: jest.fn(async () => undefined),
    keepOnDevice: jest.fn(async () => undefined),
    refresh: jest.fn(async () => undefined),
  };
}

async function renderScreen() {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<AccountClaimScreen />);
    await Promise.resolve();
  });
  renderers.push(renderer!);
  return renderer!;
}

describe('AccountClaimScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockIsOnline = true;
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
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
    jest.restoreAllMocks();
  });

  test('shows the eligible log and plan counts with import and keep actions', async () => {
    mockClaim = claimFixture({
      status: 'choice',
      logCount: 24,
      planCount: 8,
    });
    const renderer = await renderScreen();

    expect(
      renderer.root.findByProps({ testID: 'account-claim-title' }).props
        .children,
    ).toBe('기기 데이터를 계정으로 가져올까요?');
    expect(
      renderer.root.findByProps({ testID: 'account-claim-log-count' }).props
        .children,
    ).toBe('다이빙 로그 24개');
    expect(
      renderer.root.findByProps({ testID: 'account-claim-plan-count' }).props
        .children,
    ).toBe('다이빙 계획 8개');

    await ReactTestRenderer.act(async () => {
      await renderer.root
        .findByProps({
          testID: 'account-claim-import',
        })
        .props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      await renderer.root
        .findByProps({
          testID: 'account-claim-keep',
        })
        .props.onPress();
    });

    expect(mockClaim.start).toHaveBeenCalledTimes(1);
    expect(mockClaim.keepOnDevice).toHaveBeenCalledTimes(1);
  });

  test('explains what import and keep-on-device each do', async () => {
    mockClaim = claimFixture({status: 'choice', logCount: 24, planCount: 8});
    const renderer = await renderScreen();

    expect(
      renderer.root.findByProps({testID: 'account-claim-import-explanation'})
        .props.children,
    ).toBe('가져오기: 기록을 계정으로 옮겨 다른 기기와 동기화합니다.');
    expect(
      renderer.root.findByProps({testID: 'account-claim-keep-explanation'})
        .props.children,
    ).toBe('기기에 유지: 이 기기에만 남기고, 나중에 설정에서 가져올 수 있습니다.');
    expect(
      renderer.root.findAllByProps({testID: 'account-claim-offline-note'}),
    ).toHaveLength(0);
  });

  test('says why import is unavailable while the account is offline', async () => {
    mockIsOnline = false;
    mockClaim = claimFixture({status: 'choice', logCount: 24, planCount: 8});
    const renderer = await renderScreen();

    expect(
      renderer.root.findByProps({testID: 'account-claim-offline-note'}).props
        .children,
    ).toBe('인터넷에 연결되면 계속할 수 있습니다.');
    expect(
      renderer.root.findByProps({testID: 'account-claim-import'}).props
        .disabled,
    ).toBe(true);
    expect(
      renderer.root.findByProps({testID: 'account-claim-keep'}).props.disabled,
    ).toBe(false);
  });

  test('uses singular and plural English counts', async () => {
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
    });
    mockClaim = claimFixture(
      {status: 'choice', logCount: 1, planCount: 2},
      {logCount: 1, planCount: 2},
    );
    const renderer = await renderScreen();

    expect(
      renderer.root.findByProps({testID: 'account-claim-log-count'}).props
        .children,
    ).toBe('1 dive log');
    expect(
      renderer.root.findByProps({testID: 'account-claim-plan-count'}).props
        .children,
    ).toBe('2 dive plans');
  });

  test('draws the preparing spinner only after the shared 1 s delay', async () => {
    jest.useFakeTimers();
    try {
      const pendingRefresh = deferred<void>();
      mockClaim = claimFixture({status: 'hidden'});
      mockClaim.refresh = jest.fn(() => pendingRefresh.promise);
      const renderer = await renderScreen();
      const preparing = renderer.root.findByProps({
        testID: 'account-claim-preparing',
      });
      const spinner = () =>
        preparing.findAll(
          node => node.props['aria-label'] === '가져올 데이터를 확인하는 중',
        )[0];

      expect(preparing.props.accessibilityState).toEqual({busy: true});
      expect(StyleSheet.flatten(spinner()?.props.style)).toMatchObject({
        opacity: 0,
      });

      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(StyleSheet.flatten(spinner()?.props.style)).toMatchObject({
        opacity: 1,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('renders deferred choice content and retries its existing snapshot', async () => {
    mockClaim = claimFixture({
      status: 'deferred',
      logCount: 24,
      planCount: 8,
    });
    const renderer = await renderScreen();

    expect(
      renderer.root.findByProps({testID: 'account-claim-title'}).props.children,
    ).toBe('기기 데이터를 계정으로 가져올까요?');
    expect(
      renderer.root.findByProps({testID: 'account-claim-log-count'}).props
        .children,
    ).toBe('다이빙 로그 24개');

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({testID: 'account-claim-import'}).props
        .onPress();
    });

    expect(mockClaim.retry).toHaveBeenCalledTimes(1);
    expect(mockClaim.start).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({testID: 'account-claim-keep'}).props
        .onPress();
    });

    expect(mockClaim.keepOnDevice).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('renders exact active progress and allows the sheet to close', async () => {
    mockClaim = claimFixture({
      status: 'running',
      completed: 3,
      total: 32,
      currentLabel: 'Jeju Moon Island',
    });
    const renderer = await renderScreen();
    const count = renderer.root.findByProps({
      testID: 'account-claim-progress-count',
    });
    const progress = renderer.root.findByProps({
      testID: 'account-claim-progress',
    });

    expect(count.props.children).toEqual(['3', ' / ', '32']);
    expect(StyleSheet.flatten(count.props.style)).toMatchObject({
      fontVariant: ['tabular-nums'],
    });
    expect(progress.props.accessibilityRole).toBe('progressbar');
    expect(progress.props.accessibilityValue).toEqual({
      min: 0,
      max: 32,
      now: 3,
    });
    expect(
      renderer.root.findByProps({ testID: 'account-claim-current-label' }).props
        .children,
    ).toBe('Jeju Moon Island');
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({testID: 'account-claim-close'}).props
        .onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockPreventRemove).not.toHaveBeenCalled();
  });

  test('shows cleanup as an indeterminate step without stale item counts', async () => {
    mockClaim = claimFixture({
      status: 'running',
      phase: 'cleanup',
    });
    const renderer = await renderScreen();

    expect(
      renderer.root.findByProps({testID: 'account-claim-title'}).props.children,
    ).toBe('기기 데이터를 정리하는 중');
    expect(
      renderer.root.findAllByProps({testID: 'account-claim-progress-count'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findByProps({testID: 'account-claim-cleanup-spinner'}),
    ).toBeTruthy();
    expect(JSON.stringify(renderer.toJSON())).toContain(
      '계정 저장은 완료되었습니다.',
    );
  });

  test.each([
    {status: 'choice', logCount: 3, planCount: 2} as const,
    {status: 'deferred', logCount: 3, planCount: 2} as const,
    {
      status: 'failed',
      completed: 0,
      total: 5,
      errorCode: 'claim_validation_failed',
    } satisfies AccountClaimController['state'],
    {status: 'hidden'} as const,
  ])('refreshes current inventory from an initial $status state', async state => {
    mockClaim = claimFixture(state, {logCount: 3, planCount: 2});
    await renderScreen();

    expect(mockClaim.refresh).toHaveBeenCalledTimes(1);
  });

  test('hides stale choice actions and allows closing while the mount refresh is pending', async () => {
    const pendingRefresh = deferred<void>();
    mockClaim = claimFixture({
      status: 'choice',
      logCount: 24,
      planCount: 8,
    });
    mockClaim.refresh = jest.fn(() => pendingRefresh.promise);
    const renderer = await renderScreen();

    expect(mockClaim.refresh).toHaveBeenCalledTimes(1);
    expect(
      renderer.root.findAllByProps({testID: 'account-claim-import'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({testID: 'account-claim-keep'}),
    ).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({testID: 'account-claim-close'}).props.onPress();
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      pendingRefresh.resolve();
      await pendingRefresh.promise;
    });
  });

  test('finishes the single mount refresh when the claim controller identity changes', async () => {
    const pendingRefresh = deferred<void>();
    const initialClaim = claimFixture({
      status: 'choice',
      logCount: 24,
      planCount: 8,
    });
    initialClaim.refresh = jest.fn(() => pendingRefresh.promise);
    mockClaim = initialClaim;
    const renderer = await renderScreen();

    mockClaim = claimFixture({
      status: 'choice',
      logCount: 24,
      planCount: 8,
    });
    await ReactTestRenderer.act(async () => {
      renderer.update(<AccountClaimScreen />);
      await Promise.resolve();
    });

    expect(initialClaim.refresh).toHaveBeenCalledTimes(1);
    expect(mockClaim.refresh).not.toHaveBeenCalled();
    expect(
      renderer.root.findAllByProps({testID: 'account-claim-import'}),
    ).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      pendingRefresh.resolve();
      await pendingRefresh.promise;
    });

    expect(
      renderer.root.findByProps({testID: 'account-claim-import'}),
    ).toBeTruthy();
  });

  test('keeps stale actions unavailable when the mount refresh fails', async () => {
    mockClaim = claimFixture({
      status: 'choice',
      logCount: 24,
      planCount: 8,
    });
    mockClaim.refresh = jest.fn(async () => {
      throw new Error('inventory unavailable');
    });
    const renderer = await renderScreen();

    expect(mockClaim.refresh).toHaveBeenCalledTimes(1);
    expect(
      renderer.root.findAllByProps({testID: 'account-claim-import'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({testID: 'account-claim-keep'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findByProps({testID: 'account-claim-close'}),
    ).toBeTruthy();
  });

  test('explains a failed mount refresh and retries it instead of spinning forever', async () => {
    mockClaim = claimFixture({
      status: 'choice',
      logCount: 24,
      planCount: 8,
    });
    mockClaim.refresh = jest
      .fn()
      .mockRejectedValueOnce(new Error('inventory unavailable'))
      .mockResolvedValueOnce(undefined);
    const renderer = await renderScreen();

    expect(
      renderer.root.findAllByProps({testID: 'account-claim-preparing'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findByProps({testID: 'account-claim-refresh-failed'}),
    ).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({testID: 'account-claim-refresh-retry'}).props.onPress();
      await Promise.resolve();
    });

    expect(mockClaim.refresh).toHaveBeenCalledTimes(2);
    expect(
      renderer.root.findAllByProps({testID: 'account-claim-refresh-failed'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({testID: 'account-claim-import'}).length,
    ).toBeGreaterThan(0);
  });

  test.each([
    {
      status: 'retained',
      retainedItems: [
        {
          entityKind: 'log',
          clientRecordId: 'log-a',
          localRecordSha256: 'a'.repeat(64),
          reason: 'profile_corrupt',
        },
      ],
    } satisfies AccountClaimController['state'],
    {
      status: 'complete',
      imported: 1,
      retainedItems: [
        {
          entityKind: 'log',
          clientRecordId: 'log-a',
          localRecordSha256: 'a'.repeat(64),
          reason: 'profile_missing',
        },
      ],
    } satisfies AccountClaimController['state'],
  ])('hides stale $status result actions while the mount refresh is pending', async state => {
    const pendingRefresh = deferred<void>();
    mockClaim = claimFixture(state);
    mockClaim.refresh = jest.fn(() => pendingRefresh.promise);
    const renderer = await renderScreen();

    expect(
      renderer.root.findAllByProps({testID: 'account-claim-recheck'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({testID: 'account-claim-done'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findByProps({testID: 'account-claim-close'}),
    ).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      pendingRefresh.resolve();
      await pendingRefresh.promise;
    });
  });

  test('allows closing while claim preparation is still pending', async () => {
    const pending = deferred<void>();
    mockClaim = claimFixture({
      status: 'choice',
      logCount: 24,
      planCount: 8,
    });
    mockClaim.start = jest.fn(() => pending.promise);
    const renderer = await renderScreen();

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({
        testID: 'account-claim-import',
      }).props.onPress();
      await Promise.resolve();
    });

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({testID: 'account-claim-close'}).props
        .onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockPreventRemove).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      pending.resolve();
      await pending.promise;
    });
  });

  test('does not publish local action state after a pending claim outlives the sheet', async () => {
    const pending = deferred<void>();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockClaim = claimFixture({
      status: 'choice',
      logCount: 24,
      planCount: 8,
    });
    mockClaim.start = jest.fn(() => pending.promise);
    const renderer = await renderScreen();

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({
        testID: 'account-claim-import',
      }).props.onPress();
      await Promise.resolve();
      renderer.unmount();
    });

    await ReactTestRenderer.act(async () => {
      pending.resolve();
      await pending.promise;
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  test('closes immediately when keep-on-device persistence is pending', async () => {
    const pending = deferred<void>();
    mockClaim = claimFixture({
      status: 'choice',
      logCount: 24,
      planCount: 8,
    });
    mockClaim.keepOnDevice = jest.fn(() => pending.promise);
    const renderer = await renderScreen();
    let settled: Promise<void> | undefined;

    await ReactTestRenderer.act(async () => {
      settled = renderer.root
        .findByProps({testID: 'account-claim-keep'})
        .props.onPress();
      await Promise.resolve();
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockClaim.keepOnDevice).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      pending.resolve();
      await settled;
    });
  });

  test('closes after refresh reports no live device data', async () => {
    mockClaim = claimFixture({
      status: 'choice',
      logCount: 1,
      planCount: 0,
    }, {logCount: 1, planCount: 0});
    const renderer = await renderScreen();

    mockClaim = claimFixture(
      {status: 'hidden'},
      {logCount: 0, planCount: 0},
    );
    await ReactTestRenderer.act(async () => {
      renderer.update(<AccountClaimScreen />);
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('clamps the depth trace and disables its transition for reduced motion', async () => {
    jest
      .mocked(AccessibilityInfo.isReduceMotionEnabled)
      .mockResolvedValue(true);
    mockClaim = claimFixture({
      status: 'running',
      completed: 40,
      total: 32,
    });
    const renderer = await renderScreen();

    expect(
      renderer.root.findByProps({ testID: 'account-claim-progress' }).props
        .value,
    ).toBe(100);
    expect(
      renderer.root.findByProps({ testID: 'account-claim-progress-tick' }).props
        .style,
    ).toMatchObject({ left: '100%' });
    expect(
      renderer.root.findByProps({ testID: 'account-claim-progress-fill' }).props
        .className,
    ).toContain('transition-none');
  });

  test('offers retry and keep-on-device after failure without exposing an error code', async () => {
    mockClaim = claimFixture({
      status: 'failed',
      completed: 3,
      total: 32,
      errorCode: 'remote_conflict',
    });
    const renderer = await renderScreen();

    expect(
      renderer.root.findByProps({ testID: 'account-claim-title' }).props
        .children,
    ).toBe('가져오기를 완료하지 못했습니다');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('remote_conflict');

    await ReactTestRenderer.act(async () => {
      await renderer.root
        .findByProps({
          testID: 'account-claim-retry',
        })
        .props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      await renderer.root
        .findByProps({
          testID: 'account-claim-keep',
        })
        .props.onPress();
    });

    expect(mockClaim.retry).toHaveBeenCalledTimes(1);
    expect(mockClaim.keepOnDevice).toHaveBeenCalledTimes(1);
    expect(mockPreventRemove).not.toHaveBeenCalled();
  });

  test('shows the failed item and phase without exposing the internal error code', async () => {
    mockClaim = claimFixture({
      status: 'failed',
      completed: 0,
      total: 2,
      errorCode: 'profile_missing',
      failure: {
        phase: 'checking',
        entityKind: 'log',
        clientRecordId: 'log-a',
        label: 'Moon Island',
      },
    });
    const renderer = await renderScreen();
    const serialized = JSON.stringify(renderer.toJSON());

    expect(
      renderer.root.findByProps({testID: 'account-claim-failure-detail'}).props
        .children,
    ).toContain('Moon Island');
    expect(serialized).not.toContain('profile_missing');
    expect(serialized).not.toContain('log-a');
  });

  test('shows cleanup failure guidance without stale item counts', async () => {
    mockClaim = claimFixture({
      status: 'failed',
      completed: 15,
      total: 15,
      errorCode: 'claim_validation_failed',
      failure: {phase: 'cleanup'},
    });
    const renderer = await renderScreen();

    expect(
      renderer.root.findAllByProps({testID: 'account-claim-progress-count'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findByProps({testID: 'account-claim-failure-detail'}).props
        .children,
    ).toBe(
      '계정 기록은 보존되어 있습니다. 기기 원본 정리를 다시 시도해 주세요.',
    );
    expect(
      renderer.root.findByProps({testID: 'account-claim-retry'}),
    ).toBeTruthy();
  });

  test('announces completion once and closes the sheet', async () => {
    mockClaim = claimFixture({ status: 'running', completed: 31, total: 32 });
    const renderer = await renderScreen();

    mockClaim = claimFixture({status: 'complete', imported: 32, retainedItems: []});
    await ReactTestRenderer.act(async () => {
      renderer.update(<AccountClaimScreen />);
    });
    await ReactTestRenderer.act(async () => {
      renderer.update(<AccountClaimScreen />);
    });

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      '32개를 계정으로 가져왔습니다',
    );
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('shows partial completion until the user acknowledges the retained item', async () => {
    mockClaim = claimFixture({
      status: 'complete',
      imported: 13,
      retainedItems: [
        {
          entityKind: 'log',
          clientRecordId: 'log-a',
          localRecordSha256: 'a'.repeat(64),
          label: '위치 다이브',
          reason: 'profile_missing',
        },
      ],
    });
    const renderer = await renderScreen();

    expect(
      renderer.root.findByProps({testID: 'account-claim-title'}).props.children,
    ).toBe('기기 데이터를 가져왔습니다');
    expect(
      renderer.root.findByProps({testID: 'account-claim-result-summary'}).props
        .children,
    ).toContain('13개');
    expect(
      renderer.root.findByProps({testID: 'account-claim-retained-item'}).props
        .children,
    ).toContain('위치 다이브');
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      '13개를 가져왔고 1개는 기기에 유지했습니다',
    );

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({testID: 'account-claim-done'}).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('shows retained-only recovery without a zero progress failure and rechecks explicitly', async () => {
    mockClaim = claimFixture({
      status: 'retained',
      retainedItems: [
        {
          entityKind: 'log',
          clientRecordId: 'log-a',
          localRecordSha256: 'a'.repeat(64),
          label: '위치 다이브',
          reason: 'profile_corrupt',
        },
      ],
    });
    const renderer = await renderScreen();
    const serialized = JSON.stringify(renderer.toJSON());

    expect(
      renderer.root.findByProps({testID: 'account-claim-title'}).props.children,
    ).toBe('일부 데이터를 확인해야 합니다');
    expect(serialized).not.toContain('0 / 1');
    expect(serialized).not.toContain('가져오기를 완료하지 못했습니다');
    expect(serialized).not.toContain('profile_corrupt');

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({testID: 'account-claim-recheck'}).props
        .onPress();
    });
    expect(mockClaim.recheckRetained).toHaveBeenCalledTimes(1);
  });
});
