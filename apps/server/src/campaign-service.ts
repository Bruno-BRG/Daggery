import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type Database from 'better-sqlite3';
import { LEGACY_CAMPAIGN_ID } from './campaign-db';
import { getGameSystem, getRuleset, normalizeConfiguration, type CampaignConfiguration } from '@daggery/shared';

export type CampaignRole = 'gm' | 'player';
export type NoteVisibility = 'private' | 'shared';
export interface User { id: string; username: string }
export interface Campaign { id: string; name: string; description: string; role: CampaignRole; archivedAt: string | null; configuration: CampaignConfiguration }
export interface Note { id: string; campaignId: string; authorId: string; title: string; body: string; visibility: NoteVisibility; createdAt: string; updatedAt: string }

const token = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const validName = (value: string, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** These methods enforce membership independently of the caller's UI or requested role. */
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
      this.db.prepare("INSERT INTO campaign_members(campaign_id, user_id, role) VALUES (?, ?, 'gm')").run(id, userId);
      this.initializeRulesetDocuments(id, config);
    })();
    return id;
  }
  listCampaigns(userId: string): Campaign[] {
    const rows = this.db.prepare(`SELECT c.id, c.name, c.description, m.role, c.archived_at AS archivedAt, c.configuration
      FROM campaigns c JOIN campaign_members m ON m.campaign_id = c.id WHERE m.user_id = ? ORDER BY c.updated_at DESC`).all(userId) as (Omit<Campaign, 'configuration'> & { configuration: string })[];
    return rows.map(row => ({ ...row, configuration: JSON.parse(row.configuration) as CampaignConfiguration }));
  }
  configuration(campaignId: string): CampaignConfiguration {
    const row = this.db.prepare('SELECT configuration FROM campaigns WHERE id = ?').get(campaignId) as { configuration: string } | undefined;
    if (!row) throw new Error('Forbidden');
    return JSON.parse(row.configuration) as CampaignConfiguration;
  }
  private initializeRulesetDocuments(campaignId: string, config: CampaignConfiguration) {
    for (const doc of getRuleset(config)?.initialDocuments?.(config.options) ?? []) {
      this.db.prepare('INSERT OR IGNORE INTO campaign_docs(campaign_id,ns,id,value,updated) VALUES (?,?,?,?,?)')
        .run(campaignId, doc.ns, doc.id, JSON.stringify(doc.value), now());
    }
  }
  listMembers(userId: string, campaignId: string): (User & { role: CampaignRole })[] {
    this.requireMember(userId, campaignId);
    return this.db.prepare(`SELECT u.id, u.username, m.role FROM campaign_members m
      JOIN users u ON u.id = m.user_id WHERE m.campaign_id = ? ORDER BY m.role, u.username`).all(campaignId) as (User & { role: CampaignRole })[];
  }
  role(userId: string, campaignId: string): CampaignRole | null {
    const row = this.db.prepare(`SELECT m.role FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.user_id = ? AND m.campaign_id = ? AND c.archived_at IS NULL`).get(userId, campaignId) as { role: CampaignRole } | undefined;
    return row?.role ?? null;
  }
  requireMember(userId: string, campaignId: string): CampaignRole {
    const role = this.role(userId, campaignId);
    if (!role) throw new Error('Forbidden');
    return role;
  }
  requireGm(userId: string, campaignId: string): void {
    if (this.requireMember(userId, campaignId) !== 'gm') throw new Error('Forbidden');
  }
  updateCampaign(userId: string, campaignId: string, name: string, description: string, archived: boolean, configuration?: unknown): void {
    const member = this.db.prepare('SELECT role FROM campaign_members WHERE user_id = ? AND campaign_id = ?').get(userId, campaignId) as { role: CampaignRole } | undefined;
    if (member?.role !== 'gm') throw new Error('Forbidden');
    if (!validName(name, 100) || typeof description !== 'string' || description.length > 2000 || typeof archived !== 'boolean') throw new Error('Invalid campaign');
    const old = this.configuration(campaignId);
    const config = configuration === undefined ? old : normalizeConfiguration(configuration);
    if (config.systemId !== old.systemId) throw new Error('Invalid system change: create a new campaign for a different system');
    this.db.transaction(() => {
      if (getRuleset(config)?.mode === 'solo') {
        const members = this.db.prepare('SELECT COUNT(*) AS n FROM campaign_members WHERE campaign_id = ? AND user_id <> ?').get(campaignId, userId) as { n: number };
        if (members.n) throw new Error('Invalid solo campaign: other members are still present');
        this.db.prepare('UPDATE campaign_invites SET revoked_at = ? WHERE campaign_id = ? AND used_at IS NULL').run(now(), campaignId);
      }
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
  /** This is for an explicit local-admin command only, never an HTTP endpoint. */
  claimLegacyForLocalAdmin(userId: string): void {
    this.db.transaction(() => {
      const result = this.db.prepare('UPDATE campaigns SET owner_id = ?, updated_at = ? WHERE id = ? AND owner_id IS NULL').run(userId, now(), LEGACY_CAMPAIGN_ID);
      if (result.changes !== 1) throw new Error('Legacy campaign unavailable');
      this.db.prepare("INSERT INTO campaign_members(campaign_id, user_id, role) VALUES (?, ?, 'gm')").run(LEGACY_CAMPAIGN_ID, userId);
    })();
  }
  createInvite(userId: string, campaignId: string): string {
    this.requireGm(userId, campaignId);
    if (getRuleset(this.configuration(campaignId))?.mode === 'solo') throw new Error('Invalid invite: solo campaigns are private');
    const value = token();
    this.db.prepare('INSERT INTO campaign_invites(token_hash, campaign_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(digest(value), campaignId, userId, new Date(Date.now() + 7 * 86400_000).toISOString(), now());
    return value;
  }
  acceptInvite(userId: string, value: string): string {
    if (typeof value !== 'string' || value.length !== 43) throw new Error('Invalid invite');
    return this.db.transaction(() => {
      const row = this.db.prepare(`SELECT i.campaign_id AS campaignId FROM campaign_invites i JOIN campaigns c ON c.id = i.campaign_id
        WHERE i.token_hash = ? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ? AND c.archived_at IS NULL`).get(digest(value), now()) as { campaignId: string } | undefined;
      if (!row) throw new Error('Invalid invite');
      if (getRuleset(this.configuration(row.campaignId))?.mode === 'solo') throw new Error('Invalid invite');
      this.db.prepare("INSERT INTO campaign_members(campaign_id, user_id, role) VALUES (?, ?, 'player') ON CONFLICT DO NOTHING").run(row.campaignId, userId);
      this.db.prepare('UPDATE campaign_invites SET used_at = ? WHERE token_hash = ?').run(now(), digest(value));
      return row.campaignId;
    })();
  }
  revokeInvite(userId: string, campaignId: string, value: string): void {
    this.requireGm(userId, campaignId);
    this.db.prepare('UPDATE campaign_invites SET revoked_at = ? WHERE campaign_id = ? AND token_hash = ? AND used_at IS NULL').run(now(), campaignId, digest(value));
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
