/**
 * Duality GME trackers: Momentum, Supply, Initiative, Debilities and Experience.
 *
 * They come from Ironsworn (Lodestar). Momentum says how well the quest is going. It is the
 * hero's side of the table, as the Fear pool is the world's side. Every function here is pure:
 * it takes a tracker and returns a new one, so the screen, the server and the tests all agree.
 *
 * How the Ironsworn rules map to the Duality Dice:
 * - A strong hit is a success with Hope (or a critical success), a weak hit is a success with
 *   Fear, and a miss is a failure.
 * - Ironsworn's two challenge dice become the Fear die. Burning Momentum cancels it.
 * - Ironsworn's action die becomes the Hope die. Negative Momentum can cancel it.
 * - Health and spirit are the sheet's Hit Points and Stress. Only Momentum, Supply, the
 *   Debilities, Initiative and Experience are kept here.
 */

export const MOMENTUM_MIN = -6;
export const MOMENTUM_MAX = 10;
export const MOMENTUM_RESET = 2;
export const SUPPLY_MAX = 5;

export type DebilityGroup = 'condition' | 'bane' | 'burden';
export const DEBILITIES = [
  { id: 'wounded', label: 'Wounded', group: 'condition', hint: 'You are badly hurt. Clear it with Heal or Sojourn.' },
  { id: 'shaken', label: 'Shaken', group: 'condition', hint: 'You are rattled. Clear it with Sojourn.' },
  { id: 'unprepared', label: 'Unprepared', group: 'condition', hint: 'You are out of Supply. Clear it with Sojourn or Resupply.' },
  { id: 'encumbered', label: 'Encumbered', group: 'condition', hint: 'You carry too much. Drop something to clear it.' },
  { id: 'maimed', label: 'Maimed', group: 'bane', hint: 'A lasting injury. It stays until the story clears it.' },
  { id: 'corrupted', label: 'Corrupted', group: 'bane', hint: 'A lasting taint. It stays until the story clears it.' },
  { id: 'cursed', label: 'Cursed', group: 'burden', hint: 'Clear it by completing the quest it came from.' },
  { id: 'tormented', label: 'Tormented', group: 'burden', hint: 'Clear it by completing the quest it came from.' },
] as const satisfies readonly { id: string; label: string; group: DebilityGroup; hint: string }[];
export type DebilityId = (typeof DEBILITIES)[number]['id'];
const DEBILITY_IDS: readonly string[] = DEBILITIES.map(item => item.id);

/** Who holds the spotlight in a fight. `null` means no fight is on. */
export type Initiative = 'hero' | 'foe' | null;

export interface MomentumTracker {
  kind: 'momentum';
  value: number;
  supply: number;
  debilities: DebilityId[];
  initiative: Initiative;
  experience: number;
  /** Set once per fight when Turn the Tide is used. */
  tideTurned: boolean;
}

export const initialMomentum = (): MomentumTracker => ({
  kind: 'momentum', value: MOMENTUM_RESET, supply: SUPPLY_MAX, debilities: [], initiative: null, experience: 0, tideTurned: false,
});

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const whole = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback);

/** Each marked Debility lowers the most Momentum you can hold by one. */
export const maxMomentum = (debilities: readonly string[]) => MOMENTUM_MAX - new Set(debilities).size;
/** Where Momentum goes after you burn it: +2, or +1 with one Debility, or 0 with more. */
export const resetMomentum = (debilities: readonly string[]) => {
  const count = new Set(debilities).size;
  return count === 0 ? MOMENTUM_RESET : count === 1 ? 1 : 0;
};

/** Reads a saved tracker, repairing anything out of range, so a bad document cannot break the screen. */
export function parseMomentum(raw: unknown): MomentumTracker {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const debilities = Array.isArray(input.debilities)
    ? [...new Set(input.debilities.filter((id): id is DebilityId => typeof id === 'string' && DEBILITY_IDS.includes(id)))]
    : [];
  const initial = initialMomentum();
  return {
    kind: 'momentum', debilities,
    value: clamp(whole(input.value, initial.value), MOMENTUM_MIN, maxMomentum(debilities)),
    supply: clamp(whole(input.supply, initial.supply), 0, SUPPLY_MAX),
    initiative: input.initiative === 'hero' || input.initiative === 'foe' ? input.initiative : null,
    experience: clamp(whole(input.experience, 0), 0, 999),
    tideTurned: input.tideTurned === true,
  };
}

