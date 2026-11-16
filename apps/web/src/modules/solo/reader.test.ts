import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DUALITY_TABLES, IRON_MOVES } from '@daggery/shared';
import { ReaderDocument } from './reader-document';
import { READER_ENTRIES, findReaderEntries, readerMoveId, readerStepTarget, resolveReaderHash } from './reader-model';
import { MOVE_FLOWS } from './workflow';

const html = renderToStaticMarkup(createElement(ReaderDocument));
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]!);
const targetIds = new Set(ids);

test('the reader contains all tables and moves without opening another screen', () => {
  for (const table of DUALITY_TABLES) assert.equal(ids.filter(id => id === `solo-table-${table.id}`).length, 1, table.id);
  for (const move of IRON_MOVES) assert.equal(ids.filter(id => id === readerMoveId(move.id)).length, 1, move.id);
  assert.doesNotMatch(html, /<(button|input|textarea|select|form|output|details)\b/);
  assert.equal(targetIds.size, ids.length, 'document anchors must be unique');
});

test('every outline and move reference points to an already-rendered document target', () => {
  for (const entry of READER_ENTRIES) assert.ok(targetIds.has(entry.id), entry.id);
  for (const flow of Object.values(MOVE_FLOWS)) {
    for (const step of [...flow.tools ?? [], ...flow.strong ?? [], ...flow.weak ?? [], ...flow.miss ?? []]) {
      assert.ok(targetIds.has(readerStepTarget(step).id), JSON.stringify(step));
    }
  }
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(targetIds.has(match[1]!), match[1]);
});

test('find searches table contents and rule text, not just titles', () => {
  assert.ok(findReaderEntries('separated').some(entry => entry.id === 'solo-table-iron-price'));
  assert.ok(findReaderEntries('  PAY   PRICE ').some(entry => entry.id === 'solo-table-iron-price'));
  assert.ok(findReaderEntries('Difficulty Resistance').some(entry => entry.title === 'Set the Difficulty'));
  assert.equal(findReaderEntries('this-does-not-exist-98342').length, 0);
  assert.equal(findReaderEntries('   ').length, READER_ENTRIES.length);
});

test('legacy links and document anchors resolve inside the same reference', () => {
  assert.equal(resolveReaderHash('#solo-combat'), 'solo-reader-section-combat');
  assert.equal(resolveReaderHash('#solo-tables-meaning'), 'solo-reader-section-meaning');
  assert.equal(resolveReaderHash('#solo-moves-face-danger'), readerMoveId('face-danger'));
  assert.equal(resolveReaderHash('#solo-oracle'), 'solo-reader-oracle');
  assert.equal(resolveReaderHash('#solo-rules'), 'solo-reader-rules');
  assert.equal(resolveReaderHash('#solo-table-iron-price'), 'solo-table-iron-price');
  assert.equal(resolveReaderHash('#solo-unknown-table'), undefined);
});
