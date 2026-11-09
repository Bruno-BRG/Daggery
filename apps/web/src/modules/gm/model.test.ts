import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { lootEntries, rollLoot, type LootTable } from './model';

test('both core loot tables cover every possible total without gaps or duplicates', () => {
  for (const table of ['items', 'consumables'] as LootTable[]) {
    assert.deepEqual(lootEntries(table).map(entry => entry.roll).sort((a, b) => a - b), Array.from({ length: 60 }, (_, i) => i + 1));
    assert.equal(rollLoot(table, 1, () => 0).total, 1);
    const last = rollLoot(table, 5, () => .99999);
    assert.equal(last.total, 60);
    assert.equal(last.name, table === 'items' ? 'Belt of Unity' : 'Stardrop');
  }
});
test('loot uses the summed pool, not a uniform selection or an array offset', () => {
  const result = rollLoot('consumables', 2, () => .5);
  assert.deepEqual(result.dice, [7, 7]);
  assert.equal(result.total, 14);
  assert.equal(result.name, 'Improved Grindletooth Venom');
  for (const count of [0, 6, 1.5]) assert.throws(() => rollLoot('items', count));
});
