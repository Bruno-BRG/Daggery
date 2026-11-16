import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DUALITY_TABLES, dualityTable } from '@daggery/shared';
import { ReferenceTableCard, rangeLabel, segments } from './table-reference';

const render = (id: string) => renderToStaticMarkup(createElement(ReferenceTableCard, { table: dualityTable(id) }));
const escaped = (value: string) => renderToStaticMarkup(createElement('span', null, value)).replace(/^<span>|<\/span>$/g, '');

test('phone references show every entry without digital dice or bookkeeping controls', () => {
  for (const table of DUALITY_TABLES) {
    const html = render(table.id);
    assert.doesNotMatch(html, /<(button|input|textarea|form|output)\b/, table.id);
    assert.doesNotMatch(html, /No roll yet|solo-card-result|solo-log|solo-stepper/, table.id);
    for (const column of table.columns) {
      assert.ok(html.includes(escaped(column.label)), `${table.id}: column ${column.label}`);
      for (const entry of column.entries) assert.ok(html.includes(escaped(entry)), `${table.id}: ${entry}`);
    }
  }
});

test('meaning references keep both Fear columns aligned with all twelve Hope rows', () => {
  for (const id of ['action', 'subject', 'descriptor']) {
    const html = render(id);
    assert.equal((html.match(/<table\b/g) ?? []).length, 1);
    assert.equal((html.match(/scope="row"/g) ?? []).length, 12);
    assert.match(html, /Fear odd: A. Fear even: B./);
    assert.match(html, /<th scope="row" class="solo-range">12<\/th>/);
  }
});

test('multi-column references stack independent tables instead of requiring sideways scrolling', () => {
  const table = dualityTable('npc-identity');
  assert.ok(table.columns.length > 1);
  assert.equal((render(table.id).match(/<table\b/g) ?? []).length, table.columns.length);
});

test('physical dice ranges combine only consecutive matching entries', () => {
  const rows = segments(['A', 'A', 'B', 'A']);
  assert.deepEqual(rows, [
    { start: 1, end: 2, text: 'A' },
    { start: 3, end: 3, text: 'B' },
    { start: 4, end: 4, text: 'A' },
  ]);
  assert.deepEqual(rows.map(rangeLabel), ['1–2', '3', '4']);
});
