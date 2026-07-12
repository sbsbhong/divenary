import { PersistentDiveLogRepository } from '../src/repositories/persistent-dive-log-repository';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import { mobileStorageKeys } from '../src/storage/storage-keys';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { WatchSyncMessage } from '../src/types/dive-session';

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

describe('PersistentDiveLogRepository', () => {
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
