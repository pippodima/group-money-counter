/**
 * The live ledger: events on disk, folded state in memory.
 *
 * A single module-level store rather than React context — there is exactly
 * one ledger per app, and `useSyncExternalStore` gives components a
 * consistent view of it without a provider tree.
 *
 * Every mutation goes through `append`, which stamps events with the local
 * clock, writes them, and refolds. There is no other way to change state.
 */

import { useSyncExternalStore } from 'react';
import { type Envelope, type Event, envelopeId, nextSeq } from '../core/events.js';
import { fold, groupsIn } from '../core/fold.js';
import { type Hlc, decodeHlc, encodeHlc, hlcReceive, hlcSend, initialHlc } from '../core/hlc.js';
import { EMPTY_STATE, type GroupId, type LedgerState } from '../core/types.js';
import { appendEvents, readAllEvents } from '../db/database.js';
import { getDeviceId } from '../db/device.js';

export interface LedgerView {
  ready: boolean;
  /** Undefined until the first group.init event exists. */
  groupId: GroupId | undefined;
  state: LedgerState;
  deviceId: string;
  eventCount: number;
  error: string | undefined;
}

let envelopes: Envelope[] = [];
let clock: Hlc = initialHlc('0');
let deviceId = '';
let groupId: GroupId | undefined;

let view: LedgerView = {
  ready: false,
  groupId: undefined,
  state: EMPTY_STATE,
  deviceId: '',
  eventCount: 0,
  error: undefined,
};

const listeners = new Set<() => void>();

function publish(error?: string): void {
  view = {
    ready: true,
    groupId,
    state: groupId ? fold(envelopes, groupId) : EMPTY_STATE,
    deviceId,
    eventCount: envelopes.length,
    error,
  };
  for (const listener of listeners) listener();
}

/** Random lowercase hex. Short on purpose — ids ride along in every QR frame. */
export function newId(bytes = 8): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Loads the log and seeds the clock.
 *
 * The clock is recovered from the highest HLC in the log rather than stored
 * separately, so it stays monotonic across restarts without a second piece of
 * state that could fall out of step with the events.
 */
export async function initLedger(): Promise<void> {
  try {
    deviceId = await getDeviceId();
    envelopes = (await readAllEvents()) as Envelope[];

    const highest = envelopes.reduce((max, envelope) => (envelope.hlc > max ? envelope.hlc : max), '');
    clock = highest
      ? hlcReceive(initialHlc(deviceId), decodeHlc(highest), Date.now())
      : initialHlc(deviceId);

    groupId = groupsIn(envelopes)[0];
    publish();
  } catch (cause) {
    view = {
      ...view,
      ready: true,
      error: cause instanceof Error ? cause.message : String(cause),
    };
    for (const listener of listeners) listener();
  }
}

/**
 * Appends events to the log, atomically as far as the caller is concerned.
 *
 * Several events are often one user action — creating a group also adds its
 * members — so they are stamped and written together.
 */
export async function append(...events: readonly Event[]): Promise<void> {
  if (events.length === 0) return;

  const target = groupId ?? newId();
  let seq = nextSeq(envelopes, deviceId);

  const fresh = events.map((body) => {
    clock = hlcSend(clock, Date.now());
    return {
      id: envelopeId(deviceId, seq++),
      hlc: encodeHlc(clock),
      groupId: target,
      body,
    } satisfies Envelope;
  });

  await appendEvents(fresh);
  envelopes = [...envelopes, ...fresh];
  groupId = target;
  publish();
}

/**
 * Merges a log from elsewhere — an import, or later a QR scan.
 *
 * Returns how many events were new. The local clock is advanced past
 * everything observed, so anything stamped afterwards sorts correctly against
 * the events just learned.
 */
export async function merge(incoming: readonly Envelope[]): Promise<number> {
  const known = new Set(envelopes.map((envelope) => envelope.id));
  const fresh = incoming.filter((envelope) => !known.has(envelope.id));
  if (fresh.length === 0) return 0;

  const now = Date.now();
  for (const envelope of fresh) clock = hlcReceive(clock, decodeHlc(envelope.hlc), now);

  await appendEvents(fresh);
  envelopes = [...envelopes, ...fresh];
  groupId ??= groupsIn(envelopes)[0];
  publish();

  return fresh.length;
}

/** The whole log, for export. */
export function allEnvelopes(): readonly Envelope[] {
  return envelopes;
}

/** The current view outside React — for export, sync, and tests. */
export function ledgerView(): LedgerView {
  return view;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLedger(): LedgerView {
  return useSyncExternalStore(
    subscribe,
    () => view,
    () => view,
  );
}
