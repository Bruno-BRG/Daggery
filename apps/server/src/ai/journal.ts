import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AiJournalEntry, AiJournalKind, AiJournalPage } from '@daggery/shared';
import type { EmbeddingIndex } from './embeddings';
import { filterTerms, hasQueryTerms, rankObjects } from './retrieval';

export interface JournalRow { seq: number; id: string; campaign_id: string; chat_id: string | null; chat_label: string; turn_id: string | null; kind: AiJournalKind; title: string; body: string; visibility: 'shared' | 'gm'; author: 'engine' | 'gm' | 'owner'; created: string; updated: string }
export interface JournalInput { chat: string | null; turn: string | null; kind: AiJournalKind; title: string; body: string; visibility: 'shared' | 'gm'; author: 'engine' | 'gm' | 'owner' }
const PAGE = 40;

function escapeLike(value: string): string { return value.split('!').join('!!').split('%').join('!%').split('_').join('!_'); }
function clip(value: string, max: number): string { return value.slice(0, max); }

export class AiJournal {
  constructor(private db: Database.Database, private embeddings?: EmbeddingIndex) {}

  private chatTitle(chat: string | null): string {
    if (!chat) return '';
    const row = this.db.prepare('SELECT title FROM ai_chats WHERE id = ?').get(chat) as { title: string } | undefined;
    return row ? row.title : '';
  }

  insert(campaign: string, input: JournalInput): string {
    const id = randomUUID(), at = new Date().toISOString();
    const title = clip(input.title, 200), body = clip(input.body, 6000);
    this.db.prepare('INSERT INTO ai_journal (id, campaign_id, chat_id, chat_label, turn_id, kind, title, body, visibility, author, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, campaign, input.chat, this.chatTitle(input.chat), input.turn, input.kind, title, body, input.visibility, input.author, at, at);
    this.embeddings?.enqueueJournal(campaign, id, title, body);
    return id;
  }

  event(campaign: string, chat: string | null, turn: string | null, title: string, body: string, visibility: 'shared' | 'gm'): void {
    this.insert(campaign, { chat, turn, kind: 'event', title, body, visibility, author: 'engine' });
  }

  chapter(campaign: string, chat: string, turn: string | null, body: string, final: boolean): string {
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM ai_journal WHERE campaign_id = ? AND kind = 'chapter'").get(campaign) as { n: number }).n;
    return this.insert(campaign, { chat, turn, kind: 'chapter', title: 'Chapter ' + (count + 1) + (final ? ' (final)' : ''), body, visibility: 'shared', author: 'gm' });
  }

  /** All rows of a campaign, newest first, with the visibility rule applied. Search ranks these in memory. */
  private rows(campaign: string, gm: boolean): JournalRow[] {
    const where = ['campaign_id = ?'];
    const args: unknown[] = [campaign];
    if (!gm) where.push("visibility = 'shared'");
    return this.db.prepare('SELECT rowid AS seq, * FROM ai_journal WHERE ' + where.join(' AND ') + ' ORDER BY rowid DESC').all(...args) as JournalRow[];
  }

  /**
   * The paginated journal list. Any query term may match (rather than the whole phrase), which makes
   * "miller debt" find "the miller's unpaid debt", while rowid ordering and the cursor contract stay
   * exactly as before.
   */
  private select(campaign: string, gm: boolean, cursor: string | null, kind: string, terms: string[], limit: number): JournalRow[] {
    const where = ['campaign_id = ?'];
    const args: unknown[] = [campaign];
    if (!gm) where.push("visibility = 'shared'");
    if (kind !== 'all' && kind !== '') { where.push('kind = ?'); args.push(kind); }
    const wanted = terms.slice(0, 8);
    if (wanted.length) {
      where.push('(' + wanted.map(() => "(title LIKE ? ESCAPE '!' OR body LIKE ? ESCAPE '!')").join(' OR ') + ')');
      for (const term of wanted) { const like = '%' + escapeLike(term) + '%'; args.push(like, like); }
    }
    if (cursor && /^[0-9]+$/.test(cursor)) { where.push('rowid < ?'); args.push(Number(cursor)); }
    return this.db.prepare('SELECT rowid AS seq, * FROM ai_journal WHERE ' + where.join(' AND ') + ' ORDER BY rowid DESC LIMIT ?').all(...args, limit) as JournalRow[];
  }

  list(campaign: string, gm: boolean, options: { cursor: string | null; kind: string; query: string }): AiJournalPage {
    const terms = filterTerms(options.query.trim().slice(0, 200));
    const rows = this.select(campaign, gm, options.cursor, options.kind, terms, PAGE + 1);
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];
    return { entries: page.map(row => this.toEntry(row, gm)), nextCursor: rows.length > PAGE && last ? String(last.seq) : null };
  }

