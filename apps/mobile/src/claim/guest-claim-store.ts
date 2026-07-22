import type { RemoteDiveLog, RemoteDivePlan } from '@repo/supabase';

import type { DiveLogRepository } from '../repositories/dive-log-repository';
import {
  DIVE_LOGBOOK_SCHEMA_VERSION,
  parseDiveLogbookEnvelope,
} from '../repositories/persistent-dive-log-repository';
import type { DivePlanRepository } from '../repositories/dive-plan-repository';
import {
  DIVE_PLANBOOK_SCHEMA_VERSION,
  parseDivePlanbookEnvelope,
} from '../repositories/persistent-dive-plan-repository';
import {
  dataProfileKeyPrefix,
  dataStorageKeys,
} from '../storage/data-principal';
import type { PersistentKeyValueStore } from '../storage/persistent-key-value-store';
import type { WatchProfileStorage } from '../storage/watch-profile-storage';
import {
  canonicalAccountPayloadSha256,
  createAccountRemoteLog,
  createAccountRemotePlan,
} from '../sync/account-payload';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DivePlan } from '../types/dive-plan';
import {
  createProfileBytesSnapshot,
  encodeUtf8,
  GuestClaimProfileError,
  sha256BytesHex,
  verifyProfileBytesSnapshot,
} from './profile-bytes';
import type {
  GuestClaimErrorCode,
  GuestClaimFailureDetail,
  GuestClaimItem,
  GuestClaimManifest,
  GuestClaimRetainedItem,
  GuestClaimRetainedReason,
} from './guest-claim-types';

const SIDECAR_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const errorCodes = new Set<GuestClaimErrorCode>([
  'network_unavailable',
  'session_expired',
  'profile_missing',
  'profile_corrupt',
  'relationship_invalid',
  'remote_conflict',
  'claim_validation_failed',
]);

export type GuestClaimProfileReadback = {
  path: string;
  byteCount: number;
  sha256: string;
  sampleCount: number;
  verifiedAt: number;
};

export type GuestClaimSnapshotItem = {
  key: string;
  entityKind: 'plan' | 'log';
  payloadBytes: string;
  localRecordBytes: string;
  localRecordSha256: string;
  label?: string;
  profileBytes?: string;
  profileReadback?: GuestClaimProfileReadback;
};

export type GuestClaimSnapshot = {
  schemaVersion: 1;
  userId: string;
  manifest: GuestClaimManifest;
  snapshots: GuestClaimSnapshotItem[];
  retainedItems: GuestClaimRetainedItem[];
  errorCode?: GuestClaimErrorCode;
  failure?: GuestClaimFailureDetail;
};

export type GuestClaimStoreLike = {
  read(): Promise<GuestClaimSnapshot | undefined>;
  write(snapshot: GuestClaimSnapshot): Promise<void>;
  remove?(): Promise<void>;
};

export class GuestClaimStorageError extends Error {
  constructor(message = 'Malformed guest claim storage') {
    super(message);
    this.name = 'GuestClaimStorageError';
  }
}

export class GuestClaimPreparationError extends Error {
  constructor(
    readonly code: GuestClaimErrorCode,
    readonly failure?: GuestClaimFailureDetail,
  ) {
    super(code);
    this.name = 'GuestClaimPreparationError';
  }
}

export class GuestClaimStore implements GuestClaimStoreLike {
  private readonly key: string;

  constructor(
    private readonly options: {
      storage: PersistentKeyValueStore;
      userId: string;
      now?: () => number;
    },
  ) {
    this.key = dataStorageKeys({ kind: 'user', userId: options.userId }).claim;
  }

  async read(): Promise<GuestClaimSnapshot | undefined> {
    const raw = await this.options.storage.getString(this.key);
    if (raw === undefined) {
      return undefined;
    }
    return parseStoredSnapshot(raw, this.options.userId);
  }

  async write(snapshot: GuestClaimSnapshot): Promise<void> {
    if (snapshot.userId !== this.options.userId) {
      throw new GuestClaimStorageError('Guest claim user mismatch');
    }
    const parsed = parseStoredSnapshot(
      JSON.stringify(snapshot),
      this.options.userId,
    );
    await this.options.storage.setString(this.key, JSON.stringify(parsed));
  }

  async remove(): Promise<void> {
    await this.options.storage.remove(this.key);
  }
}

