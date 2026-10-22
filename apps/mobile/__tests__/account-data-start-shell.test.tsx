import { QueryClient } from '@tanstack/react-query';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ASYNC_FEEDBACK_TIMING } from '../src/constants/async-feedback';
import i18n from '../src/i18n';
import { LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import RecoveryScreen from '../src/screens/recovery/screen';
import { AccountDataProviderCore, useAccountData } from '../src/states/account-data';
import type { AuthState } from '../src/states/auth';
import type { DataPrincipal } from '../src/storage/data-principal';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';

const userId = '00000000-0000-4000-8000-000000000001';

type Repositories = {
  principal: DataPrincipal;
  queryScope: string;
  logbook: LocalDiveLogRepository;
  planbook: LocalDivePlanRepository;
};

function scopeFor(principal: DataPrincipal): string {
  return principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`;
}

function repositoriesFor(principal: DataPrincipal, logbook = new LocalDiveLogRepository()): Repositories {
  return { principal, queryScope: scopeFor(principal), logbook, planbook: new LocalDivePlanRepository() };
}

/** A logbook whose first read waits until the test opens the gate. */
function gatedLogbook(): { logbook: LocalDiveLogRepository; open(): void } {
  let open!: () => void;
  const gate = new Promise<void>(resolve => {
    open = resolve;
  });
  const logbook = new LocalDiveLogRepository();
  const list = logbook.list.bind(logbook);
  logbook.list = async () => {
    await gate;
    return list();
  };
  return { logbook, open };
}

function createDependencies(
  createRepositories = jest.fn((principal: DataPrincipal) => repositoriesFor(principal)),
) {
  return {
    metadataStorage: new InMemoryKeyValueStore(),
    profileStorage: {
      write: jest.fn(async () => undefined),
      read: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    },
    migrateLegacyData: jest.fn(async () => undefined),
    createRepositories,
    createId: () => '10000000-0000-4000-8000-000000000001',
    now: () => 100,
    jitter: () => 0,
    scheduleAfterInteractions: (task: () => void | Promise<void>) => {
      task();
      return { cancel: jest.fn() };
    },
  };
}

const publishedScopes: string[] = [];

function Capture() {
  publishedScopes.push(useAccountData().queryScope);
  return React.createElement('account-data-child', { testID: 'account-data-child' });
}

function provider(auth: AuthState, queryClient: QueryClient, dependencies: ReturnType<typeof createDependencies>) {
  return (
    <AccountDataProviderCore queryClient={queryClient} auth={{ state: auth }} dependencies={dependencies}>
      <Capture />
    </AccountDataProviderCore>
  );
}

async function flushMicrotasks() {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
  }
}

function isShowingShell(renderer: ReactTestRenderer.ReactTestRenderer): boolean {
  return renderer.root.findAllByProps({ testID: 'account-data-loading-screen' }).length > 0;
}

function isShowingChild(renderer: ReactTestRenderer.ReactTestRenderer): boolean {
  return renderer.root.findAllByProps({ testID: 'account-data-child' }).length > 0;
}

describe('account data start shell', () => {
  let queryClient: QueryClient;
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(async () => {
    publishedScopes.length = 0;
    queryClient = new QueryClient();
    renderer = undefined;
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  afterEach(async () => {
    if (renderer) {
      await ReactTestRenderer.act(async () => renderer!.unmount());
    }
    queryClient.clear();
    jest.useRealTimers();
  });

  it('keeps the shell while Auth restores a session and never publishes guest data first', async () => {
    const dependencies = createDependencies();

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(provider({ status: 'bootstrapping' }, queryClient, dependencies));
      await flushMicrotasks();
    });

    expect(isShowingShell(renderer!)).toBe(true);
    expect(isShowingChild(renderer!)).toBe(false);
    expect(dependencies.migrateLegacyData).not.toHaveBeenCalled();
    expect(dependencies.createRepositories).not.toHaveBeenCalled();
    // Nothing to restart while Auth itself is still checking the session.
    expect(renderer!.root.findByType(RecoveryScreen).props.onRetry).toBeUndefined();

    await ReactTestRenderer.act(async () => {
      renderer!.update(provider({ status: 'authenticated', userId }, queryClient, dependencies));
      await flushMicrotasks();
    });

    expect(isShowingChild(renderer!)).toBe(true);
    expect(new Set(publishedScopes)).toEqual(new Set([`user:${userId}`]));
    expect(dependencies.createRepositories.mock.calls[0]?.[0]).toEqual({ kind: 'user', userId });
  });

  it('opens guest data once Auth finds no stored session', async () => {
    const dependencies = createDependencies();

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(provider({ status: 'bootstrapping' }, queryClient, dependencies));
      await flushMicrotasks();
    });
    expect(isShowingShell(renderer!)).toBe(true);

    await ReactTestRenderer.act(async () => {
      renderer!.update(provider({ status: 'guest' }, queryClient, dependencies));
      await flushMicrotasks();
    });

    expect(isShowingChild(renderer!)).toBe(true);
    expect(new Set(publishedScopes)).toEqual(new Set(['guest']));
    expect(dependencies.createRepositories.mock.calls.map(([principal]) => principal)).toEqual([{ kind: 'guest' }]);
  });

  it('keeps guest data during sign-in and shows the shell, not guest data, until account data is ready', async () => {
    const account = gatedLogbook();
    const dependencies = createDependencies(
      jest.fn((principal: DataPrincipal) =>
        principal.kind === 'user' ? repositoriesFor(principal, account.logbook) : repositoriesFor(principal),
      ),
    );

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(provider({ status: 'guest' }, queryClient, dependencies));
      await flushMicrotasks();
    });
    await ReactTestRenderer.act(async () => {
      renderer!.update(provider({ status: 'authenticating', provider: 'apple' }, queryClient, dependencies));
      await flushMicrotasks();
    });
    expect(isShowingChild(renderer!)).toBe(true);
    expect(isShowingShell(renderer!)).toBe(false);

    publishedScopes.length = 0;
    await ReactTestRenderer.act(async () => {
      renderer!.update(provider({ status: 'authenticated', userId }, queryClient, dependencies));
      await flushMicrotasks();
    });
    expect(isShowingShell(renderer!)).toBe(true);
    expect(isShowingChild(renderer!)).toBe(false);
    expect(publishedScopes).toEqual([]);

    await ReactTestRenderer.act(async () => {
      account.open();
      await flushMicrotasks();
    });
    expect(isShowingChild(renderer!)).toBe(true);
    expect(new Set(publishedScopes)).toEqual(new Set([`user:${userId}`]));
  });

  it('hides account data at once on sign-out and opens guest data next', async () => {
    const dependencies = createDependencies();

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(provider({ status: 'authenticated', userId }, queryClient, dependencies));
      await flushMicrotasks();
    });
    expect(publishedScopes.at(-1)).toBe(`user:${userId}`);

    publishedScopes.length = 0;
    ReactTestRenderer.act(() => {
      renderer!.update(provider({ status: 'guest' }, queryClient, dependencies));
    });
    expect(isShowingShell(renderer!)).toBe(true);
    expect(publishedScopes).toEqual([]);

    await ReactTestRenderer.act(flushMicrotasks);
    expect(isShowingChild(renderer!)).toBe(true);
    expect(new Set(publishedScopes)).toEqual(new Set(['guest']));
  });

  it('ignores retry while the local preparation is in flight and restarts a stalled one after 10 s', async () => {
    jest.useFakeTimers();
    const stalled = gatedLogbook();
    const createRepositories = jest
      .fn((principal: DataPrincipal) => repositoriesFor(principal))
      .mockImplementationOnce((principal: DataPrincipal) => repositoriesFor(principal, stalled.logbook));
    const dependencies = createDependencies(createRepositories);

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(provider({ status: 'guest' }, queryClient, dependencies));
      await flushMicrotasks();
    });
    expect(isShowingShell(renderer!)).toBe(true);
    expect(createRepositories).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(ASYNC_FEEDBACK_TIMING.longRunning / 2);
      renderer!.root.findByType(RecoveryScreen).props.onRetry();
      await flushMicrotasks();
    });
    expect(createRepositories).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAllByProps({ testID: 'recovery-retry' })).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(ASYNC_FEEDBACK_TIMING.longRunning / 2);
    });
    await ReactTestRenderer.act(async () => {
      renderer!.root.findByProps({ testID: 'recovery-retry' }).props.onPress();
      await flushMicrotasks();
    });

    expect(createRepositories).toHaveBeenCalledTimes(2);
    expect(isShowingChild(renderer!)).toBe(true);

    // The stalled attempt finishing late does not replace the published repositories.
    const published = publishedScopes.length;
    await ReactTestRenderer.act(async () => {
      stalled.open();
      await flushMicrotasks();
    });
    expect(isShowingChild(renderer!)).toBe(true);
    expect(publishedScopes.length).toBe(published);
  });
});
