import type {
  AccountDataRepository,
  AccountMutationResult,
  RemoteDiveLog,
} from '@repo/supabase';
import { LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import { AccountOutbox, type AccountOutboxItem } from '../src/sync/account-outbox';
import { AccountSyncCoordinator } from '../src/sync/account-sync-coordinator';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type { DiveLogEntry } from '../src/types/dive-log-entry';

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

const remoteLog = (overrides: Partial<RemoteDiveLog> = {}): RemoteDiveLog => ({
  id: remoteId,
  localId: 'local-log-1',
  revision: 1,
  payloadSha256: 'a'.repeat(64),
  payload: {
    source: 'manual',
    started_at: '1970-01-01T00:01:40.000Z',
    manual_data: localLog().manual,
    mobile_data: localLog().mobile,
    provenance: {},
  },
  ...overrides,
});

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
      value: {id: remoteId, localId: 'plan-1', revision: 2, payloadSha256: 'b'.repeat(64), payload: {}},
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

  it('shares one in-flight drain per user, processes at most ten, and dequeues before the next call', async () => {
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
    await expect(first).resolves.toEqual({processed: 10, remaining: 2});
    expect(remote.saveLog).toHaveBeenCalledTimes(10);
    expect(lengthsAtDelivery).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  });

  it('uploads a referenced profile before saving metadata', async () => {
    const order: string[] = [];
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
    const remoteValue = remoteLog({profilePath: `${userId}/logs/${remoteId}/revision-1.json`});
    await outbox.enqueue(operation(0, {
      profileStorageKey: 'profile-key',
      payload: {local: localLog(), remote: remoteValue},
    }));
    const remote = accountRepository({
      saveLog: jest.fn(async value => {
        order.push('metadata');
        return {status: 'saved' as const, value};
      }),
    });
    const profileUploader = {
      uploadProfile: jest.fn(async () => {
        order.push('profile');
      }),
    };
    const logbook = new LocalDiveLogRepository([localLog({
      watchCapture: {
        importKey: 'watch-1:100',
        importedAt: 100,
        session: {localSessionId: 'watch-1', startedAt: 100, samples: []},
        measuredValues: {startedAt: 100},
        samples: [{localSessionId: 'watch-1', timestamp: 100, depthMeters: 3}],
        profile: {storageKey: 'profile-key', contentRevision: 'revision-1', sampleCount: 1},
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
  });

  it('keeps the local value as conflict and stores the remote latest separately', async () => {
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox', now: () => 150});
    await outbox.enqueue(operation());
    const latest = remoteLog({revision: 4, payloadSha256: 'f'.repeat(64)});
    const conflict: AccountMutationResult<RemoteDiveLog> = {status: 'conflict', remote: latest};
    const remote = accountRepository({saveLog: jest.fn(async () => conflict)});
    const logbook = new LocalDiveLogRepository([localLog()]);
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
    });
    await expect(outbox.list(userId)).resolves.toEqual([]);
    await expect(outbox.listConflicts(userId)).resolves.toEqual([
      expect.objectContaining({entityLocalId: 'local-log-1', remote: latest}),
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
        remote: remoteLog({payloadSha256: 'b'.repeat(64)}),
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
    });

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
          _local_record: {createdAt: 17, updatedAt: 29},
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
});
