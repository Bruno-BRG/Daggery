import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { GmActions } from './ai/tools';
import { CAMPAIGN_FRAMES, findCampaignFrame } from './ai/frames';
import { resetSourcebookCache } from './ai/sourcebook';
import { completion, fixture, runTurn } from './ai-test-kit';

// Frame fixtures provide their own shelf; the committed sources/rules must not appear
// installed in these tests.
process.env.DAGGERY_REPO_RULES = 'off';
process.env.DAGGERY_CATALOG_CACHE = 'off';

function book(sourceId: string, title: string, pages: { pdf: number; printed: number | null; text: string }[]) {
  return { sourceId, title, pdfPageCount: pages.length, pages };
}

const CORE = book('core-rulebook', 'Core', Array.from({ length: 10 }, (_, index) => {
  const pdf = 255 + index;
  return { pdf, printed: pdf - 1, text: 'The Witherwild frame page ' + String(pdf - 1) + '.' };
}));
const HOPE = book('hope-and-fear-book', 'Hope & Fear', [
  { pdf: 117, printed: 116, text: 'Castle High. Students investigate disappearances among the skylands.' },
  { pdf: 129, printed: 128, text: 'Reign of the Weredragon. Forlorne rules Whelvia.' },
  { pdf: 130, printed: 129, text: 'Reign of the Weredragon villain builder continues.' },
  { pdf: 131, printed: 130, text: 'Reign of the Weredragon key locations.' },
  { pdf: 145, printed: 144, text: 'Dark Heart of Andaluria. The nights grow longer.' },
  { pdf: 159, printed: 158, text: 'Journey to Horizon doom track.' },
]);
const SABLE = book('sablewood', 'Sablewood', Array.from({ length: 10 }, (_, index) => ({
  pdf: index + 1, printed: null, text: 'Sablewood forest page ' + String(index + 1) + '.',
})));

function shelf(books: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'daggery-frames-'));
  const dir = join(root, 'rules');
  mkdirSync(dir);
  for (const [name, value] of Object.entries(books)) writeFileSync(join(dir, name + '.json'), JSON.stringify(value));
  process.env.DAGGERY_DATA_DIR = root;
  resetSourcebookCache();
  return root;
}

function clean(root: string): void {
  delete process.env.DAGGERY_DATA_DIR;
  resetSourcebookCache();
  rmSync(root, { recursive: true, force: true });
}

