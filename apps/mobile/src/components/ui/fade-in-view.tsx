import React from 'react';
import type { ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';
import { fadeEntering } from './motion-entering';

type FadeInViewProps = ViewProps & {
  /** False mounts the view with no entering fade. Reanimated reads `entering` once, at mount. */
  animate?: boolean;
};

/**
 * Opacity-only arrival for content that replaces a first-load skeleton or a late conditional block.
 * Nothing moves, and the content is in the accessibility tree from the first frame. It is a plain
 * view, so the parent's gap spacing still sees one child.
 */
export function FadeInView({ animate = true, children, ...props }: FadeInViewProps): React.JSX.Element {
  return (
    <Animated.View {...props} entering={animate ? fadeEntering : undefined}>
      {children}
    </Animated.View>
  );
}
