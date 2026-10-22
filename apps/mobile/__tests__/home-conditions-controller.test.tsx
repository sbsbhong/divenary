import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import type { HomeConditionsProvider, HomeConditionsSnapshot } from '../src/conditions/home-conditions';
import type { HomeConditionsController } from '../src/conditions/use-home-conditions';
import {
  resetHomeConditionsCacheForTests,
  useHomeConditions,
} from '../src/conditions/use-home-conditions';
import type { LocationService } from '../src/conditions/location-service';

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));

let nextHarnessLocaleId = 0;
const initialAppStateCurrentStateDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState');

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(nextResolve => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

type HarnessProps = {
  locale?: string;
  locationService: LocationService;
  provider: HomeConditionsProvider;
  onSnapshot: jest.Mock<void, [HomeConditionsSnapshot]>;
  onController?: jest.Mock<void, [HomeConditionsController]>;
  openSettings?: () => Promise<void>;
};

function Harness(props: HarnessProps): null {
  const controller = useHomeConditions({
    locale: props.locale ?? 'ko',
    locationService: props.locationService,
    conditionsProvider: props.provider,
    openSettings: props.openSettings,
  });

  const {onSnapshot, onController} = props;

  React.useEffect(() => {
    onSnapshot(controller.snapshot);
  }, [controller.snapshot, onSnapshot]);

  React.useEffect(() => {
    onController?.(controller);
  }, [controller, onController]);

  return null;
}

const grantedLocation = {
  status: 'granted' as const,
  coordinates: {
    latitude: 33.5,
    longitude: 126.5,
    horizontalAccuracyMeters: 50,
    capturedAt: 1783512000,
  },
};

const readySnapshot: HomeConditionsSnapshot = {
  status: 'ready',
  cityName: 'Seoul',
  latitude: 33.5,
  longitude: 126.5,
  localTime: 1783512000,
  airTemperatureCelsius: 24.2,
  waterTemperatureCelsius: 22.8,
  isCoastal: true,
  source: 'openMeteo',
  updatedAt: 1783512000,
};

const createProvider = (snapshot: HomeConditionsSnapshot = readySnapshot): HomeConditionsProvider => ({
  getCurrentConditions: jest.fn(async () => snapshot),
});

const renderHarness = async (props: Omit<HarnessProps, 'onSnapshot'> & { onSnapshot?: jest.Mock<void, [HomeConditionsSnapshot]> }) => {
  const onSnapshot = props.onSnapshot ?? jest.fn();
  const locale = props.locale ?? `test-locale-${++nextHarnessLocaleId}`;
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <Harness
        locale={locale}
        locationService={props.locationService}
        provider={props.provider}
        onSnapshot={onSnapshot}
        onController={props.onController}
        openSettings={props.openSettings}
      />,
    );
    await flushPromises();
    await flushPromises();
  });

  return {
    renderer: renderer!,
    locale,
    onSnapshot,
    latestSnapshot: () => onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1]?.[0],
  };
};

