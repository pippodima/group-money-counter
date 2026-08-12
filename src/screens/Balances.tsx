/** Where everyone stands. */

import { balances, paidBy } from '../core/balances.js';
import { formatMoney, formatSigned } from '../lib/money.js';
import { useLedger } from '../store/ledger.js';
import { Empty, Screen } from '../ui/Chrome.js';

export function Balances() {
  const { state } = useLedger();
  const currency = state.group?.currency ?? 'EUR';
  const net = balances(state);

  const rows = state.members
    .map((member) => ({
      member,
      net: net.get(member.id) ?? 0,
      paid: paidBy(state, member.id),
    }))
    // Owed the most at the top, owing the most at the bottom; the people who
    // need to do something are at the ends, not buried in the middle.
    .sort((a, b) => b.net - a.net || (a.member.id < b.member.id ? -1 : 1));

  const settled = rows.every((row) => row.net === 0);
  const largest = Math.max(1, ...rows.map((row) => Math.abs(row.net)));

  if (state.expenses.filter((expense) => !expense.deleted).length === 0) {
    return (
      <Screen title="Balances" tabs="/balances">
        <Empty title="Nothing to balance" hint="Add an expense first." />
      </Screen>
    );
  }

  return (
    <Screen
      title="Balances"
      subtitle={settled ? 'Everyone is square' : undefined}
      tabs="/balances"
    >
      <ul className="balances">
        {rows.map(({ member, net: amount, paid }) => (
          <li key={member.id} className={amount > 0 ? 'up' : amount < 0 ? 'down' : 'level'}>
            <div className="bal-head">
              <span className="bal-name">
                {member.name}
                {!member.active && <span className="inactive"> · inactive</span>}
              </span>
              <span className="bal-net">{formatSigned(amount, currency)}</span>
            </div>
            <div className="bar" aria-hidden="true">
              <span style={{ width: `${(Math.abs(amount) / largest) * 100}%` }} />
            </div>
            <span className="bal-detail">
              {amount > 0
                ? 'is owed'
                : amount < 0
                  ? 'owes'
                  : 'settled up'}
              {' · paid '}
              {formatMoney(paid, currency)}
            </span>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
