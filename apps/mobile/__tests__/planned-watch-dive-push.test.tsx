import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type { PlannedWatchDivesUpdateStatus } from '../src/companion/watch-link';
import type { DivePlanRepository } from '../src/repositories/dive-plan-repository';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import { getPlanWatchState } from '../src/screens/planning/plan-status';
import type { DivePlan } from '../src/types/dive-plan';
import { createBlankDivePlan } from '../src/utils/create-dive-plan';

const mockUpdatePlannedWatchDives = jest.fn(async (_plans: DivePlan[]): Promise<unknown> => 'sent');
let mockPrincipalSettled = true;

jest.mock('../src/companion/default-watch-link', () => ({
  defaultWatchLink: {
    ...jest.requireActual('../src/companion/watch-link').createUnavailableWatchLink(),
    updatePlannedDives: (plans: DivePlan[]) => mockUpdatePlannedWatchDives(plans),
  },
}));

jest.mock('../src/states/account-data', () => ({
  useOptionalAccountData: () => ({ isPrincipalSettled: mockPrincipalSettled }),
}));

import { useDivePlans } from '../src/states/use-dive-plans';

function createDeferredRepository(): {
  repository: DivePlanRepository;
  resolveList: (plans: DivePlan[]) => void;
} {
  let resolveList: (plans: DivePlan[]) => void = () => undefined;
  const listPromise = new Promise<DivePlan[]>(resolve => {
    resolveList = resolve;
  });
  const repository = {
    list: jest.fn(() => listPromise),
    get: jest.fn(async () => undefined),
    save: jest.fn(async (plan: DivePlan) => plan),
    delete: jest.fn(async () => undefined),
  } as unknown as DivePlanRepository;
  return { repository, resolveList };
}

function Harness(props: { repository: DivePlanRepository }): null {
  useDivePlans({ repository: props.repository, queryScope: 'planned-watch-dive-push-test' });
  return null;
}

type DivePlansState = ReturnType<typeof useDivePlans>;

function StateHarness(props: { repository: DivePlanRepository; onState: (state: DivePlansState) => void }): null {
  props.onState(useDivePlans({ repository: props.repository, queryScope: 'planned-watch-dive-versions-test' }));
  return null;
}

const linkedWatch: PlannedWatchDivesUpdateStatus = {
  nativeBridgeAvailable: true,
  isSupported: true,
  isPaired: true,
  isWatchAppInstalled: true,
  isReachable: false,
  activationState: 'activated',
  payloadCount: 1,
  queuedCount: 0,
};

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
}

async function flushRepeatedly(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await flush();
  }
}

async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await flush();
    }
  }
  assertion();
}

describe('planned watch dive push', () => {
  const renderers: ReactTestRenderer.ReactTestRenderer[] = [];
  const queryClients: QueryClient[] = [];

  beforeEach(() => {
    mockUpdatePlannedWatchDives.mockReset();
    mockUpdatePlannedWatchDives.mockImplementation(async () => 'sent');
    mockPrincipalSettled = true;
  });

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

  function render(element: React.JSX.Element): ReactTestRenderer.ReactTestRenderer {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: Infinity, retry: false },
        mutations: { gcTime: Infinity, retry: false },
      },
    });
    queryClients.push(queryClient);
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
    });
    renderers.push(renderer!);
    return renderer!;
  }

  test('does not replace the watch plan list with an empty list before plans load', async () => {
    const { repository, resolveList } = createDeferredRepository();
    render(<Harness repository={repository} />);
    await flush();

    expect(mockUpdatePlannedWatchDives).not.toHaveBeenCalled();

    const plan = { ...createBlankDivePlan({ now: 1781353000 }), status: 'planned' as const };
    resolveList([plan]);
    await waitFor(() => expect(mockUpdatePlannedWatchDives).toHaveBeenCalledWith([plan]));

    expect(mockUpdatePlannedWatchDives).toHaveBeenCalledTimes(1);
  });

  test('does not send plans to the watch while the account principal is unsettled', async () => {
    mockPrincipalSettled = false;
    const { repository, resolveList } = createDeferredRepository();
    render(<Harness repository={repository} />);
    resolveList([{ ...createBlankDivePlan({ now: 1781353000 }), status: 'planned' as const }]);
    await flushRepeatedly();

    expect(mockUpdatePlannedWatchDives).not.toHaveBeenCalled();
  });

  test('counts a plan as sent only for the version the last successful update carried', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const updates: Array<{ resolve: (status: PlannedWatchDivesUpdateStatus) => void; reject: (error: Error) => void }> = [];
    mockUpdatePlannedWatchDives.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          updates.push({ resolve, reject });
        }),
    );
    const planned: DivePlan = { ...createBlankDivePlan({ now: 1781353000 }), localId: 'plan-planned', status: 'planned' };
    const draft: DivePlan = { ...createBlankDivePlan({ now: 1781353000 }), localId: 'plan-draft', title: 'Draft' };
    let state: DivePlansState | undefined;
    render(
      <StateHarness
        repository={new LocalDivePlanRepository([planned, draft])}
        onState={next => {
          state = next;
        }}
      />,
    );
    const lastUpdate = () => updates[updates.length - 1];
    const currentPlanned = () => state!.plans.find(plan => plan.localId === 'plan-planned')!;
    const watchState = () => getPlanWatchState(currentPlanned(), state!.plannedWatchSyncStatus, state!.plannedWatchSentVersions);

    await waitFor(() => expect(updates).toHaveLength(1));
    // Nothing counts as sent before an update finishes.
    expect(state!.plannedWatchSyncStatus).toBeUndefined();
    expect(state!.plannedWatchSentVersions).toBeUndefined();

    await ReactTestRenderer.act(async () => {
      lastUpdate().resolve(linkedWatch);
    });
    expect(state!.plannedWatchSyncStatus).toEqual(linkedWatch);
    // Only the plan the watch can see, by the version stored on this phone.
    expect(state!.plannedWatchSentVersions).toEqual(new Map([['plan-planned', 1781353000]]));
    expect(watchState()).toBe('sent');

    // An edit saved after that update is unconfirmed until an update carries it.
    const updatesBeforeEdit = updates.length;
    await ReactTestRenderer.act(async () => {
      await state!.savePlan({ ...planned, title: 'Edited', updatedAt: 1781353100 });
    });
    await waitFor(() => expect(updates.length).toBeGreaterThan(updatesBeforeEdit));
    expect(currentPlanned().updatedAt).toBe(1781353100);
    expect(watchState()).toBe('needsConnection');

    // A failed update does not count as sent either.
    await ReactTestRenderer.act(async () => {
      lastUpdate().reject(new Error('bridge unavailable'));
    });
    expect(state!.plannedWatchSentVersions).toEqual(new Map([['plan-planned', 1781353000]]));
    expect(watchState()).toBe('needsConnection');

    const updatesBeforeSecondEdit = updates.length;
    await ReactTestRenderer.act(async () => {
      await state!.savePlan({ ...planned, title: 'Edited again', updatedAt: 1781353200 });
    });
    await waitFor(() => expect(updates.length).toBeGreaterThan(updatesBeforeSecondEdit));
    await ReactTestRenderer.act(async () => {
      lastUpdate().resolve(linkedWatch);
    });
    expect(state!.plannedWatchSentVersions).toEqual(new Map([['plan-planned', 1781353200]]));
    expect(watchState()).toBe('sent');
  });
});
