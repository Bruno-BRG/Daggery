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
  const normal = rollDuality('iron-price', { state, fear: 6, rng: queue(1, 3), input: { severe: true }, question: '' });
  const advisory = rollDuality('iron-price', { state, fear: 6, rng: queue(1, 3), input: { severe: true }, question: '', advisory: true });
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

test('Duality GME: a progress roll uses the Duality Dice, or two d10 on request', () => {
  const d12 = (...values: number[]) => { let i = 0; return () => (values[i++]! - 0.5) / 12; };
  const state = initialSoloState();
  // Score 6 has a target of 7.
  assert.equal(rollDuality('iron-progress', { state, fear: 0, rng: d12(3, 6), input: { score: 6 }, question: '' }).result.title, 'Strong hit');
  assert.equal(rollDuality('iron-progress', { state, fear: 0, rng: d12(3, 9), input: { score: 6 }, question: '' }).result.title, 'Weak hit');
  assert.equal(rollDuality('iron-progress', { state, fear: 0, rng: d12(8, 8), input: { score: 6 }, question: '' }).result.title, 'Miss (match)');
  const classic = rollDuality('iron-progress', { state, fear: 0, rng: (() => { const v = [3, 5]; let i = 0; return () => (v[i++]! - 0.5) / 10; })(), input: { score: 6, dice: 'd10' }, question: '' });
  assert.equal(classic.result.title, 'Strong hit');
});

test('Duality GME: progress rolls beat the challenge dice, and a severe price spends Fear for a second price', () => {
  const d10 = (...values: number[]) => { let i = 0; return () => (values[i++]! - 0.5) / 10; };
  const state = initialSoloState();
  assert.equal(rollDuality('iron-progress', { state, fear: 0, rng: d10(3, 5), input: { score: 6, dice: 'd10', name: 'Find the caravan' }, question: '' }).result.title, 'Strong hit');
  assert.equal(rollDuality('iron-progress', { state, fear: 0, rng: d10(3, 6), input: { score: 6, dice: 'd10' }, question: '' }).result.title, 'Weak hit');
  assert.equal(rollDuality('iron-progress', { state, fear: 0, rng: d10(7, 7), input: { score: 6, dice: 'd10' }, question: '' }).result.title, 'Miss (match)');
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
    assert.throws(() => track({ variant: 'duality' }), /Invalid engine variant/);
    assert.throws(() => track({ variant: 'mythic' }), /Invalid engine variant/);
    assert.throws(() => track({ tracks: [{ id: 'v1', name: 'X', kind: 'vow', rank: 'legendary', ticks: 0, done: false }] }), /Invalid rank/);
    assert.throws(() => track({ tracks: [{ id: 'v1', name: 'X', kind: 'scene', rank: 'formidable', ticks: 0, done: false, clock: { size: 5, filled: 0 } }] }), /Invalid tension clock/);
  } finally { fixture.close(); }
});

// Old selection values must never reactivate a second engine or discard adventure data.
test('new and saved campaigns always use GME, preserving tracks, notes and revisions', async () => {
  const f = await context(0);
  try {
    assert.equal(initialSoloState().variant, 'iron');
    for (const variant of [undefined, 'duality', 'iron']) {
      const state = { ...initialSoloState(), revision: 7, variant, scene: { ...initialSoloState().scene, title: 'The lighthouse' },
        tracks: [{ id: 'oath-1', name: 'Find the keeper', kind: 'vow', rank: 'dangerous', ticks: 8, done: false }],
        threads: [{ id: 'thread-1', name: 'A missing friend', note: 'Search the harbor', done: false }] };
      f.db.prepare("INSERT INTO campaign_docs(campaign_id,ns,id,value,updated) VALUES (?,'solo','state',?,'2026') ON CONFLICT(campaign_id,ns,id) DO UPDATE SET value=excluded.value").run(f.campaign, JSON.stringify(state));
      const snapshot = f.solo.snapshot(f.user.id, f.campaign);
      assert.deepEqual(snapshot.state, { ...state, variant: 'iron' });
      assert.deepEqual(f.solo.current(f.user.id, f.campaign), snapshot.state);
      const saved = f.solo.track(f.user.id, f.campaign, { revision: 7, characters: [] });
      assert.equal(saved.variant, 'iron');
      assert.equal(saved.revision, 8);
      assert.deepEqual(saved.tracks, state.tracks);
      assert.deepEqual(saved.threads, state.threads);
    }
  } finally { f.close(); }
});

test('all current and legacy Duality oracle calls use GME matches, never wide-gap twists or events', () => {
  for (const kind of ['iron-oracle', 'duality-oracle']) {
    const run = (...dice: number[]) => rollDuality(kind, { state: initialSoloState(), fear: 5, rng: queue(...dice), input: { likelihood: 'even' }, question: 'Is it open?' });
    assert.equal(run(10, 4).result.title, 'Yes');
    assert.equal(run(4, 10).result.title, 'Yes');
    const match = run(7, 7);
    assert.equal(match.result.title, 'Yes, with a twist');
    assert.equal(match.result.cells, undefined);
    assert.equal(match.fearSpent, 0);
  }
  for (const kind of ['duality-scene', 'duality-move', 'duality-event'])
    assert.throws(() => rollDuality(kind, { state: initialSoloState(), fear: 0, rng: queue(1), input: {}, question: '' }), /Invalid solo roll type/);
});

