/** First run: name the group and list who is in it. */

import { useState } from 'react';
import { append, newId } from '../store/ledger.js';
import type { Event } from '../core/events.js';
import { Field, Problems } from '../ui/Chrome.js';

const CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'JPY'];

export function Setup() {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [members, setMembers] = useState(['', '']);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const named = members.map((member) => member.trim()).filter((member) => member !== '');

  function setMember(index: number, value: string) {
    setMembers((current) => current.map((member, i) => (i === index ? value : member)));
  }

  async function create() {
    const found: string[] = [];
    if (name.trim() === '') found.push('Give the group a name.');
    if (named.length < 1) found.push('Add at least one person.');
    if (new Set(named.map((n) => n.toLowerCase())).size !== named.length) {
      found.push('Two people have the same name.');
    }
    if (!/^[A-Za-z]{3}$/.test(currency)) found.push('Use a three-letter currency code.');

    setProblems(found);
    if (found.length > 0) return;

    setSaving(true);
    const events: Event[] = [
      { t: 'group.init', name: name.trim(), currency: currency.toUpperCase() },
      ...named.map(
        (memberName): Event => ({ t: 'member.add', memberId: newId(6), name: memberName }),
      ),
    ];
    await append(...events);
  }

  return (
    <div className="screen">
      <main className="body setup">
        <p className="eyebrow">New group</p>
        <h1>Who's splitting?</h1>
        <p className="lede">
          Everything stays on this device. No account, nothing uploaded.
        </p>

        <Field label="Group name">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Lisbon weekend"
            autoFocus
          />
        </Field>

        <Field label="Currency" hint="One currency per group for now.">
          <input
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))}
            list="currencies"
            maxLength={3}
            className="short"
          />
          <datalist id="currencies">
            {CURRENCIES.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </Field>

        <div className="field">
          <span className="field-label">People</span>
          <div className="member-inputs">
            {members.map((member, index) => (
              <input
                // Inputs are positional here; a name-based key would remount
                // the field on every keystroke and lose focus.
                key={index}
                value={member}
                onChange={(event) => setMember(index, event.target.value)}
                placeholder={index === 0 ? 'You' : `Person ${index + 1}`}
              />
            ))}
          </div>
          <button
            type="button"
            className="ghost"
            onClick={() => setMembers((current) => [...current, ''])}
          >
            Add another person
          </button>
        </div>

        <Problems items={problems} />

        <button type="button" onClick={create} disabled={saving} className="primary">
          {saving ? 'Creating…' : 'Create group'}
        </button>
      </main>
    </div>
  );
}
