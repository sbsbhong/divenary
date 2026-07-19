import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils';
import {sha256} from '@noble/hashes/sha256';
import type {
  AccountDataRepository,
  GuestClaimRemoteRepository,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';
import type {QueryClient} from '@tanstack/react-query';
import React from 'react';
import {AppState, type AppStateStatus} from 'react-native';

import type {DiveLogRepository} from '../repositories/dive-log-repository';
import type {DivePlanRepository} from '../repositories/dive-plan-repository';
import {
  createPrincipalRepositories,
  type PrincipalRepositories,
  type PrincipalRepositoryDependencies,
} from '../repositories/principal-repositories';
import {
  dataStorageKeys,
  principalScope,
  type DataPrincipal,
} from '../storage/data-principal';
import {migrateLegacyGuestData} from '../storage/migrate-legacy-guest-data';
import {createAsyncStorageKeyValueStore} from '../storage/persistent-key-value-store';
import {createWatchProfileStorage} from '../storage/watch-profile-storage';
import {
  AccountOutbox,
  type AccountOutboxItem,
} from '../sync/account-outbox';
import {
  AccountSyncCoordinator,
  type AccountSyncDrainResult,
} from '../sync/account-sync-coordinator';
import type {DiveLogEntry} from '../types/dive-log-entry';
import type {DivePlan} from '../types/dive-plan';
import {useAuth, type AuthContextValue, type AuthState} from './auth';

export type AccountDataContextValue = {
  principal: DataPrincipal;
  queryScope: string;
  logbookRepository: DiveLogRepository;
  planRepository: DivePlanRepository;
  isHydrated: boolean;
  isOnline: boolean;
  outbox?: AccountOutbox;
  accountRepository?: AccountDataRepository;
  guestClaimRemoteRepository?: GuestClaimRemoteRepository;
  requestSync(): Promise<AccountSyncDrainResult>;
};

type AccountDataProviderProps = {
  children?: React.ReactNode;
  queryClient: QueryClient;
  dependencies?: Partial<AccountDataDependencies>;
};

type AccountDataProviderCoreProps = AccountDataProviderProps & {
  auth: Pick<
    AuthContextValue,
    'state' | 'accountDataRepository' | 'guestClaimRemoteRepository'
  >;
};

export type AccountDataDependencies = PrincipalRepositoryDependencies & {
  createRepositories: typeof createPrincipalRepositories;
  migrateLegacyData: typeof migrateLegacyGuestData;
  createId: () => string;
  now: () => number;
  jitter: () => number;
};

type AccountLocalFirstRepositoryOptions = {
  userId: string;
  repositories: PrincipalRepositories;
  outbox: AccountOutbox;
  createId?: () => string;
  now?: () => number;
};

type PublishedAccountData = PrincipalRepositories & {
  outbox?: AccountOutbox;
  coordinator?: AccountSyncCoordinator;
};

const AccountDataContext = React.createContext<AccountDataContextValue | undefined>(
  undefined,
);

let defaultDependencies: AccountDataDependencies | undefined;

export function AccountDataProvider(
  props: AccountDataProviderProps,
): React.JSX.Element {
  const auth = useAuth();
  return <AccountDataProviderCore {...props} auth={auth} />;
}

export function AccountDataProviderCore({
  auth,
  children,
  queryClient,
  dependencies: dependencyOverrides,
}: AccountDataProviderCoreProps): React.JSX.Element {
  const [dependencies] = React.useState<AccountDataDependencies>(() => ({
    ...getDefaultDependencies(),
    ...dependencyOverrides,
  }));
  const desiredPrincipal = React.useMemo(
    () => principalForAuthState(auth.state),
    [auth.state],
  );
  const desiredScope = principalScope(desiredPrincipal);
  const isOnline = auth.state.status === 'authenticated';
  const [published, setPublished] = React.useState<PublishedAccountData>();
  const publishedRef = React.useRef<PublishedAccountData | undefined>(undefined);
  const generationRef = React.useRef(0);
  const migrationPromiseRef = React.useRef<Promise<void> | undefined>(undefined);

  React.useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    const publish = async () => {
      migrationPromiseRef.current ??= dependencies.migrateLegacyData({
        metadataStorage: dependencies.metadataStorage,
        profileStorage: dependencies.profileStorage,
        now: dependencies.now,
      });
      await migrationPromiseRef.current;

      const currentPublication = publishedRef.current;
      if (
        currentPublication?.queryScope !== undefined &&
        currentPublication.queryScope !== desiredScope
      ) {
        await clearPrincipalQueries(queryClient, currentPublication.queryScope);
      }
      if (generationRef.current !== generation) {
        return;
      }

      const base = dependencies.createRepositories(desiredPrincipal, dependencies);
      if (desiredPrincipal.kind === 'guest') {
        publishedRef.current = base;
        setPublished(base);
        return;
      }

      const outbox = new AccountOutbox({
        storage: dependencies.metadataStorage,
        storageKey: dataStorageKeys(desiredPrincipal).outbox,
        now: dependencies.now,
        jitter: dependencies.jitter,
      });
      const localFirst = createAccountLocalFirstRepositories({
        userId: desiredPrincipal.userId,
        repositories: base,
        outbox,
        createId: dependencies.createId,
        now: dependencies.now,
      });
      const coordinator = auth.accountDataRepository
        ? new AccountSyncCoordinator({
            userId: desiredPrincipal.userId,
            outbox,
            accountRepository: auth.accountDataRepository,
            profileUploader: auth.guestClaimRemoteRepository,
            logbookRepository: base.logbook,
            planRepository: base.planbook,
            now: dependencies.now,
          })
        : undefined;
      const nextPublication = {...localFirst, outbox, coordinator};
      publishedRef.current = nextPublication;
      setPublished(nextPublication);
    };

    void publish().catch(error => {
      console.warn('Failed to prepare principal data repositories', error);
    });

    return () => {
      if (generationRef.current === generation) {
        generationRef.current += 1;
      }
    };
  }, [
    auth.accountDataRepository,
    auth.guestClaimRemoteRepository,
    dependencies,
    desiredPrincipal,
    desiredScope,
    queryClient,
  ]);

  const requestSync = React.useCallback(async () => {
    if (!published?.coordinator) {
      return {
        processed: 0,
        remaining: published?.outbox
          ? (await published.outbox.list(
              published.principal.kind === 'user'
                ? published.principal.userId
                : undefined,
            )).length
          : 0,
      };
    }
    return published.coordinator.drain({online: isOnline});
  }, [isOnline, published]);

  React.useEffect(() => {
    let previousState = AppState.currentState as AppStateStatus;
    const subscription = AppState.addEventListener('change', nextState => {
      const becameActive = previousState !== 'active' && nextState === 'active';
      previousState = nextState;
      if (becameActive && isOnline) {
        void requestSync();
      }
    });
    return () => subscription.remove();
  }, [isOnline, requestSync]);

  React.useEffect(() => {
    const coordinator = published?.coordinator;
    if (!isOnline || published?.queryScope !== desiredScope || !coordinator) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await coordinator.hydrate({online: true});
      } catch (error) {
        console.warn('Failed to hydrate account data', error);
      }
      if (!cancelled) {
        await requestSync();
      }
    })().catch(error => {
      console.warn('Failed to sync account data', error);
    });

    return () => {
      cancelled = true;
    };
  }, [desiredScope, isOnline, published, requestSync]);

  if (!published || published.queryScope !== desiredScope) {
    return <></>;
  }

  const contextValue: AccountDataContextValue = {
    principal: published.principal,
    queryScope: published.queryScope,
    logbookRepository: published.logbook,
    planRepository: published.planbook,
    isHydrated: true,
    isOnline,
    outbox: published.outbox,
    accountRepository: auth.accountDataRepository,
    guestClaimRemoteRepository: auth.guestClaimRemoteRepository,
    requestSync,
  };

  return (
    <AccountDataContext.Provider value={contextValue}>
      {children}
    </AccountDataContext.Provider>
  );
}

