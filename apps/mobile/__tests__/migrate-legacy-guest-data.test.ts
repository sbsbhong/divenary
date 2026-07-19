import {
  LEGACY_GUEST_MIGRATION_MARKER_KEY,
  migrateLegacyGuestData,
} from '../src/storage/migrate-legacy-guest-data';
import { dataProfileKeyPrefix, dataStorageKeys } from '../src/storage/data-principal';
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
    this.values.delete(key);
  }
}

class RecordingProfileStorage implements WatchProfileStorage {
  readonly values = new Map<string, WatchDepthSample[]>();
  readonly writes: string[] = [];
  readonly removals: string[] = [];
  corruptTargetReadback = false;

  async write(key: string, value: WatchDepthSample[]): Promise<void> {
    this.writes.push(key);
    this.values.set(key, value.map(sample => ({ ...sample })));
  }

  async read(key: string): Promise<WatchDepthSample[] | undefined> {
    const value = this.values.get(key)?.map(sample => ({ ...sample }));
    if (value && this.corruptTargetReadback && key.startsWith(dataProfileKeyPrefix({ kind: 'guest' }))) {
      return value.slice(0, 1);
    }
    return value;
  }

  async remove(key: string): Promise<void> {
    this.removals.push(key);
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

  it('rejects a verified marker that could delete a guest target', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const guestLogbookKey = dataStorageKeys({ kind: 'guest' }).logbook;
    metadataStorage.values.set(guestLogbookKey, envelope(3, []));
    metadataStorage.values.set(LEGACY_GUEST_MIGRATION_MARKER_KEY, JSON.stringify({
      state: 'verified',
      sourceMetadataKeys: [guestLogbookKey],
      sourceProfileKeys: [],
      guestMetadataKeys: [guestLogbookKey],
    }));

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow(/marker/i);

    expect(metadataStorage.values.has(guestLogbookKey)).toBe(true);
    expect(metadataStorage.removals).toEqual([]);
    expect(metadataStorage.values.get(LEGACY_GUEST_MIGRATION_MARKER_KEY)).not.toBe('complete');
  });

  it('rejects a verified marker that names an unreferenced source profile', async () => {
    const metadataStorage = new RecordingKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const guestLogbookKey = dataStorageKeys({ kind: 'guest' }).logbook;
    const unrelatedProfileKey = 'dive-mobile:watch-profile:unrelated:revision';
    metadataStorage.values.set(guestLogbookKey, envelope(3, []));
    metadataStorage.values.set(LEGACY_GUEST_MIGRATION_MARKER_KEY, JSON.stringify({
      state: 'verified',
      sourceMetadataKeys: [mobileStorageKeys.logbook],
      sourceProfileKeys: [unrelatedProfileKey],
      guestMetadataKeys: [guestLogbookKey],
    }));
    profileStorage.values.set(unrelatedProfileKey, samples);

    await expect(migrateLegacyGuestData({ metadataStorage, profileStorage, now: () => 400 }))
      .rejects.toThrow(/marker/i);

    expect(profileStorage.values.has(unrelatedProfileKey)).toBe(true);
    expect(profileStorage.removals).toEqual([]);
  });
});
