/**
 * The group name in the title bar, swipeable between groups.
 *
 * A bare swipe gesture is undiscoverable, so it is never the only way in:
 * arrows flank the name, dots show where you are, and tapping opens the full
 * list. The swipe is an accelerator for people who find it, not a secret.
 */

import { useRef, useState } from 'react';
import { navigate } from '../lib/router.js';
import { setActiveGroup, useLedger } from '../store/ledger.js';

/** How far a drag must travel before it counts as a swipe rather than a tap. */
const THRESHOLD = 48;

export function GroupSwitcher({ subtitle }: { subtitle?: string | undefined }) {
  const { groups, groupId, state } = useLedger();
  const [drag, setDrag] = useState(0);
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);

  const index = groups.findIndex((group) => group.id === groupId);
  const alone = groups.length < 2;

  function go(step: number) {
    if (alone) return;
    const next = groups[(index + step + groups.length) % groups.length];
    if (next) void setActiveGroup(next.id);
  }

  return (
    <div className="switcher">
      <div
        className="switcher-row"
        style={{ transform: `translateX(${drag}px)` }}
        onPointerDown={(event) => {
          if (alone) return;
          origin.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const from = origin.current;
          if (!from) return;
          const dx = event.clientX - from.x;
          // Ignore mostly-vertical movement so this never fights page scroll.
          if (Math.abs(dx) < Math.abs(event.clientY - from.y)) return;
          setDrag(Math.max(-90, Math.min(90, dx)));
        }}
        onPointerUp={(event) => {
          const from = origin.current;
          origin.current = undefined;
          setDrag(0);
          if (!from) return;

          const dx = event.clientX - from.x;
          if (Math.abs(dx) >= THRESHOLD) go(dx < 0 ? 1 : -1);
          else if (Math.abs(dx) < 6) navigate('/groups');
        }}
        onPointerCancel={() => {
          origin.current = undefined;
          setDrag(0);
        }}
      >
        {!alone && (
          <button
            type="button"
            className="switcher-arrow"
            aria-label="Previous group"
            onClick={() => go(-1)}
          >
            ‹
          </button>
        )}

        {/* The name stays a real heading — a button is phrasing content, so
            it nests inside one legitimately, and the screen keeps its title. */}
        <span className="switcher-name">
          <h1 className="switcher-heading">
            <button type="button" className="switcher-button" onClick={() => navigate('/groups')}>
              {state.group?.name ?? 'Group'}
            </button>
          </h1>
          {subtitle && <span className="switcher-sub">{subtitle}</span>}
        </span>

        {!alone && (
          <button
            type="button"
            className="switcher-arrow"
            aria-label="Next group"
            onClick={() => go(1)}
          >
            ›
          </button>
        )}
      </div>

      {!alone && (
        <div className="switcher-dots" aria-hidden="true">
          {groups.map((group, at) => (
            <span key={group.id} className={at === index ? 'dot on' : 'dot'} />
          ))}
        </div>
      )}
    </div>
  );
}
