import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { AiCanon } from './ai/canon';
import { AiJournal } from './ai/journal';
import { EmbeddingIndex, cosine, normalizeVector, type Embedder } from './ai/embeddings';
import { catalogEntries, catalogSemantic, ensureCatalogEmbeddings } from './ai/catalog-index';
import { ensureSourcebookEmbeddings, resetSourcebookCache, searchSourcebooks } from './ai/sourcebook';
import { GmActions } from './ai/tools';

// Fixture-based tests own the shelf: ignore the committed sources/rules folder and
// never touch the developer's catalog cache.
process.env.DAGGERY_REPO_RULES = 'off';
process.env.DAGGERY_CATALOG_CACHE = 'off';

/** A deterministic stand-in for the sentence model: synonym groups share one dimension. */
const CONCEPTS: string[][] = [
  ['innkeeper', 'tavern keeper', 'publican', 'tavern', 'estalajadeiro'],
  ['lantern', 'lamp', 'light', 'lanterna'],
  ['harbor', 'port', 'dock', 'porto'],
  ['sword', 'blade', 'espada'],
  ['miller', 'moleiro'],
  ['debt', 'owe', 'owing', 'divida'],
  ['forest', 'sablewood', 'woods', 'mata'],
];

class FakeEmbedder implements Embedder {
  readonly model = 'fake-mini';
  readonly dim = 16;
  batches: string[][] = [];
  fail = false;
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.batches.push(texts);
    if (this.fail) throw new Error('embedding offline');
    return texts.map(text => {
      const lower = text.toLowerCase();
      const vector = new Float32Array(this.dim);
      CONCEPTS.forEach((terms, index) => {
        if (terms.some(term => lower.includes(term))) vector[index] = (vector[index] ?? 0) + 1;
      });
      return normalizeVector(vector);
    });
  }
}

function embedderOf(embedder: FakeEmbedder): () => Promise<Embedder | null> {
  return async () => embedder;
}

async function store(embedder: FakeEmbedder | null = new FakeEmbedder()) {
  const db = openCampaignDatabase(':memory:');
  const campaigns = new CampaignService(db);
  const user = await campaigns.register('rag-gm', 'a strong temporary test password');
  const campaign = campaigns.createCampaign(user.id, 'RAG', '', { systemId: 'daggerheart', rulesetId: 'core', gmController: 'ai' });
  const index = embedder ? new EmbeddingIndex(db, embedderOf(embedder), { debounceMs: 1, log: () => {} }) : new EmbeddingIndex(db, undefined);
  return { db, campaign, user, index, canon: new AiCanon(db, index), journal: new AiJournal(db, index), close: () => { index.close(); db.close(); } };
}


test('canon writes are indexed live and become semantically searchable after flush', async () => {
  const s = await store();
  try {
    const entry = s.canon.upsert(s.campaign, { kind: 'person', title: 'Marta the Innkeeper', body: 'She runs the tavern by the docks.', visibility: 'shared' });
    assert.ok(!s.index.vectorFor(s.campaign, 'canon', entry.id), 'nothing is embedded before the queue drains');
    await s.index.flush();
    assert.ok(s.index.vectorFor(s.campaign, 'canon', entry.id), 'flush embeds the new canon entry');

    const queryVector = await s.index.embedQuery('publican');
    assert.ok(queryVector);
    const hybrid = s.canon.search(s.campaign, 'publican', 10, undefined, false, { queryVector }).map(item => item.id);
    assert.deepEqual(hybrid, [entry.id], 'a synonym-only query finds the entry through the vector');
    assert.deepEqual(s.canon.search(s.campaign, 'publican', 10), [], 'BM25 alone misses the synonym');
    // An unrelated pure-noise query returns nothing even with a query vector.
    assert.deepEqual(s.canon.search(s.campaign, 'zeppelin weather', 10, undefined, false, { queryVector: await s.index.embedQuery('zeppelin weather') }).map(item => item.id), []);
  } finally {
    s.close();
  }
});

