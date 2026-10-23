import React from 'react';
import type { FlatList as RNFlatList } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated from 'react-native-reanimated';
import { useAppFeedback } from '../../components/feedback/app-feedback';
import { useGluestackColors } from '../../components/ui/gluestack-ui-provider';
import { ListStateCard } from '../../components/ui/list-state-card';
import { Box } from '../../components/ui/box';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { InstrumentButton, SafetyText, StatusPill } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import { FlatList } from '../../components/ui/flat-list';
import { EditIcon, Icon, SearchIcon, WatchIcon } from '../../components/ui/icon';
import { Input, InputField, InputIcon, InputSlot } from '../../components/ui/input';
import { ListStatusBadge } from '../../components/ui/list-status-badge';
import { PressScalePressable } from '../../components/ui/press-scale';
import { RefreshControl } from '../../components/ui/refresh-control';
import { ScreenHeader } from '../../components/ui/screen-header';
import { arrivalEntering, fadeEntering } from '../../components/ui/motion-entering';
import { SkeletonBlock, useContentLoading } from '../../components/ui/skeleton-block';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { MOTION_TIMING } from '../../constants/motion';
import { useFirstLoadReveal } from '../../hooks/use-first-load-reveal';
import type { DiveLogEntry } from '../../types/dive-log-entry';
import type { DiveSessionFilter } from '../../types/dive-session';
import type { WatchSyncActionResult } from '../../states/use-dive-logbook';
import { getUnsupportedDepthForLogEntry } from '../../utils/unsupported-depth';
import { getVisibleLogTags } from '../../utils/watch-session-to-dive-log-entry';
import { diveLogEntryToMobileSession } from '../../states/use-dive-logbook';
import {
  formatLogDate,
  formatLogDepth,
  formatLogMinutes,
  getLogListTitle,
  getLogMeasuredValue,
  getLogStartedAt,
  toTestIdValue,
} from './log-formatters';

type LogbookScreenProps = {
  /** Entries after the search filter. */
  entries: DiveLogEntry[];
  /** Entries before the search filter, to tell "no matches" from "no logs". */
  totalEntryCount?: number;
  loadError?: Error | null;
  filter: DiveSessionFilter;
  onFilterChange: (filter: DiveSessionFilter) => void;
  onSyncWatch: () => Promise<WatchSyncActionResult>;
  onRefresh: () => void | Promise<void>;
  isLoading?: boolean;
  /** True while account logs are still arriving from the cloud. */
  isCloudLoading?: boolean;
  reselectToken?: number;
  /** Opens the routed log detail. */
  onOpenEntry: (entry: DiveLogEntry) => void;
  /** Opens the routed log editor. */
  onCreateEntry: () => void;
  isAuthenticated?: boolean;
};

/** Rows added each time the list scrolls near its end. */
const LOGBOOK_PAGE_SIZE = 20;
const LOADING_ROW_COUNT = 3;
const TAIL_ROW_COUNT = 2;
const NO_ARRIVALS: ReadonlySet<string> = new Set();

