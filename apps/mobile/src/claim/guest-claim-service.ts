import type {
  GuestClaimRemoteRepository,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';
import { GuestClaimRepositoryError } from '@repo/supabase';

import type {ConditionalDeleteManyResult} from '../repositories/bulk-conditional-delete';
import type { PrincipalRepositories } from '../repositories/principal-repositories';
import { dataProfileKeyPrefix } from '../storage/data-principal';
import type { WatchProfileStorage } from '../storage/watch-profile-storage';
import {
  canonicalAccountPayloadSha256,
  parseAccountRemoteLog,
  parseAccountRemotePlan,
} from '../sync/account-payload';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DivePlan } from '../types/dive-plan';
import { getWatchSessionSourcePlanLocalId } from '../utils/enrich-watch-log-with-plan';
import {
  claimProfileEvidenceStorageKeys,
  compactCommittedGuestClaimSnapshot,
  createGuestClaimSnapshot,
  guestRecordsContainClaimSnapshotSources,
  guestRecordMatchesClaimSnapshot,
  GuestClaimPreparationError,
  GuestClaimStorageError,
  historicalArtifactsFromSnapshot,
  isGuestProfileStorageKey,
  migrateGuestClaimSnapshotProfileSidecars,
  parseSnapshotLocalRecord,
  parseSnapshotPayload,
  readClaimProfileBytes,
  retainedGuestRecordsMatchClaimSnapshot,
  sourceRecordBytes,
  type GuestClaimSnapshot,
  type GuestClaimSnapshotItem,
  type GuestClaimStoreLike,
} from './guest-claim-store';
import type {
  GuestClaimErrorCode,
  GuestClaimFailureDetail,
  GuestClaimItem,
  GuestClaimProgress,
} from './guest-claim-types';
import {
  createProfileBytesSnapshot,
  createStoredProfileBytesSnapshot,
  encodeUtf8,
  GuestClaimProfileError,
  type ProfileBytesSnapshot,
  verifyRawProfileBytes,
  verifyProfileBytesSnapshot,
} from './profile-bytes';

export class GuestClaimServiceError extends Error {
  constructor(
    readonly code: GuestClaimErrorCode,
    readonly failure?: GuestClaimFailureDetail,
  ) {
    super(code);
    this.name = 'GuestClaimServiceError';
  }
}

export type GuestClaimServiceOptions = {
  userId: string;
  store: GuestClaimStoreLike;
  guestRepositories: PrincipalRepositories;
  accountRepositories: PrincipalRepositories;
  accountMutationRepositories: PrincipalRepositories;
  profileStorage: WatchProfileStorage;
  remoteRepository: GuestClaimRemoteRepository;
  now?: () => number;
  onProgress?: (progress: GuestClaimProgress) => void;
  onSnapshot?: (snapshot: GuestClaimSnapshot) => void | Promise<void>;
  assertCanContinue?: () => void;
};

type ChangedGuestCapture = {
  record: DiveLogEntry | DivePlan;
  recordBytes: string;
  profile?: {
    storageKey: string;
    contentRevision: string;
    localSessionId: string;
    snapshot: ProfileBytesSnapshot;
  };
};

type GuestEntityKind = GuestClaimItem['entityKind'];

type PromotionContext = {
  visiting: Set<string>;
  published: Map<
    string,
    {
      entityKind: GuestEntityKind;
      localId: string;
      capture: ChangedGuestCapture;
    }
  >;
};

type PromotionRoot = {
  item: GuestClaimItem;
  sidecar: GuestClaimSnapshotItem;
};

export class GuestClaimService {
  private readonly now: () => number;
  private operation: Promise<GuestClaimSnapshot | undefined> | undefined;

  constructor(private readonly options: GuestClaimServiceOptions) {
    this.now = options.now ?? (() => Date.now() / 1_000);
  }

  async prepare(): Promise<GuestClaimSnapshot | undefined> {
    let existing = await this.readOwned();
    if (
      existing !== undefined &&
      isReplaceableLocalCheckpoint(existing)
    ) {
      const [logs, plans] = await Promise.all([
        this.options.guestRepositories.logbook.list(),
        this.options.guestRepositories.planbook.list(),
      ]);
      if (
        !guestRecordsContainClaimSnapshotSources({
          snapshot: existing,
          logs,
          plans,
        })
      ) {
        if (!this.options.store.remove) {
          throw new GuestClaimServiceError('claim_validation_failed');
        }
        await this.options.store.remove();
        existing = undefined;
      }
    }
    if (existing !== undefined) {
      if (
        existing.manifest.status !== 'committed' &&
        existing.manifest.status !== 'retained'
      ) {
        return existing;
      }
      const [logs, plans] = await Promise.all([
        this.options.guestRepositories.logbook.list(),
        this.options.guestRepositories.planbook.list(),
      ]);
      if (
        retainedGuestRecordsMatchClaimSnapshot({
          snapshot: existing,
          logs,
          plans,
        })
      ) {
        return existing;
      }
    }
    const snapshot = await this.createFreshSnapshot();
    if (snapshot === undefined && existing !== undefined) {
      if (!this.options.store.remove) {
        throw new GuestClaimServiceError('claim_validation_failed');
      }
      await this.options.store.remove();
    }
    return snapshot;
  }

