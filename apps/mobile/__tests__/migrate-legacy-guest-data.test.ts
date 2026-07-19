import { createHash } from 'node:crypto';
import { PersistentDiveLogRepository } from '../src/repositories/persistent-dive-log-repository';
import {
  LEGACY_GUEST_MIGRATION_MARKER_KEY,
  migrateLegacyGuestData,
} from '../src/storage/migrate-legacy-guest-data';
import { dataProfileKeyPrefix, dataStorageKeys } from '../src/storage/data-principal';
import { withLegacyDataMigrationLock } from '../src/storage/legacy-data-migration-lock';
import type { PersistentKeyValueStore } from '../src/storage/persistent-key-value-store';
import { mobileStorageKeys } from '../src/storage/storage-keys';
import type { WatchProfileStorage } from '../src/storage/watch-profile-storage';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { WatchDepthSample } from '../src/types/dive-session';
import type { DivePlan } from '../src/types/dive-plan';
import { createDefaultDiveLogRepository } from '../src/repositories/local-dive-log-repository';

const sourceProfileKey = 'dive-mobile:watch-profile:legacy-session:revision-1';
const samples: WatchDepthSample[] = [
  { localSessionId: 'legacy-session', timestamp: 100, depthMeters: 4 },
  { localSessionId: 'legacy-session', timestamp: 101, depthMeters: 7 },
];

const legacyLog: DiveLogEntry = {
  localId: 'legacy-log',
  source: 'watch',
  cloudSyncStatus: 'notConfigured',
  createdAt: 100,
  updatedAt: 200,
  manual: {
    site: { name: 'Legacy Reef' },
    buddyIds: [],
    gearIds: [],
    tags: [],
    observedMarineLife: [],
    measuredValues: {},
  },
  mobile: { mediaPlaceholders: [] },
  watchCapture: {
    importKey: 'legacy-session:200',
    importedAt: 201,
    session: {
      localSessionId: 'legacy-session',
      startedAt: 100,
      endedAt: 200,
      samples: [],
    },
    measuredValues: { startedAt: 100, endedAt: 200 },
    samples: [],
    profile: {
      storageKey: sourceProfileKey,
      contentRevision: 'revision-1',
      sampleCount: samples.length,
    },
  },
  provenance: {},
};

const legacyPlan: Omit<DivePlan, 'cloudSyncStatus'> = {
  localId: 'legacy-plan',
  status: 'draft',
  createdAt: 100,
  updatedAt: 200,
  site: { name: 'Legacy Reef' },
  buddyIds: [],
  gearIds: [],
  tags: [],
  plannedValues: {},
  checklistItems: [],
};

class RecordingKeyValueStore implements PersistentKeyValueStore {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];
  readonly removals: string[] = [];
  failMarkerWriteOnce = false;
  failRemovalKeyOnce?: string;

  async getString(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async setString(key: string, value: string): Promise<void> {
    this.writes.push(key);
    if (key === LEGACY_GUEST_MIGRATION_MARKER_KEY && this.failMarkerWriteOnce) {
      this.failMarkerWriteOnce = false;
      throw new Error('simulated marker write crash');
    }
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.removals.push(key);
    if (key === this.failRemovalKeyOnce) {
      this.failRemovalKeyOnce = undefined;
      throw new Error(`simulated metadata cleanup crash: ${key}`);
    }
    this.values.delete(key);
  }
}

class RecordingProfileStorage implements WatchProfileStorage {
  readonly values = new Map<string, WatchDepthSample[]>();
  readonly writes: string[] = [];
  readonly removals: string[] = [];
  readonly reads = new Map<string, number>();
  corruptTargetReadback = false;
  failRemovalKeyOnce?: string;
  pauseReadKeyOnce?: string;
  private pausedReadStarted?: () => void;
  private resumePausedRead?: () => void;

  waitForPausedRead(): Promise<void> {
    return new Promise(resolve => {
      this.pausedReadStarted = resolve;
    });
  }

  resumeRead(): void {
    this.resumePausedRead?.();
  }

  async write(key: string, value: WatchDepthSample[]): Promise<void> {
    this.writes.push(key);
    this.values.set(key, value.map(sample => ({ ...sample })));
  }