export async function createGuestClaimSnapshot(options: {
  userId: string;
  logbookRepository: DiveLogRepository;
  planRepository: DivePlanRepository;
  profileStorage: WatchProfileStorage;
  now?: () => number;
}): Promise<GuestClaimSnapshot> {
  const now = options.now ?? (() => Date.now() / 1_000);
  const [sourcePlans, sourceLogs] = await Promise.all([
    options.planRepository.list(),
    options.logbookRepository.list(),
  ]);
  const plans = sourcePlans
    .map(cloneJson)
    .sort((left, right) => left.localId.localeCompare(right.localId));
  const logs = sourceLogs
    .map(cloneJson)
    .sort((left, right) => left.localId.localeCompare(right.localId));
  const relationships = validateRelationships(plans, logs);
  const items: GuestClaimItem[] = [];
  const snapshots: GuestClaimSnapshotItem[] = [];
  const preparedLogs = new Map<
    string,
    Awaited<ReturnType<typeof prepareLogSnapshot>>
  >();
  const retainedLogReasons = new Map<
    string,
    Extract<GuestClaimRetainedReason, 'profile_missing' | 'profile_corrupt'>
  >();

  for (const sourceLog of logs) {
    try {
      preparedLogs.set(
        sourceLog.localId,
        await prepareLogSnapshot(sourceLog, options.profileStorage),
      );
    } catch (error) {
      if (
        error instanceof GuestClaimProfileError &&
        (error.code === 'profile_missing' || error.code === 'profile_corrupt')
      ) {
        retainedLogReasons.set(sourceLog.localId, error.code);
        continue;
      }
      if (error instanceof GuestClaimPreparationError) {
        throw new GuestClaimPreparationError(
          error.code,
          error.failure ?? claimFailureDetail('checking', sourceLog),
        );
      }
      throw error;
    }
  }

  const retainedPlanRelations = new Map<string, string>();
  for (const plan of plans) {
    if (
      plan.convertedLogLocalId !== undefined &&
      retainedLogReasons.has(plan.convertedLogLocalId)
    ) {
      retainedPlanRelations.set(plan.localId, plan.convertedLogLocalId);
    }
  }
  const claimablePlans = plans.filter(
    plan => !retainedPlanRelations.has(plan.localId),
  );
  const claimableLogs = logs.filter(
    log => !retainedLogReasons.has(log.localId),
  );
  const retainedItems: GuestClaimRetainedItem[] = [
    ...plans
      .filter(plan => retainedPlanRelations.has(plan.localId))
      .map(plan =>
        retainedItem(plan, 'plan', 'related_item_retained', {
          relatedClientRecordId: retainedPlanRelations.get(plan.localId)!,
        }),
      ),
    ...logs
      .filter(log => retainedLogReasons.has(log.localId))
      .map(log =>
        retainedItem(log, 'log', retainedLogReasons.get(log.localId)!),
      ),
  ];

  for (const plan of claimablePlans) {
    const remote = mapPlanPayload(plan);
    const key = `plan:${plan.localId}`;
    const localRecordBytes = canonicalJson(plan);
    items.push({
      key,
      entityKind: 'plan',
      clientRecordId: plan.localId,
      payloadSha256: remote.payloadSha256,
      ...(plan.convertedLogLocalId === undefined
        ? {}
        : { convertedLogClientRecordId: plan.convertedLogLocalId }),
    });
    snapshots.push({
      key,
      entityKind: 'plan',
      payloadBytes: canonicalJson(remote.payload),
      localRecordBytes,
      localRecordSha256: digestUtf8(localRecordBytes),
      ...(claimLabel(plan) === undefined ? {} : { label: claimLabel(plan) }),
    });
  }

  for (const sourceLog of claimableLogs) {
    const prepared = preparedLogs.get(sourceLog.localId);
    if (prepared === undefined) {
      throw new GuestClaimPreparationError(
        'claim_validation_failed',
        claimFailureDetail('checking', sourceLog),
      );
    }
    const remote = mapLogPayload(
      prepared.log,
      options.userId,
      prepared.byteCount,
    );
    const key = `log:${prepared.log.localId}`;
    const localRecordBytes = canonicalJson(sourceLog);
    const sourcePlanClientRecordId = relationships.get(prepared.log.localId);
    items.push({
      key,
      entityKind: 'log',
      clientRecordId: prepared.log.localId,
      payloadSha256: remote.payloadSha256,
      ...(sourcePlanClientRecordId === undefined
        ? {}
        : { sourcePlanClientRecordId }),
      ...(prepared.profile === undefined
        ? {}
        : {
            profile: {
              storageKey: prepared.log.watchCapture!.profile!.storageKey,
              contentRevision:
                prepared.log.watchCapture!.profile!.contentRevision,
              sha256: prepared.profile.sha256,
              sampleCount: prepared.profile.sampleCount,
            },
          }),
    });
    snapshots.push({
      key,
      entityKind: 'log',
      payloadBytes: canonicalJson(remote.payload),
      localRecordBytes,
      localRecordSha256: digestUtf8(localRecordBytes),
      ...(claimLabel(prepared.log) === undefined
        ? {}
        : { label: claimLabel(prepared.log) }),
      ...(prepared.profile === undefined
        ? {}
        : { profileBytes: prepared.profile.bytes }),
    });
  }

  const createdAt = now();
  const manifestSha256 = manifestDigest({
    schemaVersion: 1,
    userId: options.userId,
    planCount: claimablePlans.length,
    logCount: claimableLogs.length,
    items,
    snapshots,
    createdAt,
  });
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    userId: options.userId,
    manifest: {
      schemaVersion: 1,
      userId: options.userId,
      clientBatchId: `claim:${createdAt}:${manifestSha256.slice(0, 16)}`,
      manifestSha256,
      status:
        items.length === 0 && retainedItems.length > 0
          ? 'retained'
          : 'prepared',
      planCount: claimablePlans.length,
      logCount: claimableLogs.length,
      items,
      createdAt,
      updatedAt: createdAt,
    },
    snapshots,
    retainedItems,
  };
}

