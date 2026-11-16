import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DUALITY_TABLES } from '@daggery/shared';

const root = new URL('../../../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('the Docker context includes every Markdown file imported by the play guide', () => {
  const source = read('apps/web/src/modules/solo/Rulebook.tsx');
  const imports = [...source.matchAll(/docs\/([^?']+)\?raw/g)].map(match => `docs/${match[1]}`);
  assert.deepEqual(imports, ['docs/solo-rules-gme.md'], 'GME is the only rules source in the guide');
  const ignores = read('.dockerignore').split(/\r?\n/);
  for (const path of imports) {
    assert.ok(existsSync(new URL(path, root)), `${path} must exist`);
    assert.ok(ignores.indexOf(`!${path}`) > ignores.indexOf('docs/*'), `${path} must be included after the docs exclusion`);
  }
});

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
