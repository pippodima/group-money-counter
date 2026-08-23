import { useEffect } from 'react';
import { routeParam, useRoute } from './lib/router.js';
import { initLedger, useLedger } from './store/ledger.js';
import { Backup } from './screens/Backup.js';
import { Balances } from './screens/Balances.js';
import { ExpenseForm } from './screens/ExpenseForm.js';
import { Expenses } from './screens/Expenses.js';
import { Members } from './screens/Members.js';
import { SettleUp } from './screens/SettleUp.js';
import { Groups } from './screens/Groups.js';
import { Join } from './screens/Join.js';
import { Setup } from './screens/Setup.js';
import { Sync } from './screens/Sync.js';
import { StorageProbe } from './screens/StorageProbe.js';

export function App() {
  const { ready, groupId, error } = useLedger();
  const route = useRoute();

  useEffect(() => {
    void initLedger();
  }, []);

  if (!ready) {
    return (
      <div className="screen">
        <main className="body">
          <p className="lede">Opening your ledger…</p>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen">
        <main className="body">
          <h1>Storage unavailable</h1>
          <p className="lede danger-text">{error}</p>
          <p className="lede">
            The ledger could not be opened. In Safari this usually means private browsing,
            which blocks the database this app stores everything in.
          </p>
        </main>
      </div>
    );
  }

  // Kept reachable after M0 so the seven-day storage result can still be read.
  if (route === '/probe') return <StorageProbe />;

  if (route === '/groups') return <Groups />;
  if (route === '/groups/new') return <Setup />;
  if (route === '/join') return <Join />;

  // Everything past here needs a group open. With none, the landing screen
  // offers both ways in — starting one, and joining someone else's.
  if (!groupId) return <Groups />;

  if (route === '/new') return <ExpenseForm />;

  const expenseId = routeParam(route, '/expense/');
  if (expenseId) return <ExpenseForm expenseId={expenseId} />;

  if (route === '/balances') return <Balances />;
  if (route === '/settle') return <SettleUp />;
  if (route === '/members') return <Members />;
  if (route === '/backup') return <Backup />;
  if (route === '/sync') return <Sync />;

  return <Expenses />;
}
