import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { createDefaultDiveLogRepository } from '../repositories/local-dive-log-repository';
import {
  DIVE_LOGBOOK_SCHEMA_VERSION,
  DEFAULT_WATCH_PROFILE_KEY_PREFIX,
  parseDiveLogbookEnvelope,
} from '../repositories/persistent-dive-log-repository';
import {
  DIVE_PLANBOOK_SCHEMA_VERSION,
  parseDivePlanbookEnvelope,
} from '../repositories/persistent-dive-plan-repository';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { WatchDepthSample } from '../types/dive-session';
import type { DivePlan } from '../types/dive-plan';
import { parseWatchSyncMessageValue } from '../utils/watch-sync-message-validation';
import { dataProfileKeyPrefix, dataStorageKeys } from './data-principal';
import { withLegacyDataMigrationLock } from './legacy-data-migration-lock';
import type { PersistentKeyValueStore } from './persistent-key-value-store';
import { mobileStorageKeys } from './storage-keys';
import type { WatchProfileStorage } from './watch-profile-storage';

export const LEGACY_GUEST_MIGRATION_MARKER_KEY = mobileStorageKeys.legacyGuestMigration;
export const LEGACY_GUEST_MIGRATION_COMPLETE = 'complete';

const VERIFIED_MARKER_SCHEMA_VERSION = 1;
const sha256Pattern = /^[0-9a-f]{64}$/;
const pristineBuiltInFixtures = createDefaultDiveLogRepository().listSync();

export type LegacyGuestDataMigrationDependencies = {
  metadataStorage: PersistentKeyValueStore;
  profileStorage: WatchProfileStorage;
  now?: () => number;
};

type MetadataKind = 'logbook' | 'planbook';

type MetadataBinding = {
  sourceKey: string;
  targetKey: string;
  sourceCanonicalSha256: string;
  targetCanonicalSha256: string;
};

type ProfileBinding = {
  sourceKey: string;
  targetKey: string;
  contentRevision: string;
  sampleCount: number;
  canonicalSha256: string;
};

type VerifiedMigrationMarker = {
  schemaVersion: 1;
  state: 'verified';
  metadataBindings: MetadataBinding[];
  profileBindings: ProfileBinding[];
};

type MetadataCopy = {
  kind: MetadataKind;
  sourceKey: string;
  targetKey: string;
  schemaVersion: number;
  sourceCanonicalSha256: string;
  entries: DiveLogEntry[] | DivePlan[];
};

type ProfileReferenceBinding = {
  sourceKey: string;
  targetKey: string;
  contentRevision: string;
  sampleCount: number;
  declaredSha256?: string;
};

type ProfileCopy = ProfileBinding & {
  samples: WatchDepthSample[];
  declaredSha256?: string;
};

type PreparedTransformation = {
  metadataCopies: MetadataCopy[];
  profileCopies: ProfileCopy[];
};

type LegacyProfileIdentity = {
  localSessionId: string;
  contentRevision: string;
};

export async function migrateLegacyGuestData(
  dependencies: LegacyGuestDataMigrationDependencies,
): Promise<void> {
  return withLegacyDataMigrationLock(() => migrateLegacyGuestDataUnlocked(dependencies));
}

