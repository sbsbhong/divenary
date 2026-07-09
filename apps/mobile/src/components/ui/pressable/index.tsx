'use client';
import React from 'react';
import { createPressable } from '@gluestack-ui/core/pressable/creator';
import { Keyboard, Pressable as RNPressable } from 'react-native';

import { tva } from '@gluestack-ui/utils/nativewind-utils';
import { withStyleContext } from '@gluestack-ui/utils/nativewind-utils';
import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';

const UIPressable = createPressable({
  Root: withStyleContext(RNPressable),
});

const pressableStyle = tva({
  base: 'data-[focus-visible=true]:outline-none data-[focus-visible=true]:ring-indicator-info data-[focus-visible=true]:ring-2 data-[disabled=true]:opacity-40',
});

type IPressableProps = Omit<
  React.ComponentProps<typeof UIPressable>,
  'context'
> &
  VariantProps<typeof pressableStyle>;
const Pressable = React.forwardRef<
  React.ComponentRef<typeof UIPressable>,
  IPressableProps
>(function Pressable({ className, onPress, ...props }, ref) {
  const handlePress = React.useCallback<NonNullable<IPressableProps['onPress']>>(
    event => {
      Keyboard.dismiss();
      onPress?.(event);
    },
    [onPress],
  );

  return (
    <UIPressable
      {...props}
      onPress={onPress ? handlePress : undefined}
      ref={ref}
      className={pressableStyle({
        class: className,
      })}
    />
  );
});

Pressable.displayName = 'Pressable';
export { Pressable };
