/**
 * Export and import.
 *
 * Until QR sync lands this is the only way a ledger leaves the device, and it
 * stays the only way it survives a lost phone. Deliberately prominent rather
 * than tucked into a settings menu (DESIGN.md §9).
 */

import { useRef, useState } from 'react';
import {
  BACKUP_FORMAT,
  backupFilename,
  buildBackup,
  parseBackup,
  serialiseBackup,
} from '../lib/backup.js';
import { allEnvelopes, type MergeResult, merge, useLedger } from '../store/ledger.js';
import { Problems, Screen } from '../ui/Chrome.js';

type Outcome =
  | { kind: 'merged'; result: MergeResult }
  | { kind: 'refused'; problem: string }
  | { kind: 'exported'; filename: string };

function describe(result: MergeResult): string {
  if (result.events === 0) return 'Nothing new — you already had all of it.';

  const parts = [
    result.expenses > 0 && `${result.expenses} expense${result.expenses === 1 ? '' : 's'}`,
    result.settlements > 0 &&
      `${result.settlements} payment${result.settlements === 1 ? '' : 's'}`,
    result.members > 0 && `${result.members} ${result.members === 1 ? 'person' : 'people'}`,
  ].filter((part): part is string => typeof part === 'string');

  if (parts.length === 0) return `Added ${result.events} change${result.events === 1 ? '' : 's'}.`;

  const last = parts.pop() as string;
  return `Added ${parts.length > 0 ? `${parts.join(', ')} and ${last}` : last}.`;
}

export function Backup() {
  const { state, groupId, eventCount } = useLedger();
  const [outcome, setOutcome] = useState<Outcome | undefined>();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function exportFile() {
    if (!groupId) return;
    const name = state.group?.name ?? 'Ledger';
    const backup = buildBackup(groupId, name, allEnvelopes());
    const filename = backupFilename(name);

    const url = URL.createObjectURL(
      new Blob([serialiseBackup(backup)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    // Released on the next tick; revoking immediately can cancel the download
    // on some browsers before it has started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    setOutcome({ kind: 'exported', filename });
  }

  async function importFile(file: File) {
    setBusy(true);
    setOutcome(undefined);
    try {
      const parsed = parseBackup(await file.text());

      if (!parsed.ok) {
        setOutcome({ kind: 'refused', problem: parsed.problem });
        return;
      }

      // One group per ledger for now. Merging a different one would store
      // events that nothing can display, which looks like data loss.
      if (groupId && parsed.backup.groupId !== groupId) {
        setOutcome({
          kind: 'refused',
          problem: `That backup is for “${parsed.backup.groupName}”, which is a different group from this one. Holding several groups at once is not supported yet.`,
        });
        return;
      }

      setOutcome({ kind: 'merged', result: await merge(parsed.backup.events) });
    } catch (cause) {
      setOutcome({
        kind: 'refused',
        problem: cause instanceof Error ? cause.message : 'That file could not be read.',
      });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <Screen title="Backup" subtitle={state.group?.name} onBack>
      <section className="stack">
        <h2 className="section-title">Save a copy</h2>
        <p className="lede small">
          Writes every expense and payment to a file you keep. Nothing is uploaded — the file
          goes wherever you send it, and nowhere else.
        </p>
        <button type="button" className="primary" onClick={exportFile} disabled={!groupId}>
          Export {eventCount} change{eventCount === 1 ? '' : 's'}
        </button>
      </section>

      <section className="stack">
        <h2 className="section-title">Restore or combine</h2>
        <p className="lede small">
          Adds anything the file has that this device doesn't. It never removes or overwrites
          what is already here, so importing an old backup is always safe.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
      </section>

      {outcome?.kind === 'refused' && <Problems items={[outcome.problem]} />}

      {outcome?.kind === 'merged' && (
        <p className="notice" role="status">
          {describe(outcome.result)}
        </p>
      )}

      {outcome?.kind === 'exported' && (
        <p className="notice" role="status">
          Saved as {outcome.filename}
        </p>
      )}

      <p className="footnote">
        Backups are plain JSON in format {BACKUP_FORMAT}. Browser storage can be cleared
        without warning — by a wipe of website data, or by deleting the app from your home
        screen — so keep a copy somewhere else.
      </p>
    </Screen>
  );
}
