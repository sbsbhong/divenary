import {
  createDefaultPersistentDiveLogRepository,
  DIVE_LOGBOOK_SCHEMA_VERSION,
  migrateDiveLogbookEnvelope,
  PersistentDiveLogRepository,
} from '../src/repositories/persistent-dive-log-repository';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type { PersistentKeyValueStore } from '../src/storage/persistent-key-value-store';
import {
  PersistentJsonCommittedWriteError,
  PersistentJsonReadError,
} from '../src/storage/persistent-json-store';
import { mobileStorageKeys } from '../src/storage/storage-keys';
import type { WatchProfileStorage } from '../src/storage/watch-profile-storage';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { WatchDepthSample, WatchSyncMessage } from '../src/types/dive-session';
import {createWatchProfileDigest} from '../src/utils/watch-profile-digest';
import * as watchProfileDigest from '../src/utils/watch-profile-digest';

const manualEntry = (overrides: Partial<DiveLogEntry> = {}): DiveLogEntry => ({
  localId: 'manual-1',
  source: 'manual',
  cloudSyncStatus: 'notConfigured',
  createdAt: 100,
  updatedAt: 100,
  manual: {
    site: { name: 'Manual Reef' },
    buddyIds: [],
    gearIds: [],
    tags: [],
    observedMarineLife: [],
    measuredValues: {
      startedAt: 100,
      maxDepthMeters: 12,
    },
  },
  mobile: {
    mediaPlaceholders: [],
  },
  provenance: {
    site: 'manual',
    measuredValues: 'manual',
  },
  ...overrides,
});

const watchMessage: WatchSyncMessage = {
  type: 'sessionEnded',
  session: {
    localSessionId: 'persistent-watch-1',
    schemaVersion: 1,
    siteName: 'Watch Reef',
    syncStatus: 'pending',
    startedAt: 200,
    endedAt: 260,
    maxDepthMeters: 14,
    averageDepthMeters: 8,
    samples: [],
  },
};

class FailFirstWriteStore implements PersistentKeyValueStore {
  private readonly delegate = new InMemoryKeyValueStore();
  private shouldFail = true;

  getString(key: string): Promise<string | undefined> {
    return this.delegate.getString(key);
  }

  async setString(key: string, value: string): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('simulated metadata write failure');
    }
    await this.delegate.setString(key, value);
  }

  remove(key: string): Promise<void> {
    return this.delegate.remove(key);
  }

}

class CountingMainEnvelopeStore implements PersistentKeyValueStore {
  private readonly delegate = new InMemoryKeyValueStore();
  mainReads = 0;
  mainWrites = 0;

  constructor(private readonly mainKey: string) {}

  async getString(key: string): Promise<string | undefined> {
    if (key === this.mainKey) {
      this.mainReads += 1;
    }
    return this.delegate.getString(key);
  }

  async setString(key: string, value: string): Promise<void> {
    if (key === this.mainKey) {
      this.mainWrites += 1;
    }
    await this.delegate.setString(key, value);
  }

  remove(key: string): Promise<void> {
    return this.delegate.remove(key);
  }

  resetCounts(): void {
    this.mainReads = 0;
    this.mainWrites = 0;
  }
}

class FailingPostCommitMainReadStore implements PersistentKeyValueStore {
  private readonly delegate = new InMemoryKeyValueStore();
  private readonly commitKey = `${mobileStorageKeys.logbook}:journal:commit:v1`;
  private commitPresent = false;
  private mainReadFailureDelivered = false;
  private recoveryFailureDelivered = false;

  async getString(key: string): Promise<string | undefined> {
    if (
      key === mobileStorageKeys.logbook &&
      this.commitPresent &&
      !this.mainReadFailureDelivered
    ) {
      this.mainReadFailureDelivered = true;
      throw new Error('simulated post-commit main read failure');
    }
    return this.delegate.getString(key);
  }

  async setString(key: string, value: string): Promise<void> {
    if (
      key === mobileStorageKeys.logbook &&
      this.mainReadFailureDelivered &&
      !this.recoveryFailureDelivered
    ) {
      this.recoveryFailureDelivered = true;
      if ((await this.delegate.getString(key)) !== undefined) {
        throw new Error('simulated post-commit recovery failure');
      }
    }
    await this.delegate.setString(key, value);
    if (key === this.commitKey) {
      this.commitPresent = true;
    }
  }

  async remove(key: string): Promise<void> {
    await this.delegate.remove(key);
    if (key === this.commitKey) {
      this.commitPresent = false;
    }
  }
}

class RecordingProfileStorage implements WatchProfileStorage {
  readonly values = new Map<string, WatchDepthSample[]>();
  readonly removals: string[] = [];

  async write(key: string, samples: WatchDepthSample[]): Promise<void> {
    this.values.set(key, samples.map(sample => ({ ...sample })));
  }

  async read(key: string): Promise<WatchDepthSample[] | undefined> {
    return this.values.get(key)?.map(sample => ({ ...sample }));
  }

  async remove(key: string): Promise<void> {
    this.removals.push(key);
    this.values.delete(key);
  }
}

