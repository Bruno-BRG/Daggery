import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { GmActions } from './ai/tools';
import { PAGE_CHARS, listSourcebooks, readSourcebookPage, resetSourcebookCache, searchSourcebooks } from './ai/sourcebook';

// The committed sources/rules folder must not leak into fixture-based tests.
process.env.DAGGERY_REPO_RULES = 'off';
process.env.DAGGERY_CATALOG_CACHE = 'off';

const BOOK = {
  sourceId: 'test-book',
  title: 'Test Sourcebook',
  pdfPageCount: 4,
  printedPageOffset: 4,
  pages: [
    { pdf: 1, printed: 5, text: 'Vulnerable. While a hero is Vulnerable, incoming damage is increased. The condition clears when the attack resolves.' },
    { pdf: 2, printed: 6, text: 'Spending Fear. The GM may spend a Fear to spotlight an adversary. Fear caps at twelve.' },
    { pdf: 3, printed: 7, text: 'The Sablewood is a tier one forest full of hybrid beasts and forgotten gods.' },
    { pdf: 4, printed: 8, text: 'Long page ' + 'axolotl '.repeat(1200) },
  ],
};

function shelf(extra: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'daggery-rules-'));
  const dir = join(root, 'rules');
  mkdirSync(dir);
  writeFileSync(join(dir, 'test-book.json'), JSON.stringify(BOOK));
  for (const [name, value] of Object.entries(extra)) writeFileSync(join(dir, name), JSON.stringify(value));
  process.env.DAGGERY_DATA_DIR = root;
  resetSourcebookCache();
  return root;
}

function clean(root: string): void {
  delete process.env.DAGGERY_DATA_DIR;
  resetSourcebookCache();
  rmSync(root, { recursive: true, force: true });
}

test('sourcebook search ranks BM25 matches and reports printed and PDF pages', t => {
  const root = shelf();
  t.after(() => clean(root));
  assert.deepEqual(listSourcebooks(), [{ sourceId: 'test-book', title: 'Test Sourcebook', label: 'Source', pdfPageCount: 4 }]);
  const hits = searchSourcebooks('vulnerable damage');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0]?.source, 'test-book');
  assert.equal(hits[0]?.title, 'Test Sourcebook');
  assert.equal(hits[0]?.page, 5);
  assert.equal(hits[0]?.pdfPage, 1);
  assert.ok(hits[0]!.snippet.toLowerCase().includes('vulnerable'));
  assert.ok(hits[0]!.score > 0);
  const phrase = searchSourcebooks('spending fear');
  assert.equal(phrase[0]?.page, 6, 'the whole phrase ranks before single-term matches');
  assert.deepEqual(searchSourcebooks('vulnerable', { source: 'missing-book' }), []);
  assert.deepEqual(searchSourcebooks('   '), []);
});

test('sourcebook page reads accept printed or PDF numbers, span two pages and stay bounded', t => {
  const root = shelf();
  t.after(() => clean(root));
  const byPrinted = readSourcebookPage('test-book', 5);
  assert.ok(byPrinted);
  assert.deepEqual(byPrinted.pages, [{ page: 5, pdfPage: 1 }]);
  assert.ok(byPrinted.text.includes('Vulnerable'));
  assert.equal(byPrinted.truncated, false);
  const byPdf = readSourcebookPage('TEST-BOOK', 2, 2);
  assert.deepEqual(byPdf?.pages, [{ page: 6, pdfPage: 2 }, { page: 7, pdfPage: 3 }]);
  assert.ok(byPdf!.text.includes('Spending Fear') && byPdf!.text.includes('Sablewood'));
  const long = readSourcebookPage('test-book', 8);
  assert.equal(long?.truncated, true);
  assert.ok(long!.text.length <= PAGE_CHARS + 80, 'page text is capped');
  assert.equal(readSourcebookPage('test-book', 99), null);
  assert.equal(readSourcebookPage('missing-book', 1), null);
});

test('sourcebook search tolerates a missing rules folder', t => {
  const root = mkdtempSync(join(tmpdir(), 'daggery-empty-'));
  process.env.DAGGERY_DATA_DIR = root;
  resetSourcebookCache();
  t.after(() => clean(root));
  assert.deepEqual(listSourcebooks(), []);
  assert.deepEqual(searchSourcebooks('anything'), []);
  assert.equal(readSourcebookPage('test-book', 1), null);
});

test('sourcebook tools run through the GM action layer', async t => {
  const root = shelf();
  const db = openCampaignDatabase(':memory:');
  const campaigns = new CampaignService(db);
  t.after(() => { clean(root); db.close(); });
  const user = await campaigns.register('gmtest', 'a strong temporary test password');
  const campaign = campaigns.createCampaign(user.id, 'Shelf', '', { systemId: 'daggerheart', rulesetId: 'core', gmController: 'ai' });
  const actions = new GmActions(db, campaigns);
  const at = new Date().toISOString();
  db.prepare('INSERT INTO ai_turns(id,campaign_id,user_id,request_id,status,error,steps,cost,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('turn-1', campaign, user.id, 'req-1', 'running', '', 0, 0, at, at);
  const ctx = { campaign, owner: user.id, turn: 'turn-1', callId: 'call-1', assertActive: () => {}, publish: () => {}, publishRoll: () => {} };
  const found = actions.execute('search_sourcebook', { query: 'spending fear', limit: 3 }, ctx) as { results: { page: number; source: string }[]; sources: unknown[] };
  assert.equal(found.results[0]?.page, 6);
  assert.deepEqual(found.sources, [{ sourceId: 'test-book', title: 'Test Sourcebook', label: 'Source', pdfPageCount: 4 }]);
  const page = actions.execute('read_sourcebook_page', { source: 'test-book', page: 6, pages: 2 }, { ...ctx, callId: 'call-2' }) as { text: string };
  assert.ok(page.text.includes('Spending Fear') && page.text.includes('Sablewood'));
  assert.throws(() => actions.execute('read_sourcebook_page', { source: 'test-book', page: 99 }, { ...ctx, callId: 'call-3' }), /Invalid sourcebook page/);
});
