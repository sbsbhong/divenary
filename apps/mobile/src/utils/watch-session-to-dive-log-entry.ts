import type { DiveLogEntry, DiveLogManualMeasuredValues } from '../types/dive-log-entry';
import type { WatchSession } from '../types/dive-session';
import { getSessionImportKey, summarizeSession } from './session-summary';

type WatchSessionToDiveLogEntryOptions = {
  session: WatchSession;
  now?: number;
  localId?: string;
};

export const DEFAULT_WATCH_LOG_SITE_NAME = '워치 다이브';
export const DEFAULT_WATCH_SCUBA_START_PRESSURE_BAR = 150;

export const watchSessionToDiveLogEntry = (options: WatchSessionToDiveLogEntryOptions): DiveLogEntry => {
  const timestamp = options.now ?? Date.now() / 1000;
  const importKey = getSessionImportKey(options.session);
  const summary = summarizeSession(options.session);
  const localId = options.localId ?? `watch:${importKey}`;
  const manualMeasuredValues = getManualMeasuredValues(options.session);
  const siteName = firstNonBlankText(options.session.siteName, DEFAULT_WATCH_LOG_SITE_NAME);

  return {
    localId,
    source: 'watch',
    cloudSyncStatus: 'notConfigured',
    createdAt: timestamp,
    updatedAt: timestamp,
    manual: {
      title: options.session.planTitle,
      site: {
        siteId: options.session.siteId,
        name: siteName,
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

/**
 * Display only: true while a watch log still carries the import default site name, so screens can
 * show a localized fallback title instead. The stored name stays as imported, because guest claim
 * reuse compares `site_name` exactly.
 */
export const hasDefaultWatchSiteName = (entry: Pick<DiveLogEntry, 'source' | 'manual' | 'watchCapture'>): boolean => {
  if (entry.source !== 'watch') {
    return false;
  }

  return (entry.manual.site.name ?? entry.watchCapture?.session.siteName)?.trim() === DEFAULT_WATCH_LOG_SITE_NAME;
};

const getManualMeasuredValues = (session: WatchSession): DiveLogManualMeasuredValues => {
  return {
    diveMode: session.diveMode,
    gasLabel: session.gasLabel ?? session.scuba?.gasLabel,
    perceivedExertion: session.perceivedExertion,
    visibilityRating: session.visibilityRating,
    waterCondition: session.waterCondition,
    pressure:
      session.diveMode === 'scuba'
        ? {
            unit: 'bar',
            start: DEFAULT_WATCH_SCUBA_START_PRESSURE_BAR,
          }
        : undefined,
  };
};

function firstNonBlankText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmedValue = value?.trim();
    if (trimmedValue) {
      return trimmedValue;
    }
  }

  return undefined;
}
