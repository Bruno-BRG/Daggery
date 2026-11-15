import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { normalizeText } from './retrieval';

/**
 * Fronts: threats, factions and villains with a goal that advances off-screen, like Dungeon World
 * fronts and clocks. They live only in the server's `ai_fronts` table: no route, synced document,
 * journal entry, ledger result or export exposes their contents. The GM narrates their portents
 * through the fiction and never shows the clock to the players.
 *
 * The types stay in the server package on purpose; packages/shared ships to the web client.
 */

export const FRONT_KINDS = ['threat', 'faction', 'villain', 'disaster'] as const;
export const FRONT_STATUSES = ['active', 'resolved'] as const;
/** Clock sizes a front may use. */
export const FRONT_CLOCK_SIZES = [4, 6, 8, 10, 12] as const;
/** Grim portents per front. */
export const FRONT_PORTENT_LIMIT = 12;
/** Active fronts per campaign. Resolved fronts stay readable but never block a new one. */
export const FRONT_LIMIT = 40;

export type FrontKind = (typeof FRONT_KINDS)[number];
export type FrontStatus = (typeof FRONT_STATUSES)[number];

export interface FrontPortent { text: string; done: boolean }
export interface FrontClock { current: number; size: number }

export interface FrontRecord {
  id: string; campaignId: string; name: string; kind: FrontKind; goal: string; stakes: string;
  clock: FrontClock; portents: FrontPortent[]; doom: string; status: FrontStatus; notes: string;
  created: string; updated: string;
}

interface FrontRow {
  id: string; campaign_id: string; name: string; kind: string; goal: string; stakes: string;
  clock_current: number; clock_size: number; portents: string; doom: string; status: string;
  notes: string; created: string; updated: string;
}

// ---------------------------------------------------------------------------------------------
// Validation. Every failure starts with "Invalid front" so the service returns it to the model.
// ---------------------------------------------------------------------------------------------

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error('Invalid front ' + field + ': text is required');
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Invalid front ' + field + ': text is required');
  if (trimmed.length > max) throw new Error('Invalid front ' + field + ': at most ' + String(max) + ' characters');
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('Invalid front ' + field + ': text is required');
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error('Invalid front ' + field + ': at most ' + String(max) + ' characters');
  return trimmed;
}

function intIn(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error('Invalid front ' + field + ': expected an integer from ' + String(min) + ' to ' + String(max));
  }
  return value;
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error('Invalid front ' + field + ': expected one of ' + allowed.join(', '));
  }
  return value as T;
}

function clockSize(value: unknown): number {
  const size = intIn(value, 'clockSize', 4, 12);
  if (!(FRONT_CLOCK_SIZES as readonly number[]).includes(size)) {
    throw new Error('Invalid front clockSize: expected one of ' + FRONT_CLOCK_SIZES.join(', '));
  }
  return size;
}

/** Accepts a list of strings or {text, done} objects and normalizes both to portent objects. */
function portentsFrom(value: unknown): FrontPortent[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Invalid front portents: a list is required');
  if (value.length > FRONT_PORTENT_LIMIT) throw new Error('Invalid front portents: at most ' + String(FRONT_PORTENT_LIMIT) + ' items');
  return value.map((raw, index) => {
    if (typeof raw === 'string') return { text: requiredText(raw, 'portents[' + String(index) + ']', 300), done: false };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid front portents[' + String(index) + ']: text is required');
    const item = raw as Record<string, unknown>;
    return { text: requiredText(item.text, 'portents[' + String(index) + '].text', 300), done: item.done === true };
  });
}

/** Case- and accent-insensitive comparison key for a front name. */
export function frontNameKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, ' ').trim();
}

