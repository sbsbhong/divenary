import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { KeyboardAvoidingView, RefreshControl, ScrollView } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ButtonIcon } from '../src/components/ui/button';
import i18n from '../src/i18n';
import { AddIcon, CalendarDaysIcon } from '../src/components/ui/icon';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import { PlanEditor } from '../src/screens/planning/plan-editor';
import PlanningScreen from '../src/screens/planning/screen';
import { useDivePlans } from '../src/states/use-dive-plans';
import type { DivePlan } from '../src/types/dive-plan';

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

type HarnessProps = {
  repository: LocalDivePlanRepository;
  onCreatePlan?: () => void;
  onOpenPlan?: (plan: DivePlan) => void;
  onCreateLogFromPlan?: (plan: DivePlan) => void;
};

const queryClients: QueryClient[] = [];
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

function Harness({ repository, onCreateLogFromPlan = jest.fn(), onCreatePlan, onOpenPlan }: HarnessProps): React.JSX.Element {
  const plans = useDivePlans({ repository, queryScope: 'planning-screen-test' });

  return (
    <PlanningScreen
      sessions={[]}
      plans={plans.plans}
      onRefresh={plans.refresh}
      isRefreshing={plans.isRefreshing}
      onSavePlan={plans.savePlan}
      onDeletePlan={plans.deletePlan}
      saveError={plans.saveError}
      isSaving={plans.isSaving}
      onCreatePlan={onCreatePlan}
      onOpenPlan={onOpenPlan}
      onCreateLogFromPlan={onCreateLogFromPlan}
      onOpenLogbook={jest.fn()}
    />
  );
}

const renderPlanning = async (
  repository: LocalDivePlanRepository,
  options:
    | ((plan: DivePlan) => void)
    | {
        onCreateLogFromPlan?: (plan: DivePlan) => void;
        onCreatePlan?: () => void;
        onOpenPlan?: (plan: DivePlan) => void;
      } = {},
) => {
  const props = typeof options === 'function' ? { onCreateLogFromPlan: options } : options;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  queryClients.push(queryClient);
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    await i18n.changeLanguage('en');
    renderer = ReactTestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <Harness
          repository={repository}
          onCreateLogFromPlan={props.onCreateLogFromPlan}
          onCreatePlan={props.onCreatePlan}
          onOpenPlan={props.onOpenPlan}
        />
      </QueryClientProvider>,
    );
  });

  renderers.push(renderer!);
  return renderer!;
};

