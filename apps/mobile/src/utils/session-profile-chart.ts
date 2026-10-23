import type { WatchDepthSample } from '../types/dive-session';

export type ProfileKind = 'depth' | 'temperature';

export type ProfileSourcePoint = {
  timestamp: number;
  value: number;
};

export type ProfileRenderPoint = ProfileSourcePoint & {
  x: number;
  y: number;
};

export type ProfileRenderModel = {
  points: ProfileRenderPoint[];
  path: string;
  areaPath: string;
  minValue: number;
  maxValue: number;
  rawSampleCount: number;
  isAvailable: boolean;
};

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 96;
const DEFAULT_MAX_RENDER_POINTS = 160;

export function downsampleProfilePoints(points: ProfileSourcePoint[], maxPoints: number): ProfileSourcePoint[] {
  const pointLimit = Math.max(2, Math.floor(maxPoints));
  if (points.length <= pointLimit) {
    return points.slice();
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;

  if (pointLimit === 2) {
    return [first, last];
  }

  if (pointLimit === 3) {
    const peak = points
      .slice(1, -1)
      .reduce((selected, point) => (Math.abs(point.value - first.value) > Math.abs(selected.value - first.value) ? point : selected), points[1]!);
    return sortAndDedupeProfilePoints([first, peak, last]);
  }

  const interior = points.slice(1, -1);
  const bucketCount = Math.max(1, Math.floor((pointLimit - 2) / 2));
  const bucketSize = interior.length / bucketCount;
  const selected: ProfileSourcePoint[] = [first];

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const bucketStart = Math.floor(bucketIndex * bucketSize);
    const bucketEnd = Math.min(interior.length, Math.floor((bucketIndex + 1) * bucketSize));
    const bucket = interior.slice(bucketStart, bucketEnd);
    if (bucket.length === 0) {
      continue;
    }

    let minPoint = bucket[0]!;
    let maxPoint = bucket[0]!;
    for (const point of bucket) {
      if (point.value < minPoint.value) {
        minPoint = point;
      }
      if (point.value > maxPoint.value) {
        maxPoint = point;
      }
    }

    selected.push(minPoint);
    if (maxPoint !== minPoint) {
      selected.push(maxPoint);
    }
  }

  selected.push(last);
  return sortAndDedupeProfilePoints(selected).slice(0, pointLimit);
}

export function buildProfileRenderModel(options: {
  samples: WatchDepthSample[];
  kind: ProfileKind;
  width?: number;
  height?: number;
  maxRenderPoints?: number;
}): ProfileRenderModel {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const sourcePoints = getProfileSourcePoints(options.samples, options.kind);
  const rawSampleCount = options.samples.length;

  if (sourcePoints.length === 0) {
    return {
      points: [],
      path: '',
      areaPath: '',
      minValue: 0,
      maxValue: 0,
      rawSampleCount,
      isAvailable: false,
    };
  }

  const renderSourcePoints = downsampleProfilePoints(sourcePoints, options.maxRenderPoints ?? DEFAULT_MAX_RENDER_POINTS);
  const values = sourcePoints.map(point => point.value);
  const minValue = options.kind === 'depth' ? 0 : Math.min(...values);
  const maxValue = options.kind === 'depth' ? Math.max(1, ...values) : Math.max(...values);
  const range = Math.max(1, maxValue - minValue);
  const firstTimestamp = renderSourcePoints[0]?.timestamp ?? 0;
  const lastTimestamp = renderSourcePoints[renderSourcePoints.length - 1]?.timestamp ?? firstTimestamp;
  const duration = Math.max(1, lastTimestamp - firstTimestamp);

  const points = renderSourcePoints.map(point => {
    const normalizedX = (point.timestamp - firstTimestamp) / duration;
    const normalizedValue = (point.value - minValue) / range;
    return {
      ...point,
      x: normalizedX * width,
      y: options.kind === 'depth' ? normalizedValue * height : height - normalizedValue * height,
    };
  });

  const path = buildLinePath(points);

  return {
    points,
    path,
    areaPath: path ? `${path} L ${points[points.length - 1]!.x} ${height} L ${points[0]!.x} ${height} Z` : '',
    minValue,
    maxValue,
    rawSampleCount,
    isAvailable: true,
  };
}

