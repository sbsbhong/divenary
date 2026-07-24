import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '../../components/ui/box';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { InstrumentButton, SafetyText, StatusPill } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import { EditIcon, Icon, SearchIcon, WatchIcon } from '../../components/ui/icon';
import { Input, InputField, InputIcon, InputSlot } from '../../components/ui/input';
import { KeyboardAwareScrollView } from '../../components/ui/keyboard-aware-scroll-view';
import { ListStatusBadge } from '../../components/ui/list-status-badge';
import { Pressable } from '../../components/ui/pressable';
import { RefreshControl } from '../../components/ui/refresh-control';
import { Skeleton, SkeletonText } from '../../components/ui/skeleton';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { DiveLogEntry } from '../../types/dive-log-entry';
import type { DiveSessionFilter } from '../../types/dive-session';
import type { WatchSyncActionResult } from '../../states/use-dive-logbook';
import { createBlankDiveLogEntry } from '../../utils/create-dive-log-entry';
import { formatDate, formatDepth, formatDuration } from '../../utils/dive-formatters';
import { getUnsupportedDepthForLogEntry } from '../../utils/unsupported-depth';
import { diveLogEntryToMobileSession } from '../../states/use-dive-logbook';
import { LogEntryDetail } from './log-entry-detail';
import { LogEntryEditor } from './log-entry-editor';

type LogbookScreenProps = {
  entries: DiveLogEntry[];
  filter: DiveSessionFilter;
  onFilterChange: (filter: DiveSessionFilter) => void;
  onSyncWatch: () => Promise<WatchSyncActionResult>;
  onRefresh: () => void | Promise<void>;
  isLoading?: boolean;
  isRefreshing?: boolean;
  reselectToken?: number;
  onSaveEntry: (entry: DiveLogEntry) => Promise<DiveLogEntry>;
  onDeleteEntry: (localId: string) => Promise<void>;
  onOpenEntry?: (entry: DiveLogEntry) => void;
  onCreateEntry?: () => void;
  pendingDraft?: {
    entry: DiveLogEntry;
    sourcePlanLocalId?: string;
  };
  onPendingDraftSave?: (entry: DiveLogEntry, sourcePlanLocalId?: string) => void;
  saveError?: Error | null;
  isSaving?: boolean;
  isAuthenticated?: boolean;
};

type LocalRoute = 'list' | 'create' | 'detail' | 'edit';

