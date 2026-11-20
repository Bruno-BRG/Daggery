import { describe, expect, it } from 'vitest';
import { DUALITY_TABLES } from './duality-engine';
import { dualityProgressTarget, resolveDualityProgress, IRON_MOVE_GROUPS, IRON_MOVES, IRON_RANKS, ironProgressScore, isLodestarMove, LODESTAR_MOVE_NAMES, markIronProgress, resolveIronProgress } from './duality-variants';

describe('Duality GME', () => {
  it('marks progress by rank and caps the track', () => {
    expect(IRON_RANKS.map(rank => markIronProgress(0, rank.id))).toEqual([12, 8, 4, 2, 1]);
    expect(markIronProgress(38, 'troublesome')).toBe(40);
    expect(ironProgressScore(15)).toBe(3);
  });
  it('rolls progress against the challenge dice, ties to the dice', () => {
    expect(resolveIronProgress(6, 5, 5)).toEqual({ outcome: 'strong', match: true });
    expect(resolveIronProgress(6, 6, 2).outcome).toBe('weak');
    expect(resolveIronProgress(0, 1, 1).outcome).toBe('miss');
  });
  it('has unique moves, each with either text or all three outcomes', () => {
    expect(new Set(IRON_MOVES.map(move => move.id)).size).toBe(IRON_MOVES.length);
    for (const move of IRON_MOVES) expect(move.text !== undefined || (move.strong && move.weak && move.miss)).toBeTruthy();
  });
  it('has every Ironsworn Lodestar move, under its Ironsworn name', () => {
    expect(LODESTAR_MOVE_NAMES).toHaveLength(35);
    const names = IRON_MOVES.map(move => move.name);
    for (const name of LODESTAR_MOVE_NAMES) expect(names, name).toContain(name);
    expect(IRON_MOVES.filter(isLodestarMove)).toHaveLength(35);
  });
  it('puts every move in a known group, and every Lodestar group has moves', () => {
    const groups = IRON_MOVE_GROUPS.map(group => group.id);
    for (const move of IRON_MOVES) expect(groups, move.id).toContain(move.group);
    for (const group of groups) expect(IRON_MOVES.some(move => move.group === group), group).toBe(true);
  });
  it('says what to do on a hit and a miss in every move that rolls', () => {
    for (const move of IRON_MOVES.filter(move => move.roll && move.id !== 'ask-oracle' && move.id !== 'pay-price' && move.id !== 'turn-tide' && move.id !== 'aid-ally')) {
      if (move.text === undefined || move.strong) expect(move.strong && move.weak && move.miss, `${move.id} outcomes`).toBeTruthy();
    }
  });
  it('no longer hands out Hope for moves, because Momentum does that', () => {
    for (const move of IRON_MOVES) expect(JSON.stringify(move), move.id).not.toMatch(/gain a Hope/i);
  });
  it('ships its tables', () => {
    for (const id of ['iron-price', 'iron-vignette', 'iron-waypoint', 'iron-opportunity', 'iron-discovery', 'iron-chaos'])
      expect(DUALITY_TABLES.some(table => table.id === id)).toBe(true);
  });
});

describe('Duality progress roll', () => {
  it('converts a score to a d12 target', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(dualityProgressTarget)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 10, 11, 12]);
    expect(() => dualityProgressTarget(11)).toThrow();
  });
  it('compares the target with the Hope and Fear dice', () => {
    expect(resolveDualityProgress(6, 3, 5)).toEqual({ outcome: 'strong', match: false, target: 7 });
    expect(resolveDualityProgress(6, 3, 8).outcome).toBe('weak');
    expect(resolveDualityProgress(6, 7, 7)).toEqual({ outcome: 'miss', match: true, target: 7 });
    expect(resolveDualityProgress(0, 1, 1).outcome).toBe('miss');
  });
  it('stays within 6 points of the Ironsworn d10 odds for every score', () => {
    const beat = (target: number, sides: number) => Math.max(0, target - 1) / sides;
    for (let score = 0; score <= 10; score++) {
      const duality = beat(dualityProgressTarget(score), 12), iron = beat(score, 10);
      expect(Math.abs(duality - iron)).toBeLessThan(0.06);
    }
  });
});
