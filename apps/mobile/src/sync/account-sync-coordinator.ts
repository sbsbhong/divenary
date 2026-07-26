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
import {
  ACCOUNT_PAYLOAD_SCHEMA_VERSION,
  parseAccountRemoteLog,
  parseAccountRemotePlan,
} from './account-payload';

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

type AssertCanCommit = () => void;

type AccountHydrationFailure = {
  entityKind: AccountOutboxItem['entityKind'];
  phase: 'listing' | 'row';
  error: unknown;
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
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const drainStateByUser = new Map<string, UserDrainState>();
const entityMutationQueues = new Map<string, Promise<void>>();

export class StaleAccountSyncCommitError extends Error {
  constructor() {
    super('Account sync commit is stale');
    this.name = 'StaleAccountSyncCommitError';
  }
}

export function isStaleAccountSyncCommitError(
  error: unknown,
): error is StaleAccountSyncCommitError {
  return error instanceof StaleAccountSyncCommitError;
}

export class AccountHydrationError extends Error {
  readonly changed: number;
  readonly failureCount: number;

  constructor(
    changed: number,
    failureCount: number,
    firstFailureLabel: string,
  ) {
    super(
      `Account hydration incomplete after ${changed} updates: ` +
        `${firstFailureLabel} (${failureCount} failures)`,
    );
    this.name = 'AccountHydrationError';
    this.changed = changed;
    this.failureCount = failureCount;
  }
}

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
  private commitGeneration = 0;
  private externalCommitGuard?: AssertCanCommit;

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

  setCommitGuard(guard: AssertCanCommit | undefined): void {
    this.commitGeneration += 1;
    this.externalCommitGuard = guard;
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
    const assertCanCommit = this.captureCommitGuard();
    assertCanCommit();
    let active!: Promise<AccountSyncDrainResult>;
    active = (async () => {
      let processed = 0;
      let remaining = 0;
      try {
        do {
          state.rerunRequested = false;
          const result = await this.drainPass(assertCanCommit);
          processed += result.processed;
          remaining = result.remaining;
          if (result.processed > 0) {
            assertCanCommit();
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
    this.commitGeneration += 1;
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

    const assertCanCommit = this.captureCommitGuard();
    assertCanCommit();
    const [logsResult, plansResult] = await Promise.all([
      settleHydrationCollection(
        collectPages(
          cursor =>
            this.accountRepository.listLogs({cursor, limit: PAGE_SIZE}),
          assertCanCommit,
        ),
      ),
      settleHydrationCollection(
        collectPages(
          cursor =>
            this.accountRepository.listPlans({cursor, limit: PAGE_SIZE}),
          assertCanCommit,
        ),
      ),
    ]);
    assertCanCommit();
    const failures: AccountHydrationFailure[] = [];
    const logs =
      logsResult.status === 'fulfilled'
        ? logsResult.value
        : (failures.push({
            entityKind: 'log',
            phase: 'listing',
            error: logsResult.reason,
          }),
          []);
    const plans =
      plansResult.status === 'fulfilled'
        ? plansResult.value
        : (failures.push({
            entityKind: 'plan',
            phase: 'listing',
            error: plansResult.reason,
          }),
          []);
    let changed = 0;

    for (const remoteValue of plans) {
      try {
        const remote = parseRemotePlan(remoteValue);
        changed += await withAccountEntityMutationLock(
          this.userId,
          'plan',
          remote.localId,
          async () => {
            assertCanCommit();
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
            if (current?.cloudSyncStatus === 'pending') {
              return 0;
            }
            const local = remotePlanToLocal(remote, this.userId);
            const recoveringConflict =
              current?.cloudSyncStatus === 'conflict';
            if (
              recoveringConflict &&
              !isEquivalentHistoricalConflict(current, local, this.userId)
            ) {
              return 0;
            }
            if (sameJsonValue(current, local)) {
              return 0;
            }
            try {
              await this.commitPlanSave(
                current,
                local,
                assertCanCommit,
                recoveringConflict
                  ? () =>
                      this.outbox.removeEntityConflicts(
                        this.userId,
                        'plan',
                        remote.localId,
                        {assertCanCommit},
                      )
                  : undefined,
              );
            } catch (error) {
              if (
                recoveringConflict &&
                !isStaleAccountSyncCommitError(error)
              ) {
                await this.restorePlan(current, remote.localId);
              }
              throw error;
            }
            return 1;
          },
        );
      } catch (error) {
        if (isStaleAccountSyncCommitError(error)) {
          throw error;
        }
        failures.push({entityKind: 'plan', phase: 'row', error});
      }
    }
    for (const remoteValue of logs) {
      try {
        const remote = parseRemoteLog(remoteValue);
        changed += await withAccountEntityMutationLock(
          this.userId,
          'log',
          remote.localId,
          async () => {
            assertCanCommit();
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
            if (current?.cloudSyncStatus === 'pending') {
              return 0;
            }
            const prepared = await this.prepareHydratedLog(
              remote,
              current,
              assertCanCommit,
            );
            const recoveringConflict =
              current?.cloudSyncStatus === 'conflict';
            if (
              recoveringConflict &&
              !isEquivalentHistoricalConflict(
                current,
                prepared.local,
                this.userId,
              )
            ) {
              await prepared.rollbackProfile?.();
              return 0;
            }
            if (sameJsonValue(current, prepared.local)) {
              return 0;
            }
            try {
              await this.commitLogSave(
                current,
                prepared.local,
                assertCanCommit,
                recoveringConflict
                  ? () =>
                      this.outbox.removeEntityConflicts(
                        this.userId,
                        'log',
                        remote.localId,
                        {assertCanCommit},
                      )
                  : undefined,
              );
            } catch (error) {
              if (
                recoveringConflict &&
                !isStaleAccountSyncCommitError(error)
              ) {
                await this.restoreLog(current, remote.localId);
              }
              await prepared.rollbackProfile?.();
              throw error;
            }
            return 1;
          },
        );
      } catch (error) {
        if (isStaleAccountSyncCommitError(error)) {
          throw error;
        }
        failures.push({entityKind: 'log', phase: 'row', error});
      }
    }
    if (failures.length > 0) {
      throw new AccountHydrationError(
        changed,
        failures.length,
        safeHydrationFailureLabel(failures[0]),
      );
    }
    return changed;
  }

  private async drainPass(
    assertCanCommit: AssertCanCommit,
  ): Promise<AccountSyncDrainResult> {
    assertCanCommit();
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
        await this.deliver(head, assertCanCommit);
        processed += 1;
      } catch (error) {
        if (isStaleAccountSyncCommitError(error)) {
          throw error;
        }
        assertCanCommit();
        await this.outbox.reschedule(head.userId, head.operationId, {
          assertCanCommit,
        });
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

  private deliver(
    item: AccountOutboxItem,
    assertCanCommit: AssertCanCommit,
  ): Promise<void> {
    if (item.userId !== this.userId) {
      throw new Error('Account outbox operation belongs to another user');
    }
    return withAccountEntityMutationLock(
      item.userId,
      item.entityKind,
      item.entityLocalId,
      () => {
        assertCanCommit();
        return (
        item.entityKind === 'log'
          ? this.deliverLog(item, assertCanCommit)
          : this.deliverPlan(item, assertCanCommit)
        );
      },
    );
  }

  private async deliverLog(
    item: AccountOutboxItem,
    assertCanCommit: AssertCanCommit,
  ): Promise<void> {
    const local = requiredLocalLog(item.payload);
    const remote = requiredRemoteLog(item.payload);
    assertOperationEntity(item, local.localId, remote.localId);
    let result: AccountMutationResult<RemoteDiveLog>;

    if (item.mutation === 'delete') {
      if (item.expectedRevision === undefined) {
        throw new Error('Delete operation is missing its expected revision');
      }
      assertCanCommit();
      const rawResult = await this.accountRepository.deleteLog(
        remote.id,
        item.expectedRevision,
      );
      assertCanCommit();
      result = parseLogMutationResult(rawResult);
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
        assertCanCommit();
        await this.profileUploader.uploadProfile(remote.profilePath, bytes);
        assertCanCommit();
      }
      result = await this.saveLogWithRecovery(
        remote,
        item.expectedRevision,
        assertCanCommit,
      );
    }

    if (result.status === 'conflict') {
      const current = await this.logbookRepository.get(item.entityLocalId);
      if (item.mutation === 'delete' && current === undefined) {
        assertCanCommit();
        await this.outbox.complete(item.userId, item.operationId, {
          assertCanCommit,
        });
        return;
      }
      if (!current) {
        throw new Error('Current local log is missing during conflict');
      }
      const conflicted = {...current, cloudSyncStatus: 'conflict' as const};
      await this.commitLogSave(
        current,
        conflicted,
        assertCanCommit,
        async () => {
          assertCanCommit();
          await this.outbox.recordConflict(
            item,
            localAsRecord(conflicted),
            remoteAsRecord(result.remote),
            {assertCanCommit},
          );
        },
      );
      return;
    }

    if (item.mutation === 'upsert') {
      const current = await this.logbookRepository.get(item.entityLocalId);
      if (!current) {
        throw new Error('Current local log is missing after remote save');
      }
      const hasPendingEdit = await this.hasLaterUpsert(item);
      const saved = {
        ...current,
        remoteId: result.value.id,
        remoteRevision: result.value.revision,
        ownerUserId: this.userId,
        cloudSyncStatus: hasPendingEdit ? 'pending' : 'synced',
      } as DiveLogEntry;
      await this.commitLogSave(
        current,
        saved,
        assertCanCommit,
        async () => {
          assertCanCommit();
          await this.outbox.completeSavedUpsert(item, result.value.revision, {
            assertCanCommit,
          });
        },
      );
      return;
    }
    const current = await this.logbookRepository.get(item.entityLocalId);
    await this.commitLogDelete(
      current ?? local,
      item.entityLocalId,
      assertCanCommit,
      async () => {
        assertCanCommit();
        await this.outbox.complete(item.userId, item.operationId, {
          assertCanCommit,
        });
      },
    );
  }

  private async deliverPlan(
    item: AccountOutboxItem,
    assertCanCommit: AssertCanCommit,
  ): Promise<void> {
    const local = requiredLocalPlan(item.payload);
    const remote = requiredRemotePlan(item.payload);
    assertOperationEntity(item, local.localId, remote.localId);
    let result: AccountMutationResult<RemoteDivePlan>;

    if (item.mutation === 'delete') {
      if (item.expectedRevision === undefined) {
        throw new Error('Delete operation is missing its expected revision');
      }
      assertCanCommit();
      const rawResult = await this.accountRepository.deletePlan(
        remote.id,
        item.expectedRevision,
      );
      assertCanCommit();
      result = parsePlanMutationResult(rawResult);
    } else {
      result = await this.savePlanWithRecovery(
        remote,
        item.expectedRevision,
        assertCanCommit,
      );
    }

    if (result.status === 'conflict') {
      const current = await this.planRepository.get(item.entityLocalId);
      if (item.mutation === 'delete' && current === undefined) {
        assertCanCommit();
        await this.outbox.complete(item.userId, item.operationId, {
          assertCanCommit,
        });
        return;
      }
      if (!current) {
        throw new Error('Current local plan is missing during conflict');
      }
      const conflicted = {...current, cloudSyncStatus: 'conflict' as const};
      await this.commitPlanSave(
        current,
        conflicted,
        assertCanCommit,
        async () => {
          assertCanCommit();
          await this.outbox.recordConflict(
            item,
            localAsRecord(conflicted),
            remoteAsRecord(result.remote),
            {assertCanCommit},
          );
        },
      );
      return;
    }

    if (item.mutation === 'upsert') {
      const current = await this.planRepository.get(item.entityLocalId);
      if (!current) {
        throw new Error('Current local plan is missing after remote save');
      }
      const hasPendingEdit = await this.hasLaterUpsert(item);
      const saved = {
        ...current,
        remoteId: result.value.id,
        remoteRevision: result.value.revision,
        ownerUserId: this.userId,
        cloudSyncStatus: hasPendingEdit ? 'pending' : 'synced',
      } as DivePlan;
      await this.commitPlanSave(
        current,
        saved,
        assertCanCommit,
        async () => {
          assertCanCommit();
          await this.outbox.completeSavedUpsert(item, result.value.revision, {
            assertCanCommit,
          });
        },
      );
      return;
    }
    await this.commitPlanDelete(item.entityLocalId, assertCanCommit, async () => {
      assertCanCommit();
      await this.outbox.complete(item.userId, item.operationId, {
        assertCanCommit,
      });
    });
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
    assertCanCommit: AssertCanCommit,
  ): Promise<AccountMutationResult<RemoteDiveLog>> {
    try {
      assertCanCommit();
      const result = await this.accountRepository.saveLog(
        remote,
        expectedRevision,
      );
      assertCanCommit();
      return parseLogMutationResult(result);
    } catch (error) {
      if (isStaleAccountSyncCommitError(error)) {
        throw error;
      }
      assertCanCommit();
      let recovered: RemoteDiveLog | undefined;
      try {
        recovered = await this.findRemoteLog(remote, assertCanCommit);
      } catch (recoveryError) {
        if (isStaleAccountSyncCommitError(recoveryError)) {
          throw recoveryError;
        }
      }
      if (recovered) {
        return {status: 'saved', value: recovered};
      }
      throw error;
    }
  }

  private async savePlanWithRecovery(
    remote: RemoteDivePlan,
    expectedRevision: number | undefined,
    assertCanCommit: AssertCanCommit,
  ): Promise<AccountMutationResult<RemoteDivePlan>> {
    try {
      assertCanCommit();
      const result = await this.accountRepository.savePlan(
        remote,
        expectedRevision,
      );
      assertCanCommit();
      return parsePlanMutationResult(result);
    } catch (error) {
      if (isStaleAccountSyncCommitError(error)) {
        throw error;
      }
      assertCanCommit();
      let recovered: RemoteDivePlan | undefined;
      try {
        recovered = await this.findRemotePlan(remote, assertCanCommit);
      } catch (recoveryError) {
        if (isStaleAccountSyncCommitError(recoveryError)) {
          throw recoveryError;
        }
      }
      if (recovered) {
        return {status: 'saved', value: recovered};
      }
      throw error;
    }
  }

  private async findRemoteLog(
    expected: RemoteDiveLog,
    assertCanCommit: AssertCanCommit,
  ): Promise<RemoteDiveLog | undefined> {
    const logs = await collectPages(
      cursor => this.accountRepository.listLogs({cursor, limit: PAGE_SIZE}),
      assertCanCommit,
    );
    return logs
      .map(parseRemoteLog)
      .find(remote => sameRemoteLogMutation(remote, expected));
  }

  private async findRemotePlan(
    expected: RemoteDivePlan,
    assertCanCommit: AssertCanCommit,
  ): Promise<RemoteDivePlan | undefined> {
    const plans = await collectPages(
      cursor => this.accountRepository.listPlans({cursor, limit: PAGE_SIZE}),
      assertCanCommit,
    );
    return plans
      .map(parseRemotePlan)
      .find(remote => sameRemotePlanMutation(remote, expected));
  }

  private async prepareHydratedLog(
    remote: RemoteDiveLog,
    current: DiveLogEntry | undefined,
    assertCanCommit: AssertCanCommit,
  ): Promise<{
    local: DiveLogEntry;
    rollbackProfile?: () => Promise<void>;
  }> {
    if (remote.profilePath === undefined) {
      return {local: remoteLogToLocal(remote, this.userId)};
    }
    if (!this.profileDownloader || !this.profileStorage) {
      throw new Error('Remote profile hydration is unavailable');
    }
    const descriptor = remoteProfileDescriptor(remote);
    if (
      !isCanonicalRemoteProfilePath(
        remote.profilePath,
        this.userId,
        remote.id,
        descriptor.contentRevision,
      )
    ) {
      throw new Error('Malformed remote log profile path');
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
    if (
      current?.cloudSyncStatus === 'synced' &&
      sameJsonValue(current, local)
    ) {
      try {
        assertCanCommit();
        const cachedSamples = await this.profileStorage.read(storageKey);
        assertCanCommit();
        if (cachedSamples !== undefined) {
          validateSerializedProfile(
            JSON.stringify(cachedSamples),
            remote,
            localSessionId,
          );
          return {local};
        }
      } catch (error) {
        if (isStaleAccountSyncCommitError(error)) {
          throw error;
        }
      }
    }

    assertCanCommit();
    const bytes = await this.profileDownloader.downloadProfile(remote.profilePath);
    assertCanCommit();
    if (bytes.length !== descriptor.byteCount) {
      throw new Error('Malformed remote log profile byte count');
    }
    if (bytesToHex(sha256(bytes)) !== descriptor.sha256) {
      throw new Error('Malformed remote log profile digest');
    }
    const samples = parseProfileSamples(bytesToUtf8(bytes), localSessionId);
    if (samples.length !== descriptor.sampleCount) {
      throw new Error('Malformed remote log profile sample count');
    }

    const previousProfile = await this.profileStorage.read(storageKey);
    assertCanCommit();
    const rollbackProfile = async () => {
      if (previousProfile === undefined) {
        await this.profileStorage?.remove(storageKey);
      } else {
        await this.profileStorage?.write(storageKey, previousProfile);
      }
    };
    try {
      await this.profileStorage.write(storageKey, samples);
      assertCanCommit();
    } catch (error) {
      await rollbackProfile();
      throw error;
    }
    return {local, rollbackProfile};
  }

  private async commitLogSave(
    previous: DiveLogEntry | undefined,
    next: DiveLogEntry,
    assertCanCommit: AssertCanCommit,
    finalize?: () => Promise<void>,
  ): Promise<void> {
    assertCanCommit();
    await this.logbookRepository.save(next);
    try {
      assertCanCommit();
      await finalize?.();
    } catch (error) {
      if (isStaleAccountSyncCommitError(error)) {
        await this.restoreLog(previous, next.localId);
      }
      throw error;
    }
  }

  private async commitPlanSave(
    previous: DivePlan | undefined,
    next: DivePlan,
    assertCanCommit: AssertCanCommit,
    finalize?: () => Promise<void>,
  ): Promise<void> {
    assertCanCommit();
    await this.planRepository.save(next);
    try {
      assertCanCommit();
      await finalize?.();
    } catch (error) {
      if (isStaleAccountSyncCommitError(error)) {
        await this.restorePlan(previous, next.localId);
      }
      throw error;
    }
  }

  private async commitLogDelete(
    previous: DiveLogEntry | undefined,
    localId: string,
    assertCanCommit: AssertCanCommit,
    finalize: () => Promise<void>,
  ): Promise<void> {
    assertCanCommit();
    await this.logbookRepository.delete(localId, {
      retainProfileAfterDelete: true,
    });
    assertCanCommit();
    const profileKey = previous?.watchCapture?.profile?.storageKey;
    if (profileKey) {
      await this.logbookRepository.removeWatchProfileIfUnreferenced(profileKey);
      assertCanCommit();
    }
    await finalize();
  }

  private async commitPlanDelete(
    localId: string,
    assertCanCommit: AssertCanCommit,
    finalize: () => Promise<void>,
  ): Promise<void> {
    assertCanCommit();
    await this.planRepository.delete(localId);
    assertCanCommit();
    await finalize();
  }

  private async restoreLog(
    previous: DiveLogEntry | undefined,
    localId: string,
  ): Promise<void> {
    if (previous) {
      await this.logbookRepository.save(previous);
    } else {
      await this.logbookRepository.delete(localId);
    }
  }

  private async restorePlan(
    previous: DivePlan | undefined,
    localId: string,
  ): Promise<void> {
    if (previous) {
      await this.planRepository.save(previous);
    } else {
      await this.planRepository.delete(localId);
    }
  }

  private captureCommitGuard(): AssertCanCommit {
    const generation = this.commitGeneration;
    const external = this.externalCommitGuard;
    return () => {
      if (generation !== this.commitGeneration) {
        throw new StaleAccountSyncCommitError();
      }
      external?.();
    };
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
  assertCanCommit: AssertCanCommit,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: AccountDataCursor | undefined;
  do {
    assertCanCommit();
    const page = await list(cursor);
    assertCanCommit();
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return items;
}

async function settleHydrationCollection<T>(
  collection: Promise<T>,
): Promise<
  | {status: 'fulfilled'; value: T}
  | {status: 'rejected'; reason: unknown}
> {
  try {
    return {status: 'fulfilled', value: await collection};
  } catch (error) {
    if (isStaleAccountSyncCommitError(error)) {
      throw error;
    }
    return {status: 'rejected', reason: error};
  }
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
  return parseAccountRemoteLog(value);
}

function parseRemotePlan(value: unknown): RemoteDivePlan {
  return parseAccountRemotePlan(value);
}

function parseLogMutationResult(
  result: AccountMutationResult<RemoteDiveLog>,
): AccountMutationResult<RemoteDiveLog> {
  return result.status === 'saved'
    ? {status: 'saved', value: parseRemoteLog(result.value)}
    : {status: 'conflict', remote: parseRemoteLog(result.remote)};
}

function parsePlanMutationResult(
  result: AccountMutationResult<RemoteDivePlan>,
): AccountMutationResult<RemoteDivePlan> {
  return result.status === 'saved'
    ? {status: 'saved', value: parseRemotePlan(result.value)}
    : {status: 'conflict', remote: parseRemotePlan(result.remote)};
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
    const localPlanData = cloneRecord(planData);
    delete localPlanData._schemaVersion;
    const candidate = {
      ...localPlanData,
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

function isCanonicalRemoteProfilePath(
  profilePath: string,
  userId: string,
  remoteId: string,
  contentRevision: string,
): boolean {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(profilePath);
  } catch {
    return false;
  }
  const decodedSegments = decodedPath.split('/');
  if (
    /%(?:2e|2f|5c)/i.test(profilePath) ||
    /%(?:2e|2f|5c)/i.test(decodedPath) ||
    decodedPath.includes('\\') ||
    decodedSegments.some(segment => segment === '.' || segment === '..')
  ) {
    return false;
  }

  const encodedRevision = `${encodeURIComponent(contentRevision)}.json`;
  const logPath = `${userId}/logs/${remoteId}/${encodedRevision}`;
  if (profilePath === logPath) {
    return true;
  }

  const segments = profilePath.split('/');
  return (
    segments.length === 5 &&
    segments[0] === userId &&
    segments[1] === 'claims' &&
    UUID_PATTERN.test(segments[2] ?? '') &&
    segments[3] === remoteId &&
    segments[4] === encodedRevision
  );
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
    !hasExactKeys(value, ['schemaVersion', 'createdAt', 'updatedAt']) ||
    value.schemaVersion !== ACCOUNT_PAYLOAD_SCHEMA_VERSION ||
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

function isEquivalentHistoricalConflict(
  current: DiveLogEntry | DivePlan | undefined,
  remote: DiveLogEntry | DivePlan,
  userId: string,
): boolean {
  return (
    current !== undefined &&
    current.cloudSyncStatus === 'conflict' &&
    current.ownerUserId === userId &&
    current.localId === remote.localId &&
    current.remoteId === remote.remoteId &&
    sameJsonValue(accountDomainValue(current), accountDomainValue(remote))
  );
}

function accountDomainValue(
  value: DiveLogEntry | DivePlan,
): Record<string, unknown> {
  const result = cloneRecord(value as unknown as Record<string, unknown>);
  delete result.remoteId;
  delete result.remoteRevision;
  delete result.ownerUserId;
  delete result.cloudSyncStatus;
  if (isRecord(result.watchCapture)) {
    const watchCapture = cloneRecord(result.watchCapture);
    if (isRecord(watchCapture.profile)) {
      const profile = cloneRecord(watchCapture.profile);
      delete profile.storageKey;
      watchCapture.profile = profile;
    }
    result.watchCapture = watchCapture;
  }
  return result;
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

function safeHydrationFailureLabel(
  failure: AccountHydrationFailure,
): string {
  if (failure.phase === 'listing') {
    return failure.entityKind === 'log'
      ? 'Remote log listing failed'
      : 'Remote plan listing failed';
  }
  const message = errorMessage(failure.error);
  const knownLabels = [
    'Malformed remote log profile path',
    'Malformed remote log profile byte count',
    'Malformed remote log profile digest',
    'Malformed remote log profile sample count',
    'Malformed remote log',
    'Malformed remote plan',
    'Remote profile hydration is unavailable',
    'Malformed account profile JSON',
    'Malformed account profile samples',
  ];
  return (
    knownLabels.find(label => message.startsWith(label)) ??
    (failure.entityKind === 'log'
      ? 'Remote log hydration failed'
      : 'Remote plan hydration failed')
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