export default function LogbookScreen(props: LogbookScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const palette = useGluestackColors();
  const { notify } = useAppFeedback();
  const [isSyncingWatch, setIsSyncingWatch] = React.useState(false);
  const previousReselectToken = React.useRef(props.reselectToken ?? 0);
  const listRef = React.useRef<RNFlatList<DiveLogEntry>>(null);
  const visibleEntries = props.entries;
  const totalEntryCount = props.totalEntryCount ?? visibleEntries.length;
  const isFiltering = props.filter.query.trim().length > 0 || Boolean(props.filter.tag);
  // A failed first load has no count to show; a failed refresh keeps the last list and says so.
  const hasFirstLoadFailed = Boolean(props.loadError) && totalEntryCount === 0;
  const hasRefreshFailed = Boolean(props.loadError) && totalEntryCount > 0;
  // The shown page count belongs to one search; a new search starts again from the first page.
  const filterKey = `${props.filter.query}\u0000${props.filter.tag ?? ''}`;
  const [page, setPage] = React.useState({ filterKey, count: LOGBOOK_PAGE_SIZE });
  const shownCount = page.filterKey === filterKey ? page.count : LOGBOOK_PAGE_SIZE;
  const pagedEntries = React.useMemo(() => visibleEntries.slice(0, shownCount), [shownCount, visibleEntries]);
  const hasMorePages = shownCount < visibleEntries.length;
  // Pages cut from memory appear at once and show nothing. Only cloud pages that are still
  // arriving are real waiting, and they get a delayed tail skeleton at the true end of the list.
  const isWaitingForCloudTail = Boolean(props.isCloudLoading) && pagedEntries.length > 0 && !hasMorePages;
  // Rows of the first load fade in as one reveal. Rows that arrive later are judged in the hook below.
  const revealRows = useFirstLoadReveal(Boolean(props.isLoading) && totalEntryCount === 0);
  const arrivedIds = useRowArrivals(visibleEntries, shownCount, filterKey);
  // A first load reveals all of its rows together; a later arrival fades only its own row.
  const rowEntering = (localId: string) => (revealRows ? fadeEntering : arrivedIds.has(localId) ? arrivalEntering : undefined);
  const showLoadingSkeleton = useContentLoading(Boolean(props.isLoading), 'logbook-list');
  const showTailSkeleton = useContentLoading(isWaitingForCloudTail, 'logbook-tail');
  const showNextPage = React.useCallback(() => {
    if (!hasMorePages) {
      return;
    }
    setPage(current => ({
      filterKey,
      count: (current.filterKey === filterKey ? current.count : LOGBOOK_PAGE_SIZE) + LOGBOOK_PAGE_SIZE,
    }));
  }, [filterKey, hasMorePages]);
  // The pull spinner belongs to the pull gesture. Background refreshes (cloud pages, tab
  // reselect) leave it hidden, so iOS never keeps its inset above a list scrolled from code.
  const [isPullRefreshing, setIsPullRefreshing] = React.useState(false);
  const { onRefresh } = props;
  const pullToRefresh = React.useCallback(async () => {
    setIsPullRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsPullRefreshing(false);
    }
  }, [onRefresh]);
  // The failed-load card's retry is busy from the tap until the reload settles.
  const [isRetrying, setIsRetrying] = React.useState(false);
  const retryLoad = React.useCallback(async () => {
    setIsRetrying(true);
    try {
      await onRefresh();
    } catch {
      // A failed retry keeps the card; the list state says what happened.
    } finally {
      setIsRetrying(false);
    }
  }, [onRefresh]);

  React.useEffect(() => {
    const reselectToken = props.reselectToken ?? 0;

    if (reselectToken === previousReselectToken.current) {
      return;
    }

    previousReselectToken.current = reselectToken;
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    void onRefresh();
  }, [onRefresh, props.reselectToken]);

  const { onSyncWatch } = props;
  const syncWatch = React.useCallback(async () => {
    setIsSyncingWatch(true);

    try {
      const result = await onSyncWatch();

      if (result.importedCount > 0 && result.failedCount > 0) {
        notify(t('logbook.syncWatchPartial', { count: result.importedCount, failed: result.failedCount }), 'attention');
      } else if (result.importedCount > 0) {
        notify(t('logbook.syncWatchImported', { count: result.importedCount }), 'success');
      } else if (result.failedCount > 0) {
        notify(t('logbook.syncWatchFailed'), 'attention');
      } else if (result.unavailable) {
        notify(t('logbook.syncWatchUnavailable'), 'attention');
      } else {
        notify(t('logbook.syncWatchNone'), 'success');
      }
    } catch {
      notify(t('logbook.syncWatchFailed'), 'attention');
    } finally {
      setIsSyncingWatch(false);
    }
  }, [notify, onSyncWatch, t]);

  const header = (
    <VStack space="md" className="px-5 pt-4 pb-3">
      <ScreenHeader title={t('logbook.title')} />
      {/* Both ways to add a log share a row of their own; their labels do not fit beside the title. */}
      <HStack space="sm">
        <InstrumentButton
          testID="logbook-create-action"
          label={t('logbook.createManual')}
          icon={EditIcon}
          variant="primary"
          onPress={props.onCreateEntry}
          className="min-h-11 flex-1 px-4 py-2"
        />
        <InstrumentButton
          testID="logbook-import-action"
          label={t('logbook.syncWatch')}
          onPress={syncWatch}
          pending={isSyncingWatch}
          className="min-h-11 flex-1 px-4 py-2"
        />
      </HStack>
      <Input className="h-11 rounded-full border-0 bg-card px-5 shadow-none">
        <InputSlot testID="logbook-search-icon">
          <InputIcon as={SearchIcon} className="text-muted-foreground" />
        </InputSlot>
        <InputField
          testID="logbook-search-input"
          aria-label={t('logbook.searchLabel')}
          placeholder={t('logbook.searchPlaceholder')}
          value={props.filter.query}
          onChangeText={query => props.onFilterChange({ ...props.filter, query })}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          className="px-0 py-0 text-base font-normal"
        />
      </Input>
      {/* The count line keeps its place while the first load runs, so the list does not move. */}
      <HStack className="min-h-5 items-center">
        {props.isLoading ? (
          <Box className="w-24">
            <SkeletonBlock visible={showLoadingSkeleton} />
          </Box>
        ) : hasFirstLoadFailed ? null : (
          <Text testID="logbook-total-count" className="text-sm font-semibold text-muted-foreground">
            {isFiltering
              ? t('logbook.filteredCount', { count: visibleEntries.length, total: totalEntryCount })
              : t('logbook.totalCount', { count: totalEntryCount })}
          </Text>
        )}
      </HStack>
      {hasRefreshFailed ? (
        <Text testID="logbook-refresh-failed" className="text-sm leading-5 text-muted-foreground">
          {t('logbook.refreshFailed')}
        </Text>
      ) : null}
    </VStack>
  );

  return (
    <VStack className="flex-1 bg-background">
      {header}
      <FlatList<DiveLogEntry>
        ref={listRef}
        testID="logbook-list"
        className="flex-1"
        contentContainerClassName="px-5 pb-6"
        data={pagedEntries}
        keyExtractor={entry => entry.localId}
        renderItem={({ item }) => (
          // Entering is read once, when the row mounts. A row scrolled back into view later has none.
          <Animated.View entering={rowEntering(item.localId)}>
            <SessionListItem
              entry={item}
              showsDeviceOnlyBadge={Boolean(props.isAuthenticated && item.ownerUserId === undefined)}
              onOpen={props.onOpenEntry}
            />
          </Animated.View>
        )}
        ItemSeparatorComponent={ListItemSeparator}
        initialNumToRender={LOGBOOK_PAGE_SIZE}
        onEndReached={showNextPage}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={isPullRefreshing} onRefresh={pullToRefresh} tintColor={palette.primary} />}
        ListEmptyComponent={
          props.isLoading ? (
            <LogRowsSkeleton testID="logbook-loading-state" count={LOADING_ROW_COUNT} visible={showLoadingSkeleton} label={t('logbook.loadingList')} />
          ) : props.loadError ? (
            <ListStateCard
              testID="logbook-error-state"
              title={t('logbook.loadFailed')}
              message={t('logbook.loadFailedMessage')}
              actionLabel={t('common.retry')}
              actionPending={isRetrying}
              onAction={() => void retryLoad()}
            />
          ) : totalEntryCount > 0 ? (
            <ListStateCard
              testID="logbook-no-results-state"
              title={t('logbook.noSearchResults', { query: props.filter.query.trim() })}
              message={t('logbook.noSearchResultsMessage')}
              actionLabel={t('logbook.clearSearch')}
              onAction={() => props.onFilterChange({ ...props.filter, query: '' })}
            />
          ) : (
            <EmptyLogbook />
          )
        }
        ListFooterComponent={
          <VStack space="md" className="pt-3">
            {isWaitingForCloudTail ? (
              <LogRowsSkeleton testID="logbook-loading-more" count={TAIL_ROW_COUNT} visible={showTailSkeleton} label={t('logbook.cloudLoading')} />
            ) : null}
            <SafetyText>{t('logbook.safetyText')}</SafetyText>
          </VStack>
        }
      />
    </VStack>
  );
}

