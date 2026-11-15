import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { adversaries } from '@daggery/content';
import { CURRENT_VERSION, migrateCampaignDatabase, openCampaignDatabase } from './campaign-db';
import { fitMemory, limitsFor, type MemoryPart } from './ai/memory';
import {
  act, completion, currentTurn, finished, fixture, httpApp, ORIGIN, runTurn, schemaFiveDatabase, summaryReply, type Fixture,
} from './ai-test-kit';

/** The fake model never calls tools; tests run the NPC tools directly against an open turn. */
const handler = (request: { tools: boolean }) => request.tools ? completion('The tide turns. What do you do?') : summaryReply();

/** A complete, valid npc_create payload. */
function validNpc(name = 'Mára Vey'): Record<string, unknown> {
  return {
    name,
    role: 'harbor smuggler queen',
    ancestry: 'human',
    community: 'wanderborne',
    appearance: 'Salt-stained coat and a knife worn smooth.',
    tier: 2,
    type: 'Bruiser',
    difficulty: 11,
    thresholds: { major: 7, severe: 14 },
    hp: 6,
    stress: 3,
    attack: { name: 'Cutlass', modifier: 4, range: 'Melee', damage: '1d8+2' },
    experiences: [{ name: 'Smuggler', modifier: 2 }],
    features: [{ name: 'Cheap Shot', kind: 'action', text: 'Spend a Fear to strike first.' }],
    background: 'She ran the salt route before the guild bought the harbor.',
    want: 'Own the salt trade',
    fear: 'The harbor guild',
    secret: 'She sank the guild ledger ship herself.',
    voice: 'Clipped and dry; never says a name twice.',
    motives: 'Leverage first, blood last.',
    relationships: [{ name: 'Ash', relation: 'owes her a debt' }],
    notes: 'Keeps a second manifest under the chapel floor.',
    lastSeen: 'the lower docks',
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

test('npc_create, npc_read, npc_search and npc_update validate, clip, rank and replace', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    const created = act(f, turn, 'npc_create', validNpc()) as Record<string, any>;
    assert.equal(created.status, 'active');
    assert.equal(created.data.identity.name, 'Mára Vey');
    assert.equal(created.data.identity.type, 'Bruiser');
    assert.equal(created.data.stats.attack.damage, '1d8+2');
    assert.equal(created.data.story.want, 'Own the salt trade');

    const byId = act(f, turn, 'npc_read', { id: created.id }) as Record<string, any>;
    assert.equal(byId.id, created.id);
    assert.equal(byId.data.story.secret, 'She sank the guild ledger ship herself.');
    const byName = act(f, turn, 'npc_read', { name: 'mara vey' }) as Record<string, any>;
    assert.equal(byName.id, created.id, 'name lookup ignores case and accents');

    const found = act(f, turn, 'npc_search', { query: 'smuggler salt' }) as Record<string, any>[];
    assert.ok(found.some(item => item.id === created.id));
    assert.deepEqual(Object.keys(found[0]!).sort(), ['id', 'lastSeen', 'name', 'role', 'status', 'tier', 'want'].sort(), 'search returns summaries only');
    assert.ok(!JSON.stringify(found).includes('She sank'), 'a summary never carries story text');
    assert.ok((act(f, turn, 'npc_search', {}) as unknown[]).length <= 6, 'an empty query stays within six summaries');

    assert.throws(() => act(f, turn, 'npc_create', validNpc('mara vey')), /already has that name/, 'an active duplicate is refused');

    const updated = act(f, turn, 'npc_update', {
      id: created.id, status: 'dead', lastSeen: 'the deep',
      features: [{ name: 'Last Word', kind: 'reaction', text: 'When she falls, a rival pays.' }],
    }) as Record<string, any>;
    assert.equal(updated.status, 'dead');
    assert.equal(updated.data.story.lastSeen, 'the deep');
    assert.deepEqual(updated.data.stats.features.map((feature: any) => feature.name), ['Last Word'], 'arrays replace');
    assert.equal(updated.data.identity.name, 'Mára Vey', 'untouched fields survive an update');
    assert.equal(updated.data.story.secret, 'She sank the guild ledger ship herself.');

    assert.throws(() => act(f, turn, 'npc_read', { id: 'no-such-npc' }), /Invalid NPC/);
    assert.throws(() => act(f, turn, 'npc_update', { id: 'no-such-npc', hp: 4 }), /Invalid NPC/);
  } finally {
    await f.close();
  }
});

