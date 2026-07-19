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
  withAccountEntityMutationLock,
} from '../sync/account-sync-coordinator';
import type {DiveLogEntry} from '../types/dive-log-entry';
import type {DivePlan} from '../types/dive-plan';
import {parseWatchSyncMessageValue} from '../utils/watch-sync-message-validation';
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
  localRepositories: PrincipalRepositories;
  outbox?: AccountOutbox;
  coordinator?: AccountSyncCoordinator;
  coordinatorAccountRepository?: AccountDataRepository;
  coordinatorProfileRepository?: GuestClaimRemoteRepository;
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
  const publicationsRef = React.useRef(new Map<string, PublishedAccountData>());
  const generationRef = React.useRef(0);
  const migrationPromiseRef = React.useRef<Promise<void> | undefined>(undefined);

  React.useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const publications = publicationsRef.current;

    const isCurrent = () => generationRef.current === generation;
    const publish = async () => {
      migrationPromiseRef.current ??= dependencies.migrateLegacyData({
        metadataStorage: dependencies.metadataStorage,
        profileStorage: dependencies.profileStorage,
        now: dependencies.now,
      });
      await migrationPromiseRef.current;
      if (!isCurrent()) {
        return;
      }

      const currentPublication = publishedRef.current;
      if (
        currentPublication?.queryScope !== undefined &&
        currentPublication.queryScope !== desiredScope
      ) {
        currentPublication.coordinator?.pause();
        await clearPrincipalQueries(queryClient, currentPublication.queryScope);
      }
      if (!isCurrent()) {
        return;
      }

      let nextPublication = publications.get(desiredScope);
      if (!nextPublication) {
        const base = dependencies.createRepositories(desiredPrincipal, dependencies);
        if (desiredPrincipal.kind === 'guest') {
          nextPublication = {...base, localRepositories: base};
        } else {
          const outbox = new AccountOutbox({
            storage: dependencies.metadataStorage,
            storageKey: dataStorageKeys(desiredPrincipal).outbox,
            now: dependencies.now,
            jitter: dependencies.jitter,
          });
          nextPublication = {
            ...createAccountLocalFirstRepositories({
              userId: desiredPrincipal.userId,
              repositories: base,
              outbox,
              createId: dependencies.createId,
              now: dependencies.now,
            }),
            localRepositories: base,
            outbox,
          };
        }
        publications.set(desiredScope, nextPublication);
      }

      if (
        desiredPrincipal.kind === 'user' &&
        nextPublication.outbox
      ) {
        await reconcilePendingAccountOperations({
          userId: desiredPrincipal.userId,
          repositories: nextPublication.localRepositories,
          accountRepositories: nextPublication,
        });
        if (!isCurrent()) {
          return;
        }

        if (
          auth.accountDataRepository &&
          (nextPublication.coordinatorAccountRepository !==
            auth.accountDataRepository ||
            nextPublication.coordinatorProfileRepository !==
              auth.guestClaimRemoteRepository)
        ) {
          nextPublication.coordinator?.pause();
          nextPublication.coordinator = new AccountSyncCoordinator({
            userId: desiredPrincipal.userId,
            outbox: nextPublication.outbox,
            accountRepository: auth.accountDataRepository,
            profileUploader: auth.guestClaimRemoteRepository,
            profileDownloader: auth.guestClaimRemoteRepository,
            profileStorage: dependencies.profileStorage,
            logbookRepository: nextPublication.localRepositories.logbook,
            planRepository: nextPublication.localRepositories.planbook,
            now: dependencies.now,
          });
          nextPublication.coordinatorAccountRepository =
            auth.accountDataRepository;
          nextPublication.coordinatorProfileRepository =
            auth.guestClaimRemoteRepository;
        }
        nextPublication.coordinator?.setOnDidProcess(async () => {
          if (isCurrent()) {
            await invalidatePrincipalQueries(queryClient, desiredScope);
          }
        });

        if (isOnline && nextPublication.coordinator) {
          const hydrated =
            (await nextPublication.coordinator.hydrate({online: true})) ?? 0;
          if (!isCurrent()) {
            return;
          }
          await nextPublication.coordinator.drain({online: true});
          if (!isCurrent()) {
            return;
          }
          if (hydrated > 0) {
            await invalidatePrincipalQueries(queryClient, desiredScope);
          }
        } else {
          nextPublication.coordinator?.pause();
        }
      }
      if (!isCurrent()) {
        return;
      }
      publishedRef.current = nextPublication;
      setPublished(nextPublication);
    };

    void publish().catch(error => {
      console.warn('Failed to prepare principal data repositories', error);
    });

    return () => {
      if (generationRef.current === generation) {
        generationRef.current += 1;
        publications.get(desiredScope)?.coordinator?.pause();
      }
    };
  }, [
    auth.accountDataRepository,
    auth.guestClaimRemoteRepository,
    dependencies,
    desiredPrincipal,
    desiredScope,
    isOnline,
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
    const result = await published.coordinator.drain({online: isOnline});
    return result;
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
  const predicate = principalQueryPredicate(queryScope);
  await queryClient.cancelQueries({predicate});
  queryClient.removeQueries({predicate});
}

