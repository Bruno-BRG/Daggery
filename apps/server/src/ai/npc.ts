import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { adversaries } from '@daggery/content';
import { maxDiceTotal } from '@daggery/shared';
import { normalizeText, rankObjects } from './retrieval';

/**
 * Secret NPC sheets. They live only in the server's `ai_npcs` table: no route, synced document,
 * journal entry, ledger result or export exposes their contents. The one deliberate exposure is a
 * printed-token-shaped combat snapshot when the GM puts the NPC into an encounter.
 *
 * The types stay in the server package on purpose; packages/shared ships to the web client.
 */

export const NPC_TYPES = ['Bruiser', 'Horde', 'Leader', 'Minion', 'Ranged', 'Skulk', 'Social', 'Solo', 'Standard', 'Support'] as const;
export const NPC_STATUSES = ['active', 'dead', 'missing', 'retired'] as const;
export const NPC_ATTACK_RANGES = ['Melee', 'Very Close', 'Close', 'Far', 'Very Far'] as const;
export const NPC_FEATURE_KINDS = ['action', 'reaction', 'passive'] as const;
/** The cap counts active sheets only: dead, missing and retired NPCs stay readable but never block a new one. */
export const NPC_LIMIT = 60;
/** Search returns at most this many summaries to the GM. */
export const NPC_SEARCH_LIMIT = 6;

export type NpcType = (typeof NPC_TYPES)[number];
export type NpcStatus = (typeof NPC_STATUSES)[number];
export type NpcAttackRange = (typeof NPC_ATTACK_RANGES)[number];
export type NpcFeatureKind = (typeof NPC_FEATURE_KINDS)[number];

export interface NpcAttack { name: string; modifier: number; range: NpcAttackRange; damage: string }
export interface NpcThresholds { major: number; severe: number }
export interface NpcExperience { name: string; modifier: number }
export interface NpcFeature { name: string; kind: NpcFeatureKind; text: string; fearCost?: number }
export interface NpcRelationship { name: string; relation: string }

export interface NpcIdentity {
  name: string; role: string; ancestry: string; community: string; appearance: string;
  tier: number; type: NpcType;
}

export interface NpcStats {
  difficulty: number; thresholds: NpcThresholds; hp: number; stress: number;
  attack: NpcAttack; experiences: NpcExperience[]; features: NpcFeature[];
  /** Catalog adversary this sheet adapts, when the GM started from a printed stat block. */
  basedOn?: string;
}

export interface NpcStory {
  background: string; want: string; fear: string; secret: string; voice: string; motives: string;
  relationships: NpcRelationship[]; notes: string; lastSeen: string;
}

export interface NpcSheet { identity: NpcIdentity; stats: NpcStats; story: NpcStory }

export interface NpcRecord { id: string; campaignId: string; name: string; status: NpcStatus; data: NpcSheet; created: string; updated: string }

interface NpcRow { id: string; campaign_id: string; name: string; status: string; data: string; created: string; updated: string }

/**
 * The combat view of an adversary: either a catalog entry or an NPC's printed-token snapshot.
 * Features carry only name/kind/text; story fields are never part of it.
 */
export interface CombatStats {
  type: string;
  difficulty: number;
  hp: number;
  stress: number;
  thresholds: { major: number; severe: number | null } | null;
  attack: { name: string; modifier: number | string; range?: string; damage: string };
  features: { name: string; kind: string; text: string }[];
}

interface CatalogAdversary {
  type: string; difficulty: number; hp: number; stress?: number | null;
  thresholds?: { major: number; severe: number | null } | null;
  attack: { name?: string; modifier: number | string; damage: string; range?: string };
  features: { name: string; kind: string; text: string }[];
}

export function catalogCombatStats(source: CatalogAdversary): CombatStats {
  return {
    type: source.type,
    difficulty: source.difficulty,
    hp: source.hp,
    stress: source.stress ?? 0,
    thresholds: source.thresholds ? { major: source.thresholds.major, severe: source.thresholds.severe ?? null } : null,
    attack: { name: source.attack.name ?? 'Attack', modifier: source.attack.modifier, range: source.attack.range, damage: source.attack.damage },
    features: source.features.map(feature => ({ name: feature.name, kind: feature.kind, text: feature.text })),
  };
}

