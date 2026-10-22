import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ASYNC_FEEDBACK_TIMING } from '../src/constants/async-feedback';
import i18n from '../src/i18n';
import RecoveryScreen from '../src/screens/recovery/screen';

async function render(element: React.ReactElement) {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer!;
}

async function advance(ms: number) {
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

function count(renderer: ReactTestRenderer.ReactTestRenderer, testID: string): number {
  return renderer.root.findAllByProps({ testID }).length;
}

function text(renderer: ReactTestRenderer.ReactTestRenderer, testID: string): string {
  return String(renderer.root.findByProps({ testID }).props.children);
}

describe('RecoveryScreen start shell', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('draws only the background and mark at first, then adds feedback at 1 s, 4 s and 10 s', async () => {
    const onRetry = jest.fn();
    const renderer = await render(<RecoveryScreen kind="loading" onRetry={onRetry} startedAt={Date.now()} />);

    expect(renderer.root.findByProps({ testID: 'account-data-loading-screen' }).props.accessibilityState).toEqual({
      busy: true,
    });
    expect(count(renderer, 'account-data-loading-brand-mark')).toBeGreaterThan(0);
    expect(count(renderer, 'account-data-loading-indicator')).toBe(0);

    await advance(ASYNC_FEEDBACK_TIMING.indicator - 1);
    expect(count(renderer, 'account-data-loading-indicator')).toBe(0);
    await advance(1);
    expect(renderer.root.findByProps({ testID: 'account-data-loading-indicator' }).props.accessibilityLabel).toBe(
      '기록을 불러오는 중',
    );
    expect(count(renderer, 'account-data-loading-message')).toBe(0);

    await advance(ASYNC_FEEDBACK_TIMING.extended - ASYNC_FEEDBACK_TIMING.indicator - 1);
    expect(count(renderer, 'account-data-loading-message')).toBe(0);
    await advance(1);
    expect(text(renderer, 'account-data-loading-message')).toBe('기록을 준비하는 중');
    expect(count(renderer, 'account-data-loading-long-running')).toBe(0);

    await advance(ASYNC_FEEDBACK_TIMING.longRunning - ASYNC_FEEDBACK_TIMING.extended - 1);
    expect(count(renderer, 'account-data-loading-long-running')).toBe(0);
    expect(count(renderer, 'recovery-retry')).toBe(0);
    await advance(1);
    expect(text(renderer, 'account-data-loading-long-running')).toBe('시간이 오래 걸리고 있습니다.');

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'recovery-retry' }).props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps counting from the wait start after a remount', async () => {
    const renderer = await render(
      <RecoveryScreen kind="loading" onRetry={jest.fn()} startedAt={Date.now() - ASYNC_FEEDBACK_TIMING.longRunning} />,
    );

    expect(count(renderer, 'account-data-loading-indicator')).toBeGreaterThan(0);
    expect(count(renderer, 'account-data-loading-long-running')).toBeGreaterThan(0);
    expect(count(renderer, 'recovery-retry')).toBeGreaterThan(0);
  });

  it('restarts its delays when a retry starts a new wait', async () => {
    const startedAt = Date.now() - ASYNC_FEEDBACK_TIMING.longRunning;
    const renderer = await render(<RecoveryScreen kind="loading" onRetry={jest.fn()} startedAt={startedAt} />);
    expect(count(renderer, 'recovery-retry')).toBeGreaterThan(0);

    await ReactTestRenderer.act(async () => {
      renderer.update(<RecoveryScreen kind="loading" onRetry={jest.fn()} startedAt={Date.now()} />);
    });
    expect(count(renderer, 'recovery-retry')).toBe(0);
    expect(count(renderer, 'account-data-loading-indicator')).toBe(0);
  });

  it('says that it is taking long without a retry action when nothing can be restarted', async () => {
    const renderer = await render(<RecoveryScreen kind="loading" startedAt={Date.now()} />);

    await advance(ASYNC_FEEDBACK_TIMING.longRunning);
    expect(count(renderer, 'account-data-loading-long-running')).toBeGreaterThan(0);
    expect(count(renderer, 'recovery-retry')).toBe(0);
  });
});

describe('RecoveryScreen recovery variants', () => {
  beforeEach(async () => {
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  it.each([
    ['accountData', 'account-data-recovery-screen'],
    ['unexpected', 'app-error-recovery-screen'],
  ] as const)('keeps the %s screen neutral with one retry action', async (kind, testID) => {
    const onRetry = jest.fn();
    const renderer = await render(<RecoveryScreen kind={kind} onRetry={onRetry} />);
    const screen = renderer.root.findByProps({ testID });

    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/destructive/);
    expect(
      new Set(renderer.root.findAll(node => node.props.role === 'button').map(node => node.props.testID)),
    ).toEqual(new Set(['recovery-retry']));

    await ReactTestRenderer.act(async () => {
      screen.findByProps({ testID: 'recovery-retry' }).props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