test('npc_create rejects unknown enums, out-of-range numbers, bad dice and bad catalog references', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    let seq = 0;
    const bad = (overrides: Record<string, unknown>, message: RegExp) => assert.throws(() => act(f, turn, 'npc_create', { ...validNpc('Validation ' + String(++seq)), ...overrides }), message);
    bad({ type: 'Dragon' }, /Invalid NPC type/);
    bad({ tier: 5 }, /Invalid NPC tier/);
    bad({ difficulty: 2 }, /Invalid NPC difficulty/);
    bad({ hp: 0 }, /Invalid NPC hp/);
    bad({ stress: 13 }, /Invalid NPC stress/);
    bad({ thresholds: { major: 10, severe: 10 } }, /severe must be greater than major/);
    bad({ attack: { name: 'Cutlass', modifier: 12, range: 'Melee', damage: '1d8' } }, /Invalid NPC attack modifier/);
    bad({ attack: { name: 'Cutlass', modifier: 2, range: 'Adjacent', damage: '1d8' } }, /Invalid NPC attack range/);
    bad({ attack: { name: 'Cutlass', modifier: 2, range: 'Melee', damage: 'eight' } }, /Invalid NPC attack damage/);
    bad({ attack: { name: 'Cutlass', modifier: 2, range: 'Melee', damage: '2d6+' } }, /Invalid NPC attack damage/);
    bad({ features: [{ name: 'Nope', kind: 'legendary', text: 'x' }] }, /Invalid NPC feature kind/);
    bad({ experiences: Array.from({ length: 6 }, () => ({ name: 'E', modifier: 1 })) }, /at most 5 items/);
    bad({ features: Array.from({ length: 7 }, () => ({ name: 'F', kind: 'passive', text: 'x' })) }, /at most 6 items/);
    bad({ relationships: Array.from({ length: 11 }, () => ({ name: 'R' })) }, /at most 10 items/);
    bad({ basedOn: 'no-such-adversary' }, /no such catalog adversary/);
    bad({ voice: 'x'.repeat(401) }, /at most 400 characters/);
    bad({ name: '' }, /name: text is required/);

    const adapted = act(f, turn, 'npc_create', { ...validNpc('Adapted Guard'), basedOn: adversaries[0]!.id }) as Record<string, any>;
    assert.equal(adapted.data.stats.basedOn, adversaries[0]!.id, 'a catalog adversary can be the base');
  } finally {
    await f.close();
  }
});

test('a campaign caps active NPCs at 60, and dead or retired sheets stop counting', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    for (let index = 0; index < 60; index++) act(f, turn, 'npc_create', validNpc('Crowd ' + String(index)));
    assert.throws(() => act(f, turn, 'npc_create', validNpc('Crowd 60')), /60 active NPCs/);
    const zero = act(f, turn, 'npc_read', { name: 'Crowd 0' }) as Record<string, any>;
    act(f, turn, 'npc_update', { id: zero.id, status: 'retired' });
    const replacement = act(f, turn, 'npc_create', validNpc('Crowd 60')) as Record<string, any>;
    assert.equal(replacement.status, 'active');
    const retired = act(f, turn, 'npc_read', { id: zero.id }) as Record<string, any>;
    assert.equal(retired.status, 'retired', 'a retired sheet stays readable');
    assert.equal(f.ai.actions.npcs.search(f.campaign, '').length, 10, 'the retrieval helper lists the newest ten by default');
  } finally {
    await f.close();
  }
});

