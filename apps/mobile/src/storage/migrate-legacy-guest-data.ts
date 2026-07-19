import {
  DIVE_LOGBOOK_SCHEMA_VERSION,
  parseDiveLogbookEnvelope,
} from '../repositories/persistent-dive-log-repository';
import {
  DIVE_PLANBOOK_SCHEMA_VERSION,
  parseDivePlanbookEnvelope,
} from '../repositories/persistent-dive-plan-repository';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { WatchDepthSample } from '../types/dive-session';
import type { DivePlan } from '../types/dive-plan';
import { dataProfileKeyPrefix, dataStorageKeys } from './data-principal';
import type { PersistentKeyValueStore } from './persistent-key-value-store';
import { mobileStorageKeys } from './storage-keys';
import type { WatchProfileStorage } from './watch-profile-storage';

export const LEGACY_GUEST_MIGRATION_MARKER_KEY = mobileStorageKeys.legacyGuestMigration;
export const LEGACY_GUEST_MIGRATION_COMPLETE = 'complete';

export type LegacyGuestDataMigrationDependencies = {
  metadataStorage: PersistentKeyValueStore;
  profileStorage: WatchProfileStorage;
  now?: () => number;
};

type VerifiedMigrationMarker = {
  state: 'verified';
  sourceMetadataKeys: string[];
  sourceProfileKeys: string[];
  guestMetadataKeys: string[];
};

type ProfileCopy = {
  sourceKey: string;
  targetKey: string;
  samples: WatchDepthSample[];
};

export async function migrateLegacyGuestData(
  dependencies: LegacyGuestDataMigrationDependencies,
): Promise<void> {
  const { metadataStorage, profileStorage } = dependencies;
  const marker = await metadataStorage.getString(LEGACY_GUEST_MIGRATION_MARKER_KEY);

  if (marker === LEGACY_GUEST_MIGRATION_COMPLETE) {
    return;
  }

  if (marker !== undefined) {
    const verifiedMarker = parseVerifiedMarker(marker);
    await verifyMarkedGuestTargets(verifiedMarker, metadataStorage, profileStorage);
    await cleanupLegacySources(verifiedMarker, metadataStorage, profileStorage);
    await metadataStorage.setString(LEGACY_GUEST_MIGRATION_MARKER_KEY, LEGACY_GUEST_MIGRATION_COMPLETE);
    return;
  }

  const [rawLegacyLogbook, rawLegacyPlanbook] = await Promise.all([
    metadataStorage.getString(mobileStorageKeys.logbook),
    metadataStorage.getString(mobileStorageKeys.planbook),
  ]);

  if (rawLegacyLogbook === undefined && rawLegacyPlanbook === undefined) {
    return;
  }

  const guestKeys = dataStorageKeys({ kind: 'guest' });
  const legacyLogs = rawLegacyLogbook === undefined
    ? undefined
    : parseDiveLogbookEnvelope(rawLegacyLogbook, mobileStorageKeys.logbook).filter(entry => !isBuiltInDemoFixture(entry));
  const legacyPlans = rawLegacyPlanbook === undefined
    ? undefined
    : parseDivePlanbookEnvelope(rawLegacyPlanbook, mobileStorageKeys.planbook);
  const profileCopies = await collectProfileCopies(legacyLogs ?? [], profileStorage);
  const guestLogs = legacyLogs?.map(entry => rewriteGuestLog(entry, profileCopies));
  const guestPlans = legacyPlans?.map(toGuestPlan);

  const [rawGuestLogbook, rawGuestPlanbook] = await Promise.all([
    metadataStorage.getString(guestKeys.logbook),
    metadataStorage.getString(guestKeys.planbook),
  ]);

  verifyExistingTarget(rawGuestLogbook, guestLogs, guestKeys.logbook, parseDiveLogbookEnvelope);
  verifyExistingTarget(rawGuestPlanbook, guestPlans, guestKeys.planbook, parseDivePlanbookEnvelope);

  await copyAndVerifyProfiles(profileCopies, profileStorage);

  const now = dependencies.now ?? getCurrentTimestampSeconds;
  if (guestLogs !== undefined && rawGuestLogbook === undefined) {
    await writeEnvelope(
      metadataStorage,
      guestKeys.logbook,
      DIVE_LOGBOOK_SCHEMA_VERSION,
      guestLogs,
      now(),
    );
  }
  if (guestPlans !== undefined && rawGuestPlanbook === undefined) {
    await writeEnvelope(
      metadataStorage,
      guestKeys.planbook,
      DIVE_PLANBOOK_SCHEMA_VERSION,
      guestPlans,
      now(),
    );
  }

  await verifyMetadataReadback(metadataStorage, guestKeys.logbook, guestLogs, parseDiveLogbookEnvelope);
  await verifyMetadataReadback(metadataStorage, guestKeys.planbook, guestPlans, parseDivePlanbookEnvelope);
  await verifyProfileReadback(profileCopies, profileStorage);

  const verifiedMarker: VerifiedMigrationMarker = {
    state: 'verified',
    sourceMetadataKeys: [
      ...(rawLegacyLogbook === undefined ? [] : [mobileStorageKeys.logbook]),
      ...(rawLegacyPlanbook === undefined ? [] : [mobileStorageKeys.planbook]),
    ],
    sourceProfileKeys: profileCopies.map(copy => copy.sourceKey),
    guestMetadataKeys: [
      ...(guestLogs === undefined ? [] : [guestKeys.logbook]),
      ...(guestPlans === undefined ? [] : [guestKeys.planbook]),
    ],
  };

  await metadataStorage.setString(LEGACY_GUEST_MIGRATION_MARKER_KEY, JSON.stringify(verifiedMarker));
  await cleanupLegacySources(verifiedMarker, metadataStorage, profileStorage);
  await metadataStorage.setString(LEGACY_GUEST_MIGRATION_MARKER_KEY, LEGACY_GUEST_MIGRATION_COMPLETE);
}

