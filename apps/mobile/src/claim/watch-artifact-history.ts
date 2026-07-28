import type {DiveLogEntry} from '../types/dive-log-entry';
import {
  parseSnapshotLocalRecord,
  type GuestClaimSnapshot,
} from './guest-claim-store';

export type WatchArtifactIdentity = {
  localSessionId: string;
  contentRevision: string;
  artifactSha256: string;
};

const historicalStatuses = new Set<GuestClaimSnapshot['manifest']['status']>([
  'deferred',
  'failed',
  'retained',
  'cleanupPending',
  'committed',
]);

export function claimSnapshotContainsHistoricalArtifact(
  snapshot: GuestClaimSnapshot,
  identity: WatchArtifactIdentity,
  liveGuestIds: ReadonlySet<string>,
): boolean {
  if (
    !historicalStatuses.has(snapshot.manifest.status) ||
    !isCompleteIdentity(identity)
  ) {
    return false;
  }

  if (snapshot.historicalArtifacts !== undefined) {
    return snapshot.historicalArtifacts.some(
      artifact =>
        artifact.localSessionId === identity.localSessionId &&
        artifact.contentRevision === identity.contentRevision &&
        artifact.artifactSha256 === identity.artifactSha256,
    );
  }

  return snapshot.manifest.items.some((item, index) => {
    if (
      item.entityKind !== 'log' ||
      liveGuestIds.has(item.clientRecordId)
    ) {
      return false;
    }
    const sidecar = snapshot.snapshots[index];
    if (sidecar === undefined || sidecar.entityKind !== 'log') {
      return false;
    }
    const record = parseSnapshotLocalRecord(sidecar) as DiveLogEntry;
    const profile = record.watchCapture?.profile;
    return (
      record.watchCapture?.session.localSessionId ===
        identity.localSessionId &&
      profile?.contentRevision === identity.contentRevision &&
      (profile?.artifactSha256 ?? profile?.sha256) === identity.artifactSha256
    );
  });
}

function isCompleteIdentity(identity: WatchArtifactIdentity): boolean {
  return (
    typeof identity.localSessionId === 'string' &&
    identity.localSessionId.length > 0 &&
    typeof identity.contentRevision === 'string' &&
    identity.contentRevision.length > 0 &&
    typeof identity.artifactSha256 === 'string' &&
    identity.artifactSha256.length > 0
  );
}
