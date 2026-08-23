/**
 * Turning an event log into QR frames and back (DESIGN.md §7).
 *
 *     events → JSON → deflate → chunks → framed bytes → QR
 *
 * The design doc specified CBOR before JSON here. Measured on a realistic
 * two-week trip — 5 people, 120 expenses — CBOR came out **1.9% smaller after
 * deflate**, which does not pay for a dependency. Deflate already collapses
 * the repeated JSON keys that CBOR exists to avoid. See DIARY entry 7.
 *
 * Real numbers from that measurement: 132 events compress to 5,616 bytes,
 * about 42 bytes per event, which is six frames.
 *
 * This lives outside src/core because it depends on fflate, and core may not
 * import anything beyond itself.
 */

import { deflateSync, inflateSync } from 'fflate';
import { type Envelope, isEnvelope } from '../core/events.js';

/** 'G','M' — lets a foreign QR code be rejected before anything else is read. */
const MAGIC = Uint8Array.of(0x47, 0x4d);

/** Bumped only when an older reader could not make sense of a newer frame. */
export const SYNC_VERSION = 1;

const HEADER_BYTES = 11;
const GROUP_PREFIX_BYTES = 4;
const MAX_FRAMES = 0xffff;

/**
 * Payload bytes per frame.
 *
 * Measured, at error-correction level M, with base45 in alphanumeric mode:
 *
 *     bytes    QR version    grid
 *       400        15         77 x 77
 *       600        19         93 x 93
 *       800        23        109 x 109
 *      1100        28        129 x 129
 *      1400        31        141 x 141
 *
 * 800 rather than the 1100 the design doc implied. A 132-event trip needs 8
 * frames instead of 6 — at 4 fps that is 2 seconds a cycle against 1.5, which
 * nobody will notice — and every module is 18% larger, which is the thing
 * that actually decides whether a phone camera reads it across a table, at
 * night, in a restaurant. DESIGN §7's own rule: more frames that scan on the
 * first try beat fewer that do not.
 *
 * Worth revisiting once there is real two-device data.
 */
export const FRAME_CAPACITY = 800;

export type Decoded<T> = { ok: true; value: T } | { ok: false; problem: string };

// ------------------------------------------------------------------ payload

export function encodeLog(envelopes: readonly Envelope[]): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(envelopes));
  return deflateSync(json, { level: 9 });
}

export function decodeLog(payload: Uint8Array): Decoded<Envelope[]> {
  let text: string;
  try {
    text = new TextDecoder().decode(inflateSync(payload));
  } catch {
    return { ok: false, problem: 'The scan came through damaged. Try again.' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'The scan came through damaged. Try again.' };
  }

  if (!Array.isArray(raw)) return { ok: false, problem: 'That code does not hold a ledger.' };

  // Same rule as an imported file: nothing from outside this device enters an
  // append-only log unvalidated, and a damaged batch is refused whole.
  const bad = raw.findIndex((event) => !isEnvelope(event));
  if (bad !== -1) {
    return { ok: false, problem: `Entry ${bad + 1} of ${raw.length} is damaged, so nothing was added.` };
  }

  return { ok: true, value: raw as Envelope[] };
}

// ------------------------------------------------------------------- frames

/** The first 4 bytes of a group id, used to catch two phones syncing different trips. */
export function groupPrefix(groupId: string): Uint8Array {
  const bytes = new Uint8Array(GROUP_PREFIX_BYTES);
  for (let i = 0; i < GROUP_PREFIX_BYTES; i++) {
    const pair = groupId.slice(i * 2, i * 2 + 2);
    bytes[i] = /^[0-9a-f]{2}$/.test(pair) ? parseInt(pair, 16) : 0;
  }
  return bytes;
}

const prefixToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export interface Frame {
  version: number;
  group: string;
  index: number;
  total: number;
  chunk: Uint8Array;
}

/**
 * Splits a payload into framed chunks.
 *
 * Every frame carries the total, so a scanner knows how many to expect from
 * whichever one it happens to catch first.
 */
