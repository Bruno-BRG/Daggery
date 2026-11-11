/** A rendering limit, never a limit on an item's contribution to maximum slots. */
export const VISIBLE_RESOURCE_SLOTS = 24;

export function resourceTrack(count: number, max: number) {
  return {
    value: Math.max(0, count),
    slots: Math.min(VISIBLE_RESOURCE_SLOTS, Math.max(0, max)),
    canIncrease: count < max,
  };
}

/** Keep existing overflow after an effect ends, but do not allow new over-marking. */
export function changeResourceCount(current: number, next: number, max: number): number {
  return Math.max(0, Math.min(Math.max(current, max), next));
}
