// @vitest-environment jsdom

/**
 * Renders every screen against a real store.
 *
 * Not a substitute for using the app, but it catches the class of failure
 * that only appears at runtime — a missing guard on an empty list, an
 * undefined member id, a crash on first launch — which typechecking cannot
 * see and which would otherwise be found on a phone in a restaurant.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';

type Store = typeof import('../store/ledger.js');

let store: Store;

/**
 * Imported after `vi.resetModules()`, deliberately.
 *
 * A static import would bind App to whichever ledger instance existed when
 * this file was first evaluated, while the tests seed a different one — the
 * app would render as though no group had ever been created.
 */
async function launch(hash = '/'): Promise<void> {
  const { App } = await import('../App.js');
  window.location.hash = hash;
  await act(async () => {
    render(<App />);
  });
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  store = await import('../store/ledger.js');
  window.location.hash = '/';
});

afterEach(cleanup);

async function seed(): Promise<void> {
  await store.initLedger();
  await act(async () => {
    await store.append(
      { t: 'group.init', name: 'Lisbon weekend', currency: 'EUR' },
      { t: 'member.add', memberId: 'm0', name: 'Anna' },
      { t: 'member.add', memberId: 'm1', name: 'Marco' },
      { t: 'member.add', memberId: 'm2', name: 'Sara' },
    );
    await store.append({
      t: 'expense.create',
      expenseId: 'e1',
      fields: {
        description: 'Pastéis de nata',
        totalCents: 1250,
        date: '2026-08-11',
        payers: [{ memberId: 'm0', amountCents: 1250 }],
        split: { mode: 'equal', among: ['m0', 'm1', 'm2'] },
      },
    });
  });
}

