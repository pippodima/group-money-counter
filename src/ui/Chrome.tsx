/** Shared layout: screen frame, headers, tab bar, and small building blocks. */

import type { ReactNode } from 'react';
import { back, navigate } from '../lib/router.js';

export function Screen({
  title,
  subtitle,
  onBack,
  action,
  children,
  tabs,
}: {
  title: ReactNode;
  subtitle?: string | undefined;
  onBack?: boolean | undefined;
  action?: ReactNode;
  children: ReactNode;
  tabs?: string | undefined;
}) {
  return (
    <div className="screen">
      <header className="topbar">
        {onBack && (
          <button type="button" className="icon" onClick={back} aria-label="Back">
            ‹
          </button>
        )}
        <div className="titles">
          {typeof title === 'string' ? <h1>{title}</h1> : title}
          {typeof title === 'string' && subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>

      <main className={tabs ? 'body with-tabs' : 'body'}>{children}</main>

      {tabs && <TabBar active={tabs} />}
    </div>
  );
}

const TABS = [
  { route: '/', label: 'Expenses' },
  { route: '/balances', label: 'Balances' },
  { route: '/settle', label: 'Settle up' },
  { route: '/sync', label: 'Sync' },
] as const;

function TabBar({ active }: { active: string }) {
  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map((tab) => (
        <button
          key={tab.route}
          type="button"
          className={tab.route === active ? 'tab current' : 'tab'}
          aria-current={tab.route === active ? 'page' : undefined}
          onClick={() => navigate(tab.route)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export function Empty({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      <p className="empty-hint">{hint}</p>
      {action}
    </div>
  );
}

export function Problems({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="problems" role="alert">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
