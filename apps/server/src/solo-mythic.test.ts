import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { MythicData } from '@daggery/shared';
import { openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { SoloService } from './solo';

/**
 * A tiny invented dataset. It deliberately does not mirror the real Mythic
 * tables, which live in the gitignored packages/content/mythic directory.
 */
function fakeMythic(): MythicData {
  return {
    available: true,
    oracle: {
      tables: [
        {
          id: 'ask-the-game-master',
          title: 'Ask the Game Master',
          die: 'd100',
          columns: ['Odds'],
          entries: [
            {
              id: 'impossible',
              label: 'Impossible',
              ranges: { exceptionalYes: [1, 5], yes: [6, 45], no: [46, 95], exceptionalNo: [96, 100] },
            },
          ],
        },
        {
          id: 'discover-meaning',
          title: 'Discover Meaning',
          die: 'd100',
          columns: ['Action', 'Description'],
          entries: [
            { range: [1, 50], cells: ['Advance', 'Bright'] },
            { range: [51, 100], cells: ['Betray', 'Cold'] },
          ],
        },
      ],
    },
    adventureCrafter: {
      tables: [
        {
          id: 'theme',
          title: 'Theme',
          die: 'd6',
          entries: [
            { range: [1, 3], cells: ['Alpha', 'Bravo'] },
            { range: [4, 6], cells: ['Charlie', 'Delta'] },
          ],
        },
      ],
    },
    locationCrafting: {
      tables: [
        {
          id: 'wide',
          title: 'Wide',
          die: 'd10',
          columns: ['Left', 'Right'],
          entries: [{ range: [1, 10], cells: ['West', 'East'] }],
        },
      ],
    },
    collectedTables: { tables: [] },
  };
}

const missingMythic = (): MythicData => ({
  available: false,
  oracle: null,
  adventureCrafter: null,
  locationCrafting: null,
  collectedTables: null,
});

/** A raw rng value that makes rollDie land on `face` of a `sides`-sided die. */
const face = (value: number, sides: number) => (value - 0.5) / sides;

const queue = (...values: number[]) => {
  let index = 0;
  return () => values[index++] ?? 0.5;
};

let sequence = 0;

async function context(loader: () => MythicData = fakeMythic, values: number[] = []) {
  const db = openCampaignDatabase(':memory:');
  const campaigns = new CampaignService(db);
  const user = await campaigns.register(`mythic-${++sequence}`, 'a strong mythic password');
  const campaign = campaigns.createCampaign(user.id, 'Solo', '', { systemId: 'daggerheart', rulesetId: 'solo' });
  const solo = new SoloService(db, campaigns, () => {}, loader, queue(...values));
  return { db, campaigns, user, campaign, solo, close: () => db.close() };
}


const ask = (fixture: Awaited<ReturnType<typeof context>>, id: string, extra: Record<string, unknown> = {}) =>
  fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: id, kind: 'mythic-oracle', question: 'Is the gate open?', odds: 'impossible', ...extra });