export default function LogbookScreen(props: LogbookScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const [route, setRoute] = React.useState<LocalRoute>('list');
  const [draftEntry, setDraftEntry] = React.useState<DiveLogEntry | undefined>();
  const [syncToastMessage, setSyncToastMessage] = React.useState<string | undefined>();
  const [isSyncingWatch, setIsSyncingWatch] = React.useState(false);
  const consumedPendingDraftKey = React.useRef<string | undefined>(undefined);
  const scrollViewRef = React.useRef<React.ComponentRef<typeof KeyboardAwareScrollView>>(null);
  const editorOffsetRef = React.useRef(0);
  const editorFieldOffsetsRef = React.useRef<Record<string, number>>({});
  const previousReselectToken = React.useRef(props.reselectToken ?? 0);
  const [lastScrollTarget, setLastScrollTarget] = React.useState<number | undefined>();
  const visibleEntries = props.entries;
  const [selectedId, setSelectedId] = React.useState(visibleEntries[0]?.localId);
  const selectedEntry = visibleEntries.find(entry => entry.localId === selectedId);

  React.useEffect(() => {
    if (selectedEntry) {
      return;
    }

    if (visibleEntries[0]) {
      setSelectedId(visibleEntries[0].localId);
    }

    if (route === 'detail') {
      setRoute('list');
    }
  }, [route, selectedEntry, visibleEntries]);

  React.useEffect(() => {
    if (!props.pendingDraft) {
      return;
    }

    const pendingDraftKey = `${props.pendingDraft.entry.localId}:${props.pendingDraft.sourcePlanLocalId ?? ''}`;

    if (consumedPendingDraftKey.current === pendingDraftKey) {
      return;
    }

    consumedPendingDraftKey.current = pendingDraftKey;
    setDraftEntry(props.pendingDraft.entry);
    setRoute('create');
  }, [props.pendingDraft]);

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
    if (props.onCreateEntry) {
      props.onCreateEntry();
      return;
    }

    editorFieldOffsetsRef.current = {};
    setLastScrollTarget(undefined);
    setDraftEntry(createBlankDiveLogEntry());
    setRoute('create');
  }, [props]);

  const openEdit = React.useCallback((entry: DiveLogEntry) => {
    editorFieldOffsetsRef.current = {};
    setLastScrollTarget(undefined);
    setDraftEntry(entry);
    setRoute('edit');
  }, []);

  const openDetail = React.useCallback(
    (entry: DiveLogEntry) => {
      setSelectedId(entry.localId);

      if (props.onOpenEntry) {
        props.onOpenEntry(entry);
        return;
      }

      setRoute('detail');
    },
    [props],
  );

  const saveDraft = React.useCallback(
    async (entry: DiveLogEntry) => {
      const savedEntry = await props.onSaveEntry(entry);
      setSelectedId(savedEntry.localId);
      setDraftEntry(undefined);
      setRoute('list');
      if (props.pendingDraft?.entry.localId === entry.localId) {
        props.onPendingDraftSave?.(savedEntry, props.pendingDraft.sourcePlanLocalId);
      }
      return savedEntry;
    },
    [props],
  );

  const deleteEntry = React.useCallback(
    async (localId: string) => {
      await props.onDeleteEntry(localId);
      setRoute('list');
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
    const fallbackOffset = getLogEntryEditorFieldOffset(fieldName);
    const nextOffset = Math.max(0, measuredFieldOffset === undefined ? fallbackOffset : editorOffsetRef.current + measuredFieldOffset - 16);
    setLastScrollTarget(nextOffset);
    scrollViewRef.current?.scrollTo({ y: nextOffset, animated: true });
  }, []);

  const syncWatch = React.useCallback(async () => {
    setIsSyncingWatch(true);
    setSyncToastMessage(undefined);

    try {
      const result = await props.onSyncWatch();

      if (result.importedCount > 0) {
        setSyncToastMessage(t('logbook.syncWatchImported', { count: result.importedCount }));
      } else if (result.unavailable) {
        setSyncToastMessage(t('logbook.syncWatchUnavailable'));
      } else {
        setSyncToastMessage(t('logbook.syncWatchNone'));
      }
    } catch {
      setSyncToastMessage(t('logbook.syncWatchFailed'));
    } finally {
      setIsSyncingWatch(false);
    }
  }, [props, t]);

  return (
    <KeyboardAwareScrollView
      ref={scrollViewRef}
      className="flex-1 bg-background"
      contentContainerClassName="px-5 pt-4 pb-6"
      refreshControl={<RefreshControl refreshing={Boolean(props.isRefreshing)} onRefresh={props.onRefresh} tintColor="#0a84ff" />}
      contentInsetAdjustmentBehavior="automatic">
      <VStack space="lg">
        <VStack space="md">
          <HStack className="items-center justify-between">
            <Text className="flex-1 text-3xl font-semibold leading-9 text-foreground">{t('logbook.title')}</Text>
            <HStack space="sm">
              <InstrumentButton
                testID="logbook-create-action"
                label={t('logbook.createManual')}
                icon={EditIcon}
                variant="primary"
                onPress={openCreate}
                className="min-h-10 px-4 py-2"
              />
              <InstrumentButton
                testID="logbook-import-action"
                label={isSyncingWatch ? t('logbook.syncWatchLoading') : t('logbook.syncWatch')}
                onPress={syncWatch}
                disabled={isSyncingWatch}
                className="min-h-10 px-4 py-2"
              />
            </HStack>
          </HStack>
          {syncToastMessage ? (
            <Text
              testID="logbook-sync-toast"
              className="rounded-2xl bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
              {syncToastMessage}
            </Text>
          ) : null}
          {lastScrollTarget === undefined ? null : (
            <Text testID="logbook-scroll-target" className="hidden">{`${lastScrollTarget}`}</Text>
          )}
          <VStack space="md" className="rounded-2xl bg-card px-4 py-4">
            <Input className="h-11 rounded-full border-0 bg-muted px-5 shadow-none">
              <InputSlot testID="logbook-search-icon">
                <InputIcon as={SearchIcon} className="text-muted-foreground" />
              </InputSlot>
              <InputField
                testID="logbook-search-input"
                placeholder={t('logbook.searchPlaceholder')}
                value={props.filter.query}
                onChangeText={query => props.onFilterChange({ ...props.filter, query })}
                className="px-0 py-0 text-base font-normal"
              />
            </Input>
          </VStack>
        </VStack>

        {(route === 'create' || route === 'edit') && draftEntry ? (
          <Box testID="log-entry-editor-card-anchor" onLayout={registerEditorOffset}>
            <LogEntryEditor
              entry={draftEntry}
              mode={route === 'edit' ? 'edit' : 'create'}
              isSaving={props.isSaving}
              saveError={props.saveError}
              onCancel={() => setRoute(route === 'edit' ? 'detail' : 'list')}
              onSave={saveDraft}
              onFieldLayout={registerEditorFieldOffset}
              onInvalidSubmit={scrollToEditorError}
            />
          </Box>
        ) : null}

        {route === 'detail' && selectedEntry ? (
          <LogEntryDetail entry={selectedEntry} onBack={() => setRoute('list')} onEdit={openEdit} onDelete={deleteEntry} />
        ) : null}

        {route === 'list' ? (
          props.isLoading ? (
            <LogbookLoadingState />
          ) : visibleEntries.length === 0 ? (
            <EmptyLogbook />
          ) : (
            <VStack space="md">
              {visibleEntries.map(entry => (
                <SessionListItem
                  key={entry.localId}
                  entry={entry}
                  showsDeviceOnlyBadge={Boolean(props.isAuthenticated && entry.ownerUserId === undefined)}
                  onPress={() => openDetail(entry)}
                />
              ))}
            </VStack>
          )
        ) : null}

        <SafetyText>{t('logbook.safetyText')}</SafetyText>
      </VStack>
    </KeyboardAwareScrollView>
  );
}

