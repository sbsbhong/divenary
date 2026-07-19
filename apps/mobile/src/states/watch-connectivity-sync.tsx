import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import React from 'react';
import { AppState } from 'react-native';
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
import {
  defaultWatchConnectivityImportCoordinator,
  isStaleWatchConnectivityImportError,
  type WatchConnectivityImportGuard,
  type WatchConnectivityImportCoordinator,
  type WatchConnectivityImportScope,
} from './watch-connectivity-import-coordinator';
import { useOptionalAccountData } from './account-data';

type WatchConnectivitySyncProviderProps = {
  children?: React.ReactNode;
  repository?: DiveLogRepository;
  planRepository?: DivePlanRepository;
  queryScope?: string;
  drainPendingPayloads?: () => Promise<WatchConnectivityPayload[]>;
  acknowledgePayloads?: (payloadIds: readonly string[]) => Promise<void>;
  acknowledgeImportedPayloads?: (payloadIds: readonly string[]) => Promise<void>;
  notifyImportedEntry?: (entry: DiveLogEntry) => Promise<void>;
  onImportedEntry?: (entry: DiveLogEntry) => void;
  subscribeToPayloads?: (handler: (payload: WatchConnectivityPayload) => void) => WatchConnectivitySubscription;
  coordinator?: WatchConnectivityImportCoordinator;
  preferencesHydrated?: boolean;
  onLocalWritesCommitted?: () => Promise<unknown>;
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
  coordinator?: WatchConnectivityImportCoordinator;
  onLocalWritesCommitted?: () => Promise<unknown>;
};

export type WatchConnectivityImportSummary = {
  receivedCount: number;
  importedCount: number;
};

type WatchConnectivityAcknowledgement = (payloadIds: readonly string[]) => Promise<void>;

type DeferredAccountQueueRepository<T> = {
  saveLocalOnly?(value: T): Promise<T>;
  enqueueSaved?(value: T): Promise<void>;
};

type WatchConnectivityPayloadImportOptions = {
  payload: WatchConnectivityPayload;
  repository: DiveLogRepository;
  planRepository: DivePlanRepository;
  queryClient: QueryClient;
  queryScope?: string;
  acknowledgePayloads: WatchConnectivityAcknowledgement;
  acknowledgeImportedPayloads: WatchConnectivityAcknowledgement;
  notifyImportedEntry?: (entry: DiveLogEntry) => Promise<void>;
  coordinator: WatchConnectivityImportCoordinator;
  scope: WatchConnectivityImportScope;
  onLocalWritesCommitted?: () => Promise<unknown>;
};

type WatchConnectivityPayloadImportOnceOptions = Omit<
  WatchConnectivityPayloadImportOptions,
  'coordinator' | 'scope'
> & {
  guard: WatchConnectivityImportGuard;
};

