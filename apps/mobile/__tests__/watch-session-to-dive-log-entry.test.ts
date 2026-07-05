import type { WatchSession } from '../src/types/dive-session';
import { watchSessionToDiveLogEntry } from '../src/utils/watch-session-to-dive-log-entry';

describe('watchSessionToDiveLogEntry', () => {
  const baseSession: WatchSession = {
    localSessionId: 'watch-session-1',
    schemaVersion: 1,
    diveMode: 'scuba',
    gasLabel: 'Air',
    siteId: 'site-1',
    siteName: 'Moon Island',
    buddyIds: ['buddy-1'],
    gearIds: ['mask-1'],
    tags: ['training'],
    notes: 'Calm recreational review dive.',
    rating: 4,
    syncStatus: 'synced',
    startedAt: 1781352000,
    endedAt: 1781352600,
    maxDepthMeters: 12.4,
    averageDepthMeters: 7.1,
    waterTemperatureCelsius: 24.5,
    samples: [
      {
        localSessionId: 'watch-session-1',
        timestamp: 1781352000,
        depthMeters: 0,
        waterTemperatureCelsius: 25,
      },
      {
        localSessionId: 'watch-session-1',
        timestamp: 1781352300,
        depthMeters: 12.4,
        waterTemperatureCelsius: 24,
      },
    ],
  };

  it.each(['pending', 'synced', 'failed'] as const)('preserves watch sync status %s', syncStatus => {
    const entry = watchSessionToDiveLogEntry({
      session: { ...baseSession, syncStatus },
      now: 1781353000,
    });

    expect(entry.syncStatus).toBe(syncStatus);
  });

  it('maps a watch session into a watch-sourced log entry without losing the raw payload', () => {
    const entry = watchSessionToDiveLogEntry({
      session: baseSession,
      now: 1781353000,
    });

    expect(entry.localId).toBe('watch:watch-session-1:1781352600');
    expect(entry.watchCapture?.importKey).toBe('watch-session-1:1781352600');
    expect(entry.source).toBe('watch');
    expect(entry.syncStatus).toBe('synced');
    expect(entry.createdAt).toBe(1781353000);
    expect(entry.updatedAt).toBe(1781353000);
    expect(entry.watchCapture?.session).toBe(baseSession);

    expect(entry.manual).toMatchObject({
      site: { siteId: 'site-1', name: 'Moon Island' },
      buddyIds: ['buddy-1'],
      gearIds: ['mask-1'],
      tags: ['training'],
      notes: 'Calm recreational review dive.',
      rating: 4,
      measuredValues: {
        diveMode: 'scuba',
        gasLabel: 'Air',
      },
    });

    expect(entry.watchCapture?.measuredValues).toMatchObject({
      startedAt: 1781352000,
      endedAt: 1781352600,
      durationSeconds: 600,
      maxDepthMeters: 12.4,
      averageDepthMeters: 7.1,
      waterTemperatureCelsius: 24.5,
    });
    expect(entry.watchCapture?.samples).toEqual(baseSession.samples);

    expect(entry.provenance).toMatchObject({
      startedAt: 'watch',
      endedAt: 'watch',
      durationSeconds: 'watch',
      maxDepthMeters: 'watch',
      averageDepthMeters: 'watch',
      waterTemperatureCelsius: 'watch',
      depthSamples: 'watch',
      site: 'manual',
      buddyIds: 'manual',
      gearIds: 'manual',
      tags: 'manual',
      notes: 'manual',
      rating: 'manual',
      measuredValues: 'manual',
    });
  });

  it('maps source plan metadata into the log title overlay', () => {
    const entry = watchSessionToDiveLogEntry({
      session: {
        ...baseSession,
        sourcePlanLocalId: 'plan-1',
        planTitle: 'Blue Wall morning',
      },
      now: 1781353000,
    });

    expect(entry.manual.title).toBe('Blue Wall morning');
    expect(entry.watchCapture?.session.sourcePlanLocalId).toBe('plan-1');
  });

  it('preserves freedive segments and uses freedive max depth for watch measured values', () => {
    const segments = [
      {
        segmentId: 'freedive-segment-1',
        index: 1,
        startedAt: 1781352060,
        endedAt: 1781352102,
        durationSeconds: 42,
        maxDepthMeters: 14.2,
        minDepthMeters: 0,
        sampleStartIndex: 0,
        sampleEndIndex: 0,
      },
      {
        segmentId: 'freedive-segment-2',
        index: 2,
        startedAt: 1781352240,
        endedAt: 1781352304,
        durationSeconds: 64,
        maxDepthMeters: 18.7,
        minDepthMeters: 0,
        sampleStartIndex: 0,
        sampleEndIndex: 0,
      },
    ];
    const session: WatchSession = {
      localSessionId: 'freedive-watch-session-1',
      schemaVersion: 1,
      diveMode: 'freedive',
      startedAt: 1781352000,
      endedAt: 1781352600,
      samples: [],
      freedive: {
        diveCount: 2,
        maxDepthMeters: 18.7,
        longestDiveDurationSeconds: 64,
        segments,
      },
    };

    const entry = watchSessionToDiveLogEntry({
      session,
      now: 1781353000,
    });

    expect(entry.watchCapture?.session.freedive?.segments).toEqual(segments);
    expect(entry.watchCapture?.measuredValues.maxDepthMeters).toBe(18.7);
    expect(entry.watchCapture?.measuredValues.averageDepthMeters).toBeUndefined();
  });

  it('preserves scuba safety stop metadata and uses scuba payload values for watch measured values', () => {
    const safetyStop = {
      status: 'completed' as const,
      required: true,
      completed: true,
      targetDepthMeters: 5,
      minDepthMeters: 3,
      maxDepthMeters: 6,
      durationSeconds: 180,
      startedAt: 1781352420,
      completedAt: 1781352600,
      remainingSeconds: 0,
      timeInZoneSeconds: 180,
    };
    const session: WatchSession = {
      localSessionId: 'scuba-watch-session-1',
      schemaVersion: 1,
      diveMode: 'scuba',
      startedAt: 1781352000,
      endedAt: 1781352900,
      maxDepthMeters: 8,
      averageDepthMeters: 4,
      waterTemperatureCelsius: 20,
      samples: [
        {
          localSessionId: 'scuba-watch-session-1',
          timestamp: 1781352300,
          depthMeters: 12,
          waterTemperatureCelsius: 19,
        },
      ],
      scuba: {
        gasLabel: 'Nitrox 32',
        maxDepthMeters: 30.2,
        averageDepthMeters: 18.4,
        waterTemperatureCelsius: 23.1,
        latestAscentRateMetersPerMinute: 4.2,
        maxAscentRateMetersPerMinute: 7.8,
        safetyStop,
      },
    };

    const entry = watchSessionToDiveLogEntry({
      session,
      now: 1781353000,
    });

    expect(entry.watchCapture?.session.scuba?.safetyStop).toEqual(safetyStop);
    expect(entry.watchCapture?.measuredValues).toMatchObject({
      maxDepthMeters: 30.2,
      averageDepthMeters: 18.4,
      waterTemperatureCelsius: 23.1,
    });
    expect(entry.manual.measuredValues.gasLabel).toBe('Nitrox 32');
  });
});
