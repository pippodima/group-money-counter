/**
 * A colour per group.
 *
 * Derived from the group id rather than chosen, which means **both phones
 * show the same colour for the same group** — the id is replicated, so the
 * hue is too, for free. That turns colour into a shared name for the trip
 * rather than a local preference.
 *
 * Hues below about 25° are left out: they read as the red used for money
 * owed, and an accent that looks like a warning is worse than a dull one.
 */

const HUES = [
  155, // green — the original
  185, // teal
  205, // blue
  240, // indigo
  275, // violet
  315, // magenta
  40, // amber
  95, // olive
] as const;

export function hueFor(groupId: string | undefined): number {
  if (!groupId) return HUES[0];

  // FNV-ish: order matters, and neighbouring ids land far apart.
  let hash = 2166136261;
  for (let i = 0; i < groupId.length; i++) {
    hash = ((hash ^ groupId.charCodeAt(i)) * 16777619) >>> 0;
  }
  return HUES[hash % HUES.length] as number;
}
