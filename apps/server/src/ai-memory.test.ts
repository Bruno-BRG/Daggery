import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { adversaries } from '@daggery/content';
import { fitMemory, type MemoryPart } from './ai/memory';
import { migrateCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { OPENING_INSTRUCTION } from './ai/prompts';
import { AiConflict, AiService } from './ai/service';
import { SecretVault } from './ai/vault';
import { act, addPlayer, call, completion, currentTurn, finished, fixture, httpApp, json, lastUserText, ORIGIN, prose, runTurn, schemaFiveDatabase, seedHistory, summaryReply, type Captured, type Fixture } from './ai-test-kit';

/** A one-shot gate: the fake model waits on it until the test opens it. */
function gate(): { wait: Promise<void>; open: () => void } {
  let release: () => void = () => {};
  const wait = new Promise<void>(resolve => { release = () => resolve(); });
  return { wait, open: () => release() };
}

/** Every request sent from index "from" onward must name "chat" as its provider session. */
function everyRequestUses(f: Fixture, from: number, chat: string, label: string): void {
  const sent = f.requests.slice(from);
  assert.ok(sent.length > 0, label + ' sent no model requests');
  for (const request of sent) assert.equal(request.session, chat, label + ' used the wrong provider session');
}

test('schema 5 transcripts migrate into one open Session 1 per campaign, and running the migration again changes nothing', () => {
  const db = schemaFiveDatabase();
  try {
    const at = '2026-01-02T10:00:00.000Z';
    const config = '{"systemId":"daggerheart","rulesetId":"core","options":{},"gmController":"ai"}';
    db.prepare("INSERT INTO users(id, username, password_hash, created_at) VALUES ('gm-old', 'old-gm', '!hash', ?)").run(at);
    const insertCampaign = db.prepare('INSERT INTO campaigns(id, name, description, owner_id, created_at, updated_at, configuration) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertCampaign.run('c-old', 'Old campaign', '', 'gm-old', at, at, config);
    insertCampaign.run('c-settings', 'Settings only', '', 'gm-old', at, at, config);
    insertCampaign.run('c-plain', 'No AI yet', '', 'gm-old', at, at, config);
    const insertMember = db.prepare("INSERT INTO campaign_members(campaign_id, user_id, role) VALUES (?, 'gm-old', 'gm')");
    for (const id of ['c-old', 'c-settings', 'c-plain']) insertMember.run(id);
    const insertSettings = db.prepare("INSERT INTO campaign_ai(campaign_id, owner_id, enabled, setup, memory, updated) VALUES (?, 'gm-old', 1, '{}', '', ?)");
    insertSettings.run('c-old', at);
    insertSettings.run('c-settings', at);
    const insertTurn = db.prepare("INSERT INTO ai_turns(id, campaign_id, user_id, request_id, status, error, steps, cost, created, updated) VALUES (?, 'c-old', 'gm-old', ?, 'complete', '', 2, 0.01, ?, ?)");
    insertTurn.run('turn-1', 'req-1', at, at);
    insertTurn.run('turn-2', 'req-2', at, at);
    const insertMessage = db.prepare("INSERT INTO ai_messages(id, campaign_id, turn_id, role, text, interaction, created) VALUES (?, 'c-old', ?, ?, ?, ?, ?)");
    insertMessage.run('msg-1', 'turn-1', 'player', 'Begin.', null, at);
    insertMessage.run('msg-2', 'turn-1', 'gm', 'The harbor bell rings.', null, at);
    insertMessage.run('msg-3', 'turn-2', 'player', 'I search the crates.', null, at);
    insertMessage.run('msg-4', 'turn-2', 'gm', 'Roll to find the latch.', JSON.stringify({ kind: 'roll', resolved: false, heroId: 'hero-1', trait: 'instinct', difficulty: 12 }), at);

    migrateCampaignDatabase(db);
    migrateCampaignDatabase(db);
    assert.equal(db.pragma('user_version', { simple: true }), 6);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name);
    assert.ok(tables.includes('ai_chats'), 'ai_chats exists after migration');
    assert.ok(tables.includes('ai_journal'), 'ai_journal exists after migration');
    const chats = db.prepare('SELECT id, campaign_id AS campaign, ordinal, title, status FROM ai_chats ORDER BY campaign_id').all() as { id: string; campaign: string; ordinal: number; title: string; status: string }[];
    assert.deepEqual(chats.map(chat => [chat.campaign, chat.ordinal, chat.title, chat.status]), [['c-old', 1, 'Session 1', 'open'], ['c-settings', 1, 'Session 1', 'open']]);
    const oldChat = chats[0]!.id;
    const messages = db.prepare("SELECT chat_id AS chat, text FROM ai_messages WHERE campaign_id = 'c-old' ORDER BY rowid").all() as { chat: string | null; text: string }[];
    assert.deepEqual(messages.map(row => row.chat), [oldChat, oldChat, oldChat, oldChat]);
    assert.deepEqual(messages.map(row => row.text), ['Begin.', 'The harbor bell rings.', 'I search the crates.', 'Roll to find the latch.']);
    const turns = db.prepare("SELECT chat_id AS chat FROM ai_turns WHERE campaign_id = 'c-old' ORDER BY rowid").all() as { chat: string | null }[];
    assert.deepEqual(turns.map(row => row.chat), [oldChat, oldChat]);
    const view = new AiService(db, new CampaignService(db), new SecretVault(randomBytes(32))).session('gm-old', 'c-old');
    assert.equal(view.activeChatId, oldChat);
    assert.deepEqual(view.messages.map(message => message.text), messages.map(row => row.text));
    assert.equal(view.messages[3]!.interaction?.kind, 'roll');
  } finally {
    db.close();
  }
});

test('sessions keep separate transcripts, and a turn cannot start in one session while another session runs', async () => {
  const hold = gate();
  const f = await fixture(async request => {
    if (!request.tools) return summaryReply();
    await hold.wait;
    return completion('GM reply to ' + lastUserText(request.body));
  });
  try {
    const { ai, user, campaign } = f;
    const sessionA = ai.session(user.id, campaign).activeChatId!;
    const sessionB = ai.createChat(user.id, campaign, { title: 'Session B' }).chat.id;
    ai.start(user.id, campaign, { requestId: 'a-open', message: 'Hello from A.', chatId: sessionA });
    assert.throws(() => ai.start(user.id, campaign, { requestId: 'b-open', message: 'Hello from B.', chatId: sessionB }), AiConflict);
    assert.throws(() => ai.createChat(user.id, campaign, {}), AiConflict);
    assert.deepEqual(ai.session(user.id, campaign, sessionB).messages, [], 'session B shows nothing from session A while A runs');
    hold.open();
    await finished(ai, user.id, campaign);
    await runTurn(f, 'Hello from B.', sessionB);
    const viewA = ai.session(user.id, campaign, sessionA);
    const viewB = ai.session(user.id, campaign, sessionB);
    assert.deepEqual(viewA.messages.map(message => message.text), ['Hello from A.', 'GM reply to Hello from A.']);
    assert.deepEqual(viewB.messages.map(message => message.text), ['Hello from B.', 'GM reply to Hello from B.']);
    const aIds = new Set(viewA.messages.map(message => message.id));
    assert.ok(viewB.messages.every(message => !aIds.has(message.id)), 'no message appears in both sessions');
    const turns = f.db.prepare('SELECT request_id, chat_id FROM ai_turns WHERE campaign_id = ? ORDER BY rowid').all(campaign) as { request_id: string; chat_id: string }[];
    assert.deepEqual(turns.map(row => row.chat_id), [sessionA, sessionB]);
    assert.equal(viewB.run?.chatId, sessionB);
  } finally {
    await f.close();
  }
});

test('an ended session writes a final chapter, refuses turns and card answers, and keeps its transcript readable', async t => {
  const f = await fixture(request => request.tools
    ? completion('The harbor settles into night. What do you do?')
    : summaryReply('The party left the harbor by night.', 'Working summary: the party is free.', 'Digest: the harbor keeps its secret.'));
  try {
    const { ai, user, campaign } = f;
    const chat = ai.session(user.id, campaign).activeChatId!;
    await runTurn(f, 'Begin the night watch.');
    const turn = currentTurn(f);
    const foe = adversaries.find(entry => entry.type !== 'Minion')!;
    act(f, turn, 'create_scene', { name: 'Harbor Wall' });
    const enemy = act(f, turn, 'add_adversary', { catalogId: foe.id }) as { adversaryId: string };
    act(f, turn, 'request_roll', { heroId: f.setup.heroId, trait: 'instinct', difficulty: 10, reason: 'Listen for the bell.' });
    t.mock.method(Math, 'random', () => 0.999);
    act(f, turn, 'adversary_attack', { adversaryId: enemy.adversaryId, heroId: f.setup.heroId, reason: 'Strikes from the wall.' });
    const cards = ai.session(user.id, campaign).messages;
    const roll = cards.find(message => message.interaction?.kind === 'roll')!;
    const damage = cards.find(message => message.interaction?.kind === 'damage')!;
    assert.ok(roll && damage, 'the session has an open roll card and an open damage card');
    ai.endChat(user.id, campaign, { chatId: chat });
    const ended = await finished(ai, user.id, campaign);
    assert.equal(ended.run?.kind, 'end');
    assert.equal(ended.run?.status, 'complete');
    assert.equal(ended.chats.find(row => row.id === chat)?.status, 'ended');
    const chapters = ai.journalPage(user.id, campaign, { kind: 'chapter' }).entries;
    assert.deepEqual(chapters.map(entry => [entry.title, entry.body, entry.chatId]), [['Chapter 1 (final)', 'The party left the harbor by night.', chat]]);
    assert.throws(() => ai.start(user.id, campaign, { chatId: chat, requestId: 'late-turn', message: 'Still there?' }), { message: /^Invalid action: this session has ended/ });
    assert.throws(() => ai.resolve(user.id, campaign, damage.id, { useArmor: false }), { message: /^Invalid action: this session has ended/ });
    assert.throws(() => ai.resolve(user.id, campaign, roll.id, { advantage: 'normal' }), { message: /^Invalid action: this session has ended/ });
    const transcript = ai.session(user.id, campaign, chat).messages;
    assert.ok(transcript.some(message => message.text === 'Begin the night watch.'), 'the player message is still readable');
    assert.ok(transcript.some(message => message.role === 'notice' && message.text.startsWith('This session has ended.')), 'the ended notice is shown');
    assert.equal(transcript.find(message => message.id === damage.id)?.interaction?.resolved, false);
  } finally {
    await f.close();
  }
});

test('members see only shared journal entries and cannot write, while owner-only notes and hidden events stay with the GM', async () => {
  const f = await fixture(request => request.tools ? completion('The gate creaks open. What do you do?') : summaryReply());
  try {
    const { ai, user, campaign } = f;
    const player = await addPlayer(f, 'journalplayer');
    const secret = ai.addJournal(user.id, campaign, { title: 'Owner secret note', body: 'The keeper is the traitor.', shared: false });
    const shared = ai.addJournal(user.id, campaign, { title: 'Shared discovery', body: 'Ash found a torn map.', shared: true });
    await runTurn(f, 'Look around the dock.');
    const turn = currentTurn(f);
    act(f, turn, 'create_scene', { name: 'Dock Gate' });
    const countdown = act(f, turn, 'create_countdown', { name: 'Tide rises', start: 4 }) as { countdownId: string };
    const countdownDoc = f.ai.actions.read(campaign, 'combat', countdown.countdownId)!;
    f.ai.actions.write(campaign, 'combat', countdown.countdownId, { ...countdownDoc, visible: false });
    act(f, turn, 'advance_countdown', { countdownId: countdown.countdownId, amount: 1, reason: 'The water climbs.' });
    const memberEntries = ai.journalPage(player.id, campaign, {}).entries;
    const memberTitles = memberEntries.map(entry => entry.title);
    assert.ok(memberTitles.includes('Shared discovery'));
    assert.ok(memberTitles.includes('Scene · Dock Gate'));
    assert.ok(memberEntries.every(entry => entry.visibility === 'shared'), 'members receive shared entries only');
    assert.ok(!memberTitles.includes('Owner secret note'));
    assert.ok(!memberTitles.includes('Countdown · Tide rises is at 3'), 'a hidden countdown event stays with the GM');
    assert.deepEqual(ai.journalPage(player.id, campaign, { q: 'traitor' }).entries, [], 'search does not reveal GM-only text');
    const ownerTitles = ai.journalPage(user.id, campaign, {}).entries.map(entry => entry.title);
    assert.ok(ownerTitles.includes('Owner secret note'));
    assert.ok(ownerTitles.includes('Countdown · Tide rises is at 3'));
    assert.throws(() => ai.addJournal(player.id, campaign, { title: 'Sneaky note', body: 'Not allowed.' }), { message: 'Forbidden' });
    assert.throws(() => ai.editJournal(player.id, campaign, shared.id, { title: 'Changed' }), { message: 'Forbidden' });
    assert.throws(() => ai.deleteJournal(player.id, campaign, secret.id), { message: 'Forbidden' });
    const event = ai.journalPage(user.id, campaign, { kind: 'event' }).entries[0]!;
    assert.equal(event.editable, false);
    assert.throws(() => ai.editJournal(user.id, campaign, event.id, { title: 'Rewritten' }), { message: /^Invalid action: journal events are read only/ });
    assert.throws(() => ai.deleteJournal(user.id, campaign, event.id), { message: /^Invalid action: journal events are read only/ });
  } finally {
    await f.close();
  }
});

test('each consequential tool, each resolved roll and each resolved damage card writes a journal event, and hidden targets write GM-only events', async t => {
  const f = await fixture(request => request.tools ? completion('Noted. What do you do?') : summaryReply());
  try {
    const { ai, user, campaign } = f;
    const player = await addPlayer(f, 'eventplayer');
    await runTurn(f, 'Set the scene.');
    const turn = currentTurn(f);
    const foe = adversaries.find(entry => entry.type !== 'Minion')!;
    act(f, turn, 'create_scene', { name: 'Cliff Road' });
    const enemy = act(f, turn, 'add_adversary', { catalogId: foe.id, name: 'Harrier' }) as { adversaryId: string; tokenId: string };
    const token = f.ai.actions.read(campaign, 'map', enemy.tokenId)!;
    f.ai.actions.write(campaign, 'map', enemy.tokenId, { ...token, hidden: true });
    f.ai.actions.write(campaign, 'combat', 'fear', { kind: 'fear', value: 2 });
    act(f, turn, 'spend_fear', { amount: 1, reason: 'The ambush begins.' });
    const countdown = act(f, turn, 'create_countdown', { name: 'Storm front', start: 4 }) as { countdownId: string };
    const countdownDoc = f.ai.actions.read(campaign, 'combat', countdown.countdownId)!;
    f.ai.actions.write(campaign, 'combat', countdown.countdownId, { ...countdownDoc, visible: false });
    act(f, turn, 'advance_countdown', { countdownId: countdown.countdownId, amount: 1, reason: 'Clouds gather.' });
    act(f, turn, 'roll_loot', { table: 'items', rarity: 'Common', note: 'From the chest' });
    act(f, turn, 'give_item', { heroId: f.setup.heroId, catalogId: 'minor-health-potion', quantity: 1 });
    act(f, turn, 'set_condition', { targetId: enemy.adversaryId, condition: 'vulnerable', active: true, reason: 'Caught in the open.' });
    t.mock.method(Math, 'random', () => 0.999);
    act(f, turn, 'adversary_attack', { adversaryId: enemy.adversaryId, heroId: f.setup.heroId, reason: 'Lunges at the hero.' });
    act(f, turn, 'request_roll', { heroId: f.setup.heroId, trait: 'instinct', difficulty: 10, reason: 'Read the signs.' });
    const rollCard = ai.session(user.id, campaign).messages.find(message => message.interaction?.kind === 'roll')!;
    ai.resolve(player.id, campaign, rollCard.id, { advantage: 'normal' });
    await finished(ai, user.id, campaign);
    const damageCard = ai.session(user.id, campaign).messages.find(message => message.interaction?.kind === 'damage')!;
    ai.resolve(player.id, campaign, damageCard.id, { useArmor: false });
    await finished(ai, user.id, campaign);
    const expectations: [RegExp, 'shared' | 'gm'][] = [
      [/^Scene · Cliff Road$/, 'shared'],
      [/^Encounter · Harrier joins the scene$/, 'shared'],
      [/^Attack · Harrier (hits|misses) Ash/, 'gm'],
      [/^Fear · GM spent 1 Fear \(1 left\)$/, 'shared'],
      [/^Countdown · Storm front started at 4$/, 'shared'],
      [/^Countdown · Storm front is at 3$/, 'gm'],
      [/^Reward · .+ \(Common items roll\)$/, 'shared'],
      [/^Reward · Ash received 1x Minor Health Potion$/, 'shared'],
      [/^Condition · vulnerable applied to Harrier$/, 'gm'],
      [/^Roll · Ash · (critical success|success|failure)$/, 'shared'],
      [/^Damage · Ash takes \d+ \(\d+ HP\)$/, 'shared'],
    ];
    const owner = ai.journalPage(user.id, campaign, { kind: 'event' }).entries;
    for (const [pattern, visibility] of expectations) {
      const found = owner.find(entry => pattern.test(entry.title));
      assert.ok(found, 'missing event matching ' + String(pattern));
      assert.equal(found.visibility, visibility, String(pattern));
    }
    const memberTitles = ai.journalPage(player.id, campaign, { kind: 'event' }).entries.map(entry => entry.title);
    for (const [pattern, visibility] of expectations) {
      assert.equal(memberTitles.some(title => pattern.test(title)), visibility === 'shared', 'member view of ' + String(pattern));
    }
  } finally {
    await f.close();
  }
});

test('a resolved choice writes one journal event whose body does not repeat the choice', async () => {
  const choices = ['Take the lighthouse path', 'Follow the smuggler'];
  let gmCalls = 0;
  const f = await fixture(request => {
    if (!request.tools) return summaryReply();
    gmCalls++;
    return gmCalls === 1
      ? completion(null, [call('choice-call', 'offer_choices', { prompt: 'The road splits at the cliff.', choices })])
      : completion('The path narrows. What do you do?');
  });
  try {
    const { ai, user, campaign } = f;
    await runTurn(f, 'Set out along the coast.');
    const card = ai.session(user.id, campaign).messages.find(message => message.interaction?.kind === 'choices' && message.interaction.resolved === false)!;
    assert.ok(card, 'the turn offers an unresolved choice card');
    const chosen = choices[1]!;
    ai.resolve(user.id, campaign, card.id, { choice: chosen });
    await finished(ai, user.id, campaign);
    const events = ai.journalPage(user.id, campaign, { kind: 'event' }).entries.filter(entry => entry.title === 'Choice · ' + chosen);
    assert.equal(events.length, 1, 'exactly one choice event');
    assert.equal(events[0]!.body, '', 'the body does not repeat the choice');
    const transcript = ai.session(user.id, campaign).messages;
    assert.ok(transcript.some(message => message.role === 'player' && message.text === chosen), 'the choice is recorded as the player message');
  } finally {
    await f.close();
  }
});

test('journal_add refuses a fourth note in one turn, stores three, and keeps notes GM-only unless shared', async () => {
  let gmCalls = 0;
  const f = await fixture(request => {
    if (!request.tools) return summaryReply();
    gmCalls++;
    if (gmCalls === 1) return completion(null, [
      call('note-1', 'journal_add', { title: 'Oath', body: 'Ash swore to find the keeper.' }),
      call('note-2', 'journal_add', { title: 'Torn map', body: 'The map marks a sea cave.', shared: true }),
      call('note-3', 'journal_add', { title: 'Debt', body: 'The smuggler owes a favor.' }),
      call('note-4', 'journal_add', { title: 'Extra', body: 'A fourth note.' }),
    ]);
    return completion('The smuggler nods. What do you do?');
  });
  try {
    const { ai, user, campaign, db } = f;
    const player = await addPlayer(f, 'notesplayer');
    await runTurn(f, 'Ask the smuggler about the keeper.');
    const followUp = f.requests[1]!.body.messages as { role: string; tool_call_id?: string; content: string }[];
    const refused = followUp.find(message => message.role === 'tool' && message.tool_call_id === 'note-4');
    assert.deepEqual(JSON.parse(refused!.content), { error: 'Invalid journal entry: at most three notes per turn' });
    const turn = currentTurn(f);
    const stored = db.prepare("SELECT title, visibility FROM ai_journal WHERE turn_id = ? AND kind = 'note' ORDER BY rowid").all(turn) as { title: string; visibility: string }[];
    assert.deepEqual(stored, [{ title: 'Oath', visibility: 'gm' }, { title: 'Torn map', visibility: 'shared' }, { title: 'Debt', visibility: 'gm' }]);
    assert.deepEqual(ai.journalPage(player.id, campaign, { kind: 'note' }).entries.map(entry => entry.title), ['Torn map']);
    assert.deepEqual(ai.journalPage(user.id, campaign, { kind: 'note' }).entries.map(entry => entry.title).sort(), ['Debt', 'Oath', 'Torn map']);
    assert.equal(ai.session(user.id, campaign).actions.filter(action => action.tool === 'journal_add').length, 3);
  } finally {
    await f.close();
  }
});

test('a long lean session writes one chapter per turn, tells the GM, and updates the session summary and campaign digest', async () => {
  let summaries = 0;
  const f = await fixture(request => {
    if (!request.tools) {
      summaries++;
      return summaryReply('The party climbed the tower.', 'Working summary: the party reached the top.', 'Digest: the tower stands above the harbor.');
    }
    return completion('The tower wind bites. What do you do?');
  }, 'lean');
  try {
    const { ai, user, campaign } = f;
    seedHistory(f, ai.session(user.id, campaign).activeChatId!, 8, 3500);
    await runTurn(f, 'I climb the stairs.');
    assert.equal(summaries, 1, 'one summarizer request');
    const state = ai.session(user.id, campaign);
    assert.deepEqual(ai.journalPage(user.id, campaign, { kind: 'chapter' }).entries.map(entry => entry.title), ['Chapter 1']);
    assert.deepEqual(state.messages.filter(message => message.role === 'notice').map(message => message.text), ['Earlier messages were summarized for the GM.']);
    assert.equal(state.chatSummary, 'Working summary: the party reached the top.');
    assert.equal(state.digest, 'Digest: the tower stands above the harbor.');
    assert.equal(state.memoryStatus.chapters, 1);
  } finally {
    await f.close();
  }
});

test('retrying a turn after a provider failure resumes from its checkpoint and writes no second chapter', async () => {
  let summaries = 0, gmCalls = 0;
  const f = await fixture(request => {
    if (!request.tools) {
      summaries++;
      return summaryReply();
    }
    gmCalls++;
    return gmCalls === 1 ? json({ error: 'private upstream detail' }, 503) : completion('The lamp flickers. What do you do?');
  }, 'lean');
  try {
    const { ai, user, campaign } = f;
    seedHistory(f, ai.session(user.id, campaign).activeChatId!, 8, 3500);
    ai.start(user.id, campaign, { requestId: 'climb-1', message: 'I climb the stairs.' });
    let state = await finished(ai, user.id, campaign);
    assert.equal(state.run?.status, 'failed');
    assert.equal(summaries, 1);
    assert.equal(ai.journalPage(user.id, campaign, { kind: 'chapter' }).entries.length, 1);
    ai.retry(user.id, campaign, state.run!.id);
    state = await finished(ai, user.id, campaign);
    assert.equal(state.run?.status, 'complete');
    assert.equal(summaries, 1, 'the retry continues from the checkpoint without summarizing again');
    assert.equal(ai.journalPage(user.id, campaign, { kind: 'chapter' }).entries.length, 1);
    assert.equal(state.messages.filter(message => message.role === 'notice').length, 1);
    assert.equal(state.messages.at(-1)?.role, 'gm');
  } finally {
    await f.close();
  }
});

test('two invalid summaries write one fallback chapter from shared events and GM lead sentences, and keep the working summary', async () => {
  let summaries = 0;
  const f = await fixture(request => {
    if (!request.tools) {
      summaries++;
      return completion('Here is my summary, but without any JSON.');
    }
    return completion('The harbor waits. What do you do?');
  }, 'lean');
  try {
    const { ai, user, campaign, db } = f;
    const chat = ai.session(user.id, campaign).activeChatId!;
    db.prepare('UPDATE ai_chats SET summary = ? WHERE id = ?').run('Working summary: the crew is stranded at the pier.', chat);
    const say = (role: string, text: string) => ai.actions.message(campaign, chat, null, role, text);
    say('player', prose(3500, 'Player 1'));
    say('gm', prose(3500, 'The lantern gutters'));
    ai.actions.journal.event(campaign, chat, null, 'Harbor gate opened', 'The gate rose.', 'shared');
    say('player', prose(3500, 'Player 2'));
    ai.actions.journal.event(campaign, chat, null, 'Ledger found', 'Hidden from players.', 'gm');
    say('gm', prose(3500, 'Gulls scatter over the quay'));
    say('player', prose(3500, 'Player 3'));
    say('gm', prose(3500, 'Bells ring in the fog'));
    say('player', prose(3500, 'Player 4'));
    say('gm', prose(3500, 'Rain sweeps the quay'));
    await runTurn(f, 'I walk toward the bell.');
    assert.equal(summaries, 2, 'the summarizer is asked twice');
    const chapters = ai.journalPage(user.id, campaign, { kind: 'chapter' }).entries;
    assert.equal(chapters.length, 1, 'exactly one fallback chapter');
    assert.equal(chapters[0]!.body, 'Harbor gate opened. The lantern gutters. Gulls scatter over the quay.');
    const state = ai.session(user.id, campaign);
    assert.equal(state.chatSummary, 'Working summary: the crew is stranded at the pier.');
    assert.equal(state.messages.filter(message => message.role === 'notice').length, 1);
  } finally {
    await f.close();
  }
});

test('summarizer requests carry no tools and never include GM-only memory or campaign state', async () => {
  const secret = 'SECRET_KEEPER_HIDES_BELOW_THE_TOWER';
  const state = 'STATE_LOCATION_SALT_MARSH_LIGHTHOUSE';
  let gmCalls = 0;
  const f = await fixture(request => {
    if (!request.tools) return summaryReply();
    gmCalls++;
    if (gmCalls === 1) return completion(null, [
      call('memory', 'set_memory', { memory: secret }),
      call('state', 'update_state', { location: state, npcs: [{ name: 'Captain Vey', role: 'harbor master' }] }),
    ]);
    return completion('The tide turns. What do you do?');
  }, 'lean');
  try {
    const { ai, user, campaign } = f;
    await runTurn(f, 'Check the harbor.');
    seedHistory(f, ai.session(user.id, campaign).activeChatId!, 8, 3500);
    const before = f.requests.length;
    await runTurn(f, 'I walk to the tower.');
    const sent = f.requests.slice(before);
    const summaryRequests = sent.filter(request => !request.tools);
    assert.equal(summaryRequests.length, 1, 'one summarizer request');
    assert.equal('tools' in summaryRequests[0]!.body, false, 'the summarizer request has no tools field');
    const summaryText = JSON.stringify(summaryRequests[0]!.body);
    for (const leaked of [secret, state, 'Captain Vey']) assert.ok(!summaryText.includes(leaked), 'the summarizer saw ' + leaked);
    const gmText = JSON.stringify(sent.find(request => request.tools)!.body);
    assert.ok(gmText.includes(secret) && gmText.includes(state), 'the GM request still carries its secrets and state');
  } finally {
    await f.close();
  }
});

test('a 60-turn balanced campaign keeps every model request inside the memory budget and compacts at least twice', async t => {
  let replies = 0;
  const f = await fixture(request => {
    if (!request.tools) return summaryReply();
    replies++;
    return completion(prose(1200, 'Reply ' + replies));
  });
  try {
    const { ai, user, campaign } = f;
    for (let index = 1; index <= 60; index++) await runTurn(f, prose(300, 'Player ' + index));
    assert.equal(replies, 60);
    const limit = 24000 + 5000;
    const tokens = (items: { content: string | null }[]) => Math.ceil(items.reduce((sum, item) => sum + (item.content ?? '').length, 0) / 3.5);
    let largest = 0;
    for (const request of f.requests) {
      const messages = request.body.messages as { role: string; content: string | null }[];
      const memory = tokens(messages.slice(1).filter(item => item.role === 'system'));
      const history = tokens(messages.filter(item => item.role !== 'system'));
      largest = Math.max(largest, memory + history);
      assert.ok(memory + history <= limit, 'a request estimated at ' + String(memory + history) + ' tokens exceeds ' + String(limit));
    }
    t.diagnostic('largest estimated request: ' + String(largest) + ' tokens against a limit of ' + String(limit));
    const summaryRequests = f.requests.filter(request => !request.tools).length;
    const chapters = ai.journalPage(user.id, campaign, { kind: 'chapter' }).entries.length;
    assert.ok(chapters >= 2, 'at least two compactions happened');
    assert.equal(chapters, summaryRequests, 'each compaction writes exactly one chapter');
    const lastTurnRequest = f.requests.filter(request => request.tools).at(-1)!;
    assert.ok(JSON.stringify(lastTurnRequest.body.messages).includes(prose(300, 'Player 60')), 'the newest player message is in the final request');
  } finally {
    await f.close();
  }
});

test('every model request in a session names that session as its provider session, including compaction and the end turn', async () => {
  const f = await fixture(request => request.tools ? completion('Noted. What do you do?') : summaryReply(), 'lean');
  try {
    const { ai, user, campaign } = f;
    const chatA = ai.session(user.id, campaign).activeChatId!;
    seedHistory(f, chatA, 8, 3500);
    let mark = f.requests.length;
    await runTurn(f, 'I step forward.');
    everyRequestUses(f, mark, chatA, 'automatic compaction and turn');
    seedHistory(f, chatA, 6, 3500, 8);
    mark = f.requests.length;
    ai.compactChat(user.id, campaign, { chatId: chatA });
    await finished(ai, user.id, campaign);
    everyRequestUses(f, mark, chatA, 'manual compaction');
    const chatB = ai.createChat(user.id, campaign, { title: 'Session B' }).chat.id;
    mark = f.requests.length;
    await runTurn(f, 'Hello in session B.', chatB);
    everyRequestUses(f, mark, chatB, 'session B turn');
    mark = f.requests.length;
    ai.endChat(user.id, campaign, { chatId: chatB });
    await finished(ai, user.id, campaign);
    everyRequestUses(f, mark, chatB, 'session B end');
    assert.equal(ai.session(user.id, campaign, chatB).chats.find(row => row.id === chatB)?.status, 'ended');
    assert.equal(new Set(f.requests.map(request => request.session)).size, 2, 'only the two sessions were used');
  } finally {
    await f.close();
  }
});

test('tool results, state lists and rule searches stay within their caps', async () => {
  let gmCalls = 0;
  const f = await fixture(request => {
    if (!request.tools) return summaryReply();
    gmCalls++;
    if (gmCalls === 1) return completion(null, [call('rules', 'search_rules', { query: '', category: 'environments' })]);
    return completion('The road is quiet. What do you do?');
  });
  try {
    const { ai, campaign } = f;
    await runTurn(f, 'What threatens the road?');
    const toolResult = (f.requests[1]!.body.messages as { role: string; tool_call_id?: string; content: string }[]).find(item => item.role === 'tool');
    assert.ok(toolResult, 'the search result went back to the model');
    assert.ok(toolResult.content.length <= 6000, 'a tool result is at most 6000 characters');
    const turn = currentTurn(f);
    const full = act(f, turn, 'search_rules', { query: '', category: 'environments' }) as unknown[];
    assert.equal(full.length, 6, 'search_rules returns at most six results');
    assert.ok(JSON.parse(toolResult.content) !== undefined, 'a cut tool result is still valid JSON');
    assert.ok((act(f, turn, 'search_rules', { query: 'a', category: 'items' }) as unknown[]).length <= 6);
    const thread = (index: number) => ({ id: 'thread-' + String(index), title: 'Thread ' + String(index) });
    const npc = (index: number) => ({ id: 'npc-' + String(index), name: 'NPC ' + String(index) });
    const threads = Array.from({ length: 13 }, (_, index) => thread(index));
    assert.throws(() => act(f, turn, 'update_state', { threads }), { message: /^Invalid state: at most 12 threads/ });
    assert.equal(ai.actions.readState(campaign).threads.length, 0, 'a refused update writes nothing');
    act(f, turn, 'update_state', { threads: threads.slice(0, 12) });
    assert.equal(ai.actions.readState(campaign).threads.length, 12);
    assert.throws(() => act(f, turn, 'update_state', { threads: [thread(12)] }), { message: /^Invalid state: at most 12 threads/ });
    const npcs = Array.from({ length: 31 }, (_, index) => npc(index));
    assert.throws(() => act(f, turn, 'update_state', { npcs }), { message: /^Invalid state: at most 30 NPCs/ });
    assert.equal(ai.actions.readState(campaign).npcs.length, 0);
    act(f, turn, 'update_state', { npcs: npcs.slice(0, 30) });
    assert.equal(ai.actions.readState(campaign).npcs.length, 30);
    assert.throws(() => act(f, turn, 'update_state', { npcs: [npc(30)] }), { message: /^Invalid state: at most 30 NPCs/ });
  } finally {
    await f.close();
  }
});

test('creating a session starts no GM turn, and Begin opens it with a recap once the journal has entries', async () => {
  const f = await fixture(request => request.tools ? completion('The keeper waits. What do you do?') : summaryReply());
  try {
    const { ai, user, campaign, db } = f;
    const quiet = ai.createChat(user.id, campaign, { title: 'Quiet start' }).chat;
    ai.createChat(user.id, campaign, { title: 'Session 3' });
    ai.addJournal(user.id, campaign, { title: 'The lighthouse went dark', body: 'The beacon failed on the third night.', shared: true });
    assert.equal(f.requests.length, 0, 'creating sessions and adding a journal entry send no model request');
    assert.equal(ai.session(user.id, campaign).run, null, 'no turn is recorded');
    ai.begin(user.id, campaign, { chatId: quiet.id });
    const state = await finished(ai, user.id, campaign);
    assert.equal(state.run?.status, 'complete');
    assert.equal(state.run?.chatId, quiet.id);
    const request = f.requests.at(-1)!;
    const messages = request.body.messages as { role: string; content: string | null }[];
    assert.equal(request.tools, true);
    assert.equal(messages.filter(item => item.role === 'user').at(-1)?.content, OPENING_INSTRUCTION, 'the opening instruction is the final user message');
    assert.equal(messages.at(-1)?.role, 'system', 'the table snapshot follows the instruction');
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ai_messages WHERE chat_id = ? AND role = 'player'").get(quiet.id) as { n: number }).n, 0, 'a recap stores no player message');
    assert.equal(ai.session(user.id, campaign, quiet.id).messages.length, 1, 'only the GM opening is stored');
    assert.throws(() => ai.begin(user.id, campaign, { chatId: quiet.id }), /already begun/, 'a second Begin is refused');
    assert.equal(f.requests.length, 1, 'the refused Begin sends nothing');
  } finally {
    await f.close();
  }
});

test('Begin without journal entries stores the player opening message and sends no recap instruction', async () => {
  const f = await fixture(request => request.tools ? completion('The harbor waits. What do you do?') : summaryReply());
  try {
    const { ai, user, campaign } = f;
    const chat = ai.session(user.id, campaign).activeChatId!;
    assert.equal(f.requests.length, 0, 'the first session starts nothing by itself');
    ai.begin(user.id, campaign, { chatId: chat });
    const state = await finished(ai, user.id, campaign);
    assert.equal(state.run?.status, 'complete');
    const messages = f.requests.at(-1)!.body.messages as { role: string; content: string | null }[];
    assert.ok(!messages.some(item => item.content === OPENING_INSTRUCTION), 'no recap instruction without journal entries');
    assert.equal(messages.filter(item => item.role === 'user').at(-1)?.content?.startsWith('Begin our adventure.'), true, 'the player opening message is sent');
    const stored = ai.session(user.id, campaign, chat).messages;
    assert.deepEqual(stored.map(message => message.role), ['player', 'gm']);
    assert.match(stored[0]!.text, /^Begin our adventure\./);
    assert.throws(() => ai.begin(user.id, campaign, { chatId: chat }), /already begun/);
  } finally {
    await f.close();
  }
});

test('an opening recap cut off before its first checkpoint keeps its instruction after a restart', async () => {
  let gmCalls = 0;
  const f = await fixture(request => {
    if (!request.tools) return summaryReply();
    gmCalls++;
    return gmCalls === 1 ? json({ error: 'upstream unavailable' }, 503) : completion('The lamp is lit. What do you do?');
  });
  let restarted: AiService | null = null;
  try {
    const { ai, user, campaign, db } = f;
    ai.addJournal(user.id, campaign, { title: 'The bell rang', body: 'The harbor bell rang at dusk.', shared: true });
    const chat = ai.createChat(user.id, campaign, { title: 'Session 2' }).chat.id;
    ai.begin(user.id, campaign, { chatId: chat });
    let state = await finished(ai, user.id, campaign);
    assert.equal(state.run?.status, 'failed');
    const turn = state.run!.id;
    db.prepare("UPDATE ai_turns SET checkpoint = '[]' WHERE id = ?").run(turn);
    restarted = new AiService(db, f.campaigns, f.vault, f.provider, () => {});
    restarted.retry(user.id, campaign, turn);
    state = await finished(restarted, user.id, campaign);
    assert.equal(state.run?.status, 'complete');
    const messages = f.requests.at(-1)!.body.messages as { role: string; content: string | null }[];
    assert.equal(messages.filter(item => item.role === 'user').at(-1)?.content, OPENING_INSTRUCTION, 'the retried recap still carries its instruction');
  } finally {
    await restarted?.close();
    await f.close();
  }
});

test('start refuses request IDs that name internal turns', async () => {
  const f = await fixture(request => request.tools ? completion('Noted.') : summaryReply());
  try {
    const { ai, user, campaign } = f;
    const chat = ai.session(user.id, campaign).activeChatId!;
    for (const requestId of ['open:' + chat, 'begin:one', 'compact:one', 'end:one', 'resolve:one']) {
      assert.throws(() => ai.start(user.id, campaign, { requestId, message: 'Hello.', chatId: chat }), /Invalid request ID/);
    }
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});

test('Maximum uses 60 percent of the saved context window, the fixed sizes keep their caps, and an unknown window falls back to 48,000 tokens', async () => {
  const f = await fixture(request => request.tools ? completion('Noted.') : summaryReply());
  try {
    const { ai, user, campaign, db } = f;
    assert.deepEqual(ai.session(user.id, campaign).budgets, { lean: 12000, balanced: 24000, rich: 48000, maximum: 48000 }, 'an unknown window keeps the fixed caps');
    db.prepare('UPDATE ai_credentials SET context_window = 1000000 WHERE user_id = ?').run(user.id);
    const view = ai.session(user.id, campaign);
    assert.deepEqual(view.budgets, { lean: 12000, balanced: 24000, rich: 48000, maximum: 600000 });
    assert.equal(view.connection?.contextWindow, 1000000);
    ai.configure(user.id, campaign, { budget: 'maximum', heroId: f.setup.heroId });
    assert.equal(ai.session(user.id, campaign).memoryStatus.budgetTokens, 600000);
    ai.configure(user.id, campaign, { budget: 'balanced', heroId: f.setup.heroId });
    assert.equal(ai.session(user.id, campaign).memoryStatus.budgetTokens, 24000);
    db.prepare('UPDATE ai_credentials SET context_window = 128000 WHERE user_id = ?').run(user.id);
    assert.equal(ai.session(user.id, campaign).budgets.maximum, 76800);
    db.prepare('UPDATE ai_credentials SET context_window = 16000 WHERE user_id = ?').run(user.id);
    assert.equal(ai.session(user.id, campaign).budgets.balanced, 9600, 'a small window caps even the fixed sizes');
  } finally {
    await f.close();
  }
});

test('a Maximum backlog is summarized in batches of about 40,000 estimated tokens, one chapter per batch, and the newest 30 percent stays verbatim', async t => {
  const f = await fixture(request => request.tools ? completion('The tide turns. What do you do?') : summaryReply(), 'maximum');
  try {
    const { ai, user, campaign, db } = f;
    const chat = ai.session(user.id, campaign).activeChatId!;
    db.prepare('UPDATE ai_credentials SET context_window = 1000000 WHERE user_id = ?').run(user.id);
    seedHistory(f, chat, 400, 3500);
    await runTurn(f, 'I go on.');
    const summarizers = f.requests.filter(request => !request.tools);
    t.diagnostic('summarizer requests: ' + String(summarizers.length));
    assert.ok(summarizers.length >= 2, 'a backlog this large takes several summarizer requests');
    for (const request of summarizers) {
      const content = String((request.body.messages as { content: string | null }[]).at(-1)?.content ?? '');
      assert.ok(Math.ceil(content.length / 3.5) <= 41500, 'a summarizer request carries about 40,000 tokens of messages, not ' + String(Math.ceil(content.length / 3.5)));
    }
    assert.equal(ai.journalPage(user.id, campaign, { kind: 'chapter' }).entries.length, summarizers.length, 'each batch writes exactly one chapter');
    assert.equal(ai.session(user.id, campaign, chat).messages.filter(message => message.role === 'notice').length, 1, 'the GM is told once');
    const through = (db.prepare('SELECT summarized_through FROM ai_chats WHERE id = ?').get(chat) as { summarized_through: number }).summarized_through;
    const tail = db.prepare("SELECT text FROM ai_messages WHERE chat_id = ? AND rowid > ? AND role IN ('player', 'gm', 'roll')").all(chat, through) as { text: string }[];
    const tailTokens = tail.reduce((sum, row) => sum + Math.ceil(row.text.length / 3.5), 0);
    assert.ok(tailTokens <= 0.3 * 600000, 'the verbatim tail stays within 30 percent of the budget, estimated at ' + String(tailTokens));
    assert.ok(tailTokens > 0.2 * 600000, 'the verbatim tail is not cut far below its share, estimated at ' + String(tailTokens));
    const turn = lastTurnRequest(f);
    const messages = turn.body.messages as { role: string; content: string | null }[];
    const memory = messages.slice(1).filter(item => item.role === 'system').reduce((sum, item) => sum + Math.ceil((item.content ?? '').length / 3.5), 0);
    const history = messages.filter(item => item.role !== 'system').reduce((sum, item) => sum + Math.ceil((item.content ?? '').length / 3.5), 0);
    assert.ok(memory + history <= 605000, 'the GM request stays inside the Maximum budget');
  } finally {
    await f.close();
  }
});

test('Maximum keeps the newest twelve chapters in view, oldest first', async () => {
  const f = await fixture(request => request.tools ? completion('Noted. What do you do?') : summaryReply(), 'maximum');
  try {
    const { ai, user, campaign } = f;
    const chat = ai.session(user.id, campaign).activeChatId!;
    for (let index = 1; index <= 14; index++) ai.actions.journal.chapter(campaign, chat, null, prose(900, 'Chapter seed ' + String(index)), false);
    await runTurn(f, 'I look around.');
    const chapters = memoryBlocks(lastTurnRequest(f).body).filter(block => block.startsWith('Chapter the players have already read'));
    assert.equal(chapters.length, 12);
    assert.ok(chapters[0]!.includes('Chapter seed 3') && chapters.at(-1)!.includes('Chapter seed 14'), 'the newest twelve chapters, oldest first');
  } finally {
    await f.close();
  }
});

test('renaming relabels a session journal entries, a running session cannot be deleted, and deleting keeps its entries under the label', async () => {
  const hold = gate();
  const f = await fixture(async request => {
    if (!request.tools) return summaryReply();
    await hold.wait;
    return completion('The lamps dim. What do you do?');
  });
  try {
    const { ai, user, campaign, db } = f;
    const chat = ai.session(user.id, campaign).activeChatId!;
    ai.addJournal(user.id, campaign, { title: 'Dockside oath', body: 'Ash swore an oath to the harbor master.' });
    ai.renameChat(user.id, campaign, chat, { title: 'The Lighthouse' });
    assert.equal(ai.journalPage(user.id, campaign, {}).entries.find(entry => entry.title === 'Dockside oath')?.chatLabel, 'The Lighthouse');
    ai.start(user.id, campaign, { requestId: 'light-1', message: 'Light the lamp.', chatId: chat });
    assert.throws(() => ai.deleteChat(user.id, campaign, chat), AiConflict);
    hold.open();
    await finished(ai, user.id, campaign);
    assert.deepEqual(ai.deleteChat(user.id, campaign, chat), { removed: true });
    const counts = db.prepare('SELECT (SELECT COUNT(*) FROM ai_messages WHERE chat_id = ?) AS messages, (SELECT COUNT(*) FROM ai_turns WHERE chat_id = ?) AS turns, (SELECT COUNT(*) FROM ai_chats WHERE id = ?) AS chats').get(chat, chat, chat) as { messages: number; turns: number; chats: number };
    assert.deepEqual(counts, { messages: 0, turns: 0, chats: 0 });
    const kept = ai.journalPage(user.id, campaign, {}).entries.find(entry => entry.title === 'Dockside oath');
    assert.equal(kept?.chatId, null, 'the journal entry is detached from the deleted session');
    assert.equal(kept?.chatLabel, 'The Lighthouse', 'the journal keeps the session label');
    assert.equal(ai.session(user.id, campaign).messages.length, 0);
  } finally {
    await f.close();
  }
});

test('the transcript returns the newest 60 messages and pages back through earlier cursors', async () => {
  const f = await fixture(() => completion('Ready.'));
  try {
    const { ai, user, campaign } = f;
    const chat = ai.session(user.id, campaign).activeChatId!;
    for (let index = 1; index <= 130; index++) ai.actions.message(campaign, chat, null, index % 2 === 1 ? 'player' : 'gm', 'Message ' + String(index));
    const newest = ai.session(user.id, campaign, chat);
    assert.equal(newest.messages.length, 60);
    assert.equal(newest.messages[0]!.text, 'Message 71');
    assert.equal(newest.messages[59]!.text, 'Message 130');
    assert.ok(newest.earlierCursor, 'an earlier cursor is offered');
    const middle = ai.session(user.id, campaign, chat, newest.earlierCursor!);
    assert.equal(middle.messages.length, 60);
    assert.equal(middle.messages[0]!.text, 'Message 11');
    assert.equal(middle.messages[59]!.text, 'Message 70');
    assert.ok(middle.earlierCursor);
    const oldest = ai.session(user.id, campaign, chat, middle.earlierCursor!);
    assert.deepEqual(oldest.messages.map(message => message.text), Array.from({ length: 10 }, (_, index) => 'Message ' + String(index + 1)));
    assert.equal(oldest.earlierCursor, null);
  } finally {
    await f.close();
  }
});

test('AI HTTP routes cover sessions, journal writes, setup and ended-session errors, and require the Origin header', async () => {
  const hold = gate();
  const f = await fixture(async request => {
    if (!request.tools) return summaryReply();
    await hold.wait;
    return completion('Ready. What do you do?');
  });
  const { app, routes, cookie } = await httpApp(f);
  const base = '/api/campaigns/' + f.campaign + '/ai';
  const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) => app.inject({ method, url: base + url, headers: { cookie, origin: ORIGIN }, payload });
  try {
    assert.equal((await app.inject({ method: 'POST', url: base + '/chats', headers: { cookie }, payload: {} })).statusCode, 403, 'a mutation without Origin is refused');
    const created = await send('POST', '/chats', { title: 'Harbor' });
    assert.equal(created.statusCode, 200);
    const chat = created.json().chat.id as string;
    assert.equal((await send('POST', '/turn', { requestId: 'http-1', message: 'Hello from the dock.', chatId: chat })).statusCode, 200);
    const busy = await send('DELETE', '/chats/' + chat);
    assert.equal(busy.statusCode, 409, 'a running turn blocks deleting its session');
    hold.open();
    await finished(routes, f.user.id, f.campaign);
    assert.equal((await send('PATCH', '/chats/' + chat, { title: 'Lighthouse' })).json().chat.title, 'Lighthouse');
    const oath = (await send('POST', '/journal', { title: 'Lighthouse oath', body: 'Ash promised the keeper a lamp.', shared: true })).json().entry.id as string;
    const ledger = (await send('POST', '/journal', { title: 'Secret ledger', body: 'The ledger hides a debt.' })).json().entry.id as string;
    const notes = (await app.inject({ method: 'GET', url: base + '/journal?kind=note&q=ledger', headers: { cookie } })).json().entries as { title: string }[];
    assert.deepEqual(notes.map(entry => entry.title), ['Secret ledger']);
    assert.equal((await app.inject({ method: 'GET', url: base + '/journal?kind=poem', headers: { cookie } })).statusCode, 400);
    assert.equal((await send('PATCH', '/journal/' + oath, { title: 'Lighthouse oath (sworn)' })).json().entry.title, 'Lighthouse oath (sworn)');
    assert.deepEqual((await send('DELETE', '/journal/' + ledger)).json(), { removed: true });
    act(f, currentTurn(f), 'create_scene', { name: 'Pier' });
    const eventId = f.ai.journalPage(f.user.id, f.campaign, { kind: 'event' }).entries[0]!.id;
    const deniedEvent = await send('DELETE', '/journal/' + eventId);
    assert.equal(deniedEvent.statusCode, 400);
    assert.match(String(deniedEvent.json().error), /^Invalid action: journal events are read only/);
    const badBudget = await send('PUT', '/setup', { budget: 'huge', heroId: f.setup.heroId });
    assert.equal(badBudget.statusCode, 400);
    assert.equal(badBudget.json().error, 'Invalid memory size');
    assert.equal((await send('PUT', '/setup', { budget: 'rich', heroId: f.setup.heroId, premise: 'Find the keeper.' })).statusCode, 200);
    assert.equal((await send('GET', '')).json().budget, 'rich');
  assert.equal((await send('PUT', '/setup', { budget: 'maximum', heroId: f.setup.heroId })).statusCode, 200, 'Maximum is a memory size');
  assert.equal((await send('GET', '')).json().budgets.maximum, 48000, 'with no saved context window, Maximum falls back to 48,000 tokens');
    const compacting = await send('POST', '/compact', { chatId: chat });
    assert.equal(compacting.statusCode, 200, 'an open session can be compacted');
    assert.equal((await finished(routes, f.user.id, f.campaign)).run?.kind, 'compact');
    assert.equal((await send('POST', '/end', { chatId: chat })).statusCode, 200);
    await finished(routes, f.user.id, f.campaign);
    const late = await send('POST', '/turn', { requestId: 'late-1', message: 'Still there?', chatId: chat });
    assert.equal(late.statusCode, 400, 'an ended session refuses turns');
    assert.match(String(late.json().error), /ended/);
  const lateBegin = await send('POST', '/begin', { chatId: chat });
  assert.equal(lateBegin.statusCode, 400, 'an ended session cannot be begun');
  assert.match(String(lateBegin.json().error), /ended/);
    const compact = await send('POST', '/compact', { chatId: chat });
    assert.equal(compact.statusCode, 400, 'an ended session refuses compaction');
    assert.equal((await send('DELETE', '/chats/' + chat)).statusCode, 200);
    assert.ok(!(await send('GET', '')).json().chats.some((row: { id: string }) => row.id === chat));
  } finally {
    await app.close();
    await f.close();
  }
});

// ---- Memory limits: set_memory size, the memory cap, preparations, get_context, state text and the snapshot ----

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const CHAPTER_SEEDS = ['The first night', 'The second night', 'The third night'];
const MEMORY_TOO_LONG = 'Invalid memory: at most 4000 characters. Rewrite a shorter version.';

/** The dynamic memory blocks of a GM request: system messages after the static prompt, without the per-turn snapshot. */
function memoryBlocks(body: any): string[] {
  const messages = body.messages as { role: string; content: string | null }[];
  return messages
    .slice(1)
    .filter(item => item.role === 'system' && !(item.content ?? '').startsWith('Current table snapshot'))
    .map(item => item.content ?? '');
}

/** Characters the server counts as memory: the sum of the block lengths. The cap is 17000 characters, about 4860 estimated tokens. */
function memoryChars(blocks: string[]): number {
  return blocks.reduce((sum, block) => sum + block.length, 0);
}

/** The per-turn snapshot: the JSON that follows its header line. */
function snapshotOf(body: any): { text: string; data: any } {
  const messages = body.messages as { role: string; content: string | null }[];
  const message = messages.find(item => (item.content ?? '').startsWith('Current table snapshot'));
  if (!message?.content) throw new Error('the request has no snapshot');
  const text = message.content.slice(message.content.indexOf('\n') + 1);
  return { text, data: JSON.parse(text) as any };
}

/** The newest GM request that carried tools. */
function lastTurnRequest(f: Fixture): Captured {
  const request = f.requests.filter(item => item.tools).at(-1);
  if (!request) throw new Error('no turn request was sent');
  return request;
}

/** The content of the tool message that answers call "id", searching the requests from index "from" onward. */
function toolContent(f: Fixture, from: number, id: string): string {
  for (const request of f.requests.slice(from)) {
    const message = (request.body.messages as { role: string; tool_call_id?: string; content: string }[]).find(item => item.role === 'tool' && item.tool_call_id === id);
    if (message) return message.content;
  }
  throw new Error('no tool result for ' + id);
}

/** Setup, digest, session summary and a full campaign state: the parts of memory the cap never trims, close to their largest sizes. */
function fillUntrimmable(f: Fixture, turn: string, chat: string): void {
  f.ai.configure(f.user.id, f.campaign, { premise: prose(1500, 'Premise of the drowned coast'), tone: prose(300, 'Tone of the drowned coast'), heroId: f.setup.heroId, budget: 'balanced' });
  f.db.prepare('UPDATE campaign_ai SET digest = ? WHERE campaign_id = ?').run(prose(1800, 'Digest of the campaign'), f.campaign);
  f.db.prepare('UPDATE ai_chats SET summary = ? WHERE id = ?').run(prose(2000, 'Summary of this session'), chat);
  act(f, turn, 'update_state', {
    location: 'Harbor Wall',
    timeOfDay: 'dusk',
    objective: 'Find the keeper',
    threads: Array.from({ length: 12 }, (_, index) => ({ id: 'thread-' + String(index), title: prose(160, 'Thread ' + String(index)), status: 'open', note: prose(160, 'Note ' + String(index)) })),
    facts: Array.from({ length: 20 }, (_, index) => prose(240, 'Fact ' + String(index))),
  });
}

function addChapters(f: Fixture, chat: string, size: number): void {
  for (const seed of CHAPTER_SEEDS) f.ai.actions.journal.chapter(f.campaign, chat, null, prose(size, seed), false);
}

/** Thirteen image assets, the newest last, and one PDF that is newer still. Only images may appear in get_context. */
function addAssets(f: Fixture): void {
  for (let index = 1; index <= 13; index++) {
    f.db.prepare("INSERT INTO campaign_assets(id, campaign_id, uploaded_by, name, category, media_type, size, storage_name, visibility, created_at) VALUES (?, ?, ?, ?, 'map', 'image/png', 1000, ?, 'shared', ?)")
      .run('asset-' + String(index), f.campaign, f.user.id, 'map-' + String(index) + '.png', 'stored-' + String(index), '2026-03-01T10:00:' + String(index).padStart(2, '0') + '.000Z');
  }
  f.db.prepare("INSERT INTO campaign_assets(id, campaign_id, uploaded_by, name, category, media_type, size, storage_name, visibility, created_at) VALUES ('asset-notes', ?, ?, 'notes.pdf', 'handout', 'application/pdf', 1000, 'stored-notes', 'shared', '2026-03-01T11:00:00.000Z')")
    .run(f.campaign, f.user.id);
}

test('set_memory refuses more than 4000 characters without saving, through the model and through PUT /memory', async () => {
  const kept = 'The keeper hides below the tower.';
  const replies: (() => Response)[] = [
    () => completion(null, [call('keep', 'set_memory', { memory: kept })]),
    () => completion('The shutters rattle. What do you do?'),
    () => completion(null, [call('too-long', 'set_memory', { memory: 'x'.repeat(4001) })]),
    () => completion('The shutters go still. What do you do?'),
  ];
  const f = await fixture(request => request.tools ? (replies.shift() ?? (() => completion('The wind holds.')))() : summaryReply());
  try {
    const { ai, user, campaign } = f;
    await runTurn(f, 'Keep watch.');
    assert.equal(ai.session(user.id, campaign).memory, kept);
    const before = f.requests.length;
    await runTurn(f, 'Look for the lamp.');
    assert.deepEqual(JSON.parse(toolContent(f, before, 'too-long')), { error: MEMORY_TOO_LONG });
    assert.equal(ai.session(user.id, campaign).memory, kept, 'a refused memory is not saved');
    const turn = currentTurn(f);
    assert.throws(() => act(f, turn, 'set_memory', { memory: 'x'.repeat(4001) }), { message: MEMORY_TOO_LONG });
    assert.deepEqual(act(f, turn, 'set_memory', { memory: 'y'.repeat(4000) }), { saved: true }, 'exactly 4000 characters is accepted');
    assert.equal(ai.session(user.id, campaign).memory.length, 4000);
    const { app, cookie } = await httpApp(f);
    try {
      const url = '/api/campaigns/' + campaign + '/ai/memory';
      const refused = await app.inject({ method: 'PUT', url, headers: { cookie, origin: ORIGIN }, payload: { memory: 'x'.repeat(4001) } });
      assert.equal(refused.statusCode, 400);
      assert.deepEqual(refused.json(), { error: 'Invalid memory: at most 4000 characters.' });
      assert.equal(ai.session(user.id, campaign).memory.length, 4000, 'the HTTP refusal saves nothing');
      const accepted = await app.inject({ method: 'PUT', url, headers: { cookie, origin: ORIGIN }, payload: { memory: 'z'.repeat(4000) } });
      assert.equal(accepted.statusCode, 200);
    } finally {
      await app.close();
    }
  } finally {
    await f.close();
  }
});

test('over the memory cap, the oldest chapter goes first and the untrimmable parts stay whole', async () => {
  const f = await fixture(request => request.tools ? completion('The harbor is still. What do you do?') : summaryReply());
  try {
    const { ai, campaign } = f;
    const chat = ai.session(f.user.id, campaign).activeChatId!;
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    fillUntrimmable(f, turn, chat);
    const secret = prose(3000, 'Secret of the keeper');
    act(f, turn, 'set_memory', { memory: secret });
    addChapters(f, chat, 1300);
    await runTurn(f, 'Look around.');
    const blocks = memoryBlocks(lastTurnRequest(f).body);
    const text = blocks.join('\n');
    assert.ok(memoryChars(blocks) <= 17000, 'memory is within 17000 characters');
    const kept = CHAPTER_SEEDS.filter(seed => text.includes(seed + '.'));
    assert.deepEqual(kept, CHAPTER_SEEDS.slice(-1), 'only the newest chapter fits, so the two oldest are dropped first');
    assert.ok(text.includes(secret), 'the secrets are kept whole');
    assert.ok(!text.includes('shortened to fit'), 'the secrets are not shortened');
    assert.ok(text.includes('Premise of the drowned coast') && text.includes('Digest of the campaign') && text.includes('Summary of this session') && text.includes('Location: Harbor Wall'), 'setup, digest, session summary and state are never trimmed');
  } finally {
    await f.close();
  }
});

test('when no chapter fits, the preparations block is cut to its first lines', async () => {
  const f = await fixture(request => request.tools ? completion('The harbor is still. What do you do?') : summaryReply());
  try {
    const { ai, campaign } = f;
    const chat = ai.session(f.user.id, campaign).activeChatId!;
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    fillUntrimmable(f, turn, chat);
    act(f, turn, 'write_prep', { kind: 'setting', title: 'The Drowned Coast', fields: { premise: prose(600, 'Setting premise'), tone: prose(600, 'Setting tone'), locations: prose(600, 'Setting locations'), factions: prose(600, 'Setting factions'), secrets: prose(600, 'Setting secrets'), agreements: prose(600, 'Setting agreements') } });
    const secret = prose(3000, 'Secret of the keeper');
    act(f, turn, 'set_memory', { memory: secret });
    addChapters(f, chat, 1300);
    await runTurn(f, 'Look around.');
    const blocks = memoryBlocks(lastTurnRequest(f).body);
    const text = blocks.join('\n');
    assert.ok(memoryChars(blocks) <= 17000, 'memory is within 17000 characters');
    for (const seed of CHAPTER_SEEDS) assert.ok(!text.includes(seed + '.'), 'every chapter goes before the preparations are cut');
    const preparations = blocks.find(block => block.startsWith('GM preparations (GM only):'));
    assert.ok(preparations, 'the preparations block is kept, cut to fit');
    assert.ok(preparations.length < 2500, 'the cut block is shorter than its own limit');
    assert.ok(preparations.includes('Setting: The Drowned Coast'), 'the setting title is kept');
    assert.ok(preparations.includes('premise: ' + prose(600, 'Setting premise')), 'the first lines are kept');
    assert.ok(!preparations.includes('agreements: '), 'the trailing lines are cut');
    assert.ok(preparations.trimEnd().endsWith('(preparations shortened to fit the memory limit)'), 'the shortened block ends with its notice');
    assert.ok(text.includes(secret), 'the secrets are kept whole');
  } finally {
    await f.close();
  }
});

test('legacy secrets longer than the new limit still keep the memory parts within 17000 characters', async () => {
  const f = await fixture(request => request.tools ? completion('The harbor is still. What do you do?') : summaryReply());
  try {
    const { campaign } = f;
    const chat = f.ai.session(f.user.id, campaign).activeChatId!;
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    fillUntrimmable(f, turn, chat);
    const legacy = 'SECRET-START. ' + prose(8970, 'Legacy filler') + ' SECRET-TAIL-END.';
    f.db.prepare('UPDATE campaign_ai SET memory = ? WHERE campaign_id = ?').run(legacy, campaign);
    addChapters(f, chat, 1300);
    await runTurn(f, 'Look around.');
    const blocks = memoryBlocks(lastTurnRequest(f).body);
    const text = blocks.join('\n');
    assert.ok(memoryChars(blocks) <= 17000, 'memory is within 17000 characters');
    assert.ok(text.includes('SECRET-START'), 'the start of the legacy secrets is in the prompt');
    const survivors = CHAPTER_SEEDS.filter(seed => text.includes(seed + '.'));
    assert.deepEqual(survivors, CHAPTER_SEEDS.slice(CHAPTER_SEEDS.length - survivors.length), 'the oldest chapters are dropped first, leaving the newest: ' + survivors.join(', '));
  } finally {
    await f.close();
  }
});

// The trimming order is unit-tested on fitMemory. End-to-end tests cannot reach the secrets branch: the untouched parts and the 4000-character secrets limit stay under 17000 characters together, so preparations absorb any excess first.
const chapterPart = (id: string): MemoryPart => ({ kind: 'chapter', text: 'Chapter ' + id + ' ' + 'c'.repeat(1290) });

test('fitMemory drops the oldest chapter first and leaves the other parts alone when one chapter is enough', () => {
  const parts: MemoryPart[] = [
    { kind: 'setup', text: 'S'.repeat(1000) },
    { kind: 'preparation', text: 'P'.repeat(2000) },
    chapterPart('1'), chapterPart('2'), chapterPart('3'),
    { kind: 'secrets', text: 'K'.repeat(3000) },
    { kind: 'state', text: 'T'.repeat(6000) },
    { kind: 'summary', text: 'U'.repeat(2000) },
  ];
  const kept = fitMemory(parts, 17000);
  assert.deepEqual(kept.filter(part => part.kind === 'chapter').map(part => part.text.charAt(8)), ['2', '3'], 'the oldest chapter goes first');
  assert.deepEqual(kept.filter(part => part.kind !== 'chapter'), parts.filter(part => part.kind !== 'chapter'), 'the other parts are untouched');
  assert.ok(kept.reduce((sum, part) => sum + part.text.length, 0) <= 17000);
});

test('fitMemory shortens the preparations once every chapter is gone, and leaves the secrets alone', () => {
  const parts: MemoryPart[] = [
    { kind: 'setup', text: 'S'.repeat(1000) },
    { kind: 'preparation', text: 'P'.repeat(2500) },
    chapterPart('1'), chapterPart('2'), chapterPart('3'),
    { kind: 'secrets', text: 'K'.repeat(6000) },
    { kind: 'state', text: 'T'.repeat(6000) },
    { kind: 'summary', text: 'U'.repeat(2000) },
  ];
  const kept = fitMemory(parts, 17000);
  assert.equal(kept.filter(part => part.kind === 'chapter').length, 0, 'every chapter goes first');
  const preparations = kept.find(part => part.kind === 'preparation')!;
  assert.ok(preparations.text.startsWith('PPP'), 'the first lines are kept');
  assert.ok(preparations.text.endsWith('(preparations shortened to fit the memory limit)'), 'the shortened block ends with its notice');
  assert.equal(kept.find(part => part.kind === 'secrets')?.text, 'K'.repeat(6000), 'the secrets are untouched');
  assert.ok(kept.reduce((sum, part) => sum + part.text.length, 0) <= 17000);
});

test('fitMemory shortens the secrets last and ends them with the notice', () => {
  const parts: MemoryPart[] = [
    { kind: 'setup', text: 'S'.repeat(1000) },
    chapterPart('1'), chapterPart('2'), chapterPart('3'),
    { kind: 'secrets', text: 'K'.repeat(9000) },
    { kind: 'state', text: 'T'.repeat(6000) },
    { kind: 'summary', text: 'U'.repeat(2000) },
  ];
  const kept = fitMemory(parts, 17000);
  assert.equal(kept.filter(part => part.kind === 'chapter').length, 0, 'every chapter goes before the secrets are shortened');
  const secrets = kept.find(part => part.kind === 'secrets')!;
  assert.ok(secrets.text.startsWith('KKK'), 'the start of the secrets is kept');
  assert.ok(secrets.text.endsWith('(GM secrets shortened to fit the memory limit)'), 'the shortened secrets end with the notice');
  assert.equal(kept.find(part => part.kind === 'state')?.text, 'T'.repeat(6000), 'the state is untouched');
  assert.equal(kept.find(part => part.kind === 'summary')?.text, 'U'.repeat(2000), 'the session summary is untouched');
  assert.ok(kept.reduce((sum, part) => sum + part.text.length, 0) <= 17000);
});

test('fitMemory leaves memory under the cap unchanged', () => {
  const parts: MemoryPart[] = [{ kind: 'setup', text: 'Setup' }, { kind: 'chapter', text: 'Chapter 1 short' }, { kind: 'secrets', text: 'Secret' }];
  assert.deepEqual(fitMemory(parts, 17000), parts);
});

test('memory under the cap is never trimmed', async () => {
  const f = await fixture(request => request.tools ? completion('The harbor is quiet. What do you do?') : summaryReply());
  try {
    const { campaign } = f;
    const chat = f.ai.session(f.user.id, campaign).activeChatId!;
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    act(f, turn, 'set_memory', { memory: 'The keeper hides below the tower.' });
    f.db.prepare('UPDATE campaign_ai SET digest = ? WHERE campaign_id = ?').run('Small digest.', campaign);
    addChapters(f, chat, 200);
    await runTurn(f, 'Look around.');
    const blocks = memoryBlocks(lastTurnRequest(f).body);
    const text = blocks.join('\n');
    assert.ok(memoryChars(blocks) <= 17000, 'memory is within 17000 characters');
    for (const seed of CHAPTER_SEEDS) assert.ok(text.includes(seed + '.'), 'every chapter is kept');
    assert.ok(text.includes('The keeper hides below the tower.'), 'the secrets are kept');
    assert.ok(!text.includes('shortened to fit') && !text.includes('left out to fit'), 'nothing is marked as cut');
  } finally {
    await f.close();
  }
});

test('the GM preparations block lists the setting in order, the two newest scenarios, and clips long fields to 600 characters', async () => {
  const f = await fixture(request => request.tools ? completion('The lamp glows. What do you do?') : summaryReply());
  try {
    await runTurn(f, 'Begin.');
    assert.ok(!memoryBlocks(lastTurnRequest(f).body).some(block => block.startsWith('GM preparations')), 'no block without a setting or scenario');
    const turn = currentTurn(f);
    act(f, turn, 'write_prep', { kind: 'setting', title: 'The Drowned Coast', fields: { agreements: 'No gore on the page.', secrets: 'The keeper lives below the tower.', premise: 'A coast where the tide keeps old promises.', factions: 'Tide Wardens; smugglers', tone: 'Melancholy and wry', locations: 'Harbor Wall; the Salt Chapel' } });
    act(f, turn, 'write_prep', { kind: 'scenario', id: 'old-lighthouse', title: 'Old lighthouse', fields: { hook: 'A light still burns.', aftermath: 'The keeper fades.' } });
    await pause(5);
    act(f, turn, 'write_prep', { kind: 'scenario', id: 'smuggler-run', title: 'Smuggler run', fields: { hook: 'A cargo of salt.', stakes: 'The Wardens sail at dawn.' } });
    await pause(5);
    const stormHook = prose(900, 'The storm hook');
    act(f, turn, 'write_prep', { kind: 'scenario', id: 'storm-watch', title: 'Storm watch', fields: { aftermath: 'The coast wakes.', rewards: 'A brass lamp', cast: 'Captain Vey', scenes: 'The tower stairs', stakes: 'The bell fails in the storm.', hook: stormHook } });
    await runTurn(f, 'Look around.');
    const blocks = memoryBlocks(lastTurnRequest(f).body);
    const block = blocks.find(item => item.startsWith('GM preparations (GM only):'));
    assert.ok(block, 'the block is present once a setting exists');
    assert.ok(blocks.indexOf(block) > blocks.findIndex(item => item.startsWith('Campaign setup')), 'the block follows the setup block');
    const lines = block.split('\n');
    const settingAt = lines.indexOf('Setting: The Drowned Coast');
    assert.ok(settingAt > 0, 'the setting title follows the header');
    const settingOrder = ['premise', 'tone', 'locations', 'factions', 'secrets', 'agreements'].map(key => lines.findIndex(line => line.startsWith(key + ': ')));
    assert.ok(settingOrder.every(index => index > settingAt), 'every setting field follows the setting title');
    assert.deepEqual(settingOrder, [...settingOrder].sort((a, b) => a - b), 'setting fields use the specified order');
    assert.ok(block.includes('Scenario: Smuggler run') && block.includes('Scenario: Storm watch'), 'the two newest scenarios are listed');
    assert.ok(!block.includes('Scenario: Old lighthouse'), 'older scenarios are left out');
    const storm = lines.indexOf('Scenario: Storm watch');
    const stormLines = lines.slice(storm + 1);
    const scenarioOrder = ['hook', 'stakes', 'scenes', 'cast', 'rewards', 'aftermath'].map(key => stormLines.findIndex(line => line.startsWith(key + ': ')));
    assert.ok(scenarioOrder.every(index => index >= 0), 'every scenario field is listed');
    assert.deepEqual(scenarioOrder, [...scenarioOrder].sort((a, b) => a - b), 'scenario fields use the specified order');
    assert.ok(lines.includes('hook: ' + stormHook.slice(0, 600)), 'a long field is clipped to 600 characters');
    assert.ok(!block.includes(stormHook.slice(0, 601)), 'no character past 600 is written');
  } finally {
    await f.close();
  }
});

test('the preparations block stays within 2500 characters when every field is long', async () => {
  const f = await fixture(request => request.tools ? completion('The lamp glows. What do you do?') : summaryReply());
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    act(f, turn, 'write_prep', { kind: 'setting', title: 'The Drowned Coast', fields: { premise: prose(600, 'Setting premise'), tone: prose(600, 'Setting tone'), locations: prose(600, 'Setting locations'), factions: prose(600, 'Setting factions'), secrets: prose(600, 'Setting secrets'), agreements: prose(600, 'Setting agreements') } });
    for (let index = 1; index <= 3; index++) {
      act(f, turn, 'write_prep', { kind: 'scenario', id: 'scene-' + String(index), title: 'Scenario ' + String(index), fields: { hook: prose(600, 'Hook ' + String(index)), stakes: prose(600, 'Stakes ' + String(index)), scenes: prose(600, 'Scenes ' + String(index)), cast: prose(600, 'Cast ' + String(index)), rewards: prose(600, 'Rewards ' + String(index)), aftermath: prose(600, 'Aftermath ' + String(index)) } });
      await pause(5);
    }
    await runTurn(f, 'Look around.');
    const block = memoryBlocks(lastTurnRequest(f).body).find(item => item.startsWith('GM preparations (GM only):'));
    assert.ok(block, 'the block is present');
    assert.ok(block.length <= 2500, 'the block is at most 2500 characters');
    assert.ok(block.includes('Setting: The Drowned Coast'), 'the setting title is kept');
  } finally {
    await f.close();
  }
});

