import { adversaries } from '@daggery/content';
import type { RollPayload } from '@daggery/shared';
import type { DiceTrayApi } from '../../dice3d';
import { hpMax, stressMax, evasion as sheetEvasion, damageThresholds } from '../sheets/rules';
import type { Sheet } from '../sheets/types';

/** Every combat document lives in this namespace of the shared doc store. */
export const NS = 'combat';
export const MAX_FEAR = 12;

export interface Thresholds {
  major: number;
  severe: number;
}

export interface AdversaryFeature {
  name: string;
  kind: string;
  text: string;
}

/** One entry of packages/content/adversaries.json. */
export interface AdversarySource {
  id: string;
  name: string;
  tier: number;
  type: string;
  description: string;
  motives: string;
  difficulty: number;
  thresholds: Thresholds | null;
  hp: number;
  stress: number | null;
  attack: { modifier: number; name: string; range: string; damage: string; damageType: string };
  experiences: { name: string; bonus: number }[];
  features: AdversaryFeature[];
}

export const CATALOG = adversaries as unknown as AdversarySource[];
const CATALOG_BY_ID = new Map(CATALOG.map((a) => [a.id, a] as const));

export function sourceOf(catalogId: string): AdversarySource | undefined {
  return CATALOG_BY_ID.get(catalogId);
}

/* ------------------------------------------------------------------ rules */

/** Battle Points per adversary (SRD "Spending Battle Points"). A group of Minions costs 1. */
export const BP_COST: Record<string, number> = {
  Minion: 1,
  Social: 1,
  Support: 1,
  Horde: 2,
  Ranged: 2,
  Skulk: 2,
  Standard: 2,
  Leader: 3,
  Bruiser: 4,
  Solo: 5,
};

export const TYPE_ORDER = Object.keys(BP_COST);

export function costOf(type: string): number {
  return BP_COST[type] ?? 2;
}

/** Budget = 3 x PCs + 2, adjusted. Automatic rules depend on the encounter; the rest are GM choices. */
export interface BudgetFlags {
  easier: boolean;
  plusDamage: boolean;
  lowerTier: boolean;
  dangerous: boolean;
}

export interface BudgetLine {
  label: string;
  points: number;
  auto: boolean;
}

export interface Budget {
  party: number;
  base: number;
  lines: BudgetLine[];
  total: number;
}

const BIG_TYPES = ['Bruiser', 'Horde', 'Leader', 'Solo'];

export function computeBudget(party: number, flags: BudgetFlags, types: string[]): Budget {
  const base = 3 * party + 2;
  const lines: BudgetLine[] = [];
  if (types.filter((t) => t === 'Solo').length >= 2) {
    lines.push({ label: '2 or more Solo', points: -2, auto: true });
  }
  if (types.length > 0 && !types.some((t) => BIG_TYPES.includes(t))) {
    lines.push({ label: 'No Bruiser, Horde, Leader, or Solo', points: 1, auto: true });
  }
  if (flags.easier) lines.push({ label: 'Easier or shorter fight', points: -1, auto: false });
  if (flags.plusDamage) {
    lines.push({ label: '+1d4 (or +2) to everyone’s damage', points: -2, auto: false });
  }
  if (flags.lowerTier) lines.push({ label: 'Lower-tier adversary', points: 1, auto: false });
  if (flags.dangerous) lines.push({ label: 'More dangerous or longer fight', points: 2, auto: false });
  const total = Math.max(0, base + lines.reduce((sum, line) => sum + line.points, 0));
  return { party, base, lines, total };
}

export type Severity = 'Minor' | 'Major' | 'Severe';

/** Damage to an adversary: Severe = 3 HP, Major = 2 HP, anything else = 1 HP. */
export function hpForDamage(damage: number, t: Thresholds): { marks: number; severity: Severity | null } {
  if (damage <= 0) return { marks: 0, severity: null };
  if (damage >= t.severe) return { marks: 3, severity: 'Severe' };
  if (damage >= t.major) return { marks: 2, severity: 'Major' };
  return { marks: 1, severity: 'Minor' };
}

/** Minion (X): defeated on any damage, plus one extra per X damage. X comes from the feature name. */
export function minionDefeats(damage: number, features: AdversaryFeature[]): number {
  if (damage <= 0) return 0;
  let step = 0;
  for (const f of features) {
    const match = /^Minion \((\d+)\)/i.exec(f.name);
    if (match?.[1]) step = Number(match[1]);
  }
  return 1 + (step > 0 ? Math.floor(damage / step) : 0);
}

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };

