/**
 * Turning balances into a list of payments (DESIGN.md §6).
 *
 * Two modes, because groups genuinely disagree about which they want:
 *
 *   simplify()  — fewest transfers overall. You may be told to pay someone
 *                 you never transacted with.
 *   pairwise()  — pay back the person who actually paid. More transfers,
 *                 but every one of them is traceable to a real expense.
 */

import type { Balances } from './balances.js';
import { expenseShares } from './split.js';
import type { Cents, LedgerState, MemberId } from './types.js';

export interface Transfer {
  /** The person handing money over. */
  from: MemberId;
  to: MemberId;
  amountCents: Cents;
}

function sortTransfers(transfers: Transfer[]): Transfer[] {
  return transfers.sort(
    (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) || (a.to < b.to ? -1 : 1),
  );
}

/**
 * Fewest payments that clear every balance.
 *
 * Greedy: repeatedly match the largest creditor with the largest debtor.
 * Produces at most n−1 transfers.
 *
 * Minimising exactly is NP-hard — it reduces to subset-sum — and greedy lands
 * within a transfer or two in practice. This note exists so nobody spends a
 * weekend "fixing" it.
 */
export function simplify(net: Balances): Transfer[] {
  const creditors = [...net]
    .filter(([, amount]) => amount > 0)
    .sort(([aId, a], [bId, b]) => b - a || (aId < bId ? -1 : 1))
    .map(([memberId, amount]) => ({ memberId, amount }));

  const debtors = [...net]
    .filter(([, amount]) => amount < 0)
    .sort(([aId, a], [bId, b]) => a - b || (aId < bId ? -1 : 1))
    .map(([memberId, amount]) => ({ memberId, amount: -amount }));

  const transfers: Transfer[] = [];
  let c = 0;
  let d = 0;

  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c] as { memberId: MemberId; amount: Cents };
    const debtor = debtors[d] as { memberId: MemberId; amount: Cents };

    const amountCents = Math.min(creditor.amount, debtor.amount);
    if (amountCents > 0) {
      transfers.push({ from: debtor.memberId, to: creditor.memberId, amountCents });
    }

    creditor.amount -= amountCents;
    debtor.amount -= amountCents;
    if (creditor.amount === 0) c++;
    if (debtor.amount === 0) d++;
  }

  return sortTransfers(transfers);
}

/**
 * Who owes whom, straight from the expenses, with no transitive shortcuts.
 *
 * Each expense is settled on its own terms: within a single expense the
 * amounts paid and the shares owed both sum to the total, so the members'
 * net positions sum to exactly zero and can be cleared with whole cents. The
 * resulting debts are then accumulated, and opposing debts between the same
 * two people cancel — but nothing is ever routed through a third party.
 *
 * Settling per expense rather than per member is what keeps this exact. An
 * earlier version apportioned each debtor's share back across the payers
 * independently; those separate roundings did not add up to what each payer
 * had actually contributed, and the plan came out a cent short of the
 * balances it was supposed to clear.
 */
export function pairwise(state: LedgerState): Transfer[] {
  /** owed.get(debtor)?.get(creditor) */
  const owed = new Map<MemberId, Map<MemberId, Cents>>();

  const add = (debtor: MemberId, creditor: MemberId, amount: Cents): void => {
    if (debtor === creditor || amount === 0) return;
    const row = owed.get(debtor) ?? new Map<MemberId, Cents>();
    row.set(creditor, (row.get(creditor) ?? 0) + amount);
    owed.set(debtor, row);
  };

  for (const expense of state.expenses) {
    if (expense.deleted) continue;

    const within: Balances = new Map();
    const shift = (memberId: MemberId, delta: Cents): void => {
      within.set(memberId, (within.get(memberId) ?? 0) + delta);
    };

    for (const payer of expense.payers) shift(payer.memberId, payer.amountCents);
    for (const [memberId, share] of expenseShares(expense)) shift(memberId, -share);

    for (const transfer of simplify(within)) {
      add(transfer.from, transfer.to, transfer.amountCents);
    }
  }

  for (const settlement of state.settlements) {
    if (settlement.deleted) continue;
    // Paying someone reduces what you owe them.
    add(settlement.fromMemberId, settlement.toMemberId, -settlement.amountCents);
  }

  // Net each pair against each other, but go no further.
  const members = [...new Set([...owed.keys(), ...[...owed.values()].flatMap((r) => [...r.keys()])])].sort();
  const transfers: Transfer[] = [];

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i] as MemberId;
      const b = members[j] as MemberId;
      const net = (owed.get(a)?.get(b) ?? 0) - (owed.get(b)?.get(a) ?? 0);
      if (net > 0) transfers.push({ from: a, to: b, amountCents: net });
      else if (net < 0) transfers.push({ from: b, to: a, amountCents: -net });
    }
  }

  return sortTransfers(transfers);
}

/** Applies a settlement plan to a set of balances. Used to prove a plan clears. */
export function applyTransfers(net: Balances, transfers: readonly Transfer[]): Balances {
  const result = new Map(net);
  for (const transfer of transfers) {
    result.set(transfer.from, (result.get(transfer.from) ?? 0) + transfer.amountCents);
    result.set(transfer.to, (result.get(transfer.to) ?? 0) - transfer.amountCents);
  }
  return result;
}
