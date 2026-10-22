import React from 'react';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Section } from '../../components/ui/grouped-list';
import { HStack } from '../../components/ui/hstack';
import { Input, InputField } from '../../components/ui/input';
import { SelectorPill } from '../../components/ui/instrument';
import { Text } from '../../components/ui/text';
import { Textarea, TextareaInput } from '../../components/ui/textarea';
import type { DiveEntryStyle } from '../../types/dive-plan';
import type { WatchSession } from '../../types/dive-session';
import { SUPPORTED_WATCH_DEPTH_LIMIT_METERS } from '../../utils/unsupported-depth';
import { BadgeListInput, type BadgeListFieldHandle } from '../common/form/badge-list-field';
import { DateTimeField } from '../common/form/date-time-field';
import { FieldRow } from '../common/form/field-row';
import { PressureValueRows } from '../common/form/pressure-fields';
import { StarRatingControl } from '../common/form/star-rating-field';
import { DepthValueField, NumberValueField } from '../common/form/value-picker-field';
import { ValueRow } from '../common/form/value-row';
import type { PlanFormValues } from './plan-form-schema';

type SectionProps = {
  control: Control<PlanFormValues>;
  errors: FieldErrors<PlanFormValues>;
};

type RequiredMarkProps = {
  /** True where a save can run the full check, so the fields it needs show 필수. A draft check needs none of them. */
  requiresFullPlan: boolean;
};

const diveModes: NonNullable<WatchSession['diveMode']>[] = ['scuba', 'freedive'];
const entryStyles: DiveEntryStyle[] = ['shore', 'boat', 'pool'];
const waterConditionOptions: NonNullable<WatchSession['waterCondition']>[] = ['calm', 'mild', 'choppy', 'surge', 'current', 'unknown'];

// Grouped rows carry the field surface, so inputs drop the vendored border.
const INPUT_CLASS = 'h-11 rounded-xl border-0 bg-background';

/** The next full hour: a plan usually starts on the hour, and later than now. */
function nextFullHour(): Date {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
}