/** Reads the combat snapshot stored on an NPC-backed combat document. No NPC story is stored there. */
export function npcDocCombatStats(doc: Record<string, any> | undefined): CombatStats | null {
  if (!doc || doc.kind !== 'adversary' || typeof doc.npcId !== 'string' || !doc.npcId) return null;
  if (typeof doc.hpMax !== 'number' || typeof doc.difficulty !== 'number' || !doc.thresholds || !doc.attack) return null;
  return {
    type: typeof doc.npcType === 'string' ? doc.npcType : 'Standard',
    difficulty: doc.difficulty,
    hp: doc.hpMax,
    stress: typeof doc.stressMax === 'number' ? doc.stressMax : 0,
    thresholds: { major: Number(doc.thresholds.major), severe: Number(doc.thresholds.severe) },
    attack: {
      name: String(doc.attack.name ?? 'Attack'),
      modifier: typeof doc.attack.modifier === 'number' || typeof doc.attack.modifier === 'string' ? doc.attack.modifier : 0,
      range: typeof doc.attack.range === 'string' ? doc.attack.range : undefined,
      damage: String(doc.attack.damage ?? ''),
    },
    features: [],
  };
}

// ---------------------------------------------------------------------------------------------
// Validation. Every failure starts with "Invalid NPC" so the service returns it to the model.
// ---------------------------------------------------------------------------------------------

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error('Invalid NPC ' + field + ': text is required');
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Invalid NPC ' + field + ': text is required');
  if (trimmed.length > max) throw new Error('Invalid NPC ' + field + ': at most ' + String(max) + ' characters');
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('Invalid NPC ' + field + ': text is required');
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error('Invalid NPC ' + field + ': at most ' + String(max) + ' characters');
  return trimmed;
}

function intIn(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error('Invalid NPC ' + field + ': expected an integer from ' + String(min) + ' to ' + String(max));
  }
  return value;
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error('Invalid NPC ' + field + ': expected one of ' + allowed.join(', '));
  }
  return value as T;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid NPC ' + field + ': an object is required');
  return value as Record<string, unknown>;
}

function listOf(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid NPC ' + field + ': a list is required');
  if (value.length > max) throw new Error('Invalid NPC ' + field + ': at most ' + String(max) + ' items');
  return value;
}

/** The same parser rollDice uses (through maxDiceTotal), so a bad notation is refused up front. */
export function npcDamage(value: unknown): string {
  const notation = requiredText(value, 'attack damage', 40);
  if (!/d/i.test(notation)) throw new Error('Invalid NPC attack damage: dice notation such as "2d6+3" is required');
  try {
    maxDiceTotal(notation);
  } catch {
    throw new Error('Invalid NPC attack damage: dice notation such as "2d6+3" is required');
  }
  return notation;
}

export function npcThresholds(value: unknown): NpcThresholds {
  const item = asRecord(value, 'thresholds');
  const major = intIn(item.major, 'thresholds major', 0, 200);
  const severe = intIn(item.severe, 'thresholds severe', 0, 200);
  if (severe <= major) throw new Error('Invalid NPC thresholds: severe must be greater than major');
  return { major, severe };
}

export function npcAttack(value: unknown): NpcAttack {
  const item = asRecord(value, 'attack');
  return {
    name: requiredText(item.name, 'attack name', 60),
    modifier: intIn(item.modifier, 'attack modifier', -5, 10),
    range: oneOf(item.range, 'attack range', NPC_ATTACK_RANGES),
    damage: npcDamage(item.damage),
  };
}

export function npcExperiences(value: unknown): NpcExperience[] {
  return listOf(value, 'experiences', 5).map((raw, index) => {
    const item = asRecord(raw, 'experiences[' + String(index) + ']');
    return { name: requiredText(item.name, 'experience name', 60), modifier: intIn(item.modifier, 'experience modifier', 1, 5) };
  });
}

