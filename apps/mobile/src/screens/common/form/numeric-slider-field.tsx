import React from 'react';
import { NumberWheelPicker } from '../../../components/ui/number-wheel-picker';
import { EditorField } from './editor-field';

type NumericSliderFieldProps = {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  min: number;
  max: number;
  step: number;
  required?: boolean;
  error?: string;
  testID: string;
  placeholder?: string;
  className?: string;
  labelTestID?: string;
  unitLabel?: string;
  valueType?: 'int' | 'float';
  disabled?: boolean;
  pickerHeight?: number;
};

export function NumericSliderField(props: NumericSliderFieldProps): React.JSX.Element {
  const selectedValue = props.value === undefined ? props.min : props.value;
  const valueType = props.valueType ?? (props.step % 1 === 0 ? 'int' : 'float');

  return (
    <EditorField
      label={props.label}
      required={props.required}
      error={props.error}
      errorTestID={`${props.testID}-error`}
      labelTestID={props.labelTestID}
      className={props.className}
    >
      <NumberWheelPicker
        value={selectedValue}
        min={props.min}
        max={props.max}
        step={props.step}
        unitLabel={props.unitLabel}
        valueType={valueType}
        disabled={props.disabled}
        height={props.pickerHeight}
        onChange={props.onChange}
        testID={props.testID}
      />
    </EditorField>
  );
}
