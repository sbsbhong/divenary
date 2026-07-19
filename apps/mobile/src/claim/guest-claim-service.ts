import type {
  GuestClaimRemoteRepository,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';

import type { PrincipalRepositories } from '../repositories/principal-repositories';
import { dataProfileKeyPrefix } from '../storage/data-principal';
import type { WatchProfileStorage } from '../storage/watch-profile-storage';
import { canonicalAccountPayloadSha256 } from '../sync/account-payload';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DivePlan } from '../types/dive-plan';
import {
  createGuestClaimSnapshot,
  GuestClaimPreparationError,
  GuestClaimStorageError,
  parseSnapshotLocalRecord,
  parseSnapshotPayload,
  type GuestClaimSnapshot,
  type GuestClaimSnapshotItem,
  type GuestClaimStoreLike,
} from './guest-claim-store';
import type {
  GuestClaimErrorCode,
  GuestClaimItem,
  GuestClaimProgress,
} from './guest-claim-types';
import {
  decodeUtf8,
  encodeUtf8,
  GuestClaimProfileError,
  verifyProfileBytesSnapshot,
} from './profile-bytes';

export class GuestClaimServiceError extends Error {
  constructor(readonly code: GuestClaimErrorCode) {
    super(code);
    this.name = 'GuestClaimServiceError';
  }
}

export type GuestClaimServiceOptions = {
  userId: string;
  store: GuestClaimStoreLike;
  guestRepositories: PrincipalRepositories;
  accountRepositories: PrincipalRepositories;
  profileStorage: WatchProfileStorage;
  remoteRepository: GuestClaimRemoteRepository;
  now?: () => number;
  onProgress?: (progress: GuestClaimProgress) => void;
  onSnapshot?: (snapshot: GuestClaimSnapshot) => void | Promise<void>;
  assertCanContinue?: () => void;
};

export class GuestClaimService {
  private readonly now: () => number;
  private operation: Promise<GuestClaimSnapshot | undefined> | undefined;

  constructor(private readonly options: GuestClaimServiceOptions) {
    this.now = options.now ?? (() => Date.now() / 1_000);
  }

  async prepare(): Promise<GuestClaimSnapshot | undefined> {
    const existing = await this.readOwned();
    if (existing !== undefined) {
      if (existing.manifest.status !== 'committed') {
        return existing;
      }
      const [logs, plans] = await Promise.all([
        this.options.guestRepositories.logbook.list(),
        this.options.guestRepositories.planbook.list(),
      ]);
      if (logs.length === 0 && plans.length === 0) {
        return existing;
      }
      if (!this.options.store.remove) {
        throw new GuestClaimServiceError('claim_validation_failed');
      }
      await this.options.store.remove();
    }
    this.assertCanContinue();
    let snapshot: GuestClaimSnapshot;
    try {
      snapshot = await createGuestClaimSnapshot({
        userId: this.options.userId,
        logbookRepository: this.options.guestRepositories.logbook,
        planRepository: this.options.guestRepositories.planbook,
        profileStorage: this.options.profileStorage,
        now: this.now,
      });
    } catch (error) {
      throw this.serviceError(error);
    }
    if (snapshot.manifest.items.length === 0) {
      return undefined;
    }
    this.assertCanContinue();
    await this.persist(snapshot);
    return snapshot;
  }

  start(): Promise<GuestClaimSnapshot | undefined> {
    return this.singleFlight(async () => {
      const snapshot = await this.prepare();
      if (snapshot === undefined) {
        return undefined;
      }
      return this.run(snapshot);
    });
  }

  resume(): Promise<GuestClaimSnapshot | undefined> {
    return this.singleFlight(async () => {
      const snapshot = await this.readOwned();
      if (snapshot === undefined) {
        return undefined;
      }
      if (snapshot.manifest.status === 'cleanupPending') {
        return this.cleanup(snapshot);
      }
      if (
        snapshot.manifest.status !== 'running' &&
        snapshot.manifest.status !== 'finalizing'
      ) {
        return snapshot;
      }
      return this.run(snapshot);
    });
  }

