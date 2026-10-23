import type { TFunction } from 'i18next';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '../../components/ui/box';
import { useGluestackColors } from '../../components/ui/gluestack-ui-provider';
import { Row, Section } from '../../components/ui/grouped-list';
import { HStack } from '../../components/ui/hstack';
import { AddIcon, CalendarDaysIcon, ChevronRightIcon, Icon } from '../../components/ui/icon';
import { InstrumentButton, SafetyText, SelectorPill, StatusPill } from '../../components/ui/instrument';
import { ListStateCard } from '../../components/ui/list-state-card';
import { ListStatusBadge } from '../../components/ui/list-status-badge';
import { PressScalePressable } from '../../components/ui/press-scale';
import { RefreshControl } from '../../components/ui/refresh-control';
import { ScreenHeader } from '../../components/ui/screen-header';
import { ScrollView } from '../../components/ui/scroll-view';
import { FadeInView } from '../../components/ui/fade-in-view';
import { SkeletonBlock, useContentLoading } from '../../components/ui/skeleton-block';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { DivePlan, DivePlanStatus } from '../../types/dive-plan';
import { useFirstLoadReveal } from '../../hooks/use-first-load-reveal';
import { formatDateTimeParts } from '../common/form/date-time-field';
import { isPlanDatePassed, planTitle, selectNextPlan } from './plan-status';

type PlanningScreenProps = {
  plans?: DivePlan[];
  loadError?: Error | null;
  onRefresh: () => void | Promise<void>;
  isLoading?: boolean;
  /** A requested refresh is running. The retry button shows it; the pull spinner follows the gesture only. */
  isRefreshing?: boolean;
  reselectToken?: number;
  onCreatePlan: () => void;
  onOpenPlan: (plan: DivePlan) => void;
  onOpenLogbook: () => void;
  isAuthenticated?: boolean;
};

type PlanFilter = 'all' | DivePlanStatus;

const PLAN_FILTERS: PlanFilter[] = ['all', 'draft', 'planned', 'completed'];

/**
 * The planbook list. Create, detail and edit are root stack routes; this screen only lists plans,
 * with a 다음 다이빙 summary while an upcoming planned dive exists.
 */
export default function PlanningScreen(props: PlanningScreenProps): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const palette = useGluestackColors();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const plans = React.useMemo(() => props.plans ?? [], [props.plans]);
  const [filter, setFilter] = React.useState<PlanFilter>('all');
  const scrollViewRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const previousReselectToken = React.useRef(props.reselectToken ?? 0);
  const { onRefresh, reselectToken } = props;
  const visiblePlans = React.useMemo(() => (filter === 'all' ? plans : plans.filter(plan => plan.status === filter)), [filter, plans]);
  const nextPlan = React.useMemo(() => selectNextPlan(plans, Date.now() / 1000), [plans]);

  // First load, first-load failure, empty and filtered-out are separate states. A failed refetch
  // keeps the plans already on screen.
  const hasPlans = plans.length > 0;
  const isFirstLoad = Boolean(props.isLoading) && !hasPlans;
  const hasFirstLoadError = !isFirstLoad && !hasPlans && Boolean(props.loadError);
  const showSkeleton = useContentLoading(isFirstLoad);
  const revealPlans = useFirstLoadReveal(isFirstLoad);
  // The pull spinner belongs to the pull gesture. A tab reselect or a retry refreshes with the
  // content kept on screen and no second spinner.
  const [isPullRefreshing, setIsPullRefreshing] = React.useState(false);
  const pullToRefresh = React.useCallback(async () => {
    setIsPullRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsPullRefreshing(false);
    }
  }, [onRefresh]);

  React.useEffect(() => {
    const token = reselectToken ?? 0;

    if (token === previousReselectToken.current) {
      return;
    }

    previousReselectToken.current = token;
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    onRefresh();
  }, [onRefresh, reselectToken]);

  return (
    <ScrollView
      ref={scrollViewRef}
      className="flex-1 bg-background"
      contentContainerClassName="px-5 pt-4 pb-6"
      refreshControl={<RefreshControl refreshing={isPullRefreshing} onRefresh={pullToRefresh} tintColor={palette.primary} />}
      contentInsetAdjustmentBehavior="automatic">
      <VStack space="lg">
        <VStack className="pt-2">
          <ScreenHeader
            title={t('planning.title')}
            titleTestID="planning-title"
            trailing={
              <InstrumentButton
                testID="planning-create-action"
                label={t('planning.newPlan')}
                icon={AddIcon}
                variant="primary"
                onPress={props.onCreatePlan}
                className="min-h-11 px-4 py-2"
              />
            }
          />
        </VStack>

        {nextPlan ? (
          <Section title={t('planning.nextDive')}>
            <Row
              testID="planning-next-plan-row"
              label={planTitle(nextPlan, t)}
              detail={describePlan(nextPlan, locale)}
              separated={false}
              onPress={() => props.onOpenPlan(nextPlan)}
            />
          </Section>
        ) : null}

        <VStack space="md">
          <HStack space="xs" className="rounded-full bg-muted p-1">
            {PLAN_FILTERS.map(nextFilter => (
              <SelectorPill
                key={nextFilter}
                testID={`planning-filter-${nextFilter}`}
                className="flex-1"
                label={t(`planning.filters.${nextFilter}`)}
                selected={filter === nextFilter}
                onPress={() => setFilter(nextFilter)}
              />
            ))}
          </HStack>

          {hasPlans && props.loadError ? (
            <Text testID="planning-refresh-error" className="px-1 text-sm leading-5 text-muted-foreground">
              {t('planning.refreshFailed')}
            </Text>
          ) : null}

          {isFirstLoad ? (
            <PlanListSkeleton visible={showSkeleton} />
          ) : (
            // The list replaces the skeleton once; a later refetch or filter change never fades.
            <FadeInView animate={revealPlans}>
              {hasFirstLoadError ? (
                <ListStateCard
                  testID="planning-error-state"
                  title={t('planning.loadFailed')}
                  message={t('planning.loadFailedMessage')}
                  actionLabel={t('common.retry')}
                  actionPending={Boolean(props.isRefreshing)}
                  onAction={() => {
                    onRefresh();
                  }}
                />
              ) : !hasPlans ? (
                <ListStateCard testID="planning-empty-state" title={t('planning.noPlans')} message={t('planning.noPlansMessage')} />
              ) : !visiblePlans.length ? (
                <ListStateCard
                  testID="planning-filter-empty-state"
                  title={t('planning.noFilteredPlans')}
                  actionLabel={t('planning.showAllPlans')}
                  onAction={() => setFilter('all')}
                />
              ) : (
                <VStack space="sm">
                  {visiblePlans.map(plan => (
                    <PlanRow
                      key={plan.localId}
                      plan={plan}
                      locale={locale}
                      showsDeviceOnlyBadge={Boolean(props.isAuthenticated && plan.ownerUserId === undefined)}
                      onPress={() => props.onOpenPlan(plan)}
                    />
                  ))}
                </VStack>
              )}
            </FadeInView>
          )}
        </VStack>

        <VStack space="md" className="items-center">
          <PressScalePressable
            kind="control"
            testID="planning-open-logbook-action"
            accessibilityRole="button"
            onPress={props.onOpenLogbook}
            className="min-h-11 justify-center px-3">
            <Text className="text-sm font-semibold text-primary">{t('planning.openLogbook')}</Text>
          </PressScalePressable>
          <SafetyText>{t('planning.safetyText')}</SafetyText>
        </VStack>
      </VStack>
    </ScrollView>
  );
}

