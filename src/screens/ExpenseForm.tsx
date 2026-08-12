/** Creating and editing an expense, including all three ways of splitting it. */

import { useMemo, useState } from 'react';
import type { Event } from '../core/events.js';
import { sharesOf } from '../core/split.js';
import type { Cents, ExpenseFields, MemberId, Split } from '../core/types.js';
import { validateExpense } from '../core/validate.js';
import { today } from '../lib/day.js';
import { formatMoney, parseMoney, toAmountInput } from '../lib/money.js';
import { back, navigate } from '../lib/router.js';
import { append, newId, useLedger } from '../store/ledger.js';
import { Field, Problems, Screen } from '../ui/Chrome.js';

type Mode = 'equal' | 'shares' | 'percent' | 'exact';

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'equal', label: 'Equally' },
  { id: 'shares', label: 'Shares' },
  { id: 'percent', label: 'Percent' },
  { id: 'exact', label: 'Amounts' },
];

function modeOf(split: Split): Mode {
  if (split.mode === 'equal') return 'equal';
  if (split.mode === 'exact') return 'exact';
  return split.display === 'percent' ? 'percent' : 'shares';
}

export function ExpenseForm({ expenseId }: { expenseId?: string | undefined }) {
  const { state } = useLedger();
  const currency = state.group?.currency ?? 'EUR';
  const existing = expenseId
    ? state.expenses.find((expense) => expense.id === expenseId && !expense.deleted)
    : undefined;

  // Inactive members stay selectable if they are already part of this expense,
  // so editing an old entry cannot silently drop someone.
  const involved = new Set(
    existing ? [...existing.payers.map((payer) => payer.memberId)] : [],
  );
  const members = state.members.filter((member) => member.active || involved.has(member.id));

  const [description, setDescription] = useState(existing?.description ?? '');
  const [amountText, setAmountText] = useState(
    existing ? toAmountInput(existing.totalCents) : '',
  );
  const [date, setDate] = useState(existing?.date ?? today());
  const [multiPayer, setMultiPayer] = useState((existing?.payers.length ?? 1) > 1);
  const [payerId, setPayerId] = useState(
    existing?.payers[0]?.memberId ?? members[0]?.id ?? '',
  );
  const [payerAmounts, setPayerAmounts] = useState<Record<MemberId, string>>(() =>
    Object.fromEntries(
      (existing?.payers ?? []).map((payer) => [payer.memberId, toAmountInput(payer.amountCents)]),
    ),
  );

  const [mode, setMode] = useState<Mode>(existing ? modeOf(existing.split) : 'equal');
  const [selected, setSelected] = useState<Set<MemberId>>(() => {
    if (!existing) return new Set(members.map((member) => member.id));
    const split = existing.split;
    return new Set(
      split.mode === 'equal'
        ? split.among
        : Object.keys(split.mode === 'weights' ? split.weights : split.amounts),
    );
  });
  const [weights, setWeights] = useState<Record<MemberId, string>>(() =>
    existing?.split.mode === 'weights'
      ? Object.fromEntries(Object.entries(existing.split.weights).map(([id, w]) => [id, String(w)]))
      : {},
  );
  const [exactAmounts, setExactAmounts] = useState<Record<MemberId, string>>(() =>
    existing?.split.mode === 'exact'
      ? Object.fromEntries(
          Object.entries(existing.split.amounts).map(([id, cents]) => [id, toAmountInput(cents)]),
        )
      : {},
  );

  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const totalCents = parseMoney(amountText) ?? 0;

  const fields = useMemo((): ExpenseFields => {
    const chosen = members.filter((member) => selected.has(member.id)).map((member) => member.id);

    const split: Split =
      mode === 'equal'
        ? { mode: 'equal', among: chosen }
        : mode === 'exact'
          ? {
              mode: 'exact',
              amounts: Object.fromEntries(
                chosen.map((id) => [id, parseMoney(exactAmounts[id] ?? '') ?? 0]),
              ),
            }
          : {
              mode: 'weights',
              weights: Object.fromEntries(
                chosen.map((id) => [id, Number(weights[id] ?? '1') || 0]),
              ),
              display: mode === 'percent' ? 'percent' : 'shares',
            };

    const payers = multiPayer
      ? members
          .map((member) => ({
            memberId: member.id,
            amountCents: parseMoney(payerAmounts[member.id] ?? '') ?? 0,
          }))
          .filter((payer) => payer.amountCents > 0)
      : [{ memberId: payerId, amountCents: totalCents }];

    return { description, totalCents, date, payers, split };
  }, [
    members,
    selected,
    mode,
    exactAmounts,
    weights,
    multiPayer,
    payerAmounts,
    payerId,
    totalCents,
    description,
    date,
  ]);

  /** Live per-person amounts. Invalid input simply shows nothing. */
  const preview = useMemo(() => {
    try {
      return totalCents > 0 ? sharesOf(totalCents, fields.split) : new Map<MemberId, Cents>();
    } catch {
      return new Map<MemberId, Cents>();
    }
  }, [totalCents, fields.split]);

  const assigned = Object.entries(exactAmounts)
    .filter(([id]) => selected.has(id))
    .reduce((sum, [, text]) => sum + (parseMoney(text) ?? 0), 0);
  const remaining = totalCents - assigned;

  const weightTotal = members
    .filter((member) => selected.has(member.id))
    .reduce((sum, member) => sum + (Number(weights[member.id] ?? '1') || 0), 0);

  function toggle(memberId: MemberId) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  async function save() {
    const known = new Set(state.members.map((member) => member.id));
    const found = validateExpense(fields, known);
    setProblems(found);
    if (found.length > 0) return;

    setSaving(true);
    const event: Event = existing
      ? { t: 'expense.update', expenseId: existing.id, patch: fields }
      : { t: 'expense.create', expenseId: newId(), fields };
    await append(event);
    navigate('/', true);
  }

  async function remove() {
    if (!existing) return;
    setSaving(true);
    await append({ t: 'expense.delete', expenseId: existing.id });
    navigate('/', true);
  }

  return (
    <Screen title={existing ? 'Edit expense' : 'New expense'} onBack>
      <Field label="What was it?">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Dinner"
          autoFocus={!existing}
        />
      </Field>

      <div className="row">
        <Field label={`Total (${currency})`}>
          <input
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
      </div>

      <div className="field">
        <span className="field-label">Paid by</span>
        {multiPayer ? (
          <div className="rows">
            {members.map((member) => (
              <div className="rowline" key={member.id}>
                <span className="rowname">{member.name}</span>
                <input
                  className="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={payerAmounts[member.id] ?? ''}
                  onChange={(event) =>
                    setPayerAmounts((current) => ({ ...current, [member.id]: event.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <select value={payerId} onChange={(event) => setPayerId(event.target.value)}>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="ghost" onClick={() => setMultiPayer((on) => !on)}>
          {multiPayer ? 'One person paid' : 'Split the payment'}
        </button>
      </div>

      <div className="field">
        <span className="field-label">Split</span>
        <div className="segmented" role="group" aria-label="How to split">
          {MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={mode === option.id ? 'seg current' : 'seg'}
              aria-pressed={mode === option.id}
              onClick={() => setMode(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="rows split-rows">
          {members.map((member) => {
            const on = selected.has(member.id);
            return (
              <div className={on ? 'rowline' : 'rowline off'} key={member.id}>
                <label className="rowpick">
                  <input type="checkbox" checked={on} onChange={() => toggle(member.id)} />
                  <span className="rowname">{member.name}</span>
                </label>

                {on && (mode === 'shares' || mode === 'percent') && (
                  <input
                    className="weight"
                    inputMode="decimal"
                    value={weights[member.id] ?? '1'}
                    onChange={(event) =>
                      setWeights((current) => ({ ...current, [member.id]: event.target.value }))
                    }
                  />
                )}

                {on && mode === 'exact' && (
                  <input
                    className="amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={exactAmounts[member.id] ?? ''}
                    onChange={(event) =>
                      setExactAmounts((current) => ({
                        ...current,
                        [member.id]: event.target.value,
                      }))
                    }
                  />
                )}

                {on && mode !== 'exact' && (
                  <span className="share">
                    {preview.has(member.id) ? formatMoney(preview.get(member.id) as number, currency) : '—'}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {mode === 'exact' && totalCents > 0 && (
          <p className={remaining === 0 ? 'tally settled' : 'tally'}>
            {remaining === 0
              ? 'Fully assigned'
              : remaining > 0
                ? `${formatMoney(remaining, currency)} left to assign`
                : `${formatMoney(-remaining, currency)} over`}
          </p>
        )}

        {mode === 'percent' && weightTotal !== 100 && selected.size > 0 && (
          <p className="tally">
            Adds up to {weightTotal}%, so it will be divided in proportion.
          </p>
        )}
      </div>

      <Problems items={problems} />

      <div className="actions">
        <button type="button" className="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Add expense'}
        </button>
        {existing ? (
          <button type="button" className="danger" onClick={remove} disabled={saving}>
            Delete
          </button>
        ) : (
          <button type="button" className="ghost" onClick={back}>
            Cancel
          </button>
        )}
      </div>
    </Screen>
  );
}