test('get_context returns the documented JSON with structured state, preparations and the twelve newest image assets', async () => {
  const replies: (() => Response)[] = [];
  const f = await fixture(request => request.tools ? (replies.shift() ?? (() => completion('The wind holds. What do you do?')))() : summaryReply());
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    act(f, turn, 'update_state', { location: 'Harbor Wall', timeOfDay: 'dusk', objective: 'Find the keeper', threads: [{ id: 'lamp', title: 'Missing lamp', status: 'open', note: 'Ask the harbor master' }], npcs: [{ id: 'vey', name: 'Captain Vey', role: 'harbor master', attitude: 'wary', lastSeen: 'the quay' }], promises: [{ id: 'oath', text: 'Ash will return the lamp' }], facts: ['The keeper crossed the bay'] });
    act(f, turn, 'write_prep', { kind: 'setting', title: 'The Drowned Coast', fields: { premise: 'A coast where the tide keeps old promises.' } });
    act(f, turn, 'write_prep', { kind: 'scenario', id: 'storm-watch', title: 'Storm watch', fields: { hook: 'The bell fails in the storm.' } });
    addAssets(f);
    replies.push(() => completion(null, [call('ctx', 'get_context', {})]), () => completion('The lamp glows. What do you do?'));
    const before = f.requests.length;
    await runTurn(f, 'Check the table.');
    const content = toolContent(f, before, 'ctx');
    assert.ok(content.length <= 6000, 'the result is at most 6000 characters');
    const context = JSON.parse(content) as Record<string, any>;
    for (const key of ['heroes', 'scene', 'countdowns', 'adversaries', 'pendingCards', 'state', 'solo', 'preparations', 'assets']) assert.ok(key in context, 'get_context includes ' + key);
    assert.notEqual(context.truncated, true, 'a small result is not marked truncated');
    assert.equal(context.state.location, 'Harbor Wall');
    assert.equal(context.state.threads[0].title, 'Missing lamp');
    assert.deepEqual(context.preparations.map((item: any) => item.kind).sort(), ['scenario', 'setting']);
    for (const item of context.preparations) assert.deepEqual(Object.keys(item).sort(), ['fields', 'id', 'kind', 'title']);
    assert.equal(context.assets.length, 12);
    assert.ok(context.assets.every((item: any) => String(item.mediaType).startsWith('image/')), 'only image assets are listed');
    assert.deepEqual(context.assets.map((item: any) => item.name), Array.from({ length: 12 }, (_, index) => 'map-' + String(13 - index) + '.png'), 'the newest assets come first');
    for (const item of context.assets) assert.deepEqual(Object.keys(item).sort(), ['id', 'mediaType', 'name']);
  } finally {
    await f.close();
  }
});

