import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import React from 'react';
import { AppState, InteractionManager } from 'react-native';
import { defaultWatchLink } from '../companion/default-watch-link';
import {
  isInvalidPreparedWatchPayloadError,
  type PreparedWatchLinkPayload,
  type WatchLinkPayload,
  type WatchLinkSubscription,
} from '../companion/watch-link';
import { defaultDiveLogRepository } from '../repositories/default-dive-log-repository';
import { defaultDivePlanRepository } from '../repositories/default-dive-plan-repository';
import type { DiveLogRepository } from '../repositories/dive-log-repository';
import type { DivePlanRepository } from '../repositories/dive-plan-repository';
import {
  defaultWatchRejectedPayloadStore,
  type WatchPayloadRejectionReason,
  type WatchRejectedPayloadStore,
} from '../storage/watch-rejected-payload-store';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DivePlan } from '../types/dive-plan';
import type { WatchSyncMessage } from '../types/dive-session';
import type {WatchArtifactIdentity} from '../claim/watch-artifact-history';
import { enrichWatchLogWithSourcePlan, getWatchSessionSourcePlanLocalId } from '../utils/enrich-watch-log-with-plan';
import { parseWatchSyncMessageJson } from '../utils/watch-sync-message-validation';
import { diveLogbookQueryKeys } from './use-dive-logbook-queries';
import { divePlanQueryKeys } from './use-dive-plan-queries';
import {
  defaultWatchImportCoordinator,
  isStaleWatchImportError,
  type WatchImportGuard,
  type WatchImportCoordinator,
  type WatchImportScope,
} from './watch-import-coordinator';
import { useOptionalAccountData } from './account-data';

type WatchSyncProviderProps = {
  children?: React.ReactNode;
  repository?: DiveLogRepository;
  planRepository?: DivePlanRepository;
  queryScope?: string;
  drainPendingPayloads?: () => Promise<WatchLinkPayload[]>;
  preparePendingPayload?: (
    payload: WatchLinkPayload,
  ) => Promise<PreparedWatchLinkPayload>;
  acknowledgePayloads?: (payloadIds: readonly string[]) => Promise<void>;
  acknowledgeImportedPayloads?: (payloadIds: readonly string[]) => Promise<void>;
  notifyImportedEntry?: (entry: DiveLogEntry) => Promise<void>;
  onImportedEntry?: (entry: DiveLogEntry) => void;
  subscribeToPayloads?: (handler: (payload: WatchLinkPayload) => void) => WatchLinkSubscription;
  coordinator?: WatchImportCoordinator;
  preferencesHydrated?: boolean;
  principalSettled?: boolean;
  rejectedPayloadStore?: WatchRejectedPayloadStore;
  onLocalWritesCommitted?: () => Promise<unknown>;
  isHistoricalWatchArtifact?: (
    identity: WatchArtifactIdentity,
  ) => Promise<boolean>;
  isWatchSessionDeleted?: (localSessionId: string) => Promise<boolean>;
  reconcileDeletedWatchSession?: (localSessionId: string) => Promise<void>;
  scheduleAfterInteractions?: (
    task: () => void | Promise<void>,
  ) => {cancel(): void};
  yieldToRuntime?: () => Promise<void>;
};

type WatchImportOptions = {
  repository: DiveLogRepository;
  planRepository?: DivePlanRepository;
  queryClient: QueryClient;
  queryScope?: string;
  drainPendingPayloads?: () => Promise<WatchLinkPayload[]>;
  preparePendingPayload?: (
    payload: WatchLinkPayload,
  ) => Promise<PreparedWatchLinkPayload>;
  acknowledgePayloads?: (payloadIds: readonly string[]) => Promise<void>;
  acknowledgeImportedPayloads?: (payloadIds: readonly string[]) => Promise<void>;
  notifyImportedEntry?: (entry: DiveLogEntry) => Promise<void>;
  coordinator?: WatchImportCoordinator;
  onLocalWritesCommitted?: () => Promise<unknown>;
  isHistoricalWatchArtifact?: (
    identity: WatchArtifactIdentity,
  ) => Promise<boolean>;
  isWatchSessionDeleted?: (localSessionId: string) => Promise<boolean>;
  reconcileDeletedWatchSession?: (localSessionId: string) => Promise<void>;
  yieldToRuntime?: () => Promise<void>;
  rejectedPayloadStore?: WatchRejectedPayloadStore;
};

export type WatchImportSummary = {
  receivedCount: number;
  importedCount: number;
  failedCount: number;
};

