import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { AccessibilityInfo, Alert, FlatList, RefreshControl, ScrollView } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import metadataRichFixture from '../../../packages/contracts/fixtures/metadata-rich-watch-sync-message.json';
import { AppFeedbackProvider } from '../src/components/feedback/app-feedback';
import { ButtonIcon } from '../src/components/ui/button';
import { EditIcon } from '../src/components/ui/icon';
import i18n from '../src/i18n';
import { LocalDiveLogRepository } from '../src/repositories/local-dive-log-repository';
import { composeAccountAndDeferredGuestRows } from '../src/repositories/principal-repositories';
import { LogEntryDetail } from '../src/screens/logbook/log-entry-detail';
import { LogEntryEditor } from '../src/screens/logbook/log-entry-editor';
import { logEntryFormSchema } from '../src/screens/logbook/log-entry-form-schema';
import { getLogEntrySuggestions } from '../src/screens/logbook/log-entry-suggestions';
import { formatLogDate, formatLogDay } from '../src/screens/logbook/log-formatters';
import LogbookScreen from '../src/screens/logbook/screen';
import { useDiveLogbook } from '../src/states/use-dive-logbook';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { WatchSession } from '../src/types/dive-session';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import { watchSessionToDiveLogEntry } from '../src/utils/watch-session-to-dive-log-entry';

const mockIsWatchLinkAvailable = jest.fn();
const mockDrainPendingWatchPayloads = jest.fn();
const mockDiscardWatchPayloads = jest.fn();
const mockAcknowledgeImportedWatchPayloads = jest.fn();

