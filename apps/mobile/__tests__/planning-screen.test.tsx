import React from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ButtonIcon } from '../src/components/ui/button';
import { AddIcon } from '../src/components/ui/icon';
import i18n from '../src/i18n';
import PlanningScreen from '../src/screens/planning/screen';
import type { DivePlan } from '../src/types/dive-plan';

type Renderer = ReactTestRenderer.ReactTestRenderer;

// 2026-06-13 12:00 local time.
const NOW = new Date(2026, 5, 13, 12, 0).getTime();
const at = (month: number, day: number, hour = 9) => new Date(2026, month - 1, day, hour, 0).getTime() / 1000;

const plan = (overrides: Partial<DivePlan>): DivePlan => ({
  localId: 'plan-base',
  status: 'draft',
  createdAt: 100,
  updatedAt: 100,
  site: {},
  buddyIds: [],
  gearIds: [],
  tags: [],
  plannedValues: {},
  checklistItems: [],
  ...overrides,
});

const renderers: Renderer[] = [];

type ScreenProps = Partial<React.ComponentProps<typeof PlanningScreen>>;

const screenProps = (props: ScreenProps = {}): React.ComponentProps<typeof PlanningScreen> => ({
  plans: [],
  onRefresh: jest.fn(),
  onCreatePlan: jest.fn(),
  onOpenPlan: jest.fn(),
  onOpenLogbook: jest.fn(),
  ...props,
});

async function render(props: ScreenProps = {}): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<PlanningScreen {...screenProps(props)} />);
  });
  renderers.push(renderer!);
  return renderer!;
}

/** The host node with this test ID (the native element, not a wrapper component). */
function host(renderer: Renderer, testID: string): ReactTestRenderer.ReactTestInstance | undefined {
  return renderer.root.findAll(node => node.props.testID === testID && typeof node.type === 'string')[0];
}

function exists(renderer: Renderer, testID: string): boolean {
  return host(renderer, testID) !== undefined;
}

async function press(renderer: Renderer, testID: string): Promise<void> {
  const target = renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
  if (!target) {
    throw new Error(`No pressable element with testID ${testID}`);
  }
  await ReactTestRenderer.act(async () => {
    await target.props.onPress();
  });
}

function textNodes(renderer: Renderer, text: string): ReactTestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(node => typeof node.type === 'string' && node.props.children === text);
}

