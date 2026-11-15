import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CURRENT_VERSION, migrateCampaignDatabase, openCampaignDatabase } from './campaign-db';
import { clueAgeLabel, CLUE_STALE_MS, isStaleClue, renderClueList } from './ai/clues';
import { fitMemory, limitsFor, type MemoryPart } from './ai/memory';
import {
  act, completion, currentTurn, fixture, httpApp, ORIGIN, runTurn, schemaFiveDatabase, summaryReply, type Fixture,
} from './ai-test-kit';

/** The fake model never calls tools; tests run the clue tools directly against an open turn. */
const handler = (request: { tools: boolean }) => request.tools ? completion('The tide turns. What do you do?') : summaryReply();

/** A complete, valid clue_plant payload. */
function validClue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'clue',
    shown: 'A cracked bell tolls once at dusk, though the tower is empty.',
    truth: 'The dead keeper rings it to warn of the drowned tide.',
    ...overrides,
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

test('clue_plant, clue_update and clue_list validate, edit and filter by status', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    const chat = f.ai.actions.chats.resolveActive(f.campaign, null);
    const first = act(f, turn, 'clue_plant', validClue()) as Record<string, any>;
    assert.equal(first.kind, 'clue');
    assert.equal(first.status, 'planted');
    assert.equal(first.shown, 'A cracked bell tolls once at dusk, though the tower is empty.');
    assert.equal(first.truth, 'The dead keeper rings it to warn of the drowned tide.');
    assert.equal(first.plantedChat, chat, 'the planted session is recorded');
    assert.ok(!Number.isNaN(Date.parse(first.plantedAt)), 'the planted time is recorded');
    assert.equal(first.payoff, '');
    assert.equal(first.threadId, '');
    assert.equal(first.npcId, '');

    const second = act(f, turn, 'clue_plant', validClue({
      kind: 'foreshadowing', shown: 'Salt creeps up the chapel wall overnight.',
      truth: 'The drowned tide is rising under the town.', threadId: 'thread-1', npcId: 'npc-1',
    })) as Record<string, any>;
    assert.equal(second.kind, 'foreshadowing');
    assert.equal(second.threadId, 'thread-1');
    assert.equal(second.npcId, 'npc-1');

    const listed = act(f, turn, 'clue_list', {}) as Record<string, any>[];
    assert.equal(listed.length, 2, 'the whole ledger is listed');
    assert.deepEqual(listed.map(item => item.id), [first.id, second.id], 'oldest planted first');
    assert.ok(listed[0]!.truth.includes('dead keeper'), 'the model sees the hidden truth');

    const found = act(f, turn, 'clue_update', {
      id: first.id, status: 'found', payoff: 'The party heard the bell from the empty tower.',
      shown: 'A cracked bell tolls once at dusk.', threadId: '',
    }) as Record<string, any>;
    assert.equal(found.status, 'found');
    assert.equal(found.shown, 'A cracked bell tolls once at dusk.', 'the planted hint can be corrected');
    assert.equal(found.payoff, 'The party heard the bell from the empty tower.');
    assert.equal(found.threadId, '', 'a link can be cleared');
    assert.equal(found.truth, 'The dead keeper rings it to warn of the drowned tide.', 'untouched fields survive');

    const onlyFound = act(f, turn, 'clue_list', { status: 'found' }) as Record<string, any>[];
    assert.deepEqual(onlyFound.map(item => item.id), [first.id], 'status filters the ledger');
    assert.deepEqual(act(f, turn, 'clue_list', { status: 'paid-off' }), []);

    const paid = act(f, turn, 'clue_update', { id: second.id, status: 'paid-off', payoff: 'The tide broke through the chapel floor.' }) as Record<string, any>;
    assert.equal(paid.status, 'paid-off');
    const abandoned = act(f, turn, 'clue_update', { id: first.id, status: 'abandoned' }) as Record<string, any>;
    assert.equal(abandoned.status, 'abandoned');

    assert.throws(() => act(f, turn, 'clue_plant', validClue({ kind: 'riddle' })), /Invalid clue kind/);
    assert.throws(() => act(f, turn, 'clue_plant', validClue({ shown: '' })), /Invalid clue shown: text is required/);
    assert.throws(() => act(f, turn, 'clue_plant', validClue({ truth: 'x'.repeat(1001) })), /at most 1000 characters/);
    assert.throws(() => act(f, turn, 'clue_plant', validClue({ shown: 'x'.repeat(801) })), /at most 800 characters/);
    assert.throws(() => act(f, turn, 'clue_plant', validClue({ threadId: 'x'.repeat(121) })), /at most 120 characters/);
    assert.throws(() => act(f, turn, 'clue_list', { status: 'forgotten' }), /Invalid clue status/);
    assert.throws(() => act(f, turn, 'clue_update', { id: 'no-such-clue', status: 'found' }), /Invalid clue/);
    assert.throws(() => act(f, turn, 'clue_update', { status: 'found' }), /Invalid clue id/);
  } finally {
    await f.close();
  }
});

