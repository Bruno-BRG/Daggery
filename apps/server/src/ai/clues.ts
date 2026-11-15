import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

/**
 * The clue and foreshadowing ledger. It lives only in the server's `ai_clues` table: no route, synced
 * document, journal entry, ledger result or export exposes the hidden truth. The GM plants a hint with
 * `clue_plant`, pays it off with `clue_update`, and sees the open ones in memory so it stops forgetting
 * what it set up.
 *
 * The types stay in the server package on purpose; packages/shared ships to the web client.
 */

export const CLUE_KINDS = ['clue', 'foreshadowing', 'mystery'] as const;
export const CLUE_STATUSES = ['planted', 'found', 'paid-off', 'abandoned'] as const;
/** Statuses that still owe the table an answer, and so appear in memory. */
export const OPEN_CLUE_STATUSES = ['planted', 'found'] as const;
/** A clue planted longer ago than this and never paid off is flagged stale in memory. */
export const CLUE_STALE_MS = 48 * 60 * 60 * 1000;
/** clue_list returns at most this many entries. */
export const CLUE_LIST_LIMIT = 30;

export type ClueKind = (typeof CLUE_KINDS)[number];
export type ClueStatus = (typeof CLUE_STATUSES)[number];

export interface ClueRecord {
  id: string; campaignId: string; kind: ClueKind;
  /** What the players actually saw or heard. */
  shown: string;
  /** The hidden fact the hint points to. Never shown to the players. */
  truth: string;
  threadId: string; npcId: string;
  status: ClueStatus;
  plantedChat: string; plantedAt: string;
  payoff: string;
  created: string; updated: string;
}

interface ClueRow {
  id: string; campaign_id: string; kind: string; shown: string; truth: string;
  thread_id: string; npc_id: string; status: string; planted_chat: string; planted_at: string;
  payoff: string; created: string; updated: string;
}

// ---------------------------------------------------------------------------------------------
// Validation. Every failure starts with "Invalid clue" so the service returns it to the model.
// ---------------------------------------------------------------------------------------------

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error('Invalid clue ' + field + ': text is required');
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Invalid clue ' + field + ': text is required');
  if (trimmed.length > max) throw new Error('Invalid clue ' + field + ': at most ' + String(max) + ' characters');
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('Invalid clue ' + field + ': text is required');
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error('Invalid clue ' + field + ': at most ' + String(max) + ' characters');
  return trimmed;
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error('Invalid clue ' + field + ': expected one of ' + allowed.join(', '));
  }
  return value as T;
}

function statusOf(value: unknown): ClueStatus {
  return oneOf(value, 'status', CLUE_STATUSES);
}

/** A clue's age in milliseconds, never negative. */
export function clueAge(plantedAt: string, now = Date.now()): number {
  const planted = Date.parse(plantedAt);
  if (Number.isNaN(planted)) return 0;
  return Math.max(0, now - planted);
}

/** A clue is stale when it was planted long ago and is still planted or found. */
export function isStaleClue(record: ClueRecord, now = Date.now()): boolean {
  return (OPEN_CLUE_STATUSES as readonly string[]).includes(record.status) && clueAge(record.plantedAt, now) >= CLUE_STALE_MS;
}

