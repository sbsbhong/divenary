import type { DiveLogEntry } from '../types/dive-log-entry';
import type { WatchDepthSample, WatchSyncMessage } from '../types/dive-session';
import { watchFixtureMessages } from '../utils/watch-fixtures';
import { watchSessionToDiveLogEntry } from '../utils/watch-session-to-dive-log-entry';
import type {
  DeleteDiveLogOptions,
  DiveLogRepository,
  ImportWatchMessagesOptions,
} from './dive-log-repository';
import type {ConditionalDeleteResult, DeletePredicate} from './conditional-delete';

export type LocalDiveLogRepositoryOptions = {
  now?: () => number;
};

export class LocalDiveLogRepository implements DiveLogRepository {
  private entriesByLocalId = new Map<string, DiveLogEntry>();
  private readonly now: () => number;
  private mutationQueue: Promise<void> = Promise.resolve();

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
    return this.enqueueMutation(async () => {
      this.entriesByLocalId.set(entry.localId, cloneDiveLogEntry(entry));
      return cloneDiveLogEntry(entry);
    });
  }

  async delete(
    localId: string,
    options?: DeleteDiveLogOptions,
  ): Promise<void> {
    await this.deleteIf(localId, () => true, options);
  }

  async deleteIf(
    localId: string,
    predicate: DeletePredicate<DiveLogEntry>,
    options?: DeleteDiveLogOptions,
  ): Promise<ConditionalDeleteResult> {
    return this.enqueueMutation(async () => {
      options?.assertCanCommit?.();
      const previous = this.entriesByLocalId.get(localId);
      if (previous === undefined) {
        return 'notFound';
      }
      if (!predicate(cloneDiveLogEntry(previous))) {
        return 'conditionFailed';
      }
      this.entriesByLocalId.delete(localId);
      try {
        options?.assertCanCommit?.();
      } catch (error) {
        if (previous) {
          this.entriesByLocalId.set(localId, previous);
        }
        throw error;
      }
      return 'deleted';
    });
  }

  async removeWatchProfileIfUnreferenced(_storageKey: string): Promise<void> {
    return this.enqueueMutation(async () => undefined);
  }

  async importWatchMessages(
    messages: WatchSyncMessage[],
    options?: ImportWatchMessagesOptions,
  ): Promise<DiveLogEntry[]> {
    return this.enqueueMutation(async () => {
      const now = this.now();
      const nextEntries = new Map(
        Array.from(this.entriesByLocalId, ([localId, value]) => [
          localId,
          cloneDiveLogEntry(value),
        ]),
      );

      for (const message of messages) {
        const nextEntry = watchSessionToDiveLogEntry({
          session: message.session,
          now,
        });
        const currentEntry = findByImportKey(
          nextEntries,
          nextEntry.watchCapture?.importKey,
        );

        nextEntries.set(
          currentEntry?.localId ?? nextEntry.localId,
          mergeWatchImport(currentEntry, nextEntry),
        );
      }

      options?.assertCanCommit?.();
      const previousEntries = this.entriesByLocalId;
      this.entriesByLocalId = nextEntries;
      try {
        options?.assertCanCommit?.();
      } catch (error) {
        this.entriesByLocalId = previousEntries;
        throw error;
      }
      return this.listSync();
    });
  }

  async getWatchProfile(localId: string): Promise<WatchDepthSample[]> {
    return this.entriesByLocalId.get(localId)?.watchCapture?.samples.map(sample => ({ ...sample })) ?? [];
  }

  async readStoredWatchProfile(
    _localId: string,
  ): Promise<WatchDepthSample[] | undefined> {
    return undefined;
  }

  listSync(): DiveLogEntry[] {
    return Array.from(this.entriesByLocalId.values()).map(cloneDiveLogEntry).sort(compareDiveLogEntries);
  }

  getSync(localId: string): DiveLogEntry | undefined {
    const entry = this.entriesByLocalId.get(localId);
    return entry ? cloneDiveLogEntry(entry) : undefined;
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
    remoteRevision: currentEntry.remoteRevision,
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

function findByImportKey(
  entriesByLocalId: ReadonlyMap<string, DiveLogEntry>,
  importKey: string | undefined,
): DiveLogEntry | undefined {
  if (!importKey) {
    return undefined;
  }

  return Array.from(entriesByLocalId.values()).find(
    entry => entry.watchCapture?.importKey === importKey,
  );
}

function getEntrySortTimestamp(entry: DiveLogEntry): number {
  return entry.watchCapture?.session.startedAt ?? entry.manual.measuredValues.startedAt ?? entry.createdAt;
}