  retry(): Promise<GuestClaimSnapshot | undefined> {
    return this.singleFlight(async () => {
      const snapshot = await this.prepare();
      if (snapshot === undefined) {
        return undefined;
      }
      if (snapshot.manifest.status === 'cleanupPending') {
        return this.cleanup(snapshot);
      }
      snapshot.manifest.status = 'running';
      delete snapshot.errorCode;
      await this.persist(snapshot);
      return this.run(snapshot);
    });
  }

  async defer(): Promise<GuestClaimSnapshot | undefined> {
    const snapshot = await this.prepare();
    if (snapshot === undefined) {
      return undefined;
    }
    snapshot.manifest.status = 'deferred';
    delete snapshot.errorCode;
    await this.persist(snapshot);
    return snapshot;
  }

  async hiddenGuestIds(): Promise<{
    logIds: Set<string>;
    planIds: Set<string>;
  }> {
    const snapshot = await this.readOwned();
    const logIds = new Set<string>();
    const planIds = new Set<string>();
    if (
      snapshot?.manifest.status === 'committed' ||
      snapshot?.manifest.status === 'cleanupPending'
    ) {
      for (const item of snapshot.manifest.items) {
        (item.entityKind === 'log' ? logIds : planIds).add(item.clientRecordId);
      }
    }
    return { logIds, planIds };
  }

  private async run(snapshot: GuestClaimSnapshot): Promise<GuestClaimSnapshot> {
    try {
      this.assertCanContinue();
      if (snapshot.manifest.status !== 'finalizing') {
        snapshot.manifest.status = 'running';
        delete snapshot.errorCode;
        await this.persist(snapshot);
        this.emitProgress(snapshot, 'uploading');

        const batch = await this.options.remoteRepository.createOrLoadBatch({
          clientBatchId: snapshot.manifest.clientBatchId,
          manifestSha256: snapshot.manifest.manifestSha256,
          expectedPlanCount: snapshot.manifest.planCount,
          expectedLogCount: snapshot.manifest.logCount,
        });
        this.assertCanContinue();
        if (
          snapshot.manifest.remoteBatchId !== undefined &&
          snapshot.manifest.remoteBatchId !== batch.id
        ) {
          throw new GuestClaimServiceError('remote_conflict');
        }
        if (snapshot.manifest.remoteBatchId === undefined) {
          snapshot.manifest.remoteBatchId = batch.id;
          await this.persist(snapshot);
        }

        if (batch.status !== 'committed') {
          for (const [index, item] of snapshot.manifest.items.entries()) {
            if (item.completedAt !== undefined) {
              continue;
            }
            await this.stageItem(snapshot, index);
          }
        }
      }

      return await this.finalize(snapshot);
    } catch (error) {
      if (snapshot.userId !== this.options.userId) {
        throw this.serviceError(error);
      }
      const failure = this.serviceError(error);
      snapshot.manifest.status = 'failed';
      snapshot.errorCode = failure.code;
      await this.persist(snapshot);
      return snapshot;
    }
  }

  private async stageItem(
    snapshot: GuestClaimSnapshot,
    index: number,
  ): Promise<void> {
    const item = snapshot.manifest.items[index];
    const sidecar = snapshot.snapshots[index];
    const batchId = snapshot.manifest.remoteBatchId;
    if (item === undefined || sidecar === undefined || batchId === undefined) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    this.assertCanContinue();

    if (
      item.stagingRecordId === undefined ||
      item.targetRecordId === undefined
    ) {
      const staged = await this.options.remoteRepository.stageRecord({
        batchId,
        entityKind: item.entityKind,
        clientRecordId: item.clientRecordId,
        payloadSha256: item.payloadSha256,
        payload: parseSnapshotPayload(sidecar),
        ...(item.sourcePlanClientRecordId === undefined
          ? {}
          : { sourcePlanClientRecordId: item.sourcePlanClientRecordId }),
        ...(item.convertedLogClientRecordId === undefined
          ? {}
          : { convertedLogClientRecordId: item.convertedLogClientRecordId }),
      });
      this.assertCanContinue();
      item.stagingRecordId = staged.stagingRecordId;
      item.targetRecordId = staged.targetRecordId;
      await this.persist(snapshot);
    }

    if (item.profile !== undefined) {
      await this.stageProfile(snapshot, item, sidecar);
    }

    item.completedAt = this.now();
    await this.persist(snapshot);
    this.emitProgress(snapshot, 'uploading', sidecar.label);
  }

