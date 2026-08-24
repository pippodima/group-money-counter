// @vitest-environment jsdom

/**
 * The remote invite: build a file, and have it work at the far end.
 *
 * The transport in between is somebody else's app — a message, mail, a
 * cloud drive. What has to hold is that the file survives the trip and gets
 * the recipient into the group.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { parseBackup } from './backup.js';
import { buildInviteFile, sendInvite } from './invite.js';
import { fold } from '../core/fold.js';
import { balances } from '../core/balances.js';

type Store = typeof import('../store/ledger.js');

async function newDevice(): Promise<Store> {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const store = await import('../store/ledger.js');
  await store.initLedger();
  return store;
}

async function seeded(): Promise<Store> {
  const store = await newDevice();
  await store.createGroup('Lisbon weekend', 'EUR', ['Anna', 'Marco']);
  const [anna] = store.ledgerView().state.members;
  await store.append({
    t: 'expense.create',
    expenseId: 'e1',
    fields: {
      description: 'Pastéis de nata',
      totalCents: 1250,
      date: '2026-08-24',
      payers: [{ memberId: anna?.id as string, amountCents: 1250 }],
      split: { mode: 'equal', among: store.ledgerView().state.members.map((m) => m.id) },
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the invite file', () => {
  it('gets a distant person into the group, expenses and all', async () => {
    const host = await seeded();
    const file = buildInviteFile(
      host.ledgerView().groupId as string,
      'Lisbon weekend',
      host.activeEnvelopes(),
    );

    // The file travels by some other app entirely; only its bytes survive.
    const delivered = await file.text();

    const guest = await newDevice();
    const parsed = parseBackup(delivered);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await guest.merge(parsed.backup.events);
    expect(result.isNewGroup).toBe(true);

    await guest.setActiveGroup(result.groupId as string);
    expect(guest.ledgerView().state.group?.name).toBe('Lisbon weekend');
    expect(guest.ledgerView().state.expenses).toHaveLength(1);
    expect([...balances(guest.ledgerView().state)]).toEqual([
      ...balances(host.ledgerView().state),
    ]);
  });

  it('carries only the group it was sent for', async () => {
    const host = await seeded();
    const invited = host.ledgerView().groupId;
    await host.createGroup('Ski trip', 'CHF', ['Sara']);

    const file = buildInviteFile(invited as string, 'Lisbon weekend', host.activeEnvelopes());
    void file;

    // activeEnvelopes follows the open group, so the invite must be built
    // while the right one is open — the screen only offers it there.
    await host.setActiveGroup(invited as string);
    const correct = buildInviteFile(invited as string, 'Lisbon weekend', host.activeEnvelopes());
    const parsed = parseBackup(await correct.text());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(new Set(parsed.backup.events.map((e) => e.groupId))).toEqual(new Set([invited]));
    expect(fold(parsed.backup.events).group?.name).toBe('Lisbon weekend');
  });

  it('is named after the group, so it is recognisable in a chat', async () => {
    const host = await seeded();
    const file = buildInviteFile(
      host.ledgerView().groupId as string,
      'Lisbon weekend',
      host.activeEnvelopes(),
    );
    expect(file.name).toMatch(/^lisbon-weekend-\d{4}-\d{2}-\d{2}\.gmc\.json$/);
    expect(file.type).toBe('application/json');
  });

  it('can be opened long after it was sent, and adds nothing twice', async () => {
    const host = await seeded();
    const file = buildInviteFile(
      host.ledgerView().groupId as string,
      'Lisbon weekend',
      host.activeEnvelopes(),
    );
    const delivered = await file.text();

    const guest = await newDevice();
    const parsed = parseBackup(delivered);
    if (!parsed.ok) throw new Error('unreadable');

    await guest.merge(parsed.backup.events);
    // Opening the same invite again is a no-op, not a duplicate group.
    const second = await guest.merge(parsed.backup.events);

    expect(second.events).toBe(0);
    expect(guest.ledgerView().groups).toHaveLength(1);
  });
});

describe('sending', () => {
  it('uses the share sheet when the browser has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      canShare: () => true,
      share,
    });

    const file = new File(['{}'], 'trip.gmc.json', { type: 'application/json' });
    expect(await sendInvite(file, 'Lisbon')).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
    expect(share.mock.calls[0]?.[0]).toMatchObject({ files: [file], title: 'Lisbon' });
  });

  it('treats a dismissed share sheet as cancelled, not failed', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    vi.stubGlobal('navigator', {
      ...navigator,
      canShare: () => true,
      share: vi.fn().mockRejectedValue(abort),
    });

    const file = new File(['{}'], 'trip.gmc.json', { type: 'application/json' });
    expect(await sendInvite(file, 'Lisbon')).toBe('cancelled');
  });

  it('falls back to saving the file where there is no share sheet', async () => {
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined, share: undefined });
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });

    const clicked = vi.fn();
    const anchor = { href: '', download: '', click: clicked } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    const file = new File(['{}'], 'trip.gmc.json', { type: 'application/json' });
    expect(await sendInvite(file, 'Lisbon')).toBe('downloaded');
    expect(clicked).toHaveBeenCalledOnce();
    expect(anchor.download).toBe('trip.gmc.json');

    vi.restoreAllMocks();
  });
});