test('journal writes, edits and removals keep the vectors correct', async () => {
  const s = await store();
  try {
    const id = s.journal.insert(s.campaign, { chat: null, turn: null, kind: 'note', title: 'The publican speaks', body: 'He mentions a lamp in the cellar.', visibility: 'shared', author: 'gm' });
    await s.index.flush();
    assert.ok(s.index.vectorFor(s.campaign, 'journal', id));

    const found = s.journal.search(s.campaign, true, 'innkeeper', 10, { queryVector: await s.index.embedQuery('innkeeper') });
    assert.deepEqual(found.map(entry => entry.id), [id], 'a synonym query finds the note');

    s.journal.update(s.campaign, id, { title: 'The miller speaks', body: 'He owes a debt to the chapel.' });
    await s.index.flush();
    const current = s.journal.search(s.campaign, true, 'innkeeper', 10, { queryVector: await s.index.embedQuery('innkeeper') });
    assert.deepEqual(current, [], 'the stale vector is replaced after an edit');
    const miller = s.journal.search(s.campaign, true, 'moleiro', 10, { queryVector: await s.index.embedQuery('moleiro') });
    assert.deepEqual(miller.map(entry => entry.id), [id], 'the new text is searchable');

    s.journal.remove(s.campaign, id);
    assert.ok(!s.index.vectorFor(s.campaign, 'journal', id), 'removal deletes the vector');
  } finally {
    s.close();
  }
});

test('archiving canon deletes its vector', async () => {
  const s = await store();
  try {
    const entry = s.canon.upsert(s.campaign, { kind: 'fact', title: 'The lantern', body: 'It burns in the harbor.', visibility: 'shared' });
    await s.index.flush();
    assert.ok(s.index.vectorFor(s.campaign, 'canon', entry.id));
    assert.ok(s.canon.archive(s.campaign, entry.id));
    assert.ok(!s.index.vectorFor(s.campaign, 'canon', entry.id), 'an archived entry is removed from the semantic index');
  } finally {
    s.close();
  }
});

test('text_hash coalesces unchanged work and re-embeds changed text', async () => {
  const embedder = new FakeEmbedder();
  const s = await store(embedder);
  try {
    const entry = s.canon.upsert(s.campaign, { kind: 'fact', title: 'The harbor', body: 'Docks and ships.', visibility: 'shared' });
    await s.index.flush();
    const first = embedder.batches.length;
    assert.equal(first, 1);

    s.canon.upsert(s.campaign, { id: entry.id, kind: 'fact', title: 'The harbor', body: 'Docks and ships.' });
    await s.index.flush();
    assert.equal(embedder.batches.length, first, 'unchanged text is not embedded again');

    s.canon.upsert(s.campaign, { id: entry.id, kind: 'fact', title: 'The harbor', body: 'Docks, ships and a lantern.' });
    await s.index.flush();
    assert.equal(embedder.batches.length, first + 1, 'changed text is embedded again');
  } finally {
    s.close();
  }
});

