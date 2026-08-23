/**
 * A list row that can be swiped away.
 *
 * Never the only route: every expense also has a Delete button inside its
 * editor, so the gesture is an accelerator rather than the sole means — which
 * matters for anyone using a keyboard or a screen reader.
 */

import { useRef, useState, type ReactNode } from 'react';

/** How far the row must travel before letting go deletes it. */
const THRESHOLD = 96;

export function SwipeRow({
  children,
  onDelete,
  label,
}: {
  children: ReactNode;
  onDelete: () => void;
  label: string;
}) {
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);

  const armed = dx <= -THRESHOLD;

  function release() {
    origin.current = undefined;
    setSettling(true);
    if (armed) onDelete();
    setDx(0);
  }

  return (
    <div className="swipe">
      <div className={armed ? 'swipe-behind armed' : 'swipe-behind'} aria-hidden="true">
        <span>{armed ? 'Release to delete' : 'Delete'}</span>
      </div>

      <div
        className="swipe-front"
        style={{
          transform: `translateX(${dx}px)`,
          transition: settling ? 'transform .18s ease-out' : 'none',
        }}
        onPointerDown={(event) => {
          origin.current = { x: event.clientX, y: event.clientY };
          setSettling(false);
        }}
        onPointerMove={(event) => {
          const from = origin.current;
          if (!from) return;
          const moved = event.clientX - from.x;
          // Vertical intent wins, so swiping never hijacks page scrolling.
          if (Math.abs(moved) < Math.abs(event.clientY - from.y)) return;
          setDx(Math.min(0, Math.max(-160, moved)));
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {children}
      </div>

      {/* The accessible equivalent of the gesture. */}
      <button type="button" className="swipe-delete" onClick={onDelete} aria-label={label}>
        ×
      </button>
    </div>
  );
}
