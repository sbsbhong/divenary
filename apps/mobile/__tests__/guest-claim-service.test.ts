import type {
  GuestClaimRemoteRepository,
  GuestClaimStageInput,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';
import { GuestClaimRepositoryError } from '@repo/supabase';
import {
  createGuestClaimSnapshot,
  GuestClaimStore,
  readClaimProfileBytes,
  type GuestClaimSnapshot,
} from '../src/claim/guest-claim-store';
import {
  GuestClaimService,
  GuestClaimServiceError,
} from '../src/claim/guest-claim-service';
import {createProfileBytesSnapshot} from '../src/claim/profile-bytes';
import {createWatchProfileDigest} from '../src/utils/watch-profile-digest';
import {createAccountLocalFirstRepositories} from '../src/states/account-data';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import {
  dataProfileKeyPrefix,
  dataStorageKeys,
} from '../src/storage/data-principal';
import type { PersistentKeyValueStore } from '../src/storage/persistent-key-value-store';
import type { WatchProfileStorage } from '../src/storage/watch-profile-storage';
import {AccountOutbox} from '../src/sync/account-outbox';
import type { DiveLogRepository } from '../src/repositories/dive-log-repository';
import type { DivePlanRepository } from '../src/repositories/dive-plan-repository';
import type { PrincipalRepositories } from '../src/repositories/principal-repositories';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { DivePlan } from '../src/types/dive-plan';
import type { WatchDepthSample } from '../src/types/dive-session';

const userId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const batchId = '10000000-0000-4000-8000-000000000001';
const guestProfileKey = `${dataProfileKeyPrefix({
  kind: 'guest',
})}session-log-a:revision-1`;

type TestRepositories = PrincipalRepositories & {
  logbook: jest.Mocked<DiveLogRepository>;
  planbook: jest.Mocked<DivePlanRepository>;
};

describe('guest claim service', () => {
  beforeEach(() => {
    profileRegistry.clear();
  });

  it('stages plans before logs and persists profile readback before progress and finalization', async () => {
    const order: string[] = [];
    const storage = new RecordingStorage(order);
    const profile = profileStorage();
    const fullSamples = depthSamples(200);
    await profile.write(guestProfileKey, fullSamples);
    const guest = repositories(
      [watchLog('log-a', fullSamples.slice(0, 160))],
      [divePlan('plan-a', 'log-a')],
      order,
    );
    const account = repositories([], [], order, 'account');
    const store = new GuestClaimStore({ storage, userId, now: clock() });
    const download = deferred<Uint8Array>();
    const remote = remoteRepository(store, order, {
      downloadProfile: jest.fn(() => download.promise),
    });
    const progress: Array<{ completed: number; total: number; phase: string }> =
      [];
    const service = claimService({
      store,
      guest,
      account,
      profile,
      remote,
      order,
      onProgress: value => progress.push(value),
    });

    const running = service.start();
    await waitFor(() => expect(remote.downloadProfile).toHaveBeenCalled());

    expect(
      remote.stageRecord.mock.calls.map(([input]) => input.entityKind),
    ).toEqual(['plan', 'log']);
    expect(progress.map(value => value.completed)).toEqual([0, 1]);
    const path = remote.uploadProfile.mock.calls[0]?.[0];
    expect(path).toBe(
      `${userId}/claims/${batchId}/30000000-0000-4000-8000-000000000002/revision-1.json`,
    );
    const uploaded = remote.uploadProfile.mock.calls[0]?.[1];
    download.resolve(uploaded!);

    const result = await running;

    expect(result?.manifest.status).toBe('committed');
    expect(
      progress
        .filter(value => value.phase === 'uploading')
        .map(value => value.completed),
    ).toEqual([0, 1, 2]);
    expect(progress.at(-1)).toMatchObject({ completed: 2, total: 2 });
    expect(order).toEqual(
      expect.arrayContaining([
        'remote:finalize',
        'account:save:plan:plan-a',
        'account:save:log:log-a',
        'persist:committed',
        'guest:delete:plan:plan-a',
        'guest:delete:log:log-a',
      ]),
    );
    expect(order.indexOf('remote:finalize')).toBeLessThan(
      order.indexOf('account:save:plan:plan-a'),
    );
    expect(order.indexOf('account:save:log:log-a')).toBeLessThan(
      order.indexOf('persist:cleanupPending'),
    );
    expect(order.indexOf('persist:cleanupPending')).toBeLessThan(
      order.indexOf('guest:delete:plan:plan-a'),
    );
    expect(order.indexOf('guest:delete:log:log-a')).toBeLessThan(
      order.indexOf('persist:committed'),
    );
    await expect(account.planbook.get('plan-a')).resolves.toMatchObject({
      ownerUserId: userId,
      remoteId: '30000000-0000-4000-8000-000000000001',
      cloudSyncStatus: 'synced',
    });
    const accountLog = await account.logbook.get('log-a');
    expect(accountLog).toMatchObject({
      ownerUserId: userId,
      remoteId: '30000000-0000-4000-8000-000000000002',
      cloudSyncStatus: 'synced',
    });
    expect(accountLog?.watchCapture?.profile?.storageKey).toContain(
      encodeURIComponent(`user:${userId}`),
    );
    await expect(
      account.logbook.getWatchProfile('log-a'),
    ).resolves.toHaveLength(200);
  });

  it('publishes and cleans up claim rows with equivalent PostgREST timestamps', async () => {
    const guestPlan = {
      ...divePlan('plan-a'),
      plannedAt: 10,
    };
    const guest = repositories([diveLog('log-a')], [guestPlan]);
    const account = repositories([], [], [], 'account');
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store, [], {
      listCommittedBatch: jest.fn(async () => {
        const snapshot = await store.read();
        if (!snapshot) {
          throw new Error('missing snapshot');
        }
        const committed = committedRows(snapshot);
        committed.logs[0]!.payload.started_at =
          '1970-01-01T09:00:10.000000+09:00';
        committed.plans[0]!.payload.planned_at =
          '1970-01-01T09:00:10.000000+09:00';
        return committed;
      }),
    });
    const service = claimService({
      store,
      guest,
      account,
      profile: profileStorage(),
      remote,
    });

    const result = await service.start();

    expect(result?.manifest.status).toBe('committed');
    await expect(account.logbook.get('log-a')).resolves.toMatchObject({
      ownerUserId: userId,
      cloudSyncStatus: 'synced',
    });
    await expect(account.planbook.get('plan-a')).resolves.toMatchObject({
      ownerUserId: userId,
      cloudSyncStatus: 'synced',
    });
    await expect(guest.logbook.get('log-a')).resolves.toBeUndefined();
    await expect(guest.planbook.get('plan-a')).resolves.toBeUndefined();
  });

  it('publishes a recovered legacy artifact digest only in the account-local profile reference', async () => {
    const profile = profileStorage();
    const fullSamples = depthSamples(2);
    const legacyArtifactSha256 = 'a'.repeat(64);
    const log = watchLog('log-a', fullSamples.slice(0, 1));
    log.watchCapture!.profile = {
      ...log.watchCapture!.profile!,
      sampleCount: fullSamples.length,
      sha256: legacyArtifactSha256,
    };
    await profile.write(guestProfileKey, fullSamples);
    const guest = repositories([log], []);
    const account = repositories([], [], [], 'account');
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({store, guest, account, profile, remote});

    await service.prepare();
    await expect(guest.logbook.get('log-a')).resolves.toEqual(log);
    await expect(profile.read(guestProfileKey)).resolves.toEqual(fullSamples);

    await expect(service.start()).resolves.toMatchObject({
      manifest: {status: 'committed'},
    });
    await expect(guest.logbook.get('log-a')).resolves.toBeUndefined();

    const profileDigest = createWatchProfileDigest(fullSamples).sha256;
    await expect(account.logbook.get('log-a')).resolves.toMatchObject({
      watchCapture: {
        profile: {
          sha256: profileDigest,
          artifactSha256: legacyArtifactSha256,
        },
      },
    });
    const logStage = remote.stageRecord.mock.calls.find(
      ([input]) => input.entityKind === 'log',
    )?.[0];
    expect(logStage?.payload).toMatchObject({profile_sha256: profileDigest});
    expect(JSON.stringify(logStage?.payload)).not.toContain('artifactSha256');
  });

  it('promotes a metadata-only edit of a prepared legacy profile and completes cleanup', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const profile = profileStorage();
    const fullSamples = depthSamples(2);
    const legacyArtifactSha256 = 'a'.repeat(64);
    const profileDigest = createWatchProfileDigest(fullSamples).sha256;
    const original = watchLog('log-a', fullSamples.slice(0, 1));
    original.watchCapture!.profile = {
      ...original.watchCapture!.profile!,
      sampleCount: fullSamples.length,
      sha256: legacyArtifactSha256,
    };
    await profile.write(guestProfileKey, fullSamples);
    const guest = repositories([original], []);
    const account = repositories([], [], [], 'account');
    const outbox = new AccountOutbox({
      storage: metadataStorage,
      storageKey: dataStorageKeys({kind: 'user', userId}).outbox,
      now: clock(),
      jitter: () => 0,
    });
    const accountMutations = createAccountLocalFirstRepositories({
      userId,
      repositories: account,
      outbox,
      createId: () => uuid('9', 1),
      now: clock(),
    });
    const store = new GuestClaimStore({
      storage: metadataStorage,
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    let editedDuringCleanup = false;
    const service = new GuestClaimService({
      userId,
      store,
      guestRepositories: guest,
      accountRepositories: account,
      accountMutationRepositories: accountMutations,
      profileStorage: profile,
      remoteRepository: remote,
      now: clock(),
      onSnapshot: async snapshot => {
        if (
          snapshot.manifest.status !== 'cleanupPending' ||
          editedDuringCleanup
        ) {
          return;
        }
        editedDuringCleanup = true;
        const current = (await guest.logbook.get('log-a'))!;
        await guest.logbook.save({
          ...current,
          updatedAt: 12,
          manual: {
            ...current.manual,
            title: 'edited during cleanup',
            notes: 'metadata only',
          },
        });
      },
    });

    const result = await service.start();

    expect(editedDuringCleanup).toBe(true);
    expect(result?.manifest.status).toBe('committed');
    await expect(guest.logbook.get('log-a')).resolves.toBeUndefined();
    await expect(profile.read(guestProfileKey)).resolves.toBeUndefined();
    await expect(account.logbook.get('log-a')).resolves.toMatchObject({
      manual: {
        title: 'edited during cleanup',
        notes: 'metadata only',
      },
      cloudSyncStatus: 'pending',
      watchCapture: {
        profile: {
          sha256: profileDigest,
          artifactSha256: legacyArtifactSha256,
        },
      },
    });
    const operations = await outbox.list(userId);
    expect(operations).toHaveLength(1);
    expect(JSON.stringify(operations[0]!.payload.remote)).not.toContain(
      'artifactSha256',
    );
    const logStage = remote.stageRecord.mock.calls.find(
      ([input]) => input.entityKind === 'log',
    )?.[0];
    expect(JSON.stringify(logStage?.payload)).not.toContain('artifactSha256');
  });

  it('does not publish committed before cleanup deletion finishes', async () => {
    const statuses: string[] = [];
    const guest = repositories([diveLog('log-a')], []);
    const deleteLog = guest.logbook.delete.getMockImplementation()!;
    const cleanupRelease = deferred<void>();
    guest.logbook.delete.mockImplementation(async (localId, options) => {
      await cleanupRelease.promise;
      return deleteLog(localId, options);
    });
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const service = new GuestClaimService({
      userId,
      store,
      guestRepositories: guest,
      accountRepositories: repositories([], []),
      accountMutationRepositories: repositories([], []),
      profileStorage: profileStorage(),
      remoteRepository: remoteRepository(store),
      now: clock(),
      onSnapshot: snapshot => {
        statuses.push(snapshot.manifest.status);
      },
    });

    const running = service.start();
    await waitFor(() => expect(guest.logbook.delete).toHaveBeenCalled());

    expect(statuses.at(-1)).toBe('cleanupPending');
    expect(statuses).not.toContain('committed');

    cleanupRelease.resolve(undefined);
    const result = await running;

    expect(result?.manifest.status).toBe('committed');
    expect(statuses.at(-1)).toBe('committed');
    expect(statuses.filter(status => status === 'committed')).toHaveLength(1);
  });

  it('resumes at exactly 3 / 32 from persisted completion rather than memory', async () => {
    const storage = new InMemoryKeyValueStore();
    const guest = repositories(
      Array.from({ length: 32 }, (_, index) =>
        diveLog(`log-${String(index).padStart(2, '0')}`),
      ),
      [],
    );
    const store = new GuestClaimStore({ storage, userId, now: clock() });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guest.logbook,
      planRepository: guest.planbook,
      profileStorage: profileStorage(),
      now: () => 100,
    });
    snapshot.manifest.status = 'running';
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.manifest.updatedAt = 103;
    snapshot.manifest.items = snapshot.manifest.items.map((item, index) =>
      index < 3
        ? {
            ...item,
            stagingRecordId: uuid('2', index + 1),
            targetRecordId: uuid('3', index + 1),
            completedAt: 101 + index,
          }
        : item,
    );
    await store.write(snapshot);
    const remote = remoteRepository(store, [], {
      stageRecord: jest.fn(async () => {
        throw new GuestClaimServiceError('network_unavailable');
      }),
    });
    const progress = jest.fn();
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
      onProgress: progress,
    });

    const result = await service.resume();

    expect(progress.mock.calls[0]?.[0]).toMatchObject({
      completed: 3,
      total: 32,
      phase: 'uploading',
    });
    expect(result?.manifest.status).toBe('failed');
    expect(result?.errorCode).toBe('network_unavailable');
  });

  it('reuses one remote batch and safely repeats a stage after an interrupted response', async () => {
    const storage = new InMemoryKeyValueStore();
    const guest = repositories([diveLog('log-a')], []);
    const account = repositories([], []);
    const store = new GuestClaimStore({ storage, userId, now: clock() });
    const baseRemote = remoteRepository(store);
    let stageAttempt = 0;
    baseRemote.stageRecord.mockImplementation(async input => {
      stageAttempt += 1;
      if (stageAttempt === 1) {
        throw new GuestClaimServiceError('network_unavailable');
      }
      return targetFor(input);
    });
    const first = claimService({
      store,
      guest,
      account,
      profile: profileStorage(),
      remote: baseRemote,
    });

    await expect(first.start()).resolves.toMatchObject({
      manifest: { status: 'failed', remoteBatchId: batchId },
    });
    const resumed = claimService({
      store,
      guest,
      account,
      profile: profileStorage(),
      remote: baseRemote,
    });
    const result = await resumed.retry();

    expect(result?.manifest.status).toBe('committed');
    expect(baseRemote.createOrLoadBatch).toHaveBeenCalledTimes(2);
    expect(baseRemote.createOrLoadBatch.mock.calls[1]?.[0]).toEqual(
      baseRemote.createOrLoadBatch.mock.calls[0]?.[0],
    );
    expect(baseRemote.stageRecord).toHaveBeenCalledTimes(2);
    expect(baseRemote.stageRecord.mock.calls[1]?.[0]).toEqual(
      baseRemote.stageRecord.mock.calls[0]?.[0],
    );
  });

  it('defers without touching originals and later uploads the immutable snapshot', async () => {
    const guest = repositories([diveLog('log-a', 'original')], []);
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });

    await service.prepare();
    const deferredSnapshot = await service.defer();
    await guest.logbook.save(diveLog('log-a', 'changed after process exit'));

    expect(deferredSnapshot?.manifest.status).toBe('deferred');
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();
    expect(guest.logbook.delete).not.toHaveBeenCalled();

    const result = await claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    }).retry();
    expect(result?.manifest.clientBatchId).toBe(
      deferredSnapshot?.manifest.clientBatchId,
    );
    expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(1);
    expect(remote.createOrLoadBatch.mock.calls[0]?.[0]).toMatchObject({
      clientBatchId: deferredSnapshot?.manifest.clientBatchId,
    });
    expect(remote.stageRecord.mock.calls[0]?.[0].payload).toMatchObject({
      title: 'original',
    });
  });

  it('drops a deferred local-only snapshot after its guest sources are deleted', async () => {
    const guest = repositories([diveLog('log-a')], []);
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });

    await service.defer();
    await guest.logbook.delete('log-a');

    await expect(service.retry()).resolves.toBeUndefined();
    await expect(store.read()).resolves.toBeUndefined();
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();
    expect(remote.stageRecord).not.toHaveBeenCalled();
    expect(remote.finalize).not.toHaveBeenCalled();
  });

  it('defers a failed snapshot with remote progress and never auto-resumes it', async () => {
    const guest = repositories([diveLog('log-a')], []);
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guest.logbook,
      planRepository: guest.planbook,
      profileStorage: profileStorage(),
      now: () => 100,
    });
    snapshot.manifest.status = 'failed';
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.manifest.items[0] = {
      ...snapshot.manifest.items[0]!,
      stagingRecordId: uuid('2', 1),
      targetRecordId: uuid('3', 1),
      completedAt: 101,
    };
    snapshot.errorCode = 'network_unavailable';
    await store.write(snapshot);
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });

    const deferredSnapshot = await service.defer();
    const resumedSnapshot = await service.resume();

    expect(deferredSnapshot).toMatchObject({
      manifest: {
        status: 'deferred',
        remoteBatchId: batchId,
        items: [
          {
            stagingRecordId: uuid('2', 1),
            targetRecordId: uuid('3', 1),
            completedAt: 101,
          },
        ],
      },
    });
    expect(resumedSnapshot).toEqual(deferredSnapshot);
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();
    expect(remote.stageRecord).not.toHaveBeenCalled();
    expect(remote.finalize).not.toHaveBeenCalled();
  });

  it('preserves a failed remote-progress checkpoint after its guest source is deleted', async () => {
    const guest = repositories([diveLog('log-a')], []);
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guest.logbook,
      planRepository: guest.planbook,
      profileStorage: profileStorage(),
      now: () => 100,
    });
    snapshot.manifest.status = 'failed';
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.errorCode = 'network_unavailable';
    await store.write(snapshot);
    await guest.logbook.delete('log-a');
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote: remoteRepository(store),
    });

    await expect(service.prepare()).resolves.toEqual(snapshot);
    await expect(store.read()).resolves.toEqual(snapshot);
  });

  it('removes superseded account profiles when changed promotion resumes after outbox failure', async () => {
    const order: string[] = [];
    const metadataStorage = new InMemoryKeyValueStore();
    const profile = profileStorage();
    const originalSamples = depthSamples(200);
    const changedSamples = originalSamples.map(sample => ({
      ...sample,
      depthMeters: sample.depthMeters + 1,
    }));
    const changedProfileKey = `${dataProfileKeyPrefix({
      kind: 'guest',
    })}session-log-a:revision-2`;
    const newestProfileKey = `${dataProfileKeyPrefix({
      kind: 'guest',
    })}session-log-a:revision-3`;
    await profile.write(guestProfileKey, originalSamples);
    const original = watchLog('log-a', originalSamples.slice(0, 160));
    const guest = repositories([original], [], order);
    const account = repositories([], [], order, 'account');
    const outbox = new AccountOutbox({
      storage: metadataStorage,
      storageKey: dataStorageKeys({kind: 'user', userId}).outbox,
      now: clock(),
      jitter: () => 0,
    });
    const accountMutations = createAccountLocalFirstRepositories({
      userId,
      repositories: account,
      outbox,
      createId: () => uuid('9', 1),
      now: clock(),
    });
    const enqueue = outbox.enqueue.bind(outbox);
    let failedOperationId: string | undefined;
    jest
      .spyOn(outbox, 'enqueue')
      .mockImplementationOnce(async item => {
        failedOperationId = item.operationId;
        order.push(`outbox:failed:${item.entityLocalId}`);
        throw new Error('simulated outbox interruption');
      })
      .mockImplementation(async item => {
        order.push(`outbox:enqueued:${item.entityLocalId}`);
        return enqueue(item);
      });
    const store = new GuestClaimStore({
      storage: metadataStorage,
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account,
      accountMutations,
      profile,
      remote,
    });
    await service.prepare();
    await service.defer();

    await profile.write(changedProfileKey, changedSamples);
    await guest.logbook.save({
      ...original,
      updatedAt: 12,
      manual: { ...original.manual, title: 'changed guest row' },
      watchCapture: {
        ...original.watchCapture!,
        samples: changedSamples.slice(0, 160),
        profile: {
          storageKey: changedProfileKey,
          contentRevision: 'revision-2',
          sampleCount: changedSamples.length,
        },
      },
    });

    const result = await service.retry();

    expect(result?.manifest.status).toBe('cleanupPending');
    await expect(guest.logbook.get('log-a')).resolves.toMatchObject({
      manual: { title: 'changed guest row' },
      watchCapture: { profile: { storageKey: changedProfileKey } },
    });
    await expect(outbox.list(userId)).resolves.toEqual([]);
    const partiallyPromoted = await account.logbook.get('log-a');
    expect(partiallyPromoted).toMatchObject({
      manual: { title: 'changed guest row' },
      ownerUserId: userId,
      remoteId: uuid('3', 2),
      remoteRevision: 1,
      cloudSyncStatus: 'pending',
      watchCapture: {
        profile: {
          contentRevision: 'revision-2',
          sampleCount: changedSamples.length,
        },
      },
    });
    expect(
      partiallyPromoted?.watchCapture?.profile?.storageKey.startsWith(
        dataProfileKeyPrefix({kind: 'user', userId}),
      ),
    ).toBe(true);
    await expect(account.logbook.getWatchProfile('log-a')).resolves.toEqual(
      changedSamples,
    );
    expect(failedOperationId).toBeDefined();
    await expect(
      metadataStorage.getString(
        outbox.profileSnapshotKey(userId, failedOperationId!),
      ),
    ).resolves.toBeUndefined();
    expect(guest.logbook.delete).not.toHaveBeenCalled();

    const newestSamples = changedSamples.map(sample => ({
      ...sample,
      depthMeters: sample.depthMeters + 1,
    }));
    await profile.write(newestProfileKey, newestSamples);
    await guest.logbook.save({
      ...(await guest.logbook.get('log-a'))!,
      updatedAt: 14,
      manual: {...original.manual, title: 'newest guest row'},
      watchCapture: {
        ...(await guest.logbook.get('log-a'))!.watchCapture!,
        samples: newestSamples.slice(0, 160),
        profile: {
          storageKey: newestProfileKey,
          contentRevision: 'revision-3',
          sampleCount: newestSamples.length,
        },
      },
    });

    const resumed = await service.retry();

    expect(resumed?.manifest.status).toBe('committed');
    await expect(guest.logbook.get('log-a')).resolves.toBeUndefined();
    await expect(profile.read(newestProfileKey)).resolves.toBeUndefined();
    await expect(account.logbook.get('log-a')).resolves.toMatchObject({
      manual: { title: 'newest guest row' },
      remoteId: uuid('3', 2),
      remoteRevision: 1,
      cloudSyncStatus: 'pending',
      watchCapture: {
        profile: { contentRevision: 'revision-3', sampleCount: 200 },
      },
    });
    await expect(account.logbook.getWatchProfile('log-a')).resolves.toEqual(
      newestSamples,
    );
    const operations = await outbox.list(userId);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      entityKind: 'log',
      entityLocalId: 'log-a',
      mutation: 'upsert',
      expectedRevision: 1,
      payload: {
        local: {
          manual: { title: 'newest guest row' },
          remoteId: uuid('3', 2),
          remoteRevision: 1,
          cloudSyncStatus: 'pending',
        },
      },
    });
    await expect(outbox.readProfileSnapshot(operations[0]!)).resolves.toBe(
      JSON.stringify(newestSamples),
    );
    const accountPrefix = dataProfileKeyPrefix({kind: 'user', userId});
    await expect(
      profile.read(`${accountPrefix}session-log-a:revision-1`),
    ).resolves.toBeUndefined();
    await expect(
      profile.read(`${accountPrefix}session-log-a:revision-2`),
    ).resolves.toBeUndefined();
    expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(1);
    expect(remote.stageRecord).toHaveBeenCalledTimes(1);
    expect(order.indexOf('outbox:enqueued:log-a')).toBeLessThan(
      order.indexOf('guest:delete:log:log-a'),
    );
  });

  it.each([
    ['deterministic reconciled profile alias', true],
    ['arbitrary reconciled profile alias', false],
  ])(
    '%s is handled with strict semantic equality',
    async (_label, isDeterministicAlias) => {
    const metadataStorage = new InMemoryKeyValueStore();
    const profile = profileStorage();
    const originalSamples = depthSamples(200);
    const changedSamples = originalSamples.map(sample => ({
      ...sample,
      depthMeters: sample.depthMeters + 2,
    }));
    const guestProfileKey2 = `${dataProfileKeyPrefix({
      kind: 'guest',
    })}session-log-a:revision-2`;
    await profile.write(guestProfileKey, originalSamples);
    const original = watchLog('log-a', originalSamples.slice(0, 160));
    const guest = repositories([original], []);
    const store = new GuestClaimStore({
      storage: metadataStorage,
      userId,
      now: clock(),
    });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guest.logbook,
      planRepository: guest.planbook,
      profileStorage: profile,
      now: clock(),
    });
    snapshot.manifest.status = 'cleanupPending';
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.manifest.items[0] = {
      ...snapshot.manifest.items[0]!,
      stagingRecordId: uuid('2', 2),
      targetRecordId: uuid('3', 2),
      completedAt: 101,
    };
    const snapshotProfileBytes = (await readClaimProfileBytes(
      snapshot.snapshots[0]!,
      profile,
    ))!;
    snapshot.snapshots[0]!.profileReadback = {
      path: `${userId}/claims/${batchId}/${uuid('3', 2)}/revision-1.json`,
      byteCount: new TextEncoder().encode(snapshotProfileBytes).length,
      sha256: snapshot.manifest.items[0]!.profile!.sha256,
      sampleCount: snapshot.manifest.items[0]!.profile!.sampleCount,
      verifiedAt: 102,
    };
    await store.write(snapshot);

    await profile.write(guestProfileKey2, changedSamples);
    const changed: DiveLogEntry = {
      ...original,
      updatedAt: 13,
      manual: {...original.manual, title: 'synced before cleanup'},
      watchCapture: {
        ...original.watchCapture!,
        samples: changedSamples.slice(0, 160),
        profile: {
          storageKey: guestProfileKey2,
          contentRevision: 'revision-2',
          sampleCount: changedSamples.length,
        },
      },
    };
    await guest.logbook.save(changed);
    const profileSnapshot = createProfileBytesSnapshot(changedSamples, {
      localSessionId: changed.watchCapture!.session.localSessionId,
      sampleCount: changedSamples.length,
    });
    const reconciledRevision = isDeterministicAlias
      ? `revision-2:reconciled:${profileSnapshot.sha256.slice(0, 16)}`
      : 'revision-2:reconciled:0000000000000000';
    const accountProfileKey = `${dataProfileKeyPrefix({
      kind: 'user',
      userId,
    })}session-log-a:${encodeURIComponent(reconciledRevision)}`;
    await profile.write(accountProfileKey, changedSamples);
    const accountValue: DiveLogEntry = {
      ...changed,
      ownerUserId: userId,
      remoteId: uuid('3', 2),
      remoteRevision: 2,
      cloudSyncStatus: 'synced',
      watchCapture: {
        ...changed.watchCapture!,
        profile: {
          ...changed.watchCapture!.profile!,
          storageKey: accountProfileKey,
          contentRevision: reconciledRevision,
          sha256: profileSnapshot.sha256,
        },
      },
    };
    const account = repositories([accountValue], [], [], 'account');
    const outbox = new AccountOutbox({
      storage: metadataStorage,
      storageKey: dataStorageKeys({kind: 'user', userId}).outbox,
      now: clock(),
      jitter: () => 0,
    });
    const accountMutations = createAccountLocalFirstRepositories({
      userId,
      repositories: account,
      outbox,
      createId: () => uuid('9', 1),
      now: clock(),
    });
    const service = claimService({
      store,
      guest,
      account,
      accountMutations,
      profile,
      remote: remoteRepository(store),
    });

    const result = await service.resume();

    expect(result?.manifest.status).toBe('committed');
    await expect(guest.logbook.get('log-a')).resolves.toBeUndefined();
    await expect(outbox.list(userId)).resolves.toHaveLength(
      isDeterministicAlias ? 0 : 1,
    );
    if (isDeterministicAlias) {
      expect(account.logbook.save).not.toHaveBeenCalled();
    } else {
      expect(account.logbook.save).toHaveBeenCalled();
    }
    await expect(account.logbook.get('log-a')).resolves.toMatchObject({
      remoteRevision: 2,
      cloudSyncStatus: isDeterministicAlias ? 'synced' : 'pending',
      manual: {title: 'synced before cleanup'},
    });
    await expect(account.logbook.getWatchProfile('log-a')).resolves.toEqual(
      changedSamples,
    );
    },
  );

  it('promotes a changed plan as a pending account update before guest deletion', async () => {
    const order: string[] = [];
    const metadataStorage = new InMemoryKeyValueStore();
    const profile = profileStorage();
    const original = divePlan('plan-a');
    const changed: DivePlan = {
      ...original,
      updatedAt: 12,
      site: {name: 'Changed Reef'},
      checklistItems: [
        {id: 'item-a', label: 'Changed item', completed: true},
      ],
    };
    const guest = repositories([], [original], order);
    const account = repositories([], [], order, 'account');
    const outbox = new AccountOutbox({
      storage: metadataStorage,
      storageKey: dataStorageKeys({kind: 'user', userId}).outbox,
      now: clock(),
      jitter: () => 0,
    });
    const accountMutations = createAccountLocalFirstRepositories({
      userId,
      repositories: account,
      outbox,
      createId: () => uuid('9', 1),
      now: clock(),
    });
    const enqueue = outbox.enqueue.bind(outbox);
    jest.spyOn(outbox, 'enqueue').mockImplementation(async item => {
      order.push(`outbox:enqueued:${item.entityLocalId}`);
      return enqueue(item);
    });
    const store = new GuestClaimStore({
      storage: metadataStorage,
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account,
      accountMutations,
      profile,
      remote,
    });
    await service.prepare();
    await service.defer();
    await guest.planbook.save(changed);

    const result = await service.retry();

    expect(result?.manifest.status).toBe('committed');
    await expect(guest.planbook.get('plan-a')).resolves.toBeUndefined();
    await expect(account.planbook.get('plan-a')).resolves.toMatchObject({
      site: {name: 'Changed Reef'},
      checklistItems: [
        {id: 'item-a', label: 'Changed item', completed: true},
      ],
      ownerUserId: userId,
      remoteId: uuid('3', 1),
      remoteRevision: 1,
      cloudSyncStatus: 'pending',
    });
    await expect(outbox.list(userId)).resolves.toEqual([
      expect.objectContaining({
        entityKind: 'plan',
        entityLocalId: 'plan-a',
        mutation: 'upsert',
        expectedRevision: 1,
        payload: expect.objectContaining({
          local: expect.objectContaining({
            site: {name: 'Changed Reef'},
            remoteId: uuid('3', 1),
            remoteRevision: 1,
            cloudSyncStatus: 'pending',
          }),
        }),
      }),
    ]);
    expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(1);
    expect(order.indexOf('outbox:enqueued:plan-a')).toBeLessThan(
      order.indexOf('guest:delete:plan:plan-a'),
    );
  });

  it('repairs a pending Watch log relationship when its deferred plan is claimed', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const originalPlan = divePlan('plan-a');
    const guest = repositories([], [originalPlan]);
    const account = repositories([], [], [], 'account');
    const outbox = new AccountOutbox({
      storage: metadataStorage,
      storageKey: dataStorageKeys({kind: 'user', userId}).outbox,
      now: clock(),
      jitter: () => 0,
    });
    const accountMutations = createAccountLocalFirstRepositories({
      userId,
      repositories: account,
      outbox,
      createId: () => uuid('9', 1),
      now: clock(),
    });
    const store = new GuestClaimStore({
      storage: metadataStorage,
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account,
      accountMutations,
      profile: profileStorage(),
      remote,
    });
    await service.prepare();
    await service.defer();

    const pendingWatchLog: DiveLogEntry = {
      ...diveLog('watch-log-after-defer'),
      source: 'watch',
      updatedAt: 12,
      watchCapture: {
        importKey: 'watch-log-after-defer:12',
        importedAt: 12,
        session: {
          localSessionId: 'session-watch-log-after-defer',
          sourcePlanLocalId: originalPlan.localId,
          startedAt: 10,
          samples: [],
        },
        measuredValues: {startedAt: 10},
        samples: [],
      },
    };
    await accountMutations.logbook.save(pendingWatchLog);
    await guest.planbook.save({
      ...originalPlan,
      status: 'completed',
      completedAt: 12,
      convertedLogLocalId: pendingWatchLog.localId,
      updatedAt: 12,
    });

    const result = await service.retry();

    expect(result?.manifest.status).toBe('committed');
    const operations = await outbox.list(userId);
    expect(
      operations.map(operation => [operation.entityKind, operation.entityLocalId]),
    ).toEqual([
      ['log', pendingWatchLog.localId],
      ['plan', originalPlan.localId],
      ['log', pendingWatchLog.localId],
    ]);
    expect((operations[0]!.payload.remote as RemoteDiveLog).payload).toMatchObject({
      source_plan_id: null,
    });
    expect((operations[1]!.payload.remote as RemoteDivePlan).payload).toMatchObject({
      converted_log_id: uuid('9', 1),
    });
    expect((operations[2]!.payload.remote as RemoteDiveLog).payload).toMatchObject({
      source_plan_id: uuid('3', 1),
    });
    await expect(account.logbook.get(pendingWatchLog.localId)).resolves.toMatchObject({
      remoteId: uuid('9', 1),
      cloudSyncStatus: 'pending',
      watchCapture: {
        session: {sourcePlanLocalId: originalPlan.localId},
      },
    });
    await expect(account.planbook.get(originalPlan.localId)).resolves.toMatchObject({
      convertedLogLocalId: pendingWatchLog.localId,
      remoteId: uuid('3', 1),
      cloudSyncStatus: 'pending',
    });
    await expect(guest.planbook.get(originalPlan.localId)).resolves.toBeUndefined();
    expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(1);
  });

  it('promotes a post-snapshot converted log before its changed source plan', async () => {
    const order: string[] = [];
    const deletionQueueSizes: number[] = [];
    const metadataStorage = new InMemoryKeyValueStore();
    const profile = profileStorage();
    const originalPlan = divePlan('plan-a');
    const guest = repositories([], [originalPlan], order);
    const account = repositories([], [], order, 'account');
    const outbox = new AccountOutbox({
      storage: metadataStorage,
      storageKey: dataStorageKeys({kind: 'user', userId}).outbox,
      now: clock(),
      jitter: () => 0,
    });
    const accountMutations = createAccountLocalFirstRepositories({
      userId,
      repositories: account,
      outbox,
      createId: () => uuid('9', 1),
      now: clock(),
    });
    const enqueue = outbox.enqueue.bind(outbox);
    let interruptedPlan = false;
    jest.spyOn(outbox, 'enqueue').mockImplementation(async operation => {
      if (operation.entityKind === 'plan' && !interruptedPlan) {
        interruptedPlan = true;
        throw new Error('forced exit before root plan outbox publication');
      }
      return enqueue(operation);
    });
    const deleteLog = guest.logbook.delete.getMockImplementation()!;
    guest.logbook.delete.mockImplementation(async (localId, options) => {
      deletionQueueSizes.push((await outbox.list(userId)).length);
      return deleteLog(localId, options);
    });
    const deletePlan = guest.planbook.delete.getMockImplementation()!;
    guest.planbook.delete.mockImplementation(async localId => {
      deletionQueueSizes.push((await outbox.list(userId)).length);
      return deletePlan(localId);
    });
    const store = new GuestClaimStore({
      storage: metadataStorage,
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account,
      accountMutations,
      profile,
      remote,
    });
    await service.prepare();
    await service.defer();

    const samples = depthSamples(200).map(sample => ({
      ...sample,
      localSessionId: 'session-log-new',
    }));
    const profileKey = `${dataProfileKeyPrefix({
      kind: 'guest',
    })}session-log-new:revision-1`;
    await profile.write(profileKey, samples);
    const postSnapshotLog: DiveLogEntry = {
      ...watchLog('log-new', samples.slice(0, 160)),
      updatedAt: 12,
      watchCapture: {
        ...watchLog('log-new', []).watchCapture!,
        session: {
          ...watchLog('log-new', []).watchCapture!.session,
          sourcePlanLocalId: 'plan-a',
        },
        samples: samples.slice(0, 160),
        profile: {
          storageKey: profileKey,
          contentRevision: 'revision-1',
          sampleCount: samples.length,
        },
      },
    };
    await guest.logbook.save(postSnapshotLog);
    await guest.planbook.save({
      ...originalPlan,
      status: 'completed',
      updatedAt: 13,
      convertedLogLocalId: postSnapshotLog.localId,
    });

    const interrupted = await service.retry();

    expect(interrupted?.manifest.status).toBe('cleanupPending');
    await expect(outbox.list(userId)).resolves.toEqual([
      expect.objectContaining({entityKind: 'log', entityLocalId: 'log-new'}),
    ]);
    expect(deletionQueueSizes).toEqual([]);
    await expect(guest.logbook.get('log-new')).resolves.toBeDefined();
    await expect(guest.planbook.get('plan-a')).resolves.toBeDefined();

    const result = await service.retry();

    expect(result?.manifest.status).toBe('committed');
    const operations = await outbox.list(userId);
    expect(
      operations.map(operation => [operation.entityKind, operation.entityLocalId]),
    ).toEqual([
      ['log', 'log-new'],
      ['plan', 'plan-a'],
    ]);
    expect((operations[0]!.payload.remote as RemoteDiveLog).payload).toMatchObject({
      source_plan_id: uuid('3', 1),
    });
    expect((operations[1]!.payload.remote as RemoteDivePlan).payload).toMatchObject({
      converted_log_id: uuid('9', 1),
    });
    await expect(outbox.readProfileSnapshot(operations[0]!)).resolves.toBe(
      JSON.stringify(samples),
    );
    expect(deletionQueueSizes).toEqual([2, 2]);
    await expect(guest.logbook.get('log-new')).resolves.toBeUndefined();
    await expect(guest.planbook.get('plan-a')).resolves.toBeUndefined();
    expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(1);
  });

  it('promotes a post-snapshot source plan before its changed log', async () => {
    const deletionQueueSizes: number[] = [];
    const metadataStorage = new InMemoryKeyValueStore();
    const profile = profileStorage();
    const originalLog = diveLog('log-a');
    const guest = repositories([originalLog], []);
    const account = repositories([], [], [], 'account');
    const outbox = new AccountOutbox({
      storage: metadataStorage,
      storageKey: dataStorageKeys({kind: 'user', userId}).outbox,
      now: clock(),
      jitter: () => 0,
    });
    const accountMutations = createAccountLocalFirstRepositories({
      userId,
      repositories: account,
      outbox,
      createId: () => uuid('9', 1),
      now: clock(),
    });
    const deleteLog = guest.logbook.delete.getMockImplementation()!;
    guest.logbook.delete.mockImplementation(async (localId, options) => {
      deletionQueueSizes.push((await outbox.list(userId)).length);
      return deleteLog(localId, options);
    });
    const deletePlan = guest.planbook.delete.getMockImplementation()!;
    guest.planbook.delete.mockImplementation(async localId => {
      deletionQueueSizes.push((await outbox.list(userId)).length);
      return deletePlan(localId);
    });
    const store = new GuestClaimStore({
      storage: metadataStorage,
      userId,
      now: clock(),
    });
    const service = claimService({
      store,
      guest,
      account,
      accountMutations,
      profile,
      remote: remoteRepository(store),
    });
    await service.prepare();
    await service.defer();

    const samples = depthSamples(200);
    const profileKey = `${dataProfileKeyPrefix({
      kind: 'guest',
    })}session-log-a:revision-2`;
    await profile.write(profileKey, samples);
    const changedLog: DiveLogEntry = {
      ...watchLog('log-a', samples.slice(0, 160)),
      updatedAt: 13,
      watchCapture: {
        ...watchLog('log-a', samples.slice(0, 160)).watchCapture!,
        session: {
          ...watchLog('log-a', []).watchCapture!.session,
          sourcePlanLocalId: 'plan-new',
        },
        profile: {
          storageKey: profileKey,
          contentRevision: 'revision-2',
          sampleCount: samples.length,
        },
      },
    };
    await guest.planbook.save({
      ...divePlan('plan-new', changedLog.localId),
      updatedAt: 12,
    });
    await guest.logbook.save(changedLog);

    const result = await service.retry();

    expect(result?.manifest.status).toBe('committed');
    const operations = await outbox.list(userId);
    expect(
      operations.map(operation => [operation.entityKind, operation.entityLocalId]),
    ).toEqual([
      ['plan', 'plan-new'],
      ['log', 'log-a'],
    ]);
    expect((operations[0]!.payload.remote as RemoteDivePlan).payload).toMatchObject({
      converted_log_id: uuid('3', 2),
    });
    expect((operations[1]!.payload.remote as RemoteDiveLog).payload).toMatchObject({
      source_plan_id: uuid('9', 1),
    });
    expect(deletionQueueSizes).toEqual([2, 2]);
    await expect(guest.planbook.get('plan-new')).resolves.toBeUndefined();
    await expect(guest.logbook.get('log-a')).resolves.toBeUndefined();
  });

  it('rejects non-identical downloaded profile bytes before progress increments', async () => {
    const profile = profileStorage();
    const fullSamples = depthSamples(200);
    await profile.write(guestProfileKey, fullSamples);
    const guest = repositories(
      [watchLog('log-a', fullSamples.slice(0, 160))],
      [],
    );
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store, [], {
      downloadProfile: jest.fn(async () =>
        new TextEncoder().encode(JSON.stringify(fullSamples, null, 2)),
      ),
    });
    const progress: number[] = [];
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile,
      remote,
      onProgress: value => progress.push(value.completed),
    });

    const result = await service.start();

    expect(result?.manifest.status).toBe('failed');
    expect(result?.errorCode).toBe('profile_corrupt');
    expect(result?.failure).toEqual({
      phase: 'uploading',
      entityKind: 'log',
      clientRecordId: 'log-a',
      label: 'Local Reef',
    });
    expect(progress).toEqual([0]);
    expect(remote.attachProfile).not.toHaveBeenCalled();
  });

  it('creates a new manifest for guest rows added after a committed snapshot', async () => {
    const guest = repositories([diveLog('log-a')], []);
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });
    const first = await service.start();
    await guest.logbook.save(diveLog('log-b'));

    const second = await service.prepare();

    expect(second?.manifest.items.map(item => item.clientRecordId)).toEqual([
      'log-b',
    ]);
    expect(second?.manifest.clientBatchId).not.toBe(
      first?.manifest.clientBatchId,
    );
  });

  it('persists cleanupPending, hides claimed ids, and retries cleanup without finalizing twice', async () => {
    const order: string[] = [];
    const guest = repositories([diveLog('log-a')], [], order);
    const deleteLog = guest.logbook.delete.getMockImplementation()!;
    guest.logbook.delete
      .mockImplementationOnce(async () => {
        order.push('forced-exit:log-a');
        throw new Error('cleanup failed');
      })
      .mockImplementationOnce(deleteLog);
    const store = new GuestClaimStore({
      storage: new RecordingStorage(order),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store, order);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
      order,
    });

    const first = await service.start();

    expect(first?.manifest.status).toBe('cleanupPending');
    await expect(service.hiddenGuestIds()).resolves.toEqual({
      logIds: new Set(['log-a']),
      planIds: new Set(),
    });
    expect(order.indexOf('persist:committed')).toBeLessThan(
      order.indexOf('persist:cleanupPending'),
    );
    expect(order.indexOf('persist:cleanupPending')).toBeLessThan(
      order.indexOf('forced-exit:log-a'),
    );

    const retried = await service.retry();

    expect(retried?.manifest.status).toBe('committed');
    expect(remote.finalize).toHaveBeenCalledTimes(1);
    expect(remote.listCommittedBatch).toHaveBeenCalledTimes(1);
    expect(guest.logbook.delete).toHaveBeenCalledTimes(2);
  });

  it('reconciles a full guest inventory with one bulk delete per entity', async () => {
    const logs = Array.from({length: 15}, (_, index) =>
      diveLog(`bulk-log-${index}`),
    );
    const plans = Array.from({length: 3}, (_, index) =>
      divePlan(`bulk-plan-${index}`),
    );
    const guest = repositories(logs, plans);
    guest.logbook.deleteManyIf = jest.fn(async requests => {
      const results = new Map<string, 'deleted' | 'conditionFailed' | 'notFound'>();
      for (const request of requests) {
        const current = logs.find(value => value.localId === request.localId);
        if (current === undefined) {
          results.set(request.localId, 'notFound');
        } else if (!request.predicate(structuredClone(current))) {
          results.set(request.localId, 'conditionFailed');
        } else {
          await guest.logbook.delete(request.localId, {
            retainProfileAfterDelete: true,
          });
          results.set(request.localId, 'deleted');
        }
      }
      return results;
    });
    guest.planbook.deleteManyIf = jest.fn(async requests => {
      const results = new Map<string, 'deleted' | 'conditionFailed' | 'notFound'>();
      for (const request of requests) {
        const current = plans.find(value => value.localId === request.localId);
        if (current === undefined) {
          results.set(request.localId, 'notFound');
        } else if (!request.predicate(structuredClone(current))) {
          results.set(request.localId, 'conditionFailed');
        } else {
          await guest.planbook.delete(request.localId);
          results.set(request.localId, 'deleted');
        }
      }
      return results;
    });
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    let remoteOrdinal = 0;
    const remote = remoteRepository(store, [], {
      stageRecord: jest.fn(async () => {
        remoteOrdinal += 1;
        return {
          stagingRecordId: uuid('2', remoteOrdinal),
          targetRecordId: uuid('3', remoteOrdinal),
        };
      }),
    });
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });

    const result = await service.start();

    expect(result).toMatchObject({
      manifest: {status: 'committed'},
      snapshots: [],
    });
    expect(guest.logbook.deleteManyIf).toHaveBeenCalledTimes(1);
    expect(guest.planbook.deleteManyIf).toHaveBeenCalledTimes(1);
    expect(guest.logbook.get).not.toHaveBeenCalled();
    expect(guest.planbook.get).not.toHaveBeenCalled();
    expect(guest.logbook.deleteIf).not.toHaveBeenCalled();
    expect(guest.planbook.deleteIf).not.toHaveBeenCalled();
  });

  it('keeps a changed row retryable when its bulk condition fails', async () => {
    const changedId = 'changed-during-cleanup';
    const guest = repositories([diveLog(changedId)], []);
    guest.logbook.deleteManyIf = jest.fn(async () =>
      new Map([[changedId, 'conditionFailed' as const]]),
    );
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote: remoteRepository(store),
    });

    const result = await service.start();

    expect(result).toMatchObject({
      manifest: {status: 'cleanupPending'},
      errorCode: 'claim_validation_failed',
      failure: {
        phase: 'cleanup',
        clientRecordId: changedId,
      },
    });
    expect(await guest.logbook.get(changedId)).toBeDefined();
  });

  it('resumes cleanup after termination between item deletes', async () => {
    const order: string[] = [];
    const guest = repositories([diveLog('log-a'), diveLog('log-b')], [], order);
    const deleteLog = guest.logbook.delete.getMockImplementation()!;
    guest.logbook.delete.mockImplementation(async localId => {
      if (localId === 'log-b') {
        order.push('forced-exit:log-b');
        throw new Error('forced exit');
      }
      return deleteLog(localId);
    });
    const store = new GuestClaimStore({
      storage: new RecordingStorage(order),
      userId,
      now: clock(),
    });
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote: remoteRepository(store, order),
      order,
    });

    const interrupted = await service.start();

    expect(interrupted?.manifest.status).toBe('cleanupPending');
    expect(order.indexOf('persist:cleanupPending')).toBeLessThan(
      order.indexOf('guest:delete:log:log-a'),
    );
    await expect(guest.logbook.get('log-a')).resolves.toBeUndefined();
    await expect(guest.logbook.get('log-b')).resolves.toBeDefined();

    guest.logbook.delete.mockImplementation(deleteLog);
    const resumed = await service.retry();

    expect(resumed?.manifest.status).toBe('committed');
    await expect(guest.logbook.list()).resolves.toEqual([]);
  });

  it('rejects cleanup of a foreign-principal profile key', async () => {
    const profile = profileStorage();
    const samples = depthSamples(200);
    await profile.write(guestProfileKey, samples);
    const guest = repositories([watchLog('log-a', samples.slice(0, 160))], []);
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guest.logbook,
      planRepository: guest.planbook,
      profileStorage: profile,
      now: () => 100,
    });
    const foreignKey = `${dataProfileKeyPrefix({
      kind: 'user',
      userId: otherUserId,
    })}session-log-a:revision-1`;
    snapshot.manifest.status = 'cleanupPending';
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.manifest.items[0] = {
      ...snapshot.manifest.items[0]!,
      profile: {
        ...snapshot.manifest.items[0]!.profile!,
        storageKey: foreignKey,
      },
      stagingRecordId: uuid('2', 1),
      targetRecordId: uuid('3', 1),
      completedAt: 101,
    };
    const local = JSON.parse(
      snapshot.snapshots[0]!.localRecordBytes,
    ) as DiveLogEntry;
    local.watchCapture!.profile!.storageKey = foreignKey;
    snapshot.snapshots[0]!.localRecordBytes = JSON.stringify(local);
    const writes: GuestClaimSnapshot[] = [];
    const service = new GuestClaimService({
      userId,
      store: {
        read: async () => structuredClone(snapshot),
        write: async value => {
          writes.push(structuredClone(value));
        },
      },
      guestRepositories: guest,
      accountRepositories: repositories([], []),
      accountMutationRepositories: repositories([], []),
      profileStorage: profile,
      remoteRepository: remoteRepository(
        new GuestClaimStore({
          storage: new InMemoryKeyValueStore(),
          userId,
        }),
      ),
      now: clock(),
    });

    const result = await service.resume();

    expect(result?.manifest.status).toBe('cleanupPending');
    expect(guest.logbook.delete).not.toHaveBeenCalled();
    expect(profile.remove).not.toHaveBeenCalledWith(foreignKey);
    expect(writes.at(-1)?.manifest.status).toBe('cleanupPending');
  });

  it('maps transient repository errors and resumes the same batch', async () => {
    const guest = repositories([diveLog('log-a')], []);
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const stage = remote.stageRecord.getMockImplementation()!;
    const networkError = new GuestClaimRepositoryError(
      'stage',
      'network_unavailable',
    );
    remote.stageRecord
      .mockRejectedValueOnce(networkError)
      .mockImplementation(stage);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });

    const failed = await service.start();
    const resumed = await service.resume();

    expect(failed?.errorCode).toBe('network_unavailable');
    expect(resumed?.manifest.status).toBe('committed');
    expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(2);
    expect(remote.createOrLoadBatch.mock.calls[1]?.[0]).toEqual(
      remote.createOrLoadBatch.mock.calls[0]?.[0],
    );
  });

  it.each([
    'claim_validation_failed',
    'session_expired',
    'remote_conflict',
  ] as const)('does not auto-resume a %s failure', async errorCode => {
    const guest = repositories([diveLog('log-a')], []);
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guest.logbook,
      planRepository: guest.planbook,
      profileStorage: profileStorage(),
      now: () => 100,
    });
    snapshot.manifest.status = 'failed';
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.errorCode = errorCode;
    await store.write(snapshot);
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });

    const result = await service.resume();

    expect(result).toEqual(snapshot);
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();
    expect(remote.stageRecord).not.toHaveBeenCalled();
    expect(remote.finalize).not.toHaveBeenCalled();
  });

  it('finishes idempotent account publication after the second local copy fails', async () => {
    const guest = repositories([diveLog('log-a'), diveLog('log-b')], []);
    const account = repositories([], [], [], 'account');
    const save = account.logbook.save.getMockImplementation()!;
    let failedOnce = false;
    account.logbook.save.mockImplementation(async value => {
      if (value.localId === 'log-b' && !failedOnce) {
        failedOnce = true;
        throw new Error('second account copy failed');
      }
      return save(value);
    });
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account,
      profile: profileStorage(),
      remote,
    });

    const failed = await service.start();

    expect(failed?.manifest.status).toBe('failed');
    await expect(account.logbook.list()).resolves.toHaveLength(1);
    await expect(guest.logbook.list()).resolves.toHaveLength(2);

    const resumed = await service.retry();

    expect(resumed?.manifest.status).toBe('committed');
    await expect(account.logbook.list()).resolves.toHaveLength(2);
    await expect(guest.logbook.list()).resolves.toEqual([]);
  });

  it('rejects defer while cleanup is pending', async () => {
    const guest = repositories([diveLog('log-a')], []);
    guest.logbook.delete.mockRejectedValue(new Error('cleanup unavailable'));
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote: remoteRepository(store),
    });
    await service.start();

    await expect(service.defer()).rejects.toMatchObject({
      code: 'claim_validation_failed',
    });
    await expect(store.read()).resolves.toMatchObject({
      manifest: { status: 'cleanupPending' },
    });
  });

  it.each(['running', 'finalizing', 'cleanupPending', 'committed'] as const)(
    'does not defer or replace a %s manifest',
    async status => {
      const guest = repositories([diveLog('log-a')], []);
      const snapshot = await createGuestClaimSnapshot({
        userId,
        logbookRepository: guest.logbook,
        planRepository: guest.planbook,
        profileStorage: profileStorage(),
        now: () => 100,
      });
      snapshot.manifest.status = status;
      const write = jest.fn(async () => undefined);
      const remove = jest.fn(async () => undefined);
      const service = new GuestClaimService({
        userId,
        store: {
          read: async () => structuredClone(snapshot),
          write,
          remove,
        },
        guestRepositories: guest,
        accountRepositories: repositories([], []),
        accountMutationRepositories: repositories([], []),
        profileStorage: profileStorage(),
        remoteRepository: remoteRepository(
          new GuestClaimStore({
            storage: new InMemoryKeyValueStore(),
            userId,
          }),
        ),
      });

      await expect(service.defer()).rejects.toMatchObject({
        code: 'claim_validation_failed',
      });
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it('fails closed for a second user or mismatched committed readback', async () => {
    const storage = new InMemoryKeyValueStore();
    const guest = repositories([diveLog('log-a')], []);
    const store = new GuestClaimStore({ storage, userId, now: clock() });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guest.logbook,
      planRepository: guest.planbook,
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const foreignService = new GuestClaimService({
      userId: otherUserId,
      store: { read: async () => snapshot, write: async () => undefined },
      guestRepositories: guest,
      accountRepositories: repositories([], []),
      accountMutationRepositories: repositories([], []),
      profileStorage: profileStorage(),
      remoteRepository: remoteRepository(store),
      now: clock(),
    });
    await expect(foreignService.resume()).rejects.toMatchObject({
      code: 'claim_validation_failed',
    });

    const remote = remoteRepository(store, [], {
      listCommittedBatch: jest.fn(async () => ({
        plans: [],
        logs: [remoteLog('wrong-local-id')],
      })),
    });
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });
    const result = await service.start();

    expect(result?.manifest.status).toBe('failed');
    expect(result?.errorCode).toBe('remote_conflict');
    expect(guest.logbook.delete).not.toHaveBeenCalled();
  });

  it('claims valid records while preserving a log with a missing immutable profile', async () => {
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const guest = repositories(
      [diveLog('manual-a'), watchLog('log-a', [])],
      [],
    );
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });

    const result = await service.start();

    expect(result).toMatchObject({
      manifest: {status: 'committed', logCount: 1, planCount: 0},
      retainedItems: [
        expect.objectContaining({
          entityKind: 'log',
          clientRecordId: 'log-a',
          reason: 'profile_missing',
        }),
      ],
    });
    expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(1);
    expect(remote.stageRecord).toHaveBeenCalledTimes(1);
    await expect(guest.logbook.get('manual-a')).resolves.toBeUndefined();
    await expect(guest.logbook.get('log-a')).resolves.toBeDefined();
  });

  it('keeps an all-retained snapshot terminal without any remote request', async () => {
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const profile = profileStorage();
    const service = claimService({
      store,
      guest: repositories([watchLog('log-a', [])], []),
      account: repositories([], []),
      profile,
      remote,
    });

    const first = await service.start();
    const readsAfterFirstCheck = jest.mocked(profile.read).mock.calls.length;
    const second = await service.prepare();

    expect(first?.manifest.status).toBe('retained');
    expect(second).toEqual(first);
    expect(profile.read).toHaveBeenCalledTimes(readsAfterFirstCheck);
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();
    expect(remote.stageRecord).not.toHaveBeenCalled();
    expect(remote.finalize).not.toHaveBeenCalled();
  });

  it('imports a retained log after an explicit recheck finds its restored profile', async () => {
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const profile = profileStorage();
    const guest = repositories([watchLog('log-a', [])], []);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile,
      remote,
    });
    await service.start();
    await profile.write(guestProfileKey, depthSamples(200));

    const result = await service.recheckRetained();

    expect(result).toMatchObject({
      manifest: {status: 'committed', logCount: 1},
      retainedItems: [],
    });
    expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(1);
    await expect(guest.logbook.get('log-a')).resolves.toBeUndefined();
  });

  it('preserves the terminal snapshot when an explicit recheck cannot build a replacement', async () => {
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const profile = profileStorage();
    const service = claimService({
      store,
      guest: repositories([watchLog('log-a', [])], []),
      account: repositories([], []),
      profile,
      remote: remoteRepository(store),
    });
    const terminal = await service.start();
    jest.mocked(profile.read).mockRejectedValueOnce(
      new Error('profile storage temporarily unavailable'),
    );

    await expect(service.recheckRetained()).rejects.toMatchObject({
      code: 'claim_validation_failed',
    });
    await expect(store.read()).resolves.toEqual(terminal);
  });
});