function retainedItem(
  record: DiveLogEntry | DivePlan,
  entityKind: GuestClaimRetainedItem['entityKind'],
  reason: GuestClaimRetainedReason,
  relation: Pick<GuestClaimRetainedItem, 'relatedClientRecordId'> | undefined =
    undefined,
): GuestClaimRetainedItem {
  const localRecordBytes = canonicalJson(record);
  const label = claimLabel(record);
  return {
    entityKind,
    clientRecordId: record.localId,
    localRecordSha256: digestUtf8(localRecordBytes),
    ...(label === undefined ? {} : {label}),
    reason,
    ...(relation?.relatedClientRecordId === undefined ? {} : relation),
  };
}

export function parseSnapshotLocalRecord(
  sidecar: GuestClaimSnapshotItem,
): DiveLogEntry | DivePlan {
  return sidecar.entityKind === 'log'
    ? parseLocalLog(sidecar.localRecordBytes)
    : parseLocalPlan(sidecar.localRecordBytes);
}

export function parseSnapshotPayload(
  sidecar: GuestClaimSnapshotItem,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sidecar.payloadBytes);
  } catch {
    throw new GuestClaimStorageError();
  }
  if (!isRecord(parsed) || canonicalJson(parsed) !== sidecar.payloadBytes) {
    throw new GuestClaimStorageError();
  }
  return parsed;
}

export async function guestRecordMatchesClaimSnapshot(options: {
  item: GuestClaimItem;
  sidecar: GuestClaimSnapshotItem;
  record: DiveLogEntry | DivePlan;
  profileStorage: WatchProfileStorage;
}): Promise<boolean> {
  if (
    options.item.key !== options.sidecar.key ||
    options.item.entityKind !== options.sidecar.entityKind ||
    options.record.localId !== options.item.clientRecordId ||
    digestUtf8(canonicalJson(options.record)) !==
      options.sidecar.localRecordSha256
  ) {
    return false;
  }
  if (options.item.profile === undefined) {
    return true;
  }
  return claimProfileStillMatches(
    options.item,
    options.sidecar,
    options.profileStorage,
  );
}

export function retainedGuestRecordsMatchClaimSnapshot(options: {
  snapshot: GuestClaimSnapshot;
  logs: DiveLogEntry[];
  plans: DivePlan[];
}): boolean {
  const current = new Map<string, DiveLogEntry | DivePlan>([
    ...options.plans.map(plan => [`plan:${plan.localId}`, plan] as const),
    ...options.logs.map(log => [`log:${log.localId}`, log] as const),
  ]);
  if (current.size !== options.snapshot.retainedItems.length) {
    return false;
  }
  return options.snapshot.retainedItems.every(item => {
    const record = current.get(`${item.entityKind}:${item.clientRecordId}`);
    return (
      record !== undefined &&
      digestUtf8(canonicalJson(record)) === item.localRecordSha256
    );
  });
}

export async function claimProfileStillMatches(
  item: GuestClaimItem,
  sidecar: GuestClaimSnapshotItem,
  profileStorage: WatchProfileStorage,
): Promise<boolean> {
  if (item.profile === undefined || sidecar.profileBytes === undefined) {
    return item.profile === undefined && sidecar.profileBytes === undefined;
  }
  if (!isGuestProfileStorageKey(item.profile.storageKey)) {
    throw new GuestClaimStorageError();
  }
  try {
    const snapshot = createProfileBytesSnapshot(
      await profileStorage.read(item.profile.storageKey),
      {
        localSessionId: (parseSnapshotLocalRecord(sidecar) as DiveLogEntry)
          .watchCapture!.session.localSessionId,
        sampleCount: item.profile.sampleCount,
        sha256: item.profile.sha256,
      },
    );
    return snapshot.bytes === sidecar.profileBytes;
  } catch {
    return false;
  }
}

function mapPlanPayload(plan: DivePlan): RemoteDivePlan {
  return createAccountRemotePlan({
    ...plan,
    remoteId: `claim:${plan.localId}`,
  });
}

function mapLogPayload(
  log: DiveLogEntry,
  userId: string,
  byteCount?: number,
): RemoteDiveLog {
  return createAccountRemoteLog(
    { ...log, remoteId: `claim:${log.localId}` },
    userId,
    byteCount,
  );
}

