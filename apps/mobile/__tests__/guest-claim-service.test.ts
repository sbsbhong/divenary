import type {
  GuestClaimRemoteRepository,
  GuestClaimStageInput,
  RemoteDiveLog,
  RemoteDivePlan,
} from '@repo/supabase';
import {
  createGuestClaimSnapshot,
  GuestClaimStore,
  type GuestClaimSnapshot,
} from '../src/claim/guest-claim-store';
import {
  GuestClaimService,
  GuestClaimServiceError,
} from '../src/claim/guest-claim-service';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type { PersistentKeyValueStore } from '../src/storage/persistent-key-value-store';
import type { WatchProfileStorage } from '../src/storage/watch-profile-storage';
import type { DiveLogRepository } from '../src/repositories/dive-log-repository';
import type { DivePlanRepository } from '../src/repositories/dive-plan-repository';
import type { PrincipalRepositories } from '../src/repositories/principal-repositories';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { DivePlan } from '../src/types/dive-plan';
import type { WatchDepthSample } from '../src/types/dive-session';

const userId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const batchId = '10000000-0000-4000-8000-000000000001';

type TestRepositories = PrincipalRepositories & {
  logbook: jest.Mocked<DiveLogRepository>;
  planbook: jest.Mocked<DivePlanRepository>;
};

