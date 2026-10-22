import i18n from '../src/i18n';
import { entryToLogEntryFormValues, logEntryFormValuesToEntry } from '../src/screens/logbook/log-entry-form-schema';
import { getLogEntrySuggestions } from '../src/screens/logbook/log-entry-suggestions';
import {
  formatLogDate,
  formatLogDepth,
  formatLogDuration,
  formatLogMinutes,
  formatLogPressure,
  formatLogPressureSpoken,
  formatLogScale,
  getLogDisplayTitle,
} from '../src/screens/logbook/log-formatters';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { WatchSession } from '../src/types/dive-session';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import {
  getVisibleLogTags,
  hasDefaultWatchSiteName,
  isUntouchedWatchPressureDefault,
  watchSessionToDiveLogEntry,
} from '../src/utils/watch-session-to-dive-log-entry';

const watchSession: WatchSession = {
  localSessionId: 'formatter-watch-session',
  schemaVersion: 1,
  syncStatus: 'pending',
  startedAt: 1781352000,
  endedAt: 1781352600,
  maxDepthMeters: 12,
  samples: [],
};

function manualLog(localId: string, createdAt: number, site: string, buddies: string[] = []): DiveLogEntry {
  const entry = createBlankDiveLogEntry({ localId, now: createdAt });
  entry.manual = { ...entry.manual, site: { name: site }, buddyIds: buddies };
  return entry;
}

describe('log display formats', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ko');
  });

  test('shows depth to one decimal and unknown depth as --', () => {
    expect(formatLogDepth(18.64)).toBe('18.6 m');
    expect(formatLogDepth(12)).toBe('12.0 m');
    expect(formatLogDepth(undefined)).toBe('-- m');
  });

  test('shows dive time in minutes in the list and with seconds in the detail', async () => {
    expect(formatLogMinutes(2820, i18n.t)).toBe('47분');
    expect(formatLogMinutes(undefined, i18n.t)).toBe('--분');
    expect(formatLogDuration(602, i18n.t)).toBe('10분 2초');

    await i18n.changeLanguage('en');
    expect(formatLogMinutes(2820, i18n.t)).toBe('47 min');
    expect(formatLogDuration(2820, i18n.t)).toBe('47 min');
  });

  test('joins start and end pressure with an arrow and shows the unknown one as --', () => {
    expect(formatLogPressure({ unit: 'bar', start: 200, end: 50 })).toBe('200 → 50 bar');
    expect(formatLogPressure({ unit: 'psi', start: 3000 })).toBe('3000 → -- psi');
    expect(formatLogPressure({ unit: 'bar', end: 50 })).toBe('-- → 50 bar');
    expect(formatLogPressure({ unit: 'bar' })).toBeUndefined();
  });

  test('reads start and end pressure to VoiceOver with their own labels', () => {
    expect(formatLogPressureSpoken({ unit: 'bar', start: 200, end: 50 }, i18n.t)).toBe('시작 압력 200 bar, 종료 압력 50 bar');
    expect(formatLogPressureSpoken({ unit: 'psi', start: 3000 }, i18n.t)).toBe('시작 압력 3000 psi');
    expect(formatLogPressureSpoken({ unit: 'bar' }, i18n.t)).toBeUndefined();
  });

  test('reads 1-5 ratings out of five', () => {
    expect(formatLogScale(3)).toBe('3/5');
    expect(formatLogScale(undefined)).toBeUndefined();
  });

  test('adds the year only for another year', () => {
    const seconds = new Date(2025, 5, 13, 21, 0).getTime() / 1000;

    expect(formatLogDate(seconds, 'en', '--', new Date(2025, 9, 22))).not.toContain('2025');
    expect(formatLogDate(seconds, 'en', '--', new Date(2026, 9, 22))).toContain('2025');
    expect(formatLogDate(undefined, 'en', 'Unknown date')).toBe('Unknown date');
  });
});

describe('watch log fallback title', () => {
  test('replaces the stored import default site with a localized title without changing the data', async () => {
    const entry = watchSessionToDiveLogEntry({ session: watchSession, now: 1781353000 });

    expect(entry.manual.site.name).toBe('워치 다이브');
    expect(hasDefaultWatchSiteName(entry)).toBe(true);

    await i18n.changeLanguage('en');
    expect(getLogDisplayTitle(entry, i18n.t, 'en')).toMatch(/^Watch log · /);
    await i18n.changeLanguage('ko');
    expect(getLogDisplayTitle(entry, i18n.t, 'ko')).toMatch(/^워치 기록 · /);
  });

  test('keeps a real site and a plan title as they are', () => {
    const named = watchSessionToDiveLogEntry({ session: { ...watchSession, siteName: 'Blue Hole' }, now: 1781353000 });
    const planned = watchSessionToDiveLogEntry({ session: { ...watchSession, planTitle: 'Morning reef' }, now: 1781353000 });
    const manual = manualLog('manual-default-site', 1781353000, '워치 다이브');

    expect(getLogDisplayTitle(named, i18n.t, 'en')).toBe('Blue Hole');
    expect(getLogDisplayTitle(planned, i18n.t, 'en')).toBe('Morning reef');
    // Only a watch log can carry the import default.
    expect(hasDefaultWatchSiteName(manual)).toBe(false);
  });
});