async function collectProfileCopies(
  entries: DiveLogEntry[],
  profileStorage: WatchProfileStorage,
): Promise<ProfileCopy[]> {
  const copies = new Map<string, ProfileCopy>();

  for (const entry of entries) {
    const reference = entry.watchCapture?.profile;
    if (!reference || copies.has(reference.storageKey)) {
      continue;
    }

    const samples = await profileStorage.read(reference.storageKey);
    assertValidProfile(samples, reference.storageKey);
    if (samples.length !== reference.sampleCount) {
      throw new Error(`Legacy profile sample count mismatch for ${reference.storageKey}`);
    }

    copies.set(reference.storageKey, {
      sourceKey: reference.storageKey,
      targetKey: `${dataProfileKeyPrefix({ kind: 'guest' })}${encodeURIComponent(reference.storageKey)}`,
      samples: cloneSamples(samples),
    });
  }

  return Array.from(copies.values());
}

function rewriteGuestLog(entry: DiveLogEntry, copies: ProfileCopy[]): DiveLogEntry {
  const cloned = cloneValue(entry);
  delete cloned.ownerUserId;
  const profile = cloned.watchCapture?.profile;
  if (profile) {
    const copy = copies.find(candidate => candidate.sourceKey === profile.storageKey);
    if (!copy) {
      throw new Error(`Legacy profile copy was not prepared for ${profile.storageKey}`);
    }
    profile.storageKey = copy.targetKey;
  }
  return cloned;
}

function toGuestPlan(plan: DivePlan): DivePlan {
  const cloned = cloneValue(plan);
  delete cloned.ownerUserId;
  return { ...cloned, cloudSyncStatus: cloned.cloudSyncStatus ?? 'notConfigured' };
}

