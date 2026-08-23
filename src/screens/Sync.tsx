/**
 * QR sync (DESIGN.md §7).
 *
 * Two passes, because merge is a set union and so the second one is trivially
 * a superset:
 *
 *   1. Anna shows, Marco scans   → Marco holds A ∪ M
 *   2. Marco shows, Anna scans   → Anna holds A ∪ M, both converged
 *
 * The sender loops its frames forever, so a missed frame is not an error — it
 * comes round again. That removes all handshaking from the flow, and means
 * neither phone needs to know anything about the other.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FrameCollector, encodeLog, toFrames } from '../sync/codec.js';
import { drawFrame, frameFromText, pickDecoder } from '../sync/qr.js';
import { allEnvelopes, type MergeResult, merge, useLedger } from '../store/ledger.js';
import { groupPrefix } from '../sync/codec.js';
import { Problems, Screen } from '../ui/Chrome.js';

type Stage =
  | { at: 'choose' }
  | { at: 'showing'; swapped: boolean }
  | { at: 'scanning' }
  | { at: 'merged'; result: MergeResult };

/** Frames per second for the display loop. Fast enough to feel live. */
const FRAME_RATE = 4;

/** Decode at this width; full sensor resolution is far slower and no better. */
const SCAN_WIDTH = 640;

function describe(result: MergeResult): string {
  if (result.events === 0) return 'Nothing new — you were already in step.';
  const parts = [
    result.expenses > 0 && `${result.expenses} expense${result.expenses === 1 ? '' : 's'}`,
    result.settlements > 0 && `${result.settlements} payment${result.settlements === 1 ? '' : 's'}`,
    result.members > 0 && `${result.members} ${result.members === 1 ? 'person' : 'people'}`,
  ].filter((part): part is string => typeof part === 'string');

  if (parts.length === 0) return `Added ${result.events} change${result.events === 1 ? '' : 's'}.`;
  const last = parts.pop() as string;
  return `Added ${parts.length > 0 ? `${parts.join(', ')} and ${last}` : last}.`;
}

export function Sync() {
  const { state, groupId, eventCount } = useLedger();
  const [stage, setStage] = useState<Stage>({ at: 'choose' });
  const [problem, setProblem] = useState<string | undefined>();

  return (
    <Screen
      title="Sync"
      subtitle={state.group?.name}
      onBack={stage.at === 'choose'}
      tabs="/sync"
    >
      {stage.at === 'choose' && (
        <>
          <p className="lede small">
            Hold the two phones together. One shows, the other scans, then you swap. Nothing
            is sent anywhere — the codes only travel between the screens.
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => setStage({ at: 'showing', swapped: false })}
              disabled={!groupId}
            >
              Show my ledger
            </button>
            <button type="button" onClick={() => setStage({ at: 'scanning' })}>
              Scan theirs
            </button>
          </div>
          <p className="footnote">
            {eventCount} change{eventCount === 1 ? '' : 's'} to share.
          </p>
        </>
      )}

      {stage.at === 'showing' && groupId && (
        <Presenter
          groupId={groupId}
          swapped={stage.swapped}
          onScanNext={() => setStage({ at: 'scanning' })}
          onDone={() => setStage({ at: 'choose' })}
        />
      )}

      {stage.at === 'scanning' && (
        <Scanner
          expectedGroup={groupId ? groupPrefix(groupId) : undefined}
          onProblem={setProblem}
          onMerged={(result) => {
            setProblem(undefined);
            setStage({ at: 'merged', result });
          }}
          onCancel={() => setStage({ at: 'choose' })}
        />
      )}

      {stage.at === 'merged' && (
        <>
          <p className="notice" role="status">
            {describe(stage.result)}
          </p>
          <p className="lede small">
            Now let them scan yours, so you both end up with the same ledger.
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => setStage({ at: 'showing', swapped: true })}
            >
              Show them mine
            </button>
            <button type="button" className="ghost" onClick={() => setStage({ at: 'choose' })}>
              Done
            </button>
          </div>
        </>
      )}

      {problem && <Problems items={[problem]} />}
    </Screen>
  );
}