/**
 * Ids of rows that arrived while the list already showed rows (a watch import, a cloud page). Only
 * these fade in. The first rows, paged-in rows and rows scrolled back into view are not arrivals.
 * An arrival below the shown page is not in the set, so paging it in shows it without animation.
 * The set empties after the appear time, so a row scrolled into view later does not fade.
 * A changed search or tag only re-sorts what the diver asked for, so it never counts as an arrival,
 * and an emptied list (sign-out, account switch) starts over so the next owner's rows are not arrivals.
 */
function useRowArrivals(entries: DiveLogEntry[], shownCount: number, filterKey: string): ReadonlySet<string> {
  const [tracker, setTracker] = React.useState(() => ({
    entries,
    filterKey,
    seen: new Set(entries.map(entry => entry.localId)),
    arrived: NO_ARRIVALS,
  }));
  let current = tracker;

  // Set during render, so the arrival is in place on the render that mounts its row.
  if (entries !== tracker.entries || filterKey !== tracker.filterKey) {
    const judgesArrivals = filterKey === tracker.filterKey && tracker.seen.size > 0;
    const seen = entries.length === 0 ? new Set<string>() : new Set(tracker.seen);
    const incoming = new Set<string>();
    entries.forEach((entry, index) => {
      if (judgesArrivals && index < shownCount && !seen.has(entry.localId)) {
        incoming.add(entry.localId);
      }
      seen.add(entry.localId);
    });
    current = { entries, filterKey, seen, arrived: incoming.size > 0 ? incoming : NO_ARRIVALS };
    setTracker(current);
  }

  const arrived = current.arrived;
  React.useEffect(() => {
    if (arrived.size === 0) {
      return;
    }
    const timer = setTimeout(() => setTracker(state => ({ ...state, arrived: NO_ARRIVALS })), MOTION_TIMING.appear);
    return () => clearTimeout(timer);
  }, [arrived]);

  return arrived;
}

