import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import scubaFixture from '../../../packages/contracts/fixtures/scuba-safety-stop-watch-sync-message.json';
import { StatusPill } from '../src/components/ui/instrument';
import i18n from '../src/i18n';
import { LogEntryDetail } from '../src/screens/logbook/log-entry-detail';
import type { WatchSession } from '../src/types/dive-session';
import { watchSessionToDiveLogEntry } from '../src/utils/watch-session-to-dive-log-entry';

async function render(element: React.JSX.Element): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer!;
}

function scubaSessionWithStopStatus(status: string): WatchSession {
  const session = scubaFixture.session as WatchSession & { diveMode: 'scuba' };
  return {
    ...session,
    scuba: {
      ...session.scuba,
      safetyStop: { ...session.scuba.safetyStop, status, completed: false, remainingSeconds: 95 },
    },
  } as WatchSession;
}

describe('status tones', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ko');
  });

  test('renders the warning tone with the amber warning token instead of primary blue', async () => {
    const renderer = await render(<StatusPill testID="pill" label="Paused" tone="warning" />);
    const [styledText] = renderer.root.findAll(
      node => node.props.testID === 'pill' && typeof node.props.className === 'string',
    );
    const className = String(styledText?.props.className);

    expect(className).toContain('text-warning');
    expect(className).not.toContain('text-primary');
  });

  test('shows an incomplete recommended stop in the caution tone with recommended wording', async () => {
    const entry = watchSessionToDiveLogEntry({
      session: scubaSessionWithStopStatus('skippedOrIncomplete'),
      now: 1783228100,
      localId: 'log-incomplete-stop',
    });
    const renderer = await render(<LogEntryDetail entry={entry} />);
    const root = renderer.root;
    const pill = root.findByProps({ testID: 'log-entry-detail-safety-stop-pill' });

    expect(pill.props.tone).toBe('warning');
    expect(
      root.findAll(node => node.props.children === '권장 스탑 미완료').length,
    ).toBeGreaterThan(0);
  });
});