function getLogEntryEditorFieldOffset(fieldName: string): number {
  const offsets: Record<string, number> = {
    startedAt: 220,
    diveMode: 300,
    siteName: 430,
    durationSeconds: 520,
    maxDepthMeters: 520,
    gearIds: 680,
    waterCondition: 760,
    visibilityRating: 840,
    perceivedExertion: 920,
    pressure: 1000,
    repetitionCount: 700,
    trainingFocus: 780,
    buddies: 1120,
    tags: 1200,
    observedMarineLife: 1280,
    notes: 1360,
    rating: 1460,
  };

  return offsets[fieldName] ?? 220;
}

function EmptyLogbook(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <DiveSummaryCard>
      <VStack testID="logbook-empty-state" space="lg">
        <DiveSummaryCard.Header title={t('logbook.noImportedDives')} />
      </VStack>
    </DiveSummaryCard>
  );
}

function LogbookLoadingState(): React.JSX.Element {
  return (
    <VStack testID="logbook-loading-state" space="md">
      {[0, 1, 2].map(index => (
        <DiveSummaryCard key={index}>
          <VStack space="sm">
            <Skeleton className="h-5 w-40 rounded-full" />
            <SkeletonText _lines={2} className="h-4 rounded-full" />
          </VStack>
        </DiveSummaryCard>
      ))}
    </VStack>
  );
}

