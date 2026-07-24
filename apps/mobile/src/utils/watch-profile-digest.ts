import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';

import type {WatchDepthSample} from '../types/dive-session';

export type WatchProfileDigest = {
  bytes: string;
  byteCount: number;
  sha256: string;
};

export function createWatchProfileDigest(
  samples: WatchDepthSample[],
): WatchProfileDigest {
  const bytes = JSON.stringify(samples);
  const encoded = new TextEncoder().encode(bytes);
  return {
    bytes,
    byteCount: encoded.length,
    sha256: bytesToHex(sha256(encoded)),
  };
}
