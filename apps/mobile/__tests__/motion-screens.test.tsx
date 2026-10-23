import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { FadeInDown } from 'react-native-reanimated';
import { AppPreferencesProvider } from '../src/states/app-preferences';
import { SyncConflictBanner } from '../src/components/ui/sync-conflict-banner';
import { MOTION_TIMING } from '../src/constants/motion';
import i18n from '../src/i18n';
import { hasHomeIntroPlayed } from '../src/screens/home/home-intro';
import HomeScreen from '../src/screens/home/screen';
import LogbookScreen from '../src/screens/logbook/screen';
import PlanningScreen from '../src/screens/planning/screen';
import type { HomeConditionsSnapshot } from '../src/conditions/home-conditions';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { DivePlan } from '../src/types/dive-plan';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import { createBlankDivePlan } from '../src/utils/create-dive-plan';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const renderers: Renderer[] = [];
const NOW_SECONDS = Math.floor(Date.now() / 1000);

/** Host nodes that carry an entering animation, as mounted. */
function enteringHosts(renderer: Renderer): ReactTestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(node => typeof node.type === 'string' && node.props.entering !== undefined);
}

function track(renderer: Renderer): Renderer {
  renderers.push(renderer);
  return renderer;
}

const readySnapshot: HomeConditionsSnapshot = {
  status: 'ready',
  cityName: 'Jeju City',
  localTime: NOW_SECONDS,
  airTemperatureCelsius: 24.2,
  source: 'mock',
  updatedAt: NOW_SECONDS,
};

const grantedLocation = {
  status: 'granted' as const,
  coordinates: { latitude: 33.5, longitude: 126.5, horizontalAccuracyMeters: 50, capturedAt: NOW_SECONDS },
};

function homeElement(overrides: Partial<React.ComponentProps<typeof HomeScreen>> = {}): React.JSX.Element {
  return (
    <AppPreferencesProvider>
      <HomeScreen
        sessions={[]}
        conditionsProvider={{ getCurrentConditions: jest.fn(async () => readySnapshot) }}
        locationService={{ getCurrentLocation: jest.fn(async () => grantedLocation) }}
        onCreateLog={jest.fn()}
        onCreatePlan={jest.fn()}
        onRefresh={jest.fn()}
        {...overrides}
      />
    </AppPreferencesProvider>
  );
}

async function renderIn(element: React.JSX.Element): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return track(renderer!);
}

function plannedDive(): DivePlan {
  return { ...createBlankDivePlan(), localId: 'next-plan', status: 'planned', title: 'Next Reef', plannedAt: NOW_SECONDS + 3600 };
}

function logEntry(localId: string): DiveLogEntry {
  return createBlankDiveLogEntry({ now: NOW_SECONDS, localId });
}

function logbookElement(overrides: Partial<React.ComponentProps<typeof LogbookScreen>> = {}): React.JSX.Element {
  return (
    <LogbookScreen
      entries={[]}
      filter={{ query: '' }}
      onFilterChange={jest.fn()}
      onSyncWatch={jest.fn(async () => ({ receivedCount: 0, importedCount: 0, failedCount: 0, unavailable: false }))}
      onRefresh={jest.fn()}
      onOpenEntry={jest.fn()}
      onCreateEntry={jest.fn()}
      {...overrides}
    />
  );
}

