import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CURRENT_VERSION, migrateCampaignDatabase, openCampaignDatabase } from './campaign-db';
import { fitMemory, limitsFor, type MemoryPart } from './ai/memory';
import {
  act, completion, currentTurn, finished, fixture, httpApp, ORIGIN, runTurn, schemaFiveDatabase, summaryReply, type Fixture,
} from './ai-test-kit';

/** The fake model never calls tools; tests run the front tools directly against an open turn. */
const handler = (request: { tools: boolean }) => request.tools ? completion('The tide turns. What do you do?') : summaryReply();

/** A complete, valid front_create payload. */
function validFront(name = 'The Salt Syndicate'): Record<string, unknown> {
  return {
    name,
    kind: 'faction',
    goal: 'Own the salt trade',
    stakes: 'Who rules the harbor',
    clockSize: 6,
    portents: ['A warehouse burns', 'A rival disappears', 'The guild votes'],
    doom: 'The syndicate owns every dock',
    notes: 'They meet under the chapel.',
  };
}

/** The dynamic memory blocks of a GM request, without the static prompt and the per-turn snapshot. */
function memoryBlocks(body: any): string[] {
  const messages = body.messages as { role: string; content: string | null }[];
  return messages
    .slice(1)
    .filter(item => item.role === 'system' && !(item.content ?? '').startsWith('Current table snapshot'))
    .map(item => item.content ?? '');
}

function lastTurnRequest(f: Fixture): { body: any } {
  const request = f.requests.filter(item => item.tools).at(-1);
  if (!request) throw new Error('no turn request was sent');
  return request;
}

test('front_create, front_update, front_advance and front_list tick, cross portents and resolve', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    const created = act(f, turn, 'front_create', validFront()) as Record<string, any>;
    assert.equal(created.status, 'active');
    assert.equal(created.kind, 'faction');
    assert.equal(created.goal, 'Own the salt trade');
    assert.deepEqual(created.clock, { current: 0, size: 6 });
    assert.deepEqual(created.portents.map((portent: any) => portent.done), [false, false, false]);
    assert.equal(created.doom, 'The syndicate owns every dock');

    // Thresholds spread over a 6-clock with three portents are 2, 4 and 6.
    const first = act(f, turn, 'front_advance', { id: created.id, amount: 2, reason: 'The party ignored the docks' }) as Record<string, any>;
    assert.deepEqual(first.clock, { current: 2, size: 6 });
    assert.deepEqual(first.crossed.map((item: any) => item.index), [0]);
    assert.equal(first.clockFilled, false);
    assert.equal(first.doom, null);
    assert.equal(first.nextPortent.text, 'A rival disappears');
    assert.equal(first.reason, 'The party ignored the docks');

    const second = act(f, turn, 'front_advance', { id: created.id, amount: 2 }) as Record<string, any>;
    assert.deepEqual(second.crossed.map((item: any) => item.index), [1]);
    assert.equal(second.clock.current, 4);

    const third = act(f, turn, 'front_advance', { id: created.id, amount: 2 }) as Record<string, any>;
    assert.deepEqual(third.crossed.map((item: any) => item.index), [2]);
    assert.equal(third.clockFilled, true);
    assert.equal(third.doom, 'The syndicate owns every dock');
    assert.equal(third.nextPortent, null, 'every portent has happened');

    const listed = act(f, turn, 'front_list', {}) as Record<string, any>[];
    const found = listed.find(item => item.id === created.id)!;
    assert.deepEqual(found.clock, { current: 6, size: 6 });
    assert.ok(found.portents.every((portent: any) => portent.done), 'every crossed portent is marked done');
    assert.equal(found.doom, 'The syndicate owns every dock');

    assert.throws(() => act(f, turn, 'front_advance', { id: created.id, amount: 1 }), /clock is already full/);

    const updated = act(f, turn, 'front_update', { id: created.id, markPortent: 0, goal: 'Own the salt and the tolls', resolve: true }) as Record<string, any>;
    assert.equal(updated.status, 'resolved');
    assert.equal(updated.goal, 'Own the salt and the tolls');
    assert.equal(updated.portents[0].done, true);
    assert.equal(updated.notes, 'They meet under the chapel.', 'untouched fields survive an update');
    assert.throws(() => act(f, turn, 'front_advance', { id: created.id, amount: 1 }), /already resolved/);
    assert.throws(() => act(f, turn, 'front_update', { id: 'no-such-front', goal: 'x' }), /Invalid front/);
    assert.throws(() => act(f, turn, 'front_advance', { id: 'no-such-front', amount: 1 }), /Invalid front/);

    const reopened = act(f, turn, 'front_update', { id: created.id, resolve: false }) as Record<string, any>;
    assert.equal(reopened.status, 'active', 'resolve false reopens a front');
  } finally {
    await f.close();
  }
});

