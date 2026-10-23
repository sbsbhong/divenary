import { FadeIn, FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { MOTION_DISTANCE, MOTION_TIMING } from '../../constants/motion';

// Each builder pins reduceMotion to Never. The caller already chooses the Reduce Motion variant, and
// the OS default would otherwise skip the opacity change along with the movement.

/** Opacity only: content replacing a first-load skeleton, or a late conditional block. */
export const fadeEntering = FadeIn.duration(MOTION_TIMING.fade).reduceMotion(ReduceMotion.Never);

/** Opacity only: a row that arrives in a list already on screen. */
export const arrivalEntering = FadeIn.duration(MOTION_TIMING.appear).reduceMotion(ReduceMotion.Never);

/**
 * A banner, toast or Home block rising `appearOffset` while it brightens. Under Reduce Motion it is
 * opacity only, and the stagger delay is dropped with the movement.
 */
export function appearEntering(reduceMotion: boolean, delay = 0) {
  if (reduceMotion) {
    return FadeIn.duration(MOTION_TIMING.reducedMotionFade).reduceMotion(ReduceMotion.Never);
  }

  // FadeInDown starts 25 pt below its place by default; the spec's offset replaces that start.
  return FadeInDown.withInitialValues({ transform: [{ translateY: MOTION_DISTANCE.appearOffset }] })
    .duration(MOTION_TIMING.appear)
    .delay(delay)
    .reduceMotion(ReduceMotion.Never);
}
