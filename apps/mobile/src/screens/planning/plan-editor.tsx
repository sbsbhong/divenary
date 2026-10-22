import { zodResolver } from '@hookform/resolvers/zod';
import React from 'react';
import { AccessibilityInfo, Keyboard } from 'react-native';
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { InstrumentButton } from '../../components/ui/instrument';
import type { DivePlan, DivePlanStatus } from '../../types/dive-plan';
import { createBlankDivePlan } from '../../utils/create-dive-plan';
import type { BadgeListFieldHandle } from '../common/form/badge-list-field';
import { CollapsibleSection } from '../common/form/collapsible-section';
import { EditorAnchor, EditorScreen, type EditorScreenHandle } from '../common/form/editor-screen';
import {
  PlanBasicsSection,
  PlanDetailSections,
  PlanNotesSection,
  PlanValuesSection,
  type PlanBadgeRefs,
} from './plan-editor-sections';
import {
  planDraftSchema,
  planFormSchema,
  planFormValuesToPlan,
  planToPlanFormValues,
  type PlanFormValues,
} from './plan-form-schema';

type PlanEditorProps = {
  plan?: DivePlan;
  mode?: 'create' | 'edit';
  /** The repository is saving; every save action is disabled. */
  isSaving?: boolean;
  onCancel: () => void;
  onSave: (plan: DivePlan) => Promise<DivePlan>;
  /** Called with the first invalid field after a blocked save, once the editor has scrolled to it. */
  onInvalidSubmit?: (fieldName: string) => void;
  onDirtyChange?: (isDirty: boolean) => void;
};

/** Which button started the save, so only that one shows its pending state. */
type SaveAction = 'draft' | 'planned' | 'save';
type EditorAnchorName = 'basics' | 'plannedValues' | 'notes' | 'details';

const fullResolver = zodResolver(planFormSchema) as Resolver<PlanFormValues>;
const draftResolver = zodResolver(planDraftSchema) as Resolver<PlanFormValues>;

// Field order on screen, and the section each field scrolls to when it blocks a save.
const FIELD_ANCHORS: Array<[keyof PlanFormValues, EditorAnchorName]> = [
  ['title', 'basics'],
  ['plannedAt', 'basics'],
  ['diveMode', 'basics'],
  ['entryStyle', 'basics'],
  ['siteName', 'basics'],
  ['plannedMaxDepthMeters', 'plannedValues'],
  ['plannedDurationMinutes', 'plannedValues'],
  ['repetitionTarget', 'plannedValues'],
  ['objective', 'notes'],
  ['trainingFocus', 'notes'],
  ['notes', 'notes'],
  ['waterCondition', 'details'],
  ['visibilityExpectation', 'details'],
  ['perceivedDifficulty', 'details'],
  ['buddies', 'details'],
  ['gearIds', 'details'],
  ['tags', 'details'],
  ['plannedPressure', 'details'],
];

/**
 * The plan editor. A new plan saves as a draft (title or site is enough) or as planned (full
 * check). An existing plan has one Save that keeps its status; status changes live on the detail
 * screen.
 */
