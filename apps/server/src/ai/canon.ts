import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { EmbeddingIndex } from './embeddings';
import { hasQueryTerms, rankObjects } from './retrieval';

export const CANON_KINDS = ['person', 'location', 'faction', 'promise', 'fact', 'history', 'plan', 'rumor', 'secret'] as const;
export type CanonKind = (typeof CANON_KINDS)[number];
export type CanonVisibility = 'shared' | 'gm';
export type CanonStatus = 'active' | 'archived';
/** Canon bodies are source records: they may be longer than journal search snippets, but never unbounded. */
export const CANON_BODY_CHARS = 6000;
export const CANON_TITLE_CHARS = 200;

export interface CanonEntry {
  id: string; kind: CanonKind; title: string; body: string; visibility: CanonVisibility;
  source: string; status: CanonStatus; createdAt: string; updatedAt: string;
}

export interface CanonRow {
  seq: number; id: string; campaign_id: string; kind: CanonKind; title: string; body: string;
  visibility: CanonVisibility; source: string; status: CanonStatus; created: string; updated: string;
}

export interface CanonSearchOptions {
  /** Defaults to true. When false, only shared entries that are not secrets are returned. */
  gm?: boolean;
  /** Hits below this score are dropped; used by proactive recall to stay silent when nothing matches. */
  minScore?: number;
  /** Query embedding for hybrid (BM25 + cosine) ranking. Absent means BM25-only. */
  queryVector?: Float32Array | null;
  /** Minimum cosine similarity before a synonym-only hit is returned. */
  minSimilarity?: number;
}

export interface CanonInput {
  id?: unknown; kind: unknown; title: unknown; body: unknown; visibility?: unknown; source?: unknown;
}

export function isCanonKind(value: unknown): value is CanonKind {
  return typeof value === 'string' && (CANON_KINDS as readonly string[]).includes(value);
}

export function canonKind(value: unknown): CanonKind {
  if (!isCanonKind(value)) throw new Error('Invalid canon kind');
  return value;
}

export function canonVisibility(value: unknown, fallback: CanonVisibility = 'gm'): CanonVisibility {
  if (value === undefined || value === '') return fallback;
  if (value !== 'shared' && value !== 'gm') throw new Error('Invalid canon visibility');
  return value;
}

export function canonTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) throw new Error('Invalid canon entry: a title is required');
  if (title.length > CANON_TITLE_CHARS) throw new Error('Invalid canon entry: the title may have at most ' + String(CANON_TITLE_CHARS) + ' characters');
  return title;
}

export function canonBody(value: unknown): string {
  const body = typeof value === 'string' ? value.trim() : '';
  if (body.length > CANON_BODY_CHARS) throw new Error('Invalid canon entry: the body may have at most ' + String(CANON_BODY_CHARS) + ' characters');
  return body;
}

/**
 * Durable campaign canon. Entries are never deleted to make room; an old entry is archived instead.
 * Retrieval is ranked multi-term search over title (weighted) and body, with recency as the tiebreak
 * and newest-first order for an empty query. Active entries only, unless archived ones are requested.
 */
export class AiCanon {
  constructor(private db: Database.Database, private embeddings?: EmbeddingIndex) {}

  private row(campaign: string, id: string): CanonRow | undefined {
    return this.db.prepare('SELECT rowid AS seq, * FROM ai_canon WHERE campaign_id = ? AND id = ?').get(campaign, id) as CanonRow | undefined;
  }

  private view(row: CanonRow): CanonEntry {
    return {
      id: row.id, kind: row.kind, title: row.title, body: row.body, visibility: row.visibility,
      source: row.source, status: row.status, createdAt: row.created, updatedAt: row.updated,
    };
  }

  get(campaign: string, id: string): CanonEntry | undefined {
    const row = this.row(campaign, id);
    return row ? this.view(row) : undefined;
  }

