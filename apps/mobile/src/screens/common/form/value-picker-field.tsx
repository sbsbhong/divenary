import React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HStack } from '../../../components/ui/hstack';
import { NumberWheelPicker } from '../../../components/ui/number-wheel-picker';
import { PickerSheet } from '../../../components/ui/picker-sheet';
import { PressScalePressable } from '../../../components/ui/press-scale';
import { Text } from '../../../components/ui/text';
import { clamp, formatNumber, roundToStep } from '../../../components/ui/wheel-picker-core';
import { DepthWheelPicker, DurationWheelPicker, formatDurationDraft } from './compound-number-wheel-fields';
import { ValueRow } from './value-row';

/** Props every value row field shares. The value itself and its picker differ per field. */
export type ValueFieldBaseProps = {
  label: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  /** False hides the clear (x) action. Clearing sets the value back to unknown, not 0. */
  clearable?: boolean;
  /** A low-chroma marker after the label. */
  badge?: string;
  /** Context under the row inside the same group, such as an unsupported-depth note. */
  footer?: React.ReactNode;
  /** False drops the gap above the row, for the first row of a group. */
  separated?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  /**
   * Row: `-anchor`, `-trigger`, `-row-value`, `-error`. Sheet: `-sheet`, `-chip-<value>`, `-clear`,
   * `-done`. The wheel inside the sheet uses the bare ID, so `-input-trigger` and `-input` keep
   * working for direct entry once the sheet is open.
   */
  testID: string;
};

type QuickValue = { key: string; label: string; value: number };

type ValuePickerFieldProps = ValueFieldBaseProps & {
  value?: number;
  onChange: (value: number | undefined) => void;
  /** Where the wheel stands while the value is unknown. Done saves it; closing the sheet does not. */
  startValue: number;
  formattedValue?: string;
  spokenValue?: string;
  emptyText: string;
  quickValues: QuickValue[];
  renderPicker: (pickerValue: number) => React.ReactNode;
};

/**
 * The shared value row + picker sheet. Wheel and direct entry save as they change, a quick value
 * saves and closes, clear saves "unknown" and closes, and Done saves what the wheel shows.
 */
function ValuePickerField(props: ValuePickerFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const { onChange, startValue, value } = props;
  const pickerValue = value ?? startValue;
  const close = React.useCallback(() => setIsOpen(false), []);
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
  const pickQuickValue = React.useCallback(
    (nextValue: number) => {
      onChange(nextValue);
      setIsOpen(false);
    },
    [onChange],
  );
  const canClear = props.clearable !== false && value !== undefined;

  return (
    <>
      <ValueRow
        label={props.label}
        value={value === undefined ? undefined : props.formattedValue}
        spokenValue={value === undefined ? undefined : props.spokenValue}
        emptyText={props.emptyText}
        onPress={() => setIsOpen(true)}
        expanded={isOpen}
        required={props.required}
        error={props.error}
        badge={props.badge}
        footer={props.footer}
        disabled={props.disabled}
        separated={props.separated}
        onLayout={props.onLayout}
        testID={props.testID}
      />
      <PickerSheet
        isOpen={isOpen}
        onClose={close}
        title={props.label}
        done={{ label: t('form.done'), onPress: finish, testID: `${props.testID}-done` }}
        clear={
          canClear
            ? {
                label: t('form.clear'),
                accessibilityLabel: t('form.clearValue', { label: props.label }),
                onPress: clear,
                testID: `${props.testID}-clear`,
              }
            : undefined
        }
        testID={`${props.testID}-sheet`}>
        {props.quickValues.length ? (
          <QuickValueChips
            values={props.quickValues}
            selectedValue={value}
            onPick={pickQuickValue}
            testID={props.testID}
          />
        ) : null}
        {props.renderPicker(pickerValue)}
        <Text className="text-center text-xs leading-4 text-muted-foreground">{t('form.typeNumberHint')}</Text>
      </PickerSheet>
    </>
  );
}

function QuickValueChips(props: {
  values: QuickValue[];
  selectedValue?: number;
  onPick: (value: number) => void;
  testID: string;
}): React.JSX.Element {
  return (
    <HStack space="sm" className="flex-wrap">
      {props.values.map(chip => {
        const selected = props.selectedValue === chip.value;

        return (
          <PressScalePressable
            kind="control"
            key={chip.key}
            testID={`${props.testID}-chip-${chip.key}`}
            accessibilityRole="button"
            accessibilityLabel={chip.label}
            accessibilityState={{ selected }}
            onPress={() => props.onPick(chip.value)}
            className={`min-h-11 justify-center rounded-full px-4 ${selected ? 'bg-primary/10' : 'bg-card'}`}>
            <Text className={selected ? 'text-base font-semibold text-primary' : 'text-base text-foreground'}>{chip.label}</Text>
          </PressScalePressable>
        );
      })}
    </HStack>
  );
}

