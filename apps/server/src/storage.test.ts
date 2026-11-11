import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { bundledPaths, dataDirectory, runtimePaths } from './storage';

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('bundled paths stay separate from runtime overrides and the working directory', () => {
  const data = process.env.DAGGERY_DATA_DIR;
  const db = process.env.DAGGERY_DB;
  const cwd = process.cwd();
  try {
    delete process.env.DAGGERY_DATA_DIR;
    delete process.env.DAGGERY_DB;
    const defaultRoot = fileURLToPath(new URL('../../../data/', import.meta.url));
    assert.equal(dataDirectory(), defaultRoot);
    assert.equal(runtimePaths().database, join(defaultRoot, 'daggery.db'));
    const customRoot = join(defaultRoot, 'storage-test');
    process.env.DAGGERY_DATA_DIR = customRoot;
    process.env.DAGGERY_DB = join(defaultRoot, 'external.db');
    process.chdir(fileURLToPath(new URL('../', import.meta.url)));
    assert.deepEqual(runtimePaths(), {
      root: customRoot,
      database: process.env.DAGGERY_DB,
      campaignAssets: join(customRoot, 'campaign-assets'),
      legacyAssets: join(customRoot, 'assets'),
      backups: join(customRoot, 'backups'),
      rules: join(customRoot, 'rules'),
      models: join(customRoot, 'models'),
    });
    assert.equal(bundledPaths.cards, fileURLToPath(new URL('../../../packages/content/cards/', import.meta.url)));
    assert.equal(bundledPaths.rules, fileURLToPath(new URL('../../../sources/rules/', import.meta.url)));
    assert.equal(bundledPaths.web, fileURLToPath(new URL('../../web/dist/', import.meta.url)));
  } finally {
    process.chdir(cwd);
    restore('DAGGERY_DATA_DIR', data);
    restore('DAGGERY_DB', db);
  }
});
