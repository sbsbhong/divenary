import React from 'react';
import type { Control, FieldErrors } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Section } from '../../components/ui/grouped-list';
import { SelectorPill } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import { Input, InputField } from '../../components/ui/input';
import type { DiveEntryStyle } from '../../types/dive-plan';
import { BadgeListInput, type BadgeListFieldHandle } from '../common/form/badge-list-field';
import { FieldRow } from '../common/form/field-row';
import { PressureValueRows } from '../common/form/pressure-fields';
import { StarRatingControl } from '../common/form/star-rating-field';
import { NumberValueField } from '../common/form/value-picker-field';
import { ValueRow } from '../common/form/value-row';
import { WaterConditionControl } from '../common/form/water-condition-field';
import type { LogEntryFormValues } from './log-entry-form-schema';

export type LogEntryBadgeRefs = {
  buddies: React.RefObject<BadgeListFieldHandle | null>;
  tags: React.RefObject<BadgeListFieldHandle | null>;
  observedMarineLife: React.RefObject<BadgeListFieldHandle | null>;
  gearIds: React.RefObject<BadgeListFieldHandle | null>;
};

type LogEntryDetailFieldsProps = {
  control: Control<LogEntryFormValues>;
  errors: FieldErrors<LogEntryFormValues>;
  diveMode: LogEntryFormValues['diveMode'];
  badgeRefs: LogEntryBadgeRefs;
  buddySuggestions?: string[];
};

const entryStyles: DiveEntryStyle[] = ['shore', 'boat', 'pool'];

/**
 * The optional fields inside the editor's collapsed "세부 정보" section: conditions, the
 * mode-specific group, and the people and tags group. Pressure is log metadata only.
 */
