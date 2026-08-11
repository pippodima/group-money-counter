/**
 * IndexedDB access. The event log is the only durable truth; groups,
 * expenses and balances are all derived by folding it (DESIGN.md §9).
 *
 * This layer is deliberately thin and dumb. It stores and retrieves
 * envelopes; it never interprets them.
 */

import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

const DB_NAME = 'group-money-counter';
const DB_VERSION = 1;

/** An event envelope exactly as it sits on disk. */
export interface StoredEnvelope {
  /** `${deviceId}:${seq}` — unique without any coordination between devices. */
  id: string;
  /** Encoded HLC. Sortable as a plain string. */
  hlc: string;
  groupId: string;
  /** The event itself. Opaque here; interpreted by src/core. */
  body: unknown;
}

interface Schema extends DBSchema {
  events: {
    key: string;
    value: StoredEnvelope;
    indexes: { 'by-group-hlc': [string, string] };
  };
  meta: {
    key: string;
    value: unknown;
  };
}

let handle: Promise<IDBPDatabase<Schema>> | undefined;

export function db(): Promise<IDBPDatabase<Schema>> {
  handle ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const events = database.createObjectStore('events', { keyPath: 'id' });
      events.createIndex('by-group-hlc', ['groupId', 'hlc']);
      database.createObjectStore('meta');
    },
  });
  return handle;
}

// ------------------------------------------------------------------ meta

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get('meta', key) as Promise<T | undefined>;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}

// ---------------------------------------------------------------- events

/** Every envelope for a group, already ordered by HLC. */
export async function readEvents(groupId: string): Promise<StoredEnvelope[]> {
  return (await db()).getAllFromIndex(
    'events',
    'by-group-hlc',
    IDBKeyRange.bound([groupId, ''], [groupId, '￿']),
  );
}

export async function readAllEvents(): Promise<StoredEnvelope[]> {
  return (await db()).getAll('events');
}

/**
 * Writes envelopes, skipping any already present.
 *
 * Events are immutable, so two envelopes sharing an id are identical and
 * there is nothing to reconcile — which is what makes merging a set union
 * (DESIGN.md §3). Existing rows are left untouched rather than overwritten so
 * that a corrupted incoming copy can never clobber a good local one.
 *
 * Returns the ids actually added, which the merge summary reports to the user.
 */
export async function appendEvents(envelopes: readonly StoredEnvelope[]): Promise<string[]> {
  if (envelopes.length === 0) return [];

  const tx = (await db()).transaction('events', 'readwrite');
  const store = tx.objectStore('events');
  const added: string[] = [];

  await Promise.all(
    envelopes.map(async (envelope) => {
      if ((await store.getKey(envelope.id)) === undefined) {
        await store.put(envelope);
        added.push(envelope.id);
      }
    }),
  );

  await tx.done;
  return added;
}

export async function countEvents(): Promise<number> {
  return (await db()).count('events');
}
