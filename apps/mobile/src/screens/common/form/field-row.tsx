import React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Box } from '../../../components/ui/box';
import { HStack } from '../../../components/ui/hstack';
import { AlertCircleIcon, Icon } from '../../../components/ui/icon';
import { Text } from '../../../components/ui/text';
import { VStack } from '../../../components/ui/vstack';

/** The gap above every row but the first in a group, drawn with the page background, not a border. */
export function RowSeparator(): React.JSX.Element {
  return <Box className="ml-4 h-px bg-background" />;
}

/**
 * A row label with a quiet required marker. The marker only shows while the field is still empty,
 * so a filled form does not repeat it on every row.
 */
export function FieldLabel(props: {
  label: string;
  required?: boolean;
  hasValue?: boolean;
  labelTestID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <HStack space="sm" className="shrink items-baseline">
      <Text testID={props.labelTestID} className="shrink text-base text-card-foreground" numberOfLines={2}>
        {props.label}
      </Text>
      {props.required && !props.hasValue ? (
        <Text className="text-xs text-muted-foreground">{t('form.required')}</Text>
      ) : null}
    </HStack>
  );
}

/**
 * A validation message under a row, inside the same group. The ID prop is not called `testID`, so
 * a test lookup by that ID lands on the message text itself.
 */
export function FieldError(props: { message?: string; messageTestID?: string }): React.JSX.Element | null {
  if (!props.message) {
    return null;
  }

  return (
    <HStack space="xs" className="items-start px-4 pb-3">
      <Icon as={AlertCircleIcon} size="sm" className="mt-0.5 text-destructive" />
      <Text testID={props.messageTestID} className="flex-1 text-sm leading-5 text-destructive">
        {props.message}
      </Text>
    </HStack>
  );
}

/** Builds the one label VoiceOver reads for a row: label, value, required and error together. */
export function rowAccessibilityLabel(parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(', ');
}

type FieldRowProps = {
  label: string;
  required?: boolean;
  /** Hides the required marker once the field is filled. */
  hasValue?: boolean;
  error?: string;
  errorTestID?: string;
  labelTestID?: string;
  /** `inline` puts a compact control on the right (pills, stars); `stacked` puts it under the label (inputs, badges, notes). */
  layout?: 'inline' | 'stacked';
  /** False drops the gap above the row, for the first row of a group. */
  separated?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
  children: React.ReactNode;
};

/**
 * One editor row inside a grouped `Section`, for controls that are not a picked value: text
 * inputs, selector pills, star ratings and badge lists.
 */
export function FieldRow(props: FieldRowProps): React.JSX.Element {
  const label = (
    <FieldLabel label={props.label} required={props.required} hasValue={props.hasValue} labelTestID={props.labelTestID} />
  );

  return (
    <VStack testID={props.testID} onLayout={props.onLayout}>
      {props.separated === false ? null : <RowSeparator />}
      {props.layout === 'inline' ? (
        <HStack space="md" className="min-h-12 items-center px-4 py-2">
          <Box className="flex-1">{label}</Box>
          {props.children}
        </HStack>
      ) : (
        <VStack space="sm" className="px-4 py-3">
          {label}
          {props.children}
        </VStack>
      )}
      <FieldError message={props.error} messageTestID={props.errorTestID} />
    </VStack>
  );
}
