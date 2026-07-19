import {utf8ToBytes} from '@noble/hashes/utils';
import type {
  AccountDataCursor,
  AccountDataRepository,
  AccountMutationResult,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';

import type {DiveLogRepository} from '../repositories/dive-log-repository';
import type {DivePlanRepository} from '../repositories/dive-plan-repository';
import type {DiveLogEntry} from '../types/dive-log-entry';
import type {DivePlan} from '../types/dive-plan';
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

type AccountSyncCoordinatorOptions = {
  userId: string;
  outbox: AccountOutbox;
  accountRepository: AccountDataRepository;
  logbookRepository: DiveLogRepository;
  planRepository: DivePlanRepository;
  profileUploader?: AccountProfileUploader;
  now?: () => number;
};

type DrainOptions = {
  online: boolean;
};

const MAXIMUM_OPERATIONS_PER_PASS = 10;
const PAGE_SIZE = 100;
const inFlightByUser = new Map<string, Promise<AccountSyncDrainResult>>();

export class AccountSyncCoordinator {
  private readonly userId: string;
  private readonly outbox: AccountOutbox;
  private readonly accountRepository: AccountDataRepository;
  private readonly logbookRepository: DiveLogRepository;
  private readonly planRepository: DivePlanRepository;
  private readonly profileUploader?: AccountProfileUploader;
  private readonly now: () => number;

  constructor(options: AccountSyncCoordinatorOptions) {
    this.userId = options.userId;
    this.outbox = options.outbox;
    this.accountRepository = options.accountRepository;
    this.logbookRepository = options.logbookRepository;
    this.planRepository = options.planRepository;
    this.profileUploader = options.profileUploader;
    this.now = options.now ?? (() => Date.now() / 1_000);
  }

  drain(options: DrainOptions): Promise<AccountSyncDrainResult> {
    if (!options.online) {
      return this.outbox.list(this.userId).then(items => ({
        processed: 0,
        remaining: items.length,
      }));
    }

    const current = inFlightByUser.get(this.userId);
    if (current) {
      return current;
    }

    const result = this.drainPass();
    inFlightByUser.set(this.userId, result);
    void result.then(
      () => clearInFlight(this.userId, result),
      () => clearInFlight(this.userId, result),
    );
    return result;
  }

  async hydrate(options: DrainOptions): Promise<void> {
    if (!options.online) {
      return;
    }

    const [logs, plans] = await Promise.all([
      collectPages(cursor => this.accountRepository.listLogs({cursor, limit: PAGE_SIZE})),
      collectPages(cursor => this.accountRepository.listPlans({cursor, limit: PAGE_SIZE})),
    ]);

    for (const remote of plans) {
      const current = await this.planRepository.get(remote.localId);
      if (current?.cloudSyncStatus === 'pending' || current?.cloudSyncStatus === 'conflict') {
        continue;
      }
      await this.planRepository.save(remotePlanToLocal(remote, this.userId));
    }
    for (const remote of logs) {
      const current = await this.logbookRepository.get(remote.localId);
      if (current?.cloudSyncStatus === 'pending' || current?.cloudSyncStatus === 'conflict') {
        continue;
      }
      await this.logbookRepository.save(remoteLogToLocal(remote, this.userId));
    }
  }

  private async drainPass(): Promise<AccountSyncDrainResult> {
    const dueOperationIds = (await this.outbox.list(this.userId))
      .filter(item => item.nextAttemptAt <= this.now())
      .slice(0, MAXIMUM_OPERATIONS_PER_PASS)
      .map(item => item.operationId);
    let processed = 0;

    for (const operationId of dueOperationIds) {
      const item = (await this.outbox.list(this.userId)).find(
        candidate => candidate.operationId === operationId,
      );
      if (!item || item.nextAttemptAt > this.now()) {
        continue;
      }
      try {
        await this.deliver(item);
        processed += 1;
      } catch {
        await this.outbox.reschedule(item.operationId);
      }
    }

    return {
      processed,
      remaining: (await this.outbox.list(this.userId)).length,
    };
  }

  private async deliver(item: AccountOutboxItem): Promise<void> {
    if (item.userId !== this.userId) {
      return;
    }

    if (item.entityKind === 'log') {
      await this.deliverLog(item);
    } else {
      await this.deliverPlan(item);
    }
  }

  private async deliverLog(item: AccountOutboxItem): Promise<void> {
    const local = requiredLocalLog(item.payload);
    const remote = requiredRemoteLog(item.payload);
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
        const profile = await this.logbookRepository.getWatchProfile(
          item.entityLocalId,
        );
        await this.profileUploader.uploadProfile(
          remote.profilePath,
          utf8ToBytes(JSON.stringify(profile)),
        );
      }
      result = await this.accountRepository.saveLog(
        remote,
        item.expectedRevision,
      );
    }

    if (result.status === 'conflict') {
      await this.logbookRepository.save({...local, cloudSyncStatus: 'conflict'});
      await this.outbox.recordConflict(item, remoteAsRecord(result.remote));
      return;
    }

    if (item.mutation === 'upsert') {
      const hasPendingEdit = await this.outbox.completeSavedUpsert(
        item,
        result.value.revision,
      );
      const current = await this.logbookRepository.get(item.entityLocalId);
      await this.logbookRepository.save({
        ...(current ?? local),
        remoteId: result.value.id,
        remoteRevision: result.value.revision,
        ownerUserId: this.userId,
        cloudSyncStatus: hasPendingEdit ? 'pending' : 'synced',
      });
      return;
    }
    await this.outbox.complete(item.operationId);
  }

  private async deliverPlan(item: AccountOutboxItem): Promise<void> {
    const local = requiredLocalPlan(item.payload);
    const remote = requiredRemotePlan(item.payload);
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
      result = await this.accountRepository.savePlan(
        remote,
        item.expectedRevision,
      );
    }

    if (result.status === 'conflict') {
      await this.planRepository.save({...local, cloudSyncStatus: 'conflict'});
      await this.outbox.recordConflict(item, remoteAsRecord(result.remote));
      return;
    }

    if (item.mutation === 'upsert') {
      const hasPendingEdit = await this.outbox.completeSavedUpsert(
        item,
        result.value.revision,
      );
      const current = await this.planRepository.get(item.entityLocalId);
      await this.planRepository.save({
        ...(current ?? local),
        remoteId: result.value.id,
        remoteRevision: result.value.revision,
        ownerUserId: this.userId,
        cloudSyncStatus: hasPendingEdit ? 'pending' : 'synced',
      });
      return;
    }
    await this.outbox.complete(item.operationId);
  }
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
  const local = payload.local;
  if (!isRecord(local) || typeof local.localId !== 'string') {
    throw new Error('Malformed local log payload');
  }
  return local as DiveLogEntry;
}