test('the NPC table migrates from schema 5 and from the previous schema version', () => {
  const old = schemaFiveDatabase();
  try {
    migrateCampaignDatabase(old);
    assert.equal(old.pragma('user_version', { simple: true }), CURRENT_VERSION);
    const tables = (old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name);
    assert.ok(tables.includes('ai_npcs'), 'schema 5 gains the secret NPC table');
  } finally {
    old.close();
  }
  const db = openCampaignDatabase(':memory:');
  try {
    db.exec('DROP TABLE ai_npcs');
    db.pragma('user_version = 9');
    migrateCampaignDatabase(db);
    assert.equal(db.pragma('user_version', { simple: true }), CURRENT_VERSION);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ai_npcs_campaign'").all() as { name: string }[]).map(row => row.name);
    assert.deepEqual(indexes, ['ai_npcs_campaign'], 'a version 9 database gains the table and its campaign index');
  } finally {
    db.close();
  }
});

test('npc_to_encounter creates a printed-style token, and get_adversary, adversary_attack and basic weapon attacks use its stats', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    act(f, turn, 'create_scene', { name: 'Salt Pier' });
    const npc = act(f, turn, 'npc_create', validNpc()) as Record<string, any>;
    const encounter = act(f, turn, 'npc_to_encounter', { npcId: npc.id, x: 2, y: 2 }) as Record<string, any>;
    const combat = f.ai.actions.read<Record<string, any>>(f.campaign, 'combat', encounter.adversaryId)!;
    assert.equal(combat.kind, 'adversary');
    assert.equal(combat.name, 'Mára Vey');
    assert.equal(combat.hpMax, 6);
    assert.equal(combat.difficulty, 11);
    assert.deepEqual(combat.thresholds, { major: 7, severe: 14 });
    assert.equal(combat.attack.modifier, 4);
    for (const forbidden of ['background', 'want', 'fear', 'secret', 'voice', 'motives', 'relationships', 'notes', 'appearance']) {
      assert.ok(!(forbidden in combat), 'the combat document carries no ' + forbidden);
    }
    assert.ok(!JSON.stringify(combat).includes('guild ledger'), 'no story text reaches the synced document');
    const token = f.ai.actions.read<Record<string, any>>(f.campaign, 'map', encounter.tokenId)!;
    assert.equal(token.combatRefId, encounter.adversaryId);
    assert.equal(token.name, 'Mára Vey');

    const read = act(f, turn, 'get_adversary', { adversaryId: encounter.adversaryId }) as Record<string, any>;
    assert.equal(read.name, 'Mára Vey');
    assert.equal(read.type, 'Bruiser');
    assert.equal(read.difficulty, 11);
    assert.equal(read.hp, 6);
    assert.equal(read.attack.modifier, 4);
    assert.deepEqual(read.features, [], 'get_adversary does not leak NPC feature text');

    const original = Math.random;
    try {
      Math.random = () => 0.999999;
      const attack = act(f, turn, 'adversary_attack', { adversaryId: encounter.adversaryId, heroId: f.setup.heroId, reason: 'She strikes from the fog.' }) as Record<string, any>;
      assert.equal(attack.attack, 24, 'a d20 of 20 plus the NPC attack modifier of 4');
      assert.equal(attack.hit, true);
      assert.equal(attack.damage, 18, 'a critical deals the rolled 10 (8 plus the flat 2) plus the maximum die of 1d8');
    } finally {
      Math.random = original;
    }

    // A basic weapon attack through a requested roll uses the NPC's Difficulty and its own thresholds.
    const request = act(f, turn, 'request_roll', { heroId: f.setup.heroId, trait: 'agility', difficulty: 5, reason: 'Strike her', enemyId: encounter.adversaryId }) as Record<string, any>;
    assert.equal(request.difficulty, 11, 'the NPC Difficulty replaces the supplied one');
    const card = f.ai.session(f.user.id, f.campaign).messages.find(message => message.interaction?.kind === 'roll' && message.interaction.enemyId === encounter.adversaryId && !message.interaction.resolved)!;
    assert.ok(card, 'a roll card was offered against the NPC');
    try {
      Math.random = () => 0.999999;
      f.ai.resolve(f.user.id, f.campaign, card.id, { advantage: 'normal' });
      await finished(f.ai, f.user.id, f.campaign);
    } finally {
      Math.random = original;
    }
    const after = f.ai.actions.read<Record<string, any>>(f.campaign, 'combat', encounter.adversaryId)!;
    assert.ok(after.hpMarked > 0 && after.hpMarked <= 6, 'the hero weapon marks HP on the NPC through its thresholds');
  } finally {
    await f.close();
  }
});

