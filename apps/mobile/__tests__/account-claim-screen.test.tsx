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
    keepOnDevice: jest.fn(async () => undefined),
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

  test('announces completion once and closes the sheet', async () => {
    mockClaim = claimFixture({ status: 'running', completed: 31, total: 32 });
    const renderer = await renderScreen();

    mockClaim = claimFixture({ status: 'complete', imported: 32 });
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
});
