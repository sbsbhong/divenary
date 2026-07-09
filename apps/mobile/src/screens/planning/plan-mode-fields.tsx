import React from 'react';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { SelectorPill } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import { Input, InputField } from '../../components/ui/input';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { WatchSession } from '../../types/dive-session';
import { DepthWheelField } from '../common/form/compound-number-wheel-fields';
import { EditorField } from '../common/form/editor-field';
import { FixedOptionField } from '../common/form/fixed-option-field';
import { NumericSliderField } from '../common/form/numeric-slider-field';
import { PressureFields } from '../common/form/pressure-fields';
import { StarRatingField } from '../common/form/star-rating-field';
import type { PlanFormValues } from './plan-form-schema';
import { SUPPORTED_WATCH_DEPTH_LIMIT_METERS } from '../../utils/unsupported-depth';

type PlanModeFieldsProps = {
  control: Control<PlanFormValues>;
  errors: FieldErrors<PlanFormValues>;
  diveMode: NonNullable<WatchSession['diveMode']>;
};

const waterConditionOptions: NonNullable<WatchSession['waterCondition']>[] = ['calm', 'mild', 'choppy', 'surge', 'current', 'unknown'];

export function PlanModeFields(props: PlanModeFieldsProps): React.JSX.Element {
  const { t } = useTranslation();
  const pressureErrors = props.errors.plannedPressure as
    | {
        unit?: { message?: string };
        start?: { message?: string };
        end?: { message?: string };
      }
    | undefined;

  return (
    <ModeSection title={t(`planning.${props.diveMode}Section`, { defaultValue: `${props.diveMode} plan details` })}>
      <HStack space="md">
        <Controller
          control={props.control}
          name="plannedMaxDepthMeters"
          render={({ field }) => (
            <VStack space="xs" className="flex-1">
              <DepthWheelField
                label={t('planning.plannedMaxDepthMeters', { defaultValue: 'Planned max (m)' })}
                valueMeters={field.value}
                onChange={field.onChange}
                maxMeters={60}
                required
                error={props.errors.plannedMaxDepthMeters?.message}
                testID="planning-editor-planned-max-depth"
              />
              {field.value !== undefined && field.value > SUPPORTED_WATCH_DEPTH_LIMIT_METERS ? (
                <Text
                  testID="planning-editor-unsupported-depth-warning"
                  className="rounded-xl bg-muted px-3 py-2 text-xs font-semibold leading-4 text-muted-foreground">
                  {t('planning.unsupportedDepthWarning')}
                </Text>
              ) : null}
            </VStack>
          )}
        />
        <Controller
          control={props.control}
          name="plannedDurationMinutes"
          render={({ field }) => (
            <NumericSliderField
              className="flex-1"
              label={t('planning.durationMinutesShort', { defaultValue: 'Duration (min)' })}
              labelTestID="planning-editor-planned-duration-label"
              value={field.value}
              onChange={field.onChange}
              min={0}
              max={240}
              step={1}
              unitLabel="min"
              valueType="int"
              required
              error={props.errors.plannedDurationMinutes?.message}
              testID="planning-editor-planned-duration"
              placeholder="45"
            />
          )}
        />
      </HStack>
      {props.diveMode === 'scuba' ? (
        <>
          <FixedOptionField label={t('planning.gasLabel', { defaultValue: 'Gas label' })} value={t('logbook.airGas', { defaultValue: 'Air' })} testID="planning-editor-gas-label-air" />
          <Controller
            control={props.control}
            name="plannedPressure"
            render={({ field }) => (
              <PressureFields
                unit={field.value.unit}
                start={field.value.start}
                end={field.value.end}
                onChange={field.onChange}
                errors={{
                  unit: pressureErrors?.unit?.message,
                  start: pressureErrors?.start?.message,
                  end: pressureErrors?.end?.message,
                }}
                testIDPrefix="planning-editor-pressure"
                labels={{
                  unit: t('planning.pressureUnit', { defaultValue: 'Pressure unit' }),
                  start: t('planning.startPressure', { defaultValue: 'Start pressure' }),
                  end: t('planning.endPressure', { defaultValue: 'End pressure' }),
                }}
              />
            )}
          />
        </>
      ) : null}
      {props.diveMode === 'freedive' ? (
        <Controller
          control={props.control}
          name="repetitionTarget"
          render={({ field }) => (
            <NumericSliderField
              label={t('planning.repetitionTarget', { defaultValue: 'Repetition target' })}
              value={field.value}
              onChange={field.onChange}
              min={0}
              max={200}
              step={1}
              valueType="int"
              error={props.errors.repetitionTarget?.message}
              testID="planning-editor-repetition-target"
              placeholder="8"
            />
          )}
        />
      ) : null}
      <Controller
        control={props.control}
        name="waterCondition"
        render={({ field }) => <WaterConditionPicker value={field.value} onChange={field.onChange} />}
      />
      <Controller
        control={props.control}
        name="visibilityExpectation"
        render={({ field }) => (
          <StarRatingField
            label={t('planning.visibilityExpectation', { defaultValue: 'Visibility expectation' })}
            value={field.value}
            onChange={field.onChange}
            error={props.errors.visibilityExpectation?.message}
            testID="planning-editor-visibility-expectation"
          />
        )}
      />
      <Controller
        control={props.control}
        name="perceivedDifficulty"
        render={({ field }) => (
          <StarRatingField
            label={t('planning.perceivedDifficulty', { defaultValue: 'Difficulty' })}
            value={field.value}
            onChange={field.onChange}
            error={props.errors.perceivedDifficulty?.message}
            testID="planning-editor-perceived-difficulty"
          />
        )}
      />
      <Controller
        control={props.control}
        name="trainingFocus"
        render={({ field }) => (
          <EditorField label={t('planning.trainingFocus', { defaultValue: 'Training focus' })} error={props.errors.trainingFocus?.message}>
            <Input className="h-11 rounded-xl bg-background">
              <InputField
                testID="planning-editor-training-focus"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                placeholder={t('planning.trainingFocusPlaceholder', { defaultValue: 'e.g. buoyancy check' })}
              />
            </Input>
          </EditorField>
        )}
      />
    </ModeSection>
  );
}

function ModeSection(props: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <VStack space="sm" className="rounded-2xl border border-border bg-card px-4 py-4">
      <HStack className="items-center justify-between">
        <Text className="text-xs font-semibold uppercase text-primary">{props.title}</Text>
      </HStack>
      {props.children}
    </VStack>
  );
}

function WaterConditionPicker(props: {
  value: WatchSession['waterCondition'];
  onChange: (value: WatchSession['waterCondition']) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <EditorField
      label={t('planning.expectedWaterCondition', { defaultValue: 'Expected water condition' })}
      labelTestID="planning-editor-water-condition-label"
    >
      <HStack space="xs" className="flex-wrap">
        {waterConditionOptions.map(condition => (
          <SelectorPill
            key={condition}
            testID={`planning-editor-water-condition-${condition}`}
            className="min-w-24 flex-1"
            label={condition}
            selected={props.value === condition}
            onPress={() => props.onChange(props.value === condition ? undefined : condition)}
          />
        ))}
      </HStack>
    </EditorField>
  );
}