  private async createFreshSnapshot(): Promise<
    GuestClaimSnapshot | undefined
  > {
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
    if (
      snapshot.manifest.items.length === 0 &&
      snapshot.retainedItems.length === 0
    ) {
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
      if (snapshot.manifest.status === 'retained') {
        return snapshot;
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
      if (
        snapshot.manifest.status === 'cleanupPending' &&
        snapshot.failure === undefined
      ) {
        return this.cleanup(snapshot);
      }
      if (
        snapshot.manifest.status === 'cleanupPending' ||
        snapshot.manifest.status === 'committed'
      ) {
        return snapshot;
      }
      if (
        snapshot.manifest.status === 'failed' &&
        isTransientClaimError(snapshot.errorCode)
      ) {
        snapshot.manifest.status = 'running';
        delete snapshot.errorCode;
        delete snapshot.failure;
        await this.persist(snapshot);
        return this.run(snapshot);
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
      if (snapshot.manifest.status === 'retained') {
        return snapshot;
      }
      if (snapshot.manifest.status === 'cleanupPending') {
        delete snapshot.errorCode;
        delete snapshot.failure;
        return this.cleanup(snapshot);
      }
      snapshot.manifest.status = uploadReceiptIsComplete(snapshot)
        ? 'finalizing'
        : 'running';
      delete snapshot.errorCode;
      delete snapshot.failure;
      await this.persist(snapshot);
      return this.run(snapshot);
    });
  }

  recheckRetained(): Promise<GuestClaimSnapshot | undefined> {
    return this.singleFlight(async () => {
      const existing = await this.readOwned();
      if (
        existing === undefined ||
        (existing.manifest.status !== 'committed' &&
          existing.manifest.status !== 'retained') ||
        existing.retainedItems.length === 0 ||
        !this.options.store.remove
      ) {
        throw new GuestClaimServiceError('claim_validation_failed');
      }
      this.assertCanContinue();
      const snapshot = await this.createFreshSnapshot();
      if (snapshot === undefined) {
        await this.options.store.remove();
        return undefined;
      }
      if (snapshot.manifest.status === 'retained') {
        return snapshot;
      }
      return this.run(snapshot);
    });
  }

  async defer(): Promise<GuestClaimSnapshot | undefined> {
    if (this.operation !== undefined) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    const existing = await this.readOwned();
    if (
      existing !== undefined &&
      (existing.manifest.status === 'running' ||
        existing.manifest.status === 'finalizing' ||
        existing.manifest.status === 'cleanupPending' ||
        existing.manifest.status === 'committed')
    ) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    const snapshot = existing ?? (await this.prepare());
    if (snapshot === undefined) {
      return undefined;
    }
    if (snapshot.manifest.status === 'deferred') {
      return snapshot;
    }
    if (
      snapshot.manifest.status !== 'prepared' &&
      snapshot.manifest.status !== 'failed'
    ) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    snapshot.manifest.status = 'deferred';
    delete snapshot.errorCode;
    delete snapshot.failure;
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
    if (snapshot?.snapshots.length === 0) {
      return {logIds, planIds};
    }
    if (
      snapshot?.manifest.status === 'committed' ||
      snapshot?.manifest.status === 'cleanupPending'
    ) {
      for (const [index, item] of snapshot.manifest.items.entries()) {
        const repository =
          item.entityKind === 'log'
            ? this.options.guestRepositories.logbook
            : this.options.guestRepositories.planbook;
        const current = await repository.get(item.clientRecordId);
        if (
          current !== undefined &&
          (await guestRecordMatchesClaimSnapshot({
            item,
            sidecar: snapshot.snapshots[index]!,
            record: current,
            profileStorage: this.options.profileStorage,
          }))
        ) {
          (item.entityKind === 'log' ? logIds : planIds).add(
            item.clientRecordId,
          );
        }
      }
    }
    return { logIds, planIds };
  }

  private async run(snapshot: GuestClaimSnapshot): Promise<GuestClaimSnapshot> {
    let failureContext: GuestClaimFailureDetail = { phase: 'uploading' };
    try {
      this.assertCanContinue();
      if (
        uploadReceiptIsComplete(snapshot) &&
        snapshot.manifest.status !== 'finalizing'
      ) {
        snapshot.manifest.status = 'finalizing';
        delete snapshot.errorCode;
        delete snapshot.failure;
        await this.persist(snapshot);
      }
      if (snapshot.manifest.status !== 'finalizing') {
        snapshot.manifest.status = 'running';
        delete snapshot.errorCode;
        delete snapshot.failure;
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
            const label = snapshot.snapshots[index]?.label;
            failureContext = {
              phase: 'uploading',
              entityKind: item.entityKind,
              clientRecordId: item.clientRecordId.slice(0, 512),
              ...(label === undefined
                ? {}
                : { label: label.slice(0, 200) }),
            };
            await this.stageItem(snapshot, index);
          }
        }
      }
      failureContext = { phase: 'finalizing' };
      return await this.finalize(snapshot);
    } catch (error) {
      if (snapshot.userId !== this.options.userId) {
        throw this.serviceError(error);
      }
      const failure = this.serviceError(error);
      snapshot.manifest.status = 'failed';
      snapshot.errorCode = failure.code;
      snapshot.failure = failure.failure ?? failureContext;
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
    const profileBytes = await readClaimProfileBytes(
      sidecar,
      this.options.profileStorage,
    );
    if (
      item.profile === undefined ||
      item.stagingRecordId === undefined ||
      item.targetRecordId === undefined ||
      snapshot.manifest.remoteBatchId === undefined ||
      profileBytes === undefined
    ) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    const local = parseSnapshotLocalRecord(sidecar) as DiveLogEntry;
    const localSessionId = local.watchCapture?.session.localSessionId;
    if (localSessionId === undefined) {
      throw new GuestClaimServiceError('profile_corrupt');
    }
    const verified = verifyProfileBytesSnapshot(profileBytes, {
      localSessionId,
      sampleCount: item.profile.sampleCount,
      sha256: item.profile.sha256,
    });
    const path = `${this.options.userId}/claims/${snapshot.manifest.remoteBatchId}/${item.targetRecordId}/${encodeURIComponent(item.profile.contentRevision)}.json`;

    if (sidecar.profileReadback === undefined) {
      const bytes = encodeUtf8(profileBytes);
      await this.options.remoteRepository.uploadProfile(path, bytes);
      this.assertCanContinue();
      const downloaded =
        await this.options.remoteRepository.downloadProfile(path);
      this.assertCanContinue();
      let downloadedString: string;
      try {
        downloadedString = verifyRawProfileBytes(downloaded, {
          byteCount: verified.byteCount,
          sha256: item.profile.sha256,
        });
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
    await this.persist(snapshot);
    await this.writeAccountSnapshot(snapshot, verified);
    this.assertCanContinue();

    snapshot.manifest.status = 'cleanupPending';
    delete snapshot.errorCode;
    delete snapshot.failure;
    await this.persist(snapshot);
    this.emitProgress(snapshot, 'cleanup');
    return this.cleanup(snapshot, true);
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
      const profileBytes =
        item.profile === undefined
          ? undefined
          : await readClaimProfileBytes(
              sidecar,
              this.options.profileStorage,
            );
      let accountValue: DiveLogEntry = {
        ...local,
        remoteId: remote.id,
        remoteRevision: remote.revision,
        ownerUserId: this.options.userId,
        cloudSyncStatus: 'synced',
      };
      if (
        item.profile !== undefined &&
        (profileBytes === undefined || local.watchCapture === undefined)
      ) {
        throw new GuestClaimServiceError('profile_corrupt');
      }
      if (
        item.profile !== undefined &&
        profileBytes !== undefined &&
        local.watchCapture !== undefined
      ) {
        const profile = verifyProfileBytesSnapshot(profileBytes, {
          localSessionId: local.watchCapture.session.localSessionId,
          sampleCount: item.profile.sampleCount,
          sha256: item.profile.sha256,
        });
        const accountStorageKey = accountProfileStorageKey(
          this.options.userId,
          local.watchCapture.session.localSessionId,
          item.profile.contentRevision,
        );
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
        if (reserialized.bytes !== profileBytes) {
          throw new GuestClaimServiceError('profile_corrupt');
        }
        accountValue = {
          ...accountValue,
          watchCapture: {
            ...local.watchCapture,
            profile: {
              ...local.watchCapture.profile,
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
    cleanupPendingPersisted = false,
  ): Promise<GuestClaimSnapshot> {
    if (!cleanupPendingPersisted) {
      snapshot.manifest.status = 'cleanupPending';
      delete snapshot.errorCode;
      delete snapshot.failure;
      await this.persist(snapshot);
    }
    try {
      const historicalArtifacts = historicalArtifactsFromSnapshot(snapshot);
      const [logs, plans] = await Promise.all([
        this.options.guestRepositories.logbook.list(),
        this.options.guestRepositories.planbook.list(),
      ]);
      const logsById = new Map(logs.map(value => [value.localId, value]));
      const plansById = new Map(plans.map(value => [value.localId, value]));
      const exactLogs: Array<{
        item: GuestClaimItem;
        sidecar: GuestClaimSnapshotItem;
        expectedRecordBytes: string;
      }> = [];
      const exactPlans: Array<{
        item: GuestClaimItem;
        sidecar: GuestClaimSnapshotItem;
        expectedRecordBytes: string;
      }> = [];

      for (const [index, item] of snapshot.manifest.items.entries()) {
        this.assertCanContinue();
        const sidecar = snapshot.snapshots[index];
        if (sidecar === undefined) {
          throw new GuestClaimServiceError('claim_validation_failed', {
            phase: 'cleanup',
            entityKind: item.entityKind,
            clientRecordId: item.clientRecordId,
          });
        }
        const current = (
          item.entityKind === 'plan' ? plansById : logsById
        ).get(item.clientRecordId);
        if (current === undefined) {
          continue;
        }
        const matches = await guestRecordMatchesClaimSnapshot({
          item,
          sidecar,
          record: current,
          profileStorage: this.options.profileStorage,
        });
        if (!matches) {
          await this.promoteChangedGuest(snapshot, index, current);
          continue;
        }
        const expectedRecordBytes = sourceRecordBytes(sidecar);
        if (item.entityKind === 'plan') {
          if (
            await this.repairExactGuestPlanFromAccountLog(
              snapshot,
              index,
              current as DivePlan,
            )
          ) {
            continue;
          }
          exactPlans.push({item, sidecar, expectedRecordBytes});
        } else {
          exactLogs.push({item, sidecar, expectedRecordBytes});
        }
      }

      const planRequests = exactPlans.map(value => ({
        localId: value.item.clientRecordId,
        predicate: (candidate: DivePlan) =>
          canonicalLocal(candidate) === value.expectedRecordBytes,
      }));
      const planResults =
        planRequests.length === 0
          ? new Map()
          : this.options.guestRepositories.planbook.deleteManyIf !== undefined
            ? await this.options.guestRepositories.planbook.deleteManyIf(
                planRequests,
              )
            : new Map(
                await Promise.all(
                  planRequests.map(async request => [
                    request.localId,
                    await this.options.guestRepositories.planbook.deleteIf(
                      request.localId,
                      request.predicate,
                    ),
                  ] as const),
                ),
              );
      assertBulkCleanupResults(exactPlans, planResults);

      const logRequests = exactLogs.map(value => ({
        localId: value.item.clientRecordId,
        predicate: (candidate: DiveLogEntry) =>
          canonicalLocal(candidate) === value.expectedRecordBytes,
      }));
      const logResults =
        logRequests.length === 0
          ? new Map()
          : this.options.guestRepositories.logbook.deleteManyIf !== undefined
            ? await this.options.guestRepositories.logbook.deleteManyIf(
                logRequests,
                {
                  retainProfileAfterDelete: true,
                  assertCanCommit: () => this.assertCanContinue(),
                },
              )
            : new Map(
                await Promise.all(
                  logRequests.map(async request => [
                    request.localId,
                    await this.options.guestRepositories.logbook.deleteIf(
                      request.localId,
                      request.predicate,
                      {retainProfileAfterDelete: true},
                    ),
                  ] as const),
                ),
              );
      assertBulkCleanupResults(exactLogs, logResults);
      this.assertCanContinue();

      const guestProfileKeys = new Set<string>();
      const claimSidecarKeys = new Set<string>();
      for (const [index, item] of snapshot.manifest.items.entries()) {
        if (item.profile !== undefined) {
          if (!isGuestProfileStorageKey(item.profile.storageKey)) {
            throw cleanupItemError(item, snapshot.snapshots[index]);
          }
          guestProfileKeys.add(item.profile.storageKey);
        }
        const sidecarKey =
          snapshot.snapshots[index]?.profileSidecarStorageKey;
        if (sidecarKey !== undefined) {
          claimSidecarKeys.add(sidecarKey);
        }
      }
      for (const storageKey of guestProfileKeys) {
        await this.options.guestRepositories.logbook.removeWatchProfileIfUnreferenced(
          storageKey,
        );
      }
      for (const storageKey of claimSidecarKeys) {
        await this.options.profileStorage.remove(storageKey);
      }

      const committedSnapshot: GuestClaimSnapshot = {
        ...snapshot,
        schemaVersion: 2,
        manifest: {...snapshot.manifest, status: 'committed'},
        snapshots: [],
        historicalArtifacts,
      };
      delete committedSnapshot.errorCode;
      delete committedSnapshot.failure;
      await this.persist(committedSnapshot);
      return committedSnapshot;
    } catch (error) {
      const failure = this.serviceError(error);
      snapshot.manifest.status = 'cleanupPending';
      snapshot.errorCode = failure.code;
      snapshot.failure = failure.failure ?? {phase: 'cleanup'};
      await this.persist(snapshot);
    }
    return snapshot;
  }

  private async repairExactGuestPlanFromAccountLog(
    snapshot: GuestClaimSnapshot,
    index: number,
    current: DivePlan,
  ): Promise<boolean> {
    const matchingLogs = (
      await this.options.accountRepositories.logbook.list()
    ).filter(
      log =>
        log.watchCapture !== undefined &&
        getWatchSessionSourcePlanLocalId(log.watchCapture.session) ===
          current.localId,
    );
    if (matchingLogs.length === 0) {
      return false;
    }
    if (matchingLogs.length !== 1) {
      throw new GuestClaimServiceError('relationship_invalid');
    }
    const log = matchingLogs[0]!;
    const completedAt =
      log.watchCapture?.measuredValues.endedAt ??
      log.watchCapture?.session.endedAt ??
      log.manual.measuredValues.endedAt;
    if (completedAt === undefined) {
      throw new GuestClaimServiceError('relationship_invalid');
    }

    const originalCapture = await this.captureChangedGuest(
      'plan',
      current.localId,
      current,
    );
    const context: PromotionContext = {
      visiting: new Set(),
      published: new Map(),
    };
    await this.promoteGuestEntity(
      'plan',
      current.localId,
      {
        ...current,
        status: 'completed',
        completedAt,
        convertedLogLocalId: log.localId,
        updatedAt: completedAt,
      },
      context,
      {
        item: snapshot.manifest.items[index]!,
        sidecar: snapshot.snapshots[index]!,
      },
    );

    for (const published of context.published.values()) {
      if (
        published.entityKind === 'plan' &&
        published.localId === current.localId
      ) {
        continue;
      }
      await this.deleteCapturedGuest(
        published.entityKind,
        published.localId,
        published.capture,
      );
    }
    await this.deleteCapturedGuest('plan', current.localId, originalCapture);
    return true;
  }

  private async promoteChangedGuest(
    snapshot: GuestClaimSnapshot,
    index: number,
    current: DiveLogEntry | DivePlan,
  ): Promise<void> {
    const item = snapshot.manifest.items[index]!;
    const sidecar = snapshot.snapshots[index]!;
    const context: PromotionContext = {
      visiting: new Set(),
      published: new Map(),
    };
    await this.promoteGuestEntity(
      item.entityKind,
      item.clientRecordId,
      current,
      context,
      {item, sidecar},
    );

    for (const published of context.published.values()) {
      await this.deleteCapturedGuest(
        published.entityKind,
        published.localId,
        published.capture,
      );
    }
  }

  private async promoteGuestEntity(
    entityKind: GuestEntityKind,
    localId: string,
    current: DiveLogEntry | DivePlan,
    context: PromotionContext,
    root?: PromotionRoot,
  ): Promise<void> {
    const key = `${entityKind}:${localId}`;
    if (context.published.has(key)) {
      return;
    }
    if (context.visiting.has(key)) {
      throw new GuestClaimServiceError('relationship_invalid');
    }
    context.visiting.add(key);
    try {
      const capture = await this.captureChangedGuest(
        entityKind,
        localId,
        current,
      );
      const accountRepository =
        entityKind === 'log'
          ? this.options.accountRepositories.logbook
          : this.options.accountRepositories.planbook;
      let accountValue = await accountRepository.get(localId);
      if (root !== undefined) {
        if (
          accountValue === undefined ||
          accountValue.remoteId !== root.item.targetRecordId ||
          accountValue.ownerUserId !== this.options.userId ||
          accountValue.remoteRevision === undefined ||
          !Number.isSafeInteger(accountValue.remoteRevision) ||
          accountValue.remoteRevision < 1
        ) {
          throw new GuestClaimServiceError('claim_validation_failed');
        }
      } else if (accountValue !== undefined) {
        assertDurableAccountIdentity(accountValue, this.options.userId);
      }

      await this.promoteRelationshipDependencies(
        entityKind,
        capture.record,
        context,
      );
      accountValue = await accountRepository.get(localId);

      if (
        accountValue !== undefined &&
        (await this.isSyncedCapture(accountValue, capture, entityKind))
      ) {
        context.published.set(key, {entityKind, localId, capture});
        return;
      }

      const supersededProfileKeys = new Set<string>();
      if (entityKind === 'log') {
        const currentProfileKey = (accountValue as DiveLogEntry | undefined)
          ?.watchCapture?.profile?.storageKey;
        if (currentProfileKey !== undefined) {
          assertAccountProfileKey(currentProfileKey, this.options.userId);
          supersededProfileKeys.add(currentProfileKey);
        }
        const originalProfileKey = root
          ? originalAccountProfileKey(
              root.item,
              root.sidecar,
              this.options.userId,
            )
          : undefined;
        if (originalProfileKey !== undefined) {
          supersededProfileKeys.add(originalProfileKey);
        }
      }

      let promotedProfileKey: string | undefined;
      let promoted: DiveLogEntry | DivePlan = {
        ...capture.record,
        ...(accountValue?.remoteId === undefined
          ? {}
          : {remoteId: accountValue.remoteId}),
        ...(accountValue?.remoteRevision === undefined
          ? {}
          : {remoteRevision: accountValue.remoteRevision}),
        ownerUserId: this.options.userId,
        cloudSyncStatus: 'pending',
      };
      if (
        entityKind === 'log' &&
        capture.profile !== undefined &&
        (promoted as DiveLogEntry).watchCapture !== undefined
      ) {
        const accountProfile = await this.publishAccountProfile(capture.profile);
        promotedProfileKey = accountProfile.storageKey;
        const promotedLog = promoted as DiveLogEntry;
        promoted = {
          ...promotedLog,
          watchCapture: {
            ...promotedLog.watchCapture!,
            profile: {
              ...promotedLog.watchCapture!.profile!,
              storageKey: accountProfile.storageKey,
              contentRevision: accountProfile.contentRevision,
              sha256: capture.profile.snapshot.sha256,
              sampleCount: capture.profile.snapshot.sampleCount,
            },
          },
        };
      }

      const saved =
        entityKind === 'log'
          ? await this.options.accountMutationRepositories.logbook.save(
              promoted as DiveLogEntry,
            )
          : await this.options.accountMutationRepositories.planbook.save(
              promoted as DivePlan,
            );
      this.assertCanContinue();
      const readback = await accountRepository.get(localId);
      assertLocalReadback(saved, readback);
      assertDurableAccountIdentity(saved, this.options.userId);
      if (
        root !== undefined &&
        (saved.remoteId !== root.item.targetRecordId ||
          saved.remoteRevision !== accountValue?.remoteRevision)
      ) {
        throw new GuestClaimServiceError('claim_validation_failed');
      }
      if (capture.profile !== undefined) {
        await this.verifyAccountProfile(localId, capture);
      }
      await this.removeSupersededAccountProfiles(
        supersededProfileKeys,
        promotedProfileKey,
      );
      await this.repairPublishedRelationship(entityKind, saved);
      context.published.set(key, {entityKind, localId, capture});
    } finally {
      context.visiting.delete(key);
    }
  }

  private async repairPublishedRelationship(
    entityKind: GuestEntityKind,
    saved: DiveLogEntry | DivePlan,
  ): Promise<void> {
    if (entityKind === 'plan') {
      const plan = saved as DivePlan;
      if (plan.convertedLogLocalId === undefined) {
        return;
      }
      const log = await this.options.accountRepositories.logbook.get(
        plan.convertedLogLocalId,
      );
      const sourcePlanLocalId = log?.watchCapture
        ? getWatchSessionSourcePlanLocalId(log.watchCapture.session)
        : undefined;
      if (log === undefined || sourcePlanLocalId !== plan.localId) {
        return;
      }
      const repaired =
        await this.options.accountMutationRepositories.logbook.save(log);
      this.assertCanContinue();
      assertLocalReadback(
        repaired,
        await this.options.accountRepositories.logbook.get(log.localId),
      );
      assertDurableAccountIdentity(repaired, this.options.userId);
      return;
    }

    const log = saved as DiveLogEntry;
    const sourcePlanLocalId = log.watchCapture
      ? getWatchSessionSourcePlanLocalId(log.watchCapture.session)
      : undefined;
    if (sourcePlanLocalId === undefined) {
      return;
    }
    const plan = await this.options.accountRepositories.planbook.get(
      sourcePlanLocalId,
    );
    if (plan?.convertedLogLocalId !== log.localId) {
      return;
    }
    const repaired =
      await this.options.accountMutationRepositories.planbook.save(plan);
    this.assertCanContinue();
    assertLocalReadback(
      repaired,
      await this.options.accountRepositories.planbook.get(plan.localId),
    );
    assertDurableAccountIdentity(repaired, this.options.userId);
  }

  private async promoteRelationshipDependencies(
    entityKind: GuestEntityKind,
    record: DiveLogEntry | DivePlan,
    context: PromotionContext,
  ): Promise<void> {
    if (entityKind === 'plan') {
      const convertedLogLocalId = (record as DivePlan).convertedLogLocalId;
      if (convertedLogLocalId !== undefined) {
        await this.ensurePromotedDependency(
          'log',
          convertedLogLocalId,
          context,
        );
      }
      return;
    }
    const log = record as DiveLogEntry;
    const sourcePlanLocalId = log.watchCapture
      ? getWatchSessionSourcePlanLocalId(log.watchCapture.session)
      : undefined;
    if (sourcePlanLocalId !== undefined) {
      await this.ensurePromotedDependency('plan', sourcePlanLocalId, context);
    }
  }

  private async ensurePromotedDependency(
    entityKind: GuestEntityKind,
    localId: string,
    context: PromotionContext,
  ): Promise<void> {
    const accountRepository =
      entityKind === 'log'
        ? this.options.accountRepositories.logbook
        : this.options.accountRepositories.planbook;
    const accountValue = await accountRepository.get(localId);
    const key = `${entityKind}:${localId}`;
    if (accountValue !== undefined && context.visiting.has(key)) {
      assertDurableAccountIdentity(accountValue, this.options.userId);
      return;
    }
    const guestRepository =
      entityKind === 'log'
        ? this.options.guestRepositories.logbook
        : this.options.guestRepositories.planbook;
    const guestValue = await guestRepository.get(localId);
    if (guestValue !== undefined) {
      await this.promoteGuestEntity(
        entityKind,
        localId,
        guestValue,
        context,
      );
    } else if (accountValue === undefined) {
      throw new GuestClaimServiceError('relationship_invalid');
    }
    const readback = await accountRepository.get(localId);
    if (readback === undefined) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    assertDurableAccountIdentity(readback, this.options.userId);
  }

  private async captureChangedGuest(
    entityKind: GuestEntityKind,
    localId: string,
    current: DiveLogEntry | DivePlan,
  ): Promise<ChangedGuestCapture> {
    if (current.localId !== localId) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    const capture: ChangedGuestCapture = {
      record: current,
      recordBytes: canonicalLocal(current),
    };
    if (entityKind !== 'log') {
      return capture;
    }
    const log = current as DiveLogEntry;
    const reference = log.watchCapture?.profile;
    if (reference === undefined || log.watchCapture === undefined) {
      return capture;
    }
    assertGuestProfileKey(reference.storageKey);
    const snapshot = createStoredProfileBytesSnapshot(
      await this.options.profileStorage.read(reference.storageKey),
      {
        localSessionId: log.watchCapture.session.localSessionId,
        sampleCount: reference.sampleCount,
        sha256: reference.sha256,
        artifactSha256: reference.artifactSha256,
      },
    );
    capture.record = {
      ...log,
      watchCapture: {
        ...log.watchCapture,
        profile: {
          ...reference,
          sha256: snapshot.sha256,
          ...(snapshot.artifactSha256 === undefined
            ? {}
            : {artifactSha256: snapshot.artifactSha256}),
        },
      },
    };
    capture.profile = {
      storageKey: reference.storageKey,
      contentRevision: reference.contentRevision,
      localSessionId: log.watchCapture.session.localSessionId,
      snapshot,
    };
    return capture;
  }

  private async publishAccountProfile(profile: NonNullable<ChangedGuestCapture['profile']>): Promise<{
    storageKey: string;
    contentRevision: string;
  }> {
    const revisions = [
      profile.contentRevision,
      `${profile.contentRevision}:reconciled:${profile.snapshot.sha256.slice(0, 16)}`,
    ];
    for (const [index, contentRevision] of revisions.entries()) {
      const storageKey = accountProfileStorageKey(
        this.options.userId,
        profile.localSessionId,
        contentRevision,
      );
      const existing = await this.options.profileStorage.read(storageKey);
      if (existing === undefined) {
        await this.options.profileStorage.write(
          storageKey,
          profile.snapshot.samples,
        );
      } else {
        try {
          const verified = createProfileBytesSnapshot(existing, {
            localSessionId: profile.localSessionId,
            sampleCount: profile.snapshot.sampleCount,
            sha256: profile.snapshot.sha256,
          });
          if (verified.bytes === profile.snapshot.bytes) {
            return {storageKey, contentRevision};
          }
        } catch {
          if (index === revisions.length - 1) {
            throw new GuestClaimServiceError('profile_corrupt');
          }
          continue;
        }
        if (index !== revisions.length - 1) {
          continue;
        }
        throw new GuestClaimServiceError('profile_corrupt');
      }
      this.assertCanContinue();
      const readback = createProfileBytesSnapshot(
        await this.options.profileStorage.read(storageKey),
        {
          localSessionId: profile.localSessionId,
          sampleCount: profile.snapshot.sampleCount,
          sha256: profile.snapshot.sha256,
        },
      );
      if (readback.bytes !== profile.snapshot.bytes) {
        throw new GuestClaimServiceError('profile_corrupt');
      }
      return {storageKey, contentRevision};
    }
    throw new GuestClaimServiceError('profile_corrupt');
  }

  private async isSyncedCapture(
    accountValue: DiveLogEntry | DivePlan,
    capture: ChangedGuestCapture,
    entityKind: GuestEntityKind,
  ): Promise<boolean> {
    if (
      accountValue.cloudSyncStatus !== 'synced' ||
      accountValue.ownerUserId !== this.options.userId ||
      accountValue.remoteId === undefined ||
      accountValue.remoteRevision === undefined ||
      canonicalClaimContent(accountValue) !==
        canonicalClaimContent(capture.record)
    ) {
      return false;
    }
    if (entityKind === 'log') {
      const accountProfile = (accountValue as DiveLogEntry).watchCapture
        ?.profile;
      if ((accountProfile === undefined) !== (capture.profile === undefined)) {
        return false;
      }
      if (capture.profile !== undefined) {
        const reconciledRevision = `${capture.profile.contentRevision}:reconciled:${capture.profile.snapshot.sha256.slice(0, 16)}`;
        if (
          accountProfile === undefined ||
          (accountProfile.contentRevision !== capture.profile.contentRevision &&
            accountProfile.contentRevision !== reconciledRevision) ||
          accountProfile.sampleCount !== capture.profile.snapshot.sampleCount ||
          accountProfile.sha256 !== capture.profile.snapshot.sha256 ||
          accountProfile.storageKey !==
            accountProfileStorageKey(
              this.options.userId,
              capture.profile.localSessionId,
              accountProfile.contentRevision,
            )
        ) {
          return false;
        }
        assertAccountProfileKey(accountProfile.storageKey, this.options.userId);
        await this.verifyAccountProfile(accountValue.localId, capture);
      }
    }
    const repository =
      entityKind === 'log'
        ? this.options.accountRepositories.logbook
        : this.options.accountRepositories.planbook;
    const readback = await repository.get(accountValue.localId);
    assertLocalReadback(accountValue, readback);
    if (capture.profile !== undefined) {
      await this.verifyAccountProfile(accountValue.localId, capture);
    }
    return true;
  }

  private async verifyAccountProfile(
    localId: string,
    capture: ChangedGuestCapture,
  ): Promise<void> {
    if (capture.profile === undefined) {
      return;
    }
    const profileReadback =
      await this.options.accountRepositories.logbook.getWatchProfile(localId);
    const verified = createProfileBytesSnapshot(profileReadback, {
      localSessionId: capture.profile.localSessionId,
      sampleCount: capture.profile.snapshot.sampleCount,
      sha256: capture.profile.snapshot.sha256,
    });
    if (verified.bytes !== capture.profile.snapshot.bytes) {
      throw new GuestClaimServiceError('profile_corrupt');
    }
  }

  private async removeSupersededAccountProfiles(
    storageKeys: Set<string>,
    promotedProfileKey: string | undefined,
  ): Promise<void> {
    for (const storageKey of storageKeys) {
      assertAccountProfileKey(storageKey, this.options.userId);
      if (storageKey === promotedProfileKey) {
        continue;
      }
      await this.options.accountRepositories.logbook.removeWatchProfileIfUnreferenced(
        storageKey,
      );
      this.assertCanContinue();
    }
  }

  private async deleteCapturedGuest(
    entityKind: GuestEntityKind,
    localId: string,
    capture: ChangedGuestCapture,
  ): Promise<void> {
    const repository =
      entityKind === 'log'
        ? this.options.guestRepositories.logbook
        : this.options.guestRepositories.planbook;
    const current = await repository.get(localId);
    if (current === undefined) {
      return;
    }
    if (canonicalLocal(current) !== capture.recordBytes) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    if (capture.profile !== undefined) {
      const currentLog = current as DiveLogEntry;
      const currentProfileKey = currentLog.watchCapture?.profile?.storageKey;
      if (currentProfileKey !== capture.profile.storageKey) {
        throw new GuestClaimServiceError('claim_validation_failed');
      }
      assertGuestProfileKey(currentProfileKey);
      const verified = createProfileBytesSnapshot(
        await this.options.profileStorage.read(currentProfileKey),
        {
          localSessionId: capture.profile.localSessionId,
          sampleCount: capture.profile.snapshot.sampleCount,
          sha256: capture.profile.snapshot.sha256,
        },
      );
      if (verified.bytes !== capture.profile.snapshot.bytes) {
        throw new GuestClaimServiceError('profile_corrupt');
      }
    }
    const deleteResult = entityKind === 'log'
      ? await this.options.guestRepositories.logbook.deleteIf(
          localId,
          candidate => canonicalLocal(candidate) === capture.recordBytes,
        )
      : await this.options.guestRepositories.planbook.deleteIf(
          localId,
          candidate => canonicalLocal(candidate) === capture.recordBytes,
        );
    if (deleteResult === 'conditionFailed') {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    this.assertCanContinue();
    if ((await repository.get(localId)) !== undefined) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
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
    if (snapshot?.manifest.status === 'committed') {
      try {
        const compact = compactCommittedGuestClaimSnapshot(snapshot);
        if (compact !== snapshot) {
          await this.options.store.write(compact);
          const readback = await this.options.store.read();
          if (
            readback === undefined ||
            readback.schemaVersion !== 2 ||
            readback.userId !== compact.userId ||
            readback.manifest.status !== 'committed' ||
            readback.manifest.clientBatchId !==
              compact.manifest.clientBatchId ||
            readback.manifest.manifestSha256 !==
              compact.manifest.manifestSha256 ||
            readback.snapshots.length !== 0 ||
            JSON.stringify(readback.historicalArtifacts) !==
              JSON.stringify(compact.historicalArtifacts)
          ) {
            throw new GuestClaimStorageError();
          }
          snapshot = readback;
        }
        await Promise.allSettled(
          claimProfileEvidenceStorageKeys(snapshot).map(storageKey =>
            this.options.profileStorage.remove(storageKey),
          ),
        );
      } catch {
        // A validated committed snapshot remains authoritative until compact
        // receipt publication and semantic readback both succeed.
      }
    } else if (snapshot?.schemaVersion === 1) {
      try {
        const migrated = await migrateGuestClaimSnapshotProfileSidecars(
          snapshot,
          this.options.profileStorage,
        );
        await this.options.store.write(migrated);
        snapshot = migrated;
      } catch {
        // A legacy inline snapshot remains authoritative until sidecar
        // materialization and durable checkpoint write both succeed.
      }
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
      return new GuestClaimServiceError(error.code, error.failure);
    }
    if (error instanceof GuestClaimProfileError) {
      return new GuestClaimServiceError(error.code);
    }
    if (error instanceof GuestClaimRepositoryError) {
      return new GuestClaimServiceError(error.kind);
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

type ExactCleanupItem = {
  item: GuestClaimItem;
  sidecar: GuestClaimSnapshotItem;
};

function assertBulkCleanupResults(
  items: readonly ExactCleanupItem[],
  results: ConditionalDeleteManyResult,
): void {
  for (const value of items) {
    const result = results.get(value.item.clientRecordId);
    if (result === 'deleted' || result === 'notFound') {
      continue;
    }
    throw cleanupItemError(value.item, value.sidecar);
  }
}

function cleanupItemError(
  item: GuestClaimItem,
  sidecar: GuestClaimSnapshotItem | undefined,
): GuestClaimServiceError {
  return new GuestClaimServiceError('claim_validation_failed', {
    phase: 'cleanup',
    entityKind: item.entityKind,
    clientRecordId: item.clientRecordId.slice(0, 512),
    ...(sidecar?.label === undefined
      ? {}
      : {label: sidecar.label.slice(0, 200)}),
  });
}

function isTransientClaimError(
  errorCode: GuestClaimErrorCode | undefined,
): boolean {
  return errorCode === 'network_unavailable';
}

function uploadReceiptIsComplete(snapshot: GuestClaimSnapshot): boolean {
  return (
    snapshot.manifest.remoteBatchId !== undefined &&
    snapshot.manifest.items.every(item => item.completedAt !== undefined)
  );
}

function isReplaceableLocalCheckpoint(
  snapshot: GuestClaimSnapshot,
): boolean {
  return (
    snapshot.manifest.remoteBatchId === undefined &&
    (snapshot.manifest.status === 'prepared' ||
      snapshot.manifest.status === 'deferred' ||
      snapshot.manifest.status === 'failed')
  );
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
  const canonicalTargets = new Map<string, string>();

  for (const [index, item] of snapshot.manifest.items.entries()) {
    const sidecar = snapshot.snapshots[index]!;
    const remote =
      item.entityKind === 'plan'
        ? plans.get(item.clientRecordId)
        : logs.get(item.clientRecordId);
    if (
      remote === undefined ||
      remote.payloadSha256 !== item.payloadSha256 ||
      remote.revision < 1
    ) {
      throw new GuestClaimServiceError('remote_conflict');
    }
    canonicalTargets.set(item.key, remote.id);
    const expectedPayload = parseSnapshotPayload(sidecar);
    const normalizedPayload = { ...remote.payload };
    if (item.entityKind === 'plan') {
      const target = item.convertedLogClientRecordId
        ? logs.get(item.convertedLogClientRecordId)?.id
        : undefined;
      if (normalizedPayload.converted_log_id !== (target ?? null)) {
        throw new GuestClaimServiceError('remote_conflict');
      }
      normalizedPayload.converted_log_id = expectedPayload.converted_log_id;
    } else {
      const target = item.sourcePlanClientRecordId
        ? plans.get(item.sourcePlanClientRecordId)?.id
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
      const expectedPath =
        item.profile === undefined
          ? undefined
          : sidecar.profileReadback?.path;
      if (
        (item.profile !== undefined && expectedPath === undefined) ||
        (remote as RemoteDiveLog).profilePath !== expectedPath
      ) {
        throw new GuestClaimServiceError('remote_conflict');
      }
    }
    let verifiedRemote: RemoteDiveLog | RemoteDivePlan;
    try {
      verifiedRemote =
        item.entityKind === 'plan'
          ? parseAccountRemotePlan({
              ...remote,
              payload: normalizedPayload,
            })
          : parseAccountRemoteLog({
              ...remote,
              payload: normalizedPayload,
            });
    } catch {
      throw new GuestClaimServiceError('remote_conflict');
    }
    if (
      canonicalAccountPayloadSha256(expectedPayload) !== item.payloadSha256
    ) {
      throw new GuestClaimServiceError('remote_conflict');
    }
    if (item.entityKind === 'plan') {
      plans.set(item.clientRecordId, verifiedRemote as RemoteDivePlan);
    } else {
      logs.set(item.clientRecordId, verifiedRemote as RemoteDiveLog);
    }
  }
  for (const item of snapshot.manifest.items) {
    item.targetRecordId = canonicalTargets.get(item.key)!;
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

function canonicalClaimContent(value: DiveLogEntry | DivePlan): string {
  const content = {...value};
  delete content.remoteId;
  delete content.remoteRevision;
  delete content.ownerUserId;
  delete content.cloudSyncStatus;
  if ('manual' in content && content.watchCapture?.profile !== undefined) {
    return canonicalJson({
      ...content,
      watchCapture: {...content.watchCapture, profile: undefined},
    });
  }
  return canonicalJson(content);
}

function assertDurableAccountIdentity(
  value: DiveLogEntry | DivePlan,
  userId: string,
): void {
  if (
    value.ownerUserId !== userId ||
    value.remoteId === undefined ||
    value.remoteId.length === 0 ||
    (value.remoteRevision !== undefined &&
      (!Number.isSafeInteger(value.remoteRevision) ||
        value.remoteRevision < 1))
  ) {
    throw new GuestClaimServiceError('claim_validation_failed');
  }
}

function originalAccountProfileKey(
  item: GuestClaimItem,
  sidecar: GuestClaimSnapshotItem,
  userId: string,
): string | undefined {
  if (item.entityKind !== 'log' || item.profile === undefined) {
    return undefined;
  }
  const original = parseSnapshotLocalRecord(sidecar) as DiveLogEntry;
  const localSessionId = original.watchCapture?.session.localSessionId;
  if (localSessionId === undefined) {
    throw new GuestClaimServiceError('claim_validation_failed');
  }
  const storageKey = accountProfileStorageKey(
    userId,
    localSessionId,
    item.profile.contentRevision,
  );
  assertAccountProfileKey(storageKey, userId);
  return storageKey;
}

function assertGuestProfileKey(storageKey: string): void {
  if (!storageKey.startsWith(dataProfileKeyPrefix({kind: 'guest'}))) {
    throw new GuestClaimServiceError('claim_validation_failed');
  }
}

function assertAccountProfileKey(storageKey: string, userId: string): void {
  if (!storageKey.startsWith(dataProfileKeyPrefix({kind: 'user', userId}))) {
    throw new GuestClaimServiceError('claim_validation_failed');
  }
}

function accountProfileStorageKey(
  userId: string,
  localSessionId: string,
  contentRevision: string,
): string {
  return `${dataProfileKeyPrefix({kind: 'user', userId})}${encodeURIComponent(
    localSessionId,
  )}:${encodeURIComponent(contentRevision)}`;
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
