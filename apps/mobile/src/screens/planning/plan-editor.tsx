import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Controller, useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Box } from '../../components/ui/box';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { InstrumentButton, ScreenBackButton, SelectorPill } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import { Input, InputField } from '../../components/ui/input';
import { Text } from '../../components/ui/text';
import { Textarea, TextareaInput } from '../../components/ui/textarea';
import { VStack } from '../../components/ui/vstack';
import type { DiveEntryStyle, DivePlan, DivePlanStatus } from '../../types/dive-plan';
import type { WatchSession } from '../../types/dive-session';
import { createBlankDivePlan } from '../../utils/create-dive-plan';
import { BadgeListField } from '../common/form/badge-list-field';
import { DateTimeField } from '../common/form/date-time-field';
import { EditorField } from '../common/form/editor-field';
import { planFormSchema, planFormValuesToPlan, planToPlanFormValues, type PlanFormValues } from './plan-form-schema';
import { PlanModeFields } from './plan-mode-fields';

type PlanEditorProps = {
  plan?: DivePlan;
  mode?: 'create' | 'edit';
  isSaving?: boolean;
  saveError?: Error | null;
  onCancel: () => void;
  onSave: (plan: DivePlan) => Promise<DivePlan>;
  onFieldLayout?: (fieldName: string, y: number) => void;
  onInvalidSubmit?: (fieldName: string) => void;
};

const diveModes: NonNullable<WatchSession['diveMode']>[] = ['scuba', 'freedive'];
const entryStyles: DiveEntryStyle[] = ['shore', 'boat', 'pool'];

