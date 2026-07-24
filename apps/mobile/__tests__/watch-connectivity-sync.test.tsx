import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import type {
  GuestClaimRemoteRepository,
  GuestClaimStageInput,
  RemoteDivePlan,
} from '@repo/supabase';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import metadataRichFixture from '../../../packages/contracts/fixtures/metadata-rich-watch-sync-message.json';
import { LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import { PersistentDiveLogRepository } from '../src/repositories/persistent-dive-log-repository';
import type { WatchConnectivityPayload } from '../src/native/watch-connectivity';
import {
  createGuestClaimSnapshot,
  GuestClaimStore,
  type GuestClaimSnapshot,
} from '../src/claim/guest-claim-store';
import {GuestClaimService} from '../src/claim/guest-claim-service';
import { diveLogbookQueryKeys } from '../src/states/use-dive-logbook-queries';
import { WatchConnectivityImportCoordinator } from '../src/states/watch-connectivity-import-coordinator';
import { importPendingWatchConnectivityPayloads, WatchConnectivitySyncProvider } from '../src/states/watch-connectivity-sync';
import {
  AccountDataProviderCore,
  createAccountLocalFirstRepositories,
  useAccountData,
} from '../src/states/account-data';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import { dataStorageKeys } from '../src/storage/data-principal';
import type { WatchProfileStorage } from '../src/storage/watch-profile-storage';
import { AccountOutbox } from '../src/sync/account-outbox';
import type { WatchDepthSample } from '../src/types/dive-session';
import {createWatchProfileDigest} from '../src/utils/watch-profile-digest';
import {parseWatchSyncMessageJson} from '../src/utils/watch-sync-message-validation';

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const createDeferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>(nextResolve => {
    resolve = nextResolve;
  });
  return {promise, resolve};
};
const queryClients: QueryClient[] = [];
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

function planOnlyClaimRemoteRepository(
  store: GuestClaimStore,
): jest.Mocked<GuestClaimRemoteRepository> {
  const targets = new Map<string, string>();
  let ordinal = 0;
  const implementation: GuestClaimRemoteRepository = {
    async createOrLoadBatch() {
      return {id: '10000000-0000-4000-8000-000000000001', status: 'uploading'};
    },
    async stageRecord(input: GuestClaimStageInput) {
      ordinal += 1;
      const suffix = String(ordinal).padStart(12, '0');
      const targetRecordId = `30000000-0000-4000-8000-${suffix}`;
      targets.set(`${input.entityKind}:${input.clientRecordId}`, targetRecordId);
      return {
        stagingRecordId: `20000000-0000-4000-8000-${suffix}`,
        targetRecordId,
      };
    },
    async attachProfile() {},
    async uploadProfile() {},
    async downloadProfile() {
      throw new Error('unexpected profile download');
    },
    async finalize() {
      const snapshot = await store.read();
      return {
        status: 'committed',
        planCount: snapshot?.manifest.planCount ?? 0,
        logCount: snapshot?.manifest.logCount ?? 0,
      };
    },
    async listCommittedBatch() {
      const snapshot = (await store.read()) as GuestClaimSnapshot;
      return {
        plans: snapshot.snapshots.map((sidecar, index) => {
          const item = snapshot.manifest.items[index]!;
          return {
            id: targets.get(item.key)!,
            localId: item.clientRecordId,
            revision: 1,
            payloadSha256: item.payloadSha256,
            payload: JSON.parse(sidecar.payloadBytes) as Record<string, unknown>,
          };
        }),
        logs: [],
      };
    },
  };
  return {
    createOrLoadBatch: jest.fn(implementation.createOrLoadBatch),
    stageRecord: jest.fn(implementation.stageRecord),
    attachProfile: jest.fn(implementation.attachProfile),
    uploadProfile: jest.fn(implementation.uploadProfile),
    downloadProfile: jest.fn(implementation.downloadProfile),
    finalize: jest.fn(implementation.finalize),
    listCommittedBatch: jest.fn(implementation.listCommittedBatch),
  };
}

const createQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });

  queryClients.push(queryClient);
  return queryClient;
};

