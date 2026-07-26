const UTF16_CHUNK_SIZE = 4_096;
const CONTINUATION_MASK = 0xc0;
const CONTINUATION_PREFIX = 0x80;

function invalidUtf8(): never {
  throw new TypeError('Invalid UTF-8 byte sequence');
}

function continuationByte(bytes: Uint8Array, index: number): number {
  const byte = bytes[index];
  if (
    byte === undefined ||
    (byte & CONTINUATION_MASK) !== CONTINUATION_PREFIX
  ) {
    invalidUtf8();
  }
  return byte;
}

function decodeUtf8Manually(bytes: Uint8Array): string {
  const codeUnits: number[] = [];
  const decodedChunks: string[] = [];
  let isFirstCodePoint = true;

  const flush = () => {
    if (codeUnits.length === 0) {
      return;
    }
    decodedChunks.push(String.fromCharCode(...codeUnits));
    codeUnits.length = 0;
  };

  const appendCodePoint = (codePoint: number) => {
    if (isFirstCodePoint) {
      isFirstCodePoint = false;
      if (codePoint === 0xfeff) {
        return;
      }
    }
    if (codePoint <= 0xffff) {
      codeUnits.push(codePoint);
    } else {
      const supplementary = codePoint - 0x10000;
      codeUnits.push(
        0xd800 + (supplementary >> 10),
        0xdc00 + (supplementary & 0x3ff),
      );
    }
    if (codeUnits.length >= UTF16_CHUNK_SIZE) {
      flush();
    }
  };

  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index];
    if (first === undefined) {
      invalidUtf8();
    }

    if (first <= 0x7f) {
      appendCodePoint(first);
      index += 1;
      continue;
    }

    if (first >= 0xc2 && first <= 0xdf) {
      const second = continuationByte(bytes, index + 1);
      appendCodePoint(((first & 0x1f) << 6) | (second & 0x3f));
      index += 2;
      continue;
    }

    if (first >= 0xe0 && first <= 0xef) {
      const second = continuationByte(bytes, index + 1);
      const third = continuationByte(bytes, index + 2);
      if (
        (first === 0xe0 && second < 0xa0) ||
        (first === 0xed && second > 0x9f)
      ) {
        invalidUtf8();
      }
      appendCodePoint(
        ((first & 0x0f) << 12) |
          ((second & 0x3f) << 6) |
          (third & 0x3f),
      );
      index += 3;
      continue;
    }

    if (first >= 0xf0 && first <= 0xf4) {
      const second = continuationByte(bytes, index + 1);
      const third = continuationByte(bytes, index + 2);
      const fourth = continuationByte(bytes, index + 3);
      if (
        (first === 0xf0 && second < 0x90) ||
        (first === 0xf4 && second > 0x8f)
      ) {
        invalidUtf8();
      }
      appendCodePoint(
        ((first & 0x07) << 18) |
          ((second & 0x3f) << 12) |
          ((third & 0x3f) << 6) |
          (fourth & 0x3f),
      );
      index += 4;
      continue;
    }

    invalidUtf8();
  }

  flush();
  return decodedChunks.join('');
}

export function decodeUtf8(bytes: Uint8Array): string {
  const TextDecoderConstructor = globalThis.TextDecoder;
  if (typeof TextDecoderConstructor === 'function') {
    return new TextDecoderConstructor('utf-8', {fatal: true}).decode(bytes);
  }
  return decodeUtf8Manually(bytes);
}
