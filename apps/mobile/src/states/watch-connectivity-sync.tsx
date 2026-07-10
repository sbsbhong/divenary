import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import React from 'react';
import {
  acknowledgeImportedWatchConnectivityPayloads,
  acknowledgeWatchConnectivityPayloads,
  drainPendingWatchConnectivityPayloads,
  subscribeToWatchConnectivityPayloads,
  type WatchConnectivityPayload,
  type WatchConnectivitySubscription,
} from '../native/watch-connectivity';
import { defaultDiveLogRepository } from '../repositories/default-dive-log-repository';
import { defaultDivePlanRepository } from '../repositories/default-dive-plan-repository';
import type { DiveLogRepository } from '../repositories/dive-log-repository';
import type { DivePlanRepository } from '../repositories/dive-plan-repository';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DivePlan } from '../types/dive-plan';
import type { WatchSyncMessage } from '../types/dive-session';
import { enrichWatchLogWithSourcePlan, getWatchSessionSourcePlanLocalId } from '../utils/enrich-watch-log-with-plan';
import { parseWatchSyncMessageJson } from '../utils/watch-sync-message-validation';
import { diveLogbookQueryKeys } from './use-dive-logbook-queries';
import { divePlanQueryKeys } from './use-dive-plan-queries';

type WatchConnectivitySyncProviderProps = {
  children?: React.ReactNode;
  repository?: DiveLogRepository;
  planRepository?: DivePlanRepository;
  drainPendingPayloads?: () => Promise<WatchConnectivityPayload[]>;
  acknowledgePayloads?: (payloadIds: readonly string[]) => Promise<void>;
  acknowledgeImportedPayloads?: (payloadIds: readonly string[]) => Promise<void>;
  notifyImportedEntry?: (entry: DiveLogEntry) => Promise<void>;
  onImportedEntry?: (entry: DiveLogEntry) => void;
  subscribeToPayloads?: (handler: (payload: WatchConnectivityPayload) => void) => WatchConnectivitySubscription;
};

type WatchConnectivityImportOptions = {
  repository: DiveLogRepository;
  planRepository?: DivePlanRepository;
  queryClient: QueryClient;
  queryScope?: string;
  drainPendingPayloads?: () => Promise<WatchConnectivityPayload[]>;
  acknowledgePayloads?: (payloadIds: readonly string[]) => Promise<void>;
  acknowledgeImportedPayloads?: (payloadIds: readonly string[]) => Promise<void>;
  notifyImportedEntry?: (entry: DiveLogEntry) => Promise<void>;
};

export type WatchConnectivityImportSummary = {
  receivedCount: number;
  importedCount: number;
};

type WatchConnectivityAcknowledgement = (payloadIds: readonly string[]) => Promise<void>;

type WatchConnectivityPayloadImportOptions = {
  payload: WatchConnectivityPayload;
  repository: DiveLogRepository;
  planRepository: DivePlanRepository;
  queryClient: QueryClient;
  queryScope?: string;
  acknowledgePayloads: WatchConnectivityAcknowledgement;
  acknowledgeImportedPayloads: WatchConnectivityAcknowledgement;
  notifyImportedEntry?: (entry: DiveLogEntry) => Promise<void>;
};

