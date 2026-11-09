import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_CONFIGURATION, initialSoloState } from '@daggery/shared';
import { CURRENT_VERSION, migrateCampaignDatabase, openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { SoloConflict, SoloService } from './solo';

test('v2 campaigns migrate to Daggerheart Group while preserving documents and accounts', async () => {
  const db = openCampaignDatabase(':memory:');
  try {
    const campaigns = new CampaignService(db), user = await campaigns.register('migration', 'a strong migration password');
    const id = campaigns.createCampaign(user.id, 'Old campaign');
    db.prepare('INSERT INTO campaign_docs VALUES (?,?,?,?,?)').run(id, 'sheets', 'hero', '{"name":"Existing hero"}', '2025');
    db.exec('ALTER TABLE campaigns DROP COLUMN configuration; PRAGMA user_version = 2');
    migrateCampaignDatabase(db); migrateCampaignDatabase(db);
    assert.equal(db.pragma('user_version', { simple: true }), CURRENT_VERSION);
    assert.deepEqual(campaigns.configuration(id), DEFAULT_CONFIGURATION);
    assert.equal((await campaigns.authenticate(user.username, 'a strong migration password'))?.id, user.id);
    assert.match((db.prepare('SELECT value FROM campaign_docs WHERE campaign_id = ?').get(id) as { value: string }).value, /Existing hero/);
  } finally { db.close(); }
});

test('any user can create a configured campaign; solo privacy and configuration boundaries are enforced', async () => {
  const db = openCampaignDatabase(':memory:');
  try {
    const campaigns = new CampaignService(db), user = await campaigns.register('soloowner', 'a strong owner password'), other = await campaigns.register('another', 'another strong owner password');
    const solo = campaigns.createCampaign(user.id, 'Solo', '', { systemId: 'daggerheart', rulesetId: 'solo', options: { partyMode: 'party', partySize: 3 } });
    assert.equal(campaigns.role(user.id, solo), 'gm');
    assert.equal(campaigns.configuration(solo).options.partySize, 3);
    assert.equal(JSON.parse((db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'combat' AND id = 'fear'").get(solo) as { value: string }).value).value, 3);
    assert.throws(() => campaigns.createInvite(user.id, solo));
    assert.throws(() => campaigns.createCampaign(user.id, 'Bad', '', { systemId: 'missing', rulesetId: 'solo' }));
    const group = campaigns.createCampaign(user.id, 'Group');
    const invite = campaigns.createInvite(user.id, group);
    campaigns.updateCampaign(user.id, group, 'Now solo', '', false, { systemId: 'daggerheart', rulesetId: 'solo' });
    assert.throws(() => campaigns.acceptInvite(other.id, invite));
    const shared = campaigns.createCampaign(user.id, 'Shared');
    campaigns.acceptInvite(other.id, campaigns.createInvite(user.id, shared));
    assert.throws(() => campaigns.updateCampaign(user.id, shared, 'No', '', false, { systemId: 'daggerheart', rulesetId: 'solo' }));
    assert.throws(() => campaigns.updateCampaign(other.id, shared, 'No', '', false, DEFAULT_CONFIGURATION));
  } finally { db.close(); }
});

test('solo preparation, oracle history, accepted facts and procedures persist without resource farming', async () => {
  const db = openCampaignDatabase(':memory:');
  try {
    const campaigns = new CampaignService(db), user = await campaigns.register('soloplay', 'a strong play password'), stranger = await campaigns.register('stranger', 'another strong play password');
    const id = campaigns.createCampaign(user.id, 'Solo', '', { systemId: 'daggerheart', rulesetId: 'solo', options: { partyMode: 'companion' } });
    const group = campaigns.createCampaign(user.id, 'Group');
    const published: string[] = [], solo = new SoloService(db, campaigns, (_campaign, ns, key) => { published.push(`${ns}/${key}`); });
    assert.throws(() => solo.snapshot(stranger.id, id)); assert.throws(() => solo.snapshot(user.id, group));
    const state = initialSoloState(); state.scene.title = 'The lighthouse'; state.pool[0] = 'The keeper';
    state.countdowns.progressName = 'Find the exit'; state.countdowns.consequenceName = 'Flood';
    state.companions.push({ id: 'ally', name: 'Mira', motive: 'Protect', bond: 'Friend', specialty: 'Scout', tier: 1, hpMarked: 0, stressMarked: 0 });
    const saved = solo.save(user.id, id, state);
    assert.equal(saved.revision, 1);
    assert.throws(() => solo.save(user.id, id, state), SoloConflict);
    const fearBefore = db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'combat'").get(id);
    for (const kind of ['oracle', 'scene', 'prompt', 'response']) {
      const input = { requestId: kind, kind, question: 'Is it occupied?', likelihood: 'even', tone: 'fear' };
      const entry = solo.roll(user.id, id, input);
      assert.deepEqual(solo.roll(user.id, id, input), entry, 'retried request must not reroll');
      solo.accept(user.id, id, entry.id, 'A concrete interpretation');
    }
    assert.deepEqual(db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'combat'").get(id), fearBefore);
    assert.deepEqual(solo.snapshot(user.id, id).state.beat, saved.beat, 'oracles never reset the action beat');
    assert.equal(solo.snapshot(user.id, id).entries.length, 4);
    const companion = solo.command(user.id, id, { command: 'companion', revision: 1, companionId: 'ally', contribution: 'strike', confirmed: true });
    assert.equal(companion.state.companions[0]?.stressMarked, 1);
    assert.throws(() => solo.command(user.id, id, { command: 'companion', revision: 2, companionId: 'ally', contribution: 'cover', confirmed: true }));
    const clock = solo.command(user.id, id, { command: 'countdown', revision: 2, outcome: 'success-fear' });
    assert.equal(clock.state.countdowns.progress, 3); assert.equal(clock.state.countdowns.consequence, 5);
    assert.throws(() => solo.command(user.id, id, { command: 'countdown', revision: 3, outcome: 'success-fear' }));
    assert.throws(() => solo.command(user.id, id, { command: 'spend-fear', revision: 3, amount: 1 }), 'initial Fear is below pacing threshold');
    db.prepare("UPDATE campaign_docs SET value = ? WHERE campaign_id = ? AND ns = 'combat' AND id = 'fear'").run('{"kind":"fear","value":5}', id);
    const spent = solo.command(user.id, id, { command: 'spend-fear', revision: 3, amount: 2 });
    assert.equal(spent.state.beat.fearSpent, true);
    assert.ok(published.includes('combat/fear'));
    assert.throws(() => solo.command(user.id, id, { command: 'spend-fear', revision: 4, amount: 1 }));
    const reloaded = new SoloService(db, campaigns).snapshot(user.id, id);
    assert.equal(reloaded.state.scene.title, 'The lighthouse');
    assert.ok(reloaded.entries.some(entry => entry.kind === 'procedure' && entry.result.title.includes('Strike together')));
    const duplicatePool = { ...reloaded.state, pool: Array(12).fill('same') };
    assert.throws(() => solo.save(user.id, id, duplicatePool));
    assert.equal(solo.snapshot(user.id, id).state.revision, 4, 'failed writes roll back');
    db.prepare('INSERT INTO campaign_docs VALUES (?,?,?,?,?)').run(id, 'sheets', 'hero', '{"id":"hero","name":"Hero","hope":2}', '2026');
    solo.command(user.id, id, { command: 'next-beat', revision: 4 });
    const assisted = solo.command(user.id, id, { command: 'companion', revision: 5, companionId: 'ally', contribution: 'assist', heroId: 'hero', confirmed: true });
    assert.equal(assisted.state.beat.assistedHeroId, 'hero');
    assert.equal(JSON.parse((db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'sheets' AND id = 'hero'").get(id) as { value: string }).value).hope, 1);
    assert.ok(published.includes('sheets/hero'));
    const consumed = solo.command(user.id, id, { command: 'consume-assist', revision: 6, heroId: 'hero' });
    assert.equal(consumed.state.beat.assistConsumed, true);
    assert.throws(() => solo.command(user.id, id, { command: 'consume-assist', revision: 7, heroId: 'hero' }));
    assert.equal(solo.snapshot(user.id, id).state.revision, 7);
    // Stable journal cursors keep all history accessible without pushing it into WebSocket snapshots.
    for (let index = 0; index < 205; index++) solo.roll(user.id, id, { requestId: `note-${index}`, kind: 'journal', question: `Note ${index}` });
    const first = solo.snapshot(user.id, id);
    assert.equal(first.entries.length, 200); assert.ok(first.nextCursor);
    const older = solo.entries(user.id, id, first.nextCursor!);
    assert.ok(older.entries.length > 0);
    assert.equal(older.nextCursor, null);
    assert.ok(older.entries.every(entry => !first.entries.some(recent => recent.id === entry.id)));
    campaigns.updateCampaign(user.id, id, 'Solo', '', false, { systemId: 'daggerheart', rulesetId: 'solo', options: { partyMode: 'lone' } });
    const changed = solo.snapshot(user.id, id);
    assert.equal(changed.state.beat.assistedHeroId, undefined);
    assert.equal(changed.state.scene.title, 'The lighthouse');
    assert.equal(changed.state.companions[0]?.name, 'Mira');
  } finally { db.close(); }
});