  /** Creates an entry, or updates one by ID. An entry's visibility and source are replaced when supplied. */
  upsert(campaign: string, input: CanonInput): CanonEntry {
    const kind = canonKind(input.kind);
    const title = canonTitle(input.title);
    const body = canonBody(input.body);
    const supplied = typeof input.id === 'string' && input.id.trim() !== '';
    const id = supplied ? (input.id as string).trim().slice(0, 120) : randomUUID();
    const existing = this.row(campaign, id);
    if (supplied && !existing) throw new Error('Invalid canon entry');
    // An update that omits visibility or source keeps the stored values, so import provenance survives edits.
    const visibility = input.visibility === undefined || input.visibility === '' ? existing?.visibility ?? 'gm' : canonVisibility(input.visibility);
    const source = typeof input.source === 'string' && input.source.trim()
      ? input.source.trim().slice(0, CANON_TITLE_CHARS)
      : existing?.source ?? 'gm';
    const at = new Date().toISOString();
    if (existing) {
      this.db.prepare('UPDATE ai_canon SET kind = ?, title = ?, body = ?, visibility = ?, source = ?, updated = ? WHERE campaign_id = ? AND id = ?')
        .run(kind, title, body, visibility, source, at, campaign, id);
    } else {
      this.db.prepare("INSERT INTO ai_canon (id, campaign_id, kind, title, body, visibility, source, status, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)")
        .run(id, campaign, kind, title, body, visibility, source, at, at);
    }
    // Live indexing: the write is committed first; embedding happens on the background queue.
    this.embeddings?.enqueueCanon(campaign, id, title, body);
    return this.view(this.row(campaign, id)!);
  }

  /** Ranked entries matching every query term they can. An empty query lists the newest entries. */
  search(campaign: string, query: string, limit: number, kinds?: readonly string[], includeArchived = false, options: CanonSearchOptions = {}): CanonEntry[] {
    const where = ['campaign_id = ?'];
    const args: unknown[] = [campaign];
    if (!includeArchived) where.push("status = 'active'");
    if (options.gm === false) where.push("visibility = 'shared'", "kind != 'secret'");
    if (kinds?.length) {
      where.push('kind IN (' + kinds.map(() => '?').join(', ') + ')');
      args.push(...kinds.map(kind => canonKind(kind)));
    }
    const rows = this.db.prepare('SELECT rowid AS seq, * FROM ai_canon WHERE ' + where.join(' AND ')).all(...args) as CanonRow[];
    const text = query.trim().slice(0, 200);
    const vectors = options.queryVector && this.embeddings ? this.embeddings.vectorsFor(campaign, 'canon') : undefined;
    const found = hasQueryTerms(text)
      ? rankObjects(rows, text, {
        title: row => row.title,
        body: row => row.body,
        recency: row => row.updated,
        limit: Math.max(0, limit),
        minScore: options.minScore,
        vector: vectors ? row => vectors.get(row.id) : undefined,
        queryVector: options.queryVector,
        minSimilarity: options.minSimilarity,
      }).map(hit => hit.item)
      : rows.sort((a, b) => b.updated.localeCompare(a.updated) || b.seq - a.seq).slice(0, Math.max(0, limit));
    return found.map(row => this.view(row));
  }

  /** True when any entry (active or archived) already carries this title, compared case-insensitively. */
  titleExists(campaign: string, title: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM ai_canon WHERE campaign_id = ? AND lower(title) = lower(?) LIMIT 1').get(campaign, title.trim());
  }

  /** Active entry titles, newest first. The memory prompt lists these so the GM knows what it can retrieve. */
  listTitles(campaign: string, limit = 500): { id: string; kind: CanonKind; title: string }[] {
    return this.db.prepare("SELECT id, kind, title FROM ai_canon WHERE campaign_id = ? AND status = 'active' ORDER BY updated DESC, rowid DESC LIMIT ?").all(campaign, limit) as { id: string; kind: CanonKind; title: string }[];
  }

  /** Archives an entry. Canon is never deleted to make room. Returns false when the entry does not exist. */
  archive(campaign: string, id: string): boolean {
    const result = this.db.prepare("UPDATE ai_canon SET status = 'archived', updated = ? WHERE campaign_id = ? AND id = ?").run(new Date().toISOString(), campaign, id);
    if (result.changes > 0) this.embeddings?.remove('canon', campaign, id);
    return result.changes > 0;
  }
}