function claimService(input: {
  store: GuestClaimStore;
  guest: PrincipalRepositories;
  account: PrincipalRepositories;
  accountMutations?: PrincipalRepositories;
  profile: WatchProfileStorage;
  remote: jest.Mocked<GuestClaimRemoteRepository>;
  order?: string[];
  onProgress?: ConstructorParameters<typeof GuestClaimService>[0]['onProgress'];
}) {
  return new GuestClaimService({
    userId,
    store: input.store,
    guestRepositories: input.guest,
    accountRepositories: input.account,
    accountMutationRepositories: input.accountMutations ?? input.account,
    profileStorage: input.profile,
    remoteRepository: input.remote,
    now: clock(),
    onProgress: input.onProgress,
  });
}

function remoteRepository(
  store: GuestClaimStore,
  order: string[] = [],
  overrides: Partial<GuestClaimRemoteRepository> = {},
): jest.Mocked<GuestClaimRemoteRepository> {
  const uploaded = new Map<string, Uint8Array>();
  const repository: GuestClaimRemoteRepository = {
    async createOrLoadBatch() {
      order.push('remote:batch');
      return { id: batchId, status: 'uploading' };
    },
    async stageRecord(input) {
      order.push(`remote:stage:${input.entityKind}:${input.clientRecordId}`);
      return targetFor(input);
    },
    async attachProfile() {
      order.push('remote:attach-profile');
    },
    async uploadProfile(path, bytes) {
      order.push('remote:upload-profile');
      uploaded.set(path, bytes);
    },
    async downloadProfile(path) {
      order.push('remote:download-profile');
      const bytes = uploaded.get(path);
      if (!bytes) {
        throw new Error('missing upload');
      }
      return bytes;
    },
    async finalize() {
      order.push('remote:finalize');
      const snapshot = await store.read();
      return {
        status: 'committed',
        planCount: snapshot?.manifest.planCount ?? 0,
        logCount: snapshot?.manifest.logCount ?? 0,
      };
    },
    async listCommittedBatch() {
      order.push('remote:list');
      const snapshot = await store.read();
      if (!snapshot) {
        throw new Error('missing snapshot');
      }
      return committedRows(snapshot);
    },
    ...overrides,
  };
  return {
    createOrLoadBatch: jest.fn(repository.createOrLoadBatch),
    stageRecord: jest.fn(repository.stageRecord),
    attachProfile: jest.fn(repository.attachProfile),
    uploadProfile: jest.fn(repository.uploadProfile),
    downloadProfile: jest.fn(repository.downloadProfile),
    finalize: jest.fn(repository.finalize),
    listCommittedBatch: jest.fn(repository.listCommittedBatch),
  };
}

