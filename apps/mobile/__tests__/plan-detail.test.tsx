import React from 'react';
import { AccessibilityInfo, Alert, type AlertButton } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import type { PlannedWatchDivesUpdateStatus } from '../src/companion/watch-link';
import { InstrumentButton } from '../src/components/ui/instrument';
import i18n from '../src/i18n';
import { PlanDetail } from '../src/screens/planning/plan-detail';
import type { DivePlan, DivePlanChecklistItem } from '../src/types/dive-plan';
import { createDefaultPlanChecklist } from '../src/utils/create-dive-plan';

type Renderer = ReactTestRenderer.ReactTestRenderer;
type AlertCall = { title: string; message?: string; buttons: AlertButton[] };

const plan = (overrides: Partial<DivePlan>): DivePlan => ({
  localId: 'plan-1',
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

const readyDraft = plan({
  status: 'draft',
  title: 'Ready draft',
  plannedAt: new Date(2026, 5, 20, 9, 30).getTime() / 1000,
  site: { name: 'Blue Wall' },
  diveMode: 'scuba',
  plannedValues: { plannedMaxDepthMeters: 18, plannedDurationMinutes: 45 },
});

const linkedWatch: PlannedWatchDivesUpdateStatus = {
  nativeBridgeAvailable: true,
  isSupported: true,
  isPaired: true,
  isWatchAppInstalled: true,
  isReachable: false,
  activationState: 'activated',
  payloadCount: 1,
  queuedCount: 0,
};

const renderers: Renderer[] = [];

type DetailProps = React.ComponentProps<typeof PlanDetail>;

async function render(props: Partial<DetailProps> & { plan: DivePlan }): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PlanDetail
        onBack={jest.fn()}
        onEdit={jest.fn()}
        onComplete={jest.fn()}
        onCreateLogFromPlan={jest.fn()}
        {...props}
      />,
    );
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

function textOf(renderer: Renderer, testID: string): string {
  const node = host(renderer, testID);
  if (!node) {
    throw new Error(`No element with testID ${testID}`);
  }
  const children = node.props.children as unknown;
  return Array.isArray(children) ? children.join('') : String(children);
}

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

function captureAlerts(): AlertCall[] {
  const calls: AlertCall[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
    calls.push({ title, message, buttons: buttons ?? [] });
  });
  return calls;
}

