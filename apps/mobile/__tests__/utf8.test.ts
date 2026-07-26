import {decodeUtf8} from '../src/utils/utf8';

function withoutTextDecoder<T>(run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'TextDecoder',
  );
  Reflect.deleteProperty(globalThis, 'TextDecoder');

  try {
    return run();
  } finally {
    if (descriptor !== undefined) {
      Object.defineProperty(globalThis, 'TextDecoder', descriptor);
    }
  }
}

function withTextDecoder<T>(
  TextDecoderConstructor: typeof TextDecoder,
  run: () => T,
): T {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'TextDecoder',
  );
  Object.defineProperty(globalThis, 'TextDecoder', {
    configurable: true,
    value: TextDecoderConstructor,
  });

  try {
    return run();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, 'TextDecoder');
    } else {
      Object.defineProperty(globalThis, 'TextDecoder', descriptor);
    }
  }
}

describe('decodeUtf8', () => {
  it.each([
    ['ASCII JSON', '{"samples":[]}'],
    ['Korean', '수심 프로파일'],
    ['supplementary Unicode', '다이빙 🌊'],
  ])(
    'decodes %s without a global TextDecoder',
    (_description, expected) => {
      const bytes = new TextEncoder().encode(expected);

      expect(withoutTextDecoder(() => decodeUtf8(bytes))).toBe(expected);
    },
  );

  it('decodes a large profile without a global TextDecoder', () => {
    const expected = '수심🌊'.repeat(5_000);
    const bytes = new TextEncoder().encode(expected);

    expect(withoutTextDecoder(() => decodeUtf8(bytes))).toBe(expected);
  });

  it('strips one leading UTF-8 BOM without a global TextDecoder', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);

    expect(withoutTextDecoder(() => decodeUtf8(bytes))).toBe('{}');
  });

  it('preserves a second leading UTF-8 BOM without a global TextDecoder', () => {
    const bytes = Uint8Array.from([
      0xef,
      0xbb,
      0xbf,
      0xef,
      0xbb,
      0xbf,
      0x7b,
      0x7d,
    ]);

    expect(withoutTextDecoder(() => decodeUtf8(bytes))).toBe('\ufeff{}');
  });

  it.each([
    ['the minimum valid two-byte scalar', [0xc2, 0x80], '\u0080'],
    [
      'the maximum valid Unicode scalar',
      [0xf4, 0x8f, 0xbf, 0xbf],
      '\u{10ffff}',
    ],
  ])(
    'decodes %s without a global TextDecoder',
    (_description, bytes, expected) => {
      expect(
        withoutTextDecoder(() => decodeUtf8(Uint8Array.from(bytes))),
      ).toBe(expected);
    },
  );

  it.each([
    ['invalid continuation byte', [0x80]],
    ['invalid in-sequence continuation byte', [0xe2, 0x28, 0xa1]],
    ['overlong two-byte sequence', [0xc0, 0x80]],
    ['overlong three-byte sequence', [0xe0, 0x9f, 0xbf]],
    ['overlong four-byte sequence', [0xf0, 0x8f, 0xbf, 0xbf]],
    ['truncated sequence', [0xe2, 0x82]],
    ['UTF-16 surrogate code point', [0xed, 0xa0, 0x80]],
    ['code point above U+10FFFF', [0xf4, 0x90, 0x80, 0x80]],
  ])('rejects %s without a global TextDecoder', (_description, bytes) => {
    expect(() =>
      withoutTextDecoder(() => decodeUtf8(Uint8Array.from(bytes))),
    ).toThrow();
  });

  it('uses a fatal UTF-8 TextDecoder when one is available', () => {
    const decode = jest.fn(() => 'decoded');
    const TextDecoderConstructor = jest.fn(
      (label: string, options: {fatal?: boolean}) => {
        expect(label).toBe('utf-8');
        expect(options).toEqual({fatal: true});
        return {decode};
      },
    ) as unknown as typeof TextDecoder;
    const bytes = Uint8Array.from([0x7b, 0x7d]);

    expect(
      withTextDecoder(TextDecoderConstructor, () => decodeUtf8(bytes)),
    ).toBe('decoded');
    expect(TextDecoderConstructor).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledWith(bytes);
  });
});