async function migrateLegacyGuestDataUnlocked(
  dependencies: LegacyGuestDataMigrationDependencies,
): Promise<void> {
  const { metadataStorage, profileStorage } = dependencies;
  const rawMarker = await metadataStorage.getString(LEGACY_GUEST_MIGRATION_MARKER_KEY);

  if (rawMarker === LEGACY_GUEST_MIGRATION_COMPLETE) {
    return;
  }

  if (rawMarker !== undefined) {
    const marker = parseVerifiedMarker(rawMarker);
    const verifiedSources = await verifyMarkedTransformation(marker, metadataStorage, profileStorage);
    await cleanupLegacySources(marker, metadataStorage, profileStorage, verifiedSources);
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

  const transformation = await prepareTransformation(
    rawLegacyLogbook,
    rawLegacyPlanbook,
    profileStorage,
  );
  await verifyExistingTargets(transformation.metadataCopies, metadataStorage);
  await copyAndVerifyProfiles(transformation.profileCopies, profileStorage);

  const now = dependencies.now ?? getCurrentTimestampSeconds;
  for (const copy of transformation.metadataCopies) {
    if (await metadataStorage.getString(copy.targetKey) === undefined) {
      await writeEnvelope(metadataStorage, copy.targetKey, copy.schemaVersion, copy.entries, now());
    }
  }

  await verifyMetadataReadback(transformation.metadataCopies, metadataStorage);
  await verifyProfileReadback(transformation.profileCopies, profileStorage);

  const generatedMarker = await createVerifiedMarker(transformation, metadataStorage);
  const marker = parseVerifiedMarker(JSON.stringify(generatedMarker));
  await metadataStorage.setString(LEGACY_GUEST_MIGRATION_MARKER_KEY, JSON.stringify(marker));
  await verifyInitialCleanupAuthority(marker, transformation, metadataStorage);
  await cleanupLegacySources(marker, metadataStorage, profileStorage, {
    metadataKeys: new Set(transformation.metadataCopies.map(copy => copy.sourceKey)),
    profileKeys: new Set(transformation.profileCopies.map(copy => copy.sourceKey)),
  });
  await metadataStorage.setString(LEGACY_GUEST_MIGRATION_MARKER_KEY, LEGACY_GUEST_MIGRATION_COMPLETE);
}

async function prepareTransformation(
  rawLegacyLogbook: string | undefined,
  rawLegacyPlanbook: string | undefined,
  profileStorage: WatchProfileStorage,
): Promise<PreparedTransformation> {
  const guestKeys = dataStorageKeys({ kind: 'guest' });
  const legacyLogs = rawLegacyLogbook === undefined
    ? undefined
    : parseDiveLogbookEnvelope(rawLegacyLogbook, mobileStorageKeys.logbook)
      .filter(entry => !isBuiltInDemoFixture(entry));
  const legacyPlans = rawLegacyPlanbook === undefined
    ? undefined
    : parseDivePlanbookEnvelope(rawLegacyPlanbook, mobileStorageKeys.planbook);
  const profileCopies = await collectProfileCopies(legacyLogs ?? [], profileStorage);
  const copiesBySourceKey = new Map(profileCopies.map(copy => [copy.sourceKey, copy]));
  const guestLogs = legacyLogs?.map(entry => rewriteGuestLog(entry, copiesBySourceKey));
  const guestPlans = legacyPlans?.map(toGuestPlan);
  const metadataCopies: MetadataCopy[] = [];

  if (guestLogs !== undefined && rawLegacyLogbook !== undefined) {
    metadataCopies.push({
      kind: 'logbook',
      sourceKey: mobileStorageKeys.logbook,
      targetKey: guestKeys.logbook,
      schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
      sourceCanonicalSha256: canonicalSha256(rawLegacyLogbook),
      entries: guestLogs,
    });
  }
  if (guestPlans !== undefined && rawLegacyPlanbook !== undefined) {
    metadataCopies.push({
      kind: 'planbook',
      sourceKey: mobileStorageKeys.planbook,
      targetKey: guestKeys.planbook,
      schemaVersion: DIVE_PLANBOOK_SCHEMA_VERSION,
      sourceCanonicalSha256: canonicalSha256(rawLegacyPlanbook),
      entries: guestPlans,
    });
  }

  return { metadataCopies, profileCopies };
}

async function collectProfileCopies(
  entries: DiveLogEntry[],
  profileStorage: WatchProfileStorage,
): Promise<ProfileCopy[]> {
  const copies: ProfileCopy[] = [];

  for (const reference of collectProfileReferences(entries)) {
    const identity = requiredLegacyProfileIdentity(reference.sourceKey);
    const storedSamples = await profileStorage.read(reference.sourceKey);
    const validatedSamples = assertValidProfile(storedSamples, reference.sourceKey, identity.localSessionId);
    if (validatedSamples.length !== reference.sampleCount) {
      throw new Error(`Legacy profile sample count mismatch for ${reference.sourceKey}`);
    }
    const canonicalSamples = canonicalStringify(validatedSamples);
    copies.push({
      ...reference,
      sampleCount: validatedSamples.length,
      canonicalSha256: sha256Hex(canonicalSamples),
      samples: cloneSamples(validatedSamples),
    });
  }

  return copies;
}

function collectProfileReferences(entries: DiveLogEntry[]): ProfileReferenceBinding[] {
  const references = new Map<string, ProfileReferenceBinding>();

  for (const entry of entries) {
    const reference = entry.watchCapture?.profile;
    if (!reference) {
      continue;
    }

    const identity = parseLegacyProfileKey(reference.storageKey);
    if (!identity) {
      throw new Error(`Legacy profile key is outside the historical namespace: ${reference.storageKey}`);
    }
    if (reference.contentRevision !== identity.contentRevision
      || entry.watchCapture?.session.localSessionId !== identity.localSessionId
      || (reference.sha256 !== undefined && !sha256Pattern.test(reference.sha256))) {
      throw new Error(`Legacy profile reference does not match its storage key: ${reference.storageKey}`);
    }

    const existing = references.get(reference.storageKey);
    if (existing) {
      if (existing.contentRevision !== reference.contentRevision
        || existing.sampleCount !== reference.sampleCount
        || (reference.sha256 !== undefined
          && existing.declaredSha256 !== undefined
          && existing.declaredSha256 !== reference.sha256)) {
        throw new Error(`Conflicting legacy profile references: ${reference.storageKey}`);
      }
      if (existing.declaredSha256 === undefined && reference.sha256 !== undefined) {
        existing.declaredSha256 = reference.sha256;
      }
      continue;
    }

    references.set(reference.storageKey, {
      sourceKey: reference.storageKey,
      targetKey: targetProfileKey(reference.storageKey),
      contentRevision: identity.contentRevision,
      sampleCount: reference.sampleCount,
      declaredSha256: reference.sha256,
    });
  }

  return Array.from(references.values());
}

function rewriteGuestLog(
  entry: DiveLogEntry,
  copies: Map<string, Pick<ProfileCopy, 'targetKey'>>,
): DiveLogEntry {
  const cloned = cloneValue(entry);
  delete cloned.ownerUserId;
  const profile = cloned.watchCapture?.profile;
  if (profile) {
    const copy = copies.get(profile.storageKey);
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

async function verifyExistingTargets(
  copies: MetadataCopy[],
  metadataStorage: PersistentKeyValueStore,
): Promise<void> {
  for (const copy of copies) {
    const rawTarget = await metadataStorage.getString(copy.targetKey);
    if (rawTarget === undefined) {
      continue;
    }
    const actual = parseMetadataEnvelope(copy.kind, rawTarget, copy.targetKey);
    if (!deepEqual(actual, copy.entries)) {
      throw new Error(`Existing guest target does not match resumable copy: ${copy.targetKey}`);
    }
  }
}

async function copyAndVerifyProfiles(copies: ProfileCopy[], profileStorage: WatchProfileStorage): Promise<void> {
  for (const copy of copies) {
    const identity = requiredLegacyProfileIdentity(copy.sourceKey);
    const existing = await profileStorage.read(copy.targetKey);
    if (existing !== undefined) {
      const validated = assertValidProfile(existing, copy.targetKey, identity.localSessionId);
      if (!profileMatchesBinding(validated, copy)) {
        throw new Error(`Existing guest target profile does not match: ${copy.targetKey}`);
      }
      continue;
    }

    await profileStorage.write(copy.targetKey, cloneSamples(copy.samples));
    const readback = assertValidProfile(
      await profileStorage.read(copy.targetKey),
      copy.targetKey,
      identity.localSessionId,
    );
    if (!profileMatchesBinding(readback, copy)) {
      throw new Error(`Guest profile read-back mismatch for ${copy.targetKey}`);
    }
  }
}

async function verifyProfileReadback(copies: ProfileCopy[], profileStorage: WatchProfileStorage): Promise<void> {
  for (const copy of copies) {
    const identity = requiredLegacyProfileIdentity(copy.sourceKey);
    const readback = assertValidProfile(
      await profileStorage.read(copy.targetKey),
      copy.targetKey,
      identity.localSessionId,
    );
    if (!profileMatchesBinding(readback, copy)) {
      throw new Error(`Guest profile read-back mismatch for ${copy.targetKey}`);
    }
  }
}

async function verifyMetadataReadback(
  copies: MetadataCopy[],
  metadataStorage: PersistentKeyValueStore,
): Promise<void> {
  for (const copy of copies) {
    const rawReadback = await metadataStorage.getString(copy.targetKey);
    if (rawReadback === undefined
      || !deepEqual(parseMetadataEnvelope(copy.kind, rawReadback, copy.targetKey), copy.entries)) {
      throw new Error(`Guest metadata read-back mismatch for ${copy.targetKey}`);
    }
  }
}

async function createVerifiedMarker(
  transformation: PreparedTransformation,
  metadataStorage: PersistentKeyValueStore,
): Promise<VerifiedMigrationMarker> {
  const metadataBindings: MetadataBinding[] = [];
  for (const copy of transformation.metadataCopies) {
    const rawTarget = await metadataStorage.getString(copy.targetKey);
    if (rawTarget === undefined) {
      throw new Error(`Verified guest target is missing: ${copy.targetKey}`);
    }
    parseMetadataEnvelope(copy.kind, rawTarget, copy.targetKey);
    metadataBindings.push({
      sourceKey: copy.sourceKey,
      targetKey: copy.targetKey,
      sourceCanonicalSha256: copy.sourceCanonicalSha256,
      targetCanonicalSha256: canonicalSha256(rawTarget),
    });
  }

  return {
    schemaVersion: VERIFIED_MARKER_SCHEMA_VERSION,
    state: 'verified',
    metadataBindings,
    profileBindings: transformation.profileCopies.map(copy => ({
      sourceKey: copy.sourceKey,
      targetKey: copy.targetKey,
      contentRevision: copy.contentRevision,
      sampleCount: copy.sampleCount,
      canonicalSha256: copy.canonicalSha256,
    })),
  };
}

async function verifyInitialCleanupAuthority(
  marker: VerifiedMigrationMarker,
  transformation: PreparedTransformation,
  metadataStorage: PersistentKeyValueStore,
): Promise<void> {
  const bindingsBySource = new Map(marker.metadataBindings.map(binding => [binding.sourceKey, binding]));
  for (const copy of transformation.metadataCopies) {
    const binding = bindingsBySource.get(copy.sourceKey);
    const rawSource = await metadataStorage.getString(copy.sourceKey);
    if (!binding || rawSource === undefined) {
      throw new Error(`Exact legacy source metadata is required for cleanup: ${copy.sourceKey}`);
    }
    parseMetadataEnvelope(copy.kind, rawSource, copy.sourceKey);
    if (canonicalSha256(rawSource) !== binding.sourceCanonicalSha256
      || binding.sourceCanonicalSha256 !== copy.sourceCanonicalSha256) {
      throw new Error(`Legacy source metadata digest changed before cleanup: ${copy.sourceKey}`);
    }
  }
  if (!profileCopiesMatchBindings(transformation.profileCopies, marker.profileBindings)) {
    throw new Error('Legacy source-to-target profile transformation diverged');
  }
}

function parseVerifiedMarker(rawMarker: string): VerifiedMigrationMarker {
  const parsed = parseJson(rawMarker, 'legacy guest migration marker');
  if (!isRecord(parsed)
    || !hasOnlyKeys(parsed, ['schemaVersion', 'state', 'metadataBindings', 'profileBindings'])
    || parsed.schemaVersion !== VERIFIED_MARKER_SCHEMA_VERSION
    || parsed.state !== 'verified'
    || !Array.isArray(parsed.metadataBindings)
    || parsed.metadataBindings.length === 0
    || parsed.metadataBindings.length > 2
    || !Array.isArray(parsed.profileBindings)) {
    throw new Error('Malformed legacy guest migration marker');
  }

  const metadataBindings = parsed.metadataBindings.map(parseMetadataBinding);
  const profileBindings = parsed.profileBindings.map(parseProfileBinding);
  if (!hasUniqueValues(metadataBindings.map(binding => binding.sourceKey))
    || !hasUniqueValues(metadataBindings.map(binding => binding.targetKey))
    || !hasUniqueValues(profileBindings.map(binding => binding.sourceKey))
    || !hasUniqueValues(profileBindings.map(binding => binding.targetKey))) {
    throw new Error('Malformed legacy guest migration marker');
  }

  return {
    schemaVersion: VERIFIED_MARKER_SCHEMA_VERSION,
    state: 'verified',
    metadataBindings,
    profileBindings,
  };
}

function parseMetadataBinding(value: unknown): MetadataBinding {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'sourceKey',
      'targetKey',
      'sourceCanonicalSha256',
      'targetCanonicalSha256',
    ])
    || typeof value.sourceKey !== 'string'
    || typeof value.targetKey !== 'string'
    || typeof value.sourceCanonicalSha256 !== 'string'
    || !sha256Pattern.test(value.sourceCanonicalSha256)
    || typeof value.targetCanonicalSha256 !== 'string'
    || !sha256Pattern.test(value.targetCanonicalSha256)) {
    throw new Error('Malformed legacy guest migration marker');
  }

  const kind = metadataKindForSourceKey(value.sourceKey);
  if (!kind || value.targetKey !== targetMetadataKey(kind)) {
    throw new Error('Malformed legacy guest migration marker');
  }

  return {
    sourceKey: value.sourceKey,
    targetKey: value.targetKey,
    sourceCanonicalSha256: value.sourceCanonicalSha256,
    targetCanonicalSha256: value.targetCanonicalSha256,
  };
}

