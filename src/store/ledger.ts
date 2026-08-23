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
import { appendEvents, getMeta, readAllEvents, setMeta } from '../db/database.js';
import { getDeviceId } from '../db/device.js';

/** Enough of a group to list and pick it, without folding it twice. */
export interface GroupSummary {
  id: GroupId;
  name: string;
  currency: string;
  expenses: number;
}

export interface LedgerView {
  ready: boolean;
  /** The group being looked at. Undefined only when there are none. */
  groupId: GroupId | undefined;
  /** Every group on this device, oldest first. */
  groups: GroupSummary[];
  state: LedgerState;
  deviceId: string;
  /** Events in the active group. */
  eventCount: number;
  error: string | undefined;
}

/** Remembers which group was open, so a relaunch returns to it. */
const ACTIVE_GROUP = 'activeGroup';

let envelopes: Envelope[] = [];
let clock: Hlc = initialHlc('0');
let deviceId = '';
let groupId: GroupId | undefined;

let view: LedgerView = {
  ready: false,
  groupId: undefined,
  groups: [],
  state: EMPTY_STATE,
  deviceId: '',
  eventCount: 0,
  error: undefined,
};

const listeners = new Set<() => void>();

function publish(error?: string): void {
  // core's groupsIn sorts by id, which is canonical but random-looking — ids
  // are random hex, so the list order would shuffle between groups. Ordering
  // by each group's earliest event puts them in the order they were started.
  const firstSeen = new Map<GroupId, string>();
  for (const envelope of envelopes) {
    const seen = firstSeen.get(envelope.groupId);
    if (seen === undefined || envelope.hlc < seen) firstSeen.set(envelope.groupId, envelope.hlc);
  }

  const ids = groupsIn(envelopes).sort((a, b) => {
    const left = firstSeen.get(a) ?? '';
    const right = firstSeen.get(b) ?? '';
    return left < right ? -1 : left > right ? 1 : 0;
  });

  const groups = ids.map((id): GroupSummary => {
    const state = fold(envelopes, id);
    return {
      id,
      name: state.group?.name ?? 'Untitled group',
      currency: state.group?.currency ?? 'EUR',
      expenses: state.expenses.filter((expense) => !expense.deleted).length,
    };
  });

  // A remembered group can vanish only if the database was cleared between
  // sessions; fall back rather than showing an empty ledger for a live one.
  if (groupId !== undefined && !ids.includes(groupId)) groupId = undefined;
  groupId ??= ids[0];

  view = {
    ready: true,
    groupId,
    groups,
    state: groupId ? fold(envelopes, groupId) : EMPTY_STATE,
    deviceId,
    eventCount: groupId
      ? envelopes.filter((envelope) => envelope.groupId === groupId).length
      : 0,
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

    groupId = await getMeta<GroupId>(ACTIVE_GROUP);
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

/** Switches which group the app is looking at, and remembers the choice. */
export async function setActiveGroup(id: GroupId): Promise<void> {
  groupId = id;
  await setMeta(ACTIVE_GROUP, id);
  publish();
}

/**
 * Starts a new group and makes it active.
 *
 * The id is minted here rather than inside `append`, so that the very first
 * events already belong to it — otherwise creating a second group would file
 * its `group.init` under the first.
 */
export async function createGroup(
  name: string,
  currency: string,
  memberNames: readonly string[],
): Promise<GroupId> {
  const id = newId();
  groupId = id;
  await setMeta(ACTIVE_GROUP, id);
  await append(
    { t: 'group.init', name, currency },
    ...memberNames.map((memberName): Event => ({
      t: 'member.add',
      memberId: newId(6),
      name: memberName,
    })),
  );
  return id;
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
  if (groupId !== target) {
    groupId = target;
    await setMeta(ACTIVE_GROUP, target);
  }
  publish();
}

/** What a merge actually changed, for reporting back to the user. */
export interface MergeResult {
  events: number;
  expenses: number;
  settlements: number;
  members: number;
  /** The group the events landed in, which need not be the active one. */
  groupId: GroupId | undefined;
  /** True when this device had never seen that group before. */
  isNewGroup: boolean;
}

const NOTHING_MERGED: MergeResult = {
  events: 0,
  expenses: 0,
  settlements: 0,
  members: 0,
  groupId: undefined,
  isNewGroup: false,
};

/**
 * Merges a log from elsewhere — an import, or later a QR scan.
 *
 * The local clock is advanced past everything observed, so anything stamped
 * afterwards sorts correctly against the events just learned.
 *
 * Mechanical by design: it stores what it is given and reports what changed.
 * Deciding whether a log *should* be merged — whether it belongs to this
 * group at all — is the caller's business, because an import and a scan want
 * to ask the user different things about it.
 */
export async function merge(incoming: readonly Envelope[]): Promise<MergeResult> {
  const known = new Set(envelopes.map((envelope) => envelope.id));
  const fresh = incoming.filter((envelope) => !known.has(envelope.id));
  if (fresh.length === 0) return NOTHING_MERGED;

  // Counts are reported for the group the events belong to, which is not
  // necessarily the one on screen — a scan can carry a group this device has
  // never seen, and "added 0 expenses" would be a lie about it.
  const target = fresh[0]?.groupId;
  const isNewGroup = target !== undefined && !groupsIn(envelopes).includes(target);
  const before = target ? fold(envelopes, target) : EMPTY_STATE;

  const now = Date.now();
  for (const envelope of fresh) clock = hlcReceive(clock, decodeHlc(envelope.hlc), now);

  await appendEvents(fresh);
  envelopes = [...envelopes, ...fresh];
  publish();

  const after = target ? fold(envelopes, target) : EMPTY_STATE;
  return {
    events: fresh.length,
    expenses: after.expenses.length - before.expenses.length,
    settlements: after.settlements.length - before.settlements.length,
    members: after.members.length - before.members.length,
    groupId: target,
    isNewGroup,
  };
}

/** The whole log across every group. */
export function allEnvelopes(): readonly Envelope[] {
  return envelopes;
}

/**
 * Just the active group's events — what export and sync should send.
 *
 * Sharing the whole log would hand someone every other group on the device,
 * which is nobody's intention when they tap "show my ledger".
 */
export function activeEnvelopes(): readonly Envelope[] {
  return groupId === undefined
    ? []
    : envelopes.filter((envelope) => envelope.groupId === groupId);
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