export function PlanEditor(props: PlanEditorProps): React.JSX.Element {
  const { t } = useTranslation();
  const basePlan = React.useMemo(() => props.plan ?? createBlankDivePlan(), [props.plan]);
  const form = useForm<PlanFormValues>({
    defaultValues: planToPlanFormValues(basePlan),
    resolver: zodResolver(planFormSchema) as Resolver<PlanFormValues>,
    mode: 'onSubmit',
  });
  const [localSaveFailed, setLocalSaveFailed] = React.useState(false);
  const activeDiveMode = form.watch('diveMode') ?? 'scuba';
  const mode = props.mode ?? 'create';
  const errors = form.formState.errors;
  const bodyOffsetRef = React.useRef(0);

  const registerBodyLayout = React.useCallback((event: LayoutChangeEvent) => {
    bodyOffsetRef.current = event.nativeEvent.layout.y;
  }, []);

  const registerFieldLayout = React.useCallback(
    (fieldName: string) => (event: LayoutChangeEvent) => {
      props.onFieldLayout?.(fieldName, bodyOffsetRef.current + event.nativeEvent.layout.y);
    },
    [props],
  );

  const registerFieldGroupLayout = React.useCallback(
    (fieldNames: string[]) => (event: LayoutChangeEvent) => {
      const y = bodyOffsetRef.current + event.nativeEvent.layout.y;
      fieldNames.forEach(fieldName => props.onFieldLayout?.(fieldName, y));
    },
    [props],
  );

  const handleInvalidSubmit = React.useCallback(
    (fieldErrors: FieldErrors<PlanFormValues>) => {
      const firstInvalidField = getFirstPlanErrorField(fieldErrors);
      if (firstInvalidField) {
        props.onInvalidSubmit?.(firstInvalidField);
      }
    },
    [props],
  );

  const save = React.useCallback(
    (status: DivePlanStatus) =>
      form.handleSubmit(async values => {
        setLocalSaveFailed(false);
        try {
          await props.onSave(planFormValuesToPlan(basePlan, values, status));
        } catch {
          setLocalSaveFailed(true);
        }
      }, handleInvalidSubmit)(),
    [basePlan, form, handleInvalidSubmit, props],
  );

  return (
    <DiveSummaryCard accent="primary">
      <ScreenBackButton
        testID="planning-editor-back"
        accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
        onPress={props.onCancel}
      />
      <DiveSummaryCard.Header
        eyebrow={t('planning.editorEyebrow', { defaultValue: 'Planbook entry' })}
        title={t(mode === 'edit' ? 'planning.editorEditTitle' : 'planning.editorTitle', {
          defaultValue: mode === 'edit' ? 'Edit dive plan' : 'New dive plan',
        })}
        titleTestID="planning-editor-title"
      />
      <DiveSummaryCard.Body testID="planning-editor-body" onLayout={registerBodyLayout}>
        {props.saveError || localSaveFailed ? (
          <Text
            testID="planning-editor-error"
            className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
            children={t('planning.saveError', { defaultValue: 'Could not save this plan locally. Try again.' })}
          />
        ) : null}
        <Controller
          control={form.control}
          name="title"
          render={({ field }) => (
            <EditorField label={t('planning.planTitle', { defaultValue: 'Plan title' })} error={errors.title?.message}>
              <Input className="h-11 rounded-xl bg-background">
                <InputField
                  testID="planning-editor-plan-title"
                  value={field.value ?? ''}
                  onChangeText={field.onChange}
                  placeholder={t('planning.planTitlePlaceholder', { defaultValue: 'Morning reef plan' })}
                />
              </Input>
            </EditorField>
          )}
        />
        <Controller
          control={form.control}
          name="plannedAt"
          render={({ field }) => (
            <DateTimeField
              label={t('planning.plannedAt', { defaultValue: 'Planned date/time' })}
              value={field.value}
              onChange={field.onChange}
              required
              error={errors.plannedAt?.message}
              onLayout={registerFieldLayout('plannedAt')}
              testID="planning-editor-planned-at"
            />
          )}
        />
        <Controller
          control={form.control}
          name="diveMode"
          render={({ field }) => (
            <EditorField label={t('logbook.diveMode', { defaultValue: 'Dive mode' })} required error={errors.diveMode?.message}>
              <HStack space="xs" className="rounded-full bg-muted p-1">
                {diveModes.map(diveMode => (
                  <SelectorPill
                    key={diveMode}
                    testID={`planning-editor-mode-${diveMode}`}
                    className="flex-1"
                    label={t(`diveModes.${diveMode}`, { defaultValue: diveMode })}
                    selected={field.value === diveMode}
                    onPress={() => field.onChange(diveMode)}
                  />
                ))}
              </HStack>
            </EditorField>
          )}
        />
        <Controller
          control={form.control}
          name="entryStyle"
          render={({ field }) => (
            <EditorField label={t('planning.entryStyle', { defaultValue: 'Entry style' })}>
              <HStack space="xs" className="rounded-full bg-muted p-1">
                {entryStyles.map(entryStyle => (
                  <SelectorPill
                    key={entryStyle}
                    testID={`planning-editor-entry-style-${entryStyle}`}
                    className="flex-1"
                    label={t(`entryStyles.${entryStyle}`, { defaultValue: entryStyle })}
                    selected={field.value === entryStyle}
                    onPress={() => field.onChange(field.value === entryStyle ? undefined : entryStyle)}
                  />
                ))}
              </HStack>
            </EditorField>
          )}
        />
        <Controller
          control={form.control}
          name="siteName"
          render={({ field }) => (
            <EditorField
              label={t('planning.siteName', { defaultValue: 'Site name' })}
              required
              error={errors.siteName?.message}
              errorTestID="planning-editor-site-name-error"
              onLayout={registerFieldLayout('siteName')}
              testID="planning-editor-site-name-anchor"
            >
              <Input className="h-11 rounded-xl bg-background">
                <InputField
                  testID="planning-editor-site-name"
                  value={field.value}
                  onChangeText={field.onChange}
                  placeholder={t('planning.siteNamePlaceholder', { defaultValue: 'Dive site' })}
                />
              </Input>
            </EditorField>
          )}
        />
        <HStack space="md">
          <Controller
            control={form.control}
            name="buddies"
            render={({ field }) => (
              <BadgeListField
                label={t('logbook.buddyNames', { defaultValue: 'Buddies' })}
                values={field.value}
                onChange={field.onChange}
                inputTestID="planning-editor-buddies-input"
                badgeTestIDPrefix="planning-editor-buddies"
                placeholder={t('logbook.commaSeparatedPlaceholder', { defaultValue: 'Separate with commas' })}
                className="flex-1"
              />
            )}
          />
          <Controller
            control={form.control}
            name="gearIds"
            render={({ field }) => (
              <BadgeListField
                label={t('logbook.gear', { defaultValue: 'Gear' })}
                values={field.value}
                onChange={field.onChange}
                inputTestID="planning-editor-gear-input"
                badgeTestIDPrefix="planning-editor-gear"
                placeholder={t('logbook.commaSeparatedPlaceholder', { defaultValue: 'Separate with commas' })}
                className="flex-1"
              />
            )}
          />
        </HStack>
        <Controller
          control={form.control}
          name="tags"
          render={({ field }) => (
            <BadgeListField
              label={t('logbook.tags', { defaultValue: 'Tags' })}
              values={field.value}
              onChange={field.onChange}
              inputTestID="planning-editor-tags-input"
              badgeTestIDPrefix="planning-editor-tags"
              placeholder={t('logbook.commaSeparatedPlaceholder', { defaultValue: 'Separate with commas' })}
            />
          )}
        />
        <Controller
          control={form.control}
          name="objective"
          render={({ field }) => (
            <EditorField label={t('planning.objective', { defaultValue: 'Objective' })} error={errors.objective?.message}>
              <Input className="h-11 rounded-xl bg-background">
                <InputField
                  testID="planning-editor-objective"
                  value={field.value ?? ''}
                  onChangeText={field.onChange}
                  placeholder={t('planning.objectivePlaceholder', { defaultValue: 'What this dive is for' })}
                />
              </Input>
            </EditorField>
          )}
        />
        <Box
          testID="planning-editor-mode-fields-anchor"
          onLayout={registerFieldGroupLayout(['plannedMaxDepthMeters', 'plannedDurationMinutes'])}
        >
          <PlanModeFields control={form.control} errors={errors} diveMode={activeDiveMode} />
        </Box>
        <Controller
          control={form.control}
          name="notes"
          render={({ field }) => (
            <EditorField label={t('logbook.notes', { defaultValue: 'Notes' })} error={errors.notes?.message}>
              <Textarea className="rounded-xl bg-background">
                <TextareaInput
                  testID="planning-editor-notes"
                  value={field.value ?? ''}
                  onChangeText={field.onChange}
                  placeholder={t('planning.notesPlaceholder', { defaultValue: 'Planning notes' })}
                />
              </Textarea>
            </EditorField>
          )}
        />
      </DiveSummaryCard.Body>
      <DiveSummaryCard.Footer>
        <VStack space="sm">
          <HStack space="sm">
            <InstrumentButton className="flex-1" label={t('logbook.cancel', { defaultValue: 'Cancel' })} onPress={props.onCancel} />
            <InstrumentButton
              testID="planning-editor-save-draft"
              className="flex-1"
              label={t('planning.saveDraft', { defaultValue: 'Save draft' })}
              onPress={() => save('draft')}
              disabled={props.isSaving}
            />
          </HStack>
          <InstrumentButton
            testID="planning-editor-save-planned"
            label={props.isSaving ? t('planning.saving', { defaultValue: 'Saving' }) : t('planning.setPlanned', { defaultValue: 'Set planned' })}
            variant="primary"
            onPress={() => save('planned')}
            disabled={props.isSaving}
          />
        </VStack>
      </DiveSummaryCard.Footer>
    </DiveSummaryCard>
  );
}

function getFirstPlanErrorField(errors: FieldErrors<PlanFormValues>): string | undefined {
  const fieldOrder: Array<keyof PlanFormValues> = [
    'title',
    'plannedAt',
    'diveMode',
    'siteName',
    'plannedMaxDepthMeters',
    'plannedDurationMinutes',
    'buddies',
    'gearIds',
    'tags',
    'objective',
    'plannedPressure',
    'waterCondition',
    'visibilityExpectation',
    'perceivedDifficulty',
    'trainingFocus',
    'repetitionTarget',
    'notes',
  ];

  return fieldOrder.find(fieldName => Boolean(errors[fieldName]));
}
