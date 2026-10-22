import type {
  AccountDataRepository,
  GuestClaimRemoteRepository,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';
import type { QueryClient } from '@tanstack/react-query';
import React from 'react';
import {
  AppState,
  InteractionManager,
  type AppStateStatus,
} from 'react-native';

import {
  GuestClaimService,
  GuestClaimServiceError,
} from '../claim/guest-claim-service';
import {createStoredProfileBytesSnapshot} from '../claim/profile-bytes';
import {
  guestRecordMatchesClaimSnapshot,
  GuestClaimStore,
  parseSnapshotLocalRecord,
  type GuestClaimSnapshot,
} from '../claim/guest-claim-store';
import {
  claimSnapshotContainsHistoricalArtifact,
  type WatchArtifactIdentity,
} from '../claim/watch-artifact-history';
import {
  createWatchDeletionAwareLogbookRepository,
  createWatchLogDeletionCoordinator,
  type WatchLogDeletionCoordinator,
} from '../deletion/watch-log-deletion-coordinator';
import {
  createWatchLogDeletionStore,
  type WatchLogDeletionStore,
  type WatchLogDeletionTombstone,
} from '../deletion/watch-log-deletion-store';
import { defaultWatchLink } from '../companion/default-watch-link';
import type { WatchLink } from '../companion/watch-link';
import type {
  GuestClaimProgress,
  GuestClaimViewState,
} from '../claim/guest-claim-types';
import type { DiveLogRepository } from '../repositories/dive-log-repository';
import type { DivePlanRepository } from '../repositories/dive-plan-repository';
import {
  composeAccountAndDeferredGuestRows,
  createPrincipalRepositories,
  verifyPrincipalRepositories,
  type PrincipalRepositories,
  type PrincipalRepositoryDependencies,
} from '../repositories/principal-repositories';
import {
  dataStorageKeys,
  principalForScope,
  principalScope,
  type DataPrincipal,
} from '../storage/data-principal';
import { migrateLegacyGuestData } from '../storage/migrate-legacy-guest-data';
import { createAsyncStorageKeyValueStore } from '../storage/persistent-key-value-store';
import { createWatchProfileStorage } from '../storage/watch-profile-storage';
import { AccountOutbox, type AccountOutboxItem } from '../sync/account-outbox';
import {
  canonicalAccountPayloadSha256,
  createAccountRemoteLog,
  createAccountRemotePlan,
} from '../sync/account-payload';
import {
  AccountHydrationError,
  AccountSyncCoordinator,
  StaleAccountSyncCommitError,
  isStaleAccountSyncCommitError,
  type AccountSyncDrainResult,
  withAccountEntityMutationLock,
} from '../sync/account-sync-coordinator';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DivePlan } from '../types/dive-plan';
import { getWatchSessionSourcePlanLocalId } from '../utils/enrich-watch-log-with-plan';
import { useAuth, type AuthContextValue, type AuthState } from './auth';
import RecoveryScreen from '../screens/recovery/screen';

export type AccountDataContextValue = {
  principal: DataPrincipal;
  queryScope: string;
  logbookRepository: DiveLogRepository;
  planRepository: DivePlanRepository;
  isHydrated: boolean;
  isOnline: boolean;
  /** False while Auth is still deciding between guest and account data. */
  isPrincipalSettled?: boolean;
  outbox?: AccountOutbox;
  accountRepository?: AccountDataRepository;
  guestClaimRemoteRepository?: GuestClaimRemoteRepository;
  bootstrap: AccountDataBootstrapState;
  retryBootstrap(): void;
  claim: AccountClaimController;
  isHistoricalWatchArtifact(
    identity: WatchArtifactIdentity,
  ): Promise<boolean>;
  isWatchSessionDeleted(localSessionId: string): Promise<boolean>;
  reconcileDeletedWatchSession(localSessionId: string): Promise<void>;
  requestSync(): Promise<AccountSyncDrainResult>;
  refreshCloudData(): Promise<void>;
  /** True while account rows are being downloaded from the cloud, page by page. */
  isCloudRefreshing?: boolean;
  resolveConflict?(
    kind: 'log' | 'plan',
    localId: string,
    choice: 'keepLocal' | 'useRemote',
  ): Promise<void>;
};

export type AccountClaimController = {
  eligible: { logCount: number; planCount: number };
  state: GuestClaimViewState;
  start(): Promise<void>;
  retry(): Promise<void>;
  recheckRetained(): Promise<void>;
  keepOnDevice(): Promise<void>;
  refresh(): Promise<void>;
};

export type AccountDataBootstrapStage =
  | 'legacyMigration'
  | 'localRepository'
  | 'claimInspection'
  | 'outboxReconciliation'
  | 'remoteHydration';

export type AccountDataBootstrapState =
  | {status: 'loading'}
  | {status: 'ready'}
  | {
      status: 'degraded';
      issue: {
        stage: Exclude<AccountDataBootstrapStage, 'localRepository'>;
        retryable: true;
      };
    }
  | {
      status: 'recoveryRequired';
      issue: {stage: 'localRepository'; retryable: true};
    };

type AccountDataProviderProps = {
  children?: React.ReactNode;
  queryClient: QueryClient;
  dependencies?: Partial<AccountDataDependencies>;
  navigationReady?: boolean;
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
  scheduleAfterInteractions(
    task: () => void | Promise<void>,
  ): {cancel(): void};
  createId: () => string;
  now: () => number;
  jitter: () => number;
  queueWatchSessionDeletion: WatchLink['queueSessionDeletion'];
  listWatchSessionDeletionAcknowledgements: WatchLink['listSessionDeletionAcknowledgements'];
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
  accountRepositories?: PrincipalRepositories;
  guestRepositories?: PrincipalRepositories;
  claimStore?: GuestClaimStore;
  claimService?: GuestClaimService;
  claimGeneration?: number;
  claimInventoryObservationSequence?: number;
  hasLiveGuestInventory?: boolean;
  zeroInventoryAudit?: {
    token: object;
    generation: number;
    cancel(): void;
  };
  zeroInventoryAuditAttempted?: boolean;
  zeroInventoryRecoveryToken?: object;
  hiddenGuestIds?: HiddenGuestIds;
  outbox?: AccountOutbox;
  coordinator?: AccountSyncCoordinator;
  coordinatorAccountRepository?: AccountDataRepository;
  coordinatorProfileRepository?: GuestClaimRemoteRepository;
  cloudRefresh?: {
    generation: number | undefined;
    coordinator: AccountSyncCoordinator;
    promise: Promise<void>;
    start?(): void;
    cancel?(): void;
  };
  historicalArtifactLookup?: {
    generation: number;
    promise: Promise<Set<string>>;
  };
  rawVisibleLogbook?: DiveLogRepository;
  watchDeletionCoordinator?: WatchLogDeletionCoordinator;
  beforeWatchLogDelete?: (
    tombstone: WatchLogDeletionTombstone,
  ) => Promise<void>;
};

type HiddenGuestIds = {
  logIds: Set<string>;
  planIds: Set<string>;
  guestPriorityLogIds: Set<string>;
  guestPriorityPlanIds: Set<string>;
};

type GuestInventory = {
  logs: DiveLogEntry[];
  plans: DivePlan[];
};

type AccountClaimPresentation = {
  queryScope: string;
  eligible: { logCount: number; planCount: number };
  state: GuestClaimViewState;
};

type AccountBootstrapPresentation = {
  queryScope: string;
  state: AccountDataBootstrapState;
};

const AccountDataContext = React.createContext<
  AccountDataContextValue | undefined
>(undefined);

let defaultDependencies: AccountDataDependencies | undefined;
let accountClaimNavigationReady = false;
const accountClaimNavigationListeners = new Set<() => void>();

export function setAccountClaimNavigationReady(ready: boolean): void {
  if (accountClaimNavigationReady === ready) {
    return;
  }
  accountClaimNavigationReady = ready;
  for (const listener of accountClaimNavigationListeners) {
    listener();
  }
}

export function AccountDataProvider(
  props: AccountDataProviderProps,
): React.JSX.Element {
  const auth = useAuth();
  const navigationReady = React.useSyncExternalStore(
    listener => {
      accountClaimNavigationListeners.add(listener);
      return () => accountClaimNavigationListeners.delete(listener);
    },
    () => accountClaimNavigationReady,
    () => false,
  );
  return (
    <AccountDataProviderCore
      {...props}
      auth={auth}
      navigationReady={props.navigationReady ?? navigationReady}
    />
  );
}