describe('guest claim service', () => {
  beforeEach(() => {
    profileRegistry.clear();
  });

  it('stages plans before logs and persists profile readback before progress and finalization', async () => {
    const order: string[] = [];
    const storage = new RecordingStorage(order);
    const profile = profileStorage();
    const fullSamples = depthSamples(200);
    await profile.write('guest-profile', fullSamples);
    const guest = repositories(
      [watchLog('log-a', fullSamples.slice(0, 160))],
      [divePlan('plan-a', 'log-a')],
      order,
    );
    const account = repositories([], [], order, 'account');
    const store = new GuestClaimStore({ storage, userId, now: clock() });
    const download = deferred<Uint8Array>();
    const remote = remoteRepository(store, order, {
      downloadProfile: jest.fn(() => download.promise),
    });
    const progress: Array<{ completed: number; total: number; phase: string }> =
      [];
    const service = claimService({
      store,
      guest,
      account,
      profile,
      remote,
      order,
      onProgress: value => progress.push(value),
    });

    const running = service.start();
    await waitFor(() => expect(remote.downloadProfile).toHaveBeenCalled());

    expect(
      remote.stageRecord.mock.calls.map(([input]) => input.entityKind),
    ).toEqual(['plan', 'log']);
    expect(progress.map(value => value.completed)).toEqual([0, 1]);
    const path = remote.uploadProfile.mock.calls[0]?.[0];
    expect(path).toBe(
      `${userId}/claims/${batchId}/30000000-0000-4000-8000-000000000002/revision-1.json`,
    );
    const uploaded = remote.uploadProfile.mock.calls[0]?.[1];
    download.resolve(uploaded!);

    const result = await running;

    expect(result?.manifest.status).toBe('committed');
    expect(
      progress
        .filter(value => value.phase === 'uploading')
        .map(value => value.completed),
    ).toEqual([0, 1, 2]);
    expect(progress.at(-1)).toMatchObject({ completed: 2, total: 2 });
    expect(order).toEqual(
      expect.arrayContaining([
        'remote:finalize',
        'account:save:plan:plan-a',
        'account:save:log:log-a',
        'persist:committed',
        'guest:delete:plan:plan-a',
        'guest:delete:log:log-a',
      ]),
    );
    expect(order.indexOf('remote:finalize')).toBeLessThan(
      order.indexOf('account:save:plan:plan-a'),
    );
    expect(order.indexOf('account:save:log:log-a')).toBeLessThan(
      order.indexOf('persist:committed'),
    );
    expect(order.indexOf('persist:committed')).toBeLessThan(
      order.indexOf('guest:delete:plan:plan-a'),
    );
    await expect(account.planbook.get('plan-a')).resolves.toMatchObject({
      ownerUserId: userId,
      remoteId: '30000000-0000-4000-8000-000000000001',
      cloudSyncStatus: 'synced',
    });
    const accountLog = await account.logbook.get('log-a');
    expect(accountLog).toMatchObject({
      ownerUserId: userId,
      remoteId: '30000000-0000-4000-8000-000000000002',
      cloudSyncStatus: 'synced',
    });
    expect(accountLog?.watchCapture?.profile?.storageKey).toContain(
      encodeURIComponent(`user:${userId}`),
    );
    await expect(
      account.logbook.getWatchProfile('log-a'),
    ).resolves.toHaveLength(200);
  });

  it('resumes at exactly 3 / 32 from persisted completion rather than memory', async () => {
    const storage = new InMemoryKeyValueStore();
    const guest = repositories(
      Array.from({ length: 32 }, (_, index) =>
        diveLog(`log-${String(index).padStart(2, '0')}`),
      ),
      [],
    );
    const store = new GuestClaimStore({ storage, userId, now: clock() });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guest.logbook,
      planRepository: guest.planbook,
      profileStorage: profileStorage(),
      now: () => 100,
    });
    snapshot.manifest.status = 'running';
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.manifest.updatedAt = 103;
    snapshot.manifest.items = snapshot.manifest.items.map((item, index) =>
      index < 3
        ? {
            ...item,
            stagingRecordId: uuid('2', index + 1),
            targetRecordId: uuid('3', index + 1),
            completedAt: 101 + index,
          }
        : item,
    );
    await store.write(snapshot);
    const remote = remoteRepository(store, [], {
      stageRecord: jest.fn(async () => {
        throw new GuestClaimServiceError('network_unavailable');
      }),
    });
    const progress = jest.fn();
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
      onProgress: progress,
    });

    const result = await service.resume();

    expect(progress.mock.calls[0]?.[0]).toMatchObject({
      completed: 3,
      total: 32,
      phase: 'uploading',
    });
    expect(result?.manifest.status).toBe('failed');
    expect(result?.errorCode).toBe('network_unavailable');
  });

  it('reuses one remote batch and safely repeats a stage after an interrupted response', async () => {
    const storage = new InMemoryKeyValueStore();
    const guest = repositories([diveLog('log-a')], []);
    const account = repositories([], []);
    const store = new GuestClaimStore({ storage, userId, now: clock() });
    const baseRemote = remoteRepository(store);
    let stageAttempt = 0;
    baseRemote.stageRecord.mockImplementation(async input => {
      stageAttempt += 1;
      if (stageAttempt === 1) {
        throw new GuestClaimServiceError('network_unavailable');
      }
      return targetFor(input);
    });
    const first = claimService({
      store,
      guest,
      account,
      profile: profileStorage(),
      remote: baseRemote,
    });

    await expect(first.start()).resolves.toMatchObject({
      manifest: { status: 'failed', remoteBatchId: batchId },
    });
    const resumed = claimService({
      store,
      guest,
      account,
      profile: profileStorage(),
      remote: baseRemote,
    });
    const result = await resumed.retry();

    expect(result?.manifest.status).toBe('committed');
    expect(baseRemote.createOrLoadBatch).toHaveBeenCalledTimes(2);
    expect(baseRemote.createOrLoadBatch.mock.calls[1]?.[0]).toEqual(
      baseRemote.createOrLoadBatch.mock.calls[0]?.[0],
    );
    expect(baseRemote.stageRecord).toHaveBeenCalledTimes(2);
    expect(baseRemote.stageRecord.mock.calls[1]?.[0]).toEqual(
      baseRemote.stageRecord.mock.calls[0]?.[0],
    );
  });

  it('defers without touching originals and later uploads the immutable snapshot', async () => {
    const guest = repositories([diveLog('log-a', 'original')], []);
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });

    await service.prepare();
    const deferredSnapshot = await service.defer();
    await guest.logbook.save(diveLog('log-a', 'changed after process exit'));

    expect(deferredSnapshot?.manifest.status).toBe('deferred');
    expect(remote.createOrLoadBatch).not.toHaveBeenCalled();
    expect(guest.logbook.delete).not.toHaveBeenCalled();

    await claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    }).retry();
    expect(remote.stageRecord.mock.calls[0]?.[0].payload).toMatchObject({
      title: 'original',
    });
  });

  it('creates a new manifest for guest rows added after a committed snapshot', async () => {
    const guest = repositories([diveLog('log-a')], []);
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });
    const first = await service.start();
    await guest.logbook.save(diveLog('log-b'));

    const second = await service.prepare();

    expect(second?.manifest.items.map(item => item.clientRecordId)).toEqual([
      'log-b',
    ]);
    expect(second?.manifest.clientBatchId).not.toBe(
      first?.manifest.clientBatchId,
    );
  });

  it('persists cleanupPending, hides claimed ids, and retries cleanup without finalizing twice', async () => {
    const order: string[] = [];
    const guest = repositories([diveLog('log-a')], [], order);
    const deleteLog = guest.logbook.delete.getMockImplementation()!;
    guest.logbook.delete
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockImplementationOnce(deleteLog);
    const store = new GuestClaimStore({
      storage: new RecordingStorage(order),
      userId,
      now: clock(),
    });
    const remote = remoteRepository(store, order);
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
      order,
    });

    const first = await service.start();

    expect(first?.manifest.status).toBe('cleanupPending');
    await expect(service.hiddenGuestIds()).resolves.toEqual({
      logIds: new Set(['log-a']),
      planIds: new Set(),
    });
    expect(order.indexOf('persist:committed')).toBeLessThan(
      order.indexOf('persist:cleanupPending'),
    );

    const retried = await service.resume();

    expect(retried?.manifest.status).toBe('committed');
    expect(remote.finalize).toHaveBeenCalledTimes(1);
    expect(remote.listCommittedBatch).toHaveBeenCalledTimes(1);
    expect(guest.logbook.delete).toHaveBeenCalledTimes(2);
  });

  it('fails closed for a second user or mismatched committed readback', async () => {
    const storage = new InMemoryKeyValueStore();
    const guest = repositories([diveLog('log-a')], []);
    const store = new GuestClaimStore({ storage, userId, now: clock() });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guest.logbook,
      planRepository: guest.planbook,
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const foreignService = new GuestClaimService({
      userId: otherUserId,
      store: { read: async () => snapshot, write: async () => undefined },
      guestRepositories: guest,
      accountRepositories: repositories([], []),
      profileStorage: profileStorage(),
      remoteRepository: remoteRepository(store),
      now: clock(),
    });
    await expect(foreignService.resume()).rejects.toMatchObject({
      code: 'claim_validation_failed',
    });

    const remote = remoteRepository(store, [], {
      listCommittedBatch: jest.fn(async () => ({
        plans: [],
        logs: [remoteLog('wrong-local-id')],
      })),
    });
    const service = claimService({
      store,
      guest,
      account: repositories([], []),
      profile: profileStorage(),
      remote,
    });
    const result = await service.start();

    expect(result?.manifest.status).toBe('failed');
    expect(result?.errorCode).toBe('remote_conflict');
    expect(guest.logbook.delete).not.toHaveBeenCalled();
  });

  it('reports a missing immutable profile through the claim error contract', async () => {
    const store = new GuestClaimStore({
      storage: new InMemoryKeyValueStore(),
      userId,
      now: clock(),
    });
    const service = claimService({
      store,
      guest: repositories([watchLog('log-a', [])], []),
      account: repositories([], []),
      profile: profileStorage(),
      remote: remoteRepository(store),
    });

    await expect(service.start()).rejects.toBeInstanceOf(
      GuestClaimServiceError,
    );
    await expect(service.start()).rejects.toMatchObject({
      code: 'profile_missing',
    });
  });
});

