import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AI_PROFILE_NOTE_LIMIT } from '@daggery/shared';
import { CURRENT_VERSION, migrateCampaignDatabase, openCampaignDatabase } from './campaign-db';
import { fitMemory, renderProfile, type MemoryPart } from './ai/memory';
import {
  act, addPlayer, completion, currentTurn, fixture, httpApp, ORIGIN, runTurn, schemaFiveDatabase, summaryReply, type Fixture,
} from './ai-test-kit';

const handler = (request: { tools: boolean }) => request.tools ? completion('The lantern gutters. What do you do?') : summaryReply();

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

test('the profile routes read and edit only the current user profile', async () => {
  const f = await fixture(handler);
  try {
    const { app, cookie } = await httpApp(f);
    const base = '/api/campaigns/' + f.campaign + '/ai';
    try {
      const empty = await app.inject({ method: 'GET', url: base + '/profile', headers: { cookie, origin: ORIGIN } });
      assert.equal(empty.statusCode, 200);
      assert.equal(empty.json().profile.pacing, 'balanced', 'a player with no profile gets the defaults');

      const saved = await app.inject({
        method: 'PUT', url: base + '/profile', headers: { cookie, origin: ORIGIN },
        payload: {
          tone: 'Grim', pacing: 'slow', combat: 3, roleplay: 2, exploration: 0,
          lines: ['torture'], veils: ['graphic romance'], likes: ['puzzles'], dislikes: ['shopping'], note: 'I like planning',
        },
      });
      assert.equal(saved.statusCode, 200);
      const profile = saved.json().profile;
      assert.equal(profile.tone, 'Grim');
      assert.equal(profile.pacing, 'slow');
      assert.deepEqual([profile.combat, profile.roleplay, profile.exploration], [3, 2, 0]);
      assert.deepEqual(profile.lines, ['torture']);
      assert.deepEqual(profile.veils, ['graphic romance']);
      assert.equal(profile.notes.length, 1, 'the player note is stored');
      assert.equal(profile.notes[0].source, 'player');

      const read = await app.inject({ method: 'GET', url: base + '/profile', headers: { cookie, origin: ORIGIN } });
      assert.deepEqual(read.json().profile.lines, ['torture']);

      const merged = await app.inject({
        method: 'PUT', url: base + '/profile', headers: { cookie, origin: ORIGIN }, payload: { tone: 'Warm' },
      });
      assert.equal(merged.json().profile.tone, 'Warm');
      assert.deepEqual(merged.json().profile.lines, ['torture'], 'an omitted field keeps its stored value');

      const removed = await app.inject({
        method: 'PUT', url: base + '/profile', headers: { cookie, origin: ORIGIN },
        payload: { removeNoteIds: [profile.notes[0].id] },
      });
      assert.deepEqual(removed.json().profile.notes, [], 'the player can remove a note');

      const player = await addPlayer(f, 'playerone');
      const playerCookie = 'daggery_session=' + f.campaigns.createSession(player.id);
      const other = await app.inject({ method: 'GET', url: base + '/profile', headers: { cookie: playerCookie, origin: ORIGIN } });
      assert.equal(other.statusCode, 200);
      assert.equal(other.json().profile.tone, '', 'another member has their own profile');

      const bad = await app.inject({ method: 'PUT', url: base + '/profile', headers: { cookie, origin: ORIGIN }, payload: { pacing: 'chaotic' } });
      assert.equal(bad.statusCode, 400, 'an invalid pacing is refused');
      const badWeight = await app.inject({ method: 'PUT', url: base + '/profile', headers: { cookie, origin: ORIGIN }, payload: { combat: 4 } });
      assert.equal(badWeight.statusCode, 400, 'a weight above 3 is refused');
      const anon = await app.inject({ method: 'GET', url: base + '/profile', headers: { origin: ORIGIN } });
      assert.equal(anon.statusCode, 401, 'the profile needs a signed-in member');
    } finally {
      await app.close();
    }
  } finally {
    await f.close();
  }
});

test('profile_note records a capped GM note and can never edit lines or veils', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    f.ai.saveProfile(f.user.id, f.campaign, { lines: ['torture'], veils: ['graphic romance'] });

    const first = act(f, turn, 'profile_note', { text: 'lights up during puzzles', lines: ['torture is fine'], veils: [] }) as Record<string, unknown>;
    assert.equal(first.saved, true);
    let profile = f.ai.profile(f.user.id, f.campaign);
    assert.deepEqual(profile.lines, ['torture'], 'the GM note cannot change the lines');
    assert.deepEqual(profile.veils, ['graphic romance'], 'the GM note cannot change the veils');
    assert.equal(profile.notes.length, 1);
    assert.equal(profile.notes[0]!.source, 'gm');
    assert.equal(profile.notes[0]!.text, 'lights up during puzzles');

    for (let index = 0; index < AI_PROFILE_NOTE_LIMIT + 5; index++) act(f, turn, 'profile_note', { text: 'note ' + String(index) });
    profile = f.ai.profile(f.user.id, f.campaign);
    assert.equal(profile.notes.length, AI_PROFILE_NOTE_LIMIT, 'the note list is capped');
    assert.ok(profile.notes.some(note => note.text === 'note ' + String(AI_PROFILE_NOTE_LIMIT + 4)), 'the newest note is kept');
    assert.ok(profile.notes.every(note => note.source === 'gm'));

    assert.throws(() => act(f, turn, 'profile_note', { text: '' }), /text is required/);
    assert.throws(() => act(f, turn, 'profile_note', { text: 'x'.repeat(201) }), /at most 200 characters/);

    const target = profile.notes[0]!;
    const after = f.ai.saveProfile(f.user.id, f.campaign, { removeNoteIds: [target.id] });
    assert.equal(after.notes.some(note => note.id === target.id), false, 'the player can delete a GM note');
  } finally {
    await f.close();
  }
});

