let mockAccountData: {
  logbookRepository: import('../src/repositories/dive-log-repository').DiveLogRepository;
  planRepository: import('../src/repositories/dive-plan-repository').DivePlanRepository;
  queryScope: string;
  refreshCloudData: jest.Mock<Promise<void>, []>;
  requestSync: jest.Mock;
};
const mockLogRefetch = jest.fn<Promise<void>, []>();
const mockPlanRefetch = jest.fn<Promise<void>, []>();

jest.mock('../src/states/account-data', () => ({
  useOptionalAccountData: () => mockAccountData,
}));

jest.mock('../src/states/use-dive-logbook-queries', () => ({
  useDiveLogEntriesQuery: () => ({
    data: [],
    error: undefined,
    isLoading: false,
    isRefetching: false,
    refetch: mockLogRefetch,
  }),
  useSaveDiveLogEntryMutation: () => ({
    error: undefined,
    isPending: false,
    mutateAsync: jest.fn(),
  }),
  useDeleteDiveLogEntryMutation: () => ({
    error: undefined,
    isPending: false,
    mutateAsync: jest.fn(),
  }),
}));

jest.mock('../src/states/use-dive-plan-queries', () => ({
  useDivePlansQuery: () => ({
    data: [],
    error: undefined,
    isLoading: false,
    isRefetching: false,
    refetch: mockPlanRefetch,
  }),
  useSaveDivePlanMutation: () => ({
    error: undefined,
    isPending: false,
    mutateAsync: jest.fn(),
  }),
  useDeleteDivePlanMutation: () => ({
    error: undefined,
    isPending: false,
    mutateAsync: jest.fn(),
  }),
}));

jest.mock('../src/companion/default-watch-link', () => ({
  defaultWatchLink: {
    ...jest.requireActual('../src/companion/watch-link').createUnavailableWatchLink(),
    isAvailable: jest.fn(() => false),
    updatePlannedDives: jest.fn(async () => 'unavailable'),
  },
}));

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {LocalDiveLogRepository} from '../src/repositories/local-dive-log-repository';
import {LocalDivePlanRepository} from '../src/repositories/local-dive-plan-repository';
import {useDiveLogbook} from '../src/states/use-dive-logbook';
import {useDivePlans} from '../src/states/use-dive-plans';

describe('explicit cloud list refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccountData = {
      logbookRepository: new LocalDiveLogRepository(),
      planRepository: new LocalDivePlanRepository(),
      queryScope: 'user:test-user',
      refreshCloudData: jest.fn(async () => undefined),
      requestSync: jest.fn(async () => ({processed: 0, remaining: 0})),
    };
    mockLogRefetch.mockResolvedValue(undefined);
    mockPlanRefetch.mockResolvedValue(undefined);
  });

  it('pulls cloud account data before refetching the local Logbook query', async () => {
    const order: string[] = [];
    mockAccountData.refreshCloudData.mockImplementation(async () => {
      order.push('cloud');
    });
    mockLogRefetch.mockImplementation(async () => {
      order.push('local');
    });
    let capture: ReturnType<typeof useDiveLogbook> | undefined;
    const Capture = () => {
      capture = useDiveLogbook();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <Capture />
        </QueryClientProvider>,
      );
    });
    await ReactTestRenderer.act(async () => {
      await capture!.refresh();
    });

    expect(order).toEqual(['cloud', 'local']);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('keeps Logbook refresh usable and refetches local rows when the cloud pull fails', async () => {
    const order: string[] = [];
    mockAccountData.refreshCloudData.mockImplementation(async () => {
      order.push('cloud');
      throw new Error('cloud unavailable');
    });
    mockLogRefetch.mockImplementation(async () => {
      order.push('local');
    });
    let capture: ReturnType<typeof useDiveLogbook> | undefined;
    const Capture = () => {
      capture = useDiveLogbook();
      return null;
    };
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <Capture />
        </QueryClientProvider>,
      );
    });

    let refreshError: unknown;
    await ReactTestRenderer.act(async () => {
      try {
        await capture!.refresh();
      } catch (error) {
        refreshError = error;
      }
    });
    expect(refreshError).toBeUndefined();
    expect(order).toEqual(['cloud', 'local']);

    await ReactTestRenderer.act(async () => renderer!.unmount());
    queryClient.clear();
  });

  it('pulls cloud account data before refetching the local Planbook query', async () => {
    const order: string[] = [];
    mockAccountData.refreshCloudData.mockImplementation(async () => {
      order.push('cloud');
    });
    mockPlanRefetch.mockImplementation(async () => {
      order.push('local');
    });
    let capture: ReturnType<typeof useDivePlans> | undefined;
    const Capture = () => {
      capture = useDivePlans();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Capture />);
      await Promise.resolve();
    });
    await ReactTestRenderer.act(async () => {
      await capture!.refresh();
    });

    expect(order).toEqual(['cloud', 'local']);

    await ReactTestRenderer.act(async () => renderer!.unmount());
  });

  it('keeps Planbook refresh usable and refetches local rows when the cloud pull fails', async () => {
    const order: string[] = [];
    mockAccountData.refreshCloudData.mockImplementation(async () => {
      order.push('cloud');
      throw new Error('cloud unavailable');
    });
    mockPlanRefetch.mockImplementation(async () => {
      order.push('local');
    });
    let capture: ReturnType<typeof useDivePlans> | undefined;
    const Capture = () => {
      capture = useDivePlans();
      return null;
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Capture />);
      await Promise.resolve();
    });

    let refreshError: unknown;
    await ReactTestRenderer.act(async () => {
      try {
        await capture!.refresh();
      } catch (error) {
        refreshError = error;
      }
    });
    expect(refreshError).toBeUndefined();
    expect(order).toEqual(['cloud', 'local']);

    await ReactTestRenderer.act(async () => renderer!.unmount());
  });
});
