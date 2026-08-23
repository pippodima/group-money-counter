/**
 * Base45 (RFC 9285).
 *
 * QR frames are binary, but `BarcodeDetector` — the fast native decoder on
 * Android — hands back a *string*, not bytes. Arbitrary binary does not
 * survive that trip. Base64 would, at 33% overhead in QR byte mode.
 *
 * Base45's alphabet is exactly QR's alphanumeric charset, which packs two
 * characters into 11 bits. Three characters carry two bytes, so 16 bits of
 * payload cost 16.5 bits of QR — about 3% overhead, against 33% for base64.
 * This is the same trick the EU Digital COVID Certificate used, for the same
 * reason.
 *
 * Forty lines and a property test, rather than a dependency.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const VALUES = new Map<string, number>(
  Array.from(ALPHABET, (character, index) => [character, index]),
);

export function encodeBase45(bytes: Uint8Array): string {
  let out = '';

  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      // Two bytes become three characters, least significant first.
      const value = (bytes[i] as number) * 256 + (bytes[i + 1] as number);
      out +=
        (ALPHABET[value % 45] as string) +
        (ALPHABET[Math.floor(value / 45) % 45] as string) +
        (ALPHABET[Math.floor(value / 2025)] as string);
    } else {
      const value = bytes[i] as number;
      out += (ALPHABET[value % 45] as string) + (ALPHABET[Math.floor(value / 45)] as string);
    }
  }

  return out;
}

/** Returns undefined for anything that is not valid base45. */
export function decodeBase45(text: string): Uint8Array | undefined {
  // A length of 1 more than a multiple of 3 cannot be produced by the encoder.
  if (text.length % 3 === 1) return undefined;

  const bytes: number[] = [];

  for (let i = 0; i < text.length; i += 3) {
    const digits: number[] = [];
    for (let j = i; j < Math.min(i + 3, text.length); j++) {
      const value = VALUES.get(text[j] as string);
      if (value === undefined) return undefined;
      digits.push(value);
    }

    if (digits.length === 3) {
      const value =
        (digits[0] as number) + (digits[1] as number) * 45 + (digits[2] as number) * 2025;
      if (value > 0xffff) return undefined;
      bytes.push(value >> 8, value & 0xff);
    } else {
      const value = (digits[0] as number) + (digits[1] as number) * 45;
      if (value > 0xff) return undefined;
      bytes.push(value);
    }
  }

  return Uint8Array.from(bytes);
}
