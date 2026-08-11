import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { balances, paidBy, totalSpend } from './balances.js';
import { fold } from './fold.js';
import { applyTransfers, pairwise, simplify } from './settle.js';
import { TestDevice, arbLog, memberId } from '../testing/ledger.js';
import type { Envelope } from './events.js';

const sum = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0);

/** Anna pays 30.00 for dinner, split evenly between Anna and Marco. */
function dinnerLog(): Envelope[] {
  const device = new TestDevice('aaaa');
  return [
    device.emit({ t: 'group.init', name: 'Trip', currency: 'EUR' }),
    device.emit({ t: 'member.add', memberId: 'm0', name: 'Anna' }),
    device.emit({ t: 'member.add', memberId: 'm1', name: 'Marco' }),
    device.emit({
      t: 'expense.create',
      expenseId: 'e1',
      fields: {
        description: 'Dinner',
        totalCents: 3000,
        date: '2026-08-11',
        payers: [{ memberId: 'm0', amountCents: 3000 }],
        split: { mode: 'equal', among: ['m0', 'm1'] },
      },
    }),
  ];
}

describe('balances', () => {
  it('credits the payer and debits everyone their share', () => {
    const net = balances(fold(dinnerLog()));
    expect(net.get('m0')).toBe(1500);
    expect(net.get('m1')).toBe(-1500);
  });

  it('always nets to zero across the group', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        expect(sum(balances(fold(log)).values())).toBe(0);
      }),
    );
  });

  it('includes members with nothing to their name', () => {
    const device = new TestDevice('aaaa');
    const state = fold([
      device.emit({ t: 'group.init', name: 'Trip', currency: 'EUR' }),
      device.emit({ t: 'member.add', memberId: 'm0', name: 'Anna' }),
    ]);
    expect(balances(state).get('m0')).toBe(0);
  });

  it('ignores deleted expenses', () => {
    const log = dinnerLog();
    const device = new TestDevice('bbbb');
    const net = balances(fold([...log, device.emit({ t: 'expense.delete', expenseId: 'e1' })]));
    expect(net.get('m0')).toBe(0);
    expect(net.get('m1')).toBe(0);
  });

  it('clears the debt when a settlement is recorded', () => {
    const device = new TestDevice('bbbb');
    const settled = [
      ...dinnerLog(),
      device.emit({
        t: 'settlement.create',
        settlementId: 's1',
        fields: {
          fromMemberId: 'm1',
          toMemberId: 'm0',
          amountCents: 1500,
          date: '2026-08-12',
          note: '',
        },
      }),
    ];

    const net = balances(fold(settled));
    expect(net.get('m0')).toBe(0);
    expect(net.get('m1')).toBe(0);
  });

  it('counts spend without counting settlements as spending', () => {
    const state = fold(dinnerLog());
    expect(totalSpend(state)).toBe(3000);
    expect(paidBy(state, 'm0')).toBe(3000);
    expect(paidBy(state, 'm1')).toBe(0);
  });

  it('handles an expense paid by two people at once', () => {
    const device = new TestDevice('aaaa');
    const state = fold([
      device.emit({ t: 'group.init', name: 'Trip', currency: 'EUR' }),
      device.emit({ t: 'member.add', memberId: 'm0', name: 'Anna' }),
      device.emit({ t: 'member.add', memberId: 'm1', name: 'Marco' }),
      device.emit({
        t: 'expense.create',
        expenseId: 'e1',
        fields: {
          description: 'Groceries',
          totalCents: 4800,
          date: '2026-08-11',
          payers: [
            { memberId: 'm0', amountCents: 3000 },
            { memberId: 'm1', amountCents: 1800 },
          ],
          split: { mode: 'equal', among: ['m0', 'm1'] },
        },
      }),
    ]);

    const net = balances(state);
    expect(net.get('m0')).toBe(600);
    expect(net.get('m1')).toBe(-600);
  });
});

