/** Who should pay whom, and recording it when they do. */

import { useState } from 'react';
import { balances } from '../core/balances.js';
import { type Transfer, pairwise, simplify } from '../core/settle.js';
import { today } from '../lib/day.js';
import { formatMoney } from '../lib/money.js';
import { append, newId, useLedger } from '../store/ledger.js';
import { Empty, Screen } from '../ui/Chrome.js';

export function SettleUp() {
  const { state } = useLedger();
  const currency = state.group?.currency ?? 'EUR';
  const names = new Map(state.members.map((member) => [member.id, member.name]));

  const [simplified, setSimplified] = useState(true);
  const [paying, setPaying] = useState<string | undefined>();

  const plan: Transfer[] = simplified ? simplify(balances(state)) : pairwise(state);

  async function record(transfer: Transfer) {
    setPaying(`${transfer.from}:${transfer.to}`);
    await append({
      t: 'settlement.create',
      settlementId: newId(),
      fields: {
        fromMemberId: transfer.from,
        toMemberId: transfer.to,
        amountCents: transfer.amountCents,
        date: today(),
        note: '',
      },
    });
    setPaying(undefined);
  }

  const settlements = state.settlements.filter((settlement) => !settlement.deleted);

  return (
    <Screen title="Settle up" tabs="/settle">
      <div className="segmented" role="group" aria-label="Settlement style">
        <button
          type="button"
          className={simplified ? 'seg current' : 'seg'}
          aria-pressed={simplified}
          onClick={() => setSimplified(true)}
        >
          Fewest payments
        </button>
        <button
          type="button"
          className={simplified ? 'seg' : 'seg current'}
          aria-pressed={!simplified}
          onClick={() => setSimplified(false)}
        >
          Pay who paid
        </button>
      </div>

      <p className="lede small">
        {simplified
          ? 'The shortest way to clear everything. You may be asked to pay someone you did not buy anything from.'
          : 'Everyone pays back the people who actually paid for them. More payments, each one traceable.'}
      </p>

      {plan.length === 0 ? (
        <Empty title="All square" hint="Nobody owes anybody anything." />
      ) : (
        <ul className="transfers">
          {plan.map((transfer) => (
            <li key={`${transfer.from}-${transfer.to}`}>
              <span className="flow">
                <span className="from">{names.get(transfer.from) ?? '?'}</span>
                <span className="arrow" aria-label="pays">
                  →
                </span>
                <span className="to">{names.get(transfer.to) ?? '?'}</span>
              </span>
              <span className="transfer-amount">
                {formatMoney(transfer.amountCents, currency)}
              </span>
              <button
                type="button"
                className="ghost"
                disabled={paying !== undefined}
                onClick={() => record(transfer)}
              >
                {paying === `${transfer.from}:${transfer.to}` ? 'Recording…' : 'Mark paid'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {settlements.length > 0 && (
        <section className="past">
          <h2 className="dayhead">Payments made</h2>
          <ul className="ledger">
            {settlements.map((settlement) => (
              <li key={settlement.id}>
                <button
                  type="button"
                  onClick={() =>
                    append({ t: 'settlement.delete', settlementId: settlement.id })
                  }
                  title="Undo this payment"
                >
                  <span className="what">
                    <span className="desc">
                      {names.get(settlement.fromMemberId) ?? '?'} →{' '}
                      {names.get(settlement.toMemberId) ?? '?'}
                    </span>
                    <span className="who">tap to undo</span>
                  </span>
                  <span className="amount-cell">
                    {formatMoney(settlement.amountCents, currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  );
}
