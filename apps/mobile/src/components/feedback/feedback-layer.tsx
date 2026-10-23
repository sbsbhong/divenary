import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { MOTION_TIMING } from '../../constants/motion';
import { Box } from '../ui/box';
import { appearEntering } from '../ui/motion-entering';

const AnimatedBox = Animated.createAnimatedComponent(Box);

type FeedbackLayerProps = {
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Lets touches reach the children. A leaving layer never takes them. */
  pointerEvents?: 'box-none' | 'none';
  /** The message this layer shows was replaced or closed. It fades out and cannot be pressed. */
  leaving?: boolean;
};

/**
 * One message layer (the result banner or the watch import toast). An arriving layer rises
 * `appearOffset` while it brightens. A leaving layer only fades over `dismiss`, takes no touches,
 * and is hidden from VoiceOver, so a message that is going away cannot be pressed.
 */
export function FeedbackLayer({
  children,
  className,
  style,
  testID,
  pointerEvents = 'box-none',
  leaving = false,
}: FeedbackLayerProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  React.useEffect(() => {
    if (leaving) {
      opacity.set(withTiming(0, { duration: MOTION_TIMING.dismiss }));
    }
  }, [leaving, opacity]);

  return (
    <AnimatedBox
      testID={testID}
      entering={leaving ? undefined : appearEntering(reduceMotion)}
      pointerEvents={leaving ? 'none' : pointerEvents}
      accessibilityElementsHidden={leaving}
      importantForAccessibility={leaving ? 'no-hide-descendants' : undefined}
      className={className}
      style={leaving ? [style, fadeStyle] : style}>
      {children}
    </AnimatedBox>
  );
}