describe('first launch', () => {
  it('offers both ways in, not just creating', async () => {
    // The bug this replaced: create was the only option, so a second phone
    // always minted its own group and could never sync with the first.
    await launch();
    expect(await screen.findByRole('button', { name: /start a new group/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /join someone's group/i })).toBeDefined();
  });

  it('refuses an unnamed group and says why', async () => {
    await launch('/groups/new');
    const button = await screen.findByRole('button', { name: /create group/i });
    await act(async () => button.click());
    expect(screen.getByRole('alert').textContent).toMatch(/give the group a name/i);
  });

  it('sends anything needing a group to the landing screen', async () => {
    await launch('/balances');
    expect(await screen.findByRole('button', { name: /start a new group/i })).toBeDefined();
  });
});

describe('with a ledger', () => {
  beforeEach(seed);

  it('lists expenses with the group total', async () => {
    await launch('/');
    expect(await screen.findByText('Pastéis de nata')).toBeDefined();
    expect(screen.getByText(/paid by Anna/i)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Lisbon weekend' })).toBeDefined();
  });

  it('shows balances that sum to zero', async () => {
    await launch('/balances');
    const list = await screen.findByRole('list');
    // 12.50 three ways is 4.17 / 4.17 / 4.16 — the two spare cents go to m0
    // and m1 on the member-id tiebreak. Anna paid it all, so she is up 8.33.
    expect(within(list).getByText(/8\.33/)).toBeDefined();
    expect(within(list).getByText(/4\.17/)).toBeDefined();
    expect(within(list).getByText(/4\.16/)).toBeDefined();
  });

  it('proposes a settlement plan', async () => {
    await launch('/settle');
    expect(await screen.findByRole('button', { name: /fewest payments/i })).toBeDefined();
    expect(screen.getAllByRole('button', { name: /mark paid/i })).toHaveLength(2);
  });

  it('opens a blank expense form', async () => {
    await launch('/new');
    expect(await screen.findByRole('heading', { name: /new expense/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /add expense/i })).toBeDefined();
  });

  it('picks the payer in one tap, with the first person preselected', async () => {
    await launch('/new');
    const payers = await screen.findByRole('radiogroup', { name: /paid by/i });
    const options = within(payers).getAllByRole('radio');

    expect(options).toHaveLength(3);
    expect((options[0] as HTMLInputElement).checked).toBe(true);

    await act(async () => (options[2] as HTMLInputElement).click());
    expect((options[2] as HTMLInputElement).checked).toBe(true);
    expect((options[0] as HTMLInputElement).checked).toBe(false);
  });

  it('falls back to a dropdown once the chips would not fit', async () => {
    await act(async () => {
      await store.append(
        ...Array.from({ length: 6 }, (_, i) => ({
          t: 'member.add' as const,
          memberId: `x${i}`,
          name: `Extra ${i}`,
        })),
      );
    });

    await launch('/new');
    expect(await screen.findByRole('combobox')).toBeDefined();
    expect(screen.queryByRole('radiogroup', { name: /paid by/i })).toBeNull();
  });

  it('opens an existing expense for editing, prefilled', async () => {
    await launch('/expense/e1');
    expect(await screen.findByRole('heading', { name: /edit expense/i })).toBeDefined();
    expect(screen.getByDisplayValue('Pastéis de nata')).toBeDefined();
    expect(screen.getByDisplayValue('12.50')).toBeDefined();
    expect(screen.getByRole('button', { name: /delete/i })).toBeDefined();
  });

  it('asks before deleting a whole group, and says it can come back', async () => {
    await launch('/members');
    await act(async () => (await screen.findByRole('button', { name: /^delete this group$/i })).click());

    // Destructive and irreversible locally, so it must not be one tap — and
    // it must be honest that syncing can restore it.
    const warning = screen.getByText(/cannot be undone here/i);
    expect(warning.textContent).toMatch(/syncing|backup/i);

    await act(async () => screen.getByRole('button', { name: /keep it/i }).click());
    expect(screen.queryByText(/cannot be undone here/i)).toBeNull();
    expect(store.ledgerView().groups).toHaveLength(1);
  });

  it('deletes the group once confirmed', async () => {
    await launch('/members');
    await act(async () => (await screen.findByRole('button', { name: /^delete this group$/i })).click());
    await act(async () => screen.getByRole('button', { name: /delete .* permanently/i }).click());

    // The purge is a transaction against IndexedDB, so it lands a tick later.
    await waitFor(() => expect(store.ledgerView().groups).toEqual([]));
    expect(store.allEnvelopes()).toEqual([]);
  });

  it('lists people and lets them be renamed', async () => {
    await launch('/members');
    expect(await screen.findByDisplayValue('Anna')).toBeDefined();
    expect(screen.getByDisplayValue('Sara')).toBeDefined();
  });

  it('offers to show or scan on the sync screen', async () => {
    await launch('/sync');
    expect(await screen.findByRole('button', { name: /show my ledger/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /scan theirs/i })).toBeDefined();
    expect(screen.getByText(/sharing 5 changes from Lisbon weekend/i)).toBeDefined();
  });

  it('switches group from the title bar when there is more than one', async () => {
    await act(async () => {
      await store.createGroup('Ski trip', 'CHF', ['Anna']);
    });
    await launch('/');

    // Arrows and dots make the swipe discoverable rather than secret.
    const next = await screen.findByRole('button', { name: /next group/i });
    expect(screen.getByRole('button', { name: /previous group/i })).toBeDefined();

    // findBy, not getBy: switching writes the choice to IndexedDB, so the
    // re-render lands a tick later.
    expect(await screen.findByRole('heading', { name: 'Ski trip' })).toBeDefined();
    await act(async () => next.click());
    expect(await screen.findByRole('heading', { name: 'Lisbon weekend' })).toBeDefined();
  });

  it('hides the group arrows when there is only one', async () => {
    await launch('/');
    expect(screen.queryByRole('button', { name: /next group/i })).toBeNull();
  });

  it('puts sync in the tab bar, since it is the point of the app', async () => {
    await launch('/');
    const tabs = await screen.findByRole('navigation', { name: /sections/i });
    expect(within(tabs).getByRole('button', { name: /^sync$/i })).toBeDefined();
  });

  it('deletes an expense from the list, and can take it back', async () => {
    await launch('/');
    const before = store.allEnvelopes().length;

    // The keyboard equivalent of the swipe.
    const remove = await screen.findByRole('button', { name: /delete Pastéis de nata/i });
    await act(async () => remove.click());

    expect(screen.queryByText('Pastéis de nata')).toBeNull();
    expect((await screen.findByRole('status')).textContent).toMatch(/deleted/i);

    // Nothing is written during the undo window — deletion is absorbing, so
    // an undo could not be reversed once the event existed.
    expect(store.allEnvelopes()).toHaveLength(before);

    await act(async () => screen.getByRole('button', { name: /undo/i }).click());

    expect(await screen.findByText('Pastéis de nata')).toBeDefined();
    expect(store.allEnvelopes()).toHaveLength(before);
    expect(store.ledgerView().state.expenses[0]?.deleted).toBe(false);
  });

  it('commits the deletion when you leave the screen', async () => {
    // Fake timers cannot be used to close the undo window here: IndexedDB's
    // work needs real ones, and installing fakes stalls every later test.
    // Leaving the screen is the same commit path, and is real behaviour.
    await launch('/');
    const remove = await screen.findByRole('button', { name: /delete Pastéis de nata/i });
    await act(async () => remove.click());
    expect(store.ledgerView().state.expenses[0]?.deleted).toBe(false);

    await act(async () => {
      cleanup();
      // The commit is deliberately fire-and-forget on unmount, so give the
      // write a tick to land before reading it back.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(store.ledgerView().state.expenses[0]?.deleted).toBe(true);
  });

  it('still exposes the storage probe', async () => {
    await launch('/probe');
    expect(await screen.findByText(/milestone 0/i)).toBeDefined();
  });

  it('falls back to the expense list for an unknown route', async () => {
    await launch('/nonsense');
    expect(await screen.findByRole('heading', { name: 'Lisbon weekend' })).toBeDefined();
  });
});

describe('backup', () => {
  beforeEach(seed);

  /** Drops a file into the import picker the way a user would. */
  async function importFile(contents: string) {
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File([contents], 'backup.gmc.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('offers to export everything on the device', async () => {
    await launch('/backup');
    expect(await screen.findByRole('button', { name: /export 5 changes/i })).toBeDefined();
  });

  it('imports its own export and reports nothing new', async () => {
    const { buildBackup, serialiseBackup } = await import('../lib/backup.js');
    const text = serialiseBackup(
      buildBackup(store.ledgerView().groupId as string, 'Lisbon weekend', store.allEnvelopes()),
    );

    await launch('/backup');
    await importFile(text);

    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      expect.stringMatching(/already had all of it/i),
    );
  });

  it('takes in an expense the device has never seen', async () => {
    const { buildBackup, serialiseBackup } = await import('../lib/backup.js');
    const groupId = store.ledgerView().groupId as string;

    const extra = {
      id: 'ffff:0',
      hlc: '001800000000001-0000-ffff',
      groupId,
      body: {
        t: 'expense.create' as const,
        expenseId: 'e2',
        fields: {
          description: 'Tram tickets',
          totalCents: 900,
          date: '2026-08-12',
          payers: [{ memberId: 'm1', amountCents: 900 }],
          split: { mode: 'equal' as const, among: ['m0', 'm1', 'm2'] },
        },
      },
    };

    await launch('/backup');
    await importFile(
      serialiseBackup(buildBackup(groupId, 'Lisbon weekend', [...store.allEnvelopes(), extra])),
    );

    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      expect.stringMatching(/added 1 expense/i),
    );
    expect(store.ledgerView().state.expenses).toHaveLength(2);
  });

  it('refuses a damaged file without importing any of it', async () => {
    await launch('/backup');
    await importFile('{"format":"gmc/1","events":[{"id":"bad"}]}');

    expect((await screen.findByRole('alert')).textContent).toMatch(/damaged/i);
    expect(store.ledgerView().state.expenses).toHaveLength(1);
  });

  it('takes in a backup from another group as a second group', async () => {
    await launch('/backup');
    await importFile(
      JSON.stringify({
        format: 'gmc/1',
        groupId: 'somewhereelse00',
        groupName: 'Ski trip',
        events: [
          {
            id: 'ffff:0',
            hlc: '001800000000001-0000-ffff',
            groupId: 'somewhereelse00',
            body: { t: 'group.init', name: 'Ski trip', currency: 'CHF' },
          },
        ],
      }),
    );

    // Several groups can live side by side now, so this is an arrival rather
    // than an error — but it must not silently move you off the open one.
    expect((await screen.findByRole('status')).textContent).toMatch(/added/i);
    expect(store.ledgerView().state.group?.name).toBe('Lisbon weekend');
    expect(store.ledgerView().groups.map((group) => group.name)).toContain('Ski trip');
    expect(await screen.findByRole('button', { name: /open that group/i })).toBeDefined();
  });

  it('explains a format it cannot read', async () => {
    await launch('/backup');
    await importFile('{"format":"gmc/99","events":[]}');
    expect((await screen.findByRole('alert')).textContent).toMatch(/update the app/i);
  });
});

describe('an empty group', () => {
  beforeEach(async () => {
    await store.initLedger();
    await act(async () => {
      await store.append(
        { t: 'group.init', name: 'Empty', currency: 'EUR' },
        { t: 'member.add', memberId: 'm0', name: 'Anna' },
      );
    });
  });

  it('invites a first expense rather than showing an empty table', async () => {
    await launch('/');
    expect(await screen.findByText(/no expenses yet/i)).toBeDefined();
  });

  it('does not try to balance nothing', async () => {
    await launch('/balances');
    expect(await screen.findByText(/nothing to balance/i)).toBeDefined();
  });

  it('says everyone is square rather than showing an empty plan', async () => {
    await launch('/settle');
    expect(await screen.findByText(/all square/i)).toBeDefined();
  });
});
