import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decodeBase45, encodeBase45 } from './base45.js';

describe('base45', () => {
  it('matches the examples in RFC 9285', () => {
    expect(encodeBase45(new TextEncoder().encode('AB'))).toBe('BB8');
    expect(encodeBase45(new TextEncoder().encode('Hello!!'))).toBe('%69 VD92EX0');
    expect(encodeBase45(new TextEncoder().encode('base-45'))).toBe('UJCLQE7W581');
  });

  it('round-trips any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 3000 }), (bytes) => {
        expect(decodeBase45(encodeBase45(bytes))).toEqual(bytes);
      }),
    );
  });

  it('only ever emits characters QR can pack as alphanumeric', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 500 }), (bytes) => {
        expect(encodeBase45(bytes)).toMatch(/^[0-9A-Z $%*+\-./:]*$/);
      }),
    );
  });

  it('costs about 50% in characters, which QR packs back down', () => {
    // 2 bytes -> 3 chars, and alphanumeric mode spends 5.5 bits per char.
    const bytes = new Uint8Array(1000);
    expect(encodeBase45(bytes)).toHaveLength(1500);
  });

  it('handles the empty and single-byte cases', () => {
    expect(encodeBase45(new Uint8Array())).toBe('');
    expect(decodeBase45('')).toEqual(new Uint8Array());
    expect(decodeBase45(encodeBase45(Uint8Array.of(0)))).toEqual(Uint8Array.of(0));
    expect(decodeBase45(encodeBase45(Uint8Array.of(255)))).toEqual(Uint8Array.of(255));
  });

  it('rejects text it could not have produced', () => {
    expect(decodeBase45('a')).toBeUndefined();
    expect(decodeBase45('!!!')).toBeUndefined();
    expect(decodeBase45('BB8B')).toBeUndefined();
    expect(decodeBase45('ZZZ')).toBeUndefined();
    expect(decodeBase45('~~')).toBeUndefined();
  });
});
