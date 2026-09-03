/**
 * Regenerates the screenshots in the README.
 *
 *   npm run build && npm run preview &     # serve the real production bundle
 *   npm run screenshots
 *
 * Drives the actual interface rather than writing to IndexedDB directly, so
 * the pictures cannot drift from what the app really does — if a flow breaks,
 * this breaks with it.
 *
 * The sample ledger is fictional and deliberately dull: no real names, no real
 * amounts.
 */

import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/group-money-counter/';

/** Group id is hashed to a hue, so the seed decides the app's colour. */
const GROUP = 'Lisbon weekend';
const PEOPLE = ['Anna', 'Marco', 'Sara', 'Luca'];

const EXPENSES = [
  { what: 'Dinner at the docks', amount: '84.50', payer: 'Anna', date: '2026-08-22' },
  { what: 'Tram tickets', amount: '13.20', payer: 'Marco', date: '2026-08-22' },
  { what: 'Tile museum', amount: '32.00', payer: 'Sara', date: '2026-08-21' },
  { what: 'Pastéis de nata', amount: '9.75', payer: 'Luca', date: '2026-08-21' },
  { what: 'Airport taxi', amount: '46.00', payer: 'Anna', date: '2026-08-20' },
];

mkdirSync(OUT, { recursive: true });

// --lang, not just the context locale: a native <input type="date"> formats
// itself from the browser's UI language, and would otherwise render as US.
const browser = await chromium.launch({ args: ['--lang=en-GB'] });
const context = await browser.newContext({
  ...devices['iPhone 13'],
  colorScheme: 'light',
  locale: 'en-GB',
  timezoneId: 'Europe/Lisbon',
});
const page = await context.newPage();

const shot = async (name) => {
  await page.waitForTimeout(350); // let transitions settle
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`docs/screenshots/${name}.png`);
};

await page.goto(BASE, { waitUntil: 'networkidle' });

// ---------------------------------------------------------------- set up

// With no groups yet, the app opens on the two ways in.
await shot('00-start');
await page.getByRole('button', { name: /start a new group/i }).click();

await page.getByPlaceholder('Lisbon weekend').fill(GROUP);
const nameFields = page.locator('.member-inputs input');
for (const [index, person] of PEOPLE.entries()) {
  if (index >= (await nameFields.count())) {
    await page.getByRole('button', { name: /add another person/i }).click();
  }
  await nameFields.nth(index).fill(person);
}
await shot('01-new-group');

await page.getByRole('button', { name: /create group/i }).click();
await page.waitForSelector('.fab');

// ------------------------------------------------------------- expenses

for (const expense of EXPENSES) {
  await page.locator('.fab').click();
  await page.getByPlaceholder('Dinner').fill(expense.what);
  await page.locator('input[inputmode="decimal"]').first().fill(expense.amount);
  await page.locator('input[type="date"]').fill(expense.date);
  await page.getByRole('radiogroup', { name: /paid by/i }).getByText(expense.payer).click();
  await page.getByRole('button', { name: /add expense/i }).click();
  await page.waitForSelector('.fab');
}

await shot('02-expenses');

// --------------------------------------------------- the split editor

await page.getByText('Dinner at the docks').click();
await page.getByRole('button', { name: /^shares$/i }).click();
// A couple counting double, which is the case plain "split equally" cannot do.
const shares = page.locator('input.weight');
await shares.nth(0).fill('2');
await shot('03-split-by-shares');

await page.getByRole('button', { name: /back/i }).click();
await page.waitForSelector('.fab');

// ------------------------------------------------- balances and settling

await page.getByRole('button', { name: 'Balances' }).click();
await shot('04-balances');

await page.getByRole('button', { name: 'Settle up' }).click();
await shot('05-settle-up');

// ------------------------------------------------------------------ sync

await page.getByRole('navigation', { name: /sections/i }).getByText('Sync', { exact: true }).click();
await page.getByRole('button', { name: /show my ledger/i }).click();
await page.waitForSelector('canvas.qr');
await shot('06-sync-qr');

// ------------------------------------------------------------ dark mode

// Switched on the same page rather than in a fresh context: storageState
// carries cookies and localStorage but *not* IndexedDB, so a new context
// would open on the empty landing screen with nothing to show.
await page.emulateMedia({ colorScheme: 'dark' });
await page.getByRole('navigation', { name: /sections/i }).getByText('Expenses').click();
await shot('07-dark');

await browser.close();