/** "Take +N momentum": never above the maximum. */
export function takeMomentum(tracker: MomentumTracker, amount: number): MomentumTracker {
  if (amount < 0) throw new RangeError('Use sufferMomentum for a loss');
  return { ...tracker, value: Math.min(maxMomentum(tracker.debilities), tracker.value + amount) };
}

/**
 * "Suffer -N momentum": never below -6. What is left over is a setback: when Momentum is already at
 * its minimum, the move *Face a Setback* applies for each point left over.
 */
export function sufferMomentum(tracker: MomentumTracker, amount: number): { tracker: MomentumTracker; setback: number } {
  if (amount < 0) throw new RangeError('Use takeMomentum for a gain');
  const next = Math.max(MOMENTUM_MIN, tracker.value - amount);
  return { tracker: { ...tracker, value: next }, setback: amount - (tracker.value - next) };
}

/** Momentum is exchanged, not lost: burning, Face a Setback and Pay the Price all end here. */
export const burnMomentum = (tracker: MomentumTracker): MomentumTracker => ({ ...tracker, value: resetMomentum(tracker.debilities) });

export type MoveOutcome = 'strong' | 'weak' | 'miss';
const IMPROVED: Record<MoveOutcome, MoveOutcome> = { miss: 'weak', weak: 'strong', strong: 'strong' };

/**
 * You may burn Momentum after an action roll when it is higher than your Fear die and the move
 * did not already hit strongly. Burning cancels the Fear die: the outcome improves by one step and
 * the world does not gain Fear from the roll. Progress moves ignore Momentum.
 */
export function canBurnMomentum(tracker: MomentumTracker, fearDie: number, outcome: MoveOutcome): boolean {
  return outcome !== 'strong' && tracker.value > fearDie;
}
export const burnedOutcome = (outcome: MoveOutcome): MoveOutcome => IMPROVED[outcome];

/**
 * Negative Momentum is a drag: when its value matches your Hope die, that die is cancelled. Its
 * number comes off the total, and the roll cannot be a success with Hope.
 */
export const negativeMomentumCancelsHope = (tracker: MomentumTracker, hopeDie: number): boolean =>
  tracker.value < 0 && -tracker.value === hopeDie;

/** Strong hits take or keep Initiative. Weak hits and misses pass it to the foe. */
export const initiativeAfter = (outcome: MoveOutcome): Exclude<Initiative, null> => (outcome === 'strong' ? 'hero' : 'foe');

/**
 * Supply: "Suffer -N supply". Reaching 0 marks Unprepared. What you cannot pay while Unprepared comes
 * back as `shortfall`, which *Out of Supply* turns into harm, stress or lost Momentum.
 */
export function sufferSupply(tracker: MomentumTracker, amount: number): { tracker: MomentumTracker; shortfall: number } {
  if (amount < 0) throw new RangeError('Use takeSupply for a gain');
  const paid = Math.min(amount, tracker.supply);
  const supply = tracker.supply - paid;
  const debilities: DebilityId[] = supply === 0 && !tracker.debilities.includes('unprepared') ? [...tracker.debilities, 'unprepared'] : tracker.debilities;
  const next = { ...tracker, supply, debilities };
  return { tracker: { ...next, value: Math.min(next.value, maxMomentum(debilities)) }, shortfall: amount - paid };
}
export function takeSupply(tracker: MomentumTracker, amount: number): MomentumTracker {
  if (amount < 0) throw new RangeError('Use sufferSupply for a loss');
  return { ...tracker, supply: Math.min(SUPPLY_MAX, tracker.supply + amount) };
}

/** Marking or clearing a Debility moves the Momentum ceiling, so Momentum is pulled down to fit. */
export function setDebility(tracker: MomentumTracker, id: DebilityId, marked: boolean): MomentumTracker {
  const has = tracker.debilities.includes(id);
  if (has === marked) return tracker;
  const debilities = marked ? [...tracker.debilities, id] : tracker.debilities.filter(item => item !== id);
  return { ...tracker, debilities, value: Math.min(tracker.value, maxMomentum(debilities)) };
}

/** Starts a fight: nobody has Initiative until Enter the Fray decides. Ends it by passing `null`. */
export const setInitiative = (tracker: MomentumTracker, initiative: Initiative): MomentumTracker => ({
  ...tracker, initiative, tideTurned: initiative === null ? false : tracker.tideTurned,
});

/** Turn the Tide: once per fight, the hero steals Initiative. */
export function turnTheTide(tracker: MomentumTracker): MomentumTracker {
  if (tracker.initiative === null) throw new Error('No fight is on');
  if (tracker.tideTurned) throw new Error('You already turned the tide in this fight');
  return { ...tracker, initiative: 'hero', tideTurned: true };
}