function claimService(input: {
  store: GuestClaimStore;
  guest: PrincipalRepositories;
  account: PrincipalRepositories;
  profile: WatchProfileStorage;
  remote: jest.Mocked<GuestClaimRemoteRepository>;
  order?: string[];
  onProgress?: ConstructorParameters<typeof GuestClaimService>[0]['onProgress'];
}) {
  return new GuestClaimService({
    userId,
    store: input.store,
    guestRepositories: input.guest,
    accountRepositories: input.account,
    profileStorage: input.profile,
    remoteRepository: input.remote,
    now: clock(),
    onProgress: input.onProgress,
  });
}

function remoteRepository(
  store: GuestClaimStore,
  order: string[] = [],
  overrides: Partial<GuestClaimRemoteRepository> = {},
): jest.Mocked<GuestClaimRemoteRepository> {
  const uploaded = new Map<string, Uint8Array>();
  const repository: GuestClaimRemoteRepository = {
    async createOrLoadBatch() {
      order.push('remote:batch');
      return { id: batchId, status: 'uploading' };
    },
    async stageRecord(input) {
      order.push(`remote:stage:${input.entityKind}:${input.clientRecordId}`);
      return targetFor(input);
    },
    async attachProfile() {
      order.push('remote:attach-profile');
    },
    async uploadProfile(path, bytes) {
      order.push('remote:upload-profile');
      uploaded.set(path, bytes);
    },
    async downloadProfile(path) {
      order.push('remote:download-profile');
      const bytes = uploaded.get(path);
      if (!bytes) {
        throw new Error('missing upload');
      }
      return bytes;
    },
    async finalize() {
      order.push('remote:finalize');
      const snapshot = await store.read();
      return {
        status: 'committed',
        planCount: snapshot?.manifest.planCount ?? 0,
        logCount: snapshot?.manifest.logCount ?? 0,
      };
    },
    async listCommittedBatch() {
      order.push('remote:list');
      const snapshot = await store.read();
      if (!snapshot) {
        throw new Error('missing snapshot');
      }
      return committedRows(snapshot);
    },
    ...overrides,
  };
  return {
    createOrLoadBatch: jest.fn(repository.createOrLoadBatch),
    stageRecord: jest.fn(repository.stageRecord),
    attachProfile: jest.fn(repository.attachProfile),
    uploadProfile: jest.fn(repository.uploadProfile),
    downloadProfile: jest.fn(repository.downloadProfile),
    finalize: jest.fn(repository.finalize),
    listCommittedBatch: jest.fn(repository.listCommittedBatch),
  };
}

