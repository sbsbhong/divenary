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
  AccountDataProviderCore,
  clearPrincipalQueries,
  createAccountLocalFirstRepositories,
  invalidatePrincipalQueries,
  reconcilePendingAccountOperations,
  useAccountData,
} from '../src/states/account-data';
import { AccountOutbox } from '../src/sync/account-outbox';
import { AccountSyncCoordinator } from '../src/sync/account-sync-coordinator';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import { dataProfileKeyPrefix } from '../src/storage/data-principal';
import type { PersistentKeyValueStore } from '../src/storage/persistent-key-value-store';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { DivePlan } from '../src/types/dive-plan';
import {
  createGuestClaimSnapshot,
  GuestClaimStore,
} from '../src/claim/guest-claim-store';

const userId = '00000000-0000-4000-8000-000000000001';

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

  it('keeps the device profile key out of the remote watch metadata', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: { kind: 'user', userId },
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
    jest.spyOn(localLogbook, 'getWatchProfile').mockResolvedValue(fullSamples);
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

  it('fails closed before enqueueing a profile whose immutable digest is wrong', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const localLogbook = new LocalDiveLogRepository();
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

  it('maps claim preparation failures into controller state without remote work', async () => {
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
      expect(captures.at(-1)?.state).toEqual({
        status: 'failed',
        completed: 0,
        total: 1,
        errorCode: 'profile_missing',
      }),
    );
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      await captures.at(-1)!.keepOnDevice();
    });
    await waitFor(() =>
      expect(captures.at(-1)?.state).toEqual({ status: 'hidden' }),
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

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
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
    expect(capture?.claim.state).toEqual({ status: 'complete', imported: 1 });
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

    expect(new Set(publishedUsers)).toEqual(new Set(['user-b']));
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
