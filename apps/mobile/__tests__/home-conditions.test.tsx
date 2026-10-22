import React from 'react';
import { AppState, RefreshControl, ScrollView } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import i18n from '../src/i18n';
import HomeScreen from '../src/screens/home/screen';
import { formatDateTimeParts } from '../src/screens/common/form/date-time-field';
import { diveLogEntryToMobileSession } from '../src/states/use-dive-logbook';
import { watchSessionToDiveLogEntry } from '../src/utils/watch-session-to-dive-log-entry';
import { AppPreferencesProvider } from '../src/states/app-preferences';
import type { AppPreferencesStorage } from '../src/states/app-preferences-storage';
import type { HomeConditionsProvider, HomeConditionsSnapshot } from '../src/conditions/home-conditions';
import type { DivePlan } from '../src/types/dive-plan';
import type { LocationService } from '../src/conditions/location-service';
import { resetHomeConditionsCacheForTests } from '../src/conditions/use-home-conditions';

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));
/** Lets queued promise callbacks run without relying on timers (safe under fake timers). */
const flushMicrotasks = async () => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
};
const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];
const initialAppStateCurrentStateDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState');

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

const createPlan = (overrides: Partial<DivePlan> & Pick<DivePlan, 'localId' | 'status'>): DivePlan => ({
  createdAt: 1782440000,
  updatedAt: 1782440000,
  site: {},
  buddyIds: [],
  gearIds: [],
  tags: [],
  plannedValues: {},
  checklistItems: [],
  ...overrides,
});

const readyJejuSnapshot: HomeConditionsSnapshot = {
  status: 'ready',
  cityName: 'Jeju City',
  localTime: 1782444600,
  airTemperatureCelsius: 24.2,
  source: 'mock',
  updatedAt: 1782444300,
};