describe('settling up', () => {
  it('clears every balance when the simplified plan is paid', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        const net = balances(fold(log));
        const after = applyTransfers(net, simplify(net));
        expect([...after.values()].every((amount) => amount === 0)).toBe(true);
      }),
    );
  });

  it('clears every balance when the pairwise plan is paid', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        const state = fold(log);
        const net = balances(state);
        const after = applyTransfers(net, pairwise(state));
        expect([...after.values()].every((amount) => amount === 0)).toBe(true);
      }),
    );
  });

  it('needs no more than one payment fewer than there are people', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        const state = fold(log);
        const net = balances(state);
        expect(simplify(net).length).toBeLessThanOrEqual(Math.max(0, state.members.length - 1));
      }),
    );
  });

  it('asks nobody to pay themselves, and never for nothing', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        const state = fold(log);
        for (const plan of [simplify(balances(state)), pairwise(state)]) {
          for (const transfer of plan) {
            expect(transfer.from).not.toBe(transfer.to);
            expect(transfer.amountCents).toBeGreaterThan(0);
          }
        }
      }),
    );
  });

  it('routes around the middle when simplifying', () => {
    // Anna is owed 10 by Marco; Marco is owed 10 by Sara.
    // Simplified, Sara should just pay Anna.
    const net = new Map([
      ['anna', 1000],
      ['marco', 0],
      ['sara', -1000],
    ]);
    expect(simplify(net)).toEqual([{ from: 'sara', to: 'anna', amountCents: 1000 }]);
  });

  it('keeps payments with the people who actually paid, when unsimplified', () => {
    const device = new TestDevice('aaaa');
    // Anna pays for a dinner shared by Marco and Sara only.
    const state = fold([
      device.emit({ t: 'group.init', name: 'Trip', currency: 'EUR' }),
      ...['m0', 'm1', 'm2'].map((id, i) =>
        device.emit({ t: 'member.add', memberId: id, name: `Member ${i}` }),
      ),
      device.emit({
        t: 'expense.create',
        expenseId: 'e1',
        fields: {
          description: 'Dinner',
          totalCents: 2000,
          date: '2026-08-11',
          payers: [{ memberId: 'm0', amountCents: 2000 }],
          split: { mode: 'equal', among: ['m1', 'm2'] },
        },
      }),
    ]);

    expect(pairwise(state)).toEqual([
      { from: 'm1', to: 'm0', amountCents: 1000 },
      { from: 'm2', to: 'm0', amountCents: 1000 },
    ]);
  });

  it('cancels debts that run both ways between two people', () => {
    const device = new TestDevice('aaaa');
    const state = fold([
      device.emit({ t: 'group.init', name: 'Trip', currency: 'EUR' }),
      device.emit({ t: 'member.add', memberId: 'm0', name: 'Anna' }),
      device.emit({ t: 'member.add', memberId: 'm1', name: 'Marco' }),
      device.emit({
        t: 'expense.create',
        expenseId: 'e1',
        fields: {
          description: 'Anna pays',
          totalCents: 1000,
          date: '2026-08-11',
          payers: [{ memberId: 'm0', amountCents: 1000 }],
          split: { mode: 'equal', among: ['m0', 'm1'] },
        },
      }),
      device.emit({
        t: 'expense.create',
        expenseId: 'e2',
        fields: {
          description: 'Marco pays',
          totalCents: 600,
          date: '2026-08-11',
          payers: [{ memberId: 'm1', amountCents: 600 }],
          split: { mode: 'equal', among: ['m0', 'm1'] },
        },
      }),
    ]);

    // Marco owes 500, Anna owes 300 — one payment of 200, not two.
    expect(pairwise(state)).toEqual([{ from: 'm1', to: 'm0', amountCents: 200 }]);
  });

  it('sorts the plan the same way on every device', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        const state = fold(log);
        const net = balances(state);
        expect(simplify(new Map([...net].reverse()))).toEqual(simplify(net));
      }),
    );
  });
});

describe('member ids used by the builders', () => {
  it('are stable', () => {
    expect(memberId(0)).toBe('m0');
  });
});