function describePlan(plan: DivePlan, locale: string): string {
  const date = describePlanDate(plan, locale);
  const siteName = plan.site.name?.trim();

  // The site is the row title when the plan has no title, so it is not repeated here.
  return plan.title && siteName ? `${date} · ${siteName}` : date;
}

function describePlanDate(plan: DivePlan, locale: string): string {
  if (plan.plannedAt === undefined) {
    return '--';
  }

  const parts = formatDateTimeParts(new Date(plan.plannedAt * 1000), locale);
  return `${parts.date} ${parts.time}`;
}

/** Draft and completed say so; a planned dive whose day is over says 날짜 지남. Upcoming plans need no chip. */
function planRowChip(plan: DivePlan, t: TFunction): string | undefined {
  if (plan.status !== 'planned') {
    return t(`planning.status.${plan.status}`);
  }

  return isPlanDatePassed(plan) ? t('planning.datePassed') : undefined;
}

function PlanRow(props: {
  plan: DivePlan;
  locale: string;
  showsDeviceOnlyBadge: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const title = planTitle(props.plan, t);
  const subtitle = describePlan(props.plan, props.locale);
  const chip = planRowChip(props.plan, t);
  const modeLabel = props.plan.diveMode ? t(`diveModes.${props.plan.diveMode}`) : undefined;
  const accessibilityLabel = [
    title,
    subtitle,
    props.showsDeviceOnlyBadge ? t('accountClaim.deviceBadge') : undefined,
    chip,
    modeLabel,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <PressScalePressable
      kind="card"
      testID={`planning-plan-row-${props.plan.localId}`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={props.onPress}
      className="rounded-2xl bg-card px-4 py-3">
      <HStack space="md" className="min-h-12 items-center">
        <Box className="h-9 w-9 items-center justify-center rounded-full bg-muted">
          <Icon as={CalendarDaysIcon} className="text-muted-foreground" />
        </Box>
        <VStack space="xs" className="flex-1">
          <Text className="text-base font-semibold text-card-foreground" numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-sm leading-5 text-muted-foreground" numberOfLines={1}>
            {subtitle}
          </Text>
          {props.showsDeviceOnlyBadge ? (
            <ListStatusBadge
              testID={`planning-device-badge-${props.plan.localId}`}
              kind="device"
              label={t('accountClaim.deviceBadge')}
            />
          ) : null}
        </VStack>
        {chip ? <StatusPill testID={`planning-plan-row-${props.plan.localId}-chip`} label={chip} tone="muted" /> : null}
        <Icon as={ChevronRightIcon} className="text-muted-foreground" />
      </HStack>
    </PressScalePressable>
  );
}

/** Three rows shaped like `PlanRow`, reserved at their final size and shown only after the shared delay. */
function PlanListSkeleton(props: { visible: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const surface = props.visible ? 'rounded-2xl bg-card px-4 py-3' : 'rounded-2xl px-4 py-3';

  return (
    <VStack
      testID="planning-loading-state"
      space="sm"
      accessible={props.visible}
      accessibilityLabel={props.visible ? t('planning.loadingPlans') : undefined}
      accessibilityState={{ busy: true }}>
      {[0, 1, 2].map(index => (
        <HStack key={index} space="md" className={`min-h-12 items-center ${surface}`}>
          <Box className="h-9 w-9">
            <SkeletonBlock visible={props.visible} className="h-9 rounded-full" />
          </Box>
          <VStack space="xs" className="flex-1">
            <Box className="w-1/2">
              <SkeletonBlock visible={props.visible} className="h-5" />
            </Box>
            <Box className="w-2/3">
              <SkeletonBlock visible={props.visible} />
            </Box>
          </VStack>
        </HStack>
      ))}
    </VStack>
  );
}
