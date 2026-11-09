/**
 * Dice rules for Daggerheart (Duality rolls) and generic dice notation.
 *
 * Anything that consumes randomness takes an injectable `Rng`. An `Rng` returns
 * a float in [0, 1), the same contract as `Math.random`, so tests can drive
 * outcomes deterministically.
 */

export type Rng = () => number;

export type Advantage = 'advantage' | 'disadvantage';

/** 'critical' when both dice match, otherwise whichever die is higher. */
export type DualityOutcome = 'critical' | 'hope' | 'fear';

export const HOPE_DIE_SIDES = 12;
export const FEAR_DIE_SIDES = 12;
export const ADVANTAGE_DIE_SIDES = 6;

export interface DualityOptions {
  /** Flat bonus added to the total (usually a trait value). */
  modifier?: number;
  advantage?: Advantage;
  /** Random source used by `roll`. Defaults to Math.random. */
  rng?: Rng;
}

export interface ResolveOptions {
  modifier?: number;
  advantage?: Advantage;
  /** Face rolled on the d6. Required when `advantage` is set. */
  advantageDie?: number;
}

export interface DualityResult {
  hope: number;
  fear: number;
  modifier: number;
  advantage: Advantage | null;
  /** The d6 that was added (advantage) or subtracted (disadvantage). */
  advantageDie: number | null;
  /** hope + fear + modifier, plus or minus the advantage die. */
  total: number;
  outcome: DualityOutcome;
  /** True when the Hope die wins or the roll is a critical (a critical counts as a roll with Hope). */
  withHope: boolean;
  /** True only when the Fear die strictly wins. */
  withFear: boolean;
  /** True when both dice match: automatic success, +1 Hope, clear 1 Stress, extra damage on attacks. */
  critical: boolean;
}

/** A critical always succeeds; otherwise the total must reach the Difficulty. */
export function isSuccess(result: DualityResult, difficulty: number): boolean {
  return result.critical || result.total >= difficulty;
}

/** Rolls one die with `sides` faces and returns a value in 1..sides. */
export function rollDie(sides: number, rng: Rng = Math.random): number {
  assertPositiveInteger(sides, 'sides');
  const face = Math.floor(rng() * sides) + 1;
  return Math.min(Math.max(face, 1), sides);
}

/**
 * Resolves a Duality roll from known die faces. Pure, so it is the place to
 * test the rules themselves.
 */
export function resolveDuality(
  hope: number,
  fear: number,
  options: ResolveOptions = {},
): DualityResult {
  assertFace(hope, HOPE_DIE_SIDES, 'hope');
  assertFace(fear, FEAR_DIE_SIDES, 'fear');

  const modifier = options.modifier ?? 0;
  assertInteger(modifier, 'modifier');

  let advantageDie: number | null = null;
  let advantageBonus = 0;
  if (options.advantage) {
    if (options.advantageDie === undefined) {
      throw new RangeError('advantageDie is required when advantage is set');
    }
    assertFace(options.advantageDie, ADVANTAGE_DIE_SIDES, 'advantageDie');
    advantageDie = options.advantageDie;
    advantageBonus = options.advantage === 'advantage' ? advantageDie : -advantageDie;
  } else if (options.advantageDie !== undefined) {
    throw new RangeError('advantageDie was given without advantage');
  }

  const outcome: DualityOutcome = hope === fear ? 'critical' : hope > fear ? 'hope' : 'fear';

  return {
    hope,
    fear,
    modifier,
    advantage: options.advantage ?? null,
    advantageDie,
    total: hope + fear + modifier + advantageBonus,
    outcome,
    withHope: outcome !== 'fear',
    withFear: outcome === 'fear',
    critical: outcome === 'critical',
  };
}

/**
 * Rolls a Duality roll: a d12 Hope die and a d12 Fear die, plus a d6 when
 * advantage or disadvantage applies. Dice are drawn in that order from `rng`.
 */
