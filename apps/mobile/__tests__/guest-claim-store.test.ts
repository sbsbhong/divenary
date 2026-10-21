import { canonicalAccountPayloadSha256 } from '../src/sync/account-payload';
import {
  createGuestClaimSnapshot,
  guestRecordsContainClaimSnapshotSources,
  guestRecordMatchesClaimSnapshot,
  GuestClaimStore,
  migrateGuestClaimSnapshotProfileSidecars,
  readClaimProfileBytes,
  type GuestClaimSnapshot,
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
import {createWatchProfileDigest} from '../src/utils/watch-profile-digest';
import {verifyProfileBytesSnapshot} from '../src/claim/profile-bytes';

const userId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const batchId = '10000000-0000-4000-8000-000000000001';
const otherBatchId = '10000000-0000-4000-8000-000000000002';
const stagedTargetId = '30000000-0000-4000-8000-000000000001';
const canonicalTargetId = '40000000-0000-4000-8000-000000000001';
const guestProfileKey = `${dataProfileKeyPrefix({
  kind: 'guest',
})}session-log-a:revision-1`;

describe('guest claim store', () => {
  it('requires every snapshot source while allowing post-snapshot rows', async () => {
    const log = diveLog({localId: 'log-a'});
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([log]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });

    expect(
      guestRecordsContainClaimSnapshotSources({
        snapshot,
        logs: [log],
        plans: [],
      }),
    ).toBe(true);
    expect(
      guestRecordsContainClaimSnapshotSources({
        snapshot,
        logs: [],
        plans: [],
      }),
    ).toBe(false);
    expect(
      guestRecordsContainClaimSnapshotSources({
        snapshot,
        logs: [log, diveLog({localId: 'log-b'})],
        plans: [],
      }),
    ).toBe(true);
  });

  it('normalizes a marker-less legacy artifact digest only in the claim snapshot', async () => {
    const profiles = profileStorage();
    const samples = depthSamples(2);
    const legacyArtifactSha256 = 'a'.repeat(64);
    const log = diveLog({
      localId: 'log-a',
      samples: samples.slice(0, 1),
      profile: {
        storageKey: guestProfileKey,
        contentRevision: 'revision-1',
        sampleCount: samples.length,
        sha256: legacyArtifactSha256,
      },
    });
    const guestLogbook = repository([log]);
    await profiles.write(guestProfileKey, samples);

    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: guestLogbook,
      planRepository: repository([]),
      profileStorage: profiles,
      now: () => 100,
    });

    const profileDigest = createWatchProfileDigest(samples).sha256;
    expect(snapshot.retainedItems).toHaveLength(0);
    expect(snapshot.manifest.logCount).toBe(1);
    expect(snapshot.manifest.items[0]?.profile).toEqual(
      expect.objectContaining({sha256: profileDigest}),
    );
    const localSnapshot = JSON.parse(
      snapshot.snapshots[0]!.localRecordBytes,
    ) as DiveLogEntry;
    expect(localSnapshot.watchCapture?.profile).toEqual(
      expect.objectContaining({
        sha256: profileDigest,
        artifactSha256: legacyArtifactSha256,
      }),
    );
    const sourceSnapshot = JSON.parse(
      snapshot.snapshots[0]!.sourceRecordBytes!,
    ) as DiveLogEntry;
    expect(sourceSnapshot.watchCapture?.profile).toEqual(
      expect.objectContaining({sha256: legacyArtifactSha256}),
    );
    expect(sourceSnapshot.watchCapture?.profile?.artifactSha256).toBeUndefined();
    await expect(guestLogbook.get(log.localId)).resolves.toEqual(log);
    await expect(profiles.read(guestProfileKey)).resolves.toEqual(samples);
  });

  it('requires exact source metadata before treating a profile row as unchanged', async () => {
    const profiles = profileStorage();
    const versionedSamples = [
      {localSessionId: 'session-versioned-log', timestamp: 10, depthMeters: 1},
    ];
    const canonicalSamples = [
      {localSessionId: 'session-canonical-log', timestamp: 10, depthMeters: 1},
    ];
    const versionedProfileKey = `${dataProfileKeyPrefix({
      kind: 'guest',
    })}session-versioned-log:revision-1`;
    const canonicalProfileKey = `${dataProfileKeyPrefix({
      kind: 'guest',
    })}session-canonical-log:revision-1`;
    await profiles.write(versionedProfileKey, versionedSamples);
    await profiles.write(canonicalProfileKey, canonicalSamples);
    const versioned = diveLog({
      localId: 'versioned-log',
      samples: versionedSamples,
      profile: {
        storageKey: versionedProfileKey,
        contentRevision: 'revision-1',
        sampleCount: versionedSamples.length,
        sha256: createWatchProfileDigest(versionedSamples).sha256,
        artifactSha256: 'a'.repeat(64),
      },
    });
    const canonical = diveLog({
      localId: 'canonical-log',
      samples: canonicalSamples,
      profile: {
        storageKey: canonicalProfileKey,
        contentRevision: 'revision-1',
        sampleCount: canonicalSamples.length,
        sha256: createWatchProfileDigest(canonicalSamples).sha256,
      },
    });
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([versioned, canonical]),
      planRepository: repository([]),
      profileStorage: profiles,
      now: () => 100,
    });
    const versionedItem = snapshot.manifest.items.find(
      item => item.clientRecordId === versioned.localId,
    )!;
    const versionedSidecar = snapshot.snapshots.find(
      item => item.key === versionedItem.key,
    )!;
    const canonicalItem = snapshot.manifest.items.find(
      item => item.clientRecordId === canonical.localId,
    )!;
    const canonicalSidecar = snapshot.snapshots.find(
      item => item.key === canonicalItem.key,
    )!;

    await expect(
      guestRecordMatchesClaimSnapshot({
        item: versionedItem,
        sidecar: versionedSidecar,
        record: {
          ...versioned,
          watchCapture: {
            ...versioned.watchCapture!,
            profile: {
              ...versioned.watchCapture!.profile!,
              sha256: 'a'.repeat(64),
              artifactSha256: undefined,
            },
          },
        },
        profileStorage: profiles,
      }),
    ).resolves.toBe(false);
    await expect(
      guestRecordMatchesClaimSnapshot({
        item: canonicalItem,
        sidecar: canonicalSidecar,
        record: {
          ...canonical,
          watchCapture: {
            ...canonical.watchCapture!,
            profile: {
              ...canonical.watchCapture!.profile!,
              sha256: undefined,
            },
          },
        },
        profileStorage: profiles,
      }),
    ).resolves.toBe(false);
  });

  it('retains malformed sample values and malformed profile digests', async () => {
    const profiles = profileStorage();
    const samples = depthSamples(1);
    await profiles.write(guestProfileKey, [
      {localSessionId: 'session-log-a', timestamp: Number.NaN, depthMeters: 2},
    ]);

    const malformedSample = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([
        diveLog({
          localId: 'log-a',
          samples,
          profile: {
            storageKey: guestProfileKey,
            contentRevision: 'revision-1',
            sampleCount: 1,
            sha256: 'a'.repeat(64),
          },
        }),
      ]),
      planRepository: repository([]),
      profileStorage: profiles,
      now: () => 100,
    });
    expect(malformedSample.retainedItems).toEqual([
      expect.objectContaining({reason: 'profile_corrupt'}),
    ]);

    await profiles.write(guestProfileKey, samples);
    const malformedDigest = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([
        diveLog({
          localId: 'log-a',
          samples,
          profile: {
            storageKey: guestProfileKey,
            contentRevision: 'revision-1',
            sampleCount: 1,
            sha256: 'not-a-sha256',
          },
        }),
      ]),
      planRepository: repository([]),
      profileStorage: profiles,
      now: () => 100,
    });
    expect(malformedDigest.retainedItems).toEqual([
      expect.objectContaining({reason: 'profile_corrupt'}),
    ]);
  });

  it.each<
    [
      string,
      WatchDepthSample[] | undefined,
      'profile_missing' | 'profile_corrupt',
    ]
  >([
    ['missing profile', undefined, 'profile_missing'],
    ['sample count mismatch', depthSamples(2), 'profile_corrupt'],
    [
      'session mismatch',
      [{localSessionId: 'wrong-session', timestamp: 100, depthMeters: 2}],
      'profile_corrupt',
    ],
  ])('%s stays retained', async (_name, storedSamples, reason) => {
    const profiles = profileStorage();
    const samples = depthSamples(1);
    if (storedSamples !== undefined) {
      await profiles.write(guestProfileKey, storedSamples);
    }

    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([
        diveLog({
          localId: 'log-a',
          samples,
          profile: {
            storageKey: guestProfileKey,
            contentRevision: 'revision-1',
            sampleCount: samples.length,
            sha256: 'a'.repeat(64),
          },
        }),
      ]),
      planRepository: repository([]),
      profileStorage: profiles,
      now: () => 100,
    });

    expect(snapshot.manifest.logCount).toBe(0);
    expect(snapshot.retainedItems).toEqual([
      expect.objectContaining({
        entityKind: 'log',
        clientRecordId: 'log-a',
        reason,
      }),
    ]);
  });

  it('keeps a versioned digest mismatch retained instead of reinterpreting it', async () => {
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
            sampleCount: samples.length,
            sha256: 'a'.repeat(64),
            artifactSha256: 'b'.repeat(64),
          },
        }),
      ]),
      planRepository: repository([]),
      profileStorage: profiles,
      now: () => 100,
    });

    expect(snapshot.manifest.logCount).toBe(0);
    expect(snapshot.retainedItems).toEqual([
      expect.objectContaining({reason: 'profile_corrupt'}),
    ]);
  });

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

  it('reuses a verified read but still rejects stored text that changed', async () => {
    const storage = new InMemoryKeyValueStore();
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({ localId: 'log-a', title: 'Moon Island' })]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const store = new GuestClaimStore({ storage, userId, now: () => 101 });
    await store.write(snapshot);
    const first = await store.read();
    const second = await store.read();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);

    const key = dataStorageKeys({ kind: 'user', userId }).claim;
    const stored = JSON.parse((await storage.getString(key))!);
    stored.snapshots[0].localRecordSha256 = '0'.repeat(64);
    await storage.setString(key, JSON.stringify(stored));

    await expect(store.read()).rejects.toThrow();
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

  it.each([
    [
      'running',
      'running',
      undefined,
      {state: 'recoverable', status: 'running'},
    ],
    [
      'finalizing',
      'finalizing',
      undefined,
      {state: 'recoverable', status: 'finalizing'},
    ],
    [
      'cleanup pending',
      'cleanupPending',
      undefined,
      {state: 'recoverable', status: 'cleanupPending'},
    ],
    [
      'retryable network failure',
      'failed',
      'network_unavailable',
      {
        state: 'recoverable',
        status: 'failed',
        errorCode: 'network_unavailable',
      },
    ],
    ['prepared', 'prepared', undefined, {state: 'inactive'}],
    [
      'non-retryable failure',
      'failed',
      'session_expired',
      {state: 'inactive'},
    ],
  ] as const)(
    'persists a lightweight checkpoint hint for %s snapshots',
    async (_name, status, errorCode, expected) => {
      const storage = new InMemoryKeyValueStore();
      const snapshot = await createGuestClaimSnapshot({
        userId,
        logbookRepository: repository([diveLog({localId: 'log-a'})]),
        planRepository: repository([]),
        profileStorage: profileStorage(),
        now: () => 100,
      });
      const persisted = snapshotWithStatus(snapshot, status, errorCode);

      await new GuestClaimStore({storage, userId}).write(persisted);

      await expect(
        new GuestClaimStore({storage, userId}).readCheckpointHint(),
      ).resolves.toEqual(expected);
    },
  );

  it('does not rewrite an unchanged successfully persisted hint on item progress writes', async () => {
    const storage = new InMemoryKeyValueStore();
    const setString = jest.spyOn(storage, 'setString');
    const remove = jest.spyOn(storage, 'remove');
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const running = snapshotWithStatus(snapshot, 'running');
    const store = new GuestClaimStore({storage, userId});

    await store.write(running);
    remove.mockClear();
    const progressed = structuredClone(running);
    progressed.manifest.items[0] = {
      ...progressed.manifest.items[0]!,
      stagingRecordId: '20000000-0000-4000-8000-000000000001',
      targetRecordId: '30000000-0000-4000-8000-000000000001',
      completedAt: 101,
    };
    progressed.manifest.updatedAt = 101;
    await store.write(progressed);

    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const hintWrites = setString.mock.calls.filter(
      ([key]) => key !== claimKey,
    );
    expect(setString).toHaveBeenCalledTimes(3);
    expect(hintWrites).toHaveLength(1);
    expect(remove).not.toHaveBeenCalled();
    await expect(
      new GuestClaimStore({storage, userId}).readCheckpointHint(),
    ).resolves.toEqual({state: 'recoverable', status: 'running'});
  });

  it('invalidates a stale inactive hint before writing a recoverable snapshot', async () => {
    const values = new Map<string, string>();
    const events: string[] = [];
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const hintKey = `${claimKey}:checkpoint-hint`;
    let rejectRecoverableHint = false;
    const storage = {
      getString: jest.fn(async (key: string) => {
        events.push(`get:${key}`);
        return values.get(key);
      }),
      setString: jest.fn(async (key: string, value: string) => {
        events.push(`set:${key}`);
        if (
          key === hintKey &&
          rejectRecoverableHint &&
          JSON.parse(value).state === 'recoverable'
        ) {
          throw new Error('recoverable hint unavailable');
        }
        values.set(key, value);
      }),
      remove: jest.fn(async (key: string) => {
        events.push(`remove:${key}`);
        values.delete(key);
      }),
    };
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    await new GuestClaimStore({storage, userId}).write(snapshot);
    events.length = 0;
    rejectRecoverableHint = true;

    const recoverableStore = new GuestClaimStore({storage, userId});
    await expect(
      recoverableStore.write(snapshotWithStatus(snapshot, 'running')),
    ).resolves.toBeUndefined();

    expect(events).toEqual([
      `get:${hintKey}`,
      `remove:${hintKey}`,
      `set:${claimKey}`,
      `set:${hintKey}`,
    ]);
    await expect(
      new GuestClaimStore({storage, userId}).readCheckpointHint(),
    ).resolves.toEqual({state: 'unknown'});
    await expect(
      new GuestClaimStore({storage, userId}).read(),
    ).resolves.toMatchObject({manifest: {status: 'running'}});

    events.length = 0;
    rejectRecoverableHint = false;
    await recoverableStore.write(snapshotWithStatus(snapshot, 'running'));
    expect(events.slice(0, 2)).toEqual([
      `get:${hintKey}`,
      `remove:${hintKey}`,
    ]);
  });

  it('aborts a recoverable snapshot write when pre-write hint invalidation fails', async () => {
    const values = new Map<string, string>();
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const hintKey = `${claimKey}:checkpoint-hint`;
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    values.set(claimKey, JSON.stringify(snapshot));
    values.set(
      hintKey,
      JSON.stringify({
        schemaVersion: 1,
        userId,
        state: 'inactive',
      }),
    );
    const storage = {
      getString: jest.fn(async (key: string) => values.get(key)),
      setString: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      remove: jest.fn(async () => {
        throw new Error('hint invalidation unavailable');
      }),
    };

    await expect(
      new GuestClaimStore({storage, userId}).write(
        snapshotWithStatus(snapshot, 'running'),
      ),
    ).rejects.toThrow('hint invalidation unavailable');
    expect(JSON.parse(values.get(claimKey)!).manifest.status).toBe('prepared');
  });

  it.each([
    ['missing', undefined],
    ['malformed', '{'],
  ])(
    'clears a %s hint before writing a recoverable snapshot',
    async (_name, existingHint) => {
      const values = new Map<string, string>();
      const events: string[] = [];
      const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
      const hintKey = `${claimKey}:checkpoint-hint`;
      if (existingHint !== undefined) {
        values.set(hintKey, existingHint);
      }
      const storage = {
        getString: jest.fn(async (key: string) => {
          events.push(`get:${key}`);
          return values.get(key);
        }),
        setString: jest.fn(async (key: string, value: string) => {
          events.push(`set:${key}`);
          values.set(key, value);
        }),
        remove: jest.fn(async (key: string) => {
          events.push(`remove:${key}`);
          values.delete(key);
        }),
      };
      const snapshot = await createGuestClaimSnapshot({
        userId,
        logbookRepository: repository([diveLog({localId: 'log-a'})]),
        planRepository: repository([]),
        profileStorage: profileStorage(),
        now: () => 100,
      });

      await new GuestClaimStore({storage, userId}).write(
        snapshotWithStatus(snapshot, 'running'),
      );

      expect(events).toEqual([
        `get:${hintKey}`,
        `remove:${hintKey}`,
        `set:${claimKey}`,
        `set:${hintKey}`,
      ]);
    },
  );

  it.each([
    ['missing', undefined],
    [
      'stale',
      JSON.stringify({
        schemaVersion: 1,
        userId,
        state: 'inactive',
      }),
    ],
  ])(
    'backfills a %s checkpoint hint after an authoritative legacy snapshot read',
    async (_name, existingHint) => {
      const storage = new InMemoryKeyValueStore();
      const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
      const hintKey = `${claimKey}:checkpoint-hint`;
      const snapshot = await createGuestClaimSnapshot({
        userId,
        logbookRepository: repository([diveLog({localId: 'log-a'})]),
        planRepository: repository([]),
        profileStorage: profileStorage(),
        now: () => 100,
      });
      const running = snapshotWithStatus(snapshot, 'running');
      await storage.setString(claimKey, JSON.stringify(running));
      if (existingHint !== undefined) {
        await storage.setString(hintKey, existingHint);
      }
      const setString = jest.spyOn(storage, 'setString');

      await expect(
        new GuestClaimStore({storage, userId}).read(),
      ).resolves.toEqual(running);

      expect(setString).toHaveBeenCalledTimes(1);
      expect(setString.mock.calls[0]?.[0]).toBe(hintKey);
      await expect(
        new GuestClaimStore({storage, userId}).readCheckpointHint(),
      ).resolves.toEqual({state: 'recoverable', status: 'running'});
    },
  );

  it('does not fail an authoritative snapshot read when advisory hint backfill fails', async () => {
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const running = snapshotWithStatus(snapshot, 'running');
    const storage = {
      getString: jest.fn(async (key: string) =>
        key === claimKey ? JSON.stringify(running) : undefined,
      ),
      setString: jest.fn(async () => {
        throw new Error('hint unavailable');
      }),
      remove: jest.fn(async () => undefined),
    };

    await expect(
      new GuestClaimStore({storage, userId}).read(),
    ).resolves.toEqual(running);
    expect(storage.setString).toHaveBeenCalledTimes(1);
  });

  it('invalidates a stale inactive hint before best-effort recoverable backfill', async () => {
    const values = new Map<string, string>();
    const events: string[] = [];
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const hintKey = `${claimKey}:checkpoint-hint`;
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const running = snapshotWithStatus(snapshot, 'running');
    values.set(claimKey, JSON.stringify(running));
    values.set(
      hintKey,
      JSON.stringify({
        schemaVersion: 1,
        userId,
        state: 'inactive',
      }),
    );
    const storage = {
      getString: jest.fn(async (key: string) => {
        events.push(`get:${key}`);
        return values.get(key);
      }),
      setString: jest.fn(async (key: string) => {
        events.push(`set:${key}`);
        throw new Error('recoverable hint unavailable');
      }),
      remove: jest.fn(async (key: string) => {
        events.push(`remove:${key}`);
        values.delete(key);
      }),
    };

    await expect(
      new GuestClaimStore({storage, userId}).read(),
    ).resolves.toEqual(running);

    expect(events).toEqual([
      `get:${claimKey}`,
      `get:${hintKey}`,
      `remove:${hintKey}`,
      `set:${hintKey}`,
    ]);
    await expect(
      new GuestClaimStore({storage, userId}).readCheckpointHint(),
    ).resolves.toEqual({state: 'unknown'});
  });

  it('serializes cross-instance reads so stale backfill cannot overwrite a newer recoverable hint', async () => {
    const values = new Map<string, string>();
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const hintKey = `${claimKey}:checkpoint-hint`;
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    values.set(claimKey, JSON.stringify(snapshot));
    values.set(
      hintKey,
      JSON.stringify({
        schemaVersion: 1,
        userId,
        state: 'inactive',
      }),
    );
    let releaseStaleRead!: () => void;
    const staleReadReleased = new Promise<void>(resolve => {
      releaseStaleRead = resolve;
    });
    let markStaleReadStarted!: () => void;
    const staleReadStarted = new Promise<void>(resolve => {
      markStaleReadStarted = resolve;
    });
    let blockNextClaimRead = true;
    const setString = jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    });
    const storage = {
      getString: jest.fn(async (key: string) => {
        const captured = values.get(key);
        if (key === claimKey && blockNextClaimRead) {
          blockNextClaimRead = false;
          markStaleReadStarted();
          await staleReadReleased;
        }
        return captured;
      }),
      setString,
      remove: jest.fn(async (key: string) => {
        values.delete(key);
      }),
    };
    const staleRead = new GuestClaimStore({storage, userId}).read();
    await staleReadStarted;

    const recoverableWrite = new GuestClaimStore({storage, userId}).write(
      snapshotWithStatus(snapshot, 'running'),
    );
    await Promise.resolve();
    expect(setString).not.toHaveBeenCalled();

    releaseStaleRead();
    await expect(staleRead).resolves.toEqual(snapshot);
    await expect(recoverableWrite).resolves.toBeUndefined();
    await expect(
      new GuestClaimStore({storage, userId}).readCheckpointHint(),
    ).resolves.toEqual({state: 'recoverable', status: 'running'});
  });

  it('continues same-key operations after a queued operation rejects', async () => {
    const storage = new InMemoryKeyValueStore();
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const malformed = structuredClone(snapshot);
    malformed.snapshots[0]!.payloadBytes = '{}';
    const store = new GuestClaimStore({storage, userId});

    await expect(store.write(malformed)).rejects.toThrow('guest claim');
    await expect(store.write(snapshot)).resolves.toBeUndefined();
    await expect(store.readCheckpointHint()).resolves.toEqual({
      state: 'inactive',
    });
  });

  it('refreshes a cross-instance hint before reusing a recoverable instance cache', async () => {
    const storage = new InMemoryKeyValueStore();
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const running = snapshotWithStatus(snapshot, 'running');
    const storeA = new GuestClaimStore({storage, userId});
    const storeB = new GuestClaimStore({storage, userId});

    await storeA.write(running);
    await storeB.write(snapshot);
    await expect(storeB.readCheckpointHint()).resolves.toEqual({
      state: 'inactive',
    });

    await storeA.write(running);

    await expect(
      new GuestClaimStore({storage, userId}).readCheckpointHint(),
    ).resolves.toEqual({state: 'recoverable', status: 'running'});
  });

  it('validates before writing the snapshot and writes the full snapshot before the hint', async () => {
    const values = new Map<string, string>();
    const calls: string[] = [];
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const storage = {
      getString: jest.fn(async (key: string) => values.get(key)),
      setString: jest.fn(async (key: string, value: string) => {
        calls.push(key);
        if (key !== claimKey) {
          throw new Error('hint unavailable');
        }
        values.set(key, value);
      }),
      remove: jest.fn(async (key: string) => {
        values.delete(key);
      }),
    };
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const malformed = structuredClone(snapshot);
    malformed.snapshots[0]!.payloadBytes = '{}';
    const store = new GuestClaimStore({storage, userId});

    await expect(store.write(malformed)).rejects.toThrow('guest claim');
    expect(calls).toEqual([]);

    await expect(store.write(snapshot)).resolves.toBeUndefined();
    expect(calls[0]).toBe(claimKey);
    expect(calls[1]).not.toBe(claimKey);
    await expect(store.read()).resolves.toEqual(snapshot);
  });

  it('removes the full snapshot before its checkpoint hint', async () => {
    const storage = new InMemoryKeyValueStore();
    const remove = jest.spyOn(storage, 'remove');
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const store = new GuestClaimStore({storage, userId});
    await store.write(snapshotWithStatus(snapshot, 'running'));
    remove.mockClear();

    await store.remove();

    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    expect(remove.mock.calls[0]?.[0]).toBe(claimKey);
    expect(remove.mock.calls[1]?.[0]).not.toBe(claimKey);
    await expect(store.read()).resolves.toBeUndefined();
    await expect(store.readCheckpointHint()).resolves.toEqual({
      state: 'unknown',
    });
  });

  it('leaves a stale hint safely advisory when hint removal fails after snapshot removal', async () => {
    const values = new Map<string, string>();
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    let rejectHintRemoval = false;
    const storage = {
      getString: jest.fn(async (key: string) => values.get(key)),
      setString: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      remove: jest.fn(async (key: string) => {
        if (key !== claimKey && rejectHintRemoval) {
          throw new Error('hint remove unavailable');
        }
        values.delete(key);
      }),
    };
    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([diveLog({localId: 'log-a'})]),
      planRepository: repository([]),
      profileStorage: profileStorage(),
      now: () => 100,
    });
    const store = new GuestClaimStore({storage, userId});
    await store.write(snapshotWithStatus(snapshot, 'running'));
    rejectHintRemoval = true;

    await expect(store.remove()).resolves.toBeUndefined();

    const resumed = new GuestClaimStore({storage, userId});
    await expect(resumed.read()).resolves.toBeUndefined();
    await expect(resumed.readCheckpointHint()).resolves.toEqual({
      state: 'recoverable',
      status: 'running',
    });

    rejectHintRemoval = false;
    await resumed.remove();
    await expect(resumed.readCheckpointHint()).resolves.toEqual({
      state: 'unknown',
    });
  });

  it.each([
    ['missing', undefined],
    ['malformed', '{'],
    [
      'user mismatched',
      JSON.stringify({
        schemaVersion: 1,
        userId: otherUserId,
        state: 'recoverable',
        status: 'running',
      }),
    ],
  ])('treats a %s checkpoint hint as unknown', async (_name, raw) => {
    const storage = new InMemoryKeyValueStore();
    const claimKey = dataStorageKeys({kind: 'user', userId}).claim;
    const hintKey = `${claimKey}:checkpoint-hint`;
    if (raw !== undefined) {
      await storage.setString(hintKey, raw);
    }

    await expect(
      new GuestClaimStore({storage, userId}).readCheckpointHint(),
    ).resolves.toEqual({state: 'unknown'});
  });

  it('reads legacy claim sidecars without source evidence or retained metadata', async () => {
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
    for (const sidecar of legacy.snapshots ?? []) {
      delete sidecar.sourceRecordBytes;
      delete sidecar.sourceRecordSha256;
    }
    const manifest = legacy.manifest!;
    const manifestSha256 = canonicalAccountPayloadSha256({
      schemaVersion: 1,
      userId,
      planCount: manifest.planCount,
      logCount: manifest.logCount,
      items: manifest.items.map(item => ({
        key: item.key,
        entityKind: item.entityKind,
        clientRecordId: item.clientRecordId,
        payloadSha256: item.payloadSha256,
        sourcePlanClientRecordId: item.sourcePlanClientRecordId ?? null,
        convertedLogClientRecordId: item.convertedLogClientRecordId ?? null,
        profile: item.profile ?? null,
      })),
      localRecords: (legacy.snapshots ?? []).map(sidecar => ({
        key: sidecar.key,
        localRecordSha256: sidecar.localRecordSha256,
      })),
      createdAt: manifest.createdAt,
    });
    manifest.manifestSha256 = manifestSha256;
    manifest.clientBatchId = `claim:${manifest.createdAt}:${manifestSha256.slice(0, 16)}`;
    await storage.setString(
      dataStorageKeys({kind: 'user', userId}).claim,
      JSON.stringify(legacy),
    );

    await expect(new GuestClaimStore({storage, userId}).read()).resolves.toMatchObject({
      retainedItems: [],
      snapshots: [expect.not.objectContaining({sourceRecordBytes: expect.anything()})],
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
    expect(
      JSON.parse((await readClaimProfileBytes(logSnapshot, profiles)) ?? '[]'),
    ).toHaveLength(200);
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

  it('keeps a large immutable profile in a raw sidecar instead of the claim envelope', async () => {
    const profiles = profileStorage();
    const samples = depthSamples(8_000);
    await profiles.write(guestProfileKey, samples);

    const snapshot = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([
        diveLog({
          localId: 'log-a',
          samples: samples.slice(0, 160),
          profile: {
            storageKey: guestProfileKey,
            contentRevision: 'revision-1',
            sampleCount: samples.length,
          },
        }),
      ]),
      planRepository: repository([]),
      profileStorage: profiles,
      now: () => 100,
    });

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.snapshots[0]?.profileBytes).toBeUndefined();
    expect(snapshot.snapshots[0]?.profileSidecarStorageKey).toMatch(
      /^dive-mobile:claim-profile:/,
    );
    expect(JSON.stringify(snapshot)).not.toContain('"depthMeters"');

    const stored = await profiles.readRaw?.(
      snapshot.snapshots[0]!.profileSidecarStorageKey!,
    );
    expect(
      verifyProfileBytesSnapshot(stored!, {
        localSessionId: 'session-log-a',
        sampleCount: 8_000,
        sha256: snapshot.manifest.items[0]!.profile!.sha256,
      }).sampleCount,
    ).toBe(8_000);
  });

  it('migrates a legacy inline profile only after exact raw sidecar readback', async () => {
    const profiles = profileStorage();
    const samples = depthSamples(200);
    await profiles.write(guestProfileKey, samples);
    const current = await createGuestClaimSnapshot({
      userId,
      logbookRepository: repository([
        diveLog({
          localId: 'log-a',
          samples: samples.slice(0, 160),
          profile: {
            storageKey: guestProfileKey,
            contentRevision: 'revision-1',
            sampleCount: samples.length,
          },
        }),
      ]),
      planRepository: repository([]),
      profileStorage: profiles,
      now: () => 100,
    });
    const profileBytes = (await readClaimProfileBytes(
      current.snapshots[0]!,
      profiles,
    ))!;
    const legacy: GuestClaimSnapshot = {
      ...structuredClone(current),
      schemaVersion: 1,
      snapshots: current.snapshots.map(sidecar => {
        const {
          profileSidecarStorageKey: _sidecarKey,
          ...withoutSidecarKey
        } = sidecar;
        return {...withoutSidecarKey, profileBytes};
      }),
    };

    const migrated = await migrateGuestClaimSnapshotProfileSidecars(
      legacy,
      profiles,
    );

    expect(legacy.schemaVersion).toBe(1);
    expect(legacy.snapshots[0]?.profileBytes).toBe(profileBytes);
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      snapshots: [
        {
          profileSidecarStorageKey: expect.stringMatching(
            /^dive-mobile:claim-profile:/,
          ),
        },
      ],
    });
    expect(migrated.snapshots[0]?.profileBytes).toBeUndefined();
    await expect(
      profiles.readRaw?.(
        migrated.snapshots[0]!.profileSidecarStorageKey!,
      ),
    ).resolves.toBe(profileBytes);
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

  it('preserves an owner-scoped staged profile path after target canonicalization', async () => {
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
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.manifest.items[0] = {
      ...snapshot.manifest.items[0]!,
      stagingRecordId: '20000000-0000-4000-8000-000000000001',
      targetRecordId: canonicalTargetId,
      completedAt: 101,
    };
    const profileBytes = (await readClaimProfileBytes(
      snapshot.snapshots[0]!,
      profiles,
    ))!;
    snapshot.snapshots[0]!.profileReadback = {
      path: `${userId}/claims/${batchId}/${stagedTargetId}/revision-1.json`,
      byteCount: new TextEncoder().encode(profileBytes).length,
      sha256: snapshot.manifest.items[0]!.profile!.sha256,
      sampleCount: 1,
      verifiedAt: 101,
    };
    snapshot.manifest.updatedAt = 101;
    const store = new GuestClaimStore({storage, userId});

    await expect(store.write(snapshot)).resolves.toBeUndefined();
    await expect(store.read()).resolves.toMatchObject({
      manifest: {
        items: [{targetRecordId: canonicalTargetId}],
      },
      snapshots: [
        {
          profileReadback: {
            path: `${userId}/claims/${batchId}/${stagedTargetId}/revision-1.json`,
          },
        },
      ],
    });
  });

  it.each([
    {
      name: 'foreign owner profile readback path',
      path: `${otherUserId}/claims/${batchId}/${stagedTargetId}/revision-1.json`,
    },
    {
      name: 'foreign batch profile readback path',
      path: `${userId}/claims/${otherBatchId}/${stagedTargetId}/revision-1.json`,
    },
    {
      name: 'malformed record profile readback path',
      path: `${userId}/claims/${batchId}/not-a-uuid/revision-1.json`,
    },
    {
      name: 'unsafe profile readback path',
      path: `${userId}/claims/${batchId}/${stagedTargetId}/../revision-1.json`,
    },
    {
      name: 'wrong revision profile readback path',
      path: `${userId}/claims/${batchId}/${stagedTargetId}/revision-2.json`,
    },
  ])('rejects $name', async ({path}) => {
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
    snapshot.manifest.remoteBatchId = batchId;
    snapshot.manifest.items[0] = {
      ...snapshot.manifest.items[0]!,
      stagingRecordId: '20000000-0000-4000-8000-000000000001',
      targetRecordId: canonicalTargetId,
      completedAt: 101,
    };
    const profileBytes = (await readClaimProfileBytes(
      snapshot.snapshots[0]!,
      profiles,
    ))!;
    snapshot.snapshots[0]!.profileReadback = {
      path,
      byteCount: new TextEncoder().encode(profileBytes).length,
      sha256: snapshot.manifest.items[0]!.profile!.sha256,
      sampleCount: 1,
      verifiedAt: 101,
    };
    snapshot.manifest.updatedAt = 101;

    await expect(
      new GuestClaimStore({storage, userId}).write(snapshot),
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

function snapshotWithStatus(
  source: GuestClaimSnapshot,
  status: GuestClaimSnapshot['manifest']['status'],
  errorCode?: GuestClaimSnapshot['errorCode'],
): GuestClaimSnapshot {
  const snapshot = structuredClone(source);
  snapshot.manifest.status = status;
  snapshot.manifest.updatedAt = 101;
  if (
    status === 'running' ||
    status === 'finalizing' ||
    status === 'cleanupPending'
  ) {
    snapshot.manifest.remoteBatchId =
      '10000000-0000-4000-8000-000000000001';
  }
  if (status === 'finalizing' || status === 'cleanupPending') {
    snapshot.manifest.items = snapshot.manifest.items.map((item, index) => ({
      ...item,
      stagingRecordId: `20000000-0000-4000-8000-00000000000${index + 1}`,
      targetRecordId: `30000000-0000-4000-8000-00000000000${index + 1}`,
      completedAt: 101,
    }));
  }
  if (status === 'failed' && errorCode !== undefined) {
    snapshot.errorCode = errorCode;
  }
  return snapshot;
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
    readStoredWatchProfile: jest.fn(async () => undefined),
  } as unknown as DiveLogRepository & DivePlanRepository;
}

function profileStorage(): WatchProfileStorage {
  const values = new Map<string, WatchDepthSample[]>();
  const rawValues = new Map<string, string>();
  return {
    write: jest.fn(async (key, samples) => {
      values.set(key, structuredClone(samples));
      rawValues.set(key, JSON.stringify(samples));
    }),
    read: jest.fn(async key => {
      const raw = rawValues.get(key);
      return raw === undefined
        ? undefined
        : (JSON.parse(raw) as WatchDepthSample[]);
    }),
    writeRaw: jest.fn(async (key, payloadJson) => {
      rawValues.set(key, payloadJson);
      values.set(key, JSON.parse(payloadJson) as WatchDepthSample[]);
    }),
    readRaw: jest.fn(async key => rawValues.get(key)),
    copyRaw: jest.fn(async (sourceKey, destinationKey) => {
      const raw = rawValues.get(sourceKey);
      if (raw === undefined) {
        throw new Error('missing source profile');
      }
      rawValues.set(destinationKey, raw);
      values.set(destinationKey, JSON.parse(raw) as WatchDepthSample[]);
    }),
    remove: jest.fn(async key => {
      values.delete(key);
      rawValues.delete(key);
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
