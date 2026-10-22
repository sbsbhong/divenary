import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ASYNC_FEEDBACK_TIMING } from '../src/constants/async-feedback';
import {
  useLoadingFeedback,
  type LoadingFeedback,
  type LoadingFeedbackOptions,
} from '../src/hooks/use-loading-feedback';

let latest: LoadingFeedback | undefined;

function Probe(props: { isLoading: boolean; options?: LoadingFeedbackOptions }) {
  latest = useLoadingFeedback(props.isLoading, props.options);
  return null;
}

async function render(isLoading: boolean, options?: LoadingFeedbackOptions) {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<Probe isLoading={isLoading} options={options} />);
  });
  return renderer!;
}

async function advance(ms: number) {
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('useLoadingFeedback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    latest = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows nothing before the indicator delay and the indicator exactly at it', async () => {
    await render(true);
    await advance(ASYNC_FEEDBACK_TIMING.indicator - 1);
    expect(latest).toEqual({ showIndicator: false, showExtendedFeedback: false, isLongRunning: false });

    await advance(1);
    expect(latest).toEqual({ showIndicator: true, showExtendedFeedback: false, isLongRunning: false });
  });

  it('adds extended feedback at 4 s and long-running at 10 s', async () => {
    await render(true);
    await advance(ASYNC_FEEDBACK_TIMING.extended);
    expect(latest?.showExtendedFeedback).toBe(true);
    expect(latest?.isLongRunning).toBe(false);

    await advance(ASYNC_FEEDBACK_TIMING.longRunning - ASYNC_FEEDBACK_TIMING.extended);
    expect(latest?.isLongRunning).toBe(true);
  });

  it('resets in the same render when loading stops and restarts from zero', async () => {
    const renderer = await render(true);
    await advance(ASYNC_FEEDBACK_TIMING.indicator);
    expect(latest?.showIndicator).toBe(true);

    await ReactTestRenderer.act(async () => {
      renderer.update(<Probe isLoading={false} />);
    });
    expect(latest?.showIndicator).toBe(false);

    await ReactTestRenderer.act(async () => {
      renderer.update(<Probe isLoading />);
    });
    await advance(ASYNC_FEEDBACK_TIMING.indicator - 1);
    expect(latest?.showIndicator).toBe(false);
    await advance(1);
    expect(latest?.showIndicator).toBe(true);
  });

  it('restarts the delay when the scope changes', async () => {
    const renderer = await render(true, { resetKey: 'a' });
    await advance(ASYNC_FEEDBACK_TIMING.indicator);
    expect(latest?.showIndicator).toBe(true);

    await ReactTestRenderer.act(async () => {
      renderer.update(<Probe isLoading options={{ resetKey: 'b' }} />);
    });
    expect(latest?.showIndicator).toBe(false);
    await advance(ASYNC_FEEDBACK_TIMING.indicator);
    expect(latest?.showIndicator).toBe(true);
  });

  it('shows elapsed work at once after a remount when the start time is known', async () => {
    jest.setSystemTime(new Date('2026-10-22T00:00:10.000Z'));
    const startedAt = new Date('2026-10-22T00:00:05.000Z').getTime();

    await render(true, { startedAt });

    expect(latest).toEqual({ showIndicator: true, showExtendedFeedback: true, isLongRunning: false });
  });

  it('clears its timers on unmount', async () => {
    const loading = await render(true);
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    await ReactTestRenderer.act(async () => {
      loading.unmount();
    });

    // The indicator, extended and long-running timers are all cleared.
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    clearTimeoutSpy.mockRestore();
  });
});