export async function invalidatePrincipalQueries(
  queryClient: QueryClient,
  queryScope: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    predicate: principalQueryPredicate(queryScope),
  });
}

function principalQueryPredicate(queryScope: string) {
  return (query: {queryKey: readonly unknown[]}) =>
    (query.queryKey[0] === 'diveLogbook' || query.queryKey[0] === 'divePlans') &&
    query.queryKey[1] === queryScope;
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
  const saveLocalOnlyUnlocked = async (
    entry: DiveLogEntry,
  ): Promise<DiveLogEntry> => {
    const operations = await options.outbox.listEntity(
      options.userId,
      'log',
      entry.localId,
    );
    if (operations.some(operation => operation.mutation === 'delete')) {
      throw new Error('Cannot save an account log pending remote deletion');
    }
    const current = await options.local.get(entry.localId);
    const remoteId = current?.remoteId ?? entry.remoteId ?? options.createId();
    const pending: DiveLogEntry = {
      ...entry,
      remoteId,
      remoteRevision: current?.remoteRevision ?? entry.remoteRevision,
      ownerUserId: options.userId,
      cloudSyncStatus: 'pending',
    };
    return options.local.save(pending);
  };
  const enqueueSavedUnlocked = async (
    saved: DiveLogEntry,
    onlyIfEntityQueueEmpty: boolean,
  ): Promise<void> => {
    const current = await options.local.get(saved.localId);
    if (!current) {
      return;
    }
    assertOwnedByUser(current, options.userId);
    const operations = await options.outbox.listEntity(
      options.userId,
      'log',
      current.localId,
    );
    if (
      operations.some(operation => operation.mutation === 'delete') ||
      (onlyIfEntityQueueEmpty && operations.length > 0)
    ) {
      return;
    }

    const prepared = await prepareLogMutation(current, options);
    const operationIdentity = {
      userId: options.userId,
      entityKind: 'log' as const,
      entityLocalId: prepared.local.localId,
      mutation: 'upsert' as const,
      payload: {local: prepared.local, remote: prepared.remote},
      expectedRevision: prepared.local.remoteRevision,
    };
    const operationId = deterministicOperationId(operationIdentity);
    const profileStorageKey = prepared.serializedProfile
      ? await options.outbox.writeProfileSnapshot(
          options.userId,
          operationId,
          prepared.serializedProfile,
        )
      : undefined;
    await options.outbox.enqueue({
      operationId,
      ...operationIdentity,
      ...(profileStorageKey === undefined ? {} : {profileStorageKey}),
      attemptCount: 0,
      nextAttemptAt: options.now(),
      createdAt: prepared.local.updatedAt,
    });
  };
  const saveLocalOnly = (entry: DiveLogEntry): Promise<DiveLogEntry> =>
    withAccountEntityMutationLock(options.userId, 'log', entry.localId, () =>
      saveLocalOnlyUnlocked(entry),
    );
  const enqueueSaved = (saved: DiveLogEntry): Promise<void> =>
    withAccountEntityMutationLock(options.userId, 'log', saved.localId, () =>
      enqueueSavedUnlocked(saved, false),
    );
  const reconcileSaved = (saved: DiveLogEntry): Promise<void> =>
    withAccountEntityMutationLock(options.userId, 'log', saved.localId, () =>
      enqueueSavedUnlocked(saved, true),
    );

  return {
    async list() {
      const [entries, operations] = await Promise.all([
        options.local.list(),
        options.outbox.list(options.userId),
      ]);
      const tombstonedIds = new Set(
        operations
          .filter(
            operation =>
              operation.entityKind === 'log' &&
              operation.mutation === 'delete',
          )
          .map(operation => operation.entityLocalId),
      );
      return entries.filter(value => !tombstonedIds.has(value.localId));
    },
    async get(localId: string) {
      const [current, operations] = await Promise.all([
        options.local.get(localId),
        options.outbox.listEntity(options.userId, 'log', localId),
      ]);
      return operations.some(operation => operation.mutation === 'delete')
        ? undefined
        : current;
    },
    getWatchProfile: (localId: string) => options.local.getWatchProfile(localId),
    importWatchMessages: (
      messages: Parameters<DiveLogRepository['importWatchMessages']>[0],
      importOptions?: Parameters<DiveLogRepository['importWatchMessages']>[1],
    ) =>
      options.local.importWatchMessages(messages, importOptions),
    async save(entry: DiveLogEntry) {
      return withAccountEntityMutationLock(
        options.userId,
        'log',
        entry.localId,
        async () => {
          const saved = await saveLocalOnlyUnlocked(entry);
          await enqueueSavedUnlocked(saved, false);
          return (await options.local.get(saved.localId)) ?? saved;
        },
      );
    },
    async delete(localId: string) {
      return withAccountEntityMutationLock(
        options.userId,
        'log',
        localId,
        async () => {
          const current = await options.local.get(localId);
          if (!current) {
            return;
          }
          const operations = await options.outbox.listEntity(
            options.userId,
            'log',
            localId,
          );
          if (operations.some(operation => operation.mutation === 'delete')) {
            return;
          }
          const hasPendingUpsert = operations.some(
            operation => operation.mutation === 'upsert',
          );
          if (current.remoteId && (current.remoteRevision || hasPendingUpsert)) {
            assertOwnedByUser(current, options.userId);
            await options.outbox.enqueue(
              deleteOperation(
                options.userId,
                'log',
                current,
                toRemoteLog(current, options.userId),
                current.remoteRevision,
                options.now,
              ),
            );
            return;
          }
          await options.local.delete(localId);
          await options.outbox.removePendingEntity(
            options.userId,
            'log',
            localId,
          );
        },
      );
    },
    saveLocalOnly,
    enqueueSaved,
    reconcileSaved,
  } as DiveLogRepository & AccountQueueRepository<DiveLogEntry>;
}

