import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { initialSoloState } from '@daggery/shared';
import { openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { SoloService } from './solo';
import { rollDuality } from './solo-duality';

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
    assert.equal(fixture.roll('duality-oracle', { question: ' ', likelihood: 'likely' }).question, 'Oracle', 'the question is optional at the table');
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

test('setting the scene rolls a complication, then spends 1 Fear when the Fear Check passes', async () => {
  // Complication 1, Fear Check 3 (odd pass), Altered Scene 2.
  const altered = await context(6, 1, 3, 2);
  try {
    const entry = altered.roll('duality-scene');
    assert.equal(entry.result.title, 'Altered scene: An expected NPC is absent · Hostile forces oppose you');
    assert.deepEqual(entry.result.cells, [{ table: 'scene-complication', column: 0, roll: 1 }, { table: 'altered-scene', column: 0, roll: 2 }]);
    assert.match(entry.result.detail, /Fear Check d12 3 vs Fear 6: passes/);
    assert.match(entry.result.detail, /Fear spent: 1 \(5 left\)\./);
    assert.equal(altered.pool(), 5);
    assert.deepEqual(altered.published.at(-1), { ns: 'combat', id: 'fear', value: { kind: 'fear', value: 5 } });
  } finally { altered.close(); }
  const interrupted = await context(6, 1, 4, 2);
  try {
    assert.match(interrupted.roll('duality-scene').result.title, /^Interrupted scene: A strange omen or mystery/);
    assert.equal(interrupted.pool(), 5);
  } finally { interrupted.close(); }
  const expected = await context(6, 2, 9);
  try {
    assert.equal(expected.roll('duality-scene').result.title, 'Complication: An obstacle blocks your way');
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
  // NPC: five table rolls, then a name (Hope 6, Fear 6, Family 6, Epithet 6).
  const fixture = await context(4, 1, 2, 3, 4, 5, 6, 6, 6, 6, 1, 1, 9, 2, 12, 3, 2, 5, 6);
  try {
    assert.match(fixture.roll('duality-npc').result.title, /^Rhea Fallowmere, of the Ford: suspicious farmer or laborer who wants wealth$/);
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

test('advisory rolls suggest the Fear cost instead of spending it, and only the Fear line differs', () => {
  const state = initialSoloState();
  const normal = rollDuality('duality-scene', { state, fear: 6, rng: queue(1, 3, 2), input: {}, question: '' });
  const advisory = rollDuality('duality-scene', { state, fear: 6, rng: queue(1, 3, 2), input: {}, question: '', advisory: true });
  assert.equal(normal.fearSpent, 1);
  assert.equal(advisory.fearSpent, 1, 'the engine still reports what the move would cost');
  assert.match(normal.result.detail, /Fear spent: 1 \(5 left\)\./);
  assert.doesNotMatch(normal.result.detail, /Suggested Fear cost/);
  assert.match(advisory.result.detail, /Suggested Fear cost: 1 \(Fear pool 6\)\. Pay it with spend_fear only if you use this move\./);
  assert.doesNotMatch(advisory.result.detail, /Fear spent:/);
  assert.equal(advisory.result.title, normal.result.title);
  assert.equal(
    advisory.result.detail.replace('Suggested Fear cost: 1 (Fear pool 6). Pay it with spend_fear only if you use this move.', ''),
    normal.result.detail.replace('Fear spent: 1 (5 left).', ''),
    'decisions and every other line are unchanged',
  );
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

test('an encounter rolls creature, situation and type, and suggests fitting catalog adversaries', () => {
  // Creature 5 (undead), Situation 3 (guarding), Type 12 (Solo), then picks.
  const outcome = rollDuality('duality-encounter', { state: initialSoloState(), fear: 0, rng: queue(5, 3, 12, 1, 1, 1), input: { tier: 1 }, question: '' });
  assert.equal(outcome.result.title, 'Solo · Undead · guarding something or someone');
  assert.equal(outcome.result.tone, 'fear');
  assert.deepEqual(outcome.result.cells?.map(cell => cell.table), ['adversary-creature', 'adversary-creature', 'adversary-type']);
  assert.ok((outcome.result.suggestions ?? []).length > 0, 'tier 1 has Solo adversaries');
  assert.equal(outcome.fearSpent, 0);
  assert.throws(() => rollDuality('duality-encounter', { state: initialSoloState(), fear: 0, rng: queue(1), input: { tier: 7 }, question: '' }), /Invalid tier/);
});

test('generators roll whole tables: names, place names, settlements and the rest', () => {
  const state = initialSoloState();
  const run = (tableId: string, ...dice: number[]) => rollDuality('duality-generate', { state, fear: 0, rng: queue(...dice), input: { tableId }, question: '' });
  // Hope 1 / Fear 2 picks Given B row 1; Family 12, Epithet 3.
  assert.equal(run('names', 1, 2, 12, 3).result.title, 'Mara Thorne, Half-Hand');
  assert.equal(run('place-name', 1, 5).result.title, 'Ashford');
  const town = run('settlement', 12, 12, 7, 3, 4);
  assert.equal(town.result.title, 'Thornwick: town known for a sacred site');
  assert.match(town.result.detail, /Trouble d12 4: Someone is missing/);
  assert.equal(run('wilds', 3, 7, 1).result.title, 'Dense forest · Thick fog · A lone great tree');
  assert.equal(run('treasure', 12, 6).result.cells?.length, 2);
  assert.throws(() => run('soft-move', 1), /Invalid table/);
});

test('a hazard reads one row, so the failure fits the hazard', () => {
  const hazard = rollDuality('duality-generate', { state: initialSoloState(), fear: 0, rng: queue(1, 8), input: { tableId: 'hazard' }, question: '' });
  assert.equal(hazard.result.title, 'Pit or collapsing floor (Agility) · Fall: take physical damage');
  assert.deepEqual(hazard.result.cells, [{ table: 'hazard', column: 0, roll: 1 }, { table: 'hazard', column: 1, roll: 1 }]);
});

test('Duality GME: progress rolls beat the challenge dice, and a severe price spends Fear for a second price', () => {
  const d10 = (...values: number[]) => { let i = 0; return () => (values[i++]! - 0.5) / 10; };
  const state = initialSoloState();
  assert.equal(rollDuality('iron-progress', { state, fear: 0, rng: d10(3, 5), input: { score: 6, name: 'Find the caravan' }, question: '' }).result.title, 'Strong hit');
  assert.equal(rollDuality('iron-progress', { state, fear: 0, rng: d10(3, 6), input: { score: 6 }, question: '' }).result.title, 'Weak hit');
  assert.equal(rollDuality('iron-progress', { state, fear: 0, rng: d10(7, 7), input: { score: 6 }, question: '' }).result.title, 'Miss (match)');
  const severe = rollDuality('iron-price', { state, fear: 2, rng: queue(5, 6), input: { severe: true }, question: '' });
  assert.equal(severe.result.title, 'Mark a Stress + Take damage (by tier)');
  assert.equal(severe.fearSpent, 1);
  const oracle = rollDuality('iron-oracle', { state, fear: 0, rng: queue(5, 5), input: { likelihood: 'likely' }, question: '' });
  assert.equal(oracle.result.title, 'Yes, with a twist');
});

test('the tracker saves the engine variant and progress tracks', async () => {
  const fixture = await context(0);
  try {
    const state = fixture.solo.current(fixture.user.id, fixture.campaign);
    const saved = fixture.solo.track(fixture.user.id, fixture.campaign, { revision: state.revision, variant: 'iron',
      tracks: [{ id: 'v1', name: 'Find the caravan', kind: 'scene', rank: 'formidable', ticks: 8, done: false, clock: { size: 6, filled: 2 } }] });
    assert.equal(saved.variant, 'iron');
    assert.deepEqual(saved.tracks?.[0]?.clock, { size: 6, filled: 2 });
    const track = (patch: Record<string, unknown>) => fixture.solo.track(fixture.user.id, fixture.campaign, { revision: fixture.solo.current(fixture.user.id, fixture.campaign).revision, ...patch });
    assert.throws(() => track({ variant: 'fate' }), /Invalid engine variant/);
    assert.throws(() => track({ variant: 'mythic' }), /Invalid engine variant/);
    assert.throws(() => track({ tracks: [{ id: 'v1', name: 'X', kind: 'vow', rank: 'legendary', ticks: 0, done: false }] }), /Invalid rank/);
    assert.throws(() => track({ tracks: [{ id: 'v1', name: 'X', kind: 'scene', rank: 'formidable', ticks: 0, done: false, clock: { size: 5, filled: 0 } }] }), /Invalid tension clock/);
  } finally { fixture.close(); }
});