export function LogEntryDetailFields(props: LogEntryDetailFieldsProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      <Section title={t('logbook.sectionConditions')}>
        <Controller
          control={props.control}
          name="entryStyle"
          render={({ field }) => (
            <FieldRow label={t('logbook.entryStyle')} layout="stacked" separated={false}>
              <HStack space="xs" className="rounded-full bg-muted p-1">
                {entryStyles.map(entryStyle => (
                  <SelectorPill
                    key={entryStyle}
                    testID={`log-entry-editor-entry-style-${entryStyle}`}
                    className="flex-1"
                    label={t(`entryStyles.${entryStyle}`)}
                    selected={field.value === entryStyle}
                    onPress={() => field.onChange(field.value === entryStyle ? undefined : entryStyle)}
                  />
                ))}
              </HStack>
            </FieldRow>
          )}
        />
        {props.diveMode === 'scuba' ? (
          <Controller
            control={props.control}
            name="waterCondition"
            render={({ field }) => (
              <FieldRow label={t('logbook.waterCondition')} layout="stacked">
                <WaterConditionControl
                  value={field.value}
                  onChange={field.onChange}
                  testIDPrefix="log-entry-editor-water-condition"
                />
              </FieldRow>
            )}
          />
        ) : null}
        {props.diveMode === 'scuba' ? (
          <Controller
            control={props.control}
            name="visibilityRating"
            render={({ field }) => (
              <FieldRow
                label={t('logbook.visibilityRating')}
                layout="stacked"
                error={props.errors.visibilityRating?.message}
                errorTestID="log-entry-editor-visibility-rating-error">
                <StarRatingControl value={field.value} onChange={field.onChange} testID="log-entry-editor-visibility-rating" />
              </FieldRow>
            )}
          />
        ) : null}
        <Controller
          control={props.control}
          name="perceivedExertion"
          render={({ field }) => (
            <FieldRow
              label={t('logbook.perceivedExertion')}
              layout="stacked"
              error={props.errors.perceivedExertion?.message}
              errorTestID="log-entry-editor-perceived-exertion-error">
              <StarRatingControl value={field.value} onChange={field.onChange} testID="log-entry-editor-perceived-exertion" />
            </FieldRow>
          )}
        />
      </Section>
      {props.diveMode === 'scuba' ? <ScubaFields {...props} /> : <FreediveFields {...props} />}
      <Section title={t('logbook.sectionPeople')}>
        <Controller
          control={props.control}
          name="buddies"
          render={({ field }) => (
            <FieldRow label={t('logbook.buddyNames')} layout="stacked" separated={false}>
              <BadgeListInput
                ref={props.badgeRefs.buddies}
                accessibilityLabel={t('logbook.buddyNames')}
                values={field.value}
                onChange={field.onChange}
                inputTestID="log-entry-editor-buddies-input"
                badgeTestIDPrefix="log-entry-editor-buddies"
                placeholder={t('logbook.commaSeparatedPlaceholder')}
                autoCapitalize="words"
                autoCorrect={false}
                suggestions={props.buddySuggestions}
              />
            </FieldRow>
          )}
        />
        <Controller
          control={props.control}
          name="tags"
          render={({ field }) => (
            <FieldRow label={t('logbook.tags')} layout="stacked">
              <BadgeListInput
                ref={props.badgeRefs.tags}
                accessibilityLabel={t('logbook.tags')}
                values={field.value}
                onChange={field.onChange}
                inputTestID="log-entry-editor-tags-input"
                badgeTestIDPrefix="log-entry-editor-tags"
                placeholder={t('logbook.commaSeparatedPlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </FieldRow>
          )}
        />
        <Controller
          control={props.control}
          name="observedMarineLife"
          render={({ field }) => (
            <FieldRow label={t('logbook.observedMarineLife')} layout="stacked">
              <BadgeListInput
                ref={props.badgeRefs.observedMarineLife}
                accessibilityLabel={t('logbook.observedMarineLife')}
                values={field.value}
                onChange={field.onChange}
                inputTestID="log-entry-editor-marine-life-input"
                badgeTestIDPrefix="log-entry-editor-marine-life"
                placeholder={t('logbook.commaSeparatedPlaceholder')}
                autoCapitalize="none"
              />
            </FieldRow>
          )}
        />
      </Section>
    </>
  );
}

function ScubaFields(props: LogEntryDetailFieldsProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Section title={t('logbook.sectionGear')}>
      {/* The only gas the app records is air, so it is a read-only row, not a choice. */}
      <ValueRow
        label={t('logbook.gasLabel')}
        value={t('logbook.airGas')}
        emptyText="--"
        separated={false}
        testID="log-entry-editor-gas-label-air"
      />
      <Controller
        control={props.control}
        name="gearIds"
        render={({ field }) => (
          <FieldRow label={t('logbook.gear')} layout="stacked">
            <BadgeListInput
              ref={props.badgeRefs.gearIds}
              accessibilityLabel={t('logbook.gear')}
              values={field.value}
              onChange={field.onChange}
              inputTestID="log-entry-editor-gear"
              badgeTestIDPrefix="log-entry-editor-gear"
              placeholder={t('logbook.commaSeparatedPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </FieldRow>
        )}
      />
      <Controller
        control={props.control}
        name="pressure"
        render={({ field }) => (
          <PressureValueRows
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
              unit: t('logbook.pressureUnit'),
              start: t('logbook.startPressure'),
              end: t('logbook.endPressure'),
            }}
          />
        )}
      />
    </Section>
  );
}

function FreediveFields(props: LogEntryDetailFieldsProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Section title={t('logbook.sectionTraining')}>
      <Controller
        control={props.control}
        name="repetitionCount"
        render={({ field }) => (
          <NumberValueField
            label={t('logbook.repetitionCount')}
            value={field.value}
            onChange={field.onChange}
            min={0}
            max={200}
            valueType="int"
            startValue={8}
            quickValues={[5, 10, 20]}
            error={props.errors.repetitionCount?.message}
            separated={false}
            testID="log-entry-editor-repetition-count"
          />
        )}
      />
      <Controller
        control={props.control}
        name="trainingFocus"
        render={({ field }) => (
          <FieldRow
            label={t('logbook.trainingFocus')}
            layout="stacked"
            error={props.errors.trainingFocus?.message}
            errorTestID="log-entry-editor-training-focus-error">
            <Input className="h-11 rounded-xl bg-background">
              <InputField
                testID="log-entry-editor-training-focus"
                aria-label={t('logbook.trainingFocus')}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                placeholder={t('logbook.trainingFocusPlaceholder')}
                autoCapitalize="sentences"
                returnKeyType="done"
              />
            </Input>
          </FieldRow>
        )}
      />
    </Section>
  );
}
