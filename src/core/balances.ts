/**
 * Who is up and who is down (DESIGN.md §6).
 *
 *     net = everything you paid − everything you owe
 *
 * Positive means the group owes you. Negative means you owe the group. The
 * sum across all members is always exactly zero, which is a cheap assertion
 * that catches almost every arithmetic bug the moment it appears.
 */

import { expenseShares } from './split.js';
import type { Cents, LedgerState, MemberId } from './types.js';

export type Balances = Map<MemberId, Cents>;

function add(balances: Balances, memberId: MemberId, delta: Cents): void {
  balances.set(memberId, (balances.get(memberId) ?? 0) + delta);
}

/**
 * Net position per member.
 *
 * Every known member appears, including inactive ones and those with a zero
 * balance, so callers never have to distinguish "settled up" from "not in the
 * ledger". Iteration order follows `state.members`, which is sorted by id.
 */
export function balances(state: LedgerState): Balances {
  const net: Balances = new Map(state.members.map((member) => [member.id, 0]));

  for (const expense of state.expenses) {
    if (expense.deleted) continue;

    for (const payer of expense.payers) {
      add(net, payer.memberId, payer.amountCents);
    }
    for (const [memberId, share] of expenseShares(expense)) {
      add(net, memberId, -share);
    }
  }

  for (const settlement of state.settlements) {
    if (settlement.deleted) continue;

    // Handing money over settles what you owed: the payer's position rises,
    // the recipient's falls.
    add(net, settlement.fromMemberId, settlement.amountCents);
    add(net, settlement.toMemberId, -settlement.amountCents);
  }

  return net;
}

/** Total spend, ignoring settlements — settlements move money, they don't spend it. */
export function totalSpend(state: LedgerState): Cents {
  return state.expenses.reduce(
    (total, expense) => (expense.deleted ? total : total + expense.totalCents),
    0,
  );
}

/** What a single member has paid out across all live expenses. */
export function paidBy(state: LedgerState, memberId: MemberId): Cents {
  let total = 0;
  for (const expense of state.expenses) {
    if (expense.deleted) continue;
    for (const payer of expense.payers) {
      if (payer.memberId === memberId) total += payer.amountCents;
    }
  }
  return total;
}