function parseProfileBinding(value: unknown): ProfileBinding {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'sourceKey',
      'targetKey',
      'contentRevision',
      'sampleCount',
      'canonicalSha256',
    ])
    || typeof value.sourceKey !== 'string'
    || typeof value.targetKey !== 'string'
    || typeof value.contentRevision !== 'string'
    || !Number.isSafeInteger(value.sampleCount)
    || (value.sampleCount as number) < 0
    || typeof value.canonicalSha256 !== 'string'
    || !sha256Pattern.test(value.canonicalSha256)) {
    throw new Error('Malformed legacy guest migration marker');
  }
  const identity = parseLegacyProfileKey(value.sourceKey);
  if (!identity
    || identity.contentRevision !== value.contentRevision
    || value.targetKey !== targetProfileKey(value.sourceKey)) {
    throw new Error('Malformed legacy guest migration marker');
  }

  return {
    sourceKey: value.sourceKey,
    targetKey: value.targetKey,
    contentRevision: value.contentRevision,
    sampleCount: value.sampleCount as number,
    canonicalSha256: value.canonicalSha256,
  };
}

function validateTargetProfileReferences(
  targetEntries: Map<string, DiveLogEntry[] | DivePlan[]>,
  profileBindings: ProfileBinding[],
): void {
  const references: NonNullable<DiveLogEntry['watchCapture']>['profile'][] = [];
  const entries = targetEntries.get(mobileStorageKeys.logbook);
  if (entries) {
    for (const entry of entries) {
      if ('source' in entry && entry.watchCapture?.profile) {
        references.push(entry.watchCapture.profile);
      }
    }
  }

  const bindingsByTarget = new Map(profileBindings.map(binding => [binding.targetKey, binding]));
  for (const reference of references) {
    const binding = reference ? bindingsByTarget.get(reference.storageKey) : undefined;
    if (!reference
      || !binding
      || reference.contentRevision !== binding.contentRevision
      || reference.sampleCount !== binding.sampleCount) {
      throw new Error('Malformed legacy guest migration marker profile references');
    }
  }
  if (!sameStringSet(
    Array.from(new Set(references.flatMap(reference => reference ? [reference.storageKey] : []))),
    profileBindings.map(binding => binding.targetKey),
  )) {
    throw new Error('Malformed legacy guest migration marker profile references');
  }
}

