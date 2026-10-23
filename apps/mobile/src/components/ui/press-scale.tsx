import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import type { PressScaleKind } from '../../constants/motion';
import { usePressScale } from '../../hooks/use-press-scale';
import { Button } from './button';
import { Pressable } from './pressable';

// The animated style needs a native view that receives updates, so these wrap the existing
// components and keep their props, testIDs, accessibility state and className layout as they are.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedButton = Animated.createAnimatedComponent(Button);

type PressScalePressableProps = Omit<React.ComponentProps<typeof Pressable>, 'style'> & {
  kind: PressScaleKind;
  style?: StyleProp<ViewStyle>;
};

/** A Pressable that shrinks under the finger. Use `card` for a whole row, `control` for anything smaller. */
export const PressScalePressable = React.forwardRef<React.ComponentRef<typeof Pressable>, PressScalePressableProps>(
  ({ kind, style, onPressIn, onPressOut, ...props }, ref) => {
    const press = usePressScale(kind, { onPressIn, onPressOut });

    return (
      <AnimatedPressable
        {...props}
        ref={ref}
        style={[press.style, style]}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
      />
    );
  },
);
PressScalePressable.displayName = 'PressScalePressable';

type PressScaleButtonProps = Omit<React.ComponentProps<typeof Button>, 'style'> & {
  kind: PressScaleKind;
  style?: StyleProp<ViewStyle>;
};

/** The gluestack Button with the same press scale. Its className layout and hit area stay as they are. */
export const PressScaleButton = React.forwardRef<React.ComponentRef<typeof Button>, PressScaleButtonProps>(
  ({ kind, style, onPressIn, onPressOut, ...props }, ref) => {
    const press = usePressScale(kind, { onPressIn, onPressOut });

    return (
      <AnimatedButton
        {...props}
        ref={ref}
        style={[press.style, style]}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
      />
    );
  },
);
PressScaleButton.displayName = 'PressScaleButton';
