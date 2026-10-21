import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { Keyboard, type LayoutChangeEvent } from 'react-native';
import { Controller, useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { InstrumentButton, ScreenBackButton, SelectorPill } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import { Input, InputField } from '../../components/ui/input';
import { Text } from '../../components/ui/text';
import { Textarea, TextareaInput } from '../../components/ui/textarea';
import { VStack } from '../../components/ui/vstack';
import type { DiveEntryStyle } from '../../types/dive-plan';
import type { DiveLogEntry } from '../../types/dive-log-entry';
import type { WatchSession } from '../../types/dive-session';
import { SUPPORTED_WATCH_DEPTH_LIMIT_METERS } from '../../utils/unsupported-depth';
import { BadgeListField, type BadgeListFieldHandle } from '../common/form/badge-list-field';
import { DepthWheelField, DurationWheelField } from '../common/form/compound-number-wheel-fields';
import { DateTimeField } from '../common/form/date-time-field';
import { EditorField } from '../common/form/editor-field';
import { StarRatingField } from '../common/form/star-rating-field';
import {
  entryToLogEntryFormValues,
  logEntryFormSchema,
  logEntryFormValuesToEntry,
  type LogEntryDirtyFields,
  type LogEntryFormValues,
} from './log-entry-form-schema';
import { ModeSpecificFields } from './log-entry-mode-fields';

type LogEntryEditorProps = {
  entry: DiveLogEntry;
  mode?: 'create' | 'edit';
  isSaving?: boolean;
  saveError?: Error | null;
  onCancel: () => void;
  onSave: (entry: DiveLogEntry) => Promise<DiveLogEntry>;
  onFieldLayout?: (fieldName: string, y: number) => void;
  onInvalidSubmit?: (fieldName: string) => void;
  onDirtyChange?: (isDirty: boolean) => void;
};

const diveModes: NonNullable<WatchSession['diveMode']>[] = ['scuba', 'freedive'];
const entryStyles: DiveEntryStyle[] = ['shore', 'boat', 'pool'];

export function LogEntryEditor(props: LogEntryEditorProps): React.JSX.Element {
  const { t } = useTranslation();
  const form = useForm<LogEntryFormValues>({
    defaultValues: entryToLogEntryFormValues(props.entry),
    resolver: zodResolver(logEntryFormSchema) as Resolver<LogEntryFormValues>,
    mode: 'onSubmit',
  });
  const [localSaveFailed, setLocalSaveFailed] = React.useState(false);
  const activeDiveMode = form.watch('diveMode') ?? 'scuba';
  const mode = props.mode ?? 'create';
  const errors = form.formState.errors;
  const isDirty = form.formState.isDirty;
  const { onDirtyChange } = props;
  const bodyOffsetRef = React.useRef(0);
  const buddiesRef = React.useRef<BadgeListFieldHandle>(null);
  const tagsRef = React.useRef<BadgeListFieldHandle>(null);
  const marineLifeRef = React.useRef<BadgeListFieldHandle>(null);

  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

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
    (fieldErrors: FieldErrors<LogEntryFormValues>) => {
      const firstInvalidField = getFirstLogEntryErrorField(fieldErrors);
      if (firstInvalidField) {
        props.onInvalidSubmit?.(firstInvalidField);
      }
    },
    [props],
  );

  const flushPendingBadgeFields = React.useCallback(() => {
    form.setValue('buddies', buddiesRef.current?.commitPending() ?? form.getValues('buddies'), { shouldDirty: true });
    form.setValue('tags', tagsRef.current?.commitPending() ?? form.getValues('tags'), { shouldDirty: true });
    form.setValue('observedMarineLife', marineLifeRef.current?.commitPending() ?? form.getValues('observedMarineLife'), { shouldDirty: true });
  }, [form]);

  const save = React.useCallback(() => {
    Keyboard.dismiss();
    flushPendingBadgeFields();
    return form.handleSubmit(async values => {
      setLocalSaveFailed(false);
      try {
        await props.onSave(logEntryFormValuesToEntry(props.entry, values, form.formState.dirtyFields as LogEntryDirtyFields));
      } catch {
        setLocalSaveFailed(true);
        // Keep the draft in place while React Query exposes the mutation error state.
      }
    }, handleInvalidSubmit)();
  }, [flushPendingBadgeFields, form, handleInvalidSubmit, props]);

  return (
    <DiveSummaryCard accent="primary">
      <ScreenBackButton
        testID="log-entry-editor-back"
        accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
        onPress={props.onCancel}
      />
      <DiveSummaryCard.Header
        eyebrow={t('logbook.editorEyebrow')}
        title={t(mode === 'edit' ? 'logbook.editorEditTitle' : 'logbook.editorTitle')}
        titleTestID="log-entry-editor-title"
      />
      <DiveSummaryCard.Body testID="log-entry-editor-body" onLayout={registerBodyLayout}>
        {props.saveError || localSaveFailed ? (
          <Text
            testID="log-entry-editor-error"
            className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
            children={t('logbook.saveError')}
          />
        ) : null}
        <Controller
          control={form.control}
          name="startedAt"
          render={({ field }) => (
            <DateTimeField
              label={t('logbook.startedAt')}
              value={field.value}
              onChange={field.onChange}
              required
              error={errors.startedAt?.message}
              onLayout={registerFieldLayout('startedAt')}
              testID="log-entry-editor-started-at"
            />
          )}
        />
        <Controller
          control={form.control}
          name="diveMode"
          render={({ field }) => (
            <EditorField label={t('logbook.diveMode')} required error={errors.diveMode?.message}>
              <HStack space="xs" className="rounded-full bg-muted p-1">
                {diveModes.map(diveMode => (
                  <SelectorPill
                    key={diveMode}
                    testID={`log-entry-editor-mode-${diveMode}`}
                    className="flex-1"
                    label={t(`diveModes.${diveMode}`)}
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
            <EditorField label={t('logbook.entryStyle', { defaultValue: 'Entry style' })}>
              <HStack space="xs" className="rounded-full bg-muted p-1">
                {entryStyles.map(entryStyle => (
                  <SelectorPill
                    key={entryStyle}
                    testID={`log-entry-editor-entry-style-${entryStyle}`}
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
              label={t('logbook.siteName')}
              required
              error={errors.siteName?.message}
              errorTestID="log-entry-editor-site-name-error"
              onLayout={registerFieldLayout('siteName')}
              testID="log-entry-editor-site-name-anchor"
            >
              <Input className="h-11 rounded-xl bg-background">
                <InputField
                  testID="log-entry-editor-site-name"
                  value={field.value}
                  onChangeText={field.onChange}
                  placeholder={t('logbook.siteNamePlaceholder')}
                />
              </Input>
            </EditorField>
          )}
        />
        <HStack space="md" onLayout={registerFieldGroupLayout(['durationSeconds', 'maxDepthMeters'])}>
          <Controller
            control={form.control}
            name="durationSeconds"
            render={({ field }) => (
              <DurationWheelField
                className="flex-1"
                label={t('logbook.durationSeconds', { defaultValue: 'Duration' })}
                valueSeconds={field.value}
                onChange={field.onChange}
                maxSeconds={240 * 60}
                required
                error={errors.durationSeconds?.message}
                testID="log-entry-editor-duration"
              />
            )}
          />
          <Controller
            control={form.control}
            name="maxDepthMeters"
            render={({ field }) => (
              <VStack space="xs" className="flex-1">
                <DepthWheelField
                  label={t('logbook.maxDepthMeters')}
                  valueMeters={field.value}
                  onChange={field.onChange}
                  maxMeters={60}
                  required
                  error={errors.maxDepthMeters?.message}
                  testID="log-entry-editor-max-depth"
                />
                {field.value !== undefined && field.value > SUPPORTED_WATCH_DEPTH_LIMIT_METERS ? (
                  <Text
                    testID="log-entry-editor-unsupported-depth-warning"
                    className="rounded-xl bg-muted px-3 py-2 text-xs font-semibold leading-4 text-muted-foreground">
                    {t('logbook.unsupportedDepthWarning')}
                  </Text>
                ) : null}
              </VStack>
            )}
          />
        </HStack>
        <ModeSpecificFields control={form.control} errors={errors} diveMode={activeDiveMode} />
        <Controller
          control={form.control}
          name="buddies"
          render={({ field }) => (
            <BadgeListField
              ref={buddiesRef}
              label={t('logbook.buddyNames')}
              values={field.value}
              onChange={field.onChange}
              inputTestID="log-entry-editor-buddies-input"
              badgeTestIDPrefix="log-entry-editor-buddies"
              placeholder={t('logbook.commaSeparatedPlaceholder')}
            />
          )}
        />
        <Controller
          control={form.control}
          name="tags"
          render={({ field }) => (
            <BadgeListField
              ref={tagsRef}
              label={t('logbook.tags')}
              values={field.value}
              onChange={field.onChange}
              inputTestID="log-entry-editor-tags-input"
              badgeTestIDPrefix="log-entry-editor-tags"
              placeholder={t('logbook.commaSeparatedPlaceholder')}
            />
          )}
        />
        <Controller
          control={form.control}
          name="observedMarineLife"
          render={({ field }) => (
            <BadgeListField
              ref={marineLifeRef}
              label={t('logbook.observedMarineLife')}
              values={field.value}
              onChange={field.onChange}
              inputTestID="log-entry-editor-marine-life-input"
              badgeTestIDPrefix="log-entry-editor-marine-life"
              placeholder={t('logbook.commaSeparatedPlaceholder')}
            />
          )}
        />
        <Controller
          control={form.control}
          name="notes"
          render={({ field }) => (
            <EditorField label={t('logbook.notes')}>
              <Textarea className="rounded-xl bg-background">
                <TextareaInput
                  testID="log-entry-editor-notes"
                  value={field.value ?? ''}
                  onChangeText={field.onChange}
                  placeholder={t('logbook.notesPlaceholder')}
                />
              </Textarea>
            </EditorField>
          )}
        />
        <Controller
          control={form.control}
          name="rating"
          render={({ field }) => (
            <StarRatingField
              label={t('logbook.rating')}
              value={field.value}
              onChange={field.onChange}
              error={errors.rating?.message}
              testID="log-entry-editor-rating"
            />
          )}
        />
      </DiveSummaryCard.Body>
      <DiveSummaryCard.Footer>
        <HStack space="sm">
          <InstrumentButton className="flex-1" label={t('logbook.cancel')} onPress={props.onCancel} />
          <InstrumentButton
            testID="log-entry-editor-save"
            className="flex-1"
            label={props.isSaving ? t('logbook.saving') : t(mode === 'edit' ? 'logbook.saveChanges' : 'logbook.saveManualLog')}
            variant="primary"
            onPress={save}
            disabled={props.isSaving}
          />
        </HStack>
      </DiveSummaryCard.Footer>
    </DiveSummaryCard>
  );
}

function getFirstLogEntryErrorField(errors: FieldErrors<LogEntryFormValues>): string | undefined {
  const fieldOrder: Array<keyof LogEntryFormValues> = [
    'startedAt',
    'diveMode',
    'siteName',
    'durationSeconds',
    'maxDepthMeters',
    'gearIds',
    'waterCondition',
    'visibilityRating',
    'perceivedExertion',
    'pressure',
    'repetitionCount',
    'trainingFocus',
    'buddies',
    'tags',
    'observedMarineLife',
    'notes',
    'rating',
  ];

  return fieldOrder.find(fieldName => Boolean(errors[fieldName]));
}
