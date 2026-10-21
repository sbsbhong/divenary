import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import i18n from '../src/i18n';
import LogbookScreen from '../src/screens/logbook/screen';
import PlanningScreen from '../src/screens/planning/screen';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import { createBlankDivePlan } from '../src/utils/create-dive-plan';

jest.mock('../src/native/watch-connectivity', () => ({
  isWatchConnectivityAvailable: () => false,
  drainPendingWatchConnectivityPayloads: jest.fn(),
  acknowledgeWatchConnectivityPayloads: jest.fn(),
  acknowledgeImportedWatchConnectivityPayloads: jest.fn(),
  subscribeToWatchConnectivityPayloads: () => ({ remove: jest.fn() }),
}));

const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

async function render(element: React.JSX.Element): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  renderers.push(renderer!);
  return renderer!;
}

async function press(renderer: ReactTestRenderer.ReactTestRenderer, testID: string): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await renderer.root.findByProps({ testID }).props.onPress();
  });
}

function textOf(renderer: ReactTestRenderer.ReactTestRenderer, testID: string): string {
  const node = renderer.root.findAll(candidate => candidate.props.testID === testID && candidate.props.children !== undefined)[0];
  return React.Children.toArray(node?.props.children).join('');
}

function logbookProps(overrides: Partial<React.ComponentProps<typeof LogbookScreen>> = {}): React.ComponentProps<typeof LogbookScreen> {
  return {
    entries: [],
    filter: { query: '' },
    onFilterChange: jest.fn(),
    onSyncWatch: jest.fn(async () => ({ receivedCount: 0, importedCount: 0, failedCount: 0, unavailable: false })),
    onRefresh: jest.fn(),
    onSaveEntry: jest.fn(async (entry: DiveLogEntry) => entry),
    onDeleteEntry: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('list and sync feedback states', () => {
  beforeEach(async () => {
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  test('reports watch recordings that were not imported alongside the imported count', async () => {
    const onSyncWatch = jest.fn(async () => ({ receivedCount: 3, importedCount: 2, failedCount: 1, unavailable: false }));
    const renderer = await render(<LogbookScreen {...logbookProps({ onSyncWatch })} />);

    await press(renderer, 'logbook-import-action');

    expect(textOf(renderer, 'logbook-sync-toast')).toBe('워치 기록 2개를 가져왔고 1개는 아직 가져오지 못했습니다.');
  });

  test('distinguishes a search with no matches from an empty logbook', async () => {
    const onFilterChange = jest.fn();
    const renderer = await render(
      <LogbookScreen {...logbookProps({ filter: { query: 'manta' }, totalEntryCount: 2, onFilterChange })} />,
    );

    expect(renderer.root.findAllByProps({ testID: 'logbook-empty-state' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'logbook-no-results-state' }).length).toBeGreaterThan(0);

    await press(renderer, 'logbook-no-results-state-action');

    expect(onFilterChange).toHaveBeenCalledWith({ query: '' });
  });

  test('shows a retryable error when the logbook cannot be read', async () => {
    const onRefresh = jest.fn();
    const renderer = await render(<LogbookScreen {...logbookProps({ loadError: new Error('storage'), onRefresh })} />);

    expect(renderer.root.findAllByProps({ testID: 'logbook-empty-state' })).toHaveLength(0);
    await press(renderer, 'logbook-error-state-action');

    expect(onRefresh).toHaveBeenCalled();
  });

  test('explains an empty plan filter and offers every plan again', async () => {
    const plan = { ...createBlankDivePlan({ now: 1781353000 }), status: 'draft' as const };
    const renderer = await render(<PlanningScreen sessions={[]} plans={[plan]} onRefresh={jest.fn()} onOpenLogbook={jest.fn()} />);
    const completedFilter = renderer.root
      .findAll(node => node.props.label === '완료됨' && typeof node.props.onPress === 'function')[0];

    await ReactTestRenderer.act(async () => {
      completedFilter!.props.onPress();
    });

    expect(renderer.root.findAllByProps({ testID: 'planning-empty-state' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'planning-filter-empty-state' }).length).toBeGreaterThan(0);

    await press(renderer, 'planning-filter-empty-state-action');

    expect(renderer.root.findAllByProps({ testID: 'planning-filter-empty-state' })).toHaveLength(0);
  });

  test('shows a retryable error when plans cannot be read', async () => {
    const onRefresh = jest.fn();
    const renderer = await render(
      <PlanningScreen sessions={[]} plans={[]} loadError={new Error('storage')} onRefresh={onRefresh} onOpenLogbook={jest.fn()} />,
    );

    await press(renderer, 'planning-error-state-action');

    expect(onRefresh).toHaveBeenCalled();
  });
});
