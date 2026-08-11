/**
 * The domain model (DESIGN.md §2).
 *
 * All money is integer cents. There is no floating point anywhere in this
 * layer — see `apportion.ts` for the one place ratios are computed, and how
 * the result is forced back onto exact integers.
 */

/** Integer cents. Never a fraction, never negative for a total. */
export type Cents = number;

export type GroupId = string;
export type MemberId = string;
export type ExpenseId = string;
export type SettlementId = string;
export type DeviceId = string;

/**
 * A calendar day, `YYYY-MM-DD`.
 *
 * Deliberately not a timestamp: an expense entered at 00:30 in Rome would
 * otherwise land on the previous day for a phone set to London, and the two
 * devices would disagree about which day the dinner happened. Days are what
 * people reason about, so days are what gets stored.
 */
export type Day = string;

export interface GroupInfo {
  id: GroupId;
  name: string;
  /** ISO 4217. Fixed per group in v1. */
  currency: string;
}

export interface Member {
  id: MemberId;
  name: string;
  /**
   * Members are deactivated, never removed. An expense referencing a member
   * that no longer exists is a corrupt ledger, so history always keeps them.
   */
  active: boolean;
}

export interface Payer {
  memberId: MemberId;
  amountCents: Cents;
}

/**
 * How an expense is divided.
 *
 * `percent` is not a storage mode: percentages are weights that happen to sum
 * to 100, so they share the `weights` path and carry a display hint. One code
 * path computes every proportional split, and 33.33% never round-trips
 * through a lossy representation.
 */
export type Split =
  | { mode: 'equal'; among: readonly MemberId[] }
  | {
      mode: 'weights';
      weights: Readonly<Record<MemberId, number>>;
      display: 'shares' | 'percent';
    }
  | { mode: 'exact'; amounts: Readonly<Record<MemberId, Cents>> };

export interface ExpenseFields {
  description: string;
  totalCents: Cents;
  date: Day;
  /** Amounts must sum to `totalCents`. Usually a single payer. */
  payers: readonly Payer[];
  split: Split;
}

export interface Expense extends ExpenseFields {
  id: ExpenseId;
  /** The device that first entered it. Used for duplicate detection (§8). */
  createdBy: DeviceId;
  deleted: boolean;
}

export interface SettlementFields {
  /** The person handing money over. */
  fromMemberId: MemberId;
  toMemberId: MemberId;
  amountCents: Cents;
  date: Day;
  note: string;
}

export interface Settlement extends SettlementFields {
  id: SettlementId;
  deleted: boolean;
}

/**
 * The result of folding an event log.
 *
 * Every collection is sorted by id — a replicated key — so that two devices
 * holding the same events produce byte-identical state. Display ordering is a
 * view concern and belongs elsewhere.
 */
export interface LedgerState {
  group: GroupInfo | undefined;
  members: readonly Member[];
  expenses: readonly Expense[];
  settlements: readonly Settlement[];
}

export const EMPTY_STATE: LedgerState = {
  group: undefined,
  members: [],
  expenses: [],
  settlements: [],
};