test('the open clue ledger reaches the GM, oldest first, and flags stale clues', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    const recent = act(f, turn, 'clue_plant', validClue({ shown: 'The bell tolls at dusk.', truth: 'The keeper is not dead.' })) as Record<string, any>;
    const old = act(f, turn, 'clue_plant', validClue({ kind: 'mystery', shown: 'Salt on the chapel floor.', truth: 'The town sits on a drowned nave.' })) as Record<string, any>;
    f.db.prepare('UPDATE ai_clues SET planted_at = ? WHERE id = ?').run(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), old.id);

    await runTurn(f, 'We climb the bell tower. What do we find?');
    const blocks = memoryBlocks(lastTurnRequest(f).body);
    const ledger = blocks.find(block => block.startsWith('Open clues (GM only'));
    assert.ok(ledger, 'the open clue ledger is in the memory');
    assert.ok(ledger!.includes('The bell tolls at dusk. → The keeper is not dead.'), 'a line carries the hint and its truth');
    assert.ok(ledger!.includes('Salt on the chapel floor. → The town sits on a drowned nave.'), 'the older clue is listed');
    assert.ok(ledger!.includes('STALE'), 'a clue planted long ago is flagged stale');
    assert.ok(ledger!.indexOf('Salt on the chapel floor.') < ledger!.indexOf('The bell tolls at dusk.'), 'oldest planted first');
    const recentLine = ledger!.split('\n').find(line => line.includes('The bell tolls at dusk.'))!;
    assert.ok(!recentLine.includes('STALE'), 'a fresh clue is not stale');
    assert.ok(recentLine.includes('just now'), 'the age is shown');
    assert.ok(ledger!.includes('(id ' + recent.id + ')'), 'the id is shown so clue_update can target it');

    // A paid-off clue leaves the open ledger.
    act(f, turn, 'clue_update', { id: recent.id, status: 'paid-off', payoff: 'The party rang it themselves.' });
    await runTurn(f, 'We ring the bell. What answers?');
    const after = memoryBlocks(lastTurnRequest(f).body).find(block => block.startsWith('Open clues (GM only'))!;
    assert.ok(!after.includes('The bell tolls at dusk.'), 'paid-off clues are not listed');
    assert.ok(after.includes('Salt on the chapel floor.'));

    // The block is dropped whole with the recall block before canon is shortened.
    const parts: MemoryPart[] = [
      { kind: 'setup', text: 'S'.repeat(1000) },
      { kind: 'clues', text: 'L'.repeat(2000) },
      { kind: 'canon', text: 'C'.repeat(1000) },
      { kind: 'secrets', text: 'K'.repeat(6000) },
      { kind: 'state', text: 'T'.repeat(6000) },
      { kind: 'summary', text: 'U'.repeat(2000) },
    ];
    const kept = fitMemory(parts, 17000);
    assert.equal(kept.some(part => part.kind === 'clues'), false, 'the clue ledger is dropped whole');
    assert.equal(kept.find(part => part.kind === 'canon')?.text, 'C'.repeat(1000), 'canon is untouched while the ledger can go');
    assert.ok(limitsFor('balanced', 1_000_000).clueChars > limitsFor('balanced', 0).clueChars, 'the room scales with the window');

    assert.ok(isStaleClue({ ...(old as any), plantedAt: new Date(Date.now() - CLUE_STALE_MS - 1000).toISOString() }));
    assert.equal(clueAgeLabel(new Date(Date.now() - 3 * 3_600_000).toISOString()).endsWith('h ago'), true, 'a short age reads in hours');
    assert.equal(renderClueList([], 1000), '', 'an empty ledger renders nothing');
  } finally {
    await f.close();
  }
});

test('the clue table migrates from schema 5 and from version 10', () => {
  const old = schemaFiveDatabase();
  try {
    migrateCampaignDatabase(old);
    assert.equal(old.pragma('user_version', { simple: true }), CURRENT_VERSION);
    const tables = (old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name);
    assert.ok(tables.includes('ai_clues'), 'schema 5 gains the clue ledger');
  } finally {
    old.close();
  }
  const db = openCampaignDatabase(':memory:');
  try {
    db.exec('DROP TABLE ai_clues');
    db.pragma('user_version = 10');
    migrateCampaignDatabase(db);
    assert.equal(db.pragma('user_version', { simple: true }), CURRENT_VERSION);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ai_clues_campaign'").all() as { name: string }[]).map(row => row.name);
    assert.deepEqual(indexes, ['ai_clues_campaign'], 'a version 10 database gains the table and its campaign index');
  } finally {
    db.close();
  }
});

