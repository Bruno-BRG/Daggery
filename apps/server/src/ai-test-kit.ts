import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { openCampaignDatabase } from './campaign-db';
import { registerCampaignRoutes } from './campaign-routes';
import { CampaignService } from './campaign-service';
import { ModelProvider } from './ai/provider';
import { registerAiRoutes } from './ai/routes';
import { AiService } from './ai/service';
import { SecretVault } from './ai/vault';

/**
 * Fixtures for the AI memory tests. Databases are in memory and every model call goes through a fake fetch.
 * The file name does not end in .test.ts, so the src/*.test.ts glob does not run it.
 */
export const ORIGIN = 'http://localhost:4710';
export const MODEL = 'test-gm';
const CATALOG = { data: [{ id: MODEL, name: 'Test GM', type: 'chat', capabilities: { tools: { supported: true } }, cost: { text: { input: { price: 1 } } } }] };

export interface Captured { body: any; tools: boolean; session: string; signal: AbortSignal }
export type Handler = (request: Captured) => Response | Promise<Response>;
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export function call(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id, name, args };
}

/** A chat completion. Pass calls to make the model request tools. */
export function completion(content: string | null, calls?: ToolCall[]): Response {
  const toolCalls = calls?.map(item => ({ id: item.id, type: 'function', function: { name: item.name, arguments: JSON.stringify(item.args) } }));
  return json({ choices: [{ message: { role: 'assistant', content, ...(toolCalls?.length ? { tool_calls: toolCalls } : {}) } }], usage: { cost: 0.001 } });
}

/** A valid summarizer reply. Summarizer requests are the ones without a tools field. */
export function summaryReply(chapter = 'The party moved through the harbor district.', working = 'Working summary: the party is at the harbor.', digest = 'Digest: the harbor keeps the keeper secret.'): Response {
  return completion(JSON.stringify({ chapter, working, digest }));
}

export function lastUserText(body: any): string {
  const users = (body.messages as { role: string; content: string | null }[]).filter(item => item.role === 'user');
  return users.at(-1)?.content ?? '';
}

const WORDS = ['lantern', 'harbor', 'stone', 'whisper', 'iron', 'gate', 'tide', 'ember', 'ledger', 'road', 'salt', 'bell'];

/** Deterministic prose of an exact length. The seed becomes the first sentence. */
export function prose(length: number, seed: string): string {
  let out = seed + '.';
  for (let index = 0; out.length < length; index++) out += ' The ' + WORDS[index % WORDS.length] + ' drifts past the ' + WORDS[(index * 5 + 3) % WORDS.length] + ' and settles.';
  return out.slice(0, length).trimEnd();
}

/** Schema 5 as the migrations of version 0 to 5 left it, before sessions, the journal and the v6 columns. */
const SCHEMA_FIVE_SQL = [
  "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);",
  "CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);",
  "CREATE INDEX sessions_user ON sessions(user_id);",
  "CREATE TABLE campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', owner_id TEXT REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT);",
  "CREATE TABLE campaign_members (campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('gm','player')), PRIMARY KEY(campaign_id, user_id));",
  "CREATE INDEX campaign_members_user ON campaign_members(user_id);",
  "CREATE TABLE campaign_invites (token_hash TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, created_by TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL);",
  "CREATE TABLE campaign_docs (campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, ns TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY(campaign_id, ns, id));",
  "CREATE TABLE campaign_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, at TEXT NOT NULL, author TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);",
  "CREATE INDEX campaign_rolls_recent ON campaign_rolls(campaign_id, id DESC);",
  "CREATE TABLE campaign_notes (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('private','shared')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE INDEX campaign_notes_lookup ON campaign_notes(campaign_id, visibility, author_id);",
  "CREATE TABLE campaign_assets (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, uploaded_by TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, category TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL, storage_name TEXT NOT NULL UNIQUE, visibility TEXT NOT NULL CHECK(visibility IN ('gm','shared')), created_at TEXT NOT NULL);",
  "CREATE INDEX campaign_assets_lookup ON campaign_assets(campaign_id, visibility);",
  "ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;",
  "CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;",
  "CREATE TABLE email_codes (email TEXT NOT NULL COLLATE NOCASE, purpose TEXT NOT NULL CHECK(purpose IN ('login','link')), user_id TEXT REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, requested_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(email, purpose));",
  "ALTER TABLE campaigns ADD COLUMN configuration TEXT NOT NULL DEFAULT '{\"systemId\":\"daggerheart\",\"rulesetId\":\"core\",\"options\":{}}';",
  "CREATE TABLE IF NOT EXISTS ai_credentials (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, encrypted_key TEXT NOT NULL, model TEXT NOT NULL, key_hint TEXT NOT NULL, updated TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS campaign_ai (campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE, owner_id TEXT NOT NULL REFERENCES users(id), enabled INTEGER NOT NULL DEFAULT 1, setup TEXT NOT NULL DEFAULT '{}', memory TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS ai_turns (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', steps INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(campaign_id,request_id));",
  "CREATE UNIQUE INDEX IF NOT EXISTS ai_one_running ON ai_turns(campaign_id) WHERE status = 'running';",
  "CREATE TABLE IF NOT EXISTS ai_messages (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, turn_id TEXT REFERENCES ai_turns(id), role TEXT NOT NULL, text TEXT NOT NULL, interaction TEXT, created TEXT NOT NULL);",
  "CREATE INDEX IF NOT EXISTS ai_messages_campaign ON ai_messages(campaign_id,created);",
  "CREATE TABLE IF NOT EXISTS ai_actions (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, turn_id TEXT NOT NULL REFERENCES ai_turns(id), call_id TEXT NOT NULL, tool TEXT NOT NULL, label TEXT NOT NULL, result TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(turn_id,call_id));",
  "ALTER TABLE ai_turns ADD COLUMN checkpoint TEXT NOT NULL DEFAULT '[]';",
].join('\n');

