import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { AccessibilityInfo, Keyboard, type TextInput } from 'react-native';
import { Controller, useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Section } from '../../components/ui/grouped-list';
import { HStack } from '../../components/ui/hstack';
import { InstrumentButton, SelectorPill } from '../../components/ui/instrument';
import { Input, InputField } from '../../components/ui/input';
import { Pressable } from '../../components/ui/pressable';
import { Text } from '../../components/ui/text';
import { Textarea, TextareaInput } from '../../components/ui/textarea';
import type { DiveLogEntry } from '../../types/dive-log-entry';
import type { WatchSession } from '../../types/dive-session';
import { SUPPORTED_WATCH_DEPTH_LIMIT_METERS } from '../../utils/unsupported-depth';
import type { BadgeListFieldHandle } from '../common/form/badge-list-field';
import { CollapsibleSection } from '../common/form/collapsible-section';
import { formatDurationDraft } from '../common/form/compound-number-wheel-fields';
import { DateTimeField, formatDateTimeParts } from '../common/form/date-time-field';
import { EditorAnchor, EditorScreen, type EditorScreenHandle } from '../common/form/editor-screen';
import { FieldRow } from '../common/form/field-row';
import { StarRatingControl } from '../common/form/star-rating-field';
import { DepthValueField, DurationValueField } from '../common/form/value-picker-field';
import { formatLogDepth, formatLogDuration } from './log-formatters';
import {
  entryToLogEntryFormValues,
  logEntryFormSchema,
  logEntryFormValuesToEntry,
  type LogEntryDirtyFields,
  type LogEntryFormValues,
} from './log-entry-form-schema';
import { LogEntryDetailFields, type LogEntryBadgeRefs } from './log-entry-mode-fields';
import type { LogEntrySuggestions } from './log-entry-suggestions';
import { RestoreWatchValueLine, WatchMeasuredRow } from './log-entry-watch-fields';

type LogEntryEditorProps = {
  entry: DiveLogEntry;
  mode?: 'create' | 'edit';
  /** A save already running elsewhere for this entry keeps the save button pending. */
  isSaving?: boolean;
  onCancel: () => void;
  onSave: (entry: DiveLogEntry) => Promise<DiveLogEntry>;
  /** Reports the first invalid field after a blocked save; the editor scrolls to its section itself. */
  onInvalidSubmit?: (fieldName: string) => void;
  onDirtyChange?: (isDirty: boolean) => void;
  /** Site and buddy names from earlier logs, offered as chips. */
  suggestions?: LogEntrySuggestions;
};

type EditorSection = 'essentials' | 'review' | 'details';
type WatchMeasuredField = 'startedAt' | 'durationSeconds' | 'maxDepthMeters';

const WATCH_MEASURED_FIELDS: WatchMeasuredField[] = ['startedAt', 'durationSeconds', 'maxDepthMeters'];
const MAX_DURATION_SECONDS = 240 * 60;
const MAX_DEPTH_METERS = 60;
const diveModes: NonNullable<WatchSession['diveMode']>[] = ['scuba', 'freedive'];

// Fields in the order they appear on screen, with the section each one lives in.
const FIELD_SECTIONS: Array<[keyof LogEntryFormValues, EditorSection]> = [
  ['startedAt', 'essentials'],
  ['diveMode', 'essentials'],
  ['siteName', 'essentials'],
  ['durationSeconds', 'essentials'],
  ['maxDepthMeters', 'essentials'],
  ['rating', 'review'],
  ['notes', 'review'],
  ['entryStyle', 'details'],
  ['waterCondition', 'details'],
  ['visibilityRating', 'details'],
  ['perceivedExertion', 'details'],
  ['gearIds', 'details'],
  ['pressure', 'details'],
  ['repetitionCount', 'details'],
  ['trainingFocus', 'details'],
  ['buddies', 'details'],
  ['tags', 'details'],
  ['observedMarineLife', 'details'],
];

