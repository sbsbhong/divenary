import { createDefaultDiveLogRepository, LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import type { WatchSyncMessage } from '../src/types/dive-session';

describe('LocalDiveLogRepository', () => {
  const watchMessage: WatchSyncMessage = {
    type: 'sessionEnded',
    session: {
      localSessionId: 'repo-watch-session-1',
      schemaVersion: 1,
      siteName: 'Repository Reef',
      syncStatus: 'pending',
      startedAt: 1781352000,
      endedAt: 1781352600,
      maxDepthMeters: 10,
      averageDepthMeters: 6,
      samples: [],
    },
  };

  it('uses an injected clock for deterministic repeated imports and dedupes by import key', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781354000 });

    const firstImport = await repository.importWatchMessages([watchMessage]);
    const secondImport = await repository.importWatchMessages([
      {
        ...watchMessage,
        session: {
          ...watchMessage.session,
          syncStatus: 'synced',
          siteName: 'Updated Repository Reef',
        },
      },
    ]);

    expect(firstImport).toHaveLength(1);
    expect(secondImport).toHaveLength(1);
    expect(secondImport[0]).toMatchObject({
      localId: 'watch:repo-watch-session-1:1781352600',
      createdAt: 1781354000,
      updatedAt: 1781354000,
      syncStatus: 'pending',
      manual: {
        site: {
          name: 'Repository Reef',
        },
      },
    });
    expect(secondImport[0].watchCapture).toMatchObject({
      importKey: 'repo-watch-session-1:1781352600',
      importedAt: 1781354000,
    });
  });

  it('seeds default fixture entries with stable timestamps instead of wall-clock time', () => {
    const dateNow = jest.spyOn(Date, 'now');
    dateNow.mockReturnValueOnce(1000);
    const firstRepository = createDefaultDiveLogRepository();
    dateNow.mockReturnValueOnce(999999999);
    const secondRepository = createDefaultDiveLogRepository();

    expect(firstRepository.listSync()[0].createdAt).toBe(secondRepository.listSync()[0].createdAt);
    expect(firstRepository.listSync()[0].watchCapture?.importedAt).toBe(secondRepository.listSync()[0].watchCapture?.importedAt);

    dateNow.mockRestore();
  });

  it('preserves manual and mobile edits when re-importing an existing watch entry', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781354000 });
    const [importedEntry] = await repository.importWatchMessages([watchMessage]);

    await repository.save({
      ...importedEntry,
      manual: {
        site: { siteId: 'manual-site', name: 'Manual Reef' },
        buddyIds: ['manual-buddy'],
        gearIds: ['manual-gear'],
        tags: ['manual-tag'],
        observedMarineLife: ['nudibranch'],
        notes: 'Edited after review.',
        rating: 5,
        measuredValues: {
          startedAt: 1781351999,
          endedAt: 1781352601,
          durationSeconds: 602,
          maxDepthMeters: 11,
          averageDepthMeters: 6.2,
          waterTemperatureCelsius: 23.8,
          diveMode: 'scuba',
          gasLabel: 'Nitrox note',
        },
      },
      mobile: {
        mediaPlaceholders: ['edited-photo-placeholder'],
      },
      provenance: {
        ...importedEntry.provenance,
        site: 'manual',
        buddyIds: 'manual',
        gearIds: 'manual',
        tags: 'manual',
        observedMarineLife: 'manual',
        notes: 'manual',
        rating: 'manual',
        measuredValues: 'manual',
        mediaPlaceholders: 'mobile',
      },
    });

    const [reimportedEntry] = await repository.importWatchMessages([
      {
        ...watchMessage,
        session: {
          ...watchMessage.session,
          syncStatus: 'synced',
          siteName: 'Watch Updated Reef',
          notes: 'Watch context should not overwrite manual edit.',
          rating: 2,
          tags: ['watch-tag'],
          maxDepthMeters: 14,
          averageDepthMeters: 8,
        },
      },
    ]);

    expect(reimportedEntry).toMatchObject({
      localId: importedEntry.localId,
      createdAt: importedEntry.createdAt,
      updatedAt: 1781354000,
      syncStatus: 'pending',
      manual: {
        site: { siteId: 'manual-site', name: 'Manual Reef' },
        buddyIds: ['manual-buddy'],
        gearIds: ['manual-gear'],
        tags: ['manual-tag'],
        observedMarineLife: ['nudibranch'],
        notes: 'Edited after review.',
        rating: 5,
        measuredValues: {
          startedAt: 1781351999,
          endedAt: 1781352601,
          durationSeconds: 602,
          maxDepthMeters: 11,
          averageDepthMeters: 6.2,
          waterTemperatureCelsius: 23.8,
          diveMode: 'scuba',
          gasLabel: 'Nitrox note',
        },
      },
      mobile: {
        mediaPlaceholders: ['edited-photo-placeholder'],
      },
      provenance: {
        site: 'manual',
        buddyIds: 'manual',
        gearIds: 'manual',
        tags: 'manual',
        observedMarineLife: 'manual',
        notes: 'manual',
        rating: 'manual',
        measuredValues: 'manual',
        mediaPlaceholders: 'mobile',
        maxDepthMeters: 'watch',
        averageDepthMeters: 'watch',
      },
    });
    expect(reimportedEntry.watchCapture?.session.siteName).toBe('Watch Updated Reef');
    expect(reimportedEntry.watchCapture?.session.syncStatus).toBe('synced');
    expect(reimportedEntry.watchCapture?.session.notes).toBe('Watch context should not overwrite manual edit.');
    expect(reimportedEntry.watchCapture?.measuredValues).toMatchObject({
      maxDepthMeters: 14,
      averageDepthMeters: 8,
    });
  });
});
