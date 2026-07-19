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
  targetCanonicalJson: string;
  targetSha256: string;
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
  entries: DiveLogEntry[] | DivePlan[];
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

  if (guestLogs !== undefined) {
    metadataCopies.push({
      kind: 'logbook',
      sourceKey: mobileStorageKeys.logbook,
      targetKey: guestKeys.logbook,
      schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
      entries: guestLogs,
    });
  }
  if (guestPlans !== undefined) {
    metadataCopies.push({
      kind: 'planbook',
      sourceKey: mobileStorageKeys.planbook,
      targetKey: guestKeys.planbook,
      schemaVersion: DIVE_PLANBOOK_SCHEMA_VERSION,
      entries: guestPlans,
    });
  }

  return { metadataCopies, profileCopies };
}

async function collectProfileCopies(
  entries: DiveLogEntry[],
  profileStorage: WatchProfileStorage,
): Promise<ProfileCopy[]> {
  const copies = new Map<string, ProfileCopy>();

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

    const existing = copies.get(reference.storageKey);
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

    const samples = await profileStorage.read(reference.storageKey);
    const validatedSamples = assertValidProfile(samples, reference.storageKey, identity.localSessionId);
    if (validatedSamples.length !== reference.sampleCount) {
      throw new Error(`Legacy profile sample count mismatch for ${reference.storageKey}`);
    }
    const canonicalSamples = canonicalStringify(validatedSamples);
    copies.set(reference.storageKey, {
      sourceKey: reference.storageKey,
      targetKey: targetProfileKey(reference.storageKey),
      contentRevision: identity.contentRevision,
      sampleCount: validatedSamples.length,
      canonicalSha256: sha256Hex(canonicalSamples),
      samples: cloneSamples(validatedSamples),
      declaredSha256: reference.sha256,
    });
  }

  return Array.from(copies.values());
}

function rewriteGuestLog(entry: DiveLogEntry, copies: Map<string, ProfileCopy>): DiveLogEntry {
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
    const targetCanonicalJson = canonicalStringify(parseJson(rawTarget, copy.targetKey));
    metadataBindings.push({
      sourceKey: copy.sourceKey,
      targetKey: copy.targetKey,
      targetCanonicalJson,
      targetSha256: sha256Hex(targetCanonicalJson),
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

  validateMarkerProfileReferences(metadataBindings, profileBindings);
  return {
    schemaVersion: VERIFIED_MARKER_SCHEMA_VERSION,
    state: 'verified',
    metadataBindings,
    profileBindings,
  };
}

function parseMetadataBinding(value: unknown): MetadataBinding {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['sourceKey', 'targetKey', 'targetCanonicalJson', 'targetSha256'])
    || typeof value.sourceKey !== 'string'
    || typeof value.targetKey !== 'string'
    || typeof value.targetCanonicalJson !== 'string'
    || typeof value.targetSha256 !== 'string'
    || !sha256Pattern.test(value.targetSha256)) {
    throw new Error('Malformed legacy guest migration marker');
  }

  const kind = metadataKindForSourceKey(value.sourceKey);
  if (!kind || value.targetKey !== targetMetadataKey(kind)) {
    throw new Error('Malformed legacy guest migration marker');
  }
  const canonicalValue = parseJson(value.targetCanonicalJson, value.targetKey);
  if (canonicalStringify(canonicalValue) !== value.targetCanonicalJson
    || sha256Hex(value.targetCanonicalJson) !== value.targetSha256) {
    throw new Error('Malformed legacy guest migration marker');
  }
  parseMetadataEnvelope(kind, value.targetCanonicalJson, value.targetKey);

  return {
    sourceKey: value.sourceKey,
    targetKey: value.targetKey,
    targetCanonicalJson: value.targetCanonicalJson,
    targetSha256: value.targetSha256,
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

function validateMarkerProfileReferences(
  metadataBindings: MetadataBinding[],
  profileBindings: ProfileBinding[],
): void {
  const logbookBinding = metadataBindings.find(binding => binding.sourceKey === mobileStorageKeys.logbook);
  const references: NonNullable<DiveLogEntry['watchCapture']>['profile'][] = [];
  if (logbookBinding) {
    const entries = parseDiveLogbookEnvelope(logbookBinding.targetCanonicalJson, logbookBinding.targetKey);
    for (const entry of entries) {
      if (entry.watchCapture?.profile) {
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
    const canonicalTarget = canonicalStringify(parseJson(rawTarget, binding.targetKey));
    if (canonicalTarget !== binding.targetCanonicalJson
      || sha256Hex(canonicalTarget) !== binding.targetSha256) {
      throw new Error(`Verified guest target was modified: ${binding.targetKey}`);
    }
    actualTargetEntries.set(
      binding.sourceKey,
      parseMetadataEnvelope(kind, rawTarget, binding.targetKey),
    );
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

  let preparedSourceProfiles = new Map<string, ProfileCopy>();
  if (existingSourceKeys.length > 0) {
    const expected = await prepareTransformation(rawLegacyLogbook, rawLegacyPlanbook, profileStorage);
    for (const copy of expected.metadataCopies) {
      const actual = actualTargetEntries.get(copy.sourceKey);
      if (!actual || !deepEqual(actual, copy.entries)) {
        throw new Error(`Legacy source-to-target transformation diverged: ${copy.sourceKey}`);
      }
    }
    if (rawLegacyLogbook !== undefined
      && !profileCopiesMatchBindings(expected.profileCopies, marker.profileBindings)) {
      throw new Error('Legacy source-to-target profile transformation diverged');
    }
    preparedSourceProfiles = new Map(expected.profileCopies.map(copy => [copy.sourceKey, copy]));
  }

  const existingProfileKeys = new Set<string>();
  for (const binding of marker.profileBindings) {
    if (preparedSourceProfiles.has(binding.sourceKey)) {
      existingProfileKeys.add(binding.sourceKey);
      continue;
    }
    const sourceSamples = await profileStorage.read(binding.sourceKey);
    if (sourceSamples === undefined) {
      continue;
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
  for (const binding of marker.metadataBindings) {
    if (knownExisting?.metadataKeys.has(binding.sourceKey)
      || await metadataStorage.getString(binding.sourceKey) !== undefined) {
      await metadataStorage.remove(binding.sourceKey);
    }
  }
  for (const binding of marker.profileBindings) {
    if (knownExisting?.profileKeys.has(binding.sourceKey)
      || await profileStorage.read(binding.sourceKey) !== undefined) {
      await profileStorage.remove(binding.sourceKey);
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

/* eslint-disable no-bitwise -- SHA-256 is defined in terms of 32-bit word operations. */
function sha256Hex(value: string): string {
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) {
    bytes.push((high >>> shift) & 0xff);
  }
  for (let shift = 24; shift >= 0; shift -= 8) {
    bytes.push((low >>> shift) & 0xff);
  }

  const hash = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const byteOffset = offset + index * 4;
      words[index] = (
        (bytes[byteOffset] << 24)
        | (bytes[byteOffset + 1] << 16)
        | (bytes[byteOffset + 2] << 8)
        | bytes[byteOffset + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const sigma0 = rotateRight(words[index - 15], 7)
        ^ rotateRight(words[index - 15], 18)
        ^ (words[index - 15] >>> 3);
      const sigma1 = rotateRight(words[index - 2], 17)
        ^ rotateRight(words[index - 2], 19)
        ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map(word => word.toString(16).padStart(8, '0')).join('');
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}
/* eslint-enable no-bitwise */

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
