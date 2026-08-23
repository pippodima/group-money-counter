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
    expect(await anna.merge(marco.allEnvelopes())).toMatchObject({
      events: 1,
      expenses: 1,
      settlements: 0,
      members: 0,
      isNewGroup: false,
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

    expect(await anna.merge(marco.allEnvelopes())).toMatchObject({
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

describe('several groups on one device', () => {
  let store: Store;

  beforeEach(async () => {
    store = await newDevice();
    await store.createGroup('Lisbon', 'EUR', ['Anna', 'Marco']);
  });

  it('files a second group under its own id, not the first', async () => {
    const first = store.ledgerView().groupId;
    await store.createGroup('Ski trip', 'CHF', ['Anna', 'Sara']);
    const second = store.ledgerView().groupId;

    expect(second).not.toBe(first);
    expect(store.ledgerView().groups.map((group) => group.name)).toEqual(['Lisbon', 'Ski trip']);

    // The giveaway that group.init landed in the wrong place would be the
    // new group inheriting the old one's members.
    expect(store.ledgerView().state.members.map((member) => member.name)).toEqual([
      'Anna',
      'Sara',
    ]);
    expect(store.ledgerView().state.group?.currency).toBe('CHF');
  });

  it('keeps each group\'s expenses to itself', async () => {
    await store.append({
      t: 'expense.create',
      expenseId: 'e1',
      fields: {
        description: 'Dinner',
        totalCents: 3000,
        date: '2026-08-24',
        payers: [{ memberId: store.ledgerView().state.members[0]?.id as string, amountCents: 3000 }],
        split: { mode: 'equal', among: [store.ledgerView().state.members[0]?.id as string] },
      },
    });

    const lisbon = store.ledgerView().groupId as string;
    await store.createGroup('Ski trip', 'CHF', ['Anna']);

    expect(store.ledgerView().state.expenses).toHaveLength(0);
    await store.setActiveGroup(lisbon);
    expect(store.ledgerView().state.expenses).toHaveLength(1);
  });

  it('shares only the open group, never the others', async () => {
    const lisbon = store.ledgerView().groupId;
    await store.createGroup('Ski trip', 'CHF', ['Anna']);

    // Handing someone your ledger must not hand them every other trip on the
    // phone as well.
    const shared = store.activeEnvelopes();
    expect(shared.length).toBeGreaterThan(0);
    expect(new Set(shared.map((envelope) => envelope.groupId))).toEqual(
      new Set([store.ledgerView().groupId]),
    );
    expect(shared.some((envelope) => envelope.groupId === lisbon)).toBe(false);
    expect(store.allEnvelopes().length).toBeGreaterThan(shared.length);
  });

  it('reopens the group you were last looking at', async () => {
    const lisbon = store.ledgerView().groupId;
    await store.createGroup('Ski trip', 'CHF', ['Anna']);
    await store.setActiveGroup(lisbon as string);

    const reopened = await relaunch();
    expect(reopened.ledgerView().groupId).toBe(lisbon);
    expect(reopened.ledgerView().state.group?.name).toBe('Lisbon');
  });

  it('lets a second phone join by scanning, which was impossible before', async () => {
    const shared = store.activeEnvelopes();

    // A fresh phone with nothing on it — previously its only option was to
    // create its own group, after which syncing always failed.
    const joiner = await newDevice();
    const result = await joiner.merge(shared);

    expect(result.isNewGroup).toBe(true);
    expect(result.groupId).toBe(store.ledgerView().groupId);

    await joiner.setActiveGroup(result.groupId as string);
    expect(joiner.ledgerView().state.group?.name).toBe('Lisbon');
    expect(joiner.ledgerView().state.members).toHaveLength(2);
  });

  it('adds a scanned group alongside, without moving you off the open one', async () => {
    const other = await newDevice();
    await other.createGroup('Ski trip', 'CHF', ['Sara']);

    const staying = store.ledgerView().groupId;
    const result = await store.merge(other.activeEnvelopes());

    expect(result.isNewGroup).toBe(true);
    expect(store.ledgerView().groupId).toBe(staying);
    expect(store.ledgerView().groups).toHaveLength(2);
  });
});

describe('deleting a group', () => {
  let store: Store;

  beforeEach(async () => {
    store = await newDevice();
    await store.createGroup('Lisbon', 'EUR', ['Anna', 'Marco']);
    await store.append({
      t: 'expense.create',
      expenseId: 'e1',
      fields: {
        description: 'Dinner',
        totalCents: 3000,
        date: '2026-08-24',
        payers: [{ memberId: 'm0', amountCents: 3000 }],
        split: { mode: 'equal', among: ['m0'] },
      },
    });
  });

  it('removes it, and leaves other groups alone', async () => {
    const lisbon = store.ledgerView().groupId as string;
    await store.createGroup('Ski trip', 'CHF', ['Sara']);
    const ski = store.ledgerView().groupId;

    const removed = await store.deleteGroup(lisbon);

    expect(removed).toBe(4);
    expect(store.ledgerView().groups.map((group) => group.name)).toEqual(['Ski trip']);
    expect(store.ledgerView().groupId).toBe(ski);
    expect(store.allEnvelopes().some((envelope) => envelope.groupId === lisbon)).toBe(false);
  });

  it('moves off the deleted group when it was the one open', async () => {
    await store.createGroup('Ski trip', 'CHF', ['Sara']);
    const ski = store.ledgerView().groupId as string;

    await store.deleteGroup(ski);

    expect(store.ledgerView().groupId).not.toBe(ski);
    expect(store.ledgerView().state.group?.name).toBe('Lisbon');
  });

  it('leaves the app with nothing when it was the only group', async () => {
    await store.deleteGroup(store.ledgerView().groupId as string);

    expect(store.ledgerView().groups).toEqual([]);
    expect(store.ledgerView().groupId).toBeUndefined();
    expect(store.allEnvelopes()).toEqual([]);
  });

  it('stays deleted across a relaunch', async () => {
    const lisbon = store.ledgerView().groupId as string;
    await store.createGroup('Ski trip', 'CHF', ['Sara']);
    await store.deleteGroup(lisbon);

    const reopened = await relaunch();
    expect(reopened.ledgerView().groups.map((group) => group.name)).toEqual(['Ski trip']);
    expect(reopened.ledgerView().groupId).toBe(reopened.ledgerView().groups[0]?.id);
  });

  it('comes back if someone else still has it', async () => {
    // Deletion is local: the log is append-only and there is no way to reach
    // another device's copy. Worth proving, since the UI promises exactly this.
    const shared = store.activeEnvelopes();
    const lisbon = store.ledgerView().groupId as string;

    const friend = await newDevice();
    await friend.merge(shared);

    await store.deleteGroup(lisbon);
    expect(store.ledgerView().groups).toEqual([]);

    await store.merge(friend.activeEnvelopes());
    expect(store.ledgerView().groups.map((group) => group.name)).toEqual(['Lisbon']);
    expect(store.ledgerView().state.expenses).toHaveLength(1);
  });
});
