import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DUALITY_TABLES, IRON_MOVES, LODESTAR_TABLES } from '@daggery/shared';
import { SOLO_SECTIONS } from './reference';

const root = new URL('../../../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('every table used by the full GME manual exists in the sole engine', () => {
  const manual = read('docs/duality-solo-engine/duality-gme-manual.html');
  const tableIds = new Set(DUALITY_TABLES.map(table => table.id));
  // These charts are generated from ranks, likelihoods, foes, debilities and stats, not d12 tables.
  for (const id of ['iron-ranks', 'iron-oracle', 'iron-foes', 'iron-foes-short', 'iron-foe-tiers', 'iron-stats', 'iron-debilities']) tableIds.add(id);
  const manualIds = new Set([...manual.matchAll(/data-t="([^"]+)"/g)].map(match => match[1]!));
  for (const id of manualIds) assert.ok(tableIds.has(id), `Missing manual table: ${id}`);
  for (const table of DUALITY_TABLES) assert.ok(manualIds.has(table.id), `Table outside the GME manual: ${table.id}`);
});

test('the solo page shows every GME table exactly once', () => {
  const shown = SOLO_SECTIONS.flatMap(section => section.tables);
  assert.equal(new Set(shown).size, shown.length, 'a table appears in two sections');
  assert.deepEqual([...shown].sort(), DUALITY_TABLES.map(table => table.id).sort());
});

test('the manual prints every Ironsworn Lodestar d100 table, and every move once', () => {
  const manual = read('docs/duality-solo-engine/duality-gme-manual.html');
  const printed = new Set([...manual.matchAll(/data-l="([^"]+)"/g)].map(match => match[1]!));
  for (const table of LODESTAR_TABLES) assert.ok(printed.has(table.id), `Missing d100 table in the manual: ${table.id}`);
  for (const id of printed) assert.ok(LODESTAR_TABLES.some(table => table.id === id), `Unknown d100 table: ${id}`);
  // Every move is placed on a page by id, exactly once.
  const placed = (name: string) => {
    const html = read(`docs/duality-solo-engine/${name}.html`);
    const byId = [...html.matchAll(/data-only="([^"]+)"/g)].flatMap(match => match[1]!.split(','));
    const byGroup = [...html.matchAll(/data-moves="([a-z]+)"/g)].flatMap(match => IRON_MOVES.filter(move => move.group === match[1]).map(move => move.id));
    return [...byId, ...byGroup];
  };
  for (const name of ['duality-gme-manual', 'duality-gme', 'duality-gme-playkit']) {
    const ids = placed(name);
    assert.equal(new Set(ids).size, ids.length, `${name}: a move is placed twice`);
    for (const move of IRON_MOVES) assert.ok(ids.includes(move.id), `${name}: missing move ${move.id}`);
  }
});