  /**
   * Ranked journal search across every session of the campaign. Engine events are down-weighted so
   * notes and chapters surface first, but an event that uniquely matches is still returned. Each hit
   * carries its session label and date, and its snippet may grow with the model's context window.
   */
  search(campaign: string, gm: boolean, query: string, limit: number, options: { snippetChars?: number; minScore?: number; queryVector?: Float32Array | null; minSimilarity?: number } = {}): { id: string; kind: AiJournalKind; title: string; body: string; chat: string; at: string }[] {
    const snippetChars = Math.max(120, Math.min(1500, Math.floor(options.snippetChars ?? 600)));
    const rows = this.rows(campaign, gm);
    const text = query.trim().slice(0, 200);
    const vectors = options.queryVector && this.embeddings ? this.embeddings.vectorsFor(campaign, 'journal') : undefined;
    const hits = hasQueryTerms(text)
      ? rankObjects(rows, text, {
        title: row => row.title,
        body: row => row.body,
        recency: row => row.created,
        weight: row => row.kind === 'event' ? 0.65 : 1,
        limit: Math.max(0, limit),
        minScore: options.minScore,
        vector: vectors ? row => vectors.get(row.id) : undefined,
        queryVector: options.queryVector,
        minSimilarity: options.minSimilarity,
      }).map(hit => hit.item)
      : rows.slice(0, Math.max(0, limit));
    return hits.map(row => ({ id: row.id, kind: row.kind, title: row.title, body: row.body.slice(0, snippetChars), chat: row.chat_label, at: row.created }));
  }

  get(campaign: string, id: string): JournalRow | undefined {
    return this.db.prepare('SELECT rowid AS seq, * FROM ai_journal WHERE campaign_id = ? AND id = ?').get(campaign, id) as JournalRow | undefined;
  }

  view(campaign: string, id: string, gm: boolean): AiJournalEntry | undefined {
    const row = this.get(campaign, id);
    return row ? this.toEntry(row, gm) : undefined;
  }

  update(campaign: string, id: string, patch: { title?: string; body?: string; visibility?: 'shared' | 'gm' }): void {
    const row = this.get(campaign, id);
    if (!row) throw new Error('Invalid journal entry');
    const title = patch.title ?? row.title, body = patch.body ?? row.body;
    this.db.prepare('UPDATE ai_journal SET title = ?, body = ?, visibility = ?, updated = ? WHERE campaign_id = ? AND id = ?').run(title, body, patch.visibility ?? row.visibility, new Date().toISOString(), campaign, id);
    this.embeddings?.enqueueJournal(campaign, id, title, body);
  }

  remove(campaign: string, id: string): void {
    this.db.prepare('DELETE FROM ai_journal WHERE campaign_id = ? AND id = ?').run(campaign, id);
    this.embeddings?.remove('journal', campaign, id);
  }

  count(campaign: string, kind: AiJournalKind): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM ai_journal WHERE campaign_id = ? AND kind = ?').get(campaign, kind) as { n: number }).n;
  }

  recentChapters(campaign: string, limit: number): { id: string; title: string; body: string }[] {
    return (this.db.prepare("SELECT id, title, body FROM ai_journal WHERE campaign_id = ? AND kind = 'chapter' ORDER BY rowid DESC LIMIT ?").all(campaign, limit) as { id: string; title: string; body: string }[]).reverse();
  }

  hasEntries(campaign: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM ai_journal WHERE campaign_id = ? LIMIT 1').get(campaign);
  }

  relabel(chat: string, title: string): void {
    this.db.prepare('UPDATE ai_journal SET chat_label = ? WHERE chat_id = ?').run(title, chat);
  }

  private toEntry(row: JournalRow, gm: boolean): AiJournalEntry {
    return { id: row.id, kind: row.kind, title: row.title, body: row.body, visibility: row.visibility, chatId: row.chat_id, chatLabel: row.chat_label, author: row.author, createdAt: row.created, updatedAt: row.updated, editable: gm && row.kind !== 'event' };
  }
}
