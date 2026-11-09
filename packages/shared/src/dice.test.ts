import { describe, expect, it } from 'vitest';
import {
  DiceNotationError,
  type Rng,
  isSuccess,
  maxDiceTotal,
  resolveDuality,
  roll,
  rollDice,
  rollDie,
} from './dice';

/** Returns an Rng that yields the given values in order, then fails. */
function sequenceRng(values: number[]): Rng {
  const queue = [...values];
  return () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('rng exhausted');
    return next;
  };
}

/** Unit-interval value that rolls exactly `face` on a die with `sides` faces. */
const faceOf = (face: number, sides: number): number => (face - 1 + 0.5) / sides;

describe('rollDie', () => {
  it('maps the unit interval onto 1..sides', () => {
    expect(rollDie(12, () => 0)).toBe(1);
    expect(rollDie(12, () => 0.999999)).toBe(12);
    expect(rollDie(6, () => faceOf(4, 6))).toBe(4);
  });

  it('clamps an out-of-contract rng value of exactly 1', () => {
    expect(rollDie(6, () => 1)).toBe(6);
  });

  it('rejects a non-positive side count', () => {
    expect(() => rollDie(0, () => 0.5)).toThrow(RangeError);
  });
});

describe('resolveDuality', () => {
  it('awards the outcome to Hope when the Hope die is higher', () => {
    const result = resolveDuality(10, 4);
    expect(result.outcome).toBe('hope');
    expect(result.withHope).toBe(true);
    expect(result.withFear).toBe(false);
    expect(result.total).toBe(14);
  });

  it('awards the outcome to Fear when the Fear die is higher', () => {
    const result = resolveDuality(3, 11, { modifier: 2 });
    expect(result.outcome).toBe('fear');
    expect(result.withHope).toBe(false);
    expect(result.withFear).toBe(true);
    expect(result.total).toBe(16);
  });

  it('reports a critical when the dice match; it counts as Hope and always succeeds', () => {
    const result = resolveDuality(7, 7, { modifier: 1 });
    expect(result.outcome).toBe('critical');
    expect(result.critical).toBe(true);
    expect(result.withHope).toBe(true);
    expect(result.withFear).toBe(false);
    expect(isSuccess(result, 99)).toBe(true);
    expect(result.total).toBe(15);
  });

  it('adds the trait modifier to the total', () => {
    expect(resolveDuality(5, 2, { modifier: -3 }).total).toBe(4);
  });

  it('adds the d6 on advantage', () => {
    const result = resolveDuality(5, 2, { modifier: 1, advantage: 'advantage', advantageDie: 6 });
    expect(result.advantage).toBe('advantage');
    expect(result.advantageDie).toBe(6);
    expect(result.total).toBe(5 + 2 + 1 + 6);
  });

  it('subtracts the d6 on disadvantage', () => {
    const result = resolveDuality(5, 2, { modifier: 1, advantage: 'disadvantage', advantageDie: 6 });
    expect(result.advantage).toBe('disadvantage');
    expect(result.advantageDie).toBe(6);
    expect(result.total).toBe(5 + 2 + 1 - 6);
  });

  it('does not let the d6 change the outcome', () => {
    const result = resolveDuality(2, 9, { advantage: 'advantage', advantageDie: 6 });
    expect(result.outcome).toBe('fear');
    expect(result.total).toBe(17);
  });

  it('leaves advantage fields null when no advantage applies', () => {
    const result = resolveDuality(1, 2);
    expect(result.advantage).toBeNull();
    expect(result.advantageDie).toBeNull();
  });

  it('requires advantageDie when advantage is set', () => {
    expect(() => resolveDuality(1, 2, { advantage: 'advantage' })).toThrow(RangeError);
  });

  it('rejects advantageDie without advantage', () => {
    expect(() => resolveDuality(1, 2, { advantageDie: 3 })).toThrow(RangeError);
  });

  it('rejects dice faces outside their range', () => {
    expect(() => resolveDuality(0, 5)).toThrow(RangeError);
    expect(() => resolveDuality(13, 5)).toThrow(RangeError);
    expect(() => resolveDuality(5, 13)).toThrow(RangeError);
    expect(() => resolveDuality(5, 2, { advantage: 'advantage', advantageDie: 7 })).toThrow(
      RangeError,
    );
  });

  it('rejects non-integer dice and modifiers', () => {
    expect(() => resolveDuality(2.5, 3)).toThrow(RangeError);
    expect(() => resolveDuality(2, 3, { modifier: 1.5 })).toThrow(RangeError);
  });
});