export function roll(options: DualityOptions = {}): DualityResult {
  const rng = options.rng ?? Math.random;
  const hope = rollDie(HOPE_DIE_SIDES, rng);
  const fear = rollDie(FEAR_DIE_SIDES, rng);
  const advantageDie = options.advantage ? rollDie(ADVANTAGE_DIE_SIDES, rng) : undefined;

  return resolveDuality(hope, fear, {
    modifier: options.modifier,
    advantage: options.advantage,
    advantageDie,
  });
}

export const MAX_DICE_PER_TERM = 100;
export const MAX_DIE_SIDES = 1000;

export interface DiceRoll {
  notation: string;
  total: number;
  /** Every individual die face, in the order it was rolled. */
  rolls: number[];
  /** Sum of the flat (non-dice) terms, sign included. */
  modifier: number;
}

export class DiceNotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceNotationError';
  }
}

/**
 * One term of an expression: an optional sign, then either `NdM` (N may be
 * omitted and means 1) or a flat integer.
 */
interface DiceTerm {
  sign: 1 | -1;
  count: number;
  sides: number | null;
  flat: number | null;
}

/** Sticky, so it matches at `lastIndex`. */
const TERM_PATTERN =
  /\s*(?<sign>[+-]?)\s*(?:(?<count>\d*)d(?<sides>\d+)|(?<flat>\d+))\s*/iy;

function parseNotation(notation: string): DiceTerm[] {
  const source = notation.trim();
  if (source === '') {
    throw new DiceNotationError('Dice notation is empty');
  }

  const terms: DiceTerm[] = [];
  let pos = 0;

  while (pos < source.length) {
    TERM_PATTERN.lastIndex = pos;
    const match = TERM_PATTERN.exec(source);
    const groups = match?.groups;
    if (!match || !groups) {
      throw new DiceNotationError(`Invalid dice notation "${notation}" at position ${pos + 1}`);
    }
    if (terms.length > 0 && groups.sign === '') {
      throw new DiceNotationError(
        `Invalid dice notation "${notation}" at position ${pos + 1}: terms after the first need a + or - sign`,
      );
    }

    const sign: 1 | -1 = groups.sign === '-' ? -1 : 1;

    if (groups.sides !== undefined) {
      const count = groups.count ? Number(groups.count) : 1;
      const sides = Number(groups.sides);
      if (count < 1 || count > MAX_DICE_PER_TERM) {
        throw new DiceNotationError(`Dice count must be 1 to ${MAX_DICE_PER_TERM}, got ${count}`);
      }
      if (sides < 1 || sides > MAX_DIE_SIDES) {
        throw new DiceNotationError(`Die sides must be 1 to ${MAX_DIE_SIDES}, got ${sides}`);
      }
      terms.push({ sign, count, sides, flat: null });
    } else {
      terms.push({ sign, count: 0, sides: null, flat: Number(groups.flat) });
    }

    pos = TERM_PATTERN.lastIndex;
  }

  return terms;
}

/**
 * Parses and rolls a dice expression such as `2d6+3`, `d20`, `1d12-1` or
 * `2d6 + 1d4 - 2`. The first term may carry a sign; later terms need an
 * explicit `+` or `-`.
 */
export function rollDice(notation: string, rng: Rng = Math.random): DiceRoll {
  const rolls: number[] = [];
  let total = 0;
  let modifier = 0;

  for (const term of parseNotation(notation)) {
    if (term.sides !== null) {
      for (let i = 0; i < term.count; i++) {
        const face = rollDie(term.sides, rng);
        rolls.push(face);
        total += term.sign * face;
      }
    } else {
      const value = term.sign * (term.flat ?? 0);
      total += value;
      modifier += value;
    }
  }

  return { notation, total, rolls, modifier };
}

/**
 * Sum of the highest face of every die in an expression, ignoring flat modifiers.
 * Daggerheart critical damage is this maximum plus a normal damage roll.
 */
export function maxDiceTotal(notation: string): number {
  let total = 0;
  for (const term of parseNotation(notation)) {
    if (term.sides !== null) total += term.sign * term.count * term.sides;
  }
  return total;
}

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be an integer, got ${value}`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

function assertFace(value: number, sides: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > sides) {
    throw new RangeError(`${name} must be an integer from 1 to ${sides}, got ${value}`);
  }
}
