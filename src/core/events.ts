/**
 * The event log (DESIGN.md §3).
 *
 * Nothing mutates state directly. Every change appends an immutable event,
 * and state is a pure fold over the sorted log — which is what makes merging
 * two phones a set union rather than a conflict-resolution problem.
 */

import type { HlcString } from './hlc.js';
import type {
  DeviceId,
  ExpenseFields,
  ExpenseId,
  GroupId,
  MemberId,
  SettlementFields,
  SettlementId,
} from './types.js';

export type Event =
  | { t: 'group.init'; name: string; currency: string }
  | { t: 'group.rename'; name: string }
  | { t: 'member.add'; memberId: MemberId; name: string }
  | { t: 'member.rename'; memberId: MemberId; name: string }
  | { t: 'member.deactivate'; memberId: MemberId }
  | { t: 'member.reactivate'; memberId: MemberId }
  | { t: 'expense.create'; expenseId: ExpenseId; fields: ExpenseFields }
  | { t: 'expense.update'; expenseId: ExpenseId; patch: Partial<ExpenseFields> }
  | { t: 'expense.delete'; expenseId: ExpenseId }
  | { t: 'settlement.create'; settlementId: SettlementId; fields: SettlementFields }
  | { t: 'settlement.update'; settlementId: SettlementId; patch: Partial<SettlementFields> }
  | { t: 'settlement.delete'; settlementId: SettlementId };

export interface Envelope {
  /**
   * `${deviceId}:${seq}` — unique across devices without any coordination,
   * which is what lets merge be a plain union keyed on this field.
   */
  id: string;
  hlc: HlcString;
  groupId: GroupId;
  body: Event;
}

const ENVELOPE_ID = /^([0-9a-f]{1,32}):(\d+)$/;

export function envelopeId(deviceId: DeviceId, seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new RangeError(`sequence must be a non-negative integer: ${seq}`);
  }
  return `${deviceId}:${seq}`;
}

export function parseEnvelopeId(id: string): { deviceId: DeviceId; seq: number } {
  const match = ENVELOPE_ID.exec(id);
  if (!match) throw new SyntaxError(`malformed envelope id: ${id}`);
  return { deviceId: match[1] as string, seq: Number(match[2]) };
}

/** The device that authored an event, read straight off its id. */
export function authorOf(envelope: Envelope): DeviceId {
  return parseEnvelopeId(envelope.id).deviceId;
}

/**
 * The next free sequence number for a device.
 *
 * Derived from the log rather than stored separately, so there is no counter
 * that can drift out of step with the events it is supposed to describe.
 */
export function nextSeq(envelopes: readonly Envelope[], deviceId: DeviceId): number {
  let highest = -1;
  for (const envelope of envelopes) {
    const match = ENVELOPE_ID.exec(envelope.id);
    if (match?.[1] === deviceId) highest = Math.max(highest, Number(match[2]));
  }
  return highest + 1;
}

/**
 * Merges event logs.
 *
 * Events are immutable, so two envelopes sharing an id are identical and
 * there is nothing to compare. The first copy seen wins, which means a
 * corrupted incoming duplicate can never displace a good local one.
 *
 * Idempotent, commutative and associative — sync in any direction, any number
 * of times, in any order.
 */
export function mergeEnvelopes(...logs: readonly (readonly Envelope[])[]): Envelope[] {
  const byId = new Map<string, Envelope>();
  for (const log of logs) {
    for (const envelope of log) {
      if (!byId.has(envelope.id)) byId.set(envelope.id, envelope);
    }
  }
  return sortEnvelopes([...byId.values()]);
}

/**
 * Total order over a log.
 *
 * HLC alone is enough — its node component makes ties impossible between
 * devices — but the envelope id is used as a final tiebreak so that a
 * hand-written or corrupted log still folds deterministically rather than
 * depending on the input array's order.
 */
export function sortEnvelopes(envelopes: readonly Envelope[]): Envelope[] {
  return [...envelopes].sort((a, b) =>
    a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}