test('the secret NPC list and proactive recall reach the GM, and the list is dropped before canon is shortened', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    const npc = act(f, turn, 'npc_create', validNpc()) as Record<string, any>;
    await runTurn(f, 'Mára Vey is waiting on the pier. What does she want?');
    const blocks = memoryBlocks(lastTurnRequest(f).body);
    const list = blocks.find(block => block.startsWith('Secret NPCs (GM only'));
    assert.ok(list, 'the NPC list is in the memory');
    assert.ok(list!.includes('Mára Vey — harbor smuggler queen — Own the salt trade (id ' + npc.id + ')'), 'one line per active NPC');
    const recall = blocks.find(block => block.includes('Secret NPCs in play'));
    assert.ok(recall, 'a named NPC is recalled');
    assert.ok(recall!.includes('Clipped and dry'), 'the recall carries the voice');
    assert.ok(recall!.includes('Own the salt trade'), 'the recall carries the want');
    assert.ok(recall!.includes('Leverage first'), 'the recall carries the motives');

    const parts: MemoryPart[] = [
      { kind: 'setup', text: 'S'.repeat(1000) },
      { kind: 'npcs', text: 'N'.repeat(2000) },
      { kind: 'canon', text: 'C'.repeat(1000) },
      { kind: 'secrets', text: 'K'.repeat(6000) },
      { kind: 'state', text: 'T'.repeat(6000) },
      { kind: 'summary', text: 'U'.repeat(2000) },
    ];
    const kept = fitMemory(parts, 17000);
    assert.equal(kept.some(part => part.kind === 'npcs'), false, 'the NPC list is dropped whole');
    assert.equal(kept.find(part => part.kind === 'canon')?.text, 'C'.repeat(1000), 'canon is untouched while the NPC list can go');
    assert.ok(limitsFor('balanced', 1_000_000).npcChars > limitsFor('balanced', 0).npcChars, 'the room scales with the window');
  } finally {
    await f.close();
  }
});

