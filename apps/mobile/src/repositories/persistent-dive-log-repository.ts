import type { DiveLogEntry } from '../types/dive-log-entry';
import type { WatchDepthSample, WatchSyncMessage } from '../types/dive-session';
import { parseWatchSyncMessageValue } from '../utils/watch-sync-message-validation';
import { watchSessionToDiveLogEntry } from '../utils/watch-session-to-dive-log-entry';
import { createAsyncStorageKeyValueStore, type PersistentKeyValueStore } from '../storage/persistent-key-value-store';
import {
  PersistentJsonStore,
  UnsupportedStorageVersionError,
  type StoredEnvelope,
} from '../storage/persistent-json-store';
import { withLegacyDataMigrationLock } from '../storage/legacy-data-migration-lock';
import { mobileStorageKeys } from '../storage/storage-keys';
import { createWatchProfileStorage, type WatchProfileStorage } from '../storage/watch-profile-storage';
import type {
  DeleteDiveLogOptions,
  DiveLogRepository,
  ImportWatchMessagesOptions,
} from './dive-log-repository';
import type {ConditionalDeleteResult, DeletePredicate} from './conditional-delete';
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
  private readonly metadataStorage: PersistentKeyValueStore;
  private readonly storageKey: string;
  private readonly now: () => number;
  private readonly profileStorage: WatchProfileStorage;
  private readonly profileKeyPrefix: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: PersistentDiveLogRepositoryOptions = {}) {
    const initialEntries = options.initialEntries ?? [];
    this.now = options.now ?? getCurrentTimestampSeconds;
    const metadataStorage = options.storage ?? createAsyncStorageKeyValueStore();
    this.metadataStorage = metadataStorage;
    this.profileStorage = options.profileStorage ?? createWatchProfileStorage(metadataStorage);
    this.profileKeyPrefix = options.profileKeyPrefix ?? DEFAULT_WATCH_PROFILE_KEY_PREFIX;
    const storageKey = options.storageKey ?? mobileStorageKeys.logbook;
    this.storageKey = storageKey;
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
      const entries = await this.readEntries();
      options?.assertCanCommit?.();
      const deletedEntry = entries.find(entry => entry.localId === localId);
      if (deletedEntry === undefined) {
        return 'notFound';
      }
      if (!predicate(cloneDiveLogEntry(deletedEntry))) {
        return 'conditionFailed';
      }
      const metadataSnapshot = await this.metadataStorage.getString(
        this.storageKey,
      );
      options?.assertCanCommit?.();
      const nextEntries = entries.filter(entry => entry.localId !== localId);
      const deletedProfileKey = deletedEntry?.watchCapture?.profile?.storageKey;
      const profileKeyToRemove =
        options?.retainProfileAfterDelete !== true &&
        deletedProfileKey !== undefined &&
        !referencesProfile(nextEntries, deletedProfileKey)
          ? deletedProfileKey
          : undefined;
      let profileSnapshot: WatchDepthSample[] | undefined;
      if (profileKeyToRemove !== undefined) {
        options?.assertCanCommit?.();
        profileSnapshot = await this.profileStorage.read(profileKeyToRemove);
        options?.assertCanCommit?.();
      }
      let metadataWriteAttempted = false;
      let removedProfileKey: string | undefined;
      try {
        options?.assertCanCommit?.();
        metadataWriteAttempted = true;
        await this.writeEntries(nextEntries);
        options?.assertCanCommit?.();
        if (profileKeyToRemove !== undefined) {
          options?.assertCanCommit?.();
          removedProfileKey = profileKeyToRemove;
          await this.profileStorage.remove(profileKeyToRemove);
          options?.assertCanCommit?.();
        }
      } catch (error) {
        let rollbackError: unknown;
        if (removedProfileKey !== undefined) {
          try {
            await this.restoreProfileSnapshot({
              key: removedProfileKey,
              previous: profileSnapshot,
            });
          } catch (profileError) {
            rollbackError = profileError;
          }
        }
        if (metadataWriteAttempted) {
          try {
            await this.restoreMetadataSnapshot(metadataSnapshot);
          } catch (metadataError) {
            rollbackError ??= metadataError;
          }
        }
        if (rollbackError !== undefined) {
          throw rollbackError;
        }
        throw error;
      }
      return 'deleted';
    });
  }

  async removeWatchProfileIfUnreferenced(storageKey: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const entries = await this.readEntries();
      if (!referencesProfile(entries, storageKey)) {
        await this.profileStorage.remove(storageKey);
      }
    });
  }

  async importWatchMessages(
    messages: WatchSyncMessage[],
    options?: ImportWatchMessagesOptions,
  ): Promise<DiveLogEntry[]> {
    return this.enqueueMutation(async () => {
      const metadataSnapshot = await this.metadataStorage.getString(this.storageKey);
      const profileSnapshots: ProfileWriteSnapshot[] = [];
      const obsoleteProfileKeys = new Set<string>();
      let metadataWriteAttempted = false;
      let committedEntries: DiveLogEntry[];
      const now = this.now();
      try {
        let entries = await this.readEntries();

        for (const [messageIndex, message] of messages.entries()) {
          const fullSamples = message.session.samples;
          const contentRevision = message.session.profile?.contentRevision
            ?? `${message.session.endedAt ?? message.session.startedAt}`;
          const profileStorageKey = makeProfileStorageKey(
            this.profileKeyPrefix,
            message.session.localSessionId,
            contentRevision,
          );
          profileSnapshots.push({
            key: profileStorageKey,
            previous: await this.profileStorage.read(profileStorageKey),
          });
          options?.assertCanCommit?.();
          await this.profileStorage.write(profileStorageKey, fullSamples);
          options?.assertCanCommit?.();
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

        options?.assertCanCommit?.();
        metadataWriteAttempted = true;
        await this.writeEntries(entries);
        options?.assertCanCommit?.();
        committedEntries = entries;
      } catch (error) {
        if (metadataWriteAttempted) {
          await this.restoreMetadataSnapshot(metadataSnapshot);
        }
        await this.restoreProfileSnapshots(profileSnapshots);
        throw error;
      }

      await Promise.allSettled(
        Array.from(obsoleteProfileKeys)
          .filter(key => !referencesProfile(committedEntries, key))
          .map(key => this.profileStorage.remove(key)),
      );
      return committedEntries.map(cloneDiveLogEntry).sort(compareDiveLogEntries);
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
    const result = this.mutationQueue.then(() => withLegacyDataMigrationLock(operation));
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async restoreMetadataSnapshot(snapshot: string | undefined): Promise<void> {
    if (snapshot === undefined) {
      await this.metadataStorage.remove(this.storageKey);
    } else {
      await this.metadataStorage.setString(this.storageKey, snapshot);
    }
  }

  private async restoreProfileSnapshots(
    snapshots: readonly ProfileWriteSnapshot[],
  ): Promise<void> {
    for (const snapshot of [...snapshots].reverse()) {
      await this.restoreProfileSnapshot(snapshot);
    }
  }

  private async restoreProfileSnapshot(
    snapshot: ProfileWriteSnapshot,
  ): Promise<void> {
    if (snapshot.previous === undefined) {
      await this.profileStorage.remove(snapshot.key);
    } else {
      await this.profileStorage.write(snapshot.key, snapshot.previous);
    }
  }
}

type ProfileWriteSnapshot = {
  key: string;
  previous?: WatchDepthSample[];
};

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

  return migrateDiveLogbookEnvelope(parsed, storageKey);
}

export function migrateDiveLogbookEnvelope(
  envelope: unknown,
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

function referencesProfile(entries: DiveLogEntry[], storageKey: string): boolean {
  return entries.some(entry => entry.watchCapture?.profile?.storageKey === storageKey);
}

function getCurrentTimestampSeconds(): number {
  return Date.now() / 1000;
}

function makeProfileStorageKey(prefix: string, localSessionId: string, contentRevision: string): string {
  return `${prefix}${encodeURIComponent(localSessionId)}:${encodeURIComponent(contentRevision)}`;
}

function assertEnvelope(value: unknown, storageKey: string): asserts value is StoredEnvelope<unknown> {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'updatedAt', 'value'])
    || !Number.isInteger(value.schemaVersion)
    || typeof value.updatedAt !== 'number'
    || !Number.isFinite(value.updatedAt)
    || !('value' in value)) {
    throw new Error(`Malformed logbook envelope for ${storageKey}`);
  }
}