  async read(key: string): Promise<WatchDepthSample[] | undefined> {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
    if (key === this.pauseReadKeyOnce) {
      this.pauseReadKeyOnce = undefined;
      this.pausedReadStarted?.();
      await new Promise<void>(resolve => {
        this.resumePausedRead = resolve;
      });
    }
    const value = this.values.get(key)?.map(sample => ({ ...sample }));
    if (value && this.corruptTargetReadback && key.startsWith(dataProfileKeyPrefix({ kind: 'guest' }))) {
      return value.slice(0, 1);
    }
    return value;
  }

  async remove(key: string): Promise<void> {
    this.removals.push(key);
    if (key === this.failRemovalKeyOnce) {
      this.failRemovalKeyOnce = undefined;
      throw new Error(`simulated profile cleanup crash: ${key}`);
    }
    this.values.delete(key);
  }
}

function envelope(schemaVersion: number, value: unknown): string {
  return JSON.stringify({ schemaVersion, updatedAt: 300, value });
}

function seedLegacy(metadataStorage: RecordingKeyValueStore, profileStorage: RecordingProfileStorage): void {
  metadataStorage.values.set(mobileStorageKeys.logbook, envelope(3, [legacyLog]));
  metadataStorage.values.set(mobileStorageKeys.planbook, envelope(2, [legacyPlan]));
  profileStorage.values.set(sourceProfileKey, samples.map(sample => ({ ...sample })));
}

function cloneLog(entry: DiveLogEntry = legacyLog): DiveLogEntry {
  return JSON.parse(JSON.stringify(entry)) as DiveLogEntry;
}

function markerValue(metadataStorage: RecordingKeyValueStore): Record<string, unknown> {
  const rawMarker = metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY);
  if (!rawMarker || rawMarker === 'complete') {
    throw new Error('Expected an in-progress migration marker');
  }
  return JSON.parse(rawMarker) as Record<string, unknown>;
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

function toCanonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toCanonicalJsonValue);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, toCanonicalJsonValue(item)]),
    );
  }
  throw new Error('Test value is not canonical JSON');
}

