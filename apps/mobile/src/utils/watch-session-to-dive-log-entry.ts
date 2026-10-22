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

/**
 * Display only: true while a watch scuba log still carries the start pressure the import filled in
 * (150 bar, no end pressure, never set by the diver). The watch does not measure tank pressure, so
 * screens leave it out. The stored value stays, because guest claim reuse compares `manual_data`
 * exactly. A diver who sets a pressure in the editor marks it `manual`, which ends the match.
 */
export const isUntouchedWatchPressureDefault = (entry: Pick<DiveLogEntry, 'source' | 'manual' | 'provenance'>): boolean => {
  const pressure = entry.manual.measuredValues.pressure;

  return (
    entry.source === 'watch' &&
    entry.provenance.pressure === undefined &&
    pressure?.unit === 'bar' &&
    pressure.start === DEFAULT_WATCH_SCUBA_START_PRESSURE_BAR &&
    pressure.end === undefined
  );
};

// Tags the watch adds for its own bookkeeping: the capture marker, the test-dive marker, the planned
// depth (`planned-18m`) and the link to the plan the dive started from (`plan-<id>`).
const WATCH_SYSTEM_TAG = /^(?:watch-capture|debug-test-capture|planned-\d+m|plan-.+)$/;

/**
 * The tags a diver sees. On a watch log, the watch's bookkeeping tags stay stored (the plan link and
 * guest claim reuse read them) but are left out. Only tags the watch itself sent are left out, so a
 * tag the diver typed always shows.
 */
export const getVisibleLogTags = (entry: Pick<DiveLogEntry, 'manual' | 'watchCapture'>): string[] => {
  const watchTags = entry.watchCapture?.session.tags;

  if (!watchTags?.length) {
    return entry.manual.tags;
  }

  return entry.manual.tags.filter(tag => !(watchTags.includes(tag) && WATCH_SYSTEM_TAG.test(tag)));
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
