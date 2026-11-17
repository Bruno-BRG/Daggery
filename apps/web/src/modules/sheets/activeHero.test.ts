import assert from 'node:assert/strict';
import test from 'node:test';
import { activeHeroStorageKey, chooseActiveHero, sortHeroes, type HeroSummary } from './activeHero';

const hero = (id: string, name: string, createdAt: string): HeroSummary => ({ id, name, createdAt });

test('the stored hero wins while it still exists', () => {
  const heroes = [hero('a', 'Ada', '2024-01-01'), hero('b', 'Bo', '2024-02-01'), hero('c', 'Cy', '2024-03-01')];
  assert.equal(chooseActiveHero(heroes, 'b')?.id, 'b');
  assert.equal(chooseActiveHero(heroes, 'c')?.id, 'c');
});

test('falls back to the first hero by creation order when nothing is stored', () => {
  const heroes = [hero('late', 'Zed', '2024-03-01'), hero('early', 'Ada', '2024-01-01'), hero('middle', 'Bo', '2024-02-01')];
  assert.equal(chooseActiveHero(heroes, null)?.id, 'early');
  assert.equal(chooseActiveHero(heroes, undefined)?.id, 'early');
  assert.equal(chooseActiveHero(heroes, '')?.id, 'early');
});

test('falls back to another hero when the stored one was deleted', () => {
  const heroes = [hero('a', 'Ada', '2024-01-01'), hero('b', 'Bo', '2024-02-01')];
  assert.equal(chooseActiveHero(heroes, 'deleted')?.id, 'a');
});

test('heroes created in the same instant are ordered by name', () => {
  const heroes = [hero('c', 'Cy', '2024-01-01'), hero('a', 'Ada', '2024-01-01'), hero('b', 'Bo', '2024-01-01')];
  assert.deepEqual(sortHeroes(heroes).map((entry) => entry.id), ['a', 'b', 'c']);
  assert.equal(chooseActiveHero(heroes, 'missing')?.id, 'a');
});

test('no heroes means no active hero, and the input array is not mutated', () => {
  assert.equal(chooseActiveHero([], 'a'), undefined);
  const heroes = [hero('b', 'Bo', '2024-02-01'), hero('a', 'Ada', '2024-01-01')];
  sortHeroes(heroes);
  assert.deepEqual(heroes.map((entry) => entry.id), ['b', 'a']);
});

test('the storage key is scoped to the campaign', () => {
  assert.equal(activeHeroStorageKey('campaign-1'), 'daggery:active-hero:campaign-1');
  assert.equal(activeHeroStorageKey('campaign-2'), 'daggery:active-hero:campaign-2');
});
