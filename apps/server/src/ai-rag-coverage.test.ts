import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isNearDuplicate, normalizeForDedupe, pickDistinctivePhrases, sourcePriority } from './ai/rag-coverage';
import { resetSourcebookCache, searchSourcebooks } from './ai/sourcebook';

process.env.DAGGERY_REPO_RULES = 'off';
process.env.DAGGERY_CATALOG_CACHE = 'off';

function shelf(books: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'daggery-coverage-'));
  const dir = join(root, 'rules');
  mkdirSync(dir);
  for (const [name, value] of Object.entries(books)) writeFileSync(join(dir, name + '.json'), JSON.stringify(value));
  process.env.DAGGERY_DATA_DIR = root;
  resetSourcebookCache();
  return root;
}

function clean(root: string): void {
  delete process.env.DAGGERY_DATA_DIR;
  resetSourcebookCache();
  rmSync(root, { recursive: true, force: true });
}

test('near-duplicate detection ignores accents, case and punctuation', () => {
  const page = 'The Witherwild is a land of fungal bloom, where the dead do not stay buried and every road forks twice.';
  assert.equal(isNearDuplicate(page, '  ' + page.toUpperCase() + '  '), true);
  assert.equal(isNearDuplicate('The Witherwild is a land of fungal bloom', 'the witherwild is a land of fungal bloom'), true);
  assert.equal(isNearDuplicate(page, 'A brass orrery ticks above the archivist desk, counting centuries no living scholar remembers now.'), false);
  assert.equal(isNearDuplicate(page, 'The Witherwild is a land of fungal bloom'), false, 'very short pages are never collapsed');
  assert.equal(normalizeForDedupe('Ação, Coração!'), 'acao coracao');
  assert.ok(sourcePriority('core-rulebook') > sourcePriority('hope-and-fear-book'));
  assert.ok(sourcePriority('hope-and-fear-book') > sourcePriority('campaign-frame-materials-2026-08'));
  assert.ok(sourcePriority('campaign-frame-materials-2026-08') > sourcePriority('hope-and-fear-campaign-frame'));
});

test('distinctive phrases are rare, deterministic and drawn from text pages', () => {
  const pages = [
    { pdf: 1, text: 'The Witherwild fungal bloom corrupts every pilgrim who sleeps beneath the violet canopy tonight.' },
    { pdf: 2, text: 'Lanterns of cold iron mark the drowned causeway where the tide swallows careless travellers daily.' },
    { pdf: 3, text: 'Map page (PDF p. 3); no machine-readable text.' },
    { pdf: 4, text: 'A brass orrery ticks above the archivist desk, counting centuries no living scholar remembers now.' },
  ];
  const first = pickDistinctivePhrases(pages, 4, 3);
  const second = pickDistinctivePhrases(pages, 4, 3);
  assert.deepEqual(first, second, 'the seeded picker is reproducible');
  assert.ok(first.length > 0);
  assert.ok(first.every(phrase => phrase.words >= 3 && phrase.words <= 5));
  assert.ok(first.every(phrase => phrase.pdf !== 3), 'image-only labels are skipped');
  assert.ok(first.every(phrase => !phrase.phrase.includes('machine-readable')));
  assert.deepEqual(pickDistinctivePhrases([], 8), []);
});

test('search collapses duplicate pages and prefers the book over an older tile', t => {
  const shared = 'The Witherwild is a land of fungal bloom, where the dead do not stay buried and every road forks twice under a violet sky.';
  const book = (sourceId: string, title: string, pages: { pdf: number; printed: number | null; text: string; imageOnly?: boolean }[]) => ({
    sourceId, title, pdfPageCount: pages.length, pages,
  });
  const root = shelf({
    'core-rulebook': book('core-rulebook', 'Daggerheart Core Rulebook', [
      { pdf: 255, printed: 254, text: shared },
      { pdf: 256, printed: 255, text: 'The fungal bloom spreads through the valley.' },
    ]),
    'campaign-frame-materials-2026-08': book('campaign-frame-materials-2026-08', 'Campaign Frame Materials', [
      { pdf: 1, printed: null, text: shared },
    ]),
    'blank-maps': book('blank-maps', 'Daggerheart Blank Maps', [
      { pdf: 1, printed: null, text: 'Map page (PDF p. 1); no machine-readable text.', imageOnly: true },
      { pdf: 2, printed: null, text: 'Map page (PDF p. 2); no machine-readable text.', imageOnly: true },
    ]),
  });
  t.after(() => clean(root));

  const hits = searchSourcebooks('witherwild fungal bloom');
  assert.ok(hits.some(hit => hit.source === 'core-rulebook' && hit.pdfPage === 255), 'the book page is kept');
  assert.equal(hits.filter(hit => hit.source === 'campaign-frame-materials-2026-08').length, 0, 'the tile duplicate collapses into the book');
  assert.equal(hits[0]?.source, 'core-rulebook');
  assert.equal(hits[0]?.sourceLabel, 'Book');

  const maps = searchSourcebooks('map page machine readable text', { limit: 6 });
  assert.equal(maps.filter(hit => hit.source === 'blank-maps').length, 2, 'identical image-only labels are not merged');
  assert.ok(maps.every(hit => hit.imageOnly));
});
