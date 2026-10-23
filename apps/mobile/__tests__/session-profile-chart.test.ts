import type { WatchDepthSample } from '../src/types/dive-session';
import {
  buildProfileRenderModel,
  downsampleProfilePoints,
  logoRiderRotationDegrees,
  LOGO_RIDER_MIRRORED_NOSE_DEGREES,
  profileTipAtProgress,
  type ProfileScreenMap,
} from '../src/utils/session-profile-chart';

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

describe('profile tip and logo rider rotation', () => {
  // Chart units 200 x 100, drawn at the same size on screen: no stretch.
  const identity: ProfileScreenMap = { viewBoxWidth: 200, viewBoxHeight: 100, width: 200, height: 100 };
  // Two segments: flat from (0, 0) to (100, 0), then down to (200, 50).
  const bend = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 50 },
  ];
  const degrees = (radians: number) => (radians * 180) / Math.PI;

  it('starts at the first point and ends at the last point', () => {
    expect(profileTipAtProgress(bend, 0, identity)).toEqual({ x: 0, y: 0, angleDegrees: 0 });
    expect(profileTipAtProgress(bend, 1, identity)).toEqual({
      x: 200,
      y: 50,
      angleDegrees: degrees(Math.atan2(50, 100)),
    });
  });

  it('interpolates along x inside a segment and reads that segment direction', () => {
    // Progress 0.75 is x = 150, halfway down the second segment.
    expect(profileTipAtProgress(bend, 0.75, identity)).toEqual({
      x: 150,
      y: 25,
      angleDegrees: degrees(Math.atan2(50, 100)),
    });
  });

  it('keeps the incoming segment direction exactly on a vertex', () => {
    // Progress 0.5 is x = 100, the corner: the flat segment that ends there sets the direction.
    expect(profileTipAtProgress(bend, 0.5, identity)).toEqual({ x: 100, y: 0, angleDegrees: 0 });
  });

  it('measures the slope in screen units, so a non-uniform stretch changes the angle', () => {
    // The screen is twice as wide and half as tall: the second segment is dx 200, dy 25 on screen.
    const stretched: ProfileScreenMap = { viewBoxWidth: 200, viewBoxHeight: 100, width: 400, height: 50 };
    const tip = profileTipAtProgress(bend, 0.75, stretched);

    expect(tip?.x).toBeCloseTo(300);
    expect(tip?.y).toBeCloseTo(12.5);
    expect(tip?.angleDegrees).toBeCloseTo(degrees(Math.atan2(25, 200)));
    // The chart-unit slope would have said 26.6 degrees; the screen slope is 7.1.
    expect(tip?.angleDegrees).not.toBeCloseTo(degrees(Math.atan2(50, 100)));
  });

  it('handles a single sample as a point with no direction', () => {
    expect(profileTipAtProgress([{ x: 0, y: 30 }], 0, identity)).toEqual({ x: 0, y: 30, angleDegrees: 0 });
    expect(profileTipAtProgress([{ x: 0, y: 30 }], 0.6, identity)).toEqual({ x: 0, y: 30, angleDegrees: 0 });
  });

  it('gives a flat line a zero direction at every progress', () => {
    const flat = [
      { x: 0, y: 20 },
      { x: 100, y: 20 },
      { x: 200, y: 20 },
    ];

    expect(profileTipAtProgress(flat, 0.3, identity)).toEqual({ x: 60, y: 20, angleDegrees: 0 });
    expect(profileTipAtProgress(flat, 1, identity)?.angleDegrees).toBe(0);
  });

  it('skips a vertical segment that has no x extent', () => {
    const drop = [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 100, y: 40 },
    ];

    expect(profileTipAtProgress(drop, 0, identity)).toEqual({ x: 0, y: 40, angleDegrees: 0 });
  });

  it('clamps progress to 0 to 1 and treats a non-finite value as 0', () => {
    expect(profileTipAtProgress(bend, -0.5, identity)).toEqual(profileTipAtProgress(bend, 0, identity));
    expect(profileTipAtProgress(bend, 1.7, identity)).toEqual(profileTipAtProgress(bend, 1, identity));
    expect(profileTipAtProgress(bend, Number.NaN, identity)).toEqual(profileTipAtProgress(bend, 0, identity));
  });

  it('returns nothing without points or a measured box', () => {
    expect(profileTipAtProgress([], 0.5, identity)).toBeUndefined();
    expect(profileTipAtProgress(bend, 0.5, { ...identity, width: 0 })).toBeUndefined();
    expect(profileTipAtProgress(bend, 0.5, { ...identity, height: 0 })).toBeUndefined();
  });

  it('turns the mirrored logo by the line angle plus 57 degrees', () => {
    expect(LOGO_RIDER_MIRRORED_NOSE_DEGREES).toBe(-57);
    expect(logoRiderRotationDegrees(0)).toBe(57);
    expect(logoRiderRotationDegrees(-30)).toBe(27);
    expect(logoRiderRotationDegrees(90)).toBe(147);
  });

  it('puts the mirrored nose on the line direction', () => {
    // The mirrored nose points at -57 before the turn, so after the turn it points at the line.
    for (const lineAngle of [-45, 0, 12.5, 80]) {
      expect(LOGO_RIDER_MIRRORED_NOSE_DEGREES + logoRiderRotationDegrees(lineAngle)).toBe(lineAngle);
    }
  });
});