jest.mock('../src/companion/default-watch-link', () => ({
  defaultWatchLink: {
    ...jest.requireActual('../src/companion/watch-link').createUnavailableWatchLink(),
    isAvailable: () => mockIsWatchLinkAvailable(),
    drainPendingPayloads: () => mockDrainPendingWatchPayloads(),
    discardPayloads: (payloadIds: readonly string[]) => mockDiscardWatchPayloads(payloadIds),
    acknowledgeImportedPayloads: (payloadIds: readonly string[]) =>
      mockAcknowledgeImportedWatchPayloads(payloadIds),
    subscribeToPayloads: () => ({ remove: jest.fn() }),
  },
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

const deviceOnlyDemoEntry: DiveLogEntry = {
  ...demoWatchEntry,
  ownerUserId: undefined,
};

const debugTestWatchEntry: DiveLogEntry = {
  ...demoWatchEntry,
  localId: 'watch:debug-test-watch-entry-1:1781352600',
  manual: {
    ...demoWatchEntry.manual,
    site: { name: 'Test Reef' },
  },
  watchCapture: {
    ...demoWatchEntry.watchCapture!,
    importKey: 'debug-test-watch-entry-1:1781352600',
    session: {
      ...demoWatchEntry.watchCapture!.session,
      localSessionId: 'debug-test-watch-entry-1',
      siteName: 'Test Reef',
      tags: ['watch-capture', 'debug-test-capture'],
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

const watchScubaPressureEditEntry: DiveLogEntry = {
  ...watchEntry,
  localId: 'watch:scuba-pressure-edit:1781352600',
  cloudSyncStatus: 'notConfigured',
  manual: {
    ...watchEntry.manual,
    site: { name: 'Watch Pressure Edit Reef' },
    measuredValues: {
      ...watchEntry.manual.measuredValues,
      pressure: { unit: 'bar', start: 200 },
    },
  },
  watchCapture: {
    ...watchEntry.watchCapture!,
    importKey: 'scuba-pressure-edit:1781352600',
    session: {
      ...watchEntry.watchCapture!.session,
      localSessionId: 'scuba-pressure-edit',
      siteName: 'Watch Pressure Edit Reef',
    },
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

const unsupportedDepthWatchEntry = watchSessionToDiveLogEntry({
  now: 1781353000,
  session: {
    localSessionId: 'watch-entry-unsupported-depth',
    schemaVersion: 2,
    siteName: 'Unsupported Watch Reef',
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
    samples: [
      { localSessionId: 'watch-entry-unsupported-depth', timestamp: 1781352000, depthMeters: 0 },
      { localSessionId: 'watch-entry-unsupported-depth', timestamp: 1781352300, depthMeters: 41.8 },
      { localSessionId: 'watch-entry-unsupported-depth', timestamp: 1781352600, depthMeters: 0.4 },
    ],
  } satisfies WatchSession,
});

// A watch scuba dive started from a plan: the watch adds its own tags around the diver's tag, and the
// import fills in the 150 bar start pressure the watch never measured.
const plannedWatchEntry = watchSessionToDiveLogEntry({
  now: 1781353000,
  session: {
    ...(watchEntry.watchCapture!.session as WatchSession),
    localSessionId: 'planned-watch-entry',
    siteName: 'Planned Reef',
    tags: ['watch-capture', 'reef', 'plan-6f1c2b9a', 'planned-18m'],
  } as WatchSession,
});

/** The visible text, test IDs and spoken labels of every native node, for checks that a value never appears. */
const renderedSource = (renderer: ReactTestRenderer.ReactTestRenderer): string =>
  renderer.root
    .findAll(node => typeof node.type === 'string')
    .flatMap(node => [
      String(node.props.testID ?? ''),
      String(node.props.accessibilityLabel ?? ''),
      String(node.props['aria-label'] ?? ''),
      ...React.Children.toArray(node.props.children)
        .filter(child => typeof child === 'string' || typeof child === 'number')
        .map(String),
    ])
    .join('\n');

/** The label VoiceOver reads for the native text field with this test ID. */
const fieldLabel = (root: ReactTestRenderer.ReactTestInstance, testID: string): unknown =>
  root.findAll(node => node.props.testID === testID && typeof node.type === 'string')[0]?.props['aria-label'];

type HarnessRoute =
  | { name: 'list' }
  | { name: 'create'; entry: DiveLogEntry; sourcePlanLocalId?: string }
  | { name: 'detail'; localId: string }
  | { name: 'edit'; localId: string };

type HarnessProps = {
  repository: LocalDiveLogRepository;
  isAuthenticated?: boolean;
  initialRoute?: HarnessRoute;
  onPendingDraftSave?: (entry: DiveLogEntry, sourcePlanLocalId?: string) => void;
  onOpenEntry?: (entry: DiveLogEntry) => void;
  onCreateEntry?: () => void;
};

const queryClients: QueryClient[] = [];
const renderers: ReactTestRenderer.ReactTestRenderer[] = [];
const safeAreaMetrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

/**
 * Stands in for the app's routes with the real list, editor and detail components. The list opens
 * the editor and the detail through its callbacks, as navigation does. To keep the assertions on the
 * list short, a save returns to the list here (the app opens the saved log's detail instead).
 */
function Harness({ repository, isAuthenticated, initialRoute, onPendingDraftSave, onOpenEntry, onCreateEntry }: HarnessProps): React.JSX.Element {
  const logbook = useDiveLogbook({ repository, queryScope: 'manual-entry-test' });
  const [route, setRoute] = React.useState<HarnessRoute>(initialRoute ?? { name: 'list' });
  const backToList = () => setRoute({ name: 'list' });

  if (route.name === 'create') {
    return (
      <LogEntryEditor
        entry={route.entry}
        mode="create"
        suggestions={getLogEntrySuggestions(logbook.entries)}
        onCancel={backToList}
        onSave={async entry => {
          const savedEntry = await logbook.saveEntry(entry);
          onPendingDraftSave?.(savedEntry, route.sourcePlanLocalId);
          backToList();
          return savedEntry;
        }}
      />
    );
  }

  const routedEntry = route.name === 'list' ? undefined : logbook.entries.find(entry => entry.localId === route.localId);

  if (route.name === 'edit' && routedEntry) {
    return (
      <LogEntryEditor
        entry={routedEntry}
        mode="edit"
        suggestions={getLogEntrySuggestions(logbook.entries, routedEntry.localId)}
        onCancel={() => setRoute({ name: 'detail', localId: routedEntry.localId })}
        onSave={async entry => {
          const savedEntry = await logbook.saveEntry(entry);
          backToList();
          return savedEntry;
        }}
      />
    );
  }

  if (route.name === 'detail' && routedEntry) {
    return (
      <LogEntryDetail
        entry={routedEntry}
        onBack={backToList}
        onEdit={entry => setRoute({ name: 'edit', localId: entry.localId })}
        onDelete={async localId => {
          await logbook.deleteEntry(localId);
          backToList();
        }}
      />
    );
  }

  return (
    <LogbookScreen
      entries={logbook.filteredEntries}
      totalEntryCount={logbook.entries.length}
      filter={logbook.filter}
      onFilterChange={logbook.setFilter}
      onSyncWatch={logbook.syncWatchPayloads}
      onRefresh={logbook.refresh}
      onOpenEntry={onOpenEntry ?? (entry => setRoute({ name: 'detail', localId: entry.localId }))}
      onCreateEntry={onCreateEntry ?? (() => setRoute({ name: 'create', entry: createBlankDiveLogEntry() }))}
      isAuthenticated={isAuthenticated}
    />
  );
}

/** The app's providers that these screens read: safe area (sticky save bar) and the result toast. */
function Providers(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <AppFeedbackProvider>{props.children}</AppFeedbackProvider>
    </SafeAreaProvider>
  );
}

async function renderElement(element: React.JSX.Element): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    await i18n.changeLanguage('en');
    renderer = ReactTestRenderer.create(<Providers>{element}</Providers>);
  });

  renderers.push(renderer!);
  return renderer!;
}

const textOf = (node: ReactTestRenderer.ReactTestInstance): string => {
  const children = node.props.children as unknown;
  return Array.isArray(children) ? children.join('') : String(children);
};

/** The visible text of the native node with this test ID. */
const hostText = (root: ReactTestRenderer.ReactTestInstance, testID: string): string => {
  const node = root.findAll(candidate => candidate.props.testID === testID && typeof candidate.type === 'string')[0];
  if (!node) {
    throw new Error(`No element with testID ${testID}`);
  }
  return React.Children.toArray(node.props.children).join('');
};

const exists = (root: ReactTestRenderer.ReactTestInstance, testID: string): boolean => root.findAllByProps({ testID }).length > 0;

/** The busy/disabled state VoiceOver reads on the detail's delete row. */
const deleteRowState = (root: ReactTestRenderer.ReactTestInstance): unknown =>
  root.findAll(node => node.props.testID === 'log-entry-detail-delete' && node.props.accessibilityState !== undefined)[0]?.props.accessibilityState;

const renderLogbook = async (
  repository: LocalDiveLogRepository,
  options: {
    initialRoute?: HarnessRoute;
    onPendingDraftSave?: (entry: DiveLogEntry, sourcePlanLocalId?: string) => void;
    onOpenEntry?: (entry: DiveLogEntry) => void;
    onCreateEntry?: () => void;
    isAuthenticated?: boolean;
  } = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  queryClients.push(queryClient);

  return renderElement(
    <QueryClientProvider client={queryClient}>
      <Harness
        repository={repository}
        initialRoute={options.initialRoute}
        onPendingDraftSave={options.onPendingDraftSave}
        onOpenEntry={options.onOpenEntry}
        onCreateEntry={options.onCreateEntry}
        isAuthenticated={options.isAuthenticated}
      />
    </QueryClientProvider>,
  );
};

const listScreenProps = (overrides: Partial<React.ComponentProps<typeof LogbookScreen>> = {}): React.ComponentProps<typeof LogbookScreen> => ({
  entries: [],
  filter: { query: '' },
  onFilterChange: jest.fn(),
  onSyncWatch: async () => ({ importedCount: 0, receivedCount: 0, failedCount: 0, unavailable: false }),
  onRefresh: jest.fn(),
  onOpenEntry: jest.fn(),
  onCreateEntry: jest.fn(),
  ...overrides,
});

const changeText = async (root: ReactTestRenderer.ReactTestInstance, testID: string, value: string) => {
  await ReactTestRenderer.act(async () => {
    const field = root.findAllByProps({ testID }).find(match => typeof match.props.onChangeText === 'function');
    field!.props.onChangeText(value);
  });
};

const press = async (root: ReactTestRenderer.ReactTestInstance, testID: string) => {
  await ReactTestRenderer.act(async () => {
    await root.findByProps({ testID }).props.onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
};

/** Opens the date row's sheet, turns the native picker to `value` and closes the sheet. */
const changeDateTime = async (root: ReactTestRenderer.ReactTestInstance, testID: string, value: Date) => {
  await press(root, `${testID}-trigger`);
  await ReactTestRenderer.act(async () => {
    root.findByProps({ testID: `${testID}-picker` }).props.onValueChange({ nativeEvent: { timestamp: value.getTime(), utcOffset: 0 } }, value);
  });
  await press(root, `${testID}-done`);
};

/** Opens the value row's sheet, types into the wheel's direct entry, and closes the sheet with Done. */
const changeTextInput = async (root: ReactTestRenderer.ReactTestInstance, testID: string, value: string) => {
  await press(root, `${testID}-trigger`);
  await press(root, `${testID}-input-trigger`);

  await ReactTestRenderer.act(async () => {
    const input = root.findAllByProps({ testID: `${testID}-input` }).find(match => typeof match.props.onChangeText === 'function');
    input!.props.onChangeText(value);
  });

  await ReactTestRenderer.act(async () => {
    const input = root.findAllByProps({ testID: `${testID}-input` }).find(match => typeof match.props.onSubmitEditing === 'function');
    input!.props.onSubmitEditing();
  });

  await press(root, `${testID}-done`);
};

const changeNumber = (root: ReactTestRenderer.ReactTestInstance, testID: string, value: number) => changeTextInput(root, testID, `${value}`);

/** "세부 정보" is collapsed for a new log; open it before using the fields inside. */
const openDetails = async (root: ReactTestRenderer.ReactTestInstance) => {
  if (!exists(root, 'log-entry-editor-details-content')) {
    await press(root, 'log-entry-editor-details-toggle');
  }
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
  const values = {
    'log-entry-editor-site-name': 'Blue Corner',
    'log-entry-editor-duration': '47:00',
    'log-entry-editor-max-depth': '18.6',
    'log-entry-editor-notes': 'Calm review dive with clear water.',
    'log-entry-editor-buddies-input': 'Mina, Alex,',
    'log-entry-editor-tags-input': 'reef, training,',
    'log-entry-editor-marine-life-input': 'turtle, nudibranch,',
    ...overrides,
  };

  await press(root, `log-entry-editor-mode-${mode}`);
  await changeDateTime(root, 'log-entry-editor-started-at', new Date('2026-06-20T09:30:00'));
  await changeText(root, 'log-entry-editor-site-name', values['log-entry-editor-site-name']!);
  await changeTextInput(root, 'log-entry-editor-duration', values['log-entry-editor-duration']!);
  await changeNumber(root, 'log-entry-editor-max-depth', Number(values['log-entry-editor-max-depth']));
  await changeText(root, 'log-entry-editor-notes', values['log-entry-editor-notes']!);
  if (!Object.prototype.hasOwnProperty.call(overrides, 'log-entry-editor-rating')) {
    await press(root, 'log-entry-editor-rating-star-5');
  }
  await openDetails(root);
  await changeText(root, 'log-entry-editor-buddies-input', values['log-entry-editor-buddies-input']!);
  await changeText(root, 'log-entry-editor-tags-input', values['log-entry-editor-tags-input']!);
  await changeText(root, 'log-entry-editor-marine-life-input', values['log-entry-editor-marine-life-input']!);
};

describe('Logbook list, editor and detail', () => {
  beforeEach(() => {
    mockIsWatchLinkAvailable.mockReturnValue(false);
    mockDrainPendingWatchPayloads.mockResolvedValue([]);
    mockDiscardWatchPayloads.mockResolvedValue(undefined);
    mockAcknowledgeImportedWatchPayloads.mockResolvedValue(undefined);
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

    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('list', () => {
    test('uses clearer logbook action labels', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([]));
      const root = renderer.root;

      expect(root.findByProps({ testID: 'logbook-create-action' }).props.label).toBe('Add log');
      expect(root.findByProps({ testID: 'logbook-import-action' }).props.label).toBe('Get watch logs');
      const createActionIcon = root.findByProps({ testID: 'logbook-create-action-icon' });
      expect(createActionIcon.findByType(ButtonIcon).props.as).toBe(EditIcon);
      expect(root.findAllByProps({ testID: 'logbook-import-action-icon' })).toHaveLength(0);
      expect(root.findByProps({ testID: 'logbook-search-icon' })).toBeTruthy();
    });

    test('keeps the search box fixed above a list that scrolls on its own', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntry]));
      const list = renderer.root.findByProps({ testID: 'logbook-list' });

      expect(list.props.keyboardShouldPersistTaps).toBe('handled');
      expect(list.findAllByProps({ testID: 'logbook-search-input' })).toHaveLength(0);
      expect(list.findByProps({ testID: 'logbook-list-item-Manual Reef' })).toBeTruthy();
    });

    test('shows the total log count above the list and the match count while searching', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntry, manualEntryWithoutMetrics]));
      const root = renderer.root;

      expect(textOf(root.findByProps({ testID: 'logbook-total-count' }))).toBe('2 logs');

      await changeText(root, 'logbook-search-input', 'Manual');

      expect(textOf(root.findByProps({ testID: 'logbook-total-count' }))).toBe('1 match of 2 logs');
    });

    test('adds in-memory pages without a loading footer', async () => {
      const entries = Array.from({ length: 25 }, (_, index) => {
        const entry = createBlankDiveLogEntry({ localId: `paged-entry-${index}`, now: 1781351000 + index });
        entry.manual = { ...entry.manual, site: { name: `Paged Reef ${index}` } };
        return entry;
      });
      const renderer = await renderLogbook(new LocalDiveLogRepository(entries));
      const list = () => renderer.root.findByProps({ testID: 'logbook-list' });

      expect(list().props.data).toHaveLength(20);
      // The next rows come from memory and appear at once, so nothing announces them.
      expect(renderer.root.findAllByProps({ testID: 'logbook-loading-more' })).toHaveLength(0);

      await ReactTestRenderer.act(async () => {
        list().props.onEndReached();
      });

      expect(list().props.data).toHaveLength(25);
      expect(renderer.root.findAllByProps({ testID: 'logbook-loading-more' })).toHaveLength(0);
    });

    test('shows a two-row tail skeleton after the delay only while cloud pages are still arriving', async () => {
      jest.useFakeTimers();
      const renderer = await renderElement(<LogbookScreen {...listScreenProps({ entries: [manualEntry], isCloudLoading: true })} />);
      const tailRows = () =>
        renderer.root
          .findByProps({ testID: 'logbook-loading-more' })
          .findAll(node => typeof node.type === 'string' && node.props.accessibilityElementsHidden === true && String(node.props.className).includes('bg-skeleton'));

      expect(tailRows().length).toBeGreaterThan(0);
      expect(tailRows().every(node => String(node.props.className).includes('opacity-0'))).toBe(true);

      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(999);
      });
      expect(tailRows().every(node => String(node.props.className).includes('opacity-0'))).toBe(true);

      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(tailRows().every(node => String(node.props.className).includes('opacity-100'))).toBe(true);

      await ReactTestRenderer.act(async () => {
        renderer.update(
          <Providers>
            <LogbookScreen {...listScreenProps({ entries: [manualEntry], isCloudLoading: false })} />
          </Providers>,
        );
      });
      expect(renderer.root.findAllByProps({ testID: 'logbook-loading-more' })).toHaveLength(0);
    });

    test('uses native pull-to-refresh on the logbook scroll view', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([]));
      const refreshControl = renderer.root.findByType(ScrollView).props.refreshControl;

      expect(refreshControl.type).toBe(RefreshControl);
      expect(refreshControl.props.refreshing).toBe(false);
    });

    test('shows row-shaped skeletons only after the delay and keeps the count line in place', async () => {
      jest.useFakeTimers();
      const renderer = await renderElement(<LogbookScreen {...listScreenProps({ isLoading: true })} />);
      const root = renderer.root;
      const loadingState = () => root.findAll(node => node.props.testID === 'logbook-loading-state' && typeof node.type === 'string')[0];
      const skeletonNodes = () =>
        root.findAll(node => typeof node.type === 'string' && node.props.accessibilityElementsHidden === true && String(node.props.className).includes('bg-skeleton'));

      expect(loadingState().props.accessibilityState).toEqual({ busy: true });
      expect(root.findAllByProps({ testID: 'logbook-empty-state' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'logbook-total-count' })).toHaveLength(0);
      // Three rows with an icon circle each, plus the count line.
      expect(skeletonNodes().filter(node => String(node.props.className).includes('rounded-full'))).toHaveLength(3);
      expect(skeletonNodes().every(node => String(node.props.className).includes('opacity-0'))).toBe(true);

      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(1000);
      });

      expect(skeletonNodes().every(node => String(node.props.className).includes('opacity-100'))).toBe(true);
      expect(loadingState().props.accessibilityLabel).toBe('Loading your logbook');
    });

    test('offers both ways to start an empty logbook from the header', async () => {
      const onCreateEntry = jest.fn();
      const onSyncWatch = jest.fn(async () => ({ importedCount: 0, receivedCount: 0, failedCount: 0, unavailable: false }));
      const renderer = await renderElement(<LogbookScreen {...listScreenProps({ onCreateEntry, onSyncWatch })} />);
      const root = renderer.root;

      expect(root.findAll(node => node.props.children === 'No dive logs yet').length).toBeGreaterThan(0);

      await press(root, 'logbook-create-action');
      await press(root, 'logbook-import-action');

      expect(onCreateEntry).toHaveBeenCalledTimes(1);
      expect(onSyncWatch).toHaveBeenCalledTimes(1);
    });

    test('shows no count after a failed first load, and keeps the list with a note after a failed refresh', async () => {
      const loadError = new Error('storage unavailable');
      const failedFirstLoad = await renderElement(<LogbookScreen {...listScreenProps({ loadError, totalEntryCount: 0 })} />);

      expect(failedFirstLoad.root.findAllByProps({ testID: 'logbook-error-state' }).length).toBeGreaterThan(0);
      expect(failedFirstLoad.root.findAllByProps({ testID: 'logbook-total-count' })).toHaveLength(0);
      expect(failedFirstLoad.root.findAllByProps({ testID: 'logbook-refresh-failed' })).toHaveLength(0);

      const failedRefresh = await renderElement(
        <LogbookScreen {...listScreenProps({ entries: [manualEntry], totalEntryCount: 1, loadError })} />,
      );

      expect(textOf(failedRefresh.root.findByProps({ testID: 'logbook-total-count' }))).toBe('1 log');
      expect(hostText(failedRefresh.root, 'logbook-refresh-failed')).toBe("Couldn't refresh. Showing what was last loaded.");
      expect(failedRefresh.root.findByProps({ testID: 'logbook-list-item-Manual Reef' })).toBeTruthy();
      expect(failedRefresh.root.findAllByProps({ testID: 'logbook-error-state' })).toHaveLength(0);
    });

    test('keeps the failed-load retry busy until the reload settles', async () => {
      let finishRefresh: (() => void) | undefined;
      const onRefresh = jest.fn(
        () =>
          new Promise<void>(resolve => {
            finishRefresh = resolve;
          }),
      );
      const renderer = await renderElement(
        <LogbookScreen {...listScreenProps({ loadError: new Error('storage unavailable'), totalEntryCount: 0, onRefresh })} />,
      );
      const retry = () => renderer.root.findByProps({ testID: 'logbook-error-state-action' });

      expect(retry().props.pending).toBeFalsy();

      await ReactTestRenderer.act(async () => {
        retry().props.onPress();
      });

      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(retry().props.pending).toBe(true);

      await ReactTestRenderer.act(async () => {
        finishRefresh?.();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });

      expect(retry().props.pending).toBe(false);
    });

    test('names the search field for VoiceOver', async () => {
      const renderer = await renderElement(<LogbookScreen {...listScreenProps()} />);

      expect(fieldLabel(renderer.root, 'logbook-search-input')).toBe('Search logs');
    });

    test('keeps the watch\'s own tags out of the row, the detail and the editor, and saves them back untouched', async () => {
      const repository = new LocalDiveLogRepository([plannedWatchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;
      const expectNoWatchTags = () => {
        expect(renderedSource(renderer)).not.toMatch(/watch-capture|plan-6f1c2b9a|planned-18m/);
      };

      expect(hostText(root, 'logbook-list-tags-Planned Reef')).toBe('reef');
      expectNoWatchTags();

      await press(root, 'logbook-list-item-Planned Reef');
      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-tags-reef' })).toBeTruthy();
      expectNoWatchTags();

      await press(root, 'log-entry-detail-edit');
      await openDetails(root);
      expect(exists(root, 'log-entry-editor-tags-badge-reef')).toBe(true);
      expectNoWatchTags();

      await changeText(root, 'log-entry-editor-notes', 'Saw a turtle.');
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.notes).toBe('Saw a turtle.');
      // The plan link and guest claim reuse read the stored tags, so they stay exactly as imported.
      expect(savedEntry.manual.tags).toEqual(['watch-capture', 'reef', 'plan-6f1c2b9a', 'planned-18m']);
    });

    test('scrolls to the top and refreshes when the active logbook tab is selected again', async () => {
      const onRefresh = jest.fn();
      const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => undefined);
      const renderer = await renderElement(<LogbookScreen {...listScreenProps({ onRefresh, reselectToken: 0 })} />);

      await ReactTestRenderer.act(async () => {
        renderer.update(
          <Providers>
            <LogbookScreen {...listScreenProps({ onRefresh, reselectToken: 1 })} />
          </Providers>,
        );
      });

      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
    });

    test('import action drains pending WatchConnectivity payloads and reports the result in a toast', async () => {
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
      mockIsWatchLinkAvailable.mockReturnValue(true);
      mockDrainPendingWatchPayloads.mockResolvedValue([
        {
          payloadId: 'button-payload-1',
          payloadJson: JSON.stringify(payload),
          localSessionId: 'button-drain-session',
          receivedAt: 1781360100,
        },
      ]);
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-import-action');

      const entries = await repository.list();
      expect(entries).toHaveLength(1);
      expect(entries[0].watchCapture?.session.localSessionId).toBe('button-drain-session');
      expect(root.findByProps({ testID: 'logbook-list-item-Button Drain Reef' })).toBeTruthy();
      expect(hostText(root, 'app-feedback-message')).toBe('Saved 1 watch log on this device.');
      expect(announce).toHaveBeenCalledWith('Saved 1 watch log on this device.');
      expect(root.findAllByProps({ testID: 'logbook-sync-toast' })).toHaveLength(0);
      expect(mockAcknowledgeImportedWatchPayloads).toHaveBeenCalledWith(['button-payload-1']);
    });

    test('manual watch sync tells the user when there are no new watch logs', async () => {
      mockIsWatchLinkAvailable.mockReturnValue(true);
      mockDrainPendingWatchPayloads.mockResolvedValue([]);
      const renderer = await renderLogbook(new LocalDiveLogRepository([]));

      await press(renderer.root, 'logbook-import-action');

      expect(hostText(renderer.root, 'app-feedback-message')).toBe('No new watch logs.');
    });

    test('manual watch sync reports a retryable failure when no payload imports', async () => {
      const renderer = await renderElement(
        <LogbookScreen
          {...listScreenProps({
            onSyncWatch: async () => ({ importedCount: 0, receivedCount: 1, failedCount: 1, unavailable: false }),
          })}
        />,
      );

      await press(renderer.root, 'logbook-import-action');

      expect(hostText(renderer.root, 'app-feedback-message')).toBe('Couldn’t check watch logs. Try again.');
      expect(renderer.root.findByProps({ testID: 'app-feedback' }).props.accessibilityRole).toBe('alert');
    });

    test('list rows show unknown placeholders for manual logs with blank metrics', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntryWithoutMetrics]));
      const root = renderer.root;

      expect(root.findByProps({ testID: 'logbook-list-max-depth-No Metrics Reef---m' })).toBeTruthy();
      expect(root.findByProps({ testID: 'logbook-list-duration-No Metrics Reef---min' })).toBeTruthy();
    });

    test('lays a row out as title and depth, then date, dive type and time, with tags only when there are some', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntry, watchEntry]));
      const root = renderer.root;
      const metaText = (siteName: string) => {
        const [meta] = root.findAll(node => node.props.testID === `logbook-list-meta-${siteName}` && typeof node.type === 'string');
        return React.Children.toArray(meta.props.children)
          .map(child => (typeof child === 'string' ? child : React.Children.toArray((child as React.ReactElement<{ children: React.ReactNode }>).props.children).join('')))
          .join('');
      };
      const manualDate = formatLogDate(1781350200, 'en', 'Unknown date');
      const watchDate = formatLogDate(1781352000, 'en', 'Unknown date');

      expect(metaText('Manual Reef')).toBe(`${manualDate} · Freedive · 40 min`);
      expect(metaText('Watch Reef')).toBe(`${watchDate} · Scuba · 10 min`);
      expect(hostText(root, 'logbook-list-tags-Manual Reef')).toBe('shore');
      expect(exists(root, 'logbook-list-tags-Watch Reef')).toBe(false);
      // Compact rows: one line each for the title and the meta, with the same card padding as plan rows.
      const row = root.findAll(node => node.props.testID === 'logbook-list-item-Watch Reef' && typeof node.props.className === 'string')[0];
      expect(row.props.className).toContain('py-3');
      expect(row.props.accessibilityLabel).toBe(`Watch Reef, ${watchDate}, 12.0 m, Scuba, 10 min`);
    });

    test('labels a test dive from the watch as Test in the list, as the detail does', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([debugTestWatchEntry]));
      const root = renderer.root;

      expect(root.findByProps({ testID: 'logbook-test-badge-Test Reef' }).props.label).toBe('Test');
      expect(root.findAllByProps({ testID: 'logbook-demo-badge-Test Reef' })).toHaveLength(0);
      expect(renderedSource(renderer)).not.toMatch(/debug-test-capture|watch-capture/);
    });

    test('shows dive time in minutes, depth to one decimal, and no filler for missing tags', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntry, watchEntry]));
      const root = renderer.root;

      expect(root.findByProps({ testID: 'logbook-list-duration-Manual Reef-40min' })).toBeTruthy();
      expect(root.findByProps({ testID: 'logbook-list-max-depth-Manual Reef-18.0m' })).toBeTruthy();
      expect(root.findByProps({ testID: 'logbook-list-duration-Watch Reef-10min' })).toBeTruthy();
      expect(root.findAll(node => node.props.children === 'no tags')).toHaveLength(0);
      expect(root.findAll(node => typeof node.props.children === 'string' && node.props.children.includes('no tags'))).toHaveLength(0);
    });

    test('titles a watch log that still has the import default site with a localized fallback', async () => {
      const unnamedWatchEntry = watchSessionToDiveLogEntry({
        now: 1781353000,
        session: { ...(watchEntry.watchCapture!.session as WatchSession), localSessionId: 'unnamed-watch-entry', siteName: undefined } as WatchSession,
      });
      const repository = new LocalDiveLogRepository([unnamedWatchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;
      const day = formatLogDay(unnamedWatchEntry.watchCapture!.measuredValues.startedAt, 'en');
      const expectedTitle = `Watch log · ${day}`;

      // The stored site keeps the import default; only the visible title changes. The row's second
      // line carries the date, so the row title does not repeat it.
      expect((await repository.list())[0].manual.site.name).toBe('워치 다이브');
      expect(root.findAll(node => node.props.children === 'Watch log').length).toBeGreaterThan(0);
      expect(root.findAll(node => node.props.children === expectedTitle)).toHaveLength(0);

      await press(root, 'logbook-list-item-워치 다이브');

      expect(hostText(root, 'log-entry-detail-title')).toBe(expectedTitle);
    });

    test('uses one neutral source affordance in logbook rows instead of duplicating icon and badge', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([watchEntry, manualEntry]));
      const root = renderer.root;

      expect(root.findByProps({ testID: 'logbook-list-source-icon-Watch Reef' }).props.className).toContain('bg-muted');
      expect(root.findByProps({ testID: 'logbook-list-source-icon-Manual Reef' })).toBeTruthy();
      expect(root.findAllByProps({ testID: 'logbook-list-source-Watch Reef' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'logbook-list-source-Manual Reef' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'logbook-list-selected-dot' })).toHaveLength(0);
    });

    test('does not show a cloud status for manual rows before cloud sync exists', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntry]));

      expect(renderer.root.findAllByProps({ testID: 'logbook-list-status-Manual Reef' })).toHaveLength(0);
    });

    test('marks imported watch logs above the supported watch depth even when summary fields are lower', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([unsupportedDepthWatchEntry]));
      const root = renderer.root;

      expect(root.findByProps({ testID: 'logbook-list-unsupported-depth-Unsupported Watch Reef' }).props.label).toBe('Outside supported depth');
      await press(root, 'logbook-list-item-Unsupported Watch Reef');
      expect(root.findByProps({ testID: 'log-entry-detail-unsupported-depth-warning' }).props.children).toContain(
        'Beyond the depth this app supports on Apple Watch',
      );
    });

    test('does not present cloud status controls before cloud sync exists', async () => {
      const syncedWatchEntry: DiveLogEntry = {
        ...watchEntry,
        localId: 'watch:visible-synced-as-pending:1781352600',
        cloudSyncStatus: 'notConfigured',
        manual: {
          ...watchEntry.manual,
          site: { name: 'Visible Pending Reef' },
        },
        watchCapture: {
          ...watchEntry.watchCapture!,
          importKey: 'visible-synced-as-pending:1781352600',
          session: {
            ...watchEntry.watchCapture!.session,
            localSessionId: 'visible-synced-as-pending',
            siteName: 'Visible Pending Reef',
          },
        },
      };
      const renderer = await renderLogbook(new LocalDiveLogRepository([syncedWatchEntry]));
      const root = renderer.root;

      expect(root.findByProps({ testID: 'logbook-list-item-Visible Pending Reef' })).toBeTruthy();
      expect(root.findAllByProps({ testID: 'logbook-list-status-Visible Pending Reef' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'logbook-filter-synced' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'logbook-filter-pending' })).toHaveLength(0);
    });

    test('delegates log detail opening to the app route', async () => {
      const onOpenEntry = jest.fn();
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntry]), { onOpenEntry });
      const root = renderer.root;

      await press(root, 'logbook-list-item-Manual Reef');

      expect(onOpenEntry).toHaveBeenCalledWith(expect.objectContaining({ localId: 'manual-entry-1' }));
      expect(root.findAllByProps({ testID: 'log-entry-detail-provenance-max-depth-manual' })).toHaveLength(0);
    });

    test('delegates log creation to the app route', async () => {
      const onCreateEntry = jest.fn();
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntry]), { onCreateEntry });
      const root = renderer.root;

      await press(root, 'logbook-create-action');

      expect(onCreateEntry).toHaveBeenCalledTimes(1);
      expect(root.findAllByProps({ testID: 'log-entry-editor-title' })).toHaveLength(0);
    });

    test('labels only retained guest rows for an authenticated account', async () => {
      const accountEntry = {
        ...manualEntry,
        localId: 'account-entry',
        ownerUserId: 'user-1',
        manual: { ...manualEntry.manual, site: { name: 'Account Reef' } },
      };
      const guestEntry = {
        ...manualEntry,
        localId: 'guest-entry',
        ownerUserId: undefined,
        manual: { ...manualEntry.manual, site: { name: 'Device Reef' } },
      };
      const renderer = await renderLogbook(new LocalDiveLogRepository([accountEntry, guestEntry]), { isAuthenticated: true });

      const deviceBadge = renderer.root.findByProps({ testID: 'logbook-device-badge-Device Reef' });
      const accountBadges = renderer.root.findAllByProps({ testID: 'logbook-device-badge-Account Reef' });

      expect(deviceBadge.props.label).toBe('Only on this device');
      expect(accountBadges).toHaveLength(0);
    });

    test('shows a demo badge on demo watch rows', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([demoWatchEntry]));

      expect(renderer.root.findByProps({ testID: 'logbook-demo-badge-Demo Reef' })).toBeTruthy();
    });

    test('shows demo then device-only badges for retained demo rows', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([deviceOnlyDemoEntry]), { isAuthenticated: true });
      const badgeRow = renderer.root.findByProps({ testID: 'logbook-list-badges-Demo Reef' });

      expect(badgeRow.props.children.map((child: { props: { label: string } }) => child.props.label)).toEqual([
        'Demo',
        'Only on this device',
      ]);
    });

    test('announces retained demo storage status once from the logbook row', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([deviceOnlyDemoEntry]), { isAuthenticated: true });
      const row = renderer.root.findByProps({ testID: 'logbook-list-item-Demo Reef' });
      const date = formatLogDate(deviceOnlyDemoEntry.watchCapture!.measuredValues.startedAt, 'en', 'Unknown date');

      expect(row.props.accessibilityLabel).toBe(`Demo Reef, ${date}, Demo, Only on this device, 12.0 m, Scuba, 10 min`);
      expect(row.props.accessible).toBe(true);
      for (const badgeTestID of ['logbook-demo-badge-Demo Reef', 'logbook-device-badge-Demo Reef']) {
        const badge = renderer.root.findAllByProps({ testID: badgeTestID }).find(node => node.props.accessible === false);

        expect(badge).toBeTruthy();
        expect(badge!.props.accessible).toBe(false);
        expect(badge!.props.accessibilityElementsHidden).toBe(true);
        expect(badge!.props.importantForAccessibility).toBe('no-hide-descendants');
      }
    });

    test('includes the visible unsupported-depth marker in a badged row announcement', async () => {
      const renderer = await renderLogbook(
        new LocalDiveLogRepository([
          {
            ...unsupportedDepthWatchEntry,
            ownerUserId: undefined,
            watchCapture: {
              ...unsupportedDepthWatchEntry.watchCapture!,
              session: {
                ...unsupportedDepthWatchEntry.watchCapture!.session,
                captureMode: 'demo',
              },
            },
          },
        ]),
        { isAuthenticated: true },
      );
      const label = renderer.root.findByProps({ testID: 'logbook-list-item-Unsupported Watch Reef' }).props.accessibilityLabel as string;

      expect(label).toContain('Outside supported depth');
      expect(label.match(/Outside supported depth/g)).toHaveLength(1);
    });

    test('does not label guest rows before authentication', async () => {
      const renderer = await renderLogbook(
        new LocalDiveLogRepository([
          {
            ...manualEntry,
            localId: 'guest-entry',
            manual: { ...manualEntry.manual, site: { name: 'Guest Reef' } },
          },
        ]),
      );

      expect(renderer.root.findAllByProps({ testID: 'logbook-device-badge-Guest Reef' })).toHaveLength(0);
    });

    test('renders the account copy once when composed rows share a local id', async () => {
      const guestEntry = {
        ...manualEntry,
        ownerUserId: undefined,
        manual: { ...manualEntry.manual, site: { name: 'Guest Duplicate Reef' } },
      };
      const accountEntry = {
        ...guestEntry,
        ownerUserId: 'user-1',
        manual: { ...guestEntry.manual, site: { name: 'Account Duplicate Reef' } },
      };
      const composed = composeAccountAndDeferredGuestRows<DiveLogEntry>([accountEntry], [guestEntry]);
      const renderer = await renderLogbook(new LocalDiveLogRepository(composed), { isAuthenticated: true });

      expect(composed).toHaveLength(1);
      expect(composed[0]).toEqual(expect.objectContaining({ ownerUserId: 'user-1' }));
      expect(renderer.root.findAllByProps({ testID: 'logbook-list-item-Account Duplicate Reef' }).length).toBeGreaterThan(0);
      expect(renderer.root.findAllByProps({ testID: 'logbook-list-item-Guest Duplicate Reef' })).toHaveLength(0);
      expect(renderer.root.findAllByProps({ testID: 'logbook-device-badge-Account Duplicate Reef' })).toHaveLength(0);
    });
  });

  describe('editor', () => {
    test('create action opens the full-screen editor with a pinned back control and save', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([]));
      const root = renderer.root;

      await press(root, 'logbook-create-action');

      expect(root.findByProps({ testID: 'log-entry-editor-site-name' })).toBeTruthy();
      // The save button lives in the sticky bar, outside the scrolling body.
      const actions = root.findByProps({ testID: 'log-entry-editor-actions' });
      expect(actions.findByProps({ testID: 'log-entry-editor-save' }).props.label).toBe('Save log');
      expect(root.findByProps({ testID: 'log-entry-editor-body' }).findAllByProps({ testID: 'log-entry-editor-save' })).toHaveLength(0);
      expect(root.findAll(node => node.props.children === 'Manual log').length).toBeGreaterThan(0);
      expect(root.findByProps({ testID: 'log-entry-editor-back-icon' })).toBeTruthy();

      await press(root, 'log-entry-editor-back');

      expect(root.findAllByProps({ testID: 'log-entry-editor-title' })).toHaveLength(0);
      expect(root.findByProps({ testID: 'logbook-create-action' })).toBeTruthy();
    });

    test('gives every text field its visible label for VoiceOver', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([]), {
        initialRoute: { name: 'create', entry: createBlankDiveLogEntry() },
      });
      const root = renderer.root;

      expect(fieldLabel(root, 'log-entry-editor-site-name')).toBe('Dive site');
      expect(fieldLabel(root, 'log-entry-editor-notes')).toBe('Notes');

      await openDetails(root);
      expect(fieldLabel(root, 'log-entry-editor-gear')).toBe('Gear');
      expect(fieldLabel(root, 'log-entry-editor-buddies-input')).toBe('Buddies');
      expect(fieldLabel(root, 'log-entry-editor-tags-input')).toBe('Tags');
      expect(fieldLabel(root, 'log-entry-editor-marine-life-input')).toBe('Observed marine life');

      await press(root, 'log-entry-editor-mode-freedive');
      expect(fieldLabel(root, 'log-entry-editor-training-focus')).toBe('Training goal');
      expect(renderedSource(renderer)).not.toContain('Input Field');
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

    test('orders the sections 기본, 후기, 세부 정보 and keeps details collapsed for a new log', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([]), {
        initialRoute: { name: 'create', entry: createBlankDiveLogEntry({ now: 1781351000 }) },
      });
      await ReactTestRenderer.act(async () => {
        await i18n.changeLanguage('ko');
      });
      const root = renderer.root;
      const headers = root
        .findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'header')
        .map(node => React.Children.toArray(node.props.children).join(''));

      expect(headers).toEqual(expect.arrayContaining(['기본', '후기']));
      expect(headers.indexOf('기본')).toBeLessThan(headers.indexOf('후기'));
      expect(root.findByProps({ testID: 'log-entry-editor-details-toggle' }).props.accessibilityState).toEqual({ expanded: false });
      expect(root.findAllByProps({ testID: 'log-entry-editor-buddies-input' })).toHaveLength(0);

      await press(root, 'log-entry-editor-details-toggle');

      expect(root.findAllByProps({ testID: 'log-entry-editor-buddies-input' }).length).toBeGreaterThan(0);
      expect(root.findAllByProps({ testID: 'log-entry-editor-water-condition-unknown' })).toHaveLength(0);
    });

    test('shows numbers as value rows with unknown placeholders and opens one wheel at a time in a sheet', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([]));
      const root = renderer.root;

      await press(root, 'logbook-create-action');

      expect(root.findByProps({ testID: 'log-entry-editor-started-at-trigger' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-editor-started-at-date' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-editor-started-at-time' })).toBeTruthy();
      expect(hostText(root, 'log-entry-editor-duration-row-value')).toBe('--:--');
      expect(hostText(root, 'log-entry-editor-max-depth-row-value')).toBe('-- m');
      // No wheel sits inside the scrolling form, so a page scroll can never change a value.
      expect(root.findAllByProps({ testID: 'log-entry-editor-duration-wheel' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'log-entry-editor-max-depth-wheel' })).toHaveLength(0);

      await press(root, 'log-entry-editor-duration-trigger');

      expect(root.findByProps({ testID: 'log-entry-editor-duration-column-minutes-wheel-list' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-editor-duration-column-seconds-wheel-list' })).toBeTruthy();
      await press(root, 'log-entry-editor-duration-chip-45');
      expect(hostText(root, 'log-entry-editor-duration-row-value')).toBe('45:00');

      await press(root, 'log-entry-editor-max-depth-trigger');
      expect(root.findByProps({ testID: 'log-entry-editor-max-depth-column-meters-wheel-list' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-editor-max-depth-column-tenths-wheel-list' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-editor-max-depth-unit-fixed' }).props.children).toBe('m');
      await press(root, 'log-entry-editor-max-depth-chip-18');
      expect(hostText(root, 'log-entry-editor-max-depth-row-value')).toBe('18.0 m');

      await press(root, 'log-entry-editor-max-depth-trigger');
      await press(root, 'log-entry-editor-max-depth-clear');
      expect(hostText(root, 'log-entry-editor-max-depth-row-value')).toBe('-- m');

      expect(root.findAllByProps({ testID: 'log-entry-editor-started-at' }).filter(match => typeof match.props.onChangeText === 'function')).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'log-entry-editor-duration-slider' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'log-entry-editor-duration-decrement' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'log-entry-editor-duration-increment' })).toHaveLength(0);
      expect(root.findAllByProps({ children: 'OPTIONAL' })).toHaveLength(0);
    });

    test('limits the start time to now and saves the picked value', async () => {
      const repository = new LocalDiveLogRepository([], { now: () => 1781351000 });
      const renderer = await renderLogbook(repository);
      const root = renderer.root;
      const startedAt = new Date('2026-06-20T09:30:00');

      await press(root, 'logbook-create-action');
      await press(root, 'log-entry-editor-started-at-trigger');
      const maximumDate = root.findByProps({ testID: 'log-entry-editor-started-at-picker' }).props.maximumDate as Date;
      expect(maximumDate).toBeInstanceOf(Date);
      expect(Math.abs(maximumDate.getTime() - Date.now())).toBeLessThan(60_000);
      await press(root, 'log-entry-editor-started-at-done');

      await changeDateTime(root, 'log-entry-editor-started-at', startedAt);
      await changeText(root, 'log-entry-editor-site-name', 'Blue Corner');
      await changeTextInput(root, 'log-entry-editor-duration', '47:00');
      await changeNumber(root, 'log-entry-editor-max-depth', 18.6);
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.measuredValues.startedAt).toBe(startedAt.getTime() / 1000);
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
        cloudSyncStatus: 'notConfigured',
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

    test('allows manual depths above 40m while showing watch support warnings', async () => {
      const repository = new LocalDiveLogRepository([], { now: () => 1781351000 });
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await fillManualDraft(root, {
        'log-entry-editor-site-name': 'Forty Two Reef',
        'log-entry-editor-max-depth': '42.3',
      });

      expect(root.findByProps({ testID: 'log-entry-editor-unsupported-depth-warning' }).props.children).toContain(
        'Beyond the depth this app supports on Apple Watch',
      );
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.measuredValues.maxDepthMeters).toBe(42.3);
      expect(root.findByProps({ testID: 'logbook-list-unsupported-depth-Forty Two Reef' }).props.label).toBe('Outside supported depth');

      await press(root, 'logbook-list-item-Forty Two Reef');
      expect(root.findByProps({ testID: 'log-entry-detail-unsupported-depth-warning' }).props.children).toContain(
        'Beyond the depth this app supports on Apple Watch',
      );
    });

    test('blocks saving a manual log until required fields are valid', async () => {
      const repository = new LocalDiveLogRepository([], { now: () => 1781351000 });
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await press(root, 'log-entry-editor-save');

      expect(root.findByProps({ testID: 'log-entry-editor-site-name-error' }).props.children).toBe('Enter a dive site.');
      expect(root.findByProps({ testID: 'log-entry-editor-duration-error' }).props.children).toBe('Dive time is required.');
      expect(root.findByProps({ testID: 'log-entry-editor-max-depth-error' }).props.children).toBe('Max depth (m) is required.');
      expect(await repository.list()).toEqual([]);
    });

    test('reports the first invalid field and announces its message', async () => {
      const onInvalidSubmit = jest.fn();
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      const renderer = await renderElement(
        <LogEntryEditor entry={createBlankDiveLogEntry({ now: 1781351000 })} onCancel={jest.fn()} onSave={jest.fn()} onInvalidSubmit={onInvalidSubmit} />,
      );

      await press(renderer.root, 'log-entry-editor-save');

      expect(onInvalidSubmit).toHaveBeenCalledWith('siteName');
      expect(announce).toHaveBeenCalledWith('Enter a dive site.');
    });

    test('scrolls to the measured section of the first invalid field on a failed save', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([]));
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await layout(root, 'log-entry-editor-body', 16);
      await layout(root, 'log-entry-editor-essentials-anchor', 120);
      await press(root, 'log-entry-editor-save');

      // body y + anchor y - 16 pt of breathing room above the section.
      expect(root.findByProps({ testID: 'log-entry-editor-scroll-target' }).props.children).toBe('120');
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

      expect(root.findByProps({ testID: 'log-entry-editor-duration-error' }).props.children).toBe('Dive time is required.');
      expect(root.findByProps({ testID: 'log-entry-editor-max-depth-error' }).props.children).toBe('Max depth (m) is required.');
      expect((await repository.list()).find(entry => entry.manual.site.name === 'Blank Metrics Reef')).toBeUndefined();
    });

    test('explains invalid manual numeric schema values instead of returning generic messages', async () => {
      await i18n.changeLanguage('ko');
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
        expect(result.error.flatten().fieldErrors.durationSeconds).toContain('다이빙 시간은 0 이상이어야 합니다.');
        expect(result.error.flatten().fieldErrors.maxDepthMeters).toContain('최대 수심(m)은 0 이상이어야 합니다.');
      }
    });

    test('capitalizes names, leaves tags as typed, and moves from the site to the notes', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([]));
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      const siteInput = root.findAllByProps({ testID: 'log-entry-editor-site-name' }).find(node => typeof node.props.onChangeText === 'function')!;

      expect(siteInput.props.autoCapitalize).toBe('words');
      expect(siteInput.props.returnKeyType).toBe('next');
      expect(typeof siteInput.props.onSubmitEditing).toBe('function');

      await openDetails(root);
      const buddiesInput = root.findAllByProps({ testID: 'log-entry-editor-buddies-input' }).find(node => typeof node.props.onChangeText === 'function')!;
      const tagsInput = root.findAllByProps({ testID: 'log-entry-editor-tags-input' }).find(node => typeof node.props.onChangeText === 'function')!;

      expect(buddiesInput.props.autoCapitalize).toBe('words');
      expect(tagsInput.props.autoCapitalize).toBe('none');
    });

    test('offers sites and buddies from earlier logs as chips', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntry]));
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await press(root, 'log-entry-editor-site-suggestion-Manual Reef');

      expect(root.findAllByProps({ testID: 'log-entry-editor-site-name' }).find(node => node.props.value !== undefined)!.props.value).toBe(
        'Manual Reef',
      );
      expect(root.findAllByProps({ testID: 'log-entry-editor-site-suggestion-Manual Reef' })).toHaveLength(0);

      await openDetails(root);
      await press(root, 'log-entry-editor-buddies-suggestion-Jin');

      expect(root.findByProps({ testID: 'log-entry-editor-buddies-badge-Jin' })).toBeTruthy();
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
      await openDetails(root);
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

    test('commits a badge on return as well as on a comma', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([]));
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await openDetails(root);
      await changeText(root, 'log-entry-editor-tags-input', 'reef');
      await ReactTestRenderer.act(async () => {
        root
          .findAllByProps({ testID: 'log-entry-editor-tags-input' })
          .find(match => typeof match.props.onSubmitEditing === 'function')!
          .props.onSubmitEditing();
      });

      expect(root.findByProps({ testID: 'log-entry-editor-tags-badge-reef' })).toBeTruthy();
    });

    test('commits the final comma-separated badge token before saving', async () => {
      const repository = new LocalDiveLogRepository([], { now: () => 1781354000 });
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await changeDateTime(root, 'log-entry-editor-started-at', new Date('2026-06-20T09:30:00'));
      await changeText(root, 'log-entry-editor-site-name', 'Badge Save Reef');
      await changeNumber(root, 'log-entry-editor-duration', 45 * 60);
      await changeNumber(root, 'log-entry-editor-max-depth', 18);
      await openDetails(root);
      await changeText(root, 'log-entry-editor-buddies-input', 'Mina, Alex');
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.buddyIds).toEqual(['Mina', 'Alex']);
    });

    test('commits the final badge token on blur and styles every badge as primary', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([], { now: () => 1781354000 }));
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await openDetails(root);
      await changeText(root, 'log-entry-editor-tags-input', 'reef, training');

      await ReactTestRenderer.act(async () => {
        root
          .findAllByProps({ testID: 'log-entry-editor-tags-input' })
          .find(match => typeof match.props.onBlur === 'function')!
          .props.onBlur();
      });

      expect(root.findByProps({ testID: 'log-entry-editor-tags-badge-reef' }).props.className).toEqual(
        expect.stringContaining('bg-primary/10'),
      );
      expect(root.findByProps({ testID: 'log-entry-editor-tags-badge-training' }).props.className).toEqual(
        expect.stringContaining('bg-primary/10'),
      );
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
      await openDetails(root);
      await press(root, 'log-entry-editor-visibility-rating-star-4');
      await press(root, 'log-entry-editor-perceived-exertion-star-3');
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.rating).toBe(5);
      expect(savedEntry.manual.measuredValues.visibilityRating).toBe(4);
      expect(savedEntry.manual.measuredValues.perceivedExertion).toBe(3);
    });

    test('shows fixed Air gas as a read-only row and saves scuba pressure metadata', async () => {
      const repository = new LocalDiveLogRepository([], { now: () => 1781351000 });
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await press(root, 'log-entry-editor-mode-scuba');
      await openDetails(root);
      expect(root.findByProps({ testID: 'log-entry-editor-gas-label-air' }).props.onPress).toBeUndefined();
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

    test('saves scuba-specific fields from the details section', async () => {
      const repository = new LocalDiveLogRepository([]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await fillManualDraft(root, { 'log-entry-editor-site-name': 'Scuba Wall' }, 'scuba');
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

    test('a second tap clears the water condition', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([]));
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await press(root, 'log-entry-editor-mode-scuba');
      await openDetails(root);
      await press(root, 'log-entry-editor-water-condition-mild');
      expect(root.findByProps({ testID: 'log-entry-editor-water-condition-mild' }).props.selected).toBe(true);
      await press(root, 'log-entry-editor-water-condition-mild');
      expect(root.findByProps({ testID: 'log-entry-editor-water-condition-mild' }).props.selected).toBe(false);
    });

    test('saves optional entry style from the manual editor', async () => {
      const repository = new LocalDiveLogRepository([]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await fillManualDraft(root, { 'log-entry-editor-site-name': 'Entry Style Reef' }, 'scuba');
      await press(root, 'log-entry-editor-entry-style-shore');
      await press(root, 'log-entry-editor-save');

      const savedEntry = (await repository.list()).find(entry => entry.manual.site.name === 'Entry Style Reef');

      expect(savedEntry?.manual.entryStyle).toBe('shore');
    });

    test('switches to a freedive form and does not persist hidden scuba-only fields', async () => {
      const repository = new LocalDiveLogRepository([]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await press(root, 'log-entry-editor-mode-scuba');
      await openDetails(root);
      expect(root.findByProps({ testID: 'log-entry-editor-gas-label-air' })).toBeTruthy();
      await press(root, 'log-entry-editor-mode-freedive');

      expect(root.findByProps({ testID: 'log-entry-editor-repetition-count' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-editor-training-focus' })).toBeTruthy();
      expect(() => root.findByProps({ testID: 'log-entry-editor-gas-label-air' })).toThrow();

      await fillManualDraft(root, { 'log-entry-editor-site-name': 'Line Session', 'log-entry-editor-max-depth': '21' }, 'freedive');
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

    test('failed local save shows an error above the save button and allows retrying the same draft', async () => {
      const repository = new ToggleFailSaveRepository([]);
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-create-action');
      await fillManualDraft(root, { 'log-entry-editor-site-name': 'Retry Reef' });
      await press(root, 'log-entry-editor-save');

      expect(await repository.list()).toHaveLength(0);
      const actions = root.findByProps({ testID: 'log-entry-editor-actions' });
      expect(actions.findByProps({ testID: 'log-entry-editor-error' }).props.children).toBe('Couldn’t save this log on this device. Try again.');
      expect(announce).toHaveBeenCalledWith('Couldn’t save this log on this device. Try again.');

      repository.shouldFailSave = false;
      await press(root, 'log-entry-editor-save');

      expect((await repository.list()).find(entry => entry.manual.site.name === 'Retry Reef')).toBeTruthy();
      expect(root.findByProps({ testID: 'logbook-list-item-Retry Reef' })).toBeTruthy();
    });

    test('keeps the save button busy without changing its label while the save runs', async () => {
      let finishSave: (() => void) | undefined;
      const onSave = jest.fn(
        (entry: DiveLogEntry) =>
          new Promise<DiveLogEntry>(resolve => {
            finishSave = () => resolve(entry);
          }),
      );
      const entry = { ...manualEntry, localId: 'pending-save-entry' };
      const renderer = await renderElement(<LogEntryEditor entry={entry} mode="edit" onCancel={jest.fn()} onSave={onSave} />);
      const root = renderer.root;

      await ReactTestRenderer.act(async () => {
        void root.findByProps({ testID: 'log-entry-editor-save' }).props.onPress();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });

      const saveButton = root.findByProps({ testID: 'log-entry-editor-save' });
      expect(saveButton.props.label).toBe('Save changes');
      expect(saveButton.props.pending).toBe(true);
      expect(onSave).toHaveBeenCalledTimes(1);

      await ReactTestRenderer.act(async () => {
        finishSave?.();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });

      expect(root.findByProps({ testID: 'log-entry-editor-save' }).props.pending).toBe(false);
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
        initialRoute: { name: 'create', entry: pendingDraft, sourcePlanLocalId: 'plan-1' },
        onPendingDraftSave,
      });
      const root = renderer.root;

      expect(root.findAllByProps({ testID: 'log-entry-editor-site-name' }).find(node => node.props.value !== undefined)!.props.value).toBe('Plan Reef');
      // The draft already has details, so the section opens on its own.
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
  });

  describe('watch-measured values in the editor', () => {
    test('locks watch start time, dive time and max depth behind a 워치 측정값 chip', async () => {
      const repository = new LocalDiveLogRepository([watchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-list-item-Watch Reef');
      await press(root, 'log-entry-detail-edit');

      expect(root.findAll(node => node.props.children === 'Watch log').length).toBeGreaterThan(0);
      expect(hostText(root, 'log-entry-editor-duration-row-value')).toBe('10:00');
      expect(hostText(root, 'log-entry-editor-max-depth-row-value')).toBe('12.0 m');
      expect(hostText(root, 'log-entry-editor-duration-badge')).toBe('Recorded by watch');
      expect(hostText(root, 'log-entry-editor-started-at-badge')).toBe('Recorded by watch');
      // Read-only: nothing opens a picker until the user chooses to change the value.
      expect(root.findAllByProps({ testID: 'log-entry-editor-duration-trigger' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'log-entry-editor-max-depth-trigger' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'log-entry-editor-started-at-trigger' })).toHaveLength(0);
    });

    test('edits a watch-backed entry without losing watch capture provenance', async () => {
      const repository = new LocalDiveLogRepository([watchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-list-item-Watch Reef');
      await press(root, 'log-entry-detail-edit');
      await changeText(root, 'log-entry-editor-site-name', 'Edited Watch Reef');
      await changeText(root, 'log-entry-editor-notes', 'Reviewed on mobile.');
      await press(root, 'log-entry-editor-save');

      const entries = await repository.list();

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        localId: 'watch:watch-entry-1:1781352600',
        source: 'watch',
        cloudSyncStatus: 'notConfigured',
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

    test('shows the import default site as an empty field and keeps it stored when left empty', async () => {
      const unnamedWatchEntry = watchSessionToDiveLogEntry({
        now: 1781353000,
        session: { ...(watchEntry.watchCapture!.session as WatchSession), localSessionId: 'unnamed-site-entry', siteName: undefined } as WatchSession,
      });
      const repository = new LocalDiveLogRepository([unnamedWatchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;
      const siteField = () => root.findAll(node => node.props.testID === 'log-entry-editor-site-name' && typeof node.props.onChangeText === 'function')[0];

      await press(root, 'logbook-list-item-워치 다이브');
      await press(root, 'log-entry-detail-edit');

      expect(siteField().props.value).toBe('');
      expect(siteField().props.placeholder).toBeTruthy();
      expect(renderedSource(renderer)).not.toContain('워치 다이브');

      await changeText(root, 'log-entry-editor-notes', 'Drift along the wall.');
      await press(root, 'log-entry-editor-save');

      expect(exists(root, 'log-entry-editor-site-name-error')).toBe(false);
      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.notes).toBe('Drift along the wall.');
      // Guest claim reuse compares site_name exactly, so the stored default stays as imported.
      expect(savedEntry.manual.site.name).toBe('워치 다이브');
    });

    test('saves a site typed over the import default', async () => {
      const unnamedWatchEntry = watchSessionToDiveLogEntry({
        now: 1781353000,
        session: { ...(watchEntry.watchCapture!.session as WatchSession), localSessionId: 'renamed-site-entry', siteName: undefined } as WatchSession,
      });
      const repository = new LocalDiveLogRepository([unnamedWatchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-list-item-워치 다이브');
      await press(root, 'log-entry-detail-edit');
      await changeText(root, 'log-entry-editor-site-name', 'House Reef');
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.site.name).toBe('House Reef');
    });

    test('renders watch duration seconds and depth tenths without dirtying untouched watch metrics', async () => {
      const repository = new LocalDiveLogRepository([secondPreciseWatchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-list-item-Second Precise Reef');
      await press(root, 'log-entry-detail-edit');

      expect(hostText(root, 'log-entry-editor-duration-row-value')).toBe('10:02');
      expect(hostText(root, 'log-entry-editor-max-depth-row-value')).toBe('18.6 m');

      await changeText(root, 'log-entry-editor-site-name', 'Reviewed Precise Reef');
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.measuredValues.durationSeconds).toBeUndefined();
      expect(savedEntry.manual.measuredValues.maxDepthMeters).toBeUndefined();
      expect(savedEntry.provenance.durationSeconds).toBe('watch');
      expect(savedEntry.provenance.maxDepthMeters).toBe('watch');
    });

    test('saves a changed watch dive time as a manual override without changing untouched depth', async () => {
      const repository = new LocalDiveLogRepository([secondPreciseWatchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-list-item-Second Precise Reef');
      await press(root, 'log-entry-detail-edit');
      await press(root, 'log-entry-editor-duration-override');
      await changeTextInput(root, 'log-entry-editor-duration', '11:03');
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.measuredValues.durationSeconds).toBe(663);
      expect(savedEntry.manual.measuredValues.maxDepthMeters).toBeUndefined();
      expect(savedEntry.provenance.durationSeconds).toBe('manual');
      expect(savedEntry.provenance.maxDepthMeters).toBe('watch');
    });

    test('saves a changed watch depth as a manual override without changing untouched watch metrics', async () => {
      const repository = new LocalDiveLogRepository([watchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-list-item-Watch Reef');
      await press(root, 'log-entry-detail-edit');
      await press(root, 'log-entry-editor-max-depth-override');
      await changeNumber(root, 'log-entry-editor-max-depth', 15.5);
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();

      expect(savedEntry.manual.measuredValues.maxDepthMeters).toBe(15.5);
      expect(savedEntry.manual.measuredValues.durationSeconds).toBeUndefined();
      expect(savedEntry.provenance.maxDepthMeters).toBe('manual');
      expect(savedEntry.provenance.durationSeconds).toBe('watch');
    });

    test('goes back to the watch value from an earlier manual change', async () => {
      const repository = new LocalDiveLogRepository([hybridWatchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-list-item-Hybrid Reef');
      await press(root, 'log-entry-detail-edit');

      // The changed depth is open for editing and offers the watch value back.
      expect(hostText(root, 'log-entry-editor-max-depth-row-value')).toBe('19.0 m');
      await press(root, 'log-entry-editor-max-depth-restore');
      expect(hostText(root, 'log-entry-editor-max-depth-row-value')).toBe('12.0 m');
      expect(hostText(root, 'log-entry-editor-max-depth-badge')).toBe('Recorded by watch');
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.provenance.maxDepthMeters).toBe('watch');
      expect(savedEntry.manual.measuredValues.maxDepthMeters).toBeUndefined();
    });

    test('opens a locked watch value that fails validation so its message is visible', async () => {
      const deepWatchEntry: DiveLogEntry = {
        ...watchEntry,
        localId: 'watch:deep-entry:1781352600',
        manual: { ...watchEntry.manual, site: { name: 'Deep Watch Reef' } },
        watchCapture: {
          ...watchEntry.watchCapture!,
          measuredValues: { ...watchEntry.watchCapture!.measuredValues, maxDepthMeters: 65 },
        },
      };
      const repository = new LocalDiveLogRepository([deepWatchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-list-item-Deep Watch Reef');
      await press(root, 'log-entry-detail-edit');
      expect(root.findAllByProps({ testID: 'log-entry-editor-max-depth-trigger' })).toHaveLength(0);
      await press(root, 'log-entry-editor-save');

      expect(root.findAllByProps({ testID: 'log-entry-editor-max-depth-trigger' }).length).toBeGreaterThan(0);
      expect(root.findAllByProps({ testID: 'log-entry-editor-max-depth-error' }).length).toBeGreaterThan(0);
      expect((await repository.list())[0].manual.site.name).toBe('Deep Watch Reef');
    });

    test('editing a watch-sourced scuba log saves end pressure and detail displays both pressures', async () => {
      const repository = new LocalDiveLogRepository([watchScubaPressureEditEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-list-item-Watch Pressure Edit Reef');
      await press(root, 'log-entry-detail-edit');
      await changeNumber(root, 'log-entry-editor-pressure-end', 70);
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.measuredValues.pressure).toEqual({ unit: 'bar', start: 200, end: 70 });

      await press(root, 'logbook-list-item-Watch Pressure Edit Reef');
      expect(root.findByProps({ testID: 'log-entry-detail-source' }).props.label).toBe('Watch');
      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-pressure-200→70bar' })).toBeTruthy();
    });
  });

  describe('detail', () => {
    test('marks demo watch captures on the log detail header', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([demoWatchEntry]));
      const root = renderer.root;

      await press(root, 'logbook-list-item-Demo Reef');

      expect(root.findByProps({ testID: 'log-entry-detail-source' }).props.label).toBe('Watch');
      expect(root.findByProps({ testID: 'log-entry-detail-demo-capture' }).props.label).toBe('Demo');
    });

    test('labels debug watch captures as tests instead of demos', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([debugTestWatchEntry]));
      const root = renderer.root;

      await press(root, 'logbook-list-item-Test Reef');

      expect(root.findByProps({ testID: 'log-entry-detail-test-capture' }).props.label).toBe('Test');
      expect(root.findAllByProps({ testID: 'log-entry-detail-demo-capture' })).toHaveLength(0);
    });

    test('shows the source once and marks only values the user changed', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([watchEntry, manualEntry, hybridWatchEntry]));
      const root = renderer.root;

      await press(root, 'logbook-list-item-Manual Reef');
      expect(root.findByProps({ testID: 'log-entry-detail-provenance-max-depth-manual' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-back-icon' })).toBeTruthy();
      expect(root.findAll(node => node.props.children === 'Changed by you')).toHaveLength(0);

      await press(root, 'log-entry-detail-back');
      await press(root, 'logbook-list-item-Watch Reef');
      expect(root.findByProps({ testID: 'log-entry-detail-provenance-max-depth-watch' })).toBeTruthy();
      // The source is the header chip alone; the facts no longer repeat it.
      expect(root.findAll(node => node.props.children === 'Recorded by watch')).toHaveLength(0);
      expect(root.findAll(node => node.props.children === 'Changed by you')).toHaveLength(0);

      await press(root, 'log-entry-detail-back');
      await press(root, 'logbook-list-item-Hybrid Reef');
      expect(root.findByProps({ testID: 'log-entry-detail-provenance-max-depth-manual' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-max-depth-value-19.0m' })).toBeTruthy();
      expect(root.findAll(node => node.props.children === 'Changed by you' && typeof node.type === 'string')).toHaveLength(1);
    });

    test('detail shows unknown placeholders for missing manual measurements', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntryWithoutMetrics]));
      const root = renderer.root;

      await press(root, 'logbook-list-item-No Metrics Reef');

      expect(root.findByProps({ testID: 'log-entry-detail-max-depth-value---m' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-duration-value---min' })).toBeTruthy();
    });

    test('shows grouped rows with a spoken rating and hides empty ones', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntry, manualEntryWithoutMetrics]));
      const root = renderer.root;

      await press(root, 'logbook-list-item-Manual Reef');

      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-rating-4of5stars' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-buddies-Jin' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-tags-shore' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-marine-life-octopus' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-note' }).props.children).toBe('Manual review note.');
      expect(root.findAll(node => node.props.children === 'none')).toHaveLength(0);

      await press(root, 'log-entry-detail-back');
      await press(root, 'logbook-list-item-No Metrics Reef');

      expect(root.findAll(node => String(node.props.testID ?? '').startsWith('log-entry-detail-mode-value-tags'))).toHaveLength(0);
      expect(root.findAll(node => String(node.props.testID ?? '').startsWith('log-entry-detail-mode-value-rating'))).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'log-entry-detail-note' })).toHaveLength(0);
    });

    test('detail shows watch depth profile, temperature profile, and raw quick note fallback', async () => {
      const samples = [
        { localSessionId: 'watch-entry-1', timestamp: 1781352000, depthMeters: 0, waterTemperatureCelsius: 25 },
        { localSessionId: 'watch-entry-1', timestamp: 1781352300, depthMeters: 12, waterTemperatureCelsius: 24 },
      ];
      const watchEntryWithProfiles: DiveLogEntry = {
        ...watchEntry,
        localId: 'watch-entry-profiles',
        manual: { ...watchEntry.manual, site: { name: 'Profile Reef' }, notes: '' },
        watchCapture: {
          ...watchEntry.watchCapture!,
          session: { ...watchEntry.watchCapture!.session, siteName: 'Profile Reef', notes: 'Watch quick note from pre-dive', samples },
          samples,
        },
      };
      const renderer = await renderLogbook(new LocalDiveLogRepository([watchEntryWithProfiles]));
      const root = renderer.root;

      await press(root, 'logbook-list-item-Profile Reef');

      expect(root.findByProps({ testID: 'log-entry-detail-depth-profile' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-temperature-profile' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-note' }).props.children).toBe('Watch quick note from pre-dive');
    });

    test('detail hides temperature metric and profile when no temperature was measured', async () => {
      const samples = [
        { localSessionId: 'watch-entry-without-temperature', timestamp: 1781352000, depthMeters: 0 },
        { localSessionId: 'watch-entry-without-temperature', timestamp: 1781352300, depthMeters: 12 },
      ];
      const watchEntryWithoutTemperature: DiveLogEntry = {
        ...watchEntry,
        localId: 'watch-entry-without-temperature',
        manual: { ...watchEntry.manual, site: { name: 'Depth Only Reef' } },
        watchCapture: {
          ...watchEntry.watchCapture!,
          session: { ...watchEntry.watchCapture!.session, localSessionId: 'watch-entry-without-temperature', siteName: 'Depth Only Reef', samples },
          samples,
        },
      };
      const renderer = await renderLogbook(new LocalDiveLogRepository([watchEntryWithoutTemperature]));
      const root = renderer.root;

      await press(root, 'logbook-list-item-Depth Only Reef');

      expect(root.findAll(node => node.props.children === 'Water temp')).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'log-entry-detail-temperature-profile' })).toHaveLength(0);
      expect(root.findByProps({ testID: 'log-entry-detail-depth-profile' })).toBeTruthy();
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
        manual: { ...watchEntry.manual, site: { name: 'Large Profile Reef' } },
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
      const renderer = await renderLogbook(new LocalDiveLogRepository([watchEntryWithLargeProfiles]));
      const root = renderer.root;

      await press(root, 'logbook-list-item-Large Profile Reef');

      expect(root.findByProps({ testID: 'log-entry-detail-depth-profile' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-depth-profile-chart' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-temperature-profile' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-temperature-profile-chart' })).toBeTruthy();
    });

    test('holds the profile slot with a delayed skeleton while the watch profile loads', async () => {
      jest.useFakeTimers();
      const watchWithoutListSamples: DiveLogEntry = {
        ...watchEntry,
        watchCapture: { ...watchEntry.watchCapture!, samples: [] },
      };
      const renderer = await renderElement(<LogEntryDetail entry={watchWithoutListSamples} profileSamples={[]} isProfileLoading />);
      const skeleton = () =>
        renderer.root
          .findByProps({ testID: 'log-entry-detail-profile-loading' })
          .findAll(node => typeof node.type === 'string' && node.props.accessibilityElementsHidden === true && String(node.props.className).includes('bg-skeleton'))[0];

      expect(skeleton().props.className).toContain('opacity-0');
      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(skeleton().props.className).toContain('opacity-100');

      await ReactTestRenderer.act(async () => {
        renderer.update(
          <Providers>
            <LogEntryDetail entry={watchWithoutListSamples} profileSamples={[]} isProfileLoading={false} />
          </Providers>,
        );
      });
      expect(renderer.root.findAllByProps({ testID: 'log-entry-detail-profile-loading' })).toHaveLength(0);
    });

    test('does not show an entry style detail row for existing logs without entry style', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([manualEntry]));
      const root = renderer.root;

      await press(root, 'logbook-list-item-Manual Reef');

      expect(root.findAllByProps({ testID: 'log-entry-detail-mode-value-entry-style-shore' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'log-entry-detail-mode-value-entry-style-boat' })).toHaveLength(0);
      expect(root.findAllByProps({ testID: 'log-entry-detail-mode-value-entry-style-pool' })).toHaveLength(0);
    });

    test('leaves the watch\'s untouched import pressure out of the detail and the editor and keeps it stored', async () => {
      const repository = new LocalDiveLogRepository([watchEntry]);
      const renderer = await renderLogbook(repository);
      const root = renderer.root;

      await press(root, 'logbook-list-item-Watch Reef');
      expect(root.findAll(node => String(node.props.testID ?? '').startsWith('log-entry-detail-mode-value-pressure'))).toHaveLength(0);

      await press(root, 'log-entry-detail-edit');
      // Nothing the diver entered sits in 세부 정보, so it stays closed.
      expect(exists(root, 'log-entry-editor-details-content')).toBe(false);
      await openDetails(root);
      expect(hostText(root, 'log-entry-editor-pressure-start-row-value')).toBe('-- bar');

      await changeText(root, 'log-entry-editor-notes', 'Easy drift.');
      await press(root, 'log-entry-editor-save');

      const [savedEntry] = await repository.list();
      expect(savedEntry.manual.measuredValues.pressure).toEqual({ unit: 'bar', start: 150 });
      expect(savedEntry.provenance.pressure).toBeUndefined();
    });

    test('reads a recommended-stop status it does not know as --, never its raw code', async () => {
      const futureStatusEntry: DiveLogEntry = {
        ...watchEntry,
        watchCapture: {
          ...watchEntry.watchCapture!,
          session: {
            ...watchEntry.watchCapture!.session,
            scuba: {
              ...watchEntry.watchCapture!.session.scuba!,
              safetyStop: { ...watchEntry.watchCapture!.session.scuba!.safetyStop, status: 'futureStatus' as never },
            },
          },
        },
      };
      const renderer = await renderElement(<LogEntryDetail entry={futureStatusEntry} />);

      expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Recommended stop, --').length).toBeGreaterThan(0);
      expect(renderedSource(renderer)).not.toContain('futureStatus');
    });

    test('shows the stored Air gas in the current language', async () => {
      const renderer = await renderElement(<LogEntryDetail entry={watchEntry} />);

      expect(renderer.root.findByProps({ testID: 'log-entry-detail-mode-value-gas-label-Air' })).toBeTruthy();

      await ReactTestRenderer.act(async () => {
        await i18n.changeLanguage('ko');
      });

      expect(renderer.root.findByProps({ testID: 'log-entry-detail-mode-value-gas-label-공기' })).toBeTruthy();
    });

    test('detail displays scuba-specific metadata in review formats', async () => {
      const renderer = await renderLogbook(new LocalDiveLogRepository([scubaEntry]));
      const root = renderer.root;

      await press(root, 'logbook-list-item-Scuba Metadata Reef');

      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-gas-label-EAN32' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-gear-bcd-1,computer-1' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-water-condition-Mild' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-visibility-rating-4/5' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-perceived-exertion-3/5' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-mode-value-pressure-200→70bar' })).toBeTruthy();
      expect(root.findByProps({ testID: 'log-entry-detail-max-depth-value-20.0m' })).toBeTruthy();
    });

    test('shows delete progress and an inline error when deleting fails', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
        buttons?.find(button => button.style === 'destructive')?.onPress?.();
      });
      let rejectDelete: ((error: Error) => void) | undefined;
      const onDelete = jest.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectDelete = reject;
          }),
      );
      const renderer = await renderElement(<LogEntryDetail entry={manualEntry} onDelete={onDelete} />);
      const root = renderer.root;

      await press(root, 'log-entry-detail-delete');

      expect(alert).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledWith('manual-entry-1');
      expect(deleteRowState(root)).toEqual({ busy: true, disabled: true });
      // Busy at once; the spinner waits for the shared delay.
      expect(root.findAllByProps({ testID: 'log-entry-detail-delete-spinner' })).toHaveLength(0);

      await ReactTestRenderer.act(async () => {
        rejectDelete?.(new Error('storage'));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });

      expect(deleteRowState(root)).toEqual({ busy: false, disabled: false });
      expect(hostText(root, 'log-entry-detail-delete-error')).toBe('Couldn’t delete this log. Try again.');
    });
  });
});
