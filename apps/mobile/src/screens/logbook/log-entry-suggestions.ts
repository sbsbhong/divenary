import type { DiveLogEntry } from '../../types/dive-log-entry';
import { hasDefaultWatchSiteName } from '../../utils/watch-session-to-dive-log-entry';

export type LogEntrySuggestions = {
  sites: string[];
  buddies: string[];
};

const SUGGESTION_LIMIT = 6;

/**
 * Site and buddy names from earlier logs, most recent first and without duplicates, offered as
 * chips in the editor. The watch import default site is not a real site, so it is left out.
 */
export function getLogEntrySuggestions(entries: DiveLogEntry[], excludeLocalId?: string): LogEntrySuggestions {
  const sites = new Map<string, string>();
  const buddies = new Map<string, string>();
  const newestFirst = [...entries].sort((left, right) => right.createdAt - left.createdAt);

  for (const entry of newestFirst) {
    if (entry.localId === excludeLocalId) {
      continue;
    }

    const siteName = entry.manual.site.name?.trim();
    if (siteName && !hasDefaultWatchSiteName(entry)) {
      addSuggestion(sites, siteName);
    }

    for (const buddy of entry.manual.buddyIds) {
      addSuggestion(buddies, buddy.trim());
    }
  }

  return {
    sites: [...sites.values()].slice(0, SUGGESTION_LIMIT),
    buddies: [...buddies.values()].slice(0, SUGGESTION_LIMIT),
  };
}

// The first spelling seen wins, so "Blue Corner" and "blue corner" become one chip.
function addSuggestion(suggestions: Map<string, string>, value: string): void {
  const key = value.toLocaleLowerCase();

  if (value.length && !suggestions.has(key)) {
    suggestions.set(key, value);
  }
}
