import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { backupDatabase, CURRENT_VERSION, LEGACY_CAMPAIGN_ID, migrateCampaignDatabase, openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';

test('migration preserves legacy data and is idempotent', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE docs (ns TEXT, id TEXT, value TEXT, updated TEXT, PRIMARY KEY(ns,id));
    CREATE TABLE rolls (id INTEGER PRIMARY KEY, at TEXT, author TEXT, kind TEXT, payload TEXT);
    INSERT INTO docs VALUES ('map', 'scene:1', '{"mapUrl":"/assets/old.png"}', '2025');
    INSERT INTO rolls VALUES (1, '2025', 'A', 'dice', '{"total":4}');`);
  migrateCampaignDatabase(db);
  migrateCampaignDatabase(db);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM docs').get() as {n:number}).n, 1);
  assert.deepEqual(db.prepare('SELECT campaign_id, value FROM campaign_docs').get(), {
    campaign_id: LEGACY_CAMPAIGN_ID, value: '{"mapUrl":"/assets/old.png"}',
  });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM campaign_rolls').get() as {n:number}).n, 1);
  assert.equal((db.prepare('SELECT owner_id FROM campaigns').get() as {owner_id:string|null}).owner_id, null);
  db.close();
});

test('version 1 upgrades without changing existing accounts or campaigns', async () => {
  const db = openCampaignDatabase(':memory:');
  try {
    const service = new CampaignService(db);
    const user = await service.register('existing', 'an existing strong password');
    const campaign = service.createCampaign(user.id, 'Existing');
    db.exec('DROP TABLE email_codes; DROP INDEX users_email; ALTER TABLE users DROP COLUMN email; ALTER TABLE campaigns DROP COLUMN configuration; PRAGMA user_version = 1');
    migrateCampaignDatabase(db);
    assert.equal(db.pragma('user_version', { simple: true }), CURRENT_VERSION);
    assert.equal((await service.authenticate('existing', 'an existing strong password'))?.id, user.id);
    assert.equal(service.listCampaigns(user.id)[0]?.id, campaign);
    assert.equal(db.prepare('SELECT email FROM users WHERE id = ?').get(user.id) && true, true);
    migrateCampaignDatabase(db);
  } finally { db.close(); }
});

test('legacy campaign requires an explicit local claim and cannot be claimed twice', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE docs (ns TEXT, id TEXT, value TEXT, updated TEXT, PRIMARY KEY(ns,id));
      INSERT INTO docs VALUES ('sheets', 'one', '{}', '2025');`);
    migrateCampaignDatabase(db);
    const service = new CampaignService(db);
    const owner = await service.register('owner', 'a sufficiently long password');
    const other = await service.register('other', 'another sufficiently long password');
    assert.deepEqual(service.listCampaigns(owner.id), []);
    service.claimLegacyForLocalAdmin(owner.id);
    assert.equal(service.listCampaigns(owner.id)[0]?.id, LEGACY_CAMPAIGN_ID);
    assert.throws(() => service.claimLegacyForLocalAdmin(other.id));
    assert.equal(service.role(other.id, LEGACY_CAMPAIGN_ID), null);
  } finally { db.close(); }
});

test('failed migration rolls back its schema and version', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE docs (ns TEXT)');
  db.exec("INSERT INTO docs VALUES ('broken')");
  assert.throws(() => migrateCampaignDatabase(db));
  assert.equal(db.pragma('user_version', { simple: true }), 0);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").get(), undefined);
  db.close();
});

test('backup includes committed WAL data and does not overwrite a backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'daggery-test-'));
  const db = openCampaignDatabase(join(dir, 'live.db'));
  try {
    db.prepare('INSERT INTO users(id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run('u', 'test', 'hash', '2025');
    const destination = join(dir, 'backup.db');
    await backupDatabase(db, destination);
    await assert.rejects(() => backupDatabase(db, destination));
    const restored = new Database(destination, { readonly: true });
    try {
      assert.equal((restored.prepare('SELECT username FROM users WHERE id = ?').get('u') as { username: string }).username, 'test');
    } finally { restored.close(); }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sessions, invites and notes enforce campaign and author boundaries', async () => {
  const db = openCampaignDatabase(':memory:');
  try {
    const service = new CampaignService(db);
    const gm = await service.register('narrator', 'correct horse battery staple');
    const player = await service.register('player', 'another strong password');
    const outsider = await service.register('outsider', 'third strong password');
    assert.equal(await service.authenticate('narrator', 'bad password'), null);
    assert.equal((await service.authenticate('NARRATOR', 'correct horse battery staple'))?.id, gm.id);
    const session = service.createSession(gm.id);
    assert.equal(service.session(session)?.id, gm.id);
    assert.equal(JSON.stringify(db.prepare('SELECT token_hash FROM sessions').get()).includes(session), false);
    service.revokeSession(session);
    assert.equal(service.session(session), null);

    const campaign = service.createCampaign(gm.id, 'Test campaign');
    const otherCampaign = service.createCampaign(outsider.id, 'Other campaign');
    const invite = service.createInvite(gm.id, campaign);
    assert.equal(JSON.stringify(db.prepare('SELECT token_hash FROM campaign_invites').get()).includes(invite), false);
    assert.equal(service.acceptInvite(player.id, invite), campaign);
    assert.throws(() => service.acceptInvite(outsider.id, invite));
    assert.throws(() => service.createInvite(player.id, campaign));
    assert.throws(() => service.listNotes(outsider.id, campaign));

    const secret = service.saveNote(player.id, campaign, null, 'Secret', 'do not share', 'private');
    const shared = service.saveNote(player.id, campaign, null, 'Shared', 'hello', 'shared');
    assert.deepEqual(service.listNotes(gm.id, campaign).map(n => n.id), [shared]);
    assert.equal(service.listNotes(player.id, campaign).length, 2);
    assert.throws(() => service.saveNote(gm.id, campaign, secret, 'stolen', 'x', 'shared'));
    assert.throws(() => service.deleteNote(gm.id, campaign, secret));
    assert.throws(() => service.saveNote(outsider.id, otherCampaign, shared, 'stolen', 'x', 'shared'));
    service.saveNote(gm.id, campaign, shared, 'Updated', 'everyone can edit', 'shared');
    assert.throws(() => service.saveNote(gm.id, campaign, shared, 'hidden', '', 'private'));
    assert.equal(service.listNotes(player.id, campaign).find(n => n.id === shared)?.title, 'Updated');
    assert.throws(() => service.updateCampaign(player.id, campaign, 'No', '', true));
    service.updateCampaign(gm.id, campaign, 'Archived', '', true);
    assert.throws(() => service.listNotes(player.id, campaign));
    service.updateCampaign(gm.id, campaign, 'Restored', '', false);
    assert.equal(service.listNotes(player.id, campaign).length, 2);
  } finally { db.close(); }
});