test('front_create rejects unknown kinds, bad clock sizes, out-of-range values and too many portents', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    let seq = 0;
    const bad = (overrides: Record<string, unknown>, message: RegExp) => assert.throws(
      () => act(f, turn, 'front_create', { ...validFront('Validation ' + String(++seq)), ...overrides }), message,
    );
    bad({ kind: 'dragon' }, /Invalid front kind/);
    bad({ clockSize: 5 }, /Invalid front clockSize/);
    bad({ clockSize: 14 }, /Invalid front clockSize/);
    bad({ name: '' }, /name: text is required/);
    bad({ goal: 'x'.repeat(401) }, /at most 400 characters/);
    bad({ portents: Array.from({ length: 13 }, (_, index) => 'Portent ' + String(index)) }, /at most 12 items/);
    bad({ portents: 'not a list' }, /a list is required/);
    bad({ portents: [{ text: '' }] }, /portents\[0\]\.text: text is required/);

    act(f, turn, 'front_create', validFront('Twin'));
    assert.throws(() => act(f, turn, 'front_create', validFront('twin')), /already has that name/, 'an active duplicate is refused');

    const front = act(f, turn, 'front_create', validFront('Amounts')) as Record<string, any>;
    assert.throws(() => act(f, turn, 'front_advance', { id: front.id, amount: 0 }), /amount: expected an integer/);
    assert.throws(() => act(f, turn, 'front_advance', { id: front.id, amount: 13 }), /amount: expected an integer/);
    assert.throws(() => act(f, turn, 'front_update', { id: front.id, markPortent: 9 }), /markPortent/);
  } finally {
    await f.close();
  }
});

test('the front table and the world-time column migrate from schema 5 and from the previous schema version', () => {
  const old = schemaFiveDatabase();
  try {
    migrateCampaignDatabase(old);
    assert.equal(old.pragma('user_version', { simple: true }), CURRENT_VERSION);
    const tables = (old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name);
    assert.ok(tables.includes('ai_fronts'), 'schema 5 gains the front table');
    const columns = (old.prepare('PRAGMA table_info(ai_chats)').all() as { name: string }[]).map(row => row.name);
    assert.ok(columns.includes('world_time'), 'schema 5 gains the chat world-time column');
  } finally {
    old.close();
  }
  const db = openCampaignDatabase(':memory:');
  try {
    db.exec('DROP TABLE ai_fronts');
    db.pragma('user_version = 10');
    migrateCampaignDatabase(db);
    assert.equal(db.pragma('user_version', { simple: true }), CURRENT_VERSION);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ai_fronts_campaign'").all() as { name: string }[]).map(row => row.name);
    assert.deepEqual(indexes, ['ai_fronts_campaign'], 'a version 10 database gains the table and its campaign index');
  } finally {
    db.close();
  }
});

