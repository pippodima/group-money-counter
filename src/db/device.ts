/**
 * This install's identity.
 *
 * A device id is 16 lowercase hex characters — 64 bits — rather than a UUID.
 * It is not a UUID because it is embedded in the tail of every HLC and in
 * every event id, so it is repeated thousands of times in a log that has to
 * fit through a QR code. Dropping the hyphens and the unused version bits
 * roughly halves that overhead, and 64 random bits is far more than enough to
 * keep a handful of phones from colliding.
 *
 * It identifies the *install*, not the person. Reinstalling makes a new one,
 * which is harmless: it only ever has to be unique, never stable.
 */

import { getMeta, setMeta } from './database.js';

const KEY = 'deviceId';
const BYTES = 8;

let cached: string | undefined;

function generate(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BYTES));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  const stored = await getMeta<string>(KEY);
  if (typeof stored === 'string' && /^[0-9a-f]{16}$/.test(stored)) {
    cached = stored;
    return cached;
  }

  const fresh = generate();
  await setMeta(KEY, fresh);
  cached = fresh;
  return fresh;
}
