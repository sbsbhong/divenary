import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import metadataRichFixture from '../../../packages/contracts/fixtures/metadata-rich-watch-sync-message.json';
import { LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import type { WatchConnectivityPayload } from '../src/native/watch-connectivity';
import { diveLogbookQueryKeys } from '../src/states/use-dive-logbook-queries';
import { importPendingWatchConnectivityPayloads, WatchConnectivitySyncProvider } from '../src/states/watch-connectivity-sync';

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const queryClients: QueryClient[] = [];
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

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

  it('subscribes before draining pending payloads so startup deliveries are not missed', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781355000 });
    const queryClient = createQueryClient();
    const startupOrder: string[] = [];

    await ReactTestRenderer.act(async () => {
      renderers.push(ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <WatchConnectivitySyncProvider
            repository={repository}
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
});
