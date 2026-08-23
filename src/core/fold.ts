/**
 * Replaying an event log into state (DESIGN.md §3).
 *
 * Union the events, sort by HLC, replay in order. Because the log is replayed
 * in clock order, last-writer-wins falls out for free — there is no need for a
 * per-field clock, and no CRDT library.
 *
 * This function must be a pure function of the event *set*: fold the same
 * events in any order and the result is byte-identical. `purity.test.ts`
 * enforces the absence of ambient reads; `fold.test.ts` checks the property
 * directly by shuffling.
 */

import { authorOf, mergeEnvelopes, type Envelope } from './events.js';
import {
  EMPTY_STATE,
  type Expense,
  type ExpenseId,
  type GroupId,
  type GroupInfo,
  type LedgerState,
  type Member,
  type MemberId,
  type Settlement,
  type SettlementId,
} from './types.js';

/**
 * Applies a partial update, ignoring keys explicitly set to undefined.
 *
 * `NoInfer` on the patch keeps the shape pinned to the base being updated: an
 * `expense.update` carries `Partial<ExpenseFields>` while the stored row is an
 * `Expense`, and without it TypeScript tries to satisfy both and settles on
 * the narrower one.
 */
function patched<T extends object>(base: T, patch: Partial<NoInfer<T>>): T {
  const next = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key] = value;
  }
  return next as T;
}

/**
 * Canonical order: first appearance in the log.
 *
 * Originally this sorted by id, on the reasoning that canonical order must
 * use a replicated key. Insertion order satisfies that just as well — events
 * are replayed in HLC order, which every device agrees on, so the order a Map
 * receives them in is identical everywhere. It is not positional or local.
 *
 * Sorting by id was also actively wrong for the interface: ids are random
 * hex, so members came out shuffled rather than in the order they were added.
 */
function inOrder<T>(items: Iterable<T>): T[] {
  return [...items];
}

/**
 * Folds an event log into ledger state.
 *
 * Pass `groupId` to fold a single group out of a mixed log; omit it when the
 * log is already known to hold exactly one.
 */
export function fold(envelopes: readonly Envelope[], groupId?: GroupId): LedgerState {
  const scoped =
    groupId === undefined ? envelopes : envelopes.filter((e) => e.groupId === groupId);
  if (scoped.length === 0) return EMPTY_STATE;

  const ordered = mergeEnvelopes(scoped);

  let group: GroupInfo | undefined;
  const members = new Map<MemberId, Member>();
  const expenses = new Map<ExpenseId, Expense>();
  const settlements = new Map<SettlementId, Settlement>();

  // Deletion is absorbing: once an id is tombstoned, later creates and
  // updates for it are ignored. Without this, an update stamped after the
  // delete would resurrect the row, and the user would watch something they
  // deleted reappear after a sync — which reads as the app being broken.
  const deadExpenses = new Set<ExpenseId>();
  const deadSettlements = new Set<SettlementId>();

  for (const envelope of ordered) {
    const event = envelope.body;

    switch (event.t) {
      case 'group.init':
        group = { id: envelope.groupId, name: event.name, currency: event.currency };
        break;

      case 'group.rename':
        if (group) group = { ...group, name: event.name };
        break;

      case 'member.add':
        if (!members.has(event.memberId)) {
          members.set(event.memberId, { id: event.memberId, name: event.name, active: true });
        }
        break;

      case 'member.rename': {
        const member = members.get(event.memberId);
        if (member) members.set(event.memberId, { ...member, name: event.name });
        break;
      }

      case 'member.deactivate':
      case 'member.reactivate': {
        const member = members.get(event.memberId);
        if (member) {
          members.set(event.memberId, { ...member, active: event.t === 'member.reactivate' });
        }
        break;
      }

      case 'expense.create':
        if (!deadExpenses.has(event.expenseId) && !expenses.has(event.expenseId)) {
          expenses.set(event.expenseId, {
            ...event.fields,
            id: event.expenseId,
            createdBy: authorOf(envelope),
            deleted: false,
          });
        }
        break;

      case 'expense.update': {
        if (deadExpenses.has(event.expenseId)) break;
        const expense = expenses.get(event.expenseId);
        if (expense) expenses.set(event.expenseId, patched(expense, event.patch));
        break;
      }

      case 'expense.delete': {
        deadExpenses.add(event.expenseId);
        const expense = expenses.get(event.expenseId);
        if (expense) expenses.set(event.expenseId, { ...expense, deleted: true });
        break;
      }

      case 'settlement.create':
        if (!deadSettlements.has(event.settlementId) && !settlements.has(event.settlementId)) {
          settlements.set(event.settlementId, {
            ...event.fields,
            id: event.settlementId,
            deleted: false,
          });
        }
        break;

      case 'settlement.update': {
        if (deadSettlements.has(event.settlementId)) break;
        const settlement = settlements.get(event.settlementId);
        if (settlement) settlements.set(event.settlementId, patched(settlement, event.patch));
        break;
      }

      case 'settlement.delete': {
        deadSettlements.add(event.settlementId);
        const settlement = settlements.get(event.settlementId);
        if (settlement) settlements.set(event.settlementId, { ...settlement, deleted: true });
        break;
      }
    }
  }

  return {
    group,
    members: inOrder(members.values()),
    expenses: inOrder(expenses.values()),
    settlements: inOrder(settlements.values()),
  };
}

/** Every group id appearing in a log, in canonical order. */
export function groupsIn(envelopes: readonly Envelope[]): GroupId[] {
  return [...new Set(envelopes.map((e) => e.groupId))].sort();
}