type WatchLinkAcknowledgement = (payloadIds: readonly string[]) => Promise<void>;
type ScheduledAfterInteractions = {cancel(): void};

type DeferredAccountQueueRepository<T> = {
  saveLocalOnly?(value: T): Promise<T>;
  enqueueSaved?(value: T): Promise<void>;
};

type WatchPayloadImportOptions = {
  payload: WatchLinkPayload;
  preparePendingPayload?: (
    payload: WatchLinkPayload,
  ) => Promise<PreparedWatchLinkPayload>;
  repository: DiveLogRepository;
  planRepository: DivePlanRepository;
  queryClient: QueryClient;
  queryScope?: string;
  acknowledgePayloads: WatchLinkAcknowledgement;
  acknowledgeImportedPayloads: WatchLinkAcknowledgement;
  notifyImportedEntry?: (entry: DiveLogEntry) => Promise<void>;
  coordinator: WatchImportCoordinator;
  scope: WatchImportScope;
  onLocalWritesCommitted?: () => Promise<unknown>;
  isHistoricalWatchArtifact?: (
    identity: WatchArtifactIdentity,
  ) => Promise<boolean>;
  isWatchSessionDeleted?: (localSessionId: string) => Promise<boolean>;
  reconcileDeletedWatchSession?: (localSessionId: string) => Promise<void>;
  rejectedPayloadStore?: WatchRejectedPayloadStore;
};

type WatchPayloadImportOnceOptions = Omit<
  WatchPayloadImportOptions,
  'coordinator' | 'scope' | 'preparePendingPayload'
> & {
  payload: PreparedWatchLinkPayload;
  guard: WatchImportGuard;
};

const defaultScheduleAfterInteractions = (
  task: () => void | Promise<void>,
): ScheduledAfterInteractions => {
  const handle = InteractionManager.runAfterInteractions(task);
  return {cancel: () => handle.cancel()};
};

const defaultYieldToRuntime = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  });

async function measureSlowStage<T>(
  label: 'watch-import',
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    const durationMs = performance.now() - startedAt;
    if (__DEV__ && durationMs >= 100) {
      console.warn(`[performance] ${label} ${Math.round(durationMs)}ms`);
    }
  }
}

