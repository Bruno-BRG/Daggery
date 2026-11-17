import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type Database from 'better-sqlite3';
import { LEGACY_CAMPAIGN_ID } from './campaign-db';
import { DEFAULT_CONFIGURATION, getGameSystem, getRuleset, normalizeConfiguration, type CampaignConfiguration } from '@daggery/shared';

export type CampaignRole = 'gm' | 'player';
export type NoteVisibility = 'private' | 'shared';
export interface User { id: string; username: string }
export interface Campaign { id: string; name: string; description: string; role: CampaignRole; archivedAt: string | null; configuration: CampaignConfiguration }
export interface Note { id: string; campaignId: string; authorId: string; title: string; body: string; visibility: NoteVisibility; createdAt: string; updatedAt: string }
export interface CampaignExport {
  format: 'daggery-campaign';
  version: 1;
  exportedAt: string;
  campaign: { name: string; description: string; configuration: CampaignConfiguration };
  docs: { ns: string; id: string; value: unknown }[];
  notes: { title: string; body: string }[];
}

const token = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const validName = (value: string, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** Old rows may still hold the removed 'core' ruleset or a legacy gmController key; normalise both. */
function readConfiguration(raw: string): CampaignConfiguration {
  try { return normalizeConfiguration(JSON.parse(raw) as unknown); }
  catch { return DEFAULT_CONFIGURATION; }
}

/** A campaign has exactly one member: its owner, who always acts as the GM. */
export class CampaignService {
  constructor(private readonly db: Database.Database) {}

  async register(username: string, password: string): Promise<User> {
    if (!validName(username, 40) || !/^[\p{L}\p{N}_.-]+$/u.test(username) || typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Invalid credentials');
    const user = { id: randomUUID(), username: username.trim() };
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    this.db.prepare('INSERT INTO users(id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(user.id, user.username, hash, now());
    return user;
  }

  async authenticate(username: string, password: string): Promise<User | null> {
    if (typeof username !== 'string' || username.length > 40 || typeof password !== 'string' || password.length > 1024) return null;
    const row = this.db.prepare('SELECT id, username, password_hash AS hash FROM users WHERE username = ?').get(username) as (User & { hash: string }) | undefined;
    if (!row || row.hash === '!email-only' || !(await argon2.verify(row.hash, password))) return null;
    return { id: row.id, username: row.username };
  }

  createSession(userId: string): string {
    const value = token();
    this.db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(digest(value), userId, new Date(Date.now() + 7 * 86400_000).toISOString(), now());
    return value;
  }
  session(value: string): User | null {
    if (typeof value !== 'string' || value.length !== 43) return null;
    return (this.db.prepare(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(value), now()) as User | undefined) ?? null;
  }
  revokeSession(value: string): void {
    if (typeof value === 'string' && value.length === 43) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(value));
  }

  createCampaign(userId: string, name: string, description = '', configuration?: unknown): string {
    if (!validName(name, 100) || typeof description !== 'string' || description.length > 2000) throw new Error('Invalid campaign');
    const id = randomUUID();
    const config = normalizeConfiguration(configuration);
    this.db.transaction(() => {
      const at = now();
      this.db.prepare('INSERT INTO campaigns(id, name, description, owner_id, created_at, updated_at, configuration) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, name.trim(), description, userId, at, at, JSON.stringify(config));
      this.initializeRulesetDocuments(id, config);
    })();
    return id;
  }
  listCampaigns(userId: string): Campaign[] {
    const rows = this.db.prepare(`SELECT c.id, c.name, c.description, c.archived_at AS archivedAt, c.configuration
      FROM campaigns c WHERE c.owner_id = ? ORDER BY c.updated_at DESC`).all(userId) as { id: string; name: string; description: string; archivedAt: string | null; configuration: string }[];
    return rows.map(row => ({ ...row, role: 'gm' as const, configuration: readConfiguration(row.configuration) }));
  }
  configuration(campaignId: string): CampaignConfiguration {
    const row = this.db.prepare('SELECT configuration FROM campaigns WHERE id = ?').get(campaignId) as { configuration: string } | undefined;
    if (!row) throw new Error('Forbidden');
    return readConfiguration(row.configuration);
  }
  private owns(userId: string, campaignId: string): boolean {
    return !!this.db.prepare('SELECT 1 AS found FROM campaigns WHERE id = ? AND owner_id = ?').get(campaignId, userId);
  }
  private requireOwner(userId: string, campaignId: string): void {
    if (!this.owns(userId, campaignId)) throw new Error('Forbidden');
  }
  private initializeRulesetDocuments(campaignId: string, config: CampaignConfiguration) {
    for (const doc of getRuleset(config)?.initialDocuments?.(config.options) ?? []) {
      this.db.prepare('INSERT OR IGNORE INTO campaign_docs(campaign_id,ns,id,value,updated) VALUES (?,?,?,?,?)')
        .run(campaignId, doc.ns, doc.id, JSON.stringify(doc.value), now());
    }
  }
  role(userId: string, campaignId: string): CampaignRole | null {
    const row = this.db.prepare('SELECT 1 AS found FROM campaigns WHERE id = ? AND owner_id = ? AND archived_at IS NULL').get(campaignId, userId);
    return row ? 'gm' : null;
  }
  requireMember(userId: string, campaignId: string): CampaignRole {
    const role = this.role(userId, campaignId);
    if (!role) throw new Error('Forbidden');
    return role;
  }
  requireGm(userId: string, campaignId: string): void {
    this.requireMember(userId, campaignId);
  }
  updateCampaign(userId: string, campaignId: string, name: string, description: string, archived: boolean, configuration?: unknown): void {
    this.requireOwner(userId, campaignId);
    if (!validName(name, 100) || typeof description !== 'string' || description.length > 2000 || typeof archived !== 'boolean') throw new Error('Invalid campaign');
    const old = this.configuration(campaignId);
    const config = configuration === undefined ? old : normalizeConfiguration(configuration);
    if (config.systemId !== old.systemId) throw new Error('Invalid system change: create a new campaign for a different system');
    this.db.transaction(() => {
      this.db.prepare('UPDATE campaigns SET name = ?, description = ?, configuration = ?, updated_at = ?, archived_at = ? WHERE id = ?')
        .run(name.trim(), description, JSON.stringify(config), now(), archived ? now() : null, campaignId);
      const patches = getGameSystem(config.systemId)?.configurationChanged?.({ before: old, after: config, newId: randomUUID,
        readDocument: (ns, id) => {
          const row = this.db.prepare('SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = ? AND id = ?').get(campaignId, ns, id) as { value: string } | undefined;
          return row ? JSON.parse(row.value) as unknown : undefined;
        },
      }) ?? [];
      for (const patch of patches) {
        this.db.prepare('UPDATE campaign_docs SET value = ?, updated = ? WHERE campaign_id = ? AND ns = ? AND id = ?').run(JSON.stringify(patch.value), now(), campaignId, patch.ns, patch.id);
      }
      this.initializeRulesetDocuments(campaignId, config);
    })();
  }
  /**
   * Permanently deletes an archived campaign. Every campaign table cascades from `campaigns`, so one
   * delete removes documents, rolls, notes and assets. Returns the stored asset file names so the
   * caller can remove them from disk.
   */
  deleteCampaign(userId: string, campaignId: string): string[] {
    this.requireOwner(userId, campaignId);
    const campaign = this.db.prepare('SELECT archived_at AS archivedAt FROM campaigns WHERE id = ?').get(campaignId) as { archivedAt: string | null } | undefined;
    if (!campaign?.archivedAt) throw new Error('Invalid action: archive the campaign before deleting it');
    return this.db.transaction(() => {
      const files = (this.db.prepare('SELECT storage_name AS name FROM campaign_assets WHERE campaign_id = ?').all(campaignId) as { name: string }[]).map(row => row.name);
      this.db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);
      return files;
    })();
  }
  /** This is for an explicit local-admin command only, never an HTTP endpoint. */
  claimLegacyForLocalAdmin(userId: string): void {
    this.db.transaction(() => {
      const result = this.db.prepare('UPDATE campaigns SET owner_id = ?, updated_at = ? WHERE id = ? AND owner_id IS NULL').run(userId, now(), LEGACY_CAMPAIGN_ID);
      if (result.changes !== 1) throw new Error('Legacy campaign unavailable');
    })();
  }
  /** A portable JSON snapshot. Binary assets and uploads stay on the server. */
  exportCampaign(userId: string, campaignId: string): CampaignExport {
    this.requireOwner(userId, campaignId);
    const row = this.db.prepare('SELECT name, description, configuration FROM campaigns WHERE id = ?').get(campaignId) as { name: string; description: string; configuration: string } | undefined;
    if (!row) throw new Error('Forbidden');
    const docs = this.db.prepare('SELECT ns, id, value FROM campaign_docs WHERE campaign_id = ? ORDER BY ns, id').all(campaignId) as { ns: string; id: string; value: string }[];
    const notes = this.db.prepare('SELECT title, body FROM campaign_notes WHERE campaign_id = ? ORDER BY created_at, id').all(campaignId) as { title: string; body: string }[];
    return {
      format: 'daggery-campaign', version: 1, exportedAt: now(),
      campaign: { name: row.name, description: row.description, configuration: readConfiguration(row.configuration) },
      docs: docs.map(doc => ({ ns: doc.ns, id: doc.id, value: JSON.parse(doc.value) as unknown })),
      notes: notes.map(note => ({ title: note.title, body: note.body })),
    };
  }
  /**
   * Restores an exported campaign as a new campaign owned by the caller. Everything happens in one
   * transaction; only namespaces the current ruleset allows are copied, and assets are not included.
   */
  importCampaign(userId: string, raw: unknown): Campaign {
    if (!isRecord(raw) || raw.format !== 'daggery-campaign' || raw.version !== 1) throw new Error('Invalid campaign export');
    const data = raw as { campaign?: unknown; docs?: unknown; notes?: unknown };
    if (!isRecord(data.campaign)) throw new Error('Invalid campaign export');
    const { name, description, configuration } = data.campaign;
    if (typeof name !== 'string' || !validName(name, 100) || typeof description !== 'string' || description.length > 2000) throw new Error('Invalid campaign export');
    const config = normalizeConfiguration(configuration);
    if (!Array.isArray(data.docs) || data.docs.length > 10_000) throw new Error('Invalid campaign export');
    if (!Array.isArray(data.notes) || data.notes.length > 5_000) throw new Error('Invalid campaign export');
    const allowed = new Set((getRuleset(config)?.documents ?? []).map(policy => policy.namespace));
    const docs = data.docs.map(entry => {
      if (!isRecord(entry) || typeof entry.ns !== 'string' || typeof entry.id !== 'string' || !entry.id || entry.id.length > 120 || !isRecord(entry.value)) throw new Error('Invalid campaign export');
      return { ns: entry.ns, id: entry.id, value: entry.value };
    }).filter(entry => allowed.has(entry.ns));
    const notes = data.notes.map(entry => {
      if (!isRecord(entry) || typeof entry.title !== 'string' || !validName(entry.title, 200) || typeof entry.body !== 'string' || entry.body.length > 100_000) throw new Error('Invalid campaign export');
      return { title: entry.title.trim(), body: entry.body };
    });
    return this.db.transaction(() => {
      const taken = !!this.db.prepare('SELECT 1 AS found FROM campaigns WHERE owner_id = ? AND name = ? AND archived_at IS NULL').get(userId, String(name).trim());
      const suffix = ' (imported)';
      const finalName = taken ? `${String(name).trim().slice(0, 100 - suffix.length)}${suffix}` : String(name).trim();
      const id = randomUUID(), at = now();
      this.db.prepare('INSERT INTO campaigns(id, name, description, owner_id, created_at, updated_at, configuration) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, finalName, description, userId, at, at, JSON.stringify(config));
      this.initializeRulesetDocuments(id, config);
      const upsert = this.db.prepare(`INSERT INTO campaign_docs(campaign_id, ns, id, value, updated) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(campaign_id,ns,id) DO UPDATE SET value=excluded.value, updated=excluded.updated`);
      for (const doc of docs) upsert.run(id, doc.ns, doc.id, JSON.stringify(doc.value), at);
      const insertNote = this.db.prepare(`INSERT INTO campaign_notes(id, campaign_id, author_id, title, body, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'shared', ?, ?)`);
      for (const note of notes) insertNote.run(randomUUID(), id, userId, note.title, note.body, at, at);
      return { id, name: finalName, description, role: 'gm' as const, archivedAt: null, configuration: config };
    })();
  }

  listNotes(userId: string, campaignId: string): Note[] {
    this.requireMember(userId, campaignId);
    return this.db.prepare(`SELECT id, campaign_id AS campaignId, author_id AS authorId, title, body, visibility,
      created_at AS createdAt, updated_at AS updatedAt FROM campaign_notes
      WHERE campaign_id = ? AND (visibility = 'shared' OR author_id = ?) ORDER BY updated_at DESC`).all(campaignId, userId) as Note[];
  }
  saveNote(userId: string, campaignId: string, id: string | null, title: string, body: string, visibility: NoteVisibility): string {
    this.requireMember(userId, campaignId);
    if (!validName(title, 200) || typeof body !== 'string' || body.length > 100_000 || !['private', 'shared'].includes(visibility)) throw new Error('Invalid note');
    if (!id) {
      const noteId = randomUUID();
      const at = now();
      this.db.prepare('INSERT INTO campaign_notes(id, campaign_id, author_id, title, body, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(noteId, campaignId, userId, title.trim(), body, visibility, at, at);
      return noteId;
    }
    const existing = this.db.prepare('SELECT author_id AS authorId, visibility FROM campaign_notes WHERE id = ? AND campaign_id = ?').get(id, campaignId) as { authorId: string; visibility: NoteVisibility } | undefined;
    if (!existing || (existing.visibility === 'private' && existing.authorId !== userId) || (visibility === 'private' && existing.authorId !== userId)) throw new Error('Forbidden');
    this.db.prepare('UPDATE campaign_notes SET title = ?, body = ?, visibility = ?, updated_at = ? WHERE id = ? AND campaign_id = ?').run(title.trim(), body, visibility, now(), id, campaignId);
    return id;
  }
  deleteNote(userId: string, campaignId: string, id: string): void {
    this.requireMember(userId, campaignId);
    const result = this.db.prepare("DELETE FROM campaign_notes WHERE id = ? AND campaign_id = ? AND (visibility = 'shared' OR author_id = ?)").run(id, campaignId, userId);
    if (!result.changes) throw new Error('Forbidden');
  }
}