/**
 * The full-screen log editor: 기본 → 후기 → 세부 정보 (collapsed unless it has values), with
 * the save action pinned at the bottom. Values the watch measured stay read-only until the user
 * chooses `직접 수정`, and can go back with `워치 값으로 되돌리기`.
 */
export function LogEntryEditor(props: LogEntryEditorProps): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [defaultValues] = React.useState(() => entryToLogEntryFormValues(props.entry));
  const form = useForm<LogEntryFormValues>({
    defaultValues,
    resolver: zodResolver(logEntryFormSchema) as Resolver<LogEntryFormValues>,
    mode: 'onSubmit',
  });
  const editorRef = React.useRef<EditorScreenHandle>(null);
  const notesRef = React.useRef<React.ComponentRef<typeof TextareaInput>>(null);
  // The vendored textarea types its ref as props; at runtime it is the native text input.
  const focusNotes = () => (notesRef.current as unknown as Pick<TextInput, 'focus'> | null)?.focus();
  const buddiesRef = React.useRef<BadgeListFieldHandle>(null);
  const tagsRef = React.useRef<BadgeListFieldHandle>(null);
  const marineLifeRef = React.useRef<BadgeListFieldHandle>(null);
  const gearRef = React.useRef<BadgeListFieldHandle>(null);
  const badgeRefs: LogEntryBadgeRefs = { buddies: buddiesRef, tags: tagsRef, observedMarineLife: marineLifeRef, gearIds: gearRef };
  // Scoped to this editor, so a failure from an earlier editor never shows when this one opens.
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [detailsExpanded, setDetailsExpanded] = React.useState(() => hasDetailValues(defaultValues));
  const [overridden, setOverridden] = React.useState<Record<WatchMeasuredField, boolean>>(() => ({
    startedAt: props.entry.provenance.startedAt === 'manual',
    durationSeconds: props.entry.provenance.durationSeconds === 'manual',
    maxDepthMeters: props.entry.provenance.maxDepthMeters === 'manual',
  }));
  const watchValues = props.entry.watchCapture?.measuredValues;
  const activeDiveMode = form.watch('diveMode') ?? 'scuba';
  const mode = props.mode ?? 'create';
  const errors = form.formState.errors;
  const isDirty = form.formState.isDirty;
  const isSubmitting = form.formState.isSubmitting;
  const { onDirtyChange } = props;

  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  /** A watch value is locked while it exists and the user has not chosen to change it. */
  const isLocked = (field: WatchMeasuredField): boolean => watchValues?.[field] !== undefined && !overridden[field];

  const overrideWatchValue = (field: WatchMeasuredField) => {
    setOverridden(current => ({ ...current, [field]: true }));
  };

  const restoreWatchValue = (field: WatchMeasuredField) => {
    if (!watchValues) {
      return;
    }

    if (field === 'startedAt') {
      form.setValue('startedAt', new Date(watchValues.startedAt * 1000), { shouldDirty: true });
    } else {
      form.setValue(field, watchValues[field], { shouldDirty: true });
    }
    form.clearErrors(field);
    setOverridden(current => ({ ...current, [field]: false }));
  };

  const handleInvalidSubmit = React.useCallback(
    (fieldErrors: FieldErrors<LogEntryFormValues>) => {
      const [firstInvalidField, section] = FIELD_SECTIONS.find(([fieldName]) => Boolean(fieldErrors[fieldName])) ?? [];

      if (!firstInvalidField || !section) {
        return;
      }

      props.onInvalidSubmit?.(firstInvalidField);

      // A locked watch value that fails validation (for example a depth past the editor's range)
      // opens for editing, so its message and input are visible.
      const invalidWatchFields = WATCH_MEASURED_FIELDS.filter(fieldName => Boolean(fieldErrors[fieldName]));
      if (invalidWatchFields.length) {
        setOverridden(current => ({ ...current, ...Object.fromEntries(invalidWatchFields.map(fieldName => [fieldName, true])) }));
      }

      if (section === 'details') {
        setDetailsExpanded(true);
      }
      editorRef.current?.scrollToAnchor(section);

      const message = firstErrorMessage(fieldErrors, firstInvalidField);
      if (message) {
        AccessibilityInfo.announceForAccessibility(message);
      }
    },
    [props],
  );

  const flushPendingBadgeFields = React.useCallback(() => {
    form.setValue('buddies', buddiesRef.current?.commitPending() ?? form.getValues('buddies'), { shouldDirty: true });
    form.setValue('tags', tagsRef.current?.commitPending() ?? form.getValues('tags'), { shouldDirty: true });
    form.setValue('observedMarineLife', marineLifeRef.current?.commitPending() ?? form.getValues('observedMarineLife'), { shouldDirty: true });
    form.setValue('gearIds', gearRef.current?.commitPending() ?? form.getValues('gearIds'), { shouldDirty: true });
  }, [form]);

  const save = React.useCallback(() => {
    Keyboard.dismiss();
    flushPendingBadgeFields();
    return form.handleSubmit(async values => {
      setSaveFailed(false);
      try {
        await props.onSave(logEntryFormValuesToEntry(props.entry, values, form.formState.dirtyFields as LogEntryDirtyFields));
      } catch {
        // Keep the draft in place so the same save can be tried again.
        setSaveFailed(true);
      }
    }, handleInvalidSubmit)();
  }, [flushPendingBadgeFields, form, handleInvalidSubmit, props]);

  const watchStartedAt = watchValues ? formatDateTimeParts(new Date(watchValues.startedAt * 1000), locale) : undefined;
  const watchStartedAtText = watchStartedAt ? `${watchStartedAt.date} ${watchStartedAt.time}` : undefined;
  const watchDurationText =
    watchValues?.durationSeconds === undefined ? undefined : formatDurationDraft(watchValues.durationSeconds, MAX_DURATION_SECONDS);
  const watchDepthText = watchValues?.maxDepthMeters === undefined ? undefined : formatLogDepth(watchValues.maxDepthMeters);

  return (
    <EditorScreen
      ref={editorRef}
      testID="log-entry-editor"
      title={t(mode === 'edit' ? 'logbook.editorEditTitle' : 'logbook.editorTitle')}
      titleTestID="log-entry-editor-title"
      eyebrow={props.entry.watchCapture ? t('logbook.editorEyebrowWatch') : t('logbook.editorEyebrowManual')}
      onBack={props.onCancel}
      backTestID="log-entry-editor-back"
      actionError={saveFailed ? t('logbook.saveError') : undefined}
      actionErrorTestID="log-entry-editor-error"
      actions={
        <InstrumentButton
          testID="log-entry-editor-save"
          label={t(mode === 'edit' ? 'logbook.saveChanges' : 'logbook.saveManualLog')}
          variant="primary"
          pending={isSubmitting || Boolean(props.isSaving)}
          onPress={save}
        />
      }>
      <EditorAnchor name="essentials" anchorTestID="log-entry-editor-essentials-anchor">
        <Section title={t('logbook.sectionEssentials')}>
          {isLocked('startedAt') ? (
            <WatchMeasuredRow
              label={t('logbook.startedAt')}
              value={watchStartedAtText}
              emptyText="--"
              onOverride={() => overrideWatchValue('startedAt')}
              separated={false}
              testID="log-entry-editor-started-at"
            />
          ) : (
            <>
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
                    maximumDate={new Date()}
                    separated={false}
                    testID="log-entry-editor-started-at"
                  />
                )}
              />
              {watchStartedAtText ? (
                <RestoreWatchValueLine
                  label={t('logbook.startedAt')}
                  watchValue={watchStartedAtText}
                  onRestore={() => restoreWatchValue('startedAt')}
                  restoreTestID="log-entry-editor-started-at-restore"
                />
              ) : null}
            </>
          )}
          <Controller
            control={form.control}
            name="diveMode"
            render={({ field }) => (
              // Stacked like the entry style row: beside the label, a fixed-width selector pushed the
              // label out of the row on a phone.
              <FieldRow label={t('logbook.diveMode')} layout="stacked" error={errors.diveMode?.message}>
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
              </FieldRow>
            )}
          />
          <Controller
            control={form.control}
            name="siteName"
            render={({ field }) => (
              <FieldRow
                label={t('logbook.siteName')}
                layout="stacked"
                required
                hasValue={field.value.trim().length > 0}
                error={errors.siteName?.message}
                errorTestID="log-entry-editor-site-name-error">
                <Input className="h-11 rounded-xl bg-background">
                  <InputField
                    testID="log-entry-editor-site-name"
                    aria-label={t('logbook.siteName')}
                    value={field.value}
                    onChangeText={field.onChange}
                    placeholder={t('logbook.siteNamePlaceholder')}
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={focusNotes}
                  />
                </Input>
                <SiteSuggestions value={field.value} suggestions={props.suggestions?.sites} onPick={field.onChange} />
              </FieldRow>
            )}
          />
          {isLocked('durationSeconds') ? (
            <WatchMeasuredRow
              label={t('logbook.durationSeconds')}
              value={watchDurationText}
              spokenValue={formatLogDuration(watchValues?.durationSeconds, t)}
              emptyText="--:--"
              onOverride={() => overrideWatchValue('durationSeconds')}
              testID="log-entry-editor-duration"
            />
          ) : (
            <>
              <Controller
                control={form.control}
                name="durationSeconds"
                render={({ field }) => (
                  <DurationValueField
                    label={t('logbook.durationSeconds')}
                    valueSeconds={field.value}
                    onChange={field.onChange}
                    maxSeconds={MAX_DURATION_SECONDS}
                    required
                    error={errors.durationSeconds?.message}
                    testID="log-entry-editor-duration"
                  />
                )}
              />
              {watchDurationText ? (
                <RestoreWatchValueLine
                  label={t('logbook.durationSeconds')}
                  watchValue={watchDurationText}
                  onRestore={() => restoreWatchValue('durationSeconds')}
                  restoreTestID="log-entry-editor-duration-restore"
                />
              ) : null}
            </>
          )}
          {isLocked('maxDepthMeters') ? (
            <WatchMeasuredRow
              label={t('logbook.maxDepthMeters')}
              value={watchDepthText}
              emptyText="-- m"
              onOverride={() => overrideWatchValue('maxDepthMeters')}
              footer={<UnsupportedDepthNote meters={watchValues?.maxDepthMeters} />}
              testID="log-entry-editor-max-depth"
            />
          ) : (
            <>
              <Controller
                control={form.control}
                name="maxDepthMeters"
                render={({ field }) => (
                  <DepthValueField
                    label={t('logbook.maxDepthMeters')}
                    valueMeters={field.value}
                    onChange={field.onChange}
                    maxMeters={MAX_DEPTH_METERS}
                    required
                    error={errors.maxDepthMeters?.message}
                    footer={<UnsupportedDepthNote meters={field.value} />}
                    testID="log-entry-editor-max-depth"
                  />
                )}
              />
              {watchDepthText ? (
                <RestoreWatchValueLine
                  label={t('logbook.maxDepthMeters')}
                  watchValue={watchDepthText}
                  onRestore={() => restoreWatchValue('maxDepthMeters')}
                  restoreTestID="log-entry-editor-max-depth-restore"
                />
              ) : null}
            </>
          )}
        </Section>
      </EditorAnchor>
      <EditorAnchor name="review" anchorTestID="log-entry-editor-review-anchor">
        <Section title={t('logbook.sectionReview')}>
          <Controller
            control={form.control}
            name="rating"
            render={({ field }) => (
              <FieldRow
                label={t('logbook.rating')}
                layout="stacked"
                separated={false}
                error={errors.rating?.message}
                errorTestID="log-entry-editor-rating-error">
                <StarRatingControl value={field.value} onChange={field.onChange} testID="log-entry-editor-rating" />
              </FieldRow>
            )}
          />
          <Controller
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FieldRow label={t('logbook.notes')} layout="stacked">
                <Textarea className="rounded-xl bg-background">
                  <TextareaInput
                    ref={notesRef}
                    testID="log-entry-editor-notes"
                    aria-label={t('logbook.notes')}
                    value={field.value ?? ''}
                    onChangeText={field.onChange}
                    placeholder={t('logbook.notesPlaceholder')}
                    autoCapitalize="sentences"
                  />
                </Textarea>
              </FieldRow>
            )}
          />
        </Section>
      </EditorAnchor>
      <EditorAnchor name="details" anchorTestID="log-entry-editor-details-anchor">
        <CollapsibleSection
          title={t('logbook.sectionDetails')}
          summary={t(activeDiveMode === 'freedive' ? 'logbook.detailsSummaryFreedive' : 'logbook.detailsSummaryScuba')}
          hasValues={hasDetailValues(defaultValues)}
          expanded={detailsExpanded}
          onExpandedChange={setDetailsExpanded}
          testID="log-entry-editor-details">
          <LogEntryDetailFields
            control={form.control}
            errors={errors}
            diveMode={activeDiveMode}
            badgeRefs={badgeRefs}
            buddySuggestions={props.suggestions?.buddies}
          />
        </CollapsibleSection>
      </EditorAnchor>
    </EditorScreen>
  );
}

