/**
 * Money in and out of the interface.
 *
 * Deliberately outside src/core: `Intl` reads the device locale, which the
 * domain layer may never do. Parsing lives here too, since it is input
 * handling — core only ever sees integer cents.
 */

import type { Cents } from '../core/types.js';

/**
 * Reads an amount typed by a human.
 *
 * Accepts both decimal conventions, because a group on a trip will have
 * phones set to both: `12.50` and `12,50` are the same amount. Grouping marks
 * are tolerated too — `1.234,56` and `1,234.56` both come to 123456 cents.
 *
 * The rule for the last separator, by how many digits follow it:
 *
 *   1 or 2  a decimal point — `12,5` is twelve fifty
 *   exactly 3  a grouping mark — `1.234` is one thousand two hundred
 *              and thirty-four, not 1.23. Genuinely ambiguous, resolved
 *              this way because amounts are rarely written to three places
 *   4 or more  too many to be a grouping mark, so a decimal point with the
 *              excess dropped
 *
 * Returns null for anything it cannot read confidently, so callers can leave
 * the field alone rather than guess.
 */
export function parseMoney(input: string): Cents | null {
  const cleaned = input.trim().replace(/[^\d.,-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;

  const negative = cleaned.startsWith('-');
  const body = cleaned.replace(/-/g, '');
  if (body === '') return null;

  const separator = Math.max(body.lastIndexOf(','), body.lastIndexOf('.'));

  let whole = body;
  let fraction = '';
  if (separator >= 0) {
    const after = body.slice(separator + 1);
    if (/^\d+$/.test(after) && after.length !== 3) {
      whole = body.slice(0, separator);
      fraction = after.slice(0, 2);
    }
    // Exactly three digits: a grouping mark. `whole` keeps the whole string,
    // and the separators are stripped from it below.
  }

  whole = whole.replace(/[.,]/g, '');
  if (whole === '' && fraction === '') return null;
  if (!/^\d*$/.test(whole)) return null;

  const cents = Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;

  return negative ? -cents : cents;
}

/** `1250` → `"12.50"`. The form of an amount while it is being edited. */
export function toAmountInput(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** `1250, 'EUR'` → `"€12.50"`, in the reader's own locale. */
export function formatMoney(cents: Cents, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    // An unrecognised currency code should not blank the screen.
    return `${toAmountInput(cents)} ${currency}`;
  }
}

/** Like `formatMoney`, but always carrying an explicit + or −. */
export function formatSigned(cents: Cents, currency: string): string {
  const formatted = formatMoney(Math.abs(cents), currency);
  return cents === 0 ? formatted : `${cents > 0 ? '+' : '−'}${formatted}`;
}
