import React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PlannedWatchDivesUpdateStatus } from '../../companion/watch-link';
import { Row, Section } from '../../components/ui/grouped-list';
import { HStack } from '../../components/ui/hstack';
import { CheckCircleIcon, CircleIcon, Icon } from '../../components/ui/icon';
import { InstrumentButton, ScreenBackButton, StatusPill } from '../../components/ui/instrument';
import { Pressable } from '../../components/ui/pressable';
import { ScreenHeader } from '../../components/ui/screen-header';
import { SyncConflictBanner, type SyncConflictChoice } from '../../components/ui/sync-conflict-banner';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { DivePlan, DivePlanChecklistItem } from '../../types/dive-plan';
import { confirmDestructiveAction } from '../../utils/confirm-destructive-action';
import { getUnsupportedDepthForPlan } from '../../utils/unsupported-depth';
import { formatDateTimeParts } from '../common/form/date-time-field';
import { RowSeparator } from '../common/form/field-row';
import {
  checklistItemLabel,
  formatPlanDepth,
  getMissingPlanFields,
  getPlanWatchState,
  isPlanDatePassed,
  planStatusTone,
  planTitle,
  type PlanRequiredField,
} from './plan-status';

type PlanDetailProps = {
  plan: DivePlan;
  onBack: () => void;
  onEdit: (plan: DivePlan) => void;
  /** Saves the draft as planned. The detail checks the required fields first. */
  onPromote?: (plan: DivePlan) => Promise<unknown>;
  /** Saves the plan as completed and resolves with the saved plan. */
  onComplete: (plan: DivePlan) => Promise<DivePlan | void>;
  onDelete?: (localId: string) => Promise<void>;
  onCreateLogFromPlan: (plan: DivePlan) => void;
  hasExistingConvertedLog?: boolean;
  onOpenConvertedLog?: (localId: string) => void;
  /** Saves a toggled checklist right away. Without it the checklist is read-only. */
  onSaveChecklist?: (items: DivePlanChecklistItem[]) => Promise<unknown>;
  /** The last planned-dive handoff to the watch, if one has run. */
  watchSyncStatus?: PlannedWatchDivesUpdateStatus;
  /** Plan localId → `updatedAt` of the versions that handoff carried. */
  watchSentPlanVersions?: ReadonlyMap<string, number>;
  onResolveConflict?: (choice: SyncConflictChoice) => Promise<void>;
};

type StatusAction = 'promote' | 'complete';

const REQUIRED_FIELD_LABEL_KEYS: Record<PlanRequiredField, string> = {
  plannedAt: 'planning.plannedAt',
  diveMode: 'planning.diveMode',
  siteName: 'planning.siteName',
  plannedMaxDepth: 'planning.plannedMaxDepth',
  plannedDuration: 'planning.plannedDuration',
};

/**
 * A plan as grouped sections. Planned values are labelled as plans, never as measurements, and
 * the one status action sits under them; delete is a separate destructive row at the bottom.
 */
