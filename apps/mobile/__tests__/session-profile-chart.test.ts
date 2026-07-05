import type { WatchDepthSample } from '../src/types/dive-session';
import { buildProfileRenderModel, downsampleProfilePoints } from '../src/utils/session-profile-chart';

const sample = (index: number, depthMeters: number, waterTemperatureCelsius?: number): WatchDepthSample => ({
  localSessionId: 'chart-session',
  timestamp: 1781352000 + index,
  depthMeters,
  waterTemperatureCelsius,
});

describe('session profile chart utilities', () => {
  it('keeps raw sample arrays untouched while downsampling render points', () => {
    const samples = Array.from({ length: 850 }, (_, index) => sample(index, index % 50));
    const before = samples.slice();
    const model = buildProfileRenderModel({ samples, kind: 'depth', maxRenderPoints: 160 });

    expect(samples).toEqual(before);
    expect(model.points.length).toBeLessThanOrEqual(160);
    expect(model.rawSampleCount).toBe(850);
  });

  it('maps deeper depth values lower on the chart', () => {
    const model = buildProfileRenderModel({
      samples: [sample(0, 0), sample(1, 10), sample(2, 20)],
      kind: 'depth',
      width: 300,
      height: 100,
      maxRenderPoints: 20,
    });

    expect(model.points[0]!.y).toBeLessThan(model.points[1]!.y);
    expect(model.points[1]!.y).toBeLessThan(model.points[2]!.y);
  });

  it('preserves bucket peaks and valleys', () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      timestamp: 1781352000 + index,
      value: index === 15 ? 35 : index === 25 ? 1 : 10,
    }));

    const result = downsampleProfilePoints(points, 12);

    expect(result.some(point => point.value === 35)).toBe(true);
    expect(result.some(point => point.value === 1)).toBe(true);
    expect(result[0]).toEqual(points[0]);
    expect(result[result.length - 1]).toEqual(points[points.length - 1]);
  });

  it('returns unavailable model for all-missing temperature samples', () => {
    const model = buildProfileRenderModel({
      samples: [sample(0, 3, undefined), sample(1, 5, undefined)],
      kind: 'temperature',
    });

    expect(model.points).toHaveLength(0);
    expect(model.isAvailable).toBe(false);
  });
});
