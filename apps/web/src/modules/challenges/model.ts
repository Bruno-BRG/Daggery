import { foeHarm, foeRankFor, IRON_RANKS, IRON_TRACK_TICKS, ironProgressScore, ironRank, packRank, ticksPerHarm, type IronRank, type PackSize } from '@daggery/shared';

/**
 * Challenges: the progress tracks a solo Duality GME game runs on.
 *
 * A track is ten boxes of four ticks. Every rank marks a fixed number of ticks, taken
 * straight from the shared engine so the printed chart and this page cannot drift:
 * Minor 12 (3 boxes), Serious 8 (2), Grave 4 (1), Dire 2, Legendary 1.
 * The progress score is the number of full boxes, 0 to 10: read your own dice against it.
 *
 * Countdowns (tension clocks) use segments instead: a size of 4 to 12 and a filled count.
 */

export const TRACK_TICKS = IRON_TRACK_TICKS;
export const TICKS_PER_BOX = 4;
export const TRACK_BOXES = TRACK_TICKS / TICKS_PER_BOX;
export const COUNTDOWN_SIZES = [4, 6, 8, 10, 12] as const;
export type CountdownSize = (typeof COUNTDOWN_SIZES)[number];

export const PROGRESS_TYPES = ['oath', 'fight', 'journey', 'bond', 'scene'] as const;
export type ProgressType = (typeof PROGRESS_TYPES)[number];
export type TrackKind = ProgressType | 'countdown';
export type TrackType = TrackKind;

export interface BaseTrackDoc {
  kind: 'track';
  name: string;
  type: TrackKind;
  notes: string;
  done: boolean;
  /** ISO timestamp of the last change; keeps the newest track at the top. */
  updated: string;
}

/**
 * Vows, fights, journeys, bonds and scenes carry a rank and a track of ticks (0 to 40). A fight's rank
 * is its foe's rank: it sets the harm the foe deals and the progress each of your harm marks. A bonds
 * track marks one tick for each bond whatever its rank.
 */
export interface ProgressTrackDoc extends BaseTrackDoc {
  type: ProgressType;
  rank: IronRank;
  ticks: number;
  /** For a fight: the Daggerheart adversary the rank came from, and whether it is a pack. */
  adversary?: string;
  pack?: PackSize;
}

/** A countdown replaces rank and ticks with its size and how many segments are filled. */
export interface CountdownDoc extends BaseTrackDoc {
  type: 'countdown';
  size: CountdownSize;
  filled: number;
}

export type TrackDoc = ProgressTrackDoc | CountdownDoc;

/** Panel titles, singular labels and the order the sections appear in. */
export const TYPE_ORDER: readonly TrackKind[] = ['oath', 'fight', 'journey', 'bond', 'scene', 'countdown'];
export const TYPE_TITLE: Record<TrackKind, string> = {
  oath: 'Vows', fight: 'Fights', journey: 'Journeys', bond: 'Bonds', scene: 'Scenes', countdown: 'Countdowns',
};
export const TYPE_LABEL: Record<TrackKind, string> = {
  oath: 'Vow', fight: 'Fight', journey: 'Journey', bond: 'Bond', scene: 'Scene', countdown: 'Countdown',
};

/** The printed ranks, re-exported for the rank picker. */
export const RANK_OPTIONS = IRON_RANKS;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** How many ticks one mark of this rank adds (Minor 12, Serious 8, Grave 4, Dire 2, Legendary 1). */
export function rankTicks(rank: IronRank): number {
  return ironRank(rank).ticks;
}

export function rankLabel(rank: IronRank): string {
  return ironRank(rank).label;
}

/** What one "Mark progress" does on this kind of track: a bond is one tick, anything else a mark at its rank. */
export function progressTicks(type: ProgressType, rank: IronRank): number {
  return type === 'bond' ? 1 : rankTicks(rank);
}

/** Inflict harm on a foe: each point marks the foe's rank in ticks (Minor 3 boxes ... Legendary 1 tick). */
export function inflictHarm(ticks: number, rank: IronRank, harm: number): number {
  return clamp(clamp(ticks, 0, TRACK_TICKS) + Math.max(0, Math.trunc(harm)) * ticksPerHarm(rank), 0, TRACK_TICKS);
}

