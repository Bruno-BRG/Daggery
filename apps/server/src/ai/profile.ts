import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  AI_PROFILE_ITEM_CHARS, AI_PROFILE_LIST_LIMIT, AI_PROFILE_NOTE_CHARS, AI_PROFILE_NOTE_LIMIT,
  AI_PROFILE_PACINGS, AI_PROFILE_TONE_CHARS, AI_PROFILE_WEIGHT_MAX,
  type AiPacing, type AiProfile, type AiProfileNote, type AiProfileNoteSource,
} from '@daggery/shared';
import { record } from './validation';

interface ProfileRow {
  campaign_id: string; user_id: string; tone: string; pacing: string;
  combat: number; roleplay: number; exploration: number;
  lines: string; veils: string; likes: string; dislikes: string; notes: string; updated: string;
}

/** A profile with nothing filled in. Every player starts here, and the GM still sees it. */
export function emptyProfile(): AiProfile {
  return { tone: '', pacing: 'balanced', combat: 1, roleplay: 1, exploration: 1, lines: [], veils: [], likes: [], dislikes: [], notes: [], updated: '' };
}

function pacingOf(value: unknown): AiPacing {
  return typeof value === 'string' && AI_PROFILE_PACINGS.includes(value as AiPacing) ? value as AiPacing : 'balanced';
}

/** Stored weights are trusted to be integers, but a damaged row is clamped instead of refused. */
function weightOf(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(AI_PROFILE_WEIGHT_MAX, Math.max(0, Math.trunc(parsed))) : 1;
}

/** Reads a JSON text column or a plain array, keeping only the short string items it can use. */
function readList(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) as unknown; } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item !== '')
    .map(item => item.slice(0, AI_PROFILE_ITEM_CHARS))
    .slice(0, AI_PROFILE_LIST_LIMIT);
}

function readNotes(value: unknown): AiProfileNote[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) as unknown; } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const notes: AiProfileNote[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const text = typeof entry.text === 'string' ? entry.text.trim().slice(0, AI_PROFILE_NOTE_CHARS) : '';
    if (!text) continue;
    const source: AiProfileNoteSource = entry.source === 'gm' ? 'gm' : 'player';
    notes.push({ id: typeof entry.id === 'string' && entry.id ? entry.id : randomUUID(), text, source, at: typeof entry.at === 'string' ? entry.at : '' });
  }
  return notes.slice(-AI_PROFILE_NOTE_LIMIT);
}

/** A tolerant read of a stored profile row or a raw profile object. */
export function normalizeProfile(value: unknown): AiProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyProfile();
  const input = value as Record<string, unknown>;
  return {
    tone: typeof input.tone === 'string' ? input.tone.trim().slice(0, AI_PROFILE_TONE_CHARS) : '',
    pacing: pacingOf(input.pacing),
    combat: weightOf(input.combat),
    roleplay: weightOf(input.roleplay),
    exploration: weightOf(input.exploration),
    lines: readList(input.lines),
    veils: readList(input.veils),
    likes: readList(input.likes),
    dislikes: readList(input.dislikes),
    notes: readNotes(input.notes),
    updated: typeof input.updated === 'string' ? input.updated : '',
  };
}

function textField(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw new Error('Invalid ' + label + ': send text.');
  const body = value.trim();
  if (body.length > max) throw new Error('Invalid ' + label + ': at most ' + String(max) + ' characters.');
  return body;
}

function weightField(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > AI_PROFILE_WEIGHT_MAX) {
    throw new Error('Invalid focus weight: use a whole number from 0 to ' + String(AI_PROFILE_WEIGHT_MAX) + '.');
  }
  return value;
}

function listField(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error('Invalid ' + label + ': send a list of short items.');
  const items: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new Error('Invalid ' + label + ': every item must be text.');
    const item = raw.trim();
    if (!item) continue;
    if (item.length > AI_PROFILE_ITEM_CHARS) throw new Error('Invalid ' + label + ': each item may be at most ' + String(AI_PROFILE_ITEM_CHARS) + ' characters.');
    if (items.indexOf(item) < 0) items.push(item);
    if (items.length >= AI_PROFILE_LIST_LIMIT) break;
  }
  return items;
}

/** Keeps the newest notes within the cap, dropping old GM notes before player-written ones. */
function capNotes(notes: AiProfileNote[], keep?: string): AiProfileNote[] {
  const kept = notes.slice();
  while (kept.length > AI_PROFILE_NOTE_LIMIT) {
    let index = kept.findIndex(note => note.source === 'gm' && note.id !== keep);
    if (index < 0) index = kept.findIndex(note => note.id !== keep);
    if (index < 0) break;
    kept.splice(index, 1);
  }
  return kept;
}