test('a missing or failing embedder silently falls back to BM25', async () => {
  const disabled = await store(null);
  try {
    disabled.canon.upsert(disabled.campaign, { kind: 'person', title: 'Marta the Innkeeper', body: 'She runs the tavern.', visibility: 'shared' });
    assert.equal(await disabled.index.embedQuery('publican'), null, 'a disabled index has no query vector');
    assert.equal(disabled.canon.search(disabled.campaign, 'tavern', 10).length, 1, 'BM25 still works');
  } finally {
    disabled.close();
  }

  // A model that fails to load is treated as unavailable, with a single log line.
  const db = openCampaignDatabase(':memory:');
  const campaigns = new CampaignService(db);
  const user = await campaigns.register('rag-offline', 'a strong temporary test password');
  const campaign = campaigns.createCampaign(user.id, 'Offline', '', { systemId: 'daggerheart', rulesetId: 'core', gmController: 'ai' });
  const logs: string[] = [];
  const failing = new EmbeddingIndex(db, async () => { throw new Error('offline'); }, { debounceMs: 1, log: message => logs.push(message) });
  const canon = new AiCanon(db, failing);
  const entry = canon.upsert(campaign, { kind: 'person', title: 'Marta the Innkeeper', body: 'She runs the tavern.', visibility: 'shared' });
  await failing.flush();
  assert.equal(await failing.embedQuery('publican'), null);
  assert.ok(!failing.vectorFor(campaign, 'canon', entry.id));
  assert.equal(canon.search(campaign, 'tavern', 10).length, 1, 'the write is still BM25 searchable');
  assert.equal(logs.length, 1, 'the failure is logged once');
  failing.close();
  db.close();
});

test('backfill embeds existing campaign rows on startup', async () => {
  const db = openCampaignDatabase(':memory:');
  const campaigns = new CampaignService(db);
  const user = await campaigns.register('rag-backfill', 'a strong temporary test password');
  const campaign = campaigns.createCampaign(user.id, 'Backfill', '', { systemId: 'daggerheart', rulesetId: 'core', gmController: 'ai' });
  // Rows written before the semantic index existed have no vectors.
  const legacyCanon = new AiCanon(db);
  const legacyJournal = new AiJournal(db);
  const canonEntry = legacyCanon.upsert(campaign, { kind: 'person', title: 'The Innkeeper', body: 'A tavern host.', visibility: 'shared' });
  const journalId = legacyJournal.insert(campaign, { chat: null, turn: null, kind: 'note', title: 'The harbor lamp', body: 'A light on the dock.', visibility: 'shared', author: 'owner' });

  const embedder = new FakeEmbedder();
  const index = new EmbeddingIndex(db, embedderOf(embedder), { debounceMs: 1, log: () => {} });
  index.backfill();
  await index.flush();
  assert.ok(index.vectorFor(campaign, 'canon', canonEntry.id), 'canon rows are backfilled');
  assert.ok(index.vectorFor(campaign, 'journal', journalId), 'journal rows are backfilled');
  const indexedCanon = new AiCanon(db, index);
  const hybrid = indexedCanon.search(campaign, 'publican', 10, undefined, false, { queryVector: await index.embedQuery('publican') });
  assert.deepEqual(hybrid.map(item => item.id), [canonEntry.id]);
  index.close();
  db.close();
});

test('hybrid ranking keeps visibility, archived filtering and campaign scoping', async () => {
  const s = await store();
  try {
    const shared = s.canon.upsert(s.campaign, { kind: 'fact', title: 'The Innkeeper shared', body: 'A publican in the harbor.', visibility: 'shared' });
    const hidden = s.canon.upsert(s.campaign, { kind: 'secret', title: 'The Innkeeper truth', body: 'The innkeeper is a spy.', visibility: 'gm' });
    const archived = s.canon.upsert(s.campaign, { kind: 'fact', title: 'The Innkeeper past', body: 'Former tavern keeper.', visibility: 'shared' });
    await s.index.flush();
    s.canon.archive(s.campaign, archived.id);
    const vector = await s.index.embedQuery('publican');
    assert.deepEqual(s.canon.search(s.campaign, 'publican', 10, undefined, false, { gm: false, queryVector: vector }).map(item => item.id), [shared.id], 'a non-GM reader sees only shared, active entries');
    assert.ok(s.canon.search(s.campaign, 'publican', 10, undefined, false, { queryVector: vector }).some(item => item.id === hidden.id), 'the GM sees the hidden entry');
    assert.ok(!s.canon.search(s.campaign, 'publican', 10, undefined, false, { queryVector: vector }).some(item => item.id === archived.id), 'archived entries are hidden by default');
    assert.ok(s.canon.search(s.campaign, 'tavern keeper', 10, undefined, true).some(item => item.id === archived.id), 'an archived entry remains reachable through BM25 on request');
  } finally {
    s.close();
  }
});

