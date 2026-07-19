import type {
  AccountDataRepository,
  AccountMutationResult,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, bytesToUtf8, utf8ToBytes} from '@noble/hashes/utils';
import { LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import { AccountOutbox, type AccountOutboxItem } from '../src/sync/account-outbox';
import { AccountSyncCoordinator } from '../src/sync/account-sync-coordinator';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type {DivePlan} from '../src/types/dive-plan';
import type {WatchDepthSample} from '../src/types/dive-session';

const userId = '00000000-0000-4000-8000-000000000001';
const remoteId = '10000000-0000-4000-8000-000000000001';

const localLog = (overrides: Partial<DiveLogEntry> = {}): DiveLogEntry => ({
  localId: 'local-log-1',
  remoteId,
  remoteRevision: 1,
  ownerUserId: userId,
  source: 'manual',
  cloudSyncStatus: 'pending',
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
  ...overrides,
});

const localPlan = (overrides: Partial<DivePlan> = {}): DivePlan => ({
  localId: 'local-plan-1',
  remoteId,
  remoteRevision: 1,
  ownerUserId: userId,
  cloudSyncStatus: 'synced',
  status: 'draft',
  createdAt: 100,
  updatedAt: 100,
  site: {name: 'Local Reef'},
  buddyIds: [],
  gearIds: [],
  tags: [],
  plannedValues: {},
  checklistItems: [],
  ...overrides,
});

const remoteLog = (overrides: Partial<RemoteDiveLog> = {}): RemoteDiveLog => {
  const {payload: payloadOverride, payloadSha256, ...outerOverrides} = overrides;
  const payload = {
    source: 'manual',
    started_at: '1970-01-01T00:01:40.000Z',
    ended_at: null,
    duration_seconds: null,
    max_depth_meters: null,
    site_name: localLog().manual.site.name ?? null,
    title: null,
    rating: null,
    dive_mode: null,
    manual_data: {
      ...localLog().manual,
      _local_record: {schemaVersion: 1, createdAt: 100, updatedAt: 100},
    },
    mobile_data: localLog().mobile,
    watch_metadata: null,
    provenance: {},
    profile_preview: null,
    profile_content_revision: null,
    profile_sha256: null,
    profile_byte_count: null,
    profile_sample_count: null,
    source_plan_id: null,
    ...(payloadOverride ?? {}),
  };
  return {
    id: remoteId,
    localId: 'local-log-1',
    revision: 1,
    payloadSha256: payloadSha256 ?? canonicalSha256(payload),
    payload,
    ...outerOverrides,
  };
};

const remotePlan = (
  overrides: Partial<RemoteDivePlan> = {},
): RemoteDivePlan => {
  const {payload: payloadOverride, payloadSha256, ...outerOverrides} = overrides;
  const payload = {
    status: 'draft',
    planned_at: null,
    dive_mode: null,
    site_name: 'Local Reef',
    plan_data: {
      localId: 'local-plan-1',
      status: 'draft',
      createdAt: 100,
      updatedAt: 100,
      site: {name: 'Local Reef'},
      buddyIds: [],
      gearIds: [],
      tags: [],
      plannedValues: {},
      checklistItems: [],
      _schemaVersion: 1,
    },
    converted_log_id: null,
    ...(payloadOverride ?? {}),
  };
  return {
    id: remoteId,
    localId: 'local-plan-1',
    revision: 1,
    payloadSha256: payloadSha256 ?? canonicalSha256(payload),
    payload,
    ...outerOverrides,
  };
};

function operation(index = 0, overrides: Partial<AccountOutboxItem> = {}): AccountOutboxItem {
  const local = localLog({localId: `local-log-${index + 1}`});
  const remote = remoteLog({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    localId: local.localId,
  });
  return {
    operationId: `operation-${index + 1}`,
    userId,
    entityKind: 'log',
    entityLocalId: local.localId,
    mutation: 'upsert',
    payload: {local, remote},
    expectedRevision: 1,
    attemptCount: 0,
    nextAttemptAt: 100,
    createdAt: 100,
    ...overrides,
  };
}

function accountRepository(overrides: Partial<AccountDataRepository> = {}): jest.Mocked<AccountDataRepository> {
  return {
    listLogs: jest.fn(async () => ({items: []})),
    listPlans: jest.fn(async () => ({items: []})),
    saveLog: jest.fn(async value => ({status: 'saved', value})),
    savePlan: jest.fn(async value => ({status: 'saved', value})),
    deleteLog: jest.fn(async () => ({status: 'saved', value: remoteLog()})),
    deletePlan: jest.fn(async () => ({
      status: 'saved',
      value: remotePlan({localId: 'plan-1', revision: 2}),
    })),
    ...overrides,
  } as jest.Mocked<AccountDataRepository>;
}

describe('AccountSyncCoordinator', () => {
  it('does no remote work while offline and resumes the persisted queue online', async () => {
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
    const remote = accountRepository();
    await outbox.enqueue(operation());
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      logbookRepository: new LocalDiveLogRepository([localLog()]),
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });

    await expect(coordinator.drain({online: false})).resolves.toEqual({processed: 0, remaining: 1});
    expect(remote.saveLog).not.toHaveBeenCalled();

    await expect(coordinator.drain({online: true})).resolves.toEqual({processed: 1, remaining: 0});
    expect(remote.saveLog).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight drain per user and honors a requested follow-up pass', async () => {
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
    await Promise.all(Array.from({length: 12}, (_, index) => outbox.enqueue(operation(index))));
    const lengthsAtDelivery: number[] = [];
    const remote = accountRepository({
      saveLog: jest.fn(async value => {
        lengthsAtDelivery.push((await outbox.list(userId)).length);
        return {status: 'saved' as const, value};
      }),
    });
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      logbookRepository: new LocalDiveLogRepository(
        Array.from({length: 12}, (_, index) => localLog({localId: `local-log-${index + 1}`})),
      ),
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });

    const first = coordinator.drain({online: true});
    const second = coordinator.drain({online: true});
    expect(second).toBe(first);
    await expect(first).resolves.toEqual({processed: 12, remaining: 0});
    expect(remote.saveLog).toHaveBeenCalledTimes(12);
    expect(lengthsAtDelivery).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('keeps a later same-entity operation blocked behind a delayed failed head', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
      now: () => 100,
      jitter: () => 0,
    });
    await outbox.enqueue(operation());
    await outbox.enqueue(
      operation(0, {operationId: 'operation-2', createdAt: 101}),
    );
    const remote = accountRepository({
      saveLog: jest.fn(async () => {
        throw new Error('offline');
      }),
    });
    const scheduled: Array<{task: () => void; delayMs: number}> = [];
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      logbookRepository: new LocalDiveLogRepository([localLog()]),
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
      schedule: (task, delayMs) => {
        scheduled.push({task, delayMs});
        return {cancel: jest.fn()};
      },
    });

    await coordinator.drain({online: true});

    expect(remote.saveLog).toHaveBeenCalledTimes(1);
    await expect(outbox.list(userId)).resolves.toMatchObject([
      {operationId: 'operation-1', attemptCount: 1, nextAttemptAt: 102},
      {operationId: 'operation-2', attemptCount: 0, nextAttemptAt: 100},
    ]);
    expect(scheduled).toEqual([expect.objectContaining({delayMs: 2_000})]);
    coordinator.pause();
  });

  it('records rerun demand while a single-flight pass is active', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    await outbox.enqueue(operation());
    const firstSave = deferred<AccountMutationResult<RemoteDiveLog>>();
    const remote = accountRepository({
      saveLog: jest
        .fn()
        .mockImplementationOnce(() => firstSave.promise)
        .mockImplementation(async value => ({status: 'saved' as const, value})),
    });
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      logbookRepository: new LocalDiveLogRepository([
        localLog(),
        localLog({localId: 'local-log-2'}),
      ]),
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });

    const firstDrain = coordinator.drain({online: true});
    await Promise.resolve();
    await outbox.enqueue(operation(1));
    const requestedDuringFlight = coordinator.drain({online: true});
    firstSave.resolve({status: 'saved', value: remoteLog()});
    await Promise.all([firstDrain, requestedDuringFlight]);

    expect(remote.saveLog).toHaveBeenCalledTimes(2);
    await expect(outbox.list(userId)).resolves.toEqual([]);
  });

  it('schedules another max-ten pass when immediately due work remains', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    await Promise.all(
      Array.from({length: 12}, (_, index) => outbox.enqueue(operation(index))),
    );
    const scheduled: Array<() => void> = [];
    const remote = accountRepository();
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      logbookRepository: new LocalDiveLogRepository(
        Array.from({length: 12}, (_, index) =>
          localLog({localId: `local-log-${index + 1}`}),
        ),
      ),
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
      schedule: task => {
        scheduled.push(task);
        return {cancel: jest.fn()};
      },
    });

    await expect(coordinator.drain({online: true})).resolves.toEqual({
      processed: 10,
      remaining: 2,
    });
    expect(remote.saveLog).toHaveBeenCalledTimes(10);
    expect(scheduled).toHaveLength(1);

    scheduled.shift()?.();
    await flushPromises();
    expect(remote.saveLog).toHaveBeenCalledTimes(12);
    await expect(outbox.list(userId)).resolves.toEqual([]);
    coordinator.pause();
  });

  it('uploads a referenced profile before saving metadata', async () => {
    const order: string[] = [];
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
    const remoteValue = remoteLog({profilePath: `${userId}/logs/${remoteId}/revision-1.json`});
    const snapshot = [
      {localSessionId: 'watch-1', timestamp: 100, depthMeters: 3},
    ];
    const serializedSnapshot = JSON.stringify(snapshot);
    const profileStorageKey = await outbox.writeProfileSnapshot(
      userId,
      'operation-1',
      serializedSnapshot,
    );
    remoteValue.payload.profile_sha256 = bytesToHex(
      sha256(utf8ToBytes(serializedSnapshot)),
    );
    remoteValue.payload.profile_content_revision = 'revision-1';
    remoteValue.payload.profile_sample_count = 1;
    remoteValue.payload.profile_byte_count = utf8ToBytes(serializedSnapshot).length;
    remoteValue.payloadSha256 = canonicalSha256(remoteValue.payload);
    const queuedLocal = localLog({
      source: 'watch',
      watchCapture: {
        importKey: 'watch-1:100',
        importedAt: 100,
        session: {localSessionId: 'watch-1', startedAt: 100, samples: []},
        measuredValues: {startedAt: 100},
        samples: snapshot,
        profile: {
          storageKey: 'source-profile-key',
          contentRevision: 'revision-1',
          sampleCount: 1,
          sha256: remoteValue.payload.profile_sha256 as string,
        },
      },
    });
    await outbox.enqueue(operation(0, {
      profileStorageKey,
      payload: {local: queuedLocal, remote: remoteValue},
    }));
    const remote = accountRepository({
      saveLog: jest.fn(async value => {
        order.push('metadata');
        return {status: 'saved' as const, value};
      }),
    });
    const profileUploader = {
      uploadProfile: jest.fn(async (_path: string, _bytes: Uint8Array) => {
        order.push('profile');
      }),
    };
    const logbook = new LocalDiveLogRepository([localLog({
      watchCapture: {
        importKey: 'watch-1:100',
        importedAt: 100,
        session: {localSessionId: 'watch-1', startedAt: 100, samples: []},
        measuredValues: {startedAt: 100},
        samples: [{localSessionId: 'watch-1', timestamp: 100, depthMeters: 9}],
        profile: {
          storageKey: 'current-profile-key',
          contentRevision: 'revision-1',
          sampleCount: 1,
        },
      },
    })]);
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      profileUploader,
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });

    await coordinator.drain({online: true});

    expect(order).toEqual(['profile', 'metadata']);
    expect(profileUploader.uploadProfile).toHaveBeenCalledWith(
      remoteValue.profilePath,
      expect.any(Uint8Array),
    );
    expect(
      bytesToUtf8(profileUploader.uploadProfile.mock.calls[0][1]),
    ).toBe(serializedSnapshot);
    await expect(outbox.readProfileSnapshot({
      ...operation(),
      profileStorageKey,
    })).resolves.toBeUndefined();
  });

  it('updates local state durably before dequeuing a completed remote save', async () => {
    const order: string[] = [];
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    await outbox.enqueue(operation());
    jest.spyOn(outbox, 'completeSavedUpsert').mockImplementation(async (...args) => {
      order.push('outbox');
      return AccountOutbox.prototype.completeSavedUpsert.apply(outbox, args);
    });
    const logbook = new LocalDiveLogRepository([localLog()]);
    const originalSave = logbook.save.bind(logbook);
    jest.spyOn(logbook, 'save').mockImplementation(async value => {
      order.push('local');
      return originalSave(value);
    });
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: accountRepository({
        saveLog: jest.fn(async value => {
          order.push('remote');
          return {status: 'saved' as const, value: {...value, revision: 2}};
        }),
      }),
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });

    await coordinator.drain({online: true});

    expect(order).toEqual(['remote', 'local', 'outbox']);
  });

  it('keeps a remotely completed operation queued when the local metadata write fails', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
      now: () => 100,
      jitter: () => 0,
    });
    await outbox.enqueue(operation());
    const logbook = new LocalDiveLogRepository([localLog()]);
    jest
      .spyOn(logbook, 'save')
      .mockRejectedValueOnce(new Error('local metadata write failed'));
    const remote = accountRepository();
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
      schedule: () => ({cancel: jest.fn()}),
    });

    await coordinator.drain({online: true});

    expect(remote.saveLog).toHaveBeenCalledTimes(1);
    await expect(logbook.get('local-log-1')).resolves.toMatchObject({
      remoteRevision: 1,
      cloudSyncStatus: 'pending',
    });
    await expect(outbox.list(userId)).resolves.toMatchObject([
      {operationId: 'operation-1', attemptCount: 1, nextAttemptAt: 102},
    ]);
    coordinator.pause();
  });

  it('keeps the local value as conflict and stores the remote latest separately', async () => {
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox', now: () => 150});
    await outbox.enqueue(operation());
    const latest = remoteLog({revision: 4});
    const conflict: AccountMutationResult<RemoteDiveLog> = {status: 'conflict', remote: latest};
    const remote = accountRepository({saveLog: jest.fn(async () => conflict)});
    const currentLocal = localLog({
      updatedAt: 140,
      manual: {...localLog().manual, notes: 'Current local edit'},
    });
    const logbook = new LocalDiveLogRepository([currentLocal]);
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });

    await coordinator.drain({online: true});

    await expect(logbook.get('local-log-1')).resolves.toMatchObject({
      cloudSyncStatus: 'conflict',
      remoteRevision: 1,
      manual: {notes: 'Current local edit'},
    });
    await expect(outbox.list(userId)).resolves.toEqual([]);
    await expect(outbox.listConflicts(userId)).resolves.toEqual([
      expect.objectContaining({
        entityLocalId: 'local-log-1',
        localPayload: {...currentLocal, cloudSyncStatus: 'conflict'},
        remote: latest,
      }),
    ]);
  });

  it('advances queued rapid edits to the revision saved by the preceding edit', async () => {
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
    const first = operation();
    const second = operation(0, {
      operationId: 'operation-2',
      createdAt: 101,
      nextAttemptAt: 101,
      payload: {
        local: localLog({updatedAt: 101, manual: {...localLog().manual, notes: 'Latest edit'}}),
        remote: remoteLog(),
      },
    });
    await outbox.enqueue(first);
    await outbox.enqueue(second);
    const revisions: Array<number | undefined> = [];
    const remote = accountRepository({
      saveLog: jest.fn(async (value, expectedRevision) => {
        revisions.push(expectedRevision);
        return {
          status: 'saved' as const,
          value: {...value, revision: (expectedRevision ?? 0) + 1},
        };
      }),
    });
    const logbook = new LocalDiveLogRepository([
      localLog({updatedAt: 101, manual: {...localLog().manual, notes: 'Latest edit'}}),
    ]);
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: remote,
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 200,
      schedule: () => ({cancel: jest.fn()}),
    });

    await coordinator.drain({online: true});
    expect(revisions).toEqual([1]);
    await coordinator.drain({online: true});

    expect(revisions).toEqual([1, 2]);
    await expect(logbook.get('local-log-1')).resolves.toMatchObject({
      remoteRevision: 3,
      cloudSyncStatus: 'synced',
      manual: {notes: 'Latest edit'},
    });
    await expect(outbox.list(userId)).resolves.toEqual([]);
  });

  it('hydrates remote rows without replacing a pending local edit', async () => {
    const pending = localLog({manual: {...localLog().manual, notes: 'Keep local edit'}});
    const syncedRemote = remoteLog({
      localId: 'remote-only',
      payload: {
        ...remoteLog().payload,
        started_at: '2026-07-20T10:00:00.000Z',
        manual_data: {
          ...localLog().manual,
          _local_record: {schemaVersion: 1, createdAt: 17, updatedAt: 29},
        },
      },
    });
    const remote = accountRepository({
      listLogs: jest.fn(async () => ({items: [remoteLog(), syncedRemote]})),
    });
    const logbook = new LocalDiveLogRepository([pending]);
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox: new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'}),
      accountRepository: remote,
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });

    await coordinator.hydrate({online: true});

    expect((await logbook.get('local-log-1'))?.manual.notes).toBe('Keep local edit');
    await expect(logbook.get('remote-only')).resolves.toMatchObject({
      localId: 'remote-only',
      ownerUserId: userId,
      cloudSyncStatus: 'synced',
      createdAt: 17,
      updatedAt: 29,
    });
  });

  it('hydrates a canonical versioned plan payload', async () => {
    const planbook = new LocalDivePlanRepository();
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox: new AccountOutbox({
        storage: new InMemoryKeyValueStore(),
        storageKey: 'outbox',
      }),
      accountRepository: accountRepository({
        listPlans: jest.fn(async () => ({items: [remotePlan()]})),
      }),
      logbookRepository: new LocalDiveLogRepository(),
      planRepository: planbook,
    });

    await expect(coordinator.hydrate({online: true})).resolves.toBe(1);
    await expect(planbook.get('local-plan-1')).resolves.toEqual(localPlan());
  });

  it('does not overwrite retained local metadata while a delete tombstone is pending', async () => {
    const current = localLog({
      cloudSyncStatus: 'synced',
      manual: {...localLog().manual, notes: 'Retain until delete succeeds'},
    });
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    await outbox.enqueue(
      operation(0, {
        mutation: 'delete',
        payload: {local: current, remote: remoteLog()},
      }),
    );
    const logbook = new LocalDiveLogRepository([current]);
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: accountRepository({
        listLogs: jest.fn(async () => ({items: [remoteLog()]})),
      }),
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
    });

    await coordinator.hydrate({online: true});

    await expect(logbook.get(current.localId)).resolves.toMatchObject({
      manual: {notes: 'Retain until delete succeeds'},
      cloudSyncStatus: 'synced',
    });
  });

  it('downloads, verifies, and writes a full remote profile before log metadata', async () => {
    const samples: WatchDepthSample[] = [
      {localSessionId: 'watch-remote', timestamp: 100, depthMeters: 2},
      {localSessionId: 'watch-remote', timestamp: 101, depthMeters: 7},
    ];
    const bytes = utf8ToBytes(JSON.stringify(samples));
    const digest = bytesToHex(sha256(bytes));
    const profilePath = `${userId}/logs/${remoteId}/revision-1.json`;
    const remoteValue = watchRemoteLog({
      profilePath,
      digest,
      byteCount: bytes.length,
      samples,
    });
    const order: string[] = [];
    const profileStorage = {
      write: jest.fn(async () => {
        order.push('profile');
      }),
      read: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    const logbook = new LocalDiveLogRepository();
    jest.spyOn(logbook, 'save').mockImplementation(async value => {
      order.push('metadata');
      return value;
    });
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox: new AccountOutbox({
        storage: new InMemoryKeyValueStore(),
        storageKey: 'outbox',
      }),
      accountRepository: accountRepository({
        listLogs: jest.fn(async () => ({items: [remoteValue]})),
      }),
      profileDownloader: {downloadProfile: jest.fn(async () => bytes)},
      profileStorage,
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
    });

    await coordinator.hydrate({online: true});

    const expectedKey = `dive-mobile:watch-profile:user%3A${userId}:remote:${remoteId}:revision-1`;
    expect(order).toEqual(['profile', 'metadata']);
    expect(profileStorage.write).toHaveBeenCalledWith(expectedKey, samples);
    expect(logbook.save).toHaveBeenCalledWith(
      expect.objectContaining({
        localId: 'local-log-1',
        watchCapture: expect.objectContaining({
          profile: {
            storageKey: expectedKey,
            contentRevision: 'revision-1',
            sampleCount: 2,
            sha256: digest,
          },
        }),
      }),
    );
  });

  it('aborts stale hydration after a remote profile await without local persistence', async () => {
    const samples: WatchDepthSample[] = [
      {localSessionId: 'watch-remote', timestamp: 100, depthMeters: 4},
    ];
    const bytes = utf8ToBytes(JSON.stringify(samples));
    const profilePath = `${userId}/logs/${remoteId}/revision-1.json`;
    const remoteValue = watchRemoteLog({
      profilePath,
      digest: bytesToHex(sha256(bytes)),
      byteCount: bytes.length,
      samples,
    });
    const download = deferred<Uint8Array>();
    const profileStorage = {
      write: jest.fn(async () => undefined),
      read: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    const logbook = new LocalDiveLogRepository();
    const save = jest.spyOn(logbook, 'save');
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: accountRepository({
        listLogs: jest.fn(async () => ({items: [remoteValue]})),
      }),
      profileDownloader: {downloadProfile: jest.fn(() => download.promise)},
      profileStorage,
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
    });

    const hydration = coordinator.hydrate({online: true});
    let hydrationError: unknown;
    const observedHydration = hydration.catch(error => {
      hydrationError = error;
    });
    await flushPromises();
    coordinator.pause();
    download.resolve(bytes);

    await observedHydration;
    expect((hydrationError as Error | undefined)?.message).toMatch(
      /stale|cancel/i,
    );
    expect(profileStorage.write).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await expect(outbox.list(userId)).resolves.toEqual([]);
  });

  it('rolls back a profile write invalidated while local persistence is awaiting', async () => {
    const samples: WatchDepthSample[] = [
      {localSessionId: 'watch-remote', timestamp: 100, depthMeters: 4},
    ];
    const bytes = utf8ToBytes(JSON.stringify(samples));
    const profilePath = `${userId}/logs/${remoteId}/revision-1.json`;
    const remoteValue = watchRemoteLog({
      profilePath,
      digest: bytesToHex(sha256(bytes)),
      byteCount: bytes.length,
      samples,
    });
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    const profileStorage = {
      write: jest.fn(async () => {
        writeStarted.resolve(undefined);
        await releaseWrite.promise;
      }),
      read: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    const logbook = new LocalDiveLogRepository();
    const save = jest.spyOn(logbook, 'save');
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox: new AccountOutbox({
        storage: new InMemoryKeyValueStore(),
        storageKey: 'outbox',
      }),
      accountRepository: accountRepository({
        listLogs: jest.fn(async () => ({items: [remoteValue]})),
      }),
      profileDownloader: {downloadProfile: jest.fn(async () => bytes)},
      profileStorage,
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
    });

    const hydration = coordinator.hydrate({online: true});
    let hydrationError: unknown;
    const observedHydration = hydration.catch(error => {
      hydrationError = error;
    });
    await writeStarted.promise;
    coordinator.pause();
    releaseWrite.resolve(undefined);

    await observedHydration;
    expect((hydrationError as Error | undefined)?.message).toMatch(
      /stale|cancel/i,
    );
    expect(profileStorage.remove).toHaveBeenCalledWith(
      `dive-mobile:watch-profile:user%3A${userId}:remote:${remoteId}:revision-1`,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('leaves local state and the outbox unchanged when a remote save completes after pause', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'outbox',
    });
    await outbox.enqueue(operation());
    const before = await outbox.list(userId);
    const saveResult = deferred<AccountMutationResult<RemoteDiveLog>>();
    const logbook = new LocalDiveLogRepository([localLog()]);
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox,
      accountRepository: accountRepository({
        saveLog: jest.fn(() => saveResult.promise),
      }),
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
      now: () => 100,
      schedule: () => ({cancel: jest.fn()}),
    });

    const drain = coordinator.drain({online: true});
    let drainError: unknown;
    const observedDrain = drain.catch(error => {
      drainError = error;
    });
    await flushPromises();
    coordinator.pause();
    saveResult.resolve({
      status: 'saved',
      value: remoteLog({revision: 2}),
    });

    await observedDrain;
    expect((drainError as Error | undefined)?.message).toMatch(
      /stale|cancel/i,
    );
    await expect(logbook.get('local-log-1')).resolves.toEqual(localLog());
    await expect(outbox.list(userId)).resolves.toEqual(before);
  });

  it.each([
    {
      name: 'missing log schema version',
      mutate(remote: RemoteDiveLog) {
        const manual = {...(remote.payload.manual_data as Record<string, unknown>)};
        manual._local_record = {createdAt: 100, updatedAt: 100};
        remote.payload = {...remote.payload, manual_data: manual};
        remote.payloadSha256 = canonicalSha256(remote.payload);
      },
    },
    {
      name: 'future log schema version',
      mutate(remote: RemoteDiveLog) {
        const manual = {...(remote.payload.manual_data as Record<string, unknown>)};
        manual._local_record = {
          schemaVersion: 2,
          createdAt: 100,
          updatedAt: 100,
        };
        remote.payload = {...remote.payload, manual_data: manual};
        remote.payloadSha256 = canonicalSha256(remote.payload);
      },
    },
    {
      name: 'extra top-level log payload key',
      mutate(remote: RemoteDiveLog) {
        remote.payload = {...remote.payload, unexpected: true};
        remote.payloadSha256 = canonicalSha256(remote.payload);
      },
    },
    {
      name: 'payload digest mismatch',
      mutate(remote: RemoteDiveLog) {
        remote.payloadSha256 = 'f'.repeat(64);
      },
    },
  ])('fails closed before persistence for $name', async ({mutate}) => {
    const malformed = remoteLog();
    mutate(malformed);
    const logbook = new LocalDiveLogRepository();
    const save = jest.spyOn(logbook, 'save');
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox: new AccountOutbox({
        storage: new InMemoryKeyValueStore(),
        storageKey: 'outbox',
      }),
      accountRepository: accountRepository({
        listLogs: jest.fn(async () => ({items: [malformed]})),
      }),
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
    });

    await expect(coordinator.hydrate({online: true})).rejects.toThrow(
      'Malformed remote log',
    );
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing plan schema version',
      mutate(remote: RemoteDivePlan) {
        const planData = {...(remote.payload.plan_data as Record<string, unknown>)};
        delete planData._schemaVersion;
        remote.payload = {...remote.payload, plan_data: planData};
        remote.payloadSha256 = canonicalSha256(remote.payload);
      },
    },
    {
      name: 'future plan schema version',
      mutate(remote: RemoteDivePlan) {
        remote.payload = {
          ...remote.payload,
          plan_data: {
            ...(remote.payload.plan_data as Record<string, unknown>),
            _schemaVersion: 2,
          },
        };
        remote.payloadSha256 = canonicalSha256(remote.payload);
      },
    },
    {
      name: 'extra top-level plan payload key',
      mutate(remote: RemoteDivePlan) {
        remote.payload = {...remote.payload, unexpected: true};
        remote.payloadSha256 = canonicalSha256(remote.payload);
      },
    },
    {
      name: 'plan payload digest mismatch',
      mutate(remote: RemoteDivePlan) {
        remote.payloadSha256 = 'f'.repeat(64);
      },
    },
  ])('fails closed before persistence for $name', async ({mutate}) => {
    const malformed = remotePlan();
    mutate(malformed);
    const planbook = new LocalDivePlanRepository();
    const save = jest.spyOn(planbook, 'save');
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox: new AccountOutbox({
        storage: new InMemoryKeyValueStore(),
        storageKey: 'outbox',
      }),
      accountRepository: accountRepository({
        listPlans: jest.fn(async () => ({items: [malformed]})),
      }),
      logbookRepository: new LocalDiveLogRepository(),
      planRepository: planbook,
    });

    await expect(coordinator.hydrate({online: true})).rejects.toThrow(
      'Malformed remote plan',
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('fails closed before persistence when a remote payload is malformed', async () => {
    const malformed = remoteLog({
      payload: {...remoteLog().payload, manual_data: {site: 'not-an-object'}},
    });
    const logbook = new LocalDiveLogRepository();
    const save = jest.spyOn(logbook, 'save');
    const coordinator = new AccountSyncCoordinator({
      userId,
      outbox: new AccountOutbox({
        storage: new InMemoryKeyValueStore(),
        storageKey: 'outbox',
      }),
      accountRepository: accountRepository({
        listLogs: jest.fn(async () => ({items: [malformed]})),
      }),
      logbookRepository: logbook,
      planRepository: new LocalDivePlanRepository(),
    });

    await expect(coordinator.hydrate({online: true})).rejects.toThrow(
      'Malformed remote log',
    );
    expect(save).not.toHaveBeenCalled();
  });
});

function watchRemoteLog(input: {
  profilePath: string;
  digest: string;
  byteCount: number;
  samples: WatchDepthSample[];
}): RemoteDiveLog {
  const preview = input.samples.slice(0, 1);
  return remoteLog({
    profilePath: input.profilePath,
    payload: {
      source: 'watch',
      started_at: '1970-01-01T00:01:40.000Z',
      manual_data: {
        ...localLog().manual,
        _local_record: {
          schemaVersion: 1,
          createdAt: 100,
          updatedAt: 100,
        },
      },
      mobile_data: localLog().mobile,
      provenance: {},
      watch_metadata: {
        importKey: 'watch-remote:100',
        importedAt: 100,
        session: {
          localSessionId: 'watch-remote',
          startedAt: 100,
          samples: preview,
        },
        measuredValues: {startedAt: 100},
        samples: preview,
        profile: {
          contentRevision: 'revision-1',
          sampleCount: input.samples.length,
          sha256: input.digest,
        },
      },
      profile_preview: preview,
      profile_content_revision: 'revision-1',
      profile_sha256: input.digest,
      profile_byte_count: input.byteCount,
      profile_sample_count: input.samples.length,
    },
  });
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
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalStringify(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}
