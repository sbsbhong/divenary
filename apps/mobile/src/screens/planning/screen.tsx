import React from 'react';
import { useTranslation } from 'react-i18next';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { InstrumentButton, SafetyText, SelectorPill, StatusPill } from '../../components/ui/instrument';
import { Box } from '../../components/ui/box';
import { HStack } from '../../components/ui/hstack';
import { ArrowRightIcon, CalendarDaysIcon, ChevronRightIcon, Icon } from '../../components/ui/icon';
import { KeyboardAwareScrollView } from '../../components/ui/keyboard-aware-scroll-view';
import { Pressable } from '../../components/ui/pressable';
import { RefreshControl } from '../../components/ui/refresh-control';
import { Skeleton, SkeletonText } from '../../components/ui/skeleton';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { InstrumentTone } from '../../components/ui/theme';
import type { DivePlan, DivePlanStatus } from '../../types/dive-plan';
import type { MobileDiveSession } from '../../types/dive-session';
import { createBlankDivePlan } from '../../utils/create-dive-plan';
import { formatDate, formatDepth } from '../../utils/dive-formatters';
import { PlanDetail } from './plan-detail';
import { PlanEditor } from './plan-editor';

type PlanningScreenProps = {
  sessions: MobileDiveSession[];
  plans?: DivePlan[];
  onRefresh: () => void | Promise<void>;
  isLoading?: boolean;
  isRefreshing?: boolean;
  reselectToken?: number;
  onSavePlan?: (plan: DivePlan) => Promise<DivePlan>;
  onDeletePlan?: (localId: string) => Promise<void>;
  onCreatePlan?: () => void;
  onOpenPlan?: (plan: DivePlan) => void;
  onCreateLogFromPlan?: (plan: DivePlan) => void;
  logEntryIds?: string[];
  onOpenLogbook: () => void;
  completedPromptPlan?: DivePlan;
  onCompletedPromptLater?: () => void;
  onCreateLogFromCompletedPlan?: (plan: DivePlan) => void;
  saveError?: Error | null;
  isSaving?: boolean;
};

type LocalRoute = 'list' | 'create' | 'detail' | 'edit';
type PlanFilter = 'all' | DivePlanStatus;

