import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {
  sameAccountFloat,
  sameAccountFloatReadback,
} from './account-data-numbers.ts';

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

describe('sameAccountFloatReadback', () => {
  test('accepts exact, adjacent, and observed 15-significant-digit typed readbacks', () => {
    assert.equal(sameAccountFloatReadback(11.6, 11.6), true);
    assert.equal(
      sameAccountFloatReadback(11.6, 11.600000000000001),
      true,
    );
    assert.equal(
      sameAccountFloatReadback(13.8907051086426, 13.890705108642578),
      true,
    );
    assert.equal(
      sameAccountFloatReadback(6.91755499840561, 6.917554998405613),
      true,
    );
    assert.equal(
      sameAccountFloatReadback(18.4634580612183, 18.46345806121826),
      true,
    );
  });

  test('is directional and rejects divergence or non-finite values', () => {
    assert.equal(
      sameAccountFloatReadback(13.890705108642578, 13.8907051086426),
      false,
    );
    assert.equal(sameAccountFloatReadback(11.5, 11.600000000000001), false);
    assert.equal(sameAccountFloatReadback(120, 120.000000000003), false);
    assert.equal(sameAccountFloatReadback(Infinity, Number.MAX_VALUE), false);
    assert.equal(sameAccountFloatReadback(0, Number.NaN), false);
  });
});