describe('Plan detail', () => {
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
    jest.useRealTimers();
  });

  afterAll(async () => {
    await i18n.changeLanguage('ko');
  });

  test('shows everything the plan holds in grouped sections, labelled as plans', async () => {
    const renderer = await render({
      plan: plan({
        status: 'planned',
        title: 'Blue Wall morning',
        plannedAt: new Date(2026, 5, 20, 9, 30).getTime() / 1000,
        site: { name: 'Blue Wall' },
        diveMode: 'scuba',
        entryStyle: 'boat',
        buddyIds: ['Mina', 'Alex'],
        gearIds: ['bcd-1'],
        tags: ['reef'],
        objective: 'Buoyancy',
        notes: 'Meet at 8',
        plannedValues: {
          plannedMaxDepthMeters: 24,
          plannedDurationMinutes: 45,
          gasLabel: 'Air',
          waterCondition: 'calm',
          visibilityExpectation: 4,
          perceivedDifficulty: 2,
          trainingFocus: 'Trim',
          plannedPressure: { unit: 'psi', start: 3000, end: 900 },
        },
      }),
    });

    expect(textOf(renderer, 'planning-detail-title')).toBe('Blue Wall morning');
    expect(textOf(renderer, 'planning-detail-row-site-value')).toBe('Blue Wall');
    expect(textOf(renderer, 'planning-detail-row-mode-value')).toBe('Scuba');
    expect(textOf(renderer, 'planning-detail-row-entry-style-value')).toBe('Boat');
    expect(textOf(renderer, 'planning-detail-row-planned-max-value')).toBe('24.0 m');
    expect(textOf(renderer, 'planning-detail-row-planned-duration-value')).toBe('45 min');
    expect(textOf(renderer, 'planning-detail-row-gas-value')).toBe('Air');
    expect(textOf(renderer, 'planning-detail-row-pressure-start-value')).toBe('3000 psi');
    expect(textOf(renderer, 'planning-detail-row-pressure-end-value')).toBe('900 psi');
    expect(textOf(renderer, 'planning-detail-row-water-condition-value')).toBe('Calm');
    expect(textOf(renderer, 'planning-detail-row-visibility-value')).toBe('4/5');
    expect(renderer.root.findByProps({ testID: 'planning-detail-row-visibility' }).props.accessibilityLabel).toBe(
      'Expected visibility, 4 of 5 stars',
    );
    expect(textOf(renderer, 'planning-detail-row-difficulty-value')).toBe('2/5');
    expect(textOf(renderer, 'planning-detail-row-buddies-value')).toBe('Mina, Alex');
    expect(textOf(renderer, 'planning-detail-row-gear-value')).toBe('bcd-1');
    expect(textOf(renderer, 'planning-detail-row-tags-value')).toBe('reef');
    // The objective stays visible next to the notes.
    expect(textOf(renderer, 'planning-detail-row-objective-value')).toBe('Buoyancy');
    expect(textOf(renderer, 'planning-detail-row-training-focus-value')).toBe('Trim');
    expect(textOf(renderer, 'planning-detail-row-notes-value')).toBe('Meet at 8');
    const footers = renderer.root.findAll(node => typeof node.type === 'string' && typeof node.props.children === 'string');
    expect(footers.some(node => node.props.children === 'These are planned values, not measurements.')).toBe(true);
    expect(footers.some(node => node.props.children === 'For planning notes only, not for tank pressure decisions.')).toBe(true);
  });

  test('shows unknown values as -- and hides empty optional sections', async () => {
    const renderer = await render({ plan: plan({ title: 'Bare draft' }) });

    expect(textOf(renderer, 'planning-detail-row-planned-at-value')).toBe('--');
    expect(textOf(renderer, 'planning-detail-row-site-value')).toBe('--');
    expect(textOf(renderer, 'planning-detail-row-planned-max-value')).toBe('-- m');
    expect(textOf(renderer, 'planning-detail-row-planned-duration-value')).toBe('-- min');
    expect(exists(renderer, 'planning-detail-row-buddies')).toBe(false);
    expect(exists(renderer, 'planning-detail-row-pressure-start')).toBe(false);
    expect(exists(renderer, 'planning-detail-checklist-progress')).toBe(false);
  });

  test('marks a planned dive whose day is over', async () => {
    const renderer = await render({ plan: plan({ status: 'planned', title: 'Old plan', plannedAt: 1600000000 }) });

    expect(renderer.root.findByProps({ testID: 'planning-detail-date-passed' }).props.label).toBe('Date passed');
  });

  test('shows the planned depth note above the supported watch depth', async () => {
    const renderer = await render({ plan: plan({ title: 'Deep', plannedValues: { plannedMaxDepthMeters: 42 } }) });

    const warning = textOf(renderer, 'planning-detail-unsupported-depth-warning');
    expect(warning).toContain('This plan is deeper than the app supports on Apple Watch');
    // Still a planning note, never safety guidance.
    expect(warning).toContain('do not use it for safety decisions');
  });

  test('translates default checklist items by id and saves a tap at once', async () => {
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
    let finishSave: () => void = () => undefined;
    const onSaveChecklist = jest.fn(
      (_items: DivePlanChecklistItem[]) =>
        new Promise<void>(resolve => {
          finishSave = resolve;
        }),
    );
    const renderer = await render({ plan: plan({ title: '체크', checklistItems: createDefaultPlanChecklist() }), onSaveChecklist });

    expect(textOf(renderer, 'planning-detail-checklist-progress')).toBe('0/3');
    const siteItem = renderer.root.findByProps({ testID: 'planning-detail-checklist-site' });
    expect(siteItem.props.accessibilityLabel).toBe('다이빙 포인트 상태 확인');
    expect(siteItem.props.accessibilityRole).toBe('checkbox');
    expect(siteItem.props.accessibilityState).toEqual({ checked: false, disabled: false });

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'planning-detail-checklist-site' }).props.onPress();
    });

    expect(onSaveChecklist).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'site', completed: true }),
      expect.objectContaining({ id: 'buddy', completed: false }),
      expect.objectContaining({ id: 'gear', completed: false }),
    ]);
    // The tap shows before the save finishes.
    expect(textOf(renderer, 'planning-detail-checklist-progress')).toBe('1/3');
    expect(renderer.root.findByProps({ testID: 'planning-detail-checklist-site' }).props.accessibilityState.checked).toBe(true);

    await ReactTestRenderer.act(async () => {
      finishSave();
    });
  });

  test('puts the stored checklist back with a note when the save fails', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const onSaveChecklist = jest.fn().mockRejectedValue(new Error('disk full'));
    const renderer = await render({ plan: plan({ title: 'Fails', checklistItems: createDefaultPlanChecklist() }), onSaveChecklist });

    await press(renderer, 'planning-detail-checklist-gear');

    expect(textOf(renderer, 'planning-detail-checklist-progress')).toBe('0/3');
    expect(textOf(renderer, 'planning-detail-checklist-error')).toBe('Could not save the checklist. Try again.');
    // The note shows under the list without moving focus, so VoiceOver hears it.
    expect(announce).toHaveBeenCalledWith('Could not save the checklist. Try again.');

    // A second failure is spoken again.
    await press(renderer, 'planning-detail-checklist-site');
    expect(announce.mock.calls.filter(([message]) => message === 'Could not save the checklist. Try again.')).toHaveLength(2);
  });

  test('says where a plan stands with the watch from what the phone knows', async () => {
    const planned = plan({ status: 'planned', title: 'Watch plan' });
    const sentVersions = new Map([[planned.localId, planned.updatedAt]]);

    const sent = await render({ plan: planned, watchSyncStatus: linkedWatch, watchSentPlanVersions: sentVersions });
    // A request without a receipt: the copy never says the watch has the plan.
    expect(textOf(sent, 'planning-detail-watch-status-value')).toBe('Watch transfer requested');

    const unpaired = await render({
      plan: planned,
      watchSyncStatus: { ...linkedWatch, isPaired: false },
      watchSentPlanVersions: sentVersions,
    });
    expect(textOf(unpaired, 'planning-detail-watch-status-value')).toBe('Watch transfer unconfirmed');

    const contextError = await render({
      plan: planned,
      watchSyncStatus: { ...linkedWatch, lastContextErrorCode: 7001 },
      watchSentPlanVersions: sentVersions,
    });
    expect(textOf(contextError, 'planning-detail-watch-status-value')).toBe('Watch transfer unconfirmed');

    const draft = await render({ plan: plan({ status: 'draft', title: 'Draft' }), watchSyncStatus: linkedWatch });
    expect(textOf(draft, 'planning-detail-watch-status-value')).toBe('iPhone only');

    const converted = await render({ plan: { ...planned, convertedLogLocalId: 'log-1' }, watchSyncStatus: linkedWatch });
    expect(textOf(converted, 'planning-detail-watch-status-value')).toBe('iPhone only');

    // Before the first handoff the phone does not know yet, so the row stays away.
    const unknown = await render({ plan: planned });
    expect(exists(unknown, 'planning-detail-watch-status')).toBe(false);
  });

  test('says requested only while the last watch update carried this version of the plan', async () => {
    const planned = plan({ status: 'planned', title: 'Watch plan', updatedAt: 200 });

    // An edit saved after the last update has not gone out yet.
    const edited = await render({
      plan: planned,
      watchSyncStatus: linkedWatch,
      watchSentPlanVersions: new Map([[planned.localId, 150]]),
    });
    expect(textOf(edited, 'planning-detail-watch-status-value')).toBe('Watch transfer unconfirmed');

    // A plan the last update did not carry at all, or a status without any carried versions.
    const missing = await render({
      plan: planned,
      watchSyncStatus: linkedWatch,
      watchSentPlanVersions: new Map([['another-plan', 200]]),
    });
    expect(textOf(missing, 'planning-detail-watch-status-value')).toBe('Watch transfer unconfirmed');
    const noVersions = await render({ plan: planned, watchSyncStatus: linkedWatch });
    expect(textOf(noVersions, 'planning-detail-watch-status-value')).toBe('Watch transfer unconfirmed');

    // Once an update carries the current version, the request is shown again.
    await ReactTestRenderer.act(async () => {
      edited.update(
        <PlanDetail
          plan={planned}
          onBack={jest.fn()}
          onEdit={jest.fn()}
          onComplete={jest.fn()}
          onCreateLogFromPlan={jest.fn()}
          watchSyncStatus={linkedWatch}
          watchSentPlanVersions={new Map([[planned.localId, 200]])}
        />,
      );
    });
    expect(textOf(edited, 'planning-detail-watch-status-value')).toBe('Watch transfer requested');
  });

  test('lists and announces the missing fields instead of promoting an incomplete draft', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const onPromote = jest.fn().mockResolvedValue(undefined);
    const renderer = await render({ plan: plan({ title: 'Idea', diveMode: 'scuba' }), onPromote });

    await press(renderer, 'planning-detail-promote');

    const message = 'To confirm this plan, fill in: Date & time, Dive site, Planned max depth, Planned dive time';
    expect(onPromote).not.toHaveBeenCalled();
    expect(textOf(renderer, 'planning-detail-promote-missing')).toBe(message);
    // The note shows under the button without moving focus, so VoiceOver is told.
    expect(announce).toHaveBeenCalledWith(message);
  });

  test('promotes a complete draft to planned', async () => {
    const onPromote = jest.fn().mockResolvedValue(undefined);
    const renderer = await render({ plan: readyDraft, onPromote });

    await press(renderer, 'planning-detail-promote');

    expect(onPromote).toHaveBeenCalledWith(readyDraft);
    expect(exists(renderer, 'planning-detail-promote-missing')).toBe(false);
  });

  test('asks in place whether to start a log draft after completing a plan', async () => {
    const alerts = captureAlerts();
    const planned = plan({ status: 'planned', title: 'Done soon', site: { name: 'Complete Reef' } });
    const completed = { ...planned, status: 'completed' as const, completedAt: 1781356000 };
    const onComplete = jest.fn().mockResolvedValue(completed);
    const onCreateLogFromPlan = jest.fn();
    const renderer = await render({ plan: planned, onComplete, onCreateLogFromPlan });

    await press(renderer, 'planning-detail-complete');

    expect(onComplete).toHaveBeenCalledWith(planned);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('Add a log now?');
    expect(alerts[0].buttons.map(button => button.text)).toEqual(['Later', 'Add log']);

    alerts[0].buttons.find(button => button.style === 'cancel')?.onPress?.();
    expect(onCreateLogFromPlan).not.toHaveBeenCalled();

    alerts[0].buttons.find(button => button.style !== 'cancel')?.onPress?.();
    expect(onCreateLogFromPlan).toHaveBeenCalledWith(completed);
  });

  test('completes with a tick that is still saving and locks the checklist while completing', async () => {
    captureAlerts();
    let finishChecklist: () => void = () => undefined;
    let finishComplete: () => void = () => undefined;
    const onSaveChecklist = jest.fn(
      (_items: DivePlanChecklistItem[]) =>
        new Promise<void>(resolve => {
          finishChecklist = resolve;
        }),
    );
    const onComplete = jest.fn(
      (_plan: DivePlan) =>
        new Promise<void>(resolve => {
          finishComplete = resolve;
        }),
    );
    const planned = plan({ status: 'planned', title: 'Race', checklistItems: createDefaultPlanChecklist() });
    const renderer = await render({ plan: planned, onSaveChecklist, onComplete });

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'planning-detail-checklist-site' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'planning-detail-complete' }).props.onPress();
    });

    // The completion carries the tick, so whichever save lands last keeps it.
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ checklistItems: expect.arrayContaining([expect.objectContaining({ id: 'site', completed: true })]) }),
    );
    // A tick during the status save would write a stale status back, so the rows wait.
    const gearItem = renderer.root.findByProps({ testID: 'planning-detail-checklist-gear' });
    expect(gearItem.props.disabled).toBe(true);
    expect(gearItem.props.accessibilityState).toEqual({ checked: false, disabled: true });

    await ReactTestRenderer.act(async () => {
      finishChecklist();
      finishComplete();
    });
    expect(renderer.root.findByProps({ testID: 'planning-detail-checklist-gear' }).props.disabled).toBe(false);
  });

  test('keeps the plan and shows a short error when a status change fails', async () => {
    const alerts = captureAlerts();
    const onComplete = jest.fn().mockRejectedValue(new Error('offline'));
    const renderer = await render({ plan: plan({ status: 'planned', title: 'Fails' }), onComplete });

    await press(renderer, 'planning-detail-complete');

    expect(alerts).toHaveLength(0);
    expect(textOf(renderer, 'planning-detail-action-error')).toBe('Could not change the plan status. Try again.');
  });

  test('opens the log made from a completed plan', async () => {
    const onOpenConvertedLog = jest.fn();
    const renderer = await render({
      plan: plan({ status: 'completed', title: 'Logged', convertedLogLocalId: 'log-existing' }),
      hasExistingConvertedLog: true,
      onOpenConvertedLog,
    });

    expect(exists(renderer, 'planning-detail-create-log')).toBe(false);
    await press(renderer, 'planning-detail-open-log');

    expect(onOpenConvertedLog).toHaveBeenCalledWith('log-existing');
  });

  test('offers log creation again when the connected log is missing', async () => {
    const onCreateLogFromPlan = jest.fn();
    const completed = plan({ status: 'completed', title: 'Lost log', convertedLogLocalId: 'log-deleted' });
    const renderer = await render({ plan: completed, hasExistingConvertedLog: false, onCreateLogFromPlan });

    expect(exists(renderer, 'planning-detail-open-log')).toBe(false);
    await press(renderer, 'planning-detail-create-log');

    expect(onCreateLogFromPlan).toHaveBeenCalledWith(completed);
  });

  test('has one status action per status', async () => {
    const draft = await render({ plan: readyDraft, onPromote: jest.fn() });
    expect(exists(draft, 'planning-detail-promote')).toBe(true);
    expect(exists(draft, 'planning-detail-complete')).toBe(false);

    const planned = await render({ plan: { ...readyDraft, status: 'planned' }, onPromote: jest.fn() });
    expect(exists(planned, 'planning-detail-promote')).toBe(false);
    expect(exists(planned, 'planning-detail-complete')).toBe(true);
  });

  test('edits from the header and goes back', async () => {
    const onEdit = jest.fn();
    const onBack = jest.fn();
    const renderer = await render({ plan: readyDraft, onEdit, onBack });

    expect(exists(renderer, 'planning-detail-back-icon')).toBe(true);
    // The same secondary pill the log detail uses, not blue text.
    const edit = renderer.root.find(node => node.props.testID === 'planning-detail-edit' && node.type === InstrumentButton);
    expect(edit.props.label).toBe('Edit plan');
    expect(edit.props.variant).toBeUndefined();
    expect(edit.props.className).toBe('min-h-11 px-4 py-2');
    await press(renderer, 'planning-detail-edit');
    await press(renderer, 'planning-detail-back');

    expect(onEdit).toHaveBeenCalledWith(readyDraft);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('shows and announces a short error when deleting fails', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const alerts = captureAlerts();
    const onDelete = jest.fn().mockRejectedValue(new Error('offline'));
    const renderer = await render({ plan: readyDraft, onDelete });

    await press(renderer, 'planning-detail-delete');
    await ReactTestRenderer.act(async () => {
      alerts[0].buttons.find(button => button.style === 'destructive')?.onPress?.();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    expect(onDelete).toHaveBeenCalledWith(readyDraft.localId);
    expect(textOf(renderer, 'planning-detail-delete-error')).toBe('Could not delete this plan. Try again.');
    expect(announce).toHaveBeenCalledWith('Could not delete this plan. Try again.');
  });

  test('keeps the delete row busy while deleting, with a spinner only after the delay', async () => {
    jest.useFakeTimers();
    const alerts = captureAlerts();
    let finishDelete: () => void = () => undefined;
    const onDelete = jest.fn(
      () =>
        new Promise<void>(resolve => {
          finishDelete = resolve;
        }),
    );
    const renderer = await render({ plan: readyDraft, onDelete });
    const deleteRow = () => host(renderer, 'planning-detail-delete')!;
    const deletePressable = renderer.root.findAll(
      node => node.props.testID === 'planning-detail-delete' && typeof node.props.onPress === 'function',
    )[0];

    await ReactTestRenderer.act(async () => {
      deletePressable.props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      alerts[0].buttons.find(button => button.style === 'destructive')?.onPress?.();
    });

    // Busy and disabled from the confirm itself, so a second tap cannot delete twice.
    expect(deleteRow().props.accessibilityState).toEqual(expect.objectContaining({ busy: true, disabled: true }));
    expect(exists(renderer, 'planning-detail-delete-spinner')).toBe(false);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(exists(renderer, 'planning-detail-delete-spinner')).toBe(true);

    await ReactTestRenderer.act(async () => {
      finishDelete();
    });
    expect(deleteRow().props.accessibilityState).toEqual(expect.objectContaining({ busy: false, disabled: false }));
  });
});
