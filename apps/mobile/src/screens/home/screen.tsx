import React from 'react';
import { useTranslation } from 'react-i18next';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { MOTION_TIMING } from '../../constants/motion';
import { useFirstLoadReveal } from '../../hooks/use-first-load-reveal';
import { Box } from '../../components/ui/box';
import { useGluestackColors } from '../../components/ui/gluestack-ui-provider';
import { Section, Row } from '../../components/ui/grouped-list';
import { HStack } from '../../components/ui/hstack';
import { AddIcon, CalendarDaysIcon } from '../../components/ui/icon';
import { InstrumentButton, SafetyText } from '../../components/ui/instrument';
import { Pressable } from '../../components/ui/pressable';
import { PressScalePressable } from '../../components/ui/press-scale';
import { RefreshControl } from '../../components/ui/refresh-control';
import { ScreenHeader } from '../../components/ui/screen-header';
import { ScrollView } from '../../components/ui/scroll-view';
import { SkeletonBlock, useContentLoading } from '../../components/ui/skeleton-block';
import { FadeInView } from '../../components/ui/fade-in-view';
import { appearEntering, fadeEntering } from '../../components/ui/motion-entering';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { type HomeConditionsProvider } from '../../conditions/home-conditions';
import { type LocationService } from '../../conditions/location-service';
import { createOpenMeteoHomeConditionsProvider } from '../../conditions/open-meteo-home-conditions-provider';
import { useHomeConditions } from '../../conditions/use-home-conditions';
import type { DiveLogEntry } from '../../types/dive-log-entry';
import type { DivePlan } from '../../types/dive-plan';
import type { MobileDiveSession } from '../../types/dive-session';
import { formatDateTimeParts } from '../common/form/date-time-field';
import { planTitle, selectNextPlan } from '../planning/plan-status';
import { HomeConditionsCard } from './conditions-card';
import { LatestLogCard, LatestLogEmptyCard, LatestLogErrorCard, LatestLogLoadingCard } from './latest-log-card';
import { hasHomeIntroPlayed, markHomeIntroPlayed } from './home-intro';

type HomeScreenProps = {
  sessions: MobileDiveSession[];
  /** The entry behind `sessions[0]`, so the latest log card can open its detail. */
  latestEntry?: DiveLogEntry;
  onOpenLog?: (entry: DiveLogEntry) => void;
  /** All plans; Home shows the nearest upcoming planned one. */
  plans?: DivePlan[];
  onOpenPlan?: (plan: DivePlan) => void;
  onCreateLog: () => void;
  onCreatePlan: () => void;
  onOpenLogin?: () => void;
  showLogin?: boolean;
  onRefresh: () => void | Promise<void>;
  isLoading?: boolean;
  isRefreshing?: boolean;
  /** The logbook read failed. With nothing on screen yet, Home shows an error card instead of the empty state. */
  loadError?: unknown;
  reselectToken?: number;
  conditionsProvider?: HomeConditionsProvider;
  locationService?: LocationService;
  openSettings?: () => Promise<void>;
  recovery?: {
    title: string;
    description: string;
    actionLabel: string;
    onPress: () => void;
  };
};

