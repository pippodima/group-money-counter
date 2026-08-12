/**
 * The M0 gate (DESIGN.md §9, ROADMAP M0).
 *
 * Safari purges script-writable storage after seven days without interaction,
 * but web apps added to the Home Screen are documented as exempt. This whole
 * project rests on that exemption, so this screen exists to verify it on real
 * hardware before anything is built that could lose data.
 *
 * Install it to the home screen, open it once, then leave it alone for more
 * than seven days and open it again. If the age below still counts from the
 * original write, the exemption holds.
 */

import { useEffect, useState } from 'react';
import { countEvents, getMeta, setMeta } from '../db/database.js';
import { getDeviceId } from '../db/device.js';

const PROBE_KEY = 'storageProbe';
const MAX_VISITS = 200;
const DAY = 86_400_000;

interface ProbeRecord {
  firstWrittenAt: number;
  visits: number[];
}

interface Snapshot {
  probe: ProbeRecord;
  deviceId: string;
  events: number;
  persisted: boolean;
  standalone: boolean;
  usage: number | undefined;
  quota: number | undefined;
}

function isProbeRecord(value: unknown): value is ProbeRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<ProbeRecord>;
  return typeof record.firstWrittenAt === 'number' && Array.isArray(record.visits);
}

async function load(): Promise<Snapshot> {
  const now = Date.now();
  const existing = await getMeta<unknown>(PROBE_KEY);

  const probe: ProbeRecord = isProbeRecord(existing)
    ? { ...existing, visits: [...existing.visits, now].slice(-MAX_VISITS) }
    : { firstWrittenAt: now, visits: [now] };

  await setMeta(PROBE_KEY, probe);

  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);

  return {
    probe,
    deviceId: await getDeviceId(),
    events: await countEvents(),
    persisted: (await navigator.storage?.persisted?.().catch(() => false)) ?? false,
    // Optional call: every real browser has matchMedia, but a missing one
    // should not be reported to the user as a storage failure.
    standalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    usage: estimate?.usage,
    quota: estimate?.quota,
  };
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function formatAge(ms: number): string {
  const days = Math.floor(ms / DAY);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function StorageProbe() {
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    load()
      .then(setSnapshot)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  async function requestPersistence() {
    setRequesting(true);
    try {
      await navigator.storage?.persist?.();
      setSnapshot(await load());
    } finally {
      setRequesting(false);
    }
  }

  if (error) {
    return (
      <main className="probe">
        <h1>Storage unavailable</h1>
        <p className="lede" style={{ color: 'var(--danger)' }}>{error}</p>
        <p className="lede">
          IndexedDB could not be opened. In Safari this usually means private browsing.
        </p>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="probe">
        <p className="lede">Reading storage…</p>
      </main>
    );
  }

  const { probe, persisted, standalone, deviceId, events, usage, quota } = snapshot;
  const age = Date.now() - probe.firstWrittenAt;
  const survived = age >= 7 * DAY;
  const returning = probe.visits.length > 1;

  return (
    <main className="probe">
      <p className="eyebrow">Milestone 0 · storage gate</p>
      <h1>Group Money Counter</h1>
      <p className="lede">
        Nothing is built yet. This screen exists to prove that data written here survives
        more than seven days untouched on a home-screen install.
      </p>

      <section className={`verdict${survived ? ' good' : ''}`}>
        <span className="age">{formatAge(age)}</span>
        <span className="caption">
          {survived
            ? 'survived past the seven-day mark — the exemption holds'
            : returning
              ? 'and counting. Come back after seven days.'
              : 'just written. Close the app and come back in a week.'}
        </span>
      </section>

      <dl className="facts">
        <div>
          <dt>First written</dt>
          <dd>{dateTime.format(probe.firstWrittenAt)}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd>
            {probe.visits.length} time{probe.visits.length === 1 ? '' : 's'}
          </dd>
        </div>
        <div>
          <dt>Launched from</dt>
          <dd className={standalone ? '' : 'flag'}>
            {standalone ? 'home screen' : 'browser tab — install it to test properly'}
          </dd>
        </div>
        <div>
          <dt>Storage persisted</dt>
          <dd className={persisted ? '' : 'flag'}>{persisted ? 'granted' : 'not granted'}</dd>
        </div>
        <div>
          <dt>Used</dt>
          <dd>
            {formatBytes(usage)} of {formatBytes(quota)}
          </dd>
        </div>
        <div>
          <dt>Events stored</dt>
          <dd>{events}</dd>
        </div>
        <div>
          <dt>Device</dt>
          <dd className="mono">{deviceId}</dd>
        </div>
      </dl>

      {!persisted && (
        <p className="action">
          <button type="button" onClick={requestPersistence} disabled={requesting}>
            {requesting ? 'Asking…' : 'Request persistent storage'}
          </button>
          <span className="hint">
            Asks the browser not to evict this data. Safari decides on its own and may
            ignore it; that outcome is itself a useful result.
          </span>
        </p>
      )}

      <p className="footnote">
        Record what you find in DIARY.md. If the age resets after a week on iOS, the plan
        needs rethinking before M1.
      </p>
    </main>
  );
}