test('npc tools never expose sheet contents through the ledger, journal, checkpoint, documents or routes', async () => {
  const f = await fixture(handler);
  const marker = 'ZZQUARTZ-SECRET-MARKER-9f3c';
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    act(f, turn, 'create_scene', { name: 'Salt Pier' });
    const npc = act(f, turn, 'npc_create', {
      ...validNpc(), background: 'Background ' + marker, secret: 'Secret ' + marker,
      voice: 'Voice ' + marker, notes: 'Notes ' + marker, want: 'Want ' + marker,
    }) as Record<string, any>;
    act(f, turn, 'npc_read', { id: npc.id });
    act(f, turn, 'npc_search', { query: marker });
    act(f, turn, 'npc_update', { id: npc.id, lastSeen: 'last seen ' + marker });
    const encounter = act(f, turn, 'npc_to_encounter', { npcId: npc.id }) as Record<string, any>;

    // The owner-visible ledger stores only a neutral result and a neutral label.
    const rows = f.db.prepare("SELECT tool, label, result FROM ai_actions WHERE campaign_id = ? AND tool LIKE 'npc_%'").all(f.campaign) as { tool: string; label: string; result: string }[];
    assert.equal(rows.length, 5, 'every npc tool was recorded');
    for (const row of rows) {
      const stored = JSON.parse(row.result) as Record<string, unknown>;
      assert.deepEqual(Object.keys(stored).filter(key => key !== 'npcId'), ['done'], row.tool + ' stores a neutral result');
      if (stored.npcId !== undefined) assert.equal(stored.npcId, npc.id, 'only the opaque id is kept');
      assert.ok(!row.result.includes(marker));
      assert.ok(!/Mára|secret|voice|want/i.test(row.label), 'the label is neutral');
    }
    assert.equal(f.ai.session(f.user.id, f.campaign).actions.filter(action => action.tool.startsWith('npc_')).length, 5);

    // A retried turn replays the same call ID: a read returns the full sheet again, not the neutral ledger
    // text, and a replayed write returns the id without writing a second row.
    const ctx = { campaign: f.campaign, owner: f.user.id, turn, callId: 'retry-read', assertActive: () => {}, publish: () => {}, publishRoll: () => {} };
    f.ai.actions.execute('npc_read', { id: npc.id }, ctx);
    const reread = f.ai.actions.execute('npc_read', { id: npc.id }, ctx) as Record<string, any>;
    assert.ok(JSON.stringify(reread).includes('Secret ' + marker), 'the retried read still gives the model the sheet');
    const writeCtx = { ...ctx, callId: 'retry-create' };
    const first = f.ai.actions.execute('npc_create', { ...validNpc(), name: 'Retry Twin' }, writeCtx) as Record<string, any>;
    const replay = f.ai.actions.execute('npc_create', { ...validNpc(), name: 'Retry Twin' }, writeCtx) as Record<string, any>;
    assert.deepEqual(replay, { done: true, npcId: first.id });
    assert.ok(!JSON.stringify(f.ai.session(f.user.id, f.campaign).actions).includes(marker), 'the session payload carries no marker');

    // No journal event and no transcript message mentions the NPC or its marker.
    const journal = f.db.prepare('SELECT title, body FROM ai_journal WHERE campaign_id = ?').all(f.campaign) as { title: string; body: string }[];
    assert.ok(!JSON.stringify(journal).includes(marker), 'the journal never receives NPC content');
    assert.ok(!journal.some(entry => /Mára/.test(entry.title + entry.body)), 'no event names the NPC');
    const messages = f.db.prepare('SELECT text FROM ai_messages WHERE campaign_id = ?').all(f.campaign) as { text: string }[];
    assert.ok(!JSON.stringify(messages).includes(marker), 'no transcript message carries NPC content');

    // Synced documents and rolls stay clean; the combat document is the only printed-token exposure.
    const docs = f.db.prepare('SELECT ns, id, value FROM campaign_docs WHERE campaign_id = ?').all(f.campaign) as { ns: string; id: string; value: string }[];
    assert.ok(!JSON.stringify(docs).includes(marker), 'no campaign document carries NPC content');
    const rolls = f.db.prepare('SELECT payload FROM campaign_rolls WHERE campaign_id = ?').all(f.campaign) as { payload: string }[];
    assert.ok(!JSON.stringify(rolls).includes(marker), 'no roll payload carries NPC content');
    const canon = f.db.prepare('SELECT title, body FROM ai_canon WHERE campaign_id = ?').all(f.campaign) as { title: string; body: string }[];
    assert.ok(!JSON.stringify(canon).includes(marker), 'canon never receives NPC content');
    assert.ok(!JSON.stringify(f.ai.actions.read(f.campaign, 'combat', encounter.adversaryId)).includes(marker));

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

test('deleting a campaign removes its secret NPC rows through the foreign key', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    act(f, currentTurn(f), 'npc_create', validNpc());
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM ai_npcs WHERE campaign_id = ?').get(f.campaign) as { n: number }).n, 1);
    f.db.prepare('DELETE FROM campaigns WHERE id = ?').run(f.campaign);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM ai_npcs WHERE campaign_id = ?').get(f.campaign) as { n: number }).n, 0, 'the rows cascade away');
  } finally {
    await f.close();
  }
});