class PreparedProfileStorage extends RecordingProfileStorage {
  readonly adoptPrepared = jest.fn(
    async (payloadId: string, destinationKey: string): Promise<void> => {
      this.values.set(destinationKey, []);
    },
  );
}

class PausedFirstWriteStore implements PersistentKeyValueStore {
  private readonly delegate = new InMemoryKeyValueStore();
  private isFirstWrite = true;
  private resolveWriteStarted!: () => void;
  private resolveWrite!: () => void;
  readonly writeStarted = new Promise<void>(resolve => {
    this.resolveWriteStarted = resolve;
  });

  getString(key: string): Promise<string | undefined> {
    return this.delegate.getString(key);
  }

  async setString(key: string, value: string): Promise<void> {
    if (this.isFirstWrite) {
      this.isFirstWrite = false;
      this.resolveWriteStarted();
      await new Promise<void>(resolve => {
        this.resolveWrite = resolve;
      });
    }
    await this.delegate.setString(key, value);
  }

  remove(key: string): Promise<void> {
    return this.delegate.remove(key);
  }

  seedString(key: string, value: string): Promise<void> {
    return this.delegate.setString(key, value);
  }

  releaseWrite(): void {
    this.resolveWrite();
  }
}

class PausedProfileStorage extends RecordingProfileStorage {
  private resolveWriteStarted!: () => void;
  private resolveWrite!: () => void;
  readonly writeStarted = new Promise<void>(resolve => {
    this.resolveWriteStarted = resolve;
  });

  override async write(key: string, samples: WatchDepthSample[]): Promise<void> {
    this.resolveWriteStarted();
    await new Promise<void>(resolve => {
      this.resolveWrite = resolve;
    });
    await super.write(key, samples);
  }

  releaseWrite(): void {
    this.resolveWrite();
  }
}

class PausedRemoveProfileStorage extends RecordingProfileStorage {
  private resolveRemoveStarted!: () => void;
  private resolveRemove!: () => void;
  readonly removeStarted = new Promise<void>(resolve => {
    this.resolveRemoveStarted = resolve;
  });

  override async remove(key: string): Promise<void> {
    this.resolveRemoveStarted();
    await new Promise<void>(resolve => {
      this.resolveRemove = resolve;
    });
    await super.remove(key);
  }

  releaseRemove(): void {
    this.resolveRemove();
  }
}

class FailingObsoleteProfileStorage extends RecordingProfileStorage {
  constructor(private readonly failingKey: string) {
    super();
  }

  override async remove(key: string): Promise<void> {
    if (key === this.failingKey) {
      this.removals.push(key);
      throw new Error('simulated obsolete profile cleanup failure');
    }
    await super.remove(key);
  }
}

function watchEntryWithProfile(localId: string, importKey: string, profileKey: string): DiveLogEntry {
  return {
    ...manualEntry({ localId }),
    source: 'watch',
    watchCapture: {
      importKey,
      importedAt: 300,
      session: {
        localSessionId: `session-${localId}`,
        startedAt: 200,
        endedAt: 260,
        samples: [],
      },
      measuredValues: { startedAt: 200, endedAt: 260 },
      samples: [],
      profile: {
        storageKey: profileKey,
        contentRevision: 'revision-1',
        sampleCount: 0,
      },
    },
  };
}

