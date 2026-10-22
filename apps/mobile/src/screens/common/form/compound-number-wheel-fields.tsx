import React from 'react';
import { useTranslation } from 'react-i18next';
import { MultiColumnNumberWheelPicker } from '../../../components/ui/multi-column-number-wheel-picker';
import { EditorField } from './editor-field';

type CompoundFieldBaseProps = {
  label: string;
  required?: boolean;
  error?: string;
  testID: string;
  className?: string;
  disabled?: boolean;
  pickerHeight?: number;
};

type CompoundPickerBaseProps = {
  testID: string;
  disabled?: boolean;
  pickerHeight?: number;
};

export type DurationWheelPickerProps = CompoundPickerBaseProps & {
  valueSeconds?: number;
  maxSeconds: number;
  onChange: (value: number | undefined) => void;
};

export type DepthWheelPickerProps = CompoundPickerBaseProps & {
  valueMeters?: number;
  maxMeters: number;
  onChange: (value: number | undefined) => void;
};

export type DurationWheelFieldProps = CompoundFieldBaseProps & DurationWheelPickerProps;

export type DepthWheelFieldProps = CompoundFieldBaseProps & DepthWheelPickerProps;

export function splitDurationSeconds(valueSeconds: number | undefined, maxSeconds: number): { minutes: number; seconds: number } {
  const normalized = clampInteger(valueSeconds ?? 0, 0, maxSeconds);
  return {
    minutes: Math.floor(normalized / 60),
    seconds: normalized % 60,
  };
}

export function mergeDurationParts(minutes: number, seconds: number, maxSeconds: number): number {
  return clampInteger(minutes * 60 + seconds, 0, maxSeconds);
}

export function parseDurationDraft(value: string, maxSeconds: number): number | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.length) {
    return undefined;
  }

  const colonMatch = /^(\d+)\s*:\s*(\d{1,2})$/.exec(trimmed);
  if (colonMatch) {
    const minutes = Number(colonMatch[1]);
    const seconds = Number(colonMatch[2]);
    return seconds > 59 ? undefined : mergeDurationParts(minutes, seconds, maxSeconds);
  }

  const compact = trimmed.replace(/\s+/g, '');
  const unitMatch = /^(\d+)(?:m|min)(?:(\d{1,2})(?:s|sec))?$/.exec(compact);
  if (unitMatch) {
    const minutes = Number(unitMatch[1]);
    const seconds = unitMatch[2] === undefined ? 0 : Number(unitMatch[2]);
    return seconds > 59 ? undefined : mergeDurationParts(minutes, seconds, maxSeconds);
  }

  const secondsMatch = /^\d+$/.exec(compact);
  if (secondsMatch) {
    return clampInteger(Number(compact), 0, maxSeconds);
  }

  return undefined;
}

export function normalizeDurationDraft(value: string): string {
  return value.replace(',', ':').replace(/[^\d:msinec\s]/gi, '');
}

export function formatDurationDraft(valueSeconds: number | undefined, maxSeconds: number): string {
  const { minutes, seconds } = splitDurationSeconds(valueSeconds, maxSeconds);
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}

export function splitDepthMeters(valueMeters: number | undefined, maxMeters: number): { meters: number; tenths: number } {
  const normalizedTenths = Math.round(clampNumber(valueMeters ?? 0, 0, maxMeters) * 10);
  return {
    meters: Math.floor(normalizedTenths / 10),
    tenths: normalizedTenths % 10,
  };
}

export function mergeDepthParts(meters: number, tenths: number, maxMeters: number): number {
  return Number(clampNumber(meters + tenths / 10, 0, maxMeters).toFixed(1));
}