async function prepareLogSnapshot(
  source: DiveLogEntry,
  profileStorage: WatchProfileStorage,
): Promise<{
  log: DiveLogEntry;
  profile?: ReturnType<typeof createProfileBytesSnapshot>;
  byteCount?: number;
}> {
  const preview = source.watchCapture?.samples.slice(0, 160);
  let log: DiveLogEntry = {
    ...source,
    ...(source.watchCapture === undefined
      ? {}
      : {
          watchCapture: {
            ...source.watchCapture,
            samples: preview ?? [],
          },
        }),
  };
  const profileReference = log.watchCapture?.profile;
  if (profileReference === undefined || log.watchCapture === undefined) {
    return { log };
  }
  if (!isGuestProfileStorageKey(profileReference.storageKey)) {
    throw new GuestClaimPreparationError('claim_validation_failed');
  }
  const profile = createProfileBytesSnapshot(
    await profileStorage.read(profileReference.storageKey),
    {
      localSessionId: log.watchCapture.session.localSessionId,
      sampleCount: profileReference.sampleCount,
      sha256: profileReference.sha256,
    },
  );
  log = {
    ...log,
    watchCapture: {
      ...log.watchCapture,
      profile: { ...profileReference, sha256: profile.sha256 },
    },
  };
  return { log, profile, byteCount: profile.byteCount };
}

function boundedLogForPayload(log: DiveLogEntry, profileSha256?: string) {
  if (log.watchCapture === undefined) {
    return log;
  }
  return {
    ...log,
    watchCapture: {
      ...log.watchCapture,
      samples: log.watchCapture.samples.slice(0, 160),
      ...(log.watchCapture.profile === undefined
        ? {}
        : {
            profile: {
              ...log.watchCapture.profile,
              ...(profileSha256 === undefined
                ? {}
                : { sha256: profileSha256 }),
            },
          }),
    },
  };
}

function validateRelationships(
  plans: DivePlan[],
  logs: DiveLogEntry[],
): Map<string, string> {
  const logIds = new Set(logs.map(log => log.localId));
  const planIds = new Set<string>();
  const sourcePlanByLog = new Map<string, string>();
  for (const plan of plans) {
    if (planIds.has(plan.localId)) {
      throw new GuestClaimPreparationError('relationship_invalid');
    }
    planIds.add(plan.localId);
    if (plan.convertedLogLocalId === undefined) {
      continue;
    }
    if (
      !logIds.has(plan.convertedLogLocalId) ||
      sourcePlanByLog.has(plan.convertedLogLocalId)
    ) {
      throw new GuestClaimPreparationError('relationship_invalid');
    }
    sourcePlanByLog.set(plan.convertedLogLocalId, plan.localId);
  }
  if (logIds.size !== logs.length) {
    throw new GuestClaimPreparationError('relationship_invalid');
  }
  return sourcePlanByLog;
}

function parseStoredSnapshot(
  raw: string,
  expectedUserId: string,
): GuestClaimSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new GuestClaimStorageError();
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'schemaVersion',
      'userId',
      'manifest',
      'snapshots',
      'retainedItems',
      'errorCode',
      'failure',
    ]) ||
    value.schemaVersion !== SIDECAR_SCHEMA_VERSION ||
    value.userId !== expectedUserId ||
    !isRecord(value.manifest) ||
    !Array.isArray(value.snapshots) ||
    (value.errorCode !== undefined &&
      (typeof value.errorCode !== 'string' ||
        !errorCodes.has(value.errorCode as GuestClaimErrorCode)))
  ) {
    throw new GuestClaimStorageError();
  }
  const snapshots = value.snapshots.map(parseSidecar);
  const manifest = parseManifest(value.manifest, expectedUserId, snapshots);
  const retainedItems =
    value.retainedItems === undefined
      ? []
      : Array.isArray(value.retainedItems)
        ? value.retainedItems.map(parseRetainedItem)
        : undefined;
  if (retainedItems === undefined) {
    throw new GuestClaimStorageError();
  }
  const failure =
    value.failure === undefined ? undefined : parseFailure(value.failure);
  if (
    (manifest.status === 'failed') !== (value.errorCode !== undefined) ||
    (failure !== undefined && manifest.status !== 'failed')
  ) {
    throw new GuestClaimStorageError();
  }
  validateSnapshotSet(manifest, snapshots);
  validateRetainedSet(manifest, retainedItems);
  return {
    schemaVersion: 1,
    userId: expectedUserId,
    manifest,
    snapshots,
    retainedItems,
    ...(value.errorCode === undefined
      ? {}
      : { errorCode: value.errorCode as GuestClaimErrorCode }),
    ...(failure === undefined ? {} : { failure }),
  };
}

