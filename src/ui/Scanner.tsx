/**
 * The camera side of QR sync.
 *
 * Shared by syncing an open group and joining a new one — the optics are
 * identical, only what happens afterwards differs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FrameCollector } from '../sync/codec.js';
import { frameFromText, pickDecoder } from '../sync/qr.js';
import type { Envelope } from '../core/events.js';
import { Problems } from './Chrome.js';

/** Decode at this width; full sensor resolution is far slower and no better. */
const SCAN_WIDTH = 640;

/** How often to sample the camera. Faster than this just heats the phone. */
const SAMPLE_INTERVAL = 100;

export function Scanner({
  hint,
  onScanned,
  onCancel,
}: {
  hint: string;
  onScanned: (envelopes: Envelope[]) => void | Promise<void>;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState<{ have: number; total: number } | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [fatal, setFatal] = useState<string | undefined>();

  const deliver = useCallback(onScanned, [onScanned]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stopped = false;
    const collector = new FrameCollector();
    const scratch = document.createElement('canvas');

    async function run() {
      let read: Awaited<ReturnType<typeof pickDecoder>>;
      try {
        read = await pickDecoder();
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
      } catch {
        setFatal('The camera could not be opened. Check this site is allowed to use it.');
        return;
      }

      const element = video.current;
      if (!element || stopped) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      element.srcObject = stream;
      await element.play().catch(() => undefined);

      const context = scratch.getContext('2d', { willReadFrequently: true });
      if (!context) {
        setFatal('This browser cannot read from the camera.');
        return;
      }

      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL));
        if (stopped || element.videoWidth === 0) continue;

        const scale = Math.min(1, SCAN_WIDTH / element.videoWidth);
        scratch.width = Math.round(element.videoWidth * scale);
        scratch.height = Math.round(element.videoHeight * scale);
        context.drawImage(element, 0, 0, scratch.width, scratch.height);

        const text = await read(context.getImageData(0, 0, scratch.width, scratch.height));
        if (!text) continue;

        const frame = frameFromText(text);
        if (!frame) continue;

        const result = collector.add(frame);
        if (result.status === 'partial') {
          setProblem(undefined);
          setProgress({ have: result.have, total: result.total });
        } else if (result.status === 'rejected') {
          setProblem(result.problem);
        } else {
          stopped = true;
          await deliver(result.envelopes);
          return;
        }
      }
    }

    void run();

    return () => {
      stopped = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [deliver]);

  return (
    <>
      <p className="lede small">{hint}</p>

      <div className="qr-stage">
        <video ref={video} className="viewfinder" playsInline muted />
      </div>

      {fatal ? (
        <Problems items={[fatal]} />
      ) : (
        <p className="tally">
          {progress ? `${progress.have} of ${progress.total} frames` : 'Looking for a code…'}
        </p>
      )}

      {problem && !fatal && <Problems items={[problem]} />}

      <button type="button" className="ghost" onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}
