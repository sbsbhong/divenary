import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import i18n from '../src/i18n';
import HomeScreen from '../src/screens/home/screen';
import { AppPreferencesProvider } from '../src/states/app-preferences';
import type { AppPreferencesStorage } from '../src/states/app-preferences-storage';
import type { HomeConditionsProvider, HomeConditionsSnapshot } from '../src/conditions/home-conditions';
import type { LocationService } from '../src/conditions/location-service';

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

jest.mock('react-native-reanimated', () => {
  const createAnimation = () => {
    const animation = {} as {
      duration: jest.Mock;
      withInitialValues: jest.Mock;
    };

    animation.duration = jest.fn(() => animation);
    animation.withInitialValues = jest.fn(() => animation);

    return animation;
  };

  return {
    __esModule: true,
    default: {
      createAnimatedComponent: (component: React.ComponentType) => component,
    },
    FadeOut: createAnimation(),
    ZoomIn: createAnimation(),
  };
});

const grantedLocation = {
  status: 'granted' as const,
  coordinates: {
    latitude: 33.5,
    longitude: 126.5,
    horizontalAccuracyMeters: 50,
    capturedAt: 1783512000,
  },
};

const createGrantedLocationService = (): LocationService => ({
  getCurrentLocation: jest.fn(async () => grantedLocation),
});

const renderHome = async (
  snapshot: HomeConditionsSnapshot,
  options: {
    locationService?: LocationService;
    onOpenLogbook?: jest.Mock;
    onOpenPlanning?: jest.Mock;
    openSettings?: () => Promise<void>;
    preferencesStorage?: AppPreferencesStorage;
    sessions?: React.ComponentProps<typeof HomeScreen>['sessions'];
    isLoading?: boolean;
    recovery?: React.ComponentProps<typeof HomeScreen>['recovery'];
  } = {},
) => {
  const provider: HomeConditionsProvider = {
    getCurrentConditions: jest.fn(async () => snapshot),
  };
  const locationService = options.locationService ?? createGrantedLocationService();
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <AppPreferencesProvider storage={options.preferencesStorage}>
        <HomeScreen
          sessions={options.sessions ?? []}
          isLoading={options.isLoading}
          conditionsProvider={provider}
          locationService={locationService}
          openSettings={options.openSettings}
          onOpenLogbook={options.onOpenLogbook ?? jest.fn()}
          onOpenPlanning={options.onOpenPlanning ?? jest.fn()}
          onRefresh={jest.fn()}
          recovery={options.recovery}
        />
      </AppPreferencesProvider>,
    );
    mountedRenderers.push(renderer);
    await flushPromises();
    await flushPromises();
  });

  return {
    locationService,
    provider,
    renderer: renderer!,
  };
};

