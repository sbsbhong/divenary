import React from 'react';
import { AccessibilityInfo } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from '../src/i18n';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import { PlanEditor } from '../src/screens/planning/plan-editor';
import type { DivePlan } from '../src/types/dive-plan';

type Renderer = ReactTestRenderer.ReactTestRenderer;

// The sticky save bar reads the safe area, as it does under the app's providers.
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

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

async function renderEditor(
  options: {
    plan?: DivePlan;
    mode?: 'create' | 'edit';
    onSave?: (plan: DivePlan) => Promise<DivePlan>;
    onCancel?: () => void;
    onInvalidSubmit?: (fieldName: string) => void;
  } = {},
): Promise<{ renderer: Renderer; repository: LocalDivePlanRepository }> {
  const repository = new LocalDivePlanRepository(options.plan ? [options.plan] : [], { now: () => 1781354000 });
  let renderer: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <PlanEditor
          plan={options.plan}
          mode={options.mode}
          onCancel={options.onCancel ?? jest.fn()}
          onSave={options.onSave ?? (nextPlan => repository.save(nextPlan))}
          onInvalidSubmit={options.onInvalidSubmit}
        />
      </SafeAreaProvider>,
    );
  });
  renderers.push(renderer!);
  return { renderer: renderer!, repository };
}

/** The host node with this test ID (the native element, not a wrapper component). */
function host(renderer: Renderer, testID: string): ReactTestRenderer.ReactTestInstance | undefined {
  return renderer.root.findAll(node => node.props.testID === testID && typeof node.type === 'string')[0];
}

function exists(renderer: Renderer, testID: string): boolean {
  return host(renderer, testID) !== undefined;
}

function textOf(renderer: Renderer, testID: string): string {
  const node = host(renderer, testID);
  if (!node) {
    throw new Error(`No element with testID ${testID}`);
  }
  const children = node.props.children as unknown;
  return Array.isArray(children) ? children.join('') : String(children);
}

function textNodes(renderer: Renderer, text: string): ReactTestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(node => typeof node.type === 'string' && node.props.children === text);
}

/** The outermost element with this ID that handles presses. */
async function press(renderer: Renderer, testID: string): Promise<void> {
  const target = renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
  if (!target) {
    throw new Error(`No pressable element with testID ${testID}`);
  }
  await ReactTestRenderer.act(async () => {
    await target.props.onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
}

async function changeText(renderer: Renderer, testID: string, value: string): Promise<void> {
  const input = renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onChangeText === 'function')[0];
  if (!input) {
    throw new Error(`No text input with testID ${testID}`);
  }
  await ReactTestRenderer.act(async () => {
    input.props.onChangeText(value);
  });
}

/**
 * Opens the value row's sheet, types the number into its wheel and taps Done, as a diver would.
 * Done matters when the typed number equals the wheel's start value: only Done saves that one.
 */
async function setNumber(renderer: Renderer, testID: string, value: number): Promise<void> {
  await press(renderer, `${testID}-trigger`);
  await press(renderer, `${testID}-input-trigger`);
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findAll(node => node.props.testID === `${testID}-input` && typeof node.props.onChangeText === 'function')[0]
      .props.onChangeText(`${value}`);
  });
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findAll(node => node.props.testID === `${testID}-input` && typeof node.props.onSubmitEditing === 'function')[0]
      .props.onSubmitEditing();
  });
  await press(renderer, `${testID}-done`);
}

/** Presses without waiting for the handler's promise, for a save that is still running. */
async function pressAndLeaveRunning(renderer: Renderer, testID: string): Promise<void> {
  const target = renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
  await ReactTestRenderer.act(async () => {
    target.props.onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
}

async function setDate(renderer: Renderer, testID: string, value: Date): Promise<void> {
  await press(renderer, `${testID}-trigger`);
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findAll(node => node.props.testID === `${testID}-picker` && typeof node.props.onValueChange === 'function')[0]
      .props.onValueChange({ nativeEvent: { timestamp: value.getTime(), utcOffset: 0 } }, value);
  });
}

