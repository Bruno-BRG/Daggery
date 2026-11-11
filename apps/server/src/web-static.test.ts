import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerWebApp } from './web-static';

test('the web app serves its files, page paths get the index, and missing API and asset paths stay 404', async () => {
  const root = mkdtempSync(join(tmpdir(), 'daggery-web-'));
  try {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Daggery</title>');
    writeFileSync(join(root, 'assets', 'app.js'), 'console.log("daggery");');
    const app = Fastify({ logger: false });
    app.get('/api/me', async () => ({ user: null }));
    assert.equal(await registerWebApp(app, root), true);
    try {
      const home = await app.inject({ method: 'GET', url: '/' });
      assert.equal(home.statusCode, 200);
      assert.match(String(home.headers['content-type']), /text\/html/);
      assert.match(home.body, /<title>Daggery/);
      const page = await app.inject({ method: 'GET', url: '/campaigns/abc?tab=notes' });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /<title>Daggery/);
      const file = await app.inject({ method: 'GET', url: '/assets/app.js' });
      assert.equal(file.statusCode, 200);
      assert.match(file.body, /daggery/);
      assert.equal((await app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode, 404, 'a missing asset is not replaced by the page');
      assert.equal((await app.inject({ method: 'GET', url: '/cards/subclass/missing.webp' })).statusCode, 404, 'missing card art must not return HTML with status 200');
      assert.equal((await app.inject({ method: 'GET', url: '/cards/missing' })).statusCode, 404, 'the entire card namespace is excluded from SPA fallback');
      const missingApi = await app.inject({ method: 'GET', url: '/api/nothing' });
      assert.equal(missingApi.statusCode, 404);
      assert.match(String(missingApi.headers['content-type']), /application\/json/);
      assert.equal((await app.inject({ method: 'GET', url: '/api/me' })).statusCode, 200, 'server routes keep priority');
      assert.equal((await app.inject({ method: 'POST', url: '/campaigns' })).statusCode, 404, 'only GET falls back to the page');
    } finally {
      await app.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the web app is not registered when its build is missing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'daggery-web-empty-'));
  const app = Fastify({ logger: false });
  try {
    assert.equal(await registerWebApp(app, root), false);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
