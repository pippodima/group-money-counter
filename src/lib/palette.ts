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

  // FNV-1a, but with Math.imul. Plain `hash * 16777619` is float64
  // multiplication: the product exceeds 2^53 and the low bits are quietly
  // rounded away — which is precisely the range `% 8` then reads. The first
  // attempt handed 44% of all groups the same colour because of it.
  let hash = 2166136261;
  for (let i = 0; i < groupId.length; i++) {
    hash = Math.imul(hash ^ groupId.charCodeAt(i), 16777619);
  }

  // Avalanche (murmur3's fmix32). FNV alone leaves the low bits weakly mixed,
  // and a power-of-two modulo depends on nothing else.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;

  return HUES[(hash >>> 0) % HUES.length] as number;
}

/** The palette, for tests and for anywhere that needs to show all of them. */
export const ALL_HUES: readonly number[] = HUES;