export function parseDepthDraft(value: string, maxMeters: number): number | undefined {
  const normalized = value.trim().replace(',', '.').replace(/[^\d.]/g, '');
  if (!normalized.length || normalized === '.') {
    return undefined;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Number(clampNumber(Math.round(parsed * 10) / 10, 0, maxMeters).toFixed(1));
}

export function normalizeDepthDraft(value: string): string {
  const normalized = value.replace(',', '.').replace(/[^\d.]/g, '');
  const [wholePart, ...decimalParts] = normalized.split('.');
  return decimalParts.length === 0 ? wholePart : `${wholePart}.${decimalParts.join('').slice(0, 1)}`;
}

export function DurationWheelField(props: DurationWheelFieldProps): React.JSX.Element {
  return (
    <EditorField
      label={props.label}
      required={props.required}
      error={props.error}
      errorTestID={`${props.testID}-error`}
      className={props.className}
    >
      <DurationWheelPicker
        valueSeconds={props.valueSeconds}
        maxSeconds={props.maxSeconds}
        onChange={props.onChange}
        disabled={props.disabled}
        pickerHeight={props.pickerHeight}
        testID={props.testID}
      />
    </EditorField>
  );
}

/** The minutes/seconds wheel alone, for a picker sheet or a field wrapper. */
export function DurationWheelPicker(props: DurationWheelPickerProps): React.JSX.Element {
  const { t } = useTranslation();
  const { minutes, seconds } = splitDurationSeconds(props.valueSeconds, props.maxSeconds);
  const maxMinutes = Math.floor(props.maxSeconds / 60);
  const maxSecondsForMinute = minutes >= maxMinutes ? props.maxSeconds % 60 : 59;

  const commit = React.useCallback(
    (draft: string) => {
      const parsedValue = parseDurationDraft(draft, props.maxSeconds);
      if (parsedValue === undefined) {
        return false;
      }

      props.onChange(parsedValue);
      return true;
    },
    [props],
  );

  return (
    <MultiColumnNumberWheelPicker
      columns={[
        { id: 'minutes', value: minutes, min: 0, max: maxMinutes, step: 1, unitLabel: t('units.minutesShort') },
        {
          id: 'seconds',
          value: Math.min(seconds, maxSecondsForMinute),
          min: 0,
          max: maxSecondsForMinute,
          step: 1,
          unitLabel: t('units.secondsShort'),
          padStart: 2,
        },
      ]}
      onColumnChange={(columnId, value) => {
        if (columnId === 'minutes') {
          const nextMaxSeconds = value >= maxMinutes ? props.maxSeconds % 60 : 59;
          props.onChange(mergeDurationParts(value, Math.min(seconds, nextMaxSeconds), props.maxSeconds));
          return;
        }

        props.onChange(mergeDurationParts(minutes, value, props.maxSeconds));
      }}
      directInput={{
        value: formatDurationDraft(props.valueSeconds, props.maxSeconds),
        normalize: normalizeDurationDraft,
        onCommit: commit,
        keyboardType: 'numbers-and-punctuation',
        accessibilityLabel: t('wheelPicker.enterDuration'),
      }}
      height={props.pickerHeight}
      disabled={props.disabled}
      testID={props.testID}
    />
  );
}

export function DepthWheelField(props: DepthWheelFieldProps): React.JSX.Element {
  return (
    <EditorField
      label={props.label}
      required={props.required}
      error={props.error}
      errorTestID={`${props.testID}-error`}
      className={props.className}
    >
      <DepthWheelPicker
        valueMeters={props.valueMeters}
        maxMeters={props.maxMeters}
        onChange={props.onChange}
        disabled={props.disabled}
        pickerHeight={props.pickerHeight}
        testID={props.testID}
      />
    </EditorField>
  );
}

/** The meters/tenths wheel alone, for a picker sheet or a field wrapper. */
export function DepthWheelPicker(props: DepthWheelPickerProps): React.JSX.Element {
  const { t } = useTranslation();
  const { meters, tenths } = splitDepthMeters(props.valueMeters, props.maxMeters);
  const maxMetersInteger = Math.floor(props.maxMeters);
  const maxTenthsForMeter = meters >= maxMetersInteger ? Math.round((props.maxMeters - maxMetersInteger) * 10) : 9;

  const commit = React.useCallback(
    (draft: string) => {
      const parsedValue = parseDepthDraft(draft, props.maxMeters);
      if (parsedValue === undefined) {
        return false;
      }

      props.onChange(parsedValue);
      return true;
    },
    [props],
  );

  return (
    <MultiColumnNumberWheelPicker
      columns={[
        { id: 'meters', value: meters, min: 0, max: maxMetersInteger, step: 1, width: 54 },
        {
          id: 'tenths',
          value: Math.min(tenths, maxTenthsForMeter),
          min: 0,
          max: maxTenthsForMeter,
          step: 1,
          width: 44,
          formatValue: value => `.${value}`,
        },
        { id: 'unit', fixedLabel: 'm', width: 22 },
      ]}
      onColumnChange={(columnId, value) => {
        if (columnId === 'meters') {
          const nextMaxTenths = value >= maxMetersInteger ? Math.round((props.maxMeters - maxMetersInteger) * 10) : 9;
          props.onChange(mergeDepthParts(value, Math.min(tenths, nextMaxTenths), props.maxMeters));
          return;
        }

        props.onChange(mergeDepthParts(meters, value, props.maxMeters));
      }}
      directInput={{
        value: props.valueMeters === undefined ? '0.0' : props.valueMeters.toFixed(1),
        normalize: normalizeDepthDraft,
        onCommit: commit,
        keyboardType: 'decimal-pad',
        accessibilityLabel: t('wheelPicker.enterDepth'),
      }}
      height={props.pickerHeight}
      disabled={props.disabled}
      testID={props.testID}
    />
  );
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