export function WatchConnectivitySyncProvider(
  props: WatchConnectivitySyncProviderProps,
): React.JSX.Element {
  const accountData = useOptionalAccountData();
  const children = props.children;
  const repository = props.repository ?? accountData?.logbookRepository ?? defaultDiveLogRepository;
  const planRepository = props.planRepository ?? accountData?.planRepository ?? defaultDivePlanRepository;
  const queryScope = props.queryScope ?? (props.repository ? undefined : accountData?.queryScope);
  const drainPendingPayloads = props.drainPendingPayloads ?? drainPendingWatchConnectivityPayloads;
  const acknowledgePayloads = props.acknowledgePayloads ?? acknowledgeWatchConnectivityPayloads;
  const acknowledgeImportedPayloads = props.acknowledgeImportedPayloads ?? acknowledgeImportedWatchConnectivityPayloads;
  const notifyImportedEntry = props.notifyImportedEntry;
  const onImportedEntry = props.onImportedEntry;
  const subscribeToPayloads = props.subscribeToPayloads ?? subscribeToWatchConnectivityPayloads;
  const coordinator = props.coordinator ?? defaultWatchConnectivityImportCoordinator;
  const preferencesHydrated = props.preferencesHydrated ?? true;
  const onLocalWritesCommitted = props.onLocalWritesCommitted
    ?? (props.repository ? undefined : accountData?.requestSync);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!preferencesHydrated) {
      return;
    }
    const scope = coordinator.activateScope(queryScope);
    let isMounted = true;
    const importPayload = async (payload: WatchConnectivityPayload) => {
      const importedEntry = await importWatchConnectivityPayload({
        payload,
        repository,
        planRepository,
        queryClient,
        acknowledgePayloads,
        acknowledgeImportedPayloads,
        notifyImportedEntry,
        coordinator,
        scope,
        queryScope,
        onLocalWritesCommitted,
      });

      if (importedEntry) {
        onImportedEntry?.(importedEntry);
      }
    };
    const importPayloadSafely = (payload: WatchConnectivityPayload) => {
      void importPayload(payload).catch(error => {
        if (!isStaleWatchConnectivityImportError(error)) {
          console.warn('Failed to import watch sync payload', error);
        }
      });
    };
    const subscription = subscribeToPayloads(payload => {
      importPayloadSafely(payload);
    });

    const drain = async () => {
      const seenPayloadIds = new Set<string>();
      try {
        while (isMounted) {
          const payloads = await drainPendingPayloads();
          if (!payloads.length) {
            return;
          }
          const freshPayloads = payloads.filter(payload => !payload.payloadId || !seenPayloadIds.has(payload.payloadId));
          if (!freshPayloads.length) {
            return;
          }
          for (const payload of freshPayloads) {
            if (payload.payloadId) {
              seenPayloadIds.add(payload.payloadId);
            }
            try {
              await importPayload(payload);
            } catch (error) {
              if (!isStaleWatchConnectivityImportError(error)) {
                console.warn('Failed to import watch sync payload', error);
              }
              return;
            }
          }
        }
      } catch (error) {
        console.warn('Failed to drain pending watch sync payloads', error);
      }
    };
    void drain();
    const appStateSubscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        void drain();
      }
    });

    return () => {
      isMounted = false;
      coordinator.invalidateScope(scope);
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [
    acknowledgeImportedPayloads,
    acknowledgePayloads,
    coordinator,
    drainPendingPayloads,
    notifyImportedEntry,
    onImportedEntry,
    onLocalWritesCommitted,
    planRepository,
    preferencesHydrated,
    queryClient,
    queryScope,
    repository,
    subscribeToPayloads,
  ]);

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
  coordinator = defaultWatchConnectivityImportCoordinator,
  onLocalWritesCommitted,
}: WatchConnectivityImportOptions): Promise<WatchConnectivityImportSummary> {
  let importedCount = 0;
  let receivedCount = 0;
  const seenPayloadIds = new Set<string>();
  const scope = coordinator.activateScope(queryScope);

  while (true) {
    const payloads = await drainPendingPayloads();
    if (!payloads.length) {
      break;
    }
    const freshPayloads = payloads.filter(payload => !payload.payloadId || !seenPayloadIds.has(payload.payloadId));
    if (!freshPayloads.length) {
      break;
    }
    receivedCount += freshPayloads.length;
    for (const payload of freshPayloads) {
      if (payload.payloadId) {
        seenPayloadIds.add(payload.payloadId);
      }
      const importedEntry = await importWatchConnectivityPayload({
        payload,
        repository,
        planRepository,
        queryClient,
        queryScope,
        acknowledgePayloads,
        acknowledgeImportedPayloads,
        notifyImportedEntry,
        coordinator,
        scope,
        onLocalWritesCommitted,
      });

      if (importedEntry) {
        importedCount += 1;
      }
    }
  }

  return {
    receivedCount,
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
  coordinator,
  scope,
  onLocalWritesCommitted,
}: WatchConnectivityPayloadImportOptions): Promise<DiveLogEntry | undefined> {
  return coordinator.run(scope, payload, guard => importWatchConnectivityPayloadOnce({
    payload,
    repository,
    planRepository,
    queryClient,
    queryScope,
    acknowledgePayloads,
    acknowledgeImportedPayloads,
    notifyImportedEntry,
    guard,
    onLocalWritesCommitted,
  }));
}

async function importWatchConnectivityPayloadOnce({
  payload,
  repository,
  planRepository,
  queryClient,
  queryScope,
  acknowledgePayloads,
  acknowledgeImportedPayloads,
  notifyImportedEntry,
  guard,
  onLocalWritesCommitted,
}: WatchConnectivityPayloadImportOnceOptions): Promise<DiveLogEntry | undefined> {
  const result = parseWatchSyncMessageJson(payload.payloadJson);

  if (!result.ok) {
    console.warn('Dropped invalid watch sync payload', result.error);
    await acknowledgePayload(payload, acknowledgePayloads);
    return undefined;
  }

  const existingEntries = await repository.list();
  const duplicate = existingEntries.find(entry =>
    entry.watchCapture?.session.localSessionId === result.message.session.localSessionId
      && entry.watchCapture?.profile?.contentRevision === payload.contentRevision
      && Boolean(payload.sha256)
      && entry.watchCapture?.profile?.sha256 === payload.sha256,
  );
  if (duplicate) {
    const existingPlan = await findSourcePlan(planRepository, result.message);
    const pendingDuplicate = await persistExistingAccountPendingValue(
      repository,
      duplicate,
      guard,
    );
    const pendingPlan = await persistExistingAccountPendingValue(
      planRepository,
      existingPlan,
      guard,
    );
    guard.assertActive();
    await acknowledgePayload(payload, acknowledgeImportedPayloads);
    await enqueueExistingPendingAccountValue(repository, pendingDuplicate);
    await enqueueExistingPendingAccountValue(planRepository, pendingPlan);
    requestAccountSyncSafely(onLocalWritesCommitted);
    return undefined;
  }
  guard.assertActive();
  const entries = await repository.importWatchMessages([result.message], {
    profileDigests: [payload.sha256],
    assertCanCommit: guard.assertActive,
  });
  const { importedEntry, completedPlan, entries: importedEntries } = await markWatchConnectivityImported(
    repository,
    planRepository,
    queryClient,
    entries,
    result.message,
    payload,
    queryScope,
    guard,
  );
  guard.assertActive();
  queryClient.setQueryData(diveLogbookQueryKeys.list(repository, queryScope), importedEntries);
  queryClient.invalidateQueries({ queryKey: diveLogbookQueryKeys.all(repository, queryScope) });
  guard.assertActive();
  await acknowledgePayload(payload, acknowledgeImportedPayloads);
  await enqueueSavedAccountValue<DiveLogEntry>(repository, importedEntry);
  await enqueueSavedAccountValue<DivePlan>(planRepository, completedPlan);
  requestAccountSyncSafely(onLocalWritesCommitted);
  await notifyImportedEntrySafely(importedEntry, notifyImportedEntry);
  return importedEntry;
}

