import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DUALITY_TABLES } from '@daggery/shared';
import { SOLO_SECTIONS } from './reference';

const root = new URL('../../../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('every table used by the full GME manual exists in the sole engine', () => {
  const manual = read('docs/duality-solo-engine/duality-gme-manual.html');
  const tableIds = new Set(DUALITY_TABLES.map(table => table.id));
  // These two reference charts are generated from ranks and likelihoods, not d12 tables.
  tableIds.add('iron-ranks');
  tableIds.add('iron-oracle');
  const manualIds = new Set([...manual.matchAll(/data-t="([^"]+)"/g)].map(match => match[1]!));
  for (const id of manualIds) assert.ok(tableIds.has(id), `Missing manual table: ${id}`);
  for (const table of DUALITY_TABLES) assert.ok(manualIds.has(table.id), `Table outside the GME manual: ${table.id}`);
});

test('the solo page shows every GME table exactly once', () => {
  const shown = SOLO_SECTIONS.flatMap(section => section.tables);
  assert.equal(new Set(shown).size, shown.length, 'a table appears in two sections');
  assert.deepEqual([...shown].sort(), DUALITY_TABLES.map(table => table.id).sort());
});
