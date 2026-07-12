import type { DiveLogEntry } from '../types/dive-log-entry';
import type { WatchDepthSample, WatchSyncMessage } from '../types/dive-session';
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
  private readonly profileStorage: PersistentKeyValueStore;

  constructor(options: PersistentDiveLogRepositoryOptions = {}) {
    const initialEntries = options.initialEntries ?? [];
    this.now = options.now ?? getCurrentTimestampSeconds;
    this.profileStorage = options.storage ?? createAsyncStorageKeyValueStore();
    this.store = new PersistentJsonStore<DiveLogEntry[]>({
      key: mobileStorageKeys.logbook,
      schemaVersion: 3,
      defaultValue: () => initialEntries.map(cloneDiveLogEntry),
      migrate: migrateLogbookEnvelope,
      storage: this.profileStorage,
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
    const deletedEntry = entries.find(entry => entry.localId === localId);
    if (deletedEntry?.watchCapture?.profile?.storageKey) {
      await this.profileStorage.remove(deletedEntry.watchCapture.profile.storageKey);
    }
    await this.writeEntries(entries.filter(entry => entry.localId !== localId));
  }

  async importWatchMessages(messages: WatchSyncMessage[]): Promise<DiveLogEntry[]> {
    const now = this.now();
    let entries = await this.readEntries();

    for (const message of messages) {
      const fullSamples = message.session.samples;
      const contentRevision = message.session.profile?.contentRevision
        ?? `${message.session.endedAt ?? message.session.startedAt}`;
      const profileStorageKey = makeProfileStorageKey(message.session.localSessionId, contentRevision);
      await this.profileStorage.setString(profileStorageKey, JSON.stringify(fullSamples));
      const previewSamples = makePeakPreservingPreview(fullSamples);
      const nextEntry = watchSessionToDiveLogEntry({
        session: { ...message.session, samples: previewSamples },
        now,
      });
      nextEntry.watchCapture = nextEntry.watchCapture
        ? {
            ...nextEntry.watchCapture,
            profile: {
              storageKey: profileStorageKey,
              contentRevision,
              sampleCount: fullSamples.length,
            },
          }
        : undefined;
      const currentEntry = findByImportKey(entries, nextEntry.watchCapture?.importKey);
      const mergedEntry = mergeWatchImport(currentEntry, nextEntry);

      entries = currentEntry
        ? entries.map(entry => (entry.localId === currentEntry.localId ? mergedEntry : entry))
        : [...entries, mergedEntry];
    }

    await this.writeEntries(entries);
    return this.list();
  }

  async getWatchProfile(localId: string): Promise<WatchDepthSample[]> {
    const entry = (await this.readEntries()).find(candidate => candidate.localId === localId);
    const reference = entry?.watchCapture?.profile;
    if (!reference) {
      return entry?.watchCapture?.samples.map(sample => ({ ...sample })) ?? [];
    }
    const stored = await this.profileStorage.getString(reference.storageKey);
    if (!stored) {
      return entry?.watchCapture?.samples.map(sample => ({ ...sample })) ?? [];
    }
    return JSON.parse(stored) as WatchDepthSample[];
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

function makeProfileStorageKey(localSessionId: string, contentRevision: string): string {
  return `dive-mobile:watch-profile:${encodeURIComponent(localSessionId)}:${encodeURIComponent(contentRevision)}`;
}

function makePeakPreservingPreview(samples: WatchDepthSample[], limit = 160): WatchDepthSample[] {
  if (samples.length <= limit) {
    return samples;
  }
  const bucketSize = samples.length / limit;
  return Array.from({ length: limit }, (_, index) => {
    const start = Math.floor(index * bucketSize);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
    return samples.slice(start, end).reduce((deepest, sample) => {
      const deepestValue = deepest.bucketMaxDepthMeters ?? deepest.depthMeters;
      const sampleValue = sample.bucketMaxDepthMeters ?? sample.depthMeters;
      return sampleValue > deepestValue ? sample : deepest;
    });
  });
}
