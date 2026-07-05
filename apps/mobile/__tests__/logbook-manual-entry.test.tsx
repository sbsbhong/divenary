import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { KeyboardAvoidingView, RefreshControl, ScrollView } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import metadataRichFixture from '../../../packages/contracts/fixtures/metadata-rich-watch-sync-message.json';
import { ButtonIcon } from '../src/components/ui/button';
import { EditIcon } from '../src/components/ui/icon';
import i18n from '../src/i18n';
import { LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import { LogEntryEditor } from '../src/screens/logbook/log-entry-editor';
import { logEntryFormSchema } from '../src/screens/logbook/log-entry-form-schema';
import LogbookScreen from '../src/screens/logbook/screen';
import { useDiveLogbook } from '../src/states/use-dive-logbook';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { WatchSession } from '../src/types/dive-session';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import { watchSessionToDiveLogEntry } from '../src/utils/watch-session-to-dive-log-entry';

const mockIsWatchConnectivityAvailable = jest.fn();
const mockDrainPendingWatchConnectivityPayloads = jest.fn();
const mockAcknowledgeWatchConnectivityPayloads = jest.fn();
const mockAcknowledgeImportedWatchConnectivityPayloads = jest.fn();

jest.mock('../src/native/watch-connectivity', () => ({
  isWatchConnectivityAvailable: () => mockIsWatchConnectivityAvailable(),
  drainPendingWatchConnectivityPayloads: () => mockDrainPendingWatchConnectivityPayloads(),
  acknowledgeWatchConnectivityPayloads: (payloadIds: readonly string[]) => mockAcknowledgeWatchConnectivityPayloads(payloadIds),
  acknowledgeImportedWatchConnectivityPayloads: (payloadIds: readonly string[]) =>
    mockAcknowledgeImportedWatchConnectivityPayloads(payloadIds),
  subscribeToWatchConnectivityPayloads: () => ({ remove: jest.fn() }),
}));

class ToggleFailSaveRepository extends LocalDiveLogRepository {
  shouldFailSave = true;

  async save(entry: DiveLogEntry): Promise<DiveLogEntry> {
    if (this.shouldFailSave) {
      throw new Error('local save unavailable');
    }

    return super.save(entry);
  }
}

const watchEntry = watchSessionToDiveLogEntry({
  now: 1781353000,
  session: {
    localSessionId: 'watch-entry-1',
    schemaVersion: 1,
    siteName: 'Watch Reef',
    syncStatus: 'pending',
    startedAt: 1781352000,
    endedAt: 1781352600,
    maxDepthMeters: 12,
    averageDepthMeters: 7,
    diveMode: 'scuba',
    scuba: {
      gasLabel: 'Air',
      maxDepthMeters: 12,
      averageDepthMeters: 7,
      latestAscentRateMetersPerMinute: 0,
      maxAscentRateMetersPerMinute: 0,
      safetyStop: {
        status: 'notRequired',
        required: false,
        completed: false,
        targetDepthMeters: 5,
        minDepthMeters: 3,
        maxDepthMeters: 6,
        durationSeconds: 180,
        remainingSeconds: 180,
        timeInZoneSeconds: 0,
      },
    },
    samples: [],
  } satisfies WatchSession,
});

const demoWatchEntry: DiveLogEntry = {
  ...watchEntry,
  localId: 'watch:demo-watch-entry-1:1781352600',
  manual: {
    ...watchEntry.manual,
    site: { name: 'Demo Reef' },
  },
  watchCapture: {
    ...watchEntry.watchCapture!,
    importKey: 'demo-watch-entry-1:1781352600',
    session: {
      ...watchEntry.watchCapture!.session,
      localSessionId: 'demo-watch-entry-1',
      siteName: 'Demo Reef',
      captureMode: 'demo',
    },
  },
};

const secondPreciseWatchEntry = watchSessionToDiveLogEntry({
  now: 1781353000,
  session: {
    localSessionId: 'watch-entry-second-precise',
    schemaVersion: 1,
    siteName: 'Second Precise Reef',
    syncStatus: 'pending',
    startedAt: 1781352000,
    endedAt: 1781352602,
    maxDepthMeters: 18.6,
    averageDepthMeters: 8,
    diveMode: 'freedive',
    freedive: {
      diveCount: 1,
      maxDepthMeters: 18.6,
      longestDiveDurationSeconds: 602,
      segments: [],
    },
    samples: [],
  } satisfies WatchSession,
});

const manualEntry = createBlankDiveLogEntry({ localId: 'manual-entry-1', now: 1781351000 });
manualEntry.manual = {
  ...manualEntry.manual,
  site: { name: 'Manual Reef' },
  buddyIds: ['Jin'],
  tags: ['shore'],
  observedMarineLife: ['octopus'],
  notes: 'Manual review note.',
  rating: 4,
  measuredValues: {
    startedAt: 1781350200,
    durationSeconds: 2400,
    maxDepthMeters: 18,
    diveMode: 'freedive',
  },
};

const manualEntryWithoutMetrics = createBlankDiveLogEntry({ localId: 'manual-entry-no-metrics', now: 1781351000 });
manualEntryWithoutMetrics.manual = {
  ...manualEntryWithoutMetrics.manual,
  site: { name: 'No Metrics Reef' },
  measuredValues: {
    startedAt: 1781350200,
    diveMode: 'scuba',
  },
};

const scubaEntry = createBlankDiveLogEntry({ localId: 'manual-entry-scuba', now: 1781351000 });
scubaEntry.manual = {
  ...scubaEntry.manual,
  site: { name: 'Scuba Metadata Reef' },
  gearIds: ['bcd-1', 'computer-1'],
  measuredValues: {
    startedAt: 1781350200,
    durationSeconds: 2700,
    maxDepthMeters: 20,
    diveMode: 'scuba',
    gasLabel: 'EAN32',
    waterCondition: 'mild',
    visibilityRating: 4,
    perceivedExertion: 3,
    pressure: { unit: 'bar', start: 200, end: 70 },
  },
};

const hybridWatchEntry: DiveLogEntry = {
  ...watchEntry,
  localId: 'watch-entry-hybrid',
  manual: {
    ...watchEntry.manual,
    site: { name: 'Hybrid Reef' },
    measuredValues: {
      ...watchEntry.manual.measuredValues,
      maxDepthMeters: 19,
    },
  },
  provenance: {
    ...watchEntry.provenance,
    maxDepthMeters: 'manual',
  },
};

type HarnessProps = {
  repository: LocalDiveLogRepository;
  pendingDraft?: {
    entry: DiveLogEntry;
    sourcePlanLocalId?: string;
  };
  onPendingDraftSave?: (entry: DiveLogEntry, sourcePlanLocalId?: string) => void;
  onOpenEntry?: (entry: DiveLogEntry) => void;
  onCreateEntry?: () => void;
};

const queryClients: QueryClient[] = [];
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

function Harness({ repository, pendingDraft, onPendingDraftSave, onOpenEntry, onCreateEntry }: HarnessProps): React.JSX.Element {
  const logbook = useDiveLogbook({ repository, queryScope: 'manual-entry-test' });

  return (
    <LogbookScreen
      entries={logbook.filteredEntries}
      filter={logbook.filter}
      onFilterChange={logbook.setFilter}
      onSyncWatch={logbook.syncWatchPayloads}
      onRefresh={logbook.refresh}
      isRefreshing={logbook.isRefreshing}
      onSaveEntry={logbook.saveEntry}
      onDeleteEntry={logbook.deleteEntry}
      saveError={logbook.saveError}
      isSaving={logbook.isSaving}
      pendingDraft={pendingDraft}
      onPendingDraftSave={onPendingDraftSave}
      onOpenEntry={onOpenEntry}
      onCreateEntry={onCreateEntry}
    />
  );
}

const renderLogbook = async (
  repository: LocalDiveLogRepository,
  options: {
    pendingDraft?: {
      entry: DiveLogEntry;
      sourcePlanLocalId?: string;
    };
    onPendingDraftSave?: (entry: DiveLogEntry, sourcePlanLocalId?: string) => void;
    onOpenEntry?: (entry: DiveLogEntry) => void;
    onCreateEntry?: () => void;
    reselectToken?: number;
    onRefresh?: () => void | Promise<void>;
  } = {},
) => {
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
          pendingDraft={options.pendingDraft}
          onPendingDraftSave={options.onPendingDraftSave}
          onOpenEntry={options.onOpenEntry}
          onCreateEntry={options.onCreateEntry}
        />
      </QueryClientProvider>,
    );
  });

  renderers.push(renderer!);
  return renderer!;
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
    if (typeof field.props.onChange === 'function') {
      field.props.onChange(value);
      return;
    }

    field.props.onChangeText(formatTestDate(value));
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

