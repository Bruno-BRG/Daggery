import { describe, expect, it } from 'vitest';
import { adversaries } from '@daggery/content';
import { ADVERSARY_TYPES, adversariesForRank, FOE_RANKS, foeHarm, foeRankFor, heroHarm, isAdversaryType, packRank, ticksPerHarm } from './duality-foes';

describe('Foe ranks', () => {
  it('prints Ironsworn harm and progress for every rank', () => {
    expect(FOE_RANKS.map(rank => [rank.id, rank.harm, rank.progress])).toEqual([
      ['troublesome', 1, '3 boxes per harm'], ['dangerous', 2, '2 boxes per harm'], ['formidable', 3, '1 box per harm'],
      ['extreme', 4, '2 ticks per harm'], ['epic', 5, '1 tick per harm'],
    ]);
    expect(ticksPerHarm('troublesome')).toBe(12);
    expect(ticksPerHarm('epic')).toBe(1);
    expect(foeHarm('formidable')).toBe(3);
    expect(heroHarm('deadly')).toBe(2);
    expect(heroHarm('simple')).toBe(1);
  });
  it('turns a Daggerheart type and tier into a rank', () => {
    expect(foeRankFor('Standard', 1)).toBe('troublesome');
    expect(foeRankFor('Minion', 1)).toBe('troublesome');
    expect(foeRankFor('Minion', 3)).toBe('dangerous');
    expect(foeRankFor('Bruiser', 2)).toBe('formidable');
    expect(foeRankFor('Solo', 1)).toBe('formidable');
    expect(foeRankFor('Solo', 3)).toBe('epic');
    expect(foeRankFor('Solo', 4)).toBe('epic');
    expect(foeRankFor('Unheard-of', 2)).toBe('dangerous');
    expect(() => foeRankFor('Solo', 5)).toThrow();
  });
  it('ranks every adversary in the catalog', () => {
    for (const adversary of adversaries) {
      expect(isAdversaryType(adversary.type), `${adversary.name}: ${adversary.type}`).toBe(true);
      expect(FOE_RANKS.map(rank => rank.id)).toContain(foeRankFor(adversary.type, adversary.tier));
    }
    expect(new Set(adversaries.map(item => item.type))).toEqual(new Set(ADVERSARY_TYPES));
  });
  it('lists the type and tier pairs of each rank, and every pair belongs to one rank', () => {
    const all = FOE_RANKS.flatMap(rank => adversariesForRank(rank.id));
    expect(all).toHaveLength(ADVERSARY_TYPES.length * 4);
    for (const rank of FOE_RANKS) for (const pair of adversariesForRank(rank.id)) expect(foeRankFor(pair.type, pair.tier)).toBe(rank.id);
    expect(adversariesForRank('epic')).toContainEqual({ type: 'Solo', tier: 4 });
  });
  it('raises the rank of a pack, but only for Troublesome and Dangerous foes', () => {
    expect(packRank('troublesome', 'small')).toBe('dangerous');
    expect(packRank('troublesome', 'large')).toBe('formidable');
    expect(packRank('dangerous', 'large')).toBe('extreme');
    expect(packRank('dangerous', 'single')).toBe('dangerous');
    expect(() => packRank('formidable', 'small')).toThrow();
  });
});
