import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { MythicTable, MythicTablesFile } from '@daggery/shared';
import { loadMythic, mythicDataDir } from './mythic';

const FILES = ['oracle.json', 'adventure-crafter.json', 'location-crafting.json', 'collected-tables.json'];
const missing = FILES.filter((name) => !existsSync(join(mythicDataDir, name)));
const skip = missing.length > 0 ? `Mythic table data not present (${missing.join(', ')})` : false;

function allFiles(data: Awaited<ReturnType<typeof loadMythic>>): MythicTablesFile[] {
  return [data.oracle, data.adventureCrafter, data.locationCrafting, data.collectedTables]
    .filter((file): file is MythicTablesFile => file !== null);
}

function assertContiguous(table: MythicTable): void {
  let next = 1;
  for (const entry of table.entries) {
    assert.ok(entry.range, `${table.id}: entry is missing a roll range`);
    const [min, max] = entry.range;
    assert.equal(min, next, `${table.id}: expected range to start at ${next}, got ${min}-${max}`);
    assert.ok(max >= min, `${table.id}: reversed range ${min}-${max}`);
    next = max + 1;
  }
  assert.equal(next - 1, 100, `${table.id}: ranges cover 1-${next - 1}, expected 1-100`);
}

test('loadMythic tolerates a missing data directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mythic-empty-'));
  try {
    const data = await loadMythic(dir);
    assert.deepEqual(data, {
      available: false,
      oracle: null,
      adventureCrafter: null,
      locationCrafting: null,
      collectedTables: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Mythic d100 tables are contiguous from 1 to 100', { skip }, async () => {
  const data = await loadMythic();
  assert.equal(data.available, true);
  for (const file of allFiles(data)) {
    for (const table of file.tables) {
      if (table.die !== 'd100') continue;
      if (table.entries.some((entry) => entry.ranges)) continue; // odds chart checked separately
      assertContiguous(table);
    }
  }
});

test('Ask the Game Master odds rows are complete and contiguous', { skip }, async () => {
  const data = await loadMythic();
  const odds = data.oracle?.tables.find((table) => table.id === 'ask-the-game-master');
  assert.ok(odds, 'missing ask-the-game-master table');
  assert.equal(odds.entries.length, 9);
  for (const entry of odds.entries) {
    assert.ok(entry.label && entry.label.trim(), 'odds row is missing a label');
    const ranges = entry.ranges;
    assert.ok(ranges, `${entry.label}: missing ranges`);
    const exceptionalYes = ranges['exceptionalYes']!;
    const yes = ranges['yes']!;
    const no = ranges['no']!;
    const exceptionalNo = ranges['exceptionalNo']!;
    assert.equal(exceptionalYes[0], 1, `${entry.label}: Exceptional Yes must begin at 1`);
    assert.equal(exceptionalYes[1] + 1, yes[0], `${entry.label}: gap between Exceptional Yes and Yes`);
    assert.equal(yes[1] + 1, no[0], `${entry.label}: gap between Yes and No`);
    assert.equal(no[1] + 1, exceptionalNo[0], `${entry.label}: gap between No and Exceptional No`);
    assert.equal(exceptionalNo[1], 100, `${entry.label}: Exceptional No must end at 100`);
  }
  const byLabel = new Map(odds.entries.map((entry) => [entry.label, entry.ranges!]));
  assert.deepEqual(byLabel.get('Certain'), {
    exceptionalYes: [1, 18], yes: [19, 90], no: [91, 98], exceptionalNo: [99, 100],
  });
  assert.deepEqual(byLabel.get('50/50 or Unknown'), {
    exceptionalYes: [1, 10], yes: [11, 50], no: [51, 90], exceptionalNo: [91, 100],
  });
  assert.deepEqual(byLabel.get('Impossible'), {
    exceptionalYes: [1, 2], yes: [3, 10], no: [11, 82], exceptionalNo: [83, 100],
  });
});

test('Discover Meaning covers the full d100 range', { skip }, async () => {
  const data = await loadMythic();
  const meaning = data.oracle?.tables.find((table) => table.id === 'discover-meaning');
  assert.ok(meaning, 'missing discover-meaning table');
  assert.equal(meaning.entries.length, 50);
  assertContiguous(meaning);
  assert.deepEqual(meaning.entries[0]?.cells, ['Attain', 'Artificial']);
  assert.deepEqual(meaning.entries[49]?.cells, ['Uncertain', 'Warm']);
});

test('every Mythic table entry has non-empty content', { skip }, async () => {
  const data = await loadMythic();
  for (const file of allFiles(data)) {
    for (const table of file.tables) {
      assert.ok(table.entries.length > 0, `${table.id}: table has no entries`);
      for (const entry of table.entries) {
        if (entry.text !== undefined) assert.ok(entry.text.trim(), `${table.id}: empty text entry`);
        if (entry.cells !== undefined) {
          assert.ok(entry.cells.length > 0, `${table.id}: empty cells entry`);
          for (const cell of entry.cells) assert.ok(cell.trim(), `${table.id}: empty cell`);
        }
        if (entry.ranges !== undefined) {
          assert.ok(entry.label?.trim(), `${table.id}: named-range entry without a label`);
          for (const [name, range] of Object.entries(entry.ranges)) {
            assert.equal(range.length, 2, `${table.id}/${entry.label}: bad range for ${name}`);
            assert.ok(range[0] <= range[1], `${table.id}/${entry.label}: reversed range for ${name}`);
          }
        }
        assert.ok(
          entry.text !== undefined || entry.cells !== undefined || entry.ranges !== undefined,
          `${table.id}: entry has no content`,
        );
      }
    }
  }
});