test('combat severe prices roll twice, record both dice and pay Fear exactly once', async () => {
  const f = await context(1, 1, 11, 5, 6);
  try {
    const entry = f.roll('duality-adversary');
    assert.equal(entry.result.title, 'Severe Pay the Price: Mark a Stress + Take damage (by tier)');
    assert.deepEqual(entry.result.cells, [{ table: 'iron-price', column: 0, roll: 5 }, { table: 'iron-price', column: 0, roll: 6 }]);
    assert.equal(f.pool(), 0);
    assert.match(entry.result.detail, /Fear spent: 1 \(0 left\)/);
  } finally { f.close(); }
});

/** A raw rng value that makes rollDie land on `value` of a d100. */
const d100 = (value: number) => (value - 0.5) / 100;
const roll100 = (kind: string, input: Record<string, unknown>, ...dice: number[]) => {
  let index = 0;
  const rng = () => d100(dice[index++] ?? 50);
  return rollDuality(kind, { state: initialSoloState(), fear: 3, rng, input, question: '' });
};

test('Lodestar d100 tables read the printed row, and 00 is 100', () => {
  assert.equal(roll100('duality-lodestar', { tableId: 'region' }, 1).result.title, 'Barrier Islands');
  assert.equal(roll100('duality-lodestar', { tableId: 'region' }, 100).result.title, 'Elsewhere');
  assert.equal(roll100('duality-lodestar', { tableId: 'action' }, 37).result.title, 'Hunt');
  assert.match(roll100('duality-lodestar', { tableId: 'region' }, 100).result.detail, /d100 00: Elsewhere/);
  assert.throws(() => roll100('duality-lodestar', { tableId: 'nothing' }, 1), /Invalid Lodestar table/);
});

test('Lodestar nested and paired tables roll each part', () => {
  // Category 20 is "A manmade edifice"; example 35 is the fourth of its ten.
  assert.equal(roll100('duality-lodestar', { tableId: 'settlement-name' }, 20, 35).result.title, 'Redhall');
  assert.equal(roll100('duality-lodestar', { tableId: 'quick-settlement-name' }, 1, 1).result.title, 'Bleakmoor');
  assert.equal(roll100('duality-lodestar', { tableId: 'quick-settlement-name' }, 40, 97).result.title, 'Lowwick');
  const rank = roll100('duality-lodestar', { tableId: 'challenge-rank' }, 60);
  assert.equal(rank.result.title, 'Formidable');
  assert.match(rank.result.detail, /Foes: Exceptional fighters and mighty creatures/);
  assert.match(rank.result.detail, /In Duality GME this rank is Grave/);
});

test('"Roll twice" results roll two more, skip further doubles, and worsen a repeat', () => {
  const both = roll100('duality-lodestar', { tableId: 'pay-the-price' }, 100, 4, 60);
  assert.equal(both.result.title, 'A person or community you trusted loses faith in you, or acts against you. + It is harmful.');
  assert.match(both.result.detail, /Both results happen/);
  const same = roll100('duality-lodestar', { tableId: 'pay-the-price' }, 99, 60, 62);
  assert.equal(same.result.title, 'It is harmful. (worse)');
  const skipsDouble = roll100('duality-lodestar', { tableId: 'pay-the-price' }, 99, 100, 4, 60);
  assert.equal(skipsDouble.result.title.includes('Roll twice'), false);
  const again = roll100('duality-lodestar', { tableId: 'pay-the-price' }, 1, 2, 77);
  assert.equal(again.result.title, 'A surprising development complicates your quest. (worse)');
});

test('foe rank rolls the Challenge Rank and names adversaries of that rank', () => {
  const rolled = roll100('duality-foe-rank', {}, 90, 6, 6, 6);
  assert.match(rolled.result.title, /^Dire foe/);
  assert.match(rolled.result.detail, /Duality GME rank: Dire\. Harm 4 against you; 2 ticks per harm/);
  assert.ok(rolled.result.suggestions && rolled.result.suggestions.length > 0);
  assert.equal(roll100('duality-foe-rank', {}, 10, 6, 6, 6).result.title.startsWith('Minor'), true);
});

test('an encounter tells you the foe rank for Enter the Fray', () => {
  const ranked = rollDuality('duality-encounter', { state: initialSoloState(), fear: 0, rng: queue(5, 3, 8, 1, 1, 1), input: { tier: 2 }, question: '' });
  assert.match(ranked.result.detail, /Foe rank: (Minor|Serious|Grave|Dire|Legendary) \(a tier 2 /);
  const open = rollDuality('duality-encounter', { state: initialSoloState(), fear: 0, rng: queue(5, 3, 8, 1, 1, 1), input: {}, question: '' });
  assert.match(open.result.detail, /Foe rank by tier: .*\(tier 1\).*\(tier 4\)/);
});
