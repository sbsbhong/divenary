import { QueryClient } from '@tanstack/react-query';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type {
  AccountDataRepository,
  GuestClaimRemoteRepository,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import { LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import {
  AccountDataProviderCore as RuntimeAccountDataProviderCore,
  clearPrincipalQueries,
  createAccountLocalFirstRepositories,
  invalidatePrincipalQueries,
  reconcilePendingAccountOperations,
  useAccountData,
} from '../src/states/account-data';
import i18n from '../src/i18n';
import { AccountOutbox } from '../src/sync/account-outbox';
import { AccountSyncCoordinator } from '../src/sync/account-sync-coordinator';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import {
  dataProfileKeyPrefix,
  dataStorageKeys,
} from '../src/storage/data-principal';
import type { PersistentKeyValueStore } from '../src/storage/persistent-key-value-store';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { DivePlan } from '../src/types/dive-plan';
import {GuestClaimService} from '../src/claim/guest-claim-service';
import {
  createGuestClaimSnapshot,
  GuestClaimStore,
} from '../src/claim/guest-claim-store';
import {createWatchProfileDigest} from '../src/utils/watch-profile-digest';
import {createWatchLogDeletionStore} from '../src/deletion/watch-log-deletion-store';

const userId = '00000000-0000-4000-8000-000000000001';
const immediateAfterInteractions = (
  task: () => void | Promise<void>,
): {cancel(): void} => {
  task();
  return {cancel: jest.fn()};
};
const AccountDataProviderCore = (
  props: React.ComponentProps<typeof RuntimeAccountDataProviderCore>,
) => (
  <RuntimeAccountDataProviderCore
    {...props}
    dependencies={{
      ...props.dependencies,
      scheduleAfterInteractions:
        props.dependencies?.scheduleAfterInteractions ??
        immediateAfterInteractions,
    }}
  />
);

const entry: DiveLogEntry = {
  localId: 'local-log-1',
  source: 'manual',
  cloudSyncStatus: 'notConfigured',
  createdAt: 100,
  updatedAt: 100,
  manual: {
    site: { name: 'Local Reef' },
    buddyIds: [],
    gearIds: [],
    tags: [],
    observedMarineLife: [],
    measuredValues: { startedAt: 100 },
  },
  mobile: { mediaPlaceholders: [] },
  provenance: {},
};

const watchEntry: DiveLogEntry = {
  ...entry,
  localId: 'watch-log-1',
  source: 'watch',
  watchCapture: {
    importKey: 'watch-session-1:100',
    importedAt: 110,
    session: {
      localSessionId: 'watch-session-1',
      startedAt: 100,
      samples: [],
    },
    measuredValues: {startedAt: 100},
    samples: [],
    profile: {
      storageKey: 'watch-profile-1',
      contentRevision: 'revision-1',
      sampleCount: 0,
      sha256: 'b'.repeat(64),
      artifactSha256: 'a'.repeat(64),
    },
  },
};

const plan: DivePlan = {
  localId: 'local-plan-1',
  status: 'draft',
  cloudSyncStatus: 'notConfigured',
  createdAt: 100,
  updatedAt: 100,
  site: { name: 'Local Reef' },
  buddyIds: [],
  gearIds: [],
  tags: [],
  plannedValues: {},
  checklistItems: [],
};

describe('account data state', () => {
  beforeEach(async () => {
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  it('routes a mobile Watch-log delete through the durable tombstone coordinator', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const localLogbook = new LocalDiveLogRepository([watchEntry]);
    const queueWatchSessionDeletion = jest.fn().mockResolvedValue(undefined);
    const queryClient = new QueryClient();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{state: {status: 'guest'}}}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope: 'guest',
              logbook: localLogbook,
              planbook: new LocalDivePlanRepository(),
            }),
            queueWatchSessionDeletion,
            scheduleAfterInteractions: immediateAfterInteractions,
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 200,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));

    await capture!.logbookRepository.delete(watchEntry.localId);

    expect(await localLogbook.get(watchEntry.localId)).toBeUndefined();
    expect(
      await createWatchLogDeletionStore({storage: metadataStorage}).get(
        'watch-session-1',
      ),
    ).toMatchObject({sourceLocalIds: [watchEntry.localId]});
    expect(queueWatchSessionDeletion).toHaveBeenCalledWith(
      expect.objectContaining({localSessionId: 'watch-session-1'}),
    );

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('abandons a stale Watch claim from a persisted tombstone before bootstrap resumes it', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const deletedWatchEntry = {
      ...watchEntry,
      watchCapture: {
        ...watchEntry.watchCapture!,
        profile: undefined,
      },
    };
    const guestLogbook = new LocalDiveLogRepository([deletedWatchEntry]);
    const guestPlanbook = new LocalDivePlanRepository();
    const profileStorage = {
      write: jest.fn(async () => undefined),
      read: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    const claimStore = new GuestClaimStore({storage: metadataStorage, userId});
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: guestPlanbook,
      profileStorage,
      now: () => 100,
    });
    const batchId = '10000000-0000-4000-8000-000000000001';
    snapshot.manifest.status = 'failed';
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.errorCode = 'network_unavailable';
    await claimStore.write(snapshot);
    await createWatchLogDeletionStore({storage: metadataStorage}).record({
      localSessionId: 'watch-session-1',
      sourceLocalId: deletedWatchEntry.localId,
      requestedAt: 110,
    });
    await guestLogbook.delete(deletedWatchEntry.localId);

    const remote = guestClaimRepository();
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady={false}
          auth={{
            state: {status: 'authenticated', userId},
            guestClaimRemoteRepository: remote,
          }}
          dependencies={{
            metadataStorage,
            profileStorage,
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook:
                principal.kind === 'guest'
                  ? guestPlanbook
                  : new LocalDivePlanRepository(),
            }),
            queueWatchSessionDeletion: jest.fn(async () => undefined),
            listWatchSessionDeletionAcknowledgements: jest.fn(async () => []),
            createId: () => batchId,
            now: () => 120,
            jitter: () => 0,
          }}
        />,
      );
      await flushPromises();
    });

    await waitFor(() => expect(remote.abandon).toHaveBeenCalledWith(batchId));
    await expect(claimStore.read()).resolves.toBeUndefined();
    expect(remote.finalize).not.toHaveBeenCalledWith(batchId);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('publishes local account rows before scheduling the initial cloud hydration', async () => {
    const localLogbook = new LocalDiveLogRepository([entry]);
    const remote = accountRepository();
    const afterInteractions = controlledAfterInteractionsScheduler();
    const queryClient = new QueryClient();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? new LocalDiveLogRepository()
                  : localLogbook,
              planbook: new LocalDivePlanRepository(),
            }),
            scheduleAfterInteractions: afterInteractions.schedule,
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });

    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));
    await expect(capture!.logbookRepository.list()).resolves.toEqual([entry]);
    expect(remote.listLogs).not.toHaveBeenCalled();
    expect(remote.listPlans).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      await afterInteractions.flush();
    });
    await waitFor(() => expect(remote.listLogs).toHaveBeenCalledTimes(1));
    expect(remote.listPlans).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('starts an explicit cloud refresh immediately while automatic hydration is scheduled', async () => {
    const remote = accountRepository();
    const afterInteractions = controlledAfterInteractionsScheduler();
    const queryClient = new QueryClient();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook: new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            scheduleAfterInteractions: afterInteractions.schedule,
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });

    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));
    expect(remote.listLogs).not.toHaveBeenCalled();
    const refresh = capture!.refreshCloudData();
    await waitFor(() => expect(remote.listLogs).toHaveBeenCalledTimes(1));
    await refresh;

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('settles a cancelled scheduled hydration before an explicit refresh starts immediately', async () => {
    const remote = accountRepository();
    const afterInteractions = controlledAfterInteractionsScheduler();
    const queryClient = new QueryClient();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const auth = {
      state: {status: 'authenticated', userId} as const,
      accountDataRepository: remote,
    };
    const dependencies = {
      metadataStorage: new InMemoryKeyValueStore(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      migrateLegacyData: jest.fn(async () => undefined),
      createRepositories: (principal: {kind: 'guest'} | {kind: 'user'; userId: string}) => ({
        principal,
        queryScope:
          principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`,
        logbook: new LocalDiveLogRepository(),
        planbook: new LocalDivePlanRepository(),
      }),
      scheduleAfterInteractions: afterInteractions.schedule,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
      jitter: () => 0,
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={auth}
          dependencies={dependencies}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));
    expect(afterInteractions.tasks).toHaveLength(1);

    await ReactTestRenderer.act(async () => {
      capture!.retryBootstrap();
      await flushPromises();
      await flushPromises();
    });
    expect(afterInteractions.cancels[0]).toHaveBeenCalledTimes(1);
    await expect(afterInteractions.tasks[0]?.()).resolves.toBeUndefined();
    expect(remote.listLogs).not.toHaveBeenCalled();
    await waitFor(() => expect(afterInteractions.tasks).toHaveLength(2));

    const refresh = capture!.refreshCloudData();
    await waitFor(() => expect(remote.listLogs).toHaveBeenCalledTimes(1));
    await refresh;

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('publishes the selected principal when legacy migration is degraded', async () => {
    const queryClient = new QueryClient();
    const captures: ReturnType<typeof useAccountData>[] = [];
    const Capture = () => {
      captures.push(useAccountData());
      return React.createElement('account-data-child', {testID: 'account-data-child'});
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{state: {status: 'authenticatedOffline', userId}}}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => {
              throw new Error('legacy migration failed');
            }),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook: new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });

    expect(captures.at(-1)).toMatchObject({
      principal: {kind: 'user', userId},
      bootstrap: {
        status: 'degraded',
        issue: {stage: 'legacyMigration', retryable: true},
      },
    });
    expect(renderer!.root.findByProps({testID: 'account-data-child'})).toBeTruthy();

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
  });

  it('renders retryable recovery instead of a blank screen when repository creation fails', async () => {
    const queryClient = new QueryClient();
    const createRepositories = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('local repository unavailable');
      })
      .mockImplementation(principal => ({
        principal,
        queryScope:
          principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`,
        logbook: new LocalDiveLogRepository(),
        planbook: new LocalDivePlanRepository(),
      }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{state: {status: 'guest'}}}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories,
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          {React.createElement('account-data-child', {
            testID: 'account-data-child',
          })}
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });

    const recovery = renderer!.root.findByProps({
      testID: 'account-data-recovery-screen',
    });
    expect(recovery).toBeTruthy();
    expect(new Set(
      renderer!.root
        .findAll(node => node.props.role === 'button')
        .map(node => node.props.testID),
    )).toEqual(new Set(['recovery-retry']));

    await ReactTestRenderer.act(async () => {
      recovery.findByProps({testID: 'recovery-retry'}).props.onPress();
      await flushPromises();
    });
    expect(
      renderer!.root.findByProps({testID: 'account-data-child'}),
    ).toBeTruthy();

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
  });

  it('fails closed before remote hydration when the user logbook is unreadable', async () => {
    const storage = new InMemoryKeyValueStore();
    const userLogbookKey = dataStorageKeys({
      kind: 'user',
      userId,
    }).logbook;
    const invalidRaw = '{"schemaVersion":99,"updatedAt":1,"value":[]}';
    await storage.setString(userLogbookKey, invalidRaw);
    const remote = accountRepository();
    const queryClient = new QueryClient();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: storage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          {React.createElement('account-data-child', {
            testID: 'account-data-child',
          })}
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });

    expect(
      renderer!.root.findByProps({testID: 'account-data-recovery-screen'}),
    ).toBeTruthy();
    expect(remote.listLogs).not.toHaveBeenCalled();
    expect(remote.listPlans).not.toHaveBeenCalled();
    await expect(storage.getString(userLogbookKey)).resolves.toBe(invalidRaw);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
  });

  it('keeps local account data published when remote hydration fails', async () => {
    jest
      .spyOn(AccountSyncCoordinator.prototype, 'hydrate')
      .mockRejectedValueOnce(new Error('remote unavailable'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const afterInteractions = controlledAfterInteractionsScheduler();
    const captures: ReturnType<typeof useAccountData>[] = [];
    const Capture = () => {
      captures.push(useAccountData());
      return React.createElement('account-data-child', {testID: 'account-data-child'});
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: {} as AccountDataRepository,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook: new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            scheduleAfterInteractions: afterInteractions.schedule,
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });

    await waitFor(() =>
      expect(captures.at(-1)?.bootstrap).toEqual({status: 'ready'}),
    );
    await ReactTestRenderer.act(async () => {
      await afterInteractions.flush();
      await flushPromises();
    });
    await waitFor(() =>
      expect(captures.at(-1)?.bootstrap).toEqual({
        status: 'degraded',
        issue: {stage: 'remoteHydration', retryable: true},
      }),
    );
    expect(
      renderer!.root.findByProps({testID: 'account-data-child'}),
    ).toBeTruthy();
    expect(error).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
    error.mockRestore();
    jest.restoreAllMocks();
  });

  it('retries a failed remote hydration on foreground and publishes the recovered cloud rows', async () => {
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener;
        return {remove: jest.fn()};
      });
    const cloudLog = remoteLog({localId: 'cloud-log-after-recovery'});
    const remote = accountRepository({
      listLogs: jest
        .fn()
        .mockRejectedValueOnce(new Error('initial remote unavailable'))
        .mockResolvedValueOnce({items: [cloudLog]}),
    });
    const localLogbook = new LocalDiveLogRepository();
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const afterInteractions = controlledAfterInteractionsScheduler();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? new LocalDiveLogRepository()
                  : localLogbook,
              planbook: new LocalDivePlanRepository(),
            }),
            scheduleAfterInteractions: afterInteractions.schedule,
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));
    await ReactTestRenderer.act(async () => {
      await afterInteractions.flush();
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.bootstrap).toEqual({
        status: 'degraded',
        issue: {stage: 'remoteHydration', retryable: true},
      }),
    );

    await ReactTestRenderer.act(async () => {
      appStateListener?.('background');
      appStateListener?.('active');
      await flushPromises();
    });
    await waitFor(() => expect(remote.listLogs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));
    expect(error).not.toHaveBeenCalled();

    await expect(localLogbook.get(cloudLog.localId)).resolves.toMatchObject({
      localId: cloudLog.localId,
      ownerUserId: userId,
      cloudSyncStatus: 'synced',
    });
    expect(invalidate).toHaveBeenCalledWith({
      predicate: expect.any(Function),
    });

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
    error.mockRestore();
    jest.restoreAllMocks();
  });

  it('coalesces overlapping cloud refresh hydration for one publication', async () => {
    const stalledLogs = deferred<{items: RemoteDiveLog[]}>();
    const remote = accountRepository({
      listLogs: jest
        .fn()
        .mockResolvedValueOnce({items: []})
        .mockImplementation(() => stalledLogs.promise),
    });
    const queryClient = new QueryClient();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook: new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));
    expect(remote.listLogs).toHaveBeenCalledTimes(1);

    let firstRefresh!: Promise<void>;
    let secondRefresh!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      firstRefresh = capture!.refreshCloudData();
      secondRefresh = capture!.refreshCloudData();
      await flushPromises();
    });

    expect(remote.listLogs).toHaveBeenCalledTimes(2);
    stalledLogs.resolve({items: []});
    await ReactTestRenderer.act(async () => {
      await Promise.all([firstRefresh, secondRefresh]);
    });

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('shares the bootstrap hydration with an overlapping explicit cloud refresh', async () => {
    const stalledLogs = deferred<{items: RemoteDiveLog[]}>();
    const remote = accountRepository({
      listLogs: jest.fn(() => stalledLogs.promise),
    });
    const queryClient = new QueryClient();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook: new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(remote.listLogs).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(capture).toBeDefined());

    let refresh!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      refresh = capture!.refreshCloudData();
      await flushPromises();
    });
    const overlappingHydrationCount = remote.listLogs.mock.calls.length;
    stalledLogs.resolve({items: []});
    await ReactTestRenderer.act(async () => {
      await refresh;
      await flushPromises();
    });

    expect(overlappingHydrationCount).toBe(1);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('keeps requestSync push-only without starting a remote hydration', async () => {
    const remote = accountRepository();
    const queryClient = new QueryClient();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook: new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));
    expect(remote.listLogs).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      await capture!.requestSync();
    });

    expect(remote.listLogs).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('does not invalidate scoped queries for a zero-change cloud refresh', async () => {
    const remote = accountRepository();
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook: new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));
    invalidate.mockClear();

    await ReactTestRenderer.act(async () => {
      await capture!.refreshCloudData();
    });

    expect(invalidate).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('publishes partial bootstrap hydration changes before keeping remoteHydration degraded', async () => {
    const validCloudLog = remoteLog({localId: 'partial-bootstrap-log'});
    const malformedCloudLog = remoteLog({
      localId: 'malformed-bootstrap-log',
      payloadSha256: 'not-the-payload-digest',
    });
    const remote = accountRepository({
      listLogs: jest.fn(async () => ({
        items: [validCloudLog, malformedCloudLog],
      })),
    });
    const localLogbook = new LocalDiveLogRepository();
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const afterInteractions = controlledAfterInteractionsScheduler();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? new LocalDiveLogRepository()
                  : localLogbook,
              planbook: new LocalDivePlanRepository(),
            }),
            scheduleAfterInteractions: afterInteractions.schedule,
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.bootstrap).toEqual({status: 'ready'}),
    );
    await ReactTestRenderer.act(async () => {
      await afterInteractions.flush();
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.bootstrap).toEqual({
        status: 'degraded',
        issue: {stage: 'remoteHydration', retryable: true},
      }),
    );

    await expect(localLogbook.get(validCloudLog.localId)).resolves.toBeDefined();
    expect(invalidate).toHaveBeenCalledWith({
      predicate: expect.any(Function),
    });
    expect(error).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
    error.mockRestore();
  });

  it('publishes a missing remote log and clears remoteHydration degradation after a successful cloud refresh', async () => {
    const initiallyHydratedLog = remoteLog({
      localId: 'initially-hydrated-log',
    });
    const malformedCloudLog = remoteLog({
      localId: 'malformed-bootstrap-log',
      payloadSha256: 'not-the-payload-digest',
    });
    const recoveredCloudLog = remoteLog({
      id: '10000000-0000-4000-8000-000000000002',
      localId: 'recovered-cloud-log',
    });
    const remote = accountRepository({
      listLogs: jest
        .fn()
        .mockResolvedValueOnce({
          items: [initiallyHydratedLog, malformedCloudLog],
        })
        .mockResolvedValueOnce({
          items: [initiallyHydratedLog, recoveredCloudLog],
        }),
    });
    const localLogbook = new LocalDiveLogRepository();
    const queryClient = new QueryClient();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const afterInteractions = controlledAfterInteractionsScheduler();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? new LocalDiveLogRepository()
                  : localLogbook,
              planbook: new LocalDivePlanRepository(),
            }),
            scheduleAfterInteractions: afterInteractions.schedule,
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));
    await ReactTestRenderer.act(async () => {
      await afterInteractions.flush();
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.bootstrap).toEqual({
        status: 'degraded',
        issue: {stage: 'remoteHydration', retryable: true},
      }),
    );
    await expect(localLogbook.get(initiallyHydratedLog.localId)).resolves.toBeDefined();
    await expect(localLogbook.get(recoveredCloudLog.localId)).resolves.toBeUndefined();

    await ReactTestRenderer.act(async () => {
      await capture!.refreshCloudData();
    });

    await expect(localLogbook.get(recoveredCloudLog.localId)).resolves.toBeDefined();
    expect(capture?.bootstrap).toEqual({status: 'ready'});
    expect(error).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
    error.mockRestore();
  });

  it('publishes partial explicit hydration changes before keeping remoteHydration degraded', async () => {
    const validCloudLog = remoteLog({localId: 'partial-refresh-log'});
    const malformedCloudLog = remoteLog({
      localId: 'malformed-refresh-log',
      payloadSha256: 'not-the-payload-digest',
    });
    const remote = accountRepository({
      listLogs: jest
        .fn()
        .mockResolvedValueOnce({items: []})
        .mockResolvedValueOnce({
          items: [validCloudLog, malformedCloudLog],
        }),
    });
    const localLogbook = new LocalDiveLogRepository();
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? new LocalDiveLogRepository()
                  : localLogbook,
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.bootstrap).toEqual({status: 'ready'}));
    invalidate.mockClear();

    let refreshError: unknown;
    await ReactTestRenderer.act(async () => {
      try {
        await capture!.refreshCloudData();
      } catch (error) {
        refreshError = error;
      }
      await flushPromises();
    });

    expect(refreshError).toBeDefined();
    await expect(localLogbook.get(validCloudLog.localId)).resolves.toBeDefined();
    expect(invalidate).toHaveBeenCalledWith({
      predicate: expect.any(Function),
    });
    expect(capture?.bootstrap).toEqual({
      status: 'degraded',
      issue: {stage: 'remoteHydration', retryable: true},
    });

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
  });

  it('clears claimInspection degradation after a current claim refresh succeeds', async () => {
    const guestLogbook = new LocalDiveLogRepository();
    jest
      .spyOn(guestLogbook, 'list')
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('guest inventory unavailable'))
      .mockResolvedValue([]);
    const queryClient = new QueryClient();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{state: {status: 'authenticated', userId}}}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.bootstrap).toEqual({
        status: 'degraded',
        issue: {stage: 'claimInspection', retryable: true},
      }),
    );

    await ReactTestRenderer.act(async () => {
      await capture!.claim.refresh();
      await flushPromises();
    });

    expect(capture?.bootstrap).toEqual({status: 'ready'});

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
  });

  it('clears claimInspection degradation after foreground claim inspection succeeds', async () => {
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener;
        return {remove: jest.fn()};
      });
    const guestLogbook = new LocalDiveLogRepository();
    jest
      .spyOn(guestLogbook, 'list')
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('guest inventory unavailable'))
      .mockResolvedValue([]);
    const queryClient = new QueryClient();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{state: {status: 'authenticated', userId}}}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.bootstrap).toEqual({
        status: 'degraded',
        issue: {stage: 'claimInspection', retryable: true},
      }),
    );

    await ReactTestRenderer.act(async () => {
      appStateListener?.('background');
      appStateListener?.('active');
      await flushPromises();
    });

    expect(capture?.bootstrap).toEqual({status: 'ready'});

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
    jest.restoreAllMocks();
  });

  it('keeps claimInspection degraded until checkpoint inspection also succeeds', async () => {
    const appStateDescriptor = Object.getOwnPropertyDescriptor(
      AppState,
      'currentState',
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener;
        return {remove: jest.fn()};
      });
    const guestLogbook = new LocalDiveLogRepository();
    jest
      .spyOn(guestLogbook, 'list')
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('guest inventory unavailable'))
      .mockResolvedValue([]);
    const checkpointHint = jest
      .spyOn(GuestClaimStore.prototype, 'readCheckpointHint')
      .mockResolvedValue({state: 'inactive'});
    const queryClient = new QueryClient();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: accountRepository(),
            guestClaimRemoteRepository: guestClaimRepository(),
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.bootstrap).toEqual({
        status: 'degraded',
        issue: {stage: 'claimInspection', retryable: true},
      }),
    );
    checkpointHint.mockRejectedValueOnce(
      new Error('claim checkpoint unavailable'),
    );

    await ReactTestRenderer.act(async () => {
      appStateListener?.('background');
      appStateListener?.('active');
      await flushPromises();
    });

    expect(capture?.bootstrap).toEqual({
      status: 'degraded',
      issue: {stage: 'claimInspection', retryable: true},
    });

    await ReactTestRenderer.act(async () => {
      appStateListener?.('background');
      appStateListener?.('active');
      await flushPromises();
    });

    expect(capture?.bootstrap).toEqual({status: 'ready'});

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
    jest.restoreAllMocks();
    Object.defineProperty(AppState, 'currentState', appStateDescriptor!);
  });

  it('cancels and removes every previous-principal query before publication', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['diveLogbook', 'user:old-user', 'list'], ['old']);
    queryClient.setQueryData(['divePlans', 'user:old-user', 'list'], ['old']);
    queryClient.setQueryData(['diveLogbook', 'user:new-user', 'list'], ['new']);
    queryClient.setQueryData(['accountSummary', 'user:old-user'], ['keep']);
    queryClient.setQueryData(
      ['other', 'diveLogbook', 'user:old-user'],
      ['keep'],
    );
    const cancelQueries = jest.spyOn(queryClient, 'cancelQueries');

    await clearPrincipalQueries(queryClient, 'user:old-user');

    expect(cancelQueries).toHaveBeenCalledWith({
      predicate: expect.any(Function),
    });
    expect(
      queryClient.getQueryData(['diveLogbook', 'user:old-user', 'list']),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(['divePlans', 'user:old-user', 'list']),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(['diveLogbook', 'user:new-user', 'list']),
    ).toEqual(['new']);
    expect(
      queryClient.getQueryData(['accountSummary', 'user:old-user']),
    ).toEqual(['keep']);
    expect(
      queryClient.getQueryData(['other', 'diveLogbook', 'user:old-user']),
    ).toEqual(['keep']);
    queryClient.clear();
  });

  it('invalidates only the active principal log and plan query roots', async () => {
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidatePrincipalQueries(queryClient, `user:${userId}`);

    const predicate = invalidate.mock.calls[0][0]?.predicate;
    expect(
      predicate?.({
        queryKey: ['diveLogbook', `user:${userId}`, 'list'],
      } as never),
    ).toBe(true);
    expect(
      predicate?.({
        queryKey: ['divePlans', `user:${userId}`, 'detail'],
      } as never),
    ).toBe(true);
    expect(
      predicate?.({ queryKey: ['diveLogbook', 'user:other', 'list'] } as never),
    ).toBe(false);
    expect(
      predicate?.({ queryKey: ['accountSummary', `user:${userId}`] } as never),
    ).toBe(false);
    queryClient.clear();
  });

  it('saves account edits locally as pending before enqueueing and never calls the network directly', async () => {
    const order: string[] = [];
    const localLogbook = new LocalDiveLogRepository();
    const originalSave = localLogbook.save.bind(localLogbook);
    jest.spyOn(localLogbook, 'save').mockImplementation(async value => {
      order.push('local');
      return originalSave(value);
    });
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const originalEnqueue = outbox.enqueue.bind(outbox);
    jest.spyOn(outbox, 'enqueue').mockImplementation(async value => {
      order.push('outbox');
      return originalEnqueue(value);
    });
    const accountRepository = {
      saveLog: jest.fn(),
      savePlan: jest.fn(),
    } as unknown as AccountDataRepository;
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });

    const saved = await repositories.logbook.save(entry);

    expect(order).toEqual(['local', 'outbox']);
    expect(saved).toMatchObject({
      remoteId: '10000000-0000-4000-8000-000000000001',
      ownerUserId: userId,
      cloudSyncStatus: 'pending',
    });
    expect((await outbox.list(userId))[0]).toMatchObject({
      entityKind: 'log',
      entityLocalId: 'local-log-1',
      mutation: 'upsert',
    });
    const [queued] = await outbox.list(userId);
    const remote = queued.payload.remote as RemoteDiveLog;
    expect(Object.keys(remote.payload)).toEqual([
      'source',
      'started_at',
      'ended_at',
      'duration_seconds',
      'max_depth_meters',
      'site_name',
      'title',
      'rating',
      'dive_mode',
      'manual_data',
      'mobile_data',
      'watch_metadata',
      'provenance',
      'profile_preview',
      'profile_content_revision',
      'profile_sha256',
      'profile_byte_count',
      'profile_sample_count',
      'source_plan_id',
    ]);
    expect(remote.payload).toMatchObject({
      ended_at: null,
      duration_seconds: null,
      manual_data: { _local_record: { schemaVersion: 1 } },
      watch_metadata: null,
      source_plan_id: null,
    });
    expect(remote.payloadSha256).toBe(canonicalSha256(remote.payload));
    expect(accountRepository.saveLog).not.toHaveBeenCalled();
  });

  it('keeps guest writes local-only', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const guest = {
      principal: { kind: 'guest' } as const,
      queryScope: 'guest',
      logbook: new LocalDiveLogRepository(),
      planbook: new LocalDivePlanRepository(),
    };

    await guest.logbook.save(entry);

    await expect(guest.logbook.get('local-log-1')).resolves.toEqual(entry);
    await expect(outbox.list()).resolves.toEqual([]);
  });

  it('queues a safe null relation when an account plan references a guest-only log', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const localPlanbook = new LocalDivePlanRepository();
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: {kind: 'user', userId},
        queryScope: `user:${userId}`,
        logbook: new LocalDiveLogRepository(),
        planbook: localPlanbook,
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });
    const relatedPlan: DivePlan = {
      ...plan,
      localId: 'account-plan-with-guest-log',
      status: 'completed',
      convertedLogLocalId: 'guest-only-log',
    };

    await expect(repositories.planbook.save(relatedPlan)).resolves.toMatchObject({
      convertedLogLocalId: 'guest-only-log',
      cloudSyncStatus: 'pending',
    });

    await expect(localPlanbook.get(relatedPlan.localId)).resolves.toMatchObject({
      convertedLogLocalId: 'guest-only-log',
    });
    const [operation] = await outbox.list(userId);
    expect(operation).toMatchObject({
      entityKind: 'plan',
      entityLocalId: relatedPlan.localId,
    });
    expect((operation.payload.remote as RemoteDivePlan).payload).toMatchObject({
      converted_log_id: null,
    });
  });

  it('keeps the device profile key out of the remote watch metadata', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const localLogbook = new LocalDiveLogRepository();
    jest.spyOn(localLogbook, 'readStoredWatchProfile').mockResolvedValue([]);
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });

    const emptyProfileDigest = bytesToHex(
      sha256(utf8ToBytes(JSON.stringify([]))),
    );
    await repositories.logbook.save({
      ...entry,
      source: 'watch',
      watchCapture: {
        importKey: 'watch-1:100',
        importedAt: 100,
        session: { localSessionId: 'watch-1', startedAt: 100, samples: [] },
        measuredValues: { startedAt: 100 },
        samples: [],
        profile: {
          storageKey: 'dive-mobile:watch-profile:user:private-device-key',
          contentRevision: 'revision-1',
          sampleCount: 0,
          sha256: emptyProfileDigest,
        },
      },
    });

    const [queued] = await outbox.list(userId);
    const remote = queued.payload.remote as {
      payload: { watch_metadata: unknown };
    };
    expect(JSON.stringify(remote.payload.watch_metadata)).not.toContain(
      'storageKey',
    );
    expect(remote.payload.watch_metadata).toMatchObject({
      profile: { contentRevision: 'revision-1', sampleCount: 0 },
    });
  });

  it('snapshots exact full profile bytes under an outbox-owned operation key', async () => {
    const storage = new InMemoryKeyValueStore();
    const outbox = new AccountOutbox({ storage, storageKey: 'outbox' });
    const fullSamples = [
      { localSessionId: 'watch-1', timestamp: 100, depthMeters: 2 },
      { localSessionId: 'watch-1', timestamp: 101, depthMeters: 8 },
    ];
    const serialized = JSON.stringify(fullSamples);
    const digest = bytesToHex(sha256(utf8ToBytes(serialized)));
    const localLogbook = new LocalDiveLogRepository();
    jest.spyOn(localLogbook, 'readStoredWatchProfile').mockResolvedValue(fullSamples);
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });

    await repositories.logbook.save({
      ...entry,
      source: 'watch',
      watchCapture: {
        importKey: 'watch-1:100',
        importedAt: 100,
        session: { localSessionId: 'watch-1', startedAt: 100, samples: [] },
        measuredValues: { startedAt: 100 },
        samples: fullSamples.slice(0, 1),
        profile: {
          storageKey: 'device-profile-key',
          contentRevision: 'revision-1',
          sampleCount: 2,
          sha256: digest,
        },
      },
    });

    const [queued] = await outbox.list(userId);
    expect(queued.operationId).toMatch(/^account-operation:/);
    expect(queued.profileStorageKey).toBe(
      `outbox:profile:${encodeURIComponent(userId)}:${encodeURIComponent(
        queued.operationId,
      )}`,
    );
    await expect(outbox.readProfileSnapshot(queued)).resolves.toBe(serialized);
    expect((queued.payload.remote as RemoteDiveLog).payload).toMatchObject({
      profile_sha256: digest,
      profile_sample_count: 2,
      profile_byte_count: utf8ToBytes(serialized).length,
    });
  });

  it('normalizes a marker-less legacy profile digest before saving and enqueueing it', async () => {
    const storage = new InMemoryKeyValueStore();
    const outbox = new AccountOutbox({storage, storageKey: 'outbox'});
    const fullSamples = [
      {localSessionId: 'watch-1', timestamp: 100, depthMeters: 2},
      {localSessionId: 'watch-1', timestamp: 101, depthMeters: 8},
    ];
    const legacyArtifactSha256 = 'a'.repeat(64);
    const profileDigest = createWatchProfileDigest(fullSamples).sha256;
    const localLogbook = new LocalDiveLogRepository();
    jest.spyOn(localLogbook, 'readStoredWatchProfile').mockResolvedValue(fullSamples);
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: {kind: 'user', userId},
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });

    await repositories.logbook.save({
      ...entry,
      source: 'watch',
      watchCapture: {
        importKey: 'watch-1:100',
        importedAt: 100,
        session: {localSessionId: 'watch-1', startedAt: 100, samples: []},
        measuredValues: {startedAt: 100},
        samples: fullSamples.slice(0, 1),
        profile: {
          storageKey: 'device-profile-key',
          contentRevision: 'revision-1',
          sampleCount: fullSamples.length,
          sha256: legacyArtifactSha256,
        },
      },
    });

    await expect(localLogbook.get(entry.localId)).resolves.toMatchObject({
      watchCapture: {
        profile: {
          sha256: profileDigest,
          artifactSha256: legacyArtifactSha256,
        },
      },
    });
    const [queued] = await outbox.list(userId);
    expect((queued.payload.local as DiveLogEntry).watchCapture?.profile).toEqual(
      expect.objectContaining({
        sha256: profileDigest,
        artifactSha256: legacyArtifactSha256,
      }),
    );
    expect((queued.payload.remote as RemoteDiveLog).payload).toMatchObject({
      profile_sha256: profileDigest,
    });
  });

  it('does not enqueue a <=160-sample profile when its stored sidecar is missing', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const preview = Array.from({length: 160}, (_, index) => ({
      localSessionId: 'watch-1',
      timestamp: 100 + index,
      depthMeters: index / 10,
    }));
    const localLogbook = new LocalDiveLogRepository();
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: {kind: 'user', userId},
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });

    await expect(
      repositories.logbook.save({
        ...entry,
        source: 'watch',
        watchCapture: {
          importKey: 'watch-1:100',
          importedAt: 100,
          session: {localSessionId: 'watch-1', startedAt: 100, samples: preview},
          measuredValues: {startedAt: 100},
          samples: preview,
          profile: {
            storageKey: 'missing-sidecar',
            contentRevision: 'revision-1',
            sampleCount: preview.length,
            sha256: createWatchProfileDigest(preview).sha256,
          },
        },
      }),
    ).rejects.toThrow('stored watch profile');

    await expect(outbox.list(userId)).resolves.toEqual([]);
  });

  it('removes an operation-owned profile snapshot when enqueue fails', async () => {
    const storage = new InMemoryKeyValueStore();
    const outbox = new AccountOutbox({storage, storageKey: 'outbox'});
    const fullSamples = [
      {localSessionId: 'watch-1', timestamp: 100, depthMeters: 2},
      {localSessionId: 'watch-1', timestamp: 101, depthMeters: 8},
    ];
    const serialized = JSON.stringify(fullSamples);
    const digest = bytesToHex(sha256(utf8ToBytes(serialized)));
    const localLogbook = new LocalDiveLogRepository();
    jest.spyOn(localLogbook, 'readStoredWatchProfile').mockResolvedValue(fullSamples);
    let rejectedOperationId: string | undefined;
    jest.spyOn(outbox, 'enqueue').mockImplementationOnce(async operation => {
      rejectedOperationId = operation.operationId;
      throw new Error('simulated enqueue failure');
    });
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: {kind: 'user', userId},
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });

    await expect(
      repositories.logbook.save({
        ...entry,
        source: 'watch',
        watchCapture: {
          importKey: 'watch-1:100',
          importedAt: 100,
          session: {localSessionId: 'watch-1', startedAt: 100, samples: []},
          measuredValues: {startedAt: 100},
          samples: fullSamples.slice(0, 1),
          profile: {
            storageKey: 'device-profile-key',
            contentRevision: 'revision-1',
            sampleCount: 2,
            sha256: digest,
          },
        },
      }),
    ).rejects.toThrow('simulated enqueue failure');

    expect(rejectedOperationId).toBeDefined();
    await expect(
      storage.getString(
        outbox.profileSnapshotKey(userId, rejectedOperationId!),
      ),
    ).resolves.toBeUndefined();
    await expect(outbox.list(userId)).resolves.toEqual([]);
  });

  it('fails closed before enqueueing a versioned profile whose immutable digest is wrong', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const localLogbook = new LocalDiveLogRepository();
    jest.spyOn(localLogbook, 'readStoredWatchProfile').mockResolvedValue([
      {localSessionId: 'watch-1', timestamp: 100, depthMeters: 2},
    ]);
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });
    const sample = {
      localSessionId: 'watch-1',
      timestamp: 100,
      depthMeters: 2,
    };

    await expect(
      repositories.logbook.save({
        ...entry,
        source: 'watch',
        watchCapture: {
          importKey: 'watch-1:100',
          importedAt: 100,
          session: { localSessionId: 'watch-1', startedAt: 100, samples: [] },
          measuredValues: { startedAt: 100 },
          samples: [sample],
          profile: {
            storageKey: 'device-profile-key',
            contentRevision: 'revision-1',
            sampleCount: 1,
            sha256: '0'.repeat(64),
            artifactSha256: 'a'.repeat(64),
          },
        },
      }),
    ).rejects.toThrow('digest');

    await expect(outbox.list(userId)).resolves.toEqual([]);
    await expect(localLogbook.get(entry.localId)).resolves.toMatchObject({
      cloudSyncStatus: 'pending',
    });
  });

  it('reconciles a pending local row after an outbox write failure without duplicates', async () => {
    const storage = new FailOnceOutboxStorage('outbox');
    const outbox = new AccountOutbox({ storage, storageKey: 'outbox' });
    const localLogbook = new LocalDiveLogRepository();
    const base = {
      principal: { kind: 'user', userId } as const,
      queryScope: `user:${userId}`,
      logbook: localLogbook,
      planbook: new LocalDivePlanRepository(),
    };
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: base,
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });

    await expect(repositories.logbook.save(entry)).rejects.toThrow(
      'outbox write failed',
    );
    await expect(localLogbook.get(entry.localId)).resolves.toMatchObject({
      cloudSyncStatus: 'pending',
      remoteId: '10000000-0000-4000-8000-000000000001',
    });

    await reconcilePendingAccountOperations({
      userId,
      repositories: base,
      accountRepositories: repositories,
    });
    await reconcilePendingAccountOperations({
      userId,
      repositories: base,
      accountRepositories: repositories,
    });

    await expect(outbox.list(userId)).resolves.toHaveLength(1);
  });

  it('appends and delivers a newer pending log behind its older queued operation', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const localLogbook = new LocalDiveLogRepository();
    const base = {
      principal: { kind: 'user', userId } as const,
      queryScope: `user:${userId}`,
      logbook: localLogbook,
      planbook: new LocalDivePlanRepository(),
    };
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: base,
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });
    await repositories.logbook.save(entry);
    const pending = await localLogbook.get(entry.localId);
    await localLogbook.save({
      ...pending!,
      updatedAt: 200,
      manual: { ...pending!.manual, notes: 'newer crash-recovered edit' },
    });

    await reconcilePendingAccountOperations({
      userId,
      repositories: base,
      accountRepositories: repositories,
    });

    const before = await outbox.listEntity(userId, 'log', entry.localId);
    expect(before).toHaveLength(2);
    expect(before[0].operationId).not.toBe(before[1].operationId);
    const newerOperationId = before[1].operationId;
    const deliveredNotes: Array<string | undefined> = [];
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: accountRepository({
        saveLog: jest.fn(async (value, expectedRevision) => {
          const manualData = value.payload.manual_data as {
            notes?: string;
          };
          deliveredNotes.push(manualData.notes);
          return {
            status: 'saved' as const,
            value: { ...value, revision: (expectedRevision ?? 0) + 1 },
          };
        }),
      }),
      logbookRepository: localLogbook,
      planRepository: base.planbook,
      now: () => 200,
      schedule: () => ({ cancel: jest.fn() }),
    });

    await expect(coordinator.drain({ online: true })).resolves.toMatchObject({
      processed: 1,
      remaining: 1,
    });
    await expect(
      outbox.listEntity(userId, 'log', entry.localId),
    ).resolves.toMatchObject([
      { operationId: newerOperationId, expectedRevision: 1 },
    ]);
    await expect(localLogbook.get(entry.localId)).resolves.toMatchObject({
      cloudSyncStatus: 'pending',
      manual: { notes: 'newer crash-recovered edit' },
    });

    await coordinator.drain({ online: true });
    expect(deliveredNotes).toEqual([undefined, 'newer crash-recovered edit']);
    await expect(outbox.list(userId)).resolves.toEqual([]);
    await expect(localLogbook.get(entry.localId)).resolves.toMatchObject({
      cloudSyncStatus: 'synced',
      remoteRevision: 2,
    });
    coordinator.pause();
  });

  it('appends and delivers a newer pending plan behind its older queued operation', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const localPlanbook = new LocalDivePlanRepository();
    const base = {
      principal: { kind: 'user', userId } as const,
      queryScope: `user:${userId}`,
      logbook: new LocalDiveLogRepository(),
      planbook: localPlanbook,
    };
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: base,
      outbox,
      createId: () => '20000000-0000-4000-8000-000000000001',
      now: () => 100,
    });
    await repositories.planbook.save(plan);
    const pending = await localPlanbook.get(plan.localId);
    await localPlanbook.save({
      ...pending!,
      updatedAt: 200,
      objective: 'newer crash-recovered objective',
    });

    await reconcilePendingAccountOperations({
      userId,
      repositories: base,
      accountRepositories: repositories,
    });

    const before = await outbox.listEntity(userId, 'plan', plan.localId);
    expect(before).toHaveLength(2);
    const firstRemote = before[0].payload.remote as RemoteDivePlan;
    expect(Object.keys(firstRemote.payload)).toEqual([
      'status',
      'planned_at',
      'dive_mode',
      'site_name',
      'plan_data',
      'converted_log_id',
    ]);
    expect(firstRemote.payload).toMatchObject({
      planned_at: null,
      dive_mode: null,
      converted_log_id: null,
      plan_data: { _schemaVersion: 1 },
    });
    expect(firstRemote.payload.plan_data).not.toMatchObject({
      remoteId: expect.anything(),
      ownerUserId: expect.anything(),
      cloudSyncStatus: expect.anything(),
    });
    expect(firstRemote.payloadSha256).toBe(
      canonicalSha256(firstRemote.payload),
    );
    const newerOperationId = before[1].operationId;
    const deliveredObjectives: Array<string | undefined> = [];
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: accountRepository({
        savePlan: jest.fn(async (value, expectedRevision) => {
          const planData = value.payload.plan_data as { objective?: string };
          deliveredObjectives.push(planData.objective);
          return {
            status: 'saved' as const,
            value: { ...value, revision: (expectedRevision ?? 0) + 1 },
          };
        }),
      }),
      logbookRepository: base.logbook,
      planRepository: localPlanbook,
      now: () => 200,
      schedule: () => ({ cancel: jest.fn() }),
    });

    await expect(coordinator.drain({ online: true })).resolves.toMatchObject({
      processed: 1,
      remaining: 1,
    });
    await expect(
      outbox.listEntity(userId, 'plan', plan.localId),
    ).resolves.toMatchObject([
      { operationId: newerOperationId, expectedRevision: 1 },
    ]);
    await expect(localPlanbook.get(plan.localId)).resolves.toMatchObject({
      cloudSyncStatus: 'pending',
      objective: 'newer crash-recovered objective',
    });

    await coordinator.drain({ online: true });
    expect(deliveredObjectives).toEqual([
      undefined,
      'newer crash-recovered objective',
    ]);
    await expect(outbox.list(userId)).resolves.toEqual([]);
    await expect(localPlanbook.get(plan.localId)).resolves.toMatchObject({
      cloudSyncStatus: 'synced',
      remoteRevision: 2,
    });
    coordinator.pause();
  });

  it('persists a remote-delete tombstone before hiding and retains the local row until success', async () => {
    const current = {
      ...entry,
      remoteId: '10000000-0000-4000-8000-000000000001',
      remoteRevision: 2,
      ownerUserId: userId,
      cloudSyncStatus: 'synced' as const,
    };
    const localLogbook = new LocalDiveLogRepository([current]);
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      now: () => 100,
    });

    await repositories.logbook.delete(current.localId);

    await expect(
      repositories.logbook.get(current.localId),
    ).resolves.toBeUndefined();
    await expect(repositories.logbook.list()).resolves.toEqual([]);
    await expect(localLogbook.get(current.localId)).resolves.toEqual(current);
    await expect(outbox.list(userId)).resolves.toMatchObject([
      { mutation: 'delete', expectedRevision: 2 },
    ]);

    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: accountRepository(),
      logbookRepository: localLogbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });
    await coordinator.drain({ online: true });
    await expect(localLogbook.get(current.localId)).resolves.toBeUndefined();
    await expect(outbox.list(userId)).resolves.toEqual([]);
  });

  it('keeps a remote row visible when persisting its delete tombstone fails', async () => {
    const current = {
      ...entry,
      remoteId: '10000000-0000-4000-8000-000000000001',
      remoteRevision: 2,
      ownerUserId: userId,
      cloudSyncStatus: 'synced' as const,
    };
    const localLogbook = new LocalDiveLogRepository([current]);
    const outbox = new AccountOutbox({
      storage: new FailOnceOutboxStorage('outbox'),
      storageKey: 'outbox',
    });
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      now: () => 100,
    });

    await expect(repositories.logbook.delete(current.localId)).rejects.toThrow(
      'outbox write failed',
    );

    await expect(repositories.logbook.get(current.localId)).resolves.toEqual(
      current,
    );
    await expect(localLogbook.get(current.localId)).resolves.toEqual(current);
    await expect(outbox.list(userId)).resolves.toEqual([]);
  });

  it('restores a delete-conflicted current row as visible conflict data', async () => {
    const current = {
      ...entry,
      remoteId: '10000000-0000-4000-8000-000000000001',
      remoteRevision: 2,
      ownerUserId: userId,
      cloudSyncStatus: 'synced' as const,
      manual: { ...entry.manual, notes: 'current local' },
    };
    const localLogbook = new LocalDiveLogRepository([current]);
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
      now: () => 150,
    });
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      now: () => 100,
    });
    await repositories.logbook.delete(current.localId);
    const latest = remoteLog({ revision: 4 });
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: accountRepository({
        deleteLog: jest.fn(async () => ({
          status: 'conflict' as const,
          remote: latest,
        })),
      }),
      logbookRepository: localLogbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });

    await coordinator.drain({ online: true });

    await expect(
      repositories.logbook.get(current.localId),
    ).resolves.toMatchObject({
      cloudSyncStatus: 'conflict',
      manual: { notes: 'current local' },
    });
    await expect(outbox.listConflicts(userId)).resolves.toEqual([
      expect.objectContaining({
        localPayload: { ...current, cloudSyncStatus: 'conflict' },
        remote: latest,
      }),
    ]);
  });

  it('keeps an unsynced local-only deletion local', async () => {
    const localLogbook = new LocalDiveLogRepository([entry]);
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
    });

    await repositories.logbook.delete(entry.localId);

    await expect(localLogbook.get(entry.localId)).resolves.toBeUndefined();
    await expect(outbox.list(userId)).resolves.toEqual([]);
  });

  it('queues an edit against the completed revision when an initial save is in flight', async () => {
    const localLogbook = new LocalDiveLogRepository();
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });
    const initiallySaved = await repositories.logbook.save(entry);
    const saveResult = deferred<ReturnType<AccountDataRepository['saveLog']>>();
    const remote = accountRepository({
      saveLog: jest.fn(() => saveResult.promise.then(value => value)),
    });
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      logbookRepository: localLogbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
      schedule: () => ({ cancel: jest.fn() }),
    });

    const draining = coordinator.drain({ online: true });
    await Promise.resolve();
    const editing = repositories.logbook.save({
      ...initiallySaved,
      updatedAt: 110,
      manual: { ...initiallySaved.manual, notes: 'edited while saving' },
    });
    saveResult.resolve({ status: 'saved', value: remoteLog({ revision: 2 }) });
    await Promise.all([draining, editing]);

    await expect(localLogbook.get(entry.localId)).resolves.toMatchObject({
      remoteRevision: 2,
      cloudSyncStatus: 'pending',
      manual: { notes: 'edited while saving' },
    });
    await expect(outbox.list(userId)).resolves.toMatchObject([
      { mutation: 'upsert', expectedRevision: 2 },
    ]);
  });

  it('queues a delete after an in-flight initial save without resurrecting the row', async () => {
    const localLogbook = new LocalDiveLogRepository();
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });
    await repositories.logbook.save(entry);
    const saveResult = deferred<ReturnType<AccountDataRepository['saveLog']>>();
    const remote = accountRepository({
      saveLog: jest.fn(() => saveResult.promise.then(value => value)),
    });
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      logbookRepository: localLogbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
      schedule: () => ({ cancel: jest.fn() }),
    });

    const draining = coordinator.drain({ online: true });
    await Promise.resolve();
    const deleting = repositories.logbook.delete(entry.localId);
    saveResult.resolve({
      status: 'saved',
      value: remoteLog({ revision: 2 }),
    });
    await Promise.all([draining, deleting]);

    await expect(
      repositories.logbook.get(entry.localId),
    ).resolves.toBeUndefined();
    await expect(localLogbook.get(entry.localId)).resolves.toMatchObject({
      remoteRevision: 2,
      cloudSyncStatus: 'synced',
    });
    await expect(outbox.list(userId)).resolves.toMatchObject([
      { mutation: 'delete', expectedRevision: 2 },
    ]);
  });

  it('invalidates active-principal roots after a provider startup drain changes local state', async () => {
    const pending = {
      ...entry,
      remoteId: '10000000-0000-4000-8000-000000000001',
      ownerUserId: userId,
      cloudSyncStatus: 'pending' as const,
    };
    const remote = accountRepository();
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: { status: 'authenticated', userId },
            accountDataRepository: remote,
          }}
          dependencies={{
            metadataStorage: new InMemoryKeyValueStore(),
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope: `user:${userId}`,
              logbook: new LocalDiveLogRepository([pending]),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}
        />,
      );
      await flushPromises();
    });
    await ReactTestRenderer.act(async () => {
      await waitFor(() => expect(remote.saveLog).toHaveBeenCalled());
      await flushPromises();
    });

    expect(invalidate).toHaveBeenCalled();
    const predicate = invalidate.mock.calls.at(-1)?.[0]?.predicate;
    expect(
      predicate?.({
        queryKey: ['diveLogbook', `user:${userId}`, 'list'],
      } as never),
    ).toBe(true);
    expect(
      predicate?.({ queryKey: ['diveLogbook', 'user:other', 'list'] } as never),
    ).toBe(false);

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('resumes an online account drain when the app returns to the foreground', async () => {
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener;
        return { remove: jest.fn() };
      });
    jest
      .spyOn(AccountSyncCoordinator.prototype, 'hydrate')
      .mockResolvedValue(0);
    const drain = jest
      .spyOn(AccountSyncCoordinator.prototype, 'drain')
      .mockResolvedValue({ processed: 0, remaining: 0 });
    const metadataStorage = new InMemoryKeyValueStore();
    const queryClient = new QueryClient();
    const accountRepository = {} as AccountDataRepository;
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: { status: 'authenticated', userId },
            accountDataRepository: accountRepository,
          }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope: `user:${userId}`,
              logbook: new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}
        />,
      );
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const initialDrainCount = drain.mock.calls.length;
    await ReactTestRenderer.act(async () => {
      appStateListener?.('background');
      appStateListener?.('active');
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(drain).toHaveBeenCalledTimes(initialDrainCount + 1);
    expect(drain).toHaveBeenLastCalledWith({ online: true });

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
    jest.restoreAllMocks();
  });

  it('waits for navigation readiness and blocks remote claim start while offline', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogbook = new LocalDiveLogRepository([entry]);
    const remote = guestClaimRepository();
    const captures: Array<{
      claim: ReturnType<typeof useAccountData>['claim'];
      isOnline: boolean;
    }> = [];
    const Capture = () => {
      const data = useAccountData();
      captures.push({ claim: data.claim, isOnline: data.isOnline });
      return null;
    };
    const dependencies = {
      metadataStorage,
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      migrateLegacyData: jest.fn(async () => undefined),
      createRepositories: jest.fn(principal => ({
        principal,
        queryScope:
          principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`,
        logbook:
          principal.kind === 'guest'
            ? guestLogbook
            : new LocalDiveLogRepository(),
        planbook: new LocalDivePlanRepository(),
      })),
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
      jitter: () => 0,
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady={false}
          auth={{
            state: { status: 'authenticated', userId },
            guestClaimRemoteRepository: remote,
          }}
          dependencies={dependencies}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    expect(captures.at(-1)?.claim).toMatchObject({
      eligible: { logCount: 0, planCount: 0 },
      state: { status: 'hidden' },
    });

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: { status: 'authenticated', userId },
            guestClaimRemoteRepository: remote,
          }}
          dependencies={dependencies}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(captures.at(-1)?.claim).toMatchObject({
        eligible: { logCount: 1, planCount: 0 },
        state: { status: 'choice', logCount: 1, planCount: 0 },
      }),
    );

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: { status: 'authenticatedOffline', userId },
            guestClaimRemoteRepository: remote,
          }}
          dependencies={dependencies}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(captures.at(-1)?.isOnline).toBe(false));
    await ReactTestRenderer.act(async () => {
      await captures.at(-1)?.claim.start();
    });
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('does not read a stale claim snapshot when live guest inventory is empty', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const staleLogs = Array.from({length: 32}, (_, index) => ({
      ...entry,
      localId: `stale-log-${index}`,
    }));
    const staleSnapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: new LocalDiveLogRepository(staleLogs),
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    staleSnapshot.manifest.status = 'deferred';
    await new GuestClaimStore({storage: metadataStorage, userId}).write(
      staleSnapshot,
    );
    const claimStorageKey = dataStorageKeys({kind: 'user', userId}).claim;
    const storageRead = jest.spyOn(metadataStorage, 'getString');
    const guestLogbook = new LocalDiveLogRepository();
    const guestPlanbook = new LocalDivePlanRepository();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{state: {status: 'authenticatedOffline', userId}}}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook:
                principal.kind === 'guest'
                  ? guestPlanbook
                  : new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.claim).toMatchObject({
        eligible: {logCount: 0, planCount: 0},
        state: {status: 'hidden'},
      }),
    );

    const finalClaim = capture!.claim;
    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();

    expect(finalClaim.eligible).toEqual({logCount: 0, planCount: 0});
    expect(finalClaim.state).toEqual({status: 'hidden'});
    expect(storageRead).not.toHaveBeenCalledWith(claimStorageKey);
  });

  it('uses bulk guest inventory instead of per-item reads for a multi-item snapshot', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogs = Array.from({length: 24}, (_, index) => ({
      ...entry,
      localId: `bulk-log-${index}`,
    }));
    const guestPlans = Array.from({length: 8}, (_, index) => ({
      ...plan,
      localId: `bulk-plan-${index}`,
    }));
    const guestLogbook = new LocalDiveLogRepository(guestLogs);
    const guestPlanbook = new LocalDivePlanRepository(guestPlans);
    const profileStorage = {
      write: jest.fn(async () => undefined),
      read: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: guestPlanbook,
      profileStorage,
      now: () => 100,
    });
    snapshot.manifest.status = 'deferred';
    await new GuestClaimStore({storage: metadataStorage, userId}).write(
      snapshot,
    );
    const logGet = jest.spyOn(guestLogbook, 'get');
    const planGet = jest.spyOn(guestPlanbook, 'get');
    profileStorage.read.mockClear();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{state: {status: 'authenticatedOffline', userId}}}
          dependencies={{
            metadataStorage,
            profileStorage,
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook:
                principal.kind === 'guest'
                  ? guestPlanbook
                  : new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.claim).toMatchObject({
        eligible: {logCount: 24, planCount: 8},
        state: {status: 'deferred', logCount: 24, planCount: 8},
      }),
    );

    const finalClaim = capture!.claim;
    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();

    expect(finalClaim.eligible).toEqual({logCount: 24, planCount: 8});
    expect(logGet).not.toHaveBeenCalled();
    expect(planGet).not.toHaveBeenCalled();
    expect(profileStorage.read).not.toHaveBeenCalled();
  });

  it('keeps the latest zero inventory when overlapping refreshes finish out of order', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogbook = new LocalDiveLogRepository([entry]);
    const guestPlanbook = new LocalDivePlanRepository();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{state: {status: 'authenticated', userId}}}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook:
                principal.kind === 'guest'
                  ? guestPlanbook
                  : new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.claim).toMatchObject({
        eligible: {logCount: 1, planCount: 0},
        state: {status: 'choice', logCount: 1, planCount: 0},
      }),
    );

    const staleInventory = deferred<DiveLogEntry[]>();
    const list = jest
      .spyOn(guestLogbook, 'list')
      .mockImplementationOnce(() => staleInventory.promise)
      .mockResolvedValueOnce([]);
    let staleRefresh!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      staleRefresh = capture!.claim.refresh();
      await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    });
    await ReactTestRenderer.act(async () => {
      await capture!.claim.refresh();
    });
    expect(capture?.claim).toMatchObject({
      eligible: {logCount: 0, planCount: 0},
      state: {status: 'hidden'},
    });

    await ReactTestRenderer.act(async () => {
      staleInventory.resolve([entry]);
      await staleRefresh;
    });
    const finalClaim = capture!.claim;
    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();

    expect(finalClaim.eligible).toEqual({logCount: 0, planCount: 0});
    expect(finalClaim.state).toEqual({status: 'hidden'});
  });

  it('keeps a known zero inventory hidden while the same claim service continues in the background', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogbook = new LocalDiveLogRepository([entry]);
    const guestPlanbook = new LocalDivePlanRepository();
    const stalledStage = deferred<{
      stagingRecordId: string;
      targetRecordId: string;
    }>();
    const stalledFinalize = deferred<
      ReturnType<GuestClaimRemoteRepository['finalize']>
    >();
    const remote = guestClaimRepository();
    remote.stageRecord.mockImplementation(() => stalledStage.promise);
    remote.finalize.mockImplementation(() => stalledFinalize.promise);
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    let start!: Promise<void>;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: {status: 'authenticated', userId},
            guestClaimRemoteRepository: remote,
          }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook:
                principal.kind === 'guest'
                  ? guestPlanbook
                  : new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.claim.state).toMatchObject({status: 'choice'}),
    );

    await ReactTestRenderer.act(async () => {
      start = capture!.claim.start();
      await waitFor(() => expect(remote.stageRecord).toHaveBeenCalled());
    });
    await ReactTestRenderer.act(async () => {
      await capture!.logbookRepository.delete(entry.localId);
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.claim).toMatchObject({
        eligible: {logCount: 0, planCount: 0},
        state: {status: 'hidden'},
      }),
    );

    await ReactTestRenderer.act(async () => {
      stalledStage.resolve({
        stagingRecordId: '20000000-0000-4000-8000-000000000001',
        targetRecordId: '30000000-0000-4000-8000-000000000001',
      });
      await waitFor(() => expect(remote.finalize).toHaveBeenCalled());
    });
    const presentationAfterLateCallbacks = capture!.claim;

    stalledFinalize.reject(new Error('finalize failed after local deletion'));
    await ReactTestRenderer.act(async () => {
      await start;
      await flushPromises();
    });
    const finalClaim = capture!.claim;
    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();

    expect(remote.finalize).toHaveBeenCalled();
    expect(presentationAfterLateCallbacks).toMatchObject({
      eligible: {logCount: 0, planCount: 0},
      state: {status: 'hidden'},
    });
    expect(finalClaim).toMatchObject({
      eligible: {logCount: 0, planCount: 0},
      state: {status: 'hidden'},
    });
  });

  it('does not degrade bootstrap when an older resume rejects after a newer zero refresh', async () => {
    const appStateDescriptor = Object.getOwnPropertyDescriptor(
      AppState,
      'currentState',
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogbook = new LocalDiveLogRepository([entry]);
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    snapshot.manifest.status = 'running';
    snapshot.manifest.remoteBatchId =
      '10000000-0000-4000-8000-000000000001';
    await new GuestClaimStore({storage: metadataStorage, userId}).write(
      snapshot,
    );
    const stalledResume =
      deferred<ReturnType<GuestClaimService['resume']>>();
    const resume = jest
      .spyOn(GuestClaimService.prototype, 'resume')
      .mockImplementation(() => stalledResume.promise);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: {status: 'authenticated', userId},
            guestClaimRemoteRepository: guestClaimRepository(),
          }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(resume).toHaveBeenCalled());

    await ReactTestRenderer.act(async () => {
      await capture!.logbookRepository.delete(entry.localId);
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.claim).toMatchObject({
        eligible: {logCount: 0, planCount: 0},
        state: {status: 'hidden'},
      }),
    );

    stalledResume.reject(new Error('stale resume failed'));
    await ReactTestRenderer.act(async () => {
      await flushPromises();
      await flushPromises();
    });
    const finalBootstrap = capture!.bootstrap;
    const finalClaim = capture!.claim;
    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    resume.mockRestore();
    warn.mockRestore();
    Object.defineProperty(AppState, 'currentState', appStateDescriptor!);

    expect(finalBootstrap).toEqual({status: 'ready'});
    expect(finalClaim).toMatchObject({
      eligible: {logCount: 0, planCount: 0},
      state: {status: 'hidden'},
    });
  });

  it('re-enables claim presentation when live inventory becomes nonzero again', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogbook = new LocalDiveLogRepository([entry]);
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{state: {status: 'authenticated', userId}}}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.claim.state).toMatchObject({status: 'choice'}),
    );

    await ReactTestRenderer.act(async () => {
      await capture!.logbookRepository.delete(entry.localId);
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.claim.state).toEqual({status: 'hidden'}),
    );

    await ReactTestRenderer.act(async () => {
      await guestLogbook.save({
        ...entry,
        localId: 'new-live-guest',
      });
      await capture!.claim.refresh();
    });
    await waitFor(() =>
      expect(capture?.claim).toMatchObject({
        eligible: {logCount: 1, planCount: 0},
        state: {status: 'choice', logCount: 1, planCount: 0},
      }),
    );

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('uses an inactive checkpoint hint without reading the full claim at zero inventory', async () => {
    const appStateDescriptor = Object.getOwnPropertyDescriptor(
      AppState,
      'currentState',
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const metadataStorage = new InMemoryKeyValueStore();
    const sourceLogbook = new LocalDiveLogRepository([entry]);
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: sourceLogbook,
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    await new GuestClaimStore({storage: metadataStorage, userId}).write(
      snapshot,
    );
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const storageRead = jest.spyOn(metadataStorage, 'getString');
    const resume = jest.spyOn(GuestClaimService.prototype, 'resume');
    const afterInteractions = controlledAfterInteractionsScheduler();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: {status: 'authenticated', userId},
            guestClaimRemoteRepository: guestClaimRepository(),
          }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook: new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
            scheduleAfterInteractions: afterInteractions.schedule,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
      await flushPromises();
    });
    const finalClaim = capture!.claim;
    const resumeCalls = resume.mock.calls.length;
    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    resume.mockRestore();
    Object.defineProperty(AppState, 'currentState', appStateDescriptor!);

    expect(finalClaim).toMatchObject({
      eligible: {logCount: 0, planCount: 0},
      state: {status: 'hidden'},
    });
    expect(storageRead).toHaveBeenCalledWith(`${claimKey}:checkpoint-hint`);
    expect(storageRead).not.toHaveBeenCalledWith(claimKey);
    expect(resumeCalls).toBe(0);
    expect(afterInteractions.schedule).not.toHaveBeenCalled();
  });

  it.each([
    ['running', {status: 'running'}],
    ['finalizing', {status: 'finalizing'}],
    ['cleanup pending', {status: 'cleanupPending'}],
    [
      'retryable failure',
      {status: 'failed', errorCode: 'network_unavailable'},
    ],
  ] as const)(
    'resumes a %s checkpoint hint at zero inventory without exposing recovery UI',
    async (_name, recovery) => {
      const appStateDescriptor = Object.getOwnPropertyDescriptor(
        AppState,
        'currentState',
      );
      Object.defineProperty(AppState, 'currentState', {
        configurable: true,
        value: 'active',
      });
      const metadataStorage = new InMemoryKeyValueStore();
      const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
      await metadataStorage.setString(
        `${claimKey}:checkpoint-hint`,
        JSON.stringify({
          schemaVersion: 1,
          userId,
          state: 'recoverable',
          ...recovery,
        }),
      );
      const storageRead = jest.spyOn(metadataStorage, 'getString');
      const resume = jest
        .spyOn(GuestClaimService.prototype, 'resume')
        .mockResolvedValue(undefined);
      let capture: ReturnType<typeof useAccountData> | undefined;
      const Capture = () => {
        capture = useAccountData();
        return null;
      };
      const queryClient = new QueryClient();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <AccountDataProviderCore
            queryClient={queryClient}
            navigationReady
            auth={{
              state: {status: 'authenticated', userId},
              guestClaimRemoteRepository: guestClaimRepository(),
            }}
            dependencies={{
              metadataStorage,
              profileStorage: {
                write: jest.fn(async () => undefined),
                read: jest.fn(async () => undefined),
                remove: jest.fn(async () => undefined),
              },
              migrateLegacyData: jest.fn(async () => undefined),
              createRepositories: principal => ({
                principal,
                queryScope:
                  principal.kind === 'guest'
                    ? 'guest'
                    : `user:${principal.userId}`,
                logbook: new LocalDiveLogRepository(),
                planbook: new LocalDivePlanRepository(),
              }),
              createId: () => '10000000-0000-4000-8000-000000000001',
              now: () => 100,
              jitter: () => 0,
            }}>
            <Capture />
          </AccountDataProviderCore>,
        );
        await flushPromises();
        await flushPromises();
      });
      const finalClaim = capture!.claim;
      const healedHint = await new GuestClaimStore({
        storage: metadataStorage,
        userId,
      }).readCheckpointHint();
      const resumeCalls = resume.mock.calls.length;
      await ReactTestRenderer.act(async () => renderer!.unmount());
      queryClient.clear();
      resume.mockRestore();
      Object.defineProperty(AppState, 'currentState', appStateDescriptor!);

      expect(resumeCalls).toBe(1);
      expect(finalClaim).toMatchObject({
        eligible: {logCount: 0, planCount: 0},
        state: {status: 'hidden'},
      });
      expect(storageRead).not.toHaveBeenCalledWith(claimKey);
      expect(healedHint).toEqual({state: 'unknown'});
    },
  );

  it('starts zero-inventory recovery with a fresh token after the same-user claim service changes', async () => {
    const appStateDescriptor = Object.getOwnPropertyDescriptor(
      AppState,
      'currentState',
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const metadataStorage = new InMemoryKeyValueStore();
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    await metadataStorage.setString(
      `${claimKey}:checkpoint-hint`,
      JSON.stringify({
        schemaVersion: 1,
        userId,
        state: 'recoverable',
        status: 'running',
      }),
    );
    const stalledResume =
      deferred<ReturnType<GuestClaimService['resume']>>();
    const resume = jest
      .spyOn(GuestClaimService.prototype, 'resume')
      .mockImplementationOnce(() => stalledResume.promise)
      .mockResolvedValue(undefined);
    const dependencies = {
      metadataStorage,
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      migrateLegacyData: jest.fn(async () => undefined),
      createRepositories: jest.fn(principal => ({
        principal,
        queryScope:
          principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`,
        logbook: new LocalDiveLogRepository(),
        planbook: new LocalDivePlanRepository(),
      })),
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
      jitter: () => 0,
    };
    const queryClient = new QueryClient();
    const firstRemote = guestClaimRepository();
    const secondRemote = guestClaimRepository();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: {status: 'authenticated', userId},
            guestClaimRemoteRepository: firstRemote,
          }}
          dependencies={dependencies}
        />,
      );
      await flushPromises();
      await flushPromises();
    });
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: {status: 'authenticated', userId},
            guestClaimRemoteRepository: secondRemote,
          }}
          dependencies={dependencies}
        />,
      );
      await flushPromises();
      await flushPromises();
    });
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(2));

    stalledResume.resolve(undefined);
    await ReactTestRenderer.act(async () => {
      await flushPromises();
      await new GuestClaimStore({
        storage: metadataStorage,
        userId,
      }).readCheckpointHint();
      await flushPromises();
    });
    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    resume.mockRestore();
    Object.defineProperty(AppState, 'currentState', appStateDescriptor!);
  });

  it.each([
    ['recoverable', 'running', true],
    ['inactive', 'prepared', false],
  ] as const)(
    'defers a legacy %s full checkpoint audit and resumes only when recoverable',
    async (_name, status, shouldResume) => {
      const appStateDescriptor = Object.getOwnPropertyDescriptor(
        AppState,
        'currentState',
      );
      Object.defineProperty(AppState, 'currentState', {
        configurable: true,
        value: 'active',
      });
      const metadataStorage = new InMemoryKeyValueStore();
      const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
      const snapshot = await createGuestClaimSnapshot({
        userId,
        logbookRepository: new LocalDiveLogRepository([entry]),
        planRepository: new LocalDivePlanRepository(),
        profileStorage: {
          write: jest.fn(async () => undefined),
          read: jest.fn(async () => undefined),
          remove: jest.fn(async () => undefined),
        },
        now: () => 100,
      });
      snapshot.manifest.status = status;
      if (status === 'running') {
        snapshot.manifest.remoteBatchId =
          '10000000-0000-4000-8000-000000000001';
      }
      await metadataStorage.setString(claimKey, JSON.stringify(snapshot));
      const storageRead = jest.spyOn(metadataStorage, 'getString');
      const resume = jest
        .spyOn(GuestClaimService.prototype, 'resume')
        .mockResolvedValue(snapshot);
      const afterInteractions = controlledAfterInteractionsScheduler();
      let capture: ReturnType<typeof useAccountData> | undefined;
      const Capture = () => {
        capture = useAccountData();
        return null;
      };
      const queryClient = new QueryClient();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <AccountDataProviderCore
            queryClient={queryClient}
            navigationReady
            auth={{
              state: {status: 'authenticated', userId},
              guestClaimRemoteRepository: guestClaimRepository(),
            }}
            dependencies={{
              metadataStorage,
              profileStorage: {
                write: jest.fn(async () => undefined),
                read: jest.fn(async () => undefined),
                remove: jest.fn(async () => undefined),
              },
              migrateLegacyData: jest.fn(async () => undefined),
              createRepositories: principal => ({
                principal,
                queryScope:
                  principal.kind === 'guest'
                    ? 'guest'
                    : `user:${principal.userId}`,
                logbook: new LocalDiveLogRepository(),
                planbook: new LocalDivePlanRepository(),
              }),
              createId: () => '10000000-0000-4000-8000-000000000001',
              now: () => 100,
              jitter: () => 0,
              scheduleAfterInteractions: afterInteractions.schedule,
            }}>
            <Capture />
          </AccountDataProviderCore>,
        );
        await flushPromises();
        await flushPromises();
      });
      const immediateClaim = capture!.claim;
      const fullReadsBeforeAudit = storageRead.mock.calls.filter(
        ([key]) => key === claimKey,
      ).length;
      const audit = afterInteractions.tasks[0];
      if (audit) {
        await ReactTestRenderer.act(async () => {
          await audit();
          await flushPromises();
        });
      }
      const finalClaim = capture!.claim;
      const finalHint = await new GuestClaimStore({
        storage: metadataStorage,
        userId,
      }).readCheckpointHint();
      const resumeCalls = resume.mock.calls.length;
      await ReactTestRenderer.act(async () => renderer!.unmount());
      queryClient.clear();
      resume.mockRestore();
      Object.defineProperty(AppState, 'currentState', appStateDescriptor!);

      expect(immediateClaim).toMatchObject({
        eligible: {logCount: 0, planCount: 0},
        state: {status: 'hidden'},
      });
      expect(fullReadsBeforeAudit).toBe(0);
      expect(afterInteractions.schedule).toHaveBeenCalledTimes(1);
      expect(resumeCalls).toBe(shouldResume ? 1 : 0);
      expect(finalClaim).toMatchObject({
        eligible: {logCount: 0, planCount: 0},
        state: {status: 'hidden'},
      });
      expect(finalHint.state).toBe(
        shouldResume ? 'recoverable' : 'inactive',
      );
    },
  );

  it.each([
    ['missing snapshot', false],
    ['snapshot read failure', true],
  ] as const)(
    'runs an unknown zero-inventory legacy audit only once per publication after %s',
    async (_scenario, rejectFullRead) => {
    const appStateDescriptor = Object.getOwnPropertyDescriptor(
      AppState,
      'currentState',
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const metadataStorage = new InMemoryKeyValueStore();
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const originalGetString = metadataStorage.getString.bind(metadataStorage);
    const storageRead = jest
      .spyOn(metadataStorage, 'getString')
      .mockImplementation(async key => {
        if (rejectFullRead && key === claimKey) {
          throw new Error('claim snapshot read failed');
        }
        return originalGetString(key);
      });
    const afterInteractions = controlledAfterInteractionsScheduler();
    const queryClient = new QueryClient();
    const remote = guestClaimRepository();
    const authState = {status: 'authenticated', userId} as const;
    const dependencies = {
      metadataStorage,
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      migrateLegacyData: jest.fn(async () => undefined),
      createRepositories: jest.fn(principal => ({
        principal,
        queryScope:
          principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`,
        logbook: new LocalDiveLogRepository(),
        planbook: new LocalDivePlanRepository(),
      })),
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
      jitter: () => 0,
      scheduleAfterInteractions: afterInteractions.schedule,
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: authState,
            guestClaimRemoteRepository: remote,
          }}
          dependencies={dependencies}
        />,
      );
      await flushPromises();
      await flushPromises();
    });
    expect(afterInteractions.schedule).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      await afterInteractions.tasks[0]?.();
      await flushPromises();
      renderer.update(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady={false}
          auth={{
            state: authState,
            guestClaimRemoteRepository: remote,
          }}
          dependencies={dependencies}
        />,
      );
      await flushPromises();
    });
    await ReactTestRenderer.act(async () => {
      renderer.update(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: authState,
            guestClaimRemoteRepository: remote,
          }}
          dependencies={dependencies}
        />,
      );
      await flushPromises();
    });

    const fullClaimReads = storageRead.mock.calls.filter(
      ([key]) => key === claimKey,
    ).length;
    expect(afterInteractions.schedule).toHaveBeenCalledTimes(1);
    expect(fullClaimReads).toBe(1);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    Object.defineProperty(AppState, 'currentState', appStateDescriptor!);
    },
  );

  it('ignores a deferred legacy audit after a later nonzero refresh', async () => {
    const appStateDescriptor = Object.getOwnPropertyDescriptor(
      AppState,
      'currentState',
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const metadataStorage = new InMemoryKeyValueStore();
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: new LocalDiveLogRepository([entry]),
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    snapshot.manifest.status = 'running';
    snapshot.manifest.remoteBatchId =
      '10000000-0000-4000-8000-000000000001';
    await metadataStorage.setString(claimKey, JSON.stringify(snapshot));
    const guestLogbook = new LocalDiveLogRepository();
    const resume = jest.spyOn(GuestClaimService.prototype, 'resume');
    const afterInteractions = controlledAfterInteractionsScheduler();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: {status: 'authenticated', userId},
            guestClaimRemoteRepository: guestClaimRepository(),
          }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
            scheduleAfterInteractions: afterInteractions.schedule,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
      await flushPromises();
    });
    await guestLogbook.save({...entry, localId: 'later-live-guest'});
    await ReactTestRenderer.act(async () => {
      await capture!.claim.refresh();
    });
    const presentationBeforeAudit = capture!.claim;
    const audit = afterInteractions.tasks[0];
    if (audit) {
      await ReactTestRenderer.act(async () => {
        await audit();
        await flushPromises();
      });
    }
    const finalClaim = capture!.claim;
    const resumeCalls = resume.mock.calls.length;
    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    resume.mockRestore();
    Object.defineProperty(AppState, 'currentState', appStateDescriptor!);

    expect(afterInteractions.schedule).toHaveBeenCalledTimes(1);
    expect(presentationBeforeAudit).toMatchObject({
      eligible: {logCount: 1, planCount: 0},
      state: {status: 'running'},
    });
    expect(resumeCalls).toBe(0);
    expect(finalClaim).toEqual(presentationBeforeAudit);
  });

  it('cancels and ignores a deferred legacy audit after the principal changes', async () => {
    const appStateDescriptor = Object.getOwnPropertyDescriptor(
      AppState,
      'currentState',
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const metadataStorage = new InMemoryKeyValueStore();
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: new LocalDiveLogRepository([entry]),
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    snapshot.manifest.status = 'running';
    snapshot.manifest.remoteBatchId =
      '10000000-0000-4000-8000-000000000001';
    await metadataStorage.setString(claimKey, JSON.stringify(snapshot));
    const storageRead = jest.spyOn(metadataStorage, 'getString');
    const resume = jest.spyOn(GuestClaimService.prototype, 'resume');
    const afterInteractions = controlledAfterInteractionsScheduler();
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const dependencies = {
      metadataStorage,
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      migrateLegacyData: jest.fn(async () => undefined),
      createRepositories: jest.fn(principal => ({
        principal,
        queryScope:
          principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`,
        logbook: new LocalDiveLogRepository(),
        planbook: new LocalDivePlanRepository(),
      })),
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
      jitter: () => 0,
      scheduleAfterInteractions: afterInteractions.schedule,
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: {status: 'authenticated', userId},
            guestClaimRemoteRepository: guestClaimRepository(),
          }}
          dependencies={dependencies}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
      await flushPromises();
    });
    const audit = afterInteractions.tasks[0];

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{state: {status: 'guest'}}}
          dependencies={dependencies}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    if (audit) {
      await ReactTestRenderer.act(async () => {
        await audit();
        await flushPromises();
      });
    }
    const finalPrincipal = capture!.principal;
    const fullClaimReads = storageRead.mock.calls.filter(
      ([key]) => key === claimKey,
    ).length;
    const resumeCalls = resume.mock.calls.length;
    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    resume.mockRestore();
    Object.defineProperty(AppState, 'currentState', appStateDescriptor!);

    expect(afterInteractions.schedule).toHaveBeenCalledTimes(1);
    expect(afterInteractions.cancels[0]).toHaveBeenCalledTimes(1);
    expect(fullClaimReads).toBe(0);
    expect(resumeCalls).toBe(0);
    expect(finalPrincipal).toEqual({kind: 'guest'});
  });

  it('publishes retained profile items without remote work or an automatic retry loop', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const profileLog: DiveLogEntry = {
      ...entry,
      localId: 'profile-log',
      source: 'watch',
      watchCapture: {
        importKey: 'watch:profile-log',
        importedAt: 100,
        session: {
          localSessionId: 'session-profile-log',
          startedAt: 100,
          samples: [],
        },
        measuredValues: { startedAt: 100 },
        samples: [],
        profile: {
          storageKey: `${dataProfileKeyPrefix({
            kind: 'guest',
          })}session-profile-log:revision-1`,
          contentRevision: 'revision-1',
          sampleCount: 1,
        },
      },
    };
    const remote = guestClaimRepository();
    const guestLogbook = new LocalDiveLogRepository([profileLog]);
    const profileStorage = {
      write: jest.fn(async () => undefined),
      read: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    const captures: ReturnType<typeof useAccountData>['claim'][] = [];
    const Capture = () => {
      captures.push(useAccountData().claim);
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: { status: 'authenticated', userId },
            guestClaimRemoteRepository: remote,
          }}
          dependencies={{
            metadataStorage,
            profileStorage,
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(captures.at(-1)?.state.status).toBe('choice'));

    await ReactTestRenderer.act(async () => {
      await expect(captures.at(-1)!.start()).resolves.toBeUndefined();
    });
    await waitFor(() =>
      expect(captures.at(-1)?.state).toMatchObject({
        status: 'retained',
        retainedItems: [{
          entityKind: 'log',
          clientRecordId: 'profile-log',
          label: 'Local Reef',
          reason: 'profile_missing',
        }],
      }),
    );
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      await captures.at(-1)!.recheckRetained();
    });
    await waitFor(() =>
      expect(captures.at(-1)?.state.status).toBe('retained'),
    );
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();

    profileStorage.read.mockRejectedValueOnce(
      new Error('profile storage temporarily unavailable'),
    );
    await ReactTestRenderer.act(async () => {
      await captures.at(-1)!.recheckRetained();
    });
    await waitFor(() =>
      expect(captures.at(-1)?.state.status).toBe('retained'),
    );
    expect(captures.at(-1)?.eligible).toEqual({ logCount: 1, planCount: 0 });
    await expect(guestLogbook.get('profile-log')).resolves.toBeDefined();

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('keeps deferred guest rows ahead of same-id account copies', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogbook = new LocalDiveLogRepository([
      entry,
      { ...entry, localId: 'guest-only-log' },
    ]);
    const guestPlanbook = new LocalDivePlanRepository([plan]);
    const store = new GuestClaimStore({ storage: metadataStorage, userId });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: guestPlanbook,
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    snapshot.manifest.status = 'deferred';
    await store.write(snapshot);
    const accountLog = {
      ...entry,
      ownerUserId: userId,
      remoteId: '10000000-0000-4000-8000-000000000001',
      remoteRevision: 1,
      cloudSyncStatus: 'synced' as const,
      manual: { ...entry.manual, title: 'account copy' },
    };
    let capture:
      | {
          rows: DiveLogEntry[];
          eligible: { logCount: number; planCount: number };
          state: ReturnType<typeof useAccountData>['claim']['state'];
        }
      | undefined;
    const Capture = () => {
      const data = useAccountData();
      React.useEffect(() => {
        data.logbookRepository.list().then(rows => {
          capture = {
            rows,
            eligible: data.claim.eligible,
            state: data.claim.state,
          };
        });
      }, [data]);
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{ state: { status: 'authenticated', userId } }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository([accountLog]),
              planbook:
                principal.kind === 'guest'
                  ? guestPlanbook
                  : new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.eligible).toEqual({ logCount: 2, planCount: 1 }),
    );
    const result = capture!;

    expect(result.rows.map(row => row.localId)).toEqual([
      'local-log-1',
      'guest-only-log',
    ]);
    expect(result.rows[0]?.manual.title).toBeUndefined();
    expect(result.rows[0]?.ownerUserId).toBeUndefined();
    expect(result.rows[1]?.ownerUserId).toBeUndefined();
    expect(result.eligible).toEqual({ logCount: 2, planCount: 1 });
    expect(result.state).toEqual({
      status: 'deferred',
      logCount: 2,
      planCount: 1,
    });

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('caches historical Watch lookup per publication and invalidates it after a live guest mutation', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const historicalArtifactSha256 = 'a'.repeat(64);
    const historicalSamples: NonNullable<
      DiveLogEntry['watchCapture']
    >['samples'] = [];
    const historicalEntry: DiveLogEntry = {
      ...entry,
      localId: 'historical-watch-log',
      source: 'watch',
      watchCapture: {
        importKey: 'historical-watch-session:100',
        importedAt: 100,
        session: {
          localSessionId: 'historical-watch-session',
          startedAt: 100,
          samples: historicalSamples,
        },
        measuredValues: {startedAt: 100},
        samples: historicalSamples,
        profile: {
          storageKey: `${dataProfileKeyPrefix({
            kind: 'guest',
          })}historical-watch-session:revision-1`,
          contentRevision: 'revision-1',
          sampleCount: 0,
          sha256: createWatchProfileDigest(historicalSamples).sha256,
          artifactSha256: historicalArtifactSha256,
        },
      },
    };
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: new LocalDiveLogRepository([historicalEntry]),
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => historicalSamples),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    const identity = {
      localSessionId: 'historical-watch-session',
      contentRevision: 'revision-1',
      artifactSha256: historicalArtifactSha256,
    };
    snapshot.manifest.status = 'committed';
    snapshot.manifest.remoteBatchId =
      '10000000-0000-4000-8000-000000000001';
    snapshot.manifest.items = snapshot.manifest.items.map((item, index) => ({
      ...item,
      stagingRecordId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      targetRecordId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      completedAt: 101,
    }));
    snapshot.snapshots = [];
    snapshot.historicalArtifacts = [identity];
    const store = new GuestClaimStore({storage: metadataStorage, userId});
    await store.write(snapshot);
    const liveGuest = {...entry, localId: 'live-guest-log'};
    const guestLogbook = new LocalDiveLogRepository([liveGuest]);
    const guestList = jest.spyOn(guestLogbook, 'list');
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const storageRead = jest.spyOn(metadataStorage, 'getString');
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{state: {status: 'authenticatedOffline', userId}}}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => historicalSamples),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.isHydrated).toBe(true));
    guestList.mockClear();
    storageRead.mockClear();

    await expect(capture!.isHistoricalWatchArtifact(identity)).resolves.toBe(
      true,
    );
    await expect(capture!.isHistoricalWatchArtifact(identity)).resolves.toBe(
      true,
    );
    expect(guestList).toHaveBeenCalledTimes(1);
    expect(
      storageRead.mock.calls.filter(([key]) => key === claimKey),
    ).toHaveLength(1);

    await ReactTestRenderer.act(async () => {
      await capture!.logbookRepository.delete(liveGuest.localId);
      await flushPromises();
    });
    const guestReadsAfterMutation = guestList.mock.calls.length;
    const claimReadsAfterMutation = storageRead.mock.calls.filter(
      ([key]) => key === claimKey,
    ).length;
    guestList.mockRejectedValueOnce(
      new Error('guest inventory temporarily unavailable'),
    );
    await expect(
      capture!.isHistoricalWatchArtifact(identity),
    ).rejects.toThrow('guest inventory temporarily unavailable');
    const guestReadsAfterFailure = guestList.mock.calls.length;
    await expect(capture!.isHistoricalWatchArtifact(identity)).resolves.toBe(
      true,
    );
    expect(guestReadsAfterFailure).toBe(guestReadsAfterMutation + 1);
    expect(guestList).toHaveBeenCalledTimes(guestReadsAfterFailure + 1);
    expect(
      storageRead.mock.calls.filter(([key]) => key === claimKey),
    ).toHaveLength(claimReadsAfterMutation + 1);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('retries an in-flight historical lookup invalidated by a live guest mutation', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const historicalArtifactSha256 = 'a'.repeat(64);
    const historicalSamples: NonNullable<
      DiveLogEntry['watchCapture']
    >['samples'] = [];
    const historicalEntry: DiveLogEntry = {
      ...entry,
      localId: 'historical-watch-log',
      source: 'watch',
      watchCapture: {
        importKey: 'historical-watch-session:100',
        importedAt: 100,
        session: {
          localSessionId: 'historical-watch-session',
          startedAt: 100,
          samples: historicalSamples,
        },
        measuredValues: {startedAt: 100},
        samples: historicalSamples,
        profile: {
          storageKey: `${dataProfileKeyPrefix({
            kind: 'guest',
          })}historical-watch-session:revision-1`,
          contentRevision: 'revision-1',
          sampleCount: 0,
          sha256: createWatchProfileDigest(historicalSamples).sha256,
          artifactSha256: historicalArtifactSha256,
        },
      },
    };
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: new LocalDiveLogRepository([historicalEntry]),
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => historicalSamples),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    snapshot.manifest.status = 'failed';
    snapshot.errorCode = 'claim_validation_failed';
    await new GuestClaimStore({storage: metadataStorage, userId}).write(
      snapshot,
    );
    const liveGuest = {...entry, localId: 'live-guest-log'};
    const guestLogbook = new LocalDiveLogRepository([liveGuest]);
    const guestList = jest.spyOn(guestLogbook, 'list');
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{state: {status: 'authenticatedOffline', userId}}}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => historicalSamples),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.isHydrated).toBe(true));
    guestList.mockClear();
    const staleInventory = deferred<DiveLogEntry[]>();
    guestList.mockImplementationOnce(() => staleInventory.promise);
    const identity = {
      localSessionId: 'historical-watch-session',
      contentRevision: 'revision-1',
      artifactSha256: historicalArtifactSha256,
    };
    const lookup = capture!.isHistoricalWatchArtifact(identity);
    await waitFor(() => expect(guestList).toHaveBeenCalledTimes(1));

    await guestLogbook.save(historicalEntry);
    await ReactTestRenderer.act(async () => {
      await capture!.logbookRepository.delete(liveGuest.localId);
      await flushPromises();
    });
    staleInventory.resolve([liveGuest]);

    await expect(lookup).resolves.toBe(false);
    expect(guestList.mock.calls.length).toBeGreaterThan(1);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('invalidates historical Watch lookup when the claim snapshot changes', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const historicalArtifactSha256 = 'a'.repeat(64);
    const historicalSamples: NonNullable<
      DiveLogEntry['watchCapture']
    >['samples'] = [];
    const historicalEntry: DiveLogEntry = {
      ...entry,
      localId: 'historical-watch-log',
      source: 'watch',
      watchCapture: {
        importKey: 'historical-watch-session:100',
        importedAt: 100,
        session: {
          localSessionId: 'historical-watch-session',
          startedAt: 100,
          samples: historicalSamples,
        },
        measuredValues: {startedAt: 100},
        samples: historicalSamples,
        profile: {
          storageKey: `${dataProfileKeyPrefix({
            kind: 'guest',
          })}historical-watch-session:revision-1`,
          contentRevision: 'revision-1',
          sampleCount: 0,
          sha256: createWatchProfileDigest(historicalSamples).sha256,
          artifactSha256: historicalArtifactSha256,
        },
      },
    };
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: new LocalDiveLogRepository([historicalEntry]),
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => historicalSamples),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    snapshot.manifest.status = 'failed';
    snapshot.errorCode = 'claim_validation_failed';
    await new GuestClaimStore({storage: metadataStorage, userId}).write(
      snapshot,
    );
    const guestLogbook = new LocalDiveLogRepository([
      {...entry, localId: 'live-guest-log'},
    ]);
    const guestList = jest.spyOn(guestLogbook, 'list');
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: {status: 'authenticated', userId},
            guestClaimRemoteRepository: guestClaimRepository(),
          }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => historicalSamples),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.isHydrated).toBe(true));
    guestList.mockClear();
    const identity = {
      localSessionId: 'historical-watch-session',
      contentRevision: 'revision-1',
      artifactSha256: historicalArtifactSha256,
    };
    await expect(capture!.isHistoricalWatchArtifact(identity)).resolves.toBe(
      true,
    );

    await ReactTestRenderer.act(async () => {
      await capture!.claim.keepOnDevice();
      await flushPromises();
    });
    const readsAfterSnapshotChange = guestList.mock.calls.length;
    await expect(capture!.isHistoricalWatchArtifact(identity)).resolves.toBe(
      true,
    );
    expect(guestList).toHaveBeenCalledTimes(readsAfterSnapshotChange + 1);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('refreshes live claim eligibility after deleting the final deferred guest row', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogbook = new LocalDiveLogRepository([entry]);
    const guestPlanbook = new LocalDivePlanRepository();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new GuestClaimStore({storage: metadataStorage, userId});
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: guestPlanbook,
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    snapshot.manifest.status = 'deferred';
    await store.write(snapshot);
    let capture: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      capture = useAccountData();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{state: {status: 'authenticatedOffline', userId}}}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository(),
              planbook:
                principal.kind === 'guest'
                  ? guestPlanbook
                  : new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.claim.eligible).toEqual({logCount: 1, planCount: 0}),
    );

    jest
      .spyOn(guestLogbook, 'list')
      .mockRejectedValueOnce(new Error('guest inventory unavailable'));
    await ReactTestRenderer.act(async () => {
      await capture!.logbookRepository.save({...entry, updatedAt: 101});
      await flushPromises();
    });

    await waitFor(() => {
      expect(capture?.claim.eligible).toEqual({logCount: 0, planCount: 0});
      expect(capture?.claim.state).toEqual({status: 'hidden'});
    });

    await ReactTestRenderer.act(async () => {
      await capture!.logbookRepository.delete(entry.localId);
      await flushPromises();
    });

    await waitFor(() => {
      expect(capture?.claim.eligible).toEqual({logCount: 0, planCount: 0});
      expect(capture?.claim.state).toEqual({status: 'hidden'});
    });
    await expect(guestLogbook.list()).resolves.toEqual([]);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
    warn.mockRestore();
  });

  it('keeps guest rows ahead of partial account copies until the claim is published', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestEntry = {
      ...entry,
      manual: { ...entry.manual, title: 'guest snapshot' },
    };
    const guestLogbook = new LocalDiveLogRepository([guestEntry]);
    const store = new GuestClaimStore({ storage: metadataStorage, userId });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    snapshot.manifest.status = 'failed';
    snapshot.manifest.remoteBatchId = '10000000-0000-4000-8000-000000000001';
    snapshot.manifest.items[0] = {
      ...snapshot.manifest.items[0]!,
      stagingRecordId: '20000000-0000-4000-8000-000000000001',
      targetRecordId: '30000000-0000-4000-8000-000000000001',
      completedAt: 101,
    };
    snapshot.manifest.updatedAt = 101;
    snapshot.errorCode = 'claim_validation_failed';
    await store.write(snapshot);
    const accountCopy = {
      ...guestEntry,
      ownerUserId: userId,
      remoteId: '30000000-0000-4000-8000-000000000001',
      remoteRevision: 1,
      cloudSyncStatus: 'synced' as const,
      manual: { ...guestEntry.manual, title: 'partial account copy' },
    };
    let rows: DiveLogEntry[] = [];
    const Capture = () => {
      const data = useAccountData();
      React.useEffect(() => {
        data.logbookRepository.list().then(value => {
          rows = value;
        });
      }, [data]);
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{ state: { status: 'authenticatedOffline', userId } }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository([accountCopy]),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(rows).toHaveLength(1));

    expect(rows[0]?.manual.title).toBe('guest snapshot');
    expect(rows[0]?.ownerUserId).toBeUndefined();

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('shows a changed same-id guest after commit while an unchanged claim keeps account precedence', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const snapshotGuest = {
      ...entry,
      manual: { ...entry.manual, title: 'snapshot guest' },
    };
    const changedGuest = {
      ...snapshotGuest,
      updatedAt: snapshotGuest.updatedAt + 1,
      manual: { ...snapshotGuest.manual, title: 'changed after snapshot' },
    };
    const guestLogbook = new LocalDiveLogRepository([changedGuest]);
    const store = new GuestClaimStore({ storage: metadataStorage, userId });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: new LocalDiveLogRepository([snapshotGuest]),
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    snapshot.manifest.status = 'cleanupPending';
    snapshot.manifest.remoteBatchId = '10000000-0000-4000-8000-000000000001';
    snapshot.manifest.items[0] = {
      ...snapshot.manifest.items[0]!,
      stagingRecordId: '20000000-0000-4000-8000-000000000001',
      targetRecordId: '30000000-0000-4000-8000-000000000001',
      completedAt: 101,
    };
    snapshot.manifest.updatedAt = 101;
    await store.write(snapshot);
    const accountCopy = {
      ...snapshotGuest,
      ownerUserId: userId,
      remoteId: '30000000-0000-4000-8000-000000000001',
      remoteRevision: 1,
      cloudSyncStatus: 'synced' as const,
      manual: { ...snapshotGuest.manual, title: 'account snapshot copy' },
    };
    let capture:
      | {
          rows: DiveLogEntry[];
          eligible: { logCount: number; planCount: number };
        }
      | undefined;
    const Capture = () => {
      const data = useAccountData();
      React.useEffect(() => {
        data.logbookRepository.list().then(rows => {
          capture = { rows, eligible: data.claim.eligible };
        });
      }, [data]);
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{ state: { status: 'authenticatedOffline', userId } }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository([accountCopy]),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(capture?.rows).toHaveLength(1));

    expect(capture?.rows[0]?.manual.title).toBe('changed after snapshot');
    expect(capture?.rows[0]?.ownerUserId).toBeUndefined();
    expect(capture?.eligible).toEqual({ logCount: 1, planCount: 0 });

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('ignores a stale same-user claim callback after repository generation changes', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogbook = new LocalDiveLogRepository([entry]);
    const stalledStage = deferred<{
      stagingRecordId: string;
      targetRecordId: string;
    }>();
    const oldRemote = guestClaimRepository();
    oldRemote.stageRecord.mockImplementation(() => stalledStage.promise);
    const newRemote = guestClaimRepository();
    const captures: ReturnType<typeof useAccountData>['claim'][] = [];
    const Capture = () => {
      captures.push(useAccountData().claim);
      return null;
    };
    const dependencies = {
      metadataStorage,
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      migrateLegacyData: jest.fn(async () => undefined),
      createRepositories: jest.fn(principal => ({
        principal,
        queryScope:
          principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`,
        logbook:
          principal.kind === 'guest'
            ? guestLogbook
            : new LocalDiveLogRepository(),
        planbook: new LocalDivePlanRepository(),
      })),
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
      jitter: () => 0,
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    let oldStart: Promise<void>;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: { status: 'authenticated', userId },
            guestClaimRemoteRepository: oldRemote,
          }}
          dependencies={dependencies}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(captures.at(-1)?.state.status).toBe('choice'));
    await ReactTestRenderer.act(async () => {
      oldStart = captures.at(-1)!.start();
      await waitFor(() => expect(oldRemote.stageRecord).toHaveBeenCalled());
    });

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady={false}
          auth={{
            state: { status: 'authenticated', userId },
            guestClaimRemoteRepository: newRemote,
          }}
          dependencies={dependencies}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() => expect(captures.at(-1)?.state.status).toBe('hidden'));

    stalledStage.reject(new Error('stale repository failed'));
    await ReactTestRenderer.act(async () => {
      await oldStart!;
      await flushPromises();
    });

    expect(captures.at(-1)?.state.status).toBe('hidden');

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('automatically resumes a transient failure with the same durable batch', async () => {
    const appStateDescriptor = Object.getOwnPropertyDescriptor(
      AppState,
      'currentState',
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogbook = new LocalDiveLogRepository([entry]);
    const accountLogbook = new LocalDiveLogRepository();
    const store = new GuestClaimStore({ storage: metadataStorage, userId });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: new LocalDivePlanRepository(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    const batchId = '10000000-0000-4000-8000-000000000001';
    const targetRecordId = '30000000-0000-4000-8000-000000000001';
    snapshot.manifest.status = 'failed';
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.errorCode = 'network_unavailable';
    snapshot.manifest.updatedAt = 101;
    await store.write(snapshot);

    const remote = guestClaimRepository();
    remote.finalize.mockResolvedValue({
      status: 'committed',
      planCount: 0,
      logCount: 1,
    });
    remote.listCommittedBatch.mockResolvedValue({
      plans: [],
      logs: [
        {
          id: targetRecordId,
          localId: entry.localId,
          revision: 1,
          payloadSha256: snapshot.manifest.items[0]!.payloadSha256,
          payload: JSON.parse(snapshot.snapshots[0]!.payloadBytes),
        },
      ],
    });
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: { status: 'authenticated', userId },
            guestClaimRemoteRepository: remote,
          }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest' ? guestLogbook : accountLogbook,
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => batchId,
            now: () => 102,
            jitter: () => 0,
          }}
        />,
      );
      await flushPromises();
    });
    await waitFor(() => expect(remote.finalize).toHaveBeenCalledWith(batchId));
    await flushPromises();
    await expect(store.read()).resolves.toMatchObject({
      manifest: { status: 'committed' },
    });

    expect(remote.createOrLoadBatch).toHaveBeenCalledWith(
      expect.objectContaining({ clientBatchId: snapshot.manifest.clientBatchId }),
    );
    await expect(accountLogbook.get(entry.localId)).resolves.toMatchObject({
      ownerUserId: userId,
      remoteId: targetRecordId,
      cloudSyncStatus: 'synced',
    });
    await expect(guestLogbook.get(entry.localId)).resolves.toBeUndefined();

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
    Object.defineProperty(AppState, 'currentState', appStateDescriptor!);
  });

  it('does not auto-loop a persisted cleanup failure across remounts and retries explicitly', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestLogbook = new LocalDiveLogRepository([entry]);
    const guestPlanbook = new LocalDivePlanRepository();
    const accountLogbook = new LocalDiveLogRepository([
      {
        ...entry,
        ownerUserId: userId,
        remoteId: '30000000-0000-4000-8000-000000000001',
        remoteRevision: 1,
        cloudSyncStatus: 'synced',
      },
    ]);
    const accountPlanbook = new LocalDivePlanRepository();
    const profileStorage = {
      write: jest.fn(async () => undefined),
      read: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    const store = new GuestClaimStore({storage: metadataStorage, userId});
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: guestPlanbook,
      profileStorage,
      now: () => 100,
    });
    snapshot.manifest.status = 'cleanupPending';
    snapshot.manifest.remoteBatchId =
      '10000000-0000-4000-8000-000000000001';
    snapshot.manifest.items[0] = {
      ...snapshot.manifest.items[0]!,
      stagingRecordId: '20000000-0000-4000-8000-000000000001',
      targetRecordId: '30000000-0000-4000-8000-000000000001',
      completedAt: 101,
    };
    snapshot.errorCode = 'claim_validation_failed';
    snapshot.failure = {
      phase: 'cleanup',
      entityKind: 'log',
      clientRecordId: entry.localId,
    };
    snapshot.manifest.updatedAt = 101;
    await store.write(snapshot);

    let latestClaim: ReturnType<typeof useAccountData>['claim'] | undefined;
    const Capture = () => {
      latestClaim = useAccountData().claim;
      return null;
    };
    const dependencies = {
      metadataStorage,
      profileStorage,
      migrateLegacyData: jest.fn(async () => undefined),
      createRepositories: (principal: {kind: 'guest'} | {kind: 'user'; userId: string}) => ({
        principal,
        queryScope:
          principal.kind === 'guest'
            ? 'guest'
            : `user:${principal.userId}`,
        logbook:
          principal.kind === 'guest' ? guestLogbook : accountLogbook,
        planbook:
          principal.kind === 'guest' ? guestPlanbook : accountPlanbook,
      }),
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 102,
      jitter: () => 0,
    };

    let activeRenderer: ReactTestRenderer.ReactTestRenderer | undefined;
    let activeQueryClient: QueryClient | undefined;
    for (let mount = 0; mount < 2; mount += 1) {
      const queryClient = new QueryClient();
      let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <AccountDataProviderCore
            queryClient={queryClient}
            navigationReady
            auth={{
              state: {status: 'authenticated', userId},
              guestClaimRemoteRepository: guestClaimRepository(),
            }}
            dependencies={dependencies}
          >
            <Capture />
          </AccountDataProviderCore>,
        );
        await flushPromises();
      });
      await waitFor(() =>
        expect(latestClaim?.state).toMatchObject({
          status: 'failed',
          failure: {phase: 'cleanup'},
        }),
      );
      await expect(guestLogbook.get(entry.localId)).resolves.toBeDefined();
      if (mount === 0) {
        await ReactTestRenderer.act(async () => renderer!.unmount());
        queryClient.clear();
      } else {
        activeRenderer = renderer!;
        activeQueryClient = queryClient;
      }
    }

    await ReactTestRenderer.act(async () => {
      await latestClaim!.retry();
      await flushPromises();
    });

    await expect(guestLogbook.get(entry.localId)).resolves.toBeUndefined();
    await expect(store.read()).resolves.toMatchObject({
      manifest: {status: 'committed'},
      snapshots: [],
    });
    await ReactTestRenderer.act(async () => activeRenderer!.unmount());
    activeQueryClient!.clear();
  });

  it('hides cleanup-pending guest ids before physical cleanup and does not resume offline', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const guestClaimed = { ...entry, localId: 'claimed-log' };
    const guestRemaining = { ...entry, localId: 'remaining-log' };
    const guestLogbook = new LocalDiveLogRepository([
      guestClaimed,
      guestRemaining,
    ]);
    const guestPlanbook = new LocalDivePlanRepository();
    const store = new GuestClaimStore({ storage: metadataStorage, userId });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: new LocalDiveLogRepository([guestClaimed]),
      planRepository: guestPlanbook,
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      now: () => 100,
    });
    snapshot.manifest.status = 'cleanupPending';
    snapshot.manifest.remoteBatchId = '10000000-0000-4000-8000-000000000001';
    snapshot.manifest.items[0] = {
      ...snapshot.manifest.items[0]!,
      stagingRecordId: '20000000-0000-4000-8000-000000000001',
      targetRecordId: '30000000-0000-4000-8000-000000000001',
      completedAt: 101,
    };
    snapshot.manifest.updatedAt = 101;
    await store.write(snapshot);
    const remote = guestClaimRepository();
    const accountClaimed = {
      ...guestClaimed,
      ownerUserId: userId,
      remoteId: '30000000-0000-4000-8000-000000000001',
      remoteRevision: 1,
      cloudSyncStatus: 'synced' as const,
    };
    let capture:
      | {
          rows: DiveLogEntry[];
          eligible: { logCount: number; planCount: number };
          claim: ReturnType<typeof useAccountData>['claim'];
        }
      | undefined;
    const Capture = () => {
      const data = useAccountData();
      React.useEffect(() => {
        data.logbookRepository.list().then(rows => {
          capture = { rows, eligible: data.claim.eligible, claim: data.claim };
        });
      }, [data]);
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          navigationReady
          auth={{
            state: { status: 'authenticatedOffline', userId },
            guestClaimRemoteRepository: remote,
          }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope:
                principal.kind === 'guest'
                  ? 'guest'
                  : `user:${principal.userId}`,
              logbook:
                principal.kind === 'guest'
                  ? guestLogbook
                  : new LocalDiveLogRepository([accountClaimed]),
              planbook:
                principal.kind === 'guest'
                  ? guestPlanbook
                  : new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await waitFor(() =>
      expect(capture?.eligible).toEqual({ logCount: 1, planCount: 0 }),
    );
    const result = capture!;

    expect(result.rows.map(row => row.localId)).toEqual([
      'claimed-log',
      'remaining-log',
    ]);
    expect(result.eligible).toEqual({ logCount: 1, planCount: 0 });
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();
    expect(remote.finalize).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      await result.claim.keepOnDevice();
    });
    expect(capture?.claim.state).toEqual({
      status: 'running',
      phase: 'cleanup',
    });
    await expect(store.read()).resolves.toMatchObject({
      manifest: { status: 'cleanupPending' },
    });

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('suppresses stale hydration publication and reuses one principal repository instance', async () => {
    const firstLogs = deferred<{ items: RemoteDiveLog[] }>();
    const firstRemote = accountRepository({
      listLogs: jest.fn(() => firstLogs.promise),
    });
    const secondRemote = accountRepository();
    const localByScope = new Map<string, LocalDiveLogRepository>();
    const createRepositories = jest.fn(principal => {
      const scope =
        principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`;
      const logbook = new LocalDiveLogRepository();
      localByScope.set(scope, logbook);
      return {
        principal,
        queryScope: scope,
        logbook,
        planbook: new LocalDivePlanRepository(),
      };
    });
    const publishedUsers: string[] = [];
    const Capture = () => {
      const accountData = useAccountData();
      if (accountData.principal.kind === 'user') {
        publishedUsers.push(accountData.principal.userId);
      }
      return null;
    };
    const dependencies = {
      metadataStorage: new InMemoryKeyValueStore(),
      profileStorage: {
        write: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      },
      migrateLegacyData: jest.fn(async () => undefined),
      createRepositories,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
      jitter: () => 0,
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: { status: 'authenticated', userId: 'user-a' },
            accountDataRepository: firstRemote,
          }}
          dependencies={dependencies}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    await ReactTestRenderer.act(async () => {
      await waitFor(() => expect(firstRemote.listLogs).toHaveBeenCalled());
    });

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: { status: 'authenticated', userId: 'user-b' },
            accountDataRepository: secondRemote,
          }}
          dependencies={dependencies}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    firstLogs.resolve({ items: [remoteLog({ localId: 'stale-user-a-log' })] });
    await ReactTestRenderer.act(flushPromises);

    expect(new Set(publishedUsers)).toEqual(new Set(['user-a', 'user-b']));
    expect(publishedUsers.at(-1)).toBe('user-b');
    await expect(localByScope.get('user:user-a')?.list()).resolves.toEqual([]);

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: { status: 'authenticatedOffline', userId: 'user-b' },
            accountDataRepository: secondRemote,
          }}
          dependencies={dependencies}
        >
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    expect(
      createRepositories.mock.calls.map(([principal]) => principal),
    ).toEqual([
      { kind: 'user', userId: 'user-a' },
      { kind: 'guest' },
      { kind: 'user', userId: 'user-b' },
    ]);
    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });
});