test('get_context drops items from its longest array and sets truncated when it would exceed 6000 characters', async () => {
  const replies: (() => Response)[] = [];
  const f = await fixture(request => request.tools ? (replies.shift() ?? (() => completion('The wind holds. What do you do?')))() : summaryReply());
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    for (let index = 1; index <= 20; index++) {
      act(f, turn, 'write_prep', { kind: 'scenario', id: 'scenario-' + String(index), title: 'Scenario ' + String(index), fields: { hook: prose(600, 'Hook ' + String(index)), stakes: prose(600, 'Stakes ' + String(index)), scenes: prose(600, 'Scenes ' + String(index)), cast: prose(600, 'Cast ' + String(index)), rewards: prose(600, 'Rewards ' + String(index)), aftermath: prose(600, 'Aftermath ' + String(index)) } });
    }
    replies.push(() => completion(null, [call('ctx', 'get_context', {})]), () => completion('The lamp glows. What do you do?'));
    const before = f.requests.length;
    await runTurn(f, 'Check the table.');
    const content = toolContent(f, before, 'ctx');
    assert.ok(content.length <= 6000, 'the result is at most 6000 characters');
    const context = JSON.parse(content) as Record<string, any>;
    assert.equal(context.truncated, true, 'a result with dropped items says so');
    for (const key of ['heroes', 'scene', 'countdowns', 'adversaries', 'pendingCards', 'state', 'solo', 'preparations', 'assets']) assert.ok(key in context, 'get_context keeps ' + key);
    assert.ok(context.preparations.length < 20, 'the longest array loses items');
  } finally {
    await f.close();
  }
});

