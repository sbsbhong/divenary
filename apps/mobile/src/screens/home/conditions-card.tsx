import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '../../components/ui/box';
import { Button, ButtonIcon, ButtonSpinner } from '../../components/ui/button';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { useGluestackColors } from '../../components/ui/gluestack-ui-provider';
import { HStack } from '../../components/ui/hstack';
import { AlertCircleIcon, Icon, MapPinIcon, RepeatIcon, SettingsIcon, SunIcon, WavesIcon } from '../../components/ui/icon';
import { InstrumentButton } from '../../components/ui/instrument';
import { SkeletonBlock, useContentLoading } from '../../components/ui/skeleton-block';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { HomeConditionsSnapshot } from '../../conditions/home-conditions';
import { useLoadingFeedback } from '../../hooks/use-loading-feedback';
import { formatTemperature } from '../../utils/dive-formatters';

type HomeConditionsCardProps = {
  snapshot: HomeConditionsSnapshot;
  isRefreshing: boolean;
  refreshFailed: boolean;
  locale: string;
  onRetry: () => void;
  onOpenSettings: () => Promise<void>;
};

/** Location conditions for context only. It gives no dive-suitability or safety advice. */
export function HomeConditionsCard(props: HomeConditionsCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const snapshot = props.snapshot;
  const isLoading = snapshot.status === 'loading' || snapshot.status === 'idle';
  const showSkeleton = useContentLoading(isLoading, props.locale);

  if (isLoading) {
    return <HomeConditionsLoadingCard visible={showSkeleton} />;
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
          <Button
            testID="home-conditions-refresh-action"
            accessibilityLabel={props.isRefreshing ? t('home.conditions.refreshing') : t('home.conditions.refresh')}
            accessibilityState={{ busy: props.isRefreshing, disabled: props.isRefreshing }}
            variant="secondary"
            size="icon"
            hitSlop={4}
            disabled={props.isRefreshing}
            className="rounded-full bg-muted"
            style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]}
            onPress={props.onRefresh}>
            {showRefreshSpinner ? (
              <ButtonSpinner testID="home-conditions-refresh-spinner" color={palette.primary} />
            ) : (
              <ButtonIcon as={RepeatIcon} className="text-primary" />
            )}
          </Button>
        </HStack>

        <HStack space="md">
          <ConditionTile
            testID="home-conditions-air-tile"
            label={t('home.conditions.airTemperature')}
            value={formatTemperature(snapshot.airTemperatureCelsius)}
            valueTestID="home-conditions-air-temperature"
            icon={SunIcon}
          />
          {showsWaterTemperature ? (
            <ConditionTile
              testID="home-conditions-water-tile"
              label={t('home.conditions.waterTemperature')}
              value={formatTemperature(snapshot.waterTemperatureCelsius)}
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

/** Mirrors the ready card: header row, two tiles and the updated line. */
function HomeConditionsLoadingCard(props: { visible: boolean }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <DiveSummaryCard>
      <VStack
        testID="home-conditions-loading"
        space="md"
        accessible
        accessibilityLabel={t('home.conditions.loading')}
        accessibilityState={{ busy: true }}>
        <HStack className="items-start justify-between" space="md">
          <HStack space="sm" className="flex-1 items-start">
            <SkeletonBlock visible={props.visible} className="mt-0.5 h-9 w-9 rounded-full" />
            <VStack space="xs" className="flex-1">
              <SkeletonBlock visible={props.visible} className="my-0.5 h-6 w-32" />
              <SkeletonBlock visible={props.visible} className="h-4 w-16" />
            </VStack>
          </HStack>
          <SkeletonBlock visible={props.visible} className="h-9 w-9 rounded-full" />
        </HStack>
        <HStack space="md">
          <ConditionTileSkeleton visible={props.visible} />
          <ConditionTileSkeleton visible={props.visible} />
        </HStack>
        <SkeletonBlock visible={props.visible} className="h-3 w-28" />
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
    return '--:--';
  }

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(seconds * 1000));
}
