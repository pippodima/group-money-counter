/**
 * Two devices syncing through the real codec.
 *
 * Everything except the camera: encode, frame, collect out of order, decode,
 * merge, fold. What a phone adds on top is optics, and no test can stand in
 * for that — but every byte in between is exercised here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { FrameCollector, encodeLog, toFrames } from './codec.js';
import { encodeBase45, decodeBase45 } from './base45.js';
import { balances } from '../core/balances.js';
import type { Envelope } from '../core/events.js';

type Store = typeof import('../store/ledger.js');

async function newDevice(): Promise<Store> {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const store = await import('../store/ledger.js');
  await store.initLedger();
  return store;
}

/**
 * Everything a phone does between two screens: encode, frame, render to text,
 * read text back, collect. Frames arrive shuffled, and some arrive twice —
 * which is what a looping sender and a wandering camera actually produce.
 */
function transmit(from: Store, seen: number[] = []): Envelope[] {
  const groupId = from.ledgerView().groupId as string;
  const frames = toFrames(encodeLog(from.allEnvelopes()), groupId);

  // Base45 is the round trip through a scanner's string output.
  const asText = frames.map(encodeBase45);

  const order = seen.length > 0 ? seen : [...frames.keys()].reverse();
  const collector = new FrameCollector();
  let last = collector.add(decodeBase45(asText[order[0] as number] as string) as Uint8Array);

  for (const index of order.slice(1)) {
    last = collector.add(decodeBase45(asText[index] as string) as Uint8Array);
  }

  if (last.status !== 'complete') throw new Error(`transmission incomplete: ${last.status}`);
  return last.envelopes;
}

const dinner = {
  t: 'expense.create' as const,
  expenseId: 'e1',
  fields: {
    description: 'Dinner',
    totalCents: 6000,
    date: '2026-08-17',
    payers: [{ memberId: 'm0', amountCents: 6000 }],
    split: { mode: 'equal' as const, among: ['m0', 'm1', 'm2'] },
  },
};

const taxi = {
  t: 'expense.create' as const,
  expenseId: 'e2',
  fields: {
    description: 'Taxi',
    totalCents: 2400,
    date: '2026-08-17',
    payers: [{ memberId: 'm1', amountCents: 2400 }],
    split: { mode: 'equal' as const, among: ['m0', 'm1', 'm2'] },
  },
};

describe('two phones', () => {
  let anna: Store;
  let marco: Store;

  beforeEach(async () => {
    anna = await newDevice();
    await anna.append(
      { t: 'group.init', name: 'Lisbon', currency: 'EUR' },
      { t: 'member.add', memberId: 'm0', name: 'Anna' },
      { t: 'member.add', memberId: 'm1', name: 'Marco' },
      { t: 'member.add', memberId: 'm2', name: 'Sara' },
    );

    marco = await newDevice();
    await marco.merge(transmit(anna));
  });

  it('converges after the two-pass exchange', async () => {
    await anna.append(dinner);
    await marco.append(taxi);

    // Pass 1: Anna shows, Marco scans.
    await marco.merge(transmit(anna));
    // Pass 2: Marco shows, Anna scans.
    await anna.merge(transmit(marco));

    expect(anna.ledgerView().state).toEqual(marco.ledgerView().state);
    expect(anna.ledgerView().state.expenses).toHaveLength(2);
  });

  it('agrees to the cent on who owes what', async () => {
    await anna.append(dinner);
    await marco.append(taxi);
    await marco.merge(transmit(anna));
    await anna.merge(transmit(marco));

    const hers = balances(anna.ledgerView().state);
    const his = balances(marco.ledgerView().state);

    expect([...hers]).toEqual([...his]);
    // 60.00 three ways is 20/20/20; 24.00 is 8/8/8.
    expect(hers.get('m0')).toBe(6000 - 2000 - 800);
    expect(hers.get('m1')).toBe(2400 - 2000 - 800);
    expect([...hers.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('reports only what was actually new', async () => {
    await marco.append(taxi);

    expect(await anna.merge(transmit(marco))).toMatchObject({ events: 1, expenses: 1 });
    // Scanning the same phone again is a no-op, not a duplicate.
    expect(await anna.merge(transmit(marco))).toMatchObject({ events: 0 });
  });

  it('does not care which of them scans first', async () => {
    await anna.append(dinner);
    await marco.append(taxi);

    // Marco first this time, the reverse of the other tests.
    await anna.merge(transmit(marco));
    await marco.merge(transmit(anna));

    expect(anna.ledgerView().state).toEqual(marco.ledgerView().state);
  });

  it('survives an edit made on the other phone', async () => {
    await anna.append(dinner);
    await marco.merge(transmit(anna));

    await marco.append({
      t: 'expense.update',
      expenseId: 'e1',
      patch: { description: 'Dinner at the docks' },
    });
    await anna.merge(transmit(marco));

    expect(anna.ledgerView().state.expenses[0]?.description).toBe('Dinner at the docks');
  });

  it('keeps a deletion deleted after a round trip', async () => {
    await anna.append(dinner);
    await marco.merge(transmit(anna));
    await marco.append({ t: 'expense.delete', expenseId: 'e1' });

    await anna.merge(transmit(marco));
    await marco.merge(transmit(anna));

    expect(anna.ledgerView().state.expenses[0]?.deleted).toBe(true);
    expect(balances(anna.ledgerView().state).get('m0')).toBe(0);
  });

  it('completes even when frames arrive shuffled and repeated', async () => {
    await anna.append(dinner, taxi);
    const frames = toFrames(encodeLog(anna.allEnvelopes()), anna.ledgerView().groupId as string);

    // A wandering camera: out of order, some caught twice, some late.
    const messy = [...frames.keys(), ...frames.keys()].sort((a, b) => (a % 3) - (b % 3));
    await marco.merge(transmit(anna, messy));

    expect(marco.ledgerView().state).toEqual(anna.ledgerView().state);
  });
});