function getProfileSourcePoints(samples: WatchDepthSample[], kind: ProfileKind): ProfileSourcePoint[] {
  return samples
    .map((sample): ProfileSourcePoint | undefined => {
      const value = kind === 'depth' ? sample.depthMeters : sample.waterTemperatureCelsius;
      if (typeof value !== 'number' || !Number.isFinite(sample.timestamp) || !Number.isFinite(value)) {
        return undefined;
      }
      if (kind === 'depth' && value < 0) {
        return undefined;
      }
      return {
        timestamp: sample.timestamp,
        value,
      };
    })
    .filter((point): point is ProfileSourcePoint => {
      return point !== undefined;
    })
    .sort((left, right) => left.timestamp - right.timestamp);
}

function buildLinePath(points: ProfileRenderPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`).join(' ');
}

function sortAndDedupeProfilePoints(points: ProfileSourcePoint[]): ProfileSourcePoint[] {
  const seen = new Set<string>();
  return points
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp)
    .filter(point => {
      const key = `${point.timestamp}:${point.value}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A point in chart units (the viewBox the path is drawn in), before it is mapped onto the screen. */
export type ProfileChartPoint = {
  x: number;
  y: number;
};

/**
 * How the chart's viewBox is stretched onto the measured box. The SVG uses `preserveAspectRatio="none"`,
 * so the two axes scale by different factors and a slope must be measured in screen units.
 */
export type ProfileScreenMap = {
  viewBoxWidth: number;
  viewBoxHeight: number;
  width: number;
  height: number;
};

/** The reveal edge on screen: where the drawn line ends, and the line's direction there (down is positive). */
export type ProfileTip = {
  x: number;
  y: number;
  angleDegrees: number;
};

/**
 * The mirrored logo's nose direction before any rotation, from the watch's `LogoRiderHeading`
 * (DivePostDive.swift). Turning the mirrored mark by `line - this` puts its nose along the line.
 */
export const LOGO_RIDER_MIRRORED_NOSE_DEGREES = -57;

/**
 * The point where the reveal edge crosses the line, and the line's screen angle there.
 *
 * `progress` is the clip width as a fraction of the chart width, so the edge sits at
 * `progress * viewBoxWidth` in chart units. The segment that contains that x gives the point, by
 * linear interpolation along x, and its direction is measured after the stretch. Vertical segments
 * have no x extent, so they are skipped. The function runs on the UI thread, hence the directive.
 */
export function profileTipAtProgress(
  points: readonly ProfileChartPoint[],
  progress: number,
  map: ProfileScreenMap,
): ProfileTip | undefined {
  'worklet';
  if (points.length === 0 || map.viewBoxWidth <= 0 || map.viewBoxHeight <= 0 || map.width <= 0 || map.height <= 0) {
    return undefined;
  }

  const clamped = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
  const scaleX = map.width / map.viewBoxWidth;
  const scaleY = map.height / map.viewBoxHeight;
  const edgeX = clamped * map.viewBoxWidth;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const dx = end.x - start.x;
    if (dx <= 0 || end.x < edgeX) {
      continue;
    }

    const t = Math.min(Math.max((edgeX - start.x) / dx, 0), 1);
    const dy = end.y - start.y;
    return {
      x: (start.x + dx * t) * scaleX,
      y: (start.y + dy * t) * scaleY,
      angleDegrees: (Math.atan2(dy * scaleY, dx * scaleX) * 180) / Math.PI,
    };
  }

  // The edge is past every drawn segment (rounding at the far end): hold the last point, with the
  // direction of the last segment that has an x extent.
  const last = points[points.length - 1]!;
  let angleDegrees = 0;
  for (let index = points.length - 1; index >= 1; index -= 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    if (end.x - start.x > 0) {
      angleDegrees = (Math.atan2((end.y - start.y) * scaleY, (end.x - start.x) * scaleX) * 180) / Math.PI;
      break;
    }
  }

  return { x: last.x * scaleX, y: last.y * scaleY, angleDegrees };
}

/** The rotation that lays the mirrored logo along a line running at `lineAngleDegrees` (the +57 rule). */
export function logoRiderRotationDegrees(lineAngleDegrees: number): number {
  'worklet';
  return lineAngleDegrees - LOGO_RIDER_MIRRORED_NOSE_DEGREES;
}