test('the player preferences block is always in memory and lines and veils are never dropped', async () => {
  const f = await fixture(handler);
  try {
    f.ai.saveProfile(f.user.id, f.campaign, {
      tone: 'Grim', pacing: 'slow', combat: 3, roleplay: 1, exploration: 0,
      lines: ['torture'], veils: ['graphic romance'], likes: ['puzzles'], dislikes: ['shopping'],
    });
    await runTurn(f, 'Begin.');
    const blocks = memoryBlocks(lastTurnRequest(f).body);
    const block = blocks.find(item => item.startsWith('Player preferences'));
    assert.ok(block, 'the profile block is present');
    assert.ok(block!.includes('Lines (never include; absolute):'));
    assert.ok(block!.includes('- torture'), 'the lines are in the memory');
    assert.ok(block!.includes('- graphic romance'), 'the veils are in the memory');
    assert.ok(block!.includes('Pacing: slow'));
    assert.ok(block!.includes('Likes: puzzles'));
    assert.ok(block!.includes('Focus (0-3): combat 3, roleplay 1, exploration 0'));

    // An empty profile is still an always-on block, with the hard limits called out explicitly.
    f.ai.saveProfile(f.user.id, f.campaign, { tone: '', lines: [], veils: [], likes: [], dislikes: [] });
    await runTurn(f, 'I look around.');
    const empty = memoryBlocks(lastTurnRequest(f).body).find(item => item.startsWith('Player preferences'));
    assert.ok(empty, 'the block survives an empty profile');
    assert.ok(empty!.includes('(none stated)'));

    // The memory fitter may drop chapters and shorten canon, but it never drops the profile.
    f.ai.saveProfile(f.user.id, f.campaign, { lines: ['torture'], veils: ['graphic romance'] });
    const profile = f.ai.profile(f.user.id, f.campaign);
    const parts: MemoryPart[] = [
      { kind: 'setup', text: 'S'.repeat(1000) },
      { kind: 'profile', text: renderProfile(profile, 1800) },
      { kind: 'canon', text: 'C'.repeat(1000) },
      { kind: 'secrets', text: 'K'.repeat(6000) },
      { kind: 'chapter', text: 'H'.repeat(2000) },
    ];
    const kept = fitMemory(parts, 8000);
    const keptProfile = kept.find(part => part.kind === 'profile');
    assert.ok(keptProfile, 'the profile part is kept');
    assert.ok(keptProfile!.text.includes('torture'));
    assert.ok(keptProfile!.text.includes('graphic romance'));
    assert.equal(kept.some(part => part.kind === 'chapter'), false, 'chapters are dropped first');

    // With very little room, the optional fields trim but the lines and veils stay whole.
    const tight = renderProfile(profile, 60);
    assert.ok(tight.includes('- torture'));
    assert.ok(tight.includes('- graphic romance'));
    assert.equal(tight.includes('Pacing:'), false, 'optional fields are trimmed under a tight budget');
  } finally {
    await f.close();
  }
});

test('the profile table migrates from schema 5 and from version 12', () => {
  const old = schemaFiveDatabase();
  try {
    migrateCampaignDatabase(old);
    assert.equal(old.pragma('user_version', { simple: true }), CURRENT_VERSION);
    const tables = (old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name);
    assert.ok(tables.includes('ai_profiles'), 'schema 5 gains the player profile table');
  } finally {
    old.close();
  }
  const db = openCampaignDatabase(':memory:');
  try {
    db.exec('DROP TABLE ai_profiles');
    db.pragma('user_version = 12');
    migrateCampaignDatabase(db);
    assert.equal(db.pragma('user_version', { simple: true }), CURRENT_VERSION);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ai_profiles_campaign'").all() as { name: string }[]).map(row => row.name);
    assert.deepEqual(indexes, ['ai_profiles_campaign'], 'a version 12 database gains the table and its campaign index');
  } finally {
    db.close();
  }
});

test('deleting a campaign removes its profile rows through the foreign key', async () => {
  const f = await fixture(handler);
  try {
    f.ai.saveProfile(f.user.id, f.campaign, { tone: 'Grim' });
    const count = () => (f.db.prepare('SELECT COUNT(*) AS n FROM ai_profiles WHERE campaign_id = ?').get(f.campaign) as { n: number }).n;
    assert.equal(count(), 1);
    f.db.prepare('DELETE FROM campaigns WHERE id = ?').run(f.campaign);
    assert.equal(count(), 0, 'the rows cascade away');
  } finally {
    await f.close();
  }
});
