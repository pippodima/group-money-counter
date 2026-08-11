/**
 * Hybrid logical clock.
 *
 * Phone clocks drift, and two devices will disagree about which edit came
 * last. An HLC keeps wall-clock meaning — so a log sorts roughly
 * chronologically and stays human-debuggable — while guaranteeing a total
 * order that every device agrees on.
 *
 * Encoded form is lexicographically sortable, so ordering a log is a plain
 * string compare and IndexedDB can index it directly:
 *
 *     000001754899200000-0003-a91f4c2e8b0d1177
 *     └── millis, 15 digits ┘ └cnt┘ └── node ──┘
 *
 * Every function here is pure. The wall clock is passed in rather than read,
 * which is what keeps src/core deterministic (DESIGN.md §4) and lets tests
 * drive time directly.
 */

export interface Hlc {
  /** Epoch milliseconds, as agreed by the logical clock — not the wall clock. */
  readonly millis: number;
  /** Disambiguates events within the same millisecond. */
  readonly counter: number;
  /** Device id: lowercase hex, no separators. */
  readonly node: string;
}

/** An `Hlc` in its encoded, sortable form. */
export type HlcString = string;

const MILLIS_DIGITS = 15;
const MAX_MILLIS = 10 ** MILLIS_DIGITS - 1;
const COUNTER_DIGITS = 4;
const MAX_COUNTER = 0xffff;

const PATTERN = /^(\d{15})-([0-9a-f]{4})-([0-9a-f]{1,32})$/;

export function encodeHlc(hlc: Hlc): HlcString {
  if (!Number.isInteger(hlc.millis) || hlc.millis < 0 || hlc.millis > MAX_MILLIS) {
    throw new RangeError(`hlc millis out of range: ${hlc.millis}`);
  }
  if (!Number.isInteger(hlc.counter) || hlc.counter < 0 || hlc.counter > MAX_COUNTER) {
    throw new RangeError(`hlc counter out of range: ${hlc.counter}`);
  }
  if (!/^[0-9a-f]{1,32}$/.test(hlc.node)) {
    throw new RangeError(`hlc node must be lowercase hex: ${hlc.node}`);
  }
  const millis = String(hlc.millis).padStart(MILLIS_DIGITS, '0');
  const counter = hlc.counter.toString(16).padStart(COUNTER_DIGITS, '0');
  return `${millis}-${counter}-${hlc.node}`;
}

export function decodeHlc(encoded: HlcString): Hlc {
  const match = PATTERN.exec(encoded);
  if (!match) throw new SyntaxError(`malformed hlc: ${encoded}`);
  const [, millis, counter, node] = match as unknown as [string, string, string, string];
  return { millis: Number(millis), counter: parseInt(counter, 16), node };
}

/**
 * Orders two encoded clocks. Equivalent to a plain string comparison — which
 * is the entire point of the encoding — but named so call sites read clearly.
 */
export function compareHlc(a: HlcString, b: HlcString): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rolls a counter overflow into the next millisecond.
 *
 * Only reachable if a device emits 65,536 events inside one millisecond, which
 * this app will never do. Advancing rather than throwing means that even if it
 * somehow happened, the clock stays monotonic instead of bricking the app; it
 * self-corrects as soon as the wall clock catches up.
 */
function normalise(millis: number, counter: number, node: string): Hlc {
  return counter > MAX_COUNTER ? { millis: millis + 1, counter: 0, node } : { millis, counter, node };
}

/**
 * Advances the local clock to stamp a new local event.
 *
 * Guaranteed to return a clock strictly greater than `local`, even if the wall
 * clock has jumped backwards — which happens on real phones after an NTP
 * correction or a manual time change.
 */
export function hlcSend(local: Hlc, wallMillis: number): Hlc {
  const millis = Math.max(local.millis, wallMillis);
  const counter = millis === local.millis ? local.counter + 1 : 0;
  return normalise(millis, counter, local.node);
}

/**
 * Advances the local clock on learning of a remote event, so that anything
 * stamped afterwards sorts after the event just observed.
 *
 * Call this for every incoming event during a merge, before folding.
 */
export function hlcReceive(local: Hlc, remote: Hlc, wallMillis: number): Hlc {
  const millis = Math.max(local.millis, remote.millis, wallMillis);

  let counter: number;
  if (millis === local.millis && millis === remote.millis) {
    counter = Math.max(local.counter, remote.counter) + 1;
  } else if (millis === local.millis) {
    counter = local.counter + 1;
  } else if (millis === remote.millis) {
    counter = remote.counter + 1;
  } else {
    // The wall clock is ahead of both; start the millisecond fresh.
    counter = 0;
  }

  return normalise(millis, counter, local.node);
}

/** The clock a device starts life with. */
export function initialHlc(node: string): Hlc {
  return { millis: 0, counter: 0, node };
}
