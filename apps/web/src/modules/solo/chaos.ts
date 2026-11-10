import type { MythicRange } from '@daggery/shared';

/** The printed chart's chaos factor: no rows are shifted. */
export const CHAOS_DEFAULT = 5;
export const CHAOS_MIN = 1;
export const CHAOS_MAX = 9;

/** The minimal row shape needed to shift an odds chart. */
export interface OddsRow {
  id?: string;
  label?: string;
  ranges?: Record<string, MythicRange>;
}

export function clampChaos(value: number): number {
  if (!Number.isFinite(value)) return CHAOS_DEFAULT;
  return Math.min(CHAOS_MAX, Math.max(CHAOS_MIN, Math.round(value)));
}

/**
 * Shift the odds chart for a chaos factor.
 *
 * `rows` must be ordered from Certain (index 0) down to Impossible. Chaos 5
 * shows the chart as printed. Each point above 5 makes every row display the
 * ranges of the row that many steps toward Certain (more "yes"); each point
 * below 5 shifts toward Impossible. Rows clamp at both ends, so the Certain
 * and Impossible rows always keep the end ranges. Labels never move.
 */
export function shiftOddsRows<T extends OddsRow>(rows: readonly T[], chaos: number): T[] {
  const delta = clampChaos(chaos) - CHAOS_DEFAULT;
  return rows.map((row, index) => {
    if (delta === 0 || !row.ranges) return { ...row };
    const source = rows[Math.min(rows.length - 1, Math.max(0, index - delta))]!;
    return { ...row, ranges: source.ranges ? { ...source.ranges } : row.ranges };
  });
}
