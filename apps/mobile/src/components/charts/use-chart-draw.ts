import { useEffect, useState } from 'react';
import {
  Easing,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { MOTION_TIMING } from '../../constants/motion';

/**
 * Entry keys whose chart has been shown in this JS runtime. A key drawn once stays at its end state
 * on later shows. Kept in memory on purpose: a fresh app launch draws each chart again.
 */
const shownChartKeys = new Set<string>();

/** Ease-in-out for the line reveal and the area brightening. */
export const CHART_DRAW_EASING = Easing.bezier(0.42, 0, 0.58, 1);

export type ChartDrawOptions = {
  /** Identifies the chart for the whole runtime, such as the entry's localId plus a suffix. */
  animationKey: string;
  /** The line reveal time, in milliseconds. */
  drawDuration: number;
  /** Delay before the line starts; the secondary chart waits `chartSecondaryDelay`. */
  drawDelay?: number;
};

export type ChartDraw = {
  /** The line draws left to right: first show in this runtime, Reduce Motion off. */
  drawsLine: boolean;
  /** Reduce Motion on, first show: the chart fades in with no draw and no logo. */
  fadesIn: boolean;
  /** 0 to 1. The clip width as a fraction of the chart width; the reveal edge. */
  progress: SharedValue<number>;
  /** 0 to 1. Multiplied by the area's own opacity; the area starts after `chartAreaDelay`. */
  areaProgress: SharedValue<number>;
  /** 1 while the draw runs, then 0 after `fade`. Only the depth logo rider reads it. */
  riderOpacity: SharedValue<number>;
  /** 0 to 1 for the Reduce Motion fade of the whole chart. */
  fadeProgress: SharedValue<number>;
};

/**
 * Drives a chart's first-time reveal on the UI thread. The first render decides whether this show
 * is the first one, and the effect records the key. Later mounts of the same key start at the end
 * state. Under Reduce Motion nothing moves; the chart only fades over `reducedMotionFade`.
 */
export function useChartDraw(options: ChartDrawOptions): ChartDraw {
  const { animationKey, drawDuration, drawDelay = 0 } = options;
  const reduceMotion = useReducedMotion();
  const [firstShow] = useState(() => !shownChartKeys.has(animationKey));
  const drawsLine = firstShow && !reduceMotion;
  const fadesIn = firstShow && reduceMotion;

  const progress = useSharedValue(drawsLine ? 0 : 1);
  const areaProgress = useSharedValue(drawsLine ? 0 : 1);
  const riderOpacity = useSharedValue(1);
  const fadeProgress = useSharedValue(fadesIn ? 0 : 1);

  useEffect(() => {
    shownChartKeys.add(animationKey);

    if (drawsLine) {
      progress.set(withDelay(drawDelay, withTiming(1, { duration: drawDuration, easing: CHART_DRAW_EASING })));
      areaProgress.set(
        withDelay(
          drawDelay + MOTION_TIMING.chartAreaDelay,
          withTiming(1, { duration: MOTION_TIMING.chartAreaFill, easing: CHART_DRAW_EASING }),
        ),
      );
      riderOpacity.set(withDelay(drawDelay + drawDuration, withTiming(0, { duration: MOTION_TIMING.fade })));
    }

    if (fadesIn) {
      fadeProgress.set(withTiming(1, { duration: MOTION_TIMING.reducedMotionFade }));
    }
  }, [animationKey, drawDelay, drawDuration, drawsLine, fadesIn, progress, areaProgress, riderOpacity, fadeProgress]);

  return { drawsLine, fadesIn, progress, areaProgress, riderOpacity, fadeProgress };
}
