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
import {
  readWatchProfileRaw,
  writeWatchProfileRaw,
  type WatchProfileStorage,
} from '../storage/watch-profile-storage';
import {
  canonicalAccountPayloadSha256,
  createAccountRemoteLog,
  createAccountRemotePlan,
} from '../sync/account-payload';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DivePlan } from '../types/dive-plan';
import {
  createStoredProfileBytesSnapshot,
  createProfileBytesSnapshot,
  encodeUtf8,
  GuestClaimProfileError,
  sha256BytesHex,
  verifyProfileBytesSnapshot,
} from './profile-bytes';
import type {
  GuestClaimErrorCode,
  GuestClaimFailureDetail,
  GuestClaimHistoricalArtifact,
  GuestClaimItem,
  GuestClaimManifest,
  GuestClaimRetainedItem,
  GuestClaimRetainedReason,
} from './guest-claim-types';

const LEGACY_SIDECAR_SCHEMA_VERSION = 1;
const SIDECAR_SCHEMA_VERSION = 2;
const CHECKPOINT_HINT_SCHEMA_VERSION = 1;
const CHECKPOINT_HINT_KEY_SUFFIX = ':checkpoint-hint';
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
  sourceRecordBytes?: string;
  sourceRecordSha256?: string;
  label?: string;
  profileBytes?: string;
  profileSidecarStorageKey?: string;
  profileReadback?: GuestClaimProfileReadback;
};

export type GuestClaimSnapshot = {
  schemaVersion: 1 | 2;
  userId: string;
  manifest: GuestClaimManifest;
  snapshots: GuestClaimSnapshotItem[];
  historicalArtifacts?: GuestClaimHistoricalArtifact[];
  retainedItems: GuestClaimRetainedItem[];
  errorCode?: GuestClaimErrorCode;
  failure?: GuestClaimFailureDetail;
};

export type GuestClaimStoreLike = {
  read(): Promise<GuestClaimSnapshot | undefined>;
  write(snapshot: GuestClaimSnapshot): Promise<void>;
  remove?(): Promise<void>;
};

export type GuestClaimCheckpointHint =
  | {
      state: 'recoverable';
      status: 'running' | 'finalizing' | 'cleanupPending';
    }
  | {
      state: 'recoverable';
      status: 'failed';
      errorCode: 'network_unavailable';
    }
  | {state: 'inactive'}
  | {state: 'unknown'};

type StoredGuestClaimCheckpointHint = Exclude<
  GuestClaimCheckpointHint,
  {state: 'unknown'}
> & {
  schemaVersion: 1;
  userId: string;
};

const claimOperationTails = new Map<string, Promise<void>>();