export function useAccountData(): AccountDataContextValue {
  const value = useOptionalAccountData();
  if (!value) {
    throw new Error('useAccountData must be used within AccountDataProvider');
  }
  return value;
}

export function useOptionalAccountData(): AccountDataContextValue | undefined {
  return React.useContext(AccountDataContext);
}

export async function clearPrincipalQueries(
  queryClient: QueryClient,
  queryScope: string,
): Promise<void> {
  const predicate = (query: {queryKey: readonly unknown[]}) =>
    query.queryKey.some(segment => segment === queryScope);
  await queryClient.cancelQueries({predicate});
  queryClient.removeQueries({predicate});
}

export function createAccountLocalFirstRepositories({
  userId,
  repositories,
  outbox,
  createId = createUuid,
  now = () => Date.now() / 1_000,
}: AccountLocalFirstRepositoryOptions): PrincipalRepositories {
  const logbook = createAccountLogbookRepository({
    userId,
    local: repositories.logbook,
    outbox,
    createId,
    now,
  });
  const planbook = createAccountPlanRepository({
    userId,
    local: repositories.planbook,
    logbook,
    outbox,
    createId,
    now,
  });

  return {
    principal: {kind: 'user', userId},
    queryScope: principalScope({kind: 'user', userId}),
    logbook,
    planbook,
  };
}