function parseRetainedItem(value: unknown): GuestClaimRetainedItem {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'entityKind',
      'clientRecordId',
      'localRecordSha256',
      'label',
      'reason',
      'relatedClientRecordId',
    ]) ||
    (value.entityKind !== 'plan' && value.entityKind !== 'log') ||
    !isNonEmptyString(value.clientRecordId) ||
    !SHA256_PATTERN.test(String(value.localRecordSha256)) ||
    !isOptionalBoundedString(value.label, 200) ||
    !isRetainedReason(value.reason) ||
    !isOptionalNonEmptyString(value.relatedClientRecordId) ||
    (value.reason === 'related_item_retained') !==
      (value.relatedClientRecordId !== undefined)
  ) {
    throw new GuestClaimStorageError();
  }
  return {
    entityKind: value.entityKind,
    clientRecordId: value.clientRecordId,
    localRecordSha256: value.localRecordSha256 as string,
    ...(value.label === undefined ? {} : {label: value.label}),
    reason: value.reason,
    ...(value.relatedClientRecordId === undefined
      ? {}
      : {relatedClientRecordId: value.relatedClientRecordId}),
  };
}

function validateRetainedSet(
  manifest: GuestClaimManifest,
  retainedItems: GuestClaimRetainedItem[],
): void {
  const claimedKeys = new Set(manifest.items.map(item => item.key));
  const retainedKeys = retainedItems.map(
    item => `${item.entityKind}:${item.clientRecordId}`,
  );
  if (
    new Set(retainedKeys).size !== retainedKeys.length ||
    retainedKeys.some(key => claimedKeys.has(key)) ||
    (manifest.status === 'retained' &&
      (manifest.items.length !== 0 ||
        retainedItems.length === 0 ||
        manifest.remoteBatchId !== undefined)) ||
    (manifest.status !== 'retained' &&
      manifest.items.length === 0 &&
      retainedItems.length > 0)
  ) {
    throw new GuestClaimStorageError();
  }
}

function parseFailure(value: unknown): GuestClaimFailureDetail {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'phase',
      'entityKind',
      'clientRecordId',
      'label',
    ]) ||
    !['checking', 'uploading', 'finalizing', 'cleanup'].includes(
      String(value.phase),
    ) ||
    (value.entityKind !== undefined &&
      value.entityKind !== 'plan' &&
      value.entityKind !== 'log') ||
    !isOptionalBoundedString(value.clientRecordId, 512) ||
    !isOptionalBoundedString(value.label, 200)
  ) {
    throw new GuestClaimStorageError();
  }
  return {
    phase: value.phase as GuestClaimFailureDetail['phase'],
    ...(value.entityKind === undefined
      ? {}
      : { entityKind: value.entityKind }),
    ...(value.clientRecordId === undefined
      ? {}
      : { clientRecordId: value.clientRecordId }),
    ...(value.label === undefined ? {} : { label: value.label }),
  };
}

function parseManifest(
  value: Record<string, unknown>,
  userId: string,
  snapshots: GuestClaimSnapshotItem[],
): GuestClaimManifest {
  if (
    !hasOnlyKeys(value, [
      'schemaVersion',
      'userId',
      'clientBatchId',
      'remoteBatchId',
      'manifestSha256',
      'status',
      'planCount',
      'logCount',
      'items',
      'createdAt',
      'updatedAt',
    ]) ||
    value.schemaVersion !== 1 ||
    value.userId !== userId ||
    typeof value.clientBatchId !== 'string' ||
    !SHA256_PATTERN.test(String(value.manifestSha256)) ||
    !isManifestStatus(value.status) ||
    !isNonNegativeInteger(value.planCount) ||
    !isNonNegativeInteger(value.logCount) ||
    !Array.isArray(value.items) ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt) ||
    value.updatedAt < value.createdAt ||
    (value.remoteBatchId !== undefined &&
      (typeof value.remoteBatchId !== 'string' ||
        !UUID_PATTERN.test(value.remoteBatchId)))
  ) {
    throw new GuestClaimStorageError();
  }
  const items = value.items.map(parseItem);
  const manifest = {
    schemaVersion: 1 as const,
    userId,
    clientBatchId: value.clientBatchId,
    ...(value.remoteBatchId === undefined
      ? {}
      : { remoteBatchId: value.remoteBatchId }),
    manifestSha256: value.manifestSha256 as string,
    status: value.status,
    planCount: value.planCount,
    logCount: value.logCount,
    items,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  const digest = manifestDigest({ ...manifest, snapshots });
  if (
    digest !== manifest.manifestSha256 ||
    manifest.clientBatchId !==
      `claim:${manifest.createdAt}:${manifest.manifestSha256.slice(0, 16)}` ||
    manifest.planCount + manifest.logCount !== manifest.items.length
  ) {
    throw new GuestClaimStorageError();
  }
  validateManifestOrderAndRelationships(manifest);
  const completed = manifest.items.every(
    item => item.completedAt !== undefined,
  );
  if (
    (manifest.status === 'prepared' && manifest.remoteBatchId !== undefined) ||
    (['finalizing', 'committed', 'cleanupPending'].includes(manifest.status) &&
      manifest.remoteBatchId === undefined) ||
    (['finalizing', 'committed', 'cleanupPending'].includes(manifest.status) &&
      !completed)
  ) {
    throw new GuestClaimStorageError();
  }
  return manifest;
}

