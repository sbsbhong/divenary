import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '../../components/ui/box';
import { HStack } from '../../components/ui/hstack';
import { PressScalePressable } from '../../components/ui/press-scale';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { RowSeparator, rowAccessibilityLabel } from '../common/form/field-row';

/**
 * A value the watch measured (start time, dive time, max depth), shown read-only with a quiet
 * "워치 측정값" chip. `직접 수정` opens the normal input for it.
 */
export function WatchMeasuredRow(props: {
  label: string;
  value?: string;
  spokenValue?: string;
  emptyText: string;
  onOverride: () => void;
  /** Context under the row, such as the unsupported-depth note. */
  footer?: React.ReactNode;
  separated?: boolean;
  /** `-row`, `-row-value`, `-badge` and `-override`. */
  testID: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const badge = t('logbook.watchCaptured');

  return (
    <VStack testID={`${props.testID}-anchor`}>
      {props.separated === false ? null : <RowSeparator />}
      <HStack space="md" className="min-h-12 items-center px-4 py-3">
        <VStack
          testID={`${props.testID}-row`}
          space="xs"
          accessible
          accessibilityLabel={rowAccessibilityLabel([props.label, badge, props.spokenValue ?? props.value ?? t('form.emptyValue')])}
          className="flex-1">
          <HStack space="sm" className="flex-wrap items-center">
            <Text className="text-base text-card-foreground">{props.label}</Text>
            <Text
              testID={`${props.testID}-badge`}
              className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {badge}
            </Text>
          </HStack>
          <Text testID={`${props.testID}-row-value`} className="text-base text-foreground">
            {props.value ?? props.emptyText}
          </Text>
        </VStack>
        <PressScalePressable
          kind="control"
          testID={`${props.testID}-override`}
          accessibilityRole="button"
          accessibilityLabel={t('logbook.overrideWatchValueLabel', { label: props.label })}
          onPress={props.onOverride}
          hitSlop={8}
          className="min-h-11 justify-center">
          <Text className="text-base text-primary">{t('logbook.overrideWatchValue')}</Text>
        </PressScalePressable>
      </HStack>
      {props.footer ? <Box className="px-4 pb-3">{props.footer}</Box> : null}
    </VStack>
  );
}

/**
 * Under a watch value the user changed: what the watch measured and a way back to it. The ID prop
 * is not called `testID`, so a test lookup by that ID lands on the button itself.
 */
export function RestoreWatchValueLine(props: {
  label: string;
  watchValue: string;
  onRestore: () => void;
  restoreTestID: string;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <HStack space="sm" className="items-center px-4 pb-2">
      <Text className="flex-1 text-sm leading-5 text-muted-foreground">
        {t('logbook.watchValueNote', { value: props.watchValue })}
      </Text>
      <PressScalePressable
        kind="control"
        testID={props.restoreTestID}
        accessibilityRole="button"
        accessibilityLabel={t('logbook.restoreWatchValueLabel', { label: props.label, value: props.watchValue })}
        onPress={props.onRestore}
        hitSlop={8}
        className="min-h-11 justify-center">
        <Text className="text-sm text-primary">{t('logbook.restoreWatchValue')}</Text>
      </PressScalePressable>
    </HStack>
  );
}
