import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';

import type {WatchDepthSample} from '../src/types/dive-session';
import {createWatchProfileDigest} from '../src/utils/watch-profile-digest';

const samples: WatchDepthSample[] = [{
  localSessionId: 'session-1',
  timestamp: 1_781_000_000,
  depthMeters: 3.2,
}];

it('hashes only the serialized full sample array', () => {
  const expectedBytes = JSON.stringify(samples);
  const expectedSha = bytesToHex(sha256(new TextEncoder().encode(expectedBytes)));

  expect(createWatchProfileDigest(samples)).toEqual({
    bytes: expectedBytes,
    byteCount: new TextEncoder().encode(expectedBytes).length,
    sha256: expectedSha,
  });
});