describe('PersistentDiveLogRepository', () => {
  it('does not replace unreadable local logbook bytes when a save follows', async () => {
    const storage = new InMemoryKeyValueStore();
    const raw = '{"schemaVersion":99,"updatedAt":1,"value":[]}';
    await storage.setString('principal-logbook', raw);
    const repository = new PersistentDiveLogRepository({
      storage,
      storageKey: 'principal-logbook',
    });

    await expect(repository.save(manualEntry())).rejects.toBeInstanceOf(
      PersistentJsonReadError,
    );
    await expect(storage.getString('principal-logbook')).resolves.toBe(raw);
  });

  it('does not seed the built-in presentation fixture into persistent storage', async () => {
    const repository = createDefaultPersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      now: () => 500,
    });

    await expect(repository.list()).resolves.toEqual([]);
  });

  it('serializes concurrent read-modify-write saves', async () => {
    const repository = new PersistentDiveLogRepository({ storage: new InMemoryKeyValueStore(), now: () => 500 });

    await Promise.all([
      repository.save(manualEntry({ localId: 'concurrent-a' })),
      repository.save(manualEntry({ localId: 'concurrent-b' })),
    ]);

    expect((await repository.list()).map(entry => entry.localId).sort()).toEqual(['concurrent-a', 'concurrent-b']);
  });

  it('continues the mutation queue after one operation rejects', async () => {
    const repository = new PersistentDiveLogRepository({ storage: new FailFirstWriteStore(), now: () => 500 });

    await expect(repository.save(manualEntry({ localId: 'rejected' }))).rejects.toThrow('simulated metadata write failure');
    await expect(repository.save(manualEntry({ localId: 'accepted' }))).resolves.toMatchObject({ localId: 'accepted' });

    expect((await repository.list()).map(entry => entry.localId)).toEqual(['accepted']);
  });

  it('conditionally deletes many logs with one metadata read and write', async () => {
    const storage = new CountingMainEnvelopeStore(mobileStorageKeys.logbook);
    const repository = new PersistentDiveLogRepository({storage, now: () => 500});
    const entries = Array.from({length: 15}, (_, index) =>
      manualEntry({localId: `bulk-log-${index}`, updatedAt: index}),
    );
    for (const entry of entries) {
      await repository.save(entry);
    }
    storage.resetCounts();

    const result = await repository.deleteManyIf?.(
      entries.map(entry => ({
        localId: entry.localId,
        predicate: current => current.updatedAt === entry.updatedAt,
      })),
      {retainProfileAfterDelete: true},
    );

    expect(result && [...result.values()]).toEqual(
      Array.from({length: 15}, () => 'deleted'),
    );
    expect(storage.mainWrites).toBe(1);
    expect(await repository.list()).toEqual([]);
  });

  it('preserves logs that no longer match a bulk delete snapshot', async () => {
    const repository = new PersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      now: () => 500,
    });
    const exact = manualEntry({localId: 'exact', updatedAt: 100});
    const changed = manualEntry({localId: 'changed', updatedAt: 200});
    await repository.save(exact);
    await repository.save(changed);

    const result = await repository.deleteManyIf?.([
      {localId: exact.localId, predicate: current => current.updatedAt === 100},
      {localId: changed.localId, predicate: current => current.updatedAt === 100},
    ]);

    expect(result?.get('exact')).toBe('deleted');
    expect(result?.get('changed')).toBe('conditionFailed');
    expect((await repository.list()).map(value => value.localId)).toEqual([
      'changed',
    ]);
  });

  it('serializes conditional delete behind a queued save without removing the changed log profile', async () => {
    const storage = new PausedFirstWriteStore();
    const profileStorage = new RecordingProfileStorage();
    const profileKey = 'conditional-delete-profile';
    const original = watchEntryWithProfile('racing-log', 'racing-import', profileKey);
    const changed = {...original, updatedAt: original.updatedAt + 1};
    await storage.seedString(
      mobileStorageKeys.logbook,
      JSON.stringify({
        schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
        updatedAt: 100,
        value: [original],
      }),
    );
    await profileStorage.write(profileKey, [{
      localSessionId: 'session-racing-log',
      timestamp: 200,
      depthMeters: 1,
    }]);
    const repository = new PersistentDiveLogRepository({storage, profileStorage, now: () => 500});

    const saving = repository.save(changed);
    await storage.writeStarted;
    const deleting = (repository as unknown as {
      deleteIf(
        localId: string,
        predicate: (current: DiveLogEntry) => boolean,
      ): Promise<string>;
    }).deleteIf('racing-log', current => current.updatedAt === original.updatedAt);
    storage.releaseWrite();

    await expect(saving).resolves.toMatchObject({updatedAt: changed.updatedAt});
    await expect(deleting).resolves.toBe('conditionFailed');
    await expect(repository.get('racing-log')).resolves.toMatchObject({
      updatedAt: changed.updatedAt,
    });
    expect(profileStorage.values.has(profileKey)).toBe(true);
    expect(profileStorage.removals).toEqual([]);
  });

  it('rejects a queued watch import when its commit guard becomes stale', async () => {
    const storage = new PausedFirstWriteStore();
    const profileStorage = new RecordingProfileStorage();
    const repository = new PersistentDiveLogRepository({
      storage,
      profileStorage,
      now: () => 500,
    });
    const blockingSave = repository.save(manualEntry({localId: 'blocking'}));
    await storage.writeStarted;
    let isCurrent = true;
    const guardedImport = repository.importWatchMessages([watchMessage], {
      assertCanCommit: () => {
        if (!isCurrent) {
          throw new Error('stale principal');
        }
      },
    });

    isCurrent = false;
    storage.releaseWrite();
    await blockingSave;

    await expect(guardedImport).rejects.toThrow('stale principal');
    expect(profileStorage.values).toEqual(new Map());
    expect((await repository.list()).map(value => value.localId)).toEqual([
      'blocking',
    ]);
  });

  it('checks the commit guard again after awaited profile persistence', async () => {
    const storage = new InMemoryKeyValueStore();
    const profileStorage = new PausedProfileStorage();
    const repository = new PersistentDiveLogRepository({
      storage,
      profileStorage,
      now: () => 500,
    });
    let isCurrent = true;
    const assertCanCommit = jest.fn(() => {
      if (!isCurrent) {
        throw new Error('stale principal');
      }
    });
    const guardedImport = repository.importWatchMessages([watchMessage], {
      assertCanCommit,
    });
    await profileStorage.writeStarted;

    isCurrent = false;
    profileStorage.releaseWrite();

    await expect(guardedImport).rejects.toThrow('stale principal');
    expect(assertCanCommit).toHaveBeenCalledTimes(2);
    expect(profileStorage.values).toEqual(new Map());
    await expect(repository.list()).resolves.toEqual([]);
    await expect(storage.getString(mobileStorageKeys.logbook)).resolves.toBeUndefined();
  });

  it('keeps committed metadata and profile consistent after a post-main failure and retry', async () => {
    const storage = new FailingPostCommitMainReadStore();
    const profileStorage = new RecordingProfileStorage();
    const profileKeyPrefix = 'post-commit-profile:';
    const contentRevision = 'revision-after-main';
    const message: WatchSyncMessage = {
      ...watchMessage,
      session: {
        ...watchMessage.session,
        profile: {
          formatVersion: 1,
          contentRevision,
          sampleIntervalSeconds: 1,
          sampleCount: 2,
        },
        samples: [
          {
            localSessionId: watchMessage.session.localSessionId,
            timestamp: 200,
            depthMeters: 3,
          },
          {
            localSessionId: watchMessage.session.localSessionId,
            timestamp: 201,
            depthMeters: 8,
          },
        ],
      },
    };
    const profileKey =
      `${profileKeyPrefix}${message.session.localSessionId}:${contentRevision}`;
    const repository = new PersistentDiveLogRepository({
      storage,
      profileStorage,
      profileKeyPrefix,
      now: () => 500,
    });

    await expect(repository.importWatchMessages([message])).rejects.toMatchObject(
      {
        name: PersistentJsonCommittedWriteError.name,
        cause: {
          message: 'simulated post-commit recovery failure',
        },
      },
    );

    const pendingKey =
      `${mobileStorageKeys.logbook}:journal:pending:v1`;
    const commitKey =
      `${mobileStorageKeys.logbook}:journal:commit:v1`;
    const pending = await storage.getString(pendingKey);
    expect(await storage.getString(commitKey)).toBeDefined();
    expect(pending).toBeDefined();
    expect(await storage.getString(mobileStorageKeys.logbook)).toBe(pending);
    await expect(profileStorage.read(profileKey)).resolves.toEqual(
      message.session.samples,
    );

    const [recovered] = await repository.list();
    expect(recovered.watchCapture?.profile?.storageKey).toBe(profileKey);
    await expect(profileStorage.read(profileKey)).resolves.toEqual(
      message.session.samples,
    );

    await expect(repository.importWatchMessages([message])).resolves.toHaveLength(1);
    await expect(repository.list()).resolves.toHaveLength(1);
    await expect(profileStorage.read(profileKey)).resolves.toEqual(
      message.session.samples,
    );
    await expect(storage.getString(commitKey)).resolves.toBeUndefined();
    await expect(storage.getString(pendingKey)).resolves.toBeUndefined();
  });

  it('restores profile and metadata when the guard becomes stale during metadata persistence', async () => {
    const storage = new PausedFirstWriteStore();
    const priorEntry = manualEntry({localId: 'prior-entry'});
    const priorMetadata = JSON.stringify({
      schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
      updatedAt: 123,
      value: [priorEntry],
    });
    await storage.seedString(mobileStorageKeys.logbook, priorMetadata);
    const profileStorage = new RecordingProfileStorage();
    const repository = new PersistentDiveLogRepository({
      storage,
      profileStorage,
      now: () => 500,
    });
    let isCurrent = true;
    const assertCanCommit = jest.fn(() => {
      if (!isCurrent) {
        throw new Error('stale principal');
      }
    });
    const guardedImport = repository.importWatchMessages([watchMessage], {
      assertCanCommit,
    });
    await storage.writeStarted;

    isCurrent = false;
    storage.releaseWrite();

    await expect(guardedImport).rejects.toThrow('stale principal');
    expect(assertCanCommit).toHaveBeenCalledTimes(4);
    expect(profileStorage.values).toEqual(new Map());
    await expect(storage.getString(mobileStorageKeys.logbook)).resolves.toBe(
      priorMetadata,
    );
    await expect(repository.list()).resolves.toEqual([priorEntry]);
  });

  it('rolls back to metadata recovered from a committed journal when the guard becomes stale', async () => {
    const storage = new InMemoryKeyValueStore();
    const oldEntry = manualEntry({localId: 'old-main'});
    const recoveredEntry = manualEntry({localId: 'recovered-main'});
    const oldMain = JSON.stringify({
      schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
      updatedAt: 100,
      value: [oldEntry],
    });
    const recoveredMain = JSON.stringify({
      schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
      updatedAt: 200,
      value: [recoveredEntry],
    });
    const pendingKey = `${mobileStorageKeys.logbook}:journal:pending:v1`;
    const commitKey = `${mobileStorageKeys.logbook}:journal:commit:v1`;
    await storage.setString(mobileStorageKeys.logbook, oldMain);
    await storage.setString(pendingKey, recoveredMain);
    await storage.setString(commitKey, JSON.stringify({
      schemaVersion: 1,
      digest: bytesToHex(sha256(utf8ToBytes(recoveredMain))),
      byteCount: utf8ToBytes(recoveredMain).length,
    }));
    const profileStorage = new RecordingProfileStorage();
    const repository = new PersistentDiveLogRepository({
      storage,
      profileStorage,
      now: () => 500,
    });
    let guardCalls = 0;

    await expect(repository.importWatchMessages([watchMessage], {
      assertCanCommit: () => {
        guardCalls += 1;
        if (guardCalls === 4) {
          throw new Error('stale principal after metadata write');
        }
      },
    })).rejects.toThrow('stale principal after metadata write');

    expect(guardCalls).toBe(4);
    expect(profileStorage.values).toEqual(new Map());
    await expect(storage.getString(mobileStorageKeys.logbook)).resolves.toBe(
      recoveredMain,
    );
    await expect(repository.list()).resolves.toEqual([recoveredEntry]);
  });

  it('honors explicit metadata and profile key options', async () => {
    const storage = new InMemoryKeyValueStore();
    const repository = new PersistentDiveLogRepository({
      storage,
      storageKey: 'custom-logbook',
      profileKeyPrefix: 'custom-profile:',
      now: () => 500,
    });

    const [entry] = await repository.importWatchMessages([{ ...watchMessage, session: { ...watchMessage.session, samples: [
      { localSessionId: 'persistent-watch-1', timestamp: 200, depthMeters: 3 },
    ] } }]);

    expect(await storage.getString('custom-logbook')).toBeDefined();
    expect(entry.watchCapture?.profile?.storageKey).toBe('custom-profile:persistent-watch-1:260');
  });

  it('stores independent artifact and sample digests for imported watch profiles', async () => {
    const repository = new PersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      now: () => 500,
    });
    const message = {
      ...watchMessage,
      session: {
        ...watchMessage.session,
        samples: [{
          localSessionId: watchMessage.session.localSessionId,
          timestamp: 200,
          depthMeters: 3,
        }],
      },
    };

    const [saved] = await repository.importWatchMessages([message], {
      artifactDigests: ['a'.repeat(64)],
    });

    expect(saved.watchCapture?.profile).toEqual(expect.objectContaining({
      artifactSha256: 'a'.repeat(64),
      sha256: createWatchProfileDigest(message.session.samples).sha256,
    }));
    expect(saved.watchCapture?.profile?.sha256)
      .not.toBe(saved.watchCapture?.profile?.artifactSha256);
  });

  it('adopts a prepared native profile without hashing the full sample set in JS', async () => {
    const profileStorage = new PreparedProfileStorage();
    const repository = new PersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      profileStorage,
      now: () => 500,
    });
    const previewSamples = Array.from({length: 160}, (_, index) => ({
      localSessionId: 'prepared-large-session',
      timestamp: 200 + index,
      depthMeters: index / 10,
    }));
    const message: WatchSyncMessage = {
      ...watchMessage,
      session: {
        ...watchMessage.session,
        localSessionId: 'prepared-large-session',
        profile: {
          formatVersion: 1,
          contentRevision: 'prepared-large-revision',
          sampleIntervalSeconds: 1,
          sampleCount: 8_000,
          interrupted: false,
        },
        samples: previewSamples,
      },
    };
    const digest = 'b'.repeat(64);
    const digestSpy = jest.spyOn(
      watchProfileDigest,
      'createWatchProfileDigest',
    );
    digestSpy.mockClear();

    const [saved] = await repository.importWatchMessages([message], {
      preparedProfiles: [
        {
          payloadId: 'payload-large',
          sampleCount: 8_000,
          byteCount: 640_000,
          sha256: digest,
        },
      ],
    });

    expect(profileStorage.adoptPrepared).toHaveBeenCalledWith(
      'payload-large',
      expect.stringContaining('prepared-large-session'),
    );
    expect(saved.watchCapture?.profile?.sampleCount).toBe(8_000);
    expect(saved.watchCapture?.profile?.sha256).toBe(digest);
    expect(saved.watchCapture?.samples).toHaveLength(160);
    expect(digestSpy).not.toHaveBeenCalled();
    digestSpy.mockRestore();
  });

  it('migrates every schema-2 mobile status to not-configured without rewriting watch provenance', async () => {
    const storage = new InMemoryKeyValueStore();
    const legacyStatuses = ['localOnly', 'pending', 'synced', 'failed'] as const;
    const legacyEntries = legacyStatuses.map((syncStatus, index) => {
      const currentEntry = manualEntry({
        localId: `legacy-${syncStatus}`,
        manual: {
          ...manualEntry().manual,
          notes: index === 1 ? 'Keep mobile edits.' : undefined,
        },
      });
      const schema2Entry = { ...currentEntry };
      delete (schema2Entry as Partial<DiveLogEntry>).cloudSyncStatus;

      return {
        ...schema2Entry,
        syncStatus,
        ...(index === 1
          ? {
              source: 'watch' as const,
              watchCapture: {
                importKey: 'legacy-watch:260',
                importedAt: 300,
                session: {
                  localSessionId: 'legacy-watch',
                  startedAt: 200,
                  endedAt: 260,
                  syncStatus: 'synced' as const,
                  samples: [],
                },
                measuredValues: { startedAt: 200, endedAt: 260 },
                samples: [],
              },
            }
          : {}),
      };
    });
    expect(legacyEntries.every(entry => !('cloudSyncStatus' in entry))).toBe(true);
    await storage.setString(
      mobileStorageKeys.logbook,
      JSON.stringify({ schemaVersion: 2, updatedAt: 500, value: legacyEntries }),
    );

    const entries = await new PersistentDiveLogRepository({ storage, now: () => 600 }).list();
    const watchEntry = entries.find(entry => entry.localId === 'legacy-pending');

    expect(entries.map(entry => entry.cloudSyncStatus)).toEqual([
      'notConfigured',
      'notConfigured',
      'notConfigured',
      'notConfigured',
    ]);
    expect(watchEntry?.watchCapture?.session.syncStatus).toBe('synced');
    expect(watchEntry?.manual.notes).toBe('Keep mobile edits.');
    expect(entries.every(entry => !('syncStatus' in entry))).toBe(true);
  });

  it('saves, reloads, sorts, and deletes persisted entries', async () => {
    const storage = new InMemoryKeyValueStore();
    const repository = new PersistentDiveLogRepository({ storage, now: () => 999 });

    await repository.save(manualEntry({ localId: 'older', manual: { ...manualEntry().manual, measuredValues: { startedAt: 100 } } }));
    await repository.save(manualEntry({ localId: 'newer', manual: { ...manualEntry().manual, measuredValues: { startedAt: 300 } } }));

    const reloadedRepository = new PersistentDiveLogRepository({ storage, now: () => 999 });

    expect((await reloadedRepository.list()).map(entry => entry.localId)).toEqual(['newer', 'older']);

    await reloadedRepository.delete('newer');

    expect((await new PersistentDiveLogRepository({ storage, now: () => 999 }).list()).map(entry => entry.localId)).toEqual(['older']);
  });

  it('restores exact metadata and full profile when guarded delete becomes stale during profile removal', async () => {
    const storage = new InMemoryKeyValueStore();
    const profileStorage = new PausedRemoveProfileStorage();
    const profileKey = 'delete-profile';
    const fullProfile: WatchDepthSample[] = [
      {localSessionId: 'session-delete', timestamp: 200, depthMeters: 3},
      {localSessionId: 'session-delete', timestamp: 201, depthMeters: 9},
    ];
    profileStorage.values.set(profileKey, fullProfile);
    const repository = new PersistentDiveLogRepository({
      storage,
      profileStorage,
      now: () => 500,
    });
    const existing = watchEntryWithProfile(
      'delete',
      'session-delete:260',
      profileKey,
    );
    existing.watchCapture!.profile!.sampleCount = fullProfile.length;
    await repository.save(existing);
    const rawBefore = await storage.getString(mobileStorageKeys.logbook);
    let isCurrent = true;
    let deleteError: unknown;
    const observedDelete = repository
      .delete(existing.localId, {
        assertCanCommit: () => {
          if (!isCurrent) {
            throw new Error('stale principal');
          }
        },
      })
      .catch(error => {
        deleteError = error;
      });
    await profileStorage.removeStarted;

    isCurrent = false;
    profileStorage.releaseRemove();
    await observedDelete;

    expect((deleteError as Error | undefined)?.message).toBe(
      'stale principal',
    );
    await expect(storage.getString(mobileStorageKeys.logbook)).resolves.toBe(
      rawBefore,
    );
    await expect(repository.get(existing.localId)).resolves.toEqual(existing);
    await expect(profileStorage.read(profileKey)).resolves.toEqual(fullProfile);
  });

  it('retains a profile after metadata delete until serialized cleanup runs', async () => {
    const storage = new InMemoryKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const profileKey = 'retained-delete-profile';
    const fullProfile: WatchDepthSample[] = [
      {localSessionId: 'retained-session', timestamp: 200, depthMeters: 4},
      {localSessionId: 'retained-session', timestamp: 201, depthMeters: 11},
    ];
    profileStorage.values.set(profileKey, fullProfile);
    const repository = new PersistentDiveLogRepository({
      storage,
      profileStorage,
      now: () => 500,
    });
    const existing = watchEntryWithProfile(
      'retained-delete',
      'retained-session:260',
      profileKey,
    );
    existing.watchCapture!.profile!.sampleCount = fullProfile.length;
    await repository.save(existing);

    await repository.delete(existing.localId, {
      retainProfileAfterDelete: true,
    });

    await expect(repository.get(existing.localId)).resolves.toBeUndefined();
    await expect(profileStorage.read(profileKey)).resolves.toEqual(fullProfile);
    expect(profileStorage.removals).toEqual([]);

    await repository.removeWatchProfileIfUnreferenced(profileKey);

    await expect(profileStorage.read(profileKey)).resolves.toBeUndefined();
    expect(profileStorage.removals).toEqual([profileKey]);
  });

  it('serializes profile cleanup behind a concurrent import of the same key', async () => {
    const storage = new InMemoryKeyValueStore();
    const profileStorage = new PausedProfileStorage();
    const repository = new PersistentDiveLogRepository({
      storage,
      profileStorage,
      profileKeyPrefix: 'profile:',
      now: () => 500,
    });
    const contentRevision = 'shared-revision';
    const profileKey = `profile:${watchMessage.session.localSessionId}:${contentRevision}`;
    const message: WatchSyncMessage = {
      ...watchMessage,
      session: {
        ...watchMessage.session,
        profile: {
          formatVersion: 1,
          contentRevision,
          sampleIntervalSeconds: 1,
          sampleCount: 1,
        },
        samples: [
          {
            localSessionId: watchMessage.session.localSessionId,
            timestamp: 200,
            depthMeters: 7,
          },
        ],
      },
    };
    const observedImport = repository.importWatchMessages([message]);
    await profileStorage.writeStarted;
    const observedCleanup = repository.removeWatchProfileIfUnreferenced(
      profileKey,
    );

    profileStorage.releaseWrite();
    const [imported] = await observedImport;
    await observedCleanup;

    expect(imported.watchCapture?.profile?.storageKey).toBe(profileKey);
    await expect(profileStorage.read(profileKey)).resolves.toEqual(
      message.session.samples,
    );
    expect(profileStorage.removals).not.toContain(profileKey);
  });

  it('persists account revision and conflict state in the current schema', async () => {
    const storage = new InMemoryKeyValueStore();
    const repository = new PersistentDiveLogRepository({storage, now: () => 999});
    await repository.save(manualEntry({
      remoteId: '10000000-0000-4000-8000-000000000001',
      remoteRevision: 4,
      ownerUserId: '00000000-0000-4000-8000-000000000001',
      cloudSyncStatus: 'conflict',
    }));

    await expect(
      new PersistentDiveLogRepository({storage, now: () => 999}).get('manual-1'),
    ).resolves.toMatchObject({remoteRevision: 4, cloudSyncStatus: 'conflict'});
  });

  it('dedupes watch imports while preserving manual edits after reload', async () => {
    const storage = new InMemoryKeyValueStore();
    const repository = new PersistentDiveLogRepository({ storage, now: () => 500 });
    const [importedEntry] = await repository.importWatchMessages([watchMessage]);

    await repository.save({
      ...importedEntry,
      manual: {
        ...importedEntry.manual,
        site: { name: 'Edited Reef' },
        notes: 'Keep mobile edits.',
      },
      provenance: {
        ...importedEntry.provenance,
        site: 'manual',
        notes: 'manual',
      },
    });

    const reloadedRepository = new PersistentDiveLogRepository({ storage, now: () => 700 });
    const [reimportedEntry] = await reloadedRepository.importWatchMessages([
      {
        ...watchMessage,
        session: {
          ...watchMessage.session,
          syncStatus: 'synced',
          siteName: 'Updated Watch Reef',
          maxDepthMeters: 18,
        },
      },
    ]);

    expect(await reloadedRepository.list()).toHaveLength(1);
    expect(reimportedEntry.localId).toBe(importedEntry.localId);
    expect(reimportedEntry.manual.site.name).toBe('Edited Reef');
    expect(reimportedEntry.manual.notes).toBe('Keep mobile edits.');
    expect(reimportedEntry.cloudSyncStatus).toBe('notConfigured');
    expect(reimportedEntry.watchCapture?.session.siteName).toBe('Updated Watch Reef');
    expect(reimportedEntry.watchCapture?.session.syncStatus).toBe('synced');
    expect(reimportedEntry.watchCapture?.measuredValues.maxDepthMeters).toBe(18);
  });

  it('returns cloned entries so callers cannot mutate persisted state', async () => {
    const repository = new PersistentDiveLogRepository({ storage: new InMemoryKeyValueStore(), now: () => 500 });

    const saved = await repository.save(manualEntry());
    saved.manual.site.name = 'Mutated Reef';

    const [listed] = await repository.list();
    listed.manual.site.name = 'Listed Mutation';

    expect((await repository.get('manual-1'))?.manual.site.name).toBe('Manual Reef');
  });

  it('stores the complete watch profile separately and keeps only a bounded peak preview in metadata', async () => {
    const storage = new InMemoryKeyValueStore();
    const repository = new PersistentDiveLogRepository({ storage, now: () => 500 });
    const samples = Array.from({ length: 1_000 }, (_, index) => ({
      localSessionId: `sample-${index}`,
      timestamp: 200 + index,
      depthMeters: index === 501 ? 42 : index % 20,
    }));

    const [entry] = await repository.importWatchMessages([{
      ...watchMessage,
      session: {
        ...watchMessage.session,
        profile: {
          formatVersion: 1,
          contentRevision: 'revision-1',
          sampleIntervalSeconds: 1,
          sampleCount: samples.length,
        },
        samples,
      },
    }]);

    expect(entry.watchCapture?.samples.length).toBeLessThanOrEqual(160);
    expect(entry.watchCapture?.samples.some(sample => sample.depthMeters === 42)).toBe(true);
    expect(entry.watchCapture?.profile?.sampleCount).toBe(1_000);
    await expect(repository.getWatchProfile(entry.localId)).resolves.toHaveLength(1_000);
    await expect(repository.readStoredWatchProfile(entry.localId)).resolves.toHaveLength(1_000);
  });

  it('does not use inline preview samples when the stored profile sidecar is missing', async () => {
    const profileStorage = new RecordingProfileStorage();
    const repository = new PersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      profileStorage,
      now: () => 500,
    });
    const preview = Array.from({length: 160}, (_, index) => ({
      localSessionId: 'preview-only',
      timestamp: 200 + index,
      depthMeters: index,
    }));
    await repository.save({
      ...manualEntry({localId: 'preview-only', source: 'watch'}),
      watchCapture: {
        importKey: 'preview-only:200',
        importedAt: 500,
        session: {localSessionId: 'preview-only', startedAt: 200, samples: preview},
        measuredValues: {startedAt: 200},
        samples: preview,
        profile: {
          storageKey: 'missing-sidecar',
          contentRevision: 'revision-1',
          sampleCount: preview.length,
        },
      },
    });

    await expect(repository.getWatchProfile('preview-only')).resolves.toEqual(preview);
    await expect(repository.readStoredWatchProfile('preview-only')).resolves.toBeUndefined();
  });

  it('preserves a shared profile until the final metadata reference is deleted', async () => {
    const profileStorage = new RecordingProfileStorage();
    const profileKey = 'shared-profile';
    profileStorage.values.set(profileKey, []);
    const repository = new PersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      profileStorage,
      now: () => 500,
    });
    await repository.save(watchEntryWithProfile('shared-a', 'shared-a:260', profileKey));
    await repository.save(watchEntryWithProfile('shared-b', 'shared-b:260', profileKey));

    await repository.delete('shared-a');

    expect(profileStorage.values.has(profileKey)).toBe(true);
    expect(profileStorage.removals).toEqual([]);

    await repository.delete('shared-b');

    expect(profileStorage.values.has(profileKey)).toBe(false);
    expect(profileStorage.removals).toEqual([profileKey]);
  });

  it('preserves an obsolete profile while another metadata entry still references it', async () => {
    const profileStorage = new RecordingProfileStorage();
    const oldProfileKey = 'shared-old-profile';
    profileStorage.values.set(oldProfileKey, []);
    const repository = new PersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      profileStorage,
      profileKeyPrefix: 'profile:',
      now: () => 500,
    });
    await repository.save(watchEntryWithProfile('updated-entry', 'persistent-watch-1:260', oldProfileKey));
    await repository.save(watchEntryWithProfile('remaining-entry', 'remaining:260', oldProfileKey));

    await repository.importWatchMessages([{
      ...watchMessage,
      session: {
        ...watchMessage.session,
        profile: {
          formatVersion: 1,
          contentRevision: 'revision-2',
          sampleIntervalSeconds: 1,
          sampleCount: 1,
        },
        samples: [{ localSessionId: 'persistent-watch-1', timestamp: 200, depthMeters: 4 }],
      },
    }]);

    expect(profileStorage.values.has(oldProfileKey)).toBe(true);
    expect(profileStorage.removals).not.toContain(oldProfileKey);
  });

  it('keeps committed metadata and new profiles when obsolete cleanup partially fails', async () => {
    const profileStorage = new FailingObsoleteProfileStorage('obsolete-a');
    profileStorage.values.set('obsolete-a', []);
    profileStorage.values.set('obsolete-b', []);
    const repository = new PersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      profileStorage,
      profileKeyPrefix: 'profile:',
      now: () => 500,
    });
    await repository.save(
      watchEntryWithProfile('a', 'session-a:260', 'obsolete-a'),
    );
    await repository.save(
      watchEntryWithProfile('b', 'session-b:260', 'obsolete-b'),
    );
    const messages: WatchSyncMessage[] = ['a', 'b'].map(suffix => ({
      ...watchMessage,
      session: {
        ...watchMessage.session,
        localSessionId: `session-${suffix}`,
        profile: {
          formatVersion: 1,
          contentRevision: 'revision-2',
          sampleIntervalSeconds: 1,
          sampleCount: 1,
        },
        samples: [
          {
            localSessionId: `session-${suffix}`,
            timestamp: 200,
            depthMeters: suffix === 'a' ? 4 : 5,
          },
        ],
      },
    }));

    await expect(repository.importWatchMessages(messages)).resolves.toHaveLength(2);

    const entries = await repository.list();
    expect(entries.map(value => value.watchCapture?.profile?.storageKey).sort()).toEqual([
      'profile:session-a:revision-2',
      'profile:session-b:revision-2',
    ]);
    expect(profileStorage.values.has('profile:session-a:revision-2')).toBe(true);
    expect(profileStorage.values.has('profile:session-b:revision-2')).toBe(true);
    expect(profileStorage.values.has('obsolete-a')).toBe(true);
    expect(profileStorage.values.has('obsolete-b')).toBe(false);
  });

  it('rejects malformed nested log fields at the unknown migration entry point', () => {
    const malformedEntry = manualEntry();
    malformedEntry.mobile.mediaPlaceholders = [42 as unknown as string];

    expect(() => migrateDiveLogbookEnvelope({
      schemaVersion: 3,
      updatedAt: 500,
      value: [malformedEntry],
    } as unknown)).toThrow(/logbook/i);
  });

  it('does not load pre-reset v1 logbook entries', async () => {
    const storage = new InMemoryKeyValueStore();
    await storage.setString(
      'dive-app:logbook:v1',
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 500,
        value: [manualEntry({ localId: 'legacy-v1-entry' })],
      }),
    );

    const repository = new PersistentDiveLogRepository({ storage, now: () => 500 });

    expect(await repository.list()).toEqual([]);
  });
});