test('hybrid ranking lifts a synonym hit above BM25-only results', async () => {
  const s = await store();
  try {
    const synonym = s.canon.upsert(s.campaign, { kind: 'person', title: 'Marta', body: 'She keeps the inn as its innkeeper by the dock.', visibility: 'shared' });
    const distractor = s.canon.upsert(s.campaign, { kind: 'fact', title: 'Weather', body: 'Rain over the harbor.', visibility: 'shared' });
    await s.index.flush();
    const vector = await s.index.embedQuery('publican');
    const hybrid = s.canon.search(s.campaign, 'publican', 10, undefined, false, { queryVector: vector }).map(item => item.id);
    assert.deepEqual(hybrid, [synonym.id], 'the synonym is found and unrelated content is not');
    assert.ok(!s.canon.search(s.campaign, 'publican', 10).some(item => item.id === synonym.id), 'BM25 alone loses it');
    assert.ok(s.canon.search(s.campaign, 'harbor', 10).some(item => item.id === distractor.id), 'ordinary keyword search is untouched');
  } finally {
    s.close();
  }
});

test('sourcebook vectors are cached, rebuilt on change and new books are picked up', async t => {
  const root = mkdtempSync(join(tmpdir(), 'daggery-rag-shelf-'));
  const dir = join(root, 'rules');
  mkdirSync(dir);
  const book = (sourceId: string, pages: string[]) => ({
    sourceId, title: 'Book ' + sourceId, pdfPageCount: pages.length,
    pages: pages.map((text, index) => ({ pdf: index + 1, printed: index + 1, text })),
  });
  writeFileSync(join(dir, 'first.json'), JSON.stringify(book('first', ['The innkeeper pours ale.', 'A quiet road.'])));
  process.env.DAGGERY_DATA_DIR = root;
  resetSourcebookCache();
  t.after(() => { delete process.env.DAGGERY_DATA_DIR; resetSourcebookCache(); rmSync(root, { recursive: true, force: true }); });

  const embedder = new FakeEmbedder();
  const built = await ensureSourcebookEmbeddings(embedder);
  assert.equal(built.built, 1);
  assert.equal(built.pages, 2);
  const queryVector = await embedder.embed(['publican']);
  const semantic = searchSourcebooks('publican', { queryVector: queryVector[0] });
  assert.equal(semantic[0]?.source, 'first', 'the synonym reaches the page through its vector');
  assert.equal(semantic[0]?.page, 1);

  // A book added after startup is visible to BM25 at once and is embedded on the next ensure.
  writeFileSync(join(dir, 'second.json'), JSON.stringify(book('second', ['A lantern in the forest.'])));
  const immediate = searchSourcebooks('lantern');
  assert.equal(immediate[0]?.source, 'second', 'the new book is searchable without a restart');
  const refreshed = await ensureSourcebookEmbeddings(embedder);
  assert.equal(refreshed.built, 1, 'only the new book is embedded');
  const tree = searchSourcebooks('woods', { queryVector: (await embedder.embed(['woods']))[0] });
  assert.equal(tree[0]?.source, 'second', 'the new page is semantically retrievable');

  // Changing a book rebuilds its cache; an unchanged one is left alone.
  writeFileSync(join(dir, 'second.json'), JSON.stringify(book('second', ['A lantern in the forest.', 'A blade in the trees.'])));
  const rebuilt = await ensureSourcebookEmbeddings(embedder);
  assert.equal(rebuilt.built, 1, 'the changed book is rebuilt and the unchanged one is skipped');
  assert.equal(rebuilt.pages, 2);
});