function verifyExistingTarget<T>(
  rawTarget: string | undefined,
  expected: T[] | undefined,
  storageKey: string,
  parse: (rawValue: string, key: string) => T[],
): void {
  if (expected === undefined) {
    if (rawTarget !== undefined) {
      throw new Error(`Existing guest target cannot be merged: ${storageKey}`);
    }
    return;
  }

  if (rawTarget === undefined) {
    return;
  }

  const actual = parse(rawTarget, storageKey);
  if (!deepEqual(actual, expected)) {
    throw new Error(`Existing guest target does not match resumable copy: ${storageKey}`);
  }
}

async function copyAndVerifyProfiles(copies: ProfileCopy[], profileStorage: WatchProfileStorage): Promise<void> {
  for (const copy of copies) {
    const existing = await profileStorage.read(copy.targetKey);
    if (existing !== undefined) {
      assertValidProfile(existing, copy.targetKey);
      if (!deepEqual(existing, copy.samples)) {
        throw new Error(`Existing guest target profile does not match: ${copy.targetKey}`);
      }
      continue;
    }

    await profileStorage.write(copy.targetKey, cloneSamples(copy.samples));
    const readback = await profileStorage.read(copy.targetKey);
    assertValidProfile(readback, copy.targetKey);
    if (!deepEqual(readback, copy.samples)) {
      throw new Error(`Guest profile read-back mismatch for ${copy.targetKey}`);
    }
  }
}

async function verifyProfileReadback(copies: ProfileCopy[], profileStorage: WatchProfileStorage): Promise<void> {
  for (const copy of copies) {
    const readback = await profileStorage.read(copy.targetKey);
    assertValidProfile(readback, copy.targetKey);
    if (!deepEqual(readback, copy.samples)) {
      throw new Error(`Guest profile read-back mismatch for ${copy.targetKey}`);
    }
  }
}

async function verifyMetadataReadback<T>(
  metadataStorage: PersistentKeyValueStore,
  storageKey: string,
  expected: T[] | undefined,
  parse: (rawValue: string, key: string) => T[],
): Promise<void> {
  if (expected === undefined) {
    return;
  }

  const rawReadback = await metadataStorage.getString(storageKey);
  if (rawReadback === undefined || !deepEqual(parse(rawReadback, storageKey), expected)) {
    throw new Error(`Guest metadata read-back mismatch for ${storageKey}`);
  }
}

async function writeEnvelope<T>(
  storage: PersistentKeyValueStore,
  key: string,
  schemaVersion: number,
  value: T[],
  updatedAt: number,
): Promise<void> {
  await storage.setString(key, JSON.stringify({ schemaVersion, updatedAt, value }));
}

function parseVerifiedMarker(rawMarker: string): VerifiedMigrationMarker {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMarker);
  } catch {
    throw new Error('Malformed legacy guest migration marker');
  }

  if (!isRecord(parsed)
    || parsed.state !== 'verified'
    || !isStringArray(parsed.sourceMetadataKeys)
    || !isStringArray(parsed.sourceProfileKeys)
    || !isStringArray(parsed.guestMetadataKeys)) {
    throw new Error('Malformed legacy guest migration marker');
  }

  const guestKeys = dataStorageKeys({ kind: 'guest' });
  const expectedGuestKeys = parsed.sourceMetadataKeys.map(key => {
    if (key === mobileStorageKeys.logbook) {
      return guestKeys.logbook;
    }
    if (key === mobileStorageKeys.planbook) {
      return guestKeys.planbook;
    }
    throw new Error('Malformed legacy guest migration marker');
  });
  const guestProfilePrefix = dataProfileKeyPrefix({ kind: 'guest' });
  if (!hasUniqueValues(parsed.sourceMetadataKeys)
    || !hasUniqueValues(parsed.sourceProfileKeys)
    || !hasUniqueValues(parsed.guestMetadataKeys)
    || !sameStringSet(parsed.guestMetadataKeys, expectedGuestKeys)
    || parsed.sourceProfileKeys.some(key => !key.startsWith('dive-mobile:watch-profile:')
      || key.startsWith(guestProfilePrefix))) {
    throw new Error('Malformed legacy guest migration marker');
  }

  return {
    state: 'verified',
    sourceMetadataKeys: parsed.sourceMetadataKeys,
    sourceProfileKeys: parsed.sourceProfileKeys,
    guestMetadataKeys: parsed.guestMetadataKeys,
  };
}

