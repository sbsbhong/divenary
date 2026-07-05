import metadataRichFixture from '../../../packages/contracts/fixtures/metadata-rich-watch-sync-message.json';
import minimalFixture from '../../../packages/contracts/fixtures/minimal-watch-sync-message.json';
import freediveFixture from '../../../packages/contracts/fixtures/freedive-multi-segment-watch-sync-message.json';
import scubaSafetyStopFixture from '../../../packages/contracts/fixtures/scuba-safety-stop-watch-sync-message.json';
import { PersistentDiveLogRepository } from '../src/repositories/persistent-dive-log-repository';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import {
  parseWatchSyncMessageJson,
  parseWatchSyncMessagesValue,
  parseWatchSyncMessageValue,
} from '../src/utils/watch-sync-message-validation';
import { watchFixtureMessages } from '../src/utils/watch-fixtures';

describe('watch sync message validation', () => {
  it('validates contract fixture JSON and imports it into the persistent repository', async () => {
    const result = parseWatchSyncMessageValue(metadataRichFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const repository = new PersistentDiveLogRepository({
      storage: new InMemoryKeyValueStore(),
      now: () => 1781354000,
      initialEntries: [],
    });

    const [entry] = await repository.importWatchMessages([result.message]);

    expect(entry.localId).toBe('watch:fixture-rich-session:1781352600');
    expect(entry.watchCapture?.session.localSessionId).toBe('fixture-rich-session');
    expect(entry.watchCapture?.samples).toHaveLength(4);
  });

  it('parses raw JSON strings into watch sync messages', () => {
    const result = parseWatchSyncMessageJson(JSON.stringify(minimalFixture));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.message.session.localSessionId).toBe('fixture-minimal-session');
  });

  it('accepts source plan metadata from watch sessions', () => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'planned-session-1',
        sourcePlanLocalId: 'plan-1',
        planTitle: 'Blue Wall morning',
        startedAt: 1781352000,
        endedAt: 1781352600,
        samples: [{ localSessionId: 'planned-session-1', timestamp: 1781352000, depthMeters: 0 }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.message.session.sourcePlanLocalId).toBe('plan-1');
    expect(result.message.session.planTitle).toBe('Blue Wall morning');
  });

  it('validates arrays for transport batches', () => {
    const result = parseWatchSyncMessagesValue([minimalFixture, metadataRichFixture]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.messages).toHaveLength(2);
  });

  it('rejects payloads that do not match the contract', () => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        startedAt: 1781352000,
        samples: [{ localSessionId: 'sample-1', timestamp: 1781352000, depthMeters: 0 }],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected invalid payload');
    }
    expect(result.error.message).toContain('session.localSessionId');
  });

  it.each(['snorkel', 'pool', 'unknown'])('rejects removed dive mode %s', diveMode => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: `removed-mode-${diveMode}`,
        startedAt: 1781352000,
        diveMode,
        samples: [{ localSessionId: `removed-mode-${diveMode}`, timestamp: 1781352000, depthMeters: 0 }],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected removed dive mode to be invalid');
    }
    expect(result.error.message).toContain('session.diveMode');
  });

  it('accepts freedive sessions with segments', () => {
    const result = parseWatchSyncMessageValue(freediveFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.message.session.diveMode).toBe('freedive');
    expect(result.message.session.freedive?.segments).toHaveLength(2);
    expect(result.message.session.freedive?.segments[0]?.segmentId).toBe('free-segment-001');
  });

  it('rejects freedive sessions without freedive payload', () => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'freedive-missing-payload',
        schemaVersion: 2,
        diveMode: 'freedive',
        startedAt: 1781352000,
        samples: [{ localSessionId: 'freedive-missing-payload', timestamp: 1781352000, depthMeters: 0 }],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected freedive payload to be required');
    }
    expect(result.error.message).toContain('session.freedive');
  });

  it('normalizes legacy flat freedive payloads with diveMode before strict mode validation', () => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'legacy-flat-freedive',
        schemaVersion: 1,
        diveMode: 'freedive',
        startedAt: 1781352000,
        endedAt: 1781352060,
        maxDepthMeters: 12.4,
        averageDepthMeters: 5.8,
        samples: [
          { localSessionId: 'legacy-flat-freedive', timestamp: 1781352000, depthMeters: 0 },
          { localSessionId: 'legacy-flat-freedive', timestamp: 1781352010, depthMeters: 12.4 },
          { localSessionId: 'legacy-flat-freedive', timestamp: 1781352060, depthMeters: 0.4 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.message.session.diveMode).toBe('freedive');
    expect(result.message.session.freedive).toMatchObject({
      diveCount: 1,
      maxDepthMeters: 12.4,
      longestDiveDurationSeconds: 60,
    });
    expect(result.message.session.freedive?.segments).toHaveLength(1);
    expect(result.message.session.freedive?.segments[0]).toMatchObject({
      index: 1,
      startedAt: 1781352000,
      endedAt: 1781352060,
      durationSeconds: 60,
      maxDepthMeters: 12.4,
      minDepthMeters: 0,
      sampleStartIndex: 0,
      sampleEndIndex: 2,
    });
  });

  it('accepts scuba sessions with safety stop record', () => {
    const result = parseWatchSyncMessageValue(scubaSafetyStopFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.message.session.diveMode).toBe('scuba');
    expect(result.message.session.scuba?.safetyStop.status).toBe('completed');
    expect(result.message.session.scuba?.safetyStop.timeInZoneSeconds).toBe(180);
  });

  it('normalizes legacy flat scuba payloads with diveMode before strict mode validation', () => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'legacy-flat-scuba',
        schemaVersion: 1,
        diveMode: 'scuba',
        gasLabel: 'Air',
        startedAt: 1781352000,
        endedAt: 1781353200,
        maxDepthMeters: 18.6,
        averageDepthMeters: 9.4,
        waterTemperatureCelsius: 24,
        samples: [
          { localSessionId: 'legacy-flat-scuba', timestamp: 1781352000, depthMeters: 0, waterTemperatureCelsius: 24 },
          { localSessionId: 'legacy-flat-scuba', timestamp: 1781352600, depthMeters: 18.6, waterTemperatureCelsius: 23 },
          { localSessionId: 'legacy-flat-scuba', timestamp: 1781353200, depthMeters: 0.6, waterTemperatureCelsius: 24 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.message.session.diveMode).toBe('scuba');
    expect(result.message.session.scuba).toMatchObject({
      gasLabel: 'Air',
      maxDepthMeters: 18.6,
      averageDepthMeters: 9.4,
      waterTemperatureCelsius: 24,
      latestAscentRateMetersPerMinute: 0,
      maxAscentRateMetersPerMinute: 0,
      safetyStop: {
        status: 'unknown',
        required: false,
        completed: false,
        targetDepthMeters: 5,
        minDepthMeters: 3,
        maxDepthMeters: 6,
        durationSeconds: 180,
        remainingSeconds: 180,
        timeInZoneSeconds: 0,
      },
    });
  });

  it.each([
    ['freedive mode with scuba payload', { diveMode: 'freedive', scuba: scubaSafetyStopFixture.session.scuba }],
    ['scuba mode with freedive payload', { diveMode: 'scuba', freedive: freediveFixture.session.freedive }],
    [
      'both nested payloads together',
      {
        diveMode: 'scuba',
        freedive: freediveFixture.session.freedive,
        scuba: scubaSafetyStopFixture.session.scuba,
      },
    ],
  ])('rejects mismatched scuba and freedive payloads: %s', (_caseName, modePayload) => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'mismatched-mode-payload',
        startedAt: 1781352000,
        samples: [{ localSessionId: 'mismatched-mode-payload', timestamp: 1781352000, depthMeters: 0 }],
        ...modePayload,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected mismatched mode payload to be invalid');
    }
  });

  it.each([
    ['freedive', { freedive: freediveFixture.session.freedive }],
    ['scuba', { scuba: scubaSafetyStopFixture.session.scuba }],
  ])('rejects nested %s payload without diveMode', (_payloadName, nestedPayload) => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'nested-without-mode',
        startedAt: 1781352000,
        samples: [{ localSessionId: 'nested-without-mode', timestamp: 1781352000, depthMeters: 0 }],
        ...nestedPayload,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected nested payload without diveMode to be invalid');
    }
    expect(result.error.message).toContain('session.diveMode');
  });

  it('keeps accepting a legacy flat session without nested payload and without diveMode', () => {
    const result = parseWatchSyncMessageValue({
      type: 'sessionEnded',
      session: {
        localSessionId: 'legacy-flat-session',
        startedAt: 1781352000,
        endedAt: 1781352600,
        maxDepthMeters: 8.4,
        averageDepthMeters: 4.2,
        samples: [{ localSessionId: 'legacy-flat-session', timestamp: 1781352000, depthMeters: 0 }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.message.session.diveMode).toBeUndefined();
    expect(result.message.session.freedive).toBeUndefined();
    expect(result.message.session.scuba).toBeUndefined();
  });

  it('builds app fixture messages through the runtime validator', () => {
    expect(watchFixtureMessages.map(message => message.session.localSessionId)).toEqual(['fixture-rich-session']);
  });
});
