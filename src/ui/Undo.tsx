/**
 * A deletion held back so it can be taken back.
 *
 * Undo cannot be an event: deletion is absorbing (D6), so a tombstone can
 * never be lifted — that rule is what stops deleted expenses reappearing
 * after a sync. So nothing is written until the window closes. Undo simply
 * cancels the timer, and the log never learns anything happened.
 *
 * If the app is closed inside the window the delete is lost rather than
 * applied, which is the safe direction to fail.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const WINDOW_MS = 6000;

export interface Pending {
  id: string;
  description: string;
}

export function usePendingDelete(commit: (id: string) => void | Promise<void>) {
  const [pending, setPending] = useState<Pending | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(commit);
  latest.current = commit;

  /**
   * The outstanding deletion, mirrored outside React state.
   *
   * `flush` runs during unmount, and React will not reliably invoke a
   * setState updater on a component that is going away — so reading the
   * pending value that way silently dropped the deletion when you navigated
   * off the screen mid-window.
   */
  const outstanding = useRef<Pending | undefined>(undefined);

  const clear = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  const flush = useCallback(() => {
    clear();
    const current = outstanding.current;
    outstanding.current = undefined;
    setPending(undefined);
    if (current) void latest.current(current.id);
  }, []);

  const remove = useCallback(
    (next: Pending) => {
      // A second swipe commits the first; only one can be outstanding.
      flush();
      outstanding.current = next;
      setPending(next);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        outstanding.current = undefined;
        setPending(undefined);
        void latest.current(next.id);
      }, WINDOW_MS);
    },
    [flush],
  );

  const undo = useCallback(() => {
    clear();
    outstanding.current = undefined;
    setPending(undefined);
  }, []);

  // Leaving the screen commits: the row was visibly gone, so honour that.
  useEffect(() => flush, [flush]);

  return { pending, remove, undo };
}

export function UndoBar({ pending, onUndo }: { pending: Pending; onUndo: () => void }) {
  return (
    <div className="undobar" role="status">
      <span className="undo-text">Deleted “{pending.description}”</span>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}
