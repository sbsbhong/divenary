import { useEffect, useState } from 'react';
import { ASYNC_FEEDBACK_TIMING } from '../constants/async-feedback';

export type LoadingFeedback = {
  readonly showIndicator: boolean;
  readonly showExtendedFeedback: boolean;
  readonly isLongRunning: boolean;
};

export type LoadingFeedbackOptions = {
  /** Start of the work in epoch milliseconds, so a remounted view shows elapsed work at once. */
  readonly startedAt?: number;
  readonly indicatorMs?: number;
  /** A new scope (for example a different principal or filter) restarts the delay. */
  readonly resetKey?: string;
  readonly extendedMs?: number;
  readonly longRunningMs?: number;
};

const IDLE_FEEDBACK: LoadingFeedback = Object.freeze({
  showIndicator: false,
  showExtendedFeedback: false,
  isLongRunning: false,
});

/**
 * Turns elapsed loading time into presentation flags. The query owns the async state; this hook
 * only decides when that state becomes visible. The caller picks skeleton or spinner.
 *
 * - under 1 s: nothing
 * - 1 s to 4 s: showIndicator
 * - 4 s to 10 s: also showExtendedFeedback
 * - 10 s and later: also isLongRunning
 */
export function useLoadingFeedback(isLoading: boolean, options?: LoadingFeedbackOptions): LoadingFeedback {
  const indicatorMs = options?.indicatorMs ?? ASYNC_FEEDBACK_TIMING.indicator;
  const extendedMs = options?.extendedMs ?? ASYNC_FEEDBACK_TIMING.extended;
  const longRunningMs = options?.longRunningMs ?? ASYNC_FEEDBACK_TIMING.longRunning;
  const startedAt = options?.startedAt;
  const resetKey = options?.resetKey;

  const elapsed = () =>
    startedAt !== undefined && Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
  const initialFeedback = (): LoadingFeedback =>
    isLoading
      ? {
          showIndicator: elapsed() >= indicatorMs,
          showExtendedFeedback: elapsed() >= extendedMs,
          isLongRunning: elapsed() >= longRunningMs,
        }
      : IDLE_FEEDBACK;
  const [state, setState] = useState<LoadingFeedback>(initialFeedback);
  const [previousLoading, setPreviousLoading] = useState(isLoading);
  const [previousKey, setPreviousKey] = useState(resetKey);
  const [previousStart, setPreviousStart] = useState(startedAt);

  // A new loading cycle, scope or start time resets the flags in the same render.
  if (isLoading !== previousLoading || previousKey !== resetKey || previousStart !== startedAt) {
    setPreviousStart(startedAt);
    setPreviousKey(resetKey);
    setPreviousLoading(isLoading);
    setState(initialFeedback());
  }

  useEffect(() => {
    if (!isLoading) {
      return;
    }
    const alreadyElapsed =
      startedAt !== undefined && Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
    const indicatorTimer = setTimeout(() => {
      setState(previous => ({ ...previous, showIndicator: true }));
    }, Math.max(0, indicatorMs - alreadyElapsed));
    const extendedTimer = setTimeout(() => {
      setState(previous => ({ ...previous, showExtendedFeedback: true }));
    }, Math.max(0, extendedMs - alreadyElapsed));
    const longRunningTimer = setTimeout(() => {
      setState(previous => ({ ...previous, isLongRunning: true }));
    }, Math.max(0, longRunningMs - alreadyElapsed));

    return () => {
      clearTimeout(indicatorTimer);
      clearTimeout(extendedTimer);
      clearTimeout(longRunningTimer);
    };
  }, [isLoading, indicatorMs, extendedMs, longRunningMs, resetKey, startedAt]);

  return isLoading ? state : IDLE_FEEDBACK;
}