function createAccountPlanRepository(options: {
  userId: string;
  local: DivePlanRepository;
  logbook: DiveLogRepository;
  outbox: AccountOutbox;
  createId: () => string;
  now: () => number;
}): DivePlanRepository {
  const saveLocalOnlyUnlocked = async (plan: DivePlan): Promise<DivePlan> => {
    const operations = await options.outbox.listEntity(
      options.userId,
      'plan',
      plan.localId,
    );
    if (operations.some(operation => operation.mutation === 'delete')) {
      throw new Error('Cannot save an account plan pending remote deletion');
    }
    const current = await options.local.get(plan.localId);
    const remoteId = current?.remoteId ?? plan.remoteId ?? options.createId();
    const pending: DivePlan = {
      ...plan,
      remoteId,
      remoteRevision: current?.remoteRevision ?? plan.remoteRevision,
      ownerUserId: options.userId,
      cloudSyncStatus: 'pending',
    };
    return options.local.save(pending);
  };
  const enqueueSavedUnlocked = async (
    saved: DivePlan,
    onlyIfEntityQueueEmpty: boolean,
  ): Promise<void> => {
    const current = await options.local.get(saved.localId);
    if (!current) {
      return;
    }
    assertOwnedByUser(current, options.userId);
    const operations = await options.outbox.listEntity(
      options.userId,
      'plan',
      current.localId,
    );
    if (
      operations.some(operation => operation.mutation === 'delete') ||
      (onlyIfEntityQueueEmpty && operations.length > 0)
    ) {
      return;
    }
    const convertedLog = current.convertedLogLocalId
      ? await options.logbook.get(current.convertedLogLocalId)
      : undefined;
    const remote = toRemotePlan(current, convertedLog?.remoteId);
    const operationIdentity = {
      userId: options.userId,
      entityKind: 'plan' as const,
      entityLocalId: current.localId,
      mutation: 'upsert' as const,
      payload: {local: current, remote},
      expectedRevision: current.remoteRevision,
    };
    await options.outbox.enqueue({
      operationId: deterministicOperationId(operationIdentity),
      ...operationIdentity,
      attemptCount: 0,
      nextAttemptAt: options.now(),
      createdAt: current.updatedAt,
    });
  };
  const saveLocalOnly = (plan: DivePlan): Promise<DivePlan> =>
    withAccountEntityMutationLock(options.userId, 'plan', plan.localId, () =>
      saveLocalOnlyUnlocked(plan),
    );
  const enqueueSaved = (saved: DivePlan): Promise<void> =>
    withAccountEntityMutationLock(options.userId, 'plan', saved.localId, () =>
      enqueueSavedUnlocked(saved, false),
    );
  const reconcileSaved = (saved: DivePlan): Promise<void> =>
    withAccountEntityMutationLock(options.userId, 'plan', saved.localId, () =>
      enqueueSavedUnlocked(saved, true),
    );

  return {
    async list() {
      const [plans, operations] = await Promise.all([
        options.local.list(),
        options.outbox.list(options.userId),
      ]);
      const tombstonedIds = new Set(
        operations
          .filter(
            operation =>
              operation.entityKind === 'plan' &&
              operation.mutation === 'delete',
          )
          .map(operation => operation.entityLocalId),
      );
      return plans.filter(value => !tombstonedIds.has(value.localId));
    },
    async get(localId: string) {
      const [current, operations] = await Promise.all([
        options.local.get(localId),
        options.outbox.listEntity(options.userId, 'plan', localId),
      ]);
      return operations.some(operation => operation.mutation === 'delete')
        ? undefined
        : current;
    },
    async save(plan: DivePlan) {
      return withAccountEntityMutationLock(
        options.userId,
        'plan',
        plan.localId,
        async () => {
          const saved = await saveLocalOnlyUnlocked(plan);
          await enqueueSavedUnlocked(saved, false);
          return (await options.local.get(saved.localId)) ?? saved;
        },
      );
    },
    async delete(localId: string) {
      return withAccountEntityMutationLock(
        options.userId,
        'plan',
        localId,
        async () => {
          const current = await options.local.get(localId);
          if (!current) {
            return;
          }
          const operations = await options.outbox.listEntity(
            options.userId,
            'plan',
            localId,
          );
          if (operations.some(operation => operation.mutation === 'delete')) {
            return;
          }
          const hasPendingUpsert = operations.some(
            operation => operation.mutation === 'upsert',
          );
          if (current.remoteId && (current.remoteRevision || hasPendingUpsert)) {
            assertOwnedByUser(current, options.userId);
            await options.outbox.enqueue(
              deleteOperation(
                options.userId,
                'plan',
                current,
                toRemotePlan(current),
                current.remoteRevision,
                options.now,
              ),
            );
            return;
          }
          await options.local.delete(localId);
          await options.outbox.removePendingEntity(
            options.userId,
            'plan',
            localId,
          );
        },
      );
    },
    saveLocalOnly,
    enqueueSaved,
    reconcileSaved,
  } as DivePlanRepository & AccountQueueRepository<DivePlan>;
}