const press = async (root: ReactTestRenderer.ReactTestInstance, testID: string) => {
  await ReactTestRenderer.act(async () => {
    await root.findByProps({ testID }).props.onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
};

const layout = async (root: ReactTestRenderer.ReactTestInstance, testID: string, y: number) => {
  await ReactTestRenderer.act(async () => {
    root.findByProps({ testID }).props.onLayout({ nativeEvent: { layout: { y } } });
  });
};

const changeText = async (root: ReactTestRenderer.ReactTestInstance, testID: string, value: string) => {
  await ReactTestRenderer.act(async () => {
    const field = findInputLike(root, testID);
    if (typeof field.props.onChangeText === 'function') {
      field.props.onChangeText(value);
      return;
    }
    if (typeof field.props.onChange === 'function') {
      field.props.onChange(value);
      return;
    }
    field.props.onValueChange(value);
  });
};

const changeDateTime = async (root: ReactTestRenderer.ReactTestInstance, testID: string, value: Date) => {
  const trigger = root.findAllByProps({ testID: `${testID}-trigger` })[0];
  if (trigger) {
    await ReactTestRenderer.act(async () => {
      trigger.props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      const picker = root.findByProps({ testID: `${testID}-picker` });
      if (typeof picker.props.onValueChange === 'function') {
        picker.props.onValueChange({ nativeEvent: { timestamp: value.getTime(), utcOffset: 0 } }, value);
        return;
      }

      picker.props.onChange({ type: 'set' }, value);
    });
    return;
  }

  await ReactTestRenderer.act(async () => {
    const field = findInputLike(root, testID);
    field.props.onChange(value);
  });
};

const changeNumber = async (root: ReactTestRenderer.ReactTestInstance, testID: string, value: number) => {
  await ReactTestRenderer.act(async () => {
    root.findByProps({ testID: `${testID}-input-trigger` }).props.onPress();
  });

  await ReactTestRenderer.act(async () => {
    const input = root.findAllByProps({ testID: `${testID}-input` }).find(match => typeof match.props.onChangeText === 'function');
    input!.props.onChangeText(`${value}`);
  });

  await ReactTestRenderer.act(async () => {
    const input = root.findAllByProps({ testID: `${testID}-input` }).find(match => typeof match.props.onSubmitEditing === 'function');
    input!.props.onSubmitEditing();
  });
};

const findInputLike = (root: ReactTestRenderer.ReactTestInstance, testID: string): ReactTestRenderer.ReactTestInstance => {
  const matches = root.findAllByProps({ testID });
  return (
    matches.find(match => typeof match.props.onChangeText === 'function') ??
    matches.find(match => typeof match.props.onChange === 'function') ??
    matches.find(match => typeof match.props.onValueChange === 'function') ??
    root.findByProps({ testID })
  );
};

describe('Planning screen planbook flow', () => {
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

  it('creates a planned scuba boat plan with mode-specific fields', async () => {
    const repository = new LocalDivePlanRepository([], { now: () => 1781354000 });
    const renderer = await renderPlanning(repository);
    const root = renderer.root;

    await press(root, 'planning-create-action');
    expect(root.findByProps({ testID: 'planning-editor-title' }).props.children).toBe('New dive plan');
    await changeText(root, 'planning-editor-plan-title', 'Blue Wall morning');
    await changeDateTime(root, 'planning-editor-planned-at', new Date('2026-06-20T09:30:00'));
    await changeText(root, 'planning-editor-site-name', 'Blue Wall');
    await press(root, 'planning-editor-mode-scuba');
    await press(root, 'planning-editor-entry-style-boat');
    expect(root.findByProps({ testID: 'planning-editor-gas-label-air' })).toBeTruthy();
    await changeNumber(root, 'planning-editor-planned-max-depth', 24);
    await changeNumber(root, 'planning-editor-planned-duration', 45);
    await changeText(root, 'planning-editor-gear-input', 'bcd-1, computer-1,');
    await press(root, 'planning-editor-pressure-unit-psi');
    await changeNumber(root, 'planning-editor-pressure-start', 3000);
    await changeNumber(root, 'planning-editor-pressure-end', 900);
    await press(root, 'planning-editor-save-planned');

    const [savedPlan] = await repository.list();
    expect(savedPlan).toMatchObject({
      status: 'planned',
      title: 'Blue Wall morning',
      plannedAt: new Date('2026-06-20T09:30:00').getTime() / 1000,
      site: { name: 'Blue Wall' },
      diveMode: 'scuba',
      entryStyle: 'boat',
      gearIds: ['bcd-1', 'computer-1'],
      plannedValues: {
        plannedMaxDepthMeters: 24,
        plannedDurationMinutes: 45,
        gasLabel: 'Air',
        plannedPressure: { unit: 'psi', start: 3000, end: 900 },
      },
    });
    expect(root.findByProps({ testID: 'planning-plan-row-Blue Wall' })).toBeTruthy();
    await press(root, 'planning-plan-row-Blue Wall');
    expect(root.findByProps({ testID: 'planning-detail-planned-value-gas-Air' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-detail-planned-value-pressure-3000psi->900psi' })).toBeTruthy();
  });

  it('blocks saving a planned dive until required fields are valid', async () => {
    const repository = new LocalDivePlanRepository([], { now: () => 1781354000 });
    const renderer = await renderPlanning(repository);
    const root = renderer.root;

    await press(root, 'planning-create-action');
    await press(root, 'planning-editor-save-planned');

    expect(root.findByProps({ testID: 'planning-editor-planned-at-error' }).props.children).toBe('계획 날짜와 시간을 선택해주세요.');
    expect(root.findByProps({ testID: 'planning-editor-site-name-error' }).props.children).toBe('사이트 이름을 입력해주세요.');
    expect(root.findByProps({ testID: 'planning-editor-planned-duration-error' }).props.children).toBe('계획 시간(분)을 선택해주세요.');
    expect(root.findByProps({ testID: 'planning-editor-planned-max-depth-error' }).props.children).toBe('계획 최대 수심(m)을 선택해주세요.');
    expect(await repository.list()).toEqual([]);
  });

  it('plan editor reports the first invalid field so the screen can scroll to it', async () => {
    const onInvalidSubmit = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
      renderer = ReactTestRenderer.create(
        <PlanEditor
          onCancel={jest.fn()}
          onSave={jest.fn()}
          onInvalidSubmit={onInvalidSubmit}
        />,
      );
    });
    renderers.push(renderer!);

    await press(renderer!.root, 'planning-editor-save-planned');

    expect(onInvalidSubmit).toHaveBeenCalledWith('plannedAt');
  });

  it('plan editor scrolls to the first invalid field on failed set planned', async () => {
    const renderer = await renderPlanning(new LocalDivePlanRepository([]));
    const root = renderer.root;

    await press(root, 'planning-create-action');
    await layout(root, 'planning-editor-card-anchor', 160);
    await layout(root, 'planning-editor-body', 94);
    await layout(root, 'planning-editor-planned-at-anchor', 80);
    await press(root, 'planning-editor-save-planned');

    expect(root.findByProps({ testID: 'planning-scroll-target' }).props.children).toBe('318');
  });

  it('renders date time as a row trigger and numeric values as wheel pickers', async () => {
    const renderer = await renderPlanning(new LocalDivePlanRepository([]));
    const root = renderer.root;

    await press(root, 'planning-create-action');

    expect(root.findByProps({ testID: 'planning-editor-planned-at-trigger' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-editor-planned-at-date' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-editor-planned-at-time' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-editor-planned-duration-wheel' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-editor-planned-duration-wheel-list' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-editor-planned-duration-label' }).props.children).toBe('Duration (min)');
    expect(root.findByProps({ testID: 'planning-editor-planned-max-depth-wheel' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-editor-planned-max-depth-column-meters-wheel-list' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-editor-planned-max-depth-column-tenths-wheel-list' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-editor-planned-max-depth-unit-fixed' }).props.children).toBe('m');
    expect(root.findAllByProps({ testID: 'planning-editor-planned-at' }).filter(match => typeof match.props.onChangeText === 'function')).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'planning-editor-planned-duration-slider' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'planning-editor-planned-duration-decrement' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'planning-editor-planned-duration-increment' })).toHaveLength(0);
    expect(root.findAllByProps({ children: 'OPTIONAL' })).toHaveLength(0);
  });

  it('keeps planned duration single-column while planned depth uses split meter columns', async () => {
    const renderer = await renderPlanning(
      new LocalDivePlanRepository([
        plan({
          localId: 'plan-depth-split',
          status: 'draft',
          site: { name: 'Split Depth Reef' },
          plannedValues: {
            plannedMaxDepthMeters: 19.6,
            plannedDurationMinutes: 45,
          },
        }),
      ]),
    );
    const root = renderer.root;

    await press(root, 'planning-plan-row-Split Depth Reef');
    await press(root, 'planning-detail-edit');

    expect(root.findByProps({ testID: 'planning-editor-planned-duration-value' }).props.children).toBe('45');
    expect(root.findByProps({ testID: 'planning-editor-planned-max-depth-meters-value' }).props.children).toBe('19');
    expect(root.findByProps({ testID: 'planning-editor-planned-max-depth-tenths-value' }).props.children).toBe('.6');
  });

  it('commits plan lists as badges and removes them before saving', async () => {
    const repository = new LocalDivePlanRepository([], { now: () => 1781354000 });
    const renderer = await renderPlanning(repository);
    const root = renderer.root;

    await press(root, 'planning-create-action');
    await changeDateTime(root, 'planning-editor-planned-at', new Date('2026-06-20T09:30:00'));
    await changeText(root, 'planning-editor-site-name', 'Badge Reef');
    await changeNumber(root, 'planning-editor-planned-max-depth', 24);
    await changeNumber(root, 'planning-editor-planned-duration', 45);
    await changeText(root, 'planning-editor-buddies-input', 'Mina, Alex,');
    await changeText(root, 'planning-editor-tags-input', 'reef, training,');
    expect(root.findByProps({ testID: 'planning-editor-tags-badge-reef' }).props.className).toEqual(
      expect.stringContaining('bg-primary/10'),
    );
    await press(root, 'planning-editor-buddies-remove-Mina');
    await press(root, 'planning-editor-save-planned');

    const [savedPlan] = await repository.list();
    expect(savedPlan.buddyIds).toEqual(['Alex']);
    expect(savedPlan.tags).toEqual(['reef', 'training']);
  });

  it('commits the final plan badge token before saving', async () => {
    const repository = new LocalDivePlanRepository([], { now: () => 1781354000 });
    const renderer = await renderPlanning(repository);
    const root = renderer.root;

    await press(root, 'planning-create-action');
    await changeDateTime(root, 'planning-editor-planned-at', new Date('2026-06-20T09:30:00'));
    await changeText(root, 'planning-editor-site-name', 'Plan Badge Reef');
    await changeNumber(root, 'planning-editor-planned-max-depth', 20);
    await changeNumber(root, 'planning-editor-planned-duration', 40);
    await changeText(root, 'planning-editor-tags-input', 'reef, line');
    await press(root, 'planning-editor-save-planned');

    const [savedPlan] = await repository.list();
    expect(savedPlan.tags).toEqual(['reef', 'line']);
  });

  it('saves plan visibility and difficulty as star ratings', async () => {
    const repository = new LocalDivePlanRepository([], { now: () => 1781354000 });
    const renderer = await renderPlanning(repository);
    const root = renderer.root;

    await press(root, 'planning-create-action');
    await changeDateTime(root, 'planning-editor-planned-at', new Date('2026-06-20T09:30:00'));
    await changeText(root, 'planning-editor-site-name', 'Star Reef');
    await changeNumber(root, 'planning-editor-planned-max-depth', 18);
    await changeNumber(root, 'planning-editor-planned-duration', 40);
    await press(root, 'planning-editor-visibility-expectation-star-4');
    await press(root, 'planning-editor-perceived-difficulty-star-3');
    await press(root, 'planning-editor-save-planned');

    const [savedPlan] = await repository.list();
    expect(savedPlan.plannedValues.visibilityExpectation).toBe(4);
    expect(savedPlan.plannedValues.perceivedDifficulty).toBe(3);
  });

  it('shows a back icon on the local plan editor', async () => {
    const renderer = await renderPlanning(new LocalDivePlanRepository([]));
    const root = renderer.root;

    await press(root, 'planning-create-action');

    expect(root.findByProps({ testID: 'planning-editor-back-icon' })).toBeTruthy();
    await press(root, 'planning-editor-back');

    expect(root.findAllByProps({ testID: 'planning-editor-title' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'planning-create-action' })).toBeTruthy();
  });

  it('plan editor exposes only scuba and freedive modes', async () => {
    const repository = new LocalDivePlanRepository([], { now: () => 1781354000 });
    const renderer = await renderPlanning(repository);
    const root = renderer.root;

    await press(root, 'planning-create-action');

    expect(root.findByProps({ testID: 'planning-editor-mode-scuba' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-editor-mode-freedive' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'planning-editor-mode-snorkel' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'planning-editor-mode-pool' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'planning-editor-pool-length' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'planning-editor-lap-target' })).toHaveLength(0);
  });

  it('keeps planning inputs in a keyboard-aware scroll container', async () => {
    const renderer = await renderPlanning(new LocalDivePlanRepository([]));
    const root = renderer.root;

    expect(root.findByType(KeyboardAvoidingView).props.behavior).toBe('padding');
    expect(root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('uses native pull-to-refresh on the planning scroll view', async () => {
    const renderer = await renderPlanning(new LocalDivePlanRepository([]));
    const refreshControl = renderer.root.findByType(ScrollView).props.refreshControl;

    expect(refreshControl.type).toBe(RefreshControl);
    expect(refreshControl.props.refreshing).toBe(false);
  });

  it('refreshes when the active planning tab is selected again', async () => {
    const onRefresh = jest.fn();

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
      renderer = ReactTestRenderer.create(
        <PlanningScreen
          sessions={[]}
          plans={[]}
          onRefresh={onRefresh}
          onSavePlan={jest.fn()}
          onOpenLogbook={jest.fn()}
          reselectToken={0}
        />,
      );
    });

    await ReactTestRenderer.act(async () => {
      renderer!.update(
        <PlanningScreen
          sessions={[]}
          plans={[]}
          onRefresh={onRefresh}
          onSavePlan={jest.fn()}
          onOpenLogbook={jest.fn()}
          reselectToken={1}
        />,
      );
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('edits an existing plan without creating a duplicate', async () => {
    const repository = new LocalDivePlanRepository([
      plan({
        localId: 'plan-1',
        status: 'planned',
        title: 'Original plan',
        plannedAt: 1781355000,
        site: { name: 'Original Reef' },
        diveMode: 'freedive',
        entryStyle: 'shore',
        plannedValues: {
          plannedMaxDepthMeters: 16,
          plannedDurationMinutes: 30,
        },
      }),
    ]);
    const renderer = await renderPlanning(repository);
    const root = renderer.root;

    await press(root, 'planning-plan-row-Original Reef');
    await press(root, 'planning-detail-edit');
    await changeText(root, 'planning-editor-site-name', 'Edited Reef');
    await changeText(root, 'planning-editor-objective', 'Line practice');
    await press(root, 'planning-editor-save-draft');

    const entries = await repository.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      localId: 'plan-1',
      status: 'draft',
      site: { name: 'Edited Reef' },
      objective: 'Line practice',
    });
    expect(root.findByProps({ testID: 'planning-plan-row-Edited Reef' })).toBeTruthy();
  });

  it('shows a back icon on the local plan detail', async () => {
    const repository = new LocalDivePlanRepository([
      plan({
        localId: 'plan-1',
        status: 'planned',
        title: 'Route plan',
        site: { name: 'Route Reef' },
      }),
    ]);
    const renderer = await renderPlanning(repository);
    const root = renderer.root;

    await press(root, 'planning-plan-row-Route Reef');

    expect(root.findByProps({ testID: 'planning-detail-back-icon' })).toBeTruthy();
    await press(root, 'planning-detail-back');

    expect(root.findAllByProps({ testID: 'planning-detail-edit' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'planning-plan-row-Route Reef' })).toBeTruthy();
  });

  it('delegates plan detail and creation to the app route when provided', async () => {
    const onCreatePlan = jest.fn();
    const onOpenPlan = jest.fn();
    const repository = new LocalDivePlanRepository([
      plan({
        localId: 'plan-1',
        status: 'planned',
        title: 'Route plan',
        site: { name: 'Route Reef' },
      }),
    ]);
    const renderer = await renderPlanning(repository, { onCreatePlan, onOpenPlan });
    const root = renderer.root;

    expect(root.findAllByProps({ testID: 'planning-title-icon' })).toHaveLength(0);
    const createActionIcon = root.findByProps({ testID: 'planning-create-action-icon' });
    expect(createActionIcon.findByType(ButtonIcon).props.as).toBe(CalendarDaysIcon);
    expect(createActionIcon.findByType(ButtonIcon).props.as).not.toBe(AddIcon);
    expect(root.findByProps({ testID: 'planning-active-open-action-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-plan-row-Route Reef-icon' })).toBeTruthy();
    expect(root.findByProps({ testID: 'planning-open-logbook-action-icon' })).toBeTruthy();

    await press(root, 'planning-create-action');
    expect(onCreatePlan).toHaveBeenCalledTimes(1);
    expect(root.findAllByProps({ testID: 'planning-editor-title' })).toHaveLength(0);

    await press(root, 'planning-plan-row-Route Reef');
    expect(onOpenPlan).toHaveBeenCalledWith(expect.objectContaining({ localId: 'plan-1' }));
    expect(root.findAllByProps({ testID: 'planning-detail-edit' })).toHaveLength(0);
  });

  it('keeps one new-plan button on the empty planning screen', async () => {
    const renderer = await renderPlanning(new LocalDivePlanRepository([]));
    const root = renderer.root;

    expect(root.findAll(node => node.props.label === 'New plan')).toHaveLength(1);
    expect(root.findByProps({ testID: 'planning-create-action' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'planning-active-create-action' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'planning-empty-create-action' })).toHaveLength(0);
  });

  it('completes a plan and lets the user choose Later', async () => {
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(1781356000 * 1000);
    const repository = new LocalDivePlanRepository(
      [
        plan({
          localId: 'plan-1',
          status: 'planned',
          plannedAt: 1781355000,
          site: { name: 'Complete Reef' },
        }),
      ],
      { now: () => 1781356000 },
    );
    const renderer = await renderPlanning(repository);
    const root = renderer.root;

    await press(root, 'planning-plan-row-Complete Reef');
    await press(root, 'planning-detail-complete');
    expect(root.findByProps({ testID: 'planning-complete-dialog' })).toBeTruthy();
    await press(root, 'planning-complete-later');

    const [savedPlan] = await repository.list();
    expect(savedPlan.status).toBe('completed');
    expect(savedPlan.completedAt).toBe(1781356000);
    expect(() => root.findByProps({ testID: 'planning-complete-dialog' })).toThrow();

    dateNow.mockRestore();
  });

  it('creates a log draft from a completed plan through the callback', async () => {
    const onCreateLogFromPlan = jest.fn();
    const repository = new LocalDivePlanRepository([
      plan({
        localId: 'plan-1',
        status: 'completed',
        completedAt: 1781356000,
        site: { name: 'Log Reef' },
        diveMode: 'scuba',
        entryStyle: 'boat',
      }),
    ]);
    const renderer = await renderPlanning(repository, onCreateLogFromPlan);
    const root = renderer.root;

    await press(root, 'planning-plan-row-Log Reef');
    await press(root, 'planning-detail-create-log');

    expect(onCreateLogFromPlan).toHaveBeenCalledTimes(1);
    expect(onCreateLogFromPlan.mock.calls[0][0]).toMatchObject({
      localId: 'plan-1',
      status: 'completed',
      site: { name: 'Log Reef' },
    });
  });

});