function createAccountLogbookRepository(options: {
  userId: string;
  local: DiveLogRepository;
  outbox: AccountOutbox;
  createId: () => string;
  now: () => number;
}): DiveLogRepository {
  const saveLocalOnly = async (entry: DiveLogEntry): Promise<DiveLogEntry> => {
    const current = await options.local.get(entry.localId);
    const remoteId = entry.remoteId ?? current?.remoteId ?? options.createId();
    const pending: DiveLogEntry = {
      ...entry,
      remoteId,
      remoteRevision: entry.remoteRevision ?? current?.remoteRevision,
      ownerUserId: options.userId,
      cloudSyncStatus: 'pending',
    };
    return options.local.save(pending);
  };
  const enqueueSaved = async (saved: DiveLogEntry): Promise<void> => {
    const remote = toRemoteLog(saved, options.userId);
    await options.outbox.enqueue({
      operationId: options.createId(),
      userId: options.userId,
      entityKind: 'log',
      entityLocalId: saved.localId,
      mutation: 'upsert',
      payload: {local: saved, remote},
      expectedRevision: saved.remoteRevision,
      ...(saved.watchCapture?.profile?.storageKey
        ? {profileStorageKey: saved.watchCapture.profile.storageKey}
        : {}),
      attemptCount: 0,
      nextAttemptAt: options.now(),
      createdAt: options.now(),
    });
  };
  return {
    list: () => options.local.list(),
    get: (localId: string) => options.local.get(localId),
    getWatchProfile: (localId: string) => options.local.getWatchProfile(localId),
    importWatchMessages: (
      messages: Parameters<DiveLogRepository['importWatchMessages']>[0],
      importOptions?: Parameters<DiveLogRepository['importWatchMessages']>[1],
    ) =>
      options.local.importWatchMessages(messages, importOptions),
    async save(entry: DiveLogEntry) {
      const saved = await saveLocalOnly(entry);
      await enqueueSaved(saved);
      return saved;
    },
    async delete(localId: string) {
      const current = await options.local.get(localId);
      await options.local.delete(localId);
      if (!current?.remoteId || !current.remoteRevision) {
        await options.outbox.removePendingEntity(options.userId, 'log', localId);
        return;
      }
      await options.outbox.removePendingEntity(options.userId, 'log', localId);
      await options.outbox.enqueue(deleteOperation(
        options.userId,
        'log',
        current,
        toRemoteLog(current, options.userId),
        current.remoteRevision,
        options.createId,
        options.now,
      ));
    },
    saveLocalOnly,
    enqueueSaved,
  } as unknown as DiveLogRepository;
}

