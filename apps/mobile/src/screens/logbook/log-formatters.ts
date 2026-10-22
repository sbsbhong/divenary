import type { TFunction } from 'i18next';
import type {
  DiveFieldSource,
  DiveLogEntry,
  DiveLogManualMeasuredValues,
  DiveLogWatchMeasuredValues,
  DivePressureValues,
} from '../../types/dive-log-entry';
import { hasDefaultWatchSiteName } from '../../utils/watch-session-to-dive-log-entry';

// Display formats for the log list, detail and editor. Unknown values read `--`, never 0.

/** Depth to one decimal, the precision the editor accepts. */
export function formatLogDepth(meters: number | undefined): string {
  return meters === undefined ? '-- m' : `${roundToTenth(meters).toFixed(1)} m`;
}

export function formatLogTemperature(celsius: number | undefined): string {
  return celsius === undefined ? '-- °C' : `${roundToTenth(celsius).toFixed(1)} °C`;
}

/** Whole minutes for a list row, for example `47분` / `47 min`. */
export function formatLogMinutes(seconds: number | undefined, t: TFunction): string {
  if (seconds === undefined) {
    return t('logbook.durationUnknown');
  }

  return t('form.durationMinutes', { minutes: Math.round(seconds / 60) });
}

/** Minutes, and seconds only when there are any, for the detail: `47분` or `10분 2초`. */
export function formatLogDuration(seconds: number | undefined, t: TFunction): string {
  if (seconds === undefined) {
    return t('logbook.durationUnknown');
  }

  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;

  return remainder === 0
    ? t('form.durationMinutes', { minutes })
    : t('form.durationMinutesSeconds', { minutes, seconds: remainder });
}

/** Start and end pressure as one value, for example `200 → 50 bar`. Log metadata only. */
export function formatLogPressure(pressure: DivePressureValues | undefined): string | undefined {
  if (!pressure || (pressure.start === undefined && pressure.end === undefined)) {
    return undefined;
  }

  const unit = pressure.unit ?? 'bar';

  if (pressure.end === undefined) {
    return `${formatPressureNumber(pressure.start!)} ${unit}`;
  }

  return `${pressure.start === undefined ? '--' : formatPressureNumber(pressure.start)} → ${formatPressureNumber(pressure.end)} ${unit}`;
}

/** A 1-5 rating such as visibility or exertion: `3/5`. */
export function formatLogScale(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value}/5`;
}

/** Date and time, with the year only when it is not the current year. */
export function formatLogDate(seconds: number | undefined, locale: string, unknownLabel: string, now: Date = new Date()): string {
  if (!seconds) {
    return unknownLabel;
  }

  const value = new Date(seconds * 1000);

  return new Intl.DateTimeFormat(locale, {
    ...(value.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

/** The day alone, for a fallback title. */
export function formatLogDay(seconds: number, locale: string, now: Date = new Date()): string {
  const value = new Date(seconds * 1000);

  return new Intl.DateTimeFormat(locale, {
    ...(value.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    month: 'short',
    day: 'numeric',
  }).format(value);
}

/** When the dive started: a manual correction first, then the watch value, then the manual value. */
export function getLogStartedAt(entry: DiveLogEntry): number {
  if (entry.provenance.startedAt === 'manual' && entry.manual.measuredValues.startedAt !== undefined) {
    return entry.manual.measuredValues.startedAt;
  }

  return entry.watchCapture?.measuredValues.startedAt ?? entry.manual.measuredValues.startedAt ?? entry.createdAt;
}

/**
 * The title a row or detail shows. A watch log that still has the import default site gets a
 * localized `워치 다이브 · <day>` title; the stored site name is not changed.
 */
export function getLogDisplayTitle(entry: DiveLogEntry, t: TFunction, locale: string): string {
  const title = entry.manual.title?.trim();

  if (title) {
    return title;
  }

  if (hasDefaultWatchSiteName(entry)) {
    return t('logbook.watchDiveTitle', { date: formatLogDay(getLogStartedAt(entry), locale) });
  }

  return (entry.manual.site.name ?? entry.watchCapture?.session.siteName)?.trim() || t('logbook.untitledDive');
}

export type LogMeasuredField = 'durationSeconds' | 'maxDepthMeters' | 'averageDepthMeters' | 'waterTemperatureCelsius';

/** A measured value with where it came from. A manual correction wins over the watch value. */
export function getLogMeasuredValue(entry: DiveLogEntry, field: LogMeasuredField): { value: number | undefined; source: DiveFieldSource } {
  const manualValue = entry.manual.measuredValues[field as keyof DiveLogManualMeasuredValues] as number | undefined;
  const watchValue = entry.watchCapture?.measuredValues[field as keyof DiveLogWatchMeasuredValues] as number | undefined;

  if (entry.provenance[field] === 'manual' && manualValue !== undefined) {
    return { value: manualValue, source: 'manual' };
  }

  if (watchValue !== undefined) {
    return { value: watchValue, source: 'watch' };
  }

  if (manualValue !== undefined) {
    return { value: manualValue, source: 'manual' };
  }

  return { value: undefined, source: entry.provenance[field] ?? (entry.watchCapture ? 'watch' : 'manual') };
}

/** Test IDs carry the formatted value without spaces. */
export function toTestIdValue(value: string): string {
  return value.replace(/\s+/g, '');
}

function roundToTenth(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function formatPressureNumber(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${roundToTenth(value)}`;
}