function prepareResumeTransformation(
  rawLegacyLogbook: string | undefined,
  rawLegacyPlanbook: string | undefined,
  profileBindings: ProfileBinding[],
): MetadataCopy[] {
  const guestKeys = dataStorageKeys({ kind: 'guest' });
  const legacyLogs = rawLegacyLogbook === undefined
    ? undefined
    : parseDiveLogbookEnvelope(rawLegacyLogbook, mobileStorageKeys.logbook)
      .filter(entry => !isBuiltInDemoFixture(entry));
  const legacyPlans = rawLegacyPlanbook === undefined
    ? undefined
    : parseDivePlanbookEnvelope(rawLegacyPlanbook, mobileStorageKeys.planbook);
  const references = collectProfileReferences(legacyLogs ?? []);
  if (rawLegacyLogbook !== undefined && !profileReferencesMatchBindings(references, profileBindings)) {
    throw new Error('Legacy source-to-target profile transformation diverged');
  }

  const copiesBySourceKey = new Map(profileBindings.map(binding => [binding.sourceKey, binding]));
  const metadataCopies: MetadataCopy[] = [];
  if (legacyLogs !== undefined && rawLegacyLogbook !== undefined) {
    metadataCopies.push({
      kind: 'logbook',
      sourceKey: mobileStorageKeys.logbook,
      targetKey: guestKeys.logbook,
      schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
      sourceCanonicalSha256: canonicalSha256(rawLegacyLogbook),
      entries: legacyLogs.map(entry => rewriteGuestLog(entry, copiesBySourceKey)),
    });
  }
  if (legacyPlans !== undefined && rawLegacyPlanbook !== undefined) {
    metadataCopies.push({
      kind: 'planbook',
      sourceKey: mobileStorageKeys.planbook,
      targetKey: guestKeys.planbook,
      schemaVersion: DIVE_PLANBOOK_SCHEMA_VERSION,
      sourceCanonicalSha256: canonicalSha256(rawLegacyPlanbook),
      entries: legacyPlans.map(toGuestPlan),
    });
  }
  return metadataCopies;
}