function targetFor(input: GuestClaimStageInput) {
  const ordinal = input.clientRecordId.endsWith('a') ? 1 : 2;
  const offset = input.entityKind === 'plan' ? ordinal : ordinal + 1;
  return {
    stagingRecordId: uuid('2', offset),
    targetRecordId: uuid('3', offset),
  };
}

function committedRows(snapshot: GuestClaimSnapshot): {
  plans: RemoteDivePlan[];
  logs: RemoteDiveLog[];
} {
  const byKey = new Map(snapshot.manifest.items.map(item => [item.key, item]));
  const plans: RemoteDivePlan[] = [];
  const logs: RemoteDiveLog[] = [];
  for (const sidecar of snapshot.snapshots) {
    const item = byKey.get(sidecar.key)!;
    const payload = JSON.parse(sidecar.payloadBytes) as Record<string, unknown>;
    if (item.entityKind === 'plan') {
      payload.converted_log_id = item.convertedLogClientRecordId
        ? (byKey.get(`log:${item.convertedLogClientRecordId}`)
            ?.targetRecordId ?? null)
        : null;
      plans.push({
        id: item.targetRecordId!,
        localId: item.clientRecordId,
        revision: 1,
        payloadSha256: item.payloadSha256,
        payload,
      });
    } else {
      payload.source_plan_id = item.sourcePlanClientRecordId
        ? (byKey.get(`plan:${item.sourcePlanClientRecordId}`)?.targetRecordId ??
          null)
        : null;
      logs.push({
        id: item.targetRecordId!,
        localId: item.clientRecordId,
        revision: 1,
        payloadSha256: item.payloadSha256,
        payload,
        ...(item.profile && snapshot.manifest.remoteBatchId
          ? {
              profilePath: `${userId}/claims/${snapshot.manifest.remoteBatchId}/${item.targetRecordId}/${item.profile.contentRevision}.json`,
            }
          : {}),
      });
    }
  }
  return { plans, logs };
}