describe('useHomeConditions', () => {
  beforeEach(() => {
    resetHomeConditionsCacheForTests();
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (initialAppStateCurrentStateDescriptor) {
      Object.defineProperty(AppState, 'currentState', initialAppStateCurrentStateDescriptor);
    }
  });

  it('loads provider conditions with current coordinates', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const provider = createProvider();

    const { latestSnapshot, locale } = await renderHarness({ locationService, provider });

    expect(locationService.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(provider.getCurrentConditions).toHaveBeenCalledWith(expect.objectContaining({
      latitude: 33.5,
      longitude: 126.5,
      locale,
    }));
    expect(latestSnapshot()).toMatchObject(readySnapshot);
  });

  it('waits for an active AppState before the initial conditions request', async () => {
    const listeners: Array<(state: AppStateStatus) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: jest.fn() };
    });
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'inactive',
    });
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const provider = createProvider();

    await renderHarness({ locationService, provider });

    expect(locationService.getCurrentLocation).not.toHaveBeenCalled();
    expect(provider.getCurrentConditions).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      listeners[0]('active');
      await flushPromises();
      await flushPromises();
    });

    expect(locationService.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(1);
  });

  it('returns permissionDenied without calling the provider when location permission is denied', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => ({ status: 'permissionDenied' as const })),
    };
    const provider = createProvider();

    const { latestSnapshot } = await renderHarness({ locationService, provider });

    expect(provider.getCurrentConditions).not.toHaveBeenCalled();
    expect(latestSnapshot()).toMatchObject({ status: 'permissionDenied', source: 'openMeteo' });
  });

  it('returns unavailable when current location cannot be resolved', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => ({ status: 'unavailable' as const })),
    };
    const provider = createProvider();

    const { latestSnapshot } = await renderHarness({ locationService, provider });

    expect(provider.getCurrentConditions).not.toHaveBeenCalled();
    expect(latestSnapshot()).toMatchObject({ status: 'unavailable', source: 'openMeteo' });
  });

  it('retries the location and provider request', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const provider = createProvider();
    const onController = jest.fn<void, [HomeConditionsController]>();

    await renderHarness({ locationService, provider, onController });
    const controller = onController.mock.calls[onController.mock.calls.length - 1][0];

    await ReactTestRenderer.act(async () => {
      controller.retry();
      await flushPromises();
      await flushPromises();
    });

    expect(locationService.getCurrentLocation).toHaveBeenCalledTimes(2);
    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(2);
  });

  it('reuses a fresh ready snapshot when Home remounts with the same locale', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const provider = createProvider();
    const locale = 'ko-fresh-remount';

    const firstRender = await renderHarness({ locale, locationService, provider });
    await ReactTestRenderer.act(async () => {
      firstRender.renderer.unmount();
    });
    const secondRender = await renderHarness({ locale, locationService, provider });

    expect(locationService.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(secondRender.latestSnapshot()).toMatchObject(readySnapshot);
  });

  it('expires a ready snapshot after five minutes', async () => {
    let nowMs = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const provider = createProvider();
    const locale = 'ko-expired-remount';

    const firstRender = await renderHarness({ locale, locationService, provider });
    await ReactTestRenderer.act(async () => {
      firstRender.renderer.unmount();
    });
    nowMs += (5 * 60 * 1000) + 1;
    await renderHarness({ locale, locationService, provider });

    expect(locationService.getCurrentLocation).toHaveBeenCalledTimes(2);
    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(2);
  });

  it('does not cache non-ready snapshots', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn()
        .mockResolvedValueOnce({ status: 'error', source: 'openMeteo' })
        .mockResolvedValueOnce(readySnapshot),
    };
    const locale = 'ko-ready-only-cache';

    const firstRender = await renderHarness({ locale, locationService, provider });
    await ReactTestRenderer.act(async () => {
      firstRender.renderer.unmount();
    });
    const secondRender = await renderHarness({ locale, locationService, provider });

    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(2);
    expect(secondRender.latestSnapshot()).toMatchObject(readySnapshot);
  });

  it('keeps fresh ready snapshots isolated by locale', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const englishSnapshot: HomeConditionsSnapshot = {
      ...readySnapshot,
      cityName: 'Busan',
    };
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn()
        .mockResolvedValueOnce(readySnapshot)
        .mockResolvedValueOnce(englishSnapshot),
    };

    const koreanRender = await renderHarness({
      locale: 'ko-locale-cache',
      locationService,
      provider,
    });
    await ReactTestRenderer.act(async () => {
      koreanRender.renderer.unmount();
    });
    const englishRender = await renderHarness({
      locale: 'en-locale-cache',
      locationService,
      provider,
    });

    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(2);
    expect(englishRender.latestSnapshot()).toMatchObject({
      status: 'ready',
      cityName: 'Busan',
    });
  });

  it('does not coalesce requests for different locales', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const koreanRequest = createDeferred<HomeConditionsSnapshot>();
    const englishRequest = createDeferred<HomeConditionsSnapshot>();
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn(input =>
        input.locale === 'ko-in-flight'
          ? koreanRequest.promise
          : englishRequest.promise,
      ),
    };

    const koreanRender = await renderHarness({
      locale: 'ko-in-flight',
      locationService,
      provider,
    });
    const englishRender = await renderHarness({
      locale: 'en-in-flight',
      locationService,
      provider,
    });

    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(2);

    await ReactTestRenderer.act(async () => {
      koreanRequest.resolve(readySnapshot);
      englishRequest.resolve({ ...readySnapshot, cityName: 'Busan' });
      await flushPromises();
    });
    await ReactTestRenderer.act(async () => {
      koreanRender.renderer.unmount();
      englishRender.renderer.unmount();
    });
  });

  it('reuses a fresh ready snapshot when the app returns to foreground', async () => {
    const listeners: Array<(state: AppStateStatus) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: jest.fn() };
    });
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const provider = createProvider();

    await renderHarness({ locationService, provider });

    await ReactTestRenderer.act(async () => {
      listeners[0]('active');
      await flushPromises();
      await flushPromises();
    });

    expect(locationService.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(1);
  });

  it('shares a same-locale request already in flight when the app returns to foreground', async () => {
    const listeners: Array<(state: AppStateStatus) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: jest.fn() };
    });
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const pendingSnapshot = createDeferred<HomeConditionsSnapshot>();
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn(() => pendingSnapshot.promise),
    };

    await renderHarness({
      locale: 'ko-shared-in-flight',
      locationService,
      provider,
    });

    await ReactTestRenderer.act(async () => {
      listeners[0]('active');
      await flushPromises();
    });

    const locationCallCount = jest.mocked(locationService.getCurrentLocation).mock.calls.length;
    const providerCallCount = jest.mocked(provider.getCurrentConditions).mock.calls.length;

    await ReactTestRenderer.act(async () => {
      pendingSnapshot.resolve(readySnapshot);
      await flushPromises();
    });

    expect(locationCallCount).toBe(1);
    expect(providerCallCount).toBe(1);
  });

  it('publishes an in-flight forced refresh instead of short-circuiting to fresh cache on foreground', async () => {
    const listeners: Array<(state: AppStateStatus) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: jest.fn() };
    });
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const refreshedSnapshot: HomeConditionsSnapshot = {
      ...readySnapshot,
      cityName: 'Busan',
    };
    const pendingRefresh = createDeferred<HomeConditionsSnapshot>();
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn()
        .mockResolvedValueOnce(readySnapshot)
        .mockImplementationOnce(() => pendingRefresh.promise),
    };
    const onController = jest.fn<void, [HomeConditionsController]>();
    const render = await renderHarness({
      locale: 'ko-refresh-foreground-race',
      locationService,
      provider,
      onController,
    });
    const controller = onController.mock.calls[onController.mock.calls.length - 1][0];

    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });

    await ReactTestRenderer.act(async () => {
      controller.retry();
      await flushPromises();
    });
    await ReactTestRenderer.act(async () => {
      listeners[0]('active');
      await flushPromises();
    });
    await ReactTestRenderer.act(async () => {
      pendingRefresh.resolve(refreshedSnapshot);
      await flushPromises();
    });

    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(2);
    expect(render.latestSnapshot()).toMatchObject({
      status: 'ready',
      cityName: 'Busan',
    });
  });

  it('keeps the ready snapshot and flags the failure when a refresh throws, then clears it on success', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn()
        .mockResolvedValueOnce(readySnapshot)
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({ ...readySnapshot, cityName: 'Busan' }),
    };
    const onController = jest.fn<void, [HomeConditionsController]>();
    const latestController = () => onController.mock.calls[onController.mock.calls.length - 1][0];
    const render = await renderHarness({ locationService, provider, onController });

    await ReactTestRenderer.act(async () => {
      await latestController().refresh();
    });

    expect(render.latestSnapshot()).toMatchObject({ status: 'ready', cityName: 'Seoul' });
    expect(latestController().refreshFailed).toBe(true);
    expect(latestController().isRefreshing).toBe(false);

    await ReactTestRenderer.act(async () => {
      await latestController().refresh();
    });

    expect(render.latestSnapshot()).toMatchObject({ status: 'ready', cityName: 'Busan' });
    expect(latestController().refreshFailed).toBe(false);
  });

  it('keeps ready values through an expired-cache reload when the app returns to foreground', async () => {
    let nowMs = 2_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const listeners: Array<(state: AppStateStatus) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: jest.fn() };
    });
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const pendingReload = createDeferred<HomeConditionsSnapshot>();
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn()
        .mockResolvedValueOnce(readySnapshot)
        .mockImplementationOnce(() => pendingReload.promise),
    };
    const onController = jest.fn<void, [HomeConditionsController]>();
    const render = await renderHarness({ locationService, provider, onController });

    const snapshotCallsBeforeReload = render.onSnapshot.mock.calls.length;
    nowMs += (5 * 60 * 1000) + 1;
    await ReactTestRenderer.act(async () => {
      listeners[0]('background');
      listeners[0]('active');
      await flushPromises();
    });

    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(2);
    expect(
      render.onSnapshot.mock.calls.slice(snapshotCallsBeforeReload).map(([snapshot]) => snapshot.status),
    ).not.toContain('loading');
    expect(render.latestSnapshot()).toMatchObject({ status: 'ready', cityName: 'Seoul' });
    expect(onController.mock.calls[onController.mock.calls.length - 1][0].isRefreshing).toBe(true);

    await ReactTestRenderer.act(async () => {
      pendingReload.resolve({ ...readySnapshot, cityName: 'Busan' });
      await flushPromises();
    });

    expect(render.latestSnapshot()).toMatchObject({ status: 'ready', cityName: 'Busan' });
  });

  it('opens app settings through the injected settings action', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => ({ status: 'permissionDenied' as const })),
    };
    const provider = createProvider();
    const openSettings = jest.fn(async () => undefined);
    const onController = jest.fn<void, [HomeConditionsController]>();

    await renderHarness({ locationService, provider, openSettings, onController });
    const controller = onController.mock.calls[onController.mock.calls.length - 1][0];

    await ReactTestRenderer.act(async () => {
      await controller.openSettings();
    });

    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