async function actionFixture() {
  const db = openCampaignDatabase(':memory:');
  const campaigns = new CampaignService(db);
  const user = await campaigns.register('gmtest', 'a strong temporary test password');
  const campaign = campaigns.createCampaign(user.id, 'Frames', '', { systemId: 'daggerheart', rulesetId: 'core', gmController: 'ai' });
  const actions = new GmActions(db, campaigns);
  const at = new Date().toISOString();
  db.prepare('INSERT INTO ai_turns(id,campaign_id,user_id,request_id,status,error,steps,cost,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('turn-1', campaign, user.id, 'req-1', 'running', '', 0, 0, at, at);
  const ctx = { campaign, owner: user.id, turn: 'turn-1', callId: 'call-1', assertActive: () => {}, publish: () => {}, publishRoll: () => {} };
  return { db, campaign, actions, ctx };
}

test('campaign frame registry has unique, well-formed entries with authored summaries', () => {
  const ids = new Set<string>();
  for (const frame of CAMPAIGN_FRAMES) {
    assert.match(frame.id, /^[a-z0-9][a-z0-9-]*$/);
    assert.ok(!ids.has(frame.id), 'duplicate frame id ' + frame.id);
    ids.add(frame.id);
    assert.ok(frame.title && frame.source && frame.summary);
    assert.ok(frame.pageStart >= 1 && frame.pageEnd >= frame.pageStart);
    assert.ok(frame.summary.length <= 180);
    for (const group of [frame.seed.factions, frame.seed.npcs, frame.seed.locations, frame.seed.hooks]) {
      assert.ok(group.length >= 1 && group.every(item => item.trim().length > 0));
    }
  }
  assert.equal(findCampaignFrame('the-witherwild')?.source, 'core-rulebook');
  assert.equal(findCampaignFrame('REIGN-OF-THE-WEREDRAGON')?.pageEnd, 143);
  assert.equal(findCampaignFrame('castle-high')?.pageStart, 116);
  assert.equal(findCampaignFrame('dark-heart-of-andaluria')?.pageEnd, 157);
  assert.equal(findCampaignFrame('journey-to-horizon')?.source, 'hope-and-fear-book');
  assert.equal(findCampaignFrame('not-a-frame'), undefined);
});

test('list and load campaign frames seed prep and canon once, then read pages in chunks', async t => {
  const root = shelf({ 'core-rulebook': CORE, 'hope-and-fear-book': HOPE, sablewood: SABLE });
  const f = await actionFixture();
  t.after(() => { clean(root); f.db.close(); });
  const listed = f.actions.execute('list_campaign_frames', {}, f.ctx) as { id: string; installed: boolean }[];
  assert.equal(listed.length, CAMPAIGN_FRAMES.length);
  assert.ok(listed.every(frame => frame.installed));

  const first = f.actions.execute('load_campaign_frame', { id: 'reign-of-the-weredragon' }, { ...f.ctx, callId: 'load-1' }) as {
    seeded: boolean; page: number; nextPage: number | null; text: string;
  };
  assert.equal(first.seeded, true);
  assert.equal(first.page, 128);
  assert.equal(first.nextPage, 130);
  assert.ok(first.text.includes('Forlorne'));

  const prep = f.actions.read<{ kind: string; fields: Record<string, string> }>(f.campaign, 'gm', 'scenario:frame:reign-of-the-weredragon');
  assert.equal(prep?.kind, 'scenario');
  assert.equal(prep?.fields.premise, findCampaignFrame('reign-of-the-weredragon')?.summary);
  assert.ok(prep!.fields.factions?.includes('Forlorne'));
  assert.equal(f.actions.read<{ kind: string; fields: Record<string, string> }>(f.campaign, 'gm', 'setting')?.fields.premise, findCampaignFrame('reign-of-the-weredragon')?.summary);
  assert.ok(f.actions.read(f.campaign, 'gm', 'frame:reign-of-the-weredragon'));
  assert.ok(f.actions.canon.search(f.campaign, 'Forlorne', 10).length >= 1);

  const again = f.actions.execute('load_campaign_frame', { id: 'reign-of-the-weredragon', page: 130 }, { ...f.ctx, callId: 'load-2' }) as { seeded: boolean };
  assert.equal(again.seeded, false, 'the seed is written only on the first load');

  const chunk = f.actions.execute('load_campaign_frame', { id: 'the-witherwild' }, { ...f.ctx, callId: 'load-3' }) as { page: number; nextPage: number | null; text: string };
  assert.equal(chunk.page, 254);
  assert.equal(chunk.nextPage, 256, 'the next chunk starts after the two pages returned');
  assert.ok(chunk.text.includes('Witherwild'));
  const last = f.actions.execute('load_campaign_frame', { id: 'the-witherwild', page: 260 }, { ...f.ctx, callId: 'load-4' }) as { nextPage: number | null };
  assert.equal(last.nextPage, null);
  assert.throws(() => f.actions.execute('load_campaign_frame', { id: 'not-a-frame' }, { ...f.ctx, callId: 'load-5' }), /Invalid campaign frame/);
});

test('a frame whose sourcebook is not installed fails with a clear error', async t => {
  const root = shelf({ 'hope-and-fear-book': HOPE });
  const f = await actionFixture();
  t.after(() => { clean(root); f.db.close(); });
  const listed = f.actions.execute('list_campaign_frames', {}, { ...f.ctx, callId: 'list-1' }) as { id: string; installed: boolean }[];
  assert.equal(listed.find(frame => frame.id === 'sablewood')?.installed, false);
  assert.throws(() => f.actions.execute('load_campaign_frame', { id: 'sablewood' }, { ...f.ctx, callId: 'load-1' }), /Invalid campaign frame pages/);
});

test('adventure setup validates the selected campaign frame', async () => {
  const f = await fixture(() => completion('Ready.'));
  try {
    assert.throws(
      () => f.ai.configure(f.user.id, f.campaign, { premise: 'A quiet town', frame: 'not-a-frame', heroId: f.setup.heroId }),
      /Invalid campaign frame/,
    );
    const saved = f.ai.configure(f.user.id, f.campaign, { premise: 'A quiet town', frame: 'sablewood', heroId: f.setup.heroId });
    assert.equal(saved.frame, 'sablewood');
    assert.equal(f.ai.session(f.user.id, f.campaign).setup.frame, 'sablewood');
    assert.ok(f.ai.session(f.user.id, f.campaign).frames.some(frame => frame.id === 'the-witherwild'));
    await runTurn(f, 'Begin.');
    const systems = (f.requests.at(-1)!.body.messages as { role: string; content: string | null }[])
      .filter(message => message.role === 'system').map(message => message.content ?? '');
    assert.ok(systems.some(content => content.includes('"Sablewood" campaign frame')), 'the GM prompt names the selected frame');
  } finally { await f.close(); }
});
