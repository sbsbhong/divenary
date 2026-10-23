import { useCallback } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { MOTION_TIMING, PRESS_SCALE, type PressScaleKind } from '../constants/motion';

// Pressable types its handlers as nullable, so the caller's values pass through unchanged.
export type PressHandlers = {
  onPressIn?: ((event: GestureResponderEvent) => void) | null;
  onPressOut?: ((event: GestureResponderEvent) => void) | null;
};

/**
 * Shrinks a pressed element on the UI thread. The shared value moves without a React render, so
 * the press never waits for state. A disabled Pressable sends no press events, so it stays at 1.
 * The caller's own press handlers still run.
 */
export function usePressScale(kind: PressScaleKind, handlers?: PressHandlers) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const callerPressIn = handlers?.onPressIn;
  const callerPressOut = handlers?.onPressOut;

  const onPressIn = useCallback(
    (event: GestureResponderEvent) => {
      scale.set(withTiming(PRESS_SCALE[kind], { duration: MOTION_TIMING.pressIn, easing: Easing.out(Easing.quad) }));
      callerPressIn?.(event);
    },
    [callerPressIn, kind, scale],
  );

  const onPressOut = useCallback(
    (event: GestureResponderEvent) => {
      scale.set(withSpring(1, MOTION_TIMING.pressRelease));
      callerPressOut?.(event);
    },
    [callerPressOut, scale],
  );

  return { style, onPressIn, onPressOut };
}