async function verifyMarkedTransformation(
  marker: VerifiedMigrationMarker,
  metadataStorage: PersistentKeyValueStore,
  profileStorage: WatchProfileStorage,
): Promise<{ metadataKeys: Set<string>; profileKeys: Set<string> }> {
  const actualTargetEntries = new Map<string, DiveLogEntry[] | DivePlan[]>();
  for (const binding of marker.metadataBindings) {
    const kind = requiredMetadataKind(binding.sourceKey);
    const rawTarget = await metadataStorage.getString(binding.targetKey);
    if (rawTarget === undefined) {
      throw new Error(`Verified guest target is missing: ${binding.targetKey}`);
    }
    const entries = parseMetadataEnvelope(kind, rawTarget, binding.targetKey);
    if (canonicalSha256(rawTarget) !== binding.targetCanonicalSha256) {
      throw new Error(`Verified guest target digest was modified: ${binding.targetKey}`);
    }
    actualTargetEntries.set(binding.sourceKey, entries);
  }

  for (const binding of marker.profileBindings) {
    const identity = requiredLegacyProfileIdentity(binding.sourceKey);
    const targetSamples = assertValidProfile(
      await profileStorage.read(binding.targetKey),
      binding.targetKey,
      identity.localSessionId,
    );
    if (!profileMatchesBinding(targetSamples, binding)) {
      throw new Error(`Verified guest target profile was modified: ${binding.targetKey}`);
    }
  }
  validateTargetProfileReferences(actualTargetEntries, marker.profileBindings);

  const [rawLegacyLogbook, rawLegacyPlanbook] = await Promise.all([
    metadataStorage.getString(mobileStorageKeys.logbook),
    metadataStorage.getString(mobileStorageKeys.planbook),
  ]);
  const existingSourceKeys = [
    ...(rawLegacyLogbook === undefined ? [] : [mobileStorageKeys.logbook]),
    ...(rawLegacyPlanbook === undefined ? [] : [mobileStorageKeys.planbook]),
  ];
  const markerSourceKeys = marker.metadataBindings.map(binding => binding.sourceKey);
  if (existingSourceKeys.some(key => !markerSourceKeys.includes(key))) {
    throw new Error('Verified marker does not bind every existing legacy source');
  }

  if (existingSourceKeys.length > 0) {
    const expected = prepareResumeTransformation(
      rawLegacyLogbook,
      rawLegacyPlanbook,
      marker.profileBindings,
    );
    const bindingsBySource = new Map(marker.metadataBindings.map(binding => [binding.sourceKey, binding]));
    for (const copy of expected) {
      const actual = actualTargetEntries.get(copy.sourceKey);
      const binding = bindingsBySource.get(copy.sourceKey);
      if (!binding
        || copy.sourceCanonicalSha256 !== binding.sourceCanonicalSha256
        || !actual
        || !deepEqual(actual, copy.entries)) {
        throw new Error(`Legacy source-to-target transformation diverged: ${copy.sourceKey}`);
      }
    }
  }

  const existingProfileKeys = new Set<string>();
  for (const binding of marker.profileBindings) {
    const sourceSamples = await profileStorage.read(binding.sourceKey);
    if (sourceSamples === undefined) {
      continue;
    }
    if (rawLegacyLogbook === undefined) {
      throw new Error('Exact legacy source logbook is required to authorize profile cleanup');
    }
    const identity = requiredLegacyProfileIdentity(binding.sourceKey);
    const validated = assertValidProfile(sourceSamples, binding.sourceKey, identity.localSessionId);
    if (!profileMatchesBinding(validated, binding)) {
      throw new Error(`Verified legacy source profile diverged: ${binding.sourceKey}`);
    }
    existingProfileKeys.add(binding.sourceKey);
  }

  return {
    metadataKeys: new Set(existingSourceKeys),
    profileKeys: existingProfileKeys,
  };
}

