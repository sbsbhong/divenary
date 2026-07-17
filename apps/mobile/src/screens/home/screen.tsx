import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '../../components/ui/box';
import { Button, ButtonIcon, ButtonSpinner } from '../../components/ui/button';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { InstrumentButton, SafetyText } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import {
  AlertCircleIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  Icon,
  MapPinIcon,
  RepeatIcon,
  SettingsIcon,
  SunIcon,
  WavesIcon,
} from '../../components/ui/icon';
import { RefreshControl } from '../../components/ui/refresh-control';
import { ScrollView } from '../../components/ui/scroll-view';
import { Skeleton, SkeletonText } from '../../components/ui/skeleton';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { SessionProfile } from '../../components/ui/session-profile';
import { type HomeConditionsProvider, type HomeConditionsSnapshot } from '../../conditions/home-conditions';
import { type LocationService } from '../../conditions/location-service';
import { createOpenMeteoHomeConditionsProvider } from '../../conditions/open-meteo-home-conditions-provider';
import { useHomeConditions } from '../../conditions/use-home-conditions';
import type { MobileDiveSession } from '../../types/dive-session';
import { formatDate, formatDepth, formatDuration, formatTemperature } from '../../utils/dive-formatters';
import { getSessionDurationSeconds, getSessionMaxDepthMeters } from '../../utils/session-summary';

type HomeScreenProps = {
  sessions: MobileDiveSession[];
  onOpenLogbook: () => void;
  onOpenPlanning: () => void;
  onOpenLogin?: () => void;
  showLogin?: boolean;
  onRefresh: () => void | Promise<void>;
  isLoading?: boolean;
  isRefreshing?: boolean;
  reselectToken?: number;
  conditionsProvider?: HomeConditionsProvider;
  locationService?: LocationService;
  openSettings?: () => Promise<void>;
};

export default function HomeScreen(props: HomeScreenProps): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const recentSession = props.sessions[0];
  const recentMaxDepthMeters = recentSession ? getSessionMaxDepthMeters(recentSession) : undefined;
  const recentDurationSeconds = recentSession ? getSessionDurationSeconds(recentSession) : undefined;
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

  React.useEffect(() => {
    const reselectToken = props.reselectToken ?? 0;

    if (reselectToken === previousReselectToken.current) {
      return;
    }

    previousReselectToken.current = reselectToken;
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    void props.onRefresh();
  }, [props]);

  return (
    <ScrollView
      ref={scrollViewRef}
      className="flex-1 bg-background"
      contentContainerClassName="px-5 pt-4 pb-6"
      refreshControl={<RefreshControl refreshing={Boolean(props.isRefreshing)} onRefresh={props.onRefresh} tintColor="#0a84ff" />}
      contentInsetAdjustmentBehavior="automatic">
      <VStack space="lg">
        <VStack space="md" className="pt-2">
          <HStack className="items-start justify-between">
            <Text className="text-4xl font-semibold leading-10 text-foreground">Divenary</Text>
            {props.showLogin === true && props.onOpenLogin !== undefined ? (
              <InstrumentButton
                testID="home-login-action"
                label={t('home.login')}
                className="px-4 py-2"
                onPress={props.onOpenLogin}
                variant="primary"
              />
            ) : null}
          </HStack>
          <HStack space="xs" className="items-baseline">
            <Text className="text-2xl font-semibold text-primary">{props.sessions.length}</Text>
            <Text className="text-sm font-semibold text-muted-foreground">{t('home.logsImported')}</Text>
          </HStack>
        </VStack>

        <HomeConditionsBand
          snapshot={conditionsController.snapshot}
          isRefreshing={conditionsController.isRefreshing}
          locale={locale}
          onRetry={conditionsController.retry}
          onOpenSettings={conditionsController.openSettings}
        />

        {props.isLoading ? (
          <LatestLogLoadingCard />
        ) : recentSession ? (
          <LatestLogCard
            session={recentSession}
            locale={locale}
            recentMaxDepthMeters={recentMaxDepthMeters}
            recentDurationSeconds={recentDurationSeconds}
          />
        ) : (
          <LatestLogEmptyCard />
        )}

        <VStack space="md">
          <InstrumentButton
            testID="home-open-logbook-action"
            label={t('home.openLogbook')}
            icon={ChevronRightIcon}
            iconPlacement="trailing"
            variant="primary"
            onPress={props.onOpenLogbook}
          />
          <InstrumentButton
            testID="home-open-planning-action"
            label={t('home.planNextDive')}
            icon={CalendarDaysIcon}
            onPress={props.onOpenPlanning}
          />
        </VStack>

        <SafetyText>{t('home.safetyText')}</SafetyText>
      </VStack>
    </ScrollView>
  );
}

function LatestLogLoadingCard(): React.JSX.Element {
  return (
    <DiveSummaryCard>
      <VStack testID="home-latest-loading-state" space="md">
        <Skeleton className="h-4 w-28 rounded-full" />
        <Skeleton className="h-7 w-44 rounded-full" />
        <SkeletonText _lines={3} className="h-4 rounded-full" />
      </VStack>
    </DiveSummaryCard>
  );
}

