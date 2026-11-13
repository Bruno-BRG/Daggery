import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { SoloService } from './solo';

/** A raw rng value that makes rollDie land on `face` of a d12. */
const face = (value: number) => (value - 0.5) / 12;
const queue = (...values: number[]) => {
  let index = 0;
  return () => face(values[index++] ?? 6);
};
let sequence = 0;

async function context(fear: number, ...dice: number[]) {
  const db = openCampaignDatabase(':memory:');
  const campaigns = new CampaignService(db);
  const user = await campaigns.register(`duality-${++sequence}`, 'a strong duality password');
  const campaign = campaigns.createCampaign(user.id, 'Solo', '', { systemId: 'daggerheart', rulesetId: 'solo' });
  const published: { ns: string; id: string; value: unknown }[] = [];
  const solo = new SoloService(db, campaigns, (_campaign, ns, id, value) => { published.push({ ns, id, value }); }, queue(...dice));
  db.prepare(`INSERT INTO campaign_docs(campaign_id,ns,id,value,updated) VALUES (?,?,?,?,?)
    ON CONFLICT(campaign_id,ns,id) DO UPDATE SET value=excluded.value`).run(campaign, 'combat', 'fear', JSON.stringify({ kind: 'fear', value: fear }), '2026');
  const pool = () => JSON.parse((db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'combat' AND id = 'fear'").get(campaign) as { value: string }).value).value as number;
  const roll = (kind: string, values: Record<string, unknown> = {}) => solo.roll(user.id, campaign, { requestId: `r-${++sequence}`, kind, ...values });
  return { db, user, campaign, solo, published, pool, roll, close: () => db.close() };
}

test('the oracle adds the Duality Dice, twists on a wide gap, and never touches Fear', async () => {
  const fixture = await context(5, 9, 3);
  try {
    const entry = fixture.roll('duality-oracle', { question: 'Is the gate open?', likelihood: 'likely' });
    assert.equal(entry.result.title, 'Yes, and…');
    assert.equal(entry.result.tone, 'hope');
    assert.equal(entry.result.total, 12);
    assert.match(entry.result.detail, /Hope 9 \+ Fear 3 = 12 · Likely needs 10\+/);
    assert.equal(fixture.pool(), 5);
    assert.equal(fixture.published.length, 0);
    assert.throws(() => fixture.roll('duality-oracle', { question: ' ', likelihood: 'likely' }), /Invalid question/);
    assert.throws(() => fixture.roll('duality-oracle', { question: 'Why?', likelihood: 'certain' }), /Invalid likelihood/);
  } finally { fixture.close(); }
});

test('oracle doubles bring a Random Event that invokes a list', async () => {
  // 4 + 4, then Event Focus 7 (a Thread advances), list d12 1, Action 1/1, Subject 2/2.
  const fixture = await context(0, 4, 4, 7, 1, 1, 1, 2, 2);
  try {
    const state = fixture.solo.current(fixture.user.id, fixture.campaign);
    fixture.solo.track(fixture.user.id, fixture.campaign, { revision: state.revision, threads: [{ id: 't1', name: 'Find the caravan', note: '', done: false }] });
    const entry = fixture.roll('duality-oracle', { question: 'Is it far?', likelihood: 'even' });
    assert.equal(entry.result.title, 'No');
    assert.equal(entry.result.tone, 'revelation');
    assert.match(entry.result.detail, /Doubles: a Random Event occurs as well\./);
    assert.match(entry.result.detail, /Event Focus d12 7: A Thread advances/);
    assert.match(entry.result.detail, /Threads d12 1: Find the caravan/);
    assert.match(entry.result.detail, /Meaning \(Hope\/Fear 1\/1, 2\/2\): Seek \/ Stranger/);
  } finally { fixture.close(); }
});

test('scene setup spends 1 Fear when the Fear Check passes', async () => {
  const altered = await context(6, 3, 2);
  try {
    const entry = altered.roll('duality-scene');
    assert.equal(entry.result.title, 'Altered scene: An expected NPC is absent');
    assert.match(entry.result.detail, /Fear Check d12 3 vs Fear 6: passes/);
    assert.match(entry.result.detail, /Fear spent: 1 \(5 left\)\./);
    assert.equal(altered.pool(), 5);
    assert.deepEqual(altered.published.at(-1), { ns: 'combat', id: 'fear', value: { kind: 'fear', value: 5 } });
  } finally { altered.close(); }
  const interrupted = await context(6, 4, 2);
  try {
    assert.match(interrupted.roll('duality-scene').result.title, /^Interrupted scene: A strange omen or mystery/);
    assert.equal(interrupted.pool(), 5);
  } finally { interrupted.close(); }
  const expected = await context(6, 9);
  try {
    assert.equal(expected.roll('duality-scene').result.title, 'Expected scene');
    assert.equal(expected.pool(), 6);
    assert.equal(expected.published.length, 0);
  } finally { expected.close(); }
});

test('GM Moves: soft without a check, hard on a passed check, and a 12 spends again', async () => {
  const soft = await context(12, 5);
  try {
    assert.equal(soft.roll('duality-move', { trigger: 'success-fear' }).result.title, 'Soft Move: Mark a Stress');
    assert.equal(soft.pool(), 12);
  } finally { soft.close(); }
  const hard = await context(3, 2, 12, 1, 6);
  try {
    const entry = hard.roll('duality-move', { trigger: 'failure-fear' });
    assert.equal(entry.result.title, 'Hard Move: An adversary strikes: take damage + Enemy reinforcements arrive');
    assert.equal(hard.pool(), 1);
  } finally { hard.close(); }
  const failed = await context(3, 9, 1);
  try {
    assert.equal(failed.roll('duality-move', { trigger: 'failure-fear' }).result.title, 'Soft Move: Show how the world reacts');
    assert.equal(failed.roll('duality-move', { trigger: 'stall' }).result.title, 'No move');
    assert.equal(failed.pool(), 3);
    assert.throws(() => failed.roll('duality-move', { trigger: 'critical' }), /Invalid move trigger/);
  } finally { failed.close(); }
});

test('adversaries act for free on a failed check, spend on a pass, and chain until a fail', async () => {
  const fixture = await context(2, 5, 4, 1, 7, 1, 2, 9);
  try {
    assert.equal(fixture.roll('duality-adversary').result.title, 'Attack the most wounded PC');
    assert.equal(fixture.pool(), 2);
    const paid = fixture.roll('duality-adversary');
    assert.equal(paid.result.title, 'Attack, then spotlight a second adversary (1 Fear)');
    assert.equal(fixture.pool(), 1);
    assert.equal(fixture.roll('duality-adversary', { chain: true }).result.title, 'Next adversary: Attack the nearest PC');
    assert.equal(fixture.pool(), 0);
    assert.equal(fixture.roll('duality-adversary', { chain: true }).result.title, 'GM turn ends');
  } finally { fixture.close(); }
});

test('generators, journeys, tables and lists roll d12s', async () => {
  const fixture = await context(4, 1, 2, 3, 4, 5, 1, 1, 9, 2, 12, 3, 2, 5, 6);
  try {
    assert.equal(fixture.roll('duality-npc').result.title, 'Suspicious farmer or laborer who wants wealth');
    assert.equal(fixture.roll('duality-journey').result.title, 'Danger: Ambush');
    assert.equal(fixture.pool(), 3);
    assert.equal(fixture.roll('duality-journey').result.title, 'Discovery: Fellow travelers');
    const table = fixture.roll('duality-table', { tableId: 'site', column: 0 });
    assert.equal(table.result.title, 'Heart of the site');
    assert.equal(table.result.total, 12);
    assert.throws(() => fixture.roll('duality-table', { tableId: 'site', column: 3 }), /Invalid table column/);
    assert.throws(() => fixture.roll('duality-table', { tableId: 'nope' }), /Invalid table/);
    assert.equal(fixture.roll('duality-list', { list: 'characters' }).result.title, 'Empty list');
    assert.throws(() => fixture.roll('mythic-oracle', { question: 'Old?', odds: 'likely' }), /Invalid solo roll type/);
  } finally { fixture.close(); }
});

test('the tracker keeps lists to twelve open lines and saves countdowns', async () => {
  const fixture = await context(0);
  try {
    const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `n-${index}`, name: `NPC ${index}`, note: '', done: false }));
    const state = fixture.solo.current(fixture.user.id, fixture.campaign);
    assert.throws(() => fixture.solo.track(fixture.user.id, fixture.campaign, { revision: state.revision, characters: items(13) }), /at most 12 open lines/);
    const saved = fixture.solo.track(fixture.user.id, fixture.campaign, { revision: state.revision, characters: items(12), clocks: [{ id: 'c1', name: 'The ritual completes', start: 6, current: 4 }] });
    assert.equal(saved.characters?.length, 12);
    assert.deepEqual(saved.clocks, [{ id: 'c1', name: 'The ritual completes', start: 6, current: 4 }]);
    assert.throws(() => fixture.solo.track(fixture.user.id, fixture.campaign, { revision: saved.revision, clocks: [{ id: 'c1', name: 'x', start: 4, current: 5 }] }), /Invalid solo number/);
    const ended = fixture.solo.command(fixture.user.id, fixture.campaign, { revision: saved.revision, command: 'end-scene' });
    assert.equal(ended.state.sceneNumber, 1);
  } finally { fixture.close(); }
});