/** A short, human-readable age for the memory line. */
export function clueAgeLabel(plantedAt: string, now = Date.now()): string {
  const hours = Math.floor(clueAge(plantedAt, now) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return String(hours) + 'h ago';
  return String(Math.floor(hours / 24)) + 'd ago';
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

export class AiClues {
  constructor(private db: Database.Database) {}

  private row(campaign: string, id: string): ClueRow | undefined {
    return this.db.prepare('SELECT * FROM ai_clues WHERE campaign_id = ? AND id = ?').get(campaign, id) as ClueRow | undefined;
  }

  private view(row: ClueRow): ClueRecord {
    return {
      id: row.id, campaignId: row.campaign_id,
      kind: (CLUE_KINDS as readonly string[]).includes(row.kind) ? row.kind as ClueKind : 'clue',
      shown: row.shown, truth: row.truth, threadId: row.thread_id, npcId: row.npc_id,
      status: (CLUE_STATUSES as readonly string[]).includes(row.status) ? row.status as ClueStatus : 'planted',
      plantedChat: row.planted_chat, plantedAt: row.planted_at, payoff: row.payoff,
      created: row.created, updated: row.updated,
    };
  }

  get(campaign: string, id: string): ClueRecord | undefined {
    const row = this.row(campaign, id);
    return row ? this.view(row) : undefined;
  }

  /** The whole ledger, optionally filtered by status, oldest planted first. */
  list(campaign: string, status?: string, limit = CLUE_LIST_LIMIT): ClueRecord[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM ai_clues WHERE campaign_id = ? AND status = ? ORDER BY planted_at ASC, rowid ASC LIMIT ?').all(campaign, statusOf(status), limit)
      : this.db.prepare('SELECT * FROM ai_clues WHERE campaign_id = ? ORDER BY planted_at ASC, rowid ASC LIMIT ?').all(campaign, limit);
    return (rows as ClueRow[]).map(row => this.view(row));
  }

  /** The clues that still owe the table an answer, oldest planted first. */
  open(campaign: string): ClueRecord[] {
    return (this.db.prepare("SELECT * FROM ai_clues WHERE campaign_id = ? AND status IN ('planted','found') ORDER BY planted_at ASC, rowid ASC").all(campaign) as ClueRow[]).map(row => this.view(row));
  }

  plant(campaign: string, raw: Record<string, unknown>, chat: string): ClueRecord {
    const kind = oneOf(raw.kind, 'kind', CLUE_KINDS);
    const shown = requiredText(raw.shown, 'shown', 800);
    const truth = requiredText(raw.truth, 'truth', 1000);
    const threadId = optionalText(raw.threadId, 'threadId', 120);
    const npcId = optionalText(raw.npcId, 'npcId', 120);
    const id = randomUUID(), at = new Date().toISOString();
    this.db.prepare('INSERT INTO ai_clues(id,campaign_id,kind,shown,truth,thread_id,npc_id,status,planted_chat,planted_at,payoff,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, campaign, kind, shown, truth, threadId, npcId, 'planted', chat, at, '', at, at);
    return this.view(this.row(campaign, id)!);
  }

  /** Applies only the supplied fields. A status change to paid-off may carry the payoff note. */
  update(campaign: string, raw: Record<string, unknown>): ClueRecord {
    const id = requiredText(raw.id, 'id', 120);
    const existing = this.get(campaign, id);
    if (!existing) throw new Error('Invalid clue');
    const kind = raw.kind === undefined ? existing.kind : oneOf(raw.kind, 'kind', CLUE_KINDS);
    const shown = raw.shown === undefined ? existing.shown : requiredText(raw.shown, 'shown', 800);
    const truth = raw.truth === undefined ? existing.truth : requiredText(raw.truth, 'truth', 1000);
    const threadId = raw.threadId === undefined ? existing.threadId : optionalText(raw.threadId, 'threadId', 120);
    const npcId = raw.npcId === undefined ? existing.npcId : optionalText(raw.npcId, 'npcId', 120);
    const status = raw.status === undefined ? existing.status : statusOf(raw.status);
    const payoff = raw.payoff === undefined ? existing.payoff : optionalText(raw.payoff, 'payoff', 800);
    const at = new Date().toISOString();
    this.db.prepare('UPDATE ai_clues SET kind = ?, shown = ?, truth = ?, thread_id = ?, npc_id = ?, status = ?, payoff = ?, updated = ? WHERE campaign_id = ? AND id = ?')
      .run(kind, shown, truth, threadId, npcId, status, payoff, at, campaign, id);
    return this.view(this.row(campaign, id)!);
  }
}

/** The memory block line list, sized like the secret NPC list and dropped whole when memory is tight. */
export function renderClueList(records: ClueRecord[], room: number, now = Date.now()): string {
  if (!records.length) return '';
  const header = 'Open clues (GM only; call clue_list for the ledger):';
  const lines: string[] = [];
  const render = () => header + (lines.length ? '\n' + lines.join('\n') : '');
  for (const record of records) {
    const flags = 'planted ' + clueAgeLabel(record.plantedAt, now) + (isStaleClue(record, now) ? '; STALE' : '');
    const line = '- [' + record.status + ' ' + record.kind + '] ' + record.shown + ' → ' + record.truth + ' (' + flags + ') (id ' + record.id + ')';
    if (render().length + 1 + line.length > room - 60) break;
    lines.push(line);
  }
  const hidden = records.length - lines.length;
  if (hidden <= 0) return render();
  let note = '(' + String(hidden) + ' more; use clue_list)';
  while (lines.length && render().length + 1 + note.length > room) {
    lines.pop();
    note = '(' + String(records.length - lines.length) + ' more; use clue_list)';
  }
  return render() + '\n' + note;
}