export default function PlanningScreen(props: PlanningScreenProps): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const plans = props.plans ?? [];
  const [route, setRoute] = React.useState<LocalRoute>('list');
  const [filter, setFilter] = React.useState<PlanFilter>('all');
  const [selectedId, setSelectedId] = React.useState(plans[0]?.localId);
  const [draftPlan, setDraftPlan] = React.useState<DivePlan | undefined>();
  const [localCompletedPromptPlan, setLocalCompletedPromptPlan] = React.useState<DivePlan | undefined>();
  const scrollViewRef = React.useRef<React.ComponentRef<typeof KeyboardAwareScrollView>>(null);
  const editorOffsetRef = React.useRef(0);
  const editorFieldOffsetsRef = React.useRef<Record<string, number>>({});
  const previousReselectToken = React.useRef(props.reselectToken ?? 0);
  const [lastScrollTarget, setLastScrollTarget] = React.useState<number | undefined>();
  const visiblePlans = React.useMemo(() => (filter === 'all' ? plans : plans.filter(plan => plan.status === filter)), [filter, plans]);
  const selectedPlan = plans.find(plan => plan.localId === selectedId);
  const activePlan = React.useMemo(() => selectActivePlan(plans), [plans]);
  const completedPromptPlan = props.completedPromptPlan ?? localCompletedPromptPlan;
  const existingLogIds = React.useMemo(() => new Set(props.logEntryIds ?? []), [props.logEntryIds]);
  const hasExistingConvertedLog = React.useCallback(
    (plan: DivePlan) => Boolean(plan.convertedLogLocalId && existingLogIds.has(plan.convertedLogLocalId)),
    [existingLogIds],
  );

  React.useEffect(() => {
    if (selectedPlan) {
      return;
    }

    if (visiblePlans[0]) {
      setSelectedId(visiblePlans[0].localId);
    }

    if (route === 'detail') {
      setRoute('list');
    }
  }, [route, selectedPlan, visiblePlans]);

  React.useEffect(() => {
    const reselectToken = props.reselectToken ?? 0;

    if (reselectToken === previousReselectToken.current) {
      return;
    }

    previousReselectToken.current = reselectToken;
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    void props.onRefresh();
  }, [props]);

  const openCreate = React.useCallback(() => {
    if (props.onCreatePlan) {
      props.onCreatePlan();
      return;
    }

    editorFieldOffsetsRef.current = {};
    setLastScrollTarget(undefined);
    setDraftPlan(createBlankDivePlan());
    setRoute('create');
  }, [props]);

  const openDetail = React.useCallback((plan: DivePlan) => {
    setSelectedId(plan.localId);

    if (props.onOpenPlan) {
      props.onOpenPlan(plan);
      return;
    }

    setRoute('detail');
  }, [props]);

  const openEdit = React.useCallback((plan: DivePlan) => {
    editorFieldOffsetsRef.current = {};
    setLastScrollTarget(undefined);
    setDraftPlan(plan);
    setSelectedId(plan.localId);
    setRoute('edit');
  }, []);

  const savePlan = React.useCallback(
    async (plan: DivePlan) => {
      const savedPlan = props.onSavePlan ? await props.onSavePlan(plan) : plan;
      setSelectedId(savedPlan.localId);
      setDraftPlan(undefined);
      setRoute('list');
      return savedPlan;
    },
    [props],
  );

  const deletePlan = React.useCallback(
    async (localId: string) => {
      await props.onDeletePlan?.(localId);
      setRoute('list');
    },
    [props],
  );

  const completePlan = React.useCallback(
    async (plan: DivePlan) => {
      const timestamp = Date.now() / 1000;
      const savedPlan = await savePlan({
        ...plan,
        status: 'completed',
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      setRoute('detail');
      setSelectedId(savedPlan.localId);
      setLocalCompletedPromptPlan(savedPlan);
    },
    [savePlan],
  );

  const promotePlan = React.useCallback(
    async (plan: DivePlan) => {
      if (!isPlanReadyForPromotion(plan)) {
        openEdit(plan);
        return;
      }

      const savedPlan = await savePlan({
        ...plan,
        status: 'planned',
        updatedAt: Date.now() / 1000,
      });
      setRoute('detail');
      setSelectedId(savedPlan.localId);
    },
    [openEdit, savePlan],
  );

  const createLogFromPlan = React.useCallback(
    (plan: DivePlan) => {
      props.onCreateLogFromPlan?.(plan);
    },
    [props],
  );

  const registerEditorOffset = React.useCallback((event: { nativeEvent: { layout: { y: number } } }) => {
    editorOffsetRef.current = event.nativeEvent.layout.y;
  }, []);

  const registerEditorFieldOffset = React.useCallback((fieldName: string, y: number) => {
    editorFieldOffsetsRef.current = {
      ...editorFieldOffsetsRef.current,
      [fieldName]: y,
    };
  }, []);

  const scrollToEditorError = React.useCallback((fieldName: string) => {
    const measuredFieldOffset = editorFieldOffsetsRef.current[fieldName];
    const fallbackOffset = getPlanEditorFieldOffset(fieldName);
    const nextOffset = Math.max(0, measuredFieldOffset === undefined ? fallbackOffset : editorOffsetRef.current + measuredFieldOffset - 16);
    setLastScrollTarget(nextOffset);
    scrollViewRef.current?.scrollTo({ y: nextOffset, animated: true });
  }, []);

  return (
    <KeyboardAwareScrollView
      ref={scrollViewRef}
      className="flex-1 bg-background"
      contentContainerClassName="px-5 pt-4 pb-6"
      refreshControl={<RefreshControl refreshing={Boolean(props.isRefreshing)} onRefresh={props.onRefresh} tintColor="#0a84ff" />}
      contentInsetAdjustmentBehavior="automatic">
      <VStack space="lg">
        <VStack space="sm">
          <HStack className="items-center justify-between">
            <StatusPill label={t('status.planning', { defaultValue: 'Planning' })} />
            <StatusPill label={t('status.assist', { defaultValue: 'Assist' })} tone="secondary" />
          </HStack>
          <Text className="text-3xl font-semibold text-foreground">{t('planning.title')}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">{t('planning.subtitle')}</Text>
          {lastScrollTarget === undefined ? null : (
            <Text testID="planning-scroll-target" className="hidden">{`${lastScrollTarget}`}</Text>
          )}
        </VStack>

        {completedPromptPlan ? (
          <CompletionPrompt
            plan={completedPromptPlan}
            onLater={() => {
              if (props.onCompletedPromptLater) {
                props.onCompletedPromptLater();
                return;
              }

              setLocalCompletedPromptPlan(undefined);
            }}
            onCreateLog={() => {
              if (props.onCreateLogFromCompletedPlan) {
                props.onCreateLogFromCompletedPlan(completedPromptPlan);
                return;
              }

              createLogFromPlan(completedPromptPlan);
              setLocalCompletedPromptPlan(undefined);
            }}
          />
        ) : null}

        {(route === 'create' || route === 'edit') && draftPlan ? (
          <Box testID="planning-editor-card-anchor" onLayout={registerEditorOffset}>
            <PlanEditor
              plan={draftPlan}
              mode={route === 'edit' ? 'edit' : 'create'}
              isSaving={props.isSaving}
              saveError={props.saveError}
              onCancel={() => setRoute(route === 'edit' ? 'detail' : 'list')}
              onSave={savePlan}
              onFieldLayout={registerEditorFieldOffset}
              onInvalidSubmit={scrollToEditorError}
            />
          </Box>
        ) : null}

        {route === 'detail' && selectedPlan ? (
          <PlanDetail
            plan={selectedPlan}
            onBack={() => setRoute('list')}
            onEdit={openEdit}
            onPromote={promotePlan}
            onComplete={completePlan}
            onDelete={props.onDeletePlan ? deletePlan : undefined}
            onCreateLogFromPlan={createLogFromPlan}
            hasExistingConvertedLog={hasExistingConvertedLog(selectedPlan)}
          />
        ) : null}

        {route === 'list' ? (
          <VStack space="lg">
            <ActivePlanPanel plan={activePlan} locale={locale} onOpenPlan={openDetail} />
            <VStack space="md">
              <HStack className="items-center justify-between">
                <Text className="text-xl font-semibold text-foreground">{t('planning.planbook', { defaultValue: 'Planbook' })}</Text>
                <InstrumentButton
                  testID="planning-create-action"
                  label={t('planning.newPlan', { defaultValue: 'New plan' })}
                  icon={CalendarDaysIcon}
                  variant="primary"
                  onPress={openCreate}
                  className="min-h-10 px-4 py-2"
                />
              </HStack>
              <HStack space="xs" className="rounded-full bg-muted p-1">
                {(['all', 'draft', 'planned', 'completed'] as PlanFilter[]).map(nextFilter => (
                  <SelectorPill
                    key={nextFilter}
                    className="flex-1"
                    label={t(`planning.filters.${nextFilter}`, { defaultValue: nextFilter })}
                    selected={filter === nextFilter}
                    onPress={() => setFilter(nextFilter)}
                  />
                ))}
              </HStack>
              {props.isLoading ? (
                <PlanningLoadingState />
              ) : visiblePlans.length ? (
                <VStack space="md">
                  {visiblePlans.map(plan => (
                    <PlanRow key={plan.localId} plan={plan} locale={locale} onPress={() => openDetail(plan)} />
                  ))}
                </VStack>
              ) : (
                <EmptyPlanbook />
              )}
            </VStack>
          </VStack>
        ) : null}

        <InstrumentButton
          testID="planning-open-logbook-action"
          label={t('planning.openLogbook')}
          icon={ArrowRightIcon}
          iconPlacement="trailing"
          onPress={props.onOpenLogbook}
        />
        <SafetyText>{t('planning.safetyText')}</SafetyText>
      </VStack>
    </KeyboardAwareScrollView>
  );
}

function getPlanEditorFieldOffset(fieldName: string): number {
  const offsets: Record<string, number> = {
    title: 180,
    plannedAt: 260,
    diveMode: 360,
    siteName: 500,
    buddies: 600,
    gearIds: 600,
    tags: 700,
    objective: 780,
    plannedMaxDepthMeters: 900,
    plannedDurationMinutes: 900,
    plannedPressure: 1080,
    waterCondition: 1200,
    visibilityExpectation: 1280,
    perceivedDifficulty: 1360,
    trainingFocus: 1440,
    repetitionTarget: 1080,
    notes: 1520,
  };

  return offsets[fieldName] ?? 260;
}

function ActivePlanPanel(props: {
  plan: DivePlan | undefined;
  locale: string;
  onOpenPlan: (plan: DivePlan) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  if (!props.plan) {
    return (
      <DiveSummaryCard accent="secondary">
        <DiveSummaryCard.Header eyebrow={t('planning.activePlan', { defaultValue: 'Active plan' })} title={t('planning.noActivePlan', { defaultValue: 'No active plan' })} />
      </DiveSummaryCard>
    );
  }

  return (
    <DiveSummaryCard accent="secondary">
      <DiveSummaryCard.Header
        eyebrow={t('planning.activePlan', { defaultValue: 'Active plan' })}
        title={getPlanTitle(props.plan, t('planning.untitledPlan', { defaultValue: 'Untitled plan' }))}
        right={<StatusPill label={t(`planning.status.${props.plan.status}`, { defaultValue: props.plan.status })} tone={statusTone(props.plan.status)} />}
      />
      <DiveSummaryCard.Body>
        <DiveSummaryCard.Metric
          label={t('planning.site', { defaultValue: 'Site' })}
          value={props.plan.site.name ?? t('planning.chooseSite', { defaultValue: 'Choose site' })}
        />
        <DiveSummaryCard.Metric
          label={t('planning.plannedAt', { defaultValue: 'Planned date/time' })}
          value={formatDate(props.plan.plannedAt, props.locale, t('formatters.unknownDate', { defaultValue: 'Unknown date' }))}
        />
        <DiveSummaryCard.Metric
          label={t('planning.plannedMax', { defaultValue: 'Planned max' })}
          value={formatDepth(props.plan.plannedValues.plannedMaxDepthMeters)}
        />
      </DiveSummaryCard.Body>
      <DiveSummaryCard.Footer>
        <InstrumentButton
          testID="planning-active-open-action"
          label={t('planning.openPlan', { defaultValue: 'Open plan' })}
          icon={ChevronRightIcon}
          iconPlacement="trailing"
          variant="primary"
          onPress={() => props.onOpenPlan(props.plan!)}
        />
      </DiveSummaryCard.Footer>
    </DiveSummaryCard>
  );
}

function PlanRow(props: { plan: DivePlan; locale: string; onPress: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const siteName = props.plan.site.name ?? t('planning.untitledPlan', { defaultValue: 'Untitled plan' });
  const title = props.plan.title ?? siteName;

  return (
    <Pressable
      testID={`planning-plan-row-${siteName}`}
      onPress={props.onPress}
      className="rounded-2xl bg-card px-4 py-4"
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
      <VStack space="sm">
        <HStack className="items-center justify-between">
          <HStack space="md" className="flex-1 items-center pr-2.5">
            <Box
              testID={`planning-plan-row-${siteName}-icon`}
              className="h-9 w-9 items-center justify-center rounded-full bg-primary/10">
              <Icon as={CalendarDaysIcon} size="md" className="text-primary" />
            </Box>
            <VStack space="xs" className="flex-1">
              <Text className="text-lg font-semibold text-card-foreground">{title}</Text>
              <Text className="text-sm leading-5 text-muted-foreground">
                {siteName} · {formatDate(props.plan.plannedAt, props.locale, t('formatters.unknownDate', { defaultValue: 'Unknown date' }))}
              </Text>
            </VStack>
          </HStack>
          <StatusPill label={t(`planning.status.${props.plan.status}`, { defaultValue: props.plan.status })} tone={statusTone(props.plan.status)} />
        </HStack>
        <Text className="pl-5 text-sm leading-5 text-muted-foreground">
          {props.plan.diveMode ? t(`diveModes.${props.plan.diveMode}`) : t('diveModes.notSet')} ·{' '}
          {props.plan.entryStyle ? t(`entryStyles.${props.plan.entryStyle}`, { defaultValue: props.plan.entryStyle }) : t('logbook.none')}
        </Text>
      </VStack>
    </Pressable>
  );
}

function CompletionPrompt(props: { plan: DivePlan; onLater: () => void; onCreateLog: () => void }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <DiveSummaryCard variant="parchment">
      <VStack testID="planning-complete-dialog" space="md">
        <DiveSummaryCard.Header
          eyebrow={t('planning.completedPromptEyebrow', { defaultValue: 'Plan completed' })}
          title={t('planning.completedPromptTitle', { defaultValue: 'Create a log draft now?' })}
        />
        <Text className="text-sm leading-5 text-card-foreground">
          {t('planning.completedPromptBody', {
            defaultValue: 'The plan is marked completed. You can create a Logbook draft from safe metadata now or do it later.',
          })}
        </Text>
        <HStack space="sm">
          <InstrumentButton testID="planning-complete-later" className="flex-1" label={t('planning.later', { defaultValue: 'Later' })} onPress={props.onLater} />
          <InstrumentButton
            testID="planning-complete-create-log"
            className="flex-1"
            label={t('planning.createLogFromPlan', { defaultValue: 'Create log from plan' })}
            variant="primary"
            onPress={props.onCreateLog}
          />
        </HStack>
      </VStack>
    </DiveSummaryCard>
  );
}

function EmptyPlanbook(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <DiveSummaryCard>
      <VStack testID="planning-empty-state" space="lg">
        <DiveSummaryCard.Header eyebrow={t('planning.emptyEyebrow', { defaultValue: 'Empty' })} title={t('planning.noPlans', { defaultValue: 'No plans yet' })} />
      </VStack>
    </DiveSummaryCard>
  );
}

function PlanningLoadingState(): React.JSX.Element {
  return (
    <VStack testID="planning-loading-state" space="md">
      {[0, 1, 2].map(index => (
        <DiveSummaryCard key={index}>
          <VStack space="sm">
            <Skeleton className="h-5 w-44 rounded-full" />
            <SkeletonText _lines={2} className="h-4 rounded-full" />
          </VStack>
        </DiveSummaryCard>
      ))}
    </VStack>
  );
}

export function isPlanReadyForPromotion(plan: DivePlan): boolean {
  return Boolean(
    plan.plannedAt !== undefined &&
    plan.diveMode &&
    plan.site.name?.trim() &&
    plan.plannedValues.plannedMaxDepthMeters !== undefined &&
    plan.plannedValues.plannedDurationMinutes !== undefined,
  );
}

function selectActivePlan(plans: DivePlan[]): DivePlan | undefined {
  return plans.find(plan => plan.status === 'planned') ?? plans.find(plan => plan.status === 'draft') ?? plans[0];
}

function getPlanTitle(plan: DivePlan, fallback: string): string {
  return plan.title ?? plan.site.name ?? fallback;
}

const statusTone = (status: DivePlanStatus): InstrumentTone => {
  if (status === 'completed') {
    return 'primary';
  }

  if (status === 'planned') {
    return 'secondary';
  }

  return 'muted';
};