test('the campaign state reaches the GM as ordered text lines, with empty fields left out', async () => {
  const f = await fixture(request => request.tools ? completion('The tide turns. What do you do?') : summaryReply());
  try {
    await runTurn(f, 'Begin.');
    act(f, currentTurn(f), 'update_state', {
      location: 'Harbor Wall',
      timeOfDay: 'dusk',
      objective: '',
      threads: [{ id: 'lamp', title: 'Missing lamp', status: 'open', note: 'Ask the harbor master' }, { id: 'sailor', title: 'Lost sailor', status: 'stalled', note: 'Last seen at the tide mark' }],
      npcs: [{ id: 'vey', name: 'Captain Vey', role: 'harbor master', attitude: 'wary', lastSeen: 'the quay' }],
      promises: [{ id: 'oath', text: 'Ash will return the lamp' }],
      facts: ['The keeper crossed the bay'],
    });
    await runTurn(f, 'Look around.');
    const block = memoryBlocks(lastTurnRequest(f).body).find(item => item.includes('Location: Harbor Wall'));
    assert.ok(block, 'the state is in the prompt');
    assert.ok(!block.includes('"location"'), 'the state is text, not JSON');
    const lines = block.split('\n');
    assert.ok(!lines.some(line => line.startsWith('Objective:')), 'an empty objective is left out');
    const expected = ['Location: Harbor Wall', 'Time of day: dusk', 'Threads:', '- [open] Missing lamp - Ask the harbor master (id lamp)', '- [stalled] Lost sailor - Last seen at the tide mark (id sailor)', 'NPCs:', '- Captain Vey, harbor master; wary; last seen the quay (id vey)', 'Player promises:', '- Ash will return the lamp (id oath)', 'Facts:', '- The keeper crossed the bay'];
    assert.deepEqual(expected.filter(line => !lines.includes(line)), [], 'every expected line is present');
    const positions = expected.map(line => lines.indexOf(line));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'the lines follow the specified order');
  } finally {
    await f.close();
  }
});

