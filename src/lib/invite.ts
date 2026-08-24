/**
 * Inviting someone who isn't in the room.
 *
 * QR sync needs two phones on one table. For everyone else the invite is a
 * file, handed to whatever app the sender already uses — WhatsApp, Signal,
 * mail, AirDrop. The app never touches the network; it produces a file and
 * asks the operating system to pass it on.
 *
 * That distinction is the whole point, and worth being precise about:
 * `navigator.share` opens the OS share sheet. Nothing is transmitted unless
 * the sender picks a destination, and whatever happens after that belongs to
 * the app they picked. The claim was never "this data can never travel" — it
 * is that *this app* never sends it anywhere on its own.
 *
 * An invite is an ordinary backup file. Same format, same validation, same
 * merge on the way in, so there is no second code path to keep honest.
 */

import type { Envelope } from '../core/events.js';
import { backupFilename, buildBackup, serialiseBackup } from './backup.js';

export type SendOutcome = 'shared' | 'downloaded' | 'cancelled';

export function buildInviteFile(
  groupId: string,
  groupName: string,
  envelopes: readonly Envelope[],
): File {
  const contents = serialiseBackup(buildBackup(groupId, groupName, envelopes));
  return new File([contents], backupFilename(groupName), { type: 'application/json' });
}

/** Saves a file to disk. The fallback wherever the share sheet is unavailable. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  // Revoking immediately can cancel the download before the blob is read.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Hands the invite to the OS share sheet, or saves it if there isn't one.
 *
 * Safari on iOS and Chrome on Android both share files; most desktop browsers
 * do not, and fall through to a download.
 */
export async function sendInvite(file: File, groupName: string): Promise<SendOutcome> {
  const sharable =
    typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  if (sharable) {
    try {
      await navigator.share({
        files: [file],
        title: groupName,
        text: `Join “${groupName}” in Group Money Counter. Open the app, choose Join, then pick this file.`,
      });
      return 'shared';
    } catch (cause) {
      // Dismissing the sheet is an ordinary outcome, not a failure.
      if (cause instanceof Error && cause.name === 'AbortError') return 'cancelled';
      downloadFile(file);
      return 'downloaded';
    }
  }

  downloadFile(file);
  return 'downloaded';
}