function serializeClaimOperation<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const preceding = claimOperationTails.get(key) ?? Promise.resolve();
  const result = preceding.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  claimOperationTails.set(key, tail);
  void tail.then(() => {
    if (claimOperationTails.get(key) === tail) {
      claimOperationTails.delete(key);
    }
  });
  return result;
}

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
  private readonly checkpointHintKey: string;
  private persistedCheckpointHint?: string;
  private checkpointHintLoaded = false;
  private persistedCheckpointHintState:
    | 'recoverable'
    | 'inactive'
    | 'unknown' = 'unknown';

  constructor(
    private readonly options: {
      storage: PersistentKeyValueStore;
      userId: string;
      now?: () => number;
    },
  ) {
    this.key = dataStorageKeys({ kind: 'user', userId: options.userId }).claim;
    this.checkpointHintKey = `${this.key}${CHECKPOINT_HINT_KEY_SUFFIX}`;
  }

  read(): Promise<GuestClaimSnapshot | undefined> {
    return serializeClaimOperation(this.key, () => this.readUnlocked());
  }

  readCheckpointHint(): Promise<GuestClaimCheckpointHint> {
    return serializeClaimOperation(this.key, () =>
      this.readCheckpointHintUnlocked(),
    );
  }

  write(snapshot: GuestClaimSnapshot): Promise<void> {
    return serializeClaimOperation(this.key, () =>
      this.writeUnlocked(snapshot),
    );
  }

  remove(): Promise<void> {
    return serializeClaimOperation(this.key, () => this.removeUnlocked());
  }

  private async readUnlocked(): Promise<GuestClaimSnapshot | undefined> {
    const raw = await this.options.storage.getString(this.key);
    if (raw === undefined) {
      return undefined;
    }
    const snapshot = parseStoredSnapshot(raw, this.options.userId);
    await this.backfillCheckpointHint(snapshot);
    return snapshot;
  }

  private async readCheckpointHintUnlocked(): Promise<GuestClaimCheckpointHint> {
    const raw = await this.options.storage.getString(this.checkpointHintKey);
    if (raw === undefined) {
      this.markCheckpointHintUnknown();
      return {state: 'unknown'};
    }
    const parsed = parseStoredCheckpointHint(raw, this.options.userId);
    if (parsed === undefined) {
      this.markCheckpointHintUnknown();
      return {state: 'unknown'};
    }
    this.persistedCheckpointHint = JSON.stringify(parsed);
    this.checkpointHintLoaded = true;
    this.persistedCheckpointHintState = parsed.state;
    return publicCheckpointHint(parsed);
  }

  private async writeUnlocked(snapshot: GuestClaimSnapshot): Promise<void> {
    if (snapshot.userId !== this.options.userId) {
      throw new GuestClaimStorageError('Guest claim user mismatch');
    }
    const parsed = parseStoredSnapshot(
      JSON.stringify(snapshot),
      this.options.userId,
    );
    await this.readCheckpointHintUnlocked();
    await this.invalidateNonRecoverableHintBeforeRecoverableWrite(parsed);
    await this.options.storage.setString(this.key, JSON.stringify(parsed));
    try {
      await this.persistCheckpointHint(parsed);
    } catch {
      this.markCheckpointHintUnknown();
    }
  }

  private async removeUnlocked(): Promise<void> {
    await this.options.storage.remove(this.key);
    try {
      await this.options.storage.remove(this.checkpointHintKey);
    } catch {
      this.markCheckpointHintUnknown();
      return;
    }
    this.markCheckpointHintUnknown();
  }

  private async invalidateNonRecoverableHintBeforeRecoverableWrite(
    snapshot: GuestClaimSnapshot,
  ): Promise<void> {
    if (storedCheckpointHint(snapshot).state !== 'recoverable') {
      return;
    }
    if (!this.checkpointHintLoaded) {
      await this.readCheckpointHintUnlocked();
    }
    if (this.persistedCheckpointHintState === 'recoverable') {
      return;
    }
    await this.options.storage.remove(this.checkpointHintKey);
    this.markCheckpointHintUnknown();
  }

  private async persistCheckpointHint(
    snapshot: GuestClaimSnapshot,
  ): Promise<void> {
    const hint = storedCheckpointHint(snapshot);
    const serialized = JSON.stringify(hint);
    if (this.persistedCheckpointHint === serialized) {
      return;
    }
    await this.options.storage.setString(this.checkpointHintKey, serialized);
    this.persistedCheckpointHint = serialized;
    this.checkpointHintLoaded = true;
    this.persistedCheckpointHintState = hint.state;
  }

  private async backfillCheckpointHint(
    snapshot: GuestClaimSnapshot,
  ): Promise<void> {
    try {
      await this.readCheckpointHintUnlocked();
      await this.invalidateNonRecoverableHintBeforeRecoverableWrite(snapshot);
      await this.persistCheckpointHint(snapshot);
    } catch {
      this.markCheckpointHintUnknown();
      // The validated full snapshot remains authoritative; this hint is advisory.
    }
  }

  private markCheckpointHintUnknown(): void {
    this.persistedCheckpointHint = undefined;
    this.checkpointHintLoaded = true;
    this.persistedCheckpointHintState = 'unknown';
  }
}

