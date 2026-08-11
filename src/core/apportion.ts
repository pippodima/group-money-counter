/**
 * Dividing an amount by weights, exactly (DESIGN.md §5).
 *
 * €10 split three ways must produce 3.34 / 3.33 / 3.33 — summing to exactly
 * 1000 cents, with the *same* person getting the extra cent on every device.
 * The largest remainder method gives both properties.
 */

import type { Cents, MemberId } from './types.js';

export type WeightEntry = readonly [MemberId, number];

/**
 * Splits `total` cents across weighted members.
 *
 * The result always sums to exactly `total`: base shares are floored, and the
 * leftover cents are handed out one at a time to the largest fractional
 * remainders.
 *
 * Ties break on `memberId`, and that is not cosmetic. Two members with equal
 * weights have identical fractional parts; without a replicated tiebreak the
 * spare cent would land on whoever happened to sort first in *that device's*
 * array, and the two ledgers would drift apart with nothing to signal it
 * (DESIGN.md §4).
 */
export function apportion(total: Cents, entries: readonly WeightEntry[]): Map<MemberId, Cents> {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError(`total must be a non-negative integer of cents: ${total}`);
  }
  if (entries.length === 0) {
    throw new RangeError('cannot apportion across nobody');
  }

  const seen = new Set<MemberId>();
  let totalWeight = 0;
  for (const [memberId, weight] of entries) {
    if (seen.has(memberId)) throw new RangeError(`duplicate member in split: ${memberId}`);
    seen.add(memberId);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`weight must be finite and non-negative: ${memberId}=${weight}`);
    }
    totalWeight += weight;
  }
  if (totalWeight <= 0) {
    throw new RangeError('weights must sum to a positive number');
  }

  // Canonical input order, so the arithmetic below cannot depend on how the
  // caller happened to build the array.
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const rows = sorted.map(([memberId, weight]) => {
    const exact = (total * weight) / totalWeight;
    const base = Math.floor(exact);
    return { memberId, weight, base, frac: exact - base };
  });

  let remainder = total - rows.reduce((sum, row) => sum + row.base, 0);

  // Zero-weight members are excluded from the leftover: someone assigned no
  // share should never be handed a stray cent.
  const eligible = rows
    .filter((row) => row.weight > 0)
    .sort((a, b) => b.frac - a.frac || (a.memberId < b.memberId ? -1 : 1));

  for (let i = 0; i < remainder && i < eligible.length; i++) {
    (eligible[i] as { base: number }).base++;
  }

  return new Map(rows.map((row) => [row.memberId, row.base]));
}

/** Equal weights for everyone named. The common case. */
export function equalWeights(members: readonly MemberId[]): WeightEntry[] {
  return members.map((memberId) => [memberId, 1] as const);
}