function requiredRemoteLog(payload: Record<string, unknown>): RemoteDiveLog {
  const remote = payload.remote;
  if (!isRemoteEntity(remote)) {
    throw new Error('Malformed remote log payload');
  }
  return remote as RemoteDiveLog;
}

function requiredLocalPlan(payload: Record<string, unknown>): DivePlan {
  const local = payload.local;
  if (!isRecord(local) || typeof local.localId !== 'string') {
    throw new Error('Malformed local plan payload');
  }
  return local as DivePlan;
}

function requiredRemotePlan(payload: Record<string, unknown>): RemoteDivePlan {
  const remote = payload.remote;
  if (!isRemoteEntity(remote)) {
    throw new Error('Malformed remote plan payload');
  }
  return remote as RemoteDivePlan;
}

function isRemoteEntity(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.localId === 'string' &&
    typeof value.revision === 'number' &&
    typeof value.payloadSha256 === 'string' &&
    isRecord(value.payload)
  );
}

function remoteLogToLocal(remote: RemoteDiveLog, userId: string): DiveLogEntry {
  const payload = remote.payload;
  const storedManual = requiredRecord(payload.manual_data, 'manual_data');
  const localRecord = isRecord(storedManual._local_record)
    ? storedManual._local_record
    : undefined;
  const manual = {...storedManual};
  delete manual._local_record;
  const mobile = requiredRecord(payload.mobile_data, 'mobile_data');
  const provenance = requiredRecord(payload.provenance, 'provenance');
  const watchCapture = localWatchMetadata(payload.watch_metadata);
  const startedAt = timestampSeconds(payload.started_at) ?? 0;

  return {
    localId: remote.localId,
    remoteId: remote.id,
    remoteRevision: remote.revision,
    ownerUserId: userId,
    source: payload.source === 'watch' ? 'watch' : 'manual',
    cloudSyncStatus: 'synced',
    createdAt: numberValue(localRecord?.createdAt) ?? startedAt,
    updatedAt: numberValue(localRecord?.updatedAt) ?? startedAt,
    manual: manual as DiveLogEntry['manual'],
    mobile: mobile as DiveLogEntry['mobile'],
    ...(watchCapture ? {watchCapture} : {}),
    provenance: provenance as DiveLogEntry['provenance'],
  };
}

function localWatchMetadata(value: unknown): DiveLogEntry['watchCapture'] {
  if (!isRecord(value)) {
    return undefined;
  }
  const metadata = {...value};
  delete metadata.profile;
  return metadata as DiveLogEntry['watchCapture'];
}

function remotePlanToLocal(remote: RemoteDivePlan, userId: string): DivePlan {
  const payload = remote.payload;
  const planData = requiredRecord(payload.plan_data, 'plan_data') as DivePlan;
  return {
    ...planData,
    localId: remote.localId,
    remoteId: remote.id,
    remoteRevision: remote.revision,
    ownerUserId: userId,
    cloudSyncStatus: 'synced',
  };
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

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function timestampSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds / 1_000 : undefined;
}

function remoteAsRecord(
  remote: RemoteDiveLog | RemoteDivePlan,
): Record<string, unknown> {
  return remote as unknown as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clearInFlight(
  userId: string,
  result: Promise<AccountSyncDrainResult>,
): void {
  if (inFlightByUser.get(userId) === result) {
    inFlightByUser.delete(userId);
  }
}
