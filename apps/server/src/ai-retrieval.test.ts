import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { AiCanon } from './ai/canon';
import { AiChats } from './ai/chats';
import { AiJournal } from './ai/journal';
import { fitMemory, limitsFor, snippetCharsFor, type MemoryPart } from './ai/memory';
import { tokenize } from './ai/retrieval';
import { act, completion, currentTurn, finished, fixture, runTurn, seedHistory, summaryReply, type Captured, type Fixture } from './ai-test-kit';

/** A stand-in shared by the direct storage tests: one campaign with canon, journal and chats. */
async function store() {
  const db = openCampaignDatabase(':memory:');
  const campaigns = new CampaignService(db);
  const user = await campaigns.register('retrieval-gm', 'a strong temporary test password');
  const campaign = campaigns.createCampaign(user.id, 'Retrieval', '', { systemId: 'daggerheart', rulesetId: 'core', gmController: 'ai' });
  return { db, campaign, canon: new AiCanon(db), journal: new AiJournal(db), chats: new AiChats(db), close: () => db.close() };
}

/** The dynamic memory blocks of a GM request, without the static prompt and the per-turn snapshot. */
function memoryBlocks(body: any): string[] {
  const messages = body.messages as { role: string; content: string | null }[];
  return messages
    .slice(1)
    .filter(item => item.role === 'system' && !(item.content ?? '').startsWith('Current table snapshot'))
    .map(item => item.content ?? '');
}

function lastTurnRequest(f: Fixture): Captured {
  const request = f.requests.filter(item => item.tools).at(-1);
  if (!request) throw new Error('no turn request was sent');
  return request;
}

test('the tokenizer strips accents and possessives and folds plurals', () => {
  assert.deepEqual(tokenize("The Miller's unpaid debts"), ['miller', 'unpaid', 'debt']);
  assert.deepEqual(tokenize('Café, cafés and the café’s menu'), ['cafe', 'cafe', 'cafe', 'menu']);
  assert.deepEqual(tokenize('the and of'), [], 'stopwords are dropped');
});

test('canon search ranks multi-term, possessive, plural and accent matches, with titles above bodies', async () => {
  const s = await store();
  try {
    const debt = s.canon.upsert(s.campaign, { kind: 'promise', title: "The Miller's Unpaid Debt", body: 'The miller never paid the widow.', visibility: 'shared' });
    const bodyOnly = s.canon.upsert(s.campaign, { kind: 'fact', title: 'Chapel gossip', body: 'The miller owes a debt to the chapel by the harbor.', visibility: 'shared' });
    const rumor = s.canon.upsert(s.campaign, { kind: 'rumor', title: 'Harbor rumor', body: 'Sailors whisper about a debt and a miller.', visibility: 'shared' });
    const cafe = s.canon.upsert(s.campaign, { kind: 'location', title: 'Café Noir', body: 'A quiet café near the docks.' });

    const found = s.canon.search(s.campaign, 'miller debt', 10).map(entry => entry.id);
    assert.equal(found[0], debt.id, 'the title match ranks first');
    assert.ok(found.includes(bodyOnly.id), 'a body match is still found');
    assert.ok(found.includes(rumor.id), 'a partial body match is still found');

    assert.ok(s.canon.search(s.campaign, "miller's", 10).some(entry => entry.id === debt.id), 'a possessive query matches the plain word');
    assert.ok(s.canon.search(s.campaign, 'debts', 10).some(entry => entry.id === debt.id), 'a plural query matches the singular');
    assert.equal(s.canon.search(s.campaign, 'cafe', 10)[0]?.id, cafe.id, 'accents do not hide a match');

    const harbor = s.canon.search(s.campaign, 'harbor', 10).map(entry => entry.id);
    assert.ok(harbor.indexOf(rumor.id) < harbor.indexOf(bodyOnly.id), 'the title match outranks a body match');

    const empty = s.canon.search(s.campaign, '   ', 2).map(entry => entry.id);
    assert.deepEqual(empty, [cafe.id, rumor.id], 'an empty query lists the newest entries first');
  } finally {
    s.close();
  }
});