function LatestLogEmptyCard(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <DiveSummaryCard>
      <VStack testID="home-latest-empty-state" space="md">
        <DiveSummaryCard.Header eyebrow={t('home.latestLog')} title={t('home.noRecentLog')} />
      </VStack>
    </DiveSummaryCard>
  );
}

function LatestLogCard(props: {
  session: MobileDiveSession;
  locale: string;
  recentMaxDepthMeters: number | undefined;
  recentDurationSeconds: number | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <DiveSummaryCard>
      <DiveSummaryCard.Header
        eyebrow={t('home.latestLog')}
        title={props.session.siteName ?? t('home.noRecentLog')}
      />
      <DiveSummaryCard.Body>
        <DiveSummaryCard.Metric
          label={t('home.date')}
          value={formatDate(props.session.startedAt, props.locale, t('formatters.unknownDate'))}
        />
        <SessionProfile samples={props.session.samples ?? []} kind="depth" title={t('home.depthProfile')} />
        <HStack space="md">
          <MetricTile label={t('home.maxDepth')} value={formatDepth(props.recentMaxDepthMeters)} />
          <MetricTile label={t('home.bottomTime')} value={formatOptionalDuration(props.recentDurationSeconds)} />
        </HStack>
      </DiveSummaryCard.Body>
    </DiveSummaryCard>
  );
}