function createAccountPlanRepository(options: {
  userId: string;
  local: DivePlanRepository;
  logbook: DiveLogRepository;
  outbox: AccountOutbox;
  createId: () => string;
  now: () => number;
}): DivePlanRepository {
  const saveLocalOnly = async (plan: DivePlan): Promise<DivePlan> => {
    const current = await options.local.get(plan.localId);
    const remoteId = plan.remoteId ?? current?.remoteId ?? options.createId();
    const pending: DivePlan = {
      ...plan,
      remoteId,
      remoteRevision: plan.remoteRevision ?? current?.remoteRevision,
      ownerUserId: options.userId,
      cloudSyncStatus: 'pending',
    };
    return options.local.save(pending);
  };
  const enqueueSaved = async (saved: DivePlan): Promise<void> => {
    const convertedLog = saved.convertedLogLocalId
      ? await options.logbook.get(saved.convertedLogLocalId)
      : undefined;
    const remote = toRemotePlan(saved, convertedLog?.remoteId);
    await options.outbox.enqueue({
      operationId: options.createId(),
      userId: options.userId,
      entityKind: 'plan',
      entityLocalId: saved.localId,
      mutation: 'upsert',
      payload: {local: saved, remote},
      expectedRevision: saved.remoteRevision,
      attemptCount: 0,
      nextAttemptAt: options.now(),
      createdAt: options.now(),
    });
  };
  return {
    list: () => options.local.list(),
    get: (localId: string) => options.local.get(localId),
    async save(plan: DivePlan) {
      const saved = await saveLocalOnly(plan);
      await enqueueSaved(saved);
      return saved;
    },
    async delete(localId: string) {
      const current = await options.local.get(localId);
      await options.local.delete(localId);
      if (!current?.remoteId || !current.remoteRevision) {
        await options.outbox.removePendingEntity(options.userId, 'plan', localId);
        return;
      }
      await options.outbox.removePendingEntity(options.userId, 'plan', localId);
      await options.outbox.enqueue(deleteOperation(
        options.userId,
        'plan',
        current,
        toRemotePlan(current),
        current.remoteRevision,
        options.createId,
        options.now,
      ));
    },
    saveLocalOnly,
    enqueueSaved,
  } as unknown as DivePlanRepository;
}

function deleteOperation(
  userId: string,
  entityKind: AccountOutboxItem['entityKind'],
  local: DiveLogEntry | DivePlan,
  remote: RemoteDiveLog | RemoteDivePlan,
  expectedRevision: number,
  createId: () => string,
  now: () => number,
): AccountOutboxItem {
  const timestamp = now();
  return {
    operationId: createId(),
    userId,
    entityKind,
    entityLocalId: local.localId,
    mutation: 'delete',
    payload: {local, remote},
    expectedRevision,
    attemptCount: 0,
    nextAttemptAt: timestamp,
    createdAt: timestamp,
  };
}

