import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

import type { WatchDepthSample } from '../types/dive-session';
import {decodeUtf8 as decodeUtf8Bytes} from '../utils/utf8';
import {createWatchProfileDigest} from '../utils/watch-profile-digest';
import { parseWatchSyncMessageValue } from '../utils/watch-sync-message-validation';
import type { GuestClaimErrorCode } from './guest-claim-types';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class GuestClaimProfileError extends Error {
  constructor(
    readonly code: Extract<
      GuestClaimErrorCode,
      'profile_missing' | 'profile_corrupt'
    >,
  ) {
    super(code);
    this.name = 'GuestClaimProfileError';
  }
}

export type ProfileBytesSnapshot = {
  bytes: string;
  byteCount: number;
  sha256: string;
  sampleCount: number;
  samples: WatchDepthSample[];
};

export type StoredProfileBytesSnapshot = ProfileBytesSnapshot & {
  artifactSha256?: string;
};

export function createProfileBytesSnapshot(
  samples: WatchDepthSample[] | undefined,
  expectation: {
    localSessionId: string;
    sampleCount: number;
    sha256?: string;
  },
): ProfileBytesSnapshot {
  if (samples === undefined) {
    throw new GuestClaimProfileError('profile_missing');
  }

  const parsed = parseWatchSyncMessageValue({
    type: 'sessionEnded',
    session: {
      localSessionId: expectation.localSessionId,
      startedAt: samples[0]?.timestamp ?? 0,
      samples,
    },
  });
  if (!parsed.ok) {
    throw new GuestClaimProfileError('profile_corrupt');
  }

  const verifiedSamples = parsed.message.session.samples;
  if (
    verifiedSamples.length !== expectation.sampleCount ||
    verifiedSamples.some(
      sample => sample.localSessionId !== expectation.localSessionId,
    )
  ) {
    throw new GuestClaimProfileError('profile_corrupt');
  }

  const digest = createWatchProfileDigest(verifiedSamples);
  if (expectation.sha256 !== undefined && expectation.sha256 !== digest.sha256) {
    throw new GuestClaimProfileError('profile_corrupt');
  }

  return {
    bytes: digest.bytes,
    byteCount: digest.byteCount,
    sha256: digest.sha256,
    sampleCount: verifiedSamples.length,
    samples: verifiedSamples,
  };
}

export function createStoredProfileBytesSnapshot(
  samples: WatchDepthSample[] | undefined,
  expectation: {
    localSessionId: string;
    sampleCount: number;
    sha256?: string;
    artifactSha256?: string;
  },
): StoredProfileBytesSnapshot {
  const snapshot = createProfileBytesSnapshot(samples, {
    localSessionId: expectation.localSessionId,
    sampleCount: expectation.sampleCount,
  });

  if (expectation.artifactSha256 !== undefined) {
    if (
      expectation.sha256 === undefined ||
      expectation.sha256 !== snapshot.sha256 ||
      !SHA256_PATTERN.test(expectation.artifactSha256)
    ) {
      throw new GuestClaimProfileError('profile_corrupt');
    }
    return {...snapshot, artifactSha256: expectation.artifactSha256};
  }

  if (
    expectation.sha256 === undefined ||
    expectation.sha256 === snapshot.sha256
  ) {
    return snapshot;
  }

  if (!SHA256_PATTERN.test(expectation.sha256)) {
    throw new GuestClaimProfileError('profile_corrupt');
  }

  return {...snapshot, artifactSha256: expectation.sha256};
}

export function verifyProfileBytesSnapshot(
  bytes: string,
  expectation: {
    localSessionId: string;
    sampleCount: number;
    sha256: string;
    byteCount?: number;
  },
): ProfileBytesSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    throw new GuestClaimProfileError('profile_corrupt');
  }
  if (!Array.isArray(parsed)) {
    throw new GuestClaimProfileError('profile_corrupt');
  }
  const snapshot = createProfileBytesSnapshot(
    parsed as WatchDepthSample[],
    expectation,
  );
  if (
    expectation.byteCount !== undefined &&
    snapshot.byteCount !== expectation.byteCount
  ) {
    throw new GuestClaimProfileError('profile_corrupt');
  }
  return snapshot;
}

export function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function sha256BytesHex(value: Uint8Array): string {
  return bytesToHex(sha256(value));
}

export function verifyRawProfileBytes(
  value: Uint8Array,
  expectation: { byteCount: number; sha256: string },
): string {
  if (
    value.length !== expectation.byteCount ||
    sha256BytesHex(value) !== expectation.sha256
  ) {
    throw new GuestClaimProfileError('profile_corrupt');
  }
  return decodeUtf8(value);
}

export function decodeUtf8(value: Uint8Array): string {
  return decodeUtf8Bytes(value);
}
