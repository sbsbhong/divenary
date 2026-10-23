import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Box } from './box';
import { HStack } from './hstack';
import { CheckIcon, ChevronRightIcon, Icon } from './icon';
import { useLoadingFeedback } from '../../hooks/use-loading-feedback';
import { Pressable } from './pressable';
import { SkeletonBlock } from './skeleton-block';
import { Spinner } from './spinner';
import { Switch } from './switch';
import { Text } from './text';
import { VStack } from './vstack';

type SectionProps = {
  title?: string;
  /** One short line under the group, for context the rows cannot carry. */
  footer?: string;
  children: React.ReactNode;
  testID?: string;
  className?: string;
};

/**
 * An iOS grouped section: a short header and one card-coloured group of rows. Rows are told
 * apart by spacing and background, not borders.
 */
export function Section(props: SectionProps): React.JSX.Element {
  return (
    <VStack testID={props.testID} space="sm" className={props.className}>
      {props.title ? (
        <Text accessibilityRole="header" className="px-1 text-xs font-semibold uppercase text-muted-foreground">
          {props.title}
        </Text>
      ) : null}
      <VStack className="overflow-hidden rounded-2xl bg-card">{props.children}</VStack>
      {props.footer ? <Text className="px-1 text-xs leading-4 text-muted-foreground">{props.footer}</Text> : null}
    </VStack>
  );
}

type RowAccessory =
  | { kind: 'chevron' }
  | { kind: 'check'; checked: boolean }
  | { kind: 'switch'; value: boolean; onValueChange: (value: boolean) => void }
  | { kind: 'none' };

type RowProps = {
  label: string;
  value?: string;
  /** The value is still being read: a short placeholder holds its place while `value` is empty. */
  valueLoading?: boolean;
  /** Extra line under the label, e.g. a short explanation. */
  detail?: string;
  icon?: React.ElementType;
  accessory?: RowAccessory;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** The row's action is running: busy and disabled at once, spinner in the accessory slot after 1 s. */
  pending?: boolean;
  testID?: string;
  valueTestID?: string;
  /** Spoken instead of label + value, e.g. when the value is "--:--" or a symbol. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** False removes the hairline gap above this row (first row of a group). */
  separated?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** One grouped row: label, optional muted value, and one accessory. */
export function Row(props: RowProps): React.JSX.Element {
  const accessory = props.accessory ?? (props.onPress ? { kind: 'chevron' as const } : { kind: 'none' as const });
  const { showIndicator: showSpinner } = useLoadingFeedback(Boolean(props.pending));
  const disabled = Boolean(props.disabled || props.pending);
  const content = (
    <HStack space="md" className="min-h-12 items-center px-4 py-3">
      {props.icon ? (
        <Box className="h-8 w-8 items-center justify-center rounded-full bg-muted">
          <Icon as={props.icon} className="text-muted-foreground" />
        </Box>
      ) : null}
      <VStack className="flex-1">
        <Text className={props.destructive ? 'text-base text-destructive' : 'text-base text-card-foreground'}>
          {props.label}
        </Text>
        {props.detail ? <Text className="text-sm leading-5 text-muted-foreground">{props.detail}</Text> : null}
      </VStack>
      {props.value ? (
        <Text testID={props.valueTestID} className="max-w-[55%] text-right text-base text-muted-foreground" numberOfLines={2}>
          {props.value}
        </Text>
      ) : null}
      {props.valueLoading && !props.value ? <SkeletonBlock className="h-4 w-24" /> : null}
      {showSpinner ? (
        <Spinner
          testID={props.testID ? `${props.testID}-spinner` : undefined}
          className={props.destructive ? 'text-destructive' : 'text-muted-foreground'}
        />
      ) : null}
      {accessory.kind === 'chevron' && !showSpinner ? <Icon as={ChevronRightIcon} className="text-muted-foreground" /> : null}
      {accessory.kind === 'check' && accessory.checked ? <Icon as={CheckIcon} className="text-primary" /> : null}
      {accessory.kind === 'switch' ? (
        <Switch
          value={accessory.value}
          onValueChange={accessory.onValueChange}
          disabled={disabled}
          accessibilityLabel={props.label}
        />
      ) : null}
    </HStack>
  );
  const separator = props.separated === false ? null : <Box className="ml-4 h-px bg-background" />;

  if (!props.onPress || accessory.kind === 'switch') {
    return (
      <VStack
        testID={props.testID}
        style={props.style}
        accessible={props.accessibilityLabel !== undefined && accessory.kind !== 'switch'}
        accessibilityLabel={accessory.kind === 'switch' ? undefined : props.accessibilityLabel}
        accessibilityHint={props.accessibilityHint}>
        {separator}
        {content}
      </VStack>
    );
  }

  return (
    <VStack style={props.style}>
      {separator}
      <Pressable
        testID={props.testID}
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        accessibilityHint={props.accessibilityHint}
        accessibilityState={{
          disabled,
          busy: Boolean(props.pending),
          ...(accessory.kind === 'check' ? { selected: accessory.checked } : {}),
        }}
        disabled={disabled}
        onPress={props.onPress}
        className="active:bg-muted">
        {content}
      </Pressable>
    </VStack>
  );
}
