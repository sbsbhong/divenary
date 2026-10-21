import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type { DivePlanRepository } from '../src/repositories/dive-plan-repository';
import type { DivePlan } from '../src/types/dive-plan';
import { createBlankDivePlan } from '../src/utils/create-dive-plan';

const mockUpdatePlannedWatchDives = jest.fn(async (_plans: DivePlan[]) => 'sent' as const);
let mockPrincipalSettled = true;

jest.mock('../src/native/watch-connectivity', () => ({
  updatePlannedWatchDives: (plans: DivePlan[]) => mockUpdatePlannedWatchDives(plans),
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
    mockUpdatePlannedWatchDives.mockClear();
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
});