export function AccountDataProviderCore({
  auth,
  children,
  queryClient,
  navigationReady = false,
  dependencies: dependencyOverrides,
}: AccountDataProviderCoreProps): React.JSX.Element {
  const [dependencies] = React.useState<AccountDataDependencies>(() => ({
    ...getDefaultDependencies(),
    ...dependencyOverrides,
  }));
  const [watchDeletionStore] = React.useState<WatchLogDeletionStore>(() =>
    createWatchLogDeletionStore({storage: dependencies.metadataStorage}),
  );
  // One principal object per data owner, so auth changes that keep the same owner (signing in
  // and cancelling, onboarding) do not re-run the bootstrap below.
  const desiredScope = principalScope(principalForAuthState(auth.state));
  const desiredPrincipal = React.useMemo(
    () => principalForScope(desiredScope),
    [desiredScope],
  );
  const isOnline = auth.state.status === 'authenticated';
  const [published, setPublished] = React.useState<PublishedAccountData>();
  const [bootstrapAttempt, setBootstrapAttempt] = React.useState(0);
  const [bootstrapPresentation, setBootstrapPresentation] =
    React.useState<AccountBootstrapPresentation>({
      queryScope: desiredScope,
      state: {status: 'loading'},
    });
  // Counts cloud downloads in flight for one data owner; overlapping refreshes share the flag.
  const [cloudRefresh, setCloudRefresh] = React.useState({scope: '', count: 0});
  const beginCloudRefresh = React.useCallback((scope: string) => {
    setCloudRefresh(current => ({
      scope,
      count: current.scope === scope ? current.count + 1 : 1,
    }));
  }, []);
  const endCloudRefresh = React.useCallback((scope: string) => {
    setCloudRefresh(current =>
      current.scope === scope
        ? {scope, count: Math.max(0, current.count - 1)}
        : current,
    );
  }, []);
  const isCloudRefreshing =
    cloudRefresh.scope === desiredScope && cloudRefresh.count > 0;
  const publishedRef = React.useRef<PublishedAccountData | undefined>(
    undefined,
  );
  const publicationsRef = React.useRef(new Map<string, PublishedAccountData>());
  const generationRef = React.useRef(0);
  const claimRefreshSequenceRef = React.useRef(0);
  const migrationPromiseRef = React.useRef<Promise<void> | undefined>(
    undefined,
  );
  const guestRepositoriesRef = React.useRef<PrincipalRepositories | undefined>(
    undefined,
  );
  const [claimPresentation, setClaimPresentation] =
    React.useState<AccountClaimPresentation>(() =>
      hiddenClaimPresentation('guest'),
    );
  const [guestInventoryRevision, setGuestInventoryRevision] =
    React.useState(0);
  const notifyGuestInventoryChanged = React.useCallback(() => {
    for (const publication of publicationsRef.current.values()) {
      publication.historicalArtifactLookup = undefined;
    }
    setGuestInventoryRevision(value => value + 1);
  }, []);

  React.useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const publications = publicationsRef.current;

    const isCurrent = () => generationRef.current === generation;
    let localPublished = false;
    const publish = async () => {
      let migrationDegraded = false;
      migrationPromiseRef.current ??= dependencies.migrateLegacyData({
        metadataStorage: dependencies.metadataStorage,
        profileStorage: dependencies.profileStorage,
        now: dependencies.now,
      });
      try {
        await migrationPromiseRef.current;
      } catch (error) {
        migrationPromiseRef.current = undefined;
        migrationDegraded = true;
        console.warn('Failed to migrate legacy principal data', error);
      }
      if (!isCurrent()) {
        return;
      }

      const currentPublication = publishedRef.current;
      if (
        currentPublication?.queryScope !== undefined &&
        currentPublication.queryScope !== desiredScope
      ) {
        currentPublication.cloudRefresh?.cancel?.();
        currentPublication.coordinator?.pause();
        await clearPrincipalQueries(queryClient, currentPublication.queryScope);
      }
      if (!isCurrent()) {
        return;
      }

      let nextPublication = publications.get(desiredScope);
      if (!nextPublication) {
        const base = dependencies.createRepositories(
          desiredPrincipal,
          dependencies,
        );
        if (desiredPrincipal.kind === 'guest') {
          await verifyPrincipalRepositories(base);
          guestRepositoriesRef.current = base;
          nextPublication = { ...base, localRepositories: base };
        } else {
          const guestRepositories =
            guestRepositoriesRef.current ??
            dependencies.createRepositories(
              { kind: 'guest' },
              dependencies,
            );
          await Promise.all([
            verifyPrincipalRepositories(base),
            verifyPrincipalRepositories(guestRepositories),
          ]);
          guestRepositoriesRef.current = guestRepositories;
          const outbox = new AccountOutbox({
            storage: dependencies.metadataStorage,
            storageKey: dataStorageKeys(desiredPrincipal).outbox,
            now: dependencies.now,
            jitter: dependencies.jitter,
          });
          const accountRepositories = createAccountLocalFirstRepositories({
            userId: desiredPrincipal.userId,
            repositories: base,
            outbox,
            createId: dependencies.createId,
            now: dependencies.now,
          });
          const hiddenGuestIds: HiddenGuestIds = {
            logIds: new Set(),
            planIds: new Set(),
            guestPriorityLogIds: new Set(),
            guestPriorityPlanIds: new Set(),
          };
          nextPublication = {
            ...createComposedAccountRepositories({
              userId: desiredPrincipal.userId,
              accountRepositories,
              guestRepositories,
              hiddenGuestIds,
              onGuestInventoryChanged: notifyGuestInventoryChanged,
            }),
            localRepositories: base,
            accountRepositories,
            guestRepositories,
            claimStore: new GuestClaimStore({
              storage: dependencies.metadataStorage,
              userId: desiredPrincipal.userId,
              now: dependencies.now,
            }),
            hiddenGuestIds,
            outbox,
          };
        }
        publications.set(desiredScope, nextPublication);
      } else {
        nextPublication = {
          ...nextPublication,
          zeroInventoryAudit: undefined,
          zeroInventoryAuditAttempted: undefined,
          zeroInventoryRecoveryToken: undefined,
        };
        publications.set(desiredScope, nextPublication);
      }

      if (
        !nextPublication.watchDeletionCoordinator ||
        !nextPublication.rawVisibleLogbook
      ) {
        const publication = nextPublication;
        const rawVisibleLogbook = publication.logbook;
        const watchDeletionCoordinator = createWatchLogDeletionCoordinator({
          tombstones: watchDeletionStore,
          repository: rawVisibleLogbook,
          queueDeletion: dependencies.queueWatchSessionDeletion,
          listAcknowledgements:
            dependencies.listWatchSessionDeletionAcknowledgements,
          beforeDelete: async tombstone => {
            await publication.beforeWatchLogDelete?.(tombstone);
          },
          requestSync: async () => {
            await publication.coordinator?.drain({online: isOnline});
          },
          now: dependencies.now,
        });
        publication.rawVisibleLogbook = rawVisibleLogbook;
        publication.watchDeletionCoordinator = watchDeletionCoordinator;
        publication.logbook = createWatchDeletionAwareLogbookRepository({
          repository: rawVisibleLogbook,
          tombstones: watchDeletionStore,
          deleteEntry: entry => watchDeletionCoordinator.delete(entry),
        });
      }
      const watchDeletionCoordinator =
        nextPublication.watchDeletionCoordinator;
      if (!watchDeletionCoordinator) {
        throw new Error('Watch deletion coordinator was not initialized.');
      }
      nextPublication.beforeWatchLogDelete = undefined;

      if (
        desiredPrincipal.kind === 'user' &&
        nextPublication.claimStore &&
        nextPublication.guestRepositories &&
        nextPublication.accountRepositories &&
        auth.guestClaimRemoteRepository
      ) {
        const publication = nextPublication;
        publication.claimGeneration = generation;
        const isClaimCurrent = () =>
          isCurrent() && publication.claimGeneration === generation;
        const claimStore = nextPublication.claimStore;
        const guestRepositories = nextPublication.guestRepositories;
        const accountMutationRepositories =
          nextPublication.accountRepositories;
        publication.claimService = new GuestClaimService({
          userId: desiredPrincipal.userId,
          store: claimStore,
          guestRepositories,
          accountRepositories: publication.localRepositories,
          accountMutationRepositories,
          profileStorage: dependencies.profileStorage,
          remoteRepository: auth.guestClaimRemoteRepository,
          isWatchSessionDeleted: async localSessionId =>
            (await watchDeletionStore.get(localSessionId)) !== undefined,
          now: dependencies.now,
          assertCanContinue: () => {
            if (!isCurrent()) {
              throw new GuestClaimServiceError('session_expired');
            }
            if (!isOnline) {
              throw new GuestClaimServiceError('network_unavailable');
            }
          },
          onProgress: progress => {
            if (
              isClaimCurrent() &&
              publication.hasLiveGuestInventory !== false &&
              publication.zeroInventoryRecoveryToken === undefined
            ) {
              setClaimPresentation(
                runningClaimPresentation(desiredScope, progress),
              );
            }
          },
          onSnapshot: async snapshot => {
            if (!isClaimCurrent()) {
              return;
            }
            publication.historicalArtifactLookup = undefined;
            let shouldPublishPresentation =
              publication.hasLiveGuestInventory !== false &&
              publication.zeroInventoryRecoveryToken === undefined;
            if (
              snapshot.manifest.status !== 'running' &&
              snapshot.manifest.status !== 'finalizing'
            ) {
              const observationSequence =
                beginClaimInventoryObservation(publication);
              const inventory = await readGuestInventory(publication);
              if (!isClaimCurrent()) {
                return;
              }
              const observationCommitted =
                commitClaimInventoryObservation(
                  publication,
                  observationSequence,
                  inventory,
                );
              if (!observationCommitted) {
                shouldPublishPresentation = false;
              } else {
                shouldPublishPresentation =
                  publication.hasLiveGuestInventory !== false &&
                  publication.zeroInventoryRecoveryToken === undefined;
                await applyHiddenGuestIds(
                  publication,
                  snapshot,
                  inventory,
                  dependencies.profileStorage,
                  isClaimCurrent,
                );
                if (!isClaimCurrent()) {
                  return;
                }
                if (
                  !shouldPublishPresentation &&
                  publication.zeroInventoryRecoveryToken === undefined
                ) {
                  setClaimPresentation(
                    hiddenClaimPresentation(desiredScope),
                  );
                }
              }
            }
            if (shouldPublishPresentation) {
              setClaimPresentation(
                presentationForSnapshot(desiredScope, snapshot),
              );
            }
            if (
              snapshot.manifest.status === 'committed' ||
              snapshot.manifest.status === 'cleanupPending'
            ) {
              await invalidatePrincipalQueries(queryClient, desiredScope);
            }
          },
        });
        publication.beforeWatchLogDelete = tombstone =>
          publication.claimService!.invalidateDeletedWatchSession(
            tombstone.localSessionId,
          );
      } else if (desiredPrincipal.kind === 'user') {
        nextPublication.claimGeneration = generation;
        nextPublication.claimService = undefined;
        nextPublication.beforeWatchLogDelete = undefined;
      }
      await watchDeletionCoordinator.reconcile();

      if (!isCurrent()) {
        return;
      }
      publishedRef.current = nextPublication;
      setPublished(nextPublication);
      localPublished = true;
      setBootstrapPresentation({
        queryScope: desiredScope,
        state: migrationDegraded
          ? {
              status: 'degraded',
              issue: {stage: 'legacyMigration', retryable: true},
            }
          : {status: 'ready'},
      });

      if (desiredPrincipal.kind === 'user' && nextPublication.outbox) {
        try {
          await reconcilePendingAccountOperations({
            userId: desiredPrincipal.userId,
            repositories: nextPublication.localRepositories,
            accountRepositories:
              nextPublication.accountRepositories ?? nextPublication,
          });
        } catch (error) {
          if (isCurrent()) {
            setBootstrapPresentation({
              queryScope: desiredScope,
              state: {
                status: 'degraded',
                issue: {stage: 'outboxReconciliation', retryable: true},
              },
            });
            console.warn('Failed to reconcile local account operations', error);
          }
          return;
        }
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
        nextPublication.coordinator?.setOnHydratedPage(async () => {
          if (isCurrent()) {
            await invalidatePrincipalQueries(queryClient, desiredScope);
          }
        });
        nextPublication.coordinator?.setCommitGuard(() => {
          if (!isCurrent() || !isOnline) {
            throw new StaleAccountSyncCommitError();
          }
        });

        if (isOnline && nextPublication.coordinator) {
          const coordinator = nextPublication.coordinator;
          const refreshGeneration = nextPublication.claimGeneration;
          let settlePromise!: () => void;
          let started = false;
          let settled = false;
          let scheduledHandle: {cancel(): void} | undefined;
          const promise = new Promise<void>(resolve => {
            settlePromise = resolve;
          });
          let operation!: NonNullable<PublishedAccountData['cloudRefresh']>;
          const settle = () => {
            if (settled) {
              return;
            }
            settled = true;
            settlePromise();
          };
          const run = async () => {
            let hydrated = 0;
            beginCloudRefresh(desiredScope);
            try {
              hydrated = (await coordinator.hydrate({online: true})) ?? 0;
              if (!isCurrent()) {
                return;
              }
              await coordinator.drain({online: true});
              if (!isCurrent()) {
                return;
              }
              if (hydrated > 0) {
                await invalidatePrincipalQueries(queryClient, desiredScope);
              }
            } catch (error) {
              if (
                isCurrent() &&
                error instanceof AccountHydrationError &&
                error.changed > 0
              ) {
                await invalidatePrincipalQueries(queryClient, desiredScope);
              }
              if (isCurrent() && !isStaleAccountSyncCommitError(error)) {
                setBootstrapPresentation({
                  queryScope: desiredScope,
                  state: {
                    status: 'degraded',
                    issue: {stage: 'remoteHydration', retryable: true},
                  },
                });
                console.warn('Failed to hydrate remote account data', error);
              }
            } finally {
              endCloudRefresh(desiredScope);
              if (nextPublication.cloudRefresh === operation) {
                nextPublication.cloudRefresh = undefined;
              }
              settle();
            }
          };
          const start = () => {
            if (started || settled) {
              return;
            }
            started = true;
            scheduledHandle?.cancel();
            void run();
          };
          const cancel = () => {
            scheduledHandle?.cancel();
            if (nextPublication.cloudRefresh === operation) {
              nextPublication.cloudRefresh = undefined;
            }
            settle();
          };
          operation = {
            generation: refreshGeneration,
            coordinator,
            promise,
            start,
            cancel,
          };
          nextPublication.cloudRefresh = operation;
          try {
            scheduledHandle = dependencies.scheduleAfterInteractions(
              async () => {
                start();
                await promise;
              },
            );
            if (settled || started) {
              scheduledHandle.cancel();
            }
          } catch (error) {
            cancel();
            if (isCurrent()) {
              setBootstrapPresentation({
                queryScope: desiredScope,
                state: {
                  status: 'degraded',
                  issue: {stage: 'remoteHydration', retryable: true},
                },
              });
              console.warn('Failed to schedule remote account hydration', error);
            }
          }
          await promise;
          if (!isCurrent()) {
            return;
          }
        } else {
          nextPublication.coordinator?.pause();
        }
      }
    };

    void publish().catch(error => {
      if (isCurrent() && !isStaleAccountSyncCommitError(error)) {
        if (localPublished) {
          setBootstrapPresentation({
            queryScope: desiredScope,
            state: {
              status: 'degraded',
              issue: {stage: 'remoteHydration', retryable: true},
            },
          });
        } else {
          publishedRef.current = undefined;
          setPublished(undefined);
          setBootstrapPresentation({
            queryScope: desiredScope,
            state: {
              status: 'recoveryRequired',
              issue: {stage: 'localRepository', retryable: true},
            },
          });
        }
        console.warn('Failed to prepare principal data repositories', error);
      }
    });

    return () => {
      if (generationRef.current === generation) {
        generationRef.current += 1;
        const publication = publications.get(desiredScope);
        publication?.cloudRefresh?.cancel?.();
        publication?.coordinator?.pause();
        if (publication) {
          cancelZeroInventoryAudit(publication);
        }
      }
    };
  }, [
    auth.accountDataRepository,
    auth.guestClaimRemoteRepository,
    beginCloudRefresh,
    bootstrapAttempt,
    dependencies,
    desiredPrincipal,
    desiredScope,
    endCloudRefresh,
    isOnline,
    notifyGuestInventoryChanged,
    queryClient,
    watchDeletionStore,
  ]);

  const scheduleZeroInventoryAudit = React.useCallback(
    (publication: PublishedAccountData, generation: number) => {
      if (
        publication.zeroInventoryAudit ||
        publication.zeroInventoryAuditAttempted ||
        !publication.claimStore ||
        !publication.claimService
      ) {
        return;
      }
      const token = {};
      const isAuditCurrent = () =>
        publication.zeroInventoryAudit?.token === token &&
        publication.zeroInventoryAudit.generation === generation &&
        generationRef.current === generation &&
        publishedRef.current === publication &&
        publication.claimGeneration === generation &&
        publication.hasLiveGuestInventory === false;
      const finish = () => {
        if (publication.zeroInventoryAudit?.token === token) {
          publication.zeroInventoryAudit = undefined;
        }
      };
      publication.zeroInventoryAuditAttempted = true;
      publication.zeroInventoryAudit = {
        token,
        generation,
        cancel: () => undefined,
      };
      try {
        const handle = dependencies.scheduleAfterInteractions(async () => {
          try {
            if (!isAuditCurrent()) {
              return;
            }
            let snapshot: GuestClaimSnapshot | undefined;
            try {
              snapshot = await publication.claimStore!.read();
            } catch {
              return;
            }
            if (
              !isAuditCurrent() ||
              !isRecoverableClaimSnapshot(snapshot)
            ) {
              return;
            }
            await resumeZeroInventoryClaim(publication, isAuditCurrent);
          } finally {
            finish();
          }
        });
        if (publication.zeroInventoryAudit?.token === token) {
          publication.zeroInventoryAudit.cancel = () => handle.cancel();
        } else {
          handle.cancel();
        }
      } catch {
        finish();
      }
    },
    [dependencies],
  );

  const recoverBootstrapStage = React.useCallback(
    (queryScope: string, stage: AccountDataBootstrapStage) => {
      setBootstrapPresentation(current =>
        current.queryScope === queryScope &&
        current.state.status === 'degraded' &&
        current.state.issue.stage === stage
          ? {queryScope, state: {status: 'ready'}}
          : current,
      );
    },
    [],
  );

  const refreshClaim = React.useCallback(
    async (
      publication: PublishedAccountData,
      options: { resumeActive: boolean },
    ) => {
      const refreshSequence = claimRefreshSequenceRef.current + 1;
      claimRefreshSequenceRef.current = refreshSequence;
      const claimGeneration = publication.claimGeneration;
      const isClaimCurrent = () =>
        claimRefreshSequenceRef.current === refreshSequence &&
        generationRef.current === claimGeneration &&
        publishedRef.current === publication &&
        publication.claimGeneration === claimGeneration;
      const awaitCurrentClaimStep = async <T,>(
        operation: () => Promise<T>,
      ): Promise<
        {current: false} | {current: true; value: T}
      > => {
        try {
          const value = await operation();
          return isClaimCurrent()
            ? {current: true, value}
            : {current: false};
        } catch (error) {
          if (!isClaimCurrent()) {
            return {current: false};
          }
          throw error;
        }
      };
      const readCurrentGuestInventory = async () => {
        const observationSequence =
          beginClaimInventoryObservation(publication);
        try {
          const inventory = await readGuestInventory(publication);
          if (
            !isClaimCurrent() ||
            !commitClaimInventoryObservation(
              publication,
              observationSequence,
              inventory,
            )
          ) {
            return undefined;
          }
          return inventory;
        } catch (error) {
          if (!isClaimCurrent()) {
            return undefined;
          }
          setClaimPresentation(hiddenClaimPresentation(desiredScope));
          throw error;
        }
      };
      let inspectionStarted = false;
      let inspectionFailed = false;
      try {
        if (
          publication.queryScope !== desiredScope ||
          publication.principal.kind !== 'user' ||
          !publication.claimStore ||
          !publication.guestRepositories ||
          !navigationReady
        ) {
          setClaimPresentation(hiddenClaimPresentation(desiredScope));
          return;
        }
        inspectionStarted = true;

        const inventory = await readCurrentGuestInventory();
        if (!inventory || !isClaimCurrent()) {
          return;
        }
        if (inventory.logs.length + inventory.plans.length === 0) {
          clearHiddenGuestIds(publication);
          if (isClaimCurrent()) {
            setClaimPresentation(hiddenClaimPresentation(desiredScope));
          }
          if (
            !options.resumeActive ||
            !isOnline ||
            AppState.currentState !== 'active' ||
            !publication.claimService
          ) {
            return;
          }
          let checkpointHint: Awaited<
            ReturnType<GuestClaimStore['readCheckpointHint']>
          >;
          try {
            checkpointHint =
              await publication.claimStore.readCheckpointHint();
          } catch {
            inspectionFailed = true;
            return;
          }
          if (
            !isClaimCurrent() ||
            publication.hasLiveGuestInventory !== false
          ) {
            return;
          }
          if (checkpointHint.state === 'recoverable') {
            await resumeZeroInventoryClaim(publication, isClaimCurrent);
            return;
          }
          if (
            checkpointHint.state === 'unknown' &&
            claimGeneration !== undefined
          ) {
            scheduleZeroInventoryAudit(publication, claimGeneration);
          }
          return;
        }

        let snapshot: GuestClaimSnapshot | undefined;
        try {
          snapshot = await publication.claimStore.read();
        } catch {
          inspectionFailed = true;
          if (isClaimCurrent()) {
            setClaimPresentation({
              queryScope: desiredScope,
              eligible: {logCount: 0, planCount: 0},
              state: {
                status: 'failed',
                completed: 0,
                total: 0,
                errorCode: 'claim_validation_failed',
              },
            });
          }
          return;
        }
        if (
          !isClaimCurrent() ||
          (snapshot?.userId !== undefined &&
            snapshot.userId !== publication.principal.userId)
        ) {
          if (isClaimCurrent()) {
            inspectionFailed = true;
          }
          return;
        }
        const appliedSnapshot = await awaitCurrentClaimStep(() =>
          applyHiddenGuestIds(
            publication,
            snapshot,
            inventory,
            dependencies.profileStorage,
            isClaimCurrent,
          ),
        );
        if (!appliedSnapshot.current) {
          return;
        }
        const eligible = eligibleGuestCounts(publication, inventory);
        setClaimPresentation(
          presentationForSnapshot(desiredScope, snapshot, eligible, isOnline),
        );

        if (
          options.resumeActive &&
          isOnline &&
          AppState.currentState === 'active' &&
          publication.claimService &&
            snapshot !== undefined &&
            (snapshot.manifest.status === 'running' ||
              snapshot.manifest.status === 'finalizing' ||
              (snapshot.manifest.status === 'cleanupPending' &&
                snapshot.failure === undefined) ||
              (snapshot.manifest.status === 'committed' &&
                hasHiddenGuestIds(publication)) ||
              (snapshot.manifest.status === 'failed' &&
                snapshot.errorCode === 'network_unavailable'))
        ) {
          const resumed = await awaitCurrentClaimStep(() =>
            publication.claimService!.resume(),
          );
          if (!resumed.current) {
            return;
          }
          const refreshedInventory = await readCurrentGuestInventory();
          if (!refreshedInventory || !isClaimCurrent()) {
            return;
          }
          if (
            refreshedInventory.logs.length +
              refreshedInventory.plans.length ===
            0
          ) {
            clearHiddenGuestIds(publication);
            if (isClaimCurrent()) {
              setClaimPresentation(hiddenClaimPresentation(desiredScope));
            }
            return;
          }
          const refreshedSnapshotRead = await awaitCurrentClaimStep(() =>
            publication.claimStore!.read(),
          );
          if (!refreshedSnapshotRead.current) {
            return;
          }
          const refreshedSnapshot = refreshedSnapshotRead.value;
          const appliedRefreshedSnapshot = await awaitCurrentClaimStep(() =>
            applyHiddenGuestIds(
              publication,
              refreshedSnapshot,
              refreshedInventory,
              dependencies.profileStorage,
              isClaimCurrent,
            ),
          );
          if (!appliedRefreshedSnapshot.current) {
            return;
          }
          const refreshedEligible = eligibleGuestCounts(
            publication,
            refreshedInventory,
          );
          setClaimPresentation(
            presentationForSnapshot(
              desiredScope,
              refreshedSnapshot,
              refreshedEligible,
              isOnline,
            ),
          );
        }
      } catch (error) {
        inspectionFailed = true;
        throw error;
      } finally {
        if (inspectionStarted && !inspectionFailed && isClaimCurrent()) {
          recoverBootstrapStage(desiredScope, 'claimInspection');
        }
      }
    },
    [
      dependencies.profileStorage,
      desiredScope,
      isOnline,
      navigationReady,
      recoverBootstrapStage,
      scheduleZeroInventoryAudit,
    ],
  );

  React.useEffect(() => {
    if (!published || published.queryScope !== desiredScope) {
      setClaimPresentation(hiddenClaimPresentation(desiredScope));
      return;
    }
    refreshClaim(published, {resumeActive: true}).catch(error => {
      if (publishedRef.current === published) {
        setBootstrapPresentation({
          queryScope: desiredScope,
          state: {
            status: 'degraded',
            issue: {stage: 'claimInspection', retryable: true},
          },
        });
        console.warn('Failed to inspect guest claim state', error);
      }
    });
  }, [desiredScope, published, refreshClaim]);

  React.useEffect(() => {
    if (
      guestInventoryRevision === 0 ||
      !published ||
      published.queryScope !== desiredScope
    ) {
      return;
    }
    refreshClaim(published, {resumeActive: false}).catch(error => {
      if (publishedRef.current === published) {
        console.warn(
          'Failed to refresh guest inventory after mutation',
          error,
        );
      }
    });
  }, [
    desiredScope,
    guestInventoryRevision,
    published,
    refreshClaim,
  ]);

  const retryBootstrap = React.useCallback(() => {
    setBootstrapPresentation({
      queryScope: desiredScope,
      state: {status: 'loading'},
    });
    setBootstrapAttempt(attempt => attempt + 1);
  }, [desiredScope]);

  const requestSync = React.useCallback(async () => {
    if (!published?.coordinator) {
      return {
        processed: 0,
        remaining: published?.outbox
          ? (
              await published.outbox.list(
                published.principal.kind === 'user'
                  ? published.principal.userId
                  : undefined,
              )
            ).length
          : 0,
      };
    }
    const result = await published.coordinator.drain({ online: isOnline });
    return result;
  }, [isOnline, published]);

  const resolveConflict = React.useCallback(
    async (
      kind: 'log' | 'plan',
      localId: string,
      choice: 'keepLocal' | 'useRemote',
    ) => {
      const publication = publishedRef.current;
      const coordinator = publication?.coordinator;
      if (!publication || publication.principal.kind !== 'user' || !coordinator) {
        throw new Error('Account sync is unavailable for conflict resolution');
      }
      if (choice === 'useRemote') {
        await coordinator.resolveConflictUsingRemote(kind, localId);
      } else if (kind === 'log') {
        const rebased = await coordinator.prepareKeepLocalLog(localId);
        const logbook = publication.accountRepositories?.logbook as
          | Partial<AccountQueueRepository<DiveLogEntry>>
          | undefined;
        if (!rebased || !logbook?.reconcileSaved) {
          throw new Error('The local log could not be kept');
        }
        await logbook.reconcileSaved(rebased);
      } else {
        const rebased = await coordinator.prepareKeepLocalPlan(localId);
        const planbook = publication.accountRepositories?.planbook as
          | Partial<AccountQueueRepository<DivePlan>>
          | undefined;
        if (!rebased || !planbook?.reconcileSaved) {
          throw new Error('The local plan could not be kept');
        }
        await planbook.reconcileSaved(rebased);
      }
      await invalidatePrincipalQueries(queryClient, publication.queryScope);
      void coordinator.drain({online: isOnline}).catch(() => undefined);
    },
    [isOnline, queryClient],
  );

  const refreshCloudData = React.useCallback(async () => {
    const publication = publishedRef.current;
    const generation = publication?.claimGeneration;
    const coordinator = publication?.coordinator;
    const isCurrent = () =>
      publication !== undefined &&
      publication.principal.kind === 'user' &&
      publication.queryScope === desiredScope &&
      publication.claimGeneration === generation &&
      generationRef.current === generation &&
      publishedRef.current === publication;
    if (!isOnline || !coordinator || !isCurrent()) {
      return;
    }
    const activeRefresh = publication.cloudRefresh;
    if (
      activeRefresh &&
      activeRefresh.generation === generation &&
      activeRefresh.coordinator === coordinator
    ) {
      activeRefresh.start?.();
      return activeRefresh.promise;
    }

    const promise = (async () => {
      beginCloudRefresh(publication.queryScope);
      try {
        await coordinator.drain({online: true});
        const hydrated = await coordinator.hydrate({online: true});
        if (!isCurrent()) {
          return;
        }
        if (hydrated > 0) {
          await invalidatePrincipalQueries(queryClient, publication.queryScope);
          if (!isCurrent()) {
            return;
          }
        }
        setBootstrapPresentation(current =>
          current.queryScope === publication.queryScope &&
          current.state.status === 'degraded' &&
          current.state.issue.stage === 'remoteHydration'
            ? {queryScope: publication.queryScope, state: {status: 'ready'}}
            : current,
        );
      } catch (error) {
        if (
          isCurrent() &&
          error instanceof AccountHydrationError &&
          error.changed > 0
        ) {
          await invalidatePrincipalQueries(
            queryClient,
            publication.queryScope,
          );
        }
        if (isCurrent() && !isStaleAccountSyncCommitError(error)) {
          setBootstrapPresentation({
            queryScope: publication.queryScope,
            state: {
              status: 'degraded',
              issue: {stage: 'remoteHydration', retryable: true},
            },
          });
          console.warn('Failed to refresh remote account data', error);
        }
        throw error;
      } finally {
        endCloudRefresh(publication.queryScope);
      }
    })();
    const operation = {generation, coordinator, promise};
    publication.cloudRefresh = operation;
    try {
      await promise;
    } finally {
      if (publication.cloudRefresh === operation) {
        publication.cloudRefresh = undefined;
      }
    }
  }, [beginCloudRefresh, desiredScope, endCloudRefresh, isOnline, queryClient]);

  const runClaim = React.useCallback(
    async (operation: 'start' | 'retry' | 'recheckRetained' | 'defer') => {
      const publication = publishedRef.current;
      const claimGeneration = publication?.claimGeneration;
      const claimService = publication?.claimService;
      const isClaimCurrent = () =>
        generationRef.current === claimGeneration &&
        publishedRef.current === publication &&
        publication?.claimGeneration === claimGeneration &&
        publication?.claimService === claimService;
      if (
        publication?.principal.kind !== 'user' ||
        publication.queryScope !== desiredScope ||
        !navigationReady ||
        (operation !== 'defer' && !isOnline) ||
        !claimService
      ) {
        return;
      }
      try {
        if (operation === 'start') {
          await claimService.start();
        } else if (operation === 'retry') {
          await claimService.retry();
        } else if (operation === 'recheckRetained') {
          await claimService.recheckRetained();
        } else {
          await claimService.defer();
        }
      } catch (error) {
        if (!isClaimCurrent()) {
          return;
        }
        const inventory = await readGuestInventory(publication);
        if (!isClaimCurrent()) {
          return;
        }
        const eligible = eligibleGuestCounts(publication, inventory);
        if (operation === 'defer' || operation === 'recheckRetained') {
          let snapshot: GuestClaimSnapshot | undefined;
          try {
            snapshot = await publication.claimStore?.read();
          } catch {
            snapshot = undefined;
          }
          if (!isClaimCurrent()) {
            return;
          }
          if (snapshot !== undefined) {
            await refreshClaim(publication, { resumeActive: false });
            return;
          }
          if (operation === 'defer') {
            setClaimPresentation({
              queryScope: desiredScope,
              eligible,
              state: { status: 'hidden' },
            });
            return;
          }
        }
        let completed = 0;
        try {
          completed =
            (await publication.claimStore?.read())?.manifest.items.filter(
              item => item.completedAt !== undefined,
            ).length ?? 0;
        } catch {
          completed = 0;
        }
        if (!isClaimCurrent()) {
          return;
        }
        setClaimPresentation({
          queryScope: desiredScope,
          eligible,
          state: {
            status: 'failed',
            completed,
            total: eligible.logCount + eligible.planCount,
            errorCode:
              error instanceof GuestClaimServiceError
                ? error.code
                : 'claim_validation_failed',
            ...(error instanceof GuestClaimServiceError &&
            error.failure !== undefined
              ? {failure: error.failure}
              : {}),
          },
        });
        return;
      }
      if (isClaimCurrent()) {
        await refreshClaim(publication, { resumeActive: false });
      }
    },
    [desiredScope, isOnline, navigationReady, refreshClaim],
  );

  const resumeClaim = React.useCallback(async () => {
    const publication = publishedRef.current;
    if (
      publication?.principal.kind === 'user' &&
      publication.queryScope === desiredScope &&
      navigationReady &&
      isOnline
    ) {
      await refreshClaim(publication, { resumeActive: true });
    }
  }, [desiredScope, isOnline, navigationReady, refreshClaim]);

  React.useEffect(() => {
    let previousState = AppState.currentState as AppStateStatus;
    const subscription = AppState.addEventListener('change', nextState => {
      const becameActive = previousState !== 'active' && nextState === 'active';
      previousState = nextState;
      if (becameActive && isOnline) {
        void refreshCloudData().catch(() => undefined);
        resumeClaim().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [isOnline, refreshCloudData, resumeClaim]);

  const isHistoricalWatchArtifact = React.useCallback(
    async (identity: WatchArtifactIdentity): Promise<boolean> => {
      const publication = publishedRef.current;
      const generation = publication?.claimGeneration;
      if (
        publication?.queryScope !== desiredScope ||
        publication.principal.kind !== 'user' ||
        !publication.claimStore ||
        !publication.guestRepositories ||
        generation === undefined
      ) {
        return false;
      }
      while (true) {
        if (
          publication.historicalArtifactLookup?.generation !== generation
        ) {
          publication.historicalArtifactLookup = {
            generation,
            promise: buildHistoricalArtifactLookup(publication),
          };
        }
        const operation = publication.historicalArtifactLookup;
        let lookup: Set<string>;
        try {
          lookup = await operation.promise;
        } catch (error) {
          if (publication.historicalArtifactLookup === operation) {
            publication.historicalArtifactLookup = undefined;
          }
          throw error;
        }
        if (
          generationRef.current !== generation ||
          publishedRef.current !== publication ||
          publication.claimGeneration !== generation
        ) {
          return false;
        }
        if (publication.historicalArtifactLookup !== operation) {
          continue;
        }
        return lookup.has(watchArtifactIdentityKey(identity));
      }
    },
    [desiredScope],
  );
  const isWatchSessionDeleted = React.useCallback(
    async (localSessionId: string): Promise<boolean> =>
      (await watchDeletionStore.get(localSessionId)) !== undefined,
    [watchDeletionStore],
  );
  const reconcileDeletedWatchSession = React.useCallback(
    async (localSessionId: string): Promise<void> => {
      if ((await watchDeletionStore.get(localSessionId)) === undefined) {
        return;
      }
      const publication = publishedRef.current;
      await publication?.watchDeletionCoordinator?.reconcile();
      if (publication?.queryScope === desiredScope) {
        await invalidatePrincipalQueries(queryClient, desiredScope);
      }
    },
    [desiredScope, queryClient, watchDeletionStore],
  );

  const bootstrap =
    bootstrapPresentation.queryScope === desiredScope
      ? bootstrapPresentation.state
      : LOADING_BOOTSTRAP;
  const isPrincipalSettled = isPrincipalSettledAuthState(auth.state);
  const accountRepository = auth.accountDataRepository;
  const guestClaimRemoteRepository = auth.guestClaimRemoteRepository;
  // Every screen reads this context, so it keeps its identity until something in it changes.
  const contextValue = React.useMemo<AccountDataContextValue | undefined>(() => {
    if (!published || published.queryScope !== desiredScope) {
      return undefined;
    }
    return {
      principal: published.principal,
      queryScope: published.queryScope,
      logbookRepository: published.logbook,
      planRepository: published.planbook,
      isHydrated: true,
      isOnline,
      isPrincipalSettled,
      outbox: published.outbox,
      accountRepository,
      guestClaimRemoteRepository,
      bootstrap,
      retryBootstrap,
      claim:
        claimPresentation.queryScope === desiredScope
          ? {
              eligible: claimPresentation.eligible,
              state: claimPresentation.state,
              start: () => runClaim('start'),
              retry: () => runClaim('retry'),
              recheckRetained: () => runClaim('recheckRetained'),
              keepOnDevice: () => runClaim('defer'),
              refresh: async () => {
                await refreshClaim(published, {resumeActive: false});
              },
            }
          : hiddenClaimController(),
      isHistoricalWatchArtifact,
      isWatchSessionDeleted,
      reconcileDeletedWatchSession,
      requestSync,
      refreshCloudData,
      isCloudRefreshing,
      resolveConflict,
    };
  }, [
    accountRepository,
    bootstrap,
    claimPresentation,
    desiredScope,
    guestClaimRemoteRepository,
    isCloudRefreshing,
    isHistoricalWatchArtifact,
    isOnline,
    isPrincipalSettled,
    isWatchSessionDeleted,
    published,
    reconcileDeletedWatchSession,
    refreshClaim,
    refreshCloudData,
    requestSync,
    resolveConflict,
    retryBootstrap,
    runClaim,
  ]);

  if (!contextValue) {
    return bootstrap.status === 'recoveryRequired' ? (
      <RecoveryScreen kind="accountData" onRetry={retryBootstrap} />
    ) : (
      <RecoveryScreen kind="loading" />
    );
  }

  return (
    <AccountDataContext.Provider value={contextValue}>
      {children}
    </AccountDataContext.Provider>
  );
}

async function buildHistoricalArtifactLookup(
  publication: PublishedAccountData,
): Promise<Set<string>> {
  if (!publication.guestRepositories || !publication.claimStore) {
    return new Set();
  }
  const liveGuestIds = new Set(
    (await publication.guestRepositories.logbook.list()).map(
      record => record.localId,
    ),
  );
  const snapshot = await publication.claimStore.read();
  if (snapshot === undefined) {
    return new Set();
  }

  const identities = new Set(
    (snapshot.historicalArtifacts ?? []).map(watchArtifactIdentityKey),
  );
  for (const [index, item] of snapshot.manifest.items.entries()) {
    if (
      item.entityKind !== 'log' ||
      liveGuestIds.has(item.clientRecordId)
    ) {
      continue;
    }
    const sidecar = snapshot.snapshots[index];
    if (sidecar === undefined || sidecar.entityKind !== 'log') {
      continue;
    }
    const record = parseSnapshotLocalRecord(sidecar) as DiveLogEntry;
    const profile = record.watchCapture?.profile;
    const artifactSha256 = profile?.artifactSha256 ?? profile?.sha256;
    if (
      record.watchCapture === undefined ||
      profile?.contentRevision === undefined ||
      artifactSha256 === undefined
    ) {
      continue;
    }
    const identity: WatchArtifactIdentity = {
      localSessionId: record.watchCapture.session.localSessionId,
      contentRevision: profile.contentRevision,
      artifactSha256,
    };
    if (
      claimSnapshotContainsHistoricalArtifact(
        snapshot,
        identity,
        liveGuestIds,
      )
    ) {
      identities.add(watchArtifactIdentityKey(identity));
    }
  }
  return identities;
}

function watchArtifactIdentityKey(identity: WatchArtifactIdentity): string {
  return JSON.stringify([
    identity.localSessionId,
    identity.contentRevision,
    identity.artifactSha256,
  ]);
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
  await queryClient.cancelQueries({ predicate });
  queryClient.removeQueries({ predicate });
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
  return (query: { queryKey: readonly unknown[] }) =>
    (query.queryKey[0] === 'diveLogbook' ||
      query.queryKey[0] === 'divePlans') &&
    query.queryKey[1] === queryScope;
}

function createComposedAccountRepositories(options: {
  userId: string;
  accountRepositories: PrincipalRepositories;
  guestRepositories: PrincipalRepositories;
  hiddenGuestIds: HiddenGuestIds;
  onGuestInventoryChanged(): void;
}): PrincipalRepositories {
  const accountLogbook = options.accountRepositories
    .logbook as DiveLogRepository &
    Partial<AccountQueueRepository<DiveLogEntry>>;
  const logbook: DiveLogRepository = {
    async list() {
      const [accountRows, guestRows] = await Promise.all([
        options.accountRepositories.logbook.list(),
        options.guestRepositories.logbook.list(),
      ]);
      const visibleGuestRows = guestRows.filter(
        row => !options.hiddenGuestIds.logIds.has(row.localId),
      );
      const guestPriorityIds = new Set(
        visibleGuestRows
          .filter(row =>
            options.hiddenGuestIds.guestPriorityLogIds.has(row.localId),
          )
          .map(row => row.localId),
      );
      return composeAccountAndDeferredGuestRows(
        accountRows.filter(row => !guestPriorityIds.has(row.localId)),
        visibleGuestRows,
      );
    },
    async get(localId) {
      if (options.hiddenGuestIds.guestPriorityLogIds.has(localId)) {
        const guest = await options.guestRepositories.logbook.get(localId);
        if (guest !== undefined) {
          return guest;
        }
      }
      const account = await options.accountRepositories.logbook.get(localId);
      if (account || options.hiddenGuestIds.logIds.has(localId)) {
        return account;
      }
      return options.guestRepositories.logbook.get(localId);
    },
    async save(value) {
      if (
        value.ownerUserId === undefined &&
        (await options.guestRepositories.logbook.get(value.localId)) !==
          undefined
      ) {
        const saved = await options.guestRepositories.logbook.save(value);
        options.onGuestInventoryChanged();
        return saved;
      }
      return options.accountRepositories.logbook.save(value);
    },
    async delete(localId, deleteOptions) {
      if (options.hiddenGuestIds.guestPriorityLogIds.has(localId)) {
        await options.guestRepositories.logbook.delete(localId, deleteOptions);
        options.onGuestInventoryChanged();
        return;
      }
      if (await options.accountRepositories.logbook.get(localId)) {
        return options.accountRepositories.logbook.delete(
          localId,
          deleteOptions,
        );
      }
      await options.guestRepositories.logbook.delete(localId, deleteOptions);
      options.onGuestInventoryChanged();
    },
    async deleteIf(localId, predicate, deleteOptions) {
      if (options.hiddenGuestIds.guestPriorityLogIds.has(localId)) {
        const result = await options.guestRepositories.logbook.deleteIf(
          localId,
          predicate,
          deleteOptions,
        );
        options.onGuestInventoryChanged();
        return result;
      }
      if (await options.accountRepositories.logbook.get(localId)) {
        return options.accountRepositories.logbook.deleteIf(
          localId,
          predicate,
          deleteOptions,
        );
      }
      const result = await options.guestRepositories.logbook.deleteIf(
        localId,
        predicate,
        deleteOptions,
      );
      options.onGuestInventoryChanged();
      return result;
    },
    async getWatchProfile(localId) {
      if (options.hiddenGuestIds.guestPriorityLogIds.has(localId)) {
        return options.guestRepositories.logbook.getWatchProfile(localId);
      }
      return (await options.accountRepositories.logbook.get(localId))
        ? options.accountRepositories.logbook.getWatchProfile(localId)
        : options.guestRepositories.logbook.getWatchProfile(localId);
    },
    async readStoredWatchProfile(localId) {
      if (options.hiddenGuestIds.guestPriorityLogIds.has(localId)) {
        return options.guestRepositories.logbook.readStoredWatchProfile(
          localId,
        );
      }
      return (await options.accountRepositories.logbook.get(localId))
        ? options.accountRepositories.logbook.readStoredWatchProfile(localId)
        : options.guestRepositories.logbook.readStoredWatchProfile(localId);
    },
    importWatchMessages(messages, importOptions) {
      return options.accountRepositories.logbook.importWatchMessages(
        messages,
        importOptions,
      );
    },
    removeWatchProfileIfUnreferenced(storageKey) {
      return options.accountRepositories.logbook.removeWatchProfileIfUnreferenced(
        storageKey,
      );
    },
  };
  const composedLogbook = logbook as DiveLogRepository &
    Partial<AccountQueueRepository<DiveLogEntry>>;
  if (accountLogbook.saveLocalOnly) {
    composedLogbook.saveLocalOnly = async value => {
      if (
        value.ownerUserId === undefined &&
        (await options.guestRepositories.logbook.get(value.localId)) !==
          undefined
      ) {
        const saved = await options.guestRepositories.logbook.save(value);
        options.onGuestInventoryChanged();
        return saved;
      }
      return accountLogbook.saveLocalOnly!(value);
    };
  }
  if (accountLogbook.enqueueSaved) {
    composedLogbook.enqueueSaved = async value => {
      if (
        value.ownerUserId === undefined &&
        (await options.guestRepositories.logbook.get(value.localId)) !==
          undefined
      ) {
        return;
      }
      await accountLogbook.enqueueSaved!(value);
    };
  }
  if (accountLogbook.reconcileSaved) {
    composedLogbook.reconcileSaved = async value => {
      if (
        value.ownerUserId === undefined &&
        (await options.guestRepositories.logbook.get(value.localId)) !==
          undefined
      ) {
        return;
      }
      await accountLogbook.reconcileSaved!(value);
    };
  }
  const accountPlanbook = options.accountRepositories
    .planbook as DivePlanRepository & Partial<AccountQueueRepository<DivePlan>>;
  const planbook: DivePlanRepository = {
    async list() {
      const [accountRows, guestRows] = await Promise.all([
        options.accountRepositories.planbook.list(),
        options.guestRepositories.planbook.list(),
      ]);
      const visibleGuestRows = guestRows.filter(
        row => !options.hiddenGuestIds.planIds.has(row.localId),
      );
      const guestPriorityIds = new Set(
        visibleGuestRows
          .filter(row =>
            options.hiddenGuestIds.guestPriorityPlanIds.has(row.localId),
          )
          .map(row => row.localId),
      );
      return composeAccountAndDeferredGuestRows(
        accountRows.filter(row => !guestPriorityIds.has(row.localId)),
        visibleGuestRows,
      );
    },
    async get(localId) {
      if (options.hiddenGuestIds.guestPriorityPlanIds.has(localId)) {
        const guest = await options.guestRepositories.planbook.get(localId);
        if (guest !== undefined) {
          return guest;
        }
      }
      const account = await options.accountRepositories.planbook.get(localId);
      if (account || options.hiddenGuestIds.planIds.has(localId)) {
        return account;
      }
      return options.guestRepositories.planbook.get(localId);
    },
    async save(value) {
      if (
        value.ownerUserId === undefined &&
        (await options.guestRepositories.planbook.get(value.localId)) !==
          undefined
      ) {
        const saved = await options.guestRepositories.planbook.save(value);
        options.onGuestInventoryChanged();
        return saved;
      }
      return options.accountRepositories.planbook.save(value);
    },
    async delete(localId) {
      if (options.hiddenGuestIds.guestPriorityPlanIds.has(localId)) {
        await options.guestRepositories.planbook.delete(localId);
        options.onGuestInventoryChanged();
        return;
      }
      if (await options.accountRepositories.planbook.get(localId)) {
        return options.accountRepositories.planbook.delete(localId);
      }
      await options.guestRepositories.planbook.delete(localId);
      options.onGuestInventoryChanged();
    },
    async deleteIf(localId, predicate) {
      if (options.hiddenGuestIds.guestPriorityPlanIds.has(localId)) {
        const result = await options.guestRepositories.planbook.deleteIf(
          localId,
          predicate,
        );
        options.onGuestInventoryChanged();
        return result;
      }
      if (await options.accountRepositories.planbook.get(localId)) {
        return options.accountRepositories.planbook.deleteIf(localId, predicate);
      }
      const result = await options.guestRepositories.planbook.deleteIf(
        localId,
        predicate,
      );
      options.onGuestInventoryChanged();
      return result;
    },
  };
  const composedPlanbook = planbook as DivePlanRepository &
    Partial<AccountQueueRepository<DivePlan>>;
  if (accountPlanbook.saveLocalOnly) {
    composedPlanbook.saveLocalOnly = async value => {
      if (
        value.ownerUserId === undefined &&
        (await options.guestRepositories.planbook.get(value.localId)) !==
          undefined
      ) {
        const saved = await options.guestRepositories.planbook.save(value);
        options.onGuestInventoryChanged();
        return saved;
      }
      return accountPlanbook.saveLocalOnly!(value);
    };
  }
  if (accountPlanbook.enqueueSaved) {
    composedPlanbook.enqueueSaved = async value => {
      if (
        value.ownerUserId === undefined &&
        (await options.guestRepositories.planbook.get(value.localId)) !==
          undefined
      ) {
        return;
      }
      await accountPlanbook.enqueueSaved!(value);
    };
  }
  if (accountPlanbook.reconcileSaved) {
    composedPlanbook.reconcileSaved = async value => {
      if (
        value.ownerUserId === undefined &&
        (await options.guestRepositories.planbook.get(value.localId)) !==
          undefined
      ) {
        return;
      }
      await accountPlanbook.reconcileSaved!(value);
    };
  }
  return {
    principal: { kind: 'user', userId: options.userId },
    queryScope: principalScope({ kind: 'user', userId: options.userId }),
    logbook,
    planbook,
  };
}

async function readGuestInventory(
  publication: PublishedAccountData,
): Promise<GuestInventory> {
  if (!publication.guestRepositories) {
    return {logs: [], plans: []};
  }
  const [logs, plans] = await Promise.all([
    publication.guestRepositories.logbook.list(),
    publication.guestRepositories.planbook.list(),
  ]);
  return {logs, plans};
}

function isRecoverableClaimSnapshot(
  snapshot: GuestClaimSnapshot | undefined,
): boolean {
  return (
    snapshot?.manifest.status === 'running' ||
    snapshot?.manifest.status === 'finalizing' ||
    (snapshot?.manifest.status === 'cleanupPending' &&
      snapshot.failure === undefined) ||
    (snapshot?.manifest.status === 'failed' &&
      snapshot.errorCode === 'network_unavailable')
  );
}

async function resumeZeroInventoryClaim(
  publication: PublishedAccountData,
  isCurrent: () => boolean,
): Promise<void> {
  if (
    !publication.claimService ||
    !publication.claimStore ||
    publication.zeroInventoryRecoveryToken ||
    !isCurrent()
  ) {
    return;
  }
  const token = {};
  publication.zeroInventoryRecoveryToken = token;
  try {
    const snapshot = await publication.claimService.resume();
    if (
      publication.zeroInventoryRecoveryToken !== token ||
      !isCurrent()
    ) {
      return;
    }
    if (snapshot === undefined) {
      try {
        await publication.claimStore.remove();
      } catch {
        // The advisory hint can be retried on a later foreground refresh.
      }
    }
  } catch {
    // Zero-inventory recovery is advisory and must not expose stale UI.
  } finally {
    if (publication.zeroInventoryRecoveryToken === token) {
      publication.zeroInventoryRecoveryToken = undefined;
    }
  }
}

function beginClaimInventoryObservation(
  publication: PublishedAccountData,
): number {
  const sequence = (publication.claimInventoryObservationSequence ?? 0) + 1;
  publication.claimInventoryObservationSequence = sequence;
  return sequence;
}

function commitClaimInventoryObservation(
  publication: PublishedAccountData,
  sequence: number,
  inventory: GuestInventory,
): boolean {
  if (publication.claimInventoryObservationSequence !== sequence) {
    return false;
  }
  publication.hasLiveGuestInventory =
    inventory.logs.length + inventory.plans.length > 0;
  if (publication.hasLiveGuestInventory) {
    publication.zeroInventoryAuditAttempted = undefined;
    cancelZeroInventoryAudit(publication);
  }
  return true;
}

function cancelZeroInventoryAudit(
  publication: PublishedAccountData,
): void {
  const audit = publication.zeroInventoryAudit;
  publication.zeroInventoryAudit = undefined;
  audit?.cancel();
}

function eligibleGuestCounts(
  publication: PublishedAccountData,
  inventory: GuestInventory,
): {logCount: number; planCount: number} {
  return {
    logCount: inventory.logs.filter(
      value => !publication.hiddenGuestIds?.logIds.has(value.localId),
    ).length,
    planCount: inventory.plans.filter(
      value => !publication.hiddenGuestIds?.planIds.has(value.localId),
    ).length,
  };
}

async function applyHiddenGuestIds(
  publication: PublishedAccountData,
  snapshot: GuestClaimSnapshot | undefined,
  inventory: GuestInventory,
  profileStorage: AccountDataDependencies['profileStorage'],
  shouldApply: () => boolean = () => true,
): Promise<void> {
  const hidden = publication.hiddenGuestIds;
  if (!hidden || !publication.guestRepositories) {
    return;
  }
  const next: HiddenGuestIds = {
    logIds: new Set(),
    planIds: new Set(),
    guestPriorityLogIds: new Set(),
    guestPriorityPlanIds: new Set(),
  };
  if (snapshot === undefined) {
    if (shouldApply()) {
      replaceHiddenGuestIds(hidden, next);
    }
    return;
  }
  const published =
    snapshot.manifest.status === 'committed' ||
    snapshot.manifest.status === 'cleanupPending';
  const logsById = new Map(
    inventory.logs.map(value => [value.localId, value] as const),
  );
  const plansById = new Map(
    inventory.plans.map(value => [value.localId, value] as const),
  );
  if (!published) {
    for (const item of snapshot.manifest.items) {
      const exists = (
        item.entityKind === 'log' ? logsById : plansById
      ).has(item.clientRecordId);
      if (exists) {
        (item.entityKind === 'log'
          ? next.guestPriorityLogIds
          : next.guestPriorityPlanIds
        ).add(item.clientRecordId);
      }
    }
    if (shouldApply()) {
      replaceHiddenGuestIds(hidden, next);
    }
    return;
  }
  if (snapshot.snapshots.length === 0) {
    if (shouldApply()) {
      replaceHiddenGuestIds(hidden, next);
    }
    return;
  }
  for (const [index, item] of snapshot.manifest.items.entries()) {
    if (!shouldApply()) {
      return;
    }
    const current = (
      item.entityKind === 'log' ? logsById : plansById
    ).get(item.clientRecordId);
    if (current === undefined) {
      continue;
    }
    const matches = await guestRecordMatchesClaimSnapshot({
      item,
      sidecar: snapshot.snapshots[index]!,
      record: current,
      profileStorage,
    });
    if (!shouldApply()) {
      return;
    }
    if (published && matches) {
      (item.entityKind === 'log' ? next.logIds : next.planIds).add(
        item.clientRecordId,
      );
    } else {
      (item.entityKind === 'log'
        ? next.guestPriorityLogIds
        : next.guestPriorityPlanIds
      ).add(item.clientRecordId);
    }
  }
  if (shouldApply()) {
    replaceHiddenGuestIds(hidden, next);
  }
}

function clearHiddenGuestIds(publication: PublishedAccountData): void {
  const hidden = publication.hiddenGuestIds;
  if (!hidden) {
    return;
  }
  replaceHiddenGuestIds(hidden, {
    logIds: new Set(),
    planIds: new Set(),
    guestPriorityLogIds: new Set(),
    guestPriorityPlanIds: new Set(),
  });
}

function replaceHiddenGuestIds(
  target: HiddenGuestIds,
  source: HiddenGuestIds,
): void {
  for (const key of [
    'logIds',
    'planIds',
    'guestPriorityLogIds',
    'guestPriorityPlanIds',
  ] as const) {
    target[key].clear();
    for (const value of source[key]) {
      target[key].add(value);
    }
  }
}

function hasHiddenGuestIds(publication: PublishedAccountData): boolean {
  return Boolean(
    publication.hiddenGuestIds &&
      (publication.hiddenGuestIds.logIds.size > 0 ||
        publication.hiddenGuestIds.planIds.size > 0),
  );
}

function hiddenClaimPresentation(queryScope: string): AccountClaimPresentation {
  return {
    queryScope,
    eligible: { logCount: 0, planCount: 0 },
    state: { status: 'hidden' },
  };
}

const LOADING_BOOTSTRAP = {status: 'loading'} as const;

function hiddenClaimController(): AccountClaimController {
  return {
    eligible: { logCount: 0, planCount: 0 },
    state: { status: 'hidden' },
    start: async () => undefined,
    retry: async () => undefined,
    recheckRetained: async () => undefined,
    keepOnDevice: async () => undefined,
    refresh: async () => undefined,
  };
}

function runningClaimPresentation(
  queryScope: string,
  progress: GuestClaimProgress,
): AccountClaimPresentation {
  return {
    queryScope,
    eligible: { logCount: 0, planCount: 0 },
    state:
      progress.phase === 'cleanup'
        ? {status: 'running', phase: 'cleanup'}
        : {
            status: 'running',
            completed: progress.completed,
            total: progress.total,
            phase: progress.phase,
            ...(progress.currentLabel === undefined
              ? {}
              : {currentLabel: progress.currentLabel}),
          },
  };
}

function presentationForSnapshot(
  queryScope: string,
  snapshot: GuestClaimSnapshot | undefined,
  eligible: { logCount: number; planCount: number } = {
    logCount: 0,
    planCount: 0,
  },
  isOnline = true,
): AccountClaimPresentation {
  if (snapshot === undefined) {
    return {
      queryScope,
      eligible,
      state:
        isOnline && eligible.logCount + eligible.planCount > 0
          ? { status: 'choice', ...eligible }
          : { status: 'hidden' },
    };
  }
  if (
    eligible.logCount + eligible.planCount === 0 &&
    (snapshot.manifest.status === 'prepared' ||
      snapshot.manifest.status === 'deferred' ||
      snapshot.manifest.status === 'retained' ||
      (snapshot.manifest.status === 'failed' &&
        snapshot.manifest.remoteBatchId === undefined))
  ) {
    return {
      queryScope,
      eligible,
      state: {status: 'hidden'},
    };
  }
  const completed = snapshot.manifest.items.filter(
    item => item.completedAt !== undefined,
  ).length;
  const total = snapshot.manifest.items.length;
  let state: GuestClaimViewState;
  if (snapshot.manifest.status === 'running') {
    state = { status: 'running', completed, total, phase: 'uploading' };
  } else if (snapshot.manifest.status === 'finalizing') {
    state = { status: 'running', completed, total, phase: 'finalizing' };
  } else if (
    snapshot.manifest.status === 'cleanupPending' &&
    snapshot.failure !== undefined
  ) {
    state = {
      status: 'failed',
      completed,
      total,
      errorCode: snapshot.errorCode ?? 'claim_validation_failed',
      failure: snapshot.failure,
    };
  } else if (snapshot.manifest.status === 'cleanupPending') {
    state = {status: 'running', phase: 'cleanup'};
  } else if (snapshot.manifest.status === 'failed') {
    state = {
      status: 'failed',
      completed,
      total,
      errorCode: snapshot.errorCode ?? 'claim_validation_failed',
      ...(snapshot.failure === undefined
        ? {}
        : {failure: snapshot.failure}),
    };
  } else if (
    (snapshot.manifest.status === 'committed' ||
      snapshot.manifest.status === 'retained') &&
    isOnline &&
    eligible.logCount + eligible.planCount > snapshot.retainedItems.length
  ) {
    state = {status: 'choice', ...eligible};
  } else if (snapshot.manifest.status === 'committed') {
    state = {
      status: 'complete',
      imported: total,
      retainedItems: snapshot.retainedItems,
    };
  } else if (snapshot.manifest.status === 'retained') {
    state = {status: 'retained', retainedItems: snapshot.retainedItems};
  } else if (snapshot.manifest.status === 'deferred') {
    state = { status: 'deferred', ...eligible };
  } else if (snapshot.manifest.status === 'prepared' && isOnline) {
    state = { status: 'choice', ...eligible };
  } else {
    state = { status: 'hidden' };
  }
  return { queryScope, eligible, state };
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
    planbook: repositories.planbook,
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
    principal: { kind: 'user', userId },
    queryScope: principalScope({ kind: 'user', userId }),
    logbook,
    planbook,
  };
}

function createAccountLogbookRepository(options: {
  userId: string;
  local: DiveLogRepository;
  planbook: DivePlanRepository;
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
  const enqueueSavedUnlocked = async (saved: DiveLogEntry): Promise<void> => {
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
    if (operations.some(operation => operation.mutation === 'delete')) {
      return;
    }

    const prepared = await prepareLogMutation(current, options);
    const operationIdentity = {
      userId: options.userId,
      entityKind: 'log' as const,
      entityLocalId: prepared.local.localId,
      mutation: 'upsert' as const,
      payload: { local: prepared.local, remote: prepared.remote },
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
    try {
      await options.outbox.enqueue({
        operationId,
        ...operationIdentity,
        ...(profileStorageKey === undefined ? {} : { profileStorageKey }),
        attemptCount: 0,
        nextAttemptAt: options.now(),
        createdAt: prepared.local.updatedAt,
      });
    } catch (error) {
      if (profileStorageKey !== undefined) {
        await options.outbox.removeUnreferencedProfileSnapshot(
          options.userId,
          operationId,
        );
      }
      throw error;
    }
  };
  const saveLocalOnly = (entry: DiveLogEntry): Promise<DiveLogEntry> =>
    withAccountEntityMutationLock(options.userId, 'log', entry.localId, () =>
      saveLocalOnlyUnlocked(entry),
    );
  const enqueueSaved = (saved: DiveLogEntry): Promise<void> =>
    withAccountEntityMutationLock(options.userId, 'log', saved.localId, () =>
      enqueueSavedUnlocked(saved),
    );
  const reconcileSaved = (saved: DiveLogEntry): Promise<void> =>
    withAccountEntityMutationLock(options.userId, 'log', saved.localId, () =>
      enqueueSavedUnlocked(saved),
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
              operation.entityKind === 'log' && operation.mutation === 'delete',
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
    getWatchProfile: (localId: string) =>
      options.local.getWatchProfile(localId),
    readStoredWatchProfile: (localId: string) =>
      options.local.readStoredWatchProfile(localId),
    importWatchMessages: (
      messages: Parameters<DiveLogRepository['importWatchMessages']>[0],
      importOptions?: Parameters<DiveLogRepository['importWatchMessages']>[1],
    ) => options.local.importWatchMessages(messages, importOptions),
    async save(entry: DiveLogEntry) {
      return withAccountEntityMutationLock(
        options.userId,
        'log',
        entry.localId,
        async () => {
          const saved = await saveLocalOnlyUnlocked(entry);
          await enqueueSavedUnlocked(saved);
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
          if (
            current.remoteId &&
            (current.remoteRevision || hasPendingUpsert)
          ) {
            assertOwnedByUser(current, options.userId);
            await options.outbox.enqueue(
              deleteOperation(
                options.userId,
                'log',
                current,
                toRemoteLog(current, options.userId),
                await deleteBaseRevision(options.outbox, options.userId, 'log', current),
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
    async deleteIf(localId, predicate, deleteOptions) {
      return withAccountEntityMutationLock(
        options.userId,
        'log',
        localId,
        async () => {
          const current = await options.local.get(localId);
          if (!current) {
            return 'notFound';
          }
          if (!predicate(current)) {
            return 'conditionFailed';
          }
          const operations = await options.outbox.listEntity(
            options.userId,
            'log',
            localId,
          );
          if (operations.some(operation => operation.mutation === 'delete')) {
            return 'deleted';
          }
          const hasPendingUpsert = operations.some(
            operation => operation.mutation === 'upsert',
          );
          if (
            current.remoteId &&
            (current.remoteRevision || hasPendingUpsert)
          ) {
            assertOwnedByUser(current, options.userId);
            await options.outbox.enqueue(
              deleteOperation(
                options.userId,
                'log',
                current,
                toRemoteLog(current, options.userId),
                await deleteBaseRevision(options.outbox, options.userId, 'log', current),
                options.now,
              ),
            );
            return 'deleted';
          }
          const result = await options.local.deleteIf(
            localId,
            predicate,
            deleteOptions,
          );
          if (result === 'deleted') {
            await options.outbox.removePendingEntity(
              options.userId,
              'log',
              localId,
            );
          }
          return result;
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
  const enqueueSavedUnlocked = async (saved: DivePlan): Promise<void> => {
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
    if (operations.some(operation => operation.mutation === 'delete')) {
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
      payload: { local: current, remote },
      expectedRevision: current.remoteRevision,
    };
    const operationId = deterministicOperationId(operationIdentity);
    await options.outbox.enqueue({
      operationId,
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
      enqueueSavedUnlocked(saved),
    );
  const reconcileSaved = (saved: DivePlan): Promise<void> =>
    withAccountEntityMutationLock(options.userId, 'plan', saved.localId, () =>
      enqueueSavedUnlocked(saved),
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
          await enqueueSavedUnlocked(saved);
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
          if (
            current.remoteId &&
            (current.remoteRevision || hasPendingUpsert)
          ) {
            assertOwnedByUser(current, options.userId);
            await options.outbox.enqueue(
              deleteOperation(
                options.userId,
                'plan',
                current,
                toRemotePlan(current),
                await deleteBaseRevision(options.outbox, options.userId, 'plan', current),
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
    async deleteIf(localId, predicate) {
      return withAccountEntityMutationLock(
        options.userId,
        'plan',
        localId,
        async () => {
          const current = await options.local.get(localId);
          if (!current) {
            return 'notFound';
          }
          if (!predicate(current)) {
            return 'conditionFailed';
          }
          const operations = await options.outbox.listEntity(
            options.userId,
            'plan',
            localId,
          );
          if (operations.some(operation => operation.mutation === 'delete')) {
            return 'deleted';
          }
          const hasPendingUpsert = operations.some(
            operation => operation.mutation === 'upsert',
          );
          if (
            current.remoteId &&
            (current.remoteRevision || hasPendingUpsert)
          ) {
            assertOwnedByUser(current, options.userId);
            await options.outbox.enqueue(
              deleteOperation(
                options.userId,
                'plan',
                current,
                toRemotePlan(current),
                await deleteBaseRevision(options.outbox, options.userId, 'plan', current),
                options.now,
              ),
            );
            return 'deleted';
          }
          const result = await options.local.deleteIf(localId, predicate);
          if (result === 'deleted') {
            await options.outbox.removePendingEntity(
              options.userId,
              'plan',
              localId,
            );
          }
          return result;
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
    planbook: DivePlanRepository;
  },
): Promise<{
  local: DiveLogEntry;
  remote: RemoteDiveLog;
  serializedProfile?: string;
}> {
  const sourcePlanLocalId = saved.watchCapture
    ? getWatchSessionSourcePlanLocalId(saved.watchCapture.session)
    : undefined;
  const sourcePlan = sourcePlanLocalId
    ? await options.planbook.get(sourcePlanLocalId)
    : undefined;
  if (!saved.watchCapture?.profile) {
    return {
      local: saved,
      remote: toRemoteLog(
        saved,
        options.userId,
        undefined,
        sourcePlan?.remoteId,
      ),
    };
  }

  const storedSamples = await options.local.readStoredWatchProfile(
    saved.localId,
  );
  if (storedSamples === undefined) {
    throw new Error('Local stored watch profile is unavailable');
  }
  let snapshot: ReturnType<typeof createStoredProfileBytesSnapshot>;
  try {
    snapshot = createStoredProfileBytesSnapshot(
      storedSamples,
      {
        localSessionId: saved.watchCapture.session.localSessionId,
        sampleCount: saved.watchCapture.profile.sampleCount,
        sha256: saved.watchCapture.profile.sha256,
        artifactSha256: saved.watchCapture.profile.artifactSha256,
      },
    );
  } catch {
    throw new Error('Local watch profile digest is invalid');
  }
  const normalizedProfile = {
    ...saved.watchCapture.profile,
    sha256: snapshot.sha256,
    ...(snapshot.artifactSha256 === undefined
      ? {}
      : {artifactSha256: snapshot.artifactSha256}),
  };
  const local =
    saved.watchCapture.profile.sha256 === normalizedProfile.sha256 &&
    saved.watchCapture.profile.artifactSha256 ===
      normalizedProfile.artifactSha256
      ? saved
      : {
          ...saved,
          watchCapture: {
            ...saved.watchCapture,
            profile: normalizedProfile,
          },
        };
  if (local !== saved) {
    await options.local.save(local);
  }
  return {
    local,
    remote: toRemoteLog(
      local,
      options.userId,
      snapshot.byteCount,
      sourcePlan?.remoteId,
    ),
    serializedProfile: snapshot.bytes,
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
  const remote = operation.payload.remote as RemoteDiveLog | RemoteDivePlan;
  return `account-operation:${canonicalAccountPayloadSha256({
    userId: operation.userId,
    entityKind: operation.entityKind,
    entityLocalId: operation.entityLocalId,
    mutation: operation.mutation,
    remoteId: remote.id,
    payloadSha256: remote.payloadSha256,
    profilePath: 'profilePath' in remote ? (remote.profilePath ?? null) : null,
  })}`;
}

/**
 * Deleting a row that is already in conflict means the diver saw the other device's version and
 * still chose deletion, so the delete is based on that remote revision instead of the stale one.
 */
async function deleteBaseRevision(
  outbox: AccountOutbox,
  userId: string,
  entityKind: AccountOutboxItem['entityKind'],
  current: DiveLogEntry | DivePlan,
): Promise<number | undefined> {
  if (current.cloudSyncStatus !== 'conflict') {
    return current.remoteRevision;
  }
  const reviewed = (await outbox.listConflicts(userId))
    .filter(
      conflict =>
        conflict.entityKind === entityKind &&
        conflict.entityLocalId === current.localId,
    )
    .sort((left, right) => left.recordedAt - right.recordedAt)
    .at(-1)?.remote.revision;
  return typeof reviewed === 'number' && Number.isSafeInteger(reviewed) && reviewed > 0
    ? reviewed
    : current.remoteRevision;
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
    payload: { local, remote },
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
  sourcePlanId?: string,
): RemoteDiveLog {
  return createAccountRemoteLog(
    entry,
    userId,
    profileByteCount,
    sourcePlanId,
  );
}

function toRemotePlan(plan: DivePlan, convertedLogId?: string): RemoteDivePlan {
  return createAccountRemotePlan(plan, convertedLogId);
}

function isPrincipalSettledAuthState(state: AuthState): boolean {
  return (
    state.status === 'guest' ||
    state.status === 'authenticated' ||
    state.status === 'authenticatedOffline'
  );
}

function principalForAuthState(state: AuthState): DataPrincipal {
  return state.status === 'authenticated' ||
    state.status === 'authenticatedOffline'
    ? { kind: 'user', userId: state.userId }
    : { kind: 'guest' };
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
    scheduleAfterInteractions: task => {
      const handle = InteractionManager.runAfterInteractions(task);
      return {cancel: () => handle.cancel()};
    },
    createId: createUuid,
    now: () => Date.now() / 1_000,
    jitter: Math.random,
    queueWatchSessionDeletion: defaultWatchLink.queueSessionDeletion,
    listWatchSessionDeletionAcknowledgements: defaultWatchLink.listSessionDeletionAcknowledgements,
  };
  return defaultDependencies;
}

function createUuid(): string {
  const randomUuid = (
    globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }
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