type AccountQueueRepository<T> = {
  saveLocalOnly(value: T): Promise<T>;
  enqueueSaved(value: T): Promise<void>;
  reconcileSaved(value: T): Promise<void>;
};

export async function reconcilePendingAccountOperations(options: {
  userId: string;
  repositories: PrincipalRepositories;
  accountRepositories: PrincipalRepositories;
}): Promise<void> {
  const logbook = options.accountRepositories.logbook as DiveLogRepository &
    Partial<AccountQueueRepository<DiveLogEntry>>;
  const planbook = options.accountRepositories.planbook as DivePlanRepository &
    Partial<AccountQueueRepository<DivePlan>>;
  if (!logbook.reconcileSaved || !planbook.reconcileSaved) {
    throw new Error('Account repositories do not support reconciliation');
  }
  const [logs, plans] = await Promise.all([
    options.repositories.logbook.list(),
    options.repositories.planbook.list(),
  ]);
  for (const value of logs) {
    if (value.cloudSyncStatus === 'pending') {
      assertOwnedByUser(value, options.userId);
      await logbook.reconcileSaved(value);
    }
  }
  for (const value of plans) {
    if (value.cloudSyncStatus === 'pending') {
      assertOwnedByUser(value, options.userId);
      await planbook.reconcileSaved(value);
    }
  }
}

