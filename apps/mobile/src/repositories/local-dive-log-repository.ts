import type { DiveLogEntry } from '../types/dive-log-entry';
import type { WatchDepthSample, WatchSyncMessage } from '../types/dive-session';
import { watchFixtureMessages } from '../utils/watch-fixtures';
import { watchSessionToDiveLogEntry } from '../utils/watch-session-to-dive-log-entry';
import type { DiveLogRepository } from './dive-log-repository';

export type LocalDiveLogRepositoryOptions = {
  now?: () => number;
};

export class LocalDiveLogRepository implements DiveLogRepository {
  private entriesByLocalId = new Map<string, DiveLogEntry>();
  private readonly now: () => number;

  constructor(initialEntries: DiveLogEntry[] = [], options: LocalDiveLogRepositoryOptions = {}) {
    this.now = options.now ?? getCurrentTimestampSeconds;
    for (const entry of initialEntries) {
      this.entriesByLocalId.set(entry.localId, cloneDiveLogEntry(entry));
    }
  }

  async list(): Promise<DiveLogEntry[]> {
    return this.listSync();
  }

  async get(localId: string): Promise<DiveLogEntry | undefined> {
    return this.getSync(localId);
  }

  async save(entry: DiveLogEntry): Promise<DiveLogEntry> {
    this.entriesByLocalId.set(entry.localId, cloneDiveLogEntry(entry));
    return cloneDiveLogEntry(entry);
  }

  async delete(localId: string): Promise<void> {
    this.entriesByLocalId.delete(localId);
  }

  async importWatchMessages(messages: WatchSyncMessage[]): Promise<DiveLogEntry[]> {
    const now = this.now();

    for (const message of messages) {
      const nextEntry = watchSessionToDiveLogEntry({ session: message.session, now });
      const currentEntry = this.findByImportKey(nextEntry.watchCapture?.importKey);

      this.entriesByLocalId.set(currentEntry?.localId ?? nextEntry.localId, mergeWatchImport(currentEntry, nextEntry));
    }

    return this.listSync();
  }

  async getWatchProfile(localId: string): Promise<WatchDepthSample[]> {
    return this.entriesByLocalId.get(localId)?.watchCapture?.samples.map(sample => ({ ...sample })) ?? [];
  }

  listSync(): DiveLogEntry[] {
    return Array.from(this.entriesByLocalId.values()).map(cloneDiveLogEntry).sort(compareDiveLogEntries);
  }

  getSync(localId: string): DiveLogEntry | undefined {
    const entry = this.entriesByLocalId.get(localId);
    return entry ? cloneDiveLogEntry(entry) : undefined;
  }

  private findByImportKey(importKey: string | undefined): DiveLogEntry | undefined {
    if (!importKey) {
      return undefined;
    }

    return Array.from(this.entriesByLocalId.values()).find(entry => entry.watchCapture?.importKey === importKey);
  }
}

export const DEFAULT_FIXTURE_IMPORTED_AT = 0;

export const createDefaultDiveLogRepository = (options: LocalDiveLogRepositoryOptions = {}): LocalDiveLogRepository => {
  const entries = watchFixtureMessages.map(message =>
    watchSessionToDiveLogEntry({ session: message.session, now: DEFAULT_FIXTURE_IMPORTED_AT }),
  );

  return new LocalDiveLogRepository(entries, options);
};

export const defaultDiveLogRepository = createDefaultDiveLogRepository();

function getCurrentTimestampSeconds(): number {
  return Date.now() / 1000;
}

export function cloneDiveLogEntry(entry: DiveLogEntry): DiveLogEntry {
  return JSON.parse(JSON.stringify(entry)) as DiveLogEntry;
}

export function mergeWatchImport(currentEntry: DiveLogEntry | undefined, nextEntry: DiveLogEntry): DiveLogEntry {
  if (!currentEntry) {
    return nextEntry;
  }

  return {
    ...nextEntry,
    localId: currentEntry.localId,
    remoteId: currentEntry.remoteId,
    ownerUserId: currentEntry.ownerUserId,
    cloudSyncStatus: currentEntry.cloudSyncStatus,
    createdAt: currentEntry.createdAt,
    manual: currentEntry.manual,
    mobile: currentEntry.mobile,
    watchCapture: nextEntry.watchCapture
      ? {
          ...nextEntry.watchCapture,
          importedAt: currentEntry.watchCapture?.importedAt ?? nextEntry.watchCapture.importedAt,
        }
      : undefined,
    provenance: {
      ...nextEntry.provenance,
      site: currentEntry.provenance.site,
      buddyIds: currentEntry.provenance.buddyIds,
      gearIds: currentEntry.provenance.gearIds,
      tags: currentEntry.provenance.tags,
      observedMarineLife: currentEntry.provenance.observedMarineLife,
      notes: currentEntry.provenance.notes,
      rating: currentEntry.provenance.rating,
      measuredValues: currentEntry.provenance.measuredValues,
      mediaPlaceholders: currentEntry.provenance.mediaPlaceholders,
    },
  };
}

export function compareDiveLogEntries(left: DiveLogEntry, right: DiveLogEntry): number {
  return getEntrySortTimestamp(right) - getEntrySortTimestamp(left);
}

function getEntrySortTimestamp(entry: DiveLogEntry): number {
  return entry.watchCapture?.session.startedAt ?? entry.manual.measuredValues.startedAt ?? entry.createdAt;
}
