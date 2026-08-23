import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ALL_HUES, hueFor } from './palette.js';

/** Group ids as the app actually mints them: 16 lowercase hex characters. */
const arbGroupId = fc
  .array(fc.constantFrom(...'0123456789abcdef'), { minLength: 16, maxLength: 16 })
  .map((characters) => characters.join(''));

describe('hueFor', () => {
  it('is stable, so both phones agree on a group\'s colour', () => {
    fc.assert(
      fc.property(arbGroupId, (id) => {
        expect(hueFor(id)).toBe(hueFor(id));
      }),
    );
  });

  it('only ever returns a hue from the palette', () => {
    fc.assert(
      fc.property(arbGroupId, (id) => {
        expect(ALL_HUES).toContain(hueFor(id));
      }),
    );
  });

  it('spreads groups across the palette rather than piling them on one colour', () => {
    // The regression this exists for: the first version used float64
    // multiplication in FNV, losing the low bits that `% 8` reads. 44% of all
    // ids came out green and two hues took three quarters between them.
    const counts = new Map<number, number>(ALL_HUES.map((hue) => [hue, 0]));

    const sample = 8000;
    for (let i = 0; i < sample; i++) {
      const id = i.toString(16).padStart(16, '0');
      counts.set(hueFor(id), (counts.get(hueFor(id)) as number) + 1);
    }

    const share = [...counts.values()].map((count) => count / sample);
    const even = 1 / ALL_HUES.length;

    // Every colour gets used, and none takes more than double its fair share.
    expect(Math.min(...share)).toBeGreaterThan(even * 0.5);
    expect(Math.max(...share)).toBeLessThan(even * 2);
  });

  it('gives neighbouring ids different colours', () => {
    // Ids minted seconds apart should not look alike.
    const hues = Array.from({ length: 8 }, (_, i) =>
      hueFor(`a91f4c2e8b0d117${i.toString(16)}`),
    );
    expect(new Set(hues).size).toBeGreaterThanOrEqual(4);
  });

  it('falls back to the original green when there is no group', () => {
    expect(hueFor(undefined)).toBe(ALL_HUES[0]);
  });
});