function SessionListItem(props: {
  entry: DiveLogEntry;
  showsDeviceOnlyBadge: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const session = diveLogEntryToMobileSession(props.entry);
  const listMetrics = getListMetrics(props.entry);
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const tags = session.tags?.length ? session.tags.join(', ') : t('logbook.noTags');
  const siteName = session.siteName ?? t('logbook.untitledDive');
  const title = props.entry.manual.title ?? siteName;
  const maxDepthLabel = formatDepth(listMetrics.maxDepthMeters);
  const durationLabel = formatListDuration(listMetrics.durationSeconds);
  const unsupportedDepth = getUnsupportedDepthForLogEntry(props.entry);
  const badges = [
    ...(props.entry.watchCapture?.session.captureMode === 'demo'
      ? [{ kind: 'demo' as const, label: t('logbook.demoCapture') }]
      : []),
    ...(props.showsDeviceOnlyBadge
      ? [{ kind: 'device' as const, label: t('accountClaim.deviceBadge') }]
      : []),
  ];
  const accessibilityLabel = [title, ...badges.map(badge => badge.label)].join(', ');

  return (
    <Pressable
      testID={`logbook-list-item-${siteName}`}
      onPress={props.onPress}
      accessible={badges.length ? true : undefined}
      accessibilityLabel={badges.length ? accessibilityLabel : undefined}
      className="rounded-2xl bg-card px-4 py-4"
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
      <VStack space="sm">
        <HStack className="items-center justify-between">
          <HStack space="md" className="flex-1 items-center pr-2.5">
            <Box
              testID={`logbook-list-source-icon-${siteName}`}
              className="h-9 w-9 items-center justify-center rounded-full bg-primary/10">
              <Icon as={props.entry.source === 'watch' ? WatchIcon : EditIcon} size="md" className="text-primary" />
            </Box>
            <VStack space="xs" className="flex-1">
              <Text className="text-lg font-semibold text-card-foreground">{title}</Text>
              <Text className="text-sm leading-5 text-muted-foreground">
                {formatDate(session.startedAt, locale, t('formatters.unknownDate'))}
              </Text>
              {badges.length ? (
                <HStack testID={`logbook-list-badges-${siteName}`} space="xs" className="flex-wrap items-center">
                  {badges.map(badge => (
                    <ListStatusBadge
                      key={badge.kind}
                      kind={badge.kind}
                      label={badge.label}
                      testID={badge.kind === 'demo' ? `logbook-demo-badge-${siteName}` : `logbook-device-badge-${siteName}`}
                    />
                  ))}
                </HStack>
              ) : null}
            </VStack>
          </HStack>
          <VStack space="xs" className="items-end">
            {unsupportedDepth ? (
              <StatusPill
                testID={`logbook-list-unsupported-depth-${siteName}`}
                label={t('logbook.unsupportedDepthMarker')}
                tone="muted"
              />
            ) : null}
            <Text testID={`logbook-list-max-depth-${siteName}-${toTestIdValue(maxDepthLabel)}`} className="text-lg font-semibold text-card-foreground">
              {maxDepthLabel}
            </Text>
          </VStack>
        </HStack>
        <Text className="pl-14 text-sm leading-5 text-muted-foreground">
          {session.diveMode ? t(`diveModes.${session.diveMode}`) : t('diveModes.notSet')} ·{' '}
          <Text testID={`logbook-list-duration-${siteName}-${toTestIdValue(durationLabel)}`}>{durationLabel}</Text> · {tags}
        </Text>
      </VStack>
    </Pressable>
  );
}

function getListMetrics(entry: DiveLogEntry): { durationSeconds?: number; maxDepthMeters?: number } {
  if (entry.watchCapture) {
    return {
      durationSeconds: entry.watchCapture.measuredValues.durationSeconds,
      maxDepthMeters: entry.watchCapture.measuredValues.maxDepthMeters,
    };
  }

  return {
    durationSeconds: entry.manual.measuredValues.durationSeconds,
    maxDepthMeters: entry.manual.measuredValues.maxDepthMeters,
  };
}

function formatListDuration(seconds: number | undefined): string {
  return seconds === undefined ? '--:--' : formatDuration(seconds);
}

function toTestIdValue(value: string): string {
  return value.replace(/\s+/g, '');
}