function targetFor(input: GuestClaimStageInput) {
  const ordinal = input.clientRecordId.endsWith('a') ? 1 : 2;
  const offset = input.entityKind === 'plan' ? ordinal : ordinal + 1;
  return {
    stagingRecordId: uuid('2', offset),
    targetRecordId: uuid('3', offset),
  };
}

function committedRows(snapshot: GuestClaimSnapshot): {
  plans: RemoteDivePlan[];
  logs: RemoteDiveLog[];
} {
  const byKey = new Map(snapshot.manifest.items.map(item => [item.key, item]));
  const plans: RemoteDivePlan[] = [];
  const logs: RemoteDiveLog[] = [];
  for (const sidecar of snapshot.snapshots) {
    const item = byKey.get(sidecar.key)!;
    const payload = JSON.parse(sidecar.payloadBytes) as Record<string, unknown>;
    if (item.entityKind === 'plan') {
      payload.converted_log_id = item.convertedLogClientRecordId
        ? (byKey.get(`log:${item.convertedLogClientRecordId}`)
            ?.targetRecordId ?? null)
        : null;
      plans.push({
        id: item.targetRecordId!,
        localId: item.clientRecordId,
        revision: 1,
        payloadSha256: item.payloadSha256,
        payload,
      });
    } else {
      payload.source_plan_id = item.sourcePlanClientRecordId
        ? (byKey.get(`plan:${item.sourcePlanClientRecordId}`)?.targetRecordId ??
          null)
        : null;
      logs.push({
        id: item.targetRecordId!,
        localId: item.clientRecordId,
        revision: 1,
        payloadSha256: item.payloadSha256,
        payload,
        ...(item.profile && snapshot.manifest.remoteBatchId
          ? {
              profilePath: `${userId}/claims/${snapshot.manifest.remoteBatchId}/${item.targetRecordId}/${item.profile.contentRevision}.json`,
            }
          : {}),
      });
    }
  }
  return { plans, logs };
}

