import React from 'react';
import { useTranslation } from 'react-i18next';
import { Path, Svg } from 'react-native-svg';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { useGluestackColors } from '../../components/ui/gluestack-ui-provider';
import { HStack } from '../../components/ui/hstack';
import { AddIcon, RepeatIcon } from '../../components/ui/icon';
import { InstrumentButton, StatusPill } from '../../components/ui/instrument';
import { ListStatusBadge } from '../../components/ui/list-status-badge';
import { Pressable } from '../../components/ui/pressable';
import { SkeletonBlock } from '../../components/ui/skeleton-block';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { DiveLogEntry } from '../../types/dive-log-entry';
import type { MobileDiveSession } from '../../types/dive-session';
import { formatDate, formatDepth, formatDuration } from '../../utils/dive-formatters';
import { buildProfileRenderModel } from '../../utils/session-profile-chart';
import { getSessionDurationSeconds, getSessionMaxDepthMeters } from '../../utils/session-summary';
import { getUnsupportedDepthForLogEntry, getUnsupportedDepthForWatchSession } from '../../utils/unsupported-depth';

const SPARKLINE_WIDTH = 320;
const SPARKLINE_HEIGHT = 56;

export function LatestLogCard(props: {
  session: MobileDiveSession;
  entry?: DiveLogEntry;
  locale: string;
  onOpen?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const isDemoCapture = props.session.captureMode === 'demo';
  const isTestCapture = isDemoCapture && (props.session.tags?.includes('debug-test-capture') ?? false);
  const unsupportedDepth = props.entry
    ? getUnsupportedDepthForLogEntry(props.entry)
    : getUnsupportedDepthForWatchSession(props.session);
  const durationSeconds = getSessionDurationSeconds(props.session);
  const markers =
    isDemoCapture || unsupportedDepth ? (
      <HStack space="xs" className="flex-wrap items-center justify-end">
        {isDemoCapture ? (
          <ListStatusBadge
            testID="home-latest-demo-badge"
            kind="demo"
            label={isTestCapture ? t('logbook.testCapture') : t('logbook.demoCapture')}
          />
        ) : null}
        {unsupportedDepth ? (
          <StatusPill testID="home-latest-unsupported-depth" label={t('logbook.unsupportedDepthMarker')} tone="muted" />
        ) : null}
      </HStack>
    ) : undefined;

  const card = (
    <DiveSummaryCard>
      <VStack space="xs">
        <DiveSummaryCard.Header
          eyebrow={t('home.latestLog')}
          title={props.session.siteName ?? t('logbook.untitledDive')}
          right={markers}
        />
        <Text testID="home-latest-date" size="sm" className="text-muted-foreground">
          {formatDate(props.session.startedAt, props.locale, t('formatters.unknownDate'))}
        </Text>
      </VStack>
      <DepthSparkline session={props.session} />
      <HStack space="md">
        <LatestLogFact label={t('home.maxDepth')} value={formatDepth(getSessionMaxDepthMeters(props.session))} />
        <LatestLogFact
          label={t('home.diveTime')}
          value={durationSeconds === undefined ? '--:--' : formatDuration(durationSeconds)}
        />
      </HStack>
    </DiveSummaryCard>
  );

  if (!props.onOpen) {
    return card;
  }

  return (
    <Pressable
      testID="home-latest-log-card"
      accessibilityRole="button"
      accessibilityHint={t('home.openLatestLogHint')}
      className="rounded-2xl"
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]}
      onPress={props.onOpen}>
      {card}
    </Pressable>
  );
}

/**
 * Same container, header and fact labels as the real card; only the data slots are placeholders,
 * and they stay invisible until the shared delay has passed.
 */
export function LatestLogLoadingCard(props: { visible: boolean }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <DiveSummaryCard>
      <VStack
        testID="home-latest-loading-state"
        space="lg"
        accessible
        accessibilityLabel={t('home.latestLoading')}
        accessibilityState={{ busy: true }}>
        <VStack space="xs">
          <Text className="text-xs font-semibold uppercase text-muted-foreground">{t('home.latestLog')}</Text>
          <SkeletonBlock visible={props.visible} className="my-0.5 h-6 w-44" />
          <SkeletonBlock visible={props.visible} className="my-0.5 h-4 w-28" />
        </VStack>
        <SkeletonBlock visible={props.visible} className="h-14 rounded-lg" />
        <HStack space="md">
          <LatestLogFactSkeleton label={t('home.maxDepth')} visible={props.visible} />
          <LatestLogFactSkeleton label={t('home.diveTime')} visible={props.visible} />
        </HStack>
      </VStack>
    </DiveSummaryCard>
  );
}

export function LatestLogEmptyCard(props: { onCreateLog: () => void }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <DiveSummaryCard>
      <VStack testID="home-latest-empty-state" space="md">
        <VStack space="xs">
          <Text className="text-xs font-semibold uppercase text-muted-foreground">{t('home.latestLog')}</Text>
          <Text className="text-xl font-semibold leading-7 text-card-foreground">{t('home.emptyTitle')}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">{t('home.emptyMessage')}</Text>
        </VStack>
        <InstrumentButton
          testID="home-latest-empty-create-action"
          label={t('home.createLog')}
          icon={AddIcon}
          onPress={props.onCreateLog}
        />
      </VStack>
    </DiveSummaryCard>
  );
}

/** First read failed and nothing is on screen yet: say so and offer one retry. */
export function LatestLogErrorCard(props: { isRetrying: boolean; onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <DiveSummaryCard>
      <VStack testID="home-latest-error-state" space="md">
        <VStack space="xs">
          <Text className="text-xs font-semibold uppercase text-muted-foreground">{t('home.latestLog')}</Text>
          <Text className="text-xl font-semibold leading-7 text-card-foreground">{t('home.loadErrorTitle')}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">{t('home.loadErrorMessage')}</Text>
        </VStack>
        <InstrumentButton
          testID="home-latest-retry-action"
          label={t('common.retry')}
          icon={RepeatIcon}
          pending={props.isRetrying}
          onPress={props.onRetry}
        />
      </VStack>
    </DiveSummaryCard>
  );
}

function LatestLogFact(props: { label: string; value: string }): React.JSX.Element {
  return (
    <VStack space="xs" className="flex-1">
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</Text>
      <Text className="text-xl font-semibold leading-7 text-card-foreground">{props.value}</Text>
    </VStack>
  );
}

function LatestLogFactSkeleton(props: { label: string; visible: boolean }): React.JSX.Element {
  return (
    <VStack space="xs" className="flex-1">
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</Text>
      <SkeletonBlock visible={props.visible} className="my-0.5 h-6 w-20" />
    </VStack>
  );
}

/** One low, quiet depth line. Without samples it is left out rather than drawn empty. */
function DepthSparkline(props: { session: MobileDiveSession }): React.JSX.Element | null {
  const palette = useGluestackColors();
  const chart = buildProfileRenderModel({
    samples: props.session.samples ?? [],
    kind: 'depth',
    width: SPARKLINE_WIDTH,
    height: SPARKLINE_HEIGHT,
  });

  if (!chart.isAvailable || !chart.path) {
    return null;
  }

  return (
    <VStack
      testID="home-latest-profile"
      className="h-14 overflow-hidden"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`} preserveAspectRatio="none">
        {chart.areaPath ? <Path d={chart.areaPath} fill={palette.primary} fillOpacity={0.08} /> : null}
        <Path
          d={chart.path}
          fill="none"
          stroke={palette.primary}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
    </VStack>
  );
}
