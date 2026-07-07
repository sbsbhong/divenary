import { PersistentDiveLogRepository } from '../src/repositories/persistent-dive-log-repository';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { WatchSyncMessage } from '../src/types/dive-session';

const manualEntry = (overrides: Partial<DiveLogEntry> = {}): DiveLogEntry => ({
  localId: 'manual-1',
  source: 'manual',
  syncStatus: 'localOnly',
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
    expect(reimportedEntry.syncStatus).toBe('pending');
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