export type NumberValueFieldProps = ValueFieldBaseProps & {
  value?: number;
  onChange: (value: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
  valueType?: 'int' | 'float';
  unitLabel?: string;
  /** Where the wheel starts while the value is unknown (defaults to `min`). Nothing is saved until the user picks. */
  startValue?: number;
  /** Common values offered as chips above the wheel. */
  quickValues?: number[];
  /** Row and chip text. Defaults to the number and the unit, for example `200 bar`. */
  formatValue?: (value: number) => string;
  /** Defaults to `-- <unit>`, or `--` without a unit. */
  emptyText?: string;
};

/** A single-wheel number, such as pressure, a repetition count or a planned duration in minutes. */
export function NumberValueField(props: NumberValueFieldProps): React.JSX.Element {
  const step = props.step ?? 1;
  const format =
    props.formatValue ??
    ((value: number) => (props.unitLabel ? `${formatNumber(value, step)} ${props.unitLabel}` : formatNumber(value, step)));
  const startValue = clamp(roundToStep(props.startValue ?? props.min, step), props.min, props.max);
  const quickValues = (props.quickValues ?? [])
    .filter(value => value >= props.min && value <= props.max)
    .map(value => ({ key: formatNumber(value, step), label: format(value), value }));

  return (
    <ValuePickerField
      {...props}
      startValue={startValue}
      formattedValue={props.value === undefined ? undefined : format(props.value)}
      emptyText={props.emptyText ?? (props.unitLabel ? `-- ${props.unitLabel}` : '--')}
      quickValues={quickValues}
      renderPicker={pickerValue => (
        <NumberWheelPicker
          value={pickerValue}
          min={props.min}
          max={props.max}
          step={step}
          unitLabel={props.unitLabel}
          valueType={props.valueType}
          onChange={props.onChange}
          testID={props.testID}
        />
      )}
    />
  );
}

export type DurationValueFieldProps = ValueFieldBaseProps & {
  valueSeconds?: number;
  maxSeconds: number;
  onChange: (value: number | undefined) => void;
  /** Where the wheel starts while the duration is unknown. Defaults to 45 minutes. */
  startSeconds?: number;
  /** Chips in minutes. Defaults to 30, 45 and 60. */
  quickMinutes?: number[];
  /** Defaults to `--:--`. */
  emptyText?: string;
};

const DEFAULT_START_SECONDS = 45 * 60;
const DEFAULT_QUICK_MINUTES = [30, 45, 60];

/** A dive duration shown as `47:00` and picked on a minutes/seconds wheel. */
export function DurationValueField(props: DurationValueFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const startValue = Math.min(props.startSeconds ?? DEFAULT_START_SECONDS, props.maxSeconds);
  const spokenDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder === 0
      ? t('form.durationMinutes', { minutes })
      : t('form.durationMinutesSeconds', { minutes, seconds: remainder });
  };
  const quickValues = (props.quickMinutes ?? DEFAULT_QUICK_MINUTES)
    .filter(minutes => minutes * 60 <= props.maxSeconds)
    .map(minutes => ({ key: `${minutes}`, label: t('form.durationMinutes', { minutes }), value: minutes * 60 }));

  return (
    <ValuePickerField
      {...props}
      value={props.valueSeconds}
      startValue={startValue}
      formattedValue={props.valueSeconds === undefined ? undefined : formatDurationDraft(props.valueSeconds, props.maxSeconds)}
      spokenValue={props.valueSeconds === undefined ? undefined : spokenDuration(props.valueSeconds)}
      emptyText={props.emptyText ?? '--:--'}
      quickValues={quickValues}
      renderPicker={pickerValue => (
        <DurationWheelPicker
          valueSeconds={pickerValue}
          maxSeconds={props.maxSeconds}
          onChange={props.onChange}
          testID={props.testID}
        />
      )}
    />
  );
}

export type DepthValueFieldProps = ValueFieldBaseProps & {
  valueMeters?: number;
  maxMeters: number;
  onChange: (value: number | undefined) => void;
  /** Where the wheel starts while the depth is unknown. Defaults to 18 m. */
  startMeters?: number;
  /** Chips in meters. Defaults to 5, 10, 18 and 30. */
  quickMeters?: number[];
  /** Defaults to `-- m`. */
  emptyText?: string;
};

const DEFAULT_START_METERS = 18;
const DEFAULT_QUICK_METERS = [5, 10, 18, 30];

/** A depth shown to one decimal (`18.6 m`) and picked on a meters/tenths wheel. */
export function DepthValueField(props: DepthValueFieldProps): React.JSX.Element {
  const startValue = Math.min(props.startMeters ?? DEFAULT_START_METERS, props.maxMeters);
  const quickValues = (props.quickMeters ?? DEFAULT_QUICK_METERS)
    .filter(meters => meters <= props.maxMeters)
    .map(meters => ({ key: `${meters}`, label: `${meters} m`, value: meters }));

  return (
    <ValuePickerField
      {...props}
      value={props.valueMeters}
      startValue={startValue}
      formattedValue={props.valueMeters === undefined ? undefined : `${props.valueMeters.toFixed(1)} m`}
      emptyText={props.emptyText ?? '-- m'}
      quickValues={quickValues}
      renderPicker={pickerValue => (
        <DepthWheelPicker
          valueMeters={pickerValue}
          maxMeters={props.maxMeters}
          onChange={props.onChange}
          testID={props.testID}
        />
      )}
    />
  );
}
