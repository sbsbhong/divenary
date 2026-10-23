import React from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Pressable as RNPressable,
  ScrollView,
  SectionList,
  Text as RNText,
  View,
  VirtualizedList,
  type ViewStyle,
} from 'react-native';
import { createActionsheet } from '@gluestack-ui/core/actionsheet/creator';
import { UIIcon } from '@gluestack-ui/core/icon/creator';
import { AnimatePresence, Motion, createMotionAnimatedComponent, type MotionComponentProps } from '@legendapp/motion';
import { cssInterop } from 'nativewind';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { HStack } from './hstack';
import { CloseCircleIcon, Icon } from './icon';
import { PressScalePressable } from './press-scale';
import { Text } from './text';
import { VStack } from './vstack';

// Built from the same gluestack actionsheet creator as `./actionsheet`. That wrapper imports
// `@expo/html-elements` for a section header this sheet never uses, which Jest does not transform,
// so importing it would break every screen test that renders an editor.
type MotionViewProps = React.ComponentProps<typeof View> &
  MotionComponentProps<typeof View, ViewStyle, unknown, unknown, unknown>;
type AnimatedPressableProps = React.ComponentProps<typeof RNPressable> &
  MotionComponentProps<typeof RNPressable, ViewStyle, unknown, unknown, unknown>;

const MotionView = Motion.View as React.ComponentType<MotionViewProps>;
const AnimatedPressable = createMotionAnimatedComponent(RNPressable) as React.ComponentType<AnimatedPressableProps>;

const UISheet = createActionsheet({
  Root: View,
  Content: MotionView,
  Item: RNPressable,
  ItemText: RNText,
  DragIndicator: View,
  IndicatorWrapper: View,
  Backdrop: AnimatedPressable,
  ScrollView,
  VirtualizedList,
  FlatList,
  SectionList,
  SectionHeaderText: RNText,
  Icon: UIIcon,
  AnimatePresence,
});

cssInterop(UISheet, { className: 'style' });
cssInterop(UISheet.Content, { className: 'style' });
cssInterop(UISheet.DragIndicator, { className: 'style' });
cssInterop(UISheet.DragIndicatorWrapper, { className: 'style' });
cssInterop(UISheet.Backdrop, { className: 'style' });

export type PickerSheetAction = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

type PickerSheetProps = {
  isOpen: boolean;
  /** The backdrop, the drag handle and the Android back button close the sheet through this. */
  onClose: () => void;
  title: string;
  /** The one confirming action on the right of the header. */
  done: PickerSheetAction;
  /** An optional clear action on the left of the header, drawn with an (x). */
  clear?: PickerSheetAction;
  children: React.ReactNode;
  testID?: string;
};

/**
 * A bottom sheet that holds one picker at a time, so a value never changes while the form behind
 * it scrolls. It is a native modal, so it also covers form-sheet and modal screens.
 */
export function PickerSheet(props: PickerSheetProps): React.JSX.Element {
  // Read the context directly so a screen test without a SafeAreaProvider still renders the sheet.
  const bottomInset = React.useContext(SafeAreaInsetsContext)?.bottom ?? 0;

  return (
    <UISheet isOpen={props.isOpen} onClose={props.onClose} useRNModal className="h-full w-full">
      <KeyboardAvoidingView
        // Padding shrinks the frame the sheet is laid out in, so the sheet rides above the keyboard
        // during direct entry while the backdrop still covers the whole screen.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardFrame}>
        <UISheet.Backdrop
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'timing', duration: 200 }}
          className="absolute bottom-0 left-0 right-0 top-0 bg-black/40"
        />
        <UISheet.Content
          testID={props.testID}
          className="max-h-[80vh] w-full rounded-t-3xl bg-background pt-1"
          style={{ paddingBottom: Math.max(bottomInset, 16) }}>
          <UISheet.DragIndicatorWrapper className="w-full items-center py-2">
            <UISheet.DragIndicator className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </UISheet.DragIndicatorWrapper>
          <HStack className="min-h-12 items-center px-3">
            <HStack className="flex-1 justify-start">
              {props.clear ? <SheetHeaderButton action={props.clear} icon={CloseCircleIcon} /> : null}
            </HStack>
            <Text
              accessibilityRole="header"
              className="shrink text-center text-base font-semibold text-foreground"
              numberOfLines={1}>
              {props.title}
            </Text>
            <HStack className="flex-1 justify-end">
              <SheetHeaderButton action={props.done} emphasized />
            </HStack>
          </HStack>
          <VStack space="md" className="px-5 pt-2">
            {props.children}
          </VStack>
        </UISheet.Content>
      </KeyboardAvoidingView>
    </UISheet>
  );
}

function SheetHeaderButton(props: {
  action: PickerSheetAction;
  icon?: React.ElementType;
  emphasized?: boolean;
}): React.JSX.Element {
  return (
    <PressScalePressable
      kind="control"
      testID={props.action.testID}
      accessibilityRole="button"
      accessibilityLabel={props.action.accessibilityLabel ?? props.action.label}
      hitSlop={8}
      onPress={props.action.onPress}
      className="min-h-11 flex-row items-center justify-center gap-1 px-2">
      {props.icon ? <Icon as={props.icon} size="sm" className="text-primary" /> : null}
      <Text className={props.emphasized ? 'text-base font-semibold text-primary' : 'text-base text-primary'}>
        {props.action.label}
      </Text>
    </PressScalePressable>
  );
}

const styles = StyleSheet.create({
  keyboardFrame: { flex: 1 },
});