function parseItem(value: unknown): GuestClaimItem {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'key',
      'entityKind',
      'clientRecordId',
      'payloadSha256',
      'sourcePlanClientRecordId',
      'convertedLogClientRecordId',
      'profile',
      'stagingRecordId',
      'targetRecordId',
      'completedAt',
    ]) ||
    (value.entityKind !== 'plan' && value.entityKind !== 'log') ||
    value.key !== `${value.entityKind}:${String(value.clientRecordId)}` ||
    !isNonEmptyString(value.clientRecordId) ||
    !SHA256_PATTERN.test(String(value.payloadSha256)) ||
    !isOptionalNonEmptyString(value.sourcePlanClientRecordId) ||
    !isOptionalNonEmptyString(value.convertedLogClientRecordId) ||
    !isOptionalUuid(value.stagingRecordId) ||
    !isOptionalUuid(value.targetRecordId) ||
    !isOptionalFiniteNumber(value.completedAt) ||
    (value.stagingRecordId === undefined) !==
      (value.targetRecordId === undefined) ||
    (value.completedAt !== undefined && value.targetRecordId === undefined) ||
    (value.entityKind === 'plan' &&
      (value.sourcePlanClientRecordId !== undefined ||
        value.profile !== undefined)) ||
    (value.entityKind === 'log' &&
      value.convertedLogClientRecordId !== undefined)
  ) {
    throw new GuestClaimStorageError();
  }
  const profile =
    value.profile === undefined ? undefined : parseProfile(value.profile);
  return {
    key: value.key as string,
    entityKind: value.entityKind,
    clientRecordId: value.clientRecordId,
    payloadSha256: value.payloadSha256 as string,
    ...(value.sourcePlanClientRecordId === undefined
      ? {}
      : { sourcePlanClientRecordId: value.sourcePlanClientRecordId }),
    ...(value.convertedLogClientRecordId === undefined
      ? {}
      : { convertedLogClientRecordId: value.convertedLogClientRecordId }),
    ...(profile === undefined ? {} : { profile }),
    ...(value.stagingRecordId === undefined
      ? {}
      : { stagingRecordId: value.stagingRecordId }),
    ...(value.targetRecordId === undefined
      ? {}
      : { targetRecordId: value.targetRecordId }),
    ...(value.completedAt === undefined
      ? {}
      : { completedAt: value.completedAt }),
  };
}

function parseProfile(value: unknown): NonNullable<GuestClaimItem['profile']> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'storageKey',
      'contentRevision',
      'sha256',
      'sampleCount',
    ]) ||
    !isNonEmptyString(value.storageKey) ||
    !isNonEmptyString(value.contentRevision) ||
    !SHA256_PATTERN.test(String(value.sha256)) ||
    !isNonNegativeInteger(value.sampleCount)
  ) {
    throw new GuestClaimStorageError();
  }
  return {
    storageKey: value.storageKey,
    contentRevision: value.contentRevision,
    sha256: value.sha256 as string,
    sampleCount: value.sampleCount,
  };
}

function parseSidecar(value: unknown): GuestClaimSnapshotItem {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'key',
      'entityKind',
      'payloadBytes',
      'localRecordBytes',
      'localRecordSha256',
      'label',
      'profileBytes',
      'profileReadback',
    ]) ||
    !isNonEmptyString(value.key) ||
    (value.entityKind !== 'plan' && value.entityKind !== 'log') ||
    value.key.split(':', 1)[0] !== value.entityKind ||
    !isNonEmptyString(value.payloadBytes) ||
    !isNonEmptyString(value.localRecordBytes) ||
    !SHA256_PATTERN.test(String(value.localRecordSha256)) ||
    !isOptionalNonEmptyString(value.label) ||
    !isOptionalString(value.profileBytes)
  ) {
    throw new GuestClaimStorageError();
  }
  const profileReadback =
    value.profileReadback === undefined
      ? undefined
      : parseProfileReadback(value.profileReadback);
  return {
    key: value.key,
    entityKind: value.entityKind,
    payloadBytes: value.payloadBytes,
    localRecordBytes: value.localRecordBytes,
    localRecordSha256: value.localRecordSha256 as string,
    ...(value.label === undefined ? {} : { label: value.label }),
    ...(value.profileBytes === undefined
      ? {}
      : { profileBytes: value.profileBytes }),
    ...(profileReadback === undefined ? {} : { profileReadback }),
  };
}