function canonicalSha256(rawValue: string): string {
  const canonical = canonicalStringify(JSON.parse(rawValue) as unknown);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function metadataBinding(sourceKey: string, targetKey: string, source: string, target: string) {
  return {
    sourceKey,
    targetKey,
    sourceCanonicalSha256: canonicalSha256(source),
    targetCanonicalSha256: canonicalSha256(target),
  };
}

describe('migrateLegacyGuestData', () => {
  it('does no writes when raw legacy metadata keys do not exist', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();

    await migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 });

    expect(metadataStorage.writes).toEqual([]);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.writes).toEqual([]);
  });

  it('excludes the historical built-in fixture from migrated guest data', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const [builtInFixture] = createDefaultDiveLogRepository().listSync();
    metadataStorage.values.set(mobileStorageKeys.logbook, envelope(3, [builtInFixture]));

    await migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 });

    const rawGuestLogbook = metadataStorage.values.get(dataStorageKeys({ kind: 'guest' }).logbook);
    expect(rawGuestLogbook).toBeDefined();
    expect((JSON.parse(rawGuestLogbook!) as { value: DiveLogEntry[] }).value).toEqual([]);
    expect(metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY)).toBe('complete');
  });

  it.each([
    ['notes', (entry: DiveLogEntry) => { entry.manual.notes = 'Edited after demo import'; }],
    ['site', (entry: DiveLogEntry) => { entry.manual.site.name = 'Edited demo site'; }],
    ['media', (entry: DiveLogEntry) => { entry.mobile.mediaPlaceholders.push('edited-photo.jpg'); }],
    ['measured value', (entry: DiveLogEntry) => { entry.manual.measuredValues.maxDepthMeters = 31; }],
  ])('migrates the built-in fixture when its %s was edited', async (_label, edit) => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const [builtInFixture] = createDefaultDiveLogRepository().listSync();
    const editedFixture = cloneLog(builtInFixture);
    edit(editedFixture);
    metadataStorage.values.set(mobileStorageKeys.logbook, envelope(3, [editedFixture]));

    await migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 });

    const rawGuestLogbook = metadataStorage.values.get(dataStorageKeys({ kind: 'guest' }).logbook);
    expect((JSON.parse(rawGuestLogbook!) as { value: DiveLogEntry[] }).value).toEqual([editedFixture]);
  });

  it('copies and verifies metadata plus profiles before deleting legacy sources', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);

    await migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 });

    const guestKeys = dataStorageKeys({ kind: 'guest' });
    const guestLogs = JSON.parse(metadataStorage.values.get(guestKeys.logbook) ?? '{}') as { value: DiveLogEntry[] };
    const guestPlans = JSON.parse(metadataStorage.values.get(guestKeys.planbook) ?? '{}') as { value: DivePlan[] };
    const copiedProfileKey = guestLogs.value[0].watchCapture?.profile?.storageKey;

    expect(copiedProfileKey).toBe(`${dataProfileKeyPrefix({ kind: 'guest' })}${encodeURIComponent(sourceProfileKey)}`);
    expect(profileStorage.values.get(copiedProfileKey!)).toEqual(samples);
    expect(guestPlans.value[0]).toMatchObject({
      localId: 'legacy-plan',
      cloudSyncStatus: 'notConfigured',
    });
    expect(guestPlans.value[0].ownerUserId).toBeUndefined();
    expect(metadataStorage.values.get(mobileStorageKeys.logbook)).toBeUndefined();
    expect(metadataStorage.values.get(mobileStorageKeys.planbook)).toBeUndefined();
    expect(profileStorage.values.get(sourceProfileKey)).toBeUndefined();
    expect(metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY)).toBe('complete');
    expect(metadataStorage.writes.slice(-2)).toEqual([
      LEGACY_GUEST_MIGRATION_MARKER_KEY,
      LEGACY_GUEST_MIGRATION_MARKER_KEY,
    ]);
  });

  it('persists a compact versioned digest marker before cleanup', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    profileStorage.failRemovalKeyOnce = sourceProfileKey;

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow('simulated profile cleanup crash');

    const marker = markerValue(metadataStorage);
    expect(marker).toMatchObject({
      schemaVersion: 1,
      state: 'verified',
      metadataBindings: expect.arrayContaining([
        expect.objectContaining({
          sourceKey: mobileStorageKeys.logbook,
          targetKey: dataStorageKeys({ kind: 'guest' }).logbook,
          sourceCanonicalSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          targetCanonicalSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      ]),
      profileBindings: [expect.objectContaining({
        sourceKey: sourceProfileKey,
        targetKey: `${dataProfileKeyPrefix({ kind: 'guest' })}${encodeURIComponent(sourceProfileKey)}`,
        contentRevision: 'revision-1',
        sampleCount: 2,
        canonicalSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      })],
    });
    const [logbookBinding] = (marker.metadataBindings as Array<{
      sourceKey: string;
      sourceCanonicalSha256: string;
      targetCanonicalSha256: string;
    }>).filter(binding => binding.sourceKey === mobileStorageKeys.logbook);
    expect(logbookBinding.sourceCanonicalSha256).toBe(canonicalSha256(
      metadataStorage.values.get(mobileStorageKeys.logbook)!,
    ));
    expect(logbookBinding.targetCanonicalSha256).toBe(canonicalSha256(
      metadataStorage.values.get(dataStorageKeys({ kind: 'guest' }).logbook)!,
    ));
    expect(JSON.stringify(marker)).not.toContain('targetCanonicalJson');
    expect(JSON.stringify(marker)).not.toContain('Legacy Reef');
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(true);
    expect(metadataStorage.removals).toEqual([]);
  });

  it('resumes partial metadata cleanup only after every source profile is gone', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    metadataStorage.failRemovalKeyOnce = mobileStorageKeys.planbook;

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow('simulated metadata cleanup crash');

    expect(profileStorage.values.has(sourceProfileKey)).toBe(false);
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(false);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(true);
    expect(metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY)).not.toBe('complete');
    metadataStorage.removals.length = 0;

    await migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 401 });

    expect(metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY)).toBe('complete');
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(false);
    expect(metadataStorage.removals).toEqual([mobileStorageKeys.planbook]);
  });

  it('keeps all remaining sources when verified target metadata is tampered before resume', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    profileStorage.failRemovalKeyOnce = sourceProfileKey;
    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 })).rejects.toThrow();
    const guestLogbookKey = dataStorageKeys({ kind: 'guest' }).logbook;
    metadataStorage.values.set(guestLogbookKey, envelope(3, []));
    metadataStorage.removals.length = 0;
    profileStorage.removals.length = 0;

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 401 }))
      .rejects.toThrow(/verified|marker|target/i);

    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(true);
    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.removals).toEqual([]);
  });

  it('rejects a tampered target digest before resuming any cleanup', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    profileStorage.failRemovalKeyOnce = sourceProfileKey;
    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 })).rejects.toThrow();
    const marker = markerValue(metadataStorage);
    const logbookBinding = (marker.metadataBindings as Array<Record<string, unknown>>)
      .find(binding => binding.sourceKey === mobileStorageKeys.logbook)!;
    logbookBinding.targetCanonicalSha256 = '0'.repeat(64);
    metadataStorage.values.set(LEGACY_GUEST_MIGRATION_MARKER_KEY, JSON.stringify(marker));
    metadataStorage.removals.length = 0;
    profileStorage.removals.length = 0;

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 401 }))
      .rejects.toThrow(/target.*digest|modified/i);

    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(true);
    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.removals).toEqual([]);
  });

  it('keeps the source profile and metadata when a verified target profile is tampered', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    profileStorage.failRemovalKeyOnce = sourceProfileKey;
    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow('simulated profile cleanup crash');
    const targetProfileKey = `${dataProfileKeyPrefix({ kind: 'guest' })}${encodeURIComponent(sourceProfileKey)}`;
    profileStorage.values.set(targetProfileKey, [{ ...samples[0], depthMeters: 99 }, samples[1]]);
    profileStorage.removals.length = 0;

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 401 }))
      .rejects.toThrow(/verified|profile|target/i);

    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(true);
    expect(profileStorage.removals).toEqual([]);
    expect(metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY)).not.toBe('complete');
  });

  it('keeps metadata after the second profile removal fails and resumes from the first removal', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const secondProfileKey = 'dive-mobile:watch-profile:legacy-session-2:revision-2';
    const secondSamples: WatchDepthSample[] = [
      { localSessionId: 'legacy-session-2', timestamp: 200, depthMeters: 5 },
      { localSessionId: 'legacy-session-2', timestamp: 201, depthMeters: 8 },
    ];
    const secondLog = cloneLog();
    secondLog.localId = 'legacy-log-2';
    secondLog.watchCapture!.importKey = 'legacy-session-2:300';
    secondLog.watchCapture!.session.localSessionId = 'legacy-session-2';
    secondLog.watchCapture!.profile = {
      storageKey: secondProfileKey,
      contentRevision: 'revision-2',
      sampleCount: secondSamples.length,
    };
    metadataStorage.values.set(mobileStorageKeys.logbook, envelope(3, [legacyLog, secondLog]));
    metadataStorage.values.set(mobileStorageKeys.planbook, envelope(2, [legacyPlan]));
    profileStorage.values.set(sourceProfileKey, samples.map(sample => ({ ...sample })));
    profileStorage.values.set(secondProfileKey, secondSamples.map(sample => ({ ...sample })));
    profileStorage.failRemovalKeyOnce = secondProfileKey;

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow('simulated profile cleanup crash');
    expect(metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY)).not.toBe('complete');
    expect(profileStorage.values.has(sourceProfileKey)).toBe(false);
    expect(profileStorage.values.has(secondProfileKey)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(true);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.removals).toEqual([sourceProfileKey, secondProfileKey]);

    await migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 401 });

    expect(profileStorage.values.has(secondProfileKey)).toBe(false);
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(false);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(false);
    expect(metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY)).toBe('complete');
  });

  it('rejects source and target divergence on marker resume before deleting either source', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    profileStorage.failRemovalKeyOnce = sourceProfileKey;
    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 })).rejects.toThrow();
    const divergedSource = cloneLog();
    divergedSource.manual.notes = 'Changed after target verification';
    metadataStorage.values.set(mobileStorageKeys.logbook, envelope(3, [divergedSource]));
    metadataStorage.removals.length = 0;
    profileStorage.removals.length = 0;

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 401 }))
      .rejects.toThrow(/source|target|transformation/i);

    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(true);
    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.removals).toEqual([]);
  });

  it('resumes matching copied guest targets after a crash before the verified marker', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    metadataStorage.failMarkerWriteOnce = true;

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow('simulated marker write crash');

    const guestKeys = dataStorageKeys({ kind: 'guest' });
    expect(metadataStorage.values.has(guestKeys.logbook)).toBe(true);
    expect(metadataStorage.values.has(guestKeys.planbook)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(true);
    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);

    await migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 401 });

    expect(metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY)).toBe('complete');
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(false);
    expect(profileStorage.values.has(sourceProfileKey)).toBe(false);
  });

  it('aborts corrupt profile input without writing targets, marker, or deleting sources', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    profileStorage.values.set(sourceProfileKey, [{ depthMeters: 7 } as WatchDepthSample]);

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow(/profile/i);

    expect(metadataStorage.values.has(dataStorageKeys({ kind: 'guest' }).logbook)).toBe(false);
    expect(metadataStorage.values.has(LEGACY_GUEST_MIGRATION_MARKER_KEY)).toBe(false);
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);
  });

  it('aborts malformed metadata without treating repository defaults as legacy data', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    metadataStorage.values.set(mobileStorageKeys.logbook, envelope(3, { not: 'an array' }));

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow(/logbook/i);

    expect(metadataStorage.writes).toEqual([]);
    expect(metadataStorage.removals).toEqual([]);
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
  });

  it.each([
    ['manual measured value', mobileStorageKeys.logbook, () => {
      const entry = cloneLog();
      (entry.manual.measuredValues as Record<string, unknown>).maxDepthMeters = 'deep';
      return [entry];
    }],
    ['mobile media item', mobileStorageKeys.logbook, () => {
      const entry = cloneLog();
      entry.mobile.mediaPlaceholders = [42 as unknown as string];
      return [entry];
    }],
    ['watch session sample', mobileStorageKeys.logbook, () => {
      const entry = cloneLog();
      entry.watchCapture!.session.samples = [{ localSessionId: 'legacy-session', timestamp: 100, depthMeters: 'deep' } as unknown as WatchDepthSample];
      return [entry];
    }],
    ['plan checklist item', mobileStorageKeys.planbook, () => [{
      ...legacyPlan,
      checklistItems: [{ id: 'mask', label: 'Mask', completed: 'yes' }],
    }]],
    ['plan nested pressure', mobileStorageKeys.planbook, () => [{
      ...legacyPlan,
      plannedValues: { plannedPressure: { unit: 'bar', start: 'full' } },
    }]],
  ])('aborts malformed nested %s data and preserves its source', async (_label, sourceKey, valueFactory) => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    metadataStorage.values.set(sourceKey, envelope(sourceKey === mobileStorageKeys.logbook ? 3 : 2, valueFactory()));
    if (sourceKey === mobileStorageKeys.logbook) {
      profileStorage.values.set(sourceProfileKey, samples.map(sample => ({ ...sample })));
    }

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 })).rejects.toThrow();

    expect(metadataStorage.values.has(sourceKey)).toBe(true);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.removals).toEqual([]);
    expect(metadataStorage.values.has(LEGACY_GUEST_MIGRATION_MARKER_KEY)).toBe(false);
  });

  it.each([
    ['guest', 'dive-mobile:watch-profile:guest:revision-1'],
    ['user', 'dive-mobile:watch-profile:user%3Aaccount:revision-1'],
  ])('rejects and preserves a %s-principal profile key presented as legacy source', async (_label, aliasedKey) => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const aliasedLog = cloneLog();
    aliasedLog.watchCapture!.profile!.storageKey = aliasedKey;
    metadataStorage.values.set(mobileStorageKeys.logbook, envelope(3, [aliasedLog]));
    profileStorage.values.set(aliasedKey, samples.map(sample => ({ ...sample })));

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow(/namespace|profile/i);

    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(profileStorage.values.has(aliasedKey)).toBe(true);
    expect(metadataStorage.writes).toEqual([]);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.removals).toEqual([]);
  });

  it('rejects and preserves a non-canonically encoded legacy profile key', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const ambiguousKey = 'dive-mobile:watch-profile:legacy%2dsession:revision-1';
    const ambiguousLog = cloneLog();
    ambiguousLog.watchCapture!.profile!.storageKey = ambiguousKey;
    metadataStorage.values.set(mobileStorageKeys.logbook, envelope(3, [ambiguousLog]));
    profileStorage.values.set(ambiguousKey, samples.map(sample => ({ ...sample })));

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow(/namespace|profile/i);

    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(profileStorage.values.has(ambiguousKey)).toBe(true);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.removals).toEqual([]);
  });

  it.each([
    ['sample count', (_first: DiveLogEntry, second: DiveLogEntry) => {
      second.watchCapture!.profile!.sampleCount = samples.length + 1;
    }],
    ['content revision', (_first: DiveLogEntry, second: DiveLogEntry) => {
      second.watchCapture!.profile!.contentRevision = 'different-revision';
    }],
    ['digest metadata', (first: DiveLogEntry, second: DiveLogEntry) => {
      first.watchCapture!.profile!.sha256 = 'a'.repeat(64);
      second.watchCapture!.profile!.sha256 = 'b'.repeat(64);
    }],
  ])('rejects conflicting repeated profile %s references without deleting source', async (_label, conflict) => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const first = cloneLog();
    const second = cloneLog();
    second.localId = 'legacy-log-2';
    second.watchCapture!.importKey = 'legacy-session:200:second';
    conflict(first, second);
    metadataStorage.values.set(mobileStorageKeys.logbook, envelope(3, [first, second]));
    profileStorage.values.set(sourceProfileKey, samples.map(sample => ({ ...sample })));

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 })).rejects.toThrow(/profile/i);

    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.removals).toEqual([]);
  });

  it('reads and copies one physical profile once while validating repeated matching references', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const first = cloneLog();
    const second = cloneLog();
    second.localId = 'legacy-log-2';
    second.watchCapture!.importKey = 'legacy-session:200:second';
    metadataStorage.values.set(mobileStorageKeys.logbook, envelope(3, [first, second]));
    profileStorage.values.set(sourceProfileKey, samples.map(sample => ({ ...sample })));

    await migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 });

    expect(profileStorage.writes).toHaveLength(1);
    expect(profileStorage.reads.get(sourceProfileKey)).toBe(1);
  });

  it('aborts rather than merging or overwriting an existing mismatched guest target', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    const guestLogbookKey = dataStorageKeys({ kind: 'guest' }).logbook;
    const existingTarget = envelope(3, [{ ...legacyLog, localId: 'existing-guest-log' }]);
    metadataStorage.values.set(guestLogbookKey, existingTarget);

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow(/guest target/i);

    expect(metadataStorage.values.get(guestLogbookKey)).toBe(existingTarget);
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);
    expect(metadataStorage.values.has(LEGACY_GUEST_MIGRATION_MARKER_KEY)).toBe(false);
  });

  it('does not delete any source when profile read-back differs from the copied value', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    profileStorage.corruptTargetReadback = true;

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow(/read-back/i);

    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.removals).toEqual([]);
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(true);
    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);
    expect(metadataStorage.values.has(LEGACY_GUEST_MIGRATION_MARKER_KEY)).toBe(false);
  });

  it('serializes a default repository mutation behind migration cleanup so the new source write survives', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    profileStorage.pauseReadKeyOnce = sourceProfileKey;
    const pausedRead = profileStorage.waitForPausedRead();
    const migration = migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 });
    await pausedRead;
    const repository = new PersistentDiveLogRepository({
      storage: metadataStorage,
      profileStorage,
      now: () => 401,
    });
    const mutation = repository.save({
      ...cloneLog(),
      localId: 'concurrent-source-write',
      source: 'manual',
      watchCapture: undefined,
    });

    profileStorage.resumeRead();
    await Promise.all([migration, mutation]);

    const rawLegacyLogbook = metadataStorage.values.get(mobileStorageKeys.logbook);
    expect(rawLegacyLogbook).toBeDefined();
    expect((JSON.parse(rawLegacyLogbook!) as { value: DiveLogEntry[] }).value.map(entry => entry.localId))
      .toEqual(['concurrent-source-write']);
  });

  it('continues the shared migration lock queue after an operation rejects', async () => {
    const events: string[] = [];

    await expect(withLegacyDataMigrationLock(async () => {
      events.push('rejected');
      throw new Error('simulated lock operation failure');
    })).rejects.toThrow('simulated lock operation failure');
    await expect(withLegacyDataMigrationLock(async () => {
      events.push('recovered');
      return 'ok';
    })).resolves.toBe('ok');

    expect(events).toEqual(['rejected', 'recovered']);
  });

  it('performs no writes or deletes when the exact complete marker already exists', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    metadataStorage.values.set(LEGACY_GUEST_MIGRATION_MARKER_KEY, 'complete');
    seedLegacy(metadataStorage, profileStorage);

    await migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 });

    expect(metadataStorage.writes).toEqual([]);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.writes).toEqual([]);
    expect(profileStorage.removals).toEqual([]);
    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
  });

  it('rejects a v1 empty target as divergent with bindings for every existing metadata source', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    seedLegacy(metadataStorage, profileStorage);
    const guestKeys = dataStorageKeys({ kind: 'guest' });
    const sourceLogbook = metadataStorage.values.get(mobileStorageKeys.logbook)!;
    const sourcePlanbook = metadataStorage.values.get(mobileStorageKeys.planbook)!;
    const emptyLogbook = envelope(3, []);
    const emptyPlanbook = envelope(3, []);
    metadataStorage.values.set(guestKeys.logbook, emptyLogbook);
    metadataStorage.values.set(guestKeys.planbook, emptyPlanbook);
    metadataStorage.values.set(LEGACY_GUEST_MIGRATION_MARKER_KEY, JSON.stringify({
      schemaVersion: 1,
      state: 'verified',
      metadataBindings: [
        metadataBinding(mobileStorageKeys.logbook, guestKeys.logbook, sourceLogbook, emptyLogbook),
        metadataBinding(mobileStorageKeys.planbook, guestKeys.planbook, sourcePlanbook, emptyPlanbook),
      ],
      profileBindings: [],
    }));

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow(/diverged/i);

    expect(metadataStorage.values.has(mobileStorageKeys.logbook)).toBe(true);
    expect(metadataStorage.values.has(mobileStorageKeys.planbook)).toBe(true);
    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);
    expect(metadataStorage.removals).toEqual([]);
    expect(profileStorage.removals).toEqual([]);
  });

  it('rejects a fully valid v1 marker from deleting an exact legacy profile without its source logbook', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const guestLogbookKey = dataStorageKeys({ kind: 'guest' }).logbook;
    const targetProfileKey = `${dataProfileKeyPrefix({ kind: 'guest' })}${encodeURIComponent(sourceProfileKey)}`;
    const forgedSource = envelope(3, [legacyLog]);
    const forgedTargetLog = cloneLog();
    forgedTargetLog.watchCapture!.profile!.storageKey = targetProfileKey;
    const forgedTarget = envelope(3, [forgedTargetLog]);
    metadataStorage.values.set(guestLogbookKey, forgedTarget);
    profileStorage.values.set(sourceProfileKey, samples.map(sample => ({ ...sample })));
    profileStorage.values.set(targetProfileKey, samples.map(sample => ({ ...sample })));
    metadataStorage.values.set(LEGACY_GUEST_MIGRATION_MARKER_KEY, JSON.stringify({
      schemaVersion: 1,
      state: 'verified',
      metadataBindings: [metadataBinding(
        mobileStorageKeys.logbook,
        guestLogbookKey,
        forgedSource,
        forgedTarget,
      )],
      profileBindings: [{
        sourceKey: sourceProfileKey,
        targetKey: targetProfileKey,
        contentRevision: 'revision-1',
        sampleCount: samples.length,
        canonicalSha256: createHash('sha256')
          .update(canonicalStringify(samples), 'utf8')
          .digest('hex'),
      }],
    }));

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow(/source logbook|authorize/i);

    expect(profileStorage.values.has(sourceProfileKey)).toBe(true);
    expect(profileStorage.removals).toEqual([]);
    expect(metadataStorage.removals).toEqual([]);
    expect(metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY)).not.toBe('complete');
  });
});
