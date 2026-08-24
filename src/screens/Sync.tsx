/**
 * QR sync (DESIGN.md §7).
 *
 * Two passes, because merge is a set union and so the second is trivially a
 * superset:
 *
 *   1. Anna shows, Marco scans   → Marco holds A ∪ M
 *   2. Marco shows, Anna scans   → Anna holds A ∪ M, both converged
 *
 * The sender loops its frames forever, so a missed frame is not an error — it
 * comes round again. That removes all handshaking, and neither phone needs to
 * know anything about the other.
 */

import { useEffect, useRef, useState } from 'react';
import { encodeLog, toFrames } from '../sync/codec.js';
import { drawFrame } from '../sync/qr.js';
import {
  activeEnvelopes,
  type MergeResult,
  merge,
  setActiveGroup,
  useLedger,
} from '../store/ledger.js';
import { buildInviteFile, sendInvite, type SendOutcome } from '../lib/invite.js';
import { Problems, Screen } from '../ui/Chrome.js';
import { Scanner } from '../ui/Scanner.js';

type Stage =
  | { at: 'choose' }
  | { at: 'showing'; swapped: boolean }
  | { at: 'scanning' }
  | { at: 'merged'; result: MergeResult };

/** Frames per second for the display loop. Fast enough to feel live. */
const FRAME_RATE = 4;

export function describeMerge(result: MergeResult): string {
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
  const { state, groupId, groups, eventCount } = useLedger();
  const [stage, setStage] = useState<Stage>({ at: 'choose' });

  const merged = stage.at === 'merged' ? stage.result : undefined;
  const elsewhere =
    merged?.groupId !== undefined && merged.groupId !== groupId
      ? groups.find((group) => group.id === merged.groupId)
      : undefined;

  return (
    <Screen title="Sync" subtitle={state.group?.name} onBack={stage.at === 'choose'} tabs="/sync">
      {stage.at === 'choose' && (
        <>
          <section className="stack">
            <h2 className="section-title">They're here with you</h2>
            <p className="lede small">
              One shows, the other scans, then you swap. Nothing is sent anywhere — the codes
              only travel between the screens.
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
          </section>

          {groupId && <InviteByFile groupId={groupId} name={state.group?.name ?? 'this group'} />}

          <p className="footnote">
            Sharing {eventCount} change{eventCount === 1 ? '' : 's'} from{' '}
            {state.group?.name ?? 'this group'}. Your other groups stay on this device.
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
          hint="Point this at the other phone's screen."
          onCancel={() => setStage({ at: 'choose' })}
          onScanned={async (envelopes) => {
            setStage({ at: 'merged', result: await merge(envelopes) });
          }}
        />
      )}

      {merged && (
        <>
          <p className="notice" role="status">
            {describeMerge(merged)}
          </p>

          {elsewhere ? (
            // Scanning a group you are not currently looking at is normal, not
            // an error — it is how you get a second trip onto this phone.
            <>
              <p className="lede small">
                That was <strong>{elsewhere.name}</strong>, not the group you have open.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void setActiveGroup(elsewhere.id)}
                >
                  Open {elsewhere.name}
                </button>
                <button type="button" className="ghost" onClick={() => setStage({ at: 'choose' })}>
                  Stay here
                </button>
              </div>
            </>
          ) : (
            <>
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
        </>
      )}
    </Screen>
  );
}

// ------------------------------------------------------------- invite by file

/**
 * For someone who is not in the room.
 *
 * The app builds a file and hands it to the OS share sheet; the sender picks
 * WhatsApp, mail, AirDrop, whatever they already use. Nothing is transmitted
 * by this app, and nothing at all until they choose a destination.
 */
function InviteByFile({ groupId, name }: { groupId: string; name: string }) {
  const [outcome, setOutcome] = useState<SendOutcome | undefined>();
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setOutcome(undefined);
    try {
      const file = buildInviteFile(groupId, name, activeEnvelopes());
      setOutcome(await sendInvite(file, name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <h2 className="section-title">They're somewhere else</h2>
      <p className="lede small">
        Send them an invite file however you normally talk — a message, mail, anything. They
        open the app, choose <strong>Join</strong>, and pick the file.
      </p>
      <button type="button" onClick={send} disabled={busy}>
        {busy ? 'Preparing…' : 'Send an invite'}
      </button>

      {outcome === 'downloaded' && (
        <p className="notice" role="status">
          Saved to your device. Attach it to a message to send it on.
        </p>
      )}
      {outcome === 'shared' && (
        <p className="notice" role="status">
          Handed to the app you picked.
        </p>
      )}

      <p className="field-hint">
        The invite carries this group's expenses too, so they arrive up to date. Choosing where
        to send it is yours — this app never sends anything on its own.
      </p>
    </section>
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
  // payload four times a second for no reason.
  const [frames] = useState(() => toFrames(encodeLog(activeEnvelopes()), groupId));

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
          : 'Point the other phone at this. It keeps cycling until they have it all.'}
      </p>

      <div className="qr-stage">
        <canvas ref={canvas} className="qr" />
      </div>

      {failed ? (
        <Problems items={[failed]} />
      ) : (
        <p className="tally">
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