function parseProfileReadback(value: unknown): GuestClaimProfileReadback {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'path',
      'byteCount',
      'sha256',
      'sampleCount',
      'verifiedAt',
    ]) ||
    !isNonEmptyString(value.path) ||
    !isNonNegativeInteger(value.byteCount) ||
    !SHA256_PATTERN.test(String(value.sha256)) ||
    !isNonNegativeInteger(value.sampleCount) ||
    !isFiniteNumber(value.verifiedAt)
  ) {
    throw new GuestClaimStorageError();
  }
  return {
    path: value.path,
    byteCount: value.byteCount,
    sha256: value.sha256 as string,
    sampleCount: value.sampleCount,
    verifiedAt: value.verifiedAt,
  };
}

function validateSnapshotSet(
  manifest: GuestClaimManifest,
  snapshots: GuestClaimSnapshotItem[],
): void {
  if (snapshots.length !== manifest.items.length) {
    throw new GuestClaimStorageError();
  }
  for (const [index, item] of manifest.items.entries()) {
    const sidecar = snapshots[index];
    if (
      sidecar === undefined ||
      sidecar.key !== item.key ||
      sidecar.entityKind !== item.entityKind
    ) {
      throw new GuestClaimStorageError();
    }
    const payload = parseSnapshotPayload(sidecar);
    if (
      canonicalAccountPayloadSha256(payload) !== item.payloadSha256 ||
      digestUtf8(sidecar.localRecordBytes) !== sidecar.localRecordSha256 ||
      canonicalJson(parseJson(sidecar.localRecordBytes)) !==
        sidecar.localRecordBytes
    ) {
      throw new GuestClaimStorageError();
    }
    const local = parseSnapshotLocalRecord(sidecar);
    if (local.localId !== item.clientRecordId) {
      throw new GuestClaimStorageError();
    }
    if (item.entityKind === 'plan') {
      const plan = local as DivePlan;
      if (
        plan.convertedLogLocalId !== item.convertedLogClientRecordId ||
        canonicalJson(mapPlanPayload(plan).payload) !== sidecar.payloadBytes ||
        sidecar.profileBytes !== undefined ||
        sidecar.profileReadback !== undefined
      ) {
        throw new GuestClaimStorageError();
      }
      continue;
    }
    const log = local as DiveLogEntry;
    const preview = payload.profile_preview;
    if (Array.isArray(preview) && preview.length > 160) {
      throw new GuestClaimStorageError();
    }
    if (item.profile === undefined) {
      if (
        sidecar.profileBytes !== undefined ||
        sidecar.profileReadback !== undefined ||
        canonicalJson(mapLogPayload(boundedLogForPayload(log), manifest.userId).payload) !==
          sidecar.payloadBytes
      ) {
        throw new GuestClaimStorageError();
      }
      continue;
    }
    const reference = log.watchCapture?.profile;
    if (
      sidecar.profileBytes === undefined ||
      !isGuestProfileStorageKey(item.profile.storageKey) ||
      reference?.storageKey !== item.profile.storageKey ||
      reference.contentRevision !== item.profile.contentRevision ||
      reference.sampleCount !== item.profile.sampleCount ||
      (reference.sha256 !== undefined &&
        reference.sha256 !== item.profile.sha256) ||
      log.watchCapture === undefined
    ) {
      throw new GuestClaimStorageError();
    }
    const verified = verifyProfileBytesSnapshot(sidecar.profileBytes, {
      localSessionId: log.watchCapture.session.localSessionId,
      sampleCount: item.profile.sampleCount,
      sha256: item.profile.sha256,
      byteCount: sidecar.profileReadback?.byteCount,
    });
    const payloadLog = boundedLogForPayload(log, item.profile.sha256);
    if (
      canonicalJson(
        mapLogPayload(
          payloadLog,
          manifest.userId,
          encodeUtf8(sidecar.profileBytes).length,
        ).payload,
      ) !== sidecar.payloadBytes
    ) {
      throw new GuestClaimStorageError();
    }
    const expectedReadbackPath =
      manifest.remoteBatchId !== undefined && item.targetRecordId !== undefined
        ? `${manifest.userId}/claims/${manifest.remoteBatchId}/${item.targetRecordId}/${encodeURIComponent(item.profile.contentRevision)}.json`
        : undefined;
    if (
      sidecar.profileReadback !== undefined &&
      (expectedReadbackPath === undefined ||
        sidecar.profileReadback.path !== expectedReadbackPath ||
        sidecar.profileReadback.sha256 !== verified.sha256 ||
        sidecar.profileReadback.sampleCount !== verified.sampleCount ||
        (item.completedAt !== undefined &&
          sidecar.profileReadback.path.length === 0))
    ) {
      throw new GuestClaimStorageError();
    }
    if (
      item.completedAt !== undefined &&
      sidecar.profileReadback === undefined
    ) {
      throw new GuestClaimStorageError();
    }
  }
}