const changeTextInput = async (root: ReactTestRenderer.ReactTestInstance, testID: string, value: string) => {
  await ReactTestRenderer.act(async () => {
    root.findByProps({ testID: `${testID}-input-trigger` }).props.onPress();
  });

  await ReactTestRenderer.act(async () => {
    const input = root.findAllByProps({ testID: `${testID}-input` }).find(match => typeof match.props.onChangeText === 'function');
    input!.props.onChangeText(value);
  });

  await ReactTestRenderer.act(async () => {
    const input = root.findAllByProps({ testID: `${testID}-input` }).find(match => typeof match.props.onSubmitEditing === 'function');
    input!.props.onSubmitEditing();
  });
};

const numericTestIDs = new Set([
  'log-entry-editor-max-depth',
  'log-entry-editor-repetition-count',
  'log-entry-editor-pressure-start',
  'log-entry-editor-pressure-end',
]);

const findInputLike = (root: ReactTestRenderer.ReactTestInstance, testID: string): ReactTestRenderer.ReactTestInstance => {
  const matches = root.findAllByProps({ testID });
  return (
    matches.find(match => typeof match.props.onChangeText === 'function') ??
    matches.find(match => typeof match.props.onChange === 'function') ??
    matches.find(match => typeof match.props.onValueChange === 'function') ??
    root.findByProps({ testID })
  );
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

const fillManualDraft = async (
  root: ReactTestRenderer.ReactTestInstance,
  overrides: Partial<Record<string, string>> = {},
  mode: NonNullable<WatchSession['diveMode']> = 'freedive',
) => {
  await press(root, `log-entry-editor-mode-${mode}`);
  await changeDateTime(root, 'log-entry-editor-started-at', new Date('2026-06-20T09:30:00'));

  const values = {
    'log-entry-editor-site-name': 'Blue Corner',
    'log-entry-editor-duration': '47:00',
    'log-entry-editor-max-depth': '18.6',
    'log-entry-editor-buddies-input': 'Mina, Alex,',
    'log-entry-editor-tags-input': 'reef, training,',
    'log-entry-editor-marine-life-input': 'turtle, nudibranch,',
    'log-entry-editor-notes': 'Calm review dive with clear water.',
    ...overrides,
  };

  for (const [testID, value] of Object.entries(values)) {
    if (root.findAllByProps({ testID }).length > 0) {
      if (testID === 'log-entry-editor-duration') {
        await changeTextInput(root, testID, value);
        continue;
      }

      if (numericTestIDs.has(testID) && value.trim().length > 0 && Number.isFinite(Number(value)) && Number(value) >= 0) {
        await changeNumber(root, testID, Number(value));
        continue;
      }

      await changeText(root, testID, value);
    }
  }

  if (!Object.prototype.hasOwnProperty.call(overrides, 'log-entry-editor-rating')) {
    await press(root, 'log-entry-editor-rating-star-5');
  }
};

const formatTestDate = (value: Date): string => {
  const pad = (input: number) => `${input}`.padStart(2, '0');

  return [
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  ].join(' ');
};

describe('Logbook manual entry flow', () => {
  beforeEach(() => {
    mockIsWatchConnectivityAvailable.mockReturnValue(false);
    mockDrainPendingWatchConnectivityPayloads.mockResolvedValue([]);
    mockAcknowledgeWatchConnectivityPayloads.mockResolvedValue(undefined);
    mockAcknowledgeImportedWatchConnectivityPayloads.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount();
      }
    });

    for (const queryClient of queryClients.splice(0)) {
      queryClient.clear();
    }

    jest.clearAllMocks();
  });

  test('create action opens the manual editor', async () => {
    const renderer = await renderLogbook(new LocalDiveLogRepository([]));
    const root = renderer.root;

    await press(root, 'logbook-create-action');

    expect(root.findByProps({ testID: 'log-entry-editor-site-name' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-save' })).toBeTruthy();
  });

  test('manual editor shows a back icon for local navigation', async () => {
    const renderer = await renderLogbook(new LocalDiveLogRepository([]));
    const root = renderer.root;

    await press(root, 'logbook-create-action');

    expect(root.findByProps({ testID: 'log-entry-editor-back-icon' })).toBeTruthy();
    await press(root, 'log-entry-editor-back');

    expect(root.findAllByProps({ testID: 'log-entry-editor-title' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'logbook-create-action' })).toBeTruthy();
  });

  test('manual editor exposes only scuba and freedive modes', async () => {
    const renderer = await renderLogbook(new LocalDiveLogRepository([]));
    const root = renderer.root;

    await press(root, 'logbook-create-action');

    expect(root.findByProps({ testID: 'log-entry-editor-mode-scuba' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-mode-freedive' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'log-entry-editor-mode-snorkel' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'log-entry-editor-mode-pool' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'log-entry-editor-pool-length' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'log-entry-editor-lap-count' })).toHaveLength(0);
  });

  test('uses clearer logbook action labels', async () => {
    const renderer = await renderLogbook(new LocalDiveLogRepository([]));
    const root = renderer.root;

    expect(root.findByProps({ testID: 'logbook-create-action' }).props.label).toBe('Write');
    expect(root.findByProps({ testID: 'logbook-import-action' }).props.label).toBe('Sync Watch');
    const createActionIcon = root.findByProps({ testID: 'logbook-create-action-icon' });
    expect(createActionIcon.findByType(ButtonIcon).props.as).toBe(EditIcon);
    expect(root.findAllByProps({ testID: 'logbook-import-action-icon' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'logbook-search-icon' })).toBeTruthy();
  });

  test('keeps logbook inputs in a keyboard-aware scroll container', async () => {
    const renderer = await renderLogbook(new LocalDiveLogRepository([]));
    const root = renderer.root;

    expect(root.findByType(KeyboardAvoidingView).props.behavior).toBe('padding');
    expect(root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
  });

  test('uses native pull-to-refresh on the logbook scroll view', async () => {
    const renderer = await renderLogbook(new LocalDiveLogRepository([]));
    const refreshControl = renderer.root.findByType(ScrollView).props.refreshControl;

    expect(refreshControl.type).toBe(RefreshControl);
    expect(refreshControl.props.refreshing).toBe(false);
  });

  test('refreshes when the active logbook tab is selected again', async () => {
    const onRefresh = jest.fn();

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
      renderer = ReactTestRenderer.create(
        <LogbookScreen
          entries={[]}
          filter={{ query: '' }}
          onFilterChange={jest.fn()}
          onSyncWatch={async () => ({ importedCount: 0, receivedCount: 0, unavailable: false })}
          onRefresh={onRefresh}
          onSaveEntry={jest.fn()}
          onDeleteEntry={jest.fn()}
          reselectToken={0}
        />,
      );
    });

    await ReactTestRenderer.act(async () => {
      renderer!.update(
        <LogbookScreen
          entries={[]}
          filter={{ query: '' }}
          onFilterChange={jest.fn()}
          onSyncWatch={async () => ({ importedCount: 0, receivedCount: 0, unavailable: false })}
          onRefresh={onRefresh}
          onSaveEntry={jest.fn()}
          onDeleteEntry={jest.fn()}
          reselectToken={1}
        />,
      );
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test('import action drains pending WatchConnectivity payloads into the logbook', async () => {
    const repository = new LocalDiveLogRepository([]);
    const payload = {
      ...metadataRichFixture,
      session: {
        ...metadataRichFixture.session,
        localSessionId: 'button-drain-session',
        siteName: 'Button Drain Reef',
        endedAt: 1781359999,
      },
    };
    mockIsWatchConnectivityAvailable.mockReturnValue(true);
    mockDrainPendingWatchConnectivityPayloads.mockResolvedValue([
      {
        payloadId: 'button-payload-1',
        payloadJson: JSON.stringify(payload),
        localSessionId: 'button-drain-session',
        receivedAt: 1781360100,
      },
    ]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-import-action');

    const entries = await repository.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].watchCapture?.session.localSessionId).toBe('button-drain-session');
    expect(root.findByProps({ testID: 'logbook-list-item-Button Drain Reef' })).toBeTruthy();
    expect(root.findByProps({ testID: 'logbook-sync-toast' }).props.children).toBe('Imported 1 watch log.');
    expect(mockAcknowledgeImportedWatchConnectivityPayloads).toHaveBeenCalledWith(['button-payload-1']);
  });

  test('manual watch sync tells the user when there are no new watch logs', async () => {
    const repository = new LocalDiveLogRepository([]);
    mockIsWatchConnectivityAvailable.mockReturnValue(true);
    mockDrainPendingWatchConnectivityPayloads.mockResolvedValue([]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-import-action');

    expect(root.findByProps({ testID: 'logbook-sync-toast' }).props.children).toBe('No new watch logs.');
  });

  test('saves manual local-only entries through the repository flow and lists them with watch entries', async () => {
    const repository = new LocalDiveLogRepository([watchEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await fillManualDraft(root);
    await press(root, 'log-entry-editor-save');

    const entries = await repository.list();
    const savedEntry = entries.find(entry => entry.source === 'manual');

    expect(savedEntry).toMatchObject({
      source: 'manual',
      syncStatus: 'localOnly',
      manual: {
        site: { name: 'Blue Corner' },
        buddyIds: ['Mina', 'Alex'],
        tags: ['reef', 'training'],
        observedMarineLife: ['turtle', 'nudibranch'],
        notes: 'Calm review dive with clear water.',
        rating: 5,
        measuredValues: {
          durationSeconds: 2820,
          maxDepthMeters: 18.6,
          diveMode: 'freedive',
        },
      },
    });
    expect(root.findByProps({ testID: 'logbook-list-item-Watch Reef' })).toBeTruthy();
    expect(root.findByProps({ testID: 'logbook-list-item-Blue Corner' })).toBeTruthy();
  });

  test('blocks saving a manual log until required fields are valid', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781351000 });
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await press(root, 'log-entry-editor-save');

    expect(root.findByProps({ testID: 'log-entry-editor-site-name-error' }).props.children).toBe('사이트 이름을 입력해주세요.');
    expect(root.findByProps({ testID: 'log-entry-editor-duration-error' }).props.children).toBe('시간을 선택해주세요.');
    expect(root.findByProps({ testID: 'log-entry-editor-max-depth-error' }).props.children).toBe('최대 수심(m)을 선택해주세요.');
    expect(await repository.list()).toEqual([]);
  });

  test('manual editor reports the first invalid field so the screen can scroll to it', async () => {
    const onInvalidSubmit = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
      renderer = ReactTestRenderer.create(
        <LogEntryEditor
          entry={createBlankDiveLogEntry({ now: 1781351000 })}
          onCancel={jest.fn()}
          onSave={jest.fn()}
          onInvalidSubmit={onInvalidSubmit}
        />,
      );
    });
    renderers.push(renderer!);

    await press(renderer!.root, 'log-entry-editor-save');

    expect(onInvalidSubmit).toHaveBeenCalledWith('siteName');
  });

  test('manual editor scrolls to the first invalid field on failed save', async () => {
    const renderer = await renderLogbook(new LocalDiveLogRepository([]));
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await layout(root, 'log-entry-editor-card-anchor', 180);
    await layout(root, 'log-entry-editor-body', 96);
    await layout(root, 'log-entry-editor-site-name-anchor', 210);
    await press(root, 'log-entry-editor-save');

    expect(root.findByProps({ testID: 'logbook-scroll-target' }).props.children).toBe('470');
  });

  test('manual editor renders date time as a row trigger and numeric values as wheel pickers', async () => {
    const renderer = await renderLogbook(new LocalDiveLogRepository([]));
    const root = renderer.root;

    await press(root, 'logbook-create-action');

    expect(root.findByProps({ testID: 'log-entry-editor-started-at-trigger' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-started-at-date' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-started-at-time' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-duration-wheel' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-duration-column-minutes-wheel-list' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-duration-column-seconds-wheel-list' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-max-depth-wheel' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-max-depth-column-meters-wheel-list' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-max-depth-column-tenths-wheel-list' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-max-depth-unit-fixed' }).props.children).toBe('m');
    expect(root.findAllByProps({ testID: 'log-entry-editor-started-at' }).filter(match => typeof match.props.onChangeText === 'function')).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'log-entry-editor-duration-slider' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'log-entry-editor-duration-decrement' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'log-entry-editor-duration-increment' })).toHaveLength(0);
    expect(root.findAllByProps({ children: 'OPTIONAL' })).toHaveLength(0);
  });

  test('uses the date time picker value when saving a manual log', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781351000 });
    const renderer = await renderLogbook(repository);
    const root = renderer.root;
    const startedAt = new Date('2026-06-20T09:30:00');

    await press(root, 'logbook-create-action');
    await changeDateTime(root, 'log-entry-editor-started-at', startedAt);
    await changeText(root, 'log-entry-editor-site-name', 'Blue Corner');
    await changeTextInput(root, 'log-entry-editor-duration', '47:00');
    await changeNumber(root, 'log-entry-editor-max-depth', 18.6);
    await press(root, 'log-entry-editor-save');

    const [savedEntry] = await repository.list();
    expect(savedEntry.manual.measuredValues.startedAt).toBe(startedAt.getTime() / 1000);
  });

  test('commits comma-delimited logbook lists as removable badges', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781351000 });
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await changeDateTime(root, 'log-entry-editor-started-at', new Date('2026-06-20T09:30:00'));
    await changeText(root, 'log-entry-editor-site-name', 'Blue Corner');
    await changeTextInput(root, 'log-entry-editor-duration', '47:00');
    await changeNumber(root, 'log-entry-editor-max-depth', 18.6);
    await changeText(root, 'log-entry-editor-buddies-input', 'Mina,');
    expect(root.findByProps({ testID: 'log-entry-editor-buddies-badge-Mina' }).props.className).toEqual(
      expect.stringContaining('bg-primary/10'),
    );
    await changeText(root, 'log-entry-editor-buddies-input', 'Alex,');
    await press(root, 'log-entry-editor-buddies-remove-Mina');
    await press(root, 'log-entry-editor-save');

    const [savedEntry] = await repository.list();
    expect(savedEntry.manual.buddyIds).toEqual(['Alex']);
  });

  test('saves star ratings from the logbook editor', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781351000 });
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await press(root, 'log-entry-editor-mode-scuba');
    await changeDateTime(root, 'log-entry-editor-started-at', new Date('2026-06-20T09:30:00'));
    await changeText(root, 'log-entry-editor-site-name', 'Blue Corner');
    await changeTextInput(root, 'log-entry-editor-duration', '47:00');
    await changeNumber(root, 'log-entry-editor-max-depth', 18.6);
    await press(root, 'log-entry-editor-rating-star-5');
    await press(root, 'log-entry-editor-visibility-rating-star-4');
    await press(root, 'log-entry-editor-perceived-exertion-star-3');
    await press(root, 'log-entry-editor-save');

    const [savedEntry] = await repository.list();
    expect(savedEntry.manual.rating).toBe(5);
    expect(savedEntry.manual.measuredValues.visibilityRating).toBe(4);
    expect(savedEntry.manual.measuredValues.perceivedExertion).toBe(3);
  });

  test('shows fixed Air gas and saves scuba pressure metadata', async () => {
    const repository = new LocalDiveLogRepository([], { now: () => 1781351000 });
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await press(root, 'log-entry-editor-mode-scuba');
    expect(root.findByProps({ testID: 'log-entry-editor-gas-label-air' })).toBeTruthy();
    await changeDateTime(root, 'log-entry-editor-started-at', new Date('2026-06-20T09:30:00'));
    await changeText(root, 'log-entry-editor-site-name', 'Blue Corner');
    await changeTextInput(root, 'log-entry-editor-duration', '47:00');
    await changeNumber(root, 'log-entry-editor-max-depth', 18.6);
    await press(root, 'log-entry-editor-pressure-unit-psi');
    await changeNumber(root, 'log-entry-editor-pressure-start', 3000);
    await changeNumber(root, 'log-entry-editor-pressure-end', 900);
    await press(root, 'log-entry-editor-save');

    const [savedEntry] = await repository.list();
    expect(savedEntry.manual.measuredValues.gasLabel).toBe('Air');
    expect(savedEntry.manual.measuredValues.pressure).toEqual({ unit: 'psi', start: 3000, end: 900 });
  });

  test('blocks blank required manual numeric fields', async () => {
    const repository = new LocalDiveLogRepository([]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await press(root, 'log-entry-editor-mode-freedive');
    await changeDateTime(root, 'log-entry-editor-started-at', new Date('2026-06-20T09:30:00'));
    await changeText(root, 'log-entry-editor-site-name', 'Blank Metrics Reef');
    await press(root, 'log-entry-editor-save');

    expect(root.findByProps({ testID: 'log-entry-editor-duration-error' }).props.children).toBe('시간을 선택해주세요.');
    expect(root.findByProps({ testID: 'log-entry-editor-max-depth-error' }).props.children).toBe('최대 수심(m)을 선택해주세요.');
    expect((await repository.list()).find(entry => entry.manual.site.name === 'Blank Metrics Reef')).toBeUndefined();
  });

  test('explains invalid manual numeric schema values instead of returning generic messages', () => {
    const result = logEntryFormSchema.safeParse({
      startedAt: new Date('2026-06-20T09:30:00'),
      diveMode: 'freedive',
      siteName: 'Invalid Metrics Reef',
      durationSeconds: -5,
      maxDepthMeters: -18,
      gearIds: [],
      buddies: [],
      tags: [],
      observedMarineLife: [],
      pressure: { unit: 'bar' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.durationSeconds).toContain('시간은 0 이상이어야 합니다.');
      expect(result.error.flatten().fieldErrors.maxDepthMeters).toContain('최대 수심(m)은 0 이상이어야 합니다.');
    }
  });

  test('list rows show unknown placeholders for manual logs with blank metrics', async () => {
    const repository = new LocalDiveLogRepository([manualEntryWithoutMetrics]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    expect(root.findByProps({ testID: 'logbook-list-max-depth-No Metrics Reef---.--m' })).toBeTruthy();
    expect(root.findByProps({ testID: 'logbook-list-duration-No Metrics Reef---:--' })).toBeTruthy();
  });

  test('uses one source affordance in logbook rows instead of duplicating icon and badge', async () => {
    const repository = new LocalDiveLogRepository([watchEntry, manualEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    expect(root.findByProps({ testID: 'logbook-list-source-icon-Watch Reef' })).toBeTruthy();
    expect(root.findByProps({ testID: 'logbook-list-source-icon-Manual Reef' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'logbook-list-source-Watch Reef' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'logbook-list-source-Manual Reef' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'logbook-list-selected-dot' })).toHaveLength(0);
  });

  test('marks demo watch captures on the log detail header', async () => {
    const repository = new LocalDiveLogRepository([demoWatchEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Demo Reef');

    expect(root.findByProps({ testID: 'log-entry-detail-source' }).props.label).toBe('Watch');
    expect(root.findByProps({ testID: 'log-entry-detail-demo-capture' }).props.label).toBe('Demo');
  });

  test('labels manual local-only rows as locally saved instead of pending sync', async () => {
    const repository = new LocalDiveLogRepository([manualEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    expect(root.findByProps({ testID: 'logbook-list-status-Manual Reef' }).props.label).toBe('Local');
  });

  test('delegates log detail opening to the app route when provided', async () => {
    const onOpenEntry = jest.fn();
    const repository = new LocalDiveLogRepository([manualEntry]);
    const renderer = await renderLogbook(repository, { onOpenEntry });
    const root = renderer.root;

    await press(root, 'logbook-list-item-Manual Reef');

    expect(onOpenEntry).toHaveBeenCalledWith(expect.objectContaining({ localId: 'manual-entry-1' }));
    expect(root.findAllByProps({ testID: 'log-entry-detail-provenance-max-depth-manual' })).toHaveLength(0);
  });

  test('delegates log creation to the app route when provided', async () => {
    const onCreateEntry = jest.fn();
    const repository = new LocalDiveLogRepository([manualEntry]);
    const renderer = await renderLogbook(repository, { onCreateEntry });
    const root = renderer.root;

    await press(root, 'logbook-create-action');

    expect(onCreateEntry).toHaveBeenCalledTimes(1);
    expect(root.findAllByProps({ testID: 'log-entry-editor-title' })).toHaveLength(0);
  });

  test('detail distinguishes manual values from watch-captured values', async () => {
    const repository = new LocalDiveLogRepository([watchEntry, manualEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Manual Reef');
    expect(root.findByProps({ testID: 'log-entry-detail-provenance-max-depth-manual' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-back-icon' })).toBeTruthy();

    await press(root, 'log-entry-detail-back');
    await press(root, 'logbook-list-item-Watch Reef');
    expect(root.findByProps({ testID: 'log-entry-detail-provenance-max-depth-watch' })).toBeTruthy();
  });

  test('detail shows unknown placeholders for missing manual measurements', async () => {
    const repository = new LocalDiveLogRepository([manualEntryWithoutMetrics]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-No Metrics Reef');

    expect(root.findByProps({ testID: 'log-entry-detail-max-depth-value---.--m' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-duration-value---:--' })).toBeTruthy();
  });

  test('detail displays manual measured values when provenance is manual on a watch entry', async () => {
    const repository = new LocalDiveLogRepository([hybridWatchEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Hybrid Reef');

    expect(root.findByProps({ testID: 'log-entry-detail-provenance-max-depth-manual' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-max-depth-value-19.00m' })).toBeTruthy();
  });

  test('detail shows watch depth profile, temperature profile, and raw quick note fallback', async () => {
    const watchEntryWithProfiles: DiveLogEntry = {
      ...watchEntry,
      localId: 'watch-entry-profiles',
      manual: {
        ...watchEntry.manual,
        site: { name: 'Profile Reef' },
        notes: '',
      },
      watchCapture: {
        ...watchEntry.watchCapture!,
        session: {
          ...watchEntry.watchCapture!.session,
          siteName: 'Profile Reef',
          notes: 'Watch quick note from pre-dive',
          samples: [
            {
              localSessionId: 'watch-entry-1',
              timestamp: 1781352000,
              depthMeters: 0,
              waterTemperatureCelsius: 25,
            },
            {
              localSessionId: 'watch-entry-1',
              timestamp: 1781352300,
              depthMeters: 12,
              waterTemperatureCelsius: 24,
            },
          ],
        },
        samples: [
          {
            localSessionId: 'watch-entry-1',
            timestamp: 1781352000,
            depthMeters: 0,
            waterTemperatureCelsius: 25,
          },
          {
            localSessionId: 'watch-entry-1',
            timestamp: 1781352300,
            depthMeters: 12,
            waterTemperatureCelsius: 24,
          },
        ],
      },
    };
    const repository = new LocalDiveLogRepository([watchEntryWithProfiles]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Profile Reef');

    expect(root.findByProps({ testID: 'log-entry-detail-depth-profile' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-temperature-profile' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-note' }).props.children).toBe('Watch quick note from pre-dive');
  });

  test('detail renders watch profiles with 850 raw samples', async () => {
    const largeSamples = Array.from({ length: 850 }, (_, index) => ({
      localSessionId: 'watch-entry-large-profile',
      timestamp: 1781352000 + index,
      depthMeters: index < 425 ? index / 20 : (850 - index) / 20,
      waterTemperatureCelsius: 25 - Math.min(index, 849 - index) / 500,
    }));
    const watchEntryWithLargeProfiles: DiveLogEntry = {
      ...watchEntry,
      localId: 'watch-entry-large-profile',
      manual: {
        ...watchEntry.manual,
        site: { name: 'Large Profile Reef' },
      },
      watchCapture: {
        ...watchEntry.watchCapture!,
        session: {
          ...watchEntry.watchCapture!.session,
          localSessionId: 'watch-entry-large-profile',
          siteName: 'Large Profile Reef',
          samples: largeSamples,
        },
        samples: largeSamples,
      },
    };
    const repository = new LocalDiveLogRepository([watchEntryWithLargeProfiles]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Large Profile Reef');

    expect(root.findByProps({ testID: 'log-entry-detail-depth-profile' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-depth-profile-chart' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-temperature-profile' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-temperature-profile-chart' })).toBeTruthy();
  });

  test('returns to useful list content when filtering removes the selected detail entry', async () => {
    const repository = new LocalDiveLogRepository([watchEntry, manualEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Manual Reef');
    await changeText(root, 'logbook-search-input', 'no matching reef');

    expect(root.findByProps({ testID: 'logbook-empty-state' })).toBeTruthy();
  });

  test('failed local save shows an error and allows retrying the same draft', async () => {
    const repository = new ToggleFailSaveRepository([]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await fillManualDraft(root, {
      'log-entry-editor-site-name': 'Retry Reef',
    });
    await press(root, 'log-entry-editor-save');

    expect(await repository.list()).toHaveLength(0);
    expect(root.findByProps({ testID: 'log-entry-editor-error' }).props.children).toBe('Could not save this log locally. Try again.');

    repository.shouldFailSave = false;
    await press(root, 'log-entry-editor-save');

    expect((await repository.list()).find(entry => entry.manual.site.name === 'Retry Reef')).toBeTruthy();
    expect(root.findByProps({ testID: 'logbook-list-item-Retry Reef' })).toBeTruthy();
  });

  test('edits an existing manual entry without creating a duplicate', async () => {
    const repository = new LocalDiveLogRepository([manualEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Manual Reef');
    await press(root, 'log-entry-detail-edit');
    expect(root.findByProps({ testID: 'log-entry-editor-title' }).props.children).toBe('Edit dive log');
    await changeText(root, 'log-entry-editor-site-name', 'Edited Manual Reef');
    await changeText(root, 'log-entry-editor-notes', 'Updated after reviewing the dive.');
    await press(root, 'log-entry-editor-save');

    const entries = await repository.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      localId: 'manual-entry-1',
      manual: {
        site: { name: 'Edited Manual Reef' },
        notes: 'Updated after reviewing the dive.',
      },
    });
    expect(root.findByProps({ testID: 'logbook-list-item-Edited Manual Reef' })).toBeTruthy();
  });

  test('edits a watch-backed entry without losing watch capture provenance', async () => {
    const repository = new LocalDiveLogRepository([watchEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Watch Reef');
    await press(root, 'log-entry-detail-edit');
    expect(root.findByProps({ testID: 'log-entry-editor-duration-minutes-value' }).props.children).toBe('10');
    expect(root.findByProps({ testID: 'log-entry-editor-duration-seconds-value' }).props.children).toBe('00');
    expect(root.findByProps({ testID: 'log-entry-editor-max-depth-meters-value' }).props.children).toBe('12');
    expect(root.findByProps({ testID: 'log-entry-editor-max-depth-tenths-value' }).props.children).toBe('.0');
    await changeText(root, 'log-entry-editor-site-name', 'Edited Watch Reef');
    await changeText(root, 'log-entry-editor-notes', 'Reviewed on mobile.');
    await press(root, 'log-entry-editor-save');

    const entries = await repository.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      localId: 'watch:watch-entry-1:1781352600',
      source: 'watch',
      syncStatus: 'synced',
      manual: {
        site: { name: 'Edited Watch Reef' },
        notes: 'Reviewed on mobile.',
      },
    });
    expect(entries[0].watchCapture?.importKey).toBe('watch-entry-1:1781352600');
    expect(entries[0].manual.measuredValues.startedAt).toBeUndefined();
    expect(entries[0].manual.measuredValues.durationSeconds).toBeUndefined();
    expect(entries[0].manual.measuredValues.maxDepthMeters).toBeUndefined();
    expect(entries[0].provenance.startedAt).toBe('watch');
    expect(entries[0].provenance.durationSeconds).toBe('watch');
    expect(entries[0].provenance.maxDepthMeters).toBe('watch');
  });

  test('renders watch duration seconds and depth tenths without dirtying untouched watch metrics', async () => {
    const repository = new LocalDiveLogRepository([secondPreciseWatchEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Second Precise Reef');
    await press(root, 'log-entry-detail-edit');

    expect(root.findByProps({ testID: 'log-entry-editor-duration-minutes-value' }).props.children).toBe('10');
    expect(root.findByProps({ testID: 'log-entry-editor-duration-seconds-value' }).props.children).toBe('02');
    expect(root.findByProps({ testID: 'log-entry-editor-max-depth-meters-value' }).props.children).toBe('18');
    expect(root.findByProps({ testID: 'log-entry-editor-max-depth-tenths-value' }).props.children).toBe('.6');

    await changeText(root, 'log-entry-editor-site-name', 'Reviewed Precise Reef');
    await press(root, 'log-entry-editor-save');

    const [savedEntry] = await repository.list();
    expect(savedEntry.manual.measuredValues.durationSeconds).toBeUndefined();
    expect(savedEntry.manual.measuredValues.maxDepthMeters).toBeUndefined();
    expect(savedEntry.provenance.durationSeconds).toBe('watch');
    expect(savedEntry.provenance.maxDepthMeters).toBe('watch');
  });

  test('saves edited watch duration seconds as a manual override without changing untouched depth', async () => {
    const repository = new LocalDiveLogRepository([secondPreciseWatchEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Second Precise Reef');
    await press(root, 'log-entry-detail-edit');
    await changeTextInput(root, 'log-entry-editor-duration', '11:03');
    await press(root, 'log-entry-editor-save');

    const [savedEntry] = await repository.list();
    expect(savedEntry.manual.measuredValues.durationSeconds).toBe(663);
    expect(savedEntry.manual.measuredValues.maxDepthMeters).toBeUndefined();
    expect(savedEntry.provenance.durationSeconds).toBe('manual');
    expect(savedEntry.provenance.maxDepthMeters).toBe('watch');
  });

  test('edits a watch-backed metric as a manual override without changing untouched watch metrics', async () => {
    const repository = new LocalDiveLogRepository([watchEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Watch Reef');
    await press(root, 'log-entry-detail-edit');
    await changeNumber(root, 'log-entry-editor-max-depth', 15.5);
    await press(root, 'log-entry-editor-save');

    const [savedEntry] = await repository.list();

    expect(savedEntry.manual.measuredValues.maxDepthMeters).toBe(15.5);
    expect(savedEntry.manual.measuredValues.durationSeconds).toBeUndefined();
    expect(savedEntry.provenance.maxDepthMeters).toBe('manual');
    expect(savedEntry.provenance.durationSeconds).toBe('watch');
  });

  test('saves scuba-specific fields from the scuba form section', async () => {
    const repository = new LocalDiveLogRepository([]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await fillManualDraft(root, {
      'log-entry-editor-site-name': 'Scuba Wall',
    }, 'scuba');
    await changeText(root, 'log-entry-editor-gear', 'bcd-1, computer-1,');
    await press(root, 'log-entry-editor-water-condition-mild');
    await press(root, 'log-entry-editor-visibility-rating-star-4');
    await press(root, 'log-entry-editor-perceived-exertion-star-3');
    await press(root, 'log-entry-editor-save');

    const savedEntry = (await repository.list()).find(entry => entry.manual.site.name === 'Scuba Wall');

    expect(savedEntry).toMatchObject({
      manual: {
        gearIds: ['bcd-1', 'computer-1'],
        measuredValues: {
          diveMode: 'scuba',
          gasLabel: 'Air',
          waterCondition: 'mild',
          visibilityRating: 4,
          perceivedExertion: 3,
        },
      },
    });
  });

  test('saves optional entry style from the manual editor', async () => {
    const repository = new LocalDiveLogRepository([]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await fillManualDraft(root, {
      'log-entry-editor-site-name': 'Entry Style Reef',
    }, 'scuba');
    await press(root, 'log-entry-editor-entry-style-shore');
    await press(root, 'log-entry-editor-save');

    const savedEntry = (await repository.list()).find(entry => entry.manual.site.name === 'Entry Style Reef');

    expect(savedEntry?.manual.entryStyle).toBe('shore');
  });

  test('does not show an entry style detail row for existing logs without entry style', async () => {
    const repository = new LocalDiveLogRepository([manualEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Manual Reef');

    expect(root.findAllByProps({ testID: 'log-entry-detail-mode-value-entry-style-shore' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'log-entry-detail-mode-value-entry-style-boat' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'log-entry-detail-mode-value-entry-style-pool' })).toHaveLength(0);
  });

  test('opens a pending plan draft in the logbook editor and reports the saved log id', async () => {
    const repository = new LocalDiveLogRepository([]);
    const pendingDraft = createBlankDiveLogEntry({ localId: 'manual-from-plan', now: 1781355000 });
    pendingDraft.manual = {
      ...pendingDraft.manual,
      entryStyle: 'boat',
      site: { name: 'Plan Reef' },
      buddyIds: ['Mina'],
      tags: ['planned'],
      notes: 'Copied from plan objective.',
      measuredValues: {
        diveMode: 'scuba',
        gasLabel: 'EAN32',
      },
    };
    const onPendingDraftSave = jest.fn();
    const renderer = await renderLogbook(repository, {
      pendingDraft: {
        entry: pendingDraft,
        sourcePlanLocalId: 'plan-1',
      },
      onPendingDraftSave,
    });
    const root = renderer.root;

    expect(root.findByProps({ testID: 'log-entry-editor-site-name' }).props.value).toBe('Plan Reef');
    expect(root.findByProps({ testID: 'log-entry-editor-gas-label-air' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-entry-style-boat' }).props.selected).toBe(true);
    await changeTextInput(root, 'log-entry-editor-duration', '41:00');
    await changeNumber(root, 'log-entry-editor-max-depth', 22);
    await press(root, 'log-entry-editor-save');

    const [savedEntry] = await repository.list();
    expect(savedEntry.localId).toBe('manual-from-plan');
    expect(savedEntry.manual.measuredValues.maxDepthMeters).toBe(22);
    expect(savedEntry.manual.measuredValues.durationSeconds).toBe(2460);
    expect(onPendingDraftSave).toHaveBeenCalledWith(expect.objectContaining({ localId: 'manual-from-plan' }), 'plan-1');
  });

  test('switches to a freedive form and does not persist hidden scuba-only fields', async () => {
    const repository = new LocalDiveLogRepository([]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    await press(root, 'log-entry-editor-mode-scuba');
    expect(root.findByProps({ testID: 'log-entry-editor-gas-label-air' })).toBeTruthy();
    await press(root, 'log-entry-editor-mode-freedive');

    expect(root.findByProps({ testID: 'log-entry-editor-repetition-count' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-editor-training-focus' })).toBeTruthy();
    expect(() => root.findByProps({ testID: 'log-entry-editor-gas-label-air' })).toThrow();

    await fillManualDraft(root, {
      'log-entry-editor-site-name': 'Line Session',
      'log-entry-editor-max-depth': '21',
    }, 'freedive');
    await changeNumber(root, 'log-entry-editor-repetition-count', 8);
    await changeText(root, 'log-entry-editor-training-focus', 'constant weight technique');
    await press(root, 'log-entry-editor-save');

    const savedEntry = (await repository.list()).find(entry => entry.manual.site.name === 'Line Session');

    expect(savedEntry?.manual.gearIds).toEqual([]);
    expect(savedEntry?.manual.measuredValues).toMatchObject({
      diveMode: 'freedive',
      maxDepthMeters: 21,
      repetitionCount: 8,
      trainingFocus: 'constant weight technique',
    });
    expect(savedEntry?.manual.measuredValues.gasLabel).toBeUndefined();
  });

  test('detail displays scuba-specific metadata', async () => {
    const repository = new LocalDiveLogRepository([scubaEntry]);
    const renderer = await renderLogbook(repository);
    const root = renderer.root;

    await press(root, 'logbook-list-item-Scuba Metadata Reef');

    expect(root.findByProps({ testID: 'log-entry-detail-mode-value-gas-label-EAN32' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-mode-value-gear-bcd-1,computer-1' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-mode-value-water-condition-mild' })).toBeTruthy();
    expect(root.findByProps({ testID: 'log-entry-detail-mode-value-pressure-200bar->70bar' })).toBeTruthy();
  });
});
