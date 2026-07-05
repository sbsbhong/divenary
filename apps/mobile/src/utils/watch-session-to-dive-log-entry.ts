import type { DiveLogEntry, DiveLogManualMeasuredValues } from '../types/dive-log-entry';
import type { WatchSession } from '../types/dive-session';
import { getSessionImportKey, summarizeSession } from './session-summary';

type WatchSessionToDiveLogEntryOptions = {
  session: WatchSession;
  now?: number;
  localId?: string;
};

export const watchSessionToDiveLogEntry = (options: WatchSessionToDiveLogEntryOptions): DiveLogEntry => {
  const timestamp = options.now ?? Date.now() / 1000;
  const importKey = getSessionImportKey(options.session);
  const summary = summarizeSession(options.session);
  const localId = options.localId ?? `watch:${importKey}`;
  const manualMeasuredValues = getManualMeasuredValues(options.session);

  return {
    localId,
    source: 'watch',
    syncStatus: options.session.syncStatus ?? 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    manual: {
      title: options.session.planTitle,
      site: {
        siteId: options.session.siteId,
        name: options.session.siteName,
      },
      buddyIds: options.session.buddyIds ?? [],
      gearIds: options.session.gearIds ?? [],
      tags: options.session.tags ?? [],
      observedMarineLife: [],
      notes: options.session.notes,
      rating: options.session.rating,
      measuredValues: manualMeasuredValues,
    },
    mobile: {
      mediaPlaceholders: ['Photo import placeholder'],
    },
    watchCapture: {
      importKey,
      importedAt: timestamp,
      session: options.session,
      measuredValues: {
        startedAt: options.session.startedAt,
        endedAt: options.session.endedAt,
        durationSeconds: summary.durationSeconds,
        maxDepthMeters: summary.maxDepthMeters,
        averageDepthMeters: summary.averageDepthMeters,
        waterTemperatureCelsius: summary.waterTemperatureCelsius,
      },
      samples: options.session.samples,
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
      startedAt: 'watch',
      endedAt: 'watch',
      durationSeconds: 'watch',
      maxDepthMeters: 'watch',
      averageDepthMeters: 'watch',
      waterTemperatureCelsius: 'watch',
      depthSamples: 'watch',
    },
  };
};

const getManualMeasuredValues = (session: WatchSession): DiveLogManualMeasuredValues => {
  return {
    diveMode: session.diveMode,
    gasLabel: session.gasLabel ?? session.scuba?.gasLabel,
    perceivedExertion: session.perceivedExertion,
    visibilityRating: session.visibilityRating,
    waterCondition: session.waterCondition,
  };
};
