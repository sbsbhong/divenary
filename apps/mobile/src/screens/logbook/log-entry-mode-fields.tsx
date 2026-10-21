import React from 'react';
import type { Control, FieldErrors } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { SelectorPill } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import { Input, InputField } from '../../components/ui/input';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { BadgeListField } from '../common/form/badge-list-field';
import { EditorField } from '../common/form/editor-field';
import { FixedOptionField } from '../common/form/fixed-option-field';
import { NumericSliderField } from '../common/form/numeric-slider-field';
import { PressureFields } from '../common/form/pressure-fields';
import { StarRatingField } from '../common/form/star-rating-field';
import type { LogEntryFormValues } from './log-entry-form-schema';

type ModeSpecificFieldsProps = {
  control: Control<LogEntryFormValues>;
  errors: FieldErrors<LogEntryFormValues>;
  diveMode: LogEntryFormValues['diveMode'];
};

const waterConditionOptions: NonNullable<LogEntryFormValues['waterCondition']>[] = ['calm', 'mild', 'choppy', 'surge', 'current', 'unknown'];

export function ModeSpecificFields(props: ModeSpecificFieldsProps): React.JSX.Element | null {
  const { t } = useTranslation();

  if (props.diveMode === 'scuba') {
    return (
      <ModeSection title={t('logbook.scubaSection')}>
        <FixedOptionField label={t('logbook.gasLabel')} value={t('logbook.airGas', { defaultValue: 'Air' })} testID="log-entry-editor-gas-label-air" />
        <Controller
          control={props.control}
          name="gearIds"
          render={({ field }) => (
            <BadgeListField
              label={t('logbook.gear')}
              values={field.value}
              onChange={field.onChange}
              inputTestID="log-entry-editor-gear"
              badgeTestIDPrefix="log-entry-editor-gear"
              placeholder={t('logbook.commaSeparatedPlaceholder')}
            />
          )}
        />
        <Controller
          control={props.control}
          name="waterCondition"
          render={({ field }) => (
            <WaterConditionPicker value={field.value} onChange={field.onChange} />
          )}
        />
        <Controller
          control={props.control}
          name="visibilityRating"
          render={({ field }) => (
            <StarRatingField
              label={t('logbook.visibilityRating')}
              value={field.value}
              onChange={field.onChange}
              error={props.errors.visibilityRating?.message}
              testID="log-entry-editor-visibility-rating"
            />
          )}
        />
        <Controller
          control={props.control}
          name="perceivedExertion"
          render={({ field }) => (
            <StarRatingField
              label={t('logbook.perceivedExertion')}
              value={field.value}
              onChange={field.onChange}
              error={props.errors.perceivedExertion?.message}
              testID="log-entry-editor-perceived-exertion"
            />
          )}
        />
        <Controller
          control={props.control}
          name="pressure"
          render={({ field }) => (
            <PressureFields
              unit={field.value.unit}
              start={field.value.start}
              end={field.value.end}
              onChange={field.onChange}
              errors={{
                unit: props.errors.pressure?.unit?.message,
                start: props.errors.pressure?.start?.message,
                end: props.errors.pressure?.end?.message,
              }}
              testIDPrefix="log-entry-editor-pressure"
              labels={{
                unit: t('logbook.pressureUnit', { defaultValue: 'Pressure unit' }),
                start: t('logbook.startPressure', { defaultValue: 'Start pressure' }),
                end: t('logbook.endPressure', { defaultValue: 'End pressure' }),
              }}
            />
          )}
        />
      </ModeSection>
    );
  }

  if (props.diveMode === 'freedive') {
    return (
      <ModeSection title={t('logbook.freediveSection')}>
        <HStack space="md">
          <Controller
            control={props.control}
            name="repetitionCount"
            render={({ field }) => (
              <NumericSliderField
                className="flex-1"
                label={t('logbook.repetitionCount')}
                value={field.value}
                onChange={field.onChange}
                min={0}
                max={200}
                step={1}
                valueType="int"
                error={props.errors.repetitionCount?.message}
                testID="log-entry-editor-repetition-count"
                placeholder="8"
              />
            )}
          />
          <Controller
            control={props.control}
            name="perceivedExertion"
            render={({ field }) => (
              <StarRatingField
                label={t('logbook.perceivedExertion')}
                value={field.value}
                onChange={field.onChange}
                error={props.errors.perceivedExertion?.message}
                testID="log-entry-editor-perceived-exertion"
              />
            )}
          />
        </HStack>
        <Controller
          control={props.control}
          name="trainingFocus"
          render={({ field }) => (
            <EditorField label={t('logbook.trainingFocus')} error={props.errors.trainingFocus?.message}>
              <Input className="h-11 rounded-xl bg-background">
                <InputField
                  testID="log-entry-editor-training-focus"
                  value={field.value ?? ''}
                  onChangeText={field.onChange}
                  placeholder={t('logbook.trainingFocusPlaceholder')}
                />
              </Input>
            </EditorField>
          )}
        />
      </ModeSection>
    );
  }

  return null;
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
  value: LogEntryFormValues['waterCondition'];
  onChange: (value: LogEntryFormValues['waterCondition']) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <EditorField label={t('logbook.waterCondition')}>
      <VStack space="xs">
        <HStack space="xs">
          {waterConditionOptions.slice(0, 3).map(condition => (
            <SelectorPill
              key={condition}
              testID={`log-entry-editor-water-condition-${condition}`}
              className="flex-1"
              label={t(`waterConditions.${condition}`)}
              selected={props.value === condition}
              onPress={() => props.onChange(condition)}
            />
          ))}
        </HStack>
        <HStack space="xs">
          {waterConditionOptions.slice(3).map(condition => (
            <SelectorPill
              key={condition}
              testID={`log-entry-editor-water-condition-${condition}`}
              className="flex-1"
              label={t(`waterConditions.${condition}`)}
              selected={props.value === condition}
              onPress={() => props.onChange(condition)}
            />
          ))}
        </HStack>
      </VStack>
    </EditorField>
  );
}
