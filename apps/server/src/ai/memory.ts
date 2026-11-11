import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { adversaries } from '@daggery/content';
import { AI_BUDGET_TOKENS, type AiBudget, type AiInteraction, type AiNpc, type AiState, type AiThread } from '@daggery/shared';
import { armorScore, hpMax, stressMax, weaponForSlot } from '@daggery/shared/daggerheart';

const NL = String.fromCharCode(10);
export const COMPACT_TRIGGER = 0.6;
export const COMPACT_TAIL = 0.3;
export const MESSAGE_CHARS = 4000;
export const STATE_LIMITS = { threads: 12, npcs: 30, promises: 10, facts: 20 };
/** All memory parts together stay within this many characters, about 5,000 estimated tokens. */
export const MEMORY_CHARS = 17000;
export const SECRETS_LIMIT = 4000;
export const PREP_CHARS = 2500;
export const STATE_CHARS = 6000;
export const SNAPSHOT_CHARS = 4000;
export const TOOL_RESULT_CHARS = 6000;
/** Maximum may use this share of the model's context window. The rest is left for the reply. */
export const MAXIMUM_CONTEXT_SHARE = 0.6;
/** Maximum budget while the model's context window is unknown. It equals Rich. */
export const MAXIMUM_FALLBACK_TOKENS = 48000;

/**
 * Caps for the memory blocks. Lean keeps its small caps on every model. Balanced, Rich and Maximum
 * grow with the model's context window, so a 1M-token model keeps far more chapters, canon titles
 * and state in view.
 */
export interface MemoryLimits {
  memoryChars: number; chapters: number; prepChars: number; stateChars: number;
  /** Room for the active canon title list in the prompt. */
  canonChars: number;
  /** Room for the proactive recall block. */
  recallChars: number;
  /** Characters returned per search hit by search_journal and canon_search. */
  snippetChars: number;
}
const BASE_LIMITS: MemoryLimits = { memoryChars: MEMORY_CHARS, chapters: 3, prepChars: PREP_CHARS, stateChars: STATE_CHARS, canonChars: 1500, recallChars: 2400, snippetChars: 600 };
const MAXIMUM_LIMITS: MemoryLimits = { memoryChars: 60000, chapters: 12, prepChars: 12000, stateChars: 20000, canonChars: 6000, recallChars: 5000, snippetChars: 1500 };
/** From this context window on, Balanced and Rich get more room than the fixed tiers. */
export const MID_CONTEXT_WINDOW = 80_000;
/** A very large window (DeepSeek V4's 1M) gets the largest memory caps. */
export const LARGE_CONTEXT_WINDOW = 200_000;
const MID_LIMITS: Record<Exclude<AiBudget, 'lean'>, MemoryLimits> = {
  balanced: { memoryChars: 30000, chapters: 6, prepChars: 6000, stateChars: 11000, canonChars: 3500, recallChars: 3200, snippetChars: 1000 },
  rich: { memoryChars: 45000, chapters: 9, prepChars: 9000, stateChars: 16000, canonChars: 5500, recallChars: 4200, snippetChars: 1200 },
  maximum: { memoryChars: 100000, chapters: 18, prepChars: 20000, stateChars: 32000, canonChars: 10000, recallChars: 7000, snippetChars: 1500 },
};
const LARGE_LIMITS: Record<Exclude<AiBudget, 'lean'>, MemoryLimits> = {
  balanced: { memoryChars: 42000, chapters: 9, prepChars: 9000, stateChars: 15000, canonChars: 5000, recallChars: 4000, snippetChars: 1200 },
  rich: { memoryChars: 65000, chapters: 14, prepChars: 14000, stateChars: 22000, canonChars: 8000, recallChars: 6000, snippetChars: 1500 },
  maximum: { memoryChars: 150000, chapters: 30, prepChars: 30000, stateChars: 50000, canonChars: 16000, recallChars: 10000, snippetChars: 1500 },
};

/** Memory caps for one budget and context window. An unknown window (0) keeps the original fixed caps. */
export function limitsFor(budget: AiBudget, contextWindow = 0): MemoryLimits {
  if (budget === 'lean') return { ...BASE_LIMITS };
  if (contextWindow >= LARGE_CONTEXT_WINDOW) return { ...LARGE_LIMITS[budget] };
  if (contextWindow >= MID_CONTEXT_WINDOW) return { ...MID_LIMITS[budget] };
  return { ...(budget === 'maximum' ? MAXIMUM_LIMITS : BASE_LIMITS) };
}

