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

test('mythic oracle maps d100 ranges to all four answers and tones', async () => {
  const cases = [
    [3, 'Exceptional Yes', 'revelation'],
    [30, 'Yes', 'hope'],
    [70, 'No', 'fear'],
    [97, 'Exceptional No', 'fear'],
  ] as const;
  for (const [roll, title, tone] of cases) {
    const fixture = await context(fakeMythic, [face(roll, 100)]);
    try {
      const entry = fixture.solo.roll(fixture.user.id, fixture.campaign, {
        requestId: `odds-${roll}`, kind: 'mythic-oracle', question: 'Is the gate open?', odds: 'impossible',
      });
      assert.equal(entry.result.title, title);
      assert.equal(entry.result.tone, tone);
      assert.equal(entry.result.total, roll);
      assert.match(entry.result.detail, new RegExp(`d100: ${roll}`));
      assert.match(entry.result.detail, /Odds: Impossible/);
      assert.doesNotMatch(entry.result.detail, /Random event/);
    } finally { fixture.close(); }
  }
});

test('mythic oracle doubles trigger a random event with a meaning pair', async () => {
  const fixture = await context(fakeMythic, [face(22, 100), face(60, 100)]);
  try {
    const entry = fixture.solo.roll(fixture.user.id, fixture.campaign, {
      requestId: 'double', kind: 'mythic-oracle', question: 'Is the gate open?', odds: 'impossible',
    });
    assert.equal(entry.result.total, 22);
    assert.equal(entry.result.title, 'Yes');
    assert.match(entry.result.detail, /Random event: Betray \/ Cold/);
  } finally { fixture.close(); }
});

test('mythic oracle non-doubles do not roll a random event', async () => {
  const fixture = await context(fakeMythic, [face(30, 100)]);
  try {
    const entry = fixture.solo.roll(fixture.user.id, fixture.campaign, {
      requestId: 'plain', kind: 'mythic-oracle', question: 'Is the gate open?', odds: 'impossible',
    });
    assert.doesNotMatch(entry.result.detail, /Random event/);
  } finally { fixture.close(); }
});

test('mythic oracle shifts the odds row by the chaos factor', async () => {
  const twoRows = (): MythicData => {
    const data = fakeMythic();
    data.oracle!.tables[0]!.entries.unshift({
      id: 'certain', label: 'Certain',
      ranges: { exceptionalYes: [1, 20], yes: [21, 95], no: [96, 99], exceptionalNo: [100, 100] },
    });
    return data;
  };
  const ask = async (odds: string, chaos: number | undefined, roll: number) => {
    const fixture = await context(twoRows, [face(roll, 100)]);
    try {
      return fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: `chaos-${odds}-${chaos}`, kind: 'mythic-oracle', question: 'Q', odds, ...(chaos === undefined ? {} : { chaos }) });
    } finally { fixture.close(); }
  };
  // 50 is No on the printed Impossible row and Yes on the Certain row.
  assert.equal((await ask('impossible', undefined, 50)).result.title, 'No');
  assert.equal((await ask('impossible', 5, 50)).result.title, 'No');
  const raised = await ask('impossible', 6, 50);
  assert.equal(raised.result.title, 'Yes');
  assert.match(raised.result.detail, /Odds: Impossible · Chaos 6/);
  assert.equal((await ask('certain', 4, 50)).result.title, 'No');
  // The ends clamp: Certain cannot shift further toward Yes.
  assert.equal((await ask('certain', 9, 50)).result.title, 'Yes');
  await assert.rejects(ask('certain', 10, 50), /Invalid solo number/);
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
  const run = async (roll: number, extra: number[] = []) => {
    const fixture = await context(fakeMythic, [face(roll, 10), ...extra]);
    try {
      fixture.solo.track(fixture.user.id, fixture.campaign, { revision: 0, chaos: 6, scene: { title: 'The gate', expected: '' } });
      return fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: `scene-${roll}`, kind: 'mythic-scene' });
    } finally { fixture.close(); }
  };
  const expected = await run(7);
  assert.equal(expected.result.title, 'Expected scene');
  assert.equal(expected.question, 'The gate');
  assert.match(expected.result.detail, /d10: 7 · Chaos 6/);
  assert.equal((await run(5)).result.title, 'Altered scene');
  const interrupt = await run(6, [face(60, 100)]);
  assert.equal(interrupt.result.title, 'Interrupt scene');
  assert.match(interrupt.result.detail, /Event: Betray \/ Cold/);
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

test('mythic meaning rolls the requested number of word pairs', async () => {
  const fixture = await context(fakeMythic, [face(10, 100), face(80, 100)]);
  try {
    const entry = fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: 'meaning', kind: 'mythic-meaning', count: 2 });
    assert.match(entry.result.detail, /d100 10: Advance \/ Bright/);
    assert.match(entry.result.detail, /d100 80: Betray \/ Cold/);
    assert.equal(entry.result.tone, 'neutral');
  } finally { fixture.close(); }
});

test('mythic meaning with count one returns the pair as its title', async () => {
  const fixture = await context(fakeMythic, [face(80, 100)]);
  try {
    const entry = fixture.solo.roll(fixture.user.id, fixture.campaign, { requestId: 'one-word', kind: 'mythic-meaning', count: 1 });
    assert.equal(entry.result.title, 'Betray / Cold');
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