function remoteLog(overrides: Partial<RemoteDiveLog> = {}): RemoteDiveLog {
  const {
    payload: payloadOverride,
    payloadSha256,
    ...outerOverrides
  } = overrides;
  const payload = {
    source: 'manual',
    started_at: '1970-01-01T00:01:40.000Z',
    ended_at: null,
    duration_seconds: null,
    max_depth_meters: null,
    site_name: entry.manual.site.name ?? null,
    title: null,
    rating: null,
    dive_mode: null,
    manual_data: {
      ...entry.manual,
      _local_record: { schemaVersion: 1, createdAt: 100, updatedAt: 100 },
    },
    mobile_data: entry.mobile,
    watch_metadata: null,
    provenance: entry.provenance,
    profile_preview: null,
    profile_content_revision: null,
    profile_sha256: null,
    profile_byte_count: null,
    profile_sample_count: null,
    source_plan_id: null,
    ...(payloadOverride ?? {}),
  };
  return {
    id: '10000000-0000-4000-8000-000000000001',
    localId: entry.localId,
    revision: 2,
    payloadSha256: payloadSha256 ?? canonicalSha256(payload),
    payload,
    ...outerOverrides,
  };
}

function remotePlan(overrides: Partial<RemoteDivePlan> = {}): RemoteDivePlan {
  const {
    payload: payloadOverride,
    payloadSha256,
    ...outerOverrides
  } = overrides;
  const payload = {
    status: 'draft',
    planned_at: null,
    dive_mode: null,
    site_name: plan.site.name ?? null,
    plan_data: { ...plan, _schemaVersion: 1 },
    converted_log_id: null,
    ...(payloadOverride ?? {}),
  };
  return {
    id: '20000000-0000-4000-8000-000000000001',
    localId: plan.localId,
    revision: 2,
    payloadSha256: payloadSha256 ?? canonicalSha256(payload),
    payload,
    ...outerOverrides,
  };
}

