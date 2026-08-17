/**
 * Backup files.
 *
 * A backup is the event log, verbatim. Importing one runs the *same* merge
 * path as a QR sync will, which is deliberate: the riskiest code in the
 * project then gets exercised every time anyone takes a backup, instead of
 * only during sync (DESIGN.md §9).
 *
 * Because merging is a set union, a backup is not a snapshot that overwrites
 * things — importing an old one adds back whatever it still holds and changes
 * nothing else.
 */

import { type Envelope, isEnvelope } from '../core/events.js';

/** Bumped only when older readers could not make sense of a newer file. */
export const BACKUP_FORMAT = 'gmc/1';

export interface Backup {
  format: string;
  exportedAt: string;
  groupId: string;
  groupName: string;
  events: Envelope[];
}

export type ParseResult =
  | { ok: true; backup: Backup }
  | { ok: false; problem: string };

export function buildBackup(
  groupId: string,
  groupName: string,
  events: readonly Envelope[],
): Backup {
  return {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    groupId,
    groupName,
    events: [...events],
  };
}

export function serialiseBackup(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

/**
 * Reads a backup file, refusing anything it cannot fully vouch for.
 *
 * All or nothing on purpose: half-importing a corrupted file would leave a
 * ledger that looks complete and quietly isn't, and the log cannot be edited
 * afterwards to take the bad events back out.
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: "That file isn't valid JSON. Is it definitely a backup?" };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, problem: "That doesn't look like a backup file." };
  }

  const record = raw as Record<string, unknown>;
  const format = record['format'];

  if (typeof format !== 'string') {
    return { ok: false, problem: "That doesn't look like a backup file." };
  }
  if (format !== BACKUP_FORMAT) {
    const [family, version] = format.split('/');
    return {
      ok: false,
      problem:
        family === 'gmc'
          ? `This backup is in format ${version ?? '?'}, and this version reads ${BACKUP_FORMAT.split('/')[1]}. Update the app and try again.`
          : "That backup was written by a different app.",
    };
  }

  if (!Array.isArray(record['events'])) {
    return { ok: false, problem: 'The backup has no events in it.' };
  }

  const events = record['events'];
  const bad = events.findIndex((event) => !isEnvelope(event));
  if (bad !== -1) {
    return {
      ok: false,
      problem: `Entry ${bad + 1} of ${events.length} is damaged, so nothing was imported.`,
    };
  }

  const groups = new Set(events.map((event) => (event as Envelope).groupId));
  if (groups.size > 1) {
    return { ok: false, problem: 'That backup holds more than one group, which is not supported yet.' };
  }

  const groupId =
    typeof record['groupId'] === 'string' && record['groupId'] !== ''
      ? record['groupId']
      : ([...groups][0] ?? '');

  if (groupId === '') {
    return { ok: false, problem: 'The backup has no events in it.' };
  }

  return {
    ok: true,
    backup: {
      format,
      exportedAt: typeof record['exportedAt'] === 'string' ? record['exportedAt'] : '',
      groupId,
      groupName: typeof record['groupName'] === 'string' ? record['groupName'] : 'Untitled',
      events: events as Envelope[],
    },
  };
}

/** `"Lisbon weekend"` → `"lisbon-weekend-2026-08-14.gmc.json"` */
export function backupFilename(groupName: string, when = new Date()): string {
  const slug =
    groupName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'ledger';
  return `${slug}-${when.toISOString().slice(0, 10)}.gmc.json`;
}