const items = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}`, name: `${prefix.toUpperCase()}${index + 1}`, note: '', done: false }));

test('the Fate Chart maps a d100 to all four answers at chaos 5', async () => {
  // Impossible at Chaos 5 reads 2 / 10 / 83.
  const cases = [[2, 'Exceptional Yes', 'revelation'], [10, 'Yes', 'hope'], [50, 'No', 'fear'], [83, 'Exceptional No', 'fear']] as const;
  for (const [roll, title, tone] of cases) {
    const fixture = await context(fakeMythic, [face(roll, 100)]);
    try {
      const entry = ask(fixture, `odds-${roll}`);
      assert.equal(entry.result.title, title);
      assert.equal(entry.result.tone, tone);
      assert.equal(entry.result.total, roll);
      assert.match(entry.result.detail, new RegExp(`d100: ${roll} · Odds: Impossible · Chaos 5`));
      assert.doesNotMatch(entry.result.detail, /Random Event/);
    } finally { fixture.close(); }
  }
});

test('a double within the chaos factor adds a full Random Event', async () => {
  // 22 at Chaos 5, then Event Focus 30 (NPC Action, no characters yet), then two meaning words.
  const fixture = await context(fakeMythic, [face(22, 100), face(30, 100), face(10, 100), face(60, 100)]);
  try {
    const entry = ask(fixture, 'double');
    assert.equal(entry.result.title, 'No');
    assert.match(entry.result.detail, /Random Event: A Random Event happens as well as this answer\./);
    assert.match(entry.result.detail, /Event Focus d100 30: NPC Action, but the Characters List is empty, so Current Context/);
    assert.match(entry.result.detail, /Meaning \(Actions \(One-Page table\)\) d100 10, 60: Advance \/ Betray/);
  } finally { fixture.close(); }
  const above = await context(fakeMythic, [face(66, 100)]);
  try { assert.doesNotMatch(ask(above, 'above').result.detail, /Random Event/); } finally { above.close(); }
  const plain = await context(fakeMythic, [face(30, 100)]);
  try { assert.doesNotMatch(ask(plain, 'plain').result.detail, /Random Event/); } finally { plain.close(); }
});

test('the saved chaos factor and flavor move the Fate Chart, and a replaced rule ignores chaos', async () => {
  const run = async (state: Record<string, unknown>, roll: number, extra: Record<string, unknown>) => {
    const fixture = await context(fakeMythic, [face(roll, 100)]);
    try {
      fixture.solo.track(fixture.user.id, fixture.campaign, { revision: 0, ...state });
      return ask(fixture, 'chaos', extra);
    } finally { fixture.close(); }
  };
  // Certain at Chaos 9 has no Exceptional No; Very Unlikely at Chaos 1 has no Exceptional Yes.
  assert.equal((await run({ chaos: 9 }, 100, { odds: 'certain' })).result.title, 'No');
  assert.equal((await run({ chaos: 1 }, 1, { odds: 'very-unlikely' })).result.title, 'Yes');
  assert.equal((await run({ chaos: 9 }, 60, { odds: 'fifty-fifty' })).result.title, 'Yes');
  assert.equal((await run({ chaos: 9 }, 60, { odds: '50-50-or-unknown', purpose: 'rpg-rule' })).result.title, 'No');
  assert.equal((await run({ chaos: 9, chaosFlavor: 'none' }, 60, { odds: 'fifty-fifty' })).result.title, 'No');
  const mid = await run({ chaos: 9, chaosFlavor: 'mid' }, 76, { odds: 'fifty-fifty' });
  assert.equal(mid.result.title, 'No');
  assert.match(mid.result.detail, /Chaos 9 \(Mid-chaos\)/);
  // One-Page Mythic: any double is an event, whatever the chaos factor.
  assert.match((await run({ chaos: 1, chaosFlavor: 'one-page' }, 88, {})).result.detail, /Random Event/);
  await assert.rejects(run({ chaosFlavor: 'wild' }, 5, {}), /Invalid chaos flavor/);
});

test('a Fate Check rolls 2d10 with the odds and chaos modifiers', async () => {
  const fixture = await context(fakeMythic, [face(3, 10), face(3, 10), face(90, 100), face(10, 100), face(60, 100)]);
  try {
    fixture.solo.track(fixture.user.id, fixture.campaign, { revision: 0, chaos: 6 });
    const entry = ask(fixture, 'check', { odds: 'nearly-impossible', method: 'check' });
    assert.equal(entry.result.title, 'Exceptional No');
    assert.equal(entry.result.total, 3);
    assert.match(entry.result.detail, /2d10: 3 \+ 3 − 3 = 3 · Odds: Nearly Impossible · Chaos 6/);
    assert.match(entry.result.detail, /Event Focus d100 90: Current Context/);
    assert.throws(() => ask(fixture, 'bad-method', { method: 'coin' }), /Invalid Fate Question method/);
  } finally { fixture.close(); }
});

test('a Random Event invokes a List line by section and line dice', async () => {
  // Seven characters: two active sections, so a d4 picks the section. d4 3, d10 1 is line 6.
  const fixture = await context(fakeMythic, [face(25, 100), face(3, 4), face(1, 10), face(10, 100), face(60, 100)]);
  try {
    const { user, campaign, solo } = fixture;
    solo.track(user.id, campaign, { revision: 0, characters: items('c', 7) });
    const entry = solo.roll(user.id, campaign, { requestId: 'event', kind: 'mythic-event' });
    assert.equal(entry.result.title, 'NPC Action');
    assert.match(entry.result.detail, /Characters List d4 3, d10 1: line 6, C6/);
    const chosen = solo.roll(user.id, campaign, { requestId: 'chosen', kind: 'mythic-event', focus: 'pc-positive' });
    assert.match(chosen.result.detail, /Event Focus \(chosen\): PC Positive/);
    assert.throws(() => solo.roll(user.id, campaign, { requestId: 'empty', kind: 'mythic-event', focus: 'close-thread' }), /Threads List is empty/);
    assert.throws(() => solo.roll(user.id, campaign, { requestId: 'bad', kind: 'mythic-event', focus: 'nope' }), /Invalid event focus/);
  } finally { fixture.close(); }
  // Four elements: no section die. A d10 of 9 lands on empty line 5.
  const short = await context(fakeMythic, [face(9, 10)]);
  try {
    short.solo.track(short.user.id, short.campaign, { revision: 0, threads: items('t', 4) });
    const entry = short.solo.roll(short.user.id, short.campaign, { requestId: 'list', kind: 'mythic-list', list: 'threads' });
    assert.equal(entry.result.title, 'Choose');
    assert.match(entry.result.detail, /Threads List d10 9: line 5 is empty/);
  } finally { short.close(); }
});

test('a List element may repeat on at most three lines', async () => {
  const fixture = await context();
  try {
    const repeat = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `r-${index}`, name: 'The keeper', note: '', done: false }));
    assert.equal(fixture.solo.track(fixture.user.id, fixture.campaign, { revision: 0, characters: repeat(3) }).characters?.length, 3);
    assert.throws(() => fixture.solo.track(fixture.user.id, fixture.campaign, { revision: 1, characters: repeat(4) }), /at most three times/);
  } finally { fixture.close(); }
});

test('the tracker saves chaos, scene and lists without touching the rest of the state', async () => {
  const fixture = await context();
  try {
    const { user, campaign, solo } = fixture;
    const first = solo.track(user.id, campaign, { revision: 0, chaos: 7, scene: { title: 'The gate', expected: 'A quiet crossing' }, threads: [{ id: 't-1', name: ' Find the caravan ', note: '', done: false }] });
    assert.equal(first.revision, 1);
    assert.equal(first.chaos, 7);
    assert.deepEqual(first.scene, { title: 'The gate', goal: '', expected: 'A quiet crossing', signature: '', signatureCost: 1 });
    assert.deepEqual(first.threads, [{ id: 't-1', name: 'Find the caravan', note: '', done: false }]);
    const second = solo.track(user.id, campaign, { revision: 1, characters: [{ id: 'c-1', name: 'The keeper', note: 'wary', done: false }] });
    assert.equal(second.chaos, 7);
    assert.equal(second.threads?.length, 1);
    assert.equal(second.characters?.[0]?.note, 'wary');
    assert.equal(second.pool.length, 12);
    assert.throws(() => solo.track(user.id, campaign, { revision: 1, chaos: 5 }), /Reload the latest version/);
    assert.throws(() => solo.track(user.id, campaign, { revision: 2, chaos: 10 }), /Invalid solo number/);
    assert.throws(() => solo.track(user.id, campaign, { revision: 2, threads: [{ id: 't-2', name: '  ', note: '', done: false }] }), /Invalid tracker item/);
    assert.throws(() => solo.track(user.id, campaign, { revision: 2, threads: Array.from({ length: 26 }, (_, index) => ({ id: `t-${index}`, name: 'x', note: '', done: false })) }), /Invalid tracker list/);
    assert.equal(solo.snapshot(user.id, campaign).state.revision, 2);
  } finally { fixture.close(); }
});

test('the scene test reads the saved chaos factor', async () => {
  const run = async (roll: number, extra: number[] = [], state: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => {
    const fixture = await context(fakeMythic, [...(input.auto ? [] : [face(roll, 10)]), ...extra]);
    try {
      fixture.solo.track(fixture.user.id, fixture.campaign, { revision: 0, chaos: 6, scene: { title: 'The gate', expected: '' }, ...state });
      return fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: `scene-${roll}`, kind: 'mythic-scene', ...input });
    } finally { fixture.close(); }
  };
  const expected = await run(7);
  assert.equal(expected.result.title, 'Expected scene');
  assert.equal(expected.question, 'The gate');
  assert.match(expected.result.detail, /d10: 7 · Chaos 6/);
  assert.equal((await run(5)).result.title, 'Altered scene');
  const interrupt = await run(6, [face(90, 100), face(10, 100), face(60, 100)]);
  assert.equal(interrupt.result.title, 'Interrupt scene');
  assert.match(interrupt.result.detail, /Event Focus d100 90: Current Context/);
  assert.match(interrupt.result.detail, /Advance \/ Betray/);
  // A prepared adventure keeps the expected scene and opens it with a Random Event.
  const prepared = await run(5, [face(90, 100)], { preparedAdventure: true });
  assert.equal(prepared.result.title, 'Expected scene with a Random Event');
  assert.match(prepared.result.detail, /Event Focus d100 90: Current Context/);
  const auto = await run(0, [face(3, 100)], {}, { auto: 'interrupt' });
  assert.equal(auto.result.title, 'Interrupt scene');
  assert.match(auto.result.detail, /Event Focus d100 3: Remote Event/);
  const keyed = await run(9, [], { keyedScenes: [{ id: 'k-1', trigger: 'Midnight', event: 'The bells ring', triggered: true, done: false }] });
  assert.match(keyed.result.detail, /Keyed Scene due now: The bells ring/);
});

test('the Scene Adjustment Table makes one or two adjustments', async () => {
  const one = await context(fakeMythic, [face(2, 10)]);
  try { assert.equal(one.solo.roll(one.user.id, one.campaign, { requestId: 'adjust', kind: 'mythic-adjust' }).result.title, 'Add a character'); } finally { one.close(); }
  const two = await context(fakeMythic, [face(8, 10), face(1, 10), face(9, 10), face(6, 10)]);
  try {
    const entry = two.solo.roll(two.user.id, two.campaign, { requestId: 'adjust', kind: 'mythic-adjust' });
    assert.equal(entry.result.title, 'Remove a character + Add an object');
    assert.match(entry.result.detail, /d10: 8, 1, 9, 6 · two adjustments/);
  } finally { two.close(); }
});

test('end of scene bookkeeping moves the chaos factor', async () => {
  const fixture = await context();
  try {
    const { user, campaign, solo } = fixture;
    solo.track(user.id, campaign, { revision: 0, chaos: 9, scene: { title: 'The gate', expected: 'Quiet' } });
    const out = solo.command(user.id, campaign, { revision: 1, command: 'end-scene', control: 'out' });
    assert.equal(out.state.chaos, 9);
    assert.equal(out.state.sceneNumber, 1);
    assert.equal(out.state.scene.title, '');
    assert.equal(solo.command(user.id, campaign, { revision: 2, command: 'end-scene', control: 'in' }).state.chaos, 8);
    assert.equal(solo.command(user.id, campaign, { revision: 3, command: 'end-scene', control: 'same' }).state.chaos, 8);
    assert.throws(() => solo.command(user.id, campaign, { revision: 4, command: 'end-scene', control: 'maybe' }), /Invalid scene control/);
  } finally { fixture.close(); }
});

test('the Thread Progress Track counts progress, triggers flashpoints and runs discovery checks', async () => {
  const fixture = await context(fakeMythic, [
    face(90, 100), face(10, 100), // the flashpoint's focus is forced, so these are its two meaning words
    face(40, 100), face(4, 10), face(10, 100), face(60, 100), // discovery: Yes, d10 4
    face(95, 100), // discovery: Exceptional No
  ]);
  try {
    const { user, campaign, solo } = fixture;
    solo.track(user.id, campaign, { revision: 0, threads: items('t', 1) });
    assert.throws(() => solo.roll(user.id, campaign, { requestId: 'early', kind: 'mythic-discovery' }), /start a Thread Progress Track/);
    assert.throws(() => solo.command(user.id, campaign, { revision: 1, command: 'thread-track-start', threadId: 't-1', length: 12 }), /Invalid track length/);
    let state = solo.command(user.id, campaign, { revision: 1, command: 'thread-track-start', threadId: 't-1', length: 15 }).state;
    state = solo.command(user.id, campaign, { revision: state.revision, command: 'thread-track-progress' }).state;
    state = solo.command(user.id, campaign, { revision: state.revision, command: 'thread-track-progress' }).state;
    assert.equal(state.threadTrack?.points, 4);
    // Crossing 5 with no flashpoint in the phase triggers one, worth 2 more.
    const crossed = solo.command(user.id, campaign, { revision: state.revision, command: 'thread-track-progress' });
    assert.equal(crossed.state.threadTrack?.points, 8);
    assert.equal(crossed.state.threadTrack?.pendingFlashpoints, 1);
    assert.match(crossed.detail, /the Track triggers one/);
    const flash = solo.roll(user.id, campaign, { requestId: 'flash', kind: 'mythic-event', reason: 'flashpoint' });
    assert.equal(flash.result.title, 'Flashpoint');
    assert.match(flash.result.detail, /Event Focus \(chosen\): Current Context/);
    assert.equal(solo.current(user.id, campaign).threadTrack?.pendingFlashpoints, 0);
    assert.throws(() => solo.roll(user.id, campaign, { requestId: 'early-end', kind: 'mythic-event', reason: 'conclusion' }), /not complete/);
    // Odds below 50/50 are raised to 50/50: a 40 is a Yes. d10 4 + 8 = 12 is Track +1.
    const found = solo.roll(user.id, campaign, { requestId: 'found', kind: 'mythic-discovery', odds: 'impossible' });
    assert.equal(found.result.title, 'Discovery: Yes');
    assert.match(found.result.detail, /Odds: 50\/50/);
    assert.match(found.result.detail, /Thread Discovery d10 4 \+ 8 = 12: Track \+1/);
    assert.equal(solo.current(user.id, campaign).threadTrack?.points, 9);
    const dead = solo.roll(user.id, campaign, { requestId: 'dead', kind: 'mythic-discovery' });
    assert.equal(dead.result.title, 'Discovery: Exceptional No');
    assert.throws(() => solo.roll(user.id, campaign, { requestId: 'again', kind: 'mythic-discovery' }), /dead end/);
    const next = solo.command(user.id, campaign, { revision: solo.current(user.id, campaign).revision, command: 'end-scene', control: 'same' });
    assert.equal(next.state.threadTrack?.discoveryBlocked, false);
    // Closing the thread ends its track.
    const closed = solo.track(user.id, campaign, { revision: next.state.revision, threads: [{ ...items('t', 1)[0]!, done: true }] });
    assert.equal(closed.threadTrack, null);
  } finally { fixture.close(); }
});

test('peril points are spent and reset', async () => {
  const fixture = await context();
  try {
    const { user, campaign, solo } = fixture;
    assert.equal(solo.command(user.id, campaign, { revision: 0, command: 'peril', action: 'spend' }).state.peril?.current, 1);
    solo.command(user.id, campaign, { revision: 1, command: 'peril', action: 'spend' });
    assert.throws(() => solo.command(user.id, campaign, { revision: 2, command: 'peril', action: 'spend' }), /no Peril Points left/);
    assert.equal(solo.command(user.id, campaign, { revision: 2, command: 'peril', action: 'reset' }).state.peril?.current, 2);
  } finally { fixture.close(); }
});

test('mythic oracle is idempotent by request id', async () => {
  const fixture = await context(fakeMythic, [face(30, 100), face(97, 100)]);
  try {
    const input = { requestId: 'repeat', kind: 'mythic-oracle', question: 'Is the gate open?', odds: 'impossible' };
    const first = fixture.solo.roll(fixture.user.id, fixture.campaign, input);
    const second = fixture.solo.roll(fixture.user.id, fixture.campaign, input);
    assert.deepEqual(second, first);
    assert.equal(fixture.solo.snapshot(fixture.user.id, fixture.campaign).entries.length, 1);
  } finally { fixture.close(); }
});

test('meaning rolls word pairs from the chosen table', async () => {
  const fixture = await context(fakeMythic, [face(10, 100), face(80, 100), face(80, 100), face(10, 100), face(60, 100)]);
  try {
    const { user, campaign, solo } = fixture;
    const words = solo.roll(user.id, campaign, { requestId: 'words', kind: 'mythic-meaning', choice: 'one-page-description', count: 2 });
    assert.equal(words.result.title, 'Discover Meaning');
    assert.match(words.result.detail, /Discover Meaning, Description\) d100 10: Bright/);
    assert.match(words.result.detail, /d100 80: Cold/);
    const pair = solo.roll(user.id, campaign, { requestId: 'pair', kind: 'mythic-meaning' });
    assert.equal(pair.result.title, 'Betray / Advance');
    assert.equal(pair.result.tone, 'neutral');
    assert.throws(() => solo.roll(user.id, campaign, { requestId: 'missing', kind: 'mythic-meaning', choice: 'elements-smells' }), /“Smells” is not installed/);
    assert.throws(() => solo.roll(user.id, campaign, { requestId: 'unknown', kind: 'mythic-meaning', choice: 'nope' }), /Invalid meaning table/);
  } finally { fixture.close(); }
});

test('an Elements table is rolled twice for a pair, and a Turning Point rolls five Plot Points', async () => {
  const withTables = (): MythicData => {
    const data = fakeMythic();
    data.collectedTables = { tables: [
      { id: 'meaning-elements-smells', title: 'Smells', die: 'd100', entries: [{ range: [1, 50], text: 'Acrid' }, { range: [51, 100], text: 'Sweet' }] },
      { id: 'adventure-themes', title: 'Themes', die: 'd10', entries: [{ range: [1, 5], text: 'Action' }, { range: [6, 10], text: 'Mystery' }] },
      { id: 'plot-points', title: 'Plot Points', die: 'd100', columns: ['Action', 'Mystery'], entries: [{ range: [1, 10], text: 'None' }, { range: [11, 100], cells: ['Chase', 'Clue'] }] },
    ] };
    return data;
  };
  const fixture = await context(withTables, [face(20, 100), face(70, 100), face(50, 100), face(8, 10), face(5, 100)]);
  try {
    const { user, campaign, solo } = fixture;
    assert.equal(solo.roll(user.id, campaign, { requestId: 'smell', kind: 'mythic-meaning', choice: 'elements-smells' }).result.title, 'Acrid / Sweet');
    solo.track(user.id, campaign, { revision: 0, adventureTheme: 'Action' });
    const turning = solo.roll(user.id, campaign, { requestId: 'turn', kind: 'mythic-turning-point' });
    assert.match(turning.result.detail, /1\. Action \(adventure theme\) · d100 50: Chase/);
    assert.match(turning.result.detail, /2\. Mystery \(d10 8\) · d100 5: None/);
    assert.equal(turning.result.detail.split('\n').length, 6);
    assert.throws(() => solo.track(user.id, campaign, { revision: 1, adventureTheme: 'Comedy' }), /Invalid adventure theme/);
  } finally { fixture.close(); }
});

test('mythic tables roll their own die and honor the column picker', async () => {
  const theme = await context(fakeMythic, [face(5, 6)]);
  try {
    const entry = theme.solo.roll(theme.user.id, theme.campaign, { requestId: 'theme', kind: 'mythic-table', source: 'adventureCrafter', tableId: 'theme' });
    assert.equal(entry.result.title, 'Charlie · Delta');
    assert.equal(entry.result.total, 5);
    assert.match(entry.result.detail, /Theme · d6: 5/);
    assert.equal(entry.question, 'Theme');
  } finally { theme.close(); }

  const column = await context(fakeMythic, [face(7, 10)]);
  try {
    const entry = column.solo.roll(column.user.id, column.campaign, { requestId: 'column', kind: 'mythic-table', source: 'locationCrafting', tableId: 'wide', column: 1 });
    assert.equal(entry.result.title, 'East');
    assert.equal(entry.result.total, 7);
    assert.match(entry.result.detail, /Wide · Right · d10: 7/);
  } finally { column.close(); }
});

test('mythic rejects unknown odds, tables, sources and columns', async () => {
  const fixture = await context(fakeMythic, [face(30, 100)]);
  try {
    assert.throws(() => fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: 'bad-odds', kind: 'mythic-oracle', question: 'Q', odds: 'unknown' }), /Invalid Mythic odds/);
    assert.throws(() => fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: 'bad-kind', kind: 'mythic-nope' }), /Invalid solo roll type/);
    assert.throws(() => fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: 'bad-table', kind: 'mythic-table', source: 'oracle', tableId: 'nope' }), /Invalid Mythic table/);
    assert.throws(() => fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: 'bad-source', kind: 'mythic-table', source: 'nope', tableId: 'theme' }), /Invalid Mythic source/);
    assert.throws(() => fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: 'bad-column', kind: 'mythic-table', source: 'locationCrafting', tableId: 'wide', column: 9 }), /Invalid Mythic table column/);
    assert.equal(fixture.solo.snapshot(fixture.user.id, fixture.campaign).entries.length, 0);
  } finally { fixture.close(); }
});

test('mythic rolls fail when the table data is not installed', async () => {
  const fixture = await context(missingMythic);
  try {
    assert.throws(() => fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: 'missing', kind: 'mythic-oracle', question: 'Q', odds: 'impossible' }), /not installed/);
    assert.throws(() => fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: 'missing-table', kind: 'mythic-table', source: 'oracle', tableId: 'anything' }), /not installed/);
  } finally { fixture.close(); }
});