test('canon search keeps visibility, archived handling and kind filters', async () => {
  const s = await store();
  try {
    const shared = s.canon.upsert(s.campaign, { kind: 'fact', title: 'Lantern shared', body: 'The lantern is on the pier.', visibility: 'shared' });
    const hidden = s.canon.upsert(s.campaign, { kind: 'fact', title: 'Lantern hidden', body: 'The lantern hides a spy.', visibility: 'gm' });
    const secret = s.canon.upsert(s.campaign, { kind: 'secret', title: 'Lantern secret', body: 'The lantern is a signal.', visibility: 'shared' });
    const promise = s.canon.upsert(s.campaign, { kind: 'promise', title: 'Lantern promise', body: 'Ash will relight it.', visibility: 'shared' });

    assert.deepEqual(s.canon.search(s.campaign, 'lantern', 10, undefined, false, { gm: false }).map(entry => entry.id).sort(), [shared.id, promise.id].sort(), 'a shared context sees shared, non-secret entries only');
    assert.equal(s.canon.search(s.campaign, 'lantern', 10).length, 4, 'the GM sees every entry');
    assert.deepEqual(s.canon.search(s.campaign, 'lantern', 10, ['promise']).map(entry => entry.id), [promise.id], 'the kinds filter still applies');

    assert.ok(s.canon.archive(s.campaign, shared.id));
    assert.ok(!s.canon.search(s.campaign, 'lantern', 10).some(entry => entry.id === shared.id), 'archived entries are hidden by default');
    assert.ok(s.canon.search(s.campaign, 'lantern', 10, undefined, true).some(entry => entry.id === shared.id), 'archived entries are available on request');
    assert.ok(!s.canon.search(s.campaign, 'hidden spy', 10, undefined, false, { gm: false }).some(entry => entry.id === hidden.id));
  } finally {
    s.close();
  }
});

test('journal search spans sessions, labels every hit and down-weights engine events', async () => {
  const s = await store();
  try {
    const first = s.chats.create(s.campaign, 'Session One');
    const second = s.chats.create(s.campaign, 'Session Two');
    const note = s.journal.insert(s.campaign, { chat: first, turn: null, kind: 'note', title: 'The miller debt', body: 'The miller owes the chapel.', visibility: 'shared', author: 'gm' });
    const event = s.journal.insert(s.campaign, { chat: second, turn: null, kind: 'event', title: 'The miller debt', body: 'The miller owes the chapel.', visibility: 'shared', author: 'engine' });
    const hidden = s.journal.insert(s.campaign, { chat: second, turn: null, kind: 'note', title: 'The miller secret', body: 'The miller is a spy.', visibility: 'gm', author: 'gm' });

    const hits = s.journal.search(s.campaign, true, 'miller debt', 10);
    const noteIndex = hits.findIndex(entry => entry.id === note);
    const eventIndex = hits.findIndex(entry => entry.id === event);
    assert.ok(noteIndex >= 0 && eventIndex >= 0, 'both the note and the engine event are findable');
    assert.ok(noteIndex < eventIndex, 'the note outranks the event with the same words');
    assert.equal(hits.find(entry => entry.id === note)?.chat, 'Session One', 'the hit carries its session label');
    assert.match(hits.find(entry => entry.id === note)!.at, /^\d{4}-\d{2}-\d{2}/, 'the hit carries its date');
    assert.ok(!s.journal.search(s.campaign, false, 'miller debt', 10).some(entry => entry.id === hidden), 'a non-GM search never sees GM-only notes');
    assert.ok(s.journal.search(s.campaign, true, 'spy', 10).some(entry => entry.id === hidden), 'a unique event or note term still finds a hidden entry for the GM');

    const page = s.journal.list(s.campaign, true, { cursor: null, kind: 'all', query: 'miller chapel' });
    assert.ok(page.entries.some(entry => entry.id === note), 'the paginated list matches any query term');
  } finally {
    s.close();
  }
});