export function WatchSyncProvider(
  props: WatchSyncProviderProps,
): React.JSX.Element {
  const accountData = useOptionalAccountData();
  const children = props.children;
  const repository = props.repository ?? accountData?.logbookRepository ?? defaultDiveLogRepository;
  const planRepository = props.planRepository ?? accountData?.planRepository ?? defaultDivePlanRepository;
  const queryScope = props.queryScope ?? (props.repository ? undefined : accountData?.queryScope);
  const drainPendingPayloads = props.drainPendingPayloads ?? defaultWatchLink.drainPendingPayloads;
  const preparePendingPayload =
    props.preparePendingPayload ?? defaultWatchLink.preparePendingPayload;
  const acknowledgePayloads = props.acknowledgePayloads ?? defaultWatchLink.discardPayloads;
  const acknowledgeImportedPayloads = props.acknowledgeImportedPayloads ?? defaultWatchLink.acknowledgeImportedPayloads;
  const notifyImportedEntry = props.notifyImportedEntry;
  const onImportedEntry = props.onImportedEntry;
  const subscribeToPayloads = props.subscribeToPayloads ?? defaultWatchLink.subscribeToPayloads;
  const coordinator = props.coordinator ?? defaultWatchImportCoordinator;
  const preferencesHydrated = props.preferencesHydrated ?? true;
  const principalSettled = props.principalSettled ?? accountData?.isPrincipalSettled ?? true;
  const rejectedPayloadStore = props.rejectedPayloadStore ?? defaultWatchRejectedPayloadStore;
  const onLocalWritesCommitted = props.onLocalWritesCommitted
    ?? (props.repository ? undefined : accountData?.requestSync);
  const isHistoricalWatchArtifact = props.isHistoricalWatchArtifact
    ?? (props.repository
      ? undefined
      : accountData?.isHistoricalWatchArtifact);
  const isWatchSessionDeleted =
    props.isWatchSessionDeleted ??
    (props.repository ? undefined : accountData?.isWatchSessionDeleted);
  const reconcileDeletedWatchSession =
    props.reconcileDeletedWatchSession ??
    (props.repository
      ? undefined
      : accountData?.reconcileDeletedWatchSession);
  const scheduleAfterInteractions =
    props.scheduleAfterInteractions ?? defaultScheduleAfterInteractions;
  const yieldToRuntime = props.yieldToRuntime ?? defaultYieldToRuntime;
  const queryClient = useQueryClient();

  React.useEffect(() => {
    // The watch keeps unacknowledged sessions, so waiting for auth only delays import.
    if (!preferencesHydrated || !principalSettled) {
      return;
    }
    const scope = coordinator.activateScope(queryScope);
    let isMounted = true;
    const scheduledDrains = new Set<ScheduledAfterInteractions>();
    const importPayload = async (payload: WatchLinkPayload) => {
      const importedEntry = await measureSlowStage('watch-import', () =>
        importWatchLinkPayload({
          payload,
          preparePendingPayload,
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
          isHistoricalWatchArtifact,
          isWatchSessionDeleted,
          reconcileDeletedWatchSession,
          rejectedPayloadStore,
        }),
      );

      if (importedEntry) {
        onImportedEntry?.(importedEntry);
      }
    };
    const importPayloadSafely = (payload: WatchLinkPayload) => {
      void importPayload(payload).catch(error => {
        if (!isStaleWatchImportError(error)) {
          console.warn('Failed to import watch sync payload', error);
        }
      });
    };
    const subscription = subscribeToPayloads(payload => {
      importPayloadSafely(payload);
    });

    const drain = async () => {
      const seenPayloadIds = new Set<string>();
      let importedPreviousPayload = false;
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
            if (importedPreviousPayload) {
              await yieldToRuntime();
            }
            if (payload.payloadId) {
              seenPayloadIds.add(payload.payloadId);
            }
            try {
              await importPayload(payload);
              await clearPayloadImportFailures(rejectedPayloadStore, payload);
              importedPreviousPayload = true;
            } catch (error) {
              if (isStaleWatchImportError(error)) {
                return;
              }
              console.warn('Failed to import watch sync payload', error);
              await setAsideRepeatedlyFailingPayload(rejectedPayloadStore, payload, acknowledgePayloads);
              importedPreviousPayload = true;
            }
          }
        }
      } catch (error) {
        console.warn('Failed to drain pending watch sync payloads', error);
      }
    };
    const scheduleDrain = () => {
      let handle: ScheduledAfterInteractions | undefined;
      let startedSynchronously = false;
      const run = async () => {
        startedSynchronously = true;
        if (handle) {
          scheduledDrains.delete(handle);
        }
        if (isMounted) {
          await drain();
        }
      };
      handle = scheduleAfterInteractions(run);
      if (!startedSynchronously) {
        scheduledDrains.add(handle);
      }
    };
    scheduleDrain();
    const appStateSubscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        scheduleDrain();
      }
    });

    return () => {
      isMounted = false;
      for (const handle of scheduledDrains) {
        handle.cancel();
      }
      scheduledDrains.clear();
      coordinator.invalidateScope(scope);
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [
    acknowledgeImportedPayloads,
    acknowledgePayloads,
    coordinator,
    drainPendingPayloads,
    isHistoricalWatchArtifact,
    isWatchSessionDeleted,
    notifyImportedEntry,
    onImportedEntry,
    onLocalWritesCommitted,
    planRepository,
    preparePendingPayload,
    preferencesHydrated,
    principalSettled,
    queryClient,
    queryScope,
    rejectedPayloadStore,
    repository,
    reconcileDeletedWatchSession,
    scheduleAfterInteractions,
    subscribeToPayloads,
    yieldToRuntime,
  ]);

  return <>{children}</>;
}

export async function importPendingWatchPayloads({
  repository,
  planRepository = defaultDivePlanRepository,
  queryClient,
  queryScope,
  drainPendingPayloads = defaultWatchLink.drainPendingPayloads,
  preparePendingPayload = defaultWatchLink.preparePendingPayload,
  acknowledgePayloads = defaultWatchLink.discardPayloads,
  acknowledgeImportedPayloads = defaultWatchLink.acknowledgeImportedPayloads,
  notifyImportedEntry,
  coordinator = defaultWatchImportCoordinator,
  onLocalWritesCommitted,
  isHistoricalWatchArtifact,
  isWatchSessionDeleted,
  reconcileDeletedWatchSession,
  yieldToRuntime = defaultYieldToRuntime,
  rejectedPayloadStore = defaultWatchRejectedPayloadStore,
}: WatchImportOptions): Promise<WatchImportSummary> {
  let importedCount = 0;
  let receivedCount = 0;
  let failedCount = 0;
  const seenPayloadIds = new Set<string>();
  const scope = coordinator.activateScope(queryScope);
  let importedPreviousPayload = false;

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
      if (importedPreviousPayload) {
        await yieldToRuntime();
      }
      if (payload.payloadId) {
        seenPayloadIds.add(payload.payloadId);
      }
      try {
        const importedEntry = await measureSlowStage('watch-import', () =>
          importWatchLinkPayload({
            payload,
            preparePendingPayload,
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
            isHistoricalWatchArtifact,
            isWatchSessionDeleted,
            reconcileDeletedWatchSession,
            rejectedPayloadStore,
          }),
        );
        if (importedEntry) {
          importedCount += 1;
        }
        await clearPayloadImportFailures(rejectedPayloadStore, payload);
      } catch (error) {
        if (isStaleWatchImportError(error)) {
          throw error;
        }
        failedCount += 1;
        console.warn('Failed to import watch sync payload', error);
        await setAsideRepeatedlyFailingPayload(rejectedPayloadStore, payload, acknowledgePayloads);
      }
      importedPreviousPayload = true;
    }
  }

  return {
    receivedCount,
    importedCount,
    failedCount,
  };
}