/**
 * The player preference profile. One row per campaign member. The player edits every field
 * except GM notes, which only the GM appends; the player may remove any note.
 */
export class AiProfiles {
  constructor(private db: Database.Database) {}

  get(campaign: string, user: string): AiProfile {
    const row = this.db.prepare('SELECT * FROM ai_profiles WHERE campaign_id = ? AND user_id = ?').get(campaign, user) as ProfileRow | undefined;
    return row ? normalizeProfile(row) : emptyProfile();
  }

  /** Merges the player's edit over the stored profile. Omitted fields keep their value. */
  save(campaign: string, user: string, raw: unknown): AiProfile {
    const input = record(raw);
    const current = this.get(campaign, user);
    const updated = new Date().toISOString();
    const next: AiProfile = {
      tone: input.tone === undefined ? current.tone : textField(input.tone, AI_PROFILE_TONE_CHARS, 'tone'),
      pacing: input.pacing === undefined ? current.pacing : pacingField(input.pacing),
      combat: input.combat === undefined ? current.combat : weightField(input.combat),
      roleplay: input.roleplay === undefined ? current.roleplay : weightField(input.roleplay),
      exploration: input.exploration === undefined ? current.exploration : weightField(input.exploration),
      lines: input.lines === undefined ? current.lines : listField(input.lines, 'lines'),
      veils: input.veils === undefined ? current.veils : listField(input.veils, 'veils'),
      likes: input.likes === undefined ? current.likes : listField(input.likes, 'likes'),
      dislikes: input.dislikes === undefined ? current.dislikes : listField(input.dislikes, 'dislikes'),
      notes: current.notes.slice(),
      updated,
    };
    if (input.removeNoteIds !== undefined) {
      if (!Array.isArray(input.removeNoteIds) || input.removeNoteIds.some(id => typeof id !== 'string')) throw new Error('Invalid notes to remove: send a list of note IDs.');
      const remove = input.removeNoteIds as string[];
      next.notes = next.notes.filter(note => remove.indexOf(note.id) < 0);
    }
    if (input.note !== undefined) {
      const body = textField(input.note, AI_PROFILE_NOTE_CHARS, 'note');
      if (body) next.notes = capNotes(next.notes.concat({ id: randomUUID(), text: body, source: 'player', at: updated }));
    }
    this.write(campaign, user, next);
    return next;
  }

  /** Appends one observed preference as a GM note. It can never touch lines or veils. */
  note(campaign: string, user: string, raw: unknown): { saved: boolean; notes: number } {
    const input = record(raw);
    const body = textField(input.text, AI_PROFILE_NOTE_CHARS, 'preference note');
    if (!body) throw new Error('Invalid preference note: text is required.');
    const current = this.get(campaign, user);
    const at = new Date().toISOString();
    const created: AiProfileNote = { id: randomUUID(), text: body, source: 'gm', at };
    const notes = capNotes(current.notes.concat(created), created.id);
    this.write(campaign, user, { ...current, notes, updated: at });
    return { saved: true, notes: notes.length };
  }

  private write(campaign: string, user: string, profile: AiProfile): void {
    this.db.prepare(
      'INSERT INTO ai_profiles(campaign_id,user_id,tone,pacing,combat,roleplay,exploration,lines,veils,likes,dislikes,notes,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(campaign_id,user_id) DO UPDATE SET tone=excluded.tone,pacing=excluded.pacing,combat=excluded.combat,roleplay=excluded.roleplay,exploration=excluded.exploration,lines=excluded.lines,veils=excluded.veils,likes=excluded.likes,dislikes=excluded.dislikes,notes=excluded.notes,updated=excluded.updated',
    ).run(
      campaign, user, profile.tone, profile.pacing, profile.combat, profile.roleplay, profile.exploration,
      JSON.stringify(profile.lines), JSON.stringify(profile.veils), JSON.stringify(profile.likes), JSON.stringify(profile.dislikes),
      JSON.stringify(profile.notes), profile.updated,
    );
  }
}

function pacingField(value: unknown): AiPacing {
  if (typeof value !== 'string' || !AI_PROFILE_PACINGS.includes(value as AiPacing)) throw new Error('Invalid pacing: use fast, balanced or slow.');
  return value as AiPacing;
}
