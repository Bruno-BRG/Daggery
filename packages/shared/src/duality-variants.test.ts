import { describe, expect, it } from 'vitest';
import { DUALITY_TABLES } from './duality-engine';
import { IRON_MOVES, IRON_RANKS, ironProgressScore, markIronProgress, resolveIronProgress } from './duality-variants';

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
  it('ships its tables', () => {
    for (const id of ['iron-price', 'iron-vignette', 'iron-waypoint', 'iron-opportunity', 'iron-discovery', 'iron-chaos'])
      expect(DUALITY_TABLES.some(table => table.id === id)).toBe(true);
  });
});