function repositories(
  initialLogs: DiveLogEntry[],
  initialPlans: DivePlan[],
  order: string[] = [],
  label = 'guest',
): TestRepositories {
  const logs = new Map(
    initialLogs.map(value => [value.localId, structuredClone(value)]),
  );
  const plans = new Map(
    initialPlans.map(value => [value.localId, structuredClone(value)]),
  );
  const logbook = {
    list: jest.fn(async () =>
      [...logs.values()].map(value => structuredClone(value)),
    ),
    get: jest.fn(async localId => structuredClone(logs.get(localId))),
    save: jest.fn(async value => {
      order.push(`${label}:save:log:${value.localId}`);
      logs.set(value.localId, structuredClone(value));
      return structuredClone(value);
    }),
    delete: jest.fn(async (
      localId,
      options?: Parameters<DiveLogRepository['delete']>[1],
    ) => {
      order.push(`${label}:delete:log:${localId}`);
      const profileKey = logs.get(localId)?.watchCapture?.profile?.storageKey;
      logs.delete(localId);
      if (
        options?.retainProfileAfterDelete !== true &&
        profileKey !== undefined &&
        ![...logs.values()].some(
          value => value.watchCapture?.profile?.storageKey === profileKey,
        )
      ) {
        profileRegistry.delete(profileKey);
      }
    }),
    deleteIf: jest.fn(async (
      localId,
      predicate: Parameters<DiveLogRepository['deleteIf']>[1],
      options?: Parameters<DiveLogRepository['deleteIf']>[2],
    ) => {
      const current = logs.get(localId);
      if (current === undefined) {
        return 'notFound' as const;
      }
      if (!predicate(structuredClone(current))) {
        return 'conditionFailed' as const;
      }
      await logbook.delete(localId, options);
      return 'deleted' as const;
    }),
    removeWatchProfileIfUnreferenced: jest.fn(
      async (storageKey: string) => {
        if (
          ![...logs.values()].some(
            value => value.watchCapture?.profile?.storageKey === storageKey,
          )
        ) {
          profileRegistry.delete(storageKey);
        }
      },
    ),
    importWatchMessages: jest.fn(
      async (
        _messages: Parameters<DiveLogRepository['importWatchMessages']>[0],
      ) => [],
    ),
    getWatchProfile: jest.fn(async localId => {
      const key = logs.get(localId)?.watchCapture?.profile?.storageKey;
      return key ? (profileRegistry.get(key) ?? []) : [];
    }),
    readStoredWatchProfile: jest.fn(async localId => {
      const key = logs.get(localId)?.watchCapture?.profile?.storageKey;
      return key ? structuredClone(profileRegistry.get(key)) : undefined;
    }),
  } satisfies jest.Mocked<DiveLogRepository>;
  const planbook = {
    list: jest.fn(async () =>
      [...plans.values()].map(value => structuredClone(value)),
    ),
    get: jest.fn(async localId => structuredClone(plans.get(localId))),
    save: jest.fn(async value => {
      order.push(`${label}:save:plan:${value.localId}`);
      plans.set(value.localId, structuredClone(value));
      return structuredClone(value);
    }),
    delete: jest.fn(async localId => {
      order.push(`${label}:delete:plan:${localId}`);
      plans.delete(localId);
    }),
    deleteIf: jest.fn(async (
      localId,
      predicate: Parameters<DivePlanRepository['deleteIf']>[1],
    ) => {
      const current = plans.get(localId);
      if (current === undefined) {
        return 'notFound' as const;
      }
      if (!predicate(structuredClone(current))) {
        return 'conditionFailed' as const;
      }
      await planbook.delete(localId);
      return 'deleted' as const;
    }),
  } satisfies jest.Mocked<DivePlanRepository>;
  return {
    principal:
      label === 'account' ? { kind: 'user', userId } : { kind: 'guest' },
    queryScope: label === 'account' ? `user:${userId}` : 'guest',
    logbook,
    planbook,
  };
}