function HomeConditionsBand(props: {
  snapshot: HomeConditionsSnapshot;
  isRefreshing: boolean;
  locale: string;
  onRetry: () => void;
  onOpenSettings: () => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const snapshot = props.snapshot;

  if (snapshot.status === 'loading' || snapshot.status === 'idle') {
    return <HomeConditionsLoadingCard />;
  }

  if (snapshot.status === 'permissionDenied') {
    return (
      <DiveSummaryCard>
        <VStack space="md">
          <HStack space="sm" className="items-start">
            <Box className="mt-0.5 h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Icon as={AlertCircleIcon} size="sm" className="text-primary" />
            </Box>
            <VStack space="xs" className="flex-1">
              <Text testID="home-conditions-permission-denied" className="text-base font-semibold text-card-foreground">
                {t('home.conditions.permissionDenied')}
              </Text>
              <Text testID="home-conditions-permission-denied-body" className="text-sm leading-5 text-muted-foreground">
                {t('home.conditions.permissionDeniedBody')}
              </Text>
            </VStack>
          </HStack>
          <HStack space="sm">
            <InstrumentButton
              testID="home-conditions-open-settings-action"
              label={t('home.conditions.openSettings')}
              icon={SettingsIcon}
              className="flex-1"
              onPress={props.onOpenSettings}
            />
            <InstrumentButton
              testID="home-conditions-retry-action"
              label={t('home.conditions.tryAgain')}
              icon={RepeatIcon}
              className="flex-1"
              onPress={props.onRetry}
            />
          </HStack>
        </VStack>
      </DiveSummaryCard>
    );
  }

  if (snapshot.status !== 'ready') {
    const isError = snapshot.status === 'error';

    return (
      <DiveSummaryCard>
        <VStack space="md">
          <Text testID="home-conditions-unavailable" className="text-base font-semibold text-card-foreground">
            {t(isError ? 'home.conditions.apiError' : 'home.conditions.unavailable')}
          </Text>
          <InstrumentButton
            testID="home-conditions-retry-action"
            label={t('home.conditions.tryAgain')}
            icon={RepeatIcon}
            onPress={props.onRetry}
          />
        </VStack>
      </DiveSummaryCard>
    );
  }

  const showsWaterTemperature = snapshot.isCoastal !== false && snapshot.waterTemperatureCelsius !== undefined;

  return (
    <DiveSummaryCard>
      <VStack space="md">
        <HStack className="items-start justify-between" space="md">
          <HStack space="sm" className="flex-1 items-start">
            <Box testID="home-conditions-location-icon" className="mt-0.5 h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Icon as={MapPinIcon} size="sm" className="text-primary" />
            </Box>
            <VStack space="xs" className="flex-1">
              <Text testID="home-conditions-city" className="text-xl font-semibold leading-7 text-card-foreground">
                {snapshot.cityName ?? t('home.conditions.currentLocation')}
              </Text>
              <Text testID="home-conditions-local-time" size="sm" className="text-muted-foreground">
                {formatConditionsTime(snapshot.localTime, props.locale)}
              </Text>
            </VStack>
          </HStack>
          <HStack space="xs" className="items-center">
            <Button
              testID="home-conditions-refresh-action"
              accessibilityLabel={props.isRefreshing ? t('home.conditions.refreshing') : t('home.conditions.refresh')}
              accessibilityState={{ busy: props.isRefreshing, disabled: props.isRefreshing }}
              variant="secondary"
              size="icon"
              disabled={props.isRefreshing}
              className="rounded-full bg-muted"
              onPress={props.onRetry}>
              {props.isRefreshing ? (
                <ButtonSpinner testID="home-conditions-refresh-spinner" color="#0a84ff" />
              ) : (
                <ButtonIcon as={RepeatIcon} className="text-primary" />
              )}
            </Button>
          </HStack>
        </HStack>
        {props.isRefreshing ? (
          <HomeConditionsMetricsSkeleton />
        ) : (
          <>
            <HStack space="md">
              <ConditionMetricTile
                testID="home-conditions-air-tile"
                label={t('home.conditions.airTemperature')}
                value={formatTemperature(snapshot.airTemperatureCelsius)}
                valueTestID="home-conditions-air-temperature"
                icon={SunIcon}
                tone="muted"
              />
              {showsWaterTemperature ? (
                <ConditionMetricTile
                  testID="home-conditions-water-tile"
                  label={t('home.conditions.waterTemperature')}
                  value={formatTemperature(snapshot.waterTemperatureCelsius)}
                  valueTestID="home-conditions-water-temperature"
                  icon={WavesIcon}
                  tone="primary"
                />
              ) : (
                <VStack className="flex-1 justify-center rounded-2xl bg-muted px-4 py-4">
                  <Text testID="home-conditions-water-unavailable" className="text-sm leading-5 text-muted-foreground">
                    {t('home.conditions.waterUnavailable')}
                  </Text>
                </VStack>
              )}
            </HStack>

            <Text testID="home-conditions-updated" size="xs" className="text-muted-foreground">
              {t('home.conditions.updatedAt', {
                time: formatConditionsTime(snapshot.updatedAt, props.locale),
              })}
            </Text>
          </>
        )}
      </VStack>
    </DiveSummaryCard>
  );
}

function HomeConditionsLoadingCard(): React.JSX.Element {
  return (
    <DiveSummaryCard>
      <VStack testID="home-conditions-loading" space="md">
        <HStack className="items-start justify-between" space="md">
          <HStack space="sm" className="flex-1 items-start">
            <Skeleton className="mt-0.5 h-9 w-9 rounded-full" />
            <VStack space="xs" className="flex-1">
              <Skeleton className="h-6 w-32 rounded-full" />
              <Skeleton className="h-4 w-16 rounded-full" />
            </VStack>
          </HStack>
          <Skeleton className="h-9 w-9 rounded-full" />
        </HStack>
        <HomeConditionsMetricsSkeleton />
      </VStack>
    </DiveSummaryCard>
  );
}

function HomeConditionsMetricsSkeleton(): React.JSX.Element {
  return (
    <VStack testID="home-conditions-refreshing-skeleton" space="md">
      <HStack space="md">
        <VStack className="flex-1 rounded-2xl bg-muted px-4 py-4">
          <Skeleton className="h-4 w-16 rounded-full" />
          <Skeleton className="mt-5 h-8 w-24 rounded-full" />
        </VStack>
        <VStack className="flex-1 rounded-2xl bg-primary/10 px-4 py-4">
          <Skeleton className="h-4 w-16 rounded-full" />
          <Skeleton className="mt-5 h-8 w-24 rounded-full" />
        </VStack>
      </HStack>
      <Skeleton className="h-4 w-36 rounded-full" />
    </VStack>
  );
}

function ConditionMetricTile(props: {
  label: string;
  value: string;
  valueTestID?: string;
  icon: React.ElementType;
  tone: 'muted' | 'primary';
  testID?: string;
}): React.JSX.Element {
  const tileClassName =
    props.tone === 'primary'
      ? 'flex-1 rounded-2xl bg-primary/10 px-4 py-4'
      : 'flex-1 rounded-2xl bg-muted px-4 py-4';
  const iconClassName = props.tone === 'primary' ? 'text-primary' : 'text-muted-foreground';
  const labelClassName =
    props.tone === 'primary'
      ? 'text-xs font-semibold uppercase text-primary'
      : 'text-xs font-semibold uppercase text-muted-foreground';

  return (
    <Box testID={props.testID} className={tileClassName}>
      <VStack space="sm">
        <HStack className="items-center justify-between">
          <Text className={labelClassName}>{props.label}</Text>
          <Box testID={props.testID ? `${props.testID}-icon` : undefined} className="h-7 w-7 items-center justify-center rounded-full bg-card">
            <Icon as={props.icon} size="xs" className={iconClassName} />
          </Box>
        </HStack>
        <Text testID={props.valueTestID} className="text-2xl font-semibold text-card-foreground">
          {props.value}
        </Text>
      </VStack>
    </Box>
  );
}

function MetricTile(props: { label: string; value: string; valueTestID?: string }): React.JSX.Element {
  return (
    <VStack space="xs" className="flex-1 rounded-2xl bg-muted px-4 py-4">
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</Text>
      <Text testID={props.valueTestID} className="text-2xl font-semibold text-card-foreground">{props.value}</Text>
    </VStack>
  );
}

function formatConditionsTime(seconds: number | undefined, locale: string): string {
  if (!seconds) {
    return '--:--';
  }

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(seconds * 1000));
}

function formatOptionalDuration(seconds: number | undefined): string {
  return seconds === undefined ? '--:--' : formatDuration(seconds);
}
