import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { lootEntries, lootTableName, rollLoot, type LootSet, type LootTable } from './model';

test('both core loot tables cover every possible total without gaps or duplicates', () => {
  for (const table of ['items', 'consumables'] as LootTable[]) {
    assert.deepEqual(lootEntries(table).map(entry => entry.roll).sort((a, b) => a - b), Array.from({ length: 60 }, (_, i) => i + 1));
    assert.equal(rollLoot(table, 1, () => 0).total, 1);
    const last = rollLoot(table, 5, () => .99999);
    assert.equal(last.total, 60);
    assert.equal(last.name, table === 'items' ? 'Belt of Unity' : 'Stardrop');
  }
});
test('the Additional tables from Hope & Fear cover every possible total', () => {
  for (const table of ['items', 'consumables'] as LootTable[]) {
    assert.deepEqual(lootEntries(table, 'additional').map(entry => entry.roll).sort((a, b) => a - b), Array.from({ length: 60 }, (_, i) => i + 1));
    const first = rollLoot(table, 1, () => 0, 'additional');
    assert.equal(first.total, 1);
    assert.equal(first.name, table === 'items' ? 'Caltrops' : 'Warding Candle');
    const last = rollLoot(table, 5, () => .99999, 'additional');
    assert.equal(last.total, 60);
    assert.equal(last.name, table === 'items' ? "Augur's Relic" : 'Featherstep Potion');
  }
});
test('loot tables are named and kept separate for each book', () => {
  assert.equal(lootTableName('items', 'core'), 'Core Set Items');
  assert.equal(lootTableName('items', 'additional'), 'Additional Items');
  assert.equal(lootTableName('consumables', 'core'), 'Core Set Consumables');
  assert.equal(lootTableName('consumables', 'additional'), 'Additional Consumables');
  for (const set of ['core', 'additional'] as LootSet[]) {
    const items = lootEntries('items', set);
    assert.ok(items.every(entry => entry.roll >= 1 && entry.roll <= 60));
    assert.ok(items.every(entry => entry.rollTable?.name === lootTableName('items', set)));
  }
  const coreFirst = lootEntries('items', 'core')[0];
  const additionalFirst = lootEntries('items', 'additional')[0];
  assert.ok(coreFirst && additionalFirst);
  assert.notEqual(coreFirst.id, additionalFirst.id);
  assert.equal(rollLoot('items', 2, () => .5, 'additional').name, 'Self-Tying Rope');
  assert.equal(rollLoot('consumables', 2, () => .5, 'additional').name, 'Glowmoss Mushroom');
});
test('loot uses the summed pool, not a uniform selection or an array offset', () => {
  const result = rollLoot('consumables', 2, () => .5);
  assert.deepEqual(result.dice, [7, 7]);
  assert.equal(result.total, 14);
  assert.equal(result.name, 'Improved Grindletooth Venom');
  for (const count of [0, 6, 1.5]) assert.throws(() => rollLoot('items', count));
});
