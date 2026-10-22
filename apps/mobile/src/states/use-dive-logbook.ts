import { useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { defaultWatchLink } from '../companion/default-watch-link';
import { defaultDiveLogRepository } from '../repositories/default-dive-log-repository';
import type { DiveLogRepository } from '../repositories/dive-log-repository';
import {
  useDeleteDiveLogEntryMutation,
  useDiveLogEntriesQuery,
  useSaveDiveLogEntryMutation,
} from './use-dive-logbook-queries';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DiveSessionFilter, MobileDiveSession } from '../types/dive-session';
import { importPendingWatchPayloads, type WatchImportSummary } from './watch-sync';
import { firstNonBlankText } from '../utils/notes';
import { getVisibleLogTags } from '../utils/watch-session-to-dive-log-entry';
import { useOptionalAccountData } from './account-data';

type UseDiveLogbookOptions = {
  repository?: DiveLogRepository;
  queryScope?: string;
};

type DiveLogRepositoryWithSyncList = DiveLogRepository & {
  listSync?: () => DiveLogEntry[];
};

export type WatchSyncActionResult = WatchImportSummary & {
  unavailable: boolean;
};

export const useDiveLogbook = (options: UseDiveLogbookOptions = {}) => {
  const accountData = useOptionalAccountData();
  const repository = options.repository ?? accountData?.logbookRepository ?? defaultDiveLogRepository;
  const planRepository = accountData?.planRepository;
  const queryScope = options.queryScope ?? (options.repository ? undefined : accountData?.queryScope);
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<DiveSessionFilter>({ query: '' });
  const initialEntries = React.useMemo(() => {
    const repositoryWithSyncList = repository as DiveLogRepositoryWithSyncList;

    if (typeof repositoryWithSyncList.listSync === 'function') {
      return repositoryWithSyncList.listSync();
    }

    return undefined;
  }, [repository]);
  const entriesQuery = useDiveLogEntriesQuery(repository, {
    initialData: initialEntries,
    staleTime: Infinity,
    queryScope,
  });
  const saveEntryMutation = useSaveDiveLogEntryMutation(repository, { queryScope });
  const deleteEntryMutation = useDeleteDiveLogEntryMutation(repository, { queryScope });
  const entries = React.useMemo<DiveLogEntry[]>(
    () => entriesQuery.data ?? initialEntries ?? [],
    [entriesQuery.data, initialEntries],
  );
  const sessions = React.useMemo(() => entries.map(diveLogEntryToMobileSession), [entries]);

  const filteredEntries = React.useMemo(() => {
    const query = filter.query.trim().toLowerCase();

    return entries.filter(entry => {
      const session = diveLogEntryToMobileSession(entry);
      // Search the tags the diver sees, not the watch's internal ones (watch-capture, plan-…).
      const visibleTags = getVisibleLogTags(entry);
      const searchable = [
        session.siteName,
        session.notes,
        session.gasLabel,
        session.diveMode,
        ...visibleTags,
        ...(session.buddyIds ?? []),
        ...(session.gearIds ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesQuery = query.length === 0 || searchable.includes(query);
      const matchesTag = !filter.tag || visibleTags.includes(filter.tag);
      return matchesQuery && matchesTag;
    });
  }, [entries, filter]);

  const filteredSessions = React.useMemo(() => filteredEntries.map(diveLogEntryToMobileSession), [filteredEntries]);

  const syncWatchPayloads = React.useCallback(async (): Promise<WatchSyncActionResult> => {
    const summary = await importPendingWatchPayloads({
      repository,
      planRepository,
      queryClient,
      queryScope,
      onLocalWritesCommitted: options.repository ? undefined : accountData?.requestSync,
    });

    return {
      ...summary,
      unavailable: !defaultWatchLink.isAvailable(),
    };
  }, [accountData?.requestSync, options.repository, planRepository, queryClient, queryScope, repository]);

  const saveEntry = React.useCallback(async (entry: DiveLogEntry) => {
    const saved = await saveEntryMutation.mutateAsync(entry);
    if (!options.repository) {
      void accountData?.requestSync();
    }
    return saved;
  }, [accountData, options.repository, saveEntryMutation]);

  const deleteEntry = React.useCallback(async (localId: string) => {
    await deleteEntryMutation.mutateAsync(localId);
    if (!options.repository) {
      void accountData?.requestSync();
    }
  }, [accountData, deleteEntryMutation, options.repository]);

  // Background refetches (each cloud page, each save) stay silent; only a requested refresh
  // shows the refreshing state.
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const refresh = React.useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (!options.repository) {
        try {
          await accountData?.refreshCloudData();
        } catch {
          // Account state retains local rows and exposes the retryable cloud issue.
        }
      }
      await entriesQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [accountData, entriesQuery, options.repository]);
  const loadWatchProfile = React.useCallback(
    (localId: string) => repository.getWatchProfile(localId),
    [repository],
  );

  return {
    entries,
    sessions,
    filteredEntries,
    filteredSessions,
    filter,
    setFilter,
    syncWatchPayloads,
    refresh,
    loadWatchProfile,
    saveEntry,
    deleteEntry,
    isLoading: entriesQuery.isLoading,
    isRefreshing,
    isCloudLoading: options.repository ? false : accountData?.isCloudRefreshing === true,
    isSaving: saveEntryMutation.isPending,
    isDeleting: deleteEntryMutation.isPending,
    listError: entriesQuery.error,
    saveError: saveEntryMutation.error,
    deleteError: deleteEntryMutation.error,
  };
};

export const diveLogEntryToMobileSession = (entry: DiveLogEntry): MobileDiveSession => {
  if (entry.watchCapture) {
    return {
      ...entry.watchCapture.session,
      planTitle: entry.manual.title ?? entry.watchCapture.session.planTitle,
      siteId: entry.manual.site.siteId ?? entry.watchCapture.session.siteId,
      siteName: entry.manual.site.name ?? entry.watchCapture.session.siteName,
      buddyIds: entry.manual.buddyIds,
      gearIds: entry.manual.gearIds,
      tags: entry.manual.tags,
      notes: firstNonBlankText(entry.manual.notes, entry.watchCapture.session.notes),
      rating: entry.manual.rating,
      diveMode: entry.manual.measuredValues.diveMode ?? entry.watchCapture.session.diveMode,
      gasLabel: entry.manual.measuredValues.gasLabel ?? entry.watchCapture.session.gasLabel,
      importKey: entry.watchCapture.importKey,
      importedAt: entry.watchCapture.importedAt,
      mediaPlaceholders: entry.mobile.mediaPlaceholders,
    };
  }

  const startedAt = entry.manual.measuredValues.startedAt ?? entry.createdAt;
  const endedAt =
    entry.manual.measuredValues.endedAt ??
    (entry.manual.measuredValues.durationSeconds === undefined ? undefined : startedAt + entry.manual.measuredValues.durationSeconds);

  return {
    localSessionId: entry.localId,
    startedAt,
    endedAt,
    maxDepthMeters: entry.manual.measuredValues.maxDepthMeters,
    averageDepthMeters: entry.manual.measuredValues.averageDepthMeters,
    waterTemperatureCelsius: entry.manual.measuredValues.waterTemperatureCelsius,
    diveMode: entry.manual.measuredValues.diveMode,
    gasLabel: entry.manual.measuredValues.gasLabel,
    siteId: entry.manual.site.siteId,
    siteName: entry.manual.site.name,
    buddyIds: entry.manual.buddyIds,
    gearIds: entry.manual.gearIds,
    tags: entry.manual.tags,
    notes: entry.manual.notes,
    rating: entry.manual.rating,
    samples: [],
    importKey: entry.localId,
    importedAt: entry.createdAt,
    mediaPlaceholders: entry.mobile.mediaPlaceholders,
  };
};
