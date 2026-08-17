import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BACKUP_FORMAT,
  backupFilename,
  buildBackup,
  parseBackup,
  serialiseBackup,
} from './backup.js';
import { fold } from '../core/fold.js';
import { arbLog, GROUP_ID } from '../testing/ledger.js';

const roundTrip = (text: string) => parseBackup(text);

describe('round trip', () => {
  it('survives export and import unchanged, for any ledger', () => {
    fc.assert(
      fc.property(arbLog, (log) => {
        const text = serialiseBackup(buildBackup(GROUP_ID, 'Trip', log));
        const parsed = roundTrip(text);

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        expect(parsed.backup.events).toEqual(log);
        // The point of the exercise: the same ledger comes back out.
        expect(fold(parsed.backup.events)).toEqual(fold(log));
      }),
    );
  });

  it('carries the group name through', () => {
    const log = [
      {
        id: 'aaaa:0',
        hlc: '001700000000001-0000-aaaa',
        groupId: 'g1',
        body: { t: 'group.init' as const, name: 'Lisbon', currency: 'EUR' },
      },
    ];
    const parsed = roundTrip(serialiseBackup(buildBackup('g1', 'Lisbon weekend', log)));
    expect(parsed.ok && parsed.backup.groupName).toBe('Lisbon weekend');
  });
});

describe('refusing bad files', () => {
  const refuse = (text: string) => {
    const result = parseBackup(text);
    expect(result.ok).toBe(false);
    return result.ok ? '' : result.problem;
  };

  it('rejects things that are not JSON', () => {
    expect(refuse('not json at all')).toMatch(/valid JSON/i);
    expect(refuse('')).toMatch(/valid JSON/i);
  });

  it('rejects JSON that is not a backup', () => {
    expect(refuse('[1,2,3]')).toMatch(/doesn't look like a backup/i);
    expect(refuse('{"hello":"world"}')).toMatch(/doesn't look like a backup/i);
  });

  it('explains a version it cannot read', () => {
    expect(refuse('{"format":"gmc/2","events":[]}')).toMatch(/format 2.*reads 1|Update the app/i);
  });

  it('says plainly when the file came from another app', () => {
    expect(refuse('{"format":"splitwise/1","events":[]}')).toMatch(/different app/i);
  });

  it('rejects a file with no events', () => {
    expect(refuse(`{"format":"${BACKUP_FORMAT}","events":[]}`)).toMatch(/no events/i);
  });

  it('names the damaged entry and imports nothing', () => {
    const good = {
      id: 'aaaa:0',
      hlc: '001700000000001-0000-aaaa',
      groupId: 'g1',
      body: { t: 'group.init', name: 'Trip', currency: 'EUR' },
    };
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      events: [good, { ...good, id: 'aaaa:1', body: { t: 'nonsense' } }],
    });
    expect(refuse(text)).toMatch(/entry 2 of 2 is damaged/i);
  });

  it('rejects an expense whose split is malformed', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      events: [
        {
          id: 'aaaa:0',
          hlc: '001700000000001-0000-aaaa',
          groupId: 'g1',
          body: {
            t: 'expense.create',
            expenseId: 'e1',
            fields: {
              description: 'Dinner',
              totalCents: 1000,
              date: '2026-08-11',
              payers: [{ memberId: 'm0', amountCents: 1000 }],
              split: { mode: 'weights', weights: { m0: 'lots' }, display: 'shares' },
            },
          },
        },
      ],
    });
    expect(refuse(text)).toMatch(/damaged/i);
  });

  it('rejects amounts that are not whole cents', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      events: [
        {
          id: 'aaaa:0',
          hlc: '001700000000001-0000-aaaa',
          groupId: 'g1',
          body: {
            t: 'expense.create',
            expenseId: 'e1',
            fields: {
              description: 'Dinner',
              totalCents: 10.5,
              date: '2026-08-11',
              payers: [{ memberId: 'm0', amountCents: 10.5 }],
              split: { mode: 'equal', among: ['m0'] },
            },
          },
        },
      ],
    });
    expect(refuse(text)).toMatch(/damaged/i);
  });

  it('rejects a malformed clock, which would break ordering', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      events: [
        {
          id: 'aaaa:0',
          hlc: 'yesterday',
          groupId: 'g1',
          body: { t: 'group.init', name: 'Trip', currency: 'EUR' },
        },
      ],
    });
    expect(refuse(text)).toMatch(/damaged/i);
  });

  it('refuses a file holding more than one group', () => {
    const event = (groupId: string, id: string) => ({
      id,
      hlc: `00170000000000${id.slice(-1)}-0000-aaaa`,
      groupId,
      body: { t: 'group.init', name: 'Trip', currency: 'EUR' },
    });
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      events: [event('g1', 'aaaa:0'), event('g2', 'aaaa:1')],
    });
    expect(refuse(text)).toMatch(/more than one group/i);
  });

  it('accepts a partial expense patch', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      events: [
        {
          id: 'aaaa:0',
          hlc: '001700000000001-0000-aaaa',
          groupId: 'g1',
          body: { t: 'expense.update', expenseId: 'e1', patch: { description: 'Later dinner' } },
        },
      ],
    });
    expect(parseBackup(text).ok).toBe(true);
  });
});

describe('backupFilename', () => {
  it('slugifies the group name and stamps the day', () => {
    expect(backupFilename('Lisbon weekend', new Date('2026-08-14T10:00:00Z'))).toBe(
      'lisbon-weekend-2026-08-14.gmc.json',
    );
  });

  it('copes with names that slugify to nothing', () => {
    expect(backupFilename('  ***  ', new Date('2026-08-14T10:00:00Z'))).toBe(
      'ledger-2026-08-14.gmc.json',
    );
  });

  it('handles accents and punctuation without producing a broken name', () => {
    const name = backupFilename('Café & Bar — Ibiza!', new Date('2026-08-14T10:00:00Z'));
    expect(name).toMatch(/^[a-z0-9-]+-2026-08-14\.gmc\.json$/);
  });
});
