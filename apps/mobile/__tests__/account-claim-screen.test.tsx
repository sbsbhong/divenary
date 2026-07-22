let mockClaim: import('../src/states/account-data').AccountClaimController;
const mockGoBack = jest.fn();
const mockPreventRemove = jest.fn();

jest.mock('../src/states/account-data', () => ({
  useAccountData: () => ({ claim: mockClaim }),
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
    ).toEqual(['24', ' ', '다이빙 로그']);
    expect(
      renderer.root.findByProps({ testID: 'account-claim-plan-count' }).props
        .children,
    ).toEqual(['8', ' ', '다이빙 계획']);

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
    ).toEqual(['24', ' ', '다이빙 로그']);

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

  test('renders exact active progress and prevents navigation without a close control', async () => {
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
    expect(
      renderer.root.findAllByProps({ testID: 'account-claim-close' }),
    ).toHaveLength(0);
    expect(mockPreventRemove).toHaveBeenLastCalledWith(true);
  });

  test('renders a nonempty preparing state and refreshes a hidden eligible claim', async () => {
    mockClaim = claimFixture(
      {status: 'hidden'},
      {logCount: 3, planCount: 2},
    );
    const renderer = await renderScreen();

    expect(
      renderer.root.findByProps({testID: 'account-claim-preparing'}),
    ).toBeTruthy();
    expect(mockClaim.refresh).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      'start',
      { status: 'choice', logCount: 24, planCount: 8 } as const,
      'account-claim-import',
    ],
    [
      'retry',
      {
        status: 'failed',
        completed: 3,
        total: 32,
        errorCode: 'network_unavailable',
      } as const,
      'account-claim-retry',
    ],
  ])(
    'prevents removal while %s waits and releases it when the action rejects',
    async (action, state, testID) => {
      const pending = deferred<void>();
      const claimAction = action as 'start' | 'retry';
      mockClaim = claimFixture(state);
      mockClaim[claimAction] = jest.fn(() => pending.promise);
      const renderer = await renderScreen();
      let settled: Promise<void> | undefined;

      await ReactTestRenderer.act(async () => {
        const actionPromise = renderer.root.findByProps({ testID }).props
          .onPress() as Promise<void>;
        settled = actionPromise.catch(() => undefined);
        await Promise.resolve();
      });

      expect(mockPreventRemove).toHaveBeenLastCalledWith(true);

      await ReactTestRenderer.act(async () => {
        pending.reject(new Error('claim action failed'));
        await settled;
      });

      expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
    },
  );

  test('keeps removal prevention active when Start settles into running state', async () => {
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

    mockClaim = claimFixture({ status: 'running', completed: 0, total: 32 });
    await ReactTestRenderer.act(async () => {
      renderer.update(<AccountClaimScreen />);
      pending.resolve();
      await pending.promise;
    });

    expect(mockPreventRemove).toHaveBeenLastCalledWith(true);
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
    expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
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