export function toFrames(
  payload: Uint8Array,
  groupId: string,
  capacity = FRAME_CAPACITY,
): Uint8Array[] {
  const room = capacity - HEADER_BYTES;
  if (room < 1) throw new RangeError(`frame capacity ${capacity} leaves no room for payload`);

  const total = Math.max(1, Math.ceil(payload.length / room));
  if (total > MAX_FRAMES) throw new RangeError(`ledger needs ${total} frames, more than ${MAX_FRAMES}`);

  const prefix = groupPrefix(groupId);

  return Array.from({ length: total }, (_, index) => {
    const chunk = payload.subarray(index * room, (index + 1) * room);
    const frame = new Uint8Array(HEADER_BYTES + chunk.length);
    frame.set(MAGIC, 0);
    frame[2] = SYNC_VERSION;
    frame.set(prefix, 3);
    new DataView(frame.buffer).setUint16(7, index, false);
    new DataView(frame.buffer).setUint16(9, total, false);
    frame.set(chunk, HEADER_BYTES);
    return frame;
  });
}

export function readFrame(bytes: Uint8Array): Decoded<Frame> {
  if (bytes.length < HEADER_BYTES) return { ok: false, problem: 'That code is not a ledger.' };
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]) {
    return { ok: false, problem: 'That code is not a ledger.' };
  }

  const version = bytes[2] as number;
  if (version !== SYNC_VERSION) {
    return {
      ok: false,
      problem:
        version > SYNC_VERSION
          ? 'That phone is running a newer version. Update this one and try again.'
          : 'That phone is running an older version. Update it and try again.',
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const index = view.getUint16(7, false);
  const total = view.getUint16(9, false);
  if (total === 0 || index >= total) return { ok: false, problem: 'The scan came through damaged. Try again.' };

  return {
    ok: true,
    value: {
      version,
      group: prefixToHex(bytes.subarray(3, 7)),
      index,
      total,
      chunk: bytes.subarray(HEADER_BYTES),
    },
  };
}

// ---------------------------------------------------------------- collecting

export type Collected =
  | { status: 'partial'; have: number; total: number }
  | { status: 'complete'; envelopes: Envelope[] }
  | { status: 'rejected'; problem: string };

/**
 * Gathers frames until a payload is complete.
 *
 * Frames arrive in whatever order the camera happens to catch them, and the
 * sender loops indefinitely — so a missed frame is not an error, it simply
 * comes round again. That is what removes all handshaking from the protocol.
 */
export class FrameCollector {
  private chunks = new Map<number, Uint8Array>();
  private expected: number | undefined;
  private group: string | undefined;

  get have(): number {
    return this.chunks.size;
  }

  get total(): number | undefined {
    return this.expected;
  }

  /** The group these frames belong to, once any frame has been read. */
  get groupPrefix(): string | undefined {
    return this.group;
  }

  reset(): void {
    this.chunks.clear();
    this.expected = undefined;
    this.group = undefined;
  }

  add(bytes: Uint8Array): Collected {
    const frame = readFrame(bytes);
    if (!frame.ok) return { status: 'rejected', problem: frame.problem };

    const { group, index, total, chunk } = frame.value;

    // Two different ledgers cannot be interleaved into one payload; the
    // likeliest cause is scanning the wrong phone mid-sync.
    if (this.group !== undefined && this.group !== group) {
      return { status: 'rejected', problem: 'That code is from a different group.' };
    }
    if (this.expected !== undefined && this.expected !== total) {
      this.reset();
    }

    this.group = group;
    this.expected = total;
    this.chunks.set(index, chunk);

    if (this.chunks.size < total) {
      return { status: 'partial', have: this.chunks.size, total };
    }

    const size = Array.from(this.chunks.values()).reduce((sum, part) => sum + part.length, 0);
    const payload = new Uint8Array(size);
    let offset = 0;
    for (let i = 0; i < total; i++) {
      const part = this.chunks.get(i) as Uint8Array;
      payload.set(part, offset);
      offset += part.length;
    }

    const decoded = decodeLog(payload);
    return decoded.ok
      ? { status: 'complete', envelopes: decoded.value }
      : { status: 'rejected', problem: decoded.problem };
  }
}
