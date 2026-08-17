import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type Envelope,
  isEnvelope,
  isEvent,
  mergeEnvelopes,
  nextSeq,
  parseEnvelopeId,
} from './events.js';
import { arbLog } from '../testing/ledger.js';

describe('isEnvelope', () => {
  // The failure that would matter most: a validator strict enough to reject
  // the app's own output would make every backup unreadable.
  it('accepts everything this app produces', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        for (const envelope of log) expect(isEnvelope(envelope), JSON.stringify(envelope)).toBe(true);
      }),
    );
  });

  it('survives a round trip through JSON', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        for (const envelope of JSON.parse(JSON.stringify(log))) {
          expect(isEnvelope(envelope)).toBe(true);
        }
      }),
    );
  });

  const valid = {
    id: 'aaaa:0',
    hlc: '001700000000001-0000-aaaa',
    groupId: 'g1',
    body: { t: 'group.init', name: 'Trip', currency: 'EUR' },
  };

  it('rejects a missing or malformed envelope shell', () => {
    for (const broken of [
      null,
      [],
      'string',
      {},
      { ...valid, id: 'no-colon' },
      { ...valid, id: 'AAAA:0' }, // device ids are lowercase hex
      { ...valid, hlc: '1700000000001-0000-aaaa' }, // millis not padded
      { ...valid, hlc: 'yesterday' },
      { ...valid, groupId: '' },
      { ...valid, body: undefined },
    ]) {
      expect(isEnvelope(broken), JSON.stringify(broken)).toBe(false);
    }
  });
});

describe('isEvent', () => {
  it('rejects an unknown event type', () => {
    expect(isEvent({ t: 'expense.explode', expenseId: 'e1' })).toBe(false);
    expect(isEvent({ t: 'group.init' })).toBe(false);
  });

  it('rejects a split it could not later compute', () => {
    const withSplit = (split: unknown) => ({
      t: 'expense.create',
      expenseId: 'e1',
      fields: {
        description: 'Dinner',
        totalCents: 1000,
        date: '2026-08-11',
        payers: [{ memberId: 'm0', amountCents: 1000 }],
        split,
      },
    });

    expect(isEvent(withSplit({ mode: 'equal', among: ['m0'] }))).toBe(true);
    expect(isEvent(withSplit({ mode: 'equal', among: 'm0' }))).toBe(false);
    expect(isEvent(withSplit({ mode: 'weights', weights: { m0: -1 }, display: 'shares' }))).toBe(
      false,
    );
    expect(isEvent(withSplit({ mode: 'weights', weights: { m0: 1 }, display: 'lots' }))).toBe(false);
    expect(isEvent(withSplit({ mode: 'exact', amounts: { m0: 10.5 } }))).toBe(false);
    expect(isEvent(withSplit({ mode: 'guess' }))).toBe(false);
  });

  it('rejects a date that is not a calendar day', () => {
    expect(
      isEvent({
        t: 'settlement.create',
        settlementId: 's1',
        fields: {
          fromMemberId: 'm0',
          toMemberId: 'm1',
          amountCents: 100,
          date: 'tuesday',
          note: '',
        },
      }),
    ).toBe(false);
  });

  it('accepts a patch carrying only some of the fields', () => {
    expect(isEvent({ t: 'expense.update', expenseId: 'e1', patch: {} })).toBe(true);
    expect(isEvent({ t: 'expense.update', expenseId: 'e1', patch: { totalCents: 500 } })).toBe(true);
    expect(isEvent({ t: 'expense.update', expenseId: 'e1', patch: { totalCents: 'lots' } })).toBe(
      false,
    );
  });
});

describe('envelope ids', () => {
  it('round-trips device and sequence', () => {
    expect(parseEnvelopeId('a91f4c2e:17')).toEqual({ deviceId: 'a91f4c2e', seq: 17 });
  });

  it('hands out a sequence that no existing event uses', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        const next = nextSeq(log, 'aaaa');
        expect(log.some((envelope) => envelope.id === `aaaa:${next}`)).toBe(false);
      }),
    );
  });

  it('starts at zero for a device that has written nothing', () => {
    expect(nextSeq([], 'beef')).toBe(0);
  });
});

describe('mergeEnvelopes', () => {
  it('keeps the first copy of a repeated id', () => {
    const copy = (name: string): Envelope => ({
      id: 'aaaa:0',
      hlc: '001700000000001-0000-aaaa',
      groupId: 'g1',
      body: { t: 'group.rename', name },
    });

    // Events are immutable, so a shared id can only mean one copy is corrupt.
    // Preferring the one already held means a bad import cannot displace it.
    const merged = mergeEnvelopes([copy('Mine')], [copy('Theirs')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.body).toEqual({ t: 'group.rename', name: 'Mine' });
  });
});