function toRemoteLog(entry: DiveLogEntry, userId: string): RemoteDiveLog {
  if (!entry.remoteId) {
    throw new Error('Account log is missing a remote id');
  }
  const startedAt =
    entry.watchCapture?.measuredValues.startedAt ??
    entry.manual.measuredValues.startedAt ??
    entry.createdAt;
  const endedAt =
    entry.watchCapture?.measuredValues.endedAt ??
    entry.manual.measuredValues.endedAt;
  const durationSeconds =
    entry.watchCapture?.measuredValues.durationSeconds ??
    entry.manual.measuredValues.durationSeconds;
  const maxDepthMeters =
    entry.watchCapture?.measuredValues.maxDepthMeters ??
    entry.manual.measuredValues.maxDepthMeters;
  const contentRevision = entry.watchCapture?.profile?.contentRevision;
  const payload = compactRecord({
    source: entry.source,
    started_at: new Date(startedAt * 1_000).toISOString(),
    ended_at: endedAt === undefined ? undefined : new Date(endedAt * 1_000).toISOString(),
    duration_seconds: durationSeconds,
    max_depth_meters: maxDepthMeters,
    site_name: entry.manual.site.name,
    title: entry.manual.title,
    rating: entry.manual.rating,
    dive_mode:
      entry.manual.measuredValues.diveMode ??
      entry.watchCapture?.session.diveMode,
    manual_data: {
      ...entry.manual,
      _local_record: {
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
    },
    mobile_data: entry.mobile,
    watch_metadata: remoteWatchMetadata(entry.watchCapture),
    provenance: entry.provenance,
    profile_preview: entry.watchCapture?.samples,
    profile_content_revision: contentRevision,
    profile_sha256: entry.watchCapture?.profile?.sha256,
    profile_sample_count: entry.watchCapture?.profile?.sampleCount,
  });
  return {
    id: entry.remoteId,
    localId: entry.localId,
    revision: entry.remoteRevision ?? 1,
    payloadSha256: canonicalSha256(payload),
    payload,
    ...(contentRevision
      ? {
          profilePath: `${userId}/logs/${entry.remoteId}/${encodeURIComponent(
            contentRevision,
          )}.json`,
        }
      : {}),
  };
}

function remoteWatchMetadata(
  watchCapture: DiveLogEntry['watchCapture'],
): Record<string, unknown> | undefined {
  if (!watchCapture) {
    return undefined;
  }
  const {profile, ...metadata} = watchCapture;
  return compactRecord({
    ...metadata,
    ...(profile
      ? {
          profile: compactRecord({
            contentRevision: profile.contentRevision,
            sampleCount: profile.sampleCount,
            sha256: profile.sha256,
          }),
        }
      : {}),
  });
}

function toRemotePlan(plan: DivePlan, convertedLogId?: string): RemoteDivePlan {
  if (!plan.remoteId) {
    throw new Error('Account plan is missing a remote id');
  }
  const planData = compactRecord({...plan});
  const payload = compactRecord({
    status: plan.status,
    planned_at:
      plan.plannedAt === undefined
        ? undefined
        : new Date(plan.plannedAt * 1_000).toISOString(),
    dive_mode: plan.diveMode,
    site_name: plan.site.name,
    plan_data: planData,
    converted_log_id: convertedLogId,
  });
  return {
    id: plan.remoteId,
    localId: plan.localId,
    revision: plan.remoteRevision ?? 1,
    payloadSha256: canonicalSha256(payload),
    payload,
  };
}

function principalForAuthState(state: AuthState): DataPrincipal {
  return state.status === 'authenticated' || state.status === 'authenticatedOffline'
    ? {kind: 'user', userId: state.userId}
    : {kind: 'guest'};
}

function getDefaultDependencies(): AccountDataDependencies {
  if (defaultDependencies) {
    return defaultDependencies;
  }
  const metadataStorage = createAsyncStorageKeyValueStore();
  defaultDependencies = {
    metadataStorage,
    profileStorage: createWatchProfileStorage(metadataStorage),
    createRepositories: createPrincipalRepositories,
    migrateLegacyData: migrateLegacyGuestData,
    createId: createUuid,
    now: () => Date.now() / 1_000,
    jitter: Math.random,
  };
  return defaultDependencies;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== undefined) {
      result[key] = nested;
    }
  }
  return result;
}

function canonicalSha256(value: Record<string, unknown>): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalStringify(value))));
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalStringify(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function createUuid(): string {
  const randomUuid = (
    globalThis as typeof globalThis & {crypto?: {randomUUID?: () => string}}
  ).crypto?.randomUUID;
  if (randomUuid) {
    return randomUuid.call(globalThis.crypto);
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : 8 + (random % 4);
    return value.toString(16);
  });
}