describe('motion on screens', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ko');
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount();
      }
    });
    jest.restoreAllMocks();
  });

  // The Home intro is module state, so the first Home mount in this file must be the first test here.
  test('the first Home mount rises its blocks, one stagger apart, and the intro is then spent', async () => {
    const withInitialValues = jest.spyOn(FadeInDown, 'withInitialValues');
    expect(hasHomeIntroPlayed()).toBe(false);

    await renderIn(homeElement({ plans: [plannedDive()] }));

    // Title, latest card, next dive, quick actions and weather are built on the first render only.
    expect(withInitialValues).toHaveBeenCalledTimes(5);
    expect(hasHomeIntroPlayed()).toBe(true);
  });

  test('a later Home mount in the same run does not replay the intro', async () => {
    const withInitialValues = jest.spyOn(FadeInDown, 'withInitialValues');

    await renderIn(homeElement());

    expect(withInitialValues).not.toHaveBeenCalled();
    expect(enteringHosts(renderers[renderers.length - 1]!)).toHaveLength(0);
  });

  test('a next dive row that appears after the first render fades in without the rise', async () => {
    const renderer = await renderIn(homeElement());
    const withInitialValues = jest.spyOn(FadeInDown, 'withInitialValues');

    await ReactTestRenderer.act(async () => {
      renderer.update(homeElement({ plans: [plannedDive()] }));
    });

    expect(withInitialValues).not.toHaveBeenCalled();
    expect(enteringHosts(renderer)).toHaveLength(1);
  });

  test('a first logbook load fades its rows in, and a later arrival fades only the new row', async () => {
    jest.useFakeTimers();
    const renderer = await renderIn(logbookElement({ isLoading: true, entries: [] }));
    await ReactTestRenderer.act(async () => {
      renderer.update(logbookElement({ entries: [logEntry('a'), logEntry('b')] }));
    });
    expect(enteringHosts(renderer)).toHaveLength(2);

    // Once the first-load fade is over, rows that were already shown take no animation.
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(MOTION_TIMING.fade);
    });
    await ReactTestRenderer.act(async () => {
      renderer.update(logbookElement({ entries: [logEntry('a'), logEntry('b')] }));
    });
    expect(enteringHosts(renderer)).toHaveLength(0);

    // A new row arriving at the top fades in alone, for the appear time.
    await ReactTestRenderer.act(async () => {
      renderer.update(logbookElement({ entries: [logEntry('c'), logEntry('a'), logEntry('b')] }));
    });
    expect(enteringHosts(renderer)).toHaveLength(1);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(MOTION_TIMING.appear);
    });
    expect(enteringHosts(renderer)).toHaveLength(0);
    jest.useRealTimers();
  });

  test('the first logbook render and paging add no animation', async () => {
    const entries = Array.from({ length: 25 }, (_, index) => logEntry(`entry-${index}`));
    const renderer = await renderIn(logbookElement({ entries }));
    expect(enteringHosts(renderer)).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      const list = renderer.root.findAll(node => node.props.testID === 'logbook-list' && node.props.onEndReached)[0];
      list!.props.onEndReached();
    });

    expect(enteringHosts(renderer)).toHaveLength(0);
  });

  test('a first planning load fades its content in, and a refetch with plans on screen does not', async () => {
    const renderer = await renderIn(
      <PlanningScreen
        plans={[]}
        isLoading
        onRefresh={jest.fn()}
        onCreatePlan={jest.fn()}
        onOpenPlan={jest.fn()}
        onOpenLogbook={jest.fn()}
      />,
    );
    await ReactTestRenderer.act(async () => {
      renderer.update(
        <PlanningScreen
          plans={[]}
          isLoading={false}
          onRefresh={jest.fn()}
          onCreatePlan={jest.fn()}
          onOpenPlan={jest.fn()}
          onOpenLogbook={jest.fn()}
        />,
      );
    });
    expect(enteringHosts(renderer)).toHaveLength(1);

    const shown = await renderIn(
      <PlanningScreen
        plans={[plannedDive()]}
        onRefresh={jest.fn()}
        onCreatePlan={jest.fn()}
        onOpenPlan={jest.fn()}
        onOpenLogbook={jest.fn()}
      />,
    );
    await ReactTestRenderer.act(async () => {
      shown.update(
        <PlanningScreen
          plans={[plannedDive()]}
          isLoading
          onRefresh={jest.fn()}
          onCreatePlan={jest.fn()}
          onOpenPlan={jest.fn()}
          onOpenLogbook={jest.fn()}
        />,
      );
    });
    expect(enteringHosts(shown)).toHaveLength(0);
  });

  test('the sync conflict banner fades in wherever it is shown', async () => {
    const renderer = await renderIn(<SyncConflictBanner onResolve={jest.fn().mockResolvedValue(undefined)} />);

    expect(enteringHosts(renderer)).toHaveLength(1);
    expect(renderer.root.findByProps({ testID: 'sync-conflict-title' })).toBeTruthy();
  });
});
