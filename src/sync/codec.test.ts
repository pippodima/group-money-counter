import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FRAME_CAPACITY,
  FrameCollector,
  SYNC_VERSION,
  decodeLog,
  encodeLog,
  groupPrefix,
  readFrame,
  toFrames,
} from './codec.js';
import { GROUP_ID, arbLog } from '../testing/ledger.js';
import type { Envelope } from '../core/events.js';

/** Feeds frames to a collector in a given order, returning the last result. */
function collect(frames: Uint8Array[], order?: number[]) {
  const collector = new FrameCollector();
  const sequence = order ?? frames.map((_, i) => i);
  let result = collector.add(frames[sequence[0] as number] as Uint8Array);
  for (const i of sequence.slice(1)) result = collector.add(frames[i] as Uint8Array);
  return result;
}

describe('round trip', () => {
  // The property the whole sync depends on: whatever goes in comes out.
  it('survives encode, framing, scanning and decode, for any ledger', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        const frames = toFrames(encodeLog(log), GROUP_ID);
        const result = collect(frames);
        expect(result.status).toBe('complete');
        if (result.status === 'complete') expect(result.envelopes).toEqual(log);
      }),
    );
  });

  it('does not care what order the frames arrive in', () => {
    fc.assert(
      fc.property(arbLog, fc.integer({ min: 1, max: 400 }), (log, capacity) => {
        // Small capacities force many frames out of a small ledger.
        const frames = toFrames(encodeLog(log), GROUP_ID, capacity + 12);
        const shuffled = frames.map((_, i) => i).sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13));
        const result = collect(frames, shuffled);
        expect(result.status).toBe('complete');
        if (result.status === 'complete') expect(result.envelopes).toEqual(log);
      }),
    );
  });

  it('tolerates the same frame arriving repeatedly', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        const frames = toFrames(encodeLog(log), GROUP_ID, 200);
        // The sender loops forever, so the scanner sees plenty of repeats.
        const order = [...frames.keys(), ...frames.keys(), ...frames.keys()];
        expect(collect(frames, order).status).toBe('complete');
      }),
    );
  });

  it('reports progress until the last frame lands', () => {
    const log: Envelope[] = [
      {
        id: 'aaaa:0',
        hlc: '001700000000001-0000-aaaa',
        groupId: GROUP_ID,
        body: { t: 'group.init', name: 'Trip', currency: 'EUR' },
      },
    ];
    const frames = toFrames(encodeLog(log), GROUP_ID, 24);
    expect(frames.length).toBeGreaterThan(2);

    const collector = new FrameCollector();
    for (let i = 0; i < frames.length - 1; i++) {
      const result = collector.add(frames[i] as Uint8Array);
      expect(result).toEqual({ status: 'partial', have: i + 1, total: frames.length });
    }
    expect(collector.add(frames.at(-1) as Uint8Array).status).toBe('complete');
  });
});

describe('framing', () => {
  it('stamps every frame with the total, so any one reveals the count', () => {
    const frames = toFrames(encodeLog([]), GROUP_ID, 30);
    for (const frame of frames) {
      const read = readFrame(frame);
      expect(read.ok && read.value.total).toBe(frames.length);
    }
  });

  it('keeps a realistic trip to a handful of frames', () => {
    // Guards the sizing claim in DESIGN §7 against future payload growth.
    fc.assert(
      fc.property(arbLog, (log) => {
        expect(toFrames(encodeLog(log), GROUP_ID, FRAME_CAPACITY).length).toBeLessThanOrEqual(4);
      }),
    );
  });

  it('always produces at least one frame, even for an empty ledger', () => {
    expect(toFrames(encodeLog([]), GROUP_ID)).toHaveLength(1);
  });

  it('refuses a capacity too small to carry a header', () => {
    expect(() => toFrames(encodeLog([]), GROUP_ID, 8)).toThrow(RangeError);
  });

  it('derives a stable group prefix, and tolerates a short id', () => {
    expect(groupPrefix('a91f4c2e8b0d1177')).toEqual(Uint8Array.of(0xa9, 0x1f, 0x4c, 0x2e));
    expect(groupPrefix('ab')).toEqual(Uint8Array.of(0xab, 0, 0, 0));
  });
});

describe('refusing bad frames', () => {
  const reject = (bytes: Uint8Array) => {
    const result = new FrameCollector().add(bytes);
    expect(result.status).toBe('rejected');
    return result.status === 'rejected' ? result.problem : '';
  };

  it('rejects a QR code that is not ours', () => {
    expect(reject(new TextEncoder().encode('https://example.com'))).toMatch(/not a ledger/i);
    expect(reject(Uint8Array.of(1, 2, 3))).toMatch(/not a ledger/i);
  });

  it('names the direction of a version mismatch', () => {
    const frame = (toFrames(encodeLog([]), GROUP_ID)[0] as Uint8Array).slice();

    frame[2] = SYNC_VERSION + 1;
    expect(reject(frame)).toMatch(/newer version.*update this one/i);

    frame[2] = SYNC_VERSION - 1;
    expect(reject(frame)).toMatch(/older version/i);
  });

  it('refuses to mix two different groups into one payload', () => {
    const mine = toFrames(encodeLog([]), 'aaaaaaaaaaaaaaaa', 30);
    const theirs = toFrames(encodeLog([]), 'bbbbbbbbbbbbbbbb', 30);

    const collector = new FrameCollector();
    collector.add(mine[0] as Uint8Array);
    const result = collector.add(theirs[0] as Uint8Array);

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.problem).toMatch(/different group/i);
  });

  it('starts over if the sender changes what it is sending', () => {
    const short = toFrames(encodeLog([]), GROUP_ID, 30);
    const collector = new FrameCollector();
    collector.add(short[0] as Uint8Array);

    // Same group, different total: the other phone added an expense mid-scan.
    const longer = toFrames(new Uint8Array(200).fill(7), GROUP_ID, 30);
    const result = collector.add(longer[0] as Uint8Array);

    expect(result.status).toBe('partial');
    if (result.status === 'partial') expect(result.have).toBe(1);
  });

  it('rejects corrupted payload bytes', () => {
    const frames = toFrames(encodeLog([]), GROUP_ID);
    const damaged = (frames[0] as Uint8Array).slice();
    damaged[damaged.length - 1] = (damaged[damaged.length - 1] as number) ^ 0xff;
    damaged[damaged.length - 2] = (damaged[damaged.length - 2] as number) ^ 0xff;
    expect(reject(damaged)).toMatch(/damaged/i);
  });
});

describe('decodeLog', () => {
  it('rejects an event that would poison the log', async () => {
    const { deflateSync } = await import('fflate');
    const payload = deflateSync(
      new TextEncoder().encode(JSON.stringify([{ id: 'bad', hlc: 'nope', groupId: '', body: {} }])),
    );
    const result = decodeLog(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/entry 1 of 1 is damaged/i);
  });

  it('rejects something that is not a list of events', async () => {
    const { deflateSync } = await import('fflate');
    const payload = deflateSync(new TextEncoder().encode('{"not":"a list"}'));
    const result = decodeLog(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/does not hold a ledger/i);
  });
});
