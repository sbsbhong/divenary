import type {GuestClaimSnapshot} from '../src/claim/guest-claim-store';
import {
  claimSnapshotContainsHistoricalArtifact,
  type WatchArtifactIdentity,
} from '../src/claim/watch-artifact-history';
import type {DiveLogEntry} from '../src/types/dive-log-entry';

const artifactSha256 = 'a'.repeat(64);

function makeIdentity(): WatchArtifactIdentity {
  return {
    localSessionId: 'session-1',
    contentRevision: 'revision-1',
    artifactSha256,
  };
}

function makeFailedClaimSnapshot(
  profile: {artifactSha256?: string; sha256?: string} = {
    artifactSha256,
    sha256: 'b'.repeat(64),
  },
): GuestClaimSnapshot {
  const record: DiveLogEntry = {
    localId: 'historical-watch-log',
    source: 'watch',
    cloudSyncStatus: 'notConfigured',
    createdAt: 100,
    updatedAt: 100,
    manual: {
      site: {},
      buddyIds: [],
      gearIds: [],
      tags: [],
      observedMarineLife: [],
      measuredValues: {startedAt: 100},
    },
    mobile: {mediaPlaceholders: []},
    watchCapture: {
      importKey: 'session-1:100',
      importedAt: 100,
      session: {
        localSessionId: 'session-1',
        startedAt: 100,
        samples: [],
      },
      measuredValues: {startedAt: 100},
      samples: [],
      profile: {
        storageKey: 'guest-profile',
        contentRevision: 'revision-1',
        sampleCount: 0,
        ...profile,
      },
    },
    provenance: {},
  };

  return {
    schemaVersion: 1,
    userId: '00000000-0000-4000-8000-000000000001',
    manifest: {
      schemaVersion: 1,
      userId: '00000000-0000-4000-8000-000000000001',
      clientBatchId: 'claim:100:0000000000000000',
      manifestSha256: 'c'.repeat(64),
      status: 'failed',
      planCount: 0,
      logCount: 1,
      items: [
        {
          key: 'log:historical-watch-log',
          entityKind: 'log',
          clientRecordId: 'historical-watch-log',
          payloadSha256: 'd'.repeat(64),
        },
      ],
      createdAt: 100,
      updatedAt: 101,
    },
    snapshots: [
      {
        key: 'log:historical-watch-log',
        entityKind: 'log',
        payloadBytes: '{}',
        localRecordBytes: JSON.stringify(record),
        localRecordSha256: 'e'.repeat(64),
      },
    ],
    retainedItems: [],
    errorCode: 'claim_validation_failed',
    failure: {phase: 'finalizing'},
  };
}

describe('claimSnapshotContainsHistoricalArtifact', () => {
  it('matches an exact inactive checkpoint artifact whose live guest source is gone', () => {
    expect(
      claimSnapshotContainsHistoricalArtifact(
        makeFailedClaimSnapshot({artifactSha256}),
        makeIdentity(),
        new Set(),
      ),
    ).toBe(true);
  });

  it.each([
    'localSessionId',
    'contentRevision',
    'artifactSha256',
  ] as const)('does not match when %s differs', field => {
    const identity = makeIdentity();
    identity[field] = `${identity[field]}-different`;

    expect(
      claimSnapshotContainsHistoricalArtifact(
        makeFailedClaimSnapshot(),
        identity,
        new Set(),
      ),
    ).toBe(false);
  });

  it('does not match while the source row still exists in live guest inventory', () => {
    expect(
      claimSnapshotContainsHistoricalArtifact(
        makeFailedClaimSnapshot(),
        makeIdentity(),
        new Set(['historical-watch-log']),
      ),
    ).toBe(false);
  });

  it.each(['running', 'finalizing', 'prepared'] as const)(
    'does not match a %s checkpoint',
    status => {
      const snapshot = makeFailedClaimSnapshot();
      snapshot.manifest.status = status;

      expect(
        claimSnapshotContainsHistoricalArtifact(
          snapshot,
          makeIdentity(),
          new Set(),
        ),
      ).toBe(false);
    },
  );

  it('uses the legacy profile digest when no artifact digest marker exists', () => {
    expect(
      claimSnapshotContainsHistoricalArtifact(
        makeFailedClaimSnapshot({sha256: artifactSha256}),
        makeIdentity(),
        new Set(),
      ),
    ).toBe(true);
  });

  it('does not match an incomplete identity', () => {
    expect(
      claimSnapshotContainsHistoricalArtifact(
        makeFailedClaimSnapshot(),
        {...makeIdentity(), contentRevision: ''},
        new Set(),
      ),
    ).toBe(false);
  });
});
