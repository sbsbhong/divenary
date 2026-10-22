import React from 'react';
import { SelectorPill } from '../../../components/ui/instrument';
import { HStack } from '../../../components/ui/hstack';
import type { DivePressureUnit, DivePressureValues } from '../../../types/dive-log-entry';
import { FieldRow } from './field-row';
import { NumberValueField } from './value-picker-field';

type PressureFieldErrors = {
  unit?: string;
  start?: string;
  end?: string;
};

type PressureValueRowsProps = {
  unit?: DivePressureUnit;
  start?: number;
  end?: number;
  onChange: (value: DivePressureValues) => void;
  errors?: PressureFieldErrors;
  testIDPrefix: string;
  labels: {
    unit: string;
    start: string;
    end: string;
  };
  /** False drops the gap above the unit row, for the first row of a group. */
  separated?: boolean;
};

/**
 * Pressure as grouped rows: a bar/psi selector and two value rows that open a wheel sheet. The
 * values are log metadata only. There are no quick chips, so no number reads like a suggested
 * reserve or turn pressure; the start wheel opens at a common fill pressure and the end wheel at
 * the start value.
 */
export function PressureValueRows(props: PressureValueRowsProps): React.JSX.Element {
  const unit = props.unit ?? 'bar';
  const range = getPressureRange(unit);
  const typicalStart = unit === 'psi' ? 3000 : 200;

  const update = React.useCallback(
    (nextValue: Partial<DivePressureValues>) => {
      props.onChange({ unit, start: props.start, end: props.end, ...nextValue });
    },
    [props, unit],
  );

  return (
    <>
      <FieldRow
        label={props.labels.unit}
        layout="inline"
        separated={props.separated}
        error={props.errors?.unit}
        errorTestID={`${props.testIDPrefix}-unit-error`}
      >
        <HStack space="xs" className="w-40 rounded-full bg-muted p-1">
          {(['bar', 'psi'] as const).map(nextUnit => (
            <SelectorPill
              key={nextUnit}
              testID={`${props.testIDPrefix}-unit-${nextUnit}`}
              className="flex-1"
              label={nextUnit}
              selected={unit === nextUnit}
              onPress={() => update({ unit: nextUnit })}
            />
          ))}
        </HStack>
      </FieldRow>
      <NumberValueField
        label={props.labels.start}
        value={props.start}
        onChange={value => update({ start: value })}
        min={range.min}
        max={range.max}
        step={range.step}
        unitLabel={unit}
        valueType="int"
        startValue={typicalStart}
        error={props.errors?.start}
        testID={`${props.testIDPrefix}-start`}
      />
      <NumberValueField
        label={props.labels.end}
        value={props.end}
        onChange={value => update({ end: value })}
        min={range.min}
        max={range.max}
        step={range.step}
        unitLabel={unit}
        valueType="int"
        startValue={props.start ?? typicalStart}
        error={props.errors?.end}
        testID={`${props.testIDPrefix}-end`}
      />
    </>
  );
}

function getPressureRange(unit: DivePressureUnit): { min: number; max: number; step: number } {
  return unit === 'psi' ? { min: 0, max: 4500, step: 50 } : { min: 0, max: 300, step: 1 };
}
