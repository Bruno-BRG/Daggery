import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AiChat } from '@daggery/shared';

export interface ChatRow { id: string; campaign_id: string; ordinal: number; title: string; status: 'open' | 'paused' | 'ended'; summary: string; summarized_through: number; summary_updated: string | null; resume_note: string | null; created: string; updated: string; ended_at: string | null }
type ChatView = ChatRow & { messageCount: number };

const COUNTED_SQL = "SELECT c.*, (SELECT COUNT(*) FROM ai_messages m WHERE m.chat_id = c.id AND m.role IN ('player','gm','roll')) AS messageCount FROM ai_chats c";

export class AiChats {
  constructor(private db: Database.Database) {}

  row(campaign: string, chat: string): ChatRow | undefined {
    return this.db.prepare('SELECT * FROM ai_chats WHERE campaign_id = ? AND id = ?').get(campaign, chat) as ChatRow | undefined;
  }

  private toView(row: ChatView): AiChat {
    return { id: row.id, ordinal: row.ordinal, title: row.title, status: row.status, messageCount: row.messageCount, updatedAt: row.updated, endedAt: row.ended_at };
  }

  list(campaign: string): AiChat[] {
    return (this.db.prepare(COUNTED_SQL + ' WHERE c.campaign_id = ? ORDER BY c.ordinal DESC').all(campaign) as ChatView[]).map(row => this.toView(row));
  }

  view(campaign: string, chat: string): AiChat | undefined {
    const row = this.db.prepare(COUNTED_SQL + ' WHERE c.campaign_id = ? AND c.id = ?').get(campaign, chat) as ChatView | undefined;
    return row ? this.toView(row) : undefined;
  }

  openId(campaign: string): string | null {
    const open = this.db.prepare("SELECT id FROM ai_chats WHERE campaign_id = ? AND status = 'open' ORDER BY ordinal DESC LIMIT 1").get(campaign) as { id: string } | undefined;
    return open ? open.id : null;
  }

  defaultId(campaign: string): string | null {
    const open = this.openId(campaign);
    if (open) return open;
    const latest = this.db.prepare('SELECT id FROM ai_chats WHERE campaign_id = ? ORDER BY ordinal DESC LIMIT 1').get(campaign) as { id: string } | undefined;
    return latest ? latest.id : null;
  }

  resolveActive(campaign: string, requested: string | null): string {
    if (requested && this.row(campaign, requested)) return requested;
    const existing = this.defaultId(campaign);
    return existing ? existing : this.create(campaign);
  }

  create(campaign: string, title?: string): string {
    const next = (this.db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM ai_chats WHERE campaign_id = ?').get(campaign) as { n: number }).n;
    const id = randomUUID(), at = new Date().toISOString();
    this.db.prepare("INSERT INTO ai_chats (id, campaign_id, ordinal, title, status, summary, summarized_through, created, updated) VALUES (?, ?, ?, ?, 'open', '', 0, ?, ?)").run(id, campaign, next, title ? title : 'Session ' + next, at, at);
    return id;
  }

  rename(campaign: string, chat: string, title: string): void {
    this.db.prepare('UPDATE ai_chats SET title = ?, updated = ? WHERE campaign_id = ? AND id = ?').run(title, new Date().toISOString(), campaign, chat);
  }

  end(campaign: string, chat: string, at: string): void {
    this.db.prepare("UPDATE ai_chats SET status = 'ended', ended_at = ?, updated = ? WHERE campaign_id = ? AND id = ?").run(at, at, campaign, chat);
  }

  /** Pausing is not ending: open cards stay unresolved and the transcript stays writable after resume. */
  pause(campaign: string, chat: string, at: string, note: string): void {
    this.db.prepare("UPDATE ai_chats SET status = 'paused', resume_note = ?, updated = ? WHERE campaign_id = ? AND id = ?").run(note, at, campaign, chat);
  }

  /**
   * Resume keeps the saved resume_note. The GM overwrites it with set_resume_note the next time play
   * stops, so the last "Where we stopped" line stays available; this keeps resume a single status write.
   */
  resume(campaign: string, chat: string, at: string): void {
    this.db.prepare("UPDATE ai_chats SET status = 'open', updated = ? WHERE campaign_id = ? AND id = ?").run(at, campaign, chat);
  }

  setResumeNote(campaign: string, chat: string, note: string): void {
    this.db.prepare('UPDATE ai_chats SET resume_note = ?, updated = ? WHERE campaign_id = ? AND id = ?').run(note, new Date().toISOString(), campaign, chat);
  }

  touch(chat: string, at: string): void {
    this.db.prepare('UPDATE ai_chats SET updated = ? WHERE id = ?').run(at, chat);
  }

  /** The newest non-empty working summary, optionally excluding the current session. Used by the opening recap. */
  latestSummary(campaign: string, exclude: string | null): { title: string; summary: string } | undefined {
    return this.db.prepare("SELECT title, summary FROM ai_chats WHERE campaign_id = ? AND summary != '' AND (? IS NULL OR id != ?) ORDER BY ordinal DESC LIMIT 1").get(campaign, exclude, exclude) as { title: string; summary: string } | undefined;
  }

  setSummary(chat: string, summary: string, through: number, at: string): void {
    this.db.prepare('UPDATE ai_chats SET summary = ?, summarized_through = ?, summary_updated = ?, updated = ? WHERE id = ?').run(summary, through, at, at, chat);
  }

  remove(campaign: string, chat: string): void {
    this.db.prepare('DELETE FROM ai_actions WHERE turn_id IN (SELECT id FROM ai_turns WHERE chat_id = ?)').run(chat);
    this.db.prepare('DELETE FROM ai_messages WHERE chat_id = ?').run(chat);
    this.db.prepare('DELETE FROM ai_turns WHERE chat_id = ?').run(chat);
    this.db.prepare('UPDATE ai_journal SET chat_id = NULL WHERE chat_id = ?').run(chat);
    this.db.prepare('DELETE FROM ai_chats WHERE campaign_id = ? AND id = ?').run(campaign, chat);
  }
}
