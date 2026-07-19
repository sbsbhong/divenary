import { QueryClient } from '@tanstack/react-query';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils';
import type {
  AccountDataRepository,
  RemoteDiveLog,
} from '@repo/supabase';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState, type AppStateStatus} from 'react-native';
import { LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import {
  AccountDataProviderCore,
  clearPrincipalQueries,
  createAccountLocalFirstRepositories,
  invalidatePrincipalQueries,
  reconcilePendingAccountOperations,
  useAccountData,
} from '../src/states/account-data';
import { AccountOutbox } from '../src/sync/account-outbox';
import {AccountSyncCoordinator} from '../src/sync/account-sync-coordinator';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type {PersistentKeyValueStore} from '../src/storage/persistent-key-value-store';
import type { DiveLogEntry } from '../src/types/dive-log-entry';

const userId = '00000000-0000-4000-8000-000000000001';

const entry: DiveLogEntry = {
  localId: 'local-log-1',
  source: 'manual',
  cloudSyncStatus: 'notConfigured',
  createdAt: 100,
  updatedAt: 100,
  manual: {
    site: {name: 'Local Reef'},
    buddyIds: [],
    gearIds: [],
    tags: [],
    observedMarineLife: [],
    measuredValues: {startedAt: 100},
  },
  mobile: {mediaPlaceholders: []},
  provenance: {},
};

describe('account data state', () => {
  it('cancels and removes every previous-principal query before publication', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['diveLogbook', 'user:old-user', 'list'], ['old']);
    queryClient.setQueryData(['divePlans', 'user:old-user', 'list'], ['old']);
    queryClient.setQueryData(['diveLogbook', 'user:new-user', 'list'], ['new']);
    queryClient.setQueryData(['accountSummary', 'user:old-user'], ['keep']);
    queryClient.setQueryData(['other', 'diveLogbook', 'user:old-user'], ['keep']);
    const cancelQueries = jest.spyOn(queryClient, 'cancelQueries');

    await clearPrincipalQueries(queryClient, 'user:old-user');

    expect(cancelQueries).toHaveBeenCalledWith({predicate: expect.any(Function)});
    expect(queryClient.getQueryData(['diveLogbook', 'user:old-user', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['divePlans', 'user:old-user', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['diveLogbook', 'user:new-user', 'list'])).toEqual(['new']);
    expect(queryClient.getQueryData(['accountSummary', 'user:old-user'])).toEqual(['keep']);
    expect(queryClient.getQueryData(['other', 'diveLogbook', 'user:old-user'])).toEqual(['keep']);
    queryClient.clear();
  });

  it('invalidates only the active principal log and plan query roots', async () => {
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidatePrincipalQueries(queryClient, `user:${userId}`);

    const predicate = invalidate.mock.calls[0][0]?.predicate;
    expect(predicate?.({queryKey: ['diveLogbook', `user:${userId}`, 'list']} as never)).toBe(true);
    expect(predicate?.({queryKey: ['divePlans', `user:${userId}`, 'detail']} as never)).toBe(true);
    expect(predicate?.({queryKey: ['diveLogbook', 'user:other', 'list']} as never)).toBe(false);
    expect(predicate?.({queryKey: ['accountSummary', `user:${userId}`]} as never)).toBe(false);
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
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
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
        principal: {kind: 'user', userId},
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
    expect(accountRepository.saveLog).not.toHaveBeenCalled();
  });

  it('keeps guest writes local-only', async () => {
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
    const guest = {
      principal: {kind: 'guest'} as const,
      queryScope: 'guest',
      logbook: new LocalDiveLogRepository(),
      planbook: new LocalDivePlanRepository(),
    };

    await guest.logbook.save(entry);

    await expect(guest.logbook.get('local-log-1')).resolves.toEqual(entry);
    await expect(outbox.list()).resolves.toEqual([]);
  });

  it('keeps the device profile key out of the remote watch metadata', async () => {
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: {kind: 'user', userId},
        queryScope: `user:${userId}`,
        logbook: new LocalDiveLogRepository(),
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
        session: {localSessionId: 'watch-1', startedAt: 100, samples: []},
        measuredValues: {startedAt: 100},
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
    const remote = queued.payload.remote as {payload: {watch_metadata: unknown}};
    expect(JSON.stringify(remote.payload.watch_metadata)).not.toContain('storageKey');
    expect(remote.payload.watch_metadata).toMatchObject({
      profile: {contentRevision: 'revision-1', sampleCount: 0},
    });
  });

  it('snapshots exact full profile bytes under an outbox-owned operation key', async () => {
    const storage = new InMemoryKeyValueStore();
    const outbox = new AccountOutbox({storage, storageKey: 'outbox'});
    const fullSamples = [
      {localSessionId: 'watch-1', timestamp: 100, depthMeters: 2},
      {localSessionId: 'watch-1', timestamp: 101, depthMeters: 8},
    ];
    const serialized = JSON.stringify(fullSamples);
    const digest = bytesToHex(sha256(utf8ToBytes(serialized)));
    const localLogbook = new LocalDiveLogRepository();
    jest.spyOn(localLogbook, 'getWatchProfile').mockResolvedValue(fullSamples);
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

  it('fails closed before enqueueing a profile whose immutable digest is wrong', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
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
          session: {localSessionId: 'watch-1', startedAt: 100, samples: []},
          measuredValues: {startedAt: 100},
          samples: [sample],
          profile: {
            storageKey: 'device-profile-key',
            contentRevision: 'revision-1',
            sampleCount: 1,
            sha256: '0'.repeat(64),
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
    const outbox = new AccountOutbox({storage, storageKey: 'outbox'});
    const localLogbook = new LocalDiveLogRepository();
    const base = {
      principal: {kind: 'user', userId} as const,
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

    await expect(repositories.logbook.save(entry)).rejects.toThrow('outbox write failed');
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
        principal: {kind: 'user', userId},
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      now: () => 100,
    });

    await repositories.logbook.delete(current.localId);

    await expect(repositories.logbook.get(current.localId)).resolves.toBeUndefined();
    await expect(repositories.logbook.list()).resolves.toEqual([]);
    await expect(localLogbook.get(current.localId)).resolves.toEqual(current);
    await expect(outbox.list(userId)).resolves.toMatchObject([
      {mutation: 'delete', expectedRevision: 2},
    ]);

    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: accountRepository(),
      logbookRepository: localLogbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });
    await coordinator.drain({online: true});
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
        principal: {kind: 'user', userId},
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
      manual: {...entry.manual, notes: 'current local'},
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
        principal: {kind: 'user', userId},
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      now: () => 100,
    });
    await repositories.logbook.delete(current.localId);
    const latest = remoteLog({revision: 4});
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: accountRepository({
        deleteLog: jest.fn(async () => ({status: 'conflict' as const, remote: latest})),
      }),
      logbookRepository: localLogbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });

    await coordinator.drain({online: true});

    await expect(repositories.logbook.get(current.localId)).resolves.toMatchObject({
      cloudSyncStatus: 'conflict',
      manual: {notes: 'current local'},
    });
    await expect(outbox.listConflicts(userId)).resolves.toEqual([
      expect.objectContaining({
        localPayload: {...current, cloudSyncStatus: 'conflict'},
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
        principal: {kind: 'user', userId},
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
        principal: {kind: 'user', userId},
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
      schedule: () => ({cancel: jest.fn()}),
    });

    const draining = coordinator.drain({online: true});
    await Promise.resolve();
    const editing = repositories.logbook.save({
      ...initiallySaved,
      updatedAt: 110,
      manual: {...initiallySaved.manual, notes: 'edited while saving'},
    });
    saveResult.resolve({status: 'saved', value: remoteLog({revision: 2})});
    await Promise.all([draining, editing]);

    await expect(localLogbook.get(entry.localId)).resolves.toMatchObject({
      remoteRevision: 2,
      cloudSyncStatus: 'pending',
      manual: {notes: 'edited while saving'},
    });
    await expect(outbox.list(userId)).resolves.toMatchObject([
      {mutation: 'upsert', expectedRevision: 2},
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
        principal: {kind: 'user', userId},
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
      schedule: () => ({cancel: jest.fn()}),
    });

    const draining = coordinator.drain({online: true});
    await Promise.resolve();
    const deleting = repositories.logbook.delete(entry.localId);
    saveResult.resolve({
      status: 'saved',
      value: remoteLog({revision: 2}),
    });
    await Promise.all([draining, deleting]);

    await expect(repositories.logbook.get(entry.localId)).resolves.toBeUndefined();
    await expect(localLogbook.get(entry.localId)).resolves.toMatchObject({
      remoteRevision: 2,
      cloudSyncStatus: 'synced',
    });
    await expect(outbox.list(userId)).resolves.toMatchObject([
      {mutation: 'delete', expectedRevision: 2},
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
      predicate?.({queryKey: ['diveLogbook', `user:${userId}`, 'list']} as never),
    ).toBe(true);
    expect(
      predicate?.({queryKey: ['diveLogbook', 'user:other', 'list']} as never),
    ).toBe(false);

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });

  it('resumes an online account drain when the app returns to the foreground', async () => {
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener;
      return {remove: jest.fn()};
    });
    jest
      .spyOn(AccountSyncCoordinator.prototype, 'hydrate')
      .mockResolvedValue(0);
    const drain = jest
      .spyOn(AccountSyncCoordinator.prototype, 'drain')
      .mockResolvedValue({processed: 0, remaining: 0});
    const metadataStorage = new InMemoryKeyValueStore();
    const queryClient = new QueryClient();
    const accountRepository = {} as AccountDataRepository;
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
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
    expect(drain).toHaveBeenLastCalledWith({online: true});

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
    jest.restoreAllMocks();
  });

  it('suppresses stale hydration publication and reuses one principal repository instance', async () => {
    const firstLogs = deferred<{items: RemoteDiveLog[]}>();
    const firstRemote = accountRepository({listLogs: jest.fn(() => firstLogs.promise)});
    const secondRemote = accountRepository();
    const createRepositories = jest.fn(principal => ({
      principal,
      queryScope:
        principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`,
      logbook: new LocalDiveLogRepository(),
      planbook: new LocalDivePlanRepository(),
    }));
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
            state: {status: 'authenticated', userId: 'user-a'},
            accountDataRepository: firstRemote,
          }}
          dependencies={dependencies}>
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
            state: {status: 'authenticated', userId: 'user-b'},
            accountDataRepository: secondRemote,
          }}
          dependencies={dependencies}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    firstLogs.resolve({items: []});
    await ReactTestRenderer.act(flushPromises);

    expect(publishedUsers).toEqual(['user-b']);

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticatedOffline', userId: 'user-b'},
            accountDataRepository: secondRemote,
          }}
          dependencies={dependencies}>
          <Capture />
        </AccountDataProviderCore>,
      );
      await flushPromises();
    });
    expect(createRepositories).toHaveBeenCalledTimes(2);
    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
  });
});

function remoteLog(overrides: Partial<RemoteDiveLog> = {}): RemoteDiveLog {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    localId: entry.localId,
    revision: 2,
    payloadSha256: 'a'.repeat(64),
    payload: {
      source: 'manual',
      started_at: '1970-01-01T00:01:40.000Z',
      manual_data: entry.manual,
      mobile_data: entry.mobile,
      provenance: entry.provenance,
    },
    ...overrides,
  };
}

function accountRepository(
  overrides: Partial<AccountDataRepository> = {},
): jest.Mocked<AccountDataRepository> {
  return {
    listLogs: jest.fn(async () => ({items: []})),
    listPlans: jest.fn(async () => ({items: []})),
    saveLog: jest.fn(async value => ({status: 'saved', value})),
    savePlan: jest.fn(async value => ({status: 'saved', value})),
    deleteLog: jest.fn(async () => ({status: 'saved', value: remoteLog()})),
    deletePlan: jest.fn(async value => ({status: 'saved', value} as never)),
    ...overrides,
  } as jest.Mocked<AccountDataRepository>;
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
} {
  let resolve!: (value: Awaited<T>) => void;
  return {
    promise: new Promise<Awaited<T>>(nextResolve => {
      resolve = nextResolve;
    }),
    resolve,
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