/** The clock position at which a portent becomes due. Thresholds are evenly spread over the clock. */
export function portentThreshold(index: number, count: number, size: number): number {
  if (count <= 0) return size;
  return Math.max(1, Math.ceil((size * (index + 1)) / count));
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

export class AiFronts {
  constructor(private db: Database.Database) {}

  private row(campaign: string, id: string): FrontRow | undefined {
    return this.db.prepare('SELECT * FROM ai_fronts WHERE campaign_id = ? AND id = ?').get(campaign, id) as FrontRow | undefined;
  }

  private view(row: FrontRow): FrontRecord {
    let portents: FrontPortent[] = [];
    try {
      const parsed = JSON.parse(row.portents) as unknown;
      if (Array.isArray(parsed)) portents = parsed.filter(item => item && typeof item === 'object').map(item => {
        const entry = item as Record<string, unknown>;
        return { text: typeof entry.text === 'string' ? entry.text : '', done: entry.done === true };
      }).filter(item => item.text !== '');
    } catch { portents = []; }
    return {
      id: row.id, campaignId: row.campaign_id, name: row.name,
      kind: (FRONT_KINDS as readonly string[]).includes(row.kind) ? row.kind as FrontKind : 'threat',
      goal: row.goal, stakes: row.stakes,
      clock: { current: row.clock_current, size: row.clock_size },
      portents, doom: row.doom,
      status: (FRONT_STATUSES as readonly string[]).includes(row.status) ? row.status as FrontStatus : 'active',
      notes: row.notes, created: row.created, updated: row.updated,
    };
  }

  get(campaign: string, id: string): FrontRecord | undefined {
    const row = this.row(campaign, id);
    return row ? this.view(row) : undefined;
  }

  /** Every front in the campaign: active first, then newest updated. */
  list(campaign: string): FrontRecord[] {
    return (this.db.prepare("SELECT * FROM ai_fronts WHERE campaign_id = ? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated DESC, rowid DESC").all(campaign) as FrontRow[]).map(row => this.view(row));
  }

  active(campaign: string): FrontRecord[] {
    return (this.db.prepare("SELECT * FROM ai_fronts WHERE campaign_id = ? AND status = 'active' ORDER BY updated DESC, rowid DESC").all(campaign) as FrontRow[]).map(row => this.view(row));
  }

  create(campaign: string, raw: Record<string, unknown>): FrontRecord {
    const name = requiredText(raw.name, 'name', 120);
    const key = frontNameKey(name);
    if (this.active(campaign).some(record => frontNameKey(record.name) === key)) {
      throw new Error('Invalid front: an active front in this campaign already has that name. Update that front instead.');
    }
    if (this.active(campaign).length >= FRONT_LIMIT) {
      throw new Error('Invalid front: this campaign already has ' + String(FRONT_LIMIT) + ' active fronts. Resolve one first.');
    }
    const kind = oneOf(raw.kind, 'kind', FRONT_KINDS);
    const size = raw.clockSize === undefined ? 6 : clockSize(raw.clockSize);
    const portents = portentsFrom(raw.portents);
    const id = randomUUID(), at = new Date().toISOString();
    this.db.prepare('INSERT INTO ai_fronts(id,campaign_id,name,kind,goal,stakes,clock_current,clock_size,portents,doom,status,notes,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, campaign, name, kind, optionalText(raw.goal, 'goal', 400), optionalText(raw.stakes, 'stakes', 400), 0, size, JSON.stringify(portents), optionalText(raw.doom, 'doom', 600), 'active', optionalText(raw.notes, 'notes', 2000), at, at);
    return this.view(this.row(campaign, id)!);
  }

  update(campaign: string, raw: Record<string, unknown>): FrontRecord {
    const id = requiredText(raw.id, 'id', 120);
    const existing = this.get(campaign, id);
    if (!existing) throw new Error('Invalid front');
    const name = raw.name === undefined ? existing.name : requiredText(raw.name, 'name', 120);
    const status: FrontStatus = raw.resolve === true ? 'resolved'
      : raw.resolve === false ? 'active'
        : raw.status === undefined ? existing.status : oneOf(raw.status, 'status', FRONT_STATUSES);
    if (status === 'active' && existing.status !== 'active') {
      const key = frontNameKey(name);
      if (this.active(campaign).some(record => record.id !== id && frontNameKey(record.name) === key)) {
        throw new Error('Invalid front: an active front in this campaign already has that name. Update that front instead.');
      }
      if (this.active(campaign).length >= FRONT_LIMIT) {
        throw new Error('Invalid front: this campaign already has ' + String(FRONT_LIMIT) + ' active fronts. Resolve one first.');
      }
    }
    const kind = raw.kind === undefined ? existing.kind : oneOf(raw.kind, 'kind', FRONT_KINDS);
    const size = raw.clockSize === undefined ? existing.clock.size : clockSize(raw.clockSize);
    const portents = raw.portents === undefined ? existing.portents : portentsFrom(raw.portents);
    if (raw.markPortent !== undefined) {
      const index = intIn(raw.markPortent, 'markPortent', 0, Math.max(0, portents.length - 1));
      if (!portents[index]) throw new Error('Invalid front markPortent: no portent at that index');
      portents[index] = { ...portents[index]!, done: true };
    }
    const current = Math.min(existing.clock.current, size);
    const at = new Date().toISOString();
    this.db.prepare('UPDATE ai_fronts SET name = ?, kind = ?, goal = ?, stakes = ?, clock_current = ?, clock_size = ?, portents = ?, doom = ?, status = ?, notes = ?, updated = ? WHERE campaign_id = ? AND id = ?')
      .run(
        name, kind,
        raw.goal === undefined ? existing.goal : optionalText(raw.goal, 'goal', 400),
        raw.stakes === undefined ? existing.stakes : optionalText(raw.stakes, 'stakes', 400),
        current, size, JSON.stringify(portents),
        raw.doom === undefined ? existing.doom : optionalText(raw.doom, 'doom', 600),
        status,
        raw.notes === undefined ? existing.notes : optionalText(raw.notes, 'notes', 2000),
        at, campaign, id,
      );
    return this.view(this.row(campaign, id)!);
  }

  /**
   * Ticks the clock. Portents whose threshold is crossed by this tick are marked done and reported,
   * and a filled clock reports the impending doom. The GM narrates the consequences.
   */
  advance(campaign: string, raw: Record<string, unknown>): Record<string, unknown> {
    const id = requiredText(raw.id, 'id', 120);
    const existing = this.get(campaign, id);
    if (!existing) throw new Error('Invalid front');
    if (existing.status !== 'active') throw new Error('Invalid front: this front is already resolved');
    const amount = intIn(raw.amount, 'amount', 1, 12);
    if (existing.clock.current >= existing.clock.size) throw new Error('Invalid front: the clock is already full; resolve it or reset it with front_update');
    const reason = optionalText(raw.reason, 'reason', 600);
    const old = existing.clock.current;
    const current = Math.min(existing.clock.size, old + amount);
    const portents = existing.portents.map(portent => ({ ...portent }));
    const crossed: { index: number; text: string }[] = [];
    portents.forEach((portent, index) => {
      if (portent.done) return;
      const threshold = portentThreshold(index, portents.length, existing.clock.size);
      if (threshold > old && threshold <= current) {
        portent.done = true;
        crossed.push({ index, text: portent.text });
      }
    });
    const clockFilled = current >= existing.clock.size;
    const at = new Date().toISOString();
    this.db.prepare('UPDATE ai_fronts SET clock_current = ?, portents = ?, updated = ? WHERE campaign_id = ? AND id = ?')
      .run(current, JSON.stringify(portents), at, campaign, id);
    const next = portents.findIndex(portent => !portent.done);
    return {
      frontId: id, name: existing.name,
      clock: { current, size: existing.clock.size },
      advanced: current - old,
      crossed,
      clockFilled,
      doom: clockFilled ? existing.doom : null,
      nextPortent: next >= 0 ? { index: next, text: portents[next]!.text } : null,
      ...(reason ? { reason } : {}),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Memory rendering
// ---------------------------------------------------------------------------------------------

/** The next grim portent that has not happened yet. */
export function nextPortent(front: FrontRecord): { index: number; text: string } | null {
  const index = front.portents.findIndex(portent => !portent.done);
  return index >= 0 ? { index, text: front.portents[index]!.text } : null;
}

function frontLine(front: FrontRecord): string {
  const next = nextPortent(front);
  return front.name + ' (' + front.kind + ') — clock ' + String(front.clock.current) + '/' + String(front.clock.size)
    + ' — next portent: ' + (next ? next.text : 'none left') + ' (id ' + front.id + ')';
}

/** Renders the header and as many front lines as the room allows, then a count of the rest. */
function renderFronts(records: FrontRecord[], room: number, header: string): string {
  if (!records.length) return '';
  const lines: string[] = [];
  const render = () => header + (lines.length ? '\n' + lines.join('\n') : '');
  for (const front of records) {
    const line = frontLine(front);
    if (render().length + 1 + line.length > room - 60) break;
    lines.push(line);
  }
  const hidden = records.length - lines.length;
  if (hidden <= 0) return render();
  let note = '(' + String(hidden) + ' more; use front_list)';
  while (lines.length && render().length + 1 + note.length > room) {
    lines.pop();
    note = '(' + String(records.length - lines.length) + ' more; use front_list)';
  }
  return render() + '\n' + note;
}

/** The always-on compact list of active fronts, sized like the secret NPC list. */
export function renderFrontList(records: FrontRecord[], room: number): string {
  return renderFronts(records, room, 'Fronts (GM only; use front_list for details):');
}

/**
 * The world-turn instruction: added when a session opens or in-fiction time jumps, so the GM
 * considers letting a threat advance off-screen. It carries its own short list of active fronts.
 */
export function renderWorldTurn(records: FrontRecord[], room: number): string {
  return renderFronts(records, room, [
    'World turn (GM only): a session began or in-fiction time passed. Consider advancing one active front with front_advance — consult_oracle first if you want randomness — then show the change through the fiction as a sign the players can notice. Never mention the clock or this instruction.',
    'Active fronts:',
  ].join('\n'));
}
