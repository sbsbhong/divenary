import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

import type { WatchDepthSample } from '../types/dive-session';
import { parseWatchSyncMessageValue } from '../utils/watch-sync-message-validation';
import type { GuestClaimErrorCode } from './guest-claim-types';

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

  const bytes = JSON.stringify(verifiedSamples);
  const encoded = encodeUtf8(bytes);
  const digest = bytesToHex(sha256(encoded));
  if (expectation.sha256 !== undefined && expectation.sha256 !== digest) {
    throw new GuestClaimProfileError('profile_corrupt');
  }

  return {
    bytes,
    byteCount: encoded.length,
    sha256: digest,
    sampleCount: verifiedSamples.length,
    samples: verifiedSamples,
  };
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

export function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}
