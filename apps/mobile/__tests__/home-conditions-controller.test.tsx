import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import type { HomeConditionsProvider, HomeConditionsSnapshot } from '../src/conditions/home-conditions';
import type { HomeConditionsController } from '../src/conditions/use-home-conditions';
import { useHomeConditions } from '../src/conditions/use-home-conditions';
import type { LocationService } from '../src/conditions/location-service';

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));

type HarnessProps = {
  locationService: LocationService;
  provider: HomeConditionsProvider;
  onSnapshot: jest.Mock<void, [HomeConditionsSnapshot]>;
  onController?: jest.Mock<void, [HomeConditionsController]>;
  openSettings?: () => Promise<void>;
};

function Harness(props: HarnessProps): null {
  const controller = useHomeConditions({
    locale: 'ko',
    locationService: props.locationService,
    conditionsProvider: props.provider,
    openSettings: props.openSettings,
  });

  React.useEffect(() => {
    props.onSnapshot(controller.snapshot);
  }, [controller.snapshot, props.onSnapshot]);

  React.useEffect(() => {
    props.onController?.(controller);
  }, [controller, props.onController]);

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

  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
      <Harness
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
    onSnapshot,
    latestSnapshot: () => onSnapshot.mock.calls[onSnapshot.mock.calls.length - 1]?.[0],
  };
};

describe('useHomeConditions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads provider conditions with current coordinates', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => grantedLocation),
    };
    const provider = createProvider();

    const { latestSnapshot } = await renderHarness({ locationService, provider });

    expect(locationService.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(provider.getCurrentConditions).toHaveBeenCalledWith(expect.objectContaining({
      latitude: 33.5,
      longitude: 126.5,
      locale: 'ko',
    }));
    expect(latestSnapshot()).toMatchObject(readySnapshot);
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

  it('rechecks conditions when the app returns to foreground', async () => {
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

    expect(locationService.getCurrentLocation).toHaveBeenCalledTimes(2);
    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(2);
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