function ListItemSeparator(): React.JSX.Element {
  return <Box className="h-2" />;
}

/**
 * A first logbook: one short line covering both ways in. The two actions it names sit just above
 * in the header, so the card does not repeat them.
 */
function EmptyLogbook(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <DiveSummaryCard>
      <VStack testID="logbook-empty-state" space="xs">
        <Text accessibilityRole="header" className="text-xl font-semibold leading-7 text-card-foreground">
          {t('logbook.emptyTitle')}
        </Text>
        <Text className="text-sm leading-5 text-muted-foreground">{t('logbook.emptyMessage')}</Text>
      </VStack>
    </DiveSummaryCard>
  );
}

/**
 * Row-shaped placeholders: the same container, icon circle, title line with the depth on the right
 * and meta line as a real row. They hold their place invisibly until the shared delay has passed,
 * and the card surface appears only with them.
 */
function LogRowsSkeleton(props: { testID: string; count: number; visible: boolean; label: string }): React.JSX.Element {
  return (
    <VStack
      testID={props.testID}
      space="sm"
      accessible={props.visible}
      accessibilityLabel={props.visible ? props.label : undefined}
      accessibilityState={{ busy: true }}>
      {Array.from({ length: props.count }, (_, index) => (
        <HStack key={index} space="md" className={props.visible ? 'items-center rounded-2xl bg-card px-4 py-3' : 'items-center rounded-2xl px-4 py-3'}>
          <Box className="h-9 w-9">
            <SkeletonBlock visible={props.visible} className="h-9 rounded-full" />
          </Box>
          <VStack space="xs" className="flex-1">
            <HStack space="sm" className="h-6 items-center">
              <Box className="flex-1">
                <Box className="w-3/5">
                  <SkeletonBlock visible={props.visible} className="h-5" />
                </Box>
              </Box>
              <Box className="w-12">
                <SkeletonBlock visible={props.visible} className="h-5" />
              </Box>
            </HStack>
            <Box className="h-5 w-2/3 justify-center">
              <SkeletonBlock visible={props.visible} />
            </Box>
          </VStack>
        </HStack>
      ))}
    </VStack>
  );
}

/**
 * One compact row: title with the max depth on the right, then `date time · dive type · duration`
 * under it, both starting at the same edge. The diver's own tags and any status markers get a line
 * only when there are some. VoiceOver reads the whole row as one label. Memoized so a refetch only
 * re-renders rows whose entry object changed.
 */
