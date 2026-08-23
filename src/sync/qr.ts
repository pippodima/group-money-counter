/**
 * Drawing and reading QR codes.
 *
 * The roadmap named `zxing-wasm` for decoding. Using `jsQR` instead, for two
 * reasons. It is ~40 KB of plain JavaScript against roughly a megabyte of
 * WebAssembly, and — the deciding one — zxing-wasm fetches its `.wasm` from a
 * CDN by default. A decoder that phones home would falsify the one claim this
 * whole app is built on, and "we remembered to configure it" is a weaker
 * guarantee than "it cannot".
 *
 * The scanning conditions here are close to ideal anyway: a bright phone
 * screen at arm's length, high contrast, flat, well lit by its own backlight.
 * If real hardware proves jsQR too slow or too fussy, zxing-wasm with a
 * locally bundled binary is the upgrade path.
 */

import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { decodeBase45, encodeBase45 } from './base45.js';

/**
 * Error correction level.
 *
 * M recovers ~15% of a damaged code. Higher levels would survive a worse
 * photograph but need a denser grid to hold the same payload, and density is
 * the thing that actually breaks screen-to-camera scanning.
 */
const ERROR_CORRECTION = 'M';

/**
 * `BarcodeDetector` is not in TypeScript's DOM library yet, so the slice of
 * it used here is declared locally rather than pulling in a polyfill's types.
 */
interface BarcodeDetectorLike {
  detect(source: ImageData): Promise<Array<{ rawValue: string }>>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

/** Renders one frame. Returns the QR version chosen, for sizing checks. */
export async function drawFrame(canvas: HTMLCanvasElement, frame: Uint8Array): Promise<void> {
  await QRCode.toCanvas(canvas, encodeBase45(frame), {
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: 2,
    scale: 4,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

/** The QR version a frame would need — 1 to 40. Used to keep density honest. */
export async function frameVersion(frame: Uint8Array): Promise<number> {
  const qr = QRCode.create(encodeBase45(frame), { errorCorrectionLevel: ERROR_CORRECTION });
  return qr.version;
}

/** Reads text out of a QR code, or undefined if there isn't one in the frame. */
export type ReadImage = (image: ImageData) => Promise<string | undefined>;

/**
 * Picks the fastest decoder this browser has.
 *
 * `BarcodeDetector` is native and hardware-accelerated but exists only in
 * Chrome; Safari has never shipped it, so iOS always takes the jsQR path.
 * Both hand back a string, which is exactly why frames are base45 rather than
 * raw bytes.
 */
export async function pickDecoder(): Promise<ReadImage> {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;

  if (Detector) {
    try {
      const supported = await Detector.getSupportedFormats?.();
      if (!supported || supported.includes('qr_code')) {
        const detector = new Detector({ formats: ['qr_code'] });
        return async (image) => {
          const found = await detector.detect(image);
          return found[0]?.rawValue;
        };
      }
    } catch {
      // Falls through to jsQR — some browsers expose the constructor but
      // throw when the underlying platform has no QR support.
    }
  }

  return async (image) =>
    jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data;
}

/** Turns scanned text back into frame bytes, or undefined if it isn't ours. */
export function frameFromText(text: string): Uint8Array | undefined {
  return decodeBase45(text);
}