async function prepareLogMutation(
  saved: DiveLogEntry,
  options: {
    userId: string;
    local: DiveLogRepository;
  },
): Promise<{
  local: DiveLogEntry;
  remote: RemoteDiveLog;
  serializedProfile?: string;
}> {
  if (!saved.watchCapture?.profile) {
    return {
      local: saved,
      remote: toRemoteLog(saved, options.userId),
    };
  }

  const samples = await options.local.getWatchProfile(saved.localId);
  const parsed = parseWatchSyncMessageValue({
    type: 'sessionEnded',
    session: {...saved.watchCapture.session, samples},
  });
  if (!parsed.ok) {
    throw new Error(`Malformed local watch profile: ${parsed.error.message}`);
  }
  const fullSamples = parsed.message.session.samples;
  if (
    fullSamples.length !== saved.watchCapture.profile.sampleCount ||
    fullSamples.some(
      sample =>
        sample.localSessionId !==
        saved.watchCapture?.session.localSessionId,
    )
  ) {
    throw new Error('Local watch profile sample count or session is invalid');
  }

  const serializedProfile = JSON.stringify(fullSamples);
  const profileBytes = utf8ToBytes(serializedProfile);
  const digest = bytesToHex(sha256(profileBytes));
  if (
    saved.watchCapture.profile.sha256 !== undefined &&
    saved.watchCapture.profile.sha256 !== digest
  ) {
    throw new Error('Local watch profile digest is invalid');
  }
  const local = saved.watchCapture.profile.sha256
    ? saved
    : {
        ...saved,
        watchCapture: {
          ...saved.watchCapture,
          profile: {...saved.watchCapture.profile, sha256: digest},
        },
      };
  if (local !== saved) {
    await options.local.save(local);
  }
  return {
    local,
    remote: toRemoteLog(local, options.userId, profileBytes.length),
    serializedProfile,
  };
}

function assertOwnedByUser(
  value: DiveLogEntry | DivePlan,
  userId: string,
): void {
  if (value.ownerUserId !== userId) {
    throw new Error('Account local value belongs to another user');
  }
}

function deterministicOperationId(
  operation: Omit<
    AccountOutboxItem,
    | 'operationId'
    | 'profileStorageKey'
    | 'attemptCount'
    | 'nextAttemptAt'
    | 'createdAt'
  >,
): string {
  return `account-operation:${canonicalSha256(operation)}`;
}

function deleteOperation(
  userId: string,
  entityKind: AccountOutboxItem['entityKind'],
  local: DiveLogEntry | DivePlan,
  remote: RemoteDiveLog | RemoteDivePlan,
  expectedRevision: number | undefined,
  now: () => number,
): AccountOutboxItem {
  const operationIdentity = {
    userId,
    entityKind,
    entityLocalId: local.localId,
    mutation: 'delete' as const,
    payload: {local, remote},
    expectedRevision,
  };
  return {
    operationId: deterministicOperationId(operationIdentity),
    ...operationIdentity,
    attemptCount: 0,
    nextAttemptAt: now(),
    createdAt: local.updatedAt,
  };
}

function toRemoteLog(
  entry: DiveLogEntry,
  userId: string,
  profileByteCount?: number,
): RemoteDiveLog {
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
    profile_byte_count: profileByteCount,
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