function validateManifestOrderAndRelationships(
  manifest: GuestClaimManifest,
): void {
  const plans = manifest.items.slice(0, manifest.planCount);
  const logs = manifest.items.slice(manifest.planCount);
  if (
    plans.some(item => item.entityKind !== 'plan') ||
    logs.some(item => item.entityKind !== 'log') ||
    !isSorted(plans.map(item => item.clientRecordId)) ||
    !isSorted(logs.map(item => item.clientRecordId))
  ) {
    throw new GuestClaimStorageError();
  }
  const planById = new Map(plans.map(item => [item.clientRecordId, item]));
  const logById = new Map(logs.map(item => [item.clientRecordId, item]));
  if (planById.size !== plans.length || logById.size !== logs.length) {
    throw new GuestClaimStorageError();
  }
  const relatedLogs = new Set<string>();
  for (const plan of plans) {
    const logId = plan.convertedLogClientRecordId;
    if (logId === undefined) {
      continue;
    }
    const log = logById.get(logId);
    if (
      log === undefined ||
      relatedLogs.has(logId) ||
      log.sourcePlanClientRecordId !== plan.clientRecordId
    ) {
      throw new GuestClaimStorageError();
    }
    relatedLogs.add(logId);
  }
  for (const log of logs) {
    if (
      log.sourcePlanClientRecordId !== undefined &&
      planById.get(log.sourcePlanClientRecordId)?.convertedLogClientRecordId !==
        log.clientRecordId
    ) {
      throw new GuestClaimStorageError();
    }
  }
}

function manifestDigest(value: {
  schemaVersion: 1;
  userId: string;
  planCount: number;
  logCount: number;
  items: GuestClaimItem[];
  snapshots: GuestClaimSnapshotItem[];
  createdAt: number;
}): string {
  return canonicalAccountPayloadSha256({
    schemaVersion: value.schemaVersion,
    userId: value.userId,
    planCount: value.planCount,
    logCount: value.logCount,
    items: value.items.map(item => ({
      key: item.key,
      entityKind: item.entityKind,
      clientRecordId: item.clientRecordId,
      payloadSha256: item.payloadSha256,
      sourcePlanClientRecordId: item.sourcePlanClientRecordId ?? null,
      convertedLogClientRecordId: item.convertedLogClientRecordId ?? null,
      profile: item.profile ?? null,
    })),
    localRecords: value.snapshots.map(sidecar => ({
      key: sidecar.key,
      localRecordSha256: sidecar.localRecordSha256,
    })),
    createdAt: value.createdAt,
  });
}

function parseLocalLog(bytes: string): DiveLogEntry {
  return parseDiveLogbookEnvelope(
    JSON.stringify({
      schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
      updatedAt: 0,
      value: [parseJson(bytes)],
    }),
    'guest claim log snapshot',
  )[0]!;
}

function parseLocalPlan(bytes: string): DivePlan {
  return parseDivePlanbookEnvelope(
    JSON.stringify({
      schemaVersion: DIVE_PLANBOOK_SCHEMA_VERSION,
      updatedAt: 0,
      value: [parseJson(bytes)],
    }),
    'guest claim plan snapshot',
  )[0]!;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new GuestClaimStorageError();
  }
}

function claimLabel(value: DiveLogEntry | DivePlan): string | undefined {
  return 'manual' in value
    ? (value.manual.title ?? value.manual.site.name)
    : (value.title ?? value.site.name);
}

function claimFailureDetail(
  phase: GuestClaimFailureDetail['phase'],
  value: DiveLogEntry | DivePlan,
): GuestClaimFailureDetail {
  const label = claimLabel(value);
  return {
    phase,
    entityKind: 'manual' in value ? 'log' : 'plan',
    clientRecordId: value.localId.slice(0, 512),
    ...(label === undefined ? {} : { label: label.slice(0, 200) }),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function digestUtf8(value: string): string {
  return sha256BytesHex(encodeUtf8(value));
}

function isGuestProfileStorageKey(storageKey: string): boolean {
  return storageKey.startsWith(dataProfileKeyPrefix({ kind: 'guest' }));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isManifestStatus(
  value: unknown,
): value is GuestClaimManifest['status'] {
  return (
    value === 'prepared' ||
    value === 'running' ||
    value === 'finalizing' ||
    value === 'committed' ||
    value === 'cleanupPending' ||
    value === 'deferred' ||
    value === 'retained' ||
    value === 'failed'
  );
}

function isRetainedReason(
  value: unknown,
): value is GuestClaimRetainedReason {
  return (
    value === 'profile_missing' ||
    value === 'profile_corrupt' ||
    value === 'related_item_retained'
  );
}

function isSorted(values: string[]): boolean {
  return values.every(
    (value, index) =>
      index === 0 || values[index - 1]!.localeCompare(value) <= 0,
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalBoundedString(
  value: unknown,
  maxLength: number,
): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' && value.length > 0 && value.length <= maxLength)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isOptionalUuid(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' && UUID_PATTERN.test(value))
  );
}
