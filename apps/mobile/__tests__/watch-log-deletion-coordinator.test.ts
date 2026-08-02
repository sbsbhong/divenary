import {
  createWatchDeletionAwareLogbookRepository,
  createWatchLogDeletionCoordinator,
  type WatchSessionDeletionCommand,
} from '../src/deletion/watch-log-deletion-coordinator';
import {createWatchLogDeletionStore} from '../src/deletion/watch-log-deletion-store';
import {LocalDiveLogRepository} from '../src/repositories/local-dive-log-repository';
import {InMemoryKeyValueStore} from '../src/storage/in-memory-key-value-store';
import type {DiveLogEntry} from '../src/types/dive-log-entry';

describe('WatchLogDeletionCoordinator', () => {
  it('persists and reads back the Watch tombstone before deleting the row', async () => {
    const storage = new InMemoryKeyValueStore();
    const tombstones = createWatchLogDeletionStore({storage});
    const repository = new LocalDiveLogRepository([watchLog]);
    const originalDelete = repository.delete.bind(repository);
    repository.delete = jest.fn(async localId => {
      expect(await tombstones.get('watch-session-1')).toMatchObject({
        sourceLocalIds: ['watch-log-1'],
      });
      await originalDelete(localId);
    });
    const queueDeletion = jest.fn().mockResolvedValue(undefined);
    const requestSync = jest.fn().mockResolvedValue(undefined);
    const coordinator = createWatchLogDeletionCoordinator({
      tombstones,
      repository,
      queueDeletion,
      requestSync,
      now: () => 200,
    });

    await coordinator.delete(watchLog);

    expect(await repository.get(watchLog.localId)).toBeUndefined();
    expect(queueDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        localSessionId: 'watch-session-1',
        contentRevision: 'revision-1',
        artifactSha256: 'a'.repeat(64),
        requestedAt: 200,
      }),
    );
    expect(requestSync).toHaveBeenCalledTimes(1);
  });

  it('uses the existing delete path without a tombstone for manual logs', async () => {
    const tombstones = createWatchLogDeletionStore({
      storage: new InMemoryKeyValueStore(),
    });
    const repository = new LocalDiveLogRepository([manualLog]);
    const queueDeletion = jest.fn().mockResolvedValue(undefined);
    const coordinator = createWatchLogDeletionCoordinator({
      tombstones,
      repository,
      queueDeletion,
      now: () => 200,
    });

    await coordinator.delete(manualLog);

    expect(await tombstones.list()).toEqual([]);
    expect(queueDeletion).not.toHaveBeenCalled();
    expect(await repository.get(manualLog.localId)).toBeUndefined();
  });

  it('keeps the deletion durable and retries native delivery after a bridge failure', async () => {
    const tombstones = createWatchLogDeletionStore({
      storage: new InMemoryKeyValueStore(),
    });
    const repository = new LocalDiveLogRepository([watchLog]);
    const queueDeletion = jest
      .fn<Promise<void>, [WatchSessionDeletionCommand]>()
      .mockRejectedValueOnce(new Error('bridge unavailable'))
      .mockResolvedValue(undefined);
    const warn = jest.fn();
    const coordinator = createWatchLogDeletionCoordinator({
      tombstones,
      repository,
      queueDeletion,
      warn,
      now: () => 200,
    });

    await coordinator.delete(watchLog);
    expect(await coordinator.isDeleted('watch-session-1')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);

    await coordinator.reconcile();

    expect(queueDeletion).toHaveBeenCalledTimes(2);
    expect(queueDeletion.mock.calls[1]?.[0]).toEqual(
      queueDeletion.mock.calls[0]?.[0],
    );
  });

  it('continues durable cleanup and Watch delivery after claim invalidation fails', async () => {
    const tombstones = createWatchLogDeletionStore({
      storage: new InMemoryKeyValueStore(),
    });
    const repository = new LocalDiveLogRepository([watchLog]);
    const beforeDelete = jest
      .fn()
      .mockRejectedValue(new Error('network unavailable'));
    const queueDeletion = jest.fn().mockResolvedValue(undefined);
    const warn = jest.fn();
    const coordinator = createWatchLogDeletionCoordinator({
      tombstones,
      repository,
      beforeDelete,
      queueDeletion,
      warn,
      now: () => 200,
    });

    await expect(coordinator.delete(watchLog)).resolves.toBeUndefined();

    expect(await coordinator.isDeleted('watch-session-1')).toBe(true);
    expect(await repository.get(watchLog.localId)).toBeUndefined();
    expect(queueDeletion).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Failed to invalidate guest claim for Watch log deletion',
      expect.any(Error),
    );
  });

  it('keeps a failed local cleanup hidden and still queues paired Watch deletion', async () => {
    const tombstones = createWatchLogDeletionStore({
      storage: new InMemoryKeyValueStore(),
    });
    const raw = new LocalDiveLogRepository([watchLog]);
    raw.delete = jest.fn().mockRejectedValue(new Error('storage unavailable'));
    const queueDeletion = jest.fn().mockResolvedValue(undefined);
    const warn = jest.fn();
    const coordinator = createWatchLogDeletionCoordinator({
      tombstones,
      repository: raw,
      queueDeletion,
      warn,
      now: () => 200,
    });
    const visible = createWatchDeletionAwareLogbookRepository({
      repository: raw,
      tombstones,
      deleteEntry: entry => coordinator.delete(entry),
    });

    await expect(visible.delete(watchLog.localId)).resolves.toBeUndefined();

    expect(await visible.get(watchLog.localId)).toBeUndefined();
    expect(await raw.get(watchLog.localId)).toBeDefined();
    expect(queueDeletion).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Failed to remove tombstoned Watch log from local repository',
      expect.any(Error),
    );
  });

  it('reconciles a persisted tombstone with a row left behind by an interrupted delete', async () => {
    const tombstones = createWatchLogDeletionStore({
      storage: new InMemoryKeyValueStore(),
    });
    await tombstones.record({
      localSessionId: 'watch-session-1',
      sourceLocalId: watchLog.localId,
      contentRevision: 'revision-1',
      artifactSha256: 'a'.repeat(64),
      requestedAt: 100,
    });
    const repository = new LocalDiveLogRepository([watchLog]);
    const beforeDelete = jest.fn().mockResolvedValue(undefined);
    const coordinator = createWatchLogDeletionCoordinator({
      tombstones,
      repository,
      beforeDelete,
      queueDeletion: jest.fn().mockResolvedValue(undefined),
      now: () => 200,
    });

    await coordinator.reconcile();

    expect(beforeDelete).toHaveBeenCalledWith(
      expect.objectContaining({localSessionId: 'watch-session-1'}),
    );
    expect(await repository.get(watchLog.localId)).toBeUndefined();
  });

  it('records the durable Watch acknowledgement and stops retrying the command', async () => {
    const tombstones = createWatchLogDeletionStore({
      storage: new InMemoryKeyValueStore(),
    });
    await tombstones.record({
      localSessionId: 'watch-session-1',
      sourceLocalId: watchLog.localId,
      requestedAt: 100,
    });
    const queueDeletion = jest.fn().mockResolvedValue(undefined);
    const listAcknowledgements = jest.fn().mockResolvedValue([]);
    const coordinator = createWatchLogDeletionCoordinator({
      tombstones,
      repository: new LocalDiveLogRepository(),
      queueDeletion,
      listAcknowledgements,
    });

    await coordinator.reconcile();
    const command = queueDeletion.mock.calls[0]?.[0];
    expect(command).toBeDefined();
    listAcknowledgements.mockResolvedValue([
      {
        formatVersion: 1,
        commandId: command!.commandId,
        localSessionId: 'watch-session-1',
        acknowledgedAt: 250,
        result: 'deleted',
      },
    ]);

    await coordinator.reconcile();

    expect(await tombstones.get('watch-session-1')).toMatchObject({
      watchAcknowledgedAt: 250,
    });
    expect(queueDeletion).toHaveBeenCalledTimes(1);
  });

  it('ignores an acknowledgement whose deterministic command identity does not match', async () => {
    const tombstones = createWatchLogDeletionStore({
      storage: new InMemoryKeyValueStore(),
    });
    await tombstones.record({
      localSessionId: 'watch-session-1',
      sourceLocalId: watchLog.localId,
      requestedAt: 100,
    });
    const queueDeletion = jest.fn().mockResolvedValue(undefined);
    const coordinator = createWatchLogDeletionCoordinator({
      tombstones,
      repository: new LocalDiveLogRepository(),
      queueDeletion,
      listAcknowledgements: jest.fn().mockResolvedValue([
        {
          formatVersion: 1,
          commandId: 'c'.repeat(64),
          localSessionId: 'watch-session-1',
          acknowledgedAt: 250,
          result: 'deleted',
        },
      ]),
    });

    await coordinator.reconcile();

    expect(await tombstones.get('watch-session-1')).not.toHaveProperty(
      'watchAcknowledgedAt',
    );
    expect(queueDeletion).toHaveBeenCalledTimes(1);
  });

  it('hides a tombstoned row before interrupted physical cleanup completes', async () => {
    const tombstones = createWatchLogDeletionStore({
      storage: new InMemoryKeyValueStore(),
    });
    await tombstones.record({
      localSessionId: 'watch-session-1',
      sourceLocalId: watchLog.localId,
      requestedAt: 100,
    });
    const raw = new LocalDiveLogRepository([watchLog, manualLog]);
    const visible = createWatchDeletionAwareLogbookRepository({
      repository: raw,
      tombstones,
      deleteEntry: jest.fn(),
    });

    expect((await visible.list()).map(value => value.localId)).toEqual([
      manualLog.localId,
    ]);
    await expect(visible.get(watchLog.localId)).resolves.toBeUndefined();
    await expect(raw.get(watchLog.localId)).resolves.toBeDefined();
  });

  it('blocks a direct repository import for a tombstoned Watch session', async () => {
    const tombstones = createWatchLogDeletionStore({
      storage: new InMemoryKeyValueStore(),
    });
    await tombstones.record({
      localSessionId: 'watch-session-1',
      sourceLocalId: watchLog.localId,
      requestedAt: 100,
    });
    const raw = new LocalDiveLogRepository();
    const importWatchMessages = jest.spyOn(raw, 'importWatchMessages');
    const visible = createWatchDeletionAwareLogbookRepository({
      repository: raw,
      tombstones,
      deleteEntry: jest.fn(),
    });

    const result = await visible.importWatchMessages([
      {
        type: 'sessionEnded',
        session: {
          ...watchLog.watchCapture!.session,
          diveMode: undefined,
          freedive: undefined,
          scuba: undefined,
        },
      },
    ]);

    expect(result).toEqual([]);
    expect(importWatchMessages).not.toHaveBeenCalled();
  });
});

const manualLog: DiveLogEntry = {
  localId: 'manual-log-1',
  source: 'manual',
  cloudSyncStatus: 'notConfigured',
  createdAt: 100,
  updatedAt: 100,
  manual: {
    site: {name: 'Manual Reef'},
    buddyIds: [],
    gearIds: [],
    tags: [],
    observedMarineLife: [],
    measuredValues: {startedAt: 100},
  },
  mobile: {mediaPlaceholders: []},
  provenance: {},
};

const watchLog: DiveLogEntry = {
  ...manualLog,
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
