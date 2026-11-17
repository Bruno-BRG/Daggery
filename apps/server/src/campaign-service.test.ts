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

test('sessions, notes and campaign ownership enforce their boundaries', async () => {
  const db = openCampaignDatabase(':memory:');
  try {
    const service = new CampaignService(db);
    const owner = await service.register('narrator', 'correct horse battery staple');
    const outsider = await service.register('outsider', 'third strong password');
    assert.equal(await service.authenticate('narrator', 'bad password'), null);
    assert.equal((await service.authenticate('NARRATOR', 'correct horse battery staple'))?.id, owner.id);
    const session = service.createSession(owner.id);
    assert.equal(service.session(session)?.id, owner.id);
    assert.equal(JSON.stringify(db.prepare('SELECT token_hash FROM sessions').get()).includes(session), false);
    service.revokeSession(session);
    assert.equal(service.session(session), null);

    const campaign = service.createCampaign(owner.id, 'Test campaign');
    const otherCampaign = service.createCampaign(outsider.id, 'Other campaign');
    assert.equal(service.role(owner.id, campaign), 'gm');
    assert.equal(service.role(outsider.id, campaign), null);
    assert.throws(() => service.listNotes(outsider.id, campaign));

    const secret = service.saveNote(owner.id, campaign, null, 'Secret', 'do not share', 'private');
    const shared = service.saveNote(owner.id, campaign, null, 'Shared', 'hello', 'shared');
    assert.deepEqual(service.listNotes(owner.id, campaign).map(n => n.id).sort(), [secret, shared].sort());
    assert.throws(() => service.saveNote(outsider.id, otherCampaign, shared, 'stolen', 'x', 'shared'));
    service.saveNote(owner.id, campaign, shared, 'Updated', 'everyone can edit', 'shared');
    assert.equal(service.listNotes(owner.id, campaign).find(n => n.id === shared)?.title, 'Updated');
    assert.throws(() => service.updateCampaign(outsider.id, campaign, 'No', '', true));
    service.updateCampaign(owner.id, campaign, 'Archived', '', true);
    assert.throws(() => service.listNotes(owner.id, campaign));
    service.updateCampaign(owner.id, campaign, 'Restored', '', false);
    assert.equal(service.listNotes(owner.id, campaign).length, 2);
  } finally { db.close(); }
});

test('migration 15 drops the AI tables and invites on an older database', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE ai_chats (id TEXT PRIMARY KEY);
      CREATE TABLE ai_turns (id TEXT PRIMARY KEY, chat_id TEXT REFERENCES ai_chats(id));
      CREATE TABLE campaign_invites (token_hash TEXT PRIMARY KEY);
      INSERT INTO ai_chats VALUES ('chat');
      INSERT INTO ai_turns VALUES ('turn', 'chat');
      INSERT INTO campaign_invites VALUES ('token');
      PRAGMA user_version = 14`);
    migrateCampaignDatabase(db);
    assert.equal(db.pragma('user_version', { simple: true }), CURRENT_VERSION);
    for (const table of ['ai_chats', 'ai_turns', 'campaign_invites']) {
      assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), undefined, `${table} is dropped`);
    }
  } finally { db.close(); }
});