async function importWatchLinkPayload({
  payload,
  preparePendingPayload,
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
  isHistoricalWatchArtifact,
  isWatchSessionDeleted,
  reconcileDeletedWatchSession,
  rejectedPayloadStore,
}: WatchPayloadImportOptions): Promise<DiveLogEntry | undefined> {
  return coordinator.run(scope, payload, async guard => {
    try {
      if (
        payload.localSessionId !== undefined &&
        (await isWatchSessionDeleted?.(payload.localSessionId)) === true
      ) {
        await consumeDeletedWatchPayload({
          payload,
          localSessionId: payload.localSessionId,
          acknowledgeImportedPayloads,
          reconcileDeletedWatchSession,
          guard,
        });
        return undefined;
      }
      const preparedPayload = await preparePayloadForImport(
        payload,
        preparePendingPayload,
      );
      guard.assertActive();
      return await importWatchLinkPayloadOnce({
        payload: preparedPayload,
        repository,
        planRepository,
        queryClient,
        queryScope,
        acknowledgePayloads,
        acknowledgeImportedPayloads,
        notifyImportedEntry,
        guard,
        onLocalWritesCommitted,
        isHistoricalWatchArtifact,
        isWatchSessionDeleted,
        reconcileDeletedWatchSession,
        rejectedPayloadStore,
      });
    } catch (error) {
      if (
        typeof isInvalidPreparedWatchPayloadError === 'function' &&
        isInvalidPreparedWatchPayloadError(error)
      ) {
        guard.assertActive();
        await recordWatchPayloadRejection(rejectedPayloadStore, payload, 'invalidPreparedPayload');
        await acknowledgePayload(payload, acknowledgePayloads);
        return undefined;
      }
      throw error;
    }
  });
}

const MAX_CONSECUTIVE_IMPORT_FAILURES = 3;

async function recordWatchPayloadRejection(
  store: WatchRejectedPayloadStore | undefined,
  payload: WatchLinkPayload,
  reason: WatchPayloadRejectionReason,
): Promise<void> {
  try {
    await store?.recordRejection({
      payloadId: payload.payloadId,
      localSessionId: payload.localSessionId,
      reason,
    });
  } catch (error) {
    console.warn('Failed to record a rejected watch payload', error);
  }
}

function importFailureKey(payload: WatchLinkPayload): string | undefined {
  return payload.payloadId ?? payload.localSessionId;
}

async function clearPayloadImportFailures(
  store: WatchRejectedPayloadStore,
  payload: WatchLinkPayload,
): Promise<void> {
  const key = importFailureKey(payload);
  if (key === undefined) {
    return;
  }
  try {
    await store.clearImportFailures(key);
  } catch {
    // Failure counts only decide when to set a payload aside.
  }
}

/**
 * Removes a payload that keeps failing from the phone inbox so the payloads behind it can import.
 * The watch keeps the unacknowledged original and sends it again later.
 */
async function setAsideRepeatedlyFailingPayload(
  store: WatchRejectedPayloadStore,
  payload: WatchLinkPayload,
  acknowledgePayloads: WatchLinkAcknowledgement,
): Promise<void> {
  const key = importFailureKey(payload);
  if (key === undefined) {
    return;
  }
  try {
    const failures = await store.recordImportFailure(key);
    if (failures < MAX_CONSECUTIVE_IMPORT_FAILURES) {
      return;
    }
    await recordWatchPayloadRejection(store, payload, 'repeatedImportFailure');
    await acknowledgePayload(payload, acknowledgePayloads);
    await store.clearImportFailures(key);
  } catch (error) {
    console.warn('Failed to set aside a failing watch payload', error);
  }
}

