import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { User } from './campaign-service';

export type SendLoginCode = (email: string, code: string) => Promise<void>;
type Purpose = 'login' | 'link';
const normalizeEmail = (value: string): string => {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('Invalid email');
  return email;
};

/** Codes are scoped to one email and purpose, expire, and are consumed transactionally. */
export class EmailAuth {
  private readonly secret = randomBytes(32);
  constructor(private readonly db: Database.Database, private readonly send: SendLoginCode, private readonly allowRegistration: boolean) {}
  private hash(email: string, purpose: Purpose, code: string): string {
    return createHmac('sha256', this.secret).update(`${purpose}\0${email}\0${code}`).digest('hex');
  }
  async request(value: string, purpose: Purpose, userId: string | null): Promise<void> {
    const email = normalizeEmail(value);
    if (purpose === 'link' && !userId) throw new Error('Unauthorized');
    const existing = this.db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if ((purpose === 'login' && !existing && !this.allowRegistration) || (purpose === 'link' && existing && existing.id !== userId)) return;
    const previous = this.db.prepare('SELECT requested_at FROM email_codes WHERE email = ? AND purpose = ?').get(email, purpose) as { requested_at: string } | undefined;
    if (previous && Date.parse(previous.requested_at) > Date.now() - 60_000) return;
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const hash = this.hash(email, purpose, code);
    const at = new Date();
    this.db.prepare(`INSERT INTO email_codes(email, purpose, user_id, code_hash, expires_at, requested_at, attempts)
      VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT(email, purpose) DO UPDATE SET user_id=excluded.user_id, code_hash=excluded.code_hash,
      expires_at=excluded.expires_at, requested_at=excluded.requested_at, attempts=0`)
      .run(email, purpose, userId, hash, new Date(at.getTime() + 10 * 60_000).toISOString(), at.toISOString());
    try { await this.send(email, code); }
    catch (error) {
      this.db.prepare('DELETE FROM email_codes WHERE email = ? AND purpose = ? AND code_hash = ?').run(email, purpose, hash);
      throw error;
    }
  }
  consume(value: string, code: string, purpose: Purpose, userId: string | null): User | null {
    const email = normalizeEmail(value);
    if (!/^\d{8}$/.test(code)) return null;
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT code_hash, user_id, expires_at, attempts FROM email_codes WHERE email = ? AND purpose = ?').get(email, purpose) as { code_hash: string; user_id: string | null; expires_at: string; attempts: number } | undefined;
      if (!row || row.expires_at <= new Date().toISOString() || row.attempts >= 5 || (purpose === 'link' && (!userId || row.user_id !== userId))) return null;
      const expected = Buffer.from(row.code_hash, 'hex');
      const actual = Buffer.from(this.hash(email, purpose, code), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        this.db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ?').run(email, purpose);
        return null;
      }
      this.db.prepare('DELETE FROM email_codes WHERE email = ? AND purpose = ?').run(email, purpose);
      const existing = this.db.prepare('SELECT id, username FROM users WHERE email = ?').get(email) as User | undefined;
      if (purpose === 'link') {
        if (existing && existing.id !== userId) return null;
        this.db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
        return (this.db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as User | undefined) ?? null;
      }
      if (existing) return existing;
      if (!this.allowRegistration) return null;
      const id = randomUUID();
      const user = { id, username: `Aventureiro-${id.slice(0, 24)}` };
      this.db.prepare('INSERT INTO users(id, username, password_hash, created_at, email) VALUES (?, ?, ?, ?, ?)')
        .run(id, user.username, '!email-only', new Date().toISOString(), email);
      return user;
    })();
  }
}