export function WatchConnectivitySyncProvider({
  children,
  repository = defaultDiveLogRepository,
  planRepository = defaultDivePlanRepository,
  drainPendingPayloads = drainPendingWatchConnectivityPayloads,
  acknowledgePayloads = acknowledgeWatchConnectivityPayloads,
  acknowledgeImportedPayloads = acknowledgeImportedWatchConnectivityPayloads,
  notifyImportedEntry,
  onImportedEntry,
  subscribeToPayloads = subscribeToWatchConnectivityPayloads,
}: WatchConnectivitySyncProviderProps): React.JSX.Element {
  const queryClient = useQueryClient();

  const importPayload = React.useCallback(
    async (payload: WatchConnectivityPayload) => {
      const importedEntry = await importWatchConnectivityPayload({
        payload,
        repository,
        planRepository,
        queryClient,
        acknowledgePayloads,
        acknowledgeImportedPayloads,
        notifyImportedEntry,
      });

      if (importedEntry) {
        onImportedEntry?.(importedEntry);
      }
    },
    [
      acknowledgeImportedPayloads,
      acknowledgePayloads,
      notifyImportedEntry,
      onImportedEntry,
      planRepository,
      queryClient,
      repository,
    ],
  );

  const importPayloadSafely = React.useCallback(
    (payload: WatchConnectivityPayload) => {
      void importPayload(payload).catch(error => {
        console.warn('Failed to import watch sync payload', error);
      });
    },
    [importPayload],
  );

  React.useEffect(() => {
    let isMounted = true;
    const subscription = subscribeToPayloads(payload => {
      importPayloadSafely(payload);
    });

    drainPendingPayloads()
      .then(payloads => {
        if (!isMounted) {
          return;
        }

        for (const payload of payloads) {
          importPayloadSafely(payload);
        }
      })
      .catch(error => {
        console.warn('Failed to drain pending watch sync payloads', error);
      });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [drainPendingPayloads, importPayloadSafely, subscribeToPayloads]);

  return <>{children}</>;
}

export async function importPendingWatchConnectivityPayloads({
  repository,
  planRepository = defaultDivePlanRepository,
  queryClient,
  queryScope,
  drainPendingPayloads = drainPendingWatchConnectivityPayloads,
  acknowledgePayloads = acknowledgeWatchConnectivityPayloads,
  acknowledgeImportedPayloads = acknowledgeImportedWatchConnectivityPayloads,
  notifyImportedEntry,
}: WatchConnectivityImportOptions): Promise<WatchConnectivityImportSummary> {
  const payloads = await drainPendingPayloads();
  let importedCount = 0;

  for (const payload of payloads) {
    const importedEntry = await importWatchConnectivityPayload({
      payload,
      repository,
      planRepository,
      queryClient,
      queryScope,
      acknowledgePayloads,
      acknowledgeImportedPayloads,
      notifyImportedEntry,
    });

    if (importedEntry) {
      importedCount += 1;
    }
  }

  return {
    receivedCount: payloads.length,
    importedCount,
  };
}

async function importWatchConnectivityPayload({
  payload,
  repository,
  planRepository,
  queryClient,
  queryScope,
  acknowledgePayloads,
  acknowledgeImportedPayloads,
  notifyImportedEntry,
}: WatchConnectivityPayloadImportOptions): Promise<DiveLogEntry | undefined> {
  const result = parseWatchSyncMessageJson(payload.payloadJson);

  if (!result.ok) {
    console.warn('Dropped invalid watch sync payload', result.error);
    await acknowledgePayload(payload, acknowledgePayloads);
    return undefined;
  }

  const entries = await repository.importWatchMessages([result.message]);
  const { importedEntry, entries: importedEntries } = await markWatchConnectivityImported(
    repository,
    planRepository,
    queryClient,
    entries,
    result.message,
    payload,
    queryScope,
  );
  queryClient.setQueryData(diveLogbookQueryKeys.list(repository, queryScope), importedEntries);
  queryClient.invalidateQueries({ queryKey: diveLogbookQueryKeys.all(repository, queryScope) });
  await acknowledgePayload(payload, acknowledgeImportedPayloads);
  await notifyImportedEntrySafely(importedEntry, notifyImportedEntry);
  return importedEntry;
}

async function notifyImportedEntrySafely(
  importedEntry: DiveLogEntry | undefined,
  notifyImportedEntry: ((entry: DiveLogEntry) => Promise<void>) | undefined,
): Promise<void> {
  if (!importedEntry || !notifyImportedEntry) {
    return;
  }

  try {
    await notifyImportedEntry(importedEntry);
  } catch (error) {
    console.warn('Failed to show watch sync notification', error);
  }
}

async function acknowledgePayload(
  payload: WatchConnectivityPayload,
  acknowledgePayloads: WatchConnectivityAcknowledgement,
): Promise<void> {
  if (!payload.payloadId) {
    return;
  }

  await acknowledgePayloads([payload.payloadId]);
}

async function markWatchConnectivityImported(
  repository: DiveLogRepository,
  planRepository: DivePlanRepository,
  queryClient: QueryClient,
  entries: DiveLogEntry[],
  message: WatchSyncMessage,
  payload: WatchConnectivityPayload,
  queryScope?: string,
): Promise<{ importedEntry?: DiveLogEntry; entries: DiveLogEntry[] }> {
  const importedEntry = entries.find(entry => {
    const session = entry.watchCapture?.session;
    return (
      session?.localSessionId === message.session.localSessionId &&
      session?.endedAt === message.session.endedAt
    );
  });

  if (!importedEntry) {
    return { entries };
  }

  const sourcePlan = await findSourcePlan(planRepository, message);
  const enrichedEntry = sourcePlan ? enrichWatchLogWithSourcePlan(importedEntry, sourcePlan) : importedEntry;

  const savedEntry = await repository.save({
    ...enrichedEntry,
    syncStatus: 'pending',
    updatedAt: payload.receivedAt ?? Date.now() / 1000,
  });

  if (sourcePlan) {
    await completeSourcePlanSafely(planRepository, queryClient, sourcePlan, savedEntry, message, payload, queryScope);
  }

  const currentEntries = await repository.list();
  const currentImportedEntry = currentEntries.find(entry => entry.localId === savedEntry.localId) ?? savedEntry;

  return {
    importedEntry: currentImportedEntry,
    entries: currentEntries,
  };
}

async function findSourcePlan(
  planRepository: DivePlanRepository,
  message: WatchSyncMessage,
): Promise<DivePlan | undefined> {
  const sourcePlanLocalId = getWatchSessionSourcePlanLocalId(message.session);
  return sourcePlanLocalId ? planRepository.get(sourcePlanLocalId) : undefined;
}

async function completeSourcePlanSafely(
  planRepository: DivePlanRepository,
  queryClient: QueryClient,
  plan: DivePlan,
  entry: DiveLogEntry,
  message: WatchSyncMessage,
  payload: WatchConnectivityPayload,
  queryScope?: string,
): Promise<void> {
  try {
    await completeSourcePlan(planRepository, queryClient, plan, entry, message, payload, queryScope);
  } catch (error) {
    console.warn('Failed to complete source dive plan after watch import', error);
  }
}

async function completeSourcePlan(
  planRepository: DivePlanRepository,
  queryClient: QueryClient,
  plan: DivePlan,
  entry: DiveLogEntry,
  message: WatchSyncMessage,
  payload: WatchConnectivityPayload,
  queryScope?: string,
): Promise<void> {
  const completedAt = message.session.endedAt ?? payload.receivedAt ?? Date.now() / 1000;
  const savedPlan = await planRepository.save({
    ...plan,
    status: 'completed',
    completedAt,
    convertedLogLocalId: entry.localId,
    updatedAt: completedAt,
  });

  queryClient.setQueryData(divePlanQueryKeys.detail(savedPlan.localId, planRepository, queryScope), savedPlan);
  queryClient.setQueryData<DivePlan[]>(divePlanQueryKeys.list(planRepository, queryScope), currentPlans =>
    (currentPlans ?? []).map(currentPlan => (currentPlan.localId === savedPlan.localId ? savedPlan : currentPlan)),
  );
  queryClient.invalidateQueries({ queryKey: divePlanQueryKeys.all(planRepository, queryScope) });
}
