import type { DivePlan } from '../src/types/dive-plan';
import type { WatchSession } from '../src/types/dive-session';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import { watchSessionToDiveLogEntry } from '../src/utils/watch-session-to-dive-log-entry';
import {
  getUnsupportedDepthForLogEntry,
  getUnsupportedDepthForPlan,
  getUnsupportedDepthForWatchSession,
  SUPPORTED_WATCH_DEPTH_LIMIT_METERS,
} from '../src/utils/unsupported-depth';

const plan = (plannedMaxDepthMeters: number | undefined): DivePlan => ({
  localId: 'plan-unsupported-depth',
  status: 'draft',
  createdAt: 1781352000,
  updatedAt: 1781352000,
  site: {},
  buddyIds: [],
  gearIds: [],
  tags: [],
  plannedValues: { plannedMaxDepthMeters },
  checklistItems: [],
});

const watchSession = (overrides: Partial<WatchSession> = {}): WatchSession => ({
  localSessionId: 'watch-unsupported-depth',
  schemaVersion: 2,
  startedAt: 1781352000,
  endedAt: 1781352600,
  diveMode: 'scuba',
  scuba: {
    gasLabel: 'Air',
    maxDepthMeters: 12,
    averageDepthMeters: 7,
    latestAscentRateMetersPerMinute: 0,
    maxAscentRateMetersPerMinute: 0,
    safetyStop: {
      status: 'notRequired',
      required: false,
      completed: false,
      targetDepthMeters: 5,
      minDepthMeters: 3,
      maxDepthMeters: 6,
      durationSeconds: 180,
      remainingSeconds: 180,
      timeInZoneSeconds: 0,
    },
  },
  samples: [
    { localSessionId: 'watch-unsupported-depth', timestamp: 1781352000, depthMeters: 0 },
    { localSessionId: 'watch-unsupported-depth', timestamp: 1781352300, depthMeters: 12 },
  ],
  ...overrides,
} as unknown as WatchSession);

describe('unsupported depth helpers', () => {
  it('defines Apple Watch v1 supported depth as a review limit, not a save limit', () => {
    expect(SUPPORTED_WATCH_DEPTH_LIMIT_METERS).toBe(40);
  });

  it('marks manual log depth above 40m without rejecting the value', () => {
    const entry = createBlankDiveLogEntry({ now: 1781352000 });
    entry.manual.measuredValues.maxDepthMeters = 42.3;

    expect(getUnsupportedDepthForLogEntry(entry)).toEqual({
      exceeded: true,
      limitMeters: 40,
      maxDepthMeters: 42.3,
      source: 'manual',
    });
  });

  it('does not mark exactly 40m as outside supported watch depth', () => {
    const entry = createBlankDiveLogEntry({ now: 1781352000 });
    entry.manual.measuredValues.maxDepthMeters = 40;

    expect(getUnsupportedDepthForLogEntry(entry)).toBeUndefined();
    expect(getUnsupportedDepthForPlan(plan(40))).toBeUndefined();
  });

  it('marks planned depth above 40m as planning context outside watch support', () => {
    expect(getUnsupportedDepthForPlan(plan(41))).toEqual({
      exceeded: true,
      limitMeters: 40,
      maxDepthMeters: 41,
      source: 'planned',
    });
  });

  it('prefers explicit watch unsupported-depth metadata when present', () => {
    const session = watchSession({
      unsupportedDepth: {
        exceeded: true,
        limitMeters: 40,
        maxDepthMeters: 42.3,
        firstExceededAt: 1781352300,
      },
    } as unknown as Partial<WatchSession>);

    expect(getUnsupportedDepthForWatchSession(session)).toEqual({
      exceeded: true,
      limitMeters: 40,
      maxDepthMeters: 42.3,
      firstExceededAt: 1781352300,
      source: 'watch',
    });
  });

  it('falls back to watch summary and samples when metadata is missing', () => {
    const session = watchSession({
      maxDepthMeters: 38,
      scuba: {
        gasLabel: 'Air',
        maxDepthMeters: 39,
        averageDepthMeters: 12,
        latestAscentRateMetersPerMinute: 0,
        maxAscentRateMetersPerMinute: 0,
        safetyStop: {
          status: 'notRequired',
          required: false,
          completed: false,
          targetDepthMeters: 5,
          minDepthMeters: 3,
          maxDepthMeters: 6,
          durationSeconds: 180,
          remainingSeconds: 180,
          timeInZoneSeconds: 0,
        },
      },
      samples: [
        { localSessionId: 'watch-unsupported-depth', timestamp: 1781352000, depthMeters: 10 },
        { localSessionId: 'watch-unsupported-depth', timestamp: 1781352300, depthMeters: 41.8 },
      ],
    });
    const entry = watchSessionToDiveLogEntry({ session, now: 1781353000 });

    expect(getUnsupportedDepthForWatchSession(session)).toEqual({
      exceeded: true,
      limitMeters: 40,
      maxDepthMeters: 41.8,
      firstExceededAt: 1781352300,
      source: 'watch',
    });
    expect(getUnsupportedDepthForLogEntry(entry)?.source).toBe('watch');
  });
});
