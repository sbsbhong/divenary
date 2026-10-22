import React from 'react';
import { View, type ViewProps } from 'react-native';
import { cn } from '@gluestack-ui/utils/nativewind-utils';
import { CONTENT_LOADING_FEEDBACK } from '../../constants/async-feedback';
import { useLoadingFeedback } from '../../hooks/use-loading-feedback';

/** Use only for an active read that has no valid content in the current scope yet. */
export function useContentLoading(active: boolean, scope?: string): boolean {
  return useLoadingFeedback(active, { ...CONTENT_LOADING_FEEDBACK, resetKey: scope }).showIndicator;
}

type SkeletonBlockProps = ViewProps & {
  className?: string;
  /** False keeps the slot at its final size but invisible until the shared delay has passed. */
  visible?: boolean;
};

/**
 * A static, inert placeholder slot. It is mounted at its final size from the start so content
 * replaces it without a layout shift, hidden from assistive technology, and never tappable.
 * Text lines use `rounded`, icon slots `rounded-full`, card slots the card radius.
 */
export function SkeletonBlock({ visible = true, className, style, ...props }: SkeletonBlockProps) {
  return (
    <View
      {...props}
      // cn lets a caller's size and radius replace the defaults; plain concatenation would leave both
      // `w-full` and `w-9`, and the stylesheet order, not the class order, would pick one.
      className={cn('h-4 w-full rounded bg-skeleton', visible ? 'opacity-100' : 'opacity-0', className)}
      style={style}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
