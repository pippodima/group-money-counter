/**
 * Choosing a group, starting one, or joining someone else's.
 *
 * Doubles as the landing screen on a fresh install. Until now the only path
 * was "create a group", which meant a second phone always minted its own id —
 * and every sync attempt then failed as a different group. Joining has to be
 * as prominent as starting.
 */

import { formatMoney } from '../lib/money.js';
import { navigate } from '../lib/router.js';
import { setActiveGroup, useLedger } from '../store/ledger.js';
import { Screen } from '../ui/Chrome.js';

export function Groups() {
  const { groups, groupId } = useLedger();
  const first = groups.length === 0;

  return (
    <Screen
      title={first ? 'Group Money Counter' : 'Your groups'}
      onBack={!first}
      tabs={undefined}
    >
      {first ? (
        <>
          <p className="eyebrow">Nothing leaves your phone</p>
          <p className="lede">
            Split costs with other people, with no account and no server. Everything stays on
            this device until you show it to someone.
          </p>
        </>
      ) : (
        <ul className="grouplist">
          {groups.map((group) => (
            <li key={group.id} className={group.id === groupId ? 'current' : ''}>
              <button
                type="button"
                onClick={() => {
                  void setActiveGroup(group.id);
                  navigate('/');
                }}
              >
                <span className="what">
                  <span className="desc">{group.name}</span>
                  <span className="who">
                    {group.expenses === 0
                      ? 'No expenses yet'
                      : `${group.expenses} expense${group.expenses === 1 ? '' : 's'} · ${formatMoney(0, group.currency).replace(/[\d.,\s]/g, '')}${group.currency}`}
                  </span>
                </span>
                {group.id === groupId && <span className="who">open</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button type="button" className="primary" onClick={() => navigate('/groups/new')}>
          Start a new group
        </button>
        <button type="button" onClick={() => navigate('/join')}>
          Join someone's group
        </button>
      </div>

      <p className="footnote">
        Joining scans a QR code from a phone that already has the group. You need to be next
        to each other — there is no link to send.
      </p>
    </Screen>
  );
}
