import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { Path, Rect } from 'react-native-svg';
import i18n from '../src/i18n';
import { ProfileRevealChart } from '../src/components/charts/profile-reveal-chart';
import { LOGO_MARK_PATH } from '../src/components/brand/logo-mark';
import { LogEntryProfile } from '../src/screens/logbook/log-entry-profile';
import type { WatchDepthSample } from '../src/types/dive-session';
import { buildProfileRenderModel } from '../src/utils/session-profile-chart';

const reanimated = jest.requireMock<typeof import('react-native-reanimated')>('react-native-reanimated');

// The reanimated mock builds a new shared value on every render, which would reset the reveal on each
// re-render. A stable cell per component, as the real runtime keeps, lets these tests re-render to
// read the end state after the effect has run.
beforeAll(() => {
  jest.spyOn(reanimated, 'useSharedValue').mockImplementation(((initial: unknown) => {
    const [cell] = React.useState(() => {
      const next = {
        value: initial,
        get: () => next.value,
        set: (value: unknown) => {
          next.value = value;
        },
      };
      return next;
    });
    return cell;
  }) as typeof reanimated.useSharedValue);
});

beforeEach(() => {
  jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
  // Re-apply the stable-cell spy that restoreAllMocks removed.
  jest.spyOn(reanimated, 'useSharedValue').mockImplementation(((initial: unknown) => {
    const [cell] = React.useState(() => {
      const next = {
        value: initial,
        get: () => next.value,
        set: (value: unknown) => {
          next.value = value;
        },
      };
      return next;
    });
    return cell;
  }) as typeof reanimated.useSharedValue);
});

afterAll(() => {
  jest.restoreAllMocks();
});

const samples: WatchDepthSample[] = [
  { localSessionId: 'reveal', timestamp: 0, depthMeters: 0, waterTemperatureCelsius: 24 },
  { localSessionId: 'reveal', timestamp: 1, depthMeters: 10, waterTemperatureCelsius: 22 },
  { localSessionId: 'reveal', timestamp: 2, depthMeters: 20, waterTemperatureCelsius: 23 },
];

const CHART_WIDTH = 320;
const DEPTH_HEIGHT = 64;
const CLIP_BLEED = 10;
const DEPTH_TESTID = 'log-entry-detail-depth-profile';
const DEPTH_CHART_TESTID = 'log-entry-detail-depth-profile-chart';
const RIDER_TESTID = 'log-entry-detail-depth-profile-chart-logo-rider';

function profileElement(animationKey: string, kind: 'depth' | 'temperature' = 'depth') {
  return (
    <LogEntryProfile
      samples={samples}
      kind={kind}
      title="Depth"
      testID={kind === 'depth' ? DEPTH_TESTID : 'log-entry-detail-temperature-profile'}
      animationKey={animationKey}
    />
  );
}

function renderProfile(animationKey: string, kind: 'depth' | 'temperature' = 'depth') {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(profileElement(animationKey, kind));
  });
  return renderer!;
}

function rerenderProfile(renderer: ReactTestRenderer.ReactTestRenderer, animationKey: string, kind: 'depth' | 'temperature' = 'depth') {
  ReactTestRenderer.act(() => {
    renderer.update(profileElement(animationKey, kind));
  });
}

/** Host nodes only: composite wrappers repeat the testID prop, so counting them would double-count. */
function hostNodesWithTestID(renderer: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === testID);
}

/** The nearest host ancestor whose style sets an opacity; the Reduce Motion fade lives there. */
function fadingAncestor(node: ReactTestRenderer.ReactTestInstance): ReactTestRenderer.ReactTestInstance {
  let current: ReactTestRenderer.ReactTestInstance | null = node;
  while (current && !(typeof current.type === 'string' && StyleSheet.flatten(current.props.style)?.opacity !== undefined)) {
    current = current.parent;
  }
  return current!;
}

/** The clip rectangle's width, which is the reveal edge plus the bleed. */
function clipWidth(renderer: ReactTestRenderer.ReactTestRenderer): number {
  const rect = renderer.root.findByType(Rect);
  return (rect.props.animatedProps as { width: number }).width;
}

function linePath(renderer: ReactTestRenderer.ReactTestRenderer): string | undefined {
  // The line is the clipped stroke; the area shares the clip but is filled.
  return renderer.root.findAllByType(Path).find(node => node.props.clipPath !== undefined && node.props.fill === 'none')?.props.d;
}

function reportBoxLayout(renderer: ReactTestRenderer.ReactTestRenderer, width: number, height: number) {
  const box = renderer.root
    .findAll(node => typeof node.props.onLayout === 'function')
    .find(node => StyleSheet.flatten(node.props.style)?.height === height);
  ReactTestRenderer.act(() => {
    box!.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
  });
}