const SessionListItem = React.memo(function SessionListItem(props: {
  entry: DiveLogEntry;
  showsDeviceOnlyBadge: boolean;
  onOpen: (entry: DiveLogEntry) => void;
}): React.JSX.Element {
  const { entry, onOpen } = props;
  const openEntry = React.useCallback(() => onOpen(entry), [entry, onOpen]);
  const session = diveLogEntryToMobileSession(entry);
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const visibleTags = getVisibleLogTags(entry);
  const tags = visibleTags.length ? visibleTags.join(', ') : undefined;
  // The test ID keeps the stored site name; the visible title may be a localized fallback.
  const siteName = session.siteName ?? t('logbook.untitledDive');
  const title = getLogListTitle(entry, t);
  const maxDepthLabel = formatLogDepth(getLogMeasuredValue(entry, 'maxDepthMeters').value);
  const durationLabel = formatLogMinutes(getLogMeasuredValue(entry, 'durationSeconds').value, t);
  const unsupportedDepth = getUnsupportedDepthForLogEntry(entry);
  const dateLabel = formatLogDate(getLogStartedAt(entry), locale, t('formatters.unknownDate'));
  const diveModeLabel = session.diveMode ? t(`diveModes.${session.diveMode}`) : t('diveModes.notSet');
  const unsupportedDepthLabel = unsupportedDepth ? t('logbook.unsupportedDepthMarker') : undefined;
  const isDemoCapture = entry.watchCapture?.session.captureMode === 'demo';
  // A test dive from the watch's developer controls says 테스트, as the detail and Home do.
  const isTestCapture = isDemoCapture && (entry.watchCapture?.session.tags?.includes('debug-test-capture') ?? false);
  const badges = [
    ...(isDemoCapture
      ? [
          isTestCapture
            ? { kind: 'demo' as const, label: t('logbook.testCapture'), testID: `logbook-test-badge-${siteName}` }
            : { kind: 'demo' as const, label: t('logbook.demoCapture'), testID: `logbook-demo-badge-${siteName}` },
        ]
      : []),
    ...(props.showsDeviceOnlyBadge
      ? [{ kind: 'device' as const, label: t('accountClaim.deviceBadge'), testID: `logbook-device-badge-${siteName}` }]
      : []),
  ];
  const accessibilityLabel = [
    title,
    dateLabel,
    ...badges.map(badge => badge.label),
    unsupportedDepthLabel,
    maxDepthLabel,
    diveModeLabel,
    durationLabel,
    tags,
  ]
    .filter((label): label is string => label !== undefined)
    .join(', ');

  return (
    <PressScalePressable
      kind="card"
      testID={`logbook-list-item-${siteName}`}
      accessibilityRole="button"
      onPress={openEntry}
      accessible
      accessibilityLabel={accessibilityLabel}
      className="rounded-2xl bg-card px-4 py-3">
      <HStack space="md" className="items-center">
        <Box
          testID={`logbook-list-source-icon-${siteName}`}
          className="h-9 w-9 items-center justify-center rounded-full bg-muted">
          <Icon as={entry.source === 'watch' ? WatchIcon : EditIcon} size="md" className="text-muted-foreground" />
        </Box>
        <VStack space="xs" className="flex-1">
          <HStack space="sm" className="items-baseline">
            <Text className="flex-1 text-base font-semibold text-card-foreground" numberOfLines={1}>
              {title}
            </Text>
            <Text
              testID={`logbook-list-max-depth-${siteName}-${toTestIdValue(maxDepthLabel)}`}
              className="text-base font-semibold text-card-foreground">
              {maxDepthLabel}
            </Text>
          </HStack>
          {/* Two lines at most, so an older date with its year never cuts off the dive time. */}
          <Text testID={`logbook-list-meta-${siteName}`} className="text-sm leading-5 text-muted-foreground" numberOfLines={2}>
            {dateLabel} · {diveModeLabel} ·{' '}
            <Text testID={`logbook-list-duration-${siteName}-${toTestIdValue(durationLabel)}`}>{durationLabel}</Text>
          </Text>
          {tags ? (
            <Text testID={`logbook-list-tags-${siteName}`} className="text-sm leading-5 text-muted-foreground" numberOfLines={1}>
              {tags}
            </Text>
          ) : null}
          {unsupportedDepth || badges.length ? (
            <HStack space="xs" className="flex-wrap items-center">
              {unsupportedDepth ? (
                <StatusPill testID={`logbook-list-unsupported-depth-${siteName}`} label={t('logbook.unsupportedDepthMarker')} tone="muted" />
              ) : null}
              {badges.length ? (
                <HStack testID={`logbook-list-badges-${siteName}`} space="xs" className="flex-wrap items-center">
                  {badges.map(badge => (
                    <ListStatusBadge key={badge.testID} kind={badge.kind} label={badge.label} testID={badge.testID} />
                  ))}
                </HStack>
              ) : null}
            </HStack>
          ) : null}
        </VStack>
      </HStack>
    </PressScalePressable>
  );
});