test('active fronts and the world turn reach the GM, and the front list is dropped before canon', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    const front = act(f, turn, 'front_create', validFront()) as Record<string, any>;
    await runTurn(f, 'We wait at the docks.');
    const blocks = memoryBlocks(lastTurnRequest(f).body);
    const list = blocks.find(block => block.startsWith('Fronts (GM only'));
    assert.ok(list, 'the front list is in the memory');
    assert.ok(list!.includes('The Salt Syndicate (faction) — clock 0/6 — next portent: A warehouse burns (id ' + front.id + ')'), 'one line per active front');
    assert.equal(blocks.some(block => block.startsWith('World turn')), false, 'an ordinary turn has no world turn');

    // A time jump makes the next turn a world turn. The first change only records the baseline.
    act(f, turn, 'update_state', { timeOfDay: 'dusk' });
    await runTurn(f, 'Night falls.');
    act(f, currentTurn(f), 'update_state', { timeOfDay: 'dawn' });
    await runTurn(f, 'Dawn comes.');
    const after = memoryBlocks(lastTurnRequest(f).body);
    const world = after.find(block => block.startsWith('World turn (GM only)'));
    assert.ok(world, 'a time jump adds the world turn');
    assert.ok(world!.includes('The Salt Syndicate'), 'the world turn lists the active fronts');
    assert.ok(world!.includes('front_advance'), 'the world turn asks the GM to consider advancing one');

    // A new session also opens with a world turn.
    const { chat } = f.ai.createChat(f.user.id, f.campaign, { title: 'Session 2' });
    f.ai.begin(f.user.id, f.campaign, { chatId: chat.id });
    await finished(f.ai, f.user.id, f.campaign);
    const opening = memoryBlocks(lastTurnRequest(f).body);
    assert.ok(opening.some(block => block.startsWith('World turn (GM only)')), 'a new session opens with a world turn');

    const parts: MemoryPart[] = [
      { kind: 'setup', text: 'S'.repeat(1000) },
      { kind: 'fronts', text: 'F'.repeat(2000) },
      { kind: 'canon', text: 'C'.repeat(1000) },
      { kind: 'secrets', text: 'K'.repeat(6000) },
      { kind: 'state', text: 'T'.repeat(6000) },
      { kind: 'summary', text: 'U'.repeat(2000) },
    ];
    const kept = fitMemory(parts, 17000);
    assert.equal(kept.some(part => part.kind === 'fronts'), false, 'the front list is dropped whole');
    assert.equal(kept.find(part => part.kind === 'canon')?.text, 'C'.repeat(1000), 'canon is untouched while the front list can go');
    assert.ok(limitsFor('balanced', 1_000_000).frontChars > limitsFor('balanced', 0).frontChars, 'the room scales with the window');
  } finally {
    await f.close();
  }
});

