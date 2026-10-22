import DateTimePickerNative, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useColorScheme } from 'nativewind';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, type LayoutChangeEvent } from 'react-native';
import { HStack } from '../../../components/ui/hstack';
import { PickerSheet } from '../../../components/ui/picker-sheet';
import { Text } from '../../../components/ui/text';
import { ValueRow } from './value-row';

type DateTimeFieldProps = {
  label: string;
  value?: Date;
  onChange: (value: Date | undefined) => void;
  required?: boolean;
  error?: string;
  /** The latest moment that can be picked. The log editor passes now, so a log is never dated in the future. */
  maximumDate?: Date;
  minimumDate?: Date;
  /** Where the picker starts while there is no value. Defaults to now, kept inside the allowed range. */
  defaultValue?: Date;
  /** Shows a clear (x) action in the sheet. Off by default because both editors require a date. */
  clearable?: boolean;
  /** A low-chroma marker after the label, such as where a measured start time came from. */
  badge?: string;
  disabled?: boolean;
  /** False drops the gap above the row, for the first row of a group. */
  separated?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Row: `-anchor`, `-trigger`, `-date`, `-time`, `-error`. Sheet: `-sheet`, `-picker`, `-clear`, `-done`. */
  testID: string;
};

/**
 * A date and time row in the current language. On iOS it opens a sheet with the native wheel and
 * Done; turning the wheel saves at once, and Done saves the shown moment when there was no value.
 */
export function DateTimeField(props: DateTimeFieldProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [isOpen, setIsOpen] = React.useState(false);
  // Fixed when the sheet opens, so the wheel does not jump on every render while "now" moves.
  const [startValue, setStartValue] = React.useState<Date>(() => new Date());
  const { onChange, value } = props;
  const parts = value ? formatDateTimeParts(value, i18n.language) : undefined;

  const open = React.useCallback(() => {
    setStartValue(clampDate(props.defaultValue ?? new Date(), props.minimumDate, props.maximumDate));
    setIsOpen(true);
  }, [props.defaultValue, props.maximumDate, props.minimumDate]);

  const handleValueChange = React.useCallback(
    (_event: DateTimePickerChangeEvent, selectedDate: Date) => {
      if (Platform.OS !== 'ios') {
        setIsOpen(false);
      }

      onChange(selectedDate);
    },
    [onChange],
  );

  const handleDismiss = React.useCallback(() => {
    if (Platform.OS !== 'ios') {
      setIsOpen(false);
    }
  }, []);

  const finish = React.useCallback(() => {
    if (value === undefined) {
      onChange(startValue);
    }
    setIsOpen(false);
  }, [onChange, startValue, value]);

  const clear = React.useCallback(() => {
    onChange(undefined);
    setIsOpen(false);
  }, [onChange]);

  const picker = isOpen ? (
    <DateTimePickerNative
      testID={`${props.testID}-picker`}
      value={value ?? startValue}
      mode="datetime"
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      locale={i18n.language}
      // Follow the app theme, which can differ from the system appearance.
      themeVariant={colorScheme === 'dark' ? 'dark' : 'light'}
      maximumDate={props.maximumDate}
      minimumDate={props.minimumDate}
      onValueChange={handleValueChange}
      onDismiss={handleDismiss}
    />
  ) : null;

  return (
    <>
      <ValueRow
        label={props.label}
        value={parts ? `${parts.date} ${parts.time}` : undefined}
        emptyText="--"
        valueContent={
          <HStack space="sm" className="shrink items-baseline">
            <Text
              testID={`${props.testID}-date`}
              className={parts ? 'text-base text-foreground' : 'text-base text-muted-foreground'}
              numberOfLines={1}>
              {parts?.date ?? '--'}
            </Text>
            <Text
              testID={`${props.testID}-time`}
              className={parts ? 'text-base text-foreground' : 'text-base text-muted-foreground'}
              numberOfLines={1}>
              {parts?.time ?? '--:--'}
            </Text>
          </HStack>
        }
        onPress={open}
        expanded={isOpen}
        required={props.required}
        error={props.error}
        badge={props.badge}
        disabled={props.disabled}
        separated={props.separated}
        onLayout={props.onLayout}
        testID={props.testID}
      />
      {Platform.OS === 'ios' ? (
        <PickerSheet
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title={props.label}
          done={{ label: t('form.done'), onPress: finish, testID: `${props.testID}-done` }}
          clear={
            props.clearable && value
              ? {
                  label: t('form.clear'),
                  accessibilityLabel: t('form.clearValue', { label: props.label }),
                  onPress: clear,
                  testID: `${props.testID}-clear`,
                }
              : undefined
          }
          testID={`${props.testID}-sheet`}>
          {picker}
        </PickerSheet>
      ) : (
        // Android shows its own date dialog and closes on a pick or dismissal.
        picker
      )}
    </>
  );
}

/**
 * Formats a moment in the given language. The year is added only when it is not the current year,
 * matching the log list and detail.
 */
export function formatDateTimeParts(value: Date, locale: string, now: Date = new Date()): { date: string; time: string } {
  const date = new Intl.DateTimeFormat(locale, {
    ...(value.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(value);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(value);

  return { date, time };
}

function clampDate(value: Date, minimumDate?: Date, maximumDate?: Date): Date {
  if (maximumDate && value.getTime() > maximumDate.getTime()) {
    return maximumDate;
  }
  if (minimumDate && value.getTime() < minimumDate.getTime()) {
    return minimumDate;
  }
  return value;
}