async function cleanupLegacySources(
  marker: VerifiedMigrationMarker,
  metadataStorage: PersistentKeyValueStore,
  profileStorage: WatchProfileStorage,
  knownExisting?: { metadataKeys: Set<string>; profileKeys: Set<string> },
): Promise<void> {
  for (const binding of marker.profileBindings) {
    const exists = knownExisting
      ? knownExisting.profileKeys.has(binding.sourceKey)
      : await profileStorage.read(binding.sourceKey) !== undefined;
    if (exists) {
      await profileStorage.remove(binding.sourceKey);
    }
  }
  for (const binding of marker.metadataBindings) {
    const exists = knownExisting
      ? knownExisting.metadataKeys.has(binding.sourceKey)
      : await metadataStorage.getString(binding.sourceKey) !== undefined;
    if (exists) {
      await metadataStorage.remove(binding.sourceKey);
    }
  }
}

function parseLegacyProfileKey(storageKey: string): LegacyProfileIdentity | undefined {
  if (!storageKey.startsWith(DEFAULT_WATCH_PROFILE_KEY_PREFIX)) {
    return undefined;
  }
  const suffix = storageKey.slice(DEFAULT_WATCH_PROFILE_KEY_PREFIX.length);
  const segments = suffix.split(':');
  if (segments.length !== 2 || segments.some(segment => segment.length === 0)) {
    return undefined;
  }

  let localSessionId: string;
  let contentRevision: string;
  try {
    localSessionId = decodeURIComponent(segments[0]);
    contentRevision = decodeURIComponent(segments[1]);
  } catch {
    return undefined;
  }
  if (localSessionId.length === 0
    || contentRevision.length === 0
    || encodeURIComponent(localSessionId) !== segments[0]
    || encodeURIComponent(contentRevision) !== segments[1]
    || localSessionId === 'guest'
    || localSessionId.startsWith('guest:')
    || localSessionId === 'user'
    || localSessionId.startsWith('user:')
    || storageKey !== legacyProfileKey(localSessionId, contentRevision)) {
    return undefined;
  }
  return { localSessionId, contentRevision };
}