export function PlanEditor(props: PlanEditorProps): React.JSX.Element {
  const { t } = useTranslation();
  const basePlan = React.useMemo(() => props.plan ?? createBlankDivePlan(), [props.plan]);
  const mode = props.mode ?? 'create';
  // The resolver reads this, so each button validates against its own rules.
  const fullCheckRef = React.useRef(false);
  const form = useForm<PlanFormValues>({
    defaultValues: planToPlanFormValues(basePlan),
    resolver: (values, context, options) => (fullCheckRef.current ? fullResolver : draftResolver)(values, context, options),
    mode: 'onSubmit',
  });
  const editorRef = React.useRef<EditorScreenHandle>(null);
  const buddiesRef = React.useRef<BadgeListFieldHandle>(null);
  const gearIdsRef = React.useRef<BadgeListFieldHandle>(null);
  const tagsRef = React.useRef<BadgeListFieldHandle>(null);
  const badgeRefs = React.useMemo<PlanBadgeRefs>(() => ({ buddies: buddiesRef, gearIds: gearIdsRef, tags: tagsRef }), []);
  const [saveAction, setSaveAction] = React.useState<SaveAction>();
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [detailsExpanded, setDetailsExpanded] = React.useState(() => hasDetailValues(planToPlanFormValues(basePlan)));
  const activeDiveMode = form.watch('diveMode') ?? 'scuba';
  const errors = form.formState.errors;
  const isDirty = form.formState.isDirty;
  const { onDirtyChange, onInvalidSubmit, onSave } = props;

  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const flushPendingBadgeFields = React.useCallback(() => {
    form.setValue('buddies', buddiesRef.current?.commitPending() ?? form.getValues('buddies'), { shouldDirty: true });
    form.setValue('gearIds', gearIdsRef.current?.commitPending() ?? form.getValues('gearIds'), { shouldDirty: true });
    form.setValue('tags', tagsRef.current?.commitPending() ?? form.getValues('tags'), { shouldDirty: true });
  }, [form]);

  const handleInvalid = React.useCallback(
    (fieldErrors: FieldErrors<PlanFormValues>) => {
      const firstInvalid = FIELD_ANCHORS.find(([fieldName]) => Boolean(fieldErrors[fieldName]));
      if (!firstInvalid) {
        return;
      }

      const [fieldName, anchor] = firstInvalid;
      if (anchor === 'details') {
        setDetailsExpanded(true);
      }
      editorRef.current?.scrollToAnchor(anchor);
      onInvalidSubmit?.(fieldName);

      // The scroll is silent, so VoiceOver hears why the save stopped.
      const message = firstErrorMessage(fieldErrors, fieldName);
      if (message) {
        AccessibilityInfo.announceForAccessibility(message);
      }
    },
    [onInvalidSubmit],
  );

  const save = React.useCallback(
    (action: SaveAction) => {
      const status: DivePlanStatus = action === 'save' ? basePlan.status : action;
      Keyboard.dismiss();
      flushPendingBadgeFields();
      // A planned plan reaches the watch, so it must stay complete when it is edited.
      fullCheckRef.current = status === 'planned';
      setSaveFailed(false);
      // Busy from the press itself, so a second tap during validation cannot save twice.
      setSaveAction(action);

      return form.handleSubmit(
        async values => {
          try {
            await onSave(planFormValuesToPlan(basePlan, values, status));
          } catch {
            setSaveFailed(true);
          } finally {
            setSaveAction(undefined);
          }
        },
        fieldErrors => {
          setSaveAction(undefined);
          handleInvalid(fieldErrors);
        },
      )();
    },
    [basePlan, flushPendingBadgeFields, form, handleInvalid, onSave],
  );

  const isBusy = saveAction !== undefined || Boolean(props.isSaving);
  // 필수 marks only where a save can run the full check: 계획 확정 on a new plan, or Save on a planned one.
  const requiresFullPlan = mode === 'create' || basePlan.status === 'planned';

  return (
    <EditorScreen
      ref={editorRef}
      title={t(mode === 'edit' ? 'planning.editorEditTitle' : 'planning.editorTitle')}
      eyebrow={mode === 'edit' ? t(`planning.status.${basePlan.status}`) : undefined}
      titleTestID="planning-editor-title"
      onBack={props.onCancel}
      backTestID="planning-editor-back"
      actionError={saveFailed ? t('planning.saveError') : undefined}
      actionErrorTestID="planning-editor-error"
      testID="planning-editor"
      actions={
        mode === 'edit' ? (
          <InstrumentButton
            testID="planning-editor-save"
            label={t('planning.save')}
            variant="primary"
            pending={saveAction === 'save'}
            disabled={isBusy}
            onPress={() => save('save')}
          />
        ) : (
          <>
            <InstrumentButton
              testID="planning-editor-save-planned"
              label={t('planning.setPlanned')}
              variant="primary"
              pending={saveAction === 'planned'}
              disabled={isBusy}
              onPress={() => save('planned')}
            />
            <InstrumentButton
              testID="planning-editor-save-draft"
              label={t('planning.saveDraft')}
              pending={saveAction === 'draft'}
              disabled={isBusy}
              onPress={() => save('draft')}
            />
          </>
        )
      }>
      <EditorAnchor name="basics" anchorTestID="planning-editor-basics-anchor">
        <PlanBasicsSection control={form.control} errors={errors} requiresFullPlan={requiresFullPlan} />
      </EditorAnchor>
      <EditorAnchor name="plannedValues" anchorTestID="planning-editor-planned-values-anchor">
        <PlanValuesSection control={form.control} errors={errors} diveMode={activeDiveMode} requiresFullPlan={requiresFullPlan} />
      </EditorAnchor>
      <EditorAnchor name="notes" anchorTestID="planning-editor-notes-anchor">
        <PlanNotesSection control={form.control} errors={errors} />
      </EditorAnchor>
      <EditorAnchor name="details" anchorTestID="planning-editor-details-anchor">
        <CollapsibleSection
          title={t('planning.sections.details')}
          summary={t('planning.detailsSummary')}
          hasValues={detailsExpanded}
          expanded={detailsExpanded}
          onExpandedChange={setDetailsExpanded}
          testID="planning-editor-details">
          <PlanDetailSections control={form.control} errors={errors} diveMode={activeDiveMode} badgeRefs={badgeRefs} />
        </CollapsibleSection>
      </EditorAnchor>
    </EditorScreen>
  );
}

/** The message of the field that blocked the save; pressure errors sit one level down. */
function firstErrorMessage(errors: FieldErrors<PlanFormValues>, field: keyof PlanFormValues): string | undefined {
  if (field === 'plannedPressure') {
    const pressure = errors.plannedPressure;
    return pressure?.unit?.message ?? pressure?.start?.message ?? pressure?.end?.message ?? pressure?.message;
  }

  const message = errors[field]?.message;
  return typeof message === 'string' ? message : undefined;
}

/** Opens 세부 정보 on load when the plan already has something inside it. */
function hasDetailValues(values: PlanFormValues): boolean {
  return Boolean(
    (values.waterCondition !== undefined && values.waterCondition !== 'unknown') ||
      values.visibilityExpectation !== undefined ||
      values.perceivedDifficulty !== undefined ||
      values.buddies.length ||
      values.gearIds.length ||
      values.tags.length ||
      values.plannedPressure.start !== undefined ||
      values.plannedPressure.end !== undefined,
  );
}
