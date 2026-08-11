import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { participantsOf, sharesOf } from './split.js';
import { arbLog } from '../testing/ledger.js';
import { fold } from './fold.js';
import { expenseShares } from './split.js';

const sum = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0);

describe('sharesOf', () => {
  it('divides an equal split evenly, cent for cent', () => {
    expect([...sharesOf(1000, { mode: 'equal', among: ['a', 'b', 'c'] })]).toEqual([
      ['a', 334],
      ['b', 333],
      ['c', 333],
    ]);
  });

  it('weights a split by shares', () => {
    // A couple counting as two, a single person as one.
    const shares = sharesOf(3000, {
      mode: 'weights',
      weights: { couple: 2, single: 1 },
      display: 'shares',
    });
    expect(shares.get('couple')).toBe(2000);
    expect(shares.get('single')).toBe(1000);
  });

  it('treats percentages as weights', () => {
    const shares = sharesOf(1000, {
      mode: 'weights',
      weights: { a: 33.33, b: 33.33, c: 33.34 },
      display: 'percent',
    });
    expect(sum(shares.values())).toBe(1000);
  });

  it('uses exact amounts untouched', () => {
    const shares = sharesOf(1000, { mode: 'exact', amounts: { a: 700, b: 300 } });
    expect(shares.get('a')).toBe(700);
    expect(shares.get('b')).toBe(300);
  });

  it('refuses an exact split that does not add up', () => {
    // Caught at entry by validate.ts; this is the backstop that keeps the
    // fold from ever producing balances that silently fail to reconcile.
    expect(() => sharesOf(1000, { mode: 'exact', amounts: { a: 700, b: 200 } })).toThrow(
      /sums to 900, expected 1000/,
    );
  });

  it('always divides the whole total and no more', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        for (const expense of fold(log).expenses) {
          expect(sum(expenseShares(expense).values())).toBe(expense.totalCents);
        }
      }),
    );
  });
});

describe('participantsOf', () => {
  it('lists everyone in the split, in a stable order', () => {
    expect(participantsOf({ mode: 'equal', among: ['c', 'a', 'b'] })).toEqual(['a', 'b', 'c']);
    expect(
      participantsOf({ mode: 'weights', weights: { z: 1, a: 2 }, display: 'shares' }),
    ).toEqual(['a', 'z']);
    expect(participantsOf({ mode: 'exact', amounts: { b: 1, a: 2 } })).toEqual(['a', 'b']);
  });
});