test('memory limits scale with the context window while Lean stays small', () => {
  const balanced = limitsFor('balanced', 0);
  const largeBalanced = limitsFor('balanced', 1_000_000);
  assert.ok(largeBalanced.memoryChars > balanced.memoryChars);
  assert.ok(largeBalanced.chapters > balanced.chapters);
  assert.ok(largeBalanced.canonChars > balanced.canonChars);
  assert.ok(limitsFor('rich', 1_000_000).stateChars > limitsFor('rich', 0).stateChars, 'Rich scales too');
  assert.deepEqual(limitsFor('lean', 1_000_000), limitsFor('lean', 0), 'Lean keeps the small caps on every model');
  assert.equal(limitsFor('maximum', 0).chapters, 12, 'Maximum keeps its original caps when the window is unknown');
  assert.ok(limitsFor('maximum', 1_000_000).chapters > 12, 'Maximum grows still further');
  assert.equal(snippetCharsFor(0), 600);
  assert.equal(snippetCharsFor(1_000_000), 1500);
});

test('fitMemory drops proactive recall before it shortens canon or secrets', () => {
  const parts: MemoryPart[] = [
    { kind: 'canon', text: 'C'.repeat(600) },
    { kind: 'recall', text: 'R'.repeat(800) },
    { kind: 'secrets', text: 'S'.repeat(600) },
  ];
  const kept = fitMemory(parts, 1500);
  assert.ok(!kept.some(part => part.kind === 'recall'), 'recall is dropped whole');
  assert.ok(kept.some(part => part.kind === 'canon'));
  assert.ok(kept.some(part => part.kind === 'secrets'));
});

test('proactive recall adds a compact relevant-memory block with ids, and stays silent when nothing matches', async () => {
  const f = await fixture(request => request.tools ? completion('The miller waits. What do you do?') : summaryReply());
  try {
    const { ai, user, campaign } = f;
    const chat = ai.session(user.id, campaign).activeChatId!;
    const entry = ai.actions.canon.upsert(campaign, { kind: 'person', title: "The Miller's Debt", body: 'The miller owes the chapel a debt and fears the wardens.', visibility: 'shared' });
    ai.actions.journal.insert(campaign, { chat, turn: null, kind: 'note', title: 'Debt at the mill', body: 'The miller promised to pay by harvest.', visibility: 'shared', author: 'gm' });
    await runTurn(f, 'I ask the miller about the debt.');
    const recall = memoryBlocks(lastTurnRequest(f).body).find(block => block.startsWith('Relevant memory'));
    assert.ok(recall, 'the relevant-memory block is present');
    assert.ok(recall!.includes(entry.id), 'the canon hit carries its id');
    assert.ok(recall!.includes('Debt at the mill'), 'the journal hit is present');
    assert.match(recall!, /Session 1, \d{4}-\d{2}-\d{2}/, 'the journal hit carries its session and date');
  } finally {
    await f.close();
  }
});

test('proactive recall is absent when the turn matches nothing', async () => {
  const f = await fixture(request => request.tools ? completion('Nothing stirs. What do you do?') : summaryReply());
  try {
    await runTurn(f, 'Zyx qwerty plugh.');
    assert.ok(!memoryBlocks(lastTurnRequest(f).body).some(block => block.startsWith('Relevant memory')), 'nothing was injected');
  } finally {
    await f.close();
  }
});

test('search_journal reaches an entry from another session and labels it', async () => {
  const f = await fixture(request => request.tools ? completion('Noted. What do you do?') : summaryReply());
  try {
    const { ai, user, campaign } = f;
    const first = ai.session(user.id, campaign).activeChatId!;
    ai.actions.journal.insert(campaign, { chat: first, turn: null, kind: 'note', title: 'Harbor promise', body: 'The miller promised to pay the chapel.', visibility: 'shared', author: 'gm' });
    const second = ai.createChat(user.id, campaign, { title: 'Session B' }).chat.id;
    await runTurn(f, 'A new session starts.', second);
    const found = act(f, currentTurn(f), 'search_journal', { query: 'miller promise' }) as { title: string; chat: string; at: string }[];
    const hit = found.find(entry => entry.title === 'Harbor promise');
    assert.ok(hit, 'the note from the first session is found');
    assert.equal(hit!.chat, 'Session 1');
    assert.match(hit!.at, /^\d{4}-\d{2}-\d{2}/);
  } finally {
    await f.close();
  }
});

