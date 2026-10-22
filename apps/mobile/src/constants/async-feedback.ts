/**
 * Shared delays for loading feedback, copied from the naver-ad-bidder loading strategy. Components
 * never hard-code these numbers.
 */
export const ASYNC_FEEDBACK_TIMING = {
  /** Nothing is shown before this; fast work looks instant. */
  indicator: 1_000,
  /** A short line is added where the wait could look stuck. */
  extended: 4_000,
  /** Offer retry, cancel or recovery instead of an endless spinner. */
  longRunning: 10_000,
} as const;

/** Content skeletons appear after the same delay and have no minimum display time. */
export const CONTENT_LOADING_FEEDBACK = {
  indicatorMs: ASYNC_FEEDBACK_TIMING.indicator,
} as const;