test('a state longer than 6000 characters loses trailing items and says how many were left out', async () => {
  const f = await fixture(request => request.tools ? completion('The tide turns. What do you do?') : summaryReply());
  try {
    await runTurn(f, 'Begin.');
    act(f, currentTurn(f), 'update_state', {
      location: 'Harbor Wall',
      threads: Array.from({ length: 12 }, (_, index) => ({ id: 'thread-' + String(index), title: prose(160, 'Thread ' + String(index)), status: 'open', note: prose(160, 'Note ' + String(index)) })),
      npcs: Array.from({ length: 30 }, (_, index) => ({ id: 'npc-' + String(index), name: 'NPC ' + String(index) + ' ' + 'n'.repeat(60), role: prose(80, 'Role ' + String(index)), attitude: prose(120, 'Attitude ' + String(index)), lastSeen: prose(80, 'Seen ' + String(index)) })),
      promises: Array.from({ length: 10 }, (_, index) => ({ id: 'promise-' + String(index), text: prose(200, 'Promise ' + String(index)) })),
      facts: Array.from({ length: 20 }, (_, index) => prose(240, 'Fact ' + String(index))),
    });
    await runTurn(f, 'Look around.');
    const block = memoryBlocks(lastTurnRequest(f).body).find(item => item.includes('Location: Harbor Wall'));
    assert.ok(block, 'the state is in the prompt');
    const rendering = block.slice(block.indexOf('Location: Harbor Wall')).trimEnd();
    assert.ok(rendering.length <= 6000, 'the rendering is at most 6000 characters');
    const note = rendering.match(/\((\d+) items? left out to fit the memory limit\)$/);
    assert.ok(note, 'the rendering ends by saying how many items were left out');
    const remaining = rendering.split('\n').filter(line => line.startsWith('- ')).length;
    assert.equal(Number(note[1]), 72 - remaining, 'the count matches the item lines that were removed');
    assert.ok(rendering.includes('(id thread-0)'), 'the first items are kept');
    assert.ok(!rendering.includes('(id promise-9)'), 'trailing items are cut');
    assert.ok(!rendering.includes(prose(240, 'Fact 19')), 'the last fact is cut');
  } finally {
    await f.close();
  }
});