/** How much Fear a feature text asks to spend: a number, 'variable', or null when no Fear is spent. */
export function fearCost(text: string): number | 'variable' | null {
  if (/\bspend\s+(?:any\s+|a\s+)?number\s+of\s+fear\b/i.test(text)) return 'variable';
  const match = /\bspend\s+(?:(a|an|one|two|three|four|five|\d+)\s+)?fear\b/i.exec(text);
  if (!match) return null;
  const word = match[1]?.toLowerCase();
  if (!word) return 1;
  return WORD_NUMBERS[word] ?? (Number.parseInt(word, 10) || 1);
}

export function hpStatus(marked: number, max: number): string {
  if (marked >= max) return 'Defeated';
  if (marked === 0) return 'Unharmed';
  return marked * 2 >= max ? 'Badly wounded' : 'Wounded';
}

export function groupStatus(defeated: number, size: number): string {
  if (defeated >= size) return 'Defeated';
  return defeated === 0 ? 'Unharmed' : 'Partial';
}

export const CONDITIONS = [
  { key: 'vulnerable', label: 'Vulnerable' },
  { key: 'restrained', label: 'Restrained' },
  { key: 'hidden', label: 'Hidden' },
] as const;
export type ConditionKey = (typeof CONDITIONS)[number]['key'];
export type Conditions = Record<ConditionKey, boolean>;
export const NO_CONDITIONS: Conditions = { vulnerable: false, restrained: false, hidden: false };

/** Countdown dice sizes; a countdown uses the smallest die that can show its starting value. */
const DIE_SIZES = [4, 6, 8, 10, 12, 20] as const;
export function dieFor(start: number): number {
  return DIE_SIZES.find((sides) => sides >= start) ?? 20;
}

/* ------------------------------------------------------------- documents */

export interface Counter {
  id: string;
  label: string;
  value: number;
}

export interface FearDoc {
  kind: 'fear';
  value: number;
}

export interface SpotlightDoc {
  kind: 'spotlight';
  /** 'GM', a PC key, or null when nobody has it. */
  holder: string | null;
  tokensOn: boolean;
  tokenMax: number;
  /** Spent action tokens per PC key. A missing key means all tokens are available. */
  tokens: Record<string, number>;
}

export interface BudgetDoc extends BudgetFlags {
  kind: 'budget';
  /** Null follows the number of PCs on the roster. */
  partySize: number | null;
}

/** One adversary on the active encounter, stats looked up from the catalog by catalogId. */
export interface AdversaryDoc {
  kind: 'adversary';
  sceneId?: string;
  catalogId: string;
  name: string;
  addedAt: number;
  hpMarked: number;
  stressMarked: number;
  /** Set for Minion groups: how many minions the group started with. */
  groupSize: number | null;
  defeated: number;
  conditions: Conditions;
  counters: Counter[];
}

export interface PcDoc {
  kind: 'pc';
  name: string;
  evasion: number | null;
  hpMax: number;
  hpMarked: number;
  stressMax: number;
  stressMarked: number;
  thresholds: Thresholds | null;
  addedAt: number;
}

export interface CountdownDoc {
  kind: 'countdown';
  name: string;
  start: number;
  sides: number;
  value: number;
  visible: boolean;
  addedAt: number;
}

export type LogEvent = 'damage' | 'defeat' | 'roll' | 'fear' | 'spotlight' | 'feature' | 'countdown';

export interface LogDoc {
  kind: 'log';
  at: number;
  author: string;
  event: LogEvent;
  /** Full text, GM only. */
  text: string;
  /** What players see. Entries without it are hidden from the player view. */
  playerText?: string;
}

export type CombatDoc =
  | FearDoc
  | SpotlightDoc
  | BudgetDoc
  | AdversaryDoc
  | PcDoc
  | CountdownDoc
  | LogDoc;

export const DEFAULT_SPOTLIGHT: SpotlightDoc = {
  kind: 'spotlight',
  holder: null,
  tokensOn: false,
  tokenMax: 3,
  tokens: {},
};

export const DEFAULT_BUDGET: BudgetDoc = {
  kind: 'budget',
  partySize: null,
  easier: false,
  plusDamage: false,
  lowerTier: false,
  dangerous: false,
};

export function entriesOf<K extends CombatDoc['kind']>(
  docs: Record<string, CombatDoc>,
  kind: K,
): [string, Extract<CombatDoc, { kind: K }>][] {
  const out: [string, Extract<CombatDoc, { kind: K }>][] = [];
  for (const [id, doc] of Object.entries(docs)) {
    if (doc.kind === kind) out.push([id, doc as Extract<CombatDoc, { kind: K }>]);
  }
  return out;
}