describe('Home conditions interface', () => {
  afterEach(() => {
    ReactTestRenderer.act(() => {
      for (const renderer of mountedRenderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  beforeEach(async () => {
    const asyncStorageMock = jest.requireMock('@react-native-async-storage/async-storage') as {
      __resetAsyncStorageMock: () => void;
    };

    asyncStorageMock.__resetAsyncStorageMock();

    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  it('shows one compact recovery banner and runs its action', async () => {
    const onPress = jest.fn();
    const {renderer} = await renderHome(
      {status: 'unavailable'},
      {
        recovery: {
          title: '일부 데이터를 확인하지 못했습니다',
          description: '저장된 기록은 계속 사용할 수 있습니다.',
          actionLabel: '다시 시도',
          onPress,
        },
      },
    );

    const banner = renderer.root.findByProps({testID: 'home-recovery-banner'});
    expect(banner).toBeTruthy();
    await ReactTestRenderer.act(async () => banner.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a ready coastal snapshot with city, local time, air temperature, and water temperature', async () => {
    const { provider, renderer } = await renderHome({
      status: 'ready',
      cityName: 'Jeju City',
      localTime: 1782444600,
      airTemperatureCelsius: 24.2,
      waterTemperatureCelsius: 22.8,
      isCoastal: true,
      source: 'mock',
      updatedAt: 1782444300,
    });
    const root = renderer.root;

    expect(provider.getCurrentConditions).toHaveBeenCalledWith(expect.objectContaining({
      latitude: 33.5,
      longitude: 126.5,
      locale: 'ko',
    }));
    expect(root.findByProps({ testID: 'home-conditions-city' }).props.children).toBe('Jeju City');
    expect(root.findByProps({ testID: 'home-conditions-location-icon' }).props.className).toEqual(expect.stringContaining('bg-primary/10'));
    expect(root.findByProps({ testID: 'home-conditions-local-time' }).props.children).toMatch(/\d{1,2}:\d{2}/);
    expect(root.findByProps({ testID: 'home-conditions-air-tile' })).toBeTruthy();
    expect(root.findByProps({ testID: 'home-conditions-air-tile-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'home-conditions-air-temperature' }).props.children).toBe('24.20 °C');
    expect(root.findByProps({ testID: 'home-conditions-water-tile' })).toBeTruthy();
    expect(root.findByProps({ testID: 'home-conditions-water-tile-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'home-conditions-water-temperature' }).props.children).toBe('22.80 °C');
  });

  it('omits provider badges and attribution copy from ready conditions', async () => {
    const { renderer } = await renderHome({
      status: 'ready',
      cityName: 'Jeju City',
      localTime: 1782444600,
      airTemperatureCelsius: 24.2,
      waterTemperatureCelsius: 22.8,
      isCoastal: true,
      source: 'openMeteo',
      updatedAt: 1782444300,
    });
    const providerLabels = renderer.root.findAll(node => {
      const children = node.props.children;
      return typeof children === 'string' && children.includes('Open-Meteo');
    });

    expect(providerLabels).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'home-conditions-updated' }).props.children).toBe('오후 12:25 업데이트');
  });

  it('shows a latest log empty state instead of unknown latest metrics', async () => {
    const { renderer } = await renderHome({
      status: 'ready',
      cityName: 'Jeju City',
      localTime: 1782444600,
      airTemperatureCelsius: 24.2,
      source: 'mock',
      updatedAt: 1782444300,
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'home-latest-empty-state' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'home-latest-date' })).toHaveLength(0);
  });

  it('shows a latest log skeleton while logbook data is loading', async () => {
    const { renderer } = await renderHome({
      status: 'ready',
      cityName: 'Jeju City',
      localTime: 1782444600,
      airTemperatureCelsius: 24.2,
      source: 'mock',
      updatedAt: 1782444300,
    }, { isLoading: true });

    expect(renderer.root.findByProps({ testID: 'home-latest-loading-state' })).toBeTruthy();
  });

  it('refreshes ready conditions with visible in-flight feedback', async () => {
    let resolveRefresh: (snapshot: HomeConditionsSnapshot) => void = () => undefined;
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn()
        .mockResolvedValueOnce({
          status: 'ready',
          cityName: 'Jeju City',
          localTime: 1782444600,
          airTemperatureCelsius: 24.2,
          source: 'mock',
          updatedAt: 1782444300,
        })
        .mockImplementationOnce(
          () =>
            new Promise<HomeConditionsSnapshot>(resolve => {
              resolveRefresh = resolve;
            }),
        ),
    };
    const locationService = createGrantedLocationService();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AppPreferencesProvider>
          <HomeScreen
            sessions={[]}
            conditionsProvider={provider}
            locationService={locationService}
            onOpenLogbook={jest.fn()}
            onOpenPlanning={jest.fn()}
            onRefresh={jest.fn()}
          />
        </AppPreferencesProvider>,
      );
      mountedRenderers.push(renderer);
      await flushPromises();
      await flushPromises();
    });

    await ReactTestRenderer.act(async () => {
      renderer!.root.findByProps({ testID: 'home-conditions-refresh-action' }).props.onPress();
      await flushPromises();
    });

    const refreshButton = renderer!.root.findByProps({ testID: 'home-conditions-refresh-action' });

    expect(refreshButton.props.accessibilityState).toEqual({ busy: true, disabled: true });
    expect(renderer!.root.findByProps({ testID: 'home-conditions-refresh-spinner' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'home-conditions-refreshing-skeleton' })).toBeTruthy();
    expect(renderer!.root.findAllByProps({ testID: 'home-conditions-air-temperature' })).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      resolveRefresh({
        status: 'ready',
        cityName: 'Busan',
        localTime: 1782448200,
        airTemperatureCelsius: 25.1,
        source: 'mock',
        updatedAt: 1782448200,
      });
      await flushPromises();
    });
  });

  it('hides water temperature metrics for non-coastal snapshots', async () => {
    const { renderer } = await renderHome({
      status: 'ready',
      cityName: 'Seoul',
      localTime: 1782444600,
      airTemperatureCelsius: 27,
      isCoastal: false,
      source: 'mock',
      updatedAt: 1782444300,
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'home-conditions-city' }).props.children).toBe('Seoul');
    expect(root.findByProps({ testID: 'home-conditions-air-temperature' }).props.children).toBe('27.00 °C');
    expect(root.findAllByProps({ testID: 'home-conditions-water-temperature' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'home-conditions-water-unavailable' })).toBeTruthy();
  });

  it('shows an unavailable state without blocking primary Home actions', async () => {
    const onOpenLogbook = jest.fn();
    const onOpenPlanning = jest.fn();
    const unavailableSnapshot: HomeConditionsSnapshot = {
      status: 'unavailable',
      source: 'mock',
    };
    const { renderer } = await renderHome(unavailableSnapshot, {
      onOpenLogbook,
      onOpenPlanning,
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'home-conditions-unavailable' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'home-reminder-alert' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'home-open-logbook-action-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'home-open-planning-action-icon' })).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'home-open-logbook-action' }).props.onPress();
      root.findByProps({ testID: 'home-open-planning-action' }).props.onPress();
    });

    expect(onOpenLogbook).toHaveBeenCalledTimes(1);
    expect(onOpenPlanning).toHaveBeenCalledTimes(1);
  });

  it('shows Korean permission denied copy with settings and retry actions', async () => {
    const openSettings = jest.fn(async () => undefined);
    const locationService: LocationService = {
      getCurrentLocation: jest.fn()
        .mockResolvedValueOnce({ status: 'permissionDenied' as const })
        .mockResolvedValueOnce(grantedLocation),
    };
    const { provider, renderer } = await renderHome({
      status: 'ready',
      cityName: 'Jeju City',
      localTime: 1782444600,
      airTemperatureCelsius: 24.2,
      source: 'openMeteo',
      updatedAt: 1782444300,
    }, {
      locationService,
      openSettings,
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'home-conditions-permission-denied' }).props.children).toBe('위치 권한이 필요합니다.');
    expect(root.findByProps({ testID: 'home-conditions-permission-denied-body' }).props.children).toContain('위치 권한');

    await ReactTestRenderer.act(async () => {
      await root.findByProps({ testID: 'home-conditions-open-settings-action' }).props.onPress();
    });

    expect(openSettings).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'home-conditions-retry-action' }).props.onPress();
      await flushPromises();
      await flushPromises();
    });

    expect(locationService.getCurrentLocation).toHaveBeenCalledTimes(2);
    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(1);
  });

  it('shows English permission denied copy', async () => {
    const locationService: LocationService = {
      getCurrentLocation: jest.fn(async () => ({ status: 'permissionDenied' as const })),
    };
    const preferencesStorage: AppPreferencesStorage = {
      load: jest.fn(async () => ({
        themePreference: 'system' as const,
        language: 'en' as const,
        watchSyncNotificationsEnabled: false,
      })),
      save: jest.fn(async () => undefined),
    };
    const { renderer } = await renderHome({
      status: 'ready',
      cityName: 'Jeju City',
      localTime: 1782444600,
      airTemperatureCelsius: 24.2,
      source: 'openMeteo',
      updatedAt: 1782444300,
    }, { locationService, preferencesStorage });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'home-conditions-permission-denied' }).props.children).toBe('Location permission needed');
    expect(root.findByProps({ testID: 'home-conditions-permission-denied-body' }).props.children).toContain('location permission');
  });
});