// ------------------------------------------------------------------ showing

function Presenter({
  groupId,
  swapped,
  onScanNext,
  onDone,
}: {
  groupId: string;
  swapped: boolean;
  onScanNext: () => void;
  onDone: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<string | undefined>();

  // Snapshotted once: re-encoding on every tick would rebuild the whole
  // payload 4 times a second for no reason.
  const [frames] = useState(() => toFrames(encodeLog(allEnvelopes()), groupId));

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % frames.length), 1000 / FRAME_RATE);
    return () => clearInterval(timer);
  }, [frames.length]);

  useEffect(() => {
    const target = canvas.current;
    const frame = frames[index];
    if (!target || !frame) return;
    drawFrame(target, frame).catch((cause: unknown) =>
      setFailed(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [frames, index]);

  return (
    <>
      <p className="lede small">
        {swapped
          ? 'Let them scan this. When their screen says it is done, you are both in step.'
          : 'Point the other phone at this. It will keep cycling until they have it all.'}
      </p>

      <div className="qr-stage">
        <canvas ref={canvas} className="qr" />
      </div>

      {failed ? (
        <Problems items={[failed]} />
      ) : (
        <p className="tally" aria-live="off">
          Frame {index + 1} of {frames.length} · keeps repeating
        </p>
      )}

      <div className="actions">
        {swapped ? (
          <button type="button" className="primary" onClick={onDone}>
            They have it
          </button>
        ) : (
          <button type="button" className="primary" onClick={onScanNext}>
            Now scan theirs
          </button>
        )}
        <button type="button" className="ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </>
  );
}

// ----------------------------------------------------------------- scanning

function Scanner({
  expectedGroup,
  onMerged,
  onProblem,
  onCancel,
}: {
  expectedGroup: Uint8Array | undefined;
  onMerged: (result: MergeResult) => void;
  onProblem: (problem: string | undefined) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState<{ have: number; total: number } | undefined>();
  const [fatal, setFatal] = useState<string | undefined>();

  const expectedHex = expectedGroup
    ? Array.from(expectedGroup, (byte) => byte.toString(16).padStart(2, '0')).join('')
    : undefined;

  const handleMerged = useCallback(onMerged, [onMerged]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stopped = false;
    const collector = new FrameCollector();
    const scratch = document.createElement('canvas');

    async function run() {
      let read;
      try {
        read = await pickDecoder();
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
      } catch {
        setFatal(
          'The camera could not be opened. Check this site is allowed to use it, then try again.',
        );
        return;
      }

      const element = video.current;
      if (!element || stopped) return;
      element.srcObject = stream;
      await element.play().catch(() => undefined);

      const context = scratch.getContext('2d', { willReadFrequently: true });
      if (!context) {
        setFatal('This browser cannot read from the camera.');
        return;
      }

      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 1000 / 10));
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
          onProblem(undefined);
          setProgress({ have: result.have, total: result.total });
        } else if (result.status === 'rejected') {
          onProblem(result.problem);
        } else {
          // Guard before writing: a scan of the wrong phone would store events
          // nothing can display, which reads as data loss.
          const scanned = result.envelopes[0]?.groupId;
          if (expectedHex && scanned && !scanned.startsWith(expectedHex)) {
            onProblem('That ledger belongs to a different group.');
            collector.reset();
            continue;
          }
          stopped = true;
          handleMerged(await merge(result.envelopes));
          return;
        }
      }
    }

    void run();

    return () => {
      stopped = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [expectedHex, handleMerged, onProblem]);

  return (
    <>
      <p className="lede small">Point this at the other phone's screen.</p>

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

      <button type="button" className="ghost" onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}