describe('log entry profile reveal', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ko');
  });

  test('the first show of an entry starts with the clip closed and includes the logo rider', () => {
    const renderer = renderProfile('reveal-first-show');

    expect(hostNodesWithTestID(renderer, RIDER_TESTID)).toHaveLength(1);
    // Only the bleed to the left of the chart is inside the clip before the draw starts.
    expect(clipWidth(renderer)).toBe(CLIP_BLEED);
  });

  test('the end state shows the full path and the full area, and the rider has faded out', () => {
    const renderer = renderProfile('reveal-end-state');
    rerenderProfile(renderer, 'reveal-end-state');

    const chart = buildProfileRenderModel({ samples, kind: 'depth', width: CHART_WIDTH, height: DEPTH_HEIGHT });
    expect(linePath(renderer)).toBe(chart.path);
    expect(clipWidth(renderer)).toBe(CLIP_BLEED + CHART_WIDTH);
    const area = renderer.root.findAllByType(Path).find(node => node.props.animatedProps?.fillOpacity !== undefined);
    expect(area?.props.animatedProps.fillOpacity).toBe(0.08);
    // The rider fades out after the draw, so it is still mounted but fully transparent.
    const rider = hostNodesWithTestID(renderer, RIDER_TESTID)[0]!;
    expect(StyleSheet.flatten(rider.props.style).opacity).toBe(0);
  });

  test('a second show of the same entry starts at the end state with no rider', () => {
    const first = renderProfile('reveal-second-show');
    rerenderProfile(first, 'reveal-second-show');
    const firstPath = linePath(first);
    ReactTestRenderer.act(() => {
      first.unmount();
    });

    const second = renderProfile('reveal-second-show');

    expect(hostNodesWithTestID(second, RIDER_TESTID)).toHaveLength(0);
    expect(clipWidth(second)).toBe(CLIP_BLEED + CHART_WIDTH);
    expect(linePath(second)).toBe(firstPath);
  });

  test('the first-show memory is per entry key, so another entry still draws', () => {
    const shown = renderProfile('reveal-other-entry-a');
    ReactTestRenderer.act(() => {
      shown.unmount();
    });

    const other = renderProfile('reveal-other-entry-b');

    expect(hostNodesWithTestID(other, RIDER_TESTID)).toHaveLength(1);
  });

  test('the temperature chart draws from the left edge but never carries a logo', () => {
    const renderer = renderProfile('reveal-temperature:temperature', 'temperature');

    expect(renderer.root.findAll(node => typeof node.type === 'string' && String(node.props.testID).endsWith('logo-rider'))).toHaveLength(0);
    expect(clipWidth(renderer)).toBe(CLIP_BLEED);
  });

  test('the rider is hidden from accessibility and ignores touches', () => {
    const renderer = renderProfile('reveal-rider-a11y');
    const rider = hostNodesWithTestID(renderer, RIDER_TESTID)[0]!;

    expect(rider.props.accessibilityElementsHidden).toBe(true);
    expect(rider.props.pointerEvents).toBe('none');
  });

  test('the rider is the Divenary mark, turned to the line with the +57 degree rule', () => {
    const renderer = renderProfile('reveal-rider-transform');
    reportBoxLayout(renderer, CHART_WIDTH, DEPTH_HEIGHT);
    rerenderProfile(renderer, 'reveal-rider-transform');

    const rider = hostNodesWithTestID(renderer, RIDER_TESTID)[0]!;
    const transform = StyleSheet.flatten(rider.props.style).transform as Array<Record<string, number | string>>;
    const chart = buildProfileRenderModel({ samples, kind: 'depth', width: CHART_WIDTH, height: DEPTH_HEIGHT });
    const tip = chart.points[chart.points.length - 1]!;
    // The last segment runs from (160, 32) to (320, 64); the box matches the chart, so no stretch.
    const lineDegrees = (Math.atan2(32, 160) * 180) / Math.PI;
    const riderHeight = 22 / (81 / 64);

    expect(transform).toEqual([
      { translateX: tip.x - 11 },
      { translateY: tip.y - riderHeight / 2 },
      { rotate: `${lineDegrees + 57}deg` },
      { scaleX: -1 },
    ]);
    expect(renderer.root.findAllByType(Path).some(node => node.props.d === LOGO_MARK_PATH)).toBe(true);
  });

  test('Reduce Motion shows no draw and no rider, and the chart fades in instead', () => {
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    const renderer = renderProfile('reveal-reduce-motion');

    expect(hostNodesWithTestID(renderer, RIDER_TESTID)).toHaveLength(0);
    expect(clipWidth(renderer)).toBe(CLIP_BLEED + CHART_WIDTH);
    const [chartSvg] = hostNodesWithTestID(renderer, DEPTH_CHART_TESTID);
    expect(StyleSheet.flatten(fadingAncestor(chartSvg!).props.style).opacity).toBe(0);

    rerenderProfile(renderer, 'reveal-reduce-motion');
    const [chartSvgAfter] = hostNodesWithTestID(renderer, DEPTH_CHART_TESTID);
    expect(StyleSheet.flatten(fadingAncestor(chartSvgAfter!).props.style).opacity).toBe(1);
  });
});

describe('profile reveal chart without a logo', () => {
  test('a chart without logoColor draws without a rider', () => {
    const chart = buildProfileRenderModel({ samples, kind: 'depth', width: 320, height: 56 });
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ProfileRevealChart
          testID="sparkline-chart"
          chart={chart}
          width={320}
          height={56}
          animationKey="sparkline-no-logo"
          drawDuration={600}
          lineColor="#000000"
          lineWidth={2.5}
          areaColor="#000000"
        />,
      );
    });

    expect(renderer!.root.findAll(node => typeof node.type === 'string' && String(node.props.testID).endsWith('logo-rider'))).toHaveLength(0);
    expect(clipWidth(renderer!)).toBe(CLIP_BLEED);
  });
});
