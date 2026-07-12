import type { DiveLogEntry } from '../types/dive-log-entry';
import type { WatchSyncMessage } from '../types/dive-session';
import { watchSessionToDiveLogEntry } from '../utils/watch-session-to-dive-log-entry';
import { createAsyncStorageKeyValueStore, type PersistentKeyValueStore } from '../storage/persistent-key-value-store';
import {
  PersistentJsonStore,
  UnsupportedStorageVersionError,
  type StoredEnvelope,
} from '../storage/persistent-json-store';
import { mobileStorageKeys } from '../storage/storage-keys';
import type { DiveLogRepository } from './dive-log-repository';
import {
  cloneDiveLogEntry,
  compareDiveLogEntries,
  createDefaultDiveLogRepository,
  DEFAULT_FIXTURE_IMPORTED_AT,
  mergeWatchImport,
} from './local-dive-log-repository';

export type PersistentDiveLogRepositoryOptions = {
  storage?: PersistentKeyValueStore;
  now?: () => number;
  initialEntries?: DiveLogEntry[];
  onReadError?: (error: Error) => void;
};

export class PersistentDiveLogRepository implements DiveLogRepository {
  private readonly store: PersistentJsonStore<DiveLogEntry[]>;
  private readonly now: () => number;

  constructor(options: PersistentDiveLogRepositoryOptions = {}) {
    const initialEntries = options.initialEntries ?? [];
    this.now = options.now ?? getCurrentTimestampSeconds;
    this.store = new PersistentJsonStore<DiveLogEntry[]>({
      key: mobileStorageKeys.logbook,
      schemaVersion: 3,
      defaultValue: () => initialEntries.map(cloneDiveLogEntry),
      migrate: migrateLogbookEnvelope,
      storage: options.storage ?? createAsyncStorageKeyValueStore(),
      now: this.now,
      onReadError: options.onReadError,
    });
  }

  async list(): Promise<DiveLogEntry[]> {
    return (await this.readEntries()).map(cloneDiveLogEntry).sort(compareDiveLogEntries);
  }

  async get(localId: string): Promise<DiveLogEntry | undefined> {
    const entry = (await this.readEntries()).find(currentEntry => currentEntry.localId === localId);
    return entry ? cloneDiveLogEntry(entry) : undefined;
  }

  async save(entry: DiveLogEntry): Promise<DiveLogEntry> {
    const entries = await this.readEntries();
    const nextEntries = entries.some(currentEntry => currentEntry.localId === entry.localId)
      ? entries.map(currentEntry => (currentEntry.localId === entry.localId ? cloneDiveLogEntry(entry) : currentEntry))
      : [...entries, cloneDiveLogEntry(entry)];

    await this.writeEntries(nextEntries);
    return cloneDiveLogEntry(entry);
  }

  async delete(localId: string): Promise<void> {
    const entries = await this.readEntries();
    await this.writeEntries(entries.filter(entry => entry.localId !== localId));
  }

  async importWatchMessages(messages: WatchSyncMessage[]): Promise<DiveLogEntry[]> {
    const now = this.now();
    let entries = await this.readEntries();

    for (const message of messages) {
      const nextEntry = watchSessionToDiveLogEntry({ session: message.session, now });
      const currentEntry = findByImportKey(entries, nextEntry.watchCapture?.importKey);
      const mergedEntry = mergeWatchImport(currentEntry, nextEntry);

      entries = currentEntry
        ? entries.map(entry => (entry.localId === currentEntry.localId ? mergedEntry : entry))
        : [...entries, mergedEntry];
    }

    await this.writeEntries(entries);
    return this.list();
  }

  private async readEntries(): Promise<DiveLogEntry[]> {
    return (await this.store.read()).map(cloneDiveLogEntry);
  }

  private async writeEntries(entries: DiveLogEntry[]): Promise<void> {
    await this.store.write(entries.map(cloneDiveLogEntry).sort(compareDiveLogEntries));
  }
}

type LegacyDiveLogEntry = Omit<DiveLogEntry, 'cloudSyncStatus'> & {
  syncStatus?: 'localOnly' | 'pending' | 'synced' | 'failed';
};

function migrateLogbookEnvelope(envelope: StoredEnvelope<unknown>): DiveLogEntry[] {
  if (envelope.schemaVersion === 3) {
    return envelope.value as DiveLogEntry[];
  }

  if (envelope.schemaVersion === 2 && Array.isArray(envelope.value)) {
    return (envelope.value as LegacyDiveLogEntry[]).map(({ syncStatus: _legacyStatus, ...entry }) => ({
      ...entry,
      cloudSyncStatus: 'notConfigured',
    }));
  }

  throw new UnsupportedStorageVersionError(mobileStorageKeys.logbook, Number(envelope.schemaVersion));
}

export const createDefaultPersistentDiveLogRepository = (
  options: PersistentDiveLogRepositoryOptions = {},
): PersistentDiveLogRepository => {
  return new PersistentDiveLogRepository({
    initialEntries: createDefaultDiveLogRepository({ now: () => DEFAULT_FIXTURE_IMPORTED_AT }).listSync(),
    ...options,
  });
};

export const defaultPersistentDiveLogRepository = createDefaultPersistentDiveLogRepository();

function findByImportKey(entries: DiveLogEntry[], importKey: string | undefined): DiveLogEntry | undefined {
  if (!importKey) {
    return undefined;
  }

  return entries.find(entry => entry.watchCapture?.importKey === importKey);
}

function getCurrentTimestampSeconds(): number {
  return Date.now() / 1000;
}
