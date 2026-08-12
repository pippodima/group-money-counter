/**
 * Calendar days for the interface.
 *
 * A `Day` is `YYYY-MM-DD` with no time and no zone, which is what
 * `<input type="date">` produces natively. Everything here formats *around*
 * the timezone rather than through it: a day is a label, not an instant, and
 * converting it to one shifts it across midnight for half the world.
 */

import type { Day } from '../core/types.js';

const pad = (value: number) => String(value).padStart(2, '0');

/** The user's local calendar day — which is the one they mean. */
export function today(): Day {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Converts a day to the instant at midnight UTC.
 *
 * Only for handing to `Intl`, and only ever alongside `timeZone: 'UTC'` —
 * formatting it in local time would print the wrong date west of Greenwich.
 */
function asUtcInstant(day: Day): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
}

/** `"2026-08-11"` → `"11 Aug"`, or `"11 Aug 2025"` if it is not this year. */
export function formatDay(day: Day): string {
  const sameYear = day.slice(0, 4) === today().slice(0, 4);
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(asUtcInstant(day));
}

/** `"Today"`, `"Yesterday"`, or a formatted date. Used as list headings. */
export function formatDayRelative(day: Day): string {
  const now = today();
  if (day === now) return 'Today';

  const yesterday = new Date(asUtcInstant(now).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (day === yesterday) return 'Yesterday';

  return formatDay(day);
}

/** Newest first, which is how expense lists read. */
export function compareDayDescending(a: Day, b: Day): number {
  return a < b ? 1 : a > b ? -1 : 0;
}
