import { diveLogEntryToMobileSession } from '../src/states/use-dive-logbook';
import type { DiveLogEntry, DiveLogSyncStatus } from '../src/types/dive-log-entry';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import {
  toMobileSessionSyncStatus,
  toVisibleCloudSyncStatus,
  toVisibleRecentSessionSyncStatus,
} from '../src/utils/dive-log-sync-status';

describe('diveLogEntryToMobileSession', () => {
  it('overlays manual context onto watch-backed compatibility sessions', () => {
    const entry: DiveLogEntry = {
      localId: 'watch:session-1:1781352600',
      source: 'watch',
      syncStatus: 'synced',
      createdAt: 1781353000,
      updatedAt: 1781354000,
      manual: {
        site: { siteId: 'manual-site', name: 'Manual Reef' },
        buddyIds: ['manual-buddy'],
        gearIds: ['manual-gear'],
        tags: ['manual-tag'],
        observedMarineLife: [],
        notes: 'Manual review note.',
        rating: 5,
        measuredValues: {
          diveMode: 'scuba',
          gasLabel: 'Manual gas note',
          maxDepthMeters: 99,
          averageDepthMeters: 88,
        },
      },
      mobile: {
        mediaPlaceholders: ['manual-photo'],
      },
      watchCapture: {
        importKey: 'session-1:1781352600',
        importedAt: 1781353000,
        session: {
          localSessionId: 'session-1',
          startedAt: 1781352000,
          endedAt: 1781352600,
          siteName: 'Watch Reef',
          notes: 'Watch note',
          tags: ['watch-tag'],
          buddyIds: ['watch-buddy'],
          gearIds: ['watch-gear'],
          rating: 2,
          diveMode: 'freedive',
          gasLabel: 'Watch gas',
          maxDepthMeters: 12,
          averageDepthMeters: 7,
          samples: [],
        },
        measuredValues: {
          startedAt: 1781352000,
          endedAt: 1781352600,
          durationSeconds: 600,
          maxDepthMeters: 12,
          averageDepthMeters: 7,
        },
        samples: [],
      },
      provenance: {},
    };

    expect(diveLogEntryToMobileSession(entry)).toMatchObject({
      siteId: 'manual-site',
      siteName: 'Manual Reef',
      notes: 'Manual review note.',
      tags: ['manual-tag'],
      buddyIds: ['manual-buddy'],
      gearIds: ['manual-gear'],
      rating: 5,
      diveMode: 'scuba',
      gasLabel: 'Manual gas note',
      maxDepthMeters: 12,
      averageDepthMeters: 7,
      mediaPlaceholders: ['manual-photo'],
    });
  });

  it('derives a manual compatibility session end time from manual duration', () => {
    const entry = createBlankDiveLogEntry({
      localId: 'manual-entry-1',
      now: 1781351000,
    });

    entry.manual.measuredValues = {
      startedAt: 1781352000,
      durationSeconds: 600,
      maxDepthMeters: 12,
    };

    expect(diveLogEntryToMobileSession(entry)).toMatchObject({
      startedAt: 1781352000,
      endedAt: 1781352600,
      maxDepthMeters: 12,
    });
  });

  it.each(['pending', 'synced', 'failed'] as const)(
    'maps non-local entry sync status %s to visible cloud-pending mobile session state',
    syncStatus => {
      expect(diveLogEntryToMobileSession(createWatchBackedEntry(syncStatus)).syncStatus).toBe('pending');
    },
  );

  it('keeps local-only manual entries out of visible cloud sync status', () => {
    const entry = createBlankDiveLogEntry({
      localId: 'manual-local-only',
      now: 1781351000,
    });

    expect(diveLogEntryToMobileSession(entry).syncStatus).toBeUndefined();
  });

  it('centralizes current visible cloud sync status mapping', () => {
    expect(toVisibleCloudSyncStatus('localOnly')).toBe('localOnly');
    expect(toVisibleCloudSyncStatus('pending')).toBe('pending');
    expect(toVisibleCloudSyncStatus('synced')).toBe('pending');
    expect(toVisibleCloudSyncStatus('failed')).toBe('pending');

    expect(toMobileSessionSyncStatus('localOnly')).toBeUndefined();
    expect(toMobileSessionSyncStatus('synced')).toBe('pending');

    expect(toVisibleRecentSessionSyncStatus(undefined)).toBe('pending');
    expect(toVisibleRecentSessionSyncStatus('pending')).toBe('pending');
    expect(toVisibleRecentSessionSyncStatus('synced')).toBe('pending');
    expect(toVisibleRecentSessionSyncStatus('failed')).toBe('pending');
  });

  it('falls back to the raw watch note when a watch-backed entry has no manual note', () => {
    const entry: DiveLogEntry = {
      localId: 'watch:session-raw-note:1781352600',
      source: 'watch',
      syncStatus: 'synced',
      createdAt: 1781353000,
      updatedAt: 1781354000,
      manual: {
        site: {},
        buddyIds: [],
        gearIds: [],
        tags: [],
        observedMarineLife: [],
        measuredValues: {},
      },
      mobile: {
        mediaPlaceholders: [],
      },
      watchCapture: {
        importKey: 'session-raw-note:1781352600',
        importedAt: 1781353000,
        session: {
          localSessionId: 'session-raw-note',
          startedAt: 1781352000,
          endedAt: 1781352600,
          notes: 'Watch quick note',
          samples: [],
        },
        measuredValues: {
          startedAt: 1781352000,
          endedAt: 1781352600,
        },
        samples: [],
      },
      provenance: {},
    };

    expect(diveLogEntryToMobileSession(entry).notes).toBe('Watch quick note');
  });

  it('falls back to the raw watch note when a watch-backed entry has a blank manual note', () => {
    const entry: DiveLogEntry = {
      localId: 'watch:session-blank-manual-note:1781352600',
      source: 'watch',
      syncStatus: 'synced',
      createdAt: 1781353000,
      updatedAt: 1781354000,
      manual: {
        site: {},
        buddyIds: [],
        gearIds: [],
        tags: [],
        observedMarineLife: [],
        notes: '',
        measuredValues: {},
      },
      mobile: {
        mediaPlaceholders: [],
      },
      watchCapture: {
        importKey: 'session-blank-manual-note:1781352600',
        importedAt: 1781353000,
        session: {
          localSessionId: 'session-blank-manual-note',
          startedAt: 1781352000,
          endedAt: 1781352600,
          notes: 'Watch quick note after summary',
          samples: [],
        },
        measuredValues: {
          startedAt: 1781352000,
          endedAt: 1781352600,
        },
        samples: [],
      },
      provenance: {},
    };

    expect(diveLogEntryToMobileSession(entry).notes).toBe('Watch quick note after summary');
  });
});

function createWatchBackedEntry(syncStatus: DiveLogSyncStatus): DiveLogEntry {
  return {
    localId: `watch:session-${syncStatus}:1781352600`,
    source: 'watch',
    syncStatus,
    createdAt: 1781353000,
    updatedAt: 1781354000,
    manual: {
      site: { name: 'Visible Status Reef' },
      buddyIds: [],
      gearIds: [],
      tags: [],
      observedMarineLife: [],
      measuredValues: {},
    },
    mobile: {
      mediaPlaceholders: [],
    },
    watchCapture: {
      importKey: `session-${syncStatus}:1781352600`,
      importedAt: 1781353000,
      session: {
        localSessionId: `session-${syncStatus}`,
        startedAt: 1781352000,
        endedAt: 1781352600,
        samples: [],
      },
      measuredValues: {
        startedAt: 1781352000,
        endedAt: 1781352600,
      },
      samples: [],
    },
    provenance: {},
  };
}
