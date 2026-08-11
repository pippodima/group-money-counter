/**
 * Test-data builders.
 *
 * Lives outside src/core deliberately: the purity guard scans everything in
 * core, and this file exists to generate randomness.
 *
 * `arbLedger` produces *valid* ledgers by construction — payer amounts and
 * exact splits are built with `apportion`, so they always sum to the total.
 * That matters: the properties under test are about arithmetic holding up
 * across arbitrary ledgers, not about the fold coping with malformed input.
 */

import fc from 'fast-check';
import { apportion } from '../core/apportion.js';
import { type Envelope, type Event, envelopeId } from '../core/events.js';
import { type Hlc, encodeHlc, hlcReceive, hlcSend, initialHlc, decodeHlc } from '../core/hlc.js';
import type { ExpenseFields, MemberId, Split } from '../core/types.js';

export const GROUP_ID = 'g1';

/** A device authoring events, with its own clock and sequence counter. */
export class TestDevice {
  private clock: Hlc;
  private seq = 0;

  constructor(
    readonly deviceId: string,
    private wall = 1_700_000_000_000,
    readonly groupId = GROUP_ID,
  ) {
    this.clock = initialHlc(deviceId);
  }

  /** Stamps and returns a new event. */
  emit(body: Event): Envelope {
    this.wall += 1;
    this.clock = hlcSend(this.clock, this.wall);
    return {
      id: envelopeId(this.deviceId, this.seq++),
      hlc: encodeHlc(this.clock),
      groupId: this.groupId,
      body,
    };
  }

  /** Advances this device's clock past an event learned from elsewhere. */
  observe(envelope: Envelope): void {
    this.clock = hlcReceive(this.clock, decodeHlc(envelope.hlc), this.wall);
  }

  /** Simulates a clock that disagrees with the other device's. */
  skew(milliseconds: number): void {
    this.wall += milliseconds;
  }
}

export const memberId = (index: number): MemberId => `m${index}`;

// ------------------------------------------------------------- generators

interface ExpenseSpec {
  totalCents: number;
  payers: number[];
  payerWeights: number[];
  splitKind: number;
  participants: number[];
  weights: number[];
}

interface SettlementSpec {
  from: number;
  to: number;
  amountCents: number;
}

export interface LedgerSpec {
  memberCount: number;
  expenses: ExpenseSpec[];
  settlements: SettlementSpec[];
}

const arbExpenseSpec = (memberCount: number) =>
  fc.record({
    totalCents: fc.integer({ min: 1, max: 500_000 }),
    payers: fc.uniqueArray(fc.integer({ min: 0, max: memberCount - 1 }), {
      minLength: 1,
      maxLength: Math.min(3, memberCount),
    }),
    payerWeights: fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 3, maxLength: 3 }),
    splitKind: fc.integer({ min: 0, max: 2 }),
    participants: fc.uniqueArray(fc.integer({ min: 0, max: memberCount - 1 }), {
      minLength: 1,
      maxLength: memberCount,
    }),
    weights: fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 8, maxLength: 8 }),
  });

const arbSettlementSpec = (memberCount: number) =>
  fc.record({
    from: fc.integer({ min: 0, max: memberCount - 1 }),
    to: fc.integer({ min: 0, max: memberCount - 1 }),
    amountCents: fc.integer({ min: 1, max: 200_000 }),
  });

export const arbLedgerSpec: fc.Arbitrary<LedgerSpec> = fc
  .integer({ min: 2, max: 6 })
  .chain((memberCount) =>
    fc.record({
      memberCount: fc.constant(memberCount),
      expenses: fc.array(arbExpenseSpec(memberCount), { maxLength: 12 }),
      settlements: fc.array(arbSettlementSpec(memberCount), { maxLength: 5 }),
    }),
  );

// ----------------------------------------------------------------- builder

function buildSplit(spec: ExpenseSpec): Split {
  const participants = spec.participants.map(memberId);

  if (spec.splitKind === 0) {
    return { mode: 'equal', among: participants };
  }

  // A participant may legitimately carry zero weight, but they cannot all be
  // zero — fall back to an even split rather than generating invalid input.
  const raw = participants.map((_, i) => spec.weights[i % spec.weights.length] ?? 1);
  const weights = raw.some((weight) => weight > 0) ? raw : participants.map(() => 1);

  if (spec.splitKind === 1) {
    return {
      mode: 'weights',
      weights: Object.fromEntries(participants.map((id, i) => [id, weights[i] as number])),
      display: 'shares',
    };
  }

  const exact = apportion(
    spec.totalCents,
    participants.map((id, i) => [id, weights[i] as number] as const),
  );
  return { mode: 'exact', amounts: Object.fromEntries(exact) };
}

function buildExpense(spec: ExpenseSpec): ExpenseFields {
  const payerIds = spec.payers.map(memberId);
  const contributions = apportion(
    spec.totalCents,
    payerIds.map((id, i) => [id, spec.payerWeights[i % spec.payerWeights.length] as number] as const),
  );

  return {
    description: `expense ${spec.totalCents}`,
    totalCents: spec.totalCents,
    date: '2026-08-11',
    payers: payerIds.map((id) => ({ memberId: id, amountCents: contributions.get(id) as number })),
    split: buildSplit(spec),
  };
}

/** Turns a generated spec into a complete, valid event log. */
export function buildLog(spec: LedgerSpec, deviceId = 'aaaa'): Envelope[] {
  const device = new TestDevice(deviceId);
  const log: Envelope[] = [device.emit({ t: 'group.init', name: 'Trip', currency: 'EUR' })];

  for (let i = 0; i < spec.memberCount; i++) {
    log.push(device.emit({ t: 'member.add', memberId: memberId(i), name: `Member ${i}` }));
  }

  spec.expenses.forEach((expense, i) => {
    log.push(
      device.emit({ t: 'expense.create', expenseId: `e${i}`, fields: buildExpense(expense) }),
    );
  });

  spec.settlements.forEach((settlement, i) => {
    if (settlement.from === settlement.to) return;
    log.push(
      device.emit({
        t: 'settlement.create',
        settlementId: `s${i}`,
        fields: {
          fromMemberId: memberId(settlement.from),
          toMemberId: memberId(settlement.to),
          amountCents: settlement.amountCents,
          date: '2026-08-11',
          note: '',
        },
      }),
    );
  });

  return log;
}

export const arbLog: fc.Arbitrary<Envelope[]> = arbLedgerSpec.map((spec) => buildLog(spec));
