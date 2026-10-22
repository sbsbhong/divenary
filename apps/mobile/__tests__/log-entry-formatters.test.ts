import i18n from '../src/i18n';
import { entryToLogEntryFormValues, logEntryFormValuesToEntry } from '../src/screens/logbook/log-entry-form-schema';
import { getLogEntrySuggestions } from '../src/screens/logbook/log-entry-suggestions';
import {
  formatLogDate,
  formatLogDepth,
  formatLogDuration,
  formatLogMinutes,
  formatLogPressure,
  formatLogScale,
  getLogDisplayTitle,
} from '../src/screens/logbook/log-formatters';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { WatchSession } from '../src/types/dive-session';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import { hasDefaultWatchSiteName, watchSessionToDiveLogEntry } from '../src/utils/watch-session-to-dive-log-entry';

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

  test('joins start and end pressure with an arrow and keeps a single value plain', () => {
    expect(formatLogPressure({ unit: 'bar', start: 200, end: 50 })).toBe('200 → 50 bar');
    expect(formatLogPressure({ unit: 'psi', start: 3000 })).toBe('3000 psi');
    expect(formatLogPressure({ unit: 'bar', end: 50 })).toBe('-- → 50 bar');
    expect(formatLogPressure({ unit: 'bar' })).toBeUndefined();
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
    expect(getLogDisplayTitle(entry, i18n.t, 'en')).toMatch(/^Watch dive · /);
    await i18n.changeLanguage('ko');
    expect(getLogDisplayTitle(entry, i18n.t, 'ko')).toMatch(/^워치 다이브 · /);
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
