/**
 * Entry-time validation.
 *
 * Everything here is checked *before* an event is appended, because the log is
 * append-only: a bad expense cannot be edited out of history, only superseded.
 * Rejecting at the door keeps the fold total — it never has to decide what to
 * do with an expense whose parts don't add up.
 *
 * Returns a list of problems, empty when valid, so a form can show all of them
 * at once instead of one per submit.
 */

import type { Day, ExpenseFields, MemberId, SettlementFields, Split } from './types.js';

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Checks a `YYYY-MM-DD` calendar day.
 *
 * Done arithmetically rather than with `Date`, which this layer may not touch
 * — and which would silently accept "2026-02-31" by rolling it into March.
 */
export function isValidDay(day: Day): boolean {
  const match = DAY_PATTERN.exec(day);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (month < 1 || month > 12) return false;

  const length = month === 2 && isLeapYear(year) ? 29 : (MONTH_LENGTHS[month - 1] as number);
  return date >= 1 && date <= length;
}

function checkSplit(
  split: Split,
  totalCents: number,
  known: ReadonlySet<MemberId>,
  problems: string[],
): void {
  const participants =
    split.mode === 'equal'
      ? split.among
      : Object.keys(split.mode === 'weights' ? split.weights : split.amounts);

  if (participants.length === 0) {
    problems.push('The split must include at least one person.');
  }
  if (new Set(participants).size !== participants.length) {
    problems.push('Someone appears twice in the split.');
  }
  for (const memberId of participants) {
    if (!known.has(memberId)) problems.push(`Unknown member in split: ${memberId}`);
  }

  switch (split.mode) {
    case 'equal':
      break;

    case 'weights': {
      const weights = Object.values(split.weights);
      if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
        problems.push('Shares must be zero or more.');
      } else if (weights.reduce((sum, weight) => sum + weight, 0) <= 0) {
        problems.push('Shares must add up to more than zero.');
      }
      break;
    }

    case 'exact': {
      const amounts = Object.values(split.amounts);
      if (amounts.some((amount) => !Number.isInteger(amount) || amount < 0)) {
        problems.push('Each amount must be a whole number of cents, zero or more.');
      } else {
        const sum = amounts.reduce((total, amount) => total + amount, 0);
        if (sum !== totalCents) {
          const difference = Math.abs(totalCents - sum);
          problems.push(
            sum < totalCents
              ? `The amounts are ${difference} cents short of the total.`
              : `The amounts are ${difference} cents over the total.`,
          );
        }
      }
      break;
    }
  }
}

export function validateExpense(
  fields: ExpenseFields,
  known: ReadonlySet<MemberId>,
): string[] {
  const problems: string[] = [];

  if (fields.description.trim() === '') {
    problems.push('Give the expense a description.');
  }
  if (!Number.isInteger(fields.totalCents) || fields.totalCents <= 0) {
    problems.push('The total must be a whole number of cents, greater than zero.');
  }
  if (!isValidDay(fields.date)) {
    problems.push(`Not a valid date: ${fields.date}`);
  }

  if (fields.payers.length === 0) {
    problems.push('Record who paid.');
  } else {
    const payerIds = fields.payers.map((payer) => payer.memberId);
    if (new Set(payerIds).size !== payerIds.length) {
      problems.push('The same person is listed as payer twice.');
    }
    for (const memberId of payerIds) {
      if (!known.has(memberId)) problems.push(`Unknown payer: ${memberId}`);
    }

    const amounts = fields.payers.map((payer) => payer.amountCents);
    if (amounts.some((amount) => !Number.isInteger(amount) || amount < 0)) {
      problems.push('Each payer must contribute a whole number of cents, zero or more.');
    } else {
      const paid = amounts.reduce((sum, amount) => sum + amount, 0);
      if (paid !== fields.totalCents) {
        problems.push(`The payers contributed ${paid} cents but the total is ${fields.totalCents}.`);
      }
    }
  }

  checkSplit(fields.split, fields.totalCents, known, problems);
  return problems;
}

export function validateSettlement(
  fields: SettlementFields,
  known: ReadonlySet<MemberId>,
): string[] {
  const problems: string[] = [];

  if (!known.has(fields.fromMemberId)) {
    problems.push(`Unknown member: ${fields.fromMemberId}`);
  }
  if (!known.has(fields.toMemberId)) {
    problems.push(`Unknown member: ${fields.toMemberId}`);
  }
  if (fields.fromMemberId === fields.toMemberId) {
    problems.push('A payment needs two different people.');
  }
  if (!Number.isInteger(fields.amountCents) || fields.amountCents <= 0) {
    problems.push('The amount must be a whole number of cents, greater than zero.');
  }
  if (!isValidDay(fields.date)) {
    problems.push(`Not a valid date: ${fields.date}`);
  }

  return problems;
}
