import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

/**
 * The campaign schema is deliberately separate from the legacy docs/rolls tables.
 * Until the authenticated server is enabled, the existing application keeps using
 * the old tables and never exposes these new ones.
 */
export const LEGACY_CAMPAIGN_ID = 'legacy-unclaimed';
export const CURRENT_VERSION = 8;

/** Schema 6 adds AI sessions and the adventure journal. It only adds tables and columns, then backfills Session 1 for each AI campaign. Every step is idempotent. */
function migrateAiSessions(db: Database.Database): void {
  const statements = [
    "CREATE TABLE IF NOT EXISTS ai_chats (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','paused','ended')), summary TEXT NOT NULL DEFAULT '', summarized_through INTEGER NOT NULL DEFAULT 0, summary_updated TEXT, resume_note TEXT, created TEXT NOT NULL, updated TEXT NOT NULL, ended_at TEXT, UNIQUE(campaign_id, ordinal))",
    "CREATE TABLE IF NOT EXISTS ai_journal (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, chat_id TEXT REFERENCES ai_chats(id) ON DELETE SET NULL, chat_label TEXT NOT NULL DEFAULT '', turn_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('event','note','chapter')), title TEXT NOT NULL, body TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('shared','gm')), author TEXT NOT NULL CHECK(author IN ('engine','gm','owner')), created TEXT NOT NULL, updated TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS ai_journal_campaign ON ai_journal(campaign_id, kind)",
    "CREATE INDEX IF NOT EXISTS ai_journal_chat ON ai_journal(chat_id)",
  ];
  for (const statement of statements) db.exec(statement);
  addColumn(db, 'ai_messages', 'chat_id TEXT REFERENCES ai_chats(id)');
  addColumn(db, 'ai_turns', 'chat_id TEXT REFERENCES ai_chats(id)');
  addColumn(db, 'ai_turns', "kind TEXT NOT NULL DEFAULT 'turn' CHECK(kind IN ('turn','compact','end','pause'))");
  addColumn(db, 'ai_turns', "prompt_version TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'campaign_ai', "state TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, 'campaign_ai', "digest TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'campaign_ai', "context_budget TEXT NOT NULL DEFAULT 'balanced'");
  addColumn(db, 'ai_credentials', 'context_window INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'ai_credentials', 'temperature INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS ai_messages_chat ON ai_messages(chat_id)');
  db.exec('CREATE INDEX IF NOT EXISTS ai_turns_chat ON ai_turns(campaign_id, chat_id)');
  const now = new Date().toISOString();
  const owners = db.prepare('SELECT campaign_id AS id FROM campaign_ai UNION SELECT campaign_id AS id FROM ai_turns UNION SELECT campaign_id AS id FROM ai_messages').all() as { id: string }[];
  for (const { id: campaign } of owners) {
    const count = db.prepare('SELECT COUNT(*) AS n FROM ai_chats WHERE campaign_id = ?').get(campaign) as { n: number };
    if (!count.n) db.prepare("INSERT INTO ai_chats (id, campaign_id, ordinal, title, status, summary, summarized_through, created, updated) VALUES (?, ?, 1, 'Session 1', 'open', '', 0, ?, ?)").run(randomUUID(), campaign, now, now);
    const chat = db.prepare('SELECT id FROM ai_chats WHERE campaign_id = ? ORDER BY ordinal LIMIT 1').get(campaign) as { id: string };
    db.prepare('UPDATE ai_messages SET chat_id = ? WHERE campaign_id = ? AND chat_id IS NULL').run(chat.id, campaign);
    db.prepare('UPDATE ai_turns SET chat_id = ? WHERE campaign_id = ? AND chat_id IS NULL').run(chat.id, campaign);
  }
}

function addColumn(db: Database.Database, table: string, definition: string): void {
  const name = definition.split(' ')[0]!;
  const columns = db.prepare('PRAGMA table_info(' + table + ')').all() as { name: string }[];
  if (!columns.some(column => column.name === name)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + definition);
}

function tableSql(db: Database.Database, table: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined;
  return row ? row.sql : '';
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare('PRAGMA table_info(' + table + ')').all() as { name: string }[]).map(column => column.name);
}

/**
 * Version 8 adds the paused chat status and its resume_note column, and the pause turn kind.
 * SQLite cannot alter a CHECK constraint in place, so both tables are rebuilt. The rebuild drops
 * the old table with foreign_keys OFF (that pragma only takes effect outside a transaction) and
 * copies every row, which keeps ids so message, turn and journal references stay valid.
 */
function rebuildAiChatsAndTurns(db: Database.Database): void {
  const chats = tableSql(db, 'ai_chats'), turns = tableSql(db, 'ai_turns');
  const rebuildChats = chats !== '' && (!chats.includes("'paused'") || columnNames(db, 'ai_chats').indexOf('resume_note') < 0);
  const rebuildTurns = turns !== '' && !turns.includes("'pause'");
  if (!rebuildChats && !rebuildTurns) return;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      if (rebuildChats) {
        const note = columnNames(db, 'ai_chats').indexOf('resume_note') >= 0 ? 'resume_note' : 'NULL';
        db.exec("CREATE TABLE ai_chats_new (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','paused','ended')), summary TEXT NOT NULL DEFAULT '', summarized_through INTEGER NOT NULL DEFAULT 0, summary_updated TEXT, resume_note TEXT, created TEXT NOT NULL, updated TEXT NOT NULL, ended_at TEXT, UNIQUE(campaign_id, ordinal))");
        db.exec("INSERT INTO ai_chats_new (id, campaign_id, ordinal, title, status, summary, summarized_through, summary_updated, resume_note, created, updated, ended_at) SELECT id, campaign_id, ordinal, title, status, summary, summarized_through, summary_updated, " + note + ", created, updated, ended_at FROM ai_chats");
        db.exec('DROP TABLE ai_chats');
        db.exec('ALTER TABLE ai_chats_new RENAME TO ai_chats');
      }
      if (rebuildTurns) {
        db.exec("CREATE TABLE ai_turns_new (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', steps INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL, checkpoint TEXT NOT NULL DEFAULT '[]', chat_id TEXT REFERENCES ai_chats(id), kind TEXT NOT NULL DEFAULT 'turn' CHECK(kind IN ('turn','compact','end','pause')), prompt_version TEXT NOT NULL DEFAULT '', UNIQUE(campaign_id,request_id))");
        db.exec("INSERT INTO ai_turns_new (id, campaign_id, user_id, request_id, status, error, steps, cost, created, updated, checkpoint, chat_id, kind, prompt_version) SELECT id, campaign_id, user_id, request_id, status, error, steps, cost, created, updated, checkpoint, chat_id, kind, prompt_version FROM ai_turns");
        db.exec('DROP TABLE ai_turns');
        db.exec('ALTER TABLE ai_turns_new RENAME TO ai_turns');
        db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ai_one_running ON ai_turns(campaign_id) WHERE status = 'running'");
        db.exec('CREATE INDEX IF NOT EXISTS ai_turns_chat ON ai_turns(campaign_id, chat_id)');
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}


export function openCampaignDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    migrateCampaignDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Use SQLite's online backup API: copying a live .db file omits WAL contents. */
export async function backupDatabase(db: Database.Database, destination: string): Promise<void> {
  if (destination === ':memory:') throw new Error('Backup destination must be a file');
  mkdirSync(dirname(destination), { recursive: true });
  // Never replace an existing backup. The exclusive create also avoids races.
  const fd = openSync(destination, 'wx', 0o600);
  closeSync(fd);
  try {
    await db.backup(destination);
  } catch (error) {
    unlinkSync(destination);
    throw error;
  }
}

export function migrateCampaignDatabase(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > CURRENT_VERSION) throw new Error(`Unsupported database version ${version}`);
  if (version === CURRENT_VERSION) return;

  db.transaction(() => {
    if (version === 0) {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE TABLE campaigns (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        owner_id TEXT REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE campaign_members (
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('gm','player')),
        PRIMARY KEY(campaign_id, user_id)
      );
      CREATE INDEX campaign_members_user ON campaign_members(user_id);
      CREATE TABLE campaign_invites (
        token_hash TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL,
        used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE campaign_docs (
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        ns TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, updated TEXT NOT NULL,
        PRIMARY KEY(campaign_id, ns, id)
      );
      CREATE TABLE campaign_rolls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        at TEXT NOT NULL, author TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX campaign_rolls_recent ON campaign_rolls(campaign_id, id DESC);
      CREATE TABLE campaign_notes (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK(visibility IN ('private','shared')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX campaign_notes_lookup ON campaign_notes(campaign_id, visibility, author_id);
      CREATE TABLE campaign_assets (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        uploaded_by TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, category TEXT NOT NULL,
        media_type TEXT NOT NULL, size INTEGER NOT NULL, storage_name TEXT NOT NULL UNIQUE,
        visibility TEXT NOT NULL CHECK(visibility IN ('gm','shared')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX campaign_assets_lookup ON campaign_assets(campaign_id, visibility);
    `);
    const exists = db.prepare<[string], { found: number }>(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
    );
    const hasDocs = !!exists.get('docs');
    const hasRolls = !!exists.get('rolls');
    const docCount = hasDocs ? (db.prepare('SELECT COUNT(*) AS n FROM docs').get() as { n: number }).n : 0;
    const rollCount = hasRolls ? (db.prepare('SELECT COUNT(*) AS n FROM rolls').get() as { n: number }).n : 0;
    if (docCount || rollCount) {
      const now = new Date().toISOString();
      db.prepare('INSERT INTO campaigns (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(LEGACY_CAMPAIGN_ID, 'Campanha anterior', now, now);
      if (hasDocs) db.prepare('INSERT INTO campaign_docs (campaign_id, ns, id, value, updated) SELECT ?, ns, id, value, updated FROM docs').run(LEGACY_CAMPAIGN_ID);
      if (hasRolls) db.prepare('INSERT INTO campaign_rolls (campaign_id, at, author, kind, payload) SELECT ?, at, author, kind, payload FROM rolls ORDER BY id').run(LEGACY_CAMPAIGN_ID);
    }
    }
    if (version < 2) {
      db.exec(`
        ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;
        CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
        CREATE TABLE email_codes (
          email TEXT NOT NULL COLLATE NOCASE, purpose TEXT NOT NULL CHECK(purpose IN ('login','link')),
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL, requested_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(email, purpose)
        );
      `);
    }
    if (version < 3) {
      db.exec(`ALTER TABLE campaigns ADD COLUMN configuration TEXT NOT NULL DEFAULT '{"systemId":"daggerheart","rulesetId":"core","options":{}}';`);
    }
    if (version < 4) db.exec(`
      CREATE TABLE IF NOT EXISTS ai_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, encrypted_key TEXT NOT NULL, model TEXT NOT NULL, key_hint TEXT NOT NULL, updated TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campaign_ai (
        campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL REFERENCES users(id), enabled INTEGER NOT NULL DEFAULT 1,
        setup TEXT NOT NULL DEFAULT '{}', memory TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_turns (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, status TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT '', steps INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0,
        created TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(campaign_id,request_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ai_one_running ON ai_turns(campaign_id) WHERE status = 'running';
      CREATE TABLE IF NOT EXISTS ai_messages (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES ai_turns(id), role TEXT NOT NULL, text TEXT NOT NULL,
        interaction TEXT, created TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_messages_campaign ON ai_messages(campaign_id,created);
      CREATE TABLE IF NOT EXISTS ai_actions (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES ai_turns(id), call_id TEXT NOT NULL,
        tool TEXT NOT NULL, label TEXT NOT NULL, result TEXT NOT NULL, created TEXT NOT NULL,
        UNIQUE(turn_id,call_id)
      );
    `);
    if (version < 5) {
      const columns = db.prepare('PRAGMA table_info(ai_turns)').all() as { name: string }[];
      if (!columns.some(column => column.name === 'checkpoint')) db.exec("ALTER TABLE ai_turns ADD COLUMN checkpoint TEXT NOT NULL DEFAULT '[]'");
    }
    if (version < 6) migrateAiSessions(db);
    if (version < 7) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_canon (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('person','location','faction','promise','fact','history','plan','rumor','secret')),
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          visibility TEXT NOT NULL CHECK(visibility IN ('shared','gm')),
          source TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ai_canon_campaign ON ai_canon(campaign_id, kind);
      `);
    }
  })();
  // Changing a CHECK constraint needs a table rebuild, which only works with foreign_keys OFF
  // outside a transaction, so it runs after the main migration has committed.
  if (version < 8) rebuildAiChatsAndTurns(db);
  db.pragma(`user_version = ${CURRENT_VERSION}`);
}