function storedCheckpointHint(
  snapshot: GuestClaimSnapshot,
): StoredGuestClaimCheckpointHint {
  const base = {
    schemaVersion: CHECKPOINT_HINT_SCHEMA_VERSION,
    userId: snapshot.userId,
  } as const;
  if (
    snapshot.manifest.status === 'running' ||
    snapshot.manifest.status === 'finalizing' ||
    (snapshot.manifest.status === 'cleanupPending' &&
      snapshot.failure === undefined)
  ) {
    return {
      ...base,
      state: 'recoverable',
      status: snapshot.manifest.status,
    };
  }
  if (
    snapshot.manifest.status === 'failed' &&
    snapshot.errorCode === 'network_unavailable'
  ) {
    return {
      ...base,
      state: 'recoverable',
      status: 'failed',
      errorCode: 'network_unavailable',
    };
  }
  return {...base, state: 'inactive'};
}

function parseStoredCheckpointHint(
  raw: string,
  expectedUserId: string,
): StoredGuestClaimCheckpointHint | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== CHECKPOINT_HINT_SCHEMA_VERSION ||
    value.userId !== expectedUserId ||
    (value.state !== 'recoverable' && value.state !== 'inactive')
  ) {
    return undefined;
  }
  if (value.state === 'inactive') {
    if (!hasExactKeys(value, ['schemaVersion', 'userId', 'state'])) {
      return undefined;
    }
    return {
      schemaVersion: 1,
      userId: expectedUserId,
      state: 'inactive',
    };
  }
  if (
    value.status === 'running' ||
    value.status === 'finalizing' ||
    value.status === 'cleanupPending'
  ) {
    if (
      !hasExactKeys(value, ['schemaVersion', 'userId', 'state', 'status'])
    ) {
      return undefined;
    }
    return {
      schemaVersion: 1,
      userId: expectedUserId,
      state: 'recoverable',
      status: value.status,
    };
  }
  if (
    value.status === 'failed' &&
    value.errorCode === 'network_unavailable' &&
    hasExactKeys(value, [
      'schemaVersion',
      'userId',
      'state',
      'status',
      'errorCode',
    ])
  ) {
    return {
      schemaVersion: 1,
      userId: expectedUserId,
      state: 'recoverable',
      status: 'failed',
      errorCode: 'network_unavailable',
    };
  }
  return undefined;
}

function publicCheckpointHint(
  hint: StoredGuestClaimCheckpointHint,
): GuestClaimCheckpointHint {
  if (hint.state === 'inactive') {
    return {state: 'inactive'};
  }
  if (hint.status === 'failed') {
    return {
      state: 'recoverable',
      status: 'failed',
      errorCode: 'network_unavailable',
    };
  }
  return {state: 'recoverable', status: hint.status};
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
      sourceRecordBytes: localRecordBytes,
      sourceRecordSha256: digestUtf8(localRecordBytes),
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
    const localRecordBytes = canonicalJson(prepared.log);
    const sourceRecordBytes = canonicalJson(sourceLog);
    const sourcePlanClientRecordId = relationships.get(prepared.log.localId);
    const profileSidecarStorageKey =
      prepared.profile === undefined
        ? undefined
        : await persistClaimProfileSidecar({
            userId: options.userId,
            localId: prepared.log.localId,
            contentRevision:
              prepared.log.watchCapture!.profile!.contentRevision,
            localSessionId:
              prepared.log.watchCapture!.session.localSessionId,
            profile: prepared.profile,
            profileStorage: options.profileStorage,
          });
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
      sourceRecordBytes,
      sourceRecordSha256: digestUtf8(sourceRecordBytes),
      ...(claimLabel(prepared.log) === undefined
        ? {}
        : { label: claimLabel(prepared.log) }),
      ...(prepared.profile === undefined
        ? {}
        : {profileSidecarStorageKey}),
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
    options.record.localId !== options.item.clientRecordId
  ) {
    return false;
  }
  if (
    digestUtf8(canonicalJson(options.record)) !==
    sourceRecordSha256(options.sidecar)
  ) {
    return false;
  }
  return (
    options.item.profile === undefined ||
    (await claimProfileStillMatches(
      options.item,
      options.sidecar,
      options.profileStorage,
    ))
  );
}

