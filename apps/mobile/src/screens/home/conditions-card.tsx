import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '../../components/ui/box';
import { ButtonIcon, ButtonSpinner } from '../../components/ui/button';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { useGluestackColors } from '../../components/ui/gluestack-ui-provider';
import { HStack } from '../../components/ui/hstack';
import { AlertCircleIcon, Icon, MapPinIcon, RepeatIcon, SettingsIcon, SunIcon, WavesIcon } from '../../components/ui/icon';
import { InstrumentButton } from '../../components/ui/instrument';
import { PressScaleButton } from '../../components/ui/press-scale';
import { SkeletonBlock } from '../../components/ui/skeleton-block';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { HomeConditionsSnapshot } from '../../conditions/home-conditions';
import { useLoadingFeedback } from '../../hooks/use-loading-feedback';
import { formatLogTemperature } from '../logbook/log-formatters';

type HomeConditionsCardProps = {
  snapshot: HomeConditionsSnapshot;
  isRefreshing: boolean;
  refreshFailed: boolean;
  locale: string;
  onRetry: () => void;
  onOpenSettings: () => Promise<void>;
};

/** Local weather for context only. It gives no dive-suitability or safety advice. */
export function HomeConditionsCard(props: HomeConditionsCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const snapshot = props.snapshot;

  if (snapshot.status === 'loading' || snapshot.status === 'idle') {
    return <HomeConditionsLoadingCard locale={props.locale} onRetry={props.onRetry} />;
  }

  if (snapshot.status === 'permissionDenied') {
    return (
      <DiveSummaryCard>
        <VStack space="md">
          <HStack space="sm" className="items-start">
            <NeutralIconBubble icon={AlertCircleIcon} />
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

  return (
    <ReadyConditionsCard
      snapshot={snapshot}
      isRefreshing={props.isRefreshing}
      refreshFailed={props.refreshFailed}
      locale={props.locale}
      onRefresh={props.onRetry}
    />
  );
}

function ReadyConditionsCard(props: {
  snapshot: HomeConditionsSnapshot;
  isRefreshing: boolean;
  refreshFailed: boolean;
  locale: string;
  onRefresh: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const palette = useGluestackColors();
  // The values stay on screen while refreshing; only the button slot shows a spinner, and only
  // after the shared delay.
  const { showIndicator: showRefreshSpinner } = useLoadingFeedback(props.isRefreshing);
  const snapshot = props.snapshot;
  const showsWaterTemperature = snapshot.isCoastal !== false && snapshot.waterTemperatureCelsius !== undefined;

  return (
    <DiveSummaryCard>
      <VStack space="md">
        <HStack className="items-start justify-between" space="md">
          <HStack space="sm" className="flex-1 items-start">
            <NeutralIconBubble testID="home-conditions-location-icon" icon={MapPinIcon} />
            <VStack space="xs" className="flex-1">
              <Text testID="home-conditions-city" className="text-xl font-semibold leading-7 text-card-foreground">
                {snapshot.cityName ?? t('home.conditions.currentLocation')}
              </Text>
              <Text testID="home-conditions-local-time" size="sm" className="text-muted-foreground">
                {formatConditionsTime(snapshot.localTime, props.locale)}
              </Text>
            </VStack>
          </HStack>
          <PressScaleButton
            kind="control"
            testID="home-conditions-refresh-action"
            accessibilityLabel={props.isRefreshing ? t('home.conditions.refreshing') : t('home.conditions.refresh')}
            accessibilityState={{ busy: props.isRefreshing, disabled: props.isRefreshing }}
            variant="secondary"
            size="icon"
            hitSlop={4}
            disabled={props.isRefreshing}
            className="rounded-full bg-muted"
            onPress={props.onRefresh}>
            {showRefreshSpinner ? (
              <ButtonSpinner testID="home-conditions-refresh-spinner" color={palette.primary} />
            ) : (
              <ButtonIcon as={RepeatIcon} className="text-primary" />
            )}
          </PressScaleButton>
        </HStack>

        <HStack space="md">
          <ConditionTile
            testID="home-conditions-air-tile"
            label={t('home.conditions.airTemperature')}
            value={formatLogTemperature(snapshot.airTemperatureCelsius)}
            valueTestID="home-conditions-air-temperature"
            icon={SunIcon}
          />
          {showsWaterTemperature ? (
            <ConditionTile
              testID="home-conditions-water-tile"
              label={t('home.conditions.waterTemperature')}
              value={formatLogTemperature(snapshot.waterTemperatureCelsius)}
              valueTestID="home-conditions-water-temperature"
              icon={WavesIcon}
            />
          ) : (
            <VStack className="flex-1 justify-center rounded-2xl bg-muted px-4 py-4">
              <Text testID="home-conditions-water-unavailable" className="text-sm leading-5 text-muted-foreground">
                {t('home.conditions.waterUnavailable')}
              </Text>
            </VStack>
          )}
        </HStack>

        {props.refreshFailed ? (
          <Text testID="home-conditions-refresh-failed" size="xs" className="leading-4 text-muted-foreground">
            {t('home.refreshFailed')}
          </Text>
        ) : null}

        <HStack space="sm" className="items-center justify-between">
          <Text testID="home-conditions-updated" size="xs" className="text-muted-foreground">
            {t('home.conditions.updatedAt', {
              time: formatConditionsTime(snapshot.updatedAt, props.locale),
            })}
          </Text>
          {snapshot.source === 'openMeteo' ? (
            <Text testID="home-conditions-attribution" size="xs" className="text-muted-foreground">
              {t('home.conditions.attribution')}
            </Text>
          ) : null}
        </HStack>
      </VStack>
    </DiveSummaryCard>
  );
}

/**
 * Mirrors the ready card: header row, two tiles and the updated line. The slots appear after 1 s.
 * The updated line's slot says it is still loading from 4 s and offers a retry from 10 s, because
 * the location fix and the weather request can each take several seconds.
 */
function HomeConditionsLoadingCard(props: { locale: string; onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  // Mounted only while loading, so the delays count from the start of this load.
  const feedback = useLoadingFeedback(true, { resetKey: props.locale });
  const [isRetrying, setIsRetrying] = React.useState(false);
  const visible = feedback.showIndicator;

  const retry = () => {
    setIsRetrying(true);
    props.onRetry();
  };

  return (
    <DiveSummaryCard>
      <VStack space="md">
        <VStack
          testID="home-conditions-loading"
          space="md"
          accessible
          accessibilityLabel={t('home.conditions.loading')}
          accessibilityState={{ busy: true }}>
          <HStack className="items-start justify-between" space="md">
            <HStack space="sm" className="flex-1 items-start">
              <SkeletonBlock visible={visible} className="mt-0.5 h-9 w-9 rounded-full" />
              <VStack space="xs" className="flex-1">
                <SkeletonBlock visible={visible} className="my-0.5 h-6 w-32" />
                <SkeletonBlock visible={visible} className="h-4 w-16" />
              </VStack>
            </HStack>
            <SkeletonBlock visible={visible} className="h-9 w-9 rounded-full" />
          </HStack>
          <HStack space="md">
            <ConditionTileSkeleton visible={visible} />
            <ConditionTileSkeleton visible={visible} />
          </HStack>
        </VStack>
        {/* Outside the grouped busy element so VoiceOver can reach the retry action. */}
        {feedback.isLongRunning ? (
          <VStack space="sm">
            <Text testID="home-conditions-long-running" size="xs" className="leading-4 text-muted-foreground">
              {t('home.conditions.longRunning')}
            </Text>
            <InstrumentButton
              testID="home-conditions-loading-retry-action"
              label={t('home.conditions.tryAgain')}
              icon={RepeatIcon}
              pending={isRetrying}
              onPress={retry}
            />
          </VStack>
        ) : feedback.showExtendedFeedback ? (
          <Text testID="home-conditions-loading-message" size="xs" className="leading-4 text-muted-foreground">
            {t('home.conditions.loading')}
          </Text>
        ) : (
          <SkeletonBlock visible={visible} className="my-0.5 h-3 w-28" />
        )}
      </VStack>
    </DiveSummaryCard>
  );
}

function ConditionTileSkeleton(props: { visible: boolean }): React.JSX.Element {
  return (
    <VStack space="sm" className="flex-1 rounded-2xl bg-muted px-4 py-4">
      <HStack className="items-center justify-between">
        <SkeletonBlock visible={props.visible} className="h-3 w-12" />
        <SkeletonBlock visible={props.visible} className="h-7 w-7 rounded-full" />
      </HStack>
      <SkeletonBlock visible={props.visible} className="h-7 w-20" />
    </VStack>
  );
}

function ConditionTile(props: {
  label: string;
  value: string;
  valueTestID?: string;
  icon: React.ElementType;
  testID?: string;
}): React.JSX.Element {
  return (
    <Box testID={props.testID} className="flex-1 rounded-2xl bg-muted px-4 py-4">
      <VStack space="sm">
        <HStack className="items-center justify-between">
          <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</Text>
          <Box testID={props.testID ? `${props.testID}-icon` : undefined} className="h-7 w-7 items-center justify-center rounded-full bg-card">
            <Icon as={props.icon} size="xs" className="text-muted-foreground" />
          </Box>
        </HStack>
        <Text testID={props.valueTestID} className="text-xl font-semibold leading-7 text-card-foreground">
          {props.value}
        </Text>
      </VStack>
    </Box>
  );
}

/** Information icons sit in a neutral bubble; blue stays for the refresh and retry actions. */
function NeutralIconBubble(props: { icon: React.ElementType; testID?: string }): React.JSX.Element {
  return (
    <Box testID={props.testID} className="mt-0.5 h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
      <Icon as={props.icon} size="sm" className="text-muted-foreground" />
    </Box>
  );
}

function formatConditionsTime(seconds: number | undefined, locale: string): string {
  if (!seconds) {
    return '--';
  }

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(seconds * 1000));
}