function assertDiveLogEntries(value: unknown, requireCloudStatus: boolean, storageKey: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed logbook value for ${storageKey}`);
  }

  for (const entry of value) {
    if (!isRecord(entry)
      || !hasOnlyKeys(entry, [
        'localId',
        'remoteId',
        'remoteRevision',
        'ownerUserId',
        'source',
        'cloudSyncStatus',
        'syncStatus',
        'createdAt',
        'updatedAt',
        'manual',
        'mobile',
        'watchCapture',
        'provenance',
      ])
      || !isNonEmptyString(entry.localId)
      || (entry.source !== 'manual' && entry.source !== 'watch')
      || !isFiniteNumber(entry.createdAt)
      || !isFiniteNumber(entry.updatedAt)
      || !isOptionalNonEmptyString(entry.ownerUserId)
      || !isOptionalNonEmptyString(entry.remoteId)
      || !isOptionalPositiveInteger(entry.remoteRevision)
      || (requireCloudStatus
        ? !isCloudSyncStatus(entry.cloudSyncStatus) || entry.syncStatus !== undefined
        : entry.cloudSyncStatus !== undefined || !isOptionalLegacySyncStatus(entry.syncStatus))) {
      throw new Error(`Malformed logbook entry for ${storageKey}`);
    }

    assertManualFields(entry.manual, storageKey);
    assertMobileFields(entry.mobile, storageKey);
    assertProvenance(entry.provenance, storageKey);

    if (entry.watchCapture !== undefined) {
      assertWatchCapture(entry.watchCapture, storageKey);
    }
  }
}

function assertWatchCapture(value: unknown, storageKey: string): void {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['importKey', 'importedAt', 'session', 'measuredValues', 'samples', 'profile'])
    || !isNonEmptyString(value.importKey)
    || !isFiniteNumber(value.importedAt)
    || !isRecord(value.measuredValues)
    || !hasOnlyKeys(value.measuredValues, [
      'startedAt',
      'endedAt',
      'durationSeconds',
      'maxDepthMeters',
      'averageDepthMeters',
      'waterTemperatureCelsius',
    ])
    || !isFiniteNumber(value.measuredValues.startedAt)
    || !optionalFiniteNumber(value.measuredValues.endedAt)
    || !optionalFiniteNumber(value.measuredValues.durationSeconds)
    || !optionalFiniteNumber(value.measuredValues.maxDepthMeters)
    || !optionalFiniteNumber(value.measuredValues.averageDepthMeters)
    || !optionalFiniteNumber(value.measuredValues.waterTemperatureCelsius)
    || !Array.isArray(value.samples)) {
    throw new Error(`Malformed logbook watch capture for ${storageKey}`);
  }

  const sessionResult = parseWatchSyncMessageValue({ type: 'sessionEnded', session: value.session });
  if (!sessionResult.ok) {
    throw new Error(`Malformed logbook watch session for ${storageKey}: ${sessionResult.error.message}`);
  }
  const samplesResult = parseWatchSyncMessageValue({
    type: 'sessionEnded',
    session: {
      localSessionId: sessionResult.message.session.localSessionId,
      startedAt: sessionResult.message.session.startedAt,
      samples: value.samples,
    },
  });
  if (!samplesResult.ok) {
    throw new Error(`Malformed logbook watch samples for ${storageKey}`);
  }

  if (value.profile !== undefined) {
    if (!isRecord(value.profile)
      || !hasOnlyKeys(value.profile, ['storageKey', 'contentRevision', 'sampleCount', 'sha256'])
      || !isNonEmptyString(value.profile.storageKey)
      || !isNonEmptyString(value.profile.contentRevision)
      || !Number.isInteger(value.profile.sampleCount)
      || (value.profile.sampleCount as number) < 0
      || !isOptionalNonEmptyString(value.profile.sha256)
      || (sessionResult.message.session.profile !== undefined
        && (sessionResult.message.session.profile.contentRevision !== value.profile.contentRevision
          || sessionResult.message.session.profile.sampleCount !== value.profile.sampleCount))) {
      throw new Error(`Malformed logbook profile reference for ${storageKey}`);
    }
  }
}

function assertManualFields(value: unknown, storageKey: string): void {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'title',
      'site',
      'entryStyle',
      'buddyIds',
      'gearIds',
      'tags',
      'observedMarineLife',
      'notes',
      'rating',
      'measuredValues',
    ])
    || !isOptionalString(value.title)
    || !isRecord(value.site)
    || !hasOnlyKeys(value.site, ['siteId', 'name'])
    || !isOptionalString(value.site.siteId)
    || !isOptionalString(value.site.name)
    || !isOptionalEnum(value.entryStyle, ['shore', 'boat', 'pool'])
    || !isStringArray(value.buddyIds)
    || !isStringArray(value.gearIds)
    || !isStringArray(value.tags)
    || !isStringArray(value.observedMarineLife)
    || !isOptionalString(value.notes)
    || !optionalFiniteNumber(value.rating)) {
    throw new Error(`Malformed logbook manual fields for ${storageKey}`);
  }
  assertManualMeasuredValues(value.measuredValues, storageKey);
}

function assertManualMeasuredValues(value: unknown, storageKey: string): void {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'startedAt',
      'endedAt',
      'durationSeconds',
      'maxDepthMeters',
      'averageDepthMeters',
      'waterTemperatureCelsius',
      'diveMode',
      'gasLabel',
      'perceivedExertion',
      'visibilityRating',
      'waterCondition',
      'repetitionCount',
      'trainingFocus',
      'poolLengthMeters',
      'lapCount',
      'pressure',
    ])
    || !optionalFiniteNumber(value.startedAt)
    || !optionalFiniteNumber(value.endedAt)
    || !optionalFiniteNumber(value.durationSeconds)
    || !optionalFiniteNumber(value.maxDepthMeters)
    || !optionalFiniteNumber(value.averageDepthMeters)
    || !optionalFiniteNumber(value.waterTemperatureCelsius)
    || !isOptionalEnum(value.diveMode, ['scuba', 'freedive'])
    || !isOptionalString(value.gasLabel)
    || !optionalFiniteNumber(value.perceivedExertion)
    || !optionalFiniteNumber(value.visibilityRating)
    || !isOptionalEnum(value.waterCondition, ['calm', 'mild', 'choppy', 'surge', 'current', 'unknown'])
    || !optionalFiniteNumber(value.repetitionCount)
    || !isOptionalString(value.trainingFocus)
    || !optionalFiniteNumber(value.poolLengthMeters)
    || !optionalFiniteNumber(value.lapCount)) {
    throw new Error(`Malformed logbook measured values for ${storageKey}`);
  }

  if (value.pressure !== undefined) {
    if (!isRecord(value.pressure)
      || !hasOnlyKeys(value.pressure, ['unit', 'start', 'end'])
      || !isOptionalEnum(value.pressure.unit, ['bar', 'psi'])
      || !optionalFiniteNumber(value.pressure.start)
      || !optionalFiniteNumber(value.pressure.end)) {
      throw new Error(`Malformed logbook pressure values for ${storageKey}`);
    }
  }
}

function assertMobileFields(value: unknown, storageKey: string): void {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['mediaPlaceholders'])
    || !isStringArray(value.mediaPlaceholders)) {
    throw new Error(`Malformed logbook mobile fields for ${storageKey}`);
  }
}

function assertProvenance(value: unknown, storageKey: string): void {
  const keys = [
    'site',
    'buddyIds',
    'gearIds',
    'tags',
    'observedMarineLife',
    'notes',
    'rating',
    'measuredValues',
    'mediaPlaceholders',
    'startedAt',
    'endedAt',
    'durationSeconds',
    'maxDepthMeters',
    'averageDepthMeters',
    'waterTemperatureCelsius',
    'gasLabel',
    'perceivedExertion',
    'visibilityRating',
    'waterCondition',
    'repetitionCount',
    'trainingFocus',
    'poolLengthMeters',
    'lapCount',
    'pressure',
    'depthSamples',
  ];
  if (!isRecord(value)
    || !hasOnlyKeys(value, keys)
    || Object.values(value).some(source => source !== 'manual' && source !== 'mobile' && source !== 'watch')) {
    throw new Error(`Malformed logbook provenance for ${storageKey}`);
  }
}

function isCloudSyncStatus(value: unknown): boolean {
  return value === 'notConfigured' || value === 'pending' || value === 'synced' || value === 'failed' || value === 'conflict';
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) >= 1);
}

function isOptionalLegacySyncStatus(value: unknown): boolean {
  return value === undefined || value === 'localOnly' || value === 'pending' || value === 'synced' || value === 'failed';
}

function isOptionalEnum(value: unknown, values: readonly string[]): boolean {
  return value === undefined || (typeof value === 'string' && values.includes(value));
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(record).every(key => allowedKeys.includes(key));
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