export function npcFeatures(value: unknown): NpcFeature[] {
  return listOf(value, 'features', 6).map((raw, index) => {
    const item = asRecord(raw, 'features[' + String(index) + ']');
    const feature: NpcFeature = {
      name: requiredText(item.name, 'feature name', 60),
      kind: oneOf(item.kind, 'feature kind', NPC_FEATURE_KINDS),
      text: requiredText(item.text, 'feature text', 500),
    };
    if (item.fearCost !== undefined) feature.fearCost = intIn(item.fearCost, 'feature fearCost', 0, 3);
    return feature;
  });
}

export function npcRelationships(value: unknown): NpcRelationship[] {
  return listOf(value, 'relationships', 10).map((raw, index) => {
    const item = asRecord(raw, 'relationships[' + String(index) + ']');
    return { name: requiredText(item.name, 'relationship name', 80), relation: optionalText(item.relation, 'relationship relation', 200) };
  });
}

function basedOn(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const id = requiredText(value, 'basedOn', 120);
  if (!adversaries.some(item => item.id === id)) throw new Error('Invalid NPC basedOn: no such catalog adversary');
  return id;
}

/** Full validation for npc_create. Every field is present in the returned sheet (empty when optional). */
export function npcSheetFromCreate(raw: Record<string, unknown>): NpcSheet {
  return {
    identity: {
      name: requiredText(raw.name, 'name', 80),
      role: requiredText(raw.role, 'role', 120),
      ancestry: optionalText(raw.ancestry, 'ancestry', 60),
      community: optionalText(raw.community, 'community', 60),
      appearance: optionalText(raw.appearance, 'appearance', 600),
      tier: intIn(raw.tier, 'tier', 1, 4),
      type: oneOf(raw.type, 'type', NPC_TYPES),
    },
    stats: {
      difficulty: intIn(raw.difficulty, 'difficulty', 5, 30),
      thresholds: npcThresholds(raw.thresholds),
      hp: intIn(raw.hp, 'hp', 1, 20),
      stress: intIn(raw.stress, 'stress', 0, 12),
      attack: npcAttack(raw.attack),
      experiences: raw.experiences === undefined ? [] : npcExperiences(raw.experiences),
      features: raw.features === undefined ? [] : npcFeatures(raw.features),
      ...(basedOn(raw.basedOn) ? { basedOn: basedOn(raw.basedOn) } : {}),
    },
    story: {
      background: optionalText(raw.background, 'background', 2000),
      want: requiredText(raw.want, 'want', 300),
      fear: optionalText(raw.fear, 'fear', 300),
      secret: optionalText(raw.secret, 'secret', 1000),
      voice: requiredText(raw.voice, 'voice', 400),
      motives: optionalText(raw.motives, 'motives', 300),
      relationships: raw.relationships === undefined ? [] : npcRelationships(raw.relationships),
      notes: optionalText(raw.notes, 'notes', 2000),
      lastSeen: optionalText(raw.lastSeen, 'lastSeen', 200),
    },
  };
}

