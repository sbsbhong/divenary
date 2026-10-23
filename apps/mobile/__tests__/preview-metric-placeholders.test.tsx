import React from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import i18n from '../src/i18n';
import HomeScreen from '../src/screens/home/screen';
import MemoryScreen from '../src/screens/memory/screen';
import { AppPreferencesProvider } from '../src/states/app-preferences';
import type { MobileDiveSession } from '../src/types/dive-session';

const blankManualSession: MobileDiveSession = {
  localSessionId: 'manual-entry-no-metrics',
  startedAt: 1781350200,
  samples: [],
  importKey: 'manual-entry-no-metrics',
  importedAt: 1781351000,
  mediaPlaceholders: [],
  siteName: 'No Metrics Reef',
  tags: [],
};

const collectText = (node: ReactTestRenderer.ReactTestRendererJSON | ReactTestRenderer.ReactTestRendererJSON[] | string | null): string[] => {
  if (!node) {
    return [];
  }

  if (typeof node === 'string') {
    return [node];
  }

  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }

  return node.children?.flatMap(collectText) ?? [];
};

// Home keeps loading conditions (and its delayed loading feedback timers) until it unmounts.
const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];
const createRenderer = (element: React.ReactElement): ReactTestRenderer.ReactTestRenderer => {
  const renderer = ReactTestRenderer.create(element);
  mountedRenderers.push(renderer);
  return renderer;
};

describe('preview metric placeholders', () => {
  beforeEach(async () => {
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      for (const renderer of mountedRenderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  test('Home preview keeps unknown manual duration and depth as placeholders', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = createRenderer(
        <AppPreferencesProvider>
          <HomeScreen
            sessions={[blankManualSession]}
            onCreateLog={jest.fn()}
            onCreatePlan={jest.fn()}
            onRefresh={jest.fn()}
          />
        </AppPreferencesProvider>,
      );
    });

    const text = collectText(renderer!.toJSON());

    // Same unknown-value format as the log list and detail.
    expect(text).toContain('-- m');
    expect(text).toContain('--분');
    expect(text).not.toContain('0.0 m');
    expect(text).not.toContain('0:00');
    expect(text).not.toContain('0분');
  });

  test('Home preview uses native pull-to-refresh', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = createRenderer(
        <AppPreferencesProvider>
          <HomeScreen
            sessions={[blankManualSession]}
            onCreateLog={jest.fn()}
            onCreatePlan={jest.fn()}
            onRefresh={jest.fn()}
          />
        </AppPreferencesProvider>,
      );
    });

    const refreshControl = renderer!.root.findByType(ScrollView).props.refreshControl;
    expect(refreshControl.type).toBe(RefreshControl);
    expect(refreshControl.props.refreshing).toBe(false);
  });

  test('Home keeps one concise safety boundary without a duplicate reminder card', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = createRenderer(
        <AppPreferencesProvider>
          <HomeScreen
            sessions={[blankManualSession]}
            onCreateLog={jest.fn()}
            onCreatePlan={jest.fn()}
            onRefresh={jest.fn()}
          />
        </AppPreferencesProvider>,
      );
    });

    const text = collectText(renderer!.toJSON());

    expect(text).toContain('레크리에이션 기록 전용. 인증된 장비가 아닌 보조 도구.');
    expect(text).not.toContain('워치 리마인더 상태');
    expect(text).not.toContain('상승과 세이프티 스톱은 워치 로그에서 가져온 리뷰용 리마인더입니다.');
  });

  test('Home preview refreshes when the active home tab is selected again', async () => {
    const onRefresh = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = createRenderer(
        <AppPreferencesProvider>
          <HomeScreen
            sessions={[blankManualSession]}
            onCreateLog={jest.fn()}
            onCreatePlan={jest.fn()}
            onRefresh={onRefresh}
            reselectToken={0}
          />
        </AppPreferencesProvider>,
      );
    });

    await ReactTestRenderer.act(async () => {
      renderer!.update(
        <AppPreferencesProvider>
          <HomeScreen
            sessions={[blankManualSession]}
            onCreateLog={jest.fn()}
            onCreatePlan={jest.fn()}
            onRefresh={onRefresh}
            reselectToken={1}
          />
        </AppPreferencesProvider>,
      );
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test('Memory preview and aggregate metrics keep unknown manual values as placeholders', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = createRenderer(<MemoryScreen sessions={[blankManualSession]} onOpenLogbook={jest.fn()} />);
    });

    const text = collectText(renderer!.toJSON());

    expect(text).toEqual(expect.arrayContaining(['-- m', '--:--']));
    expect(text).not.toContain('0.0 m');
    expect(text).not.toContain('0:00');
  });
});