export function sourceRecordBytes(sidecar: GuestClaimSnapshotItem): string {
  return sidecar.sourceRecordBytes ?? sidecar.localRecordBytes;
}

export function sourceRecordSha256(sidecar: GuestClaimSnapshotItem): string {
  return sidecar.sourceRecordSha256 ?? sidecar.localRecordSha256;
}

export function compactCommittedGuestClaimSnapshot(
  snapshot: GuestClaimSnapshot,
): GuestClaimSnapshot {
  if (snapshot.manifest.status !== 'committed') {
    throw new GuestClaimStorageError();
  }
  if (
    snapshot.schemaVersion === SIDECAR_SCHEMA_VERSION &&
    snapshot.snapshots.length === 0 &&
    snapshot.historicalArtifacts !== undefined
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    snapshots: [],
    historicalArtifacts: historicalArtifactsFromSnapshot(snapshot),
  };
}

export function claimProfileEvidenceStorageKeys(
  snapshot: GuestClaimSnapshot,
): string[] {
  return snapshot.manifest.items.flatMap(item =>
    item.entityKind === 'log' && item.profile !== undefined
      ? [
          claimProfileSidecarKey(
            snapshot.userId,
            item.clientRecordId,
            item.profile.contentRevision,
            item.profile.sha256,
          ),
        ]
      : [],
  );
}

export function historicalArtifactsFromSnapshot(
  snapshot: GuestClaimSnapshot,
): GuestClaimHistoricalArtifact[] {
  if (snapshot.historicalArtifacts !== undefined) {
    return snapshot.historicalArtifacts.map(value => ({...value}));
  }
  const identities = new Map<string, GuestClaimHistoricalArtifact>();
  for (const [index, item] of snapshot.manifest.items.entries()) {
    if (item.entityKind !== 'log') {
      continue;
    }
    const sidecar = snapshot.snapshots[index];
    if (sidecar === undefined || sidecar.entityKind !== 'log') {
      continue;
    }
    const record = parseSnapshotLocalRecord(sidecar) as DiveLogEntry;
    const profile = record.watchCapture?.profile;
    const localSessionId = record.watchCapture?.session.localSessionId;
    const artifactSha256 = profile?.artifactSha256 ?? profile?.sha256;
    if (
      localSessionId === undefined ||
      profile?.contentRevision === undefined ||
      artifactSha256 === undefined
    ) {
      continue;
    }
    const identity = {
      localSessionId,
      contentRevision: profile.contentRevision,
      artifactSha256,
    };
    identities.set(
      `${identity.localSessionId}\u0000${identity.contentRevision}\u0000${identity.artifactSha256}`,
      identity,
    );
  }
  return [...identities.values()].sort(
    (left, right) =>
      left.localSessionId.localeCompare(right.localSessionId) ||
      left.contentRevision.localeCompare(right.contentRevision) ||
      left.artifactSha256.localeCompare(right.artifactSha256),
  );
}

export function guestRecordsContainClaimSnapshotSources(options: {
  snapshot: GuestClaimSnapshot;
  logs: DiveLogEntry[];
  plans: DivePlan[];
}): boolean {
  const current = new Set([
    ...options.logs.map(log => `log:${log.localId}`),
    ...options.plans.map(plan => `plan:${plan.localId}`),
  ]);
  const expected = new Set([
    ...options.snapshot.manifest.items.map(item => item.key),
    ...options.snapshot.retainedItems.map(
      item => `${item.entityKind}:${item.clientRecordId}`,
    ),
  ]);
  return [...expected].every(key => current.has(key));
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
  if (item.profile === undefined) {
    return (
      sidecar.profileBytes === undefined &&
      sidecar.profileSidecarStorageKey === undefined
    );
  }
  if (!isGuestProfileStorageKey(item.profile.storageKey)) {
    throw new GuestClaimStorageError();
  }
  const snapshotBytes = await readClaimProfileBytes(sidecar, profileStorage);
  if (snapshotBytes === undefined) {
    return false;
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
    return snapshot.bytes === snapshotBytes;
  } catch {
    return false;
  }
}