export default function HomeScreen(props: HomeScreenProps): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const recentSession = props.sessions[0];
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const conditionsProvider = React.useMemo(
    () => props.conditionsProvider ?? createOpenMeteoHomeConditionsProvider(),
    [props.conditionsProvider],
  );
  const conditionsController = useHomeConditions({
    locale,
    conditionsProvider,
    locationService: props.locationService,
    openSettings: props.openSettings,
  });
  const scrollViewRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const previousReselectToken = React.useRef(props.reselectToken ?? 0);
  const palette = useGluestackColors();
  const { latestEntry, onOpenLog, onOpenPlan, onRefresh, reselectToken } = props;
  const refreshConditions = conditionsController.refresh;
  const [isPullRefreshing, setIsPullRefreshing] = React.useState(false);

  // Loading, failed and empty are separate states; a failed refetch keeps what is already shown.
  const hasLogs = recentSession !== undefined;
  const isFirstLoad = Boolean(props.isLoading) && !hasLogs;
  const hasFirstLoadError = !isFirstLoad && !hasLogs && Boolean(props.loadError);
  const showLatestSkeleton = useContentLoading(isFirstLoad);
  // Not memoized on `plans`: the array keeps its identity across same-data refetches, and a plan
  // whose time has passed must drop off on the next render (foreground, refresh, tab change).
  const nextPlan = selectNextPlan(props.plans ?? [], Date.now() / 1000);
  const isEmpty = !isFirstLoad && !hasFirstLoadError && !hasLogs;
  const revealLatest = useFirstLoadReveal(isFirstLoad);

  // The intro belongs to the first Home mount in this JS runtime. Its blocks are decided on the first
  // render, and a block that appears later (such as the next dive row) only fades in.
  const reduceMotion = useReducedMotion();
  const [playsIntro] = React.useState(() => !hasHomeIntroPlayed());
  const [isFirstRender, setIsFirstRender] = React.useState(true);
  React.useEffect(() => {
    markHomeIntroPlayed();
    setIsFirstRender(false);
  }, []);
  const introEntering = (index: number) =>
    playsIntro && isFirstRender
      ? appearEntering(reduceMotion, reduceMotion ? 0 : index * MOTION_TIMING.stagger)
      : undefined;

  // Pull-to-refresh and tab reselect refresh the logbook and the conditions together.
  const refreshAll = React.useCallback(async () => {
    await Promise.allSettled([Promise.resolve().then(onRefresh), refreshConditions()]);
  }, [onRefresh, refreshConditions]);

  const handlePullRefresh = React.useCallback(async () => {
    setIsPullRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setIsPullRefreshing(false);
    }
  }, [refreshAll]);

  React.useEffect(() => {
    const token = reselectToken ?? 0;

    if (token === previousReselectToken.current) {
      return;
    }

    previousReselectToken.current = token;
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    void refreshAll();
  }, [refreshAll, reselectToken]);

  return (
    <ScrollView
      ref={scrollViewRef}
      className="flex-1 bg-background"
      contentContainerClassName="px-5 pt-4 pb-6"
      // The pull indicator follows the pull gesture only; a reselect or retry refresh keeps the
      // content on screen without a second spinner.
      refreshControl={
        <RefreshControl refreshing={isPullRefreshing} onRefresh={handlePullRefresh} tintColor={palette.primary} />
      }
      contentInsetAdjustmentBehavior="automatic">
      <VStack space="lg">
        <Animated.View entering={introEntering(0)}>
          <VStack space="xs" className="pt-2">
            <ScreenHeader
              title={t('home.title')}
              trailing={
                props.showLogin === true && props.onOpenLogin !== undefined ? (
                  <PressScalePressable
                    kind="control"
                    testID="home-login-action"
                    accessibilityLabel={t('home.login')}
                    accessibilityRole="button"
                    className="min-h-11 min-w-[52px] items-center justify-center bg-transparent px-1"
                    onPress={props.onOpenLogin}>
                    <Text className="text-base font-semibold text-primary">{t('home.login')}</Text>
                  </PressScalePressable>
                ) : undefined
              }
            />
            <HomeLogCount
              count={props.sessions.length}
              isLoading={isFirstLoad}
              showPlaceholder={showLatestSkeleton}
              hidden={hasFirstLoadError}
            />
          </VStack>
        </Animated.View>

        {props.recovery ? <HomeRecoveryCard {...props.recovery} /> : null}

        <Animated.View entering={introEntering(1)}>
          {isFirstLoad ? (
            <LatestLogLoadingCard visible={showLatestSkeleton} />
          ) : (
            // The card replaces the loading card once the first read lands; later reads never fade.
            <FadeInView animate={revealLatest}>
              {hasFirstLoadError ? (
                <LatestLogErrorCard isRetrying={Boolean(props.isRefreshing)} onRetry={onRefresh} />
              ) : recentSession ? (
                <VStack space="sm">
                  <LatestLogCard
                    session={recentSession}
                    entry={latestEntry}
                    locale={locale}
                    onOpen={latestEntry && onOpenLog ? () => onOpenLog(latestEntry) : undefined}
                  />
                  {props.loadError ? (
                    <Text testID="home-latest-refresh-failed" size="xs" className="px-1 leading-4 text-muted-foreground">
                      {t('home.refreshFailed')}
                    </Text>
                  ) : null}
                </VStack>
              ) : (
                <LatestLogEmptyCard onCreateLog={props.onCreateLog} />
              )}
            </FadeInView>
          )}
        </Animated.View>

        {nextPlan ? (
          <Animated.View entering={introEntering(2) ?? fadeEntering}>
            <Section title={t('home.nextPlan')}>
              <Row
                testID="home-next-plan-row"
                separated={false}
                icon={CalendarDaysIcon}
                label={planTitle(nextPlan, t)}
                detail={describeNextPlan(nextPlan, locale)}
                onPress={onOpenPlan ? () => onOpenPlan(nextPlan) : undefined}
              />
            </Section>
          </Animated.View>
        ) : null}

        {/* Quiet shortcuts; the tab bar already covers moving between tabs. The empty card above
            carries its own write action, so the line drops it there. */}
        <Animated.View entering={introEntering(3)}>
          <HStack space="sm">
            {isEmpty ? null : (
              <InstrumentButton
                testID="home-quick-create-log"
                label={t('home.createLog')}
                icon={AddIcon}
                className="flex-1"
                onPress={props.onCreateLog}
              />
            )}
            <InstrumentButton
              testID="home-quick-create-plan"
              label={t('home.createPlan')}
              icon={CalendarDaysIcon}
              className="flex-1"
              onPress={props.onCreatePlan}
            />
          </HStack>
        </Animated.View>

        <Animated.View entering={introEntering(4)}>
          <HomeConditionsCard
            snapshot={conditionsController.snapshot}
            isRefreshing={conditionsController.isRefreshing}
            refreshFailed={conditionsController.refreshFailed}
            locale={locale}
            onRetry={conditionsController.retry}
            onOpenSettings={conditionsController.openSettings}
          />
        </Animated.View>

        <SafetyText>{t('home.safetyText')}</SafetyText>
      </VStack>
    </ScrollView>
  );
}