  private async stageProfile(
    snapshot: GuestClaimSnapshot,
    item: GuestClaimItem,
    sidecar: GuestClaimSnapshotItem,
  ): Promise<void> {
    if (
      item.profile === undefined ||
      item.stagingRecordId === undefined ||
      item.targetRecordId === undefined ||
      snapshot.manifest.remoteBatchId === undefined ||
      sidecar.profileBytes === undefined
    ) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    const local = parseSnapshotLocalRecord(sidecar) as DiveLogEntry;
    const localSessionId = local.watchCapture?.session.localSessionId;
    if (localSessionId === undefined) {
      throw new GuestClaimServiceError('profile_corrupt');
    }
    const verified = verifyProfileBytesSnapshot(sidecar.profileBytes, {
      localSessionId,
      sampleCount: item.profile.sampleCount,
      sha256: item.profile.sha256,
    });
    const path = `${this.options.userId}/claims/${snapshot.manifest.remoteBatchId}/${item.targetRecordId}/${encodeURIComponent(item.profile.contentRevision)}.json`;

    if (sidecar.profileReadback === undefined) {
      const bytes = encodeUtf8(sidecar.profileBytes);
      await this.options.remoteRepository.uploadProfile(path, bytes);
      this.assertCanContinue();
      const downloaded =
        await this.options.remoteRepository.downloadProfile(path);
      this.assertCanContinue();
      let downloadedString: string;
      try {
        downloadedString = decodeUtf8(downloaded);
      } catch {
        throw new GuestClaimServiceError('profile_corrupt');
      }
      const readback = verifyProfileBytesSnapshot(downloadedString, {
        localSessionId,
        sampleCount: item.profile.sampleCount,
        sha256: item.profile.sha256,
        byteCount: verified.byteCount,
      });
      sidecar.profileReadback = {
        path,
        byteCount: readback.byteCount,
        sha256: readback.sha256,
        sampleCount: readback.sampleCount,
        verifiedAt: this.now(),
      };
      await this.persist(snapshot);
    } else if (
      sidecar.profileReadback.path !== path ||
      sidecar.profileReadback.byteCount !== verified.byteCount ||
      sidecar.profileReadback.sha256 !== verified.sha256 ||
      sidecar.profileReadback.sampleCount !== verified.sampleCount
    ) {
      throw new GuestClaimServiceError('profile_corrupt');
    }

    await this.options.remoteRepository.attachProfile({
      stagingRecordId: item.stagingRecordId,
      path,
      contentRevision: item.profile.contentRevision,
      sha256: item.profile.sha256,
      byteCount: verified.byteCount,
      sampleCount: item.profile.sampleCount,
    });
    this.assertCanContinue();
  }

  private async finalize(
    snapshot: GuestClaimSnapshot,
  ): Promise<GuestClaimSnapshot> {
    const batchId = snapshot.manifest.remoteBatchId;
    if (
      batchId === undefined ||
      !snapshot.manifest.items.every(item => item.completedAt !== undefined)
    ) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    snapshot.manifest.status = 'finalizing';
    await this.persist(snapshot);
    this.emitProgress(snapshot, 'finalizing');

    const finalized = await this.options.remoteRepository.finalize(batchId);
    this.assertCanContinue();
    if (
      finalized.status !== 'committed' ||
      finalized.planCount !== snapshot.manifest.planCount ||
      finalized.logCount !== snapshot.manifest.logCount
    ) {
      throw new GuestClaimServiceError('remote_conflict');
    }
    const committed =
      await this.options.remoteRepository.listCommittedBatch(batchId);
    this.assertCanContinue();
    const verified = verifyCommittedBatch(snapshot, committed);
    await this.writeAccountSnapshot(snapshot, verified);
    this.assertCanContinue();

    snapshot.manifest.status = 'committed';
    delete snapshot.errorCode;
    await this.persist(snapshot);
    this.emitProgress(snapshot, 'cleanup');
    return this.cleanup(snapshot);
  }

