/**
 * Joining a group someone else already has.
 *
 * Two ways in, because there are two situations. Next to them: scan their
 * screen. Anywhere else: open the invite file they sent you.
 *
 * There is no invite *link*, because there is no server to put one on. The
 * file is the invite, and whatever carried it — a message, mail, AirDrop —
 * is somebody else's app, chosen by the sender.
 */

import { useRef, useState } from 'react';
import { parseBackup } from '../lib/backup.js';
import { navigate } from '../lib/router.js';
import { merge, setActiveGroup } from '../store/ledger.js';
import { Problems, Screen } from '../ui/Chrome.js';
import { Scanner } from '../ui/Scanner.js';
import { describeMerge } from './Sync.js';
import type { Envelope } from '../core/events.js';
import type { MergeResult } from '../store/ledger.js';

type Stage =
  | { at: 'choose' }
  | { at: 'scanning' }
  | { at: 'joined'; groupId: string; summary: string }
  | { at: 'refused'; problem: string };

export function Join() {
  const [stage, setStage] = useState<Stage>({ at: 'choose' });
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Both routes end here: same merge, same validation, same reporting. */
  async function accept(envelopes: readonly Envelope[]) {
    const result: MergeResult = await merge(envelopes);

    if (!result.groupId) {
      setStage({ at: 'refused', problem: 'You already have everything from that invite.' });
      return;
    }

    setStage({ at: 'joined', groupId: result.groupId, summary: describeMerge(result) });
  }

  async function openFile(file: File) {
    setBusy(true);
    try {
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) {
        setStage({ at: 'refused', problem: parsed.problem });
        return;
      }
      await accept(parsed.backup.events);
    } catch {
      setStage({ at: 'refused', problem: 'That file could not be read.' });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <Screen title="Join a group" onBack={stage.at === 'choose'}>
      {stage.at === 'choose' && (
        <>
          <section className="stack">
            <h2 className="section-title">They're here with you</h2>
            <p className="lede small">
              Ask them to open Sync and tap “Show my ledger”, then scan their screen.
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => setStage({ at: 'scanning' })}
            >
              Scan their code
            </button>
          </section>

          <section className="stack">
            <h2 className="section-title">They sent you an invite</h2>
            <p className="lede small">
              Save the file they sent, then open it here. It works offline and however long
              after they sent it.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void openFile(file);
              }}
            />
          </section>
        </>
      )}

      {stage.at === 'scanning' && (
        <Scanner
          hint="Point this at the other phone's screen."
          onCancel={() => setStage({ at: 'choose' })}
          onScanned={accept}
        />
      )}

      {stage.at === 'refused' && (
        <>
          <Problems items={[stage.problem]} />
          <button type="button" className="primary" onClick={() => setStage({ at: 'choose' })}>
            Try again
          </button>
        </>
      )}

      {stage.at === 'joined' && (
        <>
          <p className="notice" role="status">
            {stage.summary}
          </p>
          <p className="lede small">
            You're in. Anything you add from here reaches them the next time you sync — in
            person with a code, or by sending an invite back.
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={async () => {
                await setActiveGroup(stage.groupId);
                navigate('/');
              }}
            >
              Open the group
            </button>
          </div>
        </>
      )}
    </Screen>
  );
}