/** 기본: title, date and time, mode, entry and site. */
export function PlanBasicsSection(props: SectionProps & RequiredMarkProps): React.JSX.Element {
  const { t } = useTranslation();
  const siteInputRef = React.useRef<React.ComponentRef<typeof InputField>>(null);

  return (
    <Section title={t('planning.sections.basics')}>
      <Controller
        control={props.control}
        name="title"
        render={({ field }) => (
          <FieldRow label={t('planning.planTitle')} hasValue={Boolean(field.value)} separated={false}>
            <Input className={INPUT_CLASS}>
              <InputField
                testID="planning-editor-plan-title"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                placeholder={t('planning.planTitlePlaceholder')}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => (siteInputRef.current as unknown as { focus?: () => void } | null)?.focus?.()}
              />
            </Input>
          </FieldRow>
        )}
      />
      <Controller
        control={props.control}
        name="plannedAt"
        render={({ field }) => (
          <DateTimeField
            label={t('planning.plannedAt')}
            value={field.value}
            onChange={field.onChange}
            required={props.requiresFullPlan}
            clearable
            defaultValue={nextFullHour()}
            error={props.errors.plannedAt?.message}
            testID="planning-editor-planned-at"
          />
        )}
      />
      <Controller
        control={props.control}
        name="diveMode"
        render={({ field }) => (
          <FieldRow label={t('planning.diveMode')} layout="inline" error={props.errors.diveMode?.message}>
            <HStack space="xs" className="w-48 rounded-full bg-muted p-1">
              {diveModes.map(diveMode => (
                <SelectorPill
                  key={diveMode}
                  testID={`planning-editor-mode-${diveMode}`}
                  className="flex-1"
                  label={t(`diveModes.${diveMode}`)}
                  selected={field.value === diveMode}
                  onPress={() => field.onChange(diveMode)}
                />
              ))}
            </HStack>
          </FieldRow>
        )}
      />
      <Controller
        control={props.control}
        name="entryStyle"
        render={({ field }) => (
          <FieldRow label={t('planning.entryStyle')}>
            <HStack space="xs" className="rounded-full bg-muted p-1">
              {entryStyles.map(entryStyle => (
                <SelectorPill
                  key={entryStyle}
                  testID={`planning-editor-entry-style-${entryStyle}`}
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
      <Controller
        control={props.control}
        name="siteName"
        render={({ field }) => (
          <FieldRow
            label={t('planning.siteName')}
            required={props.requiresFullPlan}
            hasValue={Boolean(field.value.trim())}
            error={props.errors.siteName?.message}
            errorTestID="planning-editor-site-name-error">
            <Input className={INPUT_CLASS}>
              <InputField
                ref={siteInputRef}
                testID="planning-editor-site-name"
                value={field.value}
                onChangeText={field.onChange}
                placeholder={t('planning.siteNamePlaceholder')}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </Input>
          </FieldRow>
        )}
      />
    </Section>
  );
}

/** 계획 수심·시간: planned depth and time, plus the gas label (scuba) or the target dive count (freedive). */
export function PlanValuesSection(
  props: SectionProps & RequiredMarkProps & { diveMode: NonNullable<WatchSession['diveMode']> },
): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Section title={t('planning.sections.plannedValues')} footer={t('planning.plannedValuesFooter')}>
      <Controller
        control={props.control}
        name="plannedMaxDepthMeters"
        render={({ field }) => (
          <DepthValueField
            label={t('planning.plannedMaxDepth')}
            valueMeters={field.value}
            onChange={field.onChange}
            maxMeters={60}
            required={props.requiresFullPlan}
            separated={false}
            error={props.errors.plannedMaxDepthMeters?.message}
            footer={
              field.value !== undefined && field.value > SUPPORTED_WATCH_DEPTH_LIMIT_METERS ? (
                <Text testID="planning-editor-unsupported-depth-warning" className="text-sm leading-5 text-muted-foreground">
                  {t('planning.unsupportedDepthWarning')}
                </Text>
              ) : undefined
            }
            testID="planning-editor-planned-max-depth"
          />
        )}
      />
      <Controller
        control={props.control}
        name="plannedDurationMinutes"
        render={({ field }) => (
          <NumberValueField
            label={t('planning.plannedDuration')}
            value={field.value}
            onChange={field.onChange}
            min={0}
            max={240}
            valueType="int"
            unitLabel={t('units.minutesShort')}
            startValue={45}
            quickValues={[30, 45, 60]}
            formatValue={minutes => t('form.durationMinutes', { minutes })}
            required={props.requiresFullPlan}
            error={props.errors.plannedDurationMinutes?.message}
            testID="planning-editor-planned-duration"
          />
        )}
      />
      {props.diveMode === 'scuba' ? (
        <ValueRow label={t('planning.gasLabel')} value={t('planning.air')} emptyText="--" testID="planning-editor-gas-label-air" />
      ) : (
        <Controller
          control={props.control}
          name="repetitionTarget"
          render={({ field }) => (
            <NumberValueField
              label={t('planning.repetitionTarget')}
              value={field.value}
              onChange={field.onChange}
              min={0}
              max={200}
              valueType="int"
              startValue={8}
              formatValue={count => t('planning.repetitionCount', { count })}
              emptyText="--"
              error={props.errors.repetitionTarget?.message}
              testID="planning-editor-repetition-target"
            />
          )}
        />
      )}
    </Section>
  );
}

/** 메모·목표: what the dive is for and free notes. */
export function PlanNotesSection(props: SectionProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Section title={t('planning.sections.notes')}>
      <Controller
        control={props.control}
        name="objective"
        render={({ field }) => (
          <FieldRow label={t('planning.objective')} hasValue={Boolean(field.value)} separated={false}>
            <Input className={INPUT_CLASS}>
              <InputField
                testID="planning-editor-objective"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                placeholder={t('planning.objectivePlaceholder')}
                returnKeyType="done"
              />
            </Input>
          </FieldRow>
        )}
      />
      <Controller
        control={props.control}
        name="trainingFocus"
        render={({ field }) => (
          <FieldRow label={t('planning.trainingFocus')} hasValue={Boolean(field.value)}>
            <Input className={INPUT_CLASS}>
              <InputField
                testID="planning-editor-training-focus"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                placeholder={t('planning.trainingFocusPlaceholder')}
                returnKeyType="done"
              />
            </Input>
          </FieldRow>
        )}
      />
      <Controller
        control={props.control}
        name="notes"
        render={({ field }) => (
          <FieldRow label={t('planning.notes')} hasValue={Boolean(field.value)}>
            <Textarea className="rounded-xl border-0 bg-background">
              <TextareaInput
                testID="planning-editor-notes"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                placeholder={t('planning.notesPlaceholder')}
              />
            </Textarea>
          </FieldRow>
        )}
      />
    </Section>
  );
}

export type PlanBadgeRefs = {
  buddies: React.RefObject<BadgeListFieldHandle | null>;
  gearIds: React.RefObject<BadgeListFieldHandle | null>;
  tags: React.RefObject<BadgeListFieldHandle | null>;
};

/** The optional sections inside 세부 정보: expected conditions, people and gear, the pressure memo. */
export function PlanDetailSections(
  props: SectionProps & { diveMode: NonNullable<WatchSession['diveMode']>; badgeRefs: PlanBadgeRefs },
): React.JSX.Element {
  const { t } = useTranslation();
  const pressureErrors = props.errors.plannedPressure as
    | { unit?: { message?: string }; start?: { message?: string }; end?: { message?: string } }
    | undefined;

  return (
    <>
      <Section title={t('planning.sections.expectedConditions')}>
        <Controller
          control={props.control}
          name="waterCondition"
          render={({ field }) => (
            <FieldRow
              label={t('planning.expectedWaterCondition')}
              labelTestID="planning-editor-water-condition-label"
              hasValue={field.value !== undefined}
              separated={false}>
              <HStack space="xs" className="flex-wrap">
                {waterConditionOptions.map(condition => (
                  <SelectorPill
                    key={condition}
                    testID={`planning-editor-water-condition-${condition}`}
                    className={field.value === condition ? 'min-w-24 flex-1 bg-primary/10' : 'min-w-24 flex-1 bg-muted'}
                    label={t(`waterConditions.${condition}`)}
                    selected={field.value === condition}
                    onPress={() => field.onChange(field.value === condition ? undefined : condition)}
                  />
                ))}
              </HStack>
            </FieldRow>
          )}
        />
        <Controller
          control={props.control}
          name="visibilityExpectation"
          render={({ field }) => (
            <FieldRow
              label={t('planning.visibilityExpectation')}
              hasValue={field.value !== undefined}
              error={props.errors.visibilityExpectation?.message}>
              <StarRatingControl value={field.value} onChange={field.onChange} testID="planning-editor-visibility-expectation" />
            </FieldRow>
          )}
        />
        <Controller
          control={props.control}
          name="perceivedDifficulty"
          render={({ field }) => (
            <FieldRow
              label={t('planning.perceivedDifficulty')}
              hasValue={field.value !== undefined}
              error={props.errors.perceivedDifficulty?.message}>
              <StarRatingControl value={field.value} onChange={field.onChange} testID="planning-editor-perceived-difficulty" />
            </FieldRow>
          )}
        />
      </Section>
      <Section title={t('planning.sections.peopleGear')}>
        <Controller
          control={props.control}
          name="buddies"
          render={({ field }) => (
            <FieldRow label={t('planning.buddies')} hasValue={field.value.length > 0} separated={false}>
              <BadgeListInput
                ref={props.badgeRefs.buddies}
                values={field.value}
                onChange={field.onChange}
                inputTestID="planning-editor-buddies-input"
                badgeTestIDPrefix="planning-editor-buddies"
                placeholder={t('planning.listPlaceholder')}
                autoCapitalize="words"
              />
            </FieldRow>
          )}
        />
        {/* A freedive plan keeps no gear list, so the field is not offered there. */}
        {props.diveMode === 'scuba' ? (
          <Controller
            control={props.control}
            name="gearIds"
            render={({ field }) => (
              <FieldRow label={t('planning.gear')} hasValue={field.value.length > 0}>
                <BadgeListInput
                  ref={props.badgeRefs.gearIds}
                  values={field.value}
                  onChange={field.onChange}
                  inputTestID="planning-editor-gear-input"
                  badgeTestIDPrefix="planning-editor-gear"
                  placeholder={t('planning.listPlaceholder')}
                  autoCapitalize="none"
                />
              </FieldRow>
            )}
          />
        ) : null}
        <Controller
          control={props.control}
          name="tags"
          render={({ field }) => (
            <FieldRow label={t('planning.tags')} hasValue={field.value.length > 0}>
              <BadgeListInput
                ref={props.badgeRefs.tags}
                values={field.value}
                onChange={field.onChange}
                inputTestID="planning-editor-tags-input"
                badgeTestIDPrefix="planning-editor-tags"
                placeholder={t('planning.listPlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </FieldRow>
          )}
        />
      </Section>
      {props.diveMode === 'scuba' ? (
        <Section title={t('planning.sections.pressureMemo')} footer={t('planning.pressureMemoNote')}>
          <Controller
            control={props.control}
            name="plannedPressure"
            render={({ field }) => (
              <PressureValueRows
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
                  unit: t('planning.pressureUnit'),
                  start: t('planning.expectedStartPressure'),
                  end: t('planning.expectedEndPressure'),
                }}
                separated={false}
              />
            )}
          />
        </Section>
      ) : null}
    </>
  );
}