/** Applies only the supplied fields to an existing sheet. Arrays replace; attack/thresholds replace whole. */
export function npcSheetFromPatch(current: NpcSheet, raw: Record<string, unknown>): NpcSheet {
  const identity: NpcIdentity = {
    name: raw.name === undefined ? current.identity.name : requiredText(raw.name, 'name', 80),
    role: raw.role === undefined ? current.identity.role : requiredText(raw.role, 'role', 120),
    ancestry: raw.ancestry === undefined ? current.identity.ancestry : optionalText(raw.ancestry, 'ancestry', 60),
    community: raw.community === undefined ? current.identity.community : optionalText(raw.community, 'community', 60),
    appearance: raw.appearance === undefined ? current.identity.appearance : optionalText(raw.appearance, 'appearance', 600),
    tier: raw.tier === undefined ? current.identity.tier : intIn(raw.tier, 'tier', 1, 4),
    type: raw.type === undefined ? current.identity.type : oneOf(raw.type, 'type', NPC_TYPES),
  };
  const stats: NpcStats = {
    difficulty: raw.difficulty === undefined ? current.stats.difficulty : intIn(raw.difficulty, 'difficulty', 5, 30),
    thresholds: raw.thresholds === undefined ? current.stats.thresholds : npcThresholds(raw.thresholds),
    hp: raw.hp === undefined ? current.stats.hp : intIn(raw.hp, 'hp', 1, 20),
    stress: raw.stress === undefined ? current.stats.stress : intIn(raw.stress, 'stress', 0, 12),
    attack: raw.attack === undefined ? current.stats.attack : npcAttack(raw.attack),
    experiences: raw.experiences === undefined ? current.stats.experiences : npcExperiences(raw.experiences),
    features: raw.features === undefined ? current.stats.features : npcFeatures(raw.features),
  };
  if (raw.basedOn !== undefined) {
    const value = basedOn(raw.basedOn);
    if (value) stats.basedOn = value;
  } else if (current.stats.basedOn) stats.basedOn = current.stats.basedOn;
  const story: NpcStory = {
    background: raw.background === undefined ? current.story.background : optionalText(raw.background, 'background', 2000),
    want: raw.want === undefined ? current.story.want : requiredText(raw.want, 'want', 300),
    fear: raw.fear === undefined ? current.story.fear : optionalText(raw.fear, 'fear', 300),
    secret: raw.secret === undefined ? current.story.secret : optionalText(raw.secret, 'secret', 1000),
    voice: raw.voice === undefined ? current.story.voice : requiredText(raw.voice, 'voice', 400),
    motives: raw.motives === undefined ? current.story.motives : optionalText(raw.motives, 'motives', 300),
    relationships: raw.relationships === undefined ? current.story.relationships : npcRelationships(raw.relationships),
    notes: raw.notes === undefined ? current.story.notes : optionalText(raw.notes, 'notes', 2000),
    lastSeen: raw.lastSeen === undefined ? current.story.lastSeen : optionalText(raw.lastSeen, 'lastSeen', 200),
  };
  return { identity, stats, story };
}

/** Case- and accent-insensitive comparison key for an NPC name. */
export function npcNameKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

export class AiNpcs {
  constructor(private db: Database.Database) {}

  private row(campaign: string, id: string): NpcRow | undefined {
    return this.db.prepare('SELECT * FROM ai_npcs WHERE campaign_id = ? AND id = ?').get(campaign, id) as NpcRow | undefined;
  }

  private view(row: NpcRow): NpcRecord {
    return {
      id: row.id, campaignId: row.campaign_id, name: row.name,
      status: (NPC_STATUSES as readonly string[]).includes(row.status) ? row.status as NpcStatus : 'active',
      data: JSON.parse(row.data) as NpcSheet, created: row.created, updated: row.updated,
    };
  }

  get(campaign: string, id: string): NpcRecord | undefined {
    const row = this.row(campaign, id);
    return row ? this.view(row) : undefined;
  }

  /** Every sheet in the campaign, newest updated first. */
  list(campaign: string): NpcRecord[] {
    return (this.db.prepare('SELECT * FROM ai_npcs WHERE campaign_id = ? ORDER BY updated DESC, rowid DESC').all(campaign) as NpcRow[]).map(row => this.view(row));
  }

  active(campaign: string): NpcRecord[] {
    return (this.db.prepare("SELECT * FROM ai_npcs WHERE campaign_id = ? AND status = 'active' ORDER BY updated DESC, rowid DESC").all(campaign) as NpcRow[]).map(row => this.view(row));
  }

  /** Resolves by exact id, or by an exact case/accent-insensitive name. An active sheet wins over an older one. */
  resolve(campaign: string, reference: string): NpcRecord | undefined {
    const byId = this.get(campaign, reference);
    if (byId) return byId;
    const key = npcNameKey(reference);
    if (!key) return undefined;
    const matches = this.list(campaign).filter(record => npcNameKey(record.data.identity.name) === key);
    return matches.find(record => record.status === 'active') ?? matches[0];
  }

