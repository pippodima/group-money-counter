import { describe, expect, it } from 'vitest';
import { isValidDay, validateExpense, validateSettlement } from './validate.js';
import type { ExpenseFields, SettlementFields } from './types.js';

const KNOWN = new Set(['m0', 'm1', 'm2']);

const expense = (overrides: Partial<ExpenseFields> = {}): ExpenseFields => ({
  description: 'Dinner',
  totalCents: 3000,
  date: '2026-08-11',
  payers: [{ memberId: 'm0', amountCents: 3000 }],
  split: { mode: 'equal', among: ['m0', 'm1'] },
  ...overrides,
});

const settlement = (overrides: Partial<SettlementFields> = {}): SettlementFields => ({
  fromMemberId: 'm1',
  toMemberId: 'm0',
  amountCents: 1500,
  date: '2026-08-11',
  note: '',
  ...overrides,
});

describe('isValidDay', () => {
  it('accepts real dates', () => {
    for (const day of ['2026-08-11', '2024-02-29', '2000-02-29', '1999-12-31']) {
      expect(isValidDay(day), day).toBe(true);
    }
  });

  it('rejects dates that only look real', () => {
    for (const day of [
      '2026-02-31', // Date would roll this into March
      '2026-02-30',
      '2025-02-29', // not a leap year
      '1900-02-29', // century, not a leap year
      '2026-13-01',
      '2026-00-10',
      '2026-08-32',
      '2026-08-00',
      '2026-8-11', // unpadded
      '11-08-2026',
      '',
      'yesterday',
    ]) {
      expect(isValidDay(day), day).toBe(false);
    }
  });
});

describe('validateExpense', () => {
  it('accepts a well-formed expense', () => {
    expect(validateExpense(expense(), KNOWN)).toEqual([]);
  });

  it('requires the payers to add up to the total', () => {
    const problems = validateExpense(
      expense({ payers: [{ memberId: 'm0', amountCents: 2500 }] }),
      KNOWN,
    );
    expect(problems).toContain('The payers contributed 2500 cents but the total is 3000.');
  });

  it('says which way an exact split is out, and by how much', () => {
    expect(
      validateExpense(expense({ split: { mode: 'exact', amounts: { m0: 1000, m1: 1500 } } }), KNOWN),
    ).toContain('The amounts are 500 cents short of the total.');

    expect(
      validateExpense(expense({ split: { mode: 'exact', amounts: { m0: 2000, m1: 1500 } } }), KNOWN),
    ).toContain('The amounts are 500 cents over the total.');
  });

  it('accepts an exact split that balances', () => {
    expect(
      validateExpense(expense({ split: { mode: 'exact', amounts: { m0: 1500, m1: 1500 } } }), KNOWN),
    ).toEqual([]);
  });

  it('rejects amounts that are not whole cents', () => {
    expect(validateExpense(expense({ totalCents: 30.5 }), KNOWN)).toContain(
      'The total must be a whole number of cents, greater than zero.',
    );
  });

  it('rejects a free or negative expense', () => {
    expect(validateExpense(expense({ totalCents: 0 }), KNOWN).length).toBeGreaterThan(0);
    expect(validateExpense(expense({ totalCents: -100 }), KNOWN).length).toBeGreaterThan(0);
  });

  it('rejects unknown people', () => {
    expect(
      validateExpense(expense({ payers: [{ memberId: 'ghost', amountCents: 3000 }] }), KNOWN),
    ).toContain('Unknown payer: ghost');

    expect(
      validateExpense(expense({ split: { mode: 'equal', among: ['m0', 'ghost'] } }), KNOWN),
    ).toContain('Unknown member in split: ghost');
  });

  it('rejects an empty split', () => {
    expect(validateExpense(expense({ split: { mode: 'equal', among: [] } }), KNOWN)).toContain(
      'The split must include at least one person.',
    );
  });

  it('rejects shares that are all zero', () => {
    expect(
      validateExpense(
        expense({ split: { mode: 'weights', weights: { m0: 0, m1: 0 }, display: 'shares' } }),
        KNOWN,
      ),
    ).toContain('Shares must add up to more than zero.');
  });

  it('allows one person to carry zero shares', () => {
    expect(
      validateExpense(
        expense({ split: { mode: 'weights', weights: { m0: 1, m1: 0 }, display: 'shares' } }),
        KNOWN,
      ),
    ).toEqual([]);
  });

  it('reports every problem at once rather than one at a time', () => {
    const problems = validateExpense(
      expense({ description: '   ', totalCents: 0, date: 'nope', payers: [] }),
      KNOWN,
    );
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });
});

describe('validateSettlement', () => {
  it('accepts a well-formed payment', () => {
    expect(validateSettlement(settlement(), KNOWN)).toEqual([]);
  });

  it('refuses a payment to yourself', () => {
    expect(validateSettlement(settlement({ toMemberId: 'm1' }), KNOWN)).toContain(
      'A payment needs two different people.',
    );
  });

  it('refuses a zero or negative payment', () => {
    expect(validateSettlement(settlement({ amountCents: 0 }), KNOWN).length).toBeGreaterThan(0);
    expect(validateSettlement(settlement({ amountCents: -5 }), KNOWN).length).toBeGreaterThan(0);
  });

  it('refuses unknown people', () => {
    expect(validateSettlement(settlement({ fromMemberId: 'ghost' }), KNOWN)).toContain(
      'Unknown member: ghost',
    );
  });
});