  private async writeAccountSnapshot(
    snapshot: GuestClaimSnapshot,
    committed: {
      plans: Map<string, RemoteDivePlan>;
      logs: Map<string, RemoteDiveLog>;
    },
  ): Promise<void> {
    for (const [index, item] of snapshot.manifest.items.entries()) {
      this.assertCanContinue();
      const sidecar = snapshot.snapshots[index]!;
      if (item.entityKind === 'plan') {
        const local = parseSnapshotLocalRecord(sidecar) as DivePlan;
        const remote = committed.plans.get(item.clientRecordId)!;
        const accountValue: DivePlan = {
          ...local,
          remoteId: remote.id,
          remoteRevision: remote.revision,
          ownerUserId: this.options.userId,
          cloudSyncStatus: 'synced',
        };
        await this.options.accountRepositories.planbook.save(accountValue);
        this.assertCanContinue();
        const readback = await this.options.accountRepositories.planbook.get(
          item.clientRecordId,
        );
        assertLocalReadback(accountValue, readback);
        continue;
      }

      const local = parseSnapshotLocalRecord(sidecar) as DiveLogEntry;
      const remote = committed.logs.get(item.clientRecordId)!;
      let accountValue: DiveLogEntry = {
        ...local,
        remoteId: remote.id,
        remoteRevision: remote.revision,
        ownerUserId: this.options.userId,
        cloudSyncStatus: 'synced',
      };
      if (
        item.profile !== undefined &&
        sidecar.profileBytes !== undefined &&
        local.watchCapture !== undefined
      ) {
        const profile = verifyProfileBytesSnapshot(sidecar.profileBytes, {
          localSessionId: local.watchCapture.session.localSessionId,
          sampleCount: item.profile.sampleCount,
          sha256: item.profile.sha256,
        });
        const accountStorageKey = `${dataProfileKeyPrefix({
          kind: 'user',
          userId: this.options.userId,
        })}${encodeURIComponent(
          local.watchCapture.session.localSessionId,
        )}:${encodeURIComponent(item.profile.contentRevision)}`;
        await this.options.profileStorage.write(
          accountStorageKey,
          profile.samples,
        );
        this.assertCanContinue();
        const profileReadback =
          await this.options.profileStorage.read(accountStorageKey);
        const reserialized = verifyProfileBytesSnapshot(
          JSON.stringify(profileReadback),
          {
            localSessionId: local.watchCapture.session.localSessionId,
            sampleCount: item.profile.sampleCount,
            sha256: item.profile.sha256,
            byteCount: profile.byteCount,
          },
        );
        if (reserialized.bytes !== sidecar.profileBytes) {
          throw new GuestClaimServiceError('profile_corrupt');
        }
        accountValue = {
          ...accountValue,
          watchCapture: {
            ...local.watchCapture,
            profile: {
              storageKey: accountStorageKey,
              contentRevision: item.profile.contentRevision,
              sha256: item.profile.sha256,
              sampleCount: item.profile.sampleCount,
            },
          },
        };
      }
      await this.options.accountRepositories.logbook.save(accountValue);
      this.assertCanContinue();
      const readback = await this.options.accountRepositories.logbook.get(
        item.clientRecordId,
      );
      assertLocalReadback(accountValue, readback);
      if (item.profile !== undefined) {
        const samples =
          await this.options.accountRepositories.logbook.getWatchProfile(
            item.clientRecordId,
          );
        verifyProfileBytesSnapshot(JSON.stringify(samples), {
          localSessionId: accountValue.watchCapture!.session.localSessionId,
          sampleCount: item.profile.sampleCount,
          sha256: item.profile.sha256,
        });
      }
    }
  }