  /** The NPCs whose name appears in the given text, up to limit, newest updated first. */
  mentioned(campaign: string, value: string, limit = 3): NpcRecord[] {
    const haystack = npcNameKey(value);
    if (!haystack) return [];
    return this.active(campaign).filter(record => {
      const key = npcNameKey(record.data.identity.name);
      return key.length > 0 && haystack.includes(key);
    }).slice(0, limit);
  }

  create(campaign: string, raw: Record<string, unknown>): NpcRecord {
    const data = npcSheetFromCreate(raw);
    const key = npcNameKey(data.identity.name);
    if (this.active(campaign).some(record => npcNameKey(record.data.identity.name) === key)) {
      throw new Error('Invalid NPC: an active NPC in this campaign already has that name. Update that sheet instead.');
    }
    if (this.active(campaign).length >= NPC_LIMIT) {
      throw new Error('Invalid NPC: this campaign already has ' + String(NPC_LIMIT) + ' active NPCs. Mark one dead, missing or retired first.');
    }
    const id = randomUUID(), at = new Date().toISOString();
    this.db.prepare("INSERT INTO ai_npcs(id,campaign_id,name,status,data,created,updated) VALUES (?,?,?,?,?,?,?)")
      .run(id, campaign, data.identity.name, 'active', JSON.stringify(data), at, at);
    return this.view(this.row(campaign, id)!);
  }

  update(campaign: string, raw: Record<string, unknown>): NpcRecord {
    const id = requiredText(raw.id, 'id', 120);
    const existing = this.get(campaign, id);
    if (!existing) throw new Error('Invalid NPC');
    const data = npcSheetFromPatch(existing.data, raw);
    const status: NpcStatus = raw.status === undefined ? existing.status : oneOf(raw.status, 'status', NPC_STATUSES);
    if (status === 'active' && existing.status !== 'active') {
      const key = npcNameKey(data.identity.name);
      if (this.active(campaign).some(record => record.id !== id && npcNameKey(record.data.identity.name) === key)) {
        throw new Error('Invalid NPC: an active NPC in this campaign already has that name. Update that sheet instead.');
      }
      if (this.active(campaign).length >= NPC_LIMIT) {
        throw new Error('Invalid NPC: this campaign already has ' + String(NPC_LIMIT) + ' active NPCs. Mark one dead, missing or retired first.');
      }
    }
    const at = new Date().toISOString();
    this.db.prepare('UPDATE ai_npcs SET name = ?, status = ?, data = ?, updated = ? WHERE campaign_id = ? AND id = ?')
      .run(data.identity.name, status, JSON.stringify(data), at, campaign, id);
    return this.view(this.row(campaign, id)!);
  }

  /** Ranked by name, role and story text; an empty query lists the newest entries. */
  search(campaign: string, query: string, limit = 10): NpcRecord[] {
    const records = this.list(campaign);
    if (!records.length) return [];
    return rankObjects(records, query.trim().slice(0, 200), {
      title: record => record.data.identity.name + ' ' + record.data.identity.role,
      body: record => [record.data.identity.appearance, record.data.story.background, record.data.story.want, record.data.story.fear, record.data.story.motives, record.data.story.notes].join(' '),
      recency: record => record.updated,
      limit: Math.max(0, limit),
    }).map(hit => hit.item);
  }
}

/** The memory block line list, sized like the canon title list. */
export function renderNpcList(records: NpcRecord[], room: number): string {
  if (!records.length) return '';
  const header = 'Secret NPCs (GM only; use npc_read for the full sheet):';
  const lines: string[] = [];
  const render = () => header + (lines.length ? '\n' + lines.join('\n') : '');
  for (const record of records) {
    const { identity, story } = record.data;
    const line = identity.name + ' — ' + identity.role + ' — ' + story.want + ' (id ' + record.id + ')';
    if (render().length + 1 + line.length > room - 60) break;
    lines.push(line);
  }
  const hidden = records.length - lines.length;
  if (hidden <= 0) return render();
  let note = '(' + String(hidden) + ' more; use npc_search)';
  while (lines.length && render().length + 1 + note.length > room) {
    lines.pop();
    note = '(' + String(records.length - lines.length) + ' more; use npc_search)';
  }
  return render() + '\n' + note;
}
