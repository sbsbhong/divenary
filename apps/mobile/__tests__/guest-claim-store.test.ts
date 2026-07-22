import { canonicalAccountPayloadSha256 } from '../src/sync/account-payload';
import {
  createGuestClaimSnapshot,
  GuestClaimStore,
} from '../src/claim/guest-claim-store';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import {
  dataProfileKeyPrefix,
  dataStorageKeys,
} from '../src/storage/data-principal';
import type { DiveLogRepository } from '../src/repositories/dive-log-repository';
import type { DivePlanRepository } from '../src/repositories/dive-plan-repository';
import type { WatchProfileStorage } from '../src/storage/watch-profile-storage';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { DivePlan } from '../src/types/dive-plan';
import type { WatchDepthSample } from '../src/types/dive-session';

const userId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const guestProfileKey = `${dataProfileKeyPrefix({
  kind: 'guest',
})}session-log-a:revision-1`;

describe('guest claim store', () => {
  it('keeps an unverifiable watch log while snapshotting unrelated valid logs', async () => {
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([
        diveLog({localId: 'manual-a'}),
        diveLog({
          localId: 'log-a',
          title: '위치 다이브',
          profile: {
            storageKey: guestProfileKey,
            contentRevision: 'revision-1',
            sampleCount: 1,
          },
        }),
        diveLog({localId: 'manual-b'}),
      ]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });

    expect(snapshot.manifest.items.map(item => item.key)).toEqual([
      'log:manual-a',
      'log:manual-b',
    ]);
    expect(snapshot.retainedItems).toEqual([
      expect.objectContaining({
        entityKind: 'log',
        clientRecordId: 'log-a',
        label: '위치 다이브',
        reason: 'profile_missing',
      }),
    ]);
    expect(snapshot.manifest).toMatchObject({
      status: 'prepared',
      planCount: 0,
      logCount: 2,
    });
  });

  it('retains the relationship pair when a converted watch log profile is corrupt', async () => {
    const profiles = profileStorage();
    await profiles.write(guestProfileKey, [
      {localSessionId: 'wrong-session', timestamp: 10, depthMeters: 1},
    ]);
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([
        diveLog({
          localId: 'log-a',
          profile: {
            storageKey: guestProfileKey,
            contentRevision: 'revision-1',
            sampleCount: 1,
          },
        }),
      ]),
      planRepository: repository([
        divePlan({localId: 'plan-a', convertedLogLocalId: 'log-a'}),
      ]),
      profileStorage: profiles,
      now: () => 100,
    });

    expect(snapshot.manifest.items).toEqual([]);
    expect(snapshot.manifest.status).toBe('retained');
    expect(snapshot.retainedItems).toEqual([
      expect.objectContaining({
        entityKind: 'plan',
        clientRecordId: 'plan-a',
        reason: 'related_item_retained',
        relatedClientRecordId: 'log-a',
      }),
      expect.objectContaining({
        entityKind: 'log',
        clientRecordId: 'log-a',
        reason: 'profile_corrupt',
      }),
    ]);
  });

  it('round-trips sanitized failure context without changing the manifest digest', async () => {
    const storage = new InMemoryKeyValueStore();
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({ localId: 'log-a', title: 'Moon Island' })]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    snapshot.manifest.status = 'failed';
    snapshot.errorCode = 'profile_corrupt';
    Reflect.set(snapshot, 'failure', {
      phase: 'checking',
      entityKind: 'log',
      clientRecordId: 'log-a',
      label: 'Moon Island',
    });
    const store = new GuestClaimStore({ storage, userId, now: () => 101 });

    await store.write(snapshot);

    await expect(store.read()).resolves.toMatchObject({
      errorCode: 'profile_corrupt',
      failure: {
        phase: 'checking',
        entityKind: 'log',
        clientRecordId: 'log-a',
        label: 'Moon Island',
      },
    });
  });

  it('reads legacy claim sidecars without retained metadata as an empty list', async () => {
    const storage = new InMemoryKeyValueStore();
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const legacy = structuredClone(snapshot) as Partial<typeof snapshot>;
    delete legacy.retainedItems;
    await storage.setString(
      dataStorageKeys({kind: 'user', userId}).claim,
      JSON.stringify(legacy),
    );

    await expect(new GuestClaimStore({storage, userId}).read()).resolves.toMatchObject({
      retainedItems: [],
    });
  });

  it('snapshots plans first with canonical payload and complete local/profile bytes', async () => {
    const storage = new InMemoryKeyValueStore();
    const profiles = profileStorage();
    const samples = depthSamples(200);
    await profiles.write(guestProfileKey, samples);
    const logs = [
      diveLog({ localId: 'log-b' }),
      diveLog({
        localId: 'log-a',
        samples: samples.slice(0, 160),
        profile: {
          storageKey: guestProfileKey,
          contentRevision: 'revision-1',
          sampleCount: samples.length,
        },
      }),
    ];
    const plans = [
      divePlan({ localId: 'plan-b' }),
      divePlan({ localId: 'plan-a', convertedLogLocalId: 'log-a' }),
    ];
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository(logs),
      planRepository: repository(plans),
      profileStorage: profiles,
      now: () => 100,
    });

    expect(snapshot.manifest.items.map(item => item.key)).toEqual([
      'plan:plan-a',
      'plan:plan-b',
      'log:log-a',
      'log:log-b',
    ]);
    expect(snapshot.manifest).toMatchObject({
      schemaVersion: 1,
      userId,
      status: 'prepared',
      planCount: 2,
      logCount: 2,
      createdAt: 100,
      updatedAt: 100,
    });
    expect(snapshot.manifest.clientBatchId).toBe(
      `claim:100:${snapshot.manifest.manifestSha256.slice(0, 16)}`,
    );
    expect(snapshot.manifest.items[0]).toMatchObject({
      convertedLogClientRecordId: 'log-a',
    });
    expect(snapshot.manifest.items[2]).toMatchObject({
      sourcePlanClientRecordId: 'plan-a',
      profile: {
        storageKey: guestProfileKey,
        contentRevision: 'revision-1',
        sampleCount: 200,
      },
    });

    const logSnapshot = snapshot.snapshots[2];
    const payload = JSON.parse(logSnapshot.payloadBytes) as Record<
      string,
      unknown
    >;
    expect(logSnapshot.payloadBytes).toBe(canonicalJson(payload));
    expect(snapshot.manifest.items[2]?.payloadSha256).toBe(
      canonicalAccountPayloadSha256(payload),
    );
    expect((payload.profile_preview as unknown[]).length).toBeLessThanOrEqual(
      160,
    );
    expect(JSON.parse(logSnapshot.profileBytes ?? '[]')).toHaveLength(200);
    expect(JSON.parse(logSnapshot.localRecordBytes)).toMatchObject({
      localId: 'log-a',
      watchCapture: { profile: { storageKey: guestProfileKey } },
    });
    expect(
      (
        logSnapshot as typeof logSnapshot & {
          localRecordSha256?: string;
        }
      ).localRecordSha256,
    ).toMatch(/^[0-9a-f]{64}$/);

    logs[1] = diveLog({ localId: 'log-a', title: 'changed after snapshot' });
    plans[0] = divePlan({ localId: 'plan-z' });
    await new GuestClaimStore({ storage, userId, now: () => 101 }).write(
      snapshot,
    );
    const resumed = await new GuestClaimStore({
      storage,
      userId,
      now: () => 102,
    }).read();

    expect(resumed).toEqual(snapshot);
    expect(resumed?.snapshots[2]?.localRecordBytes).not.toContain(
      'changed after snapshot',
    );
  });

  it('fails closed for malformed or digest-mismatched sidecars', async () => {
    const storage = new InMemoryKeyValueStore();
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({ localId: 'log-a' })]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const store = new GuestClaimStore({ storage, userId, now: () => 101 });
    await store.write(snapshot);

    const mutableProgress = structuredClone(snapshot);
    mutableProgress.manifest.status = 'running';
    mutableProgress.manifest.remoteBatchId =
      '10000000-0000-4000-8000-000000000001';
    mutableProgress.manifest.items[0] = {
      ...mutableProgress.manifest.items[0]!,
      stagingRecordId: '20000000-0000-4000-8000-000000000001',
      targetRecordId: '30000000-0000-4000-8000-000000000001',
      completedAt: 101,
    };
    mutableProgress.manifest.updatedAt = 101;
    await expect(store.write(mutableProgress)).resolves.toBeUndefined();
    expect(mutableProgress.manifest.manifestSha256).toBe(
      snapshot.manifest.manifestSha256,
    );

    const tampered = structuredClone(snapshot);
    tampered.snapshots[0]!.payloadBytes = '{}';
    await expect(store.write(tampered)).rejects.toThrow('guest claim');

    const localRecordTampered = structuredClone(snapshot);
    const localRecord = JSON.parse(
      localRecordTampered.snapshots[0]!.localRecordBytes,
    ) as DiveLogEntry;
    localRecord.manual.title = 'single field changed';
    localRecordTampered.snapshots[0]!.localRecordBytes =
      JSON.stringify(localRecord);
    await expect(store.write(localRecordTampered)).rejects.toThrow(
      'guest claim',
    );

    const strayError = structuredClone(snapshot);
    strayError.errorCode = 'network_unavailable';
    await expect(store.write(strayError)).rejects.toThrow('guest claim');

    const failedWithoutError = structuredClone(snapshot);
    failedWithoutError.manifest.status = 'failed';
    await expect(store.write(failedWithoutError)).rejects.toThrow(
      'guest claim',
    );

    await storage.setString(
      dataStorageKeys({ kind: 'user', userId }).claim,
      '{',
    );
    await expect(store.read()).rejects.toThrow('guest claim');
  });

  it('scopes manifests by user and denies cross-user snapshots', async () => {
    const storage = new InMemoryKeyValueStore();
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({ localId: 'log-a' })]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    await new GuestClaimStore({ storage, userId }).write(snapshot);

    await expect(
      new GuestClaimStore({ storage, userId: otherUserId }).read(),
    ).resolves.toBeUndefined();
    await expect(
      new GuestClaimStore({ storage, userId: otherUserId }).write(snapshot),
    ).rejects.toThrow('user');
  });

  it('rejects profile readback evidence for a different remote path', async () => {
    const storage = new InMemoryKeyValueStore();
    const profiles = profileStorage();
    const samples = depthSamples(1);
    await profiles.write(guestProfileKey, samples);
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([
        diveLog({
          localId: 'log-a',
          samples,
          profile: {
            storageKey: guestProfileKey,
            contentRevision: 'revision-1',
            sampleCount: 1,
          },
        }),
      ]),
      planRepository: repository([]),
      profileStorage: profiles,
      now: () => 100,
    });
    snapshot.manifest.status = 'running';
    snapshot.manifest.remoteBatchId = '10000000-0000-4000-8000-000000000001';
    snapshot.manifest.items[0] = {
      ...snapshot.manifest.items[0]!,
      stagingRecordId: '20000000-0000-4000-8000-000000000001',
      targetRecordId: '30000000-0000-4000-8000-000000000001',
    };
    const profileBytes = snapshot.snapshots[0]!.profileBytes!;
    snapshot.snapshots[0]!.profileReadback = {
      path: `${userId}/claims/wrong/path.json`,
      byteCount: new TextEncoder().encode(profileBytes).length,
      sha256: snapshot.manifest.items[0]!.profile!.sha256,
      sampleCount: 1,
      verifiedAt: 101,
    };
    snapshot.manifest.updatedAt = 101;

    await expect(
      new GuestClaimStore({ storage, userId }).write(snapshot),
    ).rejects.toThrow('guest claim');
  });

  it('rejects foreign-principal profile keys before reading or persisting them', async () => {
    const profiles = profileStorage();
    const foreignProfileKey = `${dataProfileKeyPrefix({
      kind: 'user',
      userId: otherUserId,
    })}session-log-a:revision-1`;
    await profiles.write(foreignProfileKey, depthSamples(1));

    await expect(
      createGuestClaimSnapshot({
        userId,
        logbookRepository: repository([
          diveLog({
            localId: 'log-a',
            samples: depthSamples(1),
            profile: {
              storageKey: foreignProfileKey,
              contentRevision: 'revision-1',
              sampleCount: 1,
            },
          }),
        ]),
        planRepository: repository([]),
        profileStorage: profiles,
        now: () => 100,
      }),
    ).rejects.toMatchObject({ code: 'claim_validation_failed' });
    expect(profiles.read).not.toHaveBeenCalledWith(foreignProfileKey);
  });

  it.each([
    {
      name: 'missing converted log',
      plans: [divePlan({ localId: 'plan-a', convertedLogLocalId: 'missing' })],
      logs: [diveLog({ localId: 'log-a' })],
    },
    {
      name: 'duplicate converted log',
      plans: [
        divePlan({ localId: 'plan-a', convertedLogLocalId: 'log-a' }),
        divePlan({ localId: 'plan-b', convertedLogLocalId: 'log-a' }),
      ],
      logs: [diveLog({ localId: 'log-a' })],
    },
  ])(
    'rejects $name before creating a staged manifest',
    async ({ plans, logs }) => {
      await expect(
        createGuestClaimSnapshot({
          userId,
          logbookRepository: repository(logs),
          planRepository: repository(plans),
          profileStorage: profileStorage(),
          now: () => 100,
        }),
      ).rejects.toMatchObject({ code: 'relationship_invalid' });
    },
  );
});

