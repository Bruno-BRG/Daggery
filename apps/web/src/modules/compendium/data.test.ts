import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import { adversaries, armor, classes, communities, domainCards, domains, ancestries, environments, transformations, weapons } from '@daggery/content';
import { ALL_ENTRIES, CATEGORIES, EMPTY_FILTERS, cardFileForEntry, filterEntries, subclassCardFile } from './data';
import { cardImage, hasStartingTraits, STARTING_TRAIT_VALUES, swapTraits, TRAIT_ORDER } from '../sheets/rules';
import type { Traits } from '@daggery/shared';

const cardsDir = fileURLToPath(new URL('../../../../../packages/content/cards/', import.meta.url));

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

test('catalog combines the core book with Hope & Fear and Sablewood', () => {
  assert.equal(classes.length, 13);
  assert.equal(domains.length, 10);
  assert.equal(domainCards.length, 210);
  assert.equal(ancestries.length, 24);
  assert.equal(communities.length, 15);
  assert.equal(transformations.length, 6);
  assert.equal(CATEGORIES.some((category) => category.id === 'transformations'), true);
  assert.equal(classes.some((item) => ['assassin', 'brawler', 'warlock', 'witch'].includes(item.id)), true);
  assert.equal(domains.some((item) => item.id === 'dread'), true);
  assert.equal(classes.every((item) => item.subclasses.length === 2), true);
  assert.equal(classes.filter((item) => item.source === 'core').length, 9);
  assert.equal(classes.filter((item) => item.source === 'hope-and-fear').length, 4);
  assert.equal(weapons.length, 317);
  assert.equal(armor.length, 70);
  assert.equal(adversaries.length, 266);
  assert.equal(environments.length, 50);
  assert.ok(weapons.some((item) => item.id === 'katana' && item.source === 'hope-and-fear'));
  assert.ok(weapons.some((item) => item.id === 'sableblade' && item.source === 'sablewood'));
  assert.ok(adversaries.some((item) => item.id === 'bullfrog' && item.source === 'sablewood'));
  assert.ok(environments.some((item) => item.id === 'village-of-hush' && item.source === 'sablewood'));
});

test('class entries represent every class and subclass pair', () => {
  const entries = ALL_ENTRIES.filter((entry) => entry.kind === 'class');
  assert.equal(entries.length, 26);
  assert.equal(new Set(entries.map((entry) => entry.key)).size, 26);
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
  for (const entry of ALL_ENTRIES.filter((item) => item.kind === 'domainCard' && item.data.source === 'core')) {
    const file = cardFileForEntry(entry);
    assert.ok(file, `missing compendium art for ${entry.name}`);
    assert.equal(cardImage(entry.id, 'domain'), `/cards/${file}`, `wrong sheet art for ${entry.name}`);
  }
  for (const entry of ALL_ENTRIES.filter((item) => item.kind === 'domainCard' && item.data.source === 'hope-and-fear')) {
    const file = cardFileForEntry(entry);
    assert.ok(file, `missing compendium art for ${entry.name}`);
    assert.equal(cardImage(entry.id, 'domain'), `/cards/${file}`, `wrong sheet art for ${entry.name}`);
  }
});

test('every card and class in the art pipeline has both full art and thumbnail', () => {
  const artEntries = ALL_ENTRIES.filter((entry) =>
    ['class', 'domainCard', 'ancestry', 'community', 'transformation'].includes(entry.kind));
  for (const entry of artEntries) {
    const file = cardFileForEntry(entry);
    assert.ok(file, `missing art mapping: ${entry.kind} ${entry.name}`);
    assert.ok(existsSync(join(cardsDir, file)), `missing art: ${file}`);
    assert.ok(existsSync(join(cardsDir, 'thumbs', file)), `missing thumbnail: ${file}`);
  }
  for (const cls of classes) {
    for (const subclass of cls.subclasses) {
      for (const part of ['foundation', 'specialization', 'mastery'] as const) {
        const file = subclassCardFile(subclass.id, part);
        assert.ok(file, `missing ${subclass.name} ${part}`);
        assert.ok(existsSync(join(cardsDir, file)), `missing art: ${file}`);
        assert.ok(existsSync(join(cardsDir, 'thumbs', file)), `missing thumbnail: ${file}`);
      }
    }
  }
});