describe('WatchConnectivitySyncProvider', () => {
  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount();
      }
    });

    for (const queryClient of queryClients.splice(0)) {
      queryClient.clear();
    }

    jest.restoreAllMocks();
  });

  it('keeps the Watch artifact digest separate from the stored profile sample digest', async () => {
    const repository = new PersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      now: () => 1781355000,
    });
    const queryClient = createQueryClient();
    const payloadJson = JSON.stringify(metadataRichFixture);
    const artifactSha256 = bytesToHex(sha256(new TextEncoder().encode(payloadJson)));
    const parsedPayload = parseWatchSyncMessageJson(payloadJson);
    if (!parsedPayload.ok) {
      throw new Error(parsedPayload.error.message);
    }

    await importPendingWatchConnectivityPayloads({
      repository,
      queryClient,
      drainPendingPayloads: async () => [{
        payloadId: 'digest-domain-payload',
        payloadJson,
        localSessionId: metadataRichFixture.session.localSessionId,
        contentRevision: metadataRichFixture.session.profile?.contentRevision,
        sha256: artifactSha256,
        receivedAt: 1781355000,
      }],
      acknowledgeImportedPayloads: jest.fn().mockResolvedValue(undefined),
    });

    const [saved] = await repository.list();
    expect(saved?.watchCapture?.profile).toEqual(expect.objectContaining({
      artifactSha256,
      sha256: createWatchProfileDigest(parsedPayload.message.session.samples).sha256,
    }));
    expect(saved?.watchCapture?.profile?.sha256).not.toBe(artifactSha256);
  });

  it('subscribes before draining pending payloads so startup deliveries are not missed', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const coordinator = new WatchConnectivityImportCoordinator();
    const startupOrder: string[] = [];

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            coordinator={coordinator}
            drainPendingPayloads={async () => {
              startupOrder.push('drain');
              return [];
            }}
            acknowledgePayloads={jest.fn()}
            subscribeToPayloads={() => {
              startupOrder.push('subscribe');
              return { remove: jest.fn() };
            }}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    expect(startupOrder.slice(0, 2)).toEqual(['subscribe', 'drain']);
  });

  it('uses the active principal repositories and scope, then acknowledges before account enqueue and drain', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const repository = new LocalDiveLogRepository([], {now: () => 1781355000});
    const planRepository = new LocalDivePlanRepository();
    const guestRepository = new LocalDiveLogRepository();
    const guestPlanRepository = new LocalDivePlanRepository();
    const queryClient = createQueryClient();
    const userId = '00000000-0000-4000-8000-000000000001';
    const queryScope = `user:${userId}`;
    const outbox = new AccountOutbox({
      storage: metadataStorage,
      storageKey: dataStorageKeys({kind: 'user', userId}).outbox,
    });
    const order: string[] = [];
    let didDrain = false;
    let identifier = 0;
    const nextId = () => {
      identifier += 1;
      return `10000000-0000-4000-8000-${String(identifier).padStart(12, '0')}`;
    };
    let drained = false;

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <AccountDataProviderCore
            queryClient={queryClient}
            auth={{state: {status: 'authenticatedOffline', userId}}}
            dependencies={{
              metadataStorage,
              profileStorage: {
                write: jest.fn(async () => undefined),
                read: jest.fn(async () => undefined),
                remove: jest.fn(async () => undefined),
              },
              migrateLegacyData: jest.fn(async () => undefined),
              createRepositories: jest.fn(principal =>
                principal.kind === 'guest'
                  ? {principal, queryScope: 'guest', logbook: guestRepository, planbook: guestPlanRepository}
                  : {principal, queryScope, logbook: repository, planbook: planRepository},
              ),
              createId: nextId,
              now: () => 1781355000,
              jitter: () => 0,
            }}>
            <WatchConnectivitySyncProvider
              drainPendingPayloads={async () => {
                if (drained) {
                  return [];
                }
                drained = true;
                return [{
                  payloadId: 'principal-payload',
                  payloadJson: JSON.stringify(metadataRichFixture),
                  localSessionId: 'fixture-rich-session',
                  receivedAt: 1781355000,
                }];
              }}
              acknowledgeImportedPayloads={async () => {
                order.push('ack');
                expect(await outbox.list(userId)).toEqual([]);
              }}
              onLocalWritesCommitted={async () => {
                order.push('remote');
                expect(await outbox.list(userId)).toHaveLength(1);
                didDrain = true;
              }}
              subscribeToPayloads={() => ({remove: jest.fn()})}
            />
          </AccountDataProviderCore>
        </QueryClientProvider>,
      ));
      await flushPromises();
      await flushPromises();
      await flushPromises();
    });

    expect(order).toEqual(['ack', 'remote']);
    expect(didDrain).toBe(true);
    expect(await repository.list()).toHaveLength(1);
    expect(
      queryClient.getQueryCache().findAll({
        predicate: query =>
          query.queryKey[0] === 'diveLogbook' &&
          query.queryKey.includes(queryScope),
      }),
    ).toHaveLength(1);
  });

  it('routes deferred guest plans and repairs a swallowed Watch completion during claim', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const userId = '00000000-0000-4000-8000-000000000001';
    const queryScope = `user:${userId}`;
    const profileStorage = {
      write: jest.fn(async () => undefined),
      read: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    const deferredPlan = {
      localId: 'deferred-watch-plan',
      status: 'planned' as const,
      cloudSyncStatus: 'notConfigured' as const,
      createdAt: 1781350000,
      updatedAt: 1781351000,
      plannedAt: 1781352000,
      title: 'Deferred Watch plan',
      site: {name: 'Deferred Reef'},
      buddyIds: [],
      gearIds: [],
      tags: [],
      plannedValues: {},
      checklistItems: [],
    };
    const failedDeferredPlan = {
      ...deferredPlan,
      localId: 'failed-deferred-watch-plan',
      title: 'Failed deferred Watch plan',
      createdAt: 1781350100,
      updatedAt: 1781351100,
      plannedAt: 1781352100,
    };
    const guestLogbook = new LocalDiveLogRepository();
    const guestPlanbook = new LocalDivePlanRepository([
      deferredPlan,
      failedDeferredPlan,
    ]);
    const claimStore = new GuestClaimStore({storage: metadataStorage, userId});
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: guestPlanbook,
      profileStorage,
      now: () => 1781353000,
    });
    snapshot.manifest.status = 'deferred';
    await claimStore.write(snapshot);

    const accountLogbook = new LocalDiveLogRepository([], {
      now: () => 1781355000,
    });
    const accountPlanbook = new LocalDivePlanRepository();
    const outbox = new AccountOutbox({
      storage: metadataStorage,
      storageKey: dataStorageKeys({kind: 'user', userId}).outbox,
    });
    const queryClient = createQueryClient();
    let accountData: ReturnType<typeof useAccountData> | undefined;
    const Capture = () => {
      accountData = useAccountData();
      return null;
    };
    let identifier = 0;
    const createId = () => {
      identifier += 1;
      return `90000000-0000-4000-8000-${String(identifier).padStart(12, '0')}`;
    };
    const dependencies = {
      metadataStorage,
      profileStorage,
      migrateLegacyData: jest.fn(async () => undefined),
      createRepositories: jest.fn(principal => ({
        principal,
        queryScope:
          principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`,
        logbook:
          principal.kind === 'guest' ? guestLogbook : accountLogbook,
        planbook:
          principal.kind === 'guest' ? guestPlanbook : accountPlanbook,
      })),
      createId,
      now: () => 1781355000,
      jitter: () => 0,
    };
    let firstRenderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      firstRenderer = ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <AccountDataProviderCore
            queryClient={queryClient}
            navigationReady
            auth={{state: {status: 'authenticatedOffline', userId}}}
            dependencies={dependencies}
          >
            <Capture />
          </AccountDataProviderCore>
        </QueryClientProvider>,
      );
      renderers.push(firstRenderer);
      await flushPromises();
    });

    expect(accountData?.isHydrated).toBe(true);
    const fixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'deferred-plan-watch-session',
        sourcePlanLocalId: deferredPlan.localId,
        endedAt: 1781357600,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'deferred-plan-watch-session',
        })),
      },
    };
    const acknowledgeImportedPayloads = jest.fn(async () => undefined);
    const onLocalWritesCommitted = jest.fn(async () => undefined);
    let drained = false;

    await expect(
      importPendingWatchConnectivityPayloads({
        repository: accountData!.logbookRepository,
        planRepository: accountData!.planRepository,
        queryClient,
        queryScope,
        coordinator: new WatchConnectivityImportCoordinator(),
        drainPendingPayloads: async () => {
          if (drained) {
            return [];
          }
          drained = true;
          return [
            {
              payloadId: 'deferred-plan-watch-payload',
              payloadJson: JSON.stringify(fixture),
              localSessionId: 'deferred-plan-watch-session',
              receivedAt: 1781357600,
            },
          ];
        },
        acknowledgeImportedPayloads,
        onLocalWritesCommitted,
      }),
    ).resolves.toEqual({receivedCount: 1, importedCount: 1});

    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith([
      'deferred-plan-watch-payload',
    ]);
    expect(onLocalWritesCommitted).toHaveBeenCalledTimes(1);
    const accountLogs = await accountLogbook.list();
    expect(accountLogs).toHaveLength(1);
    expect(accountLogs[0]).toMatchObject({
      cloudSyncStatus: 'pending',
      watchCapture: {
        session: {sourcePlanLocalId: deferredPlan.localId},
      },
    });
    const operations = await outbox.list(userId);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      entityKind: 'log',
      entityLocalId: accountLogs[0]!.localId,
    });
    expect(
      (operations[0]!.payload.remote as {payload: {source_plan_id: unknown}})
        .payload.source_plan_id,
    ).toBeNull();
    await expect(guestPlanbook.get(deferredPlan.localId)).resolves.toMatchObject({
      status: 'completed',
      completedAt: fixture.session.endedAt,
      convertedLogLocalId: accountLogs[0]!.localId,
      cloudSyncStatus: 'notConfigured',
    });
    await expect(accountPlanbook.get(deferredPlan.localId)).resolves.toBeUndefined();

    await ReactTestRenderer.act(async () => {
      firstRenderer.unmount();
      accountData = undefined;
      const resumedRenderer = ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <AccountDataProviderCore
            queryClient={queryClient}
            navigationReady
            auth={{state: {status: 'authenticatedOffline', userId}}}
            dependencies={dependencies}
          >
            <Capture />
          </AccountDataProviderCore>
        </QueryClientProvider>,
      );
      renderers.push(resumedRenderer);
      await flushPromises();
    });

    expect(accountData).toMatchObject({
      isHydrated: true,
      principal: {kind: 'user', userId},
    });
    await expect(outbox.list(userId)).resolves.toHaveLength(1);

    jest
      .spyOn(guestPlanbook, 'save')
      .mockRejectedValueOnce(new Error('simulated guest plan save failure'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failedFixture = {
      ...fixture,
      session: {
        ...fixture.session,
        localSessionId: 'failed-deferred-plan-watch-session',
        sourcePlanLocalId: failedDeferredPlan.localId,
        endedAt: 1781358600,
        samples: fixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'failed-deferred-plan-watch-session',
        })),
      },
    };
    await expect(importPendingWatchConnectivityPayloads({
      repository: accountData!.logbookRepository,
      planRepository: accountData!.planRepository,
      queryClient,
      queryScope,
      coordinator: new WatchConnectivityImportCoordinator(),
      drainPendingPayloads: async () => [{
        payloadId: 'failed-deferred-plan-watch-payload',
        payloadJson: JSON.stringify(failedFixture),
        localSessionId: failedFixture.session.localSessionId,
        receivedAt: failedFixture.session.endedAt,
      }],
      acknowledgeImportedPayloads,
      onLocalWritesCommitted,
    })).resolves.toEqual({receivedCount: 1, importedCount: 1});

    const failedAccountLog = (await accountLogbook.list()).find(
      log => log.watchCapture?.session.sourcePlanLocalId === failedDeferredPlan.localId,
    )!;
    expect(failedAccountLog).toBeDefined();
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith([
      'failed-deferred-plan-watch-payload',
    ]);
    const initialFailedLogOperation = (await outbox.list(userId)).find(
      operation => operation.entityKind === 'log' && operation.entityLocalId === failedAccountLog.localId,
    )!;
    expect(
      (initialFailedLogOperation.payload.remote as {payload: {source_plan_id: unknown}}).payload.source_plan_id,
    ).toBeNull();
    await expect(guestPlanbook.get(failedDeferredPlan.localId)).resolves.toMatchObject({
      status: 'planned',
    });
    await expect(accountPlanbook.get(failedDeferredPlan.localId)).resolves.toBeUndefined();

    const claimOrder: string[] = [];
    const enqueue = outbox.enqueue.bind(outbox);
    jest.spyOn(outbox, 'enqueue').mockImplementation(async operation => {
      claimOrder.push(`enqueue:${operation.entityKind}:${operation.entityLocalId}`);
      return enqueue(operation);
    });
    const deletePlanIf = guestPlanbook.deleteIf.bind(guestPlanbook);
    jest.spyOn(guestPlanbook, 'deleteIf').mockImplementation(async (localId, predicate) => {
      claimOrder.push(`delete:plan:${localId}`);
      return deletePlanIf(localId, predicate);
    });
    const guestRepositories = {
      principal: {kind: 'guest' as const},
      queryScope: 'guest',
      logbook: guestLogbook,
      planbook: guestPlanbook,
    };
    const accountRepositories = {
      principal: {kind: 'user' as const, userId},
      queryScope,
      logbook: accountLogbook,
      planbook: accountPlanbook,
    };
    const remote = planOnlyClaimRemoteRepository(claimStore);
    const service = new GuestClaimService({
      userId,
      store: claimStore,
      guestRepositories,
      accountRepositories,
      accountMutationRepositories: createAccountLocalFirstRepositories({
        userId,
        repositories: accountRepositories,
        outbox,
        createId,
        now: () => 1781359000,
      }),
      profileStorage,
      remoteRepository: remote,
      now: () => 1781359000,
    });
    await expect(service.retry()).resolves.toMatchObject({
      manifest: {status: 'committed'},
    });

    await expect(guestPlanbook.get(deferredPlan.localId)).resolves.toBeUndefined();
    await expect(accountPlanbook.get(deferredPlan.localId)).resolves.toMatchObject({
      status: 'completed',
      convertedLogLocalId: accountLogs[0]!.localId,
      ownerUserId: userId,
      cloudSyncStatus: 'pending',
    });
    await expect(guestPlanbook.get(failedDeferredPlan.localId)).resolves.toBeUndefined();
    const claimedPlan = await accountPlanbook.get(failedDeferredPlan.localId);
    expect(claimedPlan).toMatchObject({
      status: 'completed',
      completedAt: failedFixture.session.endedAt,
      convertedLogLocalId: failedAccountLog.localId,
      ownerUserId: userId,
      cloudSyncStatus: 'pending',
    });
    const claimedOperations = await outbox.list(userId);
    const planOperation = claimedOperations.find(
      operation => operation.entityKind === 'plan' && operation.entityLocalId === failedDeferredPlan.localId,
    )!;
    const repairedLogOperation = claimedOperations.filter(
      operation => operation.entityKind === 'log' && operation.entityLocalId === failedAccountLog.localId,
    ).at(-1)!;
    expect((planOperation.payload.remote as RemoteDivePlan).payload.converted_log_id).toBe(
      failedAccountLog.remoteId,
    );
    expect(
      (repairedLogOperation.payload.remote as {payload: {source_plan_id: unknown}}).payload.source_plan_id,
    ).toBe(claimedPlan!.remoteId);
    expect(claimOrder.indexOf(`enqueue:plan:${failedDeferredPlan.localId}`)).toBeLessThan(
      claimOrder.indexOf(`delete:plan:${failedDeferredPlan.localId}`),
    );
    expect(claimOrder.lastIndexOf(`enqueue:log:${failedAccountLog.localId}`)).toBeLessThan(
      claimOrder.indexOf(`delete:plan:${failedDeferredPlan.localId}`),
    );
    expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(1);
  });

  it('preserves a Watch-completed guest plan that changes after claim cleanup scans account logs', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const userId = '00000000-0000-4000-8000-000000000001';
    const queryScope = `user:${userId}`;
    const profileStorage: WatchProfileStorage = {
      write: jest.fn(async () => undefined),
      read: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    const guestPlan = {
      localId: 'racing-watch-plan',
      status: 'planned' as const,
      cloudSyncStatus: 'notConfigured' as const,
      createdAt: 1781350000,
      updatedAt: 1781351000,
      plannedAt: 1781352000,
      title: 'Racing Watch plan',
      site: {name: 'Race Reef'},
      buddyIds: [],
      gearIds: [],
      tags: [],
      plannedValues: {},
      checklistItems: [],
    };
    const guestLogbook = new LocalDiveLogRepository();
    const guestPlanbook = new LocalDivePlanRepository([guestPlan]);
    const claimStore = new GuestClaimStore({storage: metadataStorage, userId});
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: guestPlanbook,
      profileStorage,
      now: () => 1781353000,
    });
    snapshot.manifest.status = 'deferred';
    await claimStore.write(snapshot);

    const accountLogbook = new LocalDiveLogRepository([], {
      now: () => 1781355000,
    });
    const accountPlanbook = new LocalDivePlanRepository();
    const accountRepositories = {
      principal: {kind: 'user' as const, userId},
      queryScope,
      logbook: accountLogbook,
      planbook: accountPlanbook,
    };
    const outbox = new AccountOutbox({
      storage: metadataStorage,
      storageKey: dataStorageKeys({kind: 'user', userId}).outbox,
    });
    let identifier = 0;
    const createId = () => {
      identifier += 1;
      return `90000000-0000-4000-8000-${String(identifier).padStart(12, '0')}`;
    };
    const accountMutations = createAccountLocalFirstRepositories({
      userId,
      repositories: accountRepositories,
      outbox,
      createId,
      now: () => 1781359000,
    });
    const remote = planOnlyClaimRemoteRepository(claimStore);
    const service = new GuestClaimService({
      userId,
      store: claimStore,
      guestRepositories: {
        principal: {kind: 'guest'},
        queryScope: 'guest',
        logbook: guestLogbook,
        planbook: guestPlanbook,
      },
      accountRepositories,
      accountMutationRepositories: accountMutations,
      profileStorage,
      remoteRepository: remote,
      now: () => 1781359000,
    });
    const deleteStarted = createDeferred();
    const releaseDelete = createDeferred();
    const conditionalPlanbook = guestPlanbook as unknown as {
      deleteIf: (
        localId: string,
        predicate: (current: typeof guestPlan) => boolean,
      ) => Promise<string>;
    };
    const deleteIf = conditionalPlanbook.deleteIf.bind(guestPlanbook);
    jest.spyOn(conditionalPlanbook, 'deleteIf').mockImplementationOnce(
      async (localId, predicate) => {
        deleteStarted.resolve();
        await releaseDelete.promise;
        return deleteIf(localId, predicate);
      },
    );

    const firstAttempt = service.retry();
    await deleteStarted.promise;

    const fixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'racing-watch-session',
        sourcePlanLocalId: guestPlan.localId,
        endedAt: 1781357600,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'racing-watch-session',
        })),
      },
    };
    await expect(importPendingWatchConnectivityPayloads({
      repository: accountMutations.logbook,
      planRepository: guestPlanbook,
      queryClient: createQueryClient(),
      queryScope,
      coordinator: new WatchConnectivityImportCoordinator(),
      drainPendingPayloads: async () => [{
        payloadId: 'racing-watch-payload',
        payloadJson: JSON.stringify(fixture),
        localSessionId: fixture.session.localSessionId,
        receivedAt: fixture.session.endedAt,
      }],
      acknowledgeImportedPayloads: jest.fn(async () => undefined),
      onLocalWritesCommitted: jest.fn(async () => undefined),
    })).resolves.toEqual({receivedCount: 1, importedCount: 1});
    releaseDelete.resolve();

    await expect(firstAttempt).resolves.toMatchObject({
      manifest: {status: 'cleanupPending'},
    });
    const completedGuestPlan = await guestPlanbook.get(guestPlan.localId);
    expect(completedGuestPlan).toMatchObject({
      status: 'completed',
      completedAt: fixture.session.endedAt,
    });
    const accountLog = (await accountLogbook.list())[0]!;
    expect(completedGuestPlan?.convertedLogLocalId).toBe(accountLog.localId);

    await expect(service.resume()).resolves.toMatchObject({
      manifest: {status: 'committed'},
    });

    await expect(guestPlanbook.get(guestPlan.localId)).resolves.toBeUndefined();
    const repairedPlan = await accountPlanbook.get(guestPlan.localId);
    expect(repairedPlan).toMatchObject({
      status: 'completed',
      convertedLogLocalId: accountLog.localId,
      cloudSyncStatus: 'pending',
    });
    const operations = await outbox.list(userId);
    const planOperation = operations.find(
      operation => operation.entityKind === 'plan' && operation.entityLocalId === guestPlan.localId,
    )!;
    const repairedLogOperation = operations.filter(
      operation => operation.entityKind === 'log' && operation.entityLocalId === accountLog.localId,
    ).at(-1)!;
    expect((planOperation.payload.remote as RemoteDivePlan).payload.converted_log_id).toBe(
      accountLog.remoteId,
    );
    expect(
      (repairedLogOperation.payload.remote as {payload: {source_plan_id: unknown}}).payload.source_plan_id,
    ).toBe(repairedPlan?.remoteId);
    expect(remote.createOrLoadBatch).toHaveBeenCalledTimes(1);
  });

  it('drains pending native payloads and imports valid watch sync JSON', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            drainPendingPayloads={async () => [
              {
                payloadId: 'pending-1',
                payloadJson: JSON.stringify(metadataRichFixture),
                localSessionId: 'fixture-rich-session',
                receivedAt: 1781355000,
              },
            ]}
            acknowledgePayloads={jest.fn()}
            subscribeToPayloads={() => ({ remove: jest.fn() })}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    const entries = await repository.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].watchCapture?.session.localSessionId).toBe('fixture-rich-session');
    expect(entries[0].manual.notes).toBe('Easy recreational checkout dive. Not for decompression planning.');
    expect(entries[0].watchCapture?.samples[1]).toMatchObject({
      depthMeters: 13.2,
      waterTemperatureCelsius: 24.1,
    });
    expect(entries[0].cloudSyncStatus).toBe('notConfigured');
    expect(entries[0].watchCapture?.session.syncStatus).toBe('pending');
    expect(queryClient.getQueryData(diveLogbookQueryKeys.list(repository))).toEqual(entries);
  });

  it('acknowledges imported durable native payloads after repository save succeeds', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const acknowledgePayloads = jest.fn().mockResolvedValue(undefined);
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            drainPendingPayloads={async () => [
              {
                payloadId: 'durable-payload-1',
                payloadJson: JSON.stringify(metadataRichFixture),
                localSessionId: 'fixture-rich-session',
                receivedAt: 1781355000,
              },
            ]}
            acknowledgePayloads={acknowledgePayloads}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            subscribeToPayloads={() => ({ remove: jest.fn() })}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    expect(await repository.list()).toHaveLength(1);
    expect(acknowledgePayloads).not.toHaveBeenCalled();
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['durable-payload-1']);
  });

  it('notifies only after a valid watch payload is saved locally', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const notifyImportedEntry = jest.fn().mockResolvedValue(undefined);

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            drainPendingPayloads={async () => [
              {
                payloadId: 'notify-payload-1',
                payloadJson: JSON.stringify(metadataRichFixture),
                localSessionId: 'fixture-rich-session',
                receivedAt: 1781355000,
              },
            ]}
            acknowledgePayloads={jest.fn()}
            notifyImportedEntry={notifyImportedEntry}
            subscribeToPayloads={() => ({ remove: jest.fn() })}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    const [entry] = await repository.list();
    expect(entry.cloudSyncStatus).toBe('notConfigured');
    expect(notifyImportedEntry).toHaveBeenCalledWith(expect.objectContaining({
      localId: entry.localId,
      cloudSyncStatus: 'notConfigured',
    }));
  });

  it('imports valid event payloads delivered after subscription', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const onImportedEntry = jest.fn();
    let listener: ((payload: { payloadJson: string; localSessionId?: string; receivedAt?: number }) => void) | undefined;

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            drainPendingPayloads={async () => []}
            acknowledgePayloads={jest.fn()}
            onImportedEntry={onImportedEntry}
            subscribeToPayloads={handler => {
              listener = handler;
              return { remove: jest.fn() };
            }}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    await ReactTestRenderer.act(async () => {
      listener?.({
        payloadJson: JSON.stringify(metadataRichFixture),
        localSessionId: 'fixture-rich-session',
        receivedAt: 1781355000,
      });
      await flushPromises();
    });

    const entries = await repository.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].watchCapture?.session.localSessionId).toBe('fixture-rich-session');
    expect(onImportedEntry).toHaveBeenCalledWith(expect.objectContaining({
      localId: entries[0].localId,
      cloudSyncStatus: 'notConfigured',
    }));
  });

  it('imports live event payloads without payload ids and skips durable acknowledgement calls', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const acknowledgePayloads = jest.fn().mockResolvedValue(undefined);
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    let listener: ((payload: { payloadJson: string; localSessionId?: string; receivedAt?: number }) => void) | undefined;

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            drainPendingPayloads={async () => []}
            acknowledgePayloads={acknowledgePayloads}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            subscribeToPayloads={handler => {
              listener = handler;
              return { remove: jest.fn() };
            }}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    await ReactTestRenderer.act(async () => {
      listener?.({
        payloadJson: JSON.stringify(metadataRichFixture),
        localSessionId: 'fixture-rich-session',
        receivedAt: 1781355000,
      });
      await flushPromises();
    });

    expect(await repository.list()).toHaveLength(1);
    expect(acknowledgePayloads).not.toHaveBeenCalled();
    expect(acknowledgeImportedPayloads).not.toHaveBeenCalled();
  });

  it('keeps open watch imports and later ended imports under explicit import keys', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    const openFixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'open-to-ended-session',
        siteName: 'Open To Ended Reef',
        endedAt: undefined,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'open-to-ended-session',
        })),
      },
    };
    const endedFixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'open-to-ended-session',
        siteName: 'Open To Ended Reef',
        endedAt: 1781357600,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'open-to-ended-session',
        })),
      },
    };

    const summary = await importPendingWatchConnectivityPayloads({
      repository,
      queryClient,
      drainPendingPayloads: async () => [
        {
          payloadId: 'open-payload',
          payloadJson: JSON.stringify(openFixture),
          localSessionId: 'open-to-ended-session',
          receivedAt: 1781355000,
        },
        {
          payloadId: 'ended-payload',
          payloadJson: JSON.stringify(endedFixture),
          localSessionId: 'open-to-ended-session',
          receivedAt: 1781357600,
        },
      ],
      acknowledgePayloads: jest.fn(),
      acknowledgeImportedPayloads,
    });

    const entries = await repository.list();
    expect(summary).toEqual({ receivedCount: 2, importedCount: 2 });
    expect(entries.map(entry => entry.watchCapture?.importKey).sort()).toEqual([
      'open-to-ended-session:1781357600',
      'open-to-ended-session:open',
    ]);
    expect(acknowledgeImportedPayloads).toHaveBeenNthCalledWith(1, ['open-payload']);
    expect(acknowledgeImportedPayloads).toHaveBeenNthCalledWith(2, ['ended-payload']);
  });

  it('counts every acknowledged duplicate demo payload while keeping repository rows deduped', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const acknowledgePayloads = jest.fn().mockResolvedValue(undefined);
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    const fixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'demo-duplicate-session',
        captureMode: 'demo',
        endedAt: 1781357600,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'demo-duplicate-session',
        })),
      },
    };

    const summary = await importPendingWatchConnectivityPayloads({
      repository,
      queryClient,
      drainPendingPayloads: async () => [
        {
          payloadId: 'demo-payload-1',
          payloadJson: JSON.stringify(fixture),
          localSessionId: 'demo-duplicate-session',
          receivedAt: 1781357600,
        },
        {
          payloadId: 'demo-payload-2',
          payloadJson: JSON.stringify(fixture),
          localSessionId: 'demo-duplicate-session',
          receivedAt: 1781357601,
        },
      ],
      acknowledgePayloads,
      acknowledgeImportedPayloads,
    });

    const entries = await repository.list();
    expect(summary).toEqual({ receivedCount: 2, importedCount: 2 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      cloudSyncStatus: 'notConfigured',
      watchCapture: {
        session: {
          localSessionId: 'demo-duplicate-session',
          captureMode: 'demo',
        },
      },
    });
    expect(queryClient.getQueryData(diveLogbookQueryKeys.list(repository))).toEqual(entries);
    expect(acknowledgePayloads).not.toHaveBeenCalled();
    expect(acknowledgeImportedPayloads).toHaveBeenNthCalledWith(1, ['demo-payload-1']);
    expect(acknowledgeImportedPayloads).toHaveBeenNthCalledWith(2, ['demo-payload-2']);
  });

  it('enriches planned watch logs and completes the source mobile plan', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const planRepository = new LocalDivePlanRepository([
      {
        localId: 'plan-1',
        status: 'planned',
        createdAt: 1781350000,
        updatedAt: 1781351000,
        plannedAt: 1781352000,
        title: 'Blue Wall morning',
        diveMode: 'scuba',
        entryStyle: 'boat',
        site: { siteId: 'site-blue-wall', name: 'Blue Wall' },
        buddyIds: ['Mina'],
        gearIds: ['bcd-1'],
        tags: ['reef'],
        objective: 'Buoyancy check',
        notes: 'Review current before entering.',
        plannedValues: {
          gasLabel: 'EAN32',
          trainingFocus: 'hovering',
        },
        checklistItems: [],
      },
    ]);
    const queryClient = createQueryClient();
    let listener: ((payload: { payloadJson: string; localSessionId?: string; receivedAt?: number }) => void) | undefined;
    const fixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'planned-watch-session',
        sourcePlanLocalId: 'plan-1',
        planTitle: 'Blue Wall morning',
        siteName: 'Blue Wall',
        notes: 'Watch quick note.',
        endedAt: 1781357600,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'planned-watch-session',
        })),
      },
    };

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            planRepository={planRepository}
            drainPendingPayloads={async () => []}
            acknowledgePayloads={jest.fn()}
            subscribeToPayloads={handler => {
              listener = handler;
              return { remove: jest.fn() };
            }}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    await ReactTestRenderer.act(async () => {
      listener?.({
        payloadJson: JSON.stringify(fixture),
        localSessionId: 'planned-watch-session',
        receivedAt: 1781357600,
      });
      await flushPromises();
    });

    const [entry] = await repository.list();
    expect(entry.manual).toMatchObject({
      title: 'Blue Wall morning',
      entryStyle: 'boat',
      site: { siteId: 'site-blue-wall', name: 'Blue Wall' },
      notes: 'Buoyancy check\nhovering\nReview current before entering.\nWatch quick note.',
      measuredValues: {
        diveMode: 'scuba',
        gasLabel: 'EAN32',
        trainingFocus: 'hovering',
      },
    });
    expect(entry.manual.buddyIds).toEqual(expect.arrayContaining(['Mina', 'buddy-hana']));
    expect(entry.manual.gearIds).toEqual(expect.arrayContaining(['bcd-1', 'mask-primary', 'bcd-travel']));
    expect(entry.manual.tags).toEqual(expect.arrayContaining(['reef', 'training', 'clear-water']));

    const completedPlan = await planRepository.get('plan-1');
    expect(completedPlan).toMatchObject({
      status: 'completed',
      completedAt: 1781357600,
      convertedLogLocalId: entry.localId,
    });
  });

  it('keeps the watch log import acknowledged when source plan completion fails', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const planRepository = new LocalDivePlanRepository([
      {
        localId: 'plan-save-fails',
        status: 'planned',
        createdAt: 1781350000,
        updatedAt: 1781351000,
        plannedAt: 1781352000,
        title: 'Plan save fails',
        diveMode: 'scuba',
        site: { name: 'Failure Reef' },
        buddyIds: [],
        gearIds: [],
        tags: ['planned'],
        objective: 'Keep import durable',
        plannedValues: {
          gasLabel: 'Air',
        },
        checklistItems: [],
      },
    ]);
    const queryClient = createQueryClient();
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(planRepository, 'save').mockRejectedValue(new Error('plan storage unavailable'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'plan-save-fails-session',
        sourcePlanLocalId: 'plan-save-fails',
        planTitle: 'Plan save fails',
        endedAt: 1781357600,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'plan-save-fails-session',
        })),
      },
    };

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            planRepository={planRepository}
            drainPendingPayloads={async () => [
              {
                payloadId: 'plan-save-fails-payload',
                payloadJson: JSON.stringify(fixture),
                localSessionId: 'plan-save-fails-session',
                receivedAt: 1781357600,
              },
            ]}
            acknowledgePayloads={jest.fn()}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            subscribeToPayloads={() => ({ remove: jest.fn() })}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    const [entry] = await repository.list();
    expect(entry.cloudSyncStatus).toBe('notConfigured');
    expect(entry.manual.title).toBe('Plan save fails');
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['plan-save-fails-payload']);
    const originalPlan = await planRepository.get('plan-save-fails');
    expect(originalPlan?.status).toBe('planned');
    expect(originalPlan?.convertedLogLocalId).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'Failed to complete source dive plan after watch import',
      expect.any(Error),
    );
  });

  it('does not complete a source plan when the final imported log save fails', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const planRepository = new LocalDivePlanRepository([
      {
        localId: 'log-save-fails',
        status: 'planned',
        createdAt: 1781350000,
        updatedAt: 1781351000,
        plannedAt: 1781352000,
        title: 'Log save fails',
        diveMode: 'scuba',
        site: { name: 'Retry Reef' },
        buddyIds: [],
        gearIds: [],
        tags: ['planned'],
        objective: 'Retry import later',
        plannedValues: {
          gasLabel: 'Air',
        },
        checklistItems: [],
      },
    ]);
    const queryClient = createQueryClient();
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    const notifyImportedEntry = jest.fn().mockResolvedValue(undefined);
    const planSaveSpy = jest.spyOn(planRepository, 'save');
    jest.spyOn(repository, 'save').mockRejectedValue(new Error('final log save failed'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'log-save-fails-session',
        sourcePlanLocalId: 'log-save-fails',
        planTitle: 'Log save fails',
        endedAt: 1781357600,
        samples: metadataRichFixture.session.samples.map(sample => ({
          ...sample,
          localSessionId: 'log-save-fails-session',
        })),
      },
    };

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            planRepository={planRepository}
            drainPendingPayloads={async () => [
              {
                payloadId: 'log-save-fails-payload',
                payloadJson: JSON.stringify(fixture),
                localSessionId: 'log-save-fails-session',
                receivedAt: 1781357600,
              },
            ]}
            acknowledgePayloads={jest.fn()}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            notifyImportedEntry={notifyImportedEntry}
            subscribeToPayloads={() => ({ remove: jest.fn() })}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    expect(planSaveSpy).not.toHaveBeenCalled();
    expect(acknowledgeImportedPayloads).not.toHaveBeenCalled();
    expect(notifyImportedEntry).not.toHaveBeenCalled();
    const retryPlan = await planRepository.get('log-save-fails');
    expect(retryPlan?.status).toBe('planned');
    expect(retryPlan?.convertedLogLocalId).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith('Failed to import watch sync payload', expect.any(Error));
  });

  it('ignores payloads that fail the watch sync contract validator', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const acknowledgePayloads = jest.fn().mockResolvedValue(undefined);
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    const notifyImportedEntry = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            drainPendingPayloads={async () => [
              {
                payloadId: 'invalid-payload-1',
                payloadJson: '{"type":"sessionEnded","session":{"startedAt":1781352000,"samples":[]}}',
                localSessionId: 'broken-session',
                receivedAt: 1781355000,
              },
            ]}
            acknowledgePayloads={acknowledgePayloads}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            notifyImportedEntry={notifyImportedEntry}
            subscribeToPayloads={() => ({ remove: jest.fn() })}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    expect(await repository.list()).toEqual([]);
    expect(queryClient.getQueryData(diveLogbookQueryKeys.list(repository))).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'Dropped invalid watch sync payload',
      expect.objectContaining({ path: 'session.localSessionId' }),
    );
    expect(acknowledgePayloads).toHaveBeenCalledWith(['invalid-payload-1']);
    expect(acknowledgeImportedPayloads).not.toHaveBeenCalled();
    expect(notifyImportedEntry).not.toHaveBeenCalled();
  });

  it('does not acknowledge durable payloads when repository import fails', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const acknowledgePayloads = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(repository, 'importWatchMessages').mockRejectedValue(new Error('storage unavailable'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            drainPendingPayloads={async () => [
              {
                payloadId: 'retry-later-payload',
                payloadJson: JSON.stringify(metadataRichFixture),
                localSessionId: 'fixture-rich-session',
                receivedAt: 1781355000,
              },
            ]}
            acknowledgePayloads={acknowledgePayloads}
            subscribeToPayloads={() => ({ remove: jest.fn() })}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    expect(acknowledgePayloads).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('Failed to import watch sync payload', expect.any(Error));
  });

  it('coalesces the same payload across automatic events and manual drains', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    const notifyImportedEntry = jest.fn().mockResolvedValue(undefined);
    const originalImport = repository.importWatchMessages.bind(repository);
    let releaseImport = () => {};
    const importGate = new Promise<void>(resolve => {
      releaseImport = resolve;
    });
    const importSpy = jest.spyOn(repository, 'importWatchMessages').mockImplementation(async messages => {
      await importGate;
      return originalImport(messages);
    });
    let listener: ((payload: WatchConnectivityPayload) => void) | undefined;
    const payload: WatchConnectivityPayload = {
      payloadId: 'shared-payload',
      payloadJson: JSON.stringify(metadataRichFixture),
      localSessionId: 'fixture-rich-session',
      receivedAt: 1781355000,
    };

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            drainPendingPayloads={async () => []}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            notifyImportedEntry={notifyImportedEntry}
            subscribeToPayloads={handler => {
              listener = handler;
              return { remove: jest.fn() };
            }}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    let manualImport: ReturnType<typeof importPendingWatchConnectivityPayloads> | undefined;
    await ReactTestRenderer.act(async () => {
      listener?.(payload);
      manualImport = importPendingWatchConnectivityPayloads({
        repository,
        queryClient,
        drainPendingPayloads: async () => [payload],
        acknowledgeImportedPayloads,
      });
      await flushPromises();
    });
    const callsBeforeRelease = importSpy.mock.calls.length;

    releaseImport();
    await ReactTestRenderer.act(async () => {
      await manualImport;
      await flushPromises();
    });

    expect(callsBeforeRelease).toBe(1);
    expect(importSpy).toHaveBeenCalledTimes(1);
    expect(acknowledgeImportedPayloads).toHaveBeenCalledTimes(1);
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['shared-payload']);
    expect(notifyImportedEntry).toHaveBeenCalledTimes(1);
    expect(await repository.list()).toHaveLength(1);
  });

  it('continues the serialized import queue after a payload fails', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    const originalImport = repository.importWatchMessages.bind(repository);
    const executionOrder: string[] = [];
    let rejectFirstImport = () => {};
    const firstImportGate = new Promise<void>((_resolve, reject) => {
      rejectFirstImport = () => reject(new Error('storage unavailable'));
    });
    jest.spyOn(repository, 'importWatchMessages').mockImplementation(async messages => {
      const localSessionId = messages[0].session.localSessionId;
      executionOrder.push(`start:${localSessionId}`);
      if (localSessionId === 'queue-first') {
        await firstImportGate;
      }
      const entries = await originalImport(messages);
      executionOrder.push(`end:${localSessionId}`);
      return entries;
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    let listener: ((payload: WatchConnectivityPayload) => void) | undefined;
    const makePayload = (payloadId: string, localSessionId: string): WatchConnectivityPayload => ({
      payloadId,
      localSessionId,
      receivedAt: 1781355000,
      payloadJson: JSON.stringify({
        ...metadataRichFixture,
        session: {
          ...metadataRichFixture.session,
          localSessionId,
          samples: metadataRichFixture.session.samples.map(sample => ({ ...sample, localSessionId })),
        },
      }),
    });

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            drainPendingPayloads={async () => []}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            subscribeToPayloads={handler => {
              listener = handler;
              return { remove: jest.fn() };
            }}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    await ReactTestRenderer.act(async () => {
      listener?.(makePayload('queue-payload-first', 'queue-first'));
      listener?.(makePayload('queue-payload-second', 'queue-second'));
      await flushPromises();
    });
    const orderBeforeFailure = [...executionOrder];

    rejectFirstImport();
    await ReactTestRenderer.act(async () => {
      await flushPromises();
      await flushPromises();
    });

    expect(orderBeforeFailure).toEqual(['start:queue-first']);
    expect(executionOrder).toEqual(['start:queue-first', 'start:queue-second', 'end:queue-second']);
    expect(acknowledgeImportedPayloads).not.toHaveBeenCalledWith(['queue-payload-first']);
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['queue-payload-second']);
    expect(await repository.list()).toHaveLength(1);
  });

  it('deduplicates concurrent distinct payloads that share one session import key', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const coordinator = new WatchConnectivityImportCoordinator();
    let acknowledgedCount = 0;
    let resolveAcknowledgements = () => {};
    const acknowledgementsComplete = new Promise<void>(resolve => {
      resolveAcknowledgements = resolve;
    });
    const acknowledgeImportedPayloads = jest.fn().mockImplementation(async () => {
      acknowledgedCount += 1;
      if (acknowledgedCount === 2) {
        resolveAcknowledgements();
      }
    });
    let listener: ((payload: WatchConnectivityPayload) => void) | undefined;
    const makePayload = (payloadId: string): WatchConnectivityPayload => ({
      payloadId,
      payloadJson: JSON.stringify(metadataRichFixture),
      localSessionId: 'fixture-rich-session',
      receivedAt: 1781355000,
    });

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            coordinator={coordinator}
            drainPendingPayloads={async () => []}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            subscribeToPayloads={handler => {
              listener = handler;
              return { remove: jest.fn() };
            }}
          />
        </QueryClientProvider>,
      ));
      await flushPromises();
    });

    await ReactTestRenderer.act(async () => {
      listener?.(makePayload('same-session-a'));
      listener?.(makePayload('same-session-b'));
      await acknowledgementsComplete;
    });

    expect(await repository.list()).toHaveLength(1);
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['same-session-a']);
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['same-session-b']);
  });

  it('redelivers without duplication after acknowledgement fails', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const coordinator = new WatchConnectivityImportCoordinator();
    const acknowledgeImportedPayloads = jest.fn()
      .mockRejectedValueOnce(new Error('watch unavailable'))
      .mockResolvedValueOnce(undefined);
    const payload: WatchConnectivityPayload = {
      payloadId: 'ack-retry-payload',
      payloadJson: JSON.stringify(metadataRichFixture),
      localSessionId: 'fixture-rich-session',
      receivedAt: 1781355000,
    };
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(importPendingWatchConnectivityPayloads({
      repository,
      queryClient,
      drainPendingPayloads: async () => [payload],
      acknowledgeImportedPayloads,
      coordinator,
    })).rejects.toThrow('watch unavailable');

    const result = await importPendingWatchConnectivityPayloads({
      repository,
      queryClient,
      drainPendingPayloads: async () => [payload],
      acknowledgeImportedPayloads,
      coordinator,
    });

    expect(result.importedCount).toBe(1);
    expect(await repository.list()).toHaveLength(1);
    expect(acknowledgeImportedPayloads).toHaveBeenCalledTimes(2);
  });

  it('cancels an A import before local mutation and replays the same payload under B', async () => {
    const repositoryA = new LocalDiveLogRepository([], {now: () => 1781355000});
    const repositoryB = new LocalDiveLogRepository([], {now: () => 1781355000});
    const queryClient = createQueryClient();
    const coordinator = new WatchConnectivityImportCoordinator();
    const listStarted = createDeferred();
    const releaseList = createDeferred();
    const originalListA = repositoryA.list.bind(repositoryA);
    jest.spyOn(repositoryA, 'list').mockImplementationOnce(async () => {
      listStarted.resolve();
      await releaseList.promise;
      return originalListA();
    });
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    const requestSync = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    let listener: ((payload: WatchConnectivityPayload) => void) | undefined;
    const subscribeToPayloads = (handler: (payload: WatchConnectivityPayload) => void) => {
      listener = handler;
      return {remove: jest.fn()};
    };
    const payload: WatchConnectivityPayload = {
      payloadId: 'principal-switch-before-save',
      payloadJson: JSON.stringify(metadataRichFixture),
      localSessionId: 'fixture-rich-session',
      receivedAt: 1781355000,
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repositoryA}
            queryScope="user:A"
            coordinator={coordinator}
            drainPendingPayloads={async () => []}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            onLocalWritesCommitted={requestSync}
            subscribeToPayloads={subscribeToPayloads}
          />
        </QueryClientProvider>,
      );
      renderers.push(renderer);
      await flushPromises();
    });
    listener?.(payload);
    await listStarted.promise;

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repositoryB}
            queryScope="user:B"
            coordinator={coordinator}
            drainPendingPayloads={async () => []}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            onLocalWritesCommitted={requestSync}
            subscribeToPayloads={subscribeToPayloads}
          />
        </QueryClientProvider>,
      );
    });
    releaseList.resolve();
    await ReactTestRenderer.act(async () => {
      await flushPromises();
      await flushPromises();
    });

    expect(await repositoryA.list()).toEqual([]);
    expect(acknowledgeImportedPayloads).not.toHaveBeenCalled();
    expect(requestSync).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      listener?.(payload);
      await flushPromises();
      await flushPromises();
    });

    expect(await repositoryB.list()).toHaveLength(1);
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith([payload.payloadId]);
    expect(requestSync).toHaveBeenCalledTimes(1);
  });

  it('rolls back a persistent profile write when the principal switches before commit', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const metadataStorageKey = 'watch-race-metadata';
    const profileValues = new Map<string, WatchDepthSample[]>();
    const profileWriteStarted = createDeferred();
    const releaseProfileWrite = createDeferred();
    const profileStorage: WatchProfileStorage = {
      async write(key, samples) {
        profileWriteStarted.resolve();
        await releaseProfileWrite.promise;
        profileValues.set(key, samples.map(sample => ({...sample})));
      },
      async read(key) {
        return profileValues.get(key)?.map(sample => ({...sample}));
      },
      async remove(key) {
        profileValues.delete(key);
      },
    };
    const repositoryA = new PersistentDiveLogRepository({
      storage: metadataStorage,
      storageKey: metadataStorageKey,
      profileStorage,
      now: () => 1781355000,
    });
    const repositoryB = new LocalDiveLogRepository([], {now: () => 1781355000});
    const queryClient = createQueryClient();
    const coordinator = new WatchConnectivityImportCoordinator();
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    const requestSync = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    let listener: ((payload: WatchConnectivityPayload) => void) | undefined;
    const subscribeToPayloads = (handler: (payload: WatchConnectivityPayload) => void) => {
      listener = handler;
      return {remove: jest.fn()};
    };
    const payload: WatchConnectivityPayload = {
      payloadId: 'principal-switch-during-profile-write',
      payloadJson: JSON.stringify(metadataRichFixture),
      localSessionId: 'fixture-rich-session',
      contentRevision: 'fixture-rich-revision-1',
      sha256: 'fixture-profile-sha',
      receivedAt: 1781355000,
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repositoryA}
            queryScope="user:A"
            coordinator={coordinator}
            drainPendingPayloads={async () => []}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            onLocalWritesCommitted={requestSync}
            subscribeToPayloads={subscribeToPayloads}
          />
        </QueryClientProvider>,
      );
      renderers.push(renderer);
      await flushPromises();
    });
    listener?.(payload);
    await profileWriteStarted.promise;

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repositoryB}
            queryScope="user:B"
            coordinator={coordinator}
            drainPendingPayloads={async () => []}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            onLocalWritesCommitted={requestSync}
            subscribeToPayloads={subscribeToPayloads}
          />
        </QueryClientProvider>,
      );
    });
    releaseProfileWrite.resolve();
    await ReactTestRenderer.act(async () => {
      await flushPromises();
      await flushPromises();
    });

    expect(await repositoryA.list()).toEqual([]);
    expect(await metadataStorage.getString(metadataStorageKey)).toBeUndefined();
    expect(profileValues).toEqual(new Map());
    expect(acknowledgeImportedPayloads).not.toHaveBeenCalled();
    expect(requestSync).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('does not acknowledge or enqueue when A becomes stale after its local save', async () => {
    const repositoryA = new LocalDiveLogRepository([], {now: () => 1781355000});
    const repositoryB = new LocalDiveLogRepository([], {now: () => 1781355000});
    const enqueueSaved = jest.fn().mockResolvedValue(undefined);
    Object.assign(repositoryA, {enqueueSaved});
    const queryClient = createQueryClient();
    const coordinator = new WatchConnectivityImportCoordinator();
    const localSaveCompleted = createDeferred();
    const releasePostSaveList = createDeferred();
    const originalListA = repositoryA.list.bind(repositoryA);
    let listCallCount = 0;
    jest.spyOn(repositoryA, 'list').mockImplementation(async () => {
      listCallCount += 1;
      if (listCallCount === 2) {
        localSaveCompleted.resolve();
        await releasePostSaveList.promise;
      }
      return originalListA();
    });
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    const requestSync = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    let listener: ((payload: WatchConnectivityPayload) => void) | undefined;
    const subscribeToPayloads = (handler: (payload: WatchConnectivityPayload) => void) => {
      listener = handler;
      return {remove: jest.fn()};
    };
    const payload: WatchConnectivityPayload = {
      payloadId: 'principal-switch-after-save',
      payloadJson: JSON.stringify(metadataRichFixture),
      localSessionId: 'fixture-rich-session',
      receivedAt: 1781355000,
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repositoryA}
            queryScope="user:A"
            coordinator={coordinator}
            drainPendingPayloads={async () => []}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            onLocalWritesCommitted={requestSync}
            subscribeToPayloads={subscribeToPayloads}
          />
        </QueryClientProvider>,
      );
      renderers.push(renderer);
      await flushPromises();
    });
    listener?.(payload);
    await localSaveCompleted.promise;

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repositoryB}
            queryScope="user:B"
            coordinator={coordinator}
            drainPendingPayloads={async () => []}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            onLocalWritesCommitted={requestSync}
            subscribeToPayloads={subscribeToPayloads}
          />
        </QueryClientProvider>,
      );
    });
    releasePostSaveList.resolve();
    await ReactTestRenderer.act(async () => {
      await flushPromises();
      await flushPromises();
    });

    expect(await repositoryA.list()).toHaveLength(1);
    expect(acknowledgeImportedPayloads).not.toHaveBeenCalled();
    expect(enqueueSaved).not.toHaveBeenCalled();
    expect(requestSync).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      listener?.(payload);
      await flushPromises();
      await flushPromises();
    });

    expect(await repositoryB.list()).toHaveLength(1);
    expect(acknowledgeImportedPayloads).toHaveBeenCalledWith([payload.payloadId]);
  });

  it('separates the same payload single-flight by principal scope', async () => {
    const repositoryA = new LocalDiveLogRepository([], {now: () => 1781355000});
    const repositoryB = new LocalDiveLogRepository([], {now: () => 1781355000});
    const queryClient = createQueryClient();
    const coordinator = new WatchConnectivityImportCoordinator();
    const listStarted = createDeferred();
    const releaseList = createDeferred();
    const originalListA = repositoryA.list.bind(repositoryA);
    jest.spyOn(repositoryA, 'list').mockImplementationOnce(async () => {
      listStarted.resolve();
      await releaseList.promise;
      return originalListA();
    });
    const acknowledgeA = jest.fn().mockResolvedValue(undefined);
    const acknowledgeB = jest.fn().mockResolvedValue(undefined);
    const payload: WatchConnectivityPayload = {
      payloadId: 'same-payload-different-scope',
      payloadJson: JSON.stringify(metadataRichFixture),
      localSessionId: 'fixture-rich-session',
      receivedAt: 1781355000,
    };

    const importA = importPendingWatchConnectivityPayloads({
      repository: repositoryA,
      queryClient,
      queryScope: 'user:A',
      coordinator,
      drainPendingPayloads: async () => [payload],
      acknowledgeImportedPayloads: acknowledgeA,
    });
    await listStarted.promise;

    const importB = importPendingWatchConnectivityPayloads({
      repository: repositoryB,
      queryClient,
      queryScope: 'user:B',
      coordinator,
      drainPendingPayloads: async () => [payload],
      acknowledgeImportedPayloads: acknowledgeB,
    });

    await flushPromises();
    releaseList.resolve();
    const results = await Promise.allSettled([importA, importB]);

    expect(results[0]).toMatchObject({
      status: 'rejected',
      reason: {name: 'StaleWatchConnectivityImportError'},
    });
    expect(results[1]).toEqual({
      status: 'fulfilled',
      value: {receivedCount: 1, importedCount: 1},
    });
    expect(await repositoryA.list()).toEqual([]);
    expect(await repositoryB.list()).toHaveLength(1);
    expect(acknowledgeA).not.toHaveBeenCalled();
    expect(acknowledgeB).toHaveBeenCalledWith([payload.payloadId]);
  });

  it('persists a notConfigured duplicate as account pending before ACK and enqueue', async () => {
    const repository = new PersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'duplicate-recovery-logbook',
      now: () => 1781355000,
    });
    const planRepository = new LocalDivePlanRepository([{
      localId: 'duplicate-plan',
      status: 'planned',
      cloudSyncStatus: 'notConfigured',
      createdAt: 1781350000,
      updatedAt: 1781351000,
      plannedAt: 1781352000,
      title: 'Duplicate recovery',
      diveMode: 'scuba',
      site: {name: 'Recovery Reef'},
      buddyIds: [],
      gearIds: [],
      tags: [],
      objective: 'Recover the pending outbox write',
      plannedValues: {},
      checklistItems: [],
    }]);
    const queryClient = createQueryClient();
    const fixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        sourcePlanLocalId: 'duplicate-plan',
        samples: metadataRichFixture.session.samples.map(sample => ({...sample})),
      },
    };
    const seedPayload: WatchConnectivityPayload = {
      payloadId: 'duplicate-seed',
      payloadJson: JSON.stringify(fixture),
      localSessionId: 'fixture-rich-session',
      contentRevision: 'fixture-rich-revision-1',
      sha256: 'fixture-profile-sha',
      receivedAt: 1781355000,
    };
    await importPendingWatchConnectivityPayloads({
      repository,
      planRepository,
      queryClient,
      drainPendingPayloads: async () => [seedPayload],
      acknowledgeImportedPayloads: jest.fn().mockResolvedValue(undefined),
      coordinator: new WatchConnectivityImportCoordinator(),
    });
    const [seededEntry] = await repository.list();
    const seededPlan = await planRepository.get('duplicate-plan');
    expect(seededPlan).toBeDefined();
    expect(seededEntry.cloudSyncStatus).toBe('notConfigured');
    expect(seededPlan?.cloudSyncStatus).toBe('notConfigured');

    const order: string[] = [];
    const saveLog = repository.save.bind(repository);
    const savePlan = planRepository.save.bind(planRepository);
    const saveLocalLog = jest.fn(async (entry: Parameters<typeof repository.save>[0]) => {
      const saved = await saveLog({...entry, cloudSyncStatus: 'pending'});
      order.push('save-log');
      return saved;
    });
    const saveLocalPlan = jest.fn(async (plan: Parameters<typeof planRepository.save>[0]) => {
      const saved = await savePlan({...plan, cloudSyncStatus: 'pending'});
      order.push('save-plan');
      return saved;
    });
    const enqueueLog = jest.fn(async () => {
      order.push('enqueue-log');
    });
    const enqueuePlan = jest.fn(async () => {
      order.push('enqueue-plan');
    });
    Object.assign(repository, {saveLocalOnly: saveLocalLog, enqueueSaved: enqueueLog});
    Object.assign(planRepository, {saveLocalOnly: saveLocalPlan, enqueueSaved: enqueuePlan});
    const payload: WatchConnectivityPayload = {
      ...seedPayload,
      payloadId: 'duplicate-replay',
    };

    const result = await importPendingWatchConnectivityPayloads({
      repository,
      planRepository,
      queryClient,
      queryScope: 'user:duplicate-recovery',
      coordinator: new WatchConnectivityImportCoordinator(),
      drainPendingPayloads: async () => [payload],
      acknowledgeImportedPayloads: async payloadIds => {
        order.push('ack');
        expect(payloadIds).toEqual([payload.payloadId]);
        expect(saveLocalLog).toHaveBeenCalledTimes(1);
        expect(saveLocalPlan).toHaveBeenCalledTimes(1);
        expect((await repository.get(seededEntry.localId))?.cloudSyncStatus).toBe('pending');
        expect((await planRepository.get('duplicate-plan'))?.cloudSyncStatus).toBe('pending');
        expect(enqueueLog).not.toHaveBeenCalled();
        expect(enqueuePlan).not.toHaveBeenCalled();
      },
      onLocalWritesCommitted: async () => {
        order.push('remote');
      },
    });

    expect(result).toEqual({receivedCount: 1, importedCount: 0});
    expect(order).toEqual([
      'save-log',
      'save-plan',
      'ack',
      'enqueue-log',
      'enqueue-plan',
      'remote',
    ]);
    expect(enqueueLog).toHaveBeenCalledWith(expect.objectContaining({
      localId: seededEntry.localId,
      cloudSyncStatus: 'pending',
    }));
    expect(enqueuePlan).toHaveBeenCalledWith(expect.objectContaining({
      localId: 'duplicate-plan',
      cloudSyncStatus: 'pending',
    }));
  });

  it('commits log and plan locally before ACK, then enqueues before requesting remote sync', async () => {
    const repository = new LocalDiveLogRepository([], {now: () => 1781355000});
    const planRepository = new LocalDivePlanRepository([{
      localId: 'ordered-plan',
      status: 'planned',
      createdAt: 1781350000,
      updatedAt: 1781351000,
      plannedAt: 1781352000,
      title: 'Ordered import',
      diveMode: 'scuba',
      site: {name: 'Order Reef'},
      buddyIds: [],
      gearIds: [],
      tags: [],
      objective: 'Preserve durable ordering',
      plannedValues: {},
      checklistItems: [],
    }]);
    const order: string[] = [];
    const saveLog = repository.save.bind(repository);
    const savePlan = planRepository.save.bind(planRepository);
    Object.assign(repository, {
      saveLocalOnly: async (entry: Parameters<typeof repository.save>[0]) => {
        const saved = await saveLog(entry);
        order.push('local-log');
        return saved;
      },
      enqueueSaved: async () => {
        order.push('enqueue-log');
      },
    });
    Object.assign(planRepository, {
      saveLocalOnly: async (plan: Parameters<typeof planRepository.save>[0]) => {
        const saved = await savePlan(plan);
        order.push('local-plan');
        return saved;
      },
      enqueueSaved: async () => {
        order.push('enqueue-plan');
      },
    });
    const fixture = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        sourcePlanLocalId: 'ordered-plan',
        samples: metadataRichFixture.session.samples.map(sample => ({...sample})),
      },
    };

    await importPendingWatchConnectivityPayloads({
      repository,
      planRepository,
      queryClient: createQueryClient(),
      queryScope: 'user:ordered-import',
      coordinator: new WatchConnectivityImportCoordinator(),
      drainPendingPayloads: async () => [{
        payloadId: 'ordered-import-payload',
        payloadJson: JSON.stringify(fixture),
        localSessionId: 'fixture-rich-session',
        receivedAt: 1781355000,
      }],
      acknowledgeImportedPayloads: async () => {
        order.push('ack');
      },
      onLocalWritesCommitted: async () => {
        order.push('remote');
      },
    });

    expect(order).toEqual([
      'local-log',
      'local-plan',
      'ack',
      'enqueue-log',
      'enqueue-plan',
      'remote',
    ]);
  });

  it('invalidates an active import when the provider is cleaned up', async () => {
    const repository = new LocalDiveLogRepository([], {now: () => 1781355000});
    const queryClient = createQueryClient();
    const coordinator = new WatchConnectivityImportCoordinator();
    const listStarted = createDeferred();
    const releaseList = createDeferred();
    const originalList = repository.list.bind(repository);
    jest.spyOn(repository, 'list').mockImplementationOnce(async () => {
      listStarted.resolve();
      await releaseList.promise;
      return originalList();
    });
    const acknowledgeImportedPayloads = jest.fn().mockResolvedValue(undefined);
    const enqueueSaved = jest.fn().mockResolvedValue(undefined);
    Object.assign(repository, {enqueueSaved});
    const requestSync = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    let listener: ((payload: WatchConnectivityPayload) => void) | undefined;

    await ReactTestRenderer.act(async () => {
      const renderer = ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
            queryScope="user:cleanup"
            coordinator={coordinator}
            drainPendingPayloads={async () => []}
            acknowledgeImportedPayloads={acknowledgeImportedPayloads}
            onLocalWritesCommitted={requestSync}
            subscribeToPayloads={handler => {
              listener = handler;
              return {remove: jest.fn()};
            }}
          />
        </QueryClientProvider>,
      );
      renderers.push(renderer);
      await flushPromises();
    });
    listener?.({
      payloadId: 'cleanup-payload',
      payloadJson: JSON.stringify(metadataRichFixture),
      localSessionId: 'fixture-rich-session',
      receivedAt: 1781355000,
    });
    await listStarted.promise;

    await ReactTestRenderer.act(async () => {
      const renderer = renderers[renderers.length - 1];
      renderer.unmount();
      renderers.splice(renderers.indexOf(renderer), 1);
    });
    releaseList.resolve();
    await ReactTestRenderer.act(async () => {
      await flushPromises();
      await flushPromises();
    });

    expect(await repository.list()).toEqual([]);
    expect(acknowledgeImportedPayloads).not.toHaveBeenCalled();
    expect(enqueueSaved).not.toHaveBeenCalled();
    expect(requestSync).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