async function verifyMarkedGuestTargets(
  marker: VerifiedMigrationMarker,
  metadataStorage: PersistentKeyValueStore,
  profileStorage: WatchProfileStorage,
): Promise<void> {
  const guestKeys = dataStorageKeys({ kind: 'guest' });
  const referencedGuestProfileKeys: string[] = [];

  for (const key of marker.guestMetadataKeys) {
    const rawValue = await metadataStorage.getString(key);
    if (rawValue === undefined) {
      throw new Error(`Verified guest target is missing: ${key}`);
    }

    if (key === guestKeys.logbook) {
      const entries = parseDiveLogbookEnvelope(rawValue, key);
      for (const entry of entries) {
        const reference = entry.watchCapture?.profile;
        if (reference) {
          referencedGuestProfileKeys.push(reference.storageKey);
          const samples = await profileStorage.read(reference.storageKey);
          assertValidProfile(samples, reference.storageKey);
          if (samples.length !== reference.sampleCount) {
            throw new Error(`Verified guest profile sample count mismatch: ${reference.storageKey}`);
          }
        }
      }
    } else if (key === guestKeys.planbook) {
      parseDivePlanbookEnvelope(rawValue, key);
    } else {
      throw new Error(`Unexpected verified guest target: ${key}`);
    }
  }

  const expectedGuestProfileKeys = marker.sourceProfileKeys.map(
    key => `${dataProfileKeyPrefix({ kind: 'guest' })}${encodeURIComponent(key)}`,
  );
  if (!sameStringSet(Array.from(new Set(referencedGuestProfileKeys)), expectedGuestProfileKeys)) {
    throw new Error('Malformed legacy guest migration marker profile references');
  }
}

async function cleanupLegacySources(
  marker: VerifiedMigrationMarker,
  metadataStorage: PersistentKeyValueStore,
  profileStorage: WatchProfileStorage,
): Promise<void> {
  for (const key of marker.sourceMetadataKeys) {
    await metadataStorage.remove(key);
  }
  for (const key of marker.sourceProfileKeys) {
    await profileStorage.remove(key);
  }
}

function assertValidProfile(value: unknown, storageKey: string): asserts value is WatchDepthSample[] {
  if (!Array.isArray(value)) {
    throw new Error(`Legacy profile is missing or malformed: ${storageKey}`);
  }

  for (const sample of value) {
    if (!isRecord(sample)
      || typeof sample.localSessionId !== 'string'
      || sample.localSessionId.length === 0
      || !isFiniteNumber(sample.timestamp)
      || !isFiniteNumber(sample.depthMeters)
      || !optionalFiniteNumber(sample.pressureKPa)
      || !optionalFiniteNumber(sample.bucketMinDepthMeters)
      || !optionalFiniteNumber(sample.bucketMaxDepthMeters)
      || !optionalFiniteNumber(sample.waterTemperatureCelsius)) {
      throw new Error(`Legacy profile is malformed: ${storageKey}`);
    }
  }
}

function cloneSamples(value: WatchDepthSample[]): WatchDepthSample[] {
  return value.map(sample => ({ ...sample }));
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return deepEqual(leftKeys, rightKeys) && leftKeys.every(key => deepEqual(left[key], right[key]));
  }
  return false;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function hasUniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value));
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getCurrentTimestampSeconds(): number {
  return Date.now() / 1000;
}

function isBuiltInDemoFixture(entry: DiveLogEntry): boolean {
  return entry.localId === 'watch:fixture-rich-session:1781352600'
    && entry.watchCapture?.importKey === 'fixture-rich-session:1781352600'
    && entry.watchCapture.importedAt === 0;
}
