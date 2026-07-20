import type {
  GuestClaimRemoteRepository,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';
import { GuestClaimRepositoryError } from '@repo/supabase';

import type { PrincipalRepositories } from '../repositories/principal-repositories';
import { dataProfileKeyPrefix } from '../storage/data-principal';
import type { WatchProfileStorage } from '../storage/watch-profile-storage';
import { canonicalAccountPayloadSha256 } from '../sync/account-payload';
import type { DiveLogEntry } from '../types/dive-log-entry';
import type { DivePlan } from '../types/dive-plan';
import {
  createGuestClaimSnapshot,
  claimProfileStillMatches,
  guestRecordMatchesClaimSnapshot,
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
  createProfileBytesSnapshot,
  encodeUtf8,
  GuestClaimProfileError,
  type ProfileBytesSnapshot,
  verifyRawProfileBytes,
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
      if (
        snapshot.manifest.status === 'cleanupPending' ||
        snapshot.manifest.status === 'committed'
      ) {
        return this.cleanup(snapshot);
      }
      if (
        snapshot.manifest.status === 'failed' &&
        isTransientClaimError(snapshot.errorCode)
      ) {
        snapshot.manifest.status = 'running';
        delete snapshot.errorCode;
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
    await this.writeAccountSnapshot(snapshot, verified);
    this.assertCanContinue();

    snapshot.manifest.status = 'cleanupPending';
    delete snapshot.errorCode;
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
    cleanupPendingPersisted = false,
  ): Promise<GuestClaimSnapshot> {
    if (!cleanupPendingPersisted) {
      snapshot.manifest.status = 'cleanupPending';
      delete snapshot.errorCode;
      await this.persist(snapshot);
    }
    try {
      for (const [index, item] of snapshot.manifest.items.entries()) {
        this.assertCanContinue();
        const repository =
          item.entityKind === 'plan'
            ? this.options.guestRepositories.planbook
            : this.options.guestRepositories.logbook;
        const current = await repository.get(item.clientRecordId);
        if (current === undefined) {
          continue;
        }
        const matches = await guestRecordMatchesClaimSnapshot({
          item,
          sidecar: snapshot.snapshots[index]!,
          record: current,
          profileStorage: this.options.profileStorage,
        });
        if (!matches) {
          await this.promoteChangedGuest(snapshot, index, current);
          continue;
        }
        if (item.entityKind === 'plan') {
          await this.options.guestRepositories.planbook.delete(
            item.clientRecordId,
          );
        } else {
          await this.options.guestRepositories.logbook.delete(
            item.clientRecordId,
            { retainProfileAfterDelete: true },
          );
        }
        this.assertCanContinue();
        if ((await repository.get(item.clientRecordId)) !== undefined) {
          throw new GuestClaimServiceError('claim_validation_failed');
        }
      }
      for (const [index, item] of snapshot.manifest.items.entries()) {
        if (
          item.profile !== undefined &&
          (await claimProfileStillMatches(
            item,
            snapshot.snapshots[index]!,
            this.options.profileStorage,
          ))
        ) {
          await this.options.guestRepositories.logbook.removeWatchProfileIfUnreferenced(
            item.profile.storageKey,
          );
        }
      }
      snapshot.manifest.status = 'committed';
      await this.persist(snapshot);
    } catch {
      snapshot.manifest.status = 'cleanupPending';
      await this.persist(snapshot);
    }
    return snapshot;
  }

  private async promoteChangedGuest(
    snapshot: GuestClaimSnapshot,
    index: number,
    current: DiveLogEntry | DivePlan,
  ): Promise<void> {
    const item = snapshot.manifest.items[index]!;
    const sidecar = snapshot.snapshots[index]!;
    const capture = await this.captureChangedGuest(item, current);
    const accountRepository =
      item.entityKind === 'log'
        ? this.options.accountRepositories.logbook
        : this.options.accountRepositories.planbook;
    const committed = await accountRepository.get(item.clientRecordId);
    if (
      committed === undefined ||
      committed.remoteId !== item.targetRecordId ||
      committed.ownerUserId !== this.options.userId ||
      committed.remoteRevision === undefined ||
      !Number.isSafeInteger(committed.remoteRevision) ||
      committed.remoteRevision < 1
    ) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }

    if (item.entityKind === 'plan') {
      const promoted: DivePlan = {
        ...(capture.record as DivePlan),
        remoteId: committed.remoteId,
        remoteRevision: committed.remoteRevision,
        ownerUserId: this.options.userId,
        cloudSyncStatus: 'pending',
      };
      await this.options.accountMutationRepositories.planbook.save(promoted);
      this.assertCanContinue();
      assertLocalReadback(
        promoted,
        await this.options.accountRepositories.planbook.get(
          item.clientRecordId,
        ),
      );
      await this.deleteCapturedGuest(item, capture);
      return;
    }

    let promoted: DiveLogEntry = {
      ...(capture.record as DiveLogEntry),
      remoteId: committed.remoteId,
      remoteRevision: committed.remoteRevision,
      ownerUserId: this.options.userId,
      cloudSyncStatus: 'pending',
    };
    let promotedProfileKey: string | undefined;
    if (capture.profile !== undefined && promoted.watchCapture !== undefined) {
      const accountProfile = await this.publishAccountProfile(capture.profile);
      promotedProfileKey = accountProfile.storageKey;
      promoted = {
        ...promoted,
        watchCapture: {
          ...promoted.watchCapture,
          profile: {
            ...promoted.watchCapture.profile!,
            storageKey: accountProfile.storageKey,
            contentRevision: accountProfile.contentRevision,
            sha256: capture.profile.snapshot.sha256,
            sampleCount: capture.profile.snapshot.sampleCount,
          },
        },
      };
    }

    await this.options.accountMutationRepositories.logbook.save(promoted);
    this.assertCanContinue();
    assertLocalReadback(
      promoted,
      await this.options.accountRepositories.logbook.get(item.clientRecordId),
    );
    if (capture.profile !== undefined) {
      const profileReadback =
        await this.options.accountRepositories.logbook.getWatchProfile(
          item.clientRecordId,
        );
      const verified = createProfileBytesSnapshot(profileReadback, {
        localSessionId: capture.profile.localSessionId,
        sampleCount: capture.profile.snapshot.sampleCount,
        sha256: capture.profile.snapshot.sha256,
      });
      if (verified.bytes !== capture.profile.snapshot.bytes) {
        throw new GuestClaimServiceError('profile_corrupt');
      }
    }
    await this.removeSupersededAccountProfile(
      item,
      sidecar,
      promotedProfileKey,
    );
    await this.deleteCapturedGuest(item, capture);
  }

  private async captureChangedGuest(
    item: GuestClaimItem,
    current: DiveLogEntry | DivePlan,
  ): Promise<ChangedGuestCapture> {
    if (current.localId !== item.clientRecordId) {
      throw new GuestClaimServiceError('claim_validation_failed');
    }
    const capture: ChangedGuestCapture = {
      record: current,
      recordBytes: canonicalLocal(current),
    };
    if (item.entityKind !== 'log') {
      return capture;
    }
    const log = current as DiveLogEntry;
    const reference = log.watchCapture?.profile;
    if (reference === undefined || log.watchCapture === undefined) {
      return capture;
    }
    assertGuestProfileKey(reference.storageKey);
    capture.profile = {
      storageKey: reference.storageKey,
      contentRevision: reference.contentRevision,
      localSessionId: log.watchCapture.session.localSessionId,
      snapshot: createProfileBytesSnapshot(
        await this.options.profileStorage.read(reference.storageKey),
        {
          localSessionId: log.watchCapture.session.localSessionId,
          sampleCount: reference.sampleCount,
          sha256: reference.sha256,
        },
      ),
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

  private async removeSupersededAccountProfile(
    item: GuestClaimItem,
    sidecar: GuestClaimSnapshotItem,
    promotedProfileKey: string | undefined,
  ): Promise<void> {
    if (item.profile === undefined) {
      return;
    }
    const original = parseSnapshotLocalRecord(sidecar) as DiveLogEntry;
    const originalKey = accountProfileStorageKey(
      this.options.userId,
      original.watchCapture!.session.localSessionId,
      item.profile.contentRevision,
    );
    if (originalKey !== promotedProfileKey) {
      await this.options.accountRepositories.logbook.removeWatchProfileIfUnreferenced(
        originalKey,
      );
      this.assertCanContinue();
    }
  }

  private async deleteCapturedGuest(
    item: GuestClaimItem,
    capture: ChangedGuestCapture,
  ): Promise<void> {
    const repository =
      item.entityKind === 'log'
        ? this.options.guestRepositories.logbook
        : this.options.guestRepositories.planbook;
    const current = await repository.get(item.clientRecordId);
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
    if (item.entityKind === 'log') {
      await this.options.guestRepositories.logbook.delete(item.clientRecordId);
    } else {
      await this.options.guestRepositories.planbook.delete(item.clientRecordId);
    }
    this.assertCanContinue();
    if ((await repository.get(item.clientRecordId)) !== undefined) {
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

function isTransientClaimError(
  errorCode: GuestClaimErrorCode | undefined,
): boolean {
  return errorCode === 'network_unavailable';
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

function assertGuestProfileKey(storageKey: string): void {
  if (!storageKey.startsWith(dataProfileKeyPrefix({kind: 'guest'}))) {
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