/** The short summary under the title. While the first read runs it never shows a fake 0. */
function HomeLogCount(props: {
  count: number;
  isLoading: boolean;
  showPlaceholder: boolean;
  hidden: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation();

  if (props.hidden) {
    return null;
  }

  if (props.isLoading) {
    return <SkeletonBlock testID="home-log-count-loading" visible={props.showPlaceholder} className="my-0.5 h-4 w-16" />;
  }

  return (
    <Text testID="home-log-count" className="text-sm text-muted-foreground">
      {t('home.logCount', { count: props.count })}
    </Text>
  );
}

function HomeRecoveryCard(
  props: NonNullable<HomeScreenProps['recovery']>,
): React.JSX.Element {
  return (
    <Pressable
      testID="home-recovery-banner"
      accessibilityRole="button"
      accessibilityLabel={`${props.title}. ${props.actionLabel}`}
      className="rounded-2xl bg-card px-4 py-4 active:bg-muted"
      onPress={props.onPress}>
      <HStack space="md" className="items-start">
        <Box className="mt-1.5 h-2.5 w-2.5 rounded-full bg-warning" />
        <VStack space="xs" className="flex-1">
          <Text size="sm" bold className="text-card-foreground">
            {props.title}
          </Text>
          <Text size="xs" className="leading-5 text-muted-foreground">
            {props.description}
          </Text>
          <Text size="sm" bold className="pt-1 text-primary">
            {props.actionLabel}
          </Text>
        </VStack>
      </HStack>
    </Pressable>
  );
}

/** The same date line as the plan list row, so one plan reads the same on both screens. */
function describeNextPlan(plan: DivePlan, locale: string): string {
  const parts = plan.plannedAt === undefined ? undefined : formatDateTimeParts(new Date(plan.plannedAt * 1000), locale);
  const date = parts ? `${parts.date} ${parts.time}` : '--';
  const siteName = plan.site.name?.trim();

  // The site is the row label when the plan has no title, so it is not repeated here.
  return plan.title && siteName ? `${date} · ${siteName}` : date;
}