async function importWatchLinkPayloadOnce({
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
  isHistoricalWatchArtifact,
  isWatchSessionDeleted,
  reconcileDeletedWatchSession,
  rejectedPayloadStore,
}: WatchPayloadImportOnceOptions): Promise<DiveLogEntry | undefined> {
  const result = parseWatchSyncMessageJson(payload.payloadJson);

  if (!result.ok) {
    console.warn('Dropped invalid watch sync payload', result.error);
    await recordWatchPayloadRejection(rejectedPayloadStore, payload, 'invalidMessage');
    await acknowledgePayload(payload, acknowledgePayloads);
    return undefined;
  }
  if (
    (await isWatchSessionDeleted?.(result.message.session.localSessionId)) ===
    true
  ) {
    await consumeDeletedWatchPayload({
      payload,
      localSessionId: result.message.session.localSessionId,
      acknowledgeImportedPayloads,
      reconcileDeletedWatchSession,
      guard,
    });
    return undefined;
  }

  const existingEntries = await repository.list();
  const duplicate = existingEntries.find(entry =>
    entry.watchCapture?.session.localSessionId === result.message.session.localSessionId
      && entry.watchCapture?.profile?.contentRevision === payload.contentRevision
      && Boolean(payload.sha256)
      && storedArtifactDigest(entry) === payload.sha256,
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
  const historicalIdentity = watchArtifactIdentity(result.message, payload);
  if (
    historicalIdentity !== undefined &&
    (await isHistoricalWatchArtifact?.(historicalIdentity)) === true
  ) {
    guard.assertActive();
    await acknowledgePayload(payload, acknowledgeImportedPayloads);
    return undefined;
  }
  guard.assertActive();
  const entries = await repository.importWatchMessages([result.message], {
    artifactDigests: [payload.sha256],
    preparedProfiles: [payload.preparedProfile],
    assertCanCommit: guard.assertActive,
  });
  const { importedEntry, completedPlan, entries: importedEntries } = await markWatchPayloadImported(
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

async function consumeDeletedWatchPayload(options: {
  payload: WatchLinkPayload;
  localSessionId: string;
  acknowledgeImportedPayloads: WatchLinkAcknowledgement;
  reconcileDeletedWatchSession?: (localSessionId: string) => Promise<void>;
  guard: WatchImportGuard;
}): Promise<void> {
  options.guard.assertActive();
  await options.reconcileDeletedWatchSession?.(options.localSessionId);
  options.guard.assertActive();
  await acknowledgePayload(
    options.payload,
    options.acknowledgeImportedPayloads,
  );
}

async function preparePayloadForImport(
  payload: WatchLinkPayload,
  preparePendingPayload:
    | ((
        payload: WatchLinkPayload,
      ) => Promise<PreparedWatchLinkPayload>)
    | undefined,
): Promise<PreparedWatchLinkPayload> {
  if (payload.payloadJson !== undefined) {
    return {...payload, payloadJson: payload.payloadJson};
  }
  if (preparePendingPayload === undefined) {
    throw new Error('Watch payload preparation is unavailable');
  }
  return preparePendingPayload(payload);
}

function watchArtifactIdentity(
  message: WatchSyncMessage,
  payload: WatchLinkPayload,
): WatchArtifactIdentity | undefined {
  if (!payload.contentRevision || !payload.sha256) {
    return undefined;
  }
  return {
    localSessionId: message.session.localSessionId,
    contentRevision: payload.contentRevision,
    artifactSha256: payload.sha256,
  };
}

function storedArtifactDigest(entry: DiveLogEntry): string | undefined {
  const profile = entry.watchCapture?.profile;
  return profile?.artifactSha256 ?? profile?.sha256;
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
  payload: WatchLinkPayload,
  acknowledgePayloads: WatchLinkAcknowledgement,
): Promise<void> {
  if (!payload.payloadId) {
    return;
  }

  await acknowledgePayloads([payload.payloadId]);
}

async function markWatchPayloadImported(
  repository: DiveLogRepository,
  planRepository: DivePlanRepository,
  queryClient: QueryClient,
  entries: DiveLogEntry[],
  message: WatchSyncMessage,
  payload: WatchLinkPayload,
  queryScope?: string,
  guard?: WatchImportGuard,
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
  payload: WatchLinkPayload,
  queryScope?: string,
  guard?: WatchImportGuard,
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
    if (isStaleWatchImportError(error)) {
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
  payload: WatchLinkPayload,
  queryScope?: string,
  guard?: WatchImportGuard,
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
  guard: WatchImportGuard,
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