function repositories(
  initialLogs: DiveLogEntry[],
  initialPlans: DivePlan[],
  order: string[] = [],
  label = 'guest',
): TestRepositories {
  const logs = new Map(
    initialLogs.map(value => [value.localId, structuredClone(value)]),
  );
  const plans = new Map(
    initialPlans.map(value => [value.localId, structuredClone(value)]),
  );
  const logbook = {
    list: jest.fn(async () =>
      [...logs.values()].map(value => structuredClone(value)),
    ),
    get: jest.fn(async localId => structuredClone(logs.get(localId))),
    save: jest.fn(async value => {
      order.push(`${label}:save:log:${value.localId}`);
      logs.set(value.localId, structuredClone(value));
      return structuredClone(value);
    }),
    delete: jest.fn(async localId => {
      order.push(`${label}:delete:log:${localId}`);
      logs.delete(localId);
    }),
    removeWatchProfileIfUnreferenced: jest.fn(
      async (_storageKey: string) => undefined,
    ),
    importWatchMessages: jest.fn(
      async (
        _messages: Parameters<DiveLogRepository['importWatchMessages']>[0],
      ) => [],
    ),
    getWatchProfile: jest.fn(async localId => {
      const key = logs.get(localId)?.watchCapture?.profile?.storageKey;
      return key ? (profileRegistry.get(key) ?? []) : [];
    }),
  } satisfies jest.Mocked<DiveLogRepository>;
  const planbook = {
    list: jest.fn(async () =>
      [...plans.values()].map(value => structuredClone(value)),
    ),
    get: jest.fn(async localId => structuredClone(plans.get(localId))),
    save: jest.fn(async value => {
      order.push(`${label}:save:plan:${value.localId}`);
      plans.set(value.localId, structuredClone(value));
      return structuredClone(value);
    }),
    delete: jest.fn(async localId => {
      order.push(`${label}:delete:plan:${localId}`);
      plans.delete(localId);
    }),
  } satisfies jest.Mocked<DivePlanRepository>;
  return {
    principal:
      label === 'account' ? { kind: 'user', userId } : { kind: 'guest' },
    queryScope: label === 'account' ? `user:${userId}` : 'guest',
    logbook,
    planbook,
  };
}

const profileRegistry = new Map<string, WatchDepthSample[]>();

function profileStorage(): WatchProfileStorage {
  return {
    write: jest.fn(async (key, samples) => {
      profileRegistry.set(key, structuredClone(samples));
    }),
    read: jest.fn(async key => structuredClone(profileRegistry.get(key))),
    remove: jest.fn(async key => {
      profileRegistry.delete(key);
    }),
  };
}

function diveLog(localId: string, title?: string): DiveLogEntry {
  return {
    localId,
    source: 'manual',
    cloudSyncStatus: 'notConfigured',
    createdAt: 10,
    updatedAt: 11,
    manual: {
      title,
      site: { name: 'Local Reef' },
      buddyIds: [],
      gearIds: [],
      tags: [],
      observedMarineLife: [],
      measuredValues: { startedAt: 10 },
    },
    mobile: { mediaPlaceholders: [] },
    provenance: {},
  };
}

function watchLog(localId: string, preview: WatchDepthSample[]): DiveLogEntry {
  return {
    ...diveLog(localId),
    source: 'watch',
    watchCapture: {
      importKey: `watch:${localId}`,
      importedAt: 11,
      session: {
        localSessionId: `session-${localId}`,
        startedAt: 10,
        samples: [],
      },
      measuredValues: { startedAt: 10 },
      samples: preview,
      profile: {
        storageKey: 'guest-profile',
        contentRevision: 'revision-1',
        sampleCount: 200,
      },
    },
  };
}

function divePlan(localId: string, convertedLogLocalId?: string): DivePlan {
  return {
    localId,
    status: convertedLogLocalId ? 'completed' : 'draft',
    cloudSyncStatus: 'notConfigured',
    createdAt: 10,
    updatedAt: 11,
    convertedLogLocalId,
    site: { name: 'Local Reef' },
    buddyIds: [],
    gearIds: [],
    tags: [],
    plannedValues: {},
    checklistItems: [],
  };
}

function depthSamples(count: number): WatchDepthSample[] {
  return Array.from({ length: count }, (_, index) => ({
    localSessionId: 'session-log-a',
    timestamp: 10 + index,
    depthMeters: index / 10,
  }));
}

function remoteLog(localId: string): RemoteDiveLog {
  return {
    id: uuid('3', 1),
    localId,
    revision: 1,
    payloadSha256: 'a'.repeat(64),
    payload: {},
  };
}

function uuid(prefix: string, ordinal: number): string {
  return `${prefix}0000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
}

function clock(): () => number {
  let value = 100;
  return () => value++;
}

class RecordingStorage implements PersistentKeyValueStore {
  private readonly values = new Map<string, string>();

  constructor(private readonly order: string[]) {}

  async getString(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async setString(key: string, value: string): Promise<void> {
    const parsed = JSON.parse(value) as { manifest?: { status?: string } };
    if (parsed.manifest?.status) {
      this.order.push(`persist:${parsed.manifest.status}`);
    }
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>(nextResolve => {
      resolve = nextResolve;
    }),
    resolve,
  };
}

async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  assertion();
}