function canonicalSha256(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalStringify(value))));
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, nested]) =>
          `${JSON.stringify(key)}:${canonicalStringify(nested)}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function accountRepository(
  overrides: Partial<AccountDataRepository> = {},
): jest.Mocked<AccountDataRepository> {
  return {
    listLogs: jest.fn(async () => ({ items: [] })),
    listPlans: jest.fn(async () => ({ items: [] })),
    saveLog: jest.fn(async value => ({ status: 'saved', value })),
    savePlan: jest.fn(async value => ({ status: 'saved', value })),
    deleteLog: jest.fn(async () => ({ status: 'saved', value: remoteLog() })),
    deletePlan: jest.fn(async () => ({ status: 'saved', value: remotePlan() })),
    ...overrides,
  } as jest.Mocked<AccountDataRepository>;
}

function guestClaimRepository(): jest.Mocked<GuestClaimRemoteRepository> {
  return {
    createOrLoadBatch: jest.fn(
      async (
        _input: Parameters<GuestClaimRemoteRepository['createOrLoadBatch']>[0],
      ) => ({
        id: '10000000-0000-4000-8000-000000000001',
        status: 'uploading' as const,
      }),
    ),
    stageRecord: jest.fn(
      async (
        _input: Parameters<GuestClaimRemoteRepository['stageRecord']>[0],
      ) => ({
        stagingRecordId: '20000000-0000-4000-8000-000000000001',
        targetRecordId: '30000000-0000-4000-8000-000000000001',
      }),
    ),
    attachProfile: jest.fn(
      async (
        _input: Parameters<GuestClaimRemoteRepository['attachProfile']>[0],
      ) => undefined,
    ),
    uploadProfile: jest.fn(
      async (_path: string, _bytes: Uint8Array) => undefined,
    ),
    downloadProfile: jest.fn(async (_path: string) => new Uint8Array()),
    finalize: jest.fn(async (_batchId: string) => ({
      status: 'committed' as const,
      planCount: 0,
      logCount: 0,
    })),
    abandon: jest.fn(async (_batchId: string) => ({
      status: 'abandoned' as const,
      storageCleanupPending: false,
    })),
    listCommittedBatch: jest.fn(async (_batchId: string) => ({
      plans: [] as RemoteDivePlan[],
      logs: [] as RemoteDiveLog[],
    })),
  };
}

class FailOnceOutboxStorage implements PersistentKeyValueStore {
  private readonly values = new Map<string, string>();
  private failed = false;

  constructor(private readonly outboxKey: string) {}

  async getString(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async setString(key: string, value: string): Promise<void> {
    if (key === this.outboxKey && !this.failed) {
      this.failed = true;
      throw new Error('outbox write failed');
    }
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function deferred<T>(): {
  promise: Promise<Awaited<T>>;
  resolve(value: Awaited<T>): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: Awaited<T>) => void;
  let reject!: (error: unknown) => void;
  return {
    promise: new Promise<Awaited<T>>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    }),
    resolve,
    reject,
  };
}

function controlledAfterInteractionsScheduler(): {
  schedule: jest.Mock<
    {cancel(): void},
    [() => void | Promise<void>]
  >;
  tasks: Array<() => void | Promise<void>>;
  cancels: jest.Mock[];
  flush(): Promise<void>;
} {
  const tasks: Array<() => void | Promise<void>> = [];
  const cancels: jest.Mock[] = [];
  return {
    tasks,
    cancels,
    schedule: jest.fn(task => {
      tasks.push(task);
      const cancel = jest.fn();
      cancels.push(cancel);
      return {cancel};
    }),
    async flush() {
      await tasks.shift()?.();
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await flushPromises();
    }
  }
  assertion();
}