function requiredLegacyProfileIdentity(storageKey: string): LegacyProfileIdentity {
  const identity = parseLegacyProfileKey(storageKey);
  if (!identity) {
    throw new Error(`Malformed legacy profile namespace: ${storageKey}`);
  }
  return identity;
}

function legacyProfileKey(localSessionId: string, contentRevision: string): string {
  return `${DEFAULT_WATCH_PROFILE_KEY_PREFIX}${encodeURIComponent(localSessionId)}:${encodeURIComponent(contentRevision)}`;
}

function targetProfileKey(sourceKey: string): string {
  return `${dataProfileKeyPrefix({ kind: 'guest' })}${encodeURIComponent(sourceKey)}`;
}

function metadataKindForSourceKey(sourceKey: string): MetadataKind | undefined {
  if (sourceKey === mobileStorageKeys.logbook) {
    return 'logbook';
  }
  if (sourceKey === mobileStorageKeys.planbook) {
    return 'planbook';
  }
  return undefined;
}

function requiredMetadataKind(sourceKey: string): MetadataKind {
  const kind = metadataKindForSourceKey(sourceKey);
  if (!kind) {
    throw new Error(`Unexpected legacy metadata key: ${sourceKey}`);
  }
  return kind;
}

function targetMetadataKey(kind: MetadataKind): string {
  const guestKeys = dataStorageKeys({ kind: 'guest' });
  return kind === 'logbook' ? guestKeys.logbook : guestKeys.planbook;
}