/** Snippet length for journal and canon searches: 600 characters, growing with the context window. */
export function snippetCharsFor(contextWindow: number): number {
  if (contextWindow >= LARGE_CONTEXT_WINDOW) return 1500;
  if (contextWindow >= MID_CONTEXT_WINDOW) return 1000;
  return 600;
}

const THREAD_STATUSES = ['open', 'stalled', 'resolved'];

export interface DocSource {
  read<T = any>(campaign: string, ns: string, id: string): T | undefined;
  docs(campaign: string, ns: string): { id: string; value: any }[];
}

export function estimateTokens(value: string): number { return Math.ceil(value.length / 3.5); }

/** Estimated tokens for memory plus messages. A known context window caps every tier, and Maximum is its share. */
export function budgetTokens(budget: AiBudget, contextWindow: number): number {
  const share = Math.floor(contextWindow * MAXIMUM_CONTEXT_SHARE);
  if (budget === 'maximum') return contextWindow > 0 ? share : MAXIMUM_FALLBACK_TOKENS;
  const base = AI_BUDGET_TOKENS[budget] ?? AI_BUDGET_TOKENS.balanced;
  return contextWindow > 0 ? Math.min(base, share) : base;
}

/** The budget for every memory size, as the setup form shows it. */
export function budgetTable(contextWindow: number): Record<AiBudget, number> {
  return { lean: budgetTokens('lean', contextWindow), balanced: budgetTokens('balanced', contextWindow), rich: budgetTokens('rich', contextWindow), maximum: budgetTokens('maximum', contextWindow) };
}

export function emptyState(): AiState {
  return { location: '', timeOfDay: '', objective: '', threads: [], npcs: [], promises: [], facts: [] };
}

