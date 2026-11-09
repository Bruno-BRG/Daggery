import {
  rollDice,
  roll as rollDuality,
  type Advantage,
  type DualityResult,
  type RollPayload,
} from '@daggery/shared';
import type { ColorwayId } from './colorways';
import { isSupportedSides } from './shapes';

/** What to roll. The result is computed from @daggery/shared before any dice move. */
export type RollSpec =
  | { kind: 'duality'; modifier?: number; advantage?: Advantage }
  | { kind: 'dice'; notation: string };

/** One physical die to show: its size, the face it must land on, and its colour. */
export interface DieRequest {
  sides: number;
  value: number;
  colorway: ColorwayId;
}

/**
 * Most dice animated per roll. Dice past this are still in the result and the log, just not
 * thrown, which keeps the physics cheap on weak devices.
 */
export const MAX_TRAY_DICE = 16;

/** Computes a roll with the shared rules. This is the only source of randomness for local rolls. */
export function computeRoll(spec: RollSpec): RollPayload {
  if (spec.kind === 'duality') {
    return {
      kind: 'duality',
      result: rollDuality({ modifier: spec.modifier, advantage: spec.advantage }),
    };
  }
  return { kind: 'dice', result: rollDice(spec.notation) };
}

/**
 * The physical dice that show a result. Hope and Fear always come first, then the advantage
 * d6 if there is one. Values that do not fit their die are dropped, so a malformed remote
 * entry cannot put a die on a face it does not have.
 */
export function diceForPayload(payload: RollPayload): DieRequest[] {
  const requests: DieRequest[] = [];
  if (payload.kind === 'duality') {
    const { hope, fear, advantage, advantageDie } = payload.result;
    requests.push(
      { sides: 12, value: hope, colorway: 'hope' },
      { sides: 12, value: fear, colorway: 'fear' },
    );
    if (advantageDie !== null && advantageDie !== undefined) {
      requests.push({
        sides: 6,
        value: advantageDie,
        colorway: advantage === 'disadvantage' ? 'disadvantage' : 'advantage',
      });
    }
  } else {
    const sides = sidesFromNotation(payload.result.notation);
    if (Array.isArray(payload.result.rolls)) {
      payload.result.rolls.forEach((value, index) => {
        const faces = sides[index];
        if (faces !== undefined) requests.push({ sides: faces, value, colorway: 'neutral' });
      });
    }
  }
  return requests
    .filter(
      (request) =>
        isSupportedSides(request.sides) &&
        Number.isInteger(request.value) &&
        request.value >= 1 &&
        request.value <= request.sides,
    )
    .slice(0, MAX_TRAY_DICE);
}

const TERM_PATTERN =
  /\s*(?<sign>[+-]?)\s*(?:(?<count>\d*)d(?<sides>\d+)|(?<flat>\d+))\s*/iy;

/** Die sizes in the order `rollDice` draws them, e.g. `2d6+1d4-2` gives [6, 6, 4]. */
export function sidesFromNotation(notation: string): number[] {
  const source = notation.trim();
  const sides: number[] = [];
  let pos = 0;
  while (pos < source.length) {
    TERM_PATTERN.lastIndex = pos;
    const match = TERM_PATTERN.exec(source);
    const groups = match?.groups;
    if (!groups || TERM_PATTERN.lastIndex <= pos) return [];
    if (groups.sides !== undefined) {
      const count = groups.count ? Number(groups.count) : 1;
      for (let i = 0; i < count; i++) sides.push(Number(groups.sides));
    }
    pos = TERM_PATTERN.lastIndex;
  }
  return sides;
}

const OUTCOME_TEXT: Record<DualityResult['outcome'], string> = {
  critical: 'Critical',
  hope: 'With Hope',
  fear: 'With Fear',
};

/** One-line summary for the local UI. */
export function describePayload(payload: RollPayload): string {
  if (payload.kind === 'duality') {
    const r = payload.result;
    const advantage =
      r.advantageDie === null
        ? ''
        : ` ${r.advantage === 'advantage' ? '+' : '-'} d6 ${r.advantageDie}`;
    const modifier = r.modifier === 0 ? '' : ` ${r.modifier > 0 ? '+' : '-'} ${Math.abs(r.modifier)}`;
    return `Hope ${r.hope} + Fear ${r.fear}${advantage}${modifier} = ${r.total} (${OUTCOME_TEXT[r.outcome]})`;
  }
  const r = payload.result;
  return `${r.notation}: ${r.rolls.join(', ')} = ${r.total}`;
}

/**
 * Identity of a roll for matching the server's echo. Uses a sorted-key encoding so key order
 * from the server cannot change it.
 */
export function payloadKey(author: string, payload: RollPayload): string {
  return stableStringify({ author: normalizeAuthor(author), kind: payload.kind, result: payload.result });
}

/** Same trimming and length cap the server applies to authors. */
export function normalizeAuthor(author: string): string {
  return (author.trim() || 'Anonymous').slice(0, 40);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