const renderHome = async (
  snapshot: HomeConditionsSnapshot,
  options: {
    locationService?: LocationService;
    onCreateLog?: jest.Mock;
    onCreatePlan?: jest.Mock;
    onRefresh?: jest.Mock;
    openSettings?: () => Promise<void>;
    preferencesStorage?: AppPreferencesStorage;
    sessions?: React.ComponentProps<typeof HomeScreen>['sessions'];
    latestEntry?: React.ComponentProps<typeof HomeScreen>['latestEntry'];
    onOpenLog?: jest.Mock;
    plans?: React.ComponentProps<typeof HomeScreen>['plans'];
    onOpenPlan?: jest.Mock;
    isLoading?: boolean;
    isRefreshing?: boolean;
    loadError?: unknown;
    recovery?: React.ComponentProps<typeof HomeScreen>['recovery'];
    /** Overrides the provider built from `snapshot`, e.g. to control a later refresh. */
    provider?: HomeConditionsProvider;
  } = {},
) => {
  const provider: HomeConditionsProvider = options.provider ?? {
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
          isRefreshing={options.isRefreshing}
          loadError={options.loadError}
          conditionsProvider={provider}
          locationService={locationService}
          openSettings={options.openSettings}
          onCreateLog={options.onCreateLog ?? jest.fn()}
          onCreatePlan={options.onCreatePlan ?? jest.fn()}
          latestEntry={options.latestEntry}
          onOpenLog={options.onOpenLog}
          plans={options.plans}
          onOpenPlan={options.onOpenPlan}
          onRefresh={options.onRefresh ?? jest.fn()}
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
    jest.useRealTimers();
    ReactTestRenderer.act(() => {
      for (const renderer of mountedRenderers.splice(0)) {
        renderer.unmount();
      }
    });

    if (initialAppStateCurrentStateDescriptor) {
      Object.defineProperty(AppState, 'currentState', initialAppStateCurrentStateDescriptor);
    }
  });

  beforeEach(async () => {
    resetHomeConditionsCacheForTests();
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });

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
          title: '일부 기록을 불러오지 못했습니다',
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
    // Information icons and tiles are neutral; blue is kept for actions.
    const classNameOf = (testID: string) =>
      root.findAll(node => node.props.testID === testID && typeof node.props.className === 'string')[0]?.props.className;
    expect(classNameOf('home-conditions-location-icon')).toEqual(expect.stringContaining('bg-muted'));
    expect(classNameOf('home-conditions-location-icon')).not.toContain('bg-primary');
    expect(classNameOf('home-conditions-water-tile')).toEqual(expect.stringContaining('bg-muted'));
    expect(classNameOf('home-conditions-water-tile')).not.toContain('bg-primary');
    expect(root.findByProps({ testID: 'home-conditions-local-time' }).props.children).toMatch(/\d{1,2}:\d{2}/);
    expect(root.findByProps({ testID: 'home-conditions-air-tile' })).toBeTruthy();
    expect(root.findByProps({ testID: 'home-conditions-air-tile-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'home-conditions-air-temperature' }).props.children).toBe('24.2 °C');
    expect(root.findByProps({ testID: 'home-conditions-water-tile' })).toBeTruthy();
    expect(root.findByProps({ testID: 'home-conditions-water-tile-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'home-conditions-water-temperature' }).props.children).toBe('22.8 °C');
  });

  it('credits Open-Meteo in small print next to the updated time', async () => {
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
      return typeof node.type === 'string' && typeof children === 'string' && children.includes('Open-Meteo');
    });

    expect(providerLabels).toHaveLength(1);
    expect(renderer.root.findByProps({ testID: 'home-conditions-attribution' }).props.children).toBe('Open-Meteo 데이터');
    expect(renderer.root.findByProps({ testID: 'home-conditions-updated' }).props.children).toBe('오후 12:25 업데이트');
  });

  it('does not credit Open-Meteo for conditions from another source', async () => {
    const { renderer } = await renderHome({
      status: 'ready',
      cityName: 'Jeju City',
      localTime: 1782444600,
      airTemperatureCelsius: 24.2,
      source: 'mock',
      updatedAt: 1782444300,
    });

    expect(renderer.root.findAllByProps({ testID: 'home-conditions-attribution' })).toHaveLength(0);
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

  it('puts the latest dive first, marks demo and unsupported depth, and opens its detail', async () => {
    const session = {
      localSessionId: 'demo-deep-1',
      captureMode: 'demo' as const,
      siteName: 'Blue Hole',
      startedAt: 1782440000,
      endedAt: 1782442000,
      maxDepthMeters: 42.5,
      samples: [
        { localSessionId: 'demo-deep-1', timestamp: 1782440000, depthMeters: 0 },
        { localSessionId: 'demo-deep-1', timestamp: 1782441000, depthMeters: 42.5 },
      ],
    };
    const latestEntry = watchSessionToDiveLogEntry({ session, now: 1782443000, localId: 'log-1' });
    const onOpenLog = jest.fn();
    const { renderer } = await renderHome({
      status: 'ready',
      cityName: 'Jeju City',
      localTime: 1782444600,
      airTemperatureCelsius: 24.2,
      source: 'mock',
      updatedAt: 1782444300,
    }, {
      sessions: [diveLogEntryToMobileSession(latestEntry)],
      latestEntry,
      onOpenLog,
    });
    const root = renderer.root;
    const testIds = root
      .findAll(node => typeof node.props.testID === 'string' && typeof node.type === 'string')
      .map(node => node.props.testID as string);

    expect(testIds.indexOf('home-latest-log-card')).toBeGreaterThanOrEqual(0);
    expect(testIds.indexOf('home-latest-log-card')).toBeLessThan(
      testIds.findIndex(id => id.startsWith('home-conditions')),
    );
    expect(root.findAllByProps({ testID: 'home-latest-demo-badge' }).length).toBeGreaterThan(0);
    expect(root.findAllByProps({ testID: 'home-latest-unsupported-depth' }).length).toBeGreaterThan(0);
    // The badge is hidden from VoiceOver on its own, so the card's label carries the Demo marker,
    // in the log list row's order.
    const card = root.findByProps({ testID: 'home-latest-log-card' });
    const labelParts = (card.props.accessibilityLabel as string).split(', ');
    expect(labelParts[0]).toBe('Blue Hole');
    expect(labelParts[1]).toBe(root.findByProps({ testID: 'home-latest-date' }).props.children);
    expect(labelParts.slice(2)).toEqual(['데모', '지원 수심 밖', '최대 수심 42.5 m', '다이빙 시간 33분']);

    await ReactTestRenderer.act(async () => {
      card.props.onPress();
    });

    expect(onOpenLog).toHaveBeenCalledWith(latestEntry);
  });

  it('titles a session without its entry by the logbook rule and still reads its Test marker', async () => {
    const watchEntry = watchSessionToDiveLogEntry({
      session: {
        localSessionId: 'session-only-1',
        captureMode: 'demo',
        startedAt: 1782440000,
        endedAt: 1782442832,
        maxDepthMeters: 18.4,
        tags: ['debug-test-capture'],
        samples: [],
      },
      now: 1782443000,
      localId: 'session-only-log-1',
    });
    const { renderer } = await renderHome(readyJejuSnapshot, {
      sessions: [diveLogEntryToMobileSession(watchEntry)],
    });
    const root = renderer.root;
    const title = root.findByProps({ testID: 'home-latest-title' }).props.children as string;

    // The stored import default site stays as it is; only the shown title is localized.
    expect(watchEntry.manual.site.name).toBe('워치 다이브');
    expect(title.startsWith('워치 기록 · ')).toBe(true);
    expect(root.findByProps({ testID: 'home-latest-dive-time' }).props.children).toBe('47분');
    expect(root.findByProps({ testID: 'home-latest-max-depth' }).props.children).toBe('18.4 m');
    const summary = root.findByProps({ testID: 'home-latest-log-summary' });
    expect(summary.props.accessible).toBe(true);
    expect(summary.props.accessibilityLabel).toContain(`${title}, `);
    expect(summary.props.accessibilityLabel).toContain(', 테스트, ');
  });

  it('titles a watch log with the import default site like the logbook, in the current language', async () => {
    const latestEntry = watchSessionToDiveLogEntry({
      session: { localSessionId: 'default-site-1', startedAt: 1782440000, endedAt: 1782442000, samples: [] },
      now: 1782443000,
      localId: 'default-site-log-1',
    });
    const preferencesStorage: AppPreferencesStorage = {
      load: jest.fn(async () => ({
        themePreference: 'system' as const,
        language: 'en' as const,
        watchSyncNotificationsEnabled: false,
      })),
      save: jest.fn(async () => undefined),
    };
    const { renderer } = await renderHome(readyJejuSnapshot, {
      sessions: [diveLogEntryToMobileSession(latestEntry)],
      latestEntry,
      onOpenLog: jest.fn(),
      preferencesStorage,
    });
    const title = renderer.root.findByProps({ testID: 'home-latest-title' }).props.children as string;

    expect(title.startsWith('Watch log · ')).toBe(true);
    expect(title).not.toContain('워치 다이브');
  });

  it('shows the depth, dive time and start the diver corrected by hand, not the watch values', async () => {
    const watchEntry = watchSessionToDiveLogEntry({
      session: {
        localSessionId: 'corrected-1',
        siteName: 'Munseom',
        startedAt: 1782440000,
        endedAt: 1782442832,
        maxDepthMeters: 18.4,
        samples: [],
      },
      now: 1782443000,
      localId: 'corrected-log-1',
    });
    const correctedStartedAt = 1782436400;
    const latestEntry = {
      ...watchEntry,
      manual: {
        ...watchEntry.manual,
        measuredValues: {
          ...watchEntry.manual.measuredValues,
          startedAt: correctedStartedAt,
          maxDepthMeters: 12,
          durationSeconds: 2400,
        },
      },
      provenance: {
        ...watchEntry.provenance,
        startedAt: 'manual' as const,
        maxDepthMeters: 'manual' as const,
        durationSeconds: 'manual' as const,
      },
    };
    const { renderer } = await renderHome(readyJejuSnapshot, {
      sessions: [diveLogEntryToMobileSession(latestEntry)],
      latestEntry,
      onOpenLog: jest.fn(),
    });
    const root = renderer.root;
    const expectedDate = new Intl.DateTimeFormat('ko', {
      ...(new Date(correctedStartedAt * 1000).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const }),
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(correctedStartedAt * 1000));

    expect(root.findByProps({ testID: 'home-latest-max-depth' }).props.children).toBe('12.0 m');
    expect(root.findByProps({ testID: 'home-latest-dive-time' }).props.children).toBe('40분');
    expect(root.findByProps({ testID: 'home-latest-date' }).props.children).toBe(expectedDate);
  });

  it('formats watch values like the log list row and reads the Test marker from the watch capture', async () => {
    const watchEntry = watchSessionToDiveLogEntry({
      session: {
        localSessionId: 'test-capture-1',
        captureMode: 'demo',
        siteName: 'Test Reef',
        startedAt: 1782440000,
        endedAt: 1782442832,
        maxDepthMeters: 18.4,
        tags: ['debug-test-capture'],
        samples: [],
      },
      now: 1782443000,
      localId: 'test-capture-log-1',
    });
    // The editor can drop the tag from the editable tags; the watch capture still marks a Test log.
    const latestEntry = { ...watchEntry, manual: { ...watchEntry.manual, tags: [] } };
    const { renderer } = await renderHome(readyJejuSnapshot, {
      sessions: [diveLogEntryToMobileSession(latestEntry)],
      latestEntry,
      onOpenLog: jest.fn(),
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'home-latest-max-depth' }).props.children).toBe('18.4 m');
    // Whole minutes, like the log list row; the detail keeps the seconds.
    expect(root.findByProps({ testID: 'home-latest-dive-time' }).props.children).toBe('47분');
    expect(root.findByProps({ testID: 'home-latest-demo-badge' }).props.label).toBe('테스트');
    expect(root.findByProps({ testID: 'home-latest-log-card' }).props.accessibilityLabel).toContain(', 테스트, ');
  });

  it('shows a delayed latest log skeleton and no fake 0 count while logbook data is loading', async () => {
    jest.useFakeTimers();
    const provider: HomeConditionsProvider = { getCurrentConditions: jest.fn(async () => readyJejuSnapshot) };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AppPreferencesProvider>
          <HomeScreen
            sessions={[]}
            isLoading
            conditionsProvider={provider}
            locationService={createGrantedLocationService()}
            onCreateLog={jest.fn()}
            onCreatePlan={jest.fn()}
            onRefresh={jest.fn()}
          />
        </AppPreferencesProvider>,
      );
      mountedRenderers.push(renderer);
      await flushMicrotasks();
    });
    const root = renderer!.root;
    const loadingState = root.findByProps({ testID: 'home-latest-loading-state' });
    const countSlot = () => root.findByProps({ testID: 'home-log-count-loading' });

    expect(loadingState.props.accessibilityState).toEqual({ busy: true });
    expect(root.findAllByProps({ testID: 'home-latest-empty-state' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'home-log-count' })).toHaveLength(0);
    expect(root.findAll(node => typeof node.props.children === 'string' && node.props.children.includes('0개'))).toHaveLength(0);
    // The slots are reserved at their final size but stay invisible for the first second.
    const skeletonSlotsVisible = () =>
      loadingState.findAll(node => typeof node.props.visible === 'boolean').map(node => node.props.visible as boolean);
    expect(countSlot().props.visible).toBe(false);
    expect(skeletonSlotsVisible().length).toBeGreaterThan(0);
    expect(skeletonSlotsVisible().every(visible => !visible)).toBe(true);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(countSlot().props.visible).toBe(false);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(countSlot().props.visible).toBe(true);
    expect(skeletonSlotsVisible().every(visible => visible)).toBe(true);
  });

  it('shows an error card with retry instead of the empty state when the first logbook read fails', async () => {
    const onRefresh = jest.fn();
    const { renderer } = await renderHome(readyJejuSnapshot, {
      loadError: new Error('read failed'),
      onRefresh,
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'home-latest-error-state' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'home-latest-empty-state' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'home-log-count' })).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'home-latest-retry-action' }).props.onPress();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest log with a short note when a logbook refetch fails', async () => {
    const latestEntry = watchSessionToDiveLogEntry({
      session: { localSessionId: 'kept-1', siteName: 'Kept Reef', startedAt: 1782440000, endedAt: 1782442000, samples: [] },
      now: 1782443000,
      localId: 'kept-log-1',
    });
    const { renderer } = await renderHome(readyJejuSnapshot, {
      sessions: [diveLogEntryToMobileSession(latestEntry)],
      latestEntry,
      onOpenLog: jest.fn(),
      loadError: new Error('refetch failed'),
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'home-latest-log-card' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'home-latest-error-state' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'home-latest-refresh-failed' }).props.children).toBe(
      '새로 불러오지 못했습니다. 마지막으로 확인한 내용을 표시합니다.',
    );
    expect(root.findByProps({ testID: 'home-log-count' }).props.children).toBe('기록 1개');
  });

  it('offers to write a log from the empty state without repeating it in the quick actions', async () => {
    const onCreateLog = jest.fn();
    const { renderer } = await renderHome(readyJejuSnapshot, { onCreateLog });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'home-log-count' }).props.children).toBe('기록 0개');
    expect(root.findAllByProps({ testID: 'home-quick-create-log' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'home-quick-create-plan' })).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'home-latest-empty-create-action' }).props.onPress();
    });

    expect(onCreateLog).toHaveBeenCalledTimes(1);
  });

  it('shows the nearest upcoming planned dive and opens its detail', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const nearPlan = createPlan({ localId: 'near', status: 'planned', title: 'Near Reef', site: { name: 'Seogwipo' }, plannedAt: nowSeconds + 3600 });
    const plans = [
      createPlan({ localId: 'draft', status: 'draft', title: 'Draft Reef', plannedAt: nowSeconds + 1800 }),
      createPlan({ localId: 'past', status: 'planned', title: 'Past Reef', plannedAt: nowSeconds - 3600 }),
      createPlan({ localId: 'far', status: 'planned', title: 'Far Reef', plannedAt: nowSeconds + 86400 * 3 }),
      nearPlan,
      createPlan({ localId: 'done', status: 'completed', title: 'Done Reef', plannedAt: nowSeconds + 600 }),
    ];
    const onOpenPlan = jest.fn();
    const { renderer } = await renderHome(readyJejuSnapshot, { plans, onOpenPlan });
    const row = renderer.root.findByProps({ testID: 'home-next-plan-row' });

    expect(row.findAll(node => node.props.children === 'Near Reef').length).toBeGreaterThan(0);
    // The same date line as the plan list row.
    const parts = formatDateTimeParts(new Date(nearPlan.plannedAt! * 1000), 'ko');
    expect(row.findAll(node => node.props.children === `${parts.date} ${parts.time} · Seogwipo`).length).toBeGreaterThan(0);

    await ReactTestRenderer.act(async () => {
      row.props.onPress();
    });

    expect(onOpenPlan).toHaveBeenCalledWith(nearPlan);
  });

  it('hides the next plan row when no planned dive is upcoming', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const { renderer } = await renderHome(readyJejuSnapshot, {
      plans: [
        createPlan({ localId: 'draft', status: 'draft', title: 'Draft Reef', plannedAt: nowSeconds + 1800 }),
        createPlan({ localId: 'past', status: 'planned', title: 'Past Reef', plannedAt: nowSeconds - 3600 }),
      ],
    });

    expect(renderer.root.findAllByProps({ testID: 'home-next-plan-row' })).toHaveLength(0);
  });

  it('drops a next plan whose time has passed on the next render, even with the same plans array', async () => {
    const realNow = Date.now.bind(Date);
    let clockOffsetMs = 0;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffsetMs);
    const plans = [createPlan({ localId: 'soon', status: 'planned', title: 'Soon Reef', plannedAt: Math.floor(realNow() / 1000) + 60 })];
    const provider: HomeConditionsProvider = { getCurrentConditions: jest.fn(async () => readyJejuSnapshot) };
    const locationService = createGrantedLocationService();
    // A parent re-render passes the same plans array, as after a refetch that returned the same data.
    const renderElement = () => (
      <AppPreferencesProvider>
        <HomeScreen
          sessions={[]}
          plans={plans}
          conditionsProvider={provider}
          locationService={locationService}
          onCreateLog={jest.fn()}
          onCreatePlan={jest.fn()}
          onRefresh={jest.fn()}
        />
      </AppPreferencesProvider>
    );
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    try {
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(renderElement());
        mountedRenderers.push(renderer);
        await flushPromises();
        await flushPromises();
      });
      expect(renderer!.root.findAllByProps({ testID: 'home-next-plan-row' }).length).toBeGreaterThan(0);

      clockOffsetMs = 120_000;
      await ReactTestRenderer.act(async () => {
        renderer!.update(renderElement());
      });

      expect(renderer!.root.findAllByProps({ testID: 'home-next-plan-row' })).toHaveLength(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('adds a short line at 4 s and a working retry at 10 s while the first conditions load runs', async () => {
    jest.useFakeTimers();
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn(() => new Promise<HomeConditionsSnapshot>(() => undefined)),
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AppPreferencesProvider>
          <HomeScreen
            sessions={[]}
            conditionsProvider={provider}
            locationService={createGrantedLocationService()}
            onCreateLog={jest.fn()}
            onCreatePlan={jest.fn()}
            onRefresh={jest.fn()}
          />
        </AppPreferencesProvider>,
      );
      mountedRenderers.push(renderer);
      await flushMicrotasks();
    });
    const root = renderer!.root;
    const message = () => root.findAllByProps({ testID: 'home-conditions-loading-message' });
    const retryAction = () => root.findAllByProps({ testID: 'home-conditions-loading-retry-action' });

    expect(root.findByProps({ testID: 'home-conditions-loading' }).props.accessibilityState).toEqual({ busy: true });
    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(3999);
    });
    expect(message()).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(message()[0].props.children).toBe('주변 날씨를 불러오는 중');
    expect(retryAction()).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(5999);
    });
    expect(retryAction()).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(root.findByProps({ testID: 'home-conditions-long-running' }).props.children).toBe(
      '주변 날씨를 불러오는 데 시간이 오래 걸리고 있습니다.',
    );
    expect(retryAction()[0].props.pending).toBe(false);

    // The retry starts a fresh request instead of waiting on the stuck one, and stays busy meanwhile.
    await ReactTestRenderer.act(async () => {
      retryAction()[0].props.onPress();
      await flushMicrotasks();
    });
    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(2);
    expect(retryAction()[0].props.pending).toBe(true);
  });

  it('keeps ready values while refreshing and shows the button spinner only after 1 s', async () => {
    let resolveRefresh: (snapshot: HomeConditionsSnapshot) => void = () => undefined;
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn()
        .mockResolvedValueOnce(readyJejuSnapshot)
        .mockImplementationOnce(
          () =>
            new Promise<HomeConditionsSnapshot>(resolve => {
              resolveRefresh = resolve;
            }),
        ),
    };
    const { renderer } = await renderHome(readyJejuSnapshot, { provider });
    const root = renderer.root;
    const refreshButton = () => root.findByProps({ testID: 'home-conditions-refresh-action' });

    jest.useFakeTimers();
    await ReactTestRenderer.act(async () => {
      refreshButton().props.onPress();
      await flushMicrotasks();
    });

    // Busy and disabled at once, values unchanged, no spinner yet.
    expect(refreshButton().props.accessibilityState).toEqual({ busy: true, disabled: true });
    expect(root.findAllByProps({ testID: 'home-conditions-refresh-spinner' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'home-conditions-air-temperature' }).props.children).toBe('24.2 °C');
    expect(root.findByProps({ testID: 'home-conditions-city' }).props.children).toBe('Jeju City');

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(root.findAllByProps({ testID: 'home-conditions-refresh-spinner' })).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(root.findAllByProps({ testID: 'home-conditions-refresh-spinner' }).length).toBeGreaterThan(0);
    expect(root.findByProps({ testID: 'home-conditions-air-temperature' }).props.children).toBe('24.2 °C');

    await ReactTestRenderer.act(async () => {
      resolveRefresh({ ...readyJejuSnapshot, cityName: 'Busan', airTemperatureCelsius: 25.1, updatedAt: 1782448200 });
      await flushMicrotasks();
    });

    expect(root.findByProps({ testID: 'home-conditions-city' }).props.children).toBe('Busan');
    expect(root.findByProps({ testID: 'home-conditions-air-temperature' }).props.children).toBe('25.1 °C');
    expect(root.findAllByProps({ testID: 'home-conditions-refresh-spinner' })).toHaveLength(0);
    expect(refreshButton().props.accessibilityState).toEqual({ busy: false, disabled: false });
  });

  it('keeps the last conditions with a short note when a refresh fails', async () => {
    const provider: HomeConditionsProvider = {
      getCurrentConditions: jest.fn()
        .mockResolvedValueOnce(readyJejuSnapshot)
        .mockResolvedValueOnce({ status: 'error', source: 'openMeteo' }),
    };
    const { renderer } = await renderHome(readyJejuSnapshot, { provider });
    const root = renderer.root;

    expect(root.findAllByProps({ testID: 'home-conditions-refresh-failed' })).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'home-conditions-refresh-action' }).props.onPress();
      await flushPromises();
      await flushPromises();
    });

    expect(root.findAllByProps({ testID: 'home-conditions-unavailable' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'home-conditions-air-temperature' }).props.children).toBe('24.2 °C');
    expect(root.findByProps({ testID: 'home-conditions-refresh-failed' }).props.children).toBe(
      '새로 불러오지 못했습니다. 마지막으로 확인한 내용을 표시합니다.',
    );
  });

  it('refreshes the logbook and the conditions together on pull-to-refresh', async () => {
    let resolveLogbookRefresh: () => void = () => undefined;
    const onRefresh = jest.fn(
      () =>
        new Promise<void>(resolve => {
          resolveLogbookRefresh = resolve;
        }),
    );
    const { provider, renderer } = await renderHome(readyJejuSnapshot, { onRefresh });
    const refreshControl = () => renderer.root.findByType(ScrollView).props.refreshControl;

    expect(refreshControl().type).toBe(RefreshControl);
    expect(refreshControl().props.refreshing).toBe(false);

    await ReactTestRenderer.act(async () => {
      void refreshControl().props.onRefresh();
      await flushPromises();
      await flushPromises();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(provider.getCurrentConditions).toHaveBeenCalledTimes(2);
    // The pull indicator stays until the slower of the two finishes.
    expect(refreshControl().props.refreshing).toBe(true);

    await ReactTestRenderer.act(async () => {
      resolveLogbookRefresh();
      await flushPromises();
    });

    expect(refreshControl().props.refreshing).toBe(false);
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
    expect(root.findByProps({ testID: 'home-conditions-air-temperature' }).props.children).toBe('27.0 °C');
    expect(root.findAllByProps({ testID: 'home-conditions-water-temperature' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'home-conditions-water-unavailable' })).toBeTruthy();
  });

  it('shows an unavailable state without blocking the quick actions that replace the tab buttons', async () => {
    const onCreateLog = jest.fn();
    const onCreatePlan = jest.fn();
    const unavailableSnapshot: HomeConditionsSnapshot = {
      status: 'unavailable',
      source: 'mock',
    };
    const latestEntry = watchSessionToDiveLogEntry({
      session: { localSessionId: 'quick-1', siteName: 'Quick Reef', startedAt: 1782440000, endedAt: 1782442000, samples: [] },
      now: 1782443000,
      localId: 'quick-log-1',
    });
    const { renderer } = await renderHome(unavailableSnapshot, {
      sessions: [diveLogEntryToMobileSession(latestEntry)],
      latestEntry,
      onCreateLog,
      onCreatePlan,
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'home-conditions-unavailable' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'home-reminder-alert' })).toHaveLength(0);
    // The two large buttons that repeated the tab bar are gone.
    expect(root.findAllByProps({ testID: 'home-open-logbook-action' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'home-open-planning-action' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'home-quick-create-log-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'home-quick-create-plan-icon' })).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'home-quick-create-log' }).props.onPress();
      root.findByProps({ testID: 'home-quick-create-plan' }).props.onPress();
    });

    expect(onCreateLog).toHaveBeenCalledTimes(1);
    expect(onCreatePlan).toHaveBeenCalledTimes(1);
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

    expect(root.findByProps({ testID: 'home-conditions-permission-denied' }).props.children).toBe('주변 날씨를 보려면 위치를 허용해 주세요.');
    expect(root.findByProps({ testID: 'home-conditions-permission-denied-body' }).props.children).toBe('설정에서 Divenary의 위치 접근을 켤 수 있습니다.');

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

    expect(root.findByProps({ testID: 'home-conditions-permission-denied' }).props.children).toBe('Allow location to see local weather.');
    expect(root.findByProps({ testID: 'home-conditions-permission-denied-body' }).props.children).toBe('You can turn on location access for Divenary in Settings.');
  });
});
