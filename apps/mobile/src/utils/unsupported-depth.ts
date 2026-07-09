import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DivePlan } from '../types/dive-plan';
import type { WatchDepthSample, WatchSessionCommon } from '../types/dive-session';

export const SUPPORTED_WATCH_DEPTH_LIMIT_METERS = 40;

export type UnsupportedDepthSource = 'manual' | 'planned' | 'watch';

export type UnsupportedDepthReview = {
  exceeded: true;
  limitMeters: number;
  maxDepthMeters?: number;
  firstExceededAt?: number;
  source: UnsupportedDepthSource;
};

type WatchUnsupportedDepthRecord = {
  exceeded?: unknown;
  limitMeters?: unknown;
  maxDepthMeters?: unknown;
  firstExceededAt?: unknown;
};

type WatchSessionWithUnsupportedDepth = WatchSessionCommon & {
  unsupportedDepth?: WatchUnsupportedDepthRecord;
};

export function getUnsupportedDepthForLogEntry(entry: DiveLogEntry): UnsupportedDepthReview | undefined {
  const candidates = [
    depthReviewFromValue(entry.manual.measuredValues.maxDepthMeters, 'manual'),
    entry.watchCapture ? getUnsupportedDepthForWatchSession(entry.watchCapture.session) : undefined,
    entry.watchCapture ? depthReviewFromValue(entry.watchCapture.measuredValues.maxDepthMeters, 'watch') : undefined,
  ];

  return highestUnsupportedDepth(candidates);
}

export function getUnsupportedDepthForPlan(plan: DivePlan): UnsupportedDepthReview | undefined {
  return depthReviewFromValue(plan.plannedValues.plannedMaxDepthMeters, 'planned');
}

export function getUnsupportedDepthForWatchSession(session: WatchSessionCommon): UnsupportedDepthReview | undefined {
  const metadata = (session as WatchSessionWithUnsupportedDepth).unsupportedDepth;
  if (metadata?.exceeded === true) {
    const limitMeters = finiteNumber(metadata.limitMeters) ?? SUPPORTED_WATCH_DEPTH_LIMIT_METERS;
    return {
      exceeded: true,
      limitMeters,
      maxDepthMeters: finiteNumber(metadata.maxDepthMeters),
      firstExceededAt: finiteNumber(metadata.firstExceededAt),
      source: 'watch',
    };
  }

  const firstExceededAt = firstExceededSampleTime(session.samples, SUPPORTED_WATCH_DEPTH_LIMIT_METERS);
  const maxDepthMeters = maxFiniteNumber([
    session.maxDepthMeters,
    session.scuba?.maxDepthMeters,
    session.freedive?.maxDepthMeters,
    ...session.samples.map(sample => sample.depthMeters),
  ]);

  if (maxDepthMeters === undefined || maxDepthMeters <= SUPPORTED_WATCH_DEPTH_LIMIT_METERS) {
    return undefined;
  }

  return {
    exceeded: true,
    limitMeters: SUPPORTED_WATCH_DEPTH_LIMIT_METERS,
    maxDepthMeters,
    firstExceededAt,
    source: 'watch',
  };
}

function depthReviewFromValue(value: number | undefined, source: UnsupportedDepthSource): UnsupportedDepthReview | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= SUPPORTED_WATCH_DEPTH_LIMIT_METERS) {
    return undefined;
  }

  return {
    exceeded: true,
    limitMeters: SUPPORTED_WATCH_DEPTH_LIMIT_METERS,
    maxDepthMeters: value,
    source,
  };
}

function highestUnsupportedDepth(values: Array<UnsupportedDepthReview | undefined>): UnsupportedDepthReview | undefined {
  return values
    .filter((value): value is UnsupportedDepthReview => value !== undefined)
    .sort((left, right) => (right.maxDepthMeters ?? 0) - (left.maxDepthMeters ?? 0))[0];
}

function firstExceededSampleTime(samples: WatchDepthSample[], limitMeters: number): number | undefined {
  return samples.find(sample => Number.isFinite(sample.depthMeters) && sample.depthMeters > limitMeters)?.timestamp;
}

function maxFiniteNumber(values: Array<number | undefined>): number | undefined {
  const finiteValues = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return finiteValues.length === 0 ? undefined : Math.max(...finiteValues);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
