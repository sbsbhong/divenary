const FLOAT64_BYTES = 8;
const FLOAT64_LOW_WORD_OFFSET = 4;
const ACCOUNT_FLOAT_READBACK_SIGNIFICANT_DIGITS = 15;

const float64Buffer = new ArrayBuffer(FLOAT64_BYTES);
const float64View = new DataView(float64Buffer);

function shiftedFloat(value: number, incrementBits: boolean): number {
  float64View.setFloat64(0, value, false);
  let highWord = float64View.getUint32(0, false);
  let lowWord = float64View.getUint32(FLOAT64_LOW_WORD_OFFSET, false);

  if (incrementBits) {
    lowWord = (lowWord + 1) >>> 0;
    if (lowWord === 0) {
      highWord = (highWord + 1) >>> 0;
    }
  } else {
    if (lowWord === 0) {
      highWord = (highWord - 1) >>> 0;
    }
    lowWord = (lowWord - 1) >>> 0;
  }

  float64View.setUint32(0, highWord, false);
  float64View.setUint32(FLOAT64_LOW_WORD_OFFSET, lowWord, false);
  return float64View.getFloat64(0, false);
}

function adjacentFloat(value: number, direction: 'down' | 'up'): number {
  if (value === 0) {
    return direction === 'up' ? Number.MIN_VALUE : -Number.MIN_VALUE;
  }

  const incrementBits = value > 0
    ? direction === 'up'
    : direction === 'down';
  return shiftedFloat(value, incrementBits);
}

export function sameAccountFloat(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  if (left === right) {
    return true;
  }

  return (
    adjacentFloat(left, 'down') === right
    || adjacentFloat(left, 'up') === right
  );
}

/**
 * Compares a typed REST readback with its outgoing or embedded source value.
 * Parameter order is intentional because decimal compatibility is directional.
 */
export function sameAccountFloatReadback(
  typedValue: number,
  sourceValue: number,
): boolean {
  if (!Number.isFinite(typedValue) || !Number.isFinite(sourceValue)) {
    return false;
  }
  return (
    sameAccountFloat(typedValue, sourceValue)
    || Number(
      sourceValue.toPrecision(ACCOUNT_FLOAT_READBACK_SIGNIFICANT_DIGITS),
    ) === typedValue
  );
}
