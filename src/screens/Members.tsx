/** Managing who is in the group, plus the group's own name. */

import { useState } from 'react';
import { balances } from '../core/balances.js';
import { formatSigned } from '../lib/money.js';
import { append, newId, useLedger } from '../store/ledger.js';
import { Field, Problems, Screen } from '../ui/Chrome.js';

export function Members() {
  const { state, eventCount } = useLedger();
  const currency = state.group?.currency ?? 'EUR';
  const net = balances(state);

  const [adding, setAdding] = useState('');
  const [problems, setProblems] = useState<string[]>([]);

  async function add() {
    const name = adding.trim();
    if (name === '') return;
    if (state.members.some((member) => member.name.toLowerCase() === name.toLowerCase())) {
      setProblems(['Somebody already has that name.']);
      return;
    }
    setProblems([]);
    setAdding('');
    await append({ t: 'member.add', memberId: newId(6), name });
  }

  async function rename(memberId: string, name: string) {
    const trimmed = name.trim();
    if (trimmed === '') return;
    await append({ t: 'member.rename', memberId, name: trimmed });
  }

  return (
    <Screen title="People" subtitle={state.group?.name} onBack>
      <ul className="people">
        {state.members.map((member) => {
          const balance = net.get(member.id) ?? 0;
          return (
            <li key={member.id} className={member.active ? '' : 'inactive-row'}>
              <input
                defaultValue={member.name}
                onBlur={(event) => rename(member.id, event.target.value)}
                aria-label={`Name of ${member.name}`}
              />
              <span className="person-net">{formatSigned(balance, currency)}</span>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  append({
                    t: member.active ? 'member.deactivate' : 'member.reactivate',
                    memberId: member.id,
                  })
                }
                // Removing someone mid-trip would orphan every expense they
                // are part of, so they are hidden rather than deleted.
                title={
                  member.active
                    ? 'Hide from new expenses. Their history stays.'
                    : 'Show in new expenses again.'
                }
              >
                {member.active ? 'Hide' : 'Restore'}
              </button>
            </li>
          );
        })}
      </ul>

      <Field label="Add someone">
        <div className="inline">
          <input
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && add()}
            placeholder="Name"
          />
          <button type="button" onClick={add} disabled={adding.trim() === ''}>
            Add
          </button>
        </div>
      </Field>

      <Problems items={problems} />

      <Field label="Group name">
        <input
          defaultValue={state.group?.name ?? ''}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name !== '' && name !== state.group?.name) append({ t: 'group.rename', name });
          }}
        />
      </Field>

      <p className="footnote">
        {eventCount} event{eventCount === 1 ? '' : 's'} stored on this device · {currency}
      </p>
    </Screen>
  );
}
