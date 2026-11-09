import { randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { adversaries } from '@daggery/content';
import { canReuseAiKey, getGameSystem, getRuleset, maxDiceTotal, roll, rollDice, type AiAdventure, type AiBudget, type AiConnection, type AiInteraction, type AiJournalEntry, type AiJournalPage, type AiMessage, type AiProvider, type AiRun, type AiSetup, type AiTurnKind, type SoloState, type TraitName } from '@daggery/shared';
import { applyDualityEffects, armorScore, damageHp, damageNotation, damageSeverity, damageThresholds, hpMax, weaponForSlot, weaponModifier } from '@daggery/shared/daggerheart';
import type { Sheet } from '@daggery/shared/daggerheart/types';
import type { CampaignService } from '../campaign-service';
import type { AiChats, ChatRow } from './chats';
import type { AiJournal } from './journal';
import { GmActions, GM_TOOLS } from './tools';
import { ModelProvider, PROVIDERS, ProviderError, type ModelMessage, type ToolCall } from './provider';
import { COMPACT_TAIL, COMPACT_TRIGGER, MESSAGE_CHARS, SECRETS_LIMIT, TOOL_RESULT_CHARS, budgetTable, budgetTokens, emptyState, estimateTokens, fitJson, fitMemory, limitsFor, renderState, shorten, snapshotText, type MemoryPart } from './memory';
import { COMPACTION_PROMPT, GM_PROMPT, GM_PROMPT_VERSION, OPENING_INSTRUCTION } from './prompts';
import { QUICK_CLASSES, quickHero } from './daggerheart';
import { SecretVault } from './vault';
import { record, text } from './validation';

export class AiConflict extends Error {}

const NL = String.fromCharCode(10);
const BUDGET_NAMES = ['lean', 'balanced', 'rich', 'maximum'];
const BEGIN_MESSAGE = 'Begin our adventure. Introduce the opening scene and give me a meaningful decision.';
const DEFAULT_SETUP: AiSetup = { premise: '', tone: 'Adventurous mystery', heroId: '' };
const SUMMARY_MAX_TOKENS = 1800;
/** Estimated tokens of messages in one summarizer request. A larger backlog takes several requests, each with its own chapter. */
const COMPACT_BATCH_TOKENS = 40000;
const TURN_STEPS = 12;
const TURN_ACTIONS = 24;
/** The whole turn, including its compaction rounds, must finish within this time. */
const TURN_TIMEOUT_MS = 300000;
const TRANSCRIPT_PAGE = 60;
const SUMMARIZED_NOTICE = 'Earlier messages were summarized for the GM.';
const ENDED_NOTICE = 'This session has ended. Its transcript is read only. Start a new session to keep playing.';
const SETTING_FIELDS = ['premise', 'tone', 'locations', 'factions', 'secrets', 'agreements'];
const SCENARIO_FIELDS = ['hook', 'stakes', 'scenes', 'cast', 'rewards', 'aftermath'];

function fieldLines(fields: unknown, keys: string[]): string[] {
  const values = fields && typeof fields === 'object' ? fields as Record<string, unknown> : {};
  return keys.flatMap(key => {
    const value = typeof values[key] === 'string' ? (values[key] as string).trim() : '';
    return value ? [key + ': ' + clip(value, 600)] : [];
  });
}


interface Settings { campaign_id: string; owner_id: string; enabled: number; setup: string; memory: string; state: string; digest: string; context_budget: string; updated: string }
interface Credential { user_id: string; provider: AiProvider; encrypted_key: string; model: string; key_hint: string; context_window: number; temperature: number }
interface TurnRow { id: string; campaign_id: string; user_id: string; chat_id: string | null; kind: AiTurnKind; request_id: string; status: AiRun['status']; error: string; checkpoint: string; steps: number; cost: number; prompt_version: string; created: string; updated: string }
interface MessageRow { seq: number; id: string; role: string; text: string; interaction: string | null; at: string }
interface RunRow { id: string; kind: AiTurnKind; chat_id: string | null; status: AiRun['status']; error: string; steps: number; cost: number; at: string }
interface ActionRow { id: string; tool: string; label: string; result: string; at: string }
interface Pending { seq: number; role: string; text: string; created: string; tokens: number }
interface Summary { chapter: string; working: string; digest: string }
interface Runtime { campaign: string; owner: string; turn: string; chat: string; provider: AiProvider; model: string; key: string; temperature: boolean; signal: AbortSignal; assertActive: () => void }
type Publish = (campaign: string, ns: string, id: string, value: unknown) => void;
type PublishRoll = (campaign: string, kind: string, result: unknown, author?: string) => void;

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function budgetOf(settings: Settings | undefined): AiBudget {
  const value = settings?.context_budget ?? '';
  return BUDGET_NAMES.includes(value) ? value as AiBudget : 'balanced';
}

function setupOf(settings: Settings): AiSetup {
  try {
    return { ...DEFAULT_SETUP, ...(JSON.parse(settings.setup) as Partial<AiSetup>) };
  } catch {
    return { ...DEFAULT_SETUP };
  }
}

function words(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const parts = trimmed.split(/\s+/);
  return parts.length > max ? parts.slice(0, max).join(' ') : trimmed;
}

/** Reads the model's JSON reply. Surrounding prose or code fences are ignored. */
export function parseSummary(content: string | null | undefined): Summary | null {
  if (!content) return null;
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  const summary = { chapter: words(value.chapter, 180), working: words(value.working, 300), digest: words(value.digest, 250) };
  return summary.chapter && summary.working && summary.digest ? summary : null;
}

function firstSentence(value: string): string {
  const flat = value.trim();
  const match = flat.match(/^[^.!?]+[.!?]/);
  return clip(match ? match[0] : flat, 240);
}

/** Index where the verbatim tail starts. The newest message always stays in the tail. */
function tailStart(pending: Pending[], tokens: number): number {
  let index = pending.length;
  let used = 0;
  while (index > 0 && used + pending[index - 1]!.tokens <= tokens) {
    index--;
    used += pending[index]!.tokens;
  }
  return Math.min(index, pending.length - 1);
}

/** The oldest messages that fit in one summarizer request. The first message is always included, even when it alone is larger. */
function batchOf(pending: Pending[], tokens: number): Pending[] {
  let used = 0;
  let end = 0;
  while (end < pending.length && (end === 0 || used + pending[end]!.tokens <= tokens)) {
    used += pending[end]!.tokens;
    end++;
  }
  return pending.slice(0, end);
}

function transcript(batch: Pending[]): string {
  return batch.map(item => (item.role === 'gm' ? 'GM' : item.role === 'roll' ? 'Dice' : 'Player') + ': ' + clip(item.text, MESSAGE_CHARS)).join(NL + NL);
}

function compactionInput(summary: string, digest: string, batch: Pending[], retry: boolean): string {
  const parts = [
    'Previous session summary:' + NL + (summary || 'None yet.'),
    'Campaign digest so far:' + NL + (digest || 'None yet.'),
    'Messages to summarize, oldest first:' + NL + transcript(batch),
  ];
  if (retry) parts.push('Your previous reply could not be read. Reply with only the JSON object that contains the fields chapter, working, and digest.');
  return parts.join(NL + NL);
}

/** Tool calls from the last assistant message that have no tool result yet. */
function unanswered(conversation: ModelMessage[]): ToolCall[] {
  let index = conversation.length - 1;
  while (index >= 0 && conversation[index]!.role !== 'assistant') index--;
  const assistant = index >= 0 ? conversation[index] : undefined;
  if (!assistant?.tool_calls) return [];
  const answered = new Set(conversation.slice(index + 1).filter(message => message.role === 'tool').map(message => message.tool_call_id));
  return assistant.tool_calls.filter(call => !answered.has(call.id));
}

export class AiService {
  readonly actions: GmActions;
  private running = new Map<string, { turn: string; controller: AbortController; job?: Promise<void> }>();

  constructor(private db: Database.Database, private campaigns: CampaignService, private vault = new SecretVault(randomBytes(32)), private provider = new ModelProvider(), private publish: Publish = () => {}, private publishRoll: PublishRoll = () => {}) {
    this.actions = new GmActions(db, campaigns);
    db.prepare("UPDATE ai_turns SET status = 'failed', error = 'The server restarted. Retry to continue from the saved checkpoint.', updated = ? WHERE status = 'running'").run(new Date().toISOString());
  }

  private get chats(): AiChats {
    return this.actions.chats;
  }

  private get journal(): AiJournal {
    return this.actions.journal;
  }

  get classes() {
    return QUICK_CLASSES;
  }

  authorize(user: string, campaign: string) {
    const role = this.campaigns.requireMember(user, campaign);
    const config = this.campaigns.configuration(campaign);
    if (config.gmController !== 'ai' || !getGameSystem(config.systemId)?.supportsAiGm || config.systemId !== 'daggerheart') throw new Error('Forbidden');
    return role;
  }

  private credential(user: string): Credential | undefined {
    return this.db.prepare('SELECT * FROM ai_credentials WHERE user_id = ?').get(user) as Credential | undefined;
  }

  connection(user: string): AiConnection | null {
    const row = this.credential(user);
    return row ? { provider: row.provider, model: row.model, keyHint: row.key_hint, contextWindow: row.context_window } : null;
  }

  async models(provider: unknown) {
    const id = text(provider, 30);
    if (!Object.hasOwn(PROVIDERS, id)) throw new Error('Invalid AI provider');
    return this.provider.models(id as AiProvider);
  }

  async saveConnection(user: string, value: unknown) {
    const input = record(value);
    const provider = text(input.provider, 30) as AiProvider;
    if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Invalid AI provider');
    const model = text(input.model, 180);
    if (!/^[\w./:@+-]{1,180}$/.test(model)) throw new Error('Invalid model ID');
    const selected = (await this.provider.models(provider)).find(item => item.id === model);
    if (!selected) throw new Error('Invalid or unsupported tool-capable model');
    const previous = this.credential(user);
    const key = text(input.apiKey, 1024, '');
    if (key && key.length < 12) throw new Error('Invalid API key: enter the complete provider key');
    if (key && /[\r\n]/.test(key)) throw new Error('Invalid API key');
    if (!key && (!previous || !canReuseAiKey(previous.provider, provider))) throw new Error('Invalid API key: enter a key for this provider');
    const encrypted = key ? this.vault.seal(key, user) : previous!.encrypted_key;
    const hint = key ? '••••' + key.slice(-4) : previous!.key_hint;
    this.db.prepare('INSERT INTO ai_credentials(user_id,provider,encrypted_key,model,key_hint,updated,context_window,temperature) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,encrypted_key=excluded.encrypted_key,model=excluded.model,key_hint=excluded.key_hint,updated=excluded.updated,context_window=excluded.context_window,temperature=excluded.temperature')
      .run(user, provider, encrypted, model, hint, new Date().toISOString(), selected.contextWindow ?? 0, selected.temperature ? 1 : 0);
    return this.connection(user);
  }

  forgetConnection(user: string) {
    for (const [campaign, running] of this.running) {
      if (this.settings(campaign)?.owner_id === user) {
        this.db.prepare("UPDATE ai_turns SET status = 'cancelled', error = '', updated = ? WHERE id = ? AND status = 'running'").run(new Date().toISOString(), running.turn);
        running.controller.abort();
      }
    }
    this.db.prepare('DELETE FROM ai_credentials WHERE user_id = ?').run(user);
  }

  private settings(campaign: string) {
    return this.db.prepare('SELECT * FROM campaign_ai WHERE campaign_id = ?').get(campaign) as Settings | undefined;
  }

  session(user: string, campaign: string, chatId?: string, before?: string): AiAdventure {
    const role = this.authorize(user, campaign);
    const gm = role === 'gm';
    const settings = this.settings(campaign);
    const chats = this.chats.list(campaign);
    const active = chatId && chats.some(chat => chat.id === chatId) ? chatId : this.chats.defaultId(campaign);
    const cursor = before && /^[0-9]+$/.test(before) ? Number(before) : null;
    const rows = active
      ? this.db.prepare('SELECT rowid AS seq, id, role, text, interaction, created AS at FROM ai_messages WHERE chat_id = ? AND (? IS NULL OR rowid < ?) ORDER BY rowid DESC LIMIT ?').all(active, cursor, cursor, TRANSCRIPT_PAGE + 1) as MessageRow[]
      : [];
    const page = rows.slice(0, TRANSCRIPT_PAGE).reverse();
    const messages: AiMessage[] = page.map(row => ({ id: row.id, role: row.role as AiMessage['role'], text: row.text, at: row.at, ...(row.interaction ? { interaction: JSON.parse(row.interaction) as AiInteraction } : {}) }));
    const earlierCursor = rows.length > TRANSCRIPT_PAGE && page[0] ? String(page[0].seq) : null;
    const credential = settings ? this.credential(settings.owner_id) : undefined;
    const budget = budgetOf(settings);
    const tokens = budgetTokens(budget, credential?.context_window ?? 0);
    const budgets = budgetTable(credential?.context_window ?? 0);
    const usage = settings && active ? this.assemble(campaign, settings, active, tokens) : null;
    const latest = this.db.prepare('SELECT id, kind, chat_id, status, error, steps, cost, updated AS at FROM ai_turns WHERE campaign_id = ? ORDER BY rowid DESC LIMIT 1').get(campaign) as RunRow | undefined;
    const actions = gm && active
      ? (this.db.prepare('SELECT a.id, a.tool, a.label, a.result, a.created AS at FROM ai_actions a JOIN ai_turns t ON t.id = a.turn_id WHERE a.campaign_id = ? AND t.chat_id = ? ORDER BY a.rowid DESC LIMIT 30').all(campaign, active) as ActionRow[])
        .map(item => ({ id: item.id, tool: item.tool, label: item.label, result: JSON.parse(item.result) as unknown, at: item.at }))
      : [];
    return {
      enabled: !!settings?.enabled,
      ready: !!settings && !!credential,
      connection: gm ? this.connection(user) : null,
      setup: settings ? setupOf(settings) : { ...DEFAULT_SETUP },
      budget,
      budgets,
      memory: gm && settings ? settings.memory : '',
      digest: gm && settings ? settings.digest : '',
      state: gm && settings ? this.actions.readState(campaign) : null,
      chatSummary: gm && active ? (this.chats.row(campaign, active)?.summary ?? '') : '',
      chats,
      activeChatId: active,
      messages,
      earlierCursor,
      memoryStatus: { chapters: this.journal.count(campaign, 'chapter'), contextTokens: usage ? usage.memoryTokens + usage.historyTokens : 0, budgetTokens: tokens },
      actions,
      run: latest ? { id: latest.id, kind: latest.kind, chatId: latest.chat_id ?? '', status: latest.status, error: latest.error, steps: latest.steps, cost: latest.cost, at: latest.at } : null,
      isGm: gm,
    };
  }

  configure(user: string, campaign: string, raw: unknown) {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    if (this.running.has(campaign)) throw new AiConflict('Stop the current GM turn before changing the adventure.');
    if (!this.connection(user)) throw new Error('Invalid connection: add your provider API key first');
    const value = record(raw);
    const budget = text(value.budget, 20, 'balanced');
    if (!BUDGET_NAMES.includes(budget)) throw new Error('Invalid memory size');
    let created: Sheet | undefined;
    const setup = this.db.transaction(() => {
      let heroId = text(value.heroId, 120, '');
      if (value.quickHero) {
        const input = record(value.quickHero);
        created = quickHero(text(input.name, 100), text(input.classId, 80));
        heroId = created.id;
        this.actions.write(campaign, 'sheets', heroId, created);
      }
      if (heroId && !this.actions.read(campaign, 'sheets', heroId)) throw new Error('Invalid hero');
      const next: AiSetup = { premise: text(value.premise, 3000, ''), tone: text(value.tone, 300, 'Adventurous mystery'), heroId };
      this.db.prepare("INSERT INTO campaign_ai(campaign_id,owner_id,enabled,setup,memory,updated,context_budget) VALUES (?,?,1,?,'',?,?) ON CONFLICT(campaign_id) DO UPDATE SET owner_id=excluded.owner_id,enabled=1,setup=excluded.setup,context_budget=excluded.context_budget,updated=excluded.updated")
        .run(campaign, user, JSON.stringify(next), new Date().toISOString(), budget);
      if (!this.chats.defaultId(campaign)) this.chats.create(campaign);
      return next;
    })();
    if (created) this.publish(campaign, 'sheets', created.id, created);
    return setup;
  }

  pause(user: string, campaign: string, enabled: boolean) {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    if (!enabled) this.cancel(user, campaign);
    this.db.prepare('UPDATE campaign_ai SET enabled = ?, updated = ? WHERE campaign_id = ?').run(enabled ? 1 : 0, new Date().toISOString(), campaign);
  }

  memory(user: string, campaign: string, value: unknown) {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    if (this.running.has(campaign)) throw new AiConflict('Stop the current GM turn before editing memory.');
    const memory = typeof value === 'string' ? value.trim() : '';
    if (typeof value !== 'string' || memory.length > SECRETS_LIMIT) throw new Error('Invalid memory: at most 4000 characters.');
    this.db.prepare('UPDATE campaign_ai SET memory = ?, updated = ? WHERE campaign_id = ?').run(memory, new Date().toISOString(), campaign);
  }

  cancel(user: string, campaign: string) {
    const role = this.authorize(user, campaign);
    const running = this.running.get(campaign);
    const row = this.db.prepare("SELECT id, user_id FROM ai_turns WHERE campaign_id = ? AND status = 'running'").get(campaign) as { id: string; user_id: string } | undefined;
    if (row && role !== 'gm' && row.user_id !== user) throw new Error('Forbidden');
    if (row) this.db.prepare("UPDATE ai_turns SET status = 'cancelled', error = '', updated = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    running?.controller.abort();
  }

  private assertIdle(campaign: string, message: string) {
    if (this.running.has(campaign) || this.db.prepare("SELECT id FROM ai_turns WHERE campaign_id = ? AND status = 'running'").get(campaign)) throw new AiConflict(message);
  }

  private requireChat(campaign: string, chat: string): ChatRow {
    const row = this.chats.row(campaign, chat);
    if (!row) throw new Error('Invalid session');
    return row;
  }

  private chatFor(campaign: string, chat: string | null): string {
    if (chat) return this.requireChat(campaign, chat).id;
    return this.chats.defaultId(campaign) ?? this.chats.create(campaign);
  }

  /** Creates an empty session. Nothing runs until someone presses Begin. */
  createChat(user: string, campaign: string, raw: unknown) {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    const input = raw && typeof raw === 'object' ? record(raw) : {};
    const title = text(input.title, 120, '');
    this.assertIdle(campaign, 'Wait for the GM turn to finish before starting a session.');
    const chat = this.db.transaction(() => this.chats.create(campaign, title || undefined))();
    return { chat: this.chats.view(campaign, chat)! };
  }

  /**
   * Opens an empty session. When the journal has entries, the GM recaps them and no player message is stored.
   * Otherwise the Begin message opens the scene. Any member can begin an open session that has no messages yet.
   */
  begin(user: string, campaign: string, raw: unknown) {
    this.authorize(user, campaign);
    const chat = this.requireChat(campaign, text(record(raw).chatId, 120));
    if (chat.status === 'ended') throw new Error('Invalid action: this session has ended. Start a new session to keep playing.');
    if (this.db.prepare('SELECT 1 FROM ai_messages WHERE chat_id = ? LIMIT 1').get(chat.id)) throw new Error('Invalid action: this session has already begun. Send a message to continue.');
    const recap = this.journal.hasEntries(campaign);
    return this.enqueue(user, campaign, chat.id, 'turn', (recap ? 'open:' : 'begin:') + randomUUID(), recap ? null : BEGIN_MESSAGE);
  }

  renameChat(user: string, campaign: string, chat: string, raw: unknown) {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    this.requireChat(campaign, chat);
    const title = text(record(raw).title, 120);
    if (!title) throw new Error('Invalid title');
    this.db.transaction(() => {
      this.chats.rename(campaign, chat, title);
      this.journal.relabel(chat, title);
    })();
    return { chat: this.chats.view(campaign, chat)! };
  }

  deleteChat(user: string, campaign: string, chat: string) {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    this.requireChat(campaign, chat);
    this.assertIdle(campaign, 'Wait for the GM turn to finish before deleting this session.');
    this.db.transaction(() => this.chats.remove(campaign, chat))();
    return { removed: true };
  }

  compactChat(user: string, campaign: string, raw: unknown) {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    const chat = this.requireChat(campaign, text(record(raw).chatId, 120));
    if (chat.status === 'ended') throw new Error('Invalid action: this session has ended');
    return { turn: this.enqueue(user, campaign, chat.id, 'compact', 'compact:' + randomUUID(), null) };
  }

  endChat(user: string, campaign: string, raw: unknown) {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    const chat = this.requireChat(campaign, text(record(raw).chatId, 120));
    if (chat.status === 'ended') throw new Error('Invalid action: this session has already ended');
    return { turn: this.enqueue(user, campaign, chat.id, 'end', 'end:' + randomUUID(), null) };
  }

  start(user: string, campaign: string, raw: unknown) {
    this.authorize(user, campaign);
    const input = record(raw);
    const requestId = text(input.requestId, 100);
    if (!/^[\w:-]{1,100}$/.test(requestId) || /^(open|begin|compact|end|resolve):/.test(requestId)) throw new Error('Invalid request ID');
    const body = text(input.message, 4000);
    if (!body) throw new Error('Invalid message');
    const chat = this.chatFor(campaign, text(input.chatId, 120, '') || null);
    return this.enqueue(user, campaign, chat, 'turn', requestId, body);
  }

  private enqueue(user: string, campaign: string, chat: string, kind: AiTurnKind, requestId: string, message: string | null): { id: string; status: string } {
    const settings = this.settings(campaign);
    if (!settings || !settings.enabled || !this.credential(settings.owner_id)) throw new Error('Invalid connection: the GM is paused or not connected');
    this.campaigns.requireGm(settings.owner_id, campaign);
    const previous = this.db.prepare('SELECT id, status FROM ai_turns WHERE campaign_id = ? AND request_id = ?').get(campaign, requestId) as { id: string; status: string } | undefined;
    if (previous) return previous;
    if (this.requireChat(campaign, chat).status === 'ended') throw new Error('Invalid action: this session has ended. Start a new session to keep playing.');
    this.assertIdle(campaign, 'The GM is already taking a turn.');
    const id = randomUUID();
    const at = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO ai_turns(id,campaign_id,user_id,chat_id,kind,request_id,status,prompt_version,created,updated) VALUES (?,?,?,?,?,?,'running',?,?,?)").run(id, campaign, user, chat, kind, requestId, GM_PROMPT_VERSION, at, at);
      if (message !== null) this.actions.message(campaign, chat, id, 'player', message);
    })();
    this.launch(id, campaign);
    return { id, status: 'running' };
  }

  retry(user: string, campaign: string, id: string) {
    const role = this.authorize(user, campaign);
    const last = this.db.prepare('SELECT * FROM ai_turns WHERE campaign_id = ? ORDER BY rowid DESC LIMIT 1').get(campaign) as TurnRow | undefined;
    if (!last || last.id !== id || last.status !== 'failed' || (role !== 'gm' && last.user_id !== user)) throw new Error('Invalid retry');
    if (last.steps >= TURN_STEPS) throw new Error('Invalid retry: this turn reached its request limit. Send a new message to continue.');
    if (this.running.has(campaign)) throw new AiConflict('The GM is still finishing a turn.');
    const settings = this.settings(campaign);
    if (!settings?.enabled) throw new Error('Invalid action: resume the GM first');
    this.db.prepare("UPDATE ai_turns SET status = 'running', error = '', updated = ? WHERE id = ?").run(new Date().toISOString(), id);
    this.launch(id, campaign);
    return { id, status: 'running' };
  }

  private launch(turn: string, campaign: string) {
    const controller = new AbortController();
    this.running.set(campaign, { turn, controller });
    const timeout = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
    const job = this.run(turn, campaign, controller.signal).catch(error => {
      const current = this.db.prepare('SELECT status FROM ai_turns WHERE id = ?').get(turn) as { status: string } | undefined;
      if (current?.status === 'running') {
        const message = controller.signal.aborted
          ? 'The GM turn timed out. Retry to continue from its saved checkpoint.'
          : error instanceof ProviderError ? error.message : 'The GM could not finish this turn. Committed game actions are saved; retry to continue.';
        this.db.prepare("UPDATE ai_turns SET status = 'failed', error = ?, updated = ? WHERE id = ?").run(message, new Date().toISOString(), turn);
      }
    }).finally(() => {
      clearTimeout(timeout);
      if (this.running.get(campaign)?.turn === turn) this.running.delete(campaign);
    });
    const running = this.running.get(campaign);
    if (running?.turn === turn) running.job = job;
  }

  private async run(id: string, campaign: string, signal: AbortSignal) {
    const row = this.db.prepare('SELECT * FROM ai_turns WHERE id = ?').get(id) as TurnRow | undefined;
    const settings = this.settings(campaign);
    if (!row || !settings || !row.chat_id) throw new Error('AI turn stopped');
    const owner = settings.owner_id;
    const credential = this.credential(owner);
    if (!credential) throw new ProviderError('The provider key was removed. Add it in GM connection.');
    const assertActive = () => {
      signal.throwIfAborted();
      const state = this.db.prepare('SELECT status FROM ai_turns WHERE id = ?').get(id) as { status: string } | undefined;
      if (state?.status !== 'running' || !this.settings(campaign)?.enabled || this.campaigns.configuration(campaign).gmController !== 'ai') throw new Error('AI turn stopped');
      this.campaigns.requireGm(owner, campaign);
    };
    const rt: Runtime = {
      campaign, owner, turn: id, chat: row.chat_id, provider: credential.provider, model: credential.model,
      key: this.vault.open(credential.encrypted_key, owner), temperature: credential.temperature === 1, signal, assertActive,
    };
    if (row.kind === 'turn') return this.takeTurn(rt, row, settings, credential);
    return this.housekeeping(rt, settings, budgetTokens(budgetOf(settings), credential.context_window), row.kind);
  }

  /** Compact now, or end a session. Neither counts toward the turn's model-response limit. */
  private async housekeeping(rt: Runtime, settings: Settings, tokens: number, kind: AiTurnKind) {
    const usage = this.assemble(rt.campaign, settings, rt.chat, tokens);
    await this.compact(rt, kind === 'end' ? 'final' : 'manual', usage.messageBudget);
    const at = new Date().toISOString();
    this.db.transaction(() => {
      rt.assertActive();
      if (kind === 'end') {
        this.db.prepare("UPDATE ai_messages SET interaction = json_set(interaction, '$.resolved', json('true')) WHERE chat_id = ? AND interaction IS NOT NULL AND json_extract(interaction, '$.kind') IN ('roll', 'choices') AND json_extract(interaction, '$.resolved') = 0").run(rt.chat);
        this.chats.end(rt.campaign, rt.chat, at);
        this.actions.message(rt.campaign, rt.chat, rt.turn, 'notice', ENDED_NOTICE);
      }
      this.db.prepare("UPDATE ai_turns SET status = 'complete', error = '', checkpoint = '[]', updated = ? WHERE id = ?").run(at, rt.turn);
    })();
  }

  private async prepare(rt: Runtime, settings: Settings, tokens: number, instruction: string | null): Promise<ModelMessage[]> {
    const first = this.assemble(rt.campaign, settings, rt.chat, tokens);
    await this.compact(rt, 'auto', first.messageBudget);
    const current = this.settings(rt.campaign) ?? settings;
    const conversation = this.assemble(rt.campaign, current, rt.chat, tokens).history;
    if (instruction) conversation.push({ role: 'user', content: instruction });
    return conversation;
  }

  private async takeTurn(rt: Runtime, row: TurnRow, settings: Settings, credential: Credential) {
    const tokens = budgetTokens(budgetOf(settings), credential.context_window);
    let conversation = (JSON.parse(row.checkpoint || '[]') as ModelMessage[]).filter(message => message.role !== 'system');
    const save = () => this.db.prepare('UPDATE ai_turns SET checkpoint = ?, updated = ? WHERE id = ?').run(JSON.stringify(conversation), new Date().toISOString(), rt.turn);
    if (!conversation.length) {
      // The request ID marks an opening recap, so its instruction survives a restart before the first checkpoint.
      conversation = await this.prepare(rt, settings, tokens, row.request_id.startsWith('open:') ? OPENING_INSTRUCTION : null);
      save();
    }
    const tools = GM_TOOLS.filter(tool => tool.name !== 'solo_oracle' || this.campaigns.configuration(rt.campaign).rulesetId === 'solo');
    const context = { campaign: rt.campaign, owner: rt.owner, turn: rt.turn, chat: rt.chat, assertActive: rt.assertActive, publish: this.publish, publishRoll: this.publishRoll };
    for (;;) {
      rt.assertActive();
      for (const call of unanswered(conversation)) {
        rt.assertActive();
        const used = (this.db.prepare('SELECT COUNT(*) AS n FROM ai_actions WHERE turn_id = ?').get(rt.turn) as { n: number }).n;
        if (used >= TURN_ACTIONS) throw new ProviderError('This turn reached its game-action limit. Send a new message to continue.');
        let result: unknown;
        try {
          result = this.actions.execute(call.function.name, JSON.parse(call.function.arguments), { ...context, callId: call.id });
        } catch (error) {
          rt.assertActive();
          result = { error: error instanceof Error && /^(Invalid|Forbidden)/.test(error.message) ? error.message : 'Tool could not be completed. Read the current context and use a legal action.' };
        }
        conversation.push({ role: 'tool', tool_call_id: call.id, content: fitJson(result, TOOL_RESULT_CHARS) });
        save();
      }
      const steps = (this.db.prepare('SELECT steps FROM ai_turns WHERE id = ?').get(rt.turn) as { steps: number }).steps;
      if (steps >= TURN_STEPS) throw new ProviderError('The GM reached this turn’s request limit. Send a new message to continue; completed actions are saved.');
      const request = [...this.systemMessages(rt.campaign, rt.chat), ...conversation, this.snapshotMessage(rt)];
      const response = await this.provider.complete(rt.provider, rt.key, rt.model, request, tools, rt.signal, rt.chat, rt.temperature ? { temperature: 0.85 } : {});
      rt.assertActive();
      this.db.prepare('UPDATE ai_turns SET steps = steps + 1, cost = cost + ?, updated = ? WHERE id = ?').run(response.cost, new Date().toISOString(), rt.turn);
      if (response.message.tool_calls?.length) {
        conversation.push(response.message);
        save();
        continue;
      }
      const narration = response.message.content?.trim();
      if (!narration) throw new ProviderError('The model returned no narration. Choose another model or retry.');
      const at = new Date().toISOString();
      this.db.transaction(() => {
        rt.assertActive();
        this.actions.message(rt.campaign, rt.chat, rt.turn, 'gm', narration.slice(0, 18000));
        this.db.prepare("UPDATE ai_turns SET status = 'complete', error = '', checkpoint = '[]', updated = ? WHERE id = ?").run(at, rt.turn);
      })();
      return;
    }
  }

  /**
   * Summarizes the older unsummarized messages of a session. "auto" runs only past the trigger,
   * "manual" ignores the trigger, and "final" summarizes everything before a session ends. A large
   * backlog takes several rounds of at most COMPACT_BATCH_TOKENS each, with one chapter per round,
   * until only the newest messages that fit the tail remain unsummarized.
   */
  private async compact(rt: Runtime, mode: 'auto' | 'manual' | 'final', messageBudget: number) {
    const initial = this.pending(rt.chat);
    if (!initial.length) return;
    const total = initial.reduce((sum, item) => sum + item.tokens, 0);
    if (mode === 'auto' && total <= messageBudget * COMPACT_TRIGGER) return;
    for (let round = 0; ; round++) {
      const pending = round === 0 ? initial : this.pending(rt.chat);
      if (!pending.length) return;
      const cut = mode === 'final' ? pending.length : tailStart(pending, messageBudget * COMPACT_TAIL);
      if (cut <= 0) return;
      const batch = batchOf(pending.slice(0, cut), COMPACT_BATCH_TOKENS);
      await this.summarize(rt, batch, { final: mode === 'final' && batch.length === pending.length, notice: round === 0 && mode !== 'final' });
    }
  }

  /** One summarizer request over a batch of the oldest messages. It writes one chapter and advances the session summary. */
  private async summarize(rt: Runtime, batch: Pending[], options: { final: boolean; notice: boolean }) {
    const through = batch[batch.length - 1]!.seq;
    const chat = this.requireChat(rt.campaign, rt.chat);
    const digest = this.settings(rt.campaign)?.digest ?? '';
    let summary: Summary | null = null;
    let cost = 0;
    for (let attempt = 0; attempt < 2 && !summary; attempt++) {
      const response = await this.provider.complete(rt.provider, rt.key, rt.model, [
        { role: 'system', content: COMPACTION_PROMPT },
        { role: 'user', content: compactionInput(chat.summary, digest, batch, attempt > 0) },
      ], [], rt.signal, rt.chat, rt.temperature ? { maxTokens: SUMMARY_MAX_TOKENS, temperature: 0.2 } : { maxTokens: SUMMARY_MAX_TOKENS });
      rt.assertActive();
      cost += response.cost;
      summary = parseSummary(response.message.content);
    }
    const at = new Date().toISOString();
    this.db.transaction(() => {
      rt.assertActive();
      if (summary) {
        this.journal.chapter(rt.campaign, rt.chat, rt.turn, summary.chapter, options.final);
        this.chats.setSummary(rt.chat, summary.working, through, at);
        this.db.prepare('UPDATE campaign_ai SET digest = ?, updated = ? WHERE campaign_id = ?').run(summary.digest, at, rt.campaign);
      } else {
        this.journal.chapter(rt.campaign, rt.chat, rt.turn, this.fallbackChapter(rt, batch), options.final);
        this.chats.setSummary(rt.chat, chat.summary, through, at);
      }
      if (options.notice) this.actions.message(rt.campaign, rt.chat, rt.turn, 'notice', SUMMARIZED_NOTICE);
      this.db.prepare('UPDATE ai_turns SET cost = cost + ?, updated = ? WHERE id = ?').run(cost, at, rt.turn);
    })();
  }

  /** Used when the model fails to return valid JSON twice. Only shared events and GM narration are used. */
  private fallbackChapter(rt: Runtime, batch: Pending[]): string {
    const from = batch[0]!.created;
    const to = batch[batch.length - 1]!.created;
    const events = this.db.prepare("SELECT title FROM ai_journal WHERE campaign_id = ? AND chat_id = ? AND kind = 'event' AND visibility = 'shared' AND created >= ? AND created <= ? ORDER BY rowid LIMIT 12").all(rt.campaign, rt.chat, from, to) as { title: string }[];
    const narration = batch.filter(item => item.role === 'gm').slice(0, 12).map(item => firstSentence(item.text));
    const body = [...events.map(item => item.title + '.'), ...narration].join(' ');
    return clip(body || 'The session continued.', 1200);
  }

  private pending(chat: string): Pending[] {
    const rows = this.db.prepare("SELECT m.rowid AS seq, m.role, m.text, m.created FROM ai_messages m JOIN ai_chats c ON c.id = m.chat_id WHERE m.chat_id = ? AND m.rowid > c.summarized_through AND m.role IN ('player', 'gm', 'roll') ORDER BY m.rowid").all(chat) as { seq: number; role: string; text: string; created: string }[];
    return rows.map(row => ({ ...row, tokens: estimateTokens(clip(row.text, MESSAGE_CHARS)) }));
  }

  /** Memory parts in prompt order. They are rebuilt for every request, so edits take effect at once. */
  private blocks(campaign: string, settings: Settings, chat: string | null): MemoryPart[] {
    const limits = limitsFor(budgetOf(settings));
    const config = this.campaigns.configuration(campaign);
    const setup = setupOf(settings);
    const hero = setup.heroId ? this.actions.read<Sheet>(campaign, 'sheets', setup.heroId) : undefined;
    const parts: MemoryPart[] = [{
      kind: 'setup',
      text: [
        'Campaign setup',
        'System: ' + (getRuleset(config)?.name ?? config.rulesetId),
        'Premise: ' + (clip(setup.premise, 1500) || 'not written yet'),
        'Tone: ' + setup.tone,
        'Player hero: ' + (hero ? hero.name : 'not chosen'),
      ].join(NL),
    }];
    const preparation = this.preparations(campaign, limits.prepChars);
    if (preparation) parts.push({ kind: 'preparation', text: preparation });
    if (settings.digest) parts.push({ kind: 'digest', text: 'Campaign digest (rolling memory of the whole campaign):' + NL + clip(settings.digest, 1800) });
    for (const chapter of this.journal.recentChapters(campaign, limits.chapters)) parts.push({ kind: 'chapter', text: 'Chapter the players have already read: ' + chapter.title + NL + clip(chapter.body, 1300) });
    if (settings.memory) parts.push({ kind: 'secrets', text: 'GM-only secrets and plans (never reveal these):' + NL + clip(settings.memory, SECRETS_LIMIT) });
    const state = this.actions.readState(campaign);
    if (JSON.stringify(state) !== JSON.stringify(emptyState())) parts.push({ kind: 'state', text: 'Campaign state (GM only; authoritative, change it with update_state):' + NL + renderState(state, limits.stateChars) });
    const summary = chat ? (this.chats.row(campaign, chat)?.summary ?? '') : '';
    if (summary) parts.push({ kind: 'summary', text: 'Summary of this session so far:' + NL + clip(summary, 2000) });
    return parts;
  }

  /** GM preparations: the setting and the two newest scenarios, shortened to the room the memory size leaves for them. */
  private preparations(campaign: string, room: number): string {
    const docs = this.actions.docs(campaign, 'gm').filter(doc => doc.value.kind === 'setting' || doc.value.kind === 'scenario');
    const setting = docs.find(doc => doc.value.kind === 'setting');
    const scenarios = docs.filter(doc => doc.value.kind === 'scenario').slice(0, 2);
    const lines: string[] = [];
    if (setting) lines.push('Setting: ' + clip(String(setting.value.title ?? 'Untitled'), 200), ...fieldLines(setting.value.fields, SETTING_FIELDS));
    for (const scenario of scenarios) lines.push('Scenario: ' + clip(String(scenario.value.title ?? 'Untitled'), 200), ...fieldLines(scenario.value.fields, SCENARIO_FIELDS));
    if (!lines.length) return '';
    return shorten(['GM preparations (GM only):', ...lines].join(NL), room, '(preparations shortened to fit the memory limit)');
  }

  /** The memory parts after the cap is applied, ready to send as system messages. */
  private memoryParts(campaign: string, settings: Settings, chat: string | null): MemoryPart[] {
    return fitMemory(this.blocks(campaign, settings, chat), limitsFor(budgetOf(settings)).memoryChars);
  }

  private systemMessages(campaign: string, chat: string | null): ModelMessage[] {
    const settings = this.settings(campaign);
    if (!settings) throw new Error('AI turn stopped');
    return [{ role: 'system', content: GM_PROMPT }, ...this.memoryParts(campaign, settings, chat).map(part => ({ role: 'system' as const, content: part.text }))];
  }

  /** Memory plus the recent messages that fit. Messages get whatever budget the memory leaves. */
  private assemble(campaign: string, settings: Settings, chat: string | null, tokens: number) {
    const parts = this.memoryParts(campaign, settings, chat);
    const memoryTokens = parts.reduce((sum, part) => sum + estimateTokens(part.text), 0);
    const messageBudget = Math.max(1000, tokens - memoryTokens);
    const pending = chat ? this.pending(chat) : [];
    const history: ModelMessage[] = [];
    let historyTokens = 0;
    for (let index = pending.length - 1; index >= 0; index--) {
      const item = pending[index]!;
      if (history.length > 0 && historyTokens + item.tokens > messageBudget) break;
      history.unshift({ role: item.role === 'gm' ? 'assistant' : 'user', content: clip(item.text, MESSAGE_CHARS) });
      historyTokens += item.tokens;
    }
    return { memoryTokens, messageBudget, history, historyTokens };
  }


  private snapshotMessage(rt: Runtime): ModelMessage {
    const full = this.actions.snapshot(rt.campaign, rt.owner);
    const snapshot = Object.fromEntries(Object.entries(full).filter(([key]) => key !== 'state'));
    return { role: 'system', content: snapshotText(snapshot) };
  }

  async close() {
    const jobs = [...this.running.values()];
    for (const running of jobs) running.controller.abort();
    await Promise.allSettled(jobs.map(running => running.job));
  }

  resolve(user: string, campaign: string, messageId: string, raw: unknown) {
    this.authorize(user, campaign);
    if (this.running.has(campaign) || this.db.prepare("SELECT id FROM ai_turns WHERE campaign_id = ? AND status = 'running'").get(campaign)) throw new AiConflict('Wait for the GM to finish before resolving this card.');
    const settings = this.settings(campaign);
    if (!settings || !settings.enabled || !this.credential(settings.owner_id)) throw new Error('Invalid action: connect and resume the GM first');
    const input = record(raw);
    const changes: { ns: string; id: string; value: unknown }[] = [];
    const dice: { kind: string; result: unknown }[] = [];
    let resultText = '';
    let chatId = '';
    let eventTitle = '';
    let eventHidden = false;
    const changed = this.db.transaction(() => {
      const row = this.db.prepare('SELECT interaction, chat_id FROM ai_messages WHERE id = ? AND campaign_id = ?').get(messageId, campaign) as { interaction: string | null; chat_id: string | null } | undefined;
      if (!row?.interaction) throw new Error('Invalid action card');
      const interaction = JSON.parse(row.interaction) as AiInteraction;
      if (!row.chat_id || this.requireChat(campaign, row.chat_id).status === 'ended') throw new Error('Invalid action: this session has ended, so its cards are read only');
      if (interaction.resolved) return false;
      chatId = row.chat_id;
      const put = (ns: string, id: string, value: unknown) => {
        this.actions.write(campaign, ns, id, value);
        changes.push({ ns, id, value });
      };
      if (interaction.kind === 'choices') {
        const choice = text(input.choice, 300);
        if (!interaction.choices?.includes(choice)) throw new Error('Invalid choice');
        resultText = choice;
        eventTitle = 'Choice · ' + clip(choice, 120);
      } else {
        let sheet = this.actions.read<Sheet>(campaign, 'sheets', interaction.heroId!);
        if (!sheet) throw new Error('Invalid hero');
        if (interaction.kind === 'roll') {
          let modifier = sheet.traits[interaction.trait as TraitName];
          const weapon = interaction.enemyId ? weaponForSlot(sheet, 'primary') : undefined;
          if (interaction.enemyId && !weapon) throw new Error('Invalid attack: equip a primary weapon in Characters');
          if (weapon) modifier = weaponModifier(sheet, weapon);
          const experienceId = text(input.experienceId, 120, '');
          if (experienceId) {
            const experience = sheet.experiences.find(entry => entry.id === experienceId);
            if (!experience || sheet.hope < 1) throw new Error('Invalid Experience or insufficient Hope');
            modifier += experience.modifier;
            sheet = { ...sheet, hope: sheet.hope - 1 };
          }
          const advantage = text(input.advantage, 30, 'normal');
          if (!['normal', 'advantage', 'disadvantage'].includes(advantage)) throw new Error('Invalid advantage');
          let applied = advantage === 'normal' ? undefined : advantage as 'advantage' | 'disadvantage';
          const solo = this.actions.read<SoloState>(campaign, 'solo', 'state');
          if (this.campaigns.configuration(campaign).options.partyMode === 'companion' && solo?.beat.assistedHeroId === sheet.id && !solo.beat.assistConsumed) {
            solo.beat.assistConsumed = true;
            solo.revision++;
            put('solo', 'state', solo);
            applied = applied === 'disadvantage' ? undefined : 'advantage';
          }
          const rolled = roll({ modifier, advantage: applied });
          const success = rolled.critical || rolled.total >= interaction.difficulty!;
          sheet = applyDualityEffects(sheet, rolled).sheet;
          dice.push({ kind: 'duality', result: rolled });
          if (rolled.withFear) {
            const fear = this.actions.read<{ value: number }>(campaign, 'combat', 'fear') ?? { value: 0 };
            put('combat', 'fear', { kind: 'fear', value: Math.min(12, fear.value + 1) });
          }
          const advantageNote = rolled.advantageDie ? ', ' + String(rolled.advantage) + ' d6 ' + String(rolled.advantageDie) : '';
          const outcome = rolled.critical ? 'Critical success' : (success ? 'Success' : 'Failure') + ' with ' + (rolled.withFear ? 'Fear' : 'Hope');
          resultText = sheet.name + ': Hope ' + String(rolled.hope) + ', Fear ' + String(rolled.fear) + advantageNote + ', modifier ' + String(modifier) + ': ' + String(rolled.total) + ' vs ' + String(interaction.difficulty) + ' — ' + outcome + '.';
          eventTitle = 'Roll · ' + sheet.name + ' · ' + (rolled.critical ? 'critical success' : success ? 'success' : 'failure');
          eventHidden = !!interaction.enemyId && this.actions.isHiddenCombat(campaign, interaction.enemyId);
          if (success && weapon && interaction.enemyId) {
            const enemy = this.actions.read<Record<string, any>>(campaign, 'combat', interaction.enemyId);
            const source = adversaries.find(entry => entry.id === enemy?.catalogId);
            if (!enemy || !source) throw new Error('Invalid attack target');
            const notation = damageNotation(weapon.damage, sheet.proficiency);
            const damage = rollDice(notation);
            const total = damage.total + (rolled.critical ? maxDiceTotal(notation) : 0);
            dice.push({ kind: 'dice', result: damage });
            if (source.type === 'Minion') {
              const match = source.features.find(feature => /^Minion \(/.test(feature.name))?.name.match(/\((\d+)\)/);
              enemy.defeated = Math.min(enemy.groupSize ?? 1, enemy.defeated + (total > 0 ? 1 + Math.floor(total / Number(match?.[1] ?? Infinity)) : 0));
            } else {
              const thresholds = source.thresholds;
              const marks = total <= 0 ? 0 : thresholds ? (thresholds.severe !== null && total >= thresholds.severe ? 3 : total >= thresholds.major ? 2 : 1) : 1;
              enemy.hpMarked = Math.min(source.hp, enemy.hpMarked + marks);
            }
            put('combat', interaction.enemyId, enemy);
            resultText += ' ' + weapon.name + ' deals ' + String(total) + ' damage to ' + String(enemy.name) + '; marked HP ' + String(enemy.hpMarked) + '/' + String(source.hp) + '.';
          }
        } else if (interaction.kind === 'damage') {
          const armor = input.useArmor === true && !interaction.direct && sheet.armorSlotsMarked < armorScore(sheet);
          const severity = damageSeverity(interaction.damage ?? 0, damageThresholds(sheet));
          const marks = damageHp(severity, armor);
          sheet = { ...sheet, hpMarked: Math.min(hpMax(sheet), sheet.hpMarked + marks), armorSlotsMarked: sheet.armorSlotsMarked + (armor && marks < damageHp(severity, false) ? 1 : 0) };
          resultText = sheet.name + ' takes ' + String(interaction.damage) + ' damage: ' + String(marks) + ' HP marked' + (armor ? ', using Armor' : '') + '. HP marked ' + String(sheet.hpMarked) + '/' + String(hpMax(sheet)) + '.' + (sheet.hpMarked >= hpMax(sheet) ? ' A death move is required; the player chooses it.' : '');
          eventTitle = 'Damage · ' + sheet.name + ' takes ' + String(interaction.damage) + ' (' + String(marks) + ' HP)';
        }
        put('sheets', sheet.id, { ...sheet, updatedAt: new Date().toISOString() });
      }
      interaction.resolved = true;
      this.db.prepare('UPDATE ai_messages SET interaction = ? WHERE id = ?').run(JSON.stringify(interaction), messageId);
      this.actions.message(campaign, chatId, null, interaction.kind === 'choices' ? 'player' : 'roll', resultText);
      this.journal.event(campaign, chatId, null, eventTitle, interaction.kind === 'choices' ? '' : resultText, eventHidden ? 'gm' : 'shared');
      return true;
    })();
    for (const doc of changes) this.publish(campaign, doc.ns, doc.id, doc.value);
    const actor = (this.db.prepare('SELECT username FROM users WHERE id = ?').get(user) as { username: string }).username;
    for (const entry of dice) this.publishRoll(campaign, entry.kind, entry.result, actor);
    if (changed) return this.enqueue(user, campaign, chatId, 'turn', 'resolve:' + messageId, null);
    return { resolved: true };
  }

  journalPage(user: string, campaign: string, query: Record<string, unknown>): AiJournalPage {
    const role = this.authorize(user, campaign);
    const kind = text(query.kind, 10, 'all');
    if (['all', 'note', 'chapter', 'event'].indexOf(kind) < 0) throw new Error('Invalid journal filter');
    const cursor = typeof query.cursor === 'string' && /^[0-9]+$/.test(query.cursor) ? query.cursor : null;
    return this.journal.list(campaign, role === 'gm', { cursor, kind, query: text(query.q, 200, '') });
  }

  addJournal(user: string, campaign: string, raw: unknown): AiJournalEntry {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    const input = record(raw);
    const title = text(input.title, 160);
    const body = text(input.body, 6000);
    if (!title || !body) throw new Error('Invalid journal entry: a title and body are required');
    const id = this.journal.insert(campaign, { chat: this.chats.defaultId(campaign), turn: null, kind: 'note', title, body, visibility: input.shared === true ? 'shared' : 'gm', author: 'owner' });
    return this.journal.view(campaign, id, true)!;
  }

  editJournal(user: string, campaign: string, id: string, raw: unknown): AiJournalEntry {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    const row = this.journal.get(campaign, id);
    if (!row) throw new Error('Invalid journal entry');
    if (row.kind === 'event') throw new Error('Invalid action: journal events are read only');
    const input = record(raw);
    const patch: { title?: string; body?: string; visibility?: 'shared' | 'gm' } = {};
    if (input.title !== undefined) {
      const title = text(input.title, 160);
      if (!title) throw new Error('Invalid journal entry: a title is required');
      patch.title = title;
    }
    if (input.body !== undefined) {
      const body = text(input.body, 6000);
      if (!body) throw new Error('Invalid journal entry: a body is required');
      patch.body = body;
    }
    if (input.shared !== undefined) {
      if (typeof input.shared !== 'boolean') throw new Error('Invalid visibility');
      patch.visibility = input.shared ? 'shared' : 'gm';
    }
    this.journal.update(campaign, id, patch);
    return this.journal.view(campaign, id, true)!;
  }

  deleteJournal(user: string, campaign: string, id: string) {
    this.authorize(user, campaign);
    this.campaigns.requireGm(user, campaign);
    const row = this.journal.get(campaign, id);
    if (!row) throw new Error('Invalid journal entry');
    if (row.kind === 'event') throw new Error('Invalid action: journal events are read only');
    this.journal.remove(campaign, id);
    return { removed: true };
  }
}
