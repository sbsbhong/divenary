import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import i18n from '../src/i18n';
import { LogEntryDetail } from '../src/screens/logbook/log-entry-detail';
import { PlanDetail } from '../src/screens/planning/plan-detail';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import { createBlankDivePlan } from '../src/utils/create-dive-plan';
import { watchSessionToDiveLogEntry } from '../src/utils/watch-session-to-dive-log-entry';

const watchEntry: DiveLogEntry = watchSessionToDiveLogEntry({
  now: 1781353000,
  session: {
    localSessionId: 'watch-entry-1',
    schemaVersion: 1,
    siteName: 'Watch Reef',
    syncStatus: 'pending',
    startedAt: 1781352000,
    endedAt: 1781352600,
    maxDepthMeters: 12,
    samples: [],
  },
});

type AlertCall = {
  title: string;
  message?: string;
  buttons: AlertButton[];
};

function captureAlerts(): AlertCall[] {
  const calls: AlertCall[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
    calls.push({ title, message, buttons: buttons ?? [] });
  });
  return calls;
}

async function render(element: React.JSX.Element): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer!;
}

async function pressDelete(renderer: ReactTestRenderer.ReactTestRenderer, testID: string): Promise<void> {
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID }).props.onPress();
  });
}

function destructiveButton(call: AlertCall): AlertButton {
  const button = call.buttons.find(candidate => candidate.style === 'destructive');
  expect(button).toBeDefined();
  return button!;
}

describe('destructive action confirmation', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ko');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('asks before deleting a local manual log and deletes only after confirmation', async () => {
    const alerts = captureAlerts();
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const entry = createBlankDiveLogEntry({ now: 1781353000 });
    const renderer = await render(<LogEntryDetail entry={entry} onDelete={onDelete} />);

    await pressDelete(renderer, 'log-entry-detail-delete');

    expect(onDelete).not.toHaveBeenCalled();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('로그를 삭제할까요?');
    expect(alerts[0].message).toBe('이 작업은 되돌릴 수 없습니다.');
    expect(alerts[0].buttons.map(button => [button.text, button.style])).toEqual([
      ['취소', 'cancel'],
      ['삭제', 'destructive'],
    ]);

    await ReactTestRenderer.act(async () => {
      destructiveButton(alerts[0]).onPress?.();
    });

    expect(onDelete).toHaveBeenCalledWith(entry.localId);
  });

  test('does not delete when the confirmation is cancelled', async () => {
    const alerts = captureAlerts();
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const renderer = await render(<LogEntryDetail entry={createBlankDiveLogEntry({ now: 1781353000 })} onDelete={onDelete} />);

    await pressDelete(renderer, 'log-entry-detail-delete');
    await ReactTestRenderer.act(async () => {
      alerts[0].buttons.find(button => button.style === 'cancel')?.onPress?.();
    });

    expect(onDelete).not.toHaveBeenCalled();
  });

  test('warns that deleting a watch log also removes the original recording on the watch', async () => {
    const alerts = captureAlerts();
    const renderer = await render(<LogEntryDetail entry={watchEntry} onDelete={jest.fn()} />);

    await pressDelete(renderer, 'log-entry-detail-delete');

    expect(alerts[0].message).toBe('워치의 원본 기록도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.');
  });

  test('warns that deleting an account-synced watch log removes the watch original and synced copies', async () => {
    const alerts = captureAlerts();
    const accountEntry: DiveLogEntry = { ...watchEntry, ownerUserId: 'user-1' };
    const renderer = await render(<LogEntryDetail entry={accountEntry} onDelete={jest.fn()} />);

    await pressDelete(renderer, 'log-entry-detail-delete');

    expect(alerts[0].message).toBe(
      '워치의 원본 기록과 계정에 동기화된 사본도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.',
    );
  });

  test('asks before deleting a plan', async () => {
    const alerts = captureAlerts();
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const plan = createBlankDivePlan({ now: 1781353000 });
    const renderer = await render(
      <PlanDetail
        plan={plan}
        onBack={jest.fn()}
        onEdit={jest.fn()}
        onComplete={jest.fn()}
        onDelete={onDelete}
        onCreateLogFromPlan={jest.fn()}
      />,
    );

    await pressDelete(renderer, 'planning-detail-delete');

    expect(onDelete).not.toHaveBeenCalled();
    expect(alerts[0].title).toBe('계획을 삭제할까요?');
    expect(alerts[0].message).toBe('이 작업은 되돌릴 수 없습니다.');

    await ReactTestRenderer.act(async () => {
      destructiveButton(alerts[0]).onPress?.();
    });

    expect(onDelete).toHaveBeenCalledWith(plan.localId);
  });
});
