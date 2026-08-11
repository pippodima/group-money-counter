import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { apportion, equalWeights, type WeightEntry } from './apportion.js';

const sum = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0);

const arbEntries = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 8 })
  .chain((ids) =>
    fc
      .array(fc.integer({ min: 0, max: 20 }), { minLength: ids.length, maxLength: ids.length })
      .filter((weights) => weights.some((weight) => weight > 0))
      .map((weights) => ids.map((id, i) => [id, weights[i]] as WeightEntry)),
  );

describe('apportion', () => {
  it('splits 10.00 three ways as 3.34 / 3.33 / 3.33', () => {
    const shares = apportion(1000, equalWeights(['a', 'b', 'c']));
    expect([...shares.values()]).toEqual([334, 333, 333]);
    expect(shares.get('a')).toBe(334);
  });

  it('never invents or loses a cent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), arbEntries, (total, entries) => {
        expect(sum(apportion(total, entries).values())).toBe(total);
      }),
    );
  });

  it('gives the same answer whatever order the members arrive in', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        arbEntries,
        fc.integer(),
        (total, entries, seed) => {
          // Deterministic reshuffle driven by the generated seed.
          const shuffled = [...entries].sort(
            (a, b) =>
              ((seed + a[0].charCodeAt(0)) % 7) - ((seed + b[0].charCodeAt(0)) % 7) ||
              (a[0] < b[0] ? 1 : -1),
          );
          expect([...apportion(total, shuffled)]).toEqual([...apportion(total, entries)]);
        },
      ),
    );
  });

  it('shares out remainders as evenly as it can', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), arbEntries, (total, entries) => {
        const shares = apportion(total, entries);
        const totalWeight = sum(entries.map(([, weight]) => weight));

        // Nobody is off their exact share by a whole cent or more. Compared
        // by member id, not position: apportion returns members in canonical
        // sorted order, which is not the order they were passed in.
        for (const [memberId, weight] of entries) {
          const exact = (total * weight) / totalWeight;
          expect(Math.abs((shares.get(memberId) as number) - exact)).toBeLessThan(1);
        }
      }),
    );
  });

  it('gives nothing to a member weighted zero, including leftovers', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (total) => {
        const shares = apportion(total, [
          ['a', 1],
          ['b', 1],
          ['c', 1],
          ['zero', 0],
        ]);
        expect(shares.get('zero')).toBe(0);
        expect(sum(shares.values())).toBe(total);
      }),
    );
  });

  it('handles a single member taking everything', () => {
    expect(apportion(777, [['solo', 3]])).toEqual(new Map([['solo', 777]]));
  });

  it('handles fractional weights', () => {
    // Two adults and a child at half a share.
    const shares = apportion(1000, [
      ['adultA', 1],
      ['adultB', 1],
      ['child', 0.5],
    ]);
    expect(sum(shares.values())).toBe(1000);
    expect(shares.get('child')).toBe(200);
  });

  it('rejects input it cannot divide honestly', () => {
    expect(() => apportion(100, [])).toThrow(RangeError);
    expect(() => apportion(100, [['a', 0]])).toThrow(/positive/);
    expect(() => apportion(100, [['a', -1]])).toThrow(/non-negative/);
    expect(() => apportion(100, [['a', Number.NaN]])).toThrow(/finite/);
    expect(() => apportion(-1, [['a', 1]])).toThrow(/non-negative/);
    expect(() => apportion(1.5, [['a', 1]])).toThrow(/integer/);
    expect(() =>
      apportion(100, [
        ['a', 1],
        ['a', 1],
      ]),
    ).toThrow(/duplicate/);
  });
});
