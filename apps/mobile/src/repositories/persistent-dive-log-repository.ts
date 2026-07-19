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
import { createWatchProfileStorage, type WatchProfileStorage } from '../storage/watch-profile-storage';
import type { DiveLogRepository } from './dive-log-repository';
import {
  cloneDiveLogEntry,
  compareDiveLogEntries,
  mergeWatchImport,
} from './local-dive-log-repository';

export type PersistentDiveLogRepositoryOptions = {
  storage?: PersistentKeyValueStore;
  storageKey?: string;
  now?: () => number;
  initialEntries?: DiveLogEntry[];
  onReadError?: (error: Error) => void;
  profileStorage?: WatchProfileStorage;
  profileKeyPrefix?: string;
};

export const DIVE_LOGBOOK_SCHEMA_VERSION = 3;
export const DEFAULT_WATCH_PROFILE_KEY_PREFIX = 'dive-mobile:watch-profile:';

export class PersistentDiveLogRepository implements DiveLogRepository {
  private readonly store: PersistentJsonStore<DiveLogEntry[]>;
  private readonly now: () => number;
  private readonly profileStorage: WatchProfileStorage;
  private readonly profileKeyPrefix: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: PersistentDiveLogRepositoryOptions = {}) {
    const initialEntries = options.initialEntries ?? [];
    this.now = options.now ?? getCurrentTimestampSeconds;
    const metadataStorage = options.storage ?? createAsyncStorageKeyValueStore();
    this.profileStorage = options.profileStorage ?? createWatchProfileStorage(metadataStorage);
    this.profileKeyPrefix = options.profileKeyPrefix ?? DEFAULT_WATCH_PROFILE_KEY_PREFIX;
    const storageKey = options.storageKey ?? mobileStorageKeys.logbook;
    this.store = new PersistentJsonStore<DiveLogEntry[]>({
      key: storageKey,
      schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
      defaultValue: () => initialEntries.map(cloneDiveLogEntry),
      migrate: envelope => migrateDiveLogbookEnvelope(envelope, storageKey),
      storage: metadataStorage,
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
    return this.enqueueMutation(async () => {
      const entries = await this.readEntries();
      const nextEntries = entries.some(currentEntry => currentEntry.localId === entry.localId)
        ? entries.map(currentEntry => (currentEntry.localId === entry.localId ? cloneDiveLogEntry(entry) : currentEntry))
        : [...entries, cloneDiveLogEntry(entry)];

      await this.writeEntries(nextEntries);
      return cloneDiveLogEntry(entry);
    });
  }

  async delete(localId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const entries = await this.readEntries();
      const deletedEntry = entries.find(entry => entry.localId === localId);
      await this.writeEntries(entries.filter(entry => entry.localId !== localId));
      if (deletedEntry?.watchCapture?.profile?.storageKey) {
        await this.profileStorage.remove(deletedEntry.watchCapture.profile.storageKey);
      }
    });
  }

  async importWatchMessages(
    messages: WatchSyncMessage[],
    options?: { profileDigests?: Array<string | undefined> },
  ): Promise<DiveLogEntry[]> {
    return this.enqueueMutation(async () => {
      const now = this.now();
      let entries = await this.readEntries();
      const obsoleteProfileKeys = new Set<string>();

      for (const [messageIndex, message] of messages.entries()) {
        const fullSamples = message.session.samples;
        const contentRevision = message.session.profile?.contentRevision
          ?? `${message.session.endedAt ?? message.session.startedAt}`;
        const profileStorageKey = makeProfileStorageKey(
          this.profileKeyPrefix,
          message.session.localSessionId,
          contentRevision,
        );
        await this.profileStorage.write(profileStorageKey, fullSamples);
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
                sha256: options?.profileDigests?.[messageIndex],
              },
            }
          : undefined;
        const currentEntry = findByImportKey(entries, nextEntry.watchCapture?.importKey);
        const currentProfileKey = currentEntry?.watchCapture?.profile?.storageKey;
        if (currentProfileKey && currentProfileKey !== profileStorageKey) {
          obsoleteProfileKeys.add(currentProfileKey);
        }
        const mergedEntry = mergeWatchImport(currentEntry, nextEntry);

        entries = currentEntry
          ? entries.map(entry => (entry.localId === currentEntry.localId ? mergedEntry : entry))
          : [...entries, mergedEntry];
      }

      await this.writeEntries(entries);
      await Promise.all(Array.from(obsoleteProfileKeys, key => this.profileStorage.remove(key)));
      return entries.map(cloneDiveLogEntry).sort(compareDiveLogEntries);
    });
  }

  async getWatchProfile(localId: string): Promise<WatchDepthSample[]> {
    const entry = (await this.readEntries()).find(candidate => candidate.localId === localId);
    const reference = entry?.watchCapture?.profile;
    if (!reference) {
      return entry?.watchCapture?.samples.map(sample => ({ ...sample })) ?? [];
    }
    const stored = await this.profileStorage.read(reference.storageKey);
    if (!stored) {
      return entry?.watchCapture?.samples.map(sample => ({ ...sample })) ?? [];
    }
    return stored;
  }

  private async readEntries(): Promise<DiveLogEntry[]> {
    return (await this.store.read()).map(cloneDiveLogEntry);
  }

  private async writeEntries(entries: DiveLogEntry[]): Promise<void> {
    await this.store.write(entries.map(cloneDiveLogEntry).sort(compareDiveLogEntries));
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

type LegacyDiveLogEntry = Omit<DiveLogEntry, 'cloudSyncStatus'> & {
  syncStatus?: 'localOnly' | 'pending' | 'synced' | 'failed';
};

export function parseDiveLogbookEnvelope(
  rawValue: string,
  storageKey: string = mobileStorageKeys.logbook,
): DiveLogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(`Malformed logbook envelope for ${storageKey}`);
  }

  return migrateDiveLogbookEnvelope(parsed as StoredEnvelope<unknown>, storageKey);
}