function requestAccountSyncSafely(
  requestSync: (() => Promise<unknown>) | undefined,
): void {
  if (!requestSync) {
    return;
  }
  void requestSync().catch(error => {
    console.warn('Failed to schedule account sync after watch import', error);
  });
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
  guard?: WatchConnectivityImportGuard,
): Promise<{
  importedEntry?: DiveLogEntry;
  completedPlan?: DivePlan;
  entries: DiveLogEntry[];
}> {
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
  let completedPlan: DivePlan | undefined;

  const pendingEntry: DiveLogEntry = {
    ...enrichedEntry,
    cloudSyncStatus: 'notConfigured',
    updatedAt: payload.receivedAt ?? Date.now() / 1000,
  };
  guard?.assertActive();
  const savedEntry = await saveLocalAccountValue(repository, pendingEntry);

  if (sourcePlan) {
    completedPlan = await completeSourcePlanSafely(
      planRepository,
      queryClient,
      sourcePlan,
      savedEntry,
      message,
      payload,
      queryScope,
      guard,
    );
  }

  const currentEntries = await repository.list();
  const currentImportedEntry = currentEntries.find(entry => entry.localId === savedEntry.localId) ?? savedEntry;

  return {
    importedEntry: currentImportedEntry,
    completedPlan,
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
  guard?: WatchConnectivityImportGuard,
): Promise<DivePlan | undefined> {
  try {
    return await completeSourcePlan(
      planRepository,
      queryClient,
      plan,
      entry,
      message,
      payload,
      queryScope,
      guard,
    );
  } catch (error) {
    if (isStaleWatchConnectivityImportError(error)) {
      throw error;
    }
    console.warn('Failed to complete source dive plan after watch import', error);
    return undefined;
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
  guard?: WatchConnectivityImportGuard,
): Promise<DivePlan> {
  const completedAt = message.session.endedAt ?? payload.receivedAt ?? Date.now() / 1000;
  guard?.assertActive();
  const savedPlan = await saveLocalAccountValue(planRepository, {
    ...plan,
    status: 'completed',
    completedAt,
    convertedLogLocalId: entry.localId,
    updatedAt: completedAt,
  });

  guard?.assertActive();
  queryClient.setQueryData(divePlanQueryKeys.detail(savedPlan.localId, planRepository, queryScope), savedPlan);
  queryClient.setQueryData<DivePlan[]>(divePlanQueryKeys.list(planRepository, queryScope), currentPlans =>
    (currentPlans ?? []).map(currentPlan => (currentPlan.localId === savedPlan.localId ? savedPlan : currentPlan)),
  );
  queryClient.invalidateQueries({ queryKey: divePlanQueryKeys.all(planRepository, queryScope) });
  return savedPlan;
}

async function saveLocalAccountValue<T>(
  repository: {save(value: T): Promise<T>} & DeferredAccountQueueRepository<T>,
  value: T,
): Promise<T> {
  return repository.saveLocalOnly
    ? repository.saveLocalOnly(value)
    : repository.save(value);
}

async function enqueueSavedAccountValue<T>(
  repository: object,
  value: T | undefined,
): Promise<void> {
  const accountRepository = repository as DeferredAccountQueueRepository<T>;
  if (value !== undefined && accountRepository.enqueueSaved) {
    await accountRepository.enqueueSaved(value);
  }
}

async function enqueueExistingPendingAccountValue<
  T extends {cloudSyncStatus?: string},
>(
  repository: object,
  value: T | undefined,
): Promise<void> {
  if (value?.cloudSyncStatus !== 'pending') {
    return;
  }
  await enqueueSavedAccountValue(repository, value);
}

async function persistExistingAccountPendingValue<
  T extends {cloudSyncStatus?: string},
>(
  repository: object,
  value: T | undefined,
  guard: WatchConnectivityImportGuard,
): Promise<T | undefined> {
  if (value?.cloudSyncStatus !== 'notConfigured') {
    return value;
  }

  const accountRepository = repository as DeferredAccountQueueRepository<T>;
  if (!accountRepository.saveLocalOnly || !accountRepository.enqueueSaved) {
    return value;
  }

  guard.assertActive();
  return accountRepository.saveLocalOnly(value);
}