describe('Planning list', () => {
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount();
      }
    });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  afterAll(async () => {
    await i18n.changeLanguage('ko');
  });

  test('has one primary Create plan action and opens the routed editor and detail', async () => {
    const onCreatePlan = jest.fn();
    const onOpenPlan = jest.fn();
    const renderer = await render({
      plans: [plan({ localId: 'plan-1', status: 'planned', title: 'Route plan', site: { name: 'Route Reef' }, plannedAt: at(6, 20) })],
      onCreatePlan,
      onOpenPlan,
    });

    expect(host(renderer, 'planning-title')!.props.children).toBe('Plans');
    expect(renderer.root.findAll(node => node.props.label === 'Create plan' && typeof node.props.onPress === 'function')).toHaveLength(1);
    expect(renderer.root.findByProps({ testID: 'planning-create-action-icon' }).findByType(ButtonIcon).props.as).toBe(AddIcon);

    await press(renderer, 'planning-create-action');
    expect(onCreatePlan).toHaveBeenCalledTimes(1);

    await press(renderer, 'planning-plan-row-plan-1');
    expect(onOpenPlan).toHaveBeenCalledWith(expect.objectContaining({ localId: 'plan-1' }));
    // No in-screen editor or detail: those are root stack routes.
    expect(exists(renderer, 'planning-editor-title')).toBe(false);
    expect(exists(renderer, 'planning-detail-edit')).toBe(false);
  });

  test('shows the next dive summary only while an upcoming planned dive exists', async () => {
    const onOpenPlan = jest.fn();
    const upcoming = plan({ localId: 'upcoming', status: 'planned', title: 'Blue Wall morning', site: { name: 'Blue Wall' }, plannedAt: at(6, 20) });
    const later = plan({ localId: 'later', status: 'planned', title: 'Later dive', plannedAt: at(7, 2) });
    const renderer = await render({ plans: [later, upcoming], onOpenPlan });

    const nextRow = renderer.root.findByProps({ testID: 'planning-next-plan-row' });
    expect(nextRow.props.label).toBe('Blue Wall morning');
    expect(nextRow.props.detail).toContain('Blue Wall');
    await press(renderer, 'planning-next-plan-row');
    expect(onOpenPlan).toHaveBeenCalledWith(expect.objectContaining({ localId: 'upcoming' }));

    const withoutUpcoming = await render({
      plans: [
        plan({ localId: 'draft', status: 'draft', title: 'Draft', plannedAt: at(6, 20) }),
        plan({ localId: 'past', status: 'planned', title: 'Past', plannedAt: at(6, 1) }),
        plan({ localId: 'done', status: 'completed', title: 'Done', plannedAt: at(6, 25) }),
      ],
    });
    expect(withoutUpcoming.root.findAllByProps({ testID: 'planning-next-plan-row' })).toHaveLength(0);
    expect(textNodes(withoutUpcoming, 'No active plan')).toHaveLength(0);
  });

  test('marks drafts, completed plans and past-dated planned dives with a quiet chip', async () => {
    const renderer = await render({
      plans: [
        plan({ localId: 'upcoming', status: 'planned', title: 'Upcoming', plannedAt: at(6, 20) }),
        plan({ localId: 'today', status: 'planned', title: 'This morning', plannedAt: at(6, 13, 8) }),
        plan({ localId: 'past', status: 'planned', title: 'Past', plannedAt: at(6, 1) }),
        plan({ localId: 'draft', status: 'draft', title: 'Draft' }),
        plan({ localId: 'done', status: 'completed', title: 'Done', plannedAt: at(6, 2) }),
      ],
    });

    expect(exists(renderer, 'planning-plan-row-upcoming-chip')).toBe(false);
    // Today's dive is not past yet, even after its start time.
    expect(exists(renderer, 'planning-plan-row-today-chip')).toBe(false);
    const pastChip = renderer.root.findByProps({ testID: 'planning-plan-row-past-chip' });
    expect(pastChip.props.label).toBe('Date passed');
    expect(pastChip.props.tone).toBe('muted');
    expect(renderer.root.findByProps({ testID: 'planning-plan-row-draft-chip' }).props.label).toBe('Draft');
    expect(renderer.root.findByProps({ testID: 'planning-plan-row-done-chip' }).props.label).toBe('Completed');
    expect(renderer.root.findByProps({ testID: 'planning-plan-row-done-chip' }).props.tone).toBe('muted');
  });

  test('keys rows by plan id so plans at the same site stay apart', async () => {
    const renderer = await render({
      plans: [
        plan({ localId: 'reef-a', status: 'planned', title: 'Morning', site: { name: 'House Reef' }, plannedAt: at(6, 20) }),
        plan({ localId: 'reef-b', status: 'planned', title: 'Afternoon', site: { name: 'House Reef' }, plannedAt: at(6, 21) }),
      ],
    });

    expect(exists(renderer, 'planning-plan-row-reef-a')).toBe(true);
    expect(exists(renderer, 'planning-plan-row-reef-b')).toBe(true);
  });

  test('labels only retained guest plans for an authenticated account', async () => {
    const renderer = await render({
      isAuthenticated: true,
      plans: [
        plan({ localId: 'account-plan', ownerUserId: 'user-1', site: { name: 'Account Plan Reef' } }),
        plan({
          localId: 'device-plan',
          status: 'planned',
          title: 'Device Plan Morning',
          plannedAt: at(6, 20),
          site: { name: 'Device Plan Reef' },
          diveMode: 'scuba',
        }),
      ],
    });

    expect(renderer.root.findByProps({ testID: 'planning-device-badge-device-plan' }).props.label).toBe('Only on this device');
    expect(renderer.root.findAllByProps({ testID: 'planning-device-badge-account-plan' })).toHaveLength(0);
    const label = renderer.root.findByProps({ testID: 'planning-plan-row-device-plan' }).props.accessibilityLabel as string;
    expect(label.startsWith('Device Plan Morning, ')).toBe(true);
    expect(label).toContain('Device Plan Reef');
    expect(label).toContain('Only on this device');
    expect(label.endsWith(', Scuba')).toBe(true);
  });

  test('does not label guest plans before authentication', async () => {
    const renderer = await render({ plans: [plan({ localId: 'guest-plan', site: { name: 'Guest Plan Reef' } })] });

    expect(renderer.root.findAllByProps({ testID: 'planning-device-badge-guest-plan' })).toHaveLength(0);
  });

  test('reserves skeleton rows on the first load and shows them only after the delay', async () => {
    jest.useFakeTimers();
    const renderer = await render({ isLoading: true });
    const loading = host(renderer, 'planning-loading-state')!;

    expect(loading.props.accessibilityState).toEqual({ busy: true });
    expect(loading.props.accessible).toBe(false);
    expect(exists(renderer, 'planning-empty-state')).toBe(false);
    expect(exists(renderer, 'planning-next-plan-row')).toBe(false);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(host(renderer, 'planning-loading-state')!.props.accessible).toBe(false);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(host(renderer, 'planning-loading-state')!.props.accessible).toBe(true);
    expect(host(renderer, 'planning-loading-state')!.props.accessibilityLabel).toBe('Loading plans');
  });

  test('replaces the skeleton with the plans as soon as they arrive', async () => {
    const renderer = await render({ isLoading: true });

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <PlanningScreen {...screenProps({ plans: [plan({ localId: 'arrived', title: 'Arrived' })], isLoading: false })} />,
      );
    });

    expect(exists(renderer, 'planning-loading-state')).toBe(false);
    expect(exists(renderer, 'planning-plan-row-arrived')).toBe(true);
  });

  test('keeps the plans on screen with a short note when a refresh fails', async () => {
    const renderer = await render({
      plans: [plan({ localId: 'kept', title: 'Kept plan' })],
      loadError: new Error('offline'),
    });

    expect(exists(renderer, 'planning-plan-row-kept')).toBe(true);
    expect(exists(renderer, 'planning-error-state')).toBe(false);
    expect(host(renderer, 'planning-refresh-error')!.props.children).toBe('Couldn’t refresh. Showing what was last loaded.');
  });

  test('keeps one new-plan button on the empty planning screen', async () => {
    const renderer = await render();

    expect(renderer.root.findAll(node => node.props.label === 'Create plan' && typeof node.props.onPress === 'function')).toHaveLength(1);
    expect(exists(renderer, 'planning-empty-state')).toBe(true);
    expect(renderer.root.findAllByProps({ testID: 'planning-empty-state-action' })).toHaveLength(0);
  });

  test('uses native pull-to-refresh and refreshes when the tab is selected again', async () => {
    const onRefresh = jest.fn();
    const renderer = await render({ onRefresh, reselectToken: 0 });
    const refreshControl = renderer.root.findByType(ScrollView).props.refreshControl;

    expect(refreshControl.type).toBe(RefreshControl);
    expect(refreshControl.props.refreshing).toBe(false);

    await ReactTestRenderer.act(async () => {
      renderer.update(<PlanningScreen {...screenProps({ onRefresh, reselectToken: 1 })} />);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test('opens the logbook from the quiet link at the bottom', async () => {
    const onOpenLogbook = jest.fn();
    const renderer = await render({ onOpenLogbook });

    await press(renderer, 'planning-open-logbook-action');

    expect(onOpenLogbook).toHaveBeenCalledTimes(1);
  });
});
