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
