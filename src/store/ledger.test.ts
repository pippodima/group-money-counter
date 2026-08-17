/**
 * The store against a real IndexedDB implementation.
 *
 * The domain layer is proven by property tests; what is unproven is the
 * wiring — that events actually reach disk, that folding them back produces
 * the same state, and that the clock survives a restart still monotonic.
 * Those are the failures that would only ever show up on a phone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
// Installs IDBRequest, IDBKeyRange and friends as globals, which `idb` needs.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { balances } from '../core/balances.js';
import { decodeHlc } from '../core/hlc.js';

type Store = typeof import('./ledger.js');

/**
 * A fresh module instance. Resetting the registry gives new module-level
 * state — a new clock, a new cached device id, a new database handle — which
 * is what makes "reopening the app" testable.
 */
async function loadStore(): Promise<Store> {
  vi.resetModules();
  return import('./ledger.js');
}

/** A new device: empty database, fresh memory. */
async function newDevice(): Promise<Store> {
  globalThis.indexedDB = new IDBFactory();
  const store = await loadStore();
  await store.initLedger();
  return store;
}

/** The same device relaunched: same database, fresh memory. */
async function relaunch(): Promise<Store> {
  const store = await loadStore();
  await store.initLedger();
  return store;
}

const dinner = {
  t: 'expense.create' as const,
  expenseId: 'e1',
  fields: {
    description: 'Dinner',
    totalCents: 3000,
    date: '2026-08-11',
    payers: [{ memberId: 'm0', amountCents: 3000 }],
    split: { mode: 'equal' as const, among: ['m0', 'm1'] },
  },
};

async function seedGroup(store: Store) {
  await store.append(
    { t: 'group.init', name: 'Trip', currency: 'EUR' },
    { t: 'member.add', memberId: 'm0', name: 'Anna' },
    { t: 'member.add', memberId: 'm1', name: 'Marco' },
  );
}

function lastHlc(store: Store): string {
  return store
    .allEnvelopes()
    .map((envelope) => envelope.hlc)
    .sort()
    .at(-1) as string;
}

describe('the ledger store', () => {
  let store: Store;

  beforeEach(async () => {
    store = await newDevice();
  });

  it('starts empty, with no group', () => {
    expect(store.allEnvelopes()).toEqual([]);
    expect(store.ledgerView().groupId).toBeUndefined();
    expect(store.ledgerView().ready).toBe(true);
  });

  it('creates a group and folds it straight back', async () => {
    await seedGroup(store);

    const { state, groupId } = store.ledgerView();
    expect(groupId).toBeDefined();
    expect(state.group).toMatchObject({ name: 'Trip', currency: 'EUR' });
    expect(state.members.map((member) => member.name)).toEqual(['Anna', 'Marco']);
  });

  it('survives a relaunch with its balances intact', async () => {
    await seedGroup(store);
    await store.append(dinner);

    const reopened = await relaunch();
    const { state } = reopened.ledgerView();

    expect(state.expenses).toHaveLength(1);
    expect(state.group?.name).toBe('Trip');
    expect(balances(state).get('m0')).toBe(1500);
    expect(balances(state).get('m1')).toBe(-1500);
  });

  it('keeps the clock moving forward across a relaunch', async () => {
    await seedGroup(store);
    const before = lastHlc(store);

    const reopened = await relaunch();
    await reopened.append({ t: 'group.rename', name: 'Lisbon' });
    const after = lastHlc(reopened);

    // Same device, strictly later stamp — even though the in-memory clock
    // was rebuilt from scratch.
    expect(after > before).toBe(true);
    expect(decodeHlc(after).node).toBe(decodeHlc(before).node);
  });

  it('never reuses an event id across a relaunch', async () => {
    await seedGroup(store);
    await store.append(dinner);

    const reopened = await relaunch();
    await reopened.append({ t: 'group.rename', name: 'Lisbon' });

    const ids = reopened.allEnvelopes().map((envelope) => envelope.id);
    // group.init + two member.add + the expense + the rename.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
  });

  it('files every event under one group', async () => {
    await seedGroup(store);
    await store.append(dinner);
    expect(new Set(store.allEnvelopes().map((envelope) => envelope.groupId)).size).toBe(1);
  });

  it('keeps edits and deletes working end to end', async () => {
    await seedGroup(store);
    await store.append(dinner);
    await store.append({
      t: 'expense.update',
      expenseId: 'e1',
      patch: { description: 'Late dinner' },
    });

    expect(store.ledgerView().state.expenses[0]?.description).toBe('Late dinner');

    await store.append({ t: 'expense.delete', expenseId: 'e1' });
    const { state } = store.ledgerView();
    expect(state.expenses[0]?.deleted).toBe(true);
    expect(balances(state).get('m1')).toBe(0);
  });
});

describe('merging between devices', () => {
  it('takes in what is new and ignores what it already has', async () => {
    const anna = await newDevice();
    await seedGroup(anna);
    const shared = [...anna.allEnvelopes()];

    const marco = await newDevice();
    await marco.merge(shared);
    await marco.append(dinner);

    // Reports what actually landed, not just how many events moved.
    expect(await anna.merge(marco.allEnvelopes())).toEqual({
      events: 1,
      expenses: 1,
      settlements: 0,
      members: 0,
    });
    expect(await anna.merge(marco.allEnvelopes())).toMatchObject({ events: 0 });
    expect(anna.ledgerView().state.expenses).toHaveLength(1);
  });

  it('counts people and payments separately when reporting a merge', async () => {
    const anna = await newDevice();
    await seedGroup(anna);

    const marco = await newDevice();
    await marco.merge(anna.allEnvelopes());
    await marco.append(
      { t: 'member.add', memberId: 'm2', name: 'Sara' },
      dinner,
      {
        t: 'settlement.create',
        settlementId: 's1',
        fields: {
          fromMemberId: 'm1',
          toMemberId: 'm0',
          amountCents: 500,
          date: '2026-08-12',
          note: '',
        },
      },
    );

    expect(await anna.merge(marco.allEnvelopes())).toEqual({
      events: 3,
      expenses: 1,
      settlements: 1,
      members: 1,
    });
  });

  it('converges to identical state after both directions', async () => {
    const anna = await newDevice();
    await seedGroup(anna);

    const marco = await newDevice();
    await marco.merge(anna.allEnvelopes());
    await marco.append(dinner);
    await marco.append({
      t: 'settlement.create',
      settlementId: 's1',
      fields: {
        fromMemberId: 'm1',
        toMemberId: 'm0',
        amountCents: 1500,
        date: '2026-08-12',
        note: '',
      },
    });

    await anna.merge(marco.allEnvelopes());
    await marco.merge(anna.allEnvelopes());

    expect(anna.ledgerView().state).toEqual(marco.ledgerView().state);
    expect([...balances(anna.ledgerView().state).values()].every((net) => net === 0)).toBe(true);
  });

  it('gives each install its own identity', async () => {
    const anna = await newDevice();
    await seedGroup(anna);

    const marco = await newDevice();
    await marco.append({ t: 'group.init', name: 'Flat', currency: 'GBP' });

    expect(decodeHlc(lastHlc(anna)).node).not.toBe(decodeHlc(lastHlc(marco)).node);
  });
});