function parseMetadataEnvelope(
  kind: MetadataKind,
  rawValue: string,
  storageKey: string,
): DiveLogEntry[] | DivePlan[] {
  return kind === 'logbook'
    ? parseDiveLogbookEnvelope(rawValue, storageKey)
    : parseDivePlanbookEnvelope(rawValue, storageKey);
}

function assertValidProfile(
  value: unknown,
  storageKey: string,
  expectedLocalSessionId: string,
): WatchDepthSample[] {
  const result = parseWatchSyncMessageValue({
    type: 'sessionEnded',
    session: {
      localSessionId: expectedLocalSessionId,
      startedAt: Array.isArray(value) && isRecord(value[0]) && isFiniteNumber(value[0].timestamp)
        ? value[0].timestamp
        : 0,
      samples: value,
    },
  });
  if (!result.ok
    || result.message.session.samples.some(sample => sample.localSessionId !== expectedLocalSessionId)) {
    throw new Error(`Legacy profile is missing or malformed: ${storageKey}`);
  }
  return result.message.session.samples;
}

function profileMatchesBinding(
  samples: WatchDepthSample[],
  binding: Pick<ProfileBinding, 'sampleCount' | 'canonicalSha256'>,
): boolean {
  return samples.length === binding.sampleCount
    && sha256Hex(canonicalStringify(samples)) === binding.canonicalSha256;
}

function profileReferencesMatchBindings(
  references: ProfileReferenceBinding[],
  bindings: ProfileBinding[],
): boolean {
  if (references.length !== bindings.length) {
    return false;
  }
  const bindingsBySource = new Map(bindings.map(binding => [binding.sourceKey, binding]));
  return references.every(reference => {
    const binding = bindingsBySource.get(reference.sourceKey);
    return binding !== undefined
      && binding.targetKey === reference.targetKey
      && binding.contentRevision === reference.contentRevision
      && binding.sampleCount === reference.sampleCount;
  });
}

function profileCopiesMatchBindings(copies: ProfileCopy[], bindings: ProfileBinding[]): boolean {
  if (copies.length !== bindings.length) {
    return false;
  }
  const bindingsBySource = new Map(bindings.map(binding => [binding.sourceKey, binding]));
  return copies.every(copy => {
    const binding = bindingsBySource.get(copy.sourceKey);
    return binding !== undefined
      && binding.targetKey === copy.targetKey
      && binding.contentRevision === copy.contentRevision
      && binding.sampleCount === copy.sampleCount
      && binding.canonicalSha256 === copy.canonicalSha256;
  });
}

async function writeEnvelope<T>(
  storage: PersistentKeyValueStore,
  key: string,
  schemaVersion: number,
  value: T,
  updatedAt: number,
): Promise<void> {
  await storage.setString(key, JSON.stringify({ schemaVersion, updatedAt, value }));
}

function parseJson(rawValue: string, label: string): unknown {
  try {
    return JSON.parse(rawValue) as unknown;
  } catch {
    throw new Error(`Malformed JSON for ${label}`);
  }
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

function canonicalSha256(rawValue: string): string {
  return sha256Hex(canonicalStringify(parseJson(rawValue, 'canonical digest input')));
}

function toCanonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot canonicalize a non-finite number');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => item === undefined ? null : toCanonicalJsonValue(item));
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        result[key] = toCanonicalJsonValue(value[key]);
      }
    }
    return result;
  }
  throw new Error('Cannot canonicalize a non-JSON value');
}

function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
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

function hasUniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value));
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(record).every(key => allowedKeys.includes(key));
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
  return pristineBuiltInFixtures.some(fixture => deepEqual(entry, fixture));
}