export async function readClaimProfileBytes(
  sidecar: GuestClaimSnapshotItem,
  profileStorage: WatchProfileStorage,
): Promise<string | undefined> {
  if (
    sidecar.profileBytes !== undefined &&
    sidecar.profileSidecarStorageKey !== undefined
  ) {
    throw new GuestClaimStorageError();
  }
  if (sidecar.profileBytes !== undefined) {
    return sidecar.profileBytes;
  }
  if (sidecar.profileSidecarStorageKey === undefined) {
    return undefined;
  }
  return readWatchProfileRaw(
    profileStorage,
    sidecar.profileSidecarStorageKey,
  );
}

export async function migrateGuestClaimSnapshotProfileSidecars(
  snapshot: GuestClaimSnapshot,
  profileStorage: WatchProfileStorage,
): Promise<GuestClaimSnapshot> {
  if (snapshot.schemaVersion === SIDECAR_SCHEMA_VERSION) {
    return snapshot;
  }

  const nextSnapshots: GuestClaimSnapshotItem[] = [];
  for (const [index, sidecar] of snapshot.snapshots.entries()) {
    const item = snapshot.manifest.items[index];
    if (item?.profile === undefined) {
      nextSnapshots.push({...sidecar});
      continue;
    }
    if (sidecar.profileBytes === undefined) {
      throw new GuestClaimStorageError();
    }
    const local = parseSnapshotLocalRecord(sidecar) as DiveLogEntry;
    const localSessionId = local.watchCapture?.session.localSessionId;
    if (localSessionId === undefined) {
      throw new GuestClaimStorageError();
    }
    const verified = verifyProfileBytesSnapshot(sidecar.profileBytes, {
      localSessionId,
      sampleCount: item.profile.sampleCount,
      sha256: item.profile.sha256,
      byteCount: sidecar.profileReadback?.byteCount,
    });
    if (verified.bytes !== sidecar.profileBytes) {
      throw new GuestClaimStorageError();
    }
    const profileSidecarStorageKey = claimProfileSidecarKey(
      snapshot.userId,
      item.clientRecordId,
      item.profile.contentRevision,
      item.profile.sha256,
    );
    await writeWatchProfileRaw(
      profileStorage,
      profileSidecarStorageKey,
      sidecar.profileBytes,
    );
    const readback = await readWatchProfileRaw(
      profileStorage,
      profileSidecarStorageKey,
    );
    if (readback !== sidecar.profileBytes) {
      throw new GuestClaimStorageError();
    }
    const {
      profileBytes: _legacyProfileBytes,
      ...sidecarWithoutInlineProfile
    } = sidecar;
    nextSnapshots.push({
      ...sidecarWithoutInlineProfile,
      profileSidecarStorageKey,
    });
  }

  return {
    ...snapshot,
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    snapshots: nextSnapshots,
  };
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
  profile?: ReturnType<typeof createStoredProfileBytesSnapshot>;
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
  const profile = createStoredProfileBytesSnapshot(
    await profileStorage.read(profileReference.storageKey),
    {
      localSessionId: log.watchCapture.session.localSessionId,
      sampleCount: profileReference.sampleCount,
      sha256: profileReference.sha256,
      artifactSha256: profileReference.artifactSha256,
    },
  );
  log = {
    ...log,
    watchCapture: {
      ...log.watchCapture,
      profile: {
        ...profileReference,
        sha256: profile.sha256,
        ...(profile.artifactSha256 === undefined
          ? {}
          : {artifactSha256: profile.artifactSha256}),
      },
    },
  };
  return { log, profile, byteCount: profile.byteCount };
}

