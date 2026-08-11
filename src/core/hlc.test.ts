import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type Hlc,
  compareHlc,
  decodeHlc,
  encodeHlc,
  hlcReceive,
  hlcSend,
  initialHlc,
} from './hlc.js';

const MAX_MILLIS = 10 ** 15 - 1;

const hexString = (maxLength: number) =>
  fc
    .array(fc.constantFrom(...'0123456789abcdef'), { minLength: 1, maxLength })
    .map((chars) => chars.join(''));

const arbHlc: fc.Arbitrary<Hlc> = fc.record({
  millis: fc.integer({ min: 0, max: MAX_MILLIS }),
  counter: fc.integer({ min: 0, max: 0xffff }),
  node: hexString(32),
});

/** Semantic ordering, independent of the encoding. */
function semanticCompare(a: Hlc, b: Hlc): number {
  if (a.millis !== b.millis) return a.millis < b.millis ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  return a.node < b.node ? -1 : a.node > b.node ? 1 : 0;
}

describe('encoding', () => {
  it('pads to a fixed width so string order is numeric order', () => {
    expect(encodeHlc({ millis: 1754899200000, counter: 3, node: 'a91f' })).toBe(
      '001754899200000-0003-a91f',
    );
  });

  it('round-trips', () => {
    fc.assert(
      fc.property(arbHlc, (hlc) => {
        expect(decodeHlc(encodeHlc(hlc))).toEqual(hlc);
      }),
    );
  });

  it('rejects malformed input', () => {
    for (const bad of [
      '',
      '1754899200000-0003-a91f', // millis not padded
      '001754899200000-3-a91f', // counter not padded
      '001754899200000-0003-A91F', // uppercase node
      '001754899200000-0003-xyz', // non-hex node
      '001754899200000-0003', // no node
    ]) {
      expect(() => decodeHlc(bad), bad).toThrow();
    }
  });

  it('refuses out-of-range values rather than emitting an unsortable string', () => {
    expect(() => encodeHlc({ millis: -1, counter: 0, node: 'ab' })).toThrow(RangeError);
    expect(() => encodeHlc({ millis: 0, counter: 0x10000, node: 'ab' })).toThrow(RangeError);
    expect(() => encodeHlc({ millis: 1.5, counter: 0, node: 'ab' })).toThrow(RangeError);
    expect(() => encodeHlc({ millis: 0, counter: 0, node: 'AB' })).toThrow(RangeError);
  });
});

describe('ordering', () => {
  // The property the whole log depends on: sorting encoded strings must give
  // the same order as comparing the clocks by meaning.
  it('lexicographic order matches semantic order', () => {
    fc.assert(
      fc.property(arbHlc, arbHlc, (a, b) => {
        expect(compareHlc(encodeHlc(a), encodeHlc(b))).toBe(semanticCompare(a, b));
      }),
    );
  });

  it('sorting a shuffled batch of encoded clocks recovers the semantic order', () => {
    fc.assert(
      fc.property(fc.array(arbHlc, { minLength: 2, maxLength: 40 }), (clocks) => {
        const byString = [...clocks].map(encodeHlc).sort();
        const bySemantics = [...clocks].sort(semanticCompare).map(encodeHlc);
        expect(byString).toEqual(bySemantics);
      }),
    );
  });
});

describe('hlcSend', () => {
  it('always advances, even when the wall clock jumps backwards', () => {
    fc.assert(
      fc.property(arbHlc, fc.integer({ min: 0, max: MAX_MILLIS }), (local, wall) => {
        const next = hlcSend(local, wall);
        expect(compareHlc(encodeHlc(next), encodeHlc(local))).toBe(1);
      }),
    );
  });

  it('advances a whole sequence monotonically under a frozen clock', () => {
    let clock = initialHlc('beef');
    const stamps: string[] = [];
    for (let i = 0; i < 500; i++) {
      clock = hlcSend(clock, 1754899200000);
      stamps.push(encodeHlc(clock));
    }
    expect(stamps).toEqual([...stamps].sort());
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it('resets the counter once the wall clock moves on', () => {
    const first = hlcSend(initialHlc('beef'), 1000);
    const same = hlcSend(first, 1000);
    const later = hlcSend(same, 1001);
    expect(first.counter).toBe(0);
    expect(same.counter).toBe(1);
    expect(later).toEqual({ millis: 1001, counter: 0, node: 'beef' });
  });

  it('rolls a counter overflow into the next millisecond', () => {
    const saturated: Hlc = { millis: 1000, counter: 0xffff, node: 'beef' };
    expect(hlcSend(saturated, 1000)).toEqual({ millis: 1001, counter: 0, node: 'beef' });
  });
});

describe('hlcReceive', () => {
  it('lands strictly after both the local and the remote clock', () => {
    fc.assert(
      fc.property(
        arbHlc,
        arbHlc,
        fc.integer({ min: 0, max: MAX_MILLIS }),
        (local, remote, wall) => {
          const next = hlcReceive(local, remote, wall);
          expect(compareHlc(encodeHlc(next), encodeHlc(local))).toBe(1);
          expect(compareHlc(encodeHlc(next), encodeHlc(remote))).toBe(1);
        },
      ),
    );
  });

  it('keeps the local node id', () => {
    const next = hlcReceive(initialHlc('aaaa'), { millis: 9, counter: 2, node: 'bbbb' }, 0);
    expect(next.node).toBe('aaaa');
  });

  it('adopts a remote clock that is ahead of a stalled local one', () => {
    const next = hlcReceive(
      { millis: 100, counter: 0, node: 'aaaa' },
      { millis: 900, counter: 4, node: 'bbbb' },
      50,
    );
    expect(next).toEqual({ millis: 900, counter: 5, node: 'aaaa' });
  });

  it('two devices converge to a shared order after exchanging events', () => {
    // Anna's phone is 30 seconds ahead of Marco's.
    let anna = initialHlc('aaaa');
    let marco = initialHlc('bbbb');

    anna = hlcSend(anna, 1_000_000);
    const annaEvent = anna;

    marco = hlcReceive(marco, annaEvent, 970_000);
    marco = hlcSend(marco, 970_100);
    const marcoEvent = marco;

    // Marco's later event sorts after Anna's, despite his slower clock.
    expect(compareHlc(encodeHlc(marcoEvent), encodeHlc(annaEvent))).toBe(1);
  });
});
