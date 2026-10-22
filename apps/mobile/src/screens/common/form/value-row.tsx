import React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Box } from '../../../components/ui/box';
import { HStack } from '../../../components/ui/hstack';
import { ChevronRightIcon, Icon } from '../../../components/ui/icon';
import { Pressable } from '../../../components/ui/pressable';
import { Text } from '../../../components/ui/text';
import { VStack } from '../../../components/ui/vstack';
import { FieldError, FieldLabel, RowSeparator, rowAccessibilityLabel } from './field-row';

export type ValueRowProps = {
  label: string;
  /** The formatted value. Undefined shows `emptyText`, never a 0. */
  value?: string;
  /** What an unknown value looks like, for example `--:--`, `-- m` or `-- bar`. */
  emptyText: string;
  /** The spoken value when it differs from the visible text, for example "47분" for "47:00". */
  spokenValue?: string;
  /** Replaces the value text, for example a date and a time that keep their own test IDs. */
  valueContent?: React.ReactNode;
  /** Opens the picker for this value. Without it the row is read-only and has no chevron. */
  onPress?: () => void;
  /** True while the picker this row opens is showing. */
  expanded?: boolean;
  required?: boolean;
  error?: string;
  /** A low-chroma marker after the label, such as where a measured value came from. */
  badge?: string;
  /** One compact control at the end of the row, kept outside the row button so VoiceOver reaches it. */
  trailing?: React.ReactNode;
  /** Context under the row inside the same group, such as an unsupported-depth note. */
  footer?: React.ReactNode;
  disabled?: boolean;
  /** False drops the gap above the row, for the first row of a group. */
  separated?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  /**
   * Prefix for `-anchor` (layout wrapper), `-trigger` (row button) or `-row` (read-only row),
   * `-row-value`, `-badge` and `-error`.
   */
  testID: string;
};

/** A grouped label/value row: label, value or `--` placeholder, and a chevron when it opens a picker. */
export function ValueRow(props: ValueRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const hasValue = props.value !== undefined;
  const accessibilityLabel = rowAccessibilityLabel([
    props.label,
    props.badge,
    props.spokenValue ?? props.value ?? t('form.emptyValue'),
    props.required && t('form.required'),
    props.error,
  ]);
  const content = (
    <HStack space="md" className="min-h-12 flex-1 items-center px-4 py-3">
      <HStack space="sm" className="flex-1 items-center">
        <FieldLabel label={props.label} required={props.required} hasValue={hasValue} />
        {props.badge ? (
          <Text
            testID={`${props.testID}-badge`}
            className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {props.badge}
          </Text>
        ) : null}
      </HStack>
      {props.valueContent ?? (
        <Text
          testID={`${props.testID}-row-value`}
          className={hasValue ? 'max-w-[55%] text-right text-base text-foreground' : 'text-base text-muted-foreground'}
          numberOfLines={1}>
          {props.value ?? props.emptyText}
        </Text>
      )}
      {props.onPress ? <Icon as={ChevronRightIcon} className="text-muted-foreground" /> : null}
    </HStack>
  );

  return (
    <VStack testID={`${props.testID}-anchor`} onLayout={props.onLayout}>
      {props.separated === false ? null : <RowSeparator />}
      <HStack className="items-center">
        {props.onPress ? (
          <Pressable
            testID={`${props.testID}-trigger`}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={t('form.openPickerHint')}
            accessibilityState={{ disabled: Boolean(props.disabled), expanded: Boolean(props.expanded) }}
            disabled={props.disabled}
            onPress={props.onPress}
            className="flex-1 flex-row active:bg-muted">
            {content}
          </Pressable>
        ) : (
          <Box testID={`${props.testID}-row`} accessible accessibilityLabel={accessibilityLabel} className="flex-1 flex-row">
            {content}
          </Box>
        )}
        {props.trailing ? <Box className="pr-4">{props.trailing}</Box> : null}
      </HStack>
      <FieldError message={props.error} messageTestID={`${props.testID}-error`} />
      {props.footer ? <Box className="px-4 pb-3">{props.footer}</Box> : null}
    </VStack>
  );
}
