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
import { buildProfileRenderModel } from '../../utils/session-profile-chart';
import { getSessionDurationSeconds, getSessionMaxDepthMeters } from '../../utils/session-summary';
import { getUnsupportedDepthForLogEntry, getUnsupportedDepthForWatchSession } from '../../utils/unsupported-depth';
import { DEFAULT_WATCH_LOG_SITE_NAME } from '../../utils/watch-session-to-dive-log-entry';
import {
  formatLogDate,
  formatLogDay,
  formatLogDepth,
  formatLogMinutes,
  getLogDisplayTitle,
  getLogMeasuredValue,
  getLogStartedAt,
} from '../logbook/log-formatters';

const SPARKLINE_WIDTH = 320;
const SPARKLINE_HEIGHT = 56;

type TranslateFn = ReturnType<typeof useTranslation>['t'];

type LatestLogSummary = {
  title: string;
  startedAt: number | undefined;
  maxDepthMeters: number | undefined;
  durationSeconds: number | undefined;
  isDemoCapture: boolean;
  isTestCapture: boolean;
  hasUnsupportedDepth: boolean;
};

export function LatestLogCard(props: {
  session: MobileDiveSession;
  entry?: DiveLogEntry;
  locale: string;
  onOpen?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const summary = getLatestLogSummary(props.session, props.entry, t, props.locale);
  const dateLabel = formatLogDate(summary.startedAt, props.locale, t('formatters.unknownDate'));
  const maxDepthLabel = formatLogDepth(summary.maxDepthMeters);
  // Whole minutes, like the log list row.
  const diveTimeLabel = formatLogMinutes(summary.durationSeconds, t);
  const captureLabel = summary.isDemoCapture
    ? summary.isTestCapture
      ? t('logbook.testCapture')
      : t('logbook.demoCapture')
    : undefined;
  const unsupportedDepthLabel = summary.hasUnsupportedDepth ? t('logbook.unsupportedDepthMarker') : undefined;
  // The Demo/Test badge is hidden from VoiceOver on its own, so the card says it in one label,
  // in the same order as the log list row.
  const accessibilityLabel = [
    summary.title,
    dateLabel,
    captureLabel,
    unsupportedDepthLabel,
    `${t('home.maxDepth')} ${maxDepthLabel}`,
    `${t('home.diveTime')} ${diveTimeLabel}`,
  ]
    .filter((label): label is string => label !== undefined)
    .join(', ');
  const markers =
    captureLabel || unsupportedDepthLabel ? (
      <HStack space="xs" className="flex-wrap items-center justify-end">
        {captureLabel ? <ListStatusBadge testID="home-latest-demo-badge" kind="demo" label={captureLabel} /> : null}
        {unsupportedDepthLabel ? (
          <StatusPill testID="home-latest-unsupported-depth" label={unsupportedDepthLabel} tone="muted" />
        ) : null}
      </HStack>
    ) : undefined;

  const card = (
    <DiveSummaryCard>
      <VStack space="xs">
        <DiveSummaryCard.Header
          eyebrow={t('home.latestLog')}
          title={summary.title}
          titleTestID="home-latest-title"
          right={markers}
        />
        <Text testID="home-latest-date" size="sm" className="text-muted-foreground">
          {dateLabel}
        </Text>
      </VStack>
      <DepthSparkline session={props.session} />
      <HStack space="md">
        <LatestLogFact label={t('home.maxDepth')} value={maxDepthLabel} valueTestID="home-latest-max-depth" />
        <LatestLogFact label={t('home.diveTime')} value={diveTimeLabel} valueTestID="home-latest-dive-time" />
      </HStack>
    </DiveSummaryCard>
  );

  if (!props.onOpen) {
    return (
      <VStack testID="home-latest-log-summary" accessible accessibilityLabel={accessibilityLabel}>
        {card}
      </VStack>
    );
  }

  return (
    <Pressable
      testID="home-latest-log-card"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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

/**
 * With the entry, the card follows the log list and detail: the display title, manual corrections
 * over watch values, and the Test marker from the watch capture. The session alone is a fallback.
 */
function getLatestLogSummary(
  session: MobileDiveSession,
  entry: DiveLogEntry | undefined,
  t: TranslateFn,
  locale: string,
): LatestLogSummary {
  if (entry) {
    const watchSession = entry.watchCapture?.session;
    const isDemoCapture = watchSession?.captureMode === 'demo';

    return {
      title: getLogDisplayTitle(entry, t, locale),
      startedAt: getLogStartedAt(entry),
      maxDepthMeters: getLogMeasuredValue(entry, 'maxDepthMeters').value,
      durationSeconds: getLogMeasuredValue(entry, 'durationSeconds').value,
      isDemoCapture,
      isTestCapture: isDemoCapture && (watchSession?.tags?.includes('debug-test-capture') ?? false),
      hasUnsupportedDepth: getUnsupportedDepthForLogEntry(entry) !== undefined,
    };
  }

  const isDemoCapture = session.captureMode === 'demo';

  return {
    title: getSessionDisplayTitle(session, t, locale),
    startedAt: session.startedAt,
    maxDepthMeters: getSessionMaxDepthMeters(session),
    durationSeconds: getSessionDurationSeconds(session),
    isDemoCapture,
    isTestCapture: isDemoCapture && (session.tags?.includes('debug-test-capture') ?? false),
    hasUnsupportedDepth: getUnsupportedDepthForWatchSession(session) !== undefined,
  };
}

/**
 * The logbook title rule (`getLogDisplayTitle`) for a session without its entry: the diver's title,
 * then a localized `워치 기록 · <day>` instead of the stored import default site, then the site, then
 * `제목 없는 기록`. Display only; the stored site name is not changed.
 */
function getSessionDisplayTitle(session: MobileDiveSession, t: TranslateFn, locale: string): string {
  const title = session.planTitle?.trim();

  if (title) {
    return title;
  }

  const siteName = session.siteName?.trim();

  if (siteName === DEFAULT_WATCH_LOG_SITE_NAME && session.startedAt) {
    return t('logbook.watchDiveTitle', { date: formatLogDay(session.startedAt, locale) });
  }

  return siteName || t('logbook.untitledDive');
}

function LatestLogFact(props: { label: string; value: string; valueTestID?: string }): React.JSX.Element {
  return (
    <VStack space="xs" className="flex-1">
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</Text>
      <Text testID={props.valueTestID} className="text-xl font-semibold leading-7 text-card-foreground">
        {props.value}
      </Text>
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