  private async cleanup(
    snapshot: GuestClaimSnapshot,
  ): Promise<GuestClaimSnapshot> {
    try {
      for (const item of snapshot.manifest.items) {
        this.assertCanContinue();
        if (item.entityKind === 'plan') {
          await this.options.guestRepositories.planbook.delete(
            item.clientRecordId,
          );
        } else {
          await this.options.guestRepositories.logbook.delete(
            item.clientRecordId,
          );
        }
      }
      for (const item of snapshot.manifest.items) {
        if (item.profile !== undefined) {
          await this.options.guestRepositories.logbook.removeWatchProfileIfUnreferenced(
            item.profile.storageKey,
          );
        }
      }
      const [remainingLogs, remainingPlans] = await Promise.all([
        this.options.guestRepositories.logbook.list(),
        this.options.guestRepositories.planbook.list(),
      ]);
      const claimedLogs = new Set(
        snapshot.manifest.items
          .filter(item => item.entityKind === 'log')
          .map(item => item.clientRecordId),
      );
      const claimedPlans = new Set(
        snapshot.manifest.items
          .filter(item => item.entityKind === 'plan')
          .map(item => item.clientRecordId),
      );
      if (
        remainingLogs.some(value => claimedLogs.has(value.localId)) ||
        remainingPlans.some(value => claimedPlans.has(value.localId))
      ) {
        throw new GuestClaimServiceError('claim_validation_failed');
      }
      if (snapshot.manifest.status === 'cleanupPending') {
        snapshot.manifest.status = 'committed';
        await this.persist(snapshot);
      }
    } catch {
      snapshot.manifest.status = 'cleanupPending';
      await this.persist(snapshot);
    }
    return snapshot;
  }

  private async readOwned(): Promise<GuestClaimSnapshot | undefined> {
    let snapshot: GuestClaimSnapshot | undefined;
    try {
      snapshot = await this.options.store.read();
    } catch (error) {
      throw this.serviceError(error);
    }
    if (snapshot !== undefined && snapshot.userId !== this.options.userId) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    return snapshot;
  }

  private async persist(snapshot: GuestClaimSnapshot): Promise<void> {
    this.assertCanContinue();
    if (snapshot.userId !== this.options.userId) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    snapshot.manifest.updatedAt = Math.max(
      snapshot.manifest.updatedAt,
      this.now(),
    );
    await this.options.store.write(snapshot);
    this.assertCanContinue();
    await this.options.onSnapshot?.(snapshot);
  }

  private emitProgress(
    snapshot: GuestClaimSnapshot,
    phase: GuestClaimProgress['phase'],
    currentLabel?: string,
  ): void {
    const progress: GuestClaimProgress = {
      completed: snapshot.manifest.items.filter(
        item => item.completedAt !== undefined,
      ).length,
      total: snapshot.manifest.items.length,
      phase,
      ...(currentLabel === undefined ? {} : { currentLabel }),
    };
    this.options.onProgress?.(progress);
  }

  private serviceError(error: unknown): GuestClaimServiceError {
    if (error instanceof GuestClaimServiceError) {
      return error;
    }
    if (error instanceof GuestClaimPreparationError) {
      return new GuestClaimServiceError(error.code);
    }
    if (error instanceof GuestClaimProfileError) {
      return new GuestClaimServiceError(error.code);
    }
    if (error instanceof GuestClaimStorageError) {
      return new GuestClaimServiceError('claim_validation_failed');
    }
    return new GuestClaimServiceError('claim_validation_failed');
  }

  private assertCanContinue(): void {
    this.options.assertCanContinue?.();
  }

  private singleFlight(
    operation: () => Promise<GuestClaimSnapshot | undefined>,
  ): Promise<GuestClaimSnapshot | undefined> {
    if (this.operation !== undefined) {
      return this.operation;
    }
    const running = operation();
    this.operation = running;
    running.then(
      () => {
        if (this.operation === running) {
          this.operation = undefined;
        }
      },
      () => {
        if (this.operation === running) {
          this.operation = undefined;
        }
      },
    );
    return running;
  }
}

