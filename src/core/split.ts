/**
 * Turning a split rule into what each person owes (DESIGN.md §5).
 */

import { apportion, equalWeights, type WeightEntry } from './apportion.js';
import type { Cents, Expense, MemberId, Split } from './types.js';

/**
 * What each member owes for an expense.
 *
 * Always sums to exactly `totalCents`. Members not party to the split are
 * absent from the map rather than present with zero.
 */
export function sharesOf(totalCents: Cents, split: Split): Map<MemberId, Cents> {
  switch (split.mode) {
    case 'equal':
      return apportion(totalCents, equalWeights(split.among));

    case 'weights':
      return apportion(totalCents, Object.entries(split.weights) as WeightEntry[]);

    case 'exact': {
      // Nothing to apportion — the amounts are already exact. They are
      // validated at entry time (see validate.ts) rather than adjusted here,
      // so a mismatch surfaces to the person typing it instead of being
      // silently absorbed.
      const amounts = new Map<MemberId, Cents>(Object.entries(split.amounts));
      const sum = [...amounts.values()].reduce((total, amount) => total + amount, 0);
      if (sum !== totalCents) {
        throw new RangeError(`exact split sums to ${sum}, expected ${totalCents}`);
      }
      return amounts;
    }
  }
}

/** Everyone the split touches, in canonical order. */
export function participantsOf(split: Split): MemberId[] {
  const ids =
    split.mode === 'equal'
      ? [...split.among]
      : split.mode === 'weights'
        ? Object.keys(split.weights)
        : Object.keys(split.amounts);
  return ids.sort();
}

/** What each member owes for an expense, or nothing if it was deleted. */
export function expenseShares(expense: Expense): Map<MemberId, Cents> {
  return expense.deleted ? new Map() : sharesOf(expense.totalCents, expense.split);
}