test('the per-turn snapshot is valid JSON of at most 4000 characters and says when items were dropped', async () => {
  const f = await fixture(request => request.tools ? completion('The tide turns. What do you do?') : summaryReply());
  try {
    await runTurn(f, 'Begin.');
    const small = snapshotOf(lastTurnRequest(f).body);
    assert.ok(small.text.length <= 4000, 'the snapshot JSON is at most 4000 characters');
    assert.notEqual(small.data.truncated, true, 'a small snapshot is complete');
    const turn = currentTurn(f);
    const foe = adversaries.find(entry => entry.type !== 'Minion')!;
    act(f, turn, 'create_scene', { name: 'Cliff Road' });
    for (let index = 1; index <= 12; index++) act(f, turn, 'add_adversary', { catalogId: foe.id, name: 'Harrier ' + String(index) + ' ' + 'h'.repeat(85) });
    for (let index = 1; index <= 8; index++) act(f, turn, 'create_countdown', { name: 'Countdown ' + String(index) + ' ' + 'c'.repeat(180), start: 4 });
    await runTurn(f, 'Look around.');
    const big = snapshotOf(lastTurnRequest(f).body);
    assert.ok(big.text.length <= 4000, 'the snapshot JSON is at most 4000 characters');
    assert.equal(big.data.truncated, true, 'a snapshot with dropped items says so');
  } finally {
    await f.close();
  }
});