export function PlanDetail(props: PlanDetailProps): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { plan } = props;
  const [statusAction, setStatusAction] = React.useState<StatusAction>();
  const [actionError, setActionError] = React.useState<string>();
  const [missingFields, setMissingFields] = React.useState<PlanRequiredField[]>([]);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteFailed, setDeleteFailed] = React.useState(false);
  // Error notes appear below their control without moving focus, so each failure is also spoken.
  const checklist = useChecklistSaves(plan.checklistItems, props.onSaveChecklist, () =>
    AccessibilityInfo.announceForAccessibility(t('planning.checklistError')),
  );
  const datePassed = isPlanDatePassed(plan);
  const describeMissing = (fields: PlanRequiredField[]) =>
    t('planning.promoteMissing', { fields: fields.map(field => t(REQUIRED_FIELD_LABEL_KEYS[field])).join(', ') });

  React.useEffect(() => {
    if (actionError) {
      AccessibilityInfo.announceForAccessibility(actionError);
    }
  }, [actionError]);

  // A fixed draft no longer needs the missing-field note.
  React.useEffect(() => {
    setMissingFields(current => (current.length ? getMissingPlanFields(plan) : current));
  }, [plan]);

  const runStatusAction = async (action: StatusAction, work: () => Promise<void>) => {
    setStatusAction(action);
    setActionError(undefined);
    try {
      await work();
    } catch {
      setActionError(t('planning.actionError'));
    } finally {
      setStatusAction(undefined);
    }
  };

  // Status saves carry the checklist as shown, so a tick that is still saving is not undone.
  const currentPlan = (): DivePlan => ({ ...plan, checklistItems: checklist.items });

  const promote = () => {
    const missing = getMissingPlanFields(plan);
    setMissingFields(missing);
    if (missing.length) {
      // The note appears under the button without moving focus, so VoiceOver hears it here.
      AccessibilityInfo.announceForAccessibility(describeMissing(missing));
      return;
    }
    if (!props.onPromote) {
      return;
    }

    runStatusAction('promote', async () => {
      await props.onPromote?.(currentPlan());
    });
  };

  const complete = () =>
    runStatusAction('complete', async () => {
      const planToComplete = currentPlan();
      const savedPlan = (await props.onComplete(planToComplete)) ?? { ...planToComplete, status: 'completed' as const };
      // Completing never writes a log by itself; the diver chooses whether to start a draft now.
      Alert.alert(t('planning.completedPrompt.title'), t('planning.completedPrompt.message'), [
        { text: t('planning.completedPrompt.later'), style: 'cancel' },
        { text: t('planning.completedPrompt.create'), onPress: () => props.onCreateLogFromPlan(savedPlan) },
      ]);
    });

  const confirmDelete = () =>
    confirmDestructiveAction({
      title: t('planning.deleteConfirm.title'),
      message: t(plan.ownerUserId === undefined ? 'planning.deleteConfirm.message' : 'planning.deleteConfirm.accountMessage'),
      cancelLabel: t('common.cancel'),
      confirmLabel: t('planning.deleteConfirm.confirm'),
      onConfirm: () => {
        const deletePlan = props.onDelete;
        if (!deletePlan) {
          return;
        }

        setIsDeleting(true);
        setDeleteFailed(false);
        deletePlan(plan.localId)
          .catch(() => {
            setDeleteFailed(true);
            AccessibilityInfo.announceForAccessibility(t('planning.deleteError'));
          })
          .finally(() => setIsDeleting(false));
      },
    });

  return (
    <VStack space="lg">
      <HStack className="items-center justify-between">
        <ScreenBackButton testID="planning-detail-back" accessibilityLabel={t('common.back')} onPress={props.onBack} />
        <InstrumentButton
          testID="planning-detail-edit"
          label={t('planning.editPlan')}
          onPress={() => props.onEdit(plan)}
          className="min-h-11 px-4 py-2"
        />
      </HStack>

      <VStack space="sm">
        <ScreenHeader title={planTitle(plan, t)} titleTestID="planning-detail-title" />
        <HStack space="xs" className="flex-wrap">
          <StatusPill testID="planning-detail-status" label={t(`planning.status.${plan.status}`)} tone={planStatusTone(plan.status)} />
          {datePassed ? <StatusPill testID="planning-detail-date-passed" label={t('planning.datePassed')} tone="muted" /> : null}
        </HStack>
      </VStack>

      {plan.cloudSyncStatus === 'conflict' && props.onResolveConflict ? (
        <SyncConflictBanner onResolve={props.onResolveConflict} />
      ) : null}

      <WhenWhereSection
        plan={plan}
        locale={locale}
        watchSyncStatus={props.watchSyncStatus}
        watchSentPlanVersions={props.watchSentPlanVersions}
      />
      <DiveSection plan={plan} />
      <PressureMemoSection plan={plan} />
      <ExpectedConditionsSection plan={plan} />
      <PeopleGearSection plan={plan} />
      <NotesSection plan={plan} />
      <ChecklistSection
        items={checklist.items}
        saveFailed={checklist.saveFailed}
        // While a status save runs, a tick would be written over by it (or write over it).
        onToggle={props.onSaveChecklist && !statusAction ? checklist.toggle : undefined}
      />

      <VStack space="sm">
        {plan.status === 'draft' && props.onPromote ? (
          <InstrumentButton
            testID="planning-detail-promote"
            label={t('planning.setPlanned')}
            variant="primary"
            pending={statusAction === 'promote'}
            onPress={promote}
          />
        ) : null}
        {plan.status === 'planned' ? (
          <InstrumentButton
            testID="planning-detail-complete"
            label={t('planning.markCompleted')}
            variant="primary"
            pending={statusAction === 'complete'}
            onPress={complete}
          />
        ) : null}
        {plan.status === 'completed' && !props.hasExistingConvertedLog ? (
          <InstrumentButton
            testID="planning-detail-create-log"
            label={t('planning.createLogFromPlan')}
            variant="primary"
            onPress={() => props.onCreateLogFromPlan(plan)}
          />
        ) : null}
        {plan.status === 'completed' && props.hasExistingConvertedLog && plan.convertedLogLocalId && props.onOpenConvertedLog ? (
          <InstrumentButton
            testID="planning-detail-open-log"
            label={t('planning.openLog')}
            variant="primary"
            onPress={() => props.onOpenConvertedLog?.(plan.convertedLogLocalId!)}
          />
        ) : null}
        {missingFields.length ? (
          <Text testID="planning-detail-promote-missing" className="px-1 text-sm leading-5 text-destructive">
            {describeMissing(missingFields)}
          </Text>
        ) : null}
        {actionError ? (
          <Text testID="planning-detail-action-error" className="px-1 text-sm leading-5 text-destructive">
            {actionError}
          </Text>
        ) : null}
      </VStack>

      {props.onDelete ? (
        <VStack space="sm">
          <Section>
            <Row
              testID="planning-detail-delete"
              label={t('planning.deletePlan')}
              destructive
              accessory={{ kind: 'none' }}
              pending={isDeleting}
              separated={false}
              onPress={confirmDelete}
            />
          </Section>
          {deleteFailed ? (
            <Text testID="planning-detail-delete-error" className="px-1 text-sm leading-5 text-destructive">
              {t('planning.deleteError')}
            </Text>
          ) : null}
        </VStack>
      ) : null}
    </VStack>
  );
}