test('a large context window keeps a longer canon list and longer journal snippets', async () => {
  const f = await fixture(request => request.tools ? completion('The archive is open. What do you do?') : summaryReply());
  try {
    const { ai, user, campaign, db } = f;
    db.prepare('UPDATE ai_credentials SET context_window = 1000000 WHERE user_id = ?').run(user.id);
    for (let index = 0; index < 40; index++) {
      ai.actions.canon.upsert(campaign, { kind: 'fact', title: 'Record ' + String(index) + ' of the ' + 'long tide ledger '.repeat(4) + String(index), body: 'Record ' + String(index), visibility: 'shared' });
    }
    ai.addJournal(user.id, campaign, { title: 'The long oath', body: 'The oath of the tide wardens '.repeat(100), shared: true });
    await runTurn(f, 'Begin.');
    const canon = memoryBlocks(lastTurnRequest(f).body).find(block => block.startsWith('Canon in this campaign'));
    assert.ok(canon, 'the canon block is present');
    assert.ok(canon!.length > 1500, 'the canon title list grows past the fixed cap');
    assert.ok(canon!.length <= limitsFor('balanced', 1_000_000).canonChars);
    const found = act(f, currentTurn(f), 'search_journal', { query: 'long oath' }) as { body: string }[];
    assert.equal(found[0]?.body.length, limitsFor('balanced', 1_000_000).snippetChars, 'the snippet grows with the context window');
    assert.ok(found[0]!.body.length > 600, 'the snippet is longer than the default');
  } finally {
    await f.close();
  }
});

test('a new session carries the previous working summary into the opening recap', async () => {
  const f = await fixture(request => request.tools ? completion('The keeper waits. What do you do?') : summaryReply());
  try {
    const { ai, user, campaign } = f;
    const first = ai.session(user.id, campaign).activeChatId!;
    ai.actions.chats.setSummary(first, 'WORKING_SUMMARY_FROM_SESSION_ONE', 0, new Date().toISOString());
    ai.addJournal(user.id, campaign, { title: 'The lighthouse', body: 'The beacon failed on the third night.', shared: true });
    const second = ai.createChat(user.id, campaign, { title: 'Session 2' }).chat.id;
    ai.begin(user.id, campaign, { chatId: second });
    await finished(ai, user.id, campaign);
    const blocks = memoryBlocks(lastTurnRequest(f).body);
    assert.ok(blocks.some(block => block.startsWith('Summary of the previous session') && block.includes('WORKING_SUMMARY_FROM_SESSION_ONE')), 'the previous working summary reaches the recap');
  } finally {
    await f.close();
  }
});

test('compaction promotes durable facts to canon, capped and deduped by title', async () => {
  let summaries = 0;
  const f = await fixture(request => {
    if (request.tools) return completion('Noted. What do you do?');
    summaries++;
    const canon = summaries === 1
      ? [
        { kind: 'person', title: "The Miller's Debt", body: 'The miller owes the chapel a debt.' },
        { kind: 'person', title: "The Miller's Debt", body: 'A duplicate in the same reply.' },
        { kind: 'poem', title: 'Invalid kind', body: 'This entry is skipped.' },
        { kind: 'location', title: 'The Mill', body: 'A mill by the harbor.' },
      ]
      : [{ kind: 'person', title: "The Miller's Debt", body: 'Already promoted.' }];
    return completion(JSON.stringify({ chapter: 'A chapter happened.', working: 'The party stands at the mill.', digest: 'The miller owes the chapel.', canon }));
  });
  try {
    const { ai, user, campaign } = f;
    const chat = ai.session(user.id, campaign).activeChatId!;
    seedHistory(f, chat, 20, 1500);
    ai.compactChat(user.id, campaign, { chatId: chat });
    await finished(ai, user.id, campaign);
    const entries = ai.actions.canon.search(campaign, '', 50, undefined, true);
    assert.deepEqual(entries.map(entry => entry.title).sort(), ['The Mill', "The Miller's Debt"]);
    assert.ok(entries.every(entry => entry.source === 'compaction'), 'the source records the promotion');
    assert.ok(entries.every(entry => entry.visibility === 'gm'), 'promoted facts stay GM-only');

    seedHistory(f, chat, 20, 1500, 20);
    ai.compactChat(user.id, campaign, { chatId: chat });
    await finished(ai, user.id, campaign);
    assert.equal(ai.actions.canon.search(campaign, '', 50, undefined, true).length, 2, 'a second compaction does not duplicate a known title');
  } finally {
    await f.close();
  }
});
