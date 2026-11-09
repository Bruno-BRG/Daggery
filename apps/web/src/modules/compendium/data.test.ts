import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import { classes, communities, domainCards, domains, ancestries, transformations } from '@daggery/content';
import { ALL_ENTRIES, CATEGORIES, EMPTY_FILTERS, cardFileForEntry, filterEntries, subclassCardFile } from './data';
import { cardImage, hasStartingTraits, STARTING_TRAIT_VALUES, swapTraits, TRAIT_ORDER } from '../sheets/rules';
import type { Traits } from '@daggery/shared';

const cardsDir = fileURLToPath(new URL('../../../../../data/cards/', import.meta.url));

test('trait swaps preserve the starting distribution, including duplicate values', () => {
  let traits = Object.fromEntries(TRAIT_ORDER.map((trait, index) => [trait, STARTING_TRAIT_VALUES[index]])) as Traits;
  assert.equal(hasStartingTraits(traits), true);
  traits = swapTraits(traits, 'agility', 'strength');
  assert.equal(traits.agility, 1);
  assert.equal(traits.strength, 2);
  traits = swapTraits(traits, 'finesse', 'instinct');
  traits = swapTraits(traits, 'agility', 'instinct'); // equal values
  traits = swapTraits(traits, 'knowledge', 'presence');
  assert.equal(hasStartingTraits(traits), true);
  assert.equal(hasStartingTraits({ ...traits, agility: 99 }), false);
});

test('ranger connection excludes unrelated companion examples', () => {
  const ranger = classes.find((entry) => entry.id === 'ranger');
  assert.equal(ranger?.connections[2], 'What threat have you asked me to watch for, and why are you worried about it?');
});

test('catalog uses the core classes, domains, heritages and domain cards', () => {
  assert.equal(classes.length, 9);
  assert.equal(domains.length, 9);
  assert.equal(domainCards.length, 189);
  assert.equal(ancestries.length, 18);
  assert.equal(communities.length, 9);
  assert.equal(transformations.length, 0);
  assert.equal(CATEGORIES.some((category) => category.id === 'transformations'), false);
  assert.equal(classes.some((item) => ['assassin', 'brawler', 'warlock', 'witch'].includes(item.id)), false);
  assert.equal(domains.some((item) => item.id === 'dread'), false);
  assert.equal(classes.every((item) => item.subclasses.length === 2), true);
});

test('class entries represent each core class and subclass pair', () => {
  const entries = ALL_ENTRIES.filter((entry) => entry.kind === 'class');
  assert.equal(entries.length, 18);
  assert.equal(new Set(entries.map((entry) => entry.key)).size, 18);
  for (const cls of classes) for (const subclass of cls.subclasses) {
    const entry = entries.find((candidate) => candidate.id === `${cls.id}:${subclass.id}`);
    assert.ok(entry);
    assert.equal(entry.name, `${cls.name} — ${subclass.name}`);
    assert.equal(cardFileForEntry(entry), subclassCardFile(subclass.id, 'foundation'));
    assert.ok(filterEntries(entries, EMPTY_FILTERS, subclass.name).entries.includes(entry));
    assert.ok(filterEntries(entries, EMPTY_FILTERS, cls.name).entries.includes(entry));
  }
  const bard = filterEntries(entries, EMPTY_FILTERS, 'Troubadour').entries;
  assert.equal(bard.length, 1);
  assert.equal(bard[0]?.name, 'Bard — Troubadour');
});

test('sheet card lookup matches compendium art for every core domain card', () => {
  for (const entry of ALL_ENTRIES.filter((item) => item.kind === 'domainCard')) {
    const file = cardFileForEntry(entry);
    assert.ok(file, `missing compendium art for ${entry.name}`);
    assert.equal(cardImage(entry.id, 'domain'), `/cards/${file}`, `wrong sheet art for ${entry.name}`);
  }
});

test('every core card and class has both full art and thumbnail', () => {
  const artEntries = ALL_ENTRIES.filter((entry) => ['class', 'domainCard', 'ancestry', 'community'].includes(entry.kind));
  for (const entry of artEntries) {
    const file = cardFileForEntry(entry);
    assert.ok(file, `missing art mapping: ${entry.kind} ${entry.name}`);
    assert.ok(existsSync(join(cardsDir, file)), `missing art: ${file}`);
    assert.ok(existsSync(join(cardsDir, 'thumbs', file)), `missing thumbnail: ${file}`);
  }
  for (const cls of classes) for (const subclass of cls.subclasses) {
    for (const part of ['foundation', 'specialization', 'mastery'] as const) {
      const file = subclassCardFile(subclass.id, part);
      assert.ok(file, `missing ${subclass.name} ${part}`);
      assert.ok(existsSync(join(cardsDir, file)), `missing art: ${file}`);
      assert.ok(existsSync(join(cardsDir, 'thumbs', file)), `missing thumbnail: ${file}`);
    }
  }
});