test('clue tools never expose the hidden truth through the ledger, journal, checkpoint, documents or routes', async () => {
  const f = await fixture(handler);
  const marker = 'ZZCLUE-SECRET-MARKER-7a2e';
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    const clue = act(f, turn, 'clue_plant', validClue({
      shown: 'Shown ' + marker, truth: 'Truth ' + marker,
    })) as Record<string, any>;
    act(f, turn, 'clue_update', { id: clue.id, status: 'found', payoff: 'Payoff ' + marker });
    act(f, turn, 'clue_list', { status: 'found' });

    // The owner-visible ledger stores only a neutral result and a neutral label.
    const rows = f.db.prepare("SELECT tool, label, result FROM ai_actions WHERE campaign_id = ? AND tool LIKE 'clue_%'").all(f.campaign) as { tool: string; label: string; result: string }[];
    assert.equal(rows.length, 3, 'every clue tool was recorded');
    for (const row of rows) {
      const stored = JSON.parse(row.result) as Record<string, unknown>;
      assert.deepEqual(Object.keys(stored).filter(key => key !== 'clueId'), ['done'], row.tool + ' stores a neutral result');
      if (stored.clueId !== undefined) assert.equal(stored.clueId, clue.id, 'only the opaque id is kept');
      assert.ok(!row.result.includes(marker));
      assert.ok(!/bell|drowned|truth|shown/i.test(row.label), 'the label is neutral');
    }
    assert.equal(f.ai.session(f.user.id, f.campaign).actions.filter(action => action.tool.startsWith('clue_')).length, 3);

    // A retried turn replays the same call ID: clue_list returns the truth again instead of the
    // neutral ledger text, and a replayed plant returns only the opaque id without a second row.
    const ctx = { campaign: f.campaign, owner: f.user.id, turn, callId: 'retry-list', assertActive: () => {}, publish: () => {}, publishRoll: () => {} };
    f.ai.actions.execute('clue_list', { status: 'found' }, ctx);
    const reread = f.ai.actions.execute('clue_list', { status: 'found' }, ctx) as Record<string, any>[];
    assert.ok(JSON.stringify(reread).includes('Truth ' + marker), 'the retried list still gives the model the truth');
    const writeCtx = { ...ctx, callId: 'retry-plant' };
    const first = f.ai.actions.execute('clue_plant', validClue({ shown: 'Retry ' + marker, truth: 'Retry truth' }), writeCtx) as Record<string, any>;
    const replay = f.ai.actions.execute('clue_plant', validClue({ shown: 'Retry ' + marker, truth: 'Retry truth' }), writeCtx) as Record<string, any>;
    assert.deepEqual(replay, { done: true, clueId: first.id });
    const retryRows = f.db.prepare("SELECT COUNT(*) AS n FROM ai_actions WHERE campaign_id = ? AND call_id = 'retry-plant'").get(f.campaign) as { n: number };
    assert.equal(retryRows.n, 1, 'the replay writes no second ledger row');

    // No journal event and no transcript message carries clue content.
    const journal = f.db.prepare('SELECT title, body FROM ai_journal WHERE campaign_id = ?').all(f.campaign) as { title: string; body: string }[];
    assert.ok(!JSON.stringify(journal).includes(marker), 'the journal never receives clue content');
    const messages = f.db.prepare('SELECT text FROM ai_messages WHERE campaign_id = ?').all(f.campaign) as { text: string }[];
    assert.ok(!JSON.stringify(messages).includes(marker), 'no transcript message carries clue content');

    // Synced documents, rolls, canon and the session payload stay clean.
    const docs = f.db.prepare('SELECT ns, id, value FROM campaign_docs WHERE campaign_id = ?').all(f.campaign) as { ns: string; id: string; value: string }[];
    assert.ok(!JSON.stringify(docs).includes(marker), 'no campaign document carries clue content');
    const rolls = f.db.prepare('SELECT payload FROM campaign_rolls WHERE campaign_id = ?').all(f.campaign) as { payload: string }[];
    assert.ok(!JSON.stringify(rolls).includes(marker), 'no roll payload carries clue content');
    const canon = f.db.prepare('SELECT title, body FROM ai_canon WHERE campaign_id = ?').all(f.campaign) as { title: string; body: string }[];
    assert.ok(!JSON.stringify(canon).includes(marker), 'canon never receives clue content');
    assert.ok(!JSON.stringify(f.ai.session(f.user.id, f.campaign)).includes(marker), 'the session payload carries no marker');

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

test('deleting a campaign removes its clue rows through the foreign key', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    act(f, currentTurn(f), 'clue_plant', validClue());
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM ai_clues WHERE campaign_id = ?').get(f.campaign) as { n: number }).n, 1);
    f.db.prepare('DELETE FROM campaigns WHERE id = ?').run(f.campaign);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM ai_clues WHERE campaign_id = ?').get(f.campaign) as { n: number }).n, 0, 'the rows cascade away');
  } finally {
    await f.close();
  }
});