test('front tools never expose front contents through the ledger, journal, checkpoint, documents or routes', async () => {
  const f = await fixture(handler);
  const marker = 'ZZFRONT-SECRET-MARKER-7a1d';
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    const front = act(f, turn, 'front_create', {
      ...validFront('Front ' + marker), goal: 'Goal ' + marker, stakes: 'Stakes ' + marker,
      portents: ['Portent ' + marker], doom: 'Doom ' + marker, notes: 'Notes ' + marker,
    }) as Record<string, any>;
    act(f, turn, 'front_list', {});
    act(f, turn, 'front_advance', { id: front.id, amount: 6, reason: 'ignored ' + marker });
    act(f, turn, 'front_update', { id: front.id, notes: 'updated ' + marker });

    // The owner-visible ledger stores only a neutral result and a neutral label.
    const rows = f.db.prepare("SELECT tool, label, result FROM ai_actions WHERE campaign_id = ? AND tool LIKE 'front_%'").all(f.campaign) as { tool: string; label: string; result: string }[];
    assert.equal(rows.length, 4, 'every front tool was recorded');
    for (const row of rows) {
      const stored = JSON.parse(row.result) as Record<string, unknown>;
      assert.deepEqual(Object.keys(stored).filter(key => key !== 'frontId'), ['done'], row.tool + ' stores a neutral result');
      if (stored.frontId !== undefined) assert.equal(stored.frontId, front.id, 'only the opaque id is kept');
      assert.ok(!row.result.includes(marker));
      assert.ok(!/Syndicate|secret|doom|salt/i.test(row.label), 'the label is neutral');
    }
    assert.equal(f.ai.session(f.user.id, f.campaign).actions.filter(action => action.tool.startsWith('front_')).length, 4);

    // A retried read re-runs and still gives the model the fronts; a replayed write returns the id.
    const ctx = { campaign: f.campaign, owner: f.user.id, turn, callId: 'retry-list', assertActive: () => {}, publish: () => {}, publishRoll: () => {} };
    const firstList = f.ai.actions.execute('front_list', {}, ctx) as Record<string, any>[];
    const secondList = f.ai.actions.execute('front_list', {}, ctx) as Record<string, any>[];
    assert.deepEqual(secondList, firstList, 'the retried list runs again');
    assert.ok(JSON.stringify(secondList).includes(marker), 'the retried list still carries front content');
    const writeCtx = { ...ctx, callId: 'retry-create' };
    const created = f.ai.actions.execute('front_create', validFront('Retry Front'), writeCtx) as Record<string, any>;
    const replay = f.ai.actions.execute('front_create', validFront('Retry Front'), writeCtx) as Record<string, any>;
    assert.deepEqual(replay, { done: true, frontId: created.id });
    assert.ok(!JSON.stringify(f.ai.session(f.user.id, f.campaign).actions).includes(marker), 'the session payload carries no marker');

    // No journal event and no transcript message mentions the front.
    const journal = f.db.prepare('SELECT title, body FROM ai_journal WHERE campaign_id = ?').all(f.campaign) as { title: string; body: string }[];
    assert.ok(!JSON.stringify(journal).includes(marker), 'the journal never receives front content');
    assert.ok(!journal.some(entry => entry.title.includes(marker)), 'no event names the front');
    const messages = f.db.prepare('SELECT text FROM ai_messages WHERE campaign_id = ?').all(f.campaign) as { text: string }[];
    assert.ok(!JSON.stringify(messages).includes(marker), 'no transcript message carries front content');

    // Synced documents, rolls and canon stay clean.
    const docs = f.db.prepare('SELECT ns, id, value FROM campaign_docs WHERE campaign_id = ?').all(f.campaign) as { ns: string; id: string; value: string }[];
    assert.ok(!JSON.stringify(docs).includes(marker), 'no campaign document carries front content');
    const rolls = f.db.prepare('SELECT payload FROM campaign_rolls WHERE campaign_id = ?').all(f.campaign) as { payload: string }[];
    assert.ok(!JSON.stringify(rolls).includes(marker), 'no roll payload carries front content');
    const canon = f.db.prepare('SELECT title, body FROM ai_canon WHERE campaign_id = ?').all(f.campaign) as { title: string; body: string }[];
    assert.ok(!JSON.stringify(canon).includes(marker), 'canon never receives front content');

    // A private checkpoint may hold the full result for retry, but no route returns it.
    f.db.prepare('UPDATE ai_turns SET checkpoint = ? WHERE id = ?').run(JSON.stringify([{ role: 'tool', tool_call_id: 'x', content: marker }]), turn);
    const { app, cookie } = await httpApp(f);
    const base = '/api/campaigns/' + f.campaign + '/ai';
    const urls = [
      base,
      base + '/journal',
      base + '/journal?q=' + encodeURIComponent(marker),
      base + '/options',
      '/api/campaigns/' + f.campaign + '/notes',
      '/api/campaigns/' + f.campaign + '/members',
      '/api/campaigns',
    ];
    try {
      for (const url of urls) {
        const response = await app.inject({ method: 'GET', url, headers: { cookie, origin: ORIGIN } });
        assert.equal(response.statusCode, 200, url + ' answered ' + String(response.statusCode));
        assert.ok(!response.body.includes(marker), url + ' leaks the marker');
      }
    } finally {
      await app.close();
    }
  } finally {
    await f.close();
  }
});

test('deleting a campaign removes its front rows through the foreign key', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    act(f, currentTurn(f), 'front_create', validFront());
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM ai_fronts WHERE campaign_id = ?').get(f.campaign) as { n: number }).n, 1);
    f.db.prepare('DELETE FROM campaigns WHERE id = ?').run(f.campaign);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM ai_fronts WHERE campaign_id = ?').get(f.campaign) as { n: number }).n, 0, 'the rows cascade away');
  } finally {
    await f.close();
  }
});