async function fillRequiredFields(renderer: Renderer, siteName: string): Promise<void> {
  await setDate(renderer, 'planning-editor-planned-at', new Date('2026-06-20T09:30:00'));
  await changeText(renderer, 'planning-editor-site-name', siteName);
  await setNumber(renderer, 'planning-editor-planned-max-depth', 18);
  await setNumber(renderer, 'planning-editor-planned-duration', 40);
}

describe('Plan editor', () => {
  beforeEach(async () => {
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
  });

  afterAll(async () => {
    await i18n.changeLanguage('ko');
  });

  test('creates a planned scuba boat plan with mode-specific fields', async () => {
    const { renderer, repository } = await renderEditor();

    expect(textOf(renderer, 'planning-editor-title')).toBe('New dive plan');
    await changeText(renderer, 'planning-editor-plan-title', 'Blue Wall morning');
    await setDate(renderer, 'planning-editor-planned-at', new Date('2026-06-20T09:30:00'));
    await changeText(renderer, 'planning-editor-site-name', 'Blue Wall');
    await press(renderer, 'planning-editor-mode-scuba');
    await press(renderer, 'planning-editor-entry-style-boat');
    expect(exists(renderer, 'planning-editor-gas-label-air-row')).toBe(true);
    await setNumber(renderer, 'planning-editor-planned-max-depth', 24);
    await setNumber(renderer, 'planning-editor-planned-duration', 45);
    await press(renderer, 'planning-editor-details-toggle');
    await changeText(renderer, 'planning-editor-gear-input', 'bcd-1, computer-1,');
    await press(renderer, 'planning-editor-pressure-unit-psi');
    await setNumber(renderer, 'planning-editor-pressure-start', 3000);
    await setNumber(renderer, 'planning-editor-pressure-end', 900);
    await press(renderer, 'planning-editor-save-planned');

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
  });

  test('blocks Confirm plan until the required fields are filled and announces why', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const onInvalidSubmit = jest.fn();
    const { renderer, repository } = await renderEditor({ onInvalidSubmit });

    await press(renderer, 'planning-editor-save-planned');

    // The scroll to the first blocked field is silent, so VoiceOver hears its message.
    expect(announce).toHaveBeenCalledWith(textOf(renderer, 'planning-editor-planned-at-error'));

    expect(textOf(renderer, 'planning-editor-planned-at-error')).toBe('Choose a planned date and time.');
    expect(textOf(renderer, 'planning-editor-site-name-error')).toBe('Enter a dive site.');
    expect(textOf(renderer, 'planning-editor-planned-duration-error')).toBe('Planned dive time (min) is required.');
    expect(textOf(renderer, 'planning-editor-planned-max-depth-error')).toBe('Planned max depth (m) is required.');
    expect(onInvalidSubmit).toHaveBeenCalledWith('plannedAt');
    expect(await repository.list()).toEqual([]);
  });

  test('scrolls to the measured section of the first field that blocks the save', async () => {
    const { renderer } = await renderEditor();

    await setDate(renderer, 'planning-editor-planned-at', new Date('2026-06-20T09:30:00'));
    await changeText(renderer, 'planning-editor-site-name', 'Anchor Reef');
    await ReactTestRenderer.act(async () => {
      host(renderer, 'planning-editor-body')!.props.onLayout({ nativeEvent: { layout: { y: 16 } } });
      renderer.root
        .findByProps({ testID: 'planning-editor-planned-values-anchor' })
        .props.onLayout({ nativeEvent: { layout: { y: 420 } } });
    });
    await press(renderer, 'planning-editor-save-planned');

    // Body offset 16 + section 420 - 16 px gap above it.
    expect(textOf(renderer, 'planning-editor-scroll-target')).toBe('420');
  });

  test('saves a partial draft that has only a title', async () => {
    const { renderer, repository } = await renderEditor();

    await changeText(renderer, 'planning-editor-plan-title', 'Rough idea');
    await press(renderer, 'planning-editor-save-draft');

    const [savedPlan] = await repository.list();
    expect(savedPlan).toMatchObject({ status: 'draft', title: 'Rough idea' });
    expect(savedPlan.plannedAt).toBeUndefined();
    expect(savedPlan.plannedValues.plannedMaxDepthMeters).toBeUndefined();
  });

  test('asks for a title or a site before saving a draft', async () => {
    const { renderer, repository } = await renderEditor();

    await press(renderer, 'planning-editor-save-draft');

    expect(textOf(renderer, 'planning-editor-site-name-error')).toBe('Enter a plan title or dive site.');
    expect(exists(renderer, 'planning-editor-planned-at-error')).toBe(false);
    expect(await repository.list()).toEqual([]);
  });

  test('edits an existing plan with one Save that keeps its status', async () => {
    const existing = plan({
      localId: 'plan-1',
      status: 'planned',
      title: 'Original plan',
      plannedAt: 1781355000,
      site: { name: 'Original Reef' },
      diveMode: 'freedive',
      entryStyle: 'shore',
      plannedValues: { plannedMaxDepthMeters: 16, plannedDurationMinutes: 30 },
    });
    const { renderer, repository } = await renderEditor({ plan: existing, mode: 'edit' });

    expect(textOf(renderer, 'planning-editor-title')).toBe('Edit dive plan');
    expect(textNodes(renderer, 'Planned').length).toBeGreaterThan(0);
    expect(exists(renderer, 'planning-editor-save-draft')).toBe(false);
    expect(exists(renderer, 'planning-editor-save-planned')).toBe(false);
    await changeText(renderer, 'planning-editor-site-name', 'Edited Reef');
    await changeText(renderer, 'planning-editor-objective', 'Line practice');
    await press(renderer, 'planning-editor-save');

    const plans = await repository.list();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      localId: 'plan-1',
      status: 'planned',
      site: { name: 'Edited Reef' },
      objective: 'Line practice',
    });
  });

  test('keeps a completed plan completed when it is edited', async () => {
    const existing = plan({ localId: 'done', status: 'completed', completedAt: 1781356000, title: 'Done dive' });
    const { renderer, repository } = await renderEditor({ plan: existing, mode: 'edit' });

    await changeText(renderer, 'planning-editor-objective', 'Notes after the dive');
    await press(renderer, 'planning-editor-save');

    const [savedPlan] = await repository.list();
    expect(savedPlan).toMatchObject({ status: 'completed', completedAt: 1781356000, objective: 'Notes after the dive' });
  });

  test('marks fields required only where a save runs the full check', async () => {
    const requiredMark = i18n.t('form.required');

    // Confirm plan on a new plan needs the date and time, the dive site, the depth and the dive time.
    const { renderer: created } = await renderEditor();
    expect(textNodes(created, requiredMark)).toHaveLength(4);

    const { renderer: planned } = await renderEditor({ plan: plan({ status: 'planned', title: 'Planned' }), mode: 'edit' });
    expect(textNodes(planned, requiredMark)).toHaveLength(4);

    // A draft or a completed plan saves with the light check, so nothing says required.
    const { renderer: draft } = await renderEditor({ plan: plan({ title: 'Idea' }), mode: 'edit' });
    expect(textNodes(draft, requiredMark)).toHaveLength(0);
    const { renderer: completed } = await renderEditor({ plan: plan({ status: 'completed', title: 'Done' }), mode: 'edit' });
    expect(textNodes(completed, requiredMark)).toHaveLength(0);
  });

  test('keeps a planned plan complete: clearing a required value blocks Save', async () => {
    const existing = plan({
      localId: 'planned',
      status: 'planned',
      plannedAt: 1781355000,
      site: { name: 'Planned Reef' },
      diveMode: 'scuba',
      plannedValues: { plannedMaxDepthMeters: 18, plannedDurationMinutes: 45 },
    });
    const onSave = jest.fn();
    const { renderer } = await renderEditor({ plan: existing, mode: 'edit', onSave });

    await press(renderer, 'planning-editor-planned-max-depth-trigger');
    await press(renderer, 'planning-editor-planned-max-depth-clear');
    await press(renderer, 'planning-editor-save');

    expect(textOf(renderer, 'planning-editor-planned-max-depth-error')).toBe('Planned max depth (m) is required.');
    expect(onSave).not.toHaveBeenCalled();
  });

  test('allows planned depths above 40 m while showing the watch support note', async () => {
    const { renderer, repository } = await renderEditor();

    await fillRequiredFields(renderer, 'Forty Two Plan Reef');
    await setNumber(renderer, 'planning-editor-planned-max-depth', 42);

    expect(textOf(renderer, 'planning-editor-unsupported-depth-warning')).toContain(
      'This plan is deeper than the app supports on Apple Watch',
    );
    await press(renderer, 'planning-editor-save-planned');

    const [savedPlan] = await repository.list();
    expect(savedPlan.plannedValues.plannedMaxDepthMeters).toBe(42);
  });

  test('shows unknown planned values as -- rather than 0', async () => {
    const { renderer } = await renderEditor();

    expect(textOf(renderer, 'planning-editor-planned-max-depth-row-value')).toBe('-- m');
    expect(textOf(renderer, 'planning-editor-planned-duration-row-value')).toBe('-- min');
    expect(textOf(renderer, 'planning-editor-planned-at-date')).toBe('--');
    expect(textOf(renderer, 'planning-editor-planned-at-time')).toBe('--:--');
    expect(renderer.root.findAllByProps({ testID: 'planning-editor-planned-duration-slider' })).toHaveLength(0);
  });

  test('commits plan lists as badges and removes them before saving', async () => {
    const { renderer, repository } = await renderEditor();

    await changeText(renderer, 'planning-editor-plan-title', 'Badge plan');
    await press(renderer, 'planning-editor-details-toggle');
    await changeText(renderer, 'planning-editor-buddies-input', 'Mina, Alex,');
    await changeText(renderer, 'planning-editor-tags-input', 'reef, training,');
    expect(exists(renderer, 'planning-editor-tags-badge-reef')).toBe(true);
    await press(renderer, 'planning-editor-buddies-remove-Mina');
    await press(renderer, 'planning-editor-save-draft');

    const [savedPlan] = await repository.list();
    expect(savedPlan.buddyIds).toEqual(['Alex']);
    expect(savedPlan.tags).toEqual(['reef', 'training']);
  });

  test('commits the final plan badge token before saving', async () => {
    const { renderer, repository } = await renderEditor();

    await changeText(renderer, 'planning-editor-plan-title', 'Token plan');
    await press(renderer, 'planning-editor-details-toggle');
    await changeText(renderer, 'planning-editor-tags-input', 'reef, line');
    await press(renderer, 'planning-editor-save-draft');

    const [savedPlan] = await repository.list();
    expect(savedPlan.tags).toEqual(['reef', 'line']);
  });

  test('saves expected visibility and difficulty as star ratings', async () => {
    const { renderer, repository } = await renderEditor();

    await changeText(renderer, 'planning-editor-plan-title', 'Star plan');
    await press(renderer, 'planning-editor-details-toggle');
    await press(renderer, 'planning-editor-visibility-expectation-star-4');
    await press(renderer, 'planning-editor-perceived-difficulty-star-3');
    await press(renderer, 'planning-editor-save-draft');

    const [savedPlan] = await repository.list();
    expect(savedPlan.plannedValues.visibilityExpectation).toBe(4);
    expect(savedPlan.plannedValues.perceivedDifficulty).toBe(3);
  });

  test('offers only scuba and freedive, and a freedive plan has a repetition target instead of gas and gear', async () => {
    const { renderer } = await renderEditor();

    expect(exists(renderer, 'planning-editor-mode-snorkel')).toBe(false);
    expect(exists(renderer, 'planning-editor-mode-pool')).toBe(false);
    expect(exists(renderer, 'planning-editor-repetition-target-trigger')).toBe(false);

    await press(renderer, 'planning-editor-mode-freedive');
    await press(renderer, 'planning-editor-details-toggle');

    expect(exists(renderer, 'planning-editor-gas-label-air-row')).toBe(false);
    expect(exists(renderer, 'planning-editor-repetition-target-trigger')).toBe(true);
    expect(exists(renderer, 'planning-editor-gear-input')).toBe(false);
    expect(exists(renderer, 'planning-editor-buddies-input')).toBe(true);
    expect(exists(renderer, 'planning-editor-pressure-start-trigger')).toBe(false);
  });

  test('keeps Details closed for a new plan and open when the plan has values inside', async () => {
    const { renderer: blank } = await renderEditor();
    expect(exists(blank, 'planning-editor-details-content')).toBe(false);

    const { renderer: tagged } = await renderEditor({ plan: plan({ title: 'Tagged', tags: ['reef'] }), mode: 'edit' });
    expect(exists(tagged, 'planning-editor-details-content')).toBe(true);
  });

  test('labels expected pressure as planning notes and says it is not a reserve rule', async () => {
    const { renderer } = await renderEditor();

    await press(renderer, 'planning-editor-details-toggle');

    expect(textOf(renderer, 'planning-editor-water-condition-label')).toBe('Expected water conditions');
    expect(textNodes(renderer, 'Tank pressure notes').length).toBeGreaterThan(0);
    expect(textNodes(renderer, 'Expected start pressure').length).toBeGreaterThan(0);
    expect(textNodes(renderer, 'Expected end pressure').length).toBeGreaterThan(0);
    expect(textNodes(renderer, 'For planning notes only, not for tank pressure decisions.')).toHaveLength(1);
    // No quick chips that could read like a suggested reserve.
    await press(renderer, 'planning-editor-pressure-end-trigger');
    expect(renderer.root.findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('planning-editor-pressure-end-chip-'))).toHaveLength(0);
  });

  test('shows a save failure above the save action and announces it', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const { renderer } = await renderEditor({ onSave: () => Promise.reject(new Error('disk full')) });

    await changeText(renderer, 'planning-editor-plan-title', 'Will fail');
    await press(renderer, 'planning-editor-save-draft');

    expect(textOf(renderer, 'planning-editor-error')).toBe('Could not save this plan on this device. Try again.');
    expect(announce).toHaveBeenCalledWith('Could not save this plan on this device. Try again.');
  });

  test('marks the pressed save busy at once and disables the other one', async () => {
    let finishSave: (plan: DivePlan) => void = () => undefined;
    const onSave = jest.fn((nextPlan: DivePlan) => new Promise<DivePlan>(resolve => {
      finishSave = () => resolve(nextPlan);
    }));
    const { renderer } = await renderEditor({ onSave });

    await changeText(renderer, 'planning-editor-plan-title', 'Slow save');
    await pressAndLeaveRunning(renderer, 'planning-editor-save-draft');

    const draftButton = renderer.root.findByProps({ testID: 'planning-editor-save-draft' });
    expect(draftButton.props.pending).toBe(true);
    expect(renderer.root.findByProps({ testID: 'planning-editor-save-planned' }).props.disabled).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      finishSave(plan({}));
    });
    expect(renderer.root.findByProps({ testID: 'planning-editor-save-draft' }).props.pending).toBe(false);
  });

  test('goes back from the pinned back button', async () => {
    const onCancel = jest.fn();
    const { renderer } = await renderEditor({ onCancel });

    expect(exists(renderer, 'planning-editor-back-icon')).toBe(true);
    await press(renderer, 'planning-editor-back');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