export function schemaFiveDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_FIVE_SQL);
  db.pragma('user_version = 5');
  return db;
}

/** A GM campaign with one hero and a connected model. The default session is "Session 1". */
export async function fixture(handler: Handler, budget = 'balanced') {
  const db = openCampaignDatabase(':memory:');
  const campaigns = new CampaignService(db);
  const user = await campaigns.register('gmtest', 'a strong temporary test password');
  const campaign = campaigns.createCampaign(user.id, 'AI adventure', '', { systemId: 'daggerheart', rulesetId: 'core', gmController: 'ai' });
  const requests: Captured[] = [];
  const provider = new ModelProvider((async (_url: unknown, init?: RequestInit) => {
    if (!init?.body) return json(CATALOG);
    const body = JSON.parse(String(init.body)) as any;
    const headers = (init.headers ?? {}) as Record<string, string>;
    const request: Captured = { body, tools: body.tools !== undefined, session: headers['x-opencode-session'] ?? '', signal: init.signal as AbortSignal };
    requests.push(request);
    return handler(request);
  }) as typeof fetch);
  const vault = new SecretVault(randomBytes(32));
  const rolls: { kind: string; result: any }[] = [];
  const ai = new AiService(db, campaigns, vault, provider, () => {}, (_campaign, kind, result) => { rolls.push({ kind, result }); });
  await ai.saveConnection(user.id, { provider: 'opencode', model: MODEL, apiKey: 'test-secret-never-in-context' });
  const setup = ai.configure(user.id, campaign, { premise: 'Find the vanished keeper', budget, quickHero: { name: 'Ash', classId: 'warrior' } });
  return { ai, db, campaigns, user, campaign, requests, setup, provider, vault, rolls, close: async () => { await ai.close(); db.close(); } };
}

/** Waits until the newest turn of the campaign leaves the running state, then returns the session view. */
export async function finished(ai: AiService, user: string, campaign: string) {
  for (let attempt = 0; attempt < 5000; attempt++) {
    if (ai.session(user, campaign).run?.status !== 'running') {
      await new Promise(resolve => setTimeout(resolve, 0));
      return ai.session(user, campaign);
    }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('The GM did not finish');
}

let requestSeq = 0;
/** Starts a player turn and waits for it to finish. */
export async function runTurn(f: Fixture, message: string, chatId?: string) {
  requestSeq++;
  const started = f.ai.start(f.user.id, f.campaign, { requestId: 'req-' + requestSeq, message, ...(chatId ? { chatId } : {}) });
  const state = await finished(f.ai, f.user.id, f.campaign);
  return { started, state };
}

export function currentTurn(f: Fixture): string {
  const run = f.ai.session(f.user.id, f.campaign).run;
  if (!run) throw new Error('No turn has run yet');
  return run.id;
}

let actionSeq = 0;
/** Runs one GM tool against a turn directly, as the model would. Returns the tool result or throws its error. */
export function act(f: Fixture, turn: string, name: string, args: Record<string, unknown> = {}): any {
  actionSeq++;
  return f.ai.actions.execute(name, args, { campaign: f.campaign, owner: f.user.id, turn, callId: 'direct-' + actionSeq, assertActive: () => {}, publish: () => {}, publishRoll: () => {} });
}

export async function addPlayer(f: Fixture, username: string) {
  const player = await f.campaigns.register(username, 'a temporary player password');
  f.campaigns.acceptInvite(player.id, f.campaigns.createInvite(f.user.id, f.campaign));
  return player;
}

/** Adds alternating player and GM messages straight to a session, as older play would have left them. */
export function seedHistory(f: Fixture, chat: string, count: number, size: number, start = 0): void {
  for (let index = start; index < start + count; index++) {
    const player = index % 2 === 0;
    f.ai.actions.message(f.campaign, chat, null, player ? 'player' : 'gm', prose(size, (player ? 'Player ' : 'GM ') + 'message ' + index));
  }
}

/** Fastify with the campaign and AI routes, using the same vault and provider as the fixture. */
export async function httpApp(f: Fixture) {
  const app = Fastify({ logger: false });
  await registerCampaignRoutes(app, { service: f.campaigns, origin: ORIGIN, secureCookies: false, allowRegistration: false });
  const routes = registerAiRoutes(app, { db: f.db, service: f.campaigns, secureCookies: false, vault: f.vault, provider: f.provider, publish: () => {}, publishRoll: () => {} });
  return { app, routes, cookie: 'daggery_session=' + f.campaigns.createSession(f.user.id) };
}
