import { QueryClient } from '@tanstack/react-query';
import type { AccountDataRepository } from '@repo/supabase';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AppState, type AppStateStatus} from 'react-native';
import { LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import {
  AccountDataProviderCore,
  clearPrincipalQueries,
  createAccountLocalFirstRepositories,
} from '../src/states/account-data';
import { AccountOutbox } from '../src/sync/account-outbox';
import {AccountSyncCoordinator} from '../src/sync/account-sync-coordinator';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type { DiveLogEntry } from '../src/types/dive-log-entry';

const userId = '00000000-0000-4000-8000-000000000001';

const entry: DiveLogEntry = {
  localId: 'local-log-1',
  source: 'manual',
  cloudSyncStatus: 'notConfigured',
  createdAt: 100,
  updatedAt: 100,
  manual: {
    site: {name: 'Local Reef'},
    buddyIds: [],
    gearIds: [],
    tags: [],
    observedMarineLife: [],
    measuredValues: {startedAt: 100},
  },
  mobile: {mediaPlaceholders: []},
  provenance: {},
};

describe('account data state', () => {
  it('cancels and removes every previous-principal query before publication', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['diveLogbook', 'user:old-user', 'list'], ['old']);
    queryClient.setQueryData(['divePlans', 'user:old-user', 'list'], ['old']);
    queryClient.setQueryData(['diveLogbook', 'user:new-user', 'list'], ['new']);
    const cancelQueries = jest.spyOn(queryClient, 'cancelQueries');

    await clearPrincipalQueries(queryClient, 'user:old-user');

    expect(cancelQueries).toHaveBeenCalledWith({predicate: expect.any(Function)});
    expect(queryClient.getQueryData(['diveLogbook', 'user:old-user', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['divePlans', 'user:old-user', 'list'])).toBeUndefined();
    expect(queryClient.getQueryData(['diveLogbook', 'user:new-user', 'list'])).toEqual(['new']);
    queryClient.clear();
  });

  it('saves account edits locally as pending before enqueueing and never calls the network directly', async () => {
    const order: string[] = [];
    const localLogbook = new LocalDiveLogRepository();
    const originalSave = localLogbook.save.bind(localLogbook);
    jest.spyOn(localLogbook, 'save').mockImplementation(async value => {
      order.push('local');
      return originalSave(value);
    });
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
    const originalEnqueue = outbox.enqueue.bind(outbox);
    jest.spyOn(outbox, 'enqueue').mockImplementation(async value => {
      order.push('outbox');
      return originalEnqueue(value);
    });
    const accountRepository = {
      saveLog: jest.fn(),
      savePlan: jest.fn(),
    } as unknown as AccountDataRepository;
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: {kind: 'user', userId},
        queryScope: `user:${userId}`,
        logbook: localLogbook,
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });

    const saved = await repositories.logbook.save(entry);

    expect(order).toEqual(['local', 'outbox']);
    expect(saved).toMatchObject({
      remoteId: '10000000-0000-4000-8000-000000000001',
      ownerUserId: userId,
      cloudSyncStatus: 'pending',
    });
    expect((await outbox.list(userId))[0]).toMatchObject({
      entityKind: 'log',
      entityLocalId: 'local-log-1',
      mutation: 'upsert',
    });
    expect(accountRepository.saveLog).not.toHaveBeenCalled();
  });

  it('keeps guest writes local-only', async () => {
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
    const guest = {
      principal: {kind: 'guest'} as const,
      queryScope: 'guest',
      logbook: new LocalDiveLogRepository(),
      planbook: new LocalDivePlanRepository(),
    };

    await guest.logbook.save(entry);

    await expect(guest.logbook.get('local-log-1')).resolves.toEqual(entry);
    await expect(outbox.list()).resolves.toEqual([]);
  });

  it('keeps the device profile key out of the remote watch metadata', async () => {
    const outbox = new AccountOutbox({storage: new InMemoryKeyValueStore(), storageKey: 'outbox'});
    const repositories = createAccountLocalFirstRepositories({
      userId,
      repositories: {
        principal: {kind: 'user', userId},
        queryScope: `user:${userId}`,
        logbook: new LocalDiveLogRepository(),
        planbook: new LocalDivePlanRepository(),
      },
      outbox,
      createId: () => '10000000-0000-4000-8000-000000000001',
      now: () => 100,
    });

    await repositories.logbook.save({
      ...entry,
      source: 'watch',
      watchCapture: {
        importKey: 'watch-1:100',
        importedAt: 100,
        session: {localSessionId: 'watch-1', startedAt: 100, samples: []},
        measuredValues: {startedAt: 100},
        samples: [],
        profile: {
          storageKey: 'dive-mobile:watch-profile:user:private-device-key',
          contentRevision: 'revision-1',
          sampleCount: 0,
          sha256: 'a'.repeat(64),
        },
      },
    });

    const [queued] = await outbox.list(userId);
    const remote = queued.payload.remote as {payload: {watch_metadata: unknown}};
    expect(JSON.stringify(remote.payload.watch_metadata)).not.toContain('storageKey');
    expect(remote.payload.watch_metadata).toMatchObject({
      profile: {contentRevision: 'revision-1', sampleCount: 0},
    });
  });

  it('resumes an online account drain when the app returns to the foreground', async () => {
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener;
      return {remove: jest.fn()};
    });
    jest
      .spyOn(AccountSyncCoordinator.prototype, 'hydrate')
      .mockResolvedValue(undefined);
    const drain = jest
      .spyOn(AccountSyncCoordinator.prototype, 'drain')
      .mockResolvedValue({processed: 0, remaining: 0});
    const metadataStorage = new InMemoryKeyValueStore();
    const queryClient = new QueryClient();
    const accountRepository = {} as AccountDataRepository;
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AccountDataProviderCore
          queryClient={queryClient}
          auth={{
            state: {status: 'authenticated', userId},
            accountDataRepository: accountRepository,
          }}
          dependencies={{
            metadataStorage,
            profileStorage: {
              write: jest.fn(async () => undefined),
              read: jest.fn(async () => undefined),
              remove: jest.fn(async () => undefined),
            },
            migrateLegacyData: jest.fn(async () => undefined),
            createRepositories: principal => ({
              principal,
              queryScope: `user:${userId}`,
              logbook: new LocalDiveLogRepository(),
              planbook: new LocalDivePlanRepository(),
            }),
            createId: () => '10000000-0000-4000-8000-000000000001',
            now: () => 100,
            jitter: () => 0,
          }}
        />,
      );
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const initialDrainCount = drain.mock.calls.length;
    await ReactTestRenderer.act(async () => {
      appStateListener?.('background');
      appStateListener?.('active');
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(drain).toHaveBeenCalledTimes(initialDrainCount + 1);
    expect(drain).toHaveBeenLastCalledWith({online: true});

    await ReactTestRenderer.act(async () => renderer.unmount());
    queryClient.clear();
    jest.restoreAllMocks();
  });
});