async function persistClaimProfileSidecar(options: {
  userId: string;
  localId: string;
  contentRevision: string;
  localSessionId: string;
  profile: ReturnType<typeof createStoredProfileBytesSnapshot>;
  profileStorage: WatchProfileStorage;
}): Promise<string> {
  const key = claimProfileSidecarKey(
    options.userId,
    options.localId,
    options.contentRevision,
    options.profile.sha256,
  );
  await writeWatchProfileRaw(
    options.profileStorage,
    key,
    options.profile.bytes,
  );
  const stored = await readWatchProfileRaw(options.profileStorage, key);
  if (stored === undefined || stored !== options.profile.bytes) {
    throw new GuestClaimPreparationError('claim_validation_failed');
  }
  const verified = verifyProfileBytesSnapshot(stored, {
    localSessionId: options.localSessionId,
    sampleCount: options.profile.sampleCount,
    sha256: options.profile.sha256,
    byteCount: options.profile.byteCount,
  });
  if (verified.bytes !== stored) {
    throw new GuestClaimPreparationError('claim_validation_failed');
  }
  return key;
}

function claimProfileSidecarKey(
  userId: string,
  localId: string,
  contentRevision: string,
  sha256: string,
): string {
  return [
    'dive-mobile:claim-profile',
    encodeURIComponent(userId),
    encodeURIComponent(localId),
    encodeURIComponent(contentRevision),
    sha256,
  ].join(':');
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
      'historicalArtifacts',
      'retainedItems',
      'errorCode',
      'failure',
    ]) ||
    (value.schemaVersion !== LEGACY_SIDECAR_SCHEMA_VERSION &&
      value.schemaVersion !== SIDECAR_SCHEMA_VERSION) ||
    value.userId !== expectedUserId ||
    !isRecord(value.manifest) ||
    !Array.isArray(value.snapshots) ||
    (value.errorCode !== undefined &&
      (typeof value.errorCode !== 'string' ||
        !errorCodes.has(value.errorCode as GuestClaimErrorCode)))
  ) {
    throw new GuestClaimStorageError();
  }
  const schemaVersion = value.schemaVersion as 1 | 2;
  const snapshots = value.snapshots.map(sidecar =>
    parseSidecar(sidecar, schemaVersion),
  );
  const historicalArtifacts =
    value.historicalArtifacts === undefined
      ? undefined
      : Array.isArray(value.historicalArtifacts)
        ? value.historicalArtifacts.map(parseHistoricalArtifact)
        : undefined;
  if (
    value.historicalArtifacts !== undefined &&
    historicalArtifacts === undefined
  ) {
    throw new GuestClaimStorageError();
  }
  const compactCommittedReceipt =
    schemaVersion === SIDECAR_SCHEMA_VERSION &&
    snapshots.length === 0 &&
    historicalArtifacts !== undefined;
  if (
    snapshots.some(
      sidecar =>
        (sidecar.sourceRecordBytes === undefined) !==
        (sidecar.sourceRecordSha256 === undefined),
    ) ||
    (snapshots.some(sidecar => sidecar.sourceRecordBytes !== undefined) &&
      snapshots.some(sidecar => sidecar.sourceRecordBytes === undefined))
  ) {
    throw new GuestClaimStorageError();
  }
  const manifest = parseManifest(
    value.manifest,
    expectedUserId,
    snapshots,
    compactCommittedReceipt,
  );
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
  const hasError = value.errorCode !== undefined;
  if (
    (manifest.status === 'failed' && !hasError) ||
    (manifest.status !== 'failed' &&
      manifest.status !== 'cleanupPending' &&
      hasError) ||
    (failure !== undefined &&
      manifest.status !== 'failed' &&
      manifest.status !== 'cleanupPending') ||
    (manifest.status === 'cleanupPending' &&
      hasError !== (failure !== undefined))
  ) {
    throw new GuestClaimStorageError();
  }
  validateSnapshotSet(
    manifest,
    snapshots,
    schemaVersion,
    compactCommittedReceipt,
  );
  validateHistoricalArtifacts(
    manifest,
    historicalArtifacts,
    compactCommittedReceipt,
  );
  validateRetainedSet(manifest, retainedItems);
  return {
    schemaVersion,
    userId: expectedUserId,
    manifest,
    snapshots,
    ...(historicalArtifacts === undefined ? {} : {historicalArtifacts}),
    retainedItems,
    ...(value.errorCode === undefined
      ? {}
      : { errorCode: value.errorCode as GuestClaimErrorCode }),
    ...(failure === undefined ? {} : { failure }),
  };
}

