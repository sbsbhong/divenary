import type { DiveSessionSummary, WatchDepthSample, WatchSession } from '../types/dive-session';

export const getSessionImportKey = (session: Pick<WatchSession, 'localSessionId' | 'endedAt'>) => {
  return `${session.localSessionId}:${session.endedAt ?? 'open'}`;
};

export const summarizeSession = (session: WatchSession): DiveSessionSummary => {
  const sampleCount = session.samples.length;
  const maxDepthMeters = getSessionMaxDepthMeters(session);
  const averageDepthMeters = getSessionAverageDepthMeters(session);
  const waterTemperatureCelsius = getSessionWaterTemperatureCelsius(session);
  const durationSeconds = getSessionDurationSeconds(session);

  return {
    durationSeconds,
    maxDepthMeters,
    averageDepthMeters,
    waterTemperatureCelsius,
    sampleCount,
  };
};

export const getSessionDurationSeconds = (session: Pick<WatchSession, 'endedAt' | 'startedAt'>): number | undefined => {
  return session.endedAt === undefined ? undefined : Math.max(0, session.endedAt - session.startedAt);
};

export const getSessionMaxDepthMeters = (
  session: Pick<WatchSession, 'freedive' | 'maxDepthMeters' | 'samples' | 'scuba'>,
): number | undefined => {
  return session.scuba?.maxDepthMeters ?? session.freedive?.maxDepthMeters ?? session.maxDepthMeters ?? maxDepth(session.samples);
};

export const getSessionAverageDepthMeters = (
  session: Pick<WatchSession, 'averageDepthMeters' | 'samples' | 'scuba'>,
): number | undefined => {
  return session.scuba?.averageDepthMeters ?? session.averageDepthMeters ?? averageDepth(session.samples);
};

export const getSessionWaterTemperatureCelsius = (
  session: Pick<WatchSession, 'samples' | 'scuba' | 'waterTemperatureCelsius'>,
): number | undefined => {
  return session.scuba?.waterTemperatureCelsius ?? session.waterTemperatureCelsius ?? averageTemperature(session.samples);
};

const maxDepth = (samples: WatchDepthSample[]): number | undefined => {
  if (samples.length === 0) {
    return undefined;
  }

  return samples.reduce((maxValue, sample) => Math.max(maxValue, sample.depthMeters), samples[0].depthMeters);
};

const averageDepth = (samples: WatchDepthSample[]): number | undefined => {
  if (samples.length === 0) {
    return undefined;
  }

  return samples.reduce((sum, sample) => sum + sample.depthMeters, 0) / samples.length;
};

const averageTemperature = (samples: WatchDepthSample[]) => {
  const temperatures = samples
    .map(sample => sample.waterTemperatureCelsius)
    .filter((value): value is number => value !== undefined);

  if (temperatures.length === 0) {
    return undefined;
  }

  return temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length;
};