describe('roll', () => {
  it('draws Hope d12, then Fear d12, from the injected rng', () => {
    const result = roll({ rng: sequenceRng([faceOf(10, 12), faceOf(4, 12)]) });
    expect(result.hope).toBe(10);
    expect(result.fear).toBe(4);
    expect(result.total).toBe(14);
    expect(result.outcome).toBe('hope');
    expect(result.advantageDie).toBeNull();
  });

  it('draws the advantage d6 last, after the duality dice', () => {
    const result = roll({
      modifier: 2,
      advantage: 'advantage',
      rng: sequenceRng([faceOf(3, 12), faceOf(3, 12), faceOf(5, 6)]),
    });
    expect(result.outcome).toBe('critical');
    expect(result.advantageDie).toBe(5);
    expect(result.total).toBe(3 + 3 + 2 + 5);
  });

  it('subtracts the d6 for disadvantage', () => {
    const result = roll({
      advantage: 'disadvantage',
      rng: sequenceRng([faceOf(1, 12), faceOf(12, 12), faceOf(2, 6)]),
    });
    expect(result.outcome).toBe('fear');
    expect(result.total).toBe(1 + 12 - 2);
  });

  it('uses Math.random when no rng is injected', () => {
    const result = roll();
    expect(result.hope).toBeGreaterThanOrEqual(1);
    expect(result.hope).toBeLessThanOrEqual(12);
    expect(result.fear).toBeGreaterThanOrEqual(1);
    expect(result.fear).toBeLessThanOrEqual(12);
    expect(result.advantageDie).toBeNull();
  });
});

describe('rollDice', () => {
  it('parses NdM with a flat modifier', () => {
    // 2d6 faces 4 and 5, then +3.
    const result = rollDice('2d6+3', sequenceRng([faceOf(4, 6), faceOf(5, 6)]));
    expect(result).toEqual({ notation: '2d6+3', total: 12, rolls: [4, 5], modifier: 3 });
  });

  it('treats a missing count as 1', () => {
    const result = rollDice('d20', sequenceRng([faceOf(17, 20)]));
    expect(result.total).toBe(17);
    expect(result.rolls).toEqual([17]);
    expect(result.modifier).toBe(0);
  });

  it('handles a negative flat modifier', () => {
    const result = rollDice('1d12-1', sequenceRng([faceOf(1, 12)]));
    expect(result.total).toBe(0);
    expect(result.modifier).toBe(-1);
  });

  it('accepts multiple dice terms, whitespace and uppercase D', () => {
    const result = rollDice(
      ' 2D6 + 1d4 - 2 ',
      sequenceRng([faceOf(6, 6), faceOf(1, 6), faceOf(4, 4)]),
    );
    expect(result.rolls).toEqual([6, 1, 4]);
    expect(result.modifier).toBe(-2);
    expect(result.total).toBe(6 + 1 + 4 - 2);
  });

  it('accepts a leading sign on the first term', () => {
    const result = rollDice('-1d4+1', sequenceRng([faceOf(2, 4)]));
    expect(result.total).toBe(-2 + 1);
  });

  it('accepts a plain number', () => {
    expect(rollDice('7', sequenceRng([])).total).toBe(7);
  });

  it('rejects malformed notation', () => {
    for (const bad of ['', '   ', 'abc', '2d', '+', '2d6 3', '2d6+', '2d6*2', '2d6++1']) {
      expect(() => rollDice(bad, () => 0.5), bad).toThrow(DiceNotationError);
    }
  });

  it('rejects zero or oversized dice counts and sides', () => {
    expect(() => rollDice('0d6', () => 0.5)).toThrow(DiceNotationError);
    expect(() => rollDice('101d6', () => 0.5)).toThrow(DiceNotationError);
    expect(() => rollDice('d0', () => 0.5)).toThrow(DiceNotationError);
    expect(() => rollDice('d1001', () => 0.5)).toThrow(DiceNotationError);
  });

  it('uses Math.random when no rng is injected', () => {
    const result = rollDice('3d6');
    expect(result.rolls).toHaveLength(3);
    for (const face of result.rolls) expect(face >= 1 && face <= 6).toBe(true);
  });
});

describe('maxDiceTotal', () => {
  it('sums the highest face of every die and ignores flat terms', () => {
    expect(maxDiceTotal('2d6+3')).toBe(12);
    expect(maxDiceTotal('1d8+2')).toBe(8);
    expect(maxDiceTotal('7')).toBe(0);
  });

  it('handles multiple terms, signs and whitespace', () => {
    expect(maxDiceTotal(' 2D6 + 1d4 - 2 ')).toBe(16);
    expect(maxDiceTotal('2d8-1d4+5')).toBe(12);
  });

  it('applies a negative sign to dice maxima', () => {
    expect(maxDiceTotal('-1d4')).toBe(-4);
  });

  it('rejects malformed notation with the same parser as rollDice', () => {
    for (const bad of ['', '2d', '2d6*2', '2d6++1']) {
      expect(() => maxDiceTotal(bad), bad).toThrow(DiceNotationError);
    }
  });
});
