/**
 * Shared motion values, taken from the mobile motion spec. Components never hard-code these
 * numbers. Times are milliseconds; distances are points; scales are unitless factors.
 */

/** How far a pressed element shrinks. A card is a whole row, so it moves less than a control. */
export const PRESS_SCALE = {
  /** Buttons, pills, tabs and back buttons. */
  control: 0.95,
  /** Rows and cards that press as one surface. */
  card: 0.97,
} as const;

export type PressScaleKind = keyof typeof PRESS_SCALE;

export const MOTION_TIMING = {
  /** Press-in, ease-out, so the shrink starts at once under the finger. */
  pressIn: 90,
  /** Press release spring; a 0.85 damping ratio settles without visible overshoot. */
  pressRelease: { duration: 320, dampingRatio: 0.85 },
  /** Content or a late conditional block fading in. */
  fade: 180,
  /** A banner or toast arriving. */
  appear: 240,
  /** A banner or toast leaving. */
  dismiss: 160,
  /** Gap between Home blocks on the first appearance after launch. */
  stagger: 40,
  /** A depth profile drawing from left to right. */
  chartDraw: 900,
  /** A Home sparkline drawing from left to right. */
  sparklineDraw: 600,
  /** Delay before the chart fill starts brightening, so the line leads. */
  chartAreaDelay: 200,
  /** The chart fill brightening from 0 to its resting opacity. */
  chartAreaFill: 600,
  /** A detail chart waits for the screen's push to finish, so the draw is seen from its start. */
  chartAfterPush: 300,
  /** Delay before the secondary (water temperature) chart starts drawing. */
  chartSecondaryDelay: 150,
  /** The only motion left under Reduce Motion: a plain opacity change. */
  reducedMotionFade: 200,
} as const;

/** Arrival distance for banners, toasts and Home blocks, in points. */
export const MOTION_DISTANCE = {
  appearOffset: 8,
} as const;

/** The selected tab icon dips and springs back once after a tap. Total about 350 ms. */
export const TAB_BOUNCE = {
  /** Scale at the bottom of the dip. */
  scale: 0.86,
  /** Ease-out dip time. */
  dip: 100,
  /** Spring back to 1; a 0.5 damping ratio gives the small rebound. */
  rebound: { duration: 250, dampingRatio: 0.5 },
  /** A selection change counts as the tap's only if it lands this soon after the tap. */
  tapWindow: 500,
} as const;

/** The connection check on the device page dims the status row once to show it ran. */
export const WATCH_STATUS_BLINK = {
  /** Time to dim the row. */
  dim: 120,
  /** Time to come back to full opacity. */
  back: 240,
  /** Opacity at the dimmed point. */
  opacity: 0.3,
} as const;
