/** Managing who is in the group, plus the group's own name. */

import { useState } from 'react';
import { balances } from '../core/balances.js';
import { formatSigned } from '../lib/money.js';
import { navigate } from '../lib/router.js';
import { append, deleteGroup, newId, useLedger } from '../store/ledger.js';
import { Field, Problems, Screen } from '../ui/Chrome.js';

export function Members() {
  const { state, groupId, groups, eventCount } = useLedger();
  const currency = state.group?.currency ?? 'EUR';
  const net = balances(state);

  const [adding, setAdding] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const live = state.expenses.filter((expense) => !expense.deleted);

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

      <div className="actions">
        <button type="button" onClick={() => navigate('/groups')}>
          Switch group
        </button>
        <button type="button" onClick={() => navigate('/backup')}>
          Back up or restore
        </button>
      </div>

      <section className="danger-zone">
        <h2 className="section-title">Delete this group</h2>
        {confirming ? (
          <>
            <p className="lede small">
              Removes <strong>{state.group?.name}</strong> and its{' '}
              {live.length === 1 ? '1 expense' : `${live.length} expenses`} from this phone.
              {' '}
              This cannot be undone here — though anyone else still in the group can give it
              back by syncing, and a backup file will restore it.
            </p>
            <div className="actions">
              <button
                type="button"
                className="danger-solid"
                onClick={async () => {
                  await deleteGroup(groupId as string);
                  navigate('/groups');
                }}
              >
                Delete {state.group?.name} permanently
              </button>
              <button type="button" className="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="lede small">
              {groups.length > 1
                ? 'Your other groups are not affected.'
                : 'This is your only group. You will be back at the start.'}
            </p>
            <button type="button" className="danger" onClick={() => setConfirming(true)}>
              Delete this group
            </button>
          </>
        )}
      </section>

      <p className="footnote">
        {eventCount} event{eventCount === 1 ? '' : 's'} stored on this device · {currency}
      </p>
    </Screen>
  );
}