function parseHistoricalArtifact(
  value: unknown,
): GuestClaimHistoricalArtifact {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'localSessionId',
      'contentRevision',
      'artifactSha256',
    ]) ||
    !isNonEmptyString(value.localSessionId) ||
    !isNonEmptyString(value.contentRevision) ||
    !SHA256_PATTERN.test(String(value.artifactSha256))
  ) {
    throw new GuestClaimStorageError();
  }
  return {
    localSessionId: value.localSessionId,
    contentRevision: value.contentRevision,
    artifactSha256: value.artifactSha256 as string,
  };
}

function validateHistoricalArtifacts(
  manifest: GuestClaimManifest,
  historicalArtifacts: GuestClaimHistoricalArtifact[] | undefined,
  compactCommittedReceipt: boolean,
): void {
  if (
    compactCommittedReceipt !==
      (manifest.status === 'committed' &&
        historicalArtifacts !== undefined) ||
    (!compactCommittedReceipt && historicalArtifacts !== undefined)
  ) {
    throw new GuestClaimStorageError();
  }
  if (historicalArtifacts === undefined) {
    return;
  }
  const keys = historicalArtifacts.map(
    value =>
      `${value.localSessionId}\u0000${value.contentRevision}\u0000${value.artifactSha256}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new GuestClaimStorageError();
  }
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
  compactCommittedReceipt: boolean,
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
    (!compactCommittedReceipt && digest !== manifest.manifestSha256) ||
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
    (compactCommittedReceipt && manifest.status !== 'committed') ||
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

function parseSidecar(
  value: unknown,
  schemaVersion: GuestClaimSnapshot['schemaVersion'],
): GuestClaimSnapshotItem {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'key',
      'entityKind',
      'payloadBytes',
      'localRecordBytes',
      'localRecordSha256',
      'sourceRecordBytes',
      'sourceRecordSha256',
      'label',
      'profileBytes',
      'profileSidecarStorageKey',
      'profileReadback',
    ]) ||
    !isNonEmptyString(value.key) ||
    (value.entityKind !== 'plan' && value.entityKind !== 'log') ||
    value.key.split(':', 1)[0] !== value.entityKind ||
    !isNonEmptyString(value.payloadBytes) ||
    !isNonEmptyString(value.localRecordBytes) ||
    !SHA256_PATTERN.test(String(value.localRecordSha256)) ||
    (value.sourceRecordBytes !== undefined &&
      !isNonEmptyString(value.sourceRecordBytes)) ||
    (value.sourceRecordSha256 !== undefined &&
      !SHA256_PATTERN.test(String(value.sourceRecordSha256))) ||
    !isOptionalNonEmptyString(value.label) ||
    !isOptionalString(value.profileBytes) ||
    !isOptionalNonEmptyString(value.profileSidecarStorageKey) ||
    (value.profileBytes !== undefined &&
      value.profileSidecarStorageKey !== undefined) ||
    (schemaVersion === LEGACY_SIDECAR_SCHEMA_VERSION &&
      value.profileSidecarStorageKey !== undefined) ||
    (schemaVersion === SIDECAR_SCHEMA_VERSION &&
      value.profileBytes !== undefined)
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
    ...(value.sourceRecordBytes === undefined
      ? {}
      : {sourceRecordBytes: value.sourceRecordBytes}),
    ...(value.sourceRecordSha256 === undefined
      ? {}
      : {sourceRecordSha256: value.sourceRecordSha256 as string}),
    ...(value.label === undefined ? {} : { label: value.label }),
    ...(value.profileBytes === undefined
      ? {}
      : { profileBytes: value.profileBytes }),
    ...(value.profileSidecarStorageKey === undefined
      ? {}
      : {profileSidecarStorageKey: value.profileSidecarStorageKey}),
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
  schemaVersion: GuestClaimSnapshot['schemaVersion'],
  compactCommittedReceipt = false,
): void {
  if (compactCommittedReceipt) {
    return;
  }
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
        sidecar.localRecordBytes ||
      digestUtf8(sourceRecordBytes(sidecar)) !== sourceRecordSha256(sidecar) ||
      canonicalJson(parseJson(sourceRecordBytes(sidecar))) !==
        sourceRecordBytes(sidecar)
    ) {
      throw new GuestClaimStorageError();
    }
    const local = parseSnapshotLocalRecord(sidecar);
    const source =
      sidecar.entityKind === 'log'
        ? parseLocalLog(sourceRecordBytes(sidecar))
        : parseLocalPlan(sourceRecordBytes(sidecar));
    if (
      local.localId !== item.clientRecordId ||
      source.localId !== item.clientRecordId
    ) {
      throw new GuestClaimStorageError();
    }
    if (item.entityKind === 'plan') {
      const plan = local as DivePlan;
      if (
        plan.convertedLogLocalId !== item.convertedLogClientRecordId ||
        canonicalJson(mapPlanPayload(plan).payload) !== sidecar.payloadBytes ||
        sidecar.profileBytes !== undefined ||
        sidecar.profileSidecarStorageKey !== undefined ||
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
        sidecar.profileSidecarStorageKey !== undefined ||
        sidecar.profileReadback !== undefined ||
        canonicalJson(mapLogPayload(boundedLogForPayload(log), manifest.userId).payload) !==
          sidecar.payloadBytes
      ) {
        throw new GuestClaimStorageError();
      }
      continue;
    }
    const reference = log.watchCapture?.profile;
    const hasExpectedProfileSnapshot =
      schemaVersion === LEGACY_SIDECAR_SCHEMA_VERSION
        ? sidecar.profileBytes !== undefined &&
          sidecar.profileSidecarStorageKey === undefined
        : sidecar.profileBytes === undefined &&
          sidecar.profileSidecarStorageKey ===
            claimProfileSidecarKey(
              manifest.userId,
              item.clientRecordId,
              item.profile.contentRevision,
              item.profile.sha256,
            );
    if (
      !hasExpectedProfileSnapshot ||
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
    const profileByteCount = payload.profile_byte_count;
    if (!isNonNegativeInteger(profileByteCount)) {
      throw new GuestClaimStorageError();
    }
    const verified =
      sidecar.profileBytes === undefined
        ? undefined
        : verifyProfileBytesSnapshot(sidecar.profileBytes, {
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
          profileByteCount,
        ).payload,
      ) !== sidecar.payloadBytes
    ) {
      throw new GuestClaimStorageError();
    }
    if (
      sidecar.profileReadback !== undefined &&
      (!isClaimProfileReadbackPath(
        sidecar.profileReadback.path,
        manifest,
        item.profile.contentRevision,
      ) ||
        sidecar.profileReadback.sha256 !== item.profile.sha256 ||
        sidecar.profileReadback.sampleCount !== item.profile.sampleCount ||
        sidecar.profileReadback.byteCount !== profileByteCount ||
        (verified !== undefined &&
          (sidecar.profileReadback.sha256 !== verified.sha256 ||
            sidecar.profileReadback.sampleCount !== verified.sampleCount)) ||
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

function isClaimProfileReadbackPath(
  path: string,
  manifest: GuestClaimManifest,
  contentRevision: string,
): boolean {
  const segments = path.split('/');
  return (
    manifest.remoteBatchId !== undefined &&
    !path.includes('\\') &&
    segments.length === 5 &&
    segments[0] === manifest.userId &&
    segments[1] === 'claims' &&
    segments[2] === manifest.remoteBatchId &&
    UUID_PATTERN.test(segments[3] ?? '') &&
    segments[4] === `${encodeURIComponent(contentRevision)}.json`
  );
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
  const includesSourceRecordEvidence = value.snapshots.every(
    sidecar => sidecar.sourceRecordSha256 !== undefined,
  );
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
      ...(includesSourceRecordEvidence
        ? {sourceRecordSha256: sidecar.sourceRecordSha256}
        : {}),
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

export function isGuestProfileStorageKey(storageKey: string): boolean {
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