/** The rank of a Daggerheart adversary, raised for a pack. */
export function rankForAdversary(type: string, tier: number, pack: PackSize = 'single'): IronRank {
  const rank = foeRankFor(type, tier);
  // Only Minor and Serious foes form a pack. A bigger foe stays alone.
  return pack !== 'single' && (rank === 'troublesome' || rank === 'dangerous') ? packRank(rank, pack) : rank;
}

/** The harm a foe of this rank deals to you, for the caption of a fight. */
export const harmFromFoe = foeHarm;

/** Mark progress once at a rank, capped at ten full boxes. */
export function markProgress(ticks: number, rank: IronRank): number {
  return clamp(clamp(ticks, 0, TRACK_TICKS) + rankTicks(rank), 0, TRACK_TICKS);
}

/** Add or remove ticks directly, keeping the track between 0 and 40. */
export function addTicks(ticks: number, delta: number): number {
  return clamp(Math.trunc(ticks) + Math.trunc(delta), 0, TRACK_TICKS);
}

/** The progress score: full boxes only, 0 to 10. No roll, no modifiers. */
export function score(ticks: number): number {
  return ironProgressScore(clamp(ticks, 0, TRACK_TICKS));
}

/** Ticks in each of the ten boxes, so the header can draw Ironsworn-style marks. */
export function boxTicks(ticks: number): number[] {
  const safe = clamp(Math.trunc(ticks), 0, TRACK_TICKS);
  return Array.from({ length: TRACK_BOXES }, (_, index) => clamp(safe - index * TICKS_PER_BOX, 0, TICKS_PER_BOX));
}

/** Clicking a segment fills up to it, or unfills it and everything after it. */
export function toggleCountdown(filled: number, size: number, index: number): number {
  const safeFilled = clamp(Math.trunc(filled), 0, size);
  if (!Number.isInteger(index) || index < 0 || index >= size) return safeFilled;
  return index < safeFilled ? index : index + 1;
}

/** The caption under a track's name: "Grave · 3/10 boxes" or "4/6". */
export function trackCaption(doc: TrackDoc): string {
  if (doc.type === 'countdown') return `${clamp(Math.trunc(doc.filled), 0, doc.size)}/${doc.size}`;
  if (doc.type === 'bond') return `${clamp(Math.trunc(doc.ticks), 0, TRACK_TICKS)} bonds · ${score(doc.ticks)}/${TRACK_BOXES} boxes`;
  if (doc.type === 'fight') return `${rankLabel(doc.rank)} foe · harm ${foeHarm(doc.rank)} · ${score(doc.ticks)}/${TRACK_BOXES} boxes`;
  return `${rankLabel(doc.rank)} · ${score(doc.ticks)}/${TRACK_BOXES} boxes`;
}

/** Documents arrive from the sync socket untyped; keep anything that does not look like a track out. */
export function isTrackDoc(value: unknown): value is TrackDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  if (doc.kind !== 'track') return false;
  if (typeof doc.name !== 'string' || typeof doc.notes !== 'string' || typeof doc.done !== 'boolean' || typeof doc.updated !== 'string') return false;
  if (doc.type === 'countdown') {
    return COUNTDOWN_SIZES.includes(doc.size as CountdownSize) && typeof doc.filled === 'number' && Number.isFinite(doc.filled);
  }
  if (!(PROGRESS_TYPES as readonly string[]).includes(doc.type as string)) return false;
  return IRON_RANKS.some(rank => rank.id === doc.rank) && typeof doc.ticks === 'number' && Number.isFinite(doc.ticks);
}

export function createTrack(type: ProgressType, name: string, rank: IronRank, updated = new Date().toISOString()): ProgressTrackDoc {
  return { kind: 'track', type, name, rank, ticks: 0, notes: '', done: false, updated };
}

export function createCountdown(name: string, size: CountdownSize, updated = new Date().toISOString()): CountdownDoc {
  return { kind: 'track', type: 'countdown', name, size, filled: 0, notes: '', done: false, updated };
}
