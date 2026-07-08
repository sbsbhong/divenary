import React from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertIcon, AlertText } from '../../components/ui/alert';
import { Box } from '../../components/ui/box';
import { Button, ButtonIcon, ButtonText } from '../../components/ui/button';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { InstrumentButton, SafetyText, StatusPill } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import {
  AlertCircleIcon,
  BellIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  GlobeIcon,
  Icon,
  MapPinIcon,
  RepeatIcon,
  SettingsIcon,
  SunIcon,
  WavesIcon,
} from '../../components/ui/icon';
import { Menu, MenuItem, MenuItemLabel } from '../../components/ui/menu';
import { RefreshControl } from '../../components/ui/refresh-control';
import { ScrollView } from '../../components/ui/scroll-view';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { SessionProfile } from '../../components/ui/session-profile';
import { type HomeConditionsProvider, type HomeConditionsSnapshot } from '../../conditions/home-conditions';
import { type LocationService } from '../../conditions/location-service';
import { createOpenMeteoHomeConditionsProvider } from '../../conditions/open-meteo-home-conditions-provider';
import { useHomeConditions } from '../../conditions/use-home-conditions';
import { supportedLanguages, type SupportedLanguage } from '../../i18n';
import { useAppPreferences } from '../../states/app-preferences';
import type { MobileDiveSession } from '../../types/dive-session';
import { toVisibleRecentSessionSyncStatus } from '../../utils/dive-log-sync-status';
import { formatDate, formatDepth, formatDuration, formatTemperature } from '../../utils/dive-formatters';
import { getSessionDurationSeconds, getSessionMaxDepthMeters } from '../../utils/session-summary';

type HomeScreenProps = {
  sessions: MobileDiveSession[];
  onOpenLogbook: () => void;
  onOpenPlanning: () => void;
  onRefresh: () => void | Promise<void>;
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
  const syncStatus = toVisibleRecentSessionSyncStatus(recentSession?.syncStatus);
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
            <StatusPill label={t('status.watchAssistant')} />
            <LanguageMenu />
          </HStack>
          <Text className="text-4xl font-semibold leading-10 text-foreground">DiveMobile</Text>
          <Text className="text-base leading-6 text-muted-foreground">{t('home.subtitle')}</Text>
          <HStack space="xs" className="items-baseline">
            <Text className="text-2xl font-semibold text-primary">{props.sessions.length}</Text>
            <Text className="text-sm font-semibold text-muted-foreground">{t('home.logsImported')}</Text>
          </HStack>
        </VStack>

        <HomeConditionsBand
          snapshot={conditionsController.snapshot}
          locale={locale}
          onRetry={conditionsController.retry}
          onOpenSettings={conditionsController.openSettings}
        />

        <DiveSummaryCard>
          <DiveSummaryCard.Header
            eyebrow={t('home.latestWatchImport')}
            title={recentSession?.siteName ?? t('home.importWatchDive')}
            right={<StatusPill label={t(`status.${syncStatus}`, { defaultValue: syncStatus })} tone="secondary" />}
          />
          <DiveSummaryCard.Body>
            <DiveSummaryCard.Metric
              label={t('home.date')}
              value={formatDate(recentSession?.startedAt, locale, t('formatters.unknownDate'))}
            />
            <SessionProfile samples={recentSession?.samples ?? []} kind="depth" title={t('home.depthProfile')} />
            <HStack space="md">
              <MetricTile label={t('home.maxDepth')} value={formatDepth(recentMaxDepthMeters)} />
              <MetricTile label={t('home.bottomTime')} value={formatOptionalDuration(recentDurationSeconds)} />
            </HStack>
          </DiveSummaryCard.Body>
        </DiveSummaryCard>

        <Alert testID="home-reminder-alert" className="rounded-2xl border-border bg-card px-4 py-4">
          <Box testID="home-reminder-alert-icon" className="mt-0.5 h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <AlertIcon as={BellIcon} className="text-primary" />
          </Box>
          <AlertText className="leading-5 text-card-foreground">
            <Text className="text-base font-semibold text-card-foreground">{t('home.watchReminderStatus')}</Text>
            {'\n'}
            <Text className="text-sm leading-5 text-muted-foreground">{t('home.reminderReview')}</Text>
            {'\n'}
            <Text className="text-xs font-semibold uppercase leading-5 text-muted-foreground">
              {t('home.ascent')}: {t('home.reviewOnly')} · {t('home.safetyStop')}: {t('home.planningReminder')}
            </Text>
          </AlertText>
        </Alert>

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

function LanguageMenu(): React.JSX.Element {
  const { t } = useTranslation();
  const { language, setLanguage } = useAppPreferences();
  const [isOpen, setIsOpen] = React.useState(false);
  const activeLabel = getLanguageLabel(language, t);

  const handleSelectLanguage = React.useCallback(
    async (nextLanguage: SupportedLanguage) => {
      await setLanguage(nextLanguage);
      setIsOpen(false);
    },
    [setLanguage],
  );

  return (
    <Menu
      placement="bottom right"
      offset={4}
      closeOnSelect
      onOpen={() => setIsOpen(true)}
      onClose={() => setIsOpen(false)}
      trigger={({ ...triggerProps }) => (
        <Button
          {...triggerProps}
          testID="language-menu-trigger"
          accessibilityLabel={t(isOpen ? 'language.closeMenu' : 'language.openMenu')}
          variant="secondary"
          size="sm"
          className="rounded-full">
          <ButtonIcon as={GlobeIcon} className="text-primary" />
          <ButtonText className="text-sm font-semibold text-primary">{activeLabel}</ButtonText>
        </Button>
      )}>
      {supportedLanguages.map(option => {
        const isSelected = language === option;
        const optionLabel = getLanguageLabel(option, t);

        return (
          <MenuItem
            key={option}
            testID={`language-menu-option-${option}`}
            textValue={optionLabel}
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={t('language.switchTo', { language: optionLabel })}
            className={isSelected ? 'bg-primary' : 'bg-transparent'}
            onPress={() => handleSelectLanguage(option)}>
            <MenuItemLabel className={isSelected ? 'font-semibold text-primary-foreground' : 'font-semibold text-popover-foreground'}>
              {optionLabel}
            </MenuItemLabel>
          </MenuItem>
        );
      })}
    </Menu>
  );
}

function getLanguageLabel(language: SupportedLanguage, t: ReturnType<typeof useTranslation>['t']): string {
  return language === 'ko' ? t('settings.language.korean') : t('settings.language.english');
}

function HomeConditionsBand(props: {
  snapshot: HomeConditionsSnapshot;
  locale: string;
  onRetry: () => void;
  onOpenSettings: () => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const snapshot = props.snapshot;

  if (snapshot.status === 'loading' || snapshot.status === 'idle') {
    return (
      <DiveSummaryCard>
        <Text testID="home-conditions-loading" className="text-base font-semibold text-card-foreground">
          {t('home.conditions.loading')}
        </Text>
      </DiveSummaryCard>
    );
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
          <VStack space="xs">
            <Text testID="home-conditions-unavailable" className="text-base font-semibold text-card-foreground">
              {t(isError ? 'home.conditions.apiError' : 'home.conditions.unavailable')}
            </Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              {t(isError ? 'home.conditions.apiErrorBody' : 'home.conditions.unavailableBody')}
            </Text>
          </VStack>
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
          <StatusPill label={t(`home.conditions.sources.${snapshot.source ?? 'mock'}`)} tone="secondary" />
        </HStack>

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
          })} · {t('home.conditions.attribution')}
        </Text>
      </VStack>
    </DiveSummaryCard>
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
