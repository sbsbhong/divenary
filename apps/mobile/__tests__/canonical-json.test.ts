import { canonicalJson } from '../src/utils/canonical-json';

// The serializer every digest was produced with before key orders were cached.
function referenceCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(referenceCanonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${referenceCanonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

describe('canonicalJson', () => {
  it('produces the same bytes as the original serializer', () => {
    const samples = Array.from({ length: 5 }, (_, index) => ({
      timestamp: 100 + index,
      localSessionId: 'session-1',
      depthMeters: index * 1.5,
      ...(index % 2 === 0 ? { temperatureCelsius: 21.5 } : { temperatureCelsius: undefined }),
    }));
    const values: unknown[] = [
      null,
      'text',
      3.25,
      [1, undefined, 'two'],
      { b: 1, a: 2, B: 3, _z: 4, 'started_at': 5, startedAt: 6, 'ä': 7, '10': 8, '9': 9 },
      { nested: { zeta: [{ y: 1, x: 2 }], alpha: undefined }, samples },
      { dive_mode: 'scuba', diveMode: 'freedive', maxDepthMeters: 18, max_depth_meters: 18 },
    ];

    for (const value of values) {
      expect(canonicalJson(value)).toBe(referenceCanonicalJson(value));
    }
  });

  it('keeps each object key order independent of the insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
});
