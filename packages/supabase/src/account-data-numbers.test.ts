import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {sameAccountFloat} from './account-data-numbers.ts';

describe('sameAccountFloat', () => {
  test('accepts exact and adjacent finite binary64 values in either direction', () => {
    assert.equal(sameAccountFloat(11.6, 11.6), true);
    assert.equal(sameAccountFloat(11.6, 11.600000000000001), true);
    assert.equal(sameAccountFloat(11.600000000000001, 11.6), true);
    assert.equal(sameAccountFloat(-11.6, -11.600000000000001), true);
    assert.equal(sameAccountFloat(1, 0.9999999999999999), true);
    assert.equal(sameAccountFloat(1, 1.0000000000000002), true);
    assert.equal(sameAccountFloat(0.9999999999999999, 1), true);
    assert.equal(sameAccountFloat(-1, -0.9999999999999999), true);
    assert.equal(sameAccountFloat(-1, -1.0000000000000002), true);
    assert.equal(sameAccountFloat(-0.9999999999999999, -1), true);
  });

  test('rejects values farther than one binary64 neighbor', () => {
    assert.equal(sameAccountFloat(11.6, 11.600000000000003), false);
    assert.equal(sameAccountFloat(-11.6, -11.600000000000003), false);
  });

  test('handles signed zero and the smallest finite neighbors without non-finite recovery', () => {
    assert.equal(sameAccountFloat(0, -0), true);
    assert.equal(sameAccountFloat(0, Number.MIN_VALUE), true);
    assert.equal(sameAccountFloat(0, -Number.MIN_VALUE), true);
    assert.equal(sameAccountFloat(Number.MAX_VALUE, Infinity), false);
    assert.equal(sameAccountFloat(Number.NaN, Number.NaN), false);
  });
});