/** A quiet review note for depths past the watch's supported range. The value is still saved. */
function UnsupportedDepthNote(props: { meters?: number }): React.JSX.Element | null {
  const { t } = useTranslation();

  if (props.meters === undefined || props.meters <= SUPPORTED_WATCH_DEPTH_LIMIT_METERS) {
    return null;
  }

  return (
    <Text testID="log-entry-editor-unsupported-depth-warning" className="text-sm leading-5 text-muted-foreground">
      {t('logbook.unsupportedDepthWarning')}
    </Text>
  );
}

/** Earlier site names that start with what is typed; tapping one fills the field. */
function SiteSuggestions(props: { value: string; suggestions?: string[]; onPick: (site: string) => void }): React.JSX.Element | null {
  const { t } = useTranslation();
  const query = props.value.trim().toLocaleLowerCase();
  const matches = (props.suggestions ?? [])
    .filter(site => {
      const normalized = site.toLocaleLowerCase();
      return normalized !== query && normalized.startsWith(query);
    })
    .slice(0, 4);

  if (!matches.length) {
    return null;
  }

  return (
    <HStack space="xs" className="flex-wrap">
      {matches.map(site => (
        <Pressable
          key={site}
          testID={`log-entry-editor-site-suggestion-${site}`}
          accessibilityRole="button"
          accessibilityLabel={t('logbook.useSuggestion', { value: site })}
          onPress={() => props.onPick(site)}
          className="mb-1 mr-1 min-h-11 justify-center rounded-full bg-muted px-3"
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}>
          <Text className="text-sm text-foreground">{site}</Text>
        </Pressable>
      ))}
    </HStack>
  );
}

/** Opens "세부 정보" on the first render when the draft already has something inside it. */
function hasDetailValues(values: LogEntryFormValues): boolean {
  return Boolean(
    values.entryStyle ||
      (values.waterCondition && values.waterCondition !== 'unknown') ||
      values.visibilityRating !== undefined ||
      values.perceivedExertion !== undefined ||
      values.gearIds.length ||
      values.pressure.start !== undefined ||
      values.pressure.end !== undefined ||
      values.repetitionCount !== undefined ||
      values.trainingFocus?.trim() ||
      values.buddies.length ||
      values.tags.length ||
      values.observedMarineLife.length,
  );
}

function firstErrorMessage(errors: FieldErrors<LogEntryFormValues>, field: keyof LogEntryFormValues): string | undefined {
  if (field === 'pressure') {
    const pressure = errors.pressure;
    return pressure?.unit?.message ?? pressure?.start?.message ?? pressure?.end?.message ?? pressure?.message;
  }

  const message = errors[field]?.message;
  return typeof message === 'string' ? message : undefined;
}
