import {
  createDefaultPersistentDiveLogRepository,
  migrateDiveLogbookEnvelope,
  PersistentDiveLogRepository,
} from '../src/repositories/persistent-dive-log-repository';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type { PersistentKeyValueStore } from '../src/storage/persistent-key-value-store';
import { mobileStorageKeys } from '../src/storage/storage-keys';
import type { WatchProfileStorage } from '../src/storage/watch-profile-storage';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { WatchDepthSample, WatchSyncMessage } from '../src/types/dive-session';

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