export function fearValue(docs: Record<string, CombatDoc>): number {
  const doc = docs.fear;
  return doc?.kind === 'fear' ? doc.value : 0;
}

export function spotlightOf(docs: Record<string, CombatDoc>): SpotlightDoc {
  const doc = docs.spotlight;
  return doc?.kind === 'spotlight' ? doc : DEFAULT_SPOTLIGHT;
}

export function budgetOf(docs: Record<string, CombatDoc>): BudgetDoc {
  const doc = docs.budget;
  return doc?.kind === 'budget' ? doc : DEFAULT_BUDGET;
}

/* ------------------------------------------------------------ PC roster */

export interface Pool {
  current: number;
  max: number;
}

export interface PcView {
  /** Spotlight and token key. Sheet PCs use `sheet:<id>`, manual PCs use their doc id. */
  key: string;
  name: string;
  evasion: number | null;
  thresholds: Thresholds | null;
  /** Read-only pools from a character sheet. */
  sheetHp: Pool | null;
  sheetStress: Pool | null;
  /** Set for quick-add PCs, which this module edits. */
  manual: PcDoc | null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function poolOf(value: unknown): Pool | null {
  if (!isRecord(value)) return null;
  const current = numberOf(value.current);
  const max = numberOf(value.max);
  return current !== null && max !== null ? { current, max } : null;
}

function thresholdsOf(value: unknown): Thresholds | null {
  if (!isRecord(value)) return null;
  const major = numberOf(value.major);
  const severe = numberOf(value.severe);
  return major !== null && severe !== null ? { major, severe } : null;
}

/** Loose read of the 'sheets' namespace: tolerates any shape, uses whatever fields exist. */
export function pcViews(sheets: Record<string, unknown>, docs: Record<string, CombatDoc>): PcView[] {
  const fromSheets: PcView[] = Object.entries(sheets).map(([id, raw]) => {
    const sheet = isRecord(raw) ? raw : {};
    const name = typeof sheet.name === 'string' && sheet.name.trim() ? sheet.name.trim() : id;
    const modern = typeof sheet.hpMarked === 'number' ? {
      ...sheet, bonusHpSlots: numberOf(sheet.bonusHpSlots) ?? 0, bonusStressSlots: numberOf(sheet.bonusStressSlots) ?? 0,
      evasionBonus: numberOf(sheet.evasionBonus) ?? 0, level: numberOf(sheet.level) ?? 1,
      weapons: Array.isArray(sheet.weapons) ? sheet.weapons : [],
    } as unknown as Sheet : null;
    const healthMax = modern ? hpMax(modern) : 0, strainMax = modern ? stressMax(modern) : 0;
    return {
      key: `sheet:${id}`,
      name,
      evasion: modern ? sheetEvasion(modern) : numberOf(sheet.evasion),
      thresholds: modern ? damageThresholds(modern) : thresholdsOf(sheet.thresholds),
      sheetHp: modern ? { max: healthMax, current: clamp(healthMax - modern.hpMarked, 0, healthMax) } : poolOf(sheet.hitPoints) ?? poolOf(sheet.hp),
      sheetStress: modern ? { max: strainMax, current: clamp(strainMax - (numberOf(modern.stressMarked) ?? 0), 0, strainMax) } : poolOf(sheet.stress),
      manual: null,
    };
  });
  const manual: PcView[] = entriesOf(docs, 'pc')
    .sort((a, b) => a[1].addedAt - b[1].addedAt)
    .map(([id, doc]) => ({
      key: id,
      name: doc.name,
      evasion: doc.evasion,
      thresholds: doc.thresholds,
      sheetHp: null,
      sheetStress: null,
      manual: doc,
    }));
  return [...fromSheets, ...manual];
}

/* --------------------------------------------------------------- helpers */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function toInt(text: string): number | null {
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : null;
}

export function describeRoll(payload: RollPayload): string {
  if (payload.kind === 'dice') {
    const r = payload.result;
    return `${r.notation} = ${r.total} [${r.rolls.join(', ')}]`;
  }
  const r = payload.result;
  return `Hope ${r.hope} + Fear ${r.fear} = ${r.total}`;
}

export function totalOf(payload: RollPayload): number {
  return payload.result.total;
}

/** Everything the panels need: the live docs plus the write and log helpers. */
export interface Ctx {
  docs: Record<string, CombatDoc>;
  set: (id: string, value: CombatDoc) => void;
  remove: (id: string) => void;
  author: string;
  isGM: boolean;
  dice: DiceTrayApi;
  /** Appends to the combat log. Without `playerText` the entry is GM only. */
  log: (event: LogEvent, text: string, playerText?: string) => void;
}