function diveLog(input: {
  localId: string;
  title?: string;
  samples?: WatchDepthSample[];
  profile?: NonNullable<DiveLogEntry['watchCapture']>['profile'];
}): DiveLogEntry {
  const samples = input.samples ?? [];
  return {
    localId: input.localId,
    source: input.profile ? 'watch' : 'manual',
    cloudSyncStatus: 'notConfigured',
    createdAt: 10,
    updatedAt: 11,
    manual: {
      title: input.title,
      site: { name: 'Local Reef' },
      buddyIds: [],
      gearIds: [],
      tags: [],
      observedMarineLife: [],
      measuredValues: { startedAt: 10 },
    },
    mobile: { mediaPlaceholders: [] },
    provenance: {},
    ...(input.profile
      ? {
          watchCapture: {
            importKey: `watch:${input.localId}`,
            importedAt: 11,
            session: {
              localSessionId: `session-${input.localId}`,
              startedAt: 10,
              samples: [],
            },
            measuredValues: { startedAt: 10 },
            samples,
            profile: input.profile,
          },
        }
      : {}),
  };
}

function divePlan(input: {
  localId: string;
  convertedLogLocalId?: string;
}): DivePlan {
  return {
    localId: input.localId,
    status: input.convertedLogLocalId ? 'completed' : 'draft',
    cloudSyncStatus: 'notConfigured',
    createdAt: 10,
    updatedAt: 11,
    convertedLogLocalId: input.convertedLogLocalId,
    site: { name: 'Local Reef' },
    buddyIds: [],
    gearIds: [],
    tags: [],
    plannedValues: {},
    checklistItems: [],
  };
}

function depthSamples(count: number): WatchDepthSample[] {
  return Array.from({ length: count }, (_, index) => ({
    localSessionId: 'session-log-a',
    timestamp: 10 + index,
    depthMeters: index / 10,
  }));
}

function repository<T extends { localId: string }>(values: T[]) {
  return {
    list: jest.fn(async () => values.map(value => structuredClone(value))),
    get: jest.fn(async (localId: string) =>
      structuredClone(values.find(value => value.localId === localId)),
    ),
    save: jest.fn(async (value: T) => structuredClone(value)),
    delete: jest.fn(async () => undefined),
    removeWatchProfileIfUnreferenced: jest.fn(async () => undefined),
    importWatchMessages: jest.fn(async () => []),
    getWatchProfile: jest.fn(async () => []),
  } as unknown as DiveLogRepository & DivePlanRepository;
}

function profileStorage(): WatchProfileStorage {
  const values = new Map<string, WatchDepthSample[]>();
  return {
    write: jest.fn(async (key, samples) => {
      values.set(key, structuredClone(samples));
    }),
    read: jest.fn(async key => structuredClone(values.get(key))),
    remove: jest.fn(async key => {
      values.delete(key);
    }),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
