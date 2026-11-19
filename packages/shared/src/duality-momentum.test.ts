import { describe, expect, it } from 'vitest';
import {
  burnedOutcome, burnMomentum, canBurnMomentum, initialMomentum, initiativeAfter, maxMomentum, negativeMomentumCancelsHope,
  parseMomentum, resetMomentum, setDebility, setInitiative, sufferMomentum, sufferSupply, takeMomentum, takeSupply, turnTheTide,
} from './duality-momentum';

describe('Momentum', () => {
  it('starts at +2 with 5 Supply, and tops out at +10', () => {
    const start = initialMomentum();
    expect(start.value).toBe(2);
    expect(start.supply).toBe(5);
    expect(takeMomentum(start, 20).value).toBe(10);
  });
  it('never drops below -6, and reports the setback left over', () => {
    const low = { ...initialMomentum(), value: -5 };
    expect(sufferMomentum(low, 1)).toMatchObject({ setback: 0, tracker: { value: -6 } });
    expect(sufferMomentum(low, 4)).toMatchObject({ setback: 3, tracker: { value: -6 } });
    expect(sufferMomentum({ ...initialMomentum(), value: -6 }, 2).setback).toBe(2);
  });
  it('lowers the maximum and the reset with each Debility', () => {
    expect([0, 1, 2, 3].map(count => maxMomentum(Array(count).fill('x').map((_, i) => `d${i}`)))).toEqual([10, 9, 8, 7]);
    expect([0, 1, 2, 5].map(count => resetMomentum(Array.from({ length: count }, (_, i) => `d${i}`)))).toEqual([2, 1, 0, 0]);
  });
  it('pulls Momentum down when a Debility is marked, and does not raise it back when cleared', () => {
    let tracker = takeMomentum(initialMomentum(), 20);
    tracker = setDebility(tracker, 'wounded', true);
    expect(tracker.value).toBe(9);
    tracker = setDebility(tracker, 'shaken', true);
    expect(tracker.value).toBe(8);
    expect(setDebility(tracker, 'wounded', false).value).toBe(8);
    expect(setDebility(tracker, 'wounded', true)).toBe(tracker);
  });
  it('burns Momentum to the reset value', () => {
    expect(burnMomentum({ ...initialMomentum(), value: 8 }).value).toBe(2);
    expect(burnMomentum({ ...initialMomentum(), value: 8, debilities: ['wounded'] }).value).toBe(1);
    expect(burnMomentum({ ...initialMomentum(), value: 8, debilities: ['wounded', 'shaken'] }).value).toBe(0);
  });
  it('lets you burn only when Momentum beats the Fear die and the roll was not already strong', () => {
    const tracker = { ...initialMomentum(), value: 6 };
    expect(canBurnMomentum(tracker, 5, 'weak')).toBe(true);
    expect(canBurnMomentum(tracker, 6, 'weak')).toBe(false);
    expect(canBurnMomentum(tracker, 2, 'strong')).toBe(false);
    expect(burnedOutcome('miss')).toBe('weak');
    expect(burnedOutcome('weak')).toBe('strong');
    expect(burnedOutcome('strong')).toBe('strong');
  });
  it('cancels the Hope die when negative Momentum matches it', () => {
    const tracker = { ...initialMomentum(), value: -3 };
    expect(negativeMomentumCancelsHope(tracker, 3)).toBe(true);
    expect(negativeMomentumCancelsHope(tracker, 4)).toBe(false);
    expect(negativeMomentumCancelsHope({ ...tracker, value: 3 }, 3)).toBe(false);
  });
  it('repairs a damaged saved tracker', () => {
    const fixed = parseMomentum({ value: 99, supply: -4, debilities: ['wounded', 'wounded', 'bogus'], initiative: 'dragon', experience: 'x' });
    expect(fixed).toMatchObject({ value: 9, supply: 0, debilities: ['wounded'], initiative: null, experience: 0 });
    expect(parseMomentum(null)).toEqual(initialMomentum());
  });
});

describe('Supply', () => {
  it('marks Unprepared at 0 and reports what Supply could not pay', () => {
    const start = initialMomentum();
    expect(sufferSupply(start, 2)).toMatchObject({ shortfall: 0, tracker: { supply: 3 } });
    const empty = sufferSupply(start, 5);
    expect(empty.tracker.debilities).toEqual(['unprepared']);
    expect(empty.shortfall).toBe(0);
    const over = sufferSupply({ ...start, supply: 1 }, 3);
    expect(over).toMatchObject({ shortfall: 2, tracker: { supply: 0, debilities: ['unprepared'] } });
    expect(sufferSupply(over.tracker, 1).shortfall).toBe(1);
    expect(takeSupply(start, 3).supply).toBe(5);
  });
});

describe('Initiative', () => {
  it('goes to the hero on a strong hit and to the foe otherwise', () => {
    expect(initiativeAfter('strong')).toBe('hero');
    expect(initiativeAfter('weak')).toBe('foe');
    expect(initiativeAfter('miss')).toBe('foe');
  });
  it('lets the hero turn the tide once per fight', () => {
    let tracker = setInitiative(initialMomentum(), 'foe');
    tracker = turnTheTide(tracker);
    expect(tracker).toMatchObject({ initiative: 'hero', tideTurned: true });
    expect(() => turnTheTide({ ...tracker, initiative: 'foe' })).toThrow('already');
    expect(setInitiative(tracker, null)).toMatchObject({ initiative: null, tideTurned: false });
    expect(() => turnTheTide(initialMomentum())).toThrow('No fight');
  });
});