const profileRegistry = new Map<string, WatchDepthSample[]>();

function profileStorage(): WatchProfileStorage {
  return {
    write: jest.fn(async (key, samples) => {
      profileRegistry.set(key, structuredClone(samples));
    }),
    read: jest.fn(async key => structuredClone(profileRegistry.get(key))),
    remove: jest.fn(async key => {
      profileRegistry.delete(key);
    }),
  };
}

function diveLog(localId: string, title?: string): DiveLogEntry {
  return {
    localId,
    source: 'manual',
    cloudSyncStatus: 'notConfigured',
    createdAt: 10,
    updatedAt: 11,
    manual: {
      title,
      site: { name: 'Local Reef' },
      buddyIds: [],
      gearIds: [],
      tags: [],
      observedMarineLife: [],
      measuredValues: { startedAt: 10 },
    },
    mobile: { mediaPlaceholders: [] },
    provenance: {},
  };
}

function watchLog(localId: string, preview: WatchDepthSample[]): DiveLogEntry {
  return {
    ...diveLog(localId),
    source: 'watch',
    watchCapture: {
      importKey: `watch:${localId}`,
      importedAt: 11,
      session: {
        localSessionId: `session-${localId}`,
        startedAt: 10,
        samples: [],
      },
      measuredValues: { startedAt: 10 },
      samples: preview,
      profile: {
        storageKey: guestProfileKey,
        contentRevision: 'revision-1',
        sampleCount: 200,
      },
    },
  };
}