export function migrateDiveLogbookEnvelope(
  envelope: StoredEnvelope<unknown>,
  storageKey: string = mobileStorageKeys.logbook,
): DiveLogEntry[] {
  assertEnvelope(envelope, storageKey);

  if (envelope.schemaVersion === DIVE_LOGBOOK_SCHEMA_VERSION) {
    assertDiveLogEntries(envelope.value, true, storageKey);
    return (envelope.value as DiveLogEntry[]).map(cloneDiveLogEntry);
  }

  if (envelope.schemaVersion === 2) {
    assertDiveLogEntries(envelope.value, false, storageKey);
    return (envelope.value as LegacyDiveLogEntry[]).map(({ syncStatus: _legacyStatus, ...entry }) => ({
      ...entry,
      cloudSyncStatus: 'notConfigured',
    }));
  }

  throw new UnsupportedStorageVersionError(storageKey, Number(envelope.schemaVersion));
}

export const createDefaultPersistentDiveLogRepository = (
  options: PersistentDiveLogRepositoryOptions = {},
): PersistentDiveLogRepository => new PersistentDiveLogRepository(options);

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

function makeProfileStorageKey(prefix: string, localSessionId: string, contentRevision: string): string {
  return `${prefix}${encodeURIComponent(localSessionId)}:${encodeURIComponent(contentRevision)}`;
}

function assertEnvelope(value: unknown, storageKey: string): asserts value is StoredEnvelope<unknown> {
  if (!isRecord(value)
    || !Number.isInteger(value.schemaVersion)
    || typeof value.updatedAt !== 'number'
    || !Number.isFinite(value.updatedAt)
    || !('value' in value)) {
    throw new Error(`Malformed logbook envelope for ${storageKey}`);
  }
}

function assertDiveLogEntries(value: unknown, requireCloudStatus: boolean, storageKey: string): asserts value is DiveLogEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed logbook value for ${storageKey}`);
  }

  for (const entry of value) {
    if (!isRecord(entry)
      || !isNonEmptyString(entry.localId)
      || (entry.source !== 'manual' && entry.source !== 'watch')
      || !isFiniteNumber(entry.createdAt)
      || !isFiniteNumber(entry.updatedAt)
      || !isRecord(entry.manual)
      || !isRecord(entry.manual.site)
      || !areArrays(entry.manual, ['buddyIds', 'gearIds', 'tags', 'observedMarineLife'])
      || !isRecord(entry.manual.measuredValues)
      || !isRecord(entry.mobile)
      || !Array.isArray(entry.mobile.mediaPlaceholders)
      || !isRecord(entry.provenance)
      || (requireCloudStatus && !isCloudSyncStatus(entry.cloudSyncStatus))
      || (entry.ownerUserId !== undefined && typeof entry.ownerUserId !== 'string')
      || (entry.remoteId !== undefined && typeof entry.remoteId !== 'string')) {
      throw new Error(`Malformed logbook entry for ${storageKey}`);
    }

    if (entry.watchCapture !== undefined) {
      assertWatchCapture(entry.watchCapture, storageKey);
    }
  }
}

function assertWatchCapture(value: unknown, storageKey: string): void {
  if (!isRecord(value)
    || !isNonEmptyString(value.importKey)
    || !isFiniteNumber(value.importedAt)
    || !isRecord(value.session)
    || !isRecord(value.measuredValues)
    || !Array.isArray(value.samples)) {
    throw new Error(`Malformed logbook watch capture for ${storageKey}`);
  }

  if (value.profile !== undefined) {
    if (!isRecord(value.profile)
      || !isNonEmptyString(value.profile.storageKey)
      || !isNonEmptyString(value.profile.contentRevision)
      || !Number.isInteger(value.profile.sampleCount)
      || (value.profile.sampleCount as number) < 0
      || (value.profile.sha256 !== undefined && typeof value.profile.sha256 !== 'string')) {
      throw new Error(`Malformed logbook profile reference for ${storageKey}`);
    }
  }
}

function areArrays(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => Array.isArray(record[key]));
}

function isCloudSyncStatus(value: unknown): boolean {
  return value === 'notConfigured' || value === 'pending' || value === 'synced' || value === 'failed';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