test('the structured catalog is embedded and searchable by meaning across every source', async () => {
  const embedder = new FakeEmbedder();
  const entries = catalogEntries();
  assert.ok(entries.length > 0);
  assert.ok(entries.some(entry => entry.source === 'core'), 'the core catalog is indexed too');
  assert.ok(entries.some(entry => entry.source === 'hope-and-fear'));
  assert.ok(entries.some(entry => entry.source === 'sablewood'));
  assert.ok(entries.some(entry => entry.category === 'domains'));
  assert.ok(entries.some(entry => entry.category === 'conditions'));
  const count = await ensureCatalogEmbeddings(embedder);
  assert.equal(count, entries.length, 'every catalog entry has a vector');

  const query = (await embedder.embed(['forest']))[0]!;
  const hits = catalogSemantic(query, { limit: 20 });
  assert.ok(hits.length > 0, 'a synonym query returns catalog entries');
  assert.ok(hits.every(hit => hit.similarity >= 0.32));
  const sablewood = catalogSemantic(query, { category: 'environments', limit: 5 });
  assert.ok(sablewood.some(hit => hit.entry.source === 'sablewood'), 'category filtering is respected');
});

test('search_rules merges semantic catalog hits with keyword matches', async () => {
  const embedder = new FakeEmbedder();
  await ensureCatalogEmbeddings(embedder);
  const db = openCampaignDatabase(':memory:');
  const campaigns = new CampaignService(db);
  const user = await campaigns.register('rag-rules', 'a strong temporary test password');
  const campaign = campaigns.createCampaign(user.id, 'Rules', '', { systemId: 'daggerheart', rulesetId: 'core', gmController: 'ai' });
  const at = new Date().toISOString();
  db.prepare('INSERT INTO ai_turns(id,campaign_id,user_id,request_id,status,error,steps,cost,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('turn-rules', campaign, user.id, 'req-rules', 'running', '', 0, 0, at, at);
  try {
    const actions = new GmActions(db, campaigns);
    const ctx = { campaign, owner: user.id, turn: 'turn-rules', callId: 'rules', assertActive: () => {}, publish: () => {}, publishRoll: () => {} };
    const queryVector = (await embedder.embed(['forest']))[0]!;
    const found = actions.execute('search_rules', { category: 'environments', query: 'zzzznotaword' }, { ...ctx, queryVector }) as { id: string }[];
    assert.ok(found.length > 0, 'semantic hits fill in when the words match nothing');
  } finally {
    db.close();
  }
});

test('a canon_write in one turn is semantically retrievable in the next turn after flush', async () => {
  const embedder = new FakeEmbedder();
  const s = await store(embedder);
  const at = new Date().toISOString();
  try {
    s.db.prepare('INSERT INTO ai_turns(id,campaign_id,user_id,request_id,status,error,steps,cost,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('turn-1', s.campaign, s.user.id, 'req-1', 'running', '', 0, 0, at, at);
    const actions = new GmActions(s.db, new CampaignService(s.db), s.index);
    const ctx = { campaign: s.campaign, owner: s.user.id, turn: 'turn-1', callId: 'write', assertActive: () => {}, publish: () => {}, publishRoll: () => {} };
    const written = actions.execute('canon_write', { kind: 'person', title: 'The Publican', body: 'He keeps the inn.' }, ctx) as { id: string };
    await s.index.flush();

    const search = { ...ctx, callId: 'read', queryVector: await s.index.embedQuery('innkeeper') };
    const found = actions.execute('canon_search', { query: 'innkeeper' }, search) as { id: string }[];
    assert.deepEqual(found.map(entry => entry.id), [written.id], 'next turn finds the synonym semantically');
  } finally {
    s.close();
  }
});

test('cosine and normalization are stable', () => {
  const a = normalizeVector(Float32Array.from([3, 4]));
  assert.ok(Math.abs(cosine(a, normalizeVector(Float32Array.from([6, 8]))) - 1) < 1e-6);
  assert.equal(cosine(Float32Array.from([0, 0]), a), 0);
});