function WhenWhereSection(props: {
  plan: DivePlan;
  locale: string;
  watchSyncStatus?: PlannedWatchDivesUpdateStatus;
  watchSentPlanVersions?: ReadonlyMap<string, number>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const parts =
    props.plan.plannedAt === undefined ? undefined : formatDateTimeParts(new Date(props.plan.plannedAt * 1000), props.locale);
  const watchState = getPlanWatchState(props.plan, props.watchSyncStatus, props.watchSentPlanVersions);

  return (
    <Section title={t('planning.sections.whenWhere')}>
      <Row
        testID="planning-detail-row-planned-at"
        valueTestID="planning-detail-row-planned-at-value"
        label={t('planning.plannedAt')}
        value={parts ? `${parts.date} ${parts.time}` : '--'}
        separated={false}
      />
      <Row
        testID="planning-detail-row-site"
        valueTestID="planning-detail-row-site-value"
        label={t('planning.siteName')}
        value={props.plan.site.name ?? '--'}
      />
      {watchState ? (
        <Row
          testID="planning-detail-watch-status"
          valueTestID="planning-detail-watch-status-value"
          label={t('planning.watch.label')}
          value={t(`planning.watch.${watchState}`)}
        />
      ) : null}
    </Section>
  );
}

function DiveSection(props: { plan: DivePlan }): React.JSX.Element {
  const { t } = useTranslation();
  const values = props.plan.plannedValues;
  const unsupportedDepth = getUnsupportedDepthForPlan(props.plan);

  return (
    <Section title={t('planning.sections.dive')} footer={t('planning.plannedValuesFooter')}>
      <Row
        testID="planning-detail-row-mode"
        valueTestID="planning-detail-row-mode-value"
        label={t('planning.diveMode')}
        value={props.plan.diveMode ? t(`diveModes.${props.plan.diveMode}`) : '--'}
        separated={false}
      />
      {props.plan.entryStyle ? (
        <Row
          testID="planning-detail-row-entry-style"
          valueTestID="planning-detail-row-entry-style-value"
          label={t('planning.entryStyle')}
          value={t(`entryStyles.${props.plan.entryStyle}`)}
        />
      ) : null}
      <Row
        testID="planning-detail-row-planned-max"
        valueTestID="planning-detail-row-planned-max-value"
        label={t('planning.plannedMaxDepth')}
        value={values.plannedMaxDepthMeters === undefined ? '-- m' : formatPlanDepth(values.plannedMaxDepthMeters)}
      />
      {unsupportedDepth ? (
        <Text testID="planning-detail-unsupported-depth-warning" className="px-4 pb-3 text-sm leading-5 text-muted-foreground">
          {t('planning.unsupportedDepthWarning')}
        </Text>
      ) : null}
      <Row
        testID="planning-detail-row-planned-duration"
        valueTestID="planning-detail-row-planned-duration-value"
        label={t('planning.plannedDuration')}
        value={
          values.plannedDurationMinutes === undefined
            ? `-- ${t('units.minutesShort')}`
            : t('form.durationMinutes', { minutes: values.plannedDurationMinutes })
        }
      />
      {props.plan.diveMode === 'scuba' ? (
        <Row
          testID="planning-detail-row-gas"
          valueTestID="planning-detail-row-gas-value"
          label={t('planning.gasLabel')}
          value={t('planning.air')}
        />
      ) : null}
      {props.plan.diveMode === 'freedive' && values.repetitionTarget !== undefined ? (
        <Row
          testID="planning-detail-row-repetition-target"
          valueTestID="planning-detail-row-repetition-target-value"
          label={t('planning.repetitionTarget')}
          value={t('planning.repetitionCount', { count: values.repetitionTarget })}
        />
      ) : null}
    </Section>
  );
}

/** Expected pressures are preparation notes; the footer says they are not a reserve rule. */
function PressureMemoSection(props: { plan: DivePlan }): React.JSX.Element | null {
  const { t } = useTranslation();
  const pressure = props.plan.plannedValues.plannedPressure;

  if (props.plan.diveMode !== 'scuba' || !pressure || (pressure.start === undefined && pressure.end === undefined)) {
    return null;
  }

  const unit = pressure.unit ?? 'bar';

  return (
    <Section title={t('planning.sections.pressureMemo')} footer={t('planning.pressureMemoNote')}>
      {pressure.start !== undefined ? (
        <Row
          testID="planning-detail-row-pressure-start"
          valueTestID="planning-detail-row-pressure-start-value"
          label={t('planning.expectedStartPressure')}
          value={`${pressure.start} ${unit}`}
          separated={false}
        />
      ) : null}
      {pressure.end !== undefined ? (
        <Row
          testID="planning-detail-row-pressure-end"
          valueTestID="planning-detail-row-pressure-end-value"
          label={t('planning.expectedEndPressure')}
          value={`${pressure.end} ${unit}`}
          separated={pressure.start !== undefined}
        />
      ) : null}
    </Section>
  );
}

function ExpectedConditionsSection(props: { plan: DivePlan }): React.JSX.Element | null {
  const { t } = useTranslation();
  const values = props.plan.plannedValues;
  const rows = [
    values.waterCondition && values.waterCondition !== 'unknown'
      ? { id: 'water-condition', label: t('planning.expectedWaterCondition'), value: t(`waterConditions.${values.waterCondition}`) }
      : undefined,
    values.visibilityExpectation !== undefined
      ? { id: 'visibility', label: t('planning.visibilityExpectation'), rating: values.visibilityExpectation }
      : undefined,
    values.perceivedDifficulty !== undefined
      ? { id: 'difficulty', label: t('planning.perceivedDifficulty'), rating: values.perceivedDifficulty }
      : undefined,
  ].filter(row => row !== undefined);

  if (!rows.length) {
    return null;
  }

  return (
    <Section title={t('planning.sections.expectedConditions')}>
      {rows.map((row, index) => {
        const value = 'rating' in row ? `${row.rating}/5` : row.value;

        return (
          <Row
            key={row.id}
            testID={`planning-detail-row-${row.id}`}
            valueTestID={`planning-detail-row-${row.id}-value`}
            label={row.label}
            value={value}
            accessibilityLabel={
              'rating' in row ? `${row.label}, ${t('form.ratingStar', { value: row.rating, total: 5 })}` : undefined
            }
            separated={index > 0}
          />
        );
      })}
    </Section>
  );
}

function PeopleGearSection(props: { plan: DivePlan }): React.JSX.Element | null {
  const { t } = useTranslation();
  const rows = [
    { id: 'buddies', label: t('planning.buddies'), values: props.plan.buddyIds },
    { id: 'gear', label: t('planning.gear'), values: props.plan.gearIds },
    { id: 'tags', label: t('planning.tags'), values: props.plan.tags },
  ].filter(row => row.values.length > 0);

  if (!rows.length) {
    return null;
  }

  return (
    <Section title={t('planning.sections.peopleGear')}>
      {rows.map((row, index) => (
        <Row
          key={row.id}
          testID={`planning-detail-row-${row.id}`}
          valueTestID={`planning-detail-row-${row.id}-value`}
          label={row.label}
          value={row.values.join(', ')}
          separated={index > 0}
        />
      ))}
    </Section>
  );
}

function NotesSection(props: { plan: DivePlan }): React.JSX.Element | null {
  const { t } = useTranslation();
  const rows = [
    { id: 'objective', label: t('planning.objective'), text: props.plan.objective },
    { id: 'training-focus', label: t('planning.trainingFocus'), text: props.plan.plannedValues.trainingFocus },
    { id: 'notes', label: t('planning.notes'), text: props.plan.notes },
  ].filter((row): row is { id: string; label: string; text: string } => Boolean(row.text));

  if (!rows.length) {
    return null;
  }

  return (
    <Section title={t('planning.sections.notes')}>
      {rows.map((row, index) => (
        <VStack key={row.id} testID={`planning-detail-row-${row.id}`} accessible accessibilityLabel={`${row.label}, ${row.text}`}>
          {index > 0 ? <RowSeparator /> : null}
          <VStack space="xs" className="px-4 py-3">
            <Text className="text-sm text-muted-foreground">{row.label}</Text>
            <Text testID={`planning-detail-row-${row.id}-value`} className="text-base leading-6 text-card-foreground">
              {row.text}
            </Text>
          </VStack>
        </VStack>
      ))}
    </Section>
  );
}

/**
 * A checklist tap saves at once. While saves are in flight `items` holds the latest taps, and a
 * failed save puts the stored state back with a short note (`onSaveFailed` runs once per failure).
 */
function useChecklistSaves(
  storedItems: DivePlanChecklistItem[],
  onSaveChecklist: ((items: DivePlanChecklistItem[]) => Promise<unknown>) | undefined,
  onSaveFailed: () => void,
): { items: DivePlanChecklistItem[]; saveFailed: boolean; toggle: (id: string) => void } {
  const [pendingItems, setPendingItems] = React.useState<DivePlanChecklistItem[]>();
  const [saveFailed, setSaveFailed] = React.useState(false);
  const inFlightRef = React.useRef(0);
  const items = pendingItems ?? storedItems;

  const toggle = (id: string) => {
    if (!onSaveChecklist) {
      return;
    }

    const nextItems = items.map(item => (item.id === id ? { ...item, completed: !item.completed } : item));
    setPendingItems(nextItems);
    setSaveFailed(false);
    inFlightRef.current += 1;
    onSaveChecklist(nextItems)
      .catch(() => {
        setSaveFailed(true);
        onSaveFailed();
      })
      .finally(() => {
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) {
          setPendingItems(undefined);
        }
      });
  };

  return { items, saveFailed, toggle };
}

