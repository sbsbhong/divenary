import React from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VStack } from './vstack';

type StickyActionBarProps = {
  children: React.ReactNode;
  testID?: string;
};

/**
 * Keeps a screen's primary action visible at the bottom while the content scrolls, above the
 * home indicator and the keyboard.
 */
export function StickyActionBar(props: StickyActionBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <VStack
        testID={props.testID}
        space="sm"
        className="bg-background px-5 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        {props.children}
      </VStack>
    </KeyboardAvoidingView>
  );
}
