import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fold } from './fold.js';
import { mergeEnvelopes, type Envelope } from './events.js';
import { TestDevice, arbLog, memberId } from '../testing/ledger.js';

/** A deterministic reshuffle driven by a generated permutation. */
function reorder<T>(items: readonly T[], order: readonly number[]): T[] {
  return items
    .map((item, i) => ({ item, key: order[i % order.length] ?? i }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

const arbOrder = fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 40 });

describe('determinism', () => {
  // The property everything else rests on. If two devices fold the same
  // events into different state, balances drift apart and nothing tells you.
  it('folds to identical state whatever order the events arrive in', () => {
    fc.assert(
      fc.property(arbLog, arbOrder, (log, order) => {
        expect(fold(reorder(log, order))).toEqual(fold(log));
      }),
    );
  });

  it('is unchanged by receiving events it already has', () => {
    fc.assert(
      fc.property(arbLog, arbOrder, (log, order) => {
        const duplicated = mergeEnvelopes(log, reorder(log, order), log);
        expect(fold(duplicated)).toEqual(fold(log));
        expect(duplicated).toHaveLength(log.length);
      }),
    );
  });

  it('merges in either direction to the same result', () => {
    fc.assert(
      fc.property(arbLog, arbLog, (a, b) => {
        // Distinct device ids keep envelope ids from colliding.
        const relabelled = b.map((e) => ({ ...e, id: e.id.replace(/^aaaa/, 'bbbb') }));
        expect(mergeEnvelopes(a, relabelled)).toEqual(mergeEnvelopes(relabelled, a));
      }),
    );
  });
});

describe('tombstones', () => {
  function log(build: (device: TestDevice) => Envelope[]): Envelope[] {
    return build(new TestDevice('aaaa'));
  }

  const create = (device: TestDevice, id = 'e1') =>
    device.emit({
      t: 'expense.create',
      expenseId: id,
      fields: {
        description: 'Dinner',
        totalCents: 3000,
        date: '2026-08-11',
        payers: [{ memberId: memberId(0), amountCents: 3000 }],
        split: { mode: 'equal', among: [memberId(0), memberId(1)] },
      },
    });

  it('keeps a deleted expense deleted even if an update lands afterwards', () => {
    const events = log((d) => [
      create(d),
      d.emit({ t: 'expense.delete', expenseId: 'e1' }),
      d.emit({ t: 'expense.update', expenseId: 'e1', patch: { description: 'Resurrected' } }),
    ]);

    const [expense] = fold(events).expenses;
    expect(expense?.deleted).toBe(true);
    expect(expense?.description).toBe('Dinner');
  });

  it('ignores a create that arrives after the delete', () => {
    const events = log((d) => [d.emit({ t: 'expense.delete', expenseId: 'e1' }), create(d)]);
    expect(fold(events).expenses).toEqual([]);
  });

  it('survives the delete being replayed out of order', () => {
    const events = log((d) => [
      create(d),
      d.emit({ t: 'expense.update', expenseId: 'e1', patch: { totalCents: 4000 } }),
      d.emit({ t: 'expense.delete', expenseId: 'e1' }),
    ]);

    for (const ordering of [events, [...events].reverse(), [events[1]!, events[2]!, events[0]!]]) {
      const [expense] = fold(ordering).expenses;
      expect(expense?.deleted).toBe(true);
      expect(expense?.totalCents).toBe(4000);
    }
  });
});

describe('replay', () => {
  it('applies the later of two conflicting edits', () => {
    const anna = new TestDevice('aaaa');
    const marco = new TestDevice('bbbb');

    const created = anna.emit({
      t: 'expense.create',
      expenseId: 'e1',
      fields: {
        description: 'Taxi',
        totalCents: 2000,
        date: '2026-08-11',
        payers: [{ memberId: memberId(0), amountCents: 2000 }],
        split: { mode: 'equal', among: [memberId(0)] },
      },
    });

    marco.observe(created);
    const marcoEdit = marco.emit({
      t: 'expense.update',
      expenseId: 'e1',
      patch: { description: 'Airport taxi' },
    });

    anna.observe(marcoEdit);
    const annaEdit = anna.emit({
      t: 'expense.update',
      expenseId: 'e1',
      patch: { description: 'Taxi to the airport' },
    });

    const state = fold([annaEdit, created, marcoEdit]);
    expect(state.expenses[0]?.description).toBe('Taxi to the airport');
  });

  it('merges partial edits to different fields', () => {
    const device = new TestDevice('aaaa');
    const events = [
      device.emit({
        t: 'expense.create',
        expenseId: 'e1',
        fields: {
          description: 'Lunch',
          totalCents: 1000,
          date: '2026-08-11',
          payers: [{ memberId: memberId(0), amountCents: 1000 }],
          split: { mode: 'equal', among: [memberId(0)] },
        },
      }),
      device.emit({ t: 'expense.update', expenseId: 'e1', patch: { totalCents: 1200 } }),
      device.emit({ t: 'expense.update', expenseId: 'e1', patch: { date: '2026-08-12' } }),
    ];

    const [expense] = fold(events).expenses;
    expect(expense).toMatchObject({ description: 'Lunch', totalCents: 1200, date: '2026-08-12' });
  });

  it('records who first entered an expense', () => {
    const marco = new TestDevice('bbbb');
    const events = [
      marco.emit({
        t: 'expense.create',
        expenseId: 'e1',
        fields: {
          description: 'Beer',
          totalCents: 800,
          date: '2026-08-11',
          payers: [{ memberId: memberId(0), amountCents: 800 }],
          split: { mode: 'equal', among: [memberId(0)] },
        },
      }),
    ];
    expect(fold(events).expenses[0]?.createdBy).toBe('bbbb');
  });

  it('ignores updates to something that was never created', () => {
    const device = new TestDevice('aaaa');
    const events = [device.emit({ t: 'expense.update', expenseId: 'ghost', patch: {} })];
    expect(fold(events).expenses).toEqual([]);
  });

  it('tracks member lifecycle without losing history', () => {
    const device = new TestDevice('aaaa');
    const events = [
      device.emit({ t: 'group.init', name: 'Trip', currency: 'EUR' }),
      device.emit({ t: 'member.add', memberId: 'm0', name: 'Anna' }),
      device.emit({ t: 'member.rename', memberId: 'm0', name: 'Anna B' }),
      device.emit({ t: 'member.deactivate', memberId: 'm0' }),
    ];

    const state = fold(events);
    expect(state.members).toEqual([{ id: 'm0', name: 'Anna B', active: false }]);
    expect(fold([...events, device.emit({ t: 'member.reactivate', memberId: 'm0' })]).members[0])
      .toMatchObject({ active: true });
  });

  it('separates groups sharing one log', () => {
    const anna = new TestDevice('aaaa', 1_700_000_000_000, 'trip');
    const marco = new TestDevice('bbbb', 1_700_000_000_000, 'flat');
    const events = [
      anna.emit({ t: 'group.init', name: 'Trip', currency: 'EUR' }),
      marco.emit({ t: 'group.init', name: 'Flat', currency: 'GBP' }),
    ];

    expect(fold(events, 'trip').group).toMatchObject({ name: 'Trip', currency: 'EUR' });
    expect(fold(events, 'flat').group).toMatchObject({ name: 'Flat', currency: 'GBP' });
  });

  it('returns empty state for an empty log', () => {
    expect(fold([])).toMatchObject({ group: undefined, expenses: [], members: [] });
  });
});