/** Preparation reminders the diver ticks off. Without `onToggle` the rows are read-only. */
function ChecklistSection(props: {
  items: DivePlanChecklistItem[];
  saveFailed: boolean;
  onToggle?: (id: string) => void;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const { items, onToggle } = props;
  const doneCount = items.filter(item => item.completed).length;

  if (!items.length) {
    return null;
  }

  return (
    <VStack space="sm">
      <HStack className="items-center justify-between px-1">
        <Text accessibilityRole="header" className="text-xs font-semibold uppercase text-muted-foreground">
          {t('planning.sections.checklist')}
        </Text>
        <Text
          testID="planning-detail-checklist-progress"
          accessibilityLabel={t('planning.checklistProgressLabel', { done: doneCount, total: items.length })}
          className="text-xs text-muted-foreground">
          {`${doneCount}/${items.length}`}
        </Text>
      </HStack>
      <Section>
        {items.map((item, index) => {
          const label = checklistItemLabel(item, t);

          return (
            <VStack key={item.id}>
              {index > 0 ? <RowSeparator /> : null}
              <Pressable
                testID={`planning-detail-checklist-${item.id}`}
                accessibilityRole="checkbox"
                accessibilityLabel={label}
                accessibilityState={{ checked: item.completed, disabled: !onToggle }}
                disabled={!onToggle}
                onPress={() => onToggle?.(item.id)}
                className="active:bg-muted">
                <HStack space="md" className="min-h-12 items-center px-4 py-3">
                  <Icon
                    as={item.completed ? CheckCircleIcon : CircleIcon}
                    className={item.completed ? 'text-primary' : 'text-muted-foreground'}
                  />
                  <Text className={item.completed ? 'flex-1 text-base text-muted-foreground' : 'flex-1 text-base text-card-foreground'}>
                    {label}
                  </Text>
                </HStack>
              </Pressable>
            </VStack>
          );
        })}
      </Section>
      {props.saveFailed ? (
        <Text testID="planning-detail-checklist-error" className="px-1 text-sm leading-5 text-destructive">
          {t('planning.checklistError')}
        </Text>
      ) : null}
    </VStack>
  );
}