function verifyCommittedBatch(
  snapshot: GuestClaimSnapshot,
  committed: { plans: RemoteDivePlan[]; logs: RemoteDiveLog[] },
): { plans: Map<string, RemoteDivePlan>; logs: Map<string, RemoteDiveLog> } {
  if (
    committed.plans.length !== snapshot.manifest.planCount ||
    committed.logs.length !== snapshot.manifest.logCount
  ) {
    throw new GuestClaimServiceError('remote_conflict');
  }
  const plans = uniqueByLocalId(committed.plans);
  const logs = uniqueByLocalId(committed.logs);
  const byKey = new Map(snapshot.manifest.items.map(item => [item.key, item]));

  for (const [index, item] of snapshot.manifest.items.entries()) {
    const sidecar = snapshot.snapshots[index]!;
    const remote =
      item.entityKind === 'plan'
        ? plans.get(item.clientRecordId)
        : logs.get(item.clientRecordId);
    if (
      remote === undefined ||
      remote.id !== item.targetRecordId ||
      remote.payloadSha256 !== item.payloadSha256 ||
      remote.revision < 1
    ) {
      throw new GuestClaimServiceError('remote_conflict');
    }
    const expectedPayload = parseSnapshotPayload(sidecar);
    const normalizedPayload = { ...remote.payload };
    if (item.entityKind === 'plan') {
      const target = item.convertedLogClientRecordId
        ? byKey.get(`log:${item.convertedLogClientRecordId}`)?.targetRecordId
        : undefined;
      if (normalizedPayload.converted_log_id !== (target ?? null)) {
        throw new GuestClaimServiceError('remote_conflict');
      }
      normalizedPayload.converted_log_id = expectedPayload.converted_log_id;
    } else {
      const target = item.sourcePlanClientRecordId
        ? byKey.get(`plan:${item.sourcePlanClientRecordId}`)?.targetRecordId
        : undefined;
      if (normalizedPayload.source_plan_id !== (target ?? null)) {
        throw new GuestClaimServiceError('remote_conflict');
      }
      normalizedPayload.source_plan_id = expectedPayload.source_plan_id;
      if (
        Array.isArray(normalizedPayload.profile_preview) &&
        normalizedPayload.profile_preview.length > 160
      ) {
        throw new GuestClaimServiceError('remote_conflict');
      }
      const expectedPath = item.profile
        ? `${snapshot.userId}/claims/${snapshot.manifest.remoteBatchId}/${item.targetRecordId}/${encodeURIComponent(item.profile.contentRevision)}.json`
        : undefined;
      if ((remote as RemoteDiveLog).profilePath !== expectedPath) {
        throw new GuestClaimServiceError('remote_conflict');
      }
    }
    if (
      canonicalAccountPayloadSha256(normalizedPayload) !== item.payloadSha256 ||
      canonicalAccountPayloadSha256(expectedPayload) !== item.payloadSha256
    ) {
      throw new GuestClaimServiceError('remote_conflict');
    }
  }
  return { plans, logs };
}

function uniqueByLocalId<T extends RemoteDiveLog | RemoteDivePlan>(
  values: T[],
): Map<string, T> {
  const result = new Map<string, T>();
  const ids = new Set<string>();
  for (const value of values) {
    if (result.has(value.localId) || ids.has(value.id)) {
      throw new GuestClaimServiceError('remote_conflict');
    }
    result.set(value.localId, value);
    ids.add(value.id);
  }
  return result;
}

function assertLocalReadback<T extends DiveLogEntry | DivePlan>(
  expected: T,
  actual: T | undefined,
): void {
  if (
    actual === undefined ||
    canonicalLocal(actual) !== canonicalLocal(expected)
  ) {
    throw new GuestClaimServiceError('claim_validation_failed');
  }
}

function canonicalLocal(value: DiveLogEntry | DivePlan): string {
  return canonicalJson(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