function divePlan(localId: string, convertedLogLocalId?: string): DivePlan {
  return {
    localId,
    status: convertedLogLocalId ? 'completed' : 'draft',
    cloudSyncStatus: 'notConfigured',
    createdAt: 10,
    updatedAt: 11,
    convertedLogLocalId,
    site: { name: 'Local Reef' },
    buddyIds: [],
    gearIds: [],
    tags: [],
    plannedValues: {},
    checklistItems: [],
  };
}

function depthSamples(count: number): WatchDepthSample[] {
  return Array.from({ length: count }, (_, index) => ({
    localSessionId: 'session-log-a',
    timestamp: 10 + index,
    depthMeters: index / 10,
  }));
}

function remoteLog(localId: string): RemoteDiveLog {
  return {
    id: uuid('3', 1),
    localId,
    revision: 1,
    payloadSha256: 'a'.repeat(64),
    payload: {},
  };
}

function uuid(prefix: string, ordinal: number): string {
  return `${prefix}0000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
}

function clock(): () => number {
  let value = 100;
  return () => value++;
}

class RecordingStorage implements PersistentKeyValueStore {
  private readonly values = new Map<string, string>();

  constructor(private readonly order: string[]) {}

  async getString(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async setString(key: string, value: string): Promise<void> {
    const parsed = JSON.parse(value) as { manifest?: { status?: string } };
    if (parsed.manifest?.status) {
      this.order.push(`persist:${parsed.manifest.status}`);
    }
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>(nextResolve => {
      resolve = nextResolve;
    }),
    resolve,
  };
}

async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  assertion();
}
