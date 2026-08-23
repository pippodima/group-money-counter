/** The expense list — the screen the app opens on. */

import { totalSpend } from '../core/balances.js';
import type { Expense } from '../core/types.js';
import { compareDayDescending, formatDayRelative } from '../lib/day.js';
import { formatMoney } from '../lib/money.js';
import { navigate } from '../lib/router.js';
import { append, useLedger } from '../store/ledger.js';
import { Empty, Screen } from '../ui/Chrome.js';
import { GroupSwitcher } from '../ui/GroupSwitcher.js';
import { SwipeRow } from '../ui/SwipeRow.js';
import { UndoBar, usePendingDelete } from '../ui/Undo.js';

export function Expenses() {
  const { state } = useLedger();
  const currency = state.group?.currency ?? 'EUR';
  const names = new Map(state.members.map((member) => [member.id, member.name]));

  const { pending, remove, undo } = usePendingDelete((expenseId) =>
    append({ t: 'expense.delete', expenseId }),
  );

  // A pending row is hidden immediately, though nothing is written until the
  // undo window closes.
  const live = state.expenses.filter(
    (expense) => !expense.deleted && expense.id !== pending?.id,
  );

  const days = [...new Set(live.map((expense) => expense.date))].sort(compareDayDescending);
  const byDay = days.map(
    (day) => [day, live.filter((expense) => expense.date === day)] as const,
  );

  function payerLabel(expense: Expense): string {
    if (expense.payers.length === 1) {
      return names.get(expense.payers[0]?.memberId ?? '') ?? 'someone';
    }
    return `${expense.payers.length} people`;
  }

  return (
    <Screen
      title={<GroupSwitcher subtitle={
        live.length === 0
          ? 'Nothing yet'
          : `${formatMoney(totalSpend(state), currency)} · ${live.length} expense${live.length === 1 ? '' : 's'}`
      } />}
      tabs="/"
      action={
        <button type="button" className="icon" onClick={() => navigate('/members')} aria-label="People">
          ⋯
        </button>
      }
    >
      {live.length === 0 ? (
        <Empty
          title="No expenses yet"
          hint="Add the first one and the balances will work themselves out."
          action={
            <button type="button" className="primary" onClick={() => navigate('/new')}>
              Add an expense
            </button>
          }
        />
      ) : (
        <div className="daygroups">
          {byDay.map(([day, expenses]) => (
            <section key={day}>
              <h2 className="dayhead">{formatDayRelative(day)}</h2>
              <ul className="ledger">
                {expenses.map((expense) => (
                  <li key={expense.id}>
                    <SwipeRow
                      label={`Delete ${expense.description}`}
                      onDelete={() =>
                        remove({ id: expense.id, description: expense.description })
                      }
                    >
                      <button type="button" onClick={() => navigate(`/expense/${expense.id}`)}>
                        <span className="what">
                          <span className="desc">{expense.description}</span>
                          <span className="who">paid by {payerLabel(expense)}</span>
                        </span>
                        <span className="amount-cell">
                          {formatMoney(expense.totalCents, currency)}
                        </span>
                      </button>
                    </SwipeRow>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <button type="button" className="fab" onClick={() => navigate('/new')} aria-label="Add expense">
        +
      </button>

      {pending && <UndoBar pending={pending} onUndo={undo} />}
    </Screen>
  );
}