function clip(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function stableId(value: unknown): string { return clip(value, 60) || randomUUID().slice(0, 8); }
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function listOf(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

export function normalizeThread(raw: unknown): AiThread {
  const item = asRecord(raw);
  const status = THREAD_STATUSES.indexOf(String(item.status)) >= 0 ? String(item.status) as AiThread['status'] : 'open';
  return { id: stableId(item.id), title: clip(item.title, 160), status, note: clip(item.note, 160) };
}

export function normalizeNpc(raw: unknown): AiNpc {
  const item = asRecord(raw);
  return { id: stableId(item.id), name: clip(item.name, 80), role: clip(item.role, 80), attitude: clip(item.attitude, 120), lastSeen: clip(item.lastSeen, 80) };
}

function normalizePromise(raw: unknown): { id: string; text: string } {
  const item = asRecord(raw);
  return { id: stableId(item.id), text: clip(item.text, 200) };
}

export function normalizeState(raw: unknown): AiState {
  const value = asRecord(raw);
  return {
    location: clip(value.location, 200),
    timeOfDay: clip(value.timeOfDay, 120),
    objective: clip(value.objective, 300),
    threads: listOf(value.threads).slice(0, STATE_LIMITS.threads).map(normalizeThread).filter(item => item.title !== ''),
    npcs: listOf(value.npcs).slice(0, STATE_LIMITS.npcs).map(normalizeNpc).filter(item => item.name !== ''),
    promises: listOf(value.promises).slice(0, STATE_LIMITS.promises).map(normalizePromise).filter(item => item.text !== ''),
    facts: listOf(value.facts).map(item => clip(item, 240)).filter(item => item !== '').slice(-STATE_LIMITS.facts),
  };
}

function upsert<T extends { id: string }>(list: T[], item: T, max: number, label: string): T[] {
  const index = list.findIndex(existing => existing.id === item.id);
  if (index >= 0) return list.map((existing, position) => position === index ? item : existing);
  if (list.length >= max) throw new Error('Invalid state: at most ' + max + ' ' + label + '; resolve or remove one first');
  return list.concat([item]);
}

export function applyStatePatch(current: AiState, patch: Record<string, unknown>): AiState {
  for (const key of ['threads', 'npcs', 'promises', 'facts', 'removeIds']) {
    if (patch[key] !== undefined && !Array.isArray(patch[key])) throw new Error('Invalid state: ' + key + ' must be a list');
  }
  const next = normalizeState(current);
  if (patch.location !== undefined) next.location = clip(patch.location, 200);
  if (patch.timeOfDay !== undefined) next.timeOfDay = clip(patch.timeOfDay, 120);
  if (patch.objective !== undefined) next.objective = clip(patch.objective, 300);
  if (Array.isArray(patch.removeIds)) {
    const removed = patch.removeIds.map(id => clip(id, 60));
    next.threads = next.threads.filter(item => removed.indexOf(item.id) < 0);
    next.npcs = next.npcs.filter(item => removed.indexOf(item.id) < 0);
    next.promises = next.promises.filter(item => removed.indexOf(item.id) < 0);
  }
  for (const raw of listOf(patch.threads)) {
    const item = normalizeThread(raw);
    if (!item.title) throw new Error('Invalid thread: a title is required');
    next.threads = upsert(next.threads, item, STATE_LIMITS.threads, 'threads');
  }
  for (const raw of listOf(patch.npcs)) {
    const item = normalizeNpc(raw);
    if (!item.name) throw new Error('Invalid NPC: a name is required');
    next.npcs = upsert(next.npcs, item, STATE_LIMITS.npcs, 'NPCs');
  }
  for (const raw of listOf(patch.promises)) {
    const item = normalizePromise(raw);
    if (!item.text) throw new Error('Invalid promise: text is required');
    next.promises = upsert(next.promises, item, STATE_LIMITS.promises, 'promises');
  }
  for (const fact of listOf(patch.facts)) {
    const value = clip(fact, 240);
    if (value && next.facts.indexOf(value) < 0) next.facts.push(value);
  }
  next.facts = next.facts.slice(-STATE_LIMITS.facts);
  return next;
}

export function snapshotFor(db: Database.Database, source: DocSource, campaign: string): Record<string, unknown> {
  const active = source.read<{ sceneId: string }>(campaign, 'map', 'active');
  const scene = active ? source.read<{ id: string; name: string }>(campaign, 'map', 'scene:' + active.sceneId) : undefined;
  const heroes = source.docs(campaign, 'sheets').slice(0, 6).map(doc => {
    const sheet = doc.value;
    return {
      id: doc.id, name: sheet.name, classId: sheet.classId, level: sheet.level,
      hp: sheet.hpMarked + '/' + hpMax(sheet), stress: sheet.stressMarked + '/' + stressMax(sheet),
      hope: sheet.hope, armor: sheet.armorSlotsMarked + '/' + armorScore(sheet),
      weapon: weaponForSlot(sheet, 'primary')?.name ?? null,
    };
  });
  const combat = source.docs(campaign, 'combat');
  const fearValue = combat.find(doc => doc.id === 'fear')?.value.value;
  const holder = combat.find(doc => doc.id === 'spotlight')?.value.holder;
  const spotlight = holder === 'GM' ? 'GM' : typeof holder === 'string' && holder.indexOf('sheet:') === 0 ? holder.slice('sheet:'.length) : null;
  const countdowns = combat.filter(doc => doc.value.kind === 'countdown').slice(0, 8).map(doc => ({
    id: doc.id, name: doc.value.name, remaining: doc.value.value, sides: doc.value.sides, visible: doc.value.visible !== false,
  }));
  const present = combat.filter(doc => doc.value.kind === 'adversary' && (!scene || doc.value.sceneId === scene.id)).slice(0, 12).map(doc => {
    const catalog = adversaries.find(item => item.id === doc.value.catalogId);
    const conditions = Object.keys(doc.value.conditions ?? {}).filter(key => doc.value.conditions[key] === true);
    return { id: doc.id, name: doc.value.name, hpMarked: doc.value.hpMarked, hpMax: catalog?.hp ?? null, defeated: doc.value.defeated ?? 0, groupSize: doc.value.groupSize ?? null, conditions };
  });
  const cards = db.prepare("SELECT id, interaction FROM ai_messages WHERE campaign_id = ? AND interaction IS NOT NULL AND json_extract(interaction, '$.resolved') = 0 ORDER BY rowid DESC LIMIT 5").all(campaign) as { id: string; interaction: string }[];
  return {
    heroes,
    scene: scene ? { id: scene.id, name: scene.name } : null,
    fear: typeof fearValue === 'number' ? fearValue : 0,
    spotlight,
    countdowns,
    adversaries: present,
    pendingCards: cards.map(card => {
      const item = JSON.parse(card.interaction) as AiInteraction;
      return { id: card.id, kind: item.kind, heroId: item.heroId ?? null, trait: item.trait ?? null, difficulty: item.difficulty ?? null, damage: item.damage ?? null, choices: item.choices ?? null };
    }),
  };
}

export interface MemoryPart { kind: 'setup' | 'preparation' | 'canon' | 'recall' | 'digest' | 'chapter' | 'secrets' | 'state' | 'summary' | 'resume'; text: string }

/** Cuts text to at most room characters and ends it with a note. The first lines are kept. */
export function shorten(text: string, room: number, note: string): string {
  if (text.length <= room) return text;
  const keep = room - note.length - NL.length;
  return keep > 0 ? text.slice(0, keep).trimEnd() + NL + note : '';
}

/**
 * Keeps the memory parts within maxChars. Older chapters go first, then the proactive recall block
 * is dropped whole (it is a convenience, not canon), and only then are canon titles, preparations
 * and secrets shortened.
 */
export function fitMemory(parts: MemoryPart[], maxChars: number): MemoryPart[] {
  const kept = parts.map(part => ({ ...part }));
  const total = () => kept.reduce((sum, part) => sum + part.text.length, 0);
  while (total() > maxChars) {
    const oldest = kept.findIndex(part => part.kind === 'chapter');
    if (oldest < 0) break;
    kept.splice(oldest, 1);
  }
  if (total() > maxChars) {
    const recall = kept.findIndex(part => part.kind === 'recall');
    if (recall >= 0) kept.splice(recall, 1);
  }
  const notes = { canon: '(canon titles shortened to fit the memory limit)', preparation: '(preparations shortened to fit the memory limit)', secrets: '(GM secrets shortened to fit the memory limit)' };
  for (const kind of ['canon', 'preparation', 'secrets'] as const) {
    const over = total() - maxChars;
    if (over <= 0) break;
    const part = kept.find(item => item.kind === kind);
    if (part) part.text = shorten(part.text, part.text.length - over, notes[kind]);
  }
  return kept.filter(part => part.text !== '');
}

/** Campaign state as plain text. Item ids stay visible so update_state can merge by id. */
export function renderState(state: AiState, max: number): string {
  const lines: { text: string; item: boolean }[] = [];
  if (state.location) lines.push({ text: 'Location: ' + state.location, item: false });
  if (state.timeOfDay) lines.push({ text: 'Time of day: ' + state.timeOfDay, item: false });
  if (state.objective) lines.push({ text: 'Objective: ' + state.objective, item: false });
  const sections: [string, string[]][] = [
    ['Threads', state.threads.map(item => '[' + item.status + '] ' + item.title + (item.note ? ' - ' + item.note : '') + ' (id ' + item.id + ')')],
    ['NPCs', state.npcs.map(item => item.name + (item.role ? ', ' + item.role : '') + (item.attitude ? '; ' + item.attitude : '') + (item.lastSeen ? '; last seen ' + item.lastSeen : '') + ' (id ' + item.id + ')')],
    ['Player promises', state.promises.map(item => item.text + ' (id ' + item.id + ')')],
    ['Facts', state.facts],
  ];
  for (const [label, items] of sections) {
    if (!items.length) continue;
    lines.push({ text: label + ':', item: false });
    for (const item of items) lines.push({ text: '- ' + item, item: true });
  }
  const render = () => lines.map(line => line.text).join(NL);
  let omitted = 0;
  while (render().length > max - 60) {
    let index = lines.length - 1;
    while (index >= 0 && !lines[index]!.item) index--;
    if (index < 0) break;
    lines.splice(index, 1);
    omitted++;
  }
  return omitted ? render() + NL + '(' + omitted + ' items left out to fit the memory limit)' : render();
}

function longestArray(node: unknown, found: { array: unknown[]; size: number } | null = null): { array: unknown[]; size: number } | null {
  if (Array.isArray(node)) {
    const size = JSON.stringify(node).length;
    if (node.length && (!found || size > found.size)) found = { array: node, size };
    for (const item of node) found = longestArray(item, found);
  } else if (node && typeof node === 'object') {
    for (const item of Object.values(node)) found = longestArray(item, found);
  }
  return found;
}

/** Always returns parseable JSON. When too long, the last item of the largest list is dropped until it fits, and the object is marked truncated. */
export function fitJson(value: unknown, max: number): string {
  const copy = JSON.parse(JSON.stringify(value ?? null)) as unknown;
  const isObject = copy !== null && typeof copy === 'object' && !Array.isArray(copy);
  let trimmed = false;
  for (;;) {
    const json = JSON.stringify(trimmed && isObject ? { ...(copy as Record<string, unknown>), truncated: true } : copy);
    if (json.length <= max) return json;
    const found = longestArray(copy);
    if (!found) return isObject ? '{"truncated":true}' : 'null';
    found.array.pop();
    trimmed = true;
  }
}

export function snapshotText(snapshot: Record<string, unknown>): string {
  return 'Current table snapshot (data; this is the present state and outranks older messages):' + NL + fitJson(snapshot, SNAPSHOT_CHARS);
}
