import {sha256} from '@noble/hashes/sha256';
import {
  bytesToHex,
  bytesToUtf8,
  utf8ToBytes,
} from '@noble/hashes/utils';
import type {
  AccountDataCursor,
  AccountDataRepository,
  AccountMutationResult,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';

import type {DiveLogRepository} from '../repositories/dive-log-repository';
import {
  DIVE_LOGBOOK_SCHEMA_VERSION,
  parseDiveLogbookEnvelope,
} from '../repositories/persistent-dive-log-repository';
import type {DivePlanRepository} from '../repositories/dive-plan-repository';
import {
  DIVE_PLANBOOK_SCHEMA_VERSION,
  parseDivePlanbookEnvelope,
} from '../repositories/persistent-dive-plan-repository';
import {dataProfileKeyPrefix} from '../storage/data-principal';
import type {WatchProfileStorage} from '../storage/watch-profile-storage';
import type {DiveLogEntry} from '../types/dive-log-entry';
import type {DivePlan} from '../types/dive-plan';
import type {WatchDepthSample} from '../types/dive-session';
import {parseWatchSyncMessageValue} from '../utils/watch-sync-message-validation';
import {
  type AccountOutboxItem,
  AccountOutbox,
} from './account-outbox';

export type AccountSyncDrainResult = {
  processed: number;
  remaining: number;
};

export type AccountProfileUploader = {
  uploadProfile(path: string, bytes: Uint8Array): Promise<void>;
};

export type AccountProfileDownloader = {
  downloadProfile(path: string): Promise<Uint8Array>;
};

type ScheduledAccountSync = {
  cancel(): void;
};

type AccountSyncCoordinatorOptions = {
  userId: string;
  outbox: AccountOutbox;
  accountRepository: AccountDataRepository;
  logbookRepository: DiveLogRepository;
  planRepository: DivePlanRepository;
  profileUploader?: AccountProfileUploader;
  profileDownloader?: AccountProfileDownloader;
  profileStorage?: WatchProfileStorage;
  now?: () => number;
  schedule?: (
    task: () => void,
    delayMs: number,
  ) => ScheduledAccountSync;
  onDidProcess?: () => void | Promise<void>;
};

type DrainOptions = {
  online: boolean;
};

type UserDrainState = {
  active?: Promise<AccountSyncDrainResult>;
  rerunRequested: boolean;
  online: boolean;
  coordinator?: AccountSyncCoordinator;
  scheduled?: ScheduledAccountSync;
};

const MAXIMUM_OPERATIONS_PER_PASS = 10;
const PAGE_SIZE = 100;
const drainStateByUser = new Map<string, UserDrainState>();
const entityMutationQueues = new Map<string, Promise<void>>();

export class AccountSyncCoordinator {
  private readonly userId: string;
  private readonly outbox: AccountOutbox;
  private readonly accountRepository: AccountDataRepository;
  private readonly logbookRepository: DiveLogRepository;
  private readonly planRepository: DivePlanRepository;
  private readonly profileUploader?: AccountProfileUploader;
  private readonly profileDownloader?: AccountProfileDownloader;
  private readonly profileStorage?: WatchProfileStorage;
  private readonly now: () => number;
  private readonly schedule: (
    task: () => void,
    delayMs: number,
  ) => ScheduledAccountSync;
  private onDidProcess?: () => void | Promise<void>;

  constructor(options: AccountSyncCoordinatorOptions) {
    this.userId = options.userId;
    this.outbox = options.outbox;
    this.accountRepository = options.accountRepository;
    this.logbookRepository = options.logbookRepository;
    this.planRepository = options.planRepository;
    this.profileUploader = options.profileUploader;
    this.profileDownloader = options.profileDownloader;
    this.profileStorage = options.profileStorage;
    this.now = options.now ?? (() => Date.now() / 1_000);
    this.schedule = options.schedule ?? defaultSchedule;
    this.onDidProcess = options.onDidProcess;
  }

  setOnDidProcess(listener: (() => void | Promise<void>) | undefined): void {
    this.onDidProcess = listener;
  }

  drain(options: DrainOptions): Promise<AccountSyncDrainResult> {
    if (!options.online) {
      this.pause();
      return this.outbox.list(this.userId).then(items => ({
        processed: 0,
        remaining: items.length,
      }));
    }

    const state = getDrainState(this.userId);
    state.online = true;
    state.coordinator = this;
    if (state.active) {
      state.rerunRequested = true;
      return state.active;
    }

    state.scheduled?.cancel();
    state.scheduled = undefined;
    let active!: Promise<AccountSyncDrainResult>;
    active = (async () => {
      let processed = 0;
      let remaining = 0;
      try {
        do {
          state.rerunRequested = false;
          const result = await this.drainPass();
          processed += result.processed;
          remaining = result.remaining;
          if (result.processed > 0) {
            await this.onDidProcess?.();
          }
        } while (state.online && state.rerunRequested);
        return {processed, remaining};
      } finally {
        try {
          if (state.online && state.coordinator === this) {
            await this.scheduleNextPass(state);
          }
        } finally {
          if (state.active === active) {
            state.active = undefined;
          }
          cleanupDrainState(this.userId, state);
        }
      }
    })();
    state.active = active;
    return active;
  }

  pause(): void {
    const state = drainStateByUser.get(this.userId);
    if (!state || state.coordinator !== this) {
      return;
    }
    state.online = false;
    state.rerunRequested = false;
    state.scheduled?.cancel();
    state.scheduled = undefined;
    cleanupDrainState(this.userId, state);
  }

  async hydrate(options: DrainOptions): Promise<number> {
    if (!options.online) {
      return 0;
    }

    const [logs, plans] = await Promise.all([
      collectPages(cursor =>
        this.accountRepository.listLogs({cursor, limit: PAGE_SIZE}),
      ),
      collectPages(cursor =>
        this.accountRepository.listPlans({cursor, limit: PAGE_SIZE}),
      ),
    ]);
    let changed = 0;

    for (const remoteValue of plans) {
      const remote = parseRemotePlan(remoteValue);
      changed += await withAccountEntityMutationLock(
        this.userId,
        'plan',
        remote.localId,
        async () => {
          if (
            (await this.outbox.listEntity(
              this.userId,
              'plan',
              remote.localId,
            )).length > 0
          ) {
            return 0;
          }
          const current = await this.planRepository.get(remote.localId);
          if (isLocallyAuthoritative(current)) {
            return 0;
          }
          const local = remotePlanToLocal(remote, this.userId);
          if (sameJsonValue(current, local)) {
            return 0;
          }
          await this.planRepository.save(local);
          return 1;
        },
      );
    }
    for (const remoteValue of logs) {
      const remote = parseRemoteLog(remoteValue);
      changed += await withAccountEntityMutationLock(
        this.userId,
        'log',
        remote.localId,
        async () => {
          if (
            (await this.outbox.listEntity(
              this.userId,
              'log',
              remote.localId,
            )).length > 0
          ) {
            return 0;
          }
          const current = await this.logbookRepository.get(remote.localId);
          if (isLocallyAuthoritative(current)) {
            return 0;
          }
          const local = await this.prepareHydratedLog(remote);
          if (sameJsonValue(current, local)) {
            return 0;
          }
          await this.logbookRepository.save(local);
          return 1;
        },
      );
    }
    return changed;
  }

  private async drainPass(): Promise<AccountSyncDrainResult> {
    const dueHeads = entityHeads(await this.outbox.list(this.userId))
      .filter(item => item.nextAttemptAt <= this.now())
      .slice(0, MAXIMUM_OPERATIONS_PER_PASS);
    let processed = 0;

    for (const selected of dueHeads) {
      const [head] = await this.outbox.listEntity(
        selected.userId,
        selected.entityKind,
        selected.entityLocalId,
      );
      if (
        !head ||
        head.operationId !== selected.operationId ||
        head.nextAttemptAt > this.now()
      ) {
        continue;
      }
      try {
        await this.deliver(head);
        processed += 1;
      } catch {
        await this.outbox.reschedule(head.userId, head.operationId);
      }
    }

    return {
      processed,
      remaining: (await this.outbox.list(this.userId)).length,
    };
  }

  private async scheduleNextPass(state: UserDrainState): Promise<void> {
    const heads = entityHeads(await this.outbox.list(this.userId));
    if (heads.length === 0) {
      return;
    }
    const nextAttemptAt = Math.min(...heads.map(item => item.nextAttemptAt));
    const delayMs = Math.min(
      2_147_483_647,
      Math.max(0, Math.round((nextAttemptAt - this.now()) * 1_000)),
    );
    state.scheduled?.cancel();
    state.scheduled = this.schedule(() => {
      if (state.scheduled) {
        state.scheduled = undefined;
      }
      if (state.online && state.coordinator) {
        void state.coordinator.drain({online: true});
      }
    }, delayMs);
  }

  private deliver(item: AccountOutboxItem): Promise<void> {
    if (item.userId !== this.userId) {
      throw new Error('Account outbox operation belongs to another user');
    }
    return withAccountEntityMutationLock(
      item.userId,
      item.entityKind,
      item.entityLocalId,
      () =>
        item.entityKind === 'log'
          ? this.deliverLog(item)
          : this.deliverPlan(item),
    );
  }

  private async deliverLog(item: AccountOutboxItem): Promise<void> {
    const local = requiredLocalLog(item.payload);
    const remote = requiredRemoteLog(item.payload);
    assertOperationEntity(item, local.localId, remote.localId);
    let result: AccountMutationResult<RemoteDiveLog>;

    if (item.mutation === 'delete') {
      if (item.expectedRevision === undefined) {
        throw new Error('Delete operation is missing its expected revision');
      }
      result = await this.accountRepository.deleteLog(
        remote.id,
        item.expectedRevision,
      );
    } else {
      if (item.profileStorageKey !== undefined) {
        if (!remote.profilePath || !this.profileUploader) {
          throw new Error('Profile delivery is unavailable');
        }
        const serialized = await this.outbox.readProfileSnapshot(item);
        if (serialized === undefined) {
          throw new Error('Account outbox profile snapshot is missing');
        }
        const bytes = validateSerializedProfile(
          serialized,
          remote,
          local.watchCapture?.session.localSessionId,
        );
        await this.profileUploader.uploadProfile(remote.profilePath, bytes);
      }
      result = await this.saveLogWithRecovery(remote, item.expectedRevision);
    }

    if (result.status === 'conflict') {
      const current = await this.logbookRepository.get(item.entityLocalId);
      if (item.mutation === 'delete' && current === undefined) {
        await this.outbox.complete(item.userId, item.operationId);
        return;
      }
      if (!current) {
        throw new Error('Current local log is missing during conflict');
      }
      const conflicted = {...current, cloudSyncStatus: 'conflict' as const};
      await this.logbookRepository.save(conflicted);
      await this.outbox.recordConflict(
        item,
        localAsRecord(conflicted),
        remoteAsRecord(result.remote),
      );
      return;
    }

    if (item.mutation === 'upsert') {
      const current = await this.logbookRepository.get(item.entityLocalId);
      if (!current) {
        throw new Error('Current local log is missing after remote save');
      }
      const hasPendingEdit = await this.hasLaterUpsert(item);
      await this.logbookRepository.save({
        ...current,
        remoteId: result.value.id,
        remoteRevision: result.value.revision,
        ownerUserId: this.userId,
        cloudSyncStatus: hasPendingEdit ? 'pending' : 'synced',
      });
      await this.outbox.completeSavedUpsert(item, result.value.revision);
      return;
    }
    await this.logbookRepository.delete(item.entityLocalId);
    await this.outbox.complete(item.userId, item.operationId);
  }

  private async deliverPlan(item: AccountOutboxItem): Promise<void> {
    const local = requiredLocalPlan(item.payload);
    const remote = requiredRemotePlan(item.payload);
    assertOperationEntity(item, local.localId, remote.localId);
    let result: AccountMutationResult<RemoteDivePlan>;

    if (item.mutation === 'delete') {
      if (item.expectedRevision === undefined) {
        throw new Error('Delete operation is missing its expected revision');
      }
      result = await this.accountRepository.deletePlan(
        remote.id,
        item.expectedRevision,
      );
    } else {
      result = await this.savePlanWithRecovery(remote, item.expectedRevision);
    }

    if (result.status === 'conflict') {
      const current = await this.planRepository.get(item.entityLocalId);
      if (item.mutation === 'delete' && current === undefined) {
        await this.outbox.complete(item.userId, item.operationId);
        return;
      }
      if (!current) {
        throw new Error('Current local plan is missing during conflict');
      }
      const conflicted = {...current, cloudSyncStatus: 'conflict' as const};
      await this.planRepository.save(conflicted);
      await this.outbox.recordConflict(
        item,
        localAsRecord(conflicted),
        remoteAsRecord(result.remote),
      );
      return;
    }

    if (item.mutation === 'upsert') {
      const current = await this.planRepository.get(item.entityLocalId);
      if (!current) {
        throw new Error('Current local plan is missing after remote save');
      }
      const hasPendingEdit = await this.hasLaterUpsert(item);
      await this.planRepository.save({
        ...current,
        remoteId: result.value.id,
        remoteRevision: result.value.revision,
        ownerUserId: this.userId,
        cloudSyncStatus: hasPendingEdit ? 'pending' : 'synced',
      });
      await this.outbox.completeSavedUpsert(item, result.value.revision);
      return;
    }
    await this.planRepository.delete(item.entityLocalId);
    await this.outbox.complete(item.userId, item.operationId);
  }

  private async hasLaterUpsert(item: AccountOutboxItem): Promise<boolean> {
    const operations = await this.outbox.listEntity(
      item.userId,
      item.entityKind,
      item.entityLocalId,
    );
    const operationIndex = operations.findIndex(
      operation => operation.operationId === item.operationId,
    );
    return (
      operationIndex >= 0 &&
      operations
        .slice(operationIndex + 1)
        .some(operation => operation.mutation === 'upsert')
    );
  }

  private async saveLogWithRecovery(
    remote: RemoteDiveLog,
    expectedRevision: number | undefined,
  ): Promise<AccountMutationResult<RemoteDiveLog>> {
    try {
      return await this.accountRepository.saveLog(remote, expectedRevision);
    } catch (error) {
      const recovered = await this.findRemoteLog(remote).catch(() => undefined);
      if (recovered) {
        return {status: 'saved', value: recovered};
      }
      throw error;
    }
  }

  private async savePlanWithRecovery(
    remote: RemoteDivePlan,
    expectedRevision: number | undefined,
  ): Promise<AccountMutationResult<RemoteDivePlan>> {
    try {
      return await this.accountRepository.savePlan(remote, expectedRevision);
    } catch (error) {
      const recovered = await this.findRemotePlan(remote).catch(() => undefined);
      if (recovered) {
        return {status: 'saved', value: recovered};
      }
      throw error;
    }
  }

  private async findRemoteLog(
    expected: RemoteDiveLog,
  ): Promise<RemoteDiveLog | undefined> {
    const logs = await collectPages(cursor =>
      this.accountRepository.listLogs({cursor, limit: PAGE_SIZE}),
    );
    return logs
      .map(parseRemoteLog)
      .find(remote => sameRemoteLogMutation(remote, expected));
  }

  private async findRemotePlan(
    expected: RemoteDivePlan,
  ): Promise<RemoteDivePlan | undefined> {
    const plans = await collectPages(cursor =>
      this.accountRepository.listPlans({cursor, limit: PAGE_SIZE}),
    );
    return plans
      .map(parseRemotePlan)
      .find(remote => sameRemotePlanMutation(remote, expected));
  }

  private async prepareHydratedLog(remote: RemoteDiveLog): Promise<DiveLogEntry> {
    if (remote.profilePath === undefined) {
      return remoteLogToLocal(remote, this.userId);
    }
    if (!this.profileDownloader || !this.profileStorage) {
      throw new Error('Remote profile hydration is unavailable');
    }
    if (!remote.profilePath.startsWith(`${this.userId}/logs/${remote.id}/`)) {
      throw new Error('Malformed remote log profile path');
    }

    const descriptor = remoteProfileDescriptor(remote);
    const bytes = await this.profileDownloader.downloadProfile(remote.profilePath);
    if (bytes.length !== descriptor.byteCount) {
      throw new Error('Malformed remote log profile byte count');
    }
    if (bytesToHex(sha256(bytes)) !== descriptor.sha256) {
      throw new Error('Malformed remote log profile digest');
    }
    const watchMetadata = requiredRecord(
      remote.payload.watch_metadata,
      'watch_metadata',
    );
    const session = requiredRecord(watchMetadata.session, 'watch session');
    const localSessionId = requiredString(
      session.localSessionId,
      'watch localSessionId',
    );
    const samples = parseProfileSamples(bytesToUtf8(bytes), localSessionId);
    if (samples.length !== descriptor.sampleCount) {
      throw new Error('Malformed remote log profile sample count');
    }

    const storageKey = `${dataProfileKeyPrefix({
      kind: 'user',
      userId: this.userId,
    })}remote:${encodeURIComponent(remote.id)}:${encodeURIComponent(
      descriptor.contentRevision,
    )}`;
    const local = remoteLogToLocal(remote, this.userId, {
      storageKey,
      contentRevision: descriptor.contentRevision,
      sampleCount: descriptor.sampleCount,
      sha256: descriptor.sha256,
    });
    await this.profileStorage.write(storageKey, samples);
    return local;
  }
}

export function withAccountEntityMutationLock<T>(
  userId: string,
  entityKind: AccountOutboxItem['entityKind'],
  entityLocalId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${userId}\u0000${entityKind}\u0000${entityLocalId}`;
  const previous = entityMutationQueues.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  entityMutationQueues.set(key, tail);
  void tail.finally(() => {
    if (entityMutationQueues.get(key) === tail) {
      entityMutationQueues.delete(key);
    }
  });
  return result;
}

async function collectPages<T>(
  list: (cursor?: AccountDataCursor) => Promise<{
    items: T[];
    nextCursor?: AccountDataCursor;
  }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: AccountDataCursor | undefined;
  do {
    const page = await list(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return items;
}

function requiredLocalLog(payload: Record<string, unknown>): DiveLogEntry {
  assertOperationPayload(payload);
  try {
    const [local] = parseDiveLogbookEnvelope(
      JSON.stringify({
        schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
        updatedAt: 0,
        value: [payload.local],
      }),
      'account outbox log payload',
    );
    if (!local) {
      throw new Error('missing log');
    }
    return local;
  } catch (error) {
    throw new Error(`Malformed local log payload: ${errorMessage(error)}`);
  }
}

function requiredRemoteLog(payload: Record<string, unknown>): RemoteDiveLog {
  assertOperationPayload(payload);
  return parseRemoteLog(payload.remote);
}

function requiredLocalPlan(payload: Record<string, unknown>): DivePlan {
  assertOperationPayload(payload);
  try {
    const [local] = parseDivePlanbookEnvelope(
      JSON.stringify({
        schemaVersion: DIVE_PLANBOOK_SCHEMA_VERSION,
        updatedAt: 0,
        value: [payload.local],
      }),
      'account outbox plan payload',
    );
    if (!local) {
      throw new Error('missing plan');
    }
    return local;
  } catch (error) {
    throw new Error(`Malformed local plan payload: ${errorMessage(error)}`);
  }
}

function requiredRemotePlan(payload: Record<string, unknown>): RemoteDivePlan {
  assertOperationPayload(payload);
  return parseRemotePlan(payload.remote);
}

function parseRemoteLog(value: unknown): RemoteDiveLog {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'localId',
      'revision',
      'payloadSha256',
      'payload',
      'profilePath',
    ]) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.localId) ||
    !isPositiveInteger(value.revision) ||
    !isSha256(value.payloadSha256) ||
    !isRecord(value.payload) ||
    (value.profilePath !== undefined && !isNonEmptyString(value.profilePath))
  ) {
    throw new Error('Malformed remote log payload');
  }
  return {
    id: value.id,
    localId: value.localId,
    revision: value.revision,
    payloadSha256: value.payloadSha256,
    payload: cloneRecord(value.payload),
    ...(value.profilePath === undefined
      ? {}
      : {profilePath: value.profilePath}),
  };
}

function parseRemotePlan(value: unknown): RemoteDivePlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'localId',
      'revision',
      'payloadSha256',
      'payload',
    ]) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.localId) ||
    !isPositiveInteger(value.revision) ||
    !isSha256(value.payloadSha256) ||
    !isRecord(value.payload)
  ) {
    throw new Error('Malformed remote plan payload');
  }
  return {
    id: value.id,
    localId: value.localId,
    revision: value.revision,
    payloadSha256: value.payloadSha256,
    payload: cloneRecord(value.payload),
  };
}

function remoteLogToLocal(
  remote: RemoteDiveLog,
  userId: string,
  profile?: NonNullable<DiveLogEntry['watchCapture']>['profile'],
): DiveLogEntry {
  try {
    const payload = remote.payload;
    const storedManual = requiredRecord(payload.manual_data, 'manual_data');
    const localRecord = optionalLocalRecord(storedManual._local_record);
    const manual = cloneRecord(storedManual);
    delete manual._local_record;
    const startedAt = requiredTimestampSeconds(payload.started_at, 'started_at');
    const watchCapture = localWatchMetadata(payload.watch_metadata, profile);
    const candidate: Record<string, unknown> = {
      localId: remote.localId,
      remoteId: remote.id,
      remoteRevision: remote.revision,
      ownerUserId: userId,
      source: payload.source,
      cloudSyncStatus: 'synced',
      createdAt: localRecord?.createdAt ?? startedAt,
      updatedAt: localRecord?.updatedAt ?? startedAt,
      manual,
      mobile: requiredRecord(payload.mobile_data, 'mobile_data'),
      provenance: requiredRecord(payload.provenance, 'provenance'),
      ...(watchCapture === undefined ? {} : {watchCapture}),
    };
    if (
      candidate.source !== 'manual' &&
      candidate.source !== 'watch'
    ) {
      throw new Error('invalid source');
    }
    if (candidate.source === 'watch' && watchCapture === undefined) {
      throw new Error('missing watch metadata');
    }
    const [local] = parseDiveLogbookEnvelope(
      JSON.stringify({
        schemaVersion: DIVE_LOGBOOK_SCHEMA_VERSION,
        updatedAt: 0,
        value: [candidate],
      }),
      `remote log ${remote.id}`,
    );
    if (!local) {
      throw new Error('missing parsed log');
    }
    return local;
  } catch (error) {
    throw new Error(`Malformed remote log ${remote.id}: ${errorMessage(error)}`);
  }
}

function localWatchMetadata(
  value: unknown,
  profile?: NonNullable<DiveLogEntry['watchCapture']>['profile'],
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    if (profile !== undefined) {
      throw new Error('profile without watch metadata');
    }
    return undefined;
  }
  const metadata = requiredRecord(value, 'watch_metadata');
  const remoteProfile = metadata.profile;
  if (profile === undefined && remoteProfile !== undefined && remoteProfile !== null) {
    throw new Error('profile metadata without profile object');
  }
  if (profile !== undefined) {
    if (
      !isRecord(remoteProfile) ||
      !hasExactKeys(remoteProfile, [
        'contentRevision',
        'sampleCount',
        'sha256',
      ]) ||
      remoteProfile.contentRevision !== profile.contentRevision ||
      remoteProfile.sampleCount !== profile.sampleCount ||
      remoteProfile.sha256 !== profile.sha256
    ) {
      throw new Error('inconsistent watch profile metadata');
    }
  }
  return {
    ...cloneRecord(metadata),
    ...(profile === undefined ? {} : {profile}),
  };
}

function remotePlanToLocal(remote: RemoteDivePlan, userId: string): DivePlan {
  try {
    const planData = requiredRecord(remote.payload.plan_data, 'plan_data');
    const candidate = {
      ...cloneRecord(planData),
      localId: remote.localId,
      remoteId: remote.id,
      remoteRevision: remote.revision,
      ownerUserId: userId,
      cloudSyncStatus: 'synced',
    };
    const [local] = parseDivePlanbookEnvelope(
      JSON.stringify({
        schemaVersion: DIVE_PLANBOOK_SCHEMA_VERSION,
        updatedAt: 0,
        value: [candidate],
      }),
      `remote plan ${remote.id}`,
    );
    if (!local) {
      throw new Error('missing parsed plan');
    }
    return local;
  } catch (error) {
    throw new Error(`Malformed remote plan ${remote.id}: ${errorMessage(error)}`);
  }
}

function remoteProfileDescriptor(remote: RemoteDiveLog): {
  contentRevision: string;
  sha256: string;
  byteCount: number;
  sampleCount: number;
} {
  const contentRevision = requiredString(
    remote.payload.profile_content_revision,
    'profile_content_revision',
  );
  const profileSha256 = remote.payload.profile_sha256;
  const byteCount = remote.payload.profile_byte_count;
  const sampleCount = remote.payload.profile_sample_count;
  if (
    !isSha256(profileSha256) ||
    !isNonNegativeInteger(byteCount) ||
    !isNonNegativeInteger(sampleCount)
  ) {
    throw new Error('Malformed remote log profile metadata');
  }
  return {contentRevision, sha256: profileSha256, byteCount, sampleCount};
}

function validateSerializedProfile(
  serialized: string,
  remote: RemoteDiveLog,
  localSessionId: string | undefined,
): Uint8Array {
  if (!localSessionId) {
    throw new Error('Profile operation is missing its local session id');
  }
  const descriptor = remoteProfileDescriptor(remote);
  const bytes = utf8ToBytes(serialized);
  if (bytes.length !== descriptor.byteCount) {
    throw new Error('Account outbox profile byte count mismatch');
  }
  if (bytesToHex(sha256(bytes)) !== descriptor.sha256) {
    throw new Error('Account outbox profile digest mismatch');
  }
  const samples = parseProfileSamples(serialized, localSessionId);
  if (samples.length !== descriptor.sampleCount) {
    throw new Error('Account outbox profile sample count mismatch');
  }
  return bytes;
}

function parseProfileSamples(
  serialized: string,
  localSessionId: string,
): WatchDepthSample[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error('Malformed account profile JSON');
  }
  const result = parseWatchSyncMessageValue({
    type: 'sessionEnded',
    session: {localSessionId, startedAt: 0, samples: parsed},
  });
  if (
    !result.ok ||
    result.message.session.samples.some(
      sample => sample.localSessionId !== localSessionId,
    )
  ) {
    throw new Error('Malformed account profile samples');
  }
  return result.message.session.samples.map(sample => ({...sample}));
}

function optionalLocalRecord(
  value: unknown,
): {createdAt: number; updatedAt: number} | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['createdAt', 'updatedAt']) ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt)
  ) {
    throw new Error('Malformed remote _local_record');
  }
  return {createdAt: value.createdAt, updatedAt: value.updatedAt};
}

function assertOperationPayload(
  payload: Record<string, unknown>,
): asserts payload is {local: unknown; remote: unknown} {
  if (!hasExactKeys(payload, ['local', 'remote'])) {
    throw new Error('Malformed account operation payload');
  }
}

function assertOperationEntity(
  item: AccountOutboxItem,
  localId: string,
  remoteLocalId: string,
): void {
  if (
    item.entityLocalId !== localId ||
    item.entityLocalId !== remoteLocalId
  ) {
    throw new Error('Account operation entity ids do not match');
  }
}

function entityHeads(items: readonly AccountOutboxItem[]): AccountOutboxItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.entityKind}\u0000${item.entityLocalId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isLocallyAuthoritative(
  value: DiveLogEntry | DivePlan | undefined,
): boolean {
  return (
    value?.cloudSyncStatus === 'pending' ||
    value?.cloudSyncStatus === 'conflict'
  );
}

function sameRemoteLogMutation(
  left: RemoteDiveLog,
  right: RemoteDiveLog,
): boolean {
  return (
    left.id === right.id &&
    left.localId === right.localId &&
    left.payloadSha256 === right.payloadSha256 &&
    left.profilePath === right.profilePath
  );
}

function sameRemotePlanMutation(
  left: RemoteDivePlan,
  right: RemoteDivePlan,
): boolean {
  return (
    left.id === right.id &&
    left.localId === right.localId &&
    left.payloadSha256 === right.payloadSha256
  );
}

function remoteAsRecord(
  remote: RemoteDiveLog | RemoteDivePlan,
): Record<string, unknown> {
  return cloneRecord(remote as unknown as Record<string, unknown>);
}

function localAsRecord(local: DiveLogEntry | DivePlan): Record<string, unknown> {
  return cloneRecord(local as unknown as Record<string, unknown>);
}

function requiredRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Malformed remote ${field}`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (!isNonEmptyString(value)) {
    throw new Error(`Malformed remote ${field}`);
  }
  return value;
}

function requiredTimestampSeconds(value: unknown, field: string): number {
  if (typeof value !== 'string') {
    throw new Error(`Malformed remote ${field}`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Malformed remote ${field}`);
  }
  return milliseconds / 1_000;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, nested]) =>
          `${JSON.stringify(key)}:${canonicalStringify(nested)}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function getDrainState(userId: string): UserDrainState {
  const existing = drainStateByUser.get(userId);
  if (existing) {
    return existing;
  }
  const created: UserDrainState = {rerunRequested: false, online: false};
  drainStateByUser.set(userId, created);
  return created;
}

function cleanupDrainState(userId: string, state: UserDrainState): void {
  if (!state.active && !state.scheduled && !state.online) {
    if (drainStateByUser.get(userId) === state) {
      drainStateByUser.delete(userId);
    }
  }
}

function defaultSchedule(
  task: () => void,
  delayMs: number,
): ScheduledAccountSync {
  const timeout = setTimeout(task, delayMs);
  return {cancel: () => clearTimeout(timeout)};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasExactKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(record);
  return (
    keys.length === expectedKeys.length &&
    keys.every(key => expectedKeys.includes(key))
  );
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(record).every(key => allowedKeys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
