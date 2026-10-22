import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import i18n from '../src/i18n';
import { LogEntryDetail } from '../src/screens/logbook/log-entry-detail';
import { PlanDetail } from '../src/screens/planning/plan-detail';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import { createBlankDivePlan } from '../src/utils/create-dive-plan';

async function render(element: React.JSX.Element): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer!;
}

async function press(renderer: ReactTestRenderer.ReactTestRenderer, testID: string): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await renderer.root.findByProps({ testID }).props.onPress();
  });
}

describe('sync conflict banner', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ko');
  });

  test('offers both versions for a conflicted log and reports the choice', async () => {
    const onResolveConflict = jest.fn().mockResolvedValue(undefined);
    const entry = { ...createBlankDiveLogEntry({ now: 1781353000 }), cloudSyncStatus: 'conflict' as const };
    const renderer = await render(<LogEntryDetail entry={entry} onResolveConflict={onResolveConflict} />);

    expect(renderer.root.findByProps({ testID: 'sync-conflict-title' }).props.children).toBe(
      '다른 기기에서 수정한 내용이 있습니다',
    );
    await press(renderer, 'sync-conflict-keep-local');
    await press(renderer, 'sync-conflict-use-remote');

    expect(onResolveConflict.mock.calls).toEqual([['keepLocal'], ['useRemote']]);
  });

  test('explains a failed resolution without hiding the choices', async () => {
    const onResolveConflict = jest.fn().mockRejectedValue(new Error('offline'));
    const entry = { ...createBlankDiveLogEntry({ now: 1781353000 }), cloudSyncStatus: 'conflict' as const };
    const renderer = await render(<LogEntryDetail entry={entry} onResolveConflict={onResolveConflict} />);

    await press(renderer, 'sync-conflict-use-remote');

    expect(renderer.root.findByProps({ testID: 'sync-conflict-error' }).props.children).toBe(
      '선택한 내용을 저장하지 못했습니다. 다시 시도해 주세요.',
    );
    expect(renderer.root.findByProps({ testID: 'sync-conflict-keep-local' })).toBeTruthy();
  });

  test('shows no conflict banner for a synced log', async () => {
    const entry = { ...createBlankDiveLogEntry({ now: 1781353000 }), cloudSyncStatus: 'synced' as const };
    const renderer = await render(<LogEntryDetail entry={entry} onResolveConflict={jest.fn()} />);

    expect(renderer.root.findAllByProps({ testID: 'sync-conflict-title' })).toHaveLength(0);
  });

  test('offers both versions for a conflicted plan', async () => {
    const onResolveConflict = jest.fn().mockResolvedValue(undefined);
    const plan = { ...createBlankDivePlan({ now: 1781353000 }), cloudSyncStatus: 'conflict' as const };
    const renderer = await render(
      <PlanDetail
        plan={plan}
        onBack={jest.fn()}
        onEdit={jest.fn()}
        onComplete={jest.fn()}
        onCreateLogFromPlan={jest.fn()}
        onResolveConflict={onResolveConflict}
      />,
    );

    await press(renderer, 'sync-conflict-keep-local');

    expect(onResolveConflict).toHaveBeenCalledWith('keepLocal');
  });
});