describe('editor suggestions', () => {
  test('offers recent sites and buddies once each, newest first, without the watch import default', () => {
    const entries = [
      manualLog('older', 1781350000, 'Blue Corner', ['Mina']),
      manualLog('newer', 1781352000, 'blue corner', ['Alex', 'Mina']),
      manualLog('current', 1781353000, 'Being edited', ['Self']),
      watchSessionToDiveLogEntry({ session: watchSession, now: 1781351000 }),
    ];

    expect(getLogEntrySuggestions(entries, 'current')).toEqual({
      sites: ['blue corner'],
      buddies: ['Alex', 'Mina'],
    });
  });
});

describe('watch value restore', () => {
  test('saves a watch time picked again as the watch value, not a manual override', () => {
    const entry: DiveLogEntry = {
      ...watchSessionToDiveLogEntry({ session: watchSession, now: 1781353000 }),
      manual: {
        ...watchSessionToDiveLogEntry({ session: watchSession, now: 1781353000 }).manual,
        measuredValues: { diveMode: 'scuba', startedAt: 1781351000, maxDepthMeters: 19 },
      },
    };
    entry.provenance = { ...entry.provenance, startedAt: 'manual', maxDepthMeters: 'manual' };
    const values = {
      ...entryToLogEntryFormValues(entry),
      startedAt: new Date(watchSession.startedAt * 1000),
      maxDepthMeters: 12,
    };

    const saved = logEntryFormValuesToEntry(entry, values, { startedAt: true, maxDepthMeters: true });

    expect(saved.provenance.startedAt).toBe('watch');
    expect(saved.provenance.maxDepthMeters).toBe('watch');
    expect(saved.manual.measuredValues.maxDepthMeters).toBeUndefined();
  });
});

describe('watch bookkeeping kept out of sight', () => {
  // What the watch sends for a scuba dive started from a plan: its own tags around the diver's tag.
  const plannedScubaSession: WatchSession = {
    ...watchSession,
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
    tags: ['watch-capture', 'reef', 'plan-6f1c2b9a', 'planned-18m'],
  };

  test('hides only the tags the watch added for itself', () => {
    const entry = watchSessionToDiveLogEntry({ session: plannedScubaSession, now: 1781353000 });
    const typedTags = { ...entry, manual: { ...entry.manual, tags: [...entry.manual.tags, 'plan-b'] } };

    expect(getVisibleLogTags(entry)).toEqual(['reef']);
    // A tag the diver typed shows even when it looks like a watch tag.
    expect(getVisibleLogTags(typedTags)).toEqual(['reef', 'plan-b']);
    expect(getVisibleLogTags(manualLog('manual-plan-tag', 1781353000, 'Reef'))).toEqual([]);
  });

  test('an untouched save keeps the stored tags and the import pressure default exactly as they were', () => {
    const entry = watchSessionToDiveLogEntry({ session: plannedScubaSession, now: 1781353000 });
    const values = entryToLogEntryFormValues(entry);

    expect(isUntouchedWatchPressureDefault(entry)).toBe(true);
    expect(values.tags).toEqual(['reef']);
    expect(values.pressure).toEqual({ unit: 'bar' });

    const saved = logEntryFormValuesToEntry(entry, { ...values, notes: 'Calm' }, { notes: true });

    expect(saved.manual.tags).toEqual(['watch-capture', 'reef', 'plan-6f1c2b9a', 'planned-18m']);
    expect(saved.manual.measuredValues.pressure).toEqual({ unit: 'bar', start: 150 });
    expect(saved.provenance.pressure).toBeUndefined();
    expect(isUntouchedWatchPressureDefault(saved)).toBe(true);
  });

  test('a changed tag list keeps the hidden watch tags, and a pressure the diver sets is a real value', () => {
    const entry = watchSessionToDiveLogEntry({ session: plannedScubaSession, now: 1781353000 });
    const values = entryToLogEntryFormValues(entry);

    const saved = logEntryFormValuesToEntry(
      entry,
      { ...values, tags: ['night'], pressure: { unit: 'bar', start: 200, end: 60 } },
      { tags: true, pressure: true },
    );

    expect(saved.manual.tags).toEqual(['watch-capture', 'plan-6f1c2b9a', 'planned-18m', 'night']);
    expect(saved.manual.measuredValues.pressure).toEqual({ unit: 'bar', start: 200, end: 60 });
    expect(saved.provenance.pressure).toBe('manual');
    expect(isUntouchedWatchPressureDefault(saved)).toBe(false);
  });
});
