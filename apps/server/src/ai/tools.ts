import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { adversaries, ancestries, armor, classes, communities, consumables, domainCards, environments, items, transformations, weapons } from '@daggery/content';
import { hasFeature, maxDiceTotal, rollDice, rollDie, type AiBudget, type AiInteraction, type AiState } from '@daggery/shared';
import { armorScore, classResourceDefinitions, classResourceValue, evasion, getArmor, getClass, getCommunity, getDomainCard, getSubclass, heritageDisplayName, hpMax, markStress, MAX_HOPE, sheetAncestries, spellcastTraitName, stressMax, weaponForSlot } from '@daggery/shared/daggerheart';
import type { Sheet } from '@daggery/shared/daggerheart/types';
import type { CampaignService } from '../campaign-service';
import { SoloService } from '../solo';
import { effectiveContextWindow, type ToolDefinition } from './provider';
import { AiCanon, CANON_KINDS, canonKind } from './canon';
import { catalogSemantic } from './catalog-index';
import { AiChats } from './chats';
import type { EmbeddingIndex } from './embeddings';
import { CAMPAIGN_FRAMES, findCampaignFrame } from './frames';
import { AiJournal } from './journal';
import { listSourcebooks, readSourcebookPage, searchSourcebooks } from './sourcebook';
import { applyStatePatch, emptyState, limitsFor, normalizeState, SECRETS_LIMIT, snapshotFor } from './memory';
import { integer, number, record, text } from './validation';

const s = { type: 'string' }, n = { type: 'number' };
const schema = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const tool = (name: string, description: string, properties: Record<string, unknown>, required?: string[]): ToolDefinition => ({ name, description, parameters: schema(properties, required) });

/** Horde (X): at half or more HP marked, the standard attack deals X instead (Core Rulebook p. 199). */
function hordeDamage(features: { name: string }[], hpMarked: number, hp: number, base: string): string {
  if (hp <= 0 || hpMarked * 2 < hp) return base;
  for (const feature of features) {
    const value = /^Horde \(([^)]+)\)/i.exec(feature.name)?.[1]?.trim();
    if (value) return value;
  }
  return base;
}
export const GM_TOOLS: ToolDefinition[] = [
  tool('get_context', 'Read the table snapshot: heroes, the active scene, countdowns, present adversaries, pending cards, the campaign state, the GM preparations, and the image assets that can serve as scene maps, with their IDs. Use it only when a needed fact is missing.', {}),
  tool('search_rules', 'Find actual catalog rules, adversaries, environments, items, abilities, ancestries or communities, including the Hope & Fear and Sablewood material. Without id, a ranked search returns at most six results trimmed to 280 characters per field; findings can also match by meaning. With id (an exact catalog ID from a search result, get_character or get_adversary), returns that one entry in full.', { query: s, id: s, category: { type: 'string', enum: ['adversaries', 'ancestries', 'communities', 'environments', 'items', 'consumables', 'weapons', 'armor', 'cards', 'classes', 'transformations'] } }, ['category']),
  tool('search_sourcebook', 'Search the installed printed sourcebooks (the core rulebook, Hope & Fear material, Sablewood and other supplements) for rules, mechanics, adversary behaviour, items or lore. Use it whenever you are unsure about anything the table would look up, before inventing a ruling. Returns source, title, page (printed when known, otherwise PDF), pdfPage, score and a snippet. Cite as “Title, p. N”. Then read the page with read_sourcebook_page.', { query: s, source: s, limit: n }, ['query']),
  tool('read_sourcebook_page', 'Read the full printed text of a sourcebook page found with search_sourcebook. `page` is the page value from a search hit (printed if known, otherwise PDF). Optional `pages` reads that page and the next one, at most 2. Cite as “Title, p. N”.', { source: s, page: n, pages: n }, ['source', 'page']),
  tool('get_character', 'Read one hero sheet: level, class and subclass, heritage, community, traits, HP/Stress/Hope/armor marks with maxima, evasion, equipped weapons and armor, Experiences, loadout domain cards, inventory, and source IDs. Read-only. Use search_rules with category cards and a card ID for full card text.', { heroId: s }, ['heroId']),
  tool('get_adversary', 'Read one present adversary: its catalog stats and full feature text, plus its current marks, defeated count, group size, and active conditions. Read-only.', { adversaryId: s }, ['adversaryId']),
  tool('set_memory', 'Rewrite the GM-only secrets and plans as one short text of at most 4000 characters. Players never see it, and the new text replaces the previous one entirely.', { memory: s }),
  tool('set_resume_note', 'Record the exact situation where play stops, so it survives a pause: what decision is pending, positions, active effects, and the next trigger. At most 1500 characters. It is shown to the GM as "Where we stopped" when play resumes.', { note: s }),
  tool('update_state', 'Merge changes into the campaign state: location, time of day, objective, threads, NPCs, promises, and facts. List items upsert by id; use removeIds to delete. Caps: 12 threads, 30 NPCs, 10 promises, 20 facts.', {
    location: s,
    timeOfDay: s,
    objective: s,
    threads: { type: 'array', items: { type: 'object', properties: { id: s, title: s, status: { type: 'string', enum: ['open', 'stalled', 'resolved'] }, note: s }, required: ['title'] } },
    npcs: { type: 'array', items: { type: 'object', properties: { id: s, name: s, role: s, attitude: s, lastSeen: s }, required: ['name'] } },
    promises: { type: 'array', items: { type: 'object', properties: { id: s, text: s }, required: ['text'] } },
    facts: { type: 'array', items: s },
    removeIds: { type: 'array', items: s },
  }, []),
  tool('journal_add', 'Write an adventure note: a discovery, decision, promise, or changed relationship. Dice, damage, and scene changes are already recorded automatically. Shared notes are visible to players; others are for the GM only. At most three per turn.', { title: s, body: s, shared: { type: 'boolean' } }, ['title', 'body']),
  tool('search_journal', 'Search the adventure journal across every session of the campaign by ranked keywords (several words may match different parts of an entry). Returns at most six entries with trimmed text, each with its session label and date. Use it before inventing a detail that may already exist.', { query: s, limit: n }, ['query']),
  tool('journal_read', 'Read one complete journal entry by ID, including the full body and any GM-only note. Use search_journal first to find the ID.', { id: s }, ['id']),
  tool('canon_write', 'Create or update a durable canon entry: a person, location, faction, promise, fact, history, plan, rumor, or secret. Bodies may be up to 6000 characters. Canon is never deleted to make room; archive obsolete entries instead. An entry with visibility "gm", including the kind "secret", is GM only; "shared" records it as player-safe.', { id: s, kind: { type: 'string', enum: [...CANON_KINDS] }, title: s, body: s, visibility: { type: 'string', enum: ['shared', 'gm'] }, source: s }, ['kind', 'title', 'body']),
  tool('canon_search', 'Search durable canon by ranked keywords; title matches rank highest and several words may match different parts of an entry. Returns active entries with id, kind, title and a trimmed body. Canon survives state compaction and fact eviction, so search here before inventing a detail. Entries with visibility "gm" or kind "secret" are GM only.', { query: s, kind: { type: 'string', enum: [...CANON_KINDS] }, limit: n }, ['query']),
  tool('canon_read', 'Read one complete canon entry by ID, including its full body. Use canon_search first to find the ID. Entries with visibility "gm" or kind "secret" are GM only.', { id: s }, ['id']),
  tool('list_campaign_frames', 'List the campaign frames available from the installed sourcebooks, with their source, page range, one-sentence summary and whether the sourcebook is installed. A game can run a published frame or a custom world.', {}),
  tool('load_campaign_frame', 'Open a campaign frame. The first call for a campaign also writes brief seed prep and canon (premise, tone, factions, key NPCs, locations, starting hooks) so the frame survives memory compaction. Returns a chunk of the frame’s printed pages; pass `page` from `nextPage` to continue reading. Use it before the opening and at the start of each session when the campaign uses a frame.', { id: s, page: n }, ['id']),
  tool('write_prep', 'Create/update GM preparations. Setting field keys: premise, tone, locations, factions, secrets, agreements. Scenario field keys: hook, stakes, scenes, cast, rewards, aftermath. Values are prose. An existing scenario ID preserves that scenario.', { kind: { type: 'string', enum: ['setting', 'scenario'] }, title: s, fields: { type: 'object', additionalProperties: s }, id: s }, ['kind', 'title', 'fields']),
  tool('write_note', 'Create a campaign note for the Notes page, shared or GM-only. Never overwrite another author’s private note. For adventure records, use journal_add.', { title: s, body: s, shared: { type: 'boolean' } }),
  tool('create_scene', 'Create a table scene and make it active. For its map, use the ID of an image asset listed by get_context, or leave assetId blank for a grid.', { name: s, cols: n, rows: n, assetId: s }, ['name']),
  tool('activate_scene', 'Switch to an existing map scene.', { sceneId: s }),
  tool('place_token', 'Place a hero, NPC, prop or marker on the active scene. Coordinates are grid cells. Hero reference is optional.', { name: s, x: n, y: n, heroId: s }, ['name', 'x', 'y']),
  tool('move_token', 'Move an existing miniature within its scene using grid-cell coordinates.', { tokenId: s, x: n, y: n }),
  tool('set_condition', 'Set or clear Vulnerable, Restrained or Hidden on a present adversary or miniature. Explain the fictional trigger; this does not grant damage or extra attacks.', { targetId: s, condition: { type: 'string', enum: ['vulnerable', 'restrained', 'hidden'] }, active: { type: 'boolean' }, reason: s }),
  tool('set_spotlight', 'Pass the spotlight to GM or a hero ID. An extra GM spotlight still requires spending Fear separately when the rules require it.', { holder: s, reason: s }),
  tool('draw_on_scene', 'Add a line, rectangle, ellipse or text annotation to the active map. Coordinates and sizes are grid cells.', { kind: { type: 'string', enum: ['line', 'rect', 'ellipse', 'text'] }, x: n, y: n, width: n, height: n, text: s }, ['kind', 'x', 'y', 'width', 'height']),
  tool('fog_area', 'Add a rectangular fog hide/reveal area on the active scene, using grid cells.', { x: n, y: n, width: n, height: n, reveal: { type: 'boolean' } }),
  tool('add_adversary', 'Add an adversary from the actual catalog to the encounter and active map. Difficulty/damage/HP come from the source.', { catalogId: s, name: s, x: n, y: n }, ['catalogId']),
  tool('request_roll', 'Ask the player to roll a trait against a declared Difficulty. For a basic weapon attack provide enemyId; the engine chooses the equipped weapon trait, Difficulty and damage. Never roll the player’s choice for them.', { heroId: s, trait: { type: 'string', enum: ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'] }, difficulty: n, reason: s, enemyId: s }, ['heroId', 'trait', 'difficulty', 'reason']),
  tool('adversary_attack', 'Resolve a present adversary’s standard d20 attack against a hero. Damage becomes a player-confirmed card with an Armor option. Requires a fictional opening; no extra spotlight is granted.', { adversaryId: s, heroId: s, reason: s }),
  tool('deal_damage', 'Deal damage from any source other than an adversary’s standard attack: an environment, trap, fall, hazard, feature, spell, or direct damage. Accepts dice notation like "2d6+3" or a flat number. Damage becomes a player-confirmed card with an Armor option unless direct. Can also apply a core condition when the source sensibly imposes one.', { heroId: s, damage: s, direct: { type: 'boolean' }, condition: { type: 'string', enum: ['vulnerable', 'restrained', 'hidden'] }, reason: s }, ['heroId', 'damage', 'reason']),
  tool('mark_stress', 'Make a hero mark Stress from a feature, environment, or consequence (not an attack). If the Stress track is full, the overflow marks 1 HP as the rules require.', { heroId: s, amount: n, reason: s }, ['heroId', 'amount', 'reason']),
  tool('spend_fear', 'Pay a legal GM feature/extra-move cost from existing Fear, with an explanation. Does not grant any additional free actions.', { amount: n, reason: s }),
  tool('create_countdown', 'Create a named countdown with an explicit completion event. Countdown does not advance automatically.', { name: s, start: n }),
  tool('advance_countdown', 'Advance a relevant countdown by 1–3 once for its cause. Do not charge the same consequence twice.', { countdownId: s, amount: n, reason: s }),
  tool('roll_loot', 'Roll a printed loot table from the Core Set or Additional (Hope & Fear) tables. Rarity sets the allowed d12 pool: Common 1–2d12, Uncommon 2–3d12, Rare 3–4d12, Legendary 4–5d12. Omit dice to use the smaller pool.', { table: { type: 'string', enum: ['items', 'consumables'] }, set: { type: 'string', enum: ['core', 'additional'] }, rarity: { type: 'string', enum: ['Common', 'Uncommon', 'Rare', 'Legendary'] }, dice: n, note: s }, ['table', 'rarity']),
  tool('give_item', 'Give a known catalog item or consumable to a hero. Use this after agreeing the reward; it changes inventory.', { heroId: s, catalogId: s, quantity: n }),
  tool('solo_oracle', 'Consult the solo oracle or thematic scene engine without changing Hope/Fear. Available only in Solo rulesets.', { kind: { type: 'string', enum: ['oracle', 'scene', 'prompt', 'response'] }, question: s, likelihood: { type: 'string', enum: ['very-likely', 'likely', 'even', 'unlikely', 'very-unlikely'] } }, ['kind', 'question']),
  tool('offer_choices', 'Offer 2–4 possible next actions without choosing for the player. The player can always type something else.', { prompt: s, choices: { type: 'array', items: s, minItems: 2, maxItems: 4 } }),
  tool('withdraw_request', 'Withdraw an obsolete roll or choice card when the player changes their intention. Cannot withdraw already incurred damage. Never use this to reroll a resolved action.', { messageId: s, reason: s }),
];

const ACTION_LABELS: Record<string, string> = {
  get_context: 'Reviewed the table', search_rules: 'Consulted the rules', search_sourcebook: 'Searched the sourcebooks', read_sourcebook_page: 'Read a sourcebook page', get_character: 'Reviewed a hero sheet', get_adversary: 'Reviewed an adversary', set_memory: 'Updated GM secrets', set_resume_note: 'Recorded where play stopped', update_state: 'Updated the campaign state', journal_add: 'Wrote a journal note', search_journal: 'Searched the journal', journal_read: 'Read the journal', canon_write: 'Wrote canon', canon_search: 'Searched canon', canon_read: 'Read canon', list_campaign_frames: 'Reviewed campaign frames', load_campaign_frame: 'Opened a campaign frame', write_prep: 'Prepared the world', write_note: 'Recorded a note', create_scene: 'Created a scene', activate_scene: 'Changed the scene', place_token: 'Placed a miniature', move_token: 'Moved a miniature', fog_area: 'Updated scene fog', draw_on_scene: 'Annotated the map', set_condition: 'Updated a condition', set_spotlight: 'Passed the spotlight', add_adversary: 'Added an adversary', request_roll: 'Requested a hero roll', adversary_attack: 'Resolved an adversary attack', deal_damage: 'Dealt damage', mark_stress: 'Marked Stress', spend_fear: 'Spent Fear', create_countdown: 'Started a countdown', advance_countdown: 'Advanced a countdown', roll_loot: 'Rolled a reward', give_item: 'Added an inventory reward', solo_oracle: 'Consulted the oracle', offer_choices: 'Offered a choice', withdraw_request: 'Withdrew an obsolete request',
};

export interface ActionContext {
  campaign: string; owner: string; turn: string; callId: string;
  /** Session that receives messages and journal entries. Defaults to the open session. */
  chat?: string;
  /** Query embedding for hybrid search tools, computed by the service before the call. */
  queryVector?: Float32Array | null;
  assertActive: () => void;
  publish: (campaign: string, ns: string, id: string, value: unknown) => void;
  publishRoll: (campaign: string, kind: string, result: unknown) => void;
}

function compactRule(item: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).slice(0, 10).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 280) : value]));
}

/** A hero's loadout card by ID: name, domain, level and type. Full text comes from search_rules with the ID. */
function cardView(id: string): Record<string, unknown> {
  const card = getDomainCard(id);
  return card ? { id: card.id, name: card.name, domain: card.domain, level: card.level, type: card.type } : { id, name: null };
}

/** A compact but complete read of one hero sheet, with catalog IDs next to every name. */
function characterView(sheet: Sheet): Record<string, unknown> {
  const cls = getClass(sheet.classId), subclass = getSubclass(sheet.classId, sheet.subclassId), community = getCommunity(sheet.communityId), equipped = getArmor(sheet.armorId, sheet);
  const slot = (name: 'primary' | 'secondary') => {
    const entry = sheet.weapons.find(item => item.slot === name);
    return entry ? { id: entry.weaponId, name: weaponForSlot(sheet, name)?.name ?? null } : null;
  };
  return {
    id: sheet.id,
    name: sheet.name,
    level: sheet.level,
    proficiency: sheet.proficiency,
    class: { id: sheet.classId, name: cls?.name ?? null },
    subclass: sheet.subclassId ? { id: sheet.subclassId, name: subclass?.name ?? null } : null,
    heritage: heritageDisplayName(sheet),
    ancestries: sheetAncestries(sheet).map(entry => ({ id: entry.id, name: entry.name })),
    community: sheet.communityId ? { id: sheet.communityId, name: community?.name ?? null } : null,
    traits: sheet.traits,
    hp: { marked: sheet.hpMarked, max: hpMax(sheet) },
    stress: { marked: sheet.stressMarked, max: stressMax(sheet) },
    hope: { current: sheet.hope, max: MAX_HOPE },
    armor: { id: sheet.armorId, name: equipped?.name ?? null, marked: sheet.armorSlotsMarked, max: armorScore(sheet) },
    evasion: evasion(sheet),
    weapons: { primary: slot('primary'), secondary: slot('secondary') },
    experiences: sheet.experiences.map(item => ({ name: item.name, modifier: item.modifier })),
    loadout: sheet.loadoutIds.map(cardView),
    inventory: sheet.inventory.map(entry => ({ name: entry.name, qty: entry.qty, kind: entry.kind, catalogId: entry.catalogId ?? null })),
    /** Current class-feature resources: Ranger's Focus target and unspent Seraph Prayer Dice. */
    resources: {
      focusTargetId: sheet.resources?.focusTargetId ?? null,
      prayerDice: [...(sheet.resources?.prayerDice ?? [])],
      /**
       * The current value of every class-resource tracker visible on this sheet (Bard Rally,
       * Witch phase, and so on) so the GM never silently overwrites a value the player tracks
       * manually. Read-only: adjusting a tracker is a player decision.
       */
      classResources: Object.fromEntries(classResourceDefinitions(sheet).map(definition => [definition.id, classResourceValue(sheet, definition.id)])),
    },
  };
}

export class GmActions {
  readonly journal: AiJournal;
  readonly chats: AiChats;
  readonly canon: AiCanon;
  constructor(private db: Database.Database, private campaigns: CampaignService, readonly embeddings?: EmbeddingIndex) {
    this.journal = new AiJournal(db, embeddings);
    this.chats = new AiChats(db);
    this.canon = new AiCanon(db, embeddings);
  }

  /** Snippet length for journal and canon searches: larger budgets and context windows get longer hits. */
  private snippetChars(campaign: string): number {
    const settings = this.db.prepare('SELECT owner_id, context_budget FROM campaign_ai WHERE campaign_id = ?').get(campaign) as { owner_id: string; context_budget: string } | undefined;
    if (!settings) return 600;
    const credential = this.db.prepare('SELECT model, context_window FROM ai_credentials WHERE user_id = ?').get(settings.owner_id) as { model: string; context_window: number } | undefined;
    const contextWindow = credential ? effectiveContextWindow(credential.model, credential.context_window) : 0;
    const budget: AiBudget = ['lean', 'balanced', 'rich', 'maximum'].includes(settings.context_budget) ? settings.context_budget as AiBudget : 'balanced';
    return limitsFor(budget, contextWindow).snippetChars;
  }
  read<T = Record<string, any>>(campaign: string, ns: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = ? AND id = ?').get(campaign, ns, id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }
  docs(campaign: string, ns: string): { id: string; value: Record<string, any> }[] {
    return (this.db.prepare('SELECT id, value FROM campaign_docs WHERE campaign_id = ? AND ns = ? ORDER BY updated DESC').all(campaign, ns) as { id: string; value: string }[]).map(row => ({ id: row.id, value: JSON.parse(row.value) as Record<string, any> }));
  }
  write(campaign: string, ns: string, id: string, value: unknown): void {
    this.db.prepare('INSERT INTO campaign_docs(campaign_id,ns,id,value,updated) VALUES (?,?,?,?,?) ON CONFLICT(campaign_id,ns,id) DO UPDATE SET value=excluded.value,updated=excluded.updated').run(campaign, ns, id, JSON.stringify(value), new Date().toISOString());
  }
  message(campaign: string, chat: string | null, turn: string | null, role: string, body: string, interaction?: AiInteraction): string {
    const id = randomUUID(), at = new Date().toISOString();
    this.db.prepare('INSERT INTO ai_messages(id,campaign_id,turn_id,chat_id,role,text,interaction,created) VALUES (?,?,?,?,?,?,?,?)').run(id, campaign, turn, chat, role, body, interaction ? JSON.stringify(interaction) : null, at);
    if (chat) this.chats.touch(chat, at);
    return id;
  }
  readState(campaign: string): AiState {
    const row = this.db.prepare('SELECT state FROM campaign_ai WHERE campaign_id = ?').get(campaign) as { state: string } | undefined;
    if (!row) return emptyState();
    try { return normalizeState(JSON.parse(row.state)); } catch { return emptyState(); }
  }
  writeState(campaign: string, state: AiState): void {
    this.db.prepare('UPDATE campaign_ai SET state = ?, updated = ? WHERE campaign_id = ?').run(JSON.stringify(state), new Date().toISOString(), campaign);
  }
  snapshot(campaign: string, owner: string): Record<string, unknown> {
    const solo = hasFeature(this.campaigns.configuration(campaign), 'daggerheart.solo') ? new SoloService(this.db, this.campaigns).snapshot(owner, campaign) : null;
    return Object.assign(snapshotFor(this.db, this, campaign), { state: this.readState(campaign), solo: solo ? solo.state : null });
  }
  isHiddenCombat(campaign: string, combatId: string): boolean { return this.hiddenToken(campaign, combatId); }
  /** GM secrets must be text of at most SECRETS_LIMIT characters. Longer text is refused, never cut. */
  secretsText(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Invalid memory: send the secrets as text.');
    const memory = value.trim();
    if (memory.length > SECRETS_LIMIT) throw new Error('Invalid memory: at most 4000 characters. Rewrite a shorter version.');
    return memory;
  }
  preparationDocs(campaign: string): { kind: string; id: string; title: string; fields: Record<string, unknown> }[] {
    const docs = this.docs(campaign, 'gm').filter(doc => doc.value.kind === 'setting' || doc.value.kind === 'scenario');
    const ordered = [...docs.filter(doc => doc.value.kind === 'setting'), ...docs.filter(doc => doc.value.kind === 'scenario').slice(0, 3)];
    return ordered.map(doc => ({ kind: String(doc.value.kind), id: doc.id, title: String(doc.value.title ?? ''), fields: (doc.value.fields ?? {}) as Record<string, unknown> }));
  }
  imageAssets(campaign: string): { id: string; name: string; mediaType: string }[] {
    return this.db.prepare("SELECT id, name, media_type AS mediaType FROM campaign_assets WHERE campaign_id = ? AND media_type LIKE 'image/%' ORDER BY created_at DESC LIMIT 12").all(campaign) as { id: string; name: string; mediaType: string }[];
  }
  private hiddenToken(campaign: string, combatId: string): boolean {
    if (!combatId) return false;
    return this.docs(campaign, 'map').some(doc => doc.id.indexOf('token:') === 0 && doc.value.combatRefId === combatId && doc.value.hidden === true);
  }
  private recordEvent(name: string, args: Record<string, unknown>, result: unknown, campaign: string, chat: string, turn: string): void {
    const data = (result && typeof result === 'object' ? result : {}) as Record<string, any>;
    const note = (title: string, body: string, visibility: 'shared' | 'gm' = 'shared') => this.journal.event(campaign, chat, turn, title, body, visibility);
    if (name === 'create_scene') note('Scene · ' + String(data.name), 'The active scene changed.', 'shared');
    else if (name === 'activate_scene') {
      const scene = this.read<Record<string, any>>(campaign, 'map', 'scene:' + text(args.sceneId, 120));
      note('Scene · ' + String(scene ? scene.name : 'changed'), '');
    }
    else if (name === 'add_adversary') note('Encounter · ' + String(data.name) + ' joins the scene', '', this.hiddenToken(campaign, String(data.adversaryId ?? '')) ? 'gm' : 'shared');
    else if (name === 'adversary_attack') {
      const enemyId = text(args.adversaryId, 120);
      const enemy = this.read<Record<string, any>>(campaign, 'combat', enemyId);
      const hero = this.read<Record<string, any>>(campaign, 'sheets', text(args.heroId, 120));
      const target = hero ? String(hero.name) : 'the hero';
      const outcome = data.hit === true ? 'hits ' + target + ' for ' + String(data.damage) : 'misses ' + target;
      note('Attack · ' + String(enemy ? enemy.name : 'Adversary') + ' ' + outcome, 'Attack roll ' + String(data.attack) + '.', this.hiddenToken(campaign, enemyId) ? 'gm' : 'shared');
    }
    else if (name === 'deal_damage') {
      const sheet = this.read<Record<string, any>>(campaign, 'sheets', text(args.heroId, 120));
      note('Damage · ' + String(sheet?.name ?? 'A hero') + ' takes ' + String(data.damage) + ' damage' + (data.direct === true ? ' (direct)' : '') + (data.condition ? ' and is ' + String(data.condition) : ''), text(args.reason, 800, ''));
    }
    else if (name === 'mark_stress') {
      const sheet = this.read<Record<string, any>>(campaign, 'sheets', text(args.heroId, 120));
      note('Stress · ' + String(sheet?.name ?? 'A hero') + ' marks ' + String(data.stress) + ' Stress' + (data.overflowHp === true ? ' (1 HP overflow)' : ''), text(args.reason, 800, ''));
    }
    else if (name === 'spend_fear') note('Fear · GM spent ' + String(data.spent) + ' Fear (' + String(data.remaining) + ' left)', text(args.reason, 800, ''), 'shared');
    else if (name === 'create_countdown') note('Countdown · ' + text(args.name, 200) + ' started at ' + String(data.remaining), '', 'shared');
    else if (name === 'advance_countdown') {
      const countdown = this.read<Record<string, any>>(campaign, 'combat', text(args.countdownId, 120));
      const label = countdown ? String(countdown.name) : 'Countdown';
      note('Countdown · ' + label + ' is at ' + String(data.remaining) + (data.complete === true ? ' (complete)' : ''), text(args.reason, 800, ''), countdown && countdown.visible === false ? 'gm' : 'shared');
    }
    else if (name === 'roll_loot') note('Reward · ' + String(data.name) + ' (' + String(data.tableName ?? text(args.table, 20)) + ' · ' + String(data.total) + ' from ' + String((data.dice as unknown[] | undefined)?.length ?? 1) + 'd12)', String(data.description ?? ''), 'shared');
    else if (name === 'give_item') note('Reward · ' + String(data.hero) + ' received ' + String(data.quantity) + 'x ' + String(data.given), '', 'shared');
    else if (name === 'set_condition') {
      const target = text(args.targetId, 120);
      const isToken = target.indexOf('token:') === 0;
      const doc = this.read<Record<string, any>>(campaign, isToken ? 'map' : 'combat', target);
      const hidden = isToken ? doc !== undefined && doc.hidden === true : this.hiddenToken(campaign, target);
      note('Condition · ' + text(args.condition, 30) + ' ' + (args.active === true ? 'applied to' : 'cleared from') + ' ' + String(doc ? doc.name : 'a target'), text(args.reason, 800, ''), hidden ? 'gm' : 'shared');
    }
  }
  execute(name: string, raw: unknown, ctx: ActionContext): unknown {
    ctx.assertActive(); this.campaigns.requireGm(ctx.owner, ctx.campaign);
    const previous = this.db.prepare('SELECT result FROM ai_actions WHERE turn_id = ? AND call_id = ?').get(ctx.turn, ctx.callId) as { result: string } | undefined;
    if (previous) return JSON.parse(previous.result) as unknown;
    if (!GM_TOOLS.some(tool => tool.name === name)) throw new Error('Invalid GM tool');
    const args = record(raw), changed: { ns: string; id: string; value: unknown }[] = [];
    const rolls: { kind: string; result: unknown }[] = [];
    const chat = ctx.chat ? ctx.chat : this.chats.resolveActive(ctx.campaign, null);
    const put = (ns: string, id: string, value: unknown) => { this.write(ctx.campaign, ns, id, value); changed.push({ ns, id, value }); };
    const hero = (id: unknown) => {
      const value = this.read<Sheet>(ctx.campaign, 'sheets', text(id, 120));
      if (!value) throw new Error('Invalid hero'); return value;
    };
    const activeScene = () => {
      const active = this.read(ctx.campaign, 'map', 'active');
      const scene = active && this.read(ctx.campaign, 'map', 'scene:' + active.sceneId);
      if (!scene) throw new Error('Invalid scene: create or activate a scene first'); return scene;
    };
    let result: unknown;
    this.db.transaction(() => {
      ctx.assertActive();
      if (name === 'get_context') result = { ...this.snapshot(ctx.campaign, ctx.owner), preparations: this.preparationDocs(ctx.campaign), assets: this.imageAssets(ctx.campaign) };
      else if (name === 'search_rules') {
        const catalog: Record<string, readonly { id: string }[]> = { adversaries, ancestries, communities, environments, items, consumables, weapons, armor, cards: domainCards, classes, transformations };
        const category = text(args.category, 30), query = text(args.query, 200, '').toLowerCase(), id = text(args.id, 120, '');
        if (!Object.hasOwn(catalog, category)) throw new Error('Invalid catalog category');
        if (id) {
          const entry = catalog[category]!.find(item => item.id === id);
          if (!entry) throw new Error('Invalid rule ID');
          result = entry;
        } else {
          void this.embeddings?.ensureCatalog();
          const matches = catalog[category]!.filter(item => JSON.stringify(item).toLowerCase().indexOf(query) >= 0);
          const semantic = ctx.queryVector ? catalogSemantic(ctx.queryVector, { category, limit: 12 }) : [];
          if (!semantic.length) result = matches.slice(0, 6).map(compactRule);
          else {
            const chosen: string[] = matches.slice(0, 6).map(item => item.id);
            const merged: Record<string, unknown>[] = matches.slice(0, 6).map(compactRule);
            for (const hit of semantic) {
              if (chosen.includes(hit.entry.id) || chosen.length >= 6) continue;
              chosen.push(hit.entry.id);
              merged.push(compactRule(hit.entry.entry));
            }
            result = merged;
          }
        }
      }
      else if (name === 'search_sourcebook') {
        const query = text(args.query, 500);
        if (!query) throw new Error('Invalid search: a query is required');
        const source = text(args.source, 80, '');
        // Pick up a sourcebook added at runtime and (re)embed only books whose content changed.
        void this.embeddings?.ensureSourcebooks();
        const hits = searchSourcebooks(query, { source: source || undefined, limit: integer(args.limit, 1, 12, 6), queryVector: ctx.queryVector, embedderModel: this.embeddings?.model ?? undefined });
        const sources = listSourcebooks();
        result = {
          results: hits,
          sources,
          ...(hits.length ? {} : { note: sources.length ? 'No matching page. Try fewer or different words, or another source.' : 'No sourcebooks are installed. The GM can still use search_rules and canon.' }),
        };
      }
      else if (name === 'read_sourcebook_page') {
        const read = readSourcebookPage(text(args.source, 80), integer(args.page, 1, 100000), integer(args.pages, 1, 2, 1));
        if (!read) throw new Error('Invalid sourcebook page: use search_sourcebook to find the source and page first');
        result = read;
      }
      else if (name === 'get_character') result = characterView(hero(args.heroId));
      else if (name === 'get_adversary') {
        const id = text(args.adversaryId, 120), doc = this.read<Record<string, any>>(ctx.campaign, 'combat', id);
        const source = doc?.kind === 'adversary' ? adversaries.find(item => item.id === doc.catalogId) : undefined;
        if (!doc || !source) throw new Error('Invalid adversary');
        result = {
          id: source.id, name: source.name, type: source.type, difficulty: source.difficulty,
          attack: { modifier: source.attack.modifier, damage: source.attack.damage },
          thresholds: source.thresholds ?? null, hp: source.hp, stress: source.stress,
          features: source.features.map(feature => ({ name: feature.name, kind: feature.kind, text: feature.text })),
          adversaryId: id, tableName: doc.name,
          hpMarked: doc.hpMarked, stressMarked: doc.stressMarked, defeated: doc.defeated ?? 0, groupSize: doc.groupSize ?? null,
          conditions: Object.keys(doc.conditions ?? {}).filter(key => doc.conditions[key] === true),
        };
      }
      else if (name === 'set_memory') {
        this.db.prepare('UPDATE campaign_ai SET memory = ?, updated = ? WHERE campaign_id = ?').run(this.secretsText(args.memory), new Date().toISOString(), ctx.campaign); result = { saved: true };
      }
      else if (name === 'set_resume_note') {
        const note = typeof args.note === 'string' ? args.note.trim() : '';
        if (!note || note.length > 1500) throw new Error('Invalid resume note: at most 1500 characters.');
        this.chats.setResumeNote(ctx.campaign, chat, note); result = { saved: true };
      }
      else if (name === 'update_state') {
        const next = applyStatePatch(this.readState(ctx.campaign), args);
        this.writeState(ctx.campaign, next);
        result = { saved: true, threads: next.threads.length, npcs: next.npcs.length, promises: next.promises.length, facts: next.facts.length };
      }
      else if (name === 'journal_add') {
        const written = this.db.prepare("SELECT COUNT(*) AS n FROM ai_journal WHERE turn_id = ? AND kind = 'note' AND author = 'gm'").get(ctx.turn) as { n: number };
        if (written.n >= 3) throw new Error('Invalid journal entry: at most three notes per turn');
        const title = text(args.title, 160), body = text(args.body, 1200);
        if (!title || !body) throw new Error('Invalid journal entry: a title and body are required');
        const shared = args.shared === true;
        const id = this.journal.insert(ctx.campaign, { chat, turn: ctx.turn, kind: 'note', title, body, visibility: shared ? 'shared' : 'gm', author: 'gm' });
        result = { id, shared };
      }
      else if (name === 'search_journal') {
        result = this.journal.search(ctx.campaign, true, text(args.query, 200, ''), integer(args.limit, 1, 6, 4), { snippetChars: this.snippetChars(ctx.campaign), queryVector: ctx.queryVector });
      }
      else if (name === 'journal_read') {
        const entry = this.journal.view(ctx.campaign, text(args.id, 120), true);
        if (!entry) throw new Error('Invalid journal entry');
        result = entry;
      }
      else if (name === 'canon_write') {
        const id = text(args.id, 120, '');
        result = this.canon.upsert(ctx.campaign, { ...(id ? { id } : {}), kind: args.kind, title: args.title, body: args.body, visibility: args.visibility, source: args.source });
      }
      else if (name === 'canon_search') {
        const kind = text(args.kind, 30, '');
        if (kind) canonKind(kind);
        result = this.canon.search(ctx.campaign, text(args.query, 200, ''), integer(args.limit, 1, 10, 6), kind ? [kind] : undefined, false, { queryVector: ctx.queryVector })
          .map(entry => ({ id: entry.id, kind: entry.kind, title: entry.title, body: entry.body.slice(0, this.snippetChars(ctx.campaign)) }));
      }
      else if (name === 'canon_read') {
        const entry = this.canon.get(ctx.campaign, text(args.id, 120));
        if (!entry) throw new Error('Invalid canon entry');
        result = entry;
      }
      else if (name === 'list_campaign_frames') {
        const installed = new Set(listSourcebooks().map(book => book.sourceId));
        result = CAMPAIGN_FRAMES.map(frame => ({
          id: frame.id, title: frame.title, source: frame.source,
          pageStart: frame.pageStart, pageEnd: frame.pageEnd,
          summary: frame.summary, installed: installed.has(frame.source),
        }));
      }
      else if (name === 'load_campaign_frame') {
        const frame = findCampaignFrame(text(args.id, 120));
        if (!frame) throw new Error('Invalid campaign frame');
        const marker = 'frame:' + frame.id;
        let seeded = false;
        if (!this.read(ctx.campaign, 'gm', marker)) {
          const at = new Date().toISOString();
          const fields = {
            premise: frame.summary,
            tone: frame.seed.tone,
            locations: frame.seed.locations.join('; '),
            factions: frame.seed.factions.join('; '),
            secrets: '',
            agreements: '',
            hook: frame.seed.hooks.join('; '),
            stakes: '',
            scenes: '',
            cast: frame.seed.npcs.join('; '),
            rewards: '',
            aftermath: '',
          };
          put('gm', 'scenario:' + marker, { kind: 'scenario', title: frame.title + ' (campaign frame)', fields, environmentId: '', status: 'planned', updated: at });
          if (!this.docs(ctx.campaign, 'gm').some(doc => doc.value.kind === 'setting')) {
            put('gm', 'setting', {
              kind: 'setting',
              title: frame.title + ' (campaign frame)',
              fields: { premise: frame.summary, tone: frame.seed.tone, locations: frame.seed.locations.join('; '), factions: frame.seed.factions.join('; '), secrets: '', agreements: '' },
              environmentId: '', status: 'planned', updated: at,
            });
          }
          const seeds: { kind: string; title: string; body: string }[] = [
            { kind: 'fact', title: frame.title + ' · premise', body: frame.summary },
            { kind: 'fact', title: frame.title + ' · tone', body: frame.seed.tone },
            ...frame.seed.factions.map(name => ({ kind: 'faction', title: name, body: 'Frame faction from ' + frame.title + '.' })),
            ...frame.seed.npcs.map(name => ({ kind: 'person', title: name, body: 'Frame NPC from ' + frame.title + '.' })),
            ...frame.seed.locations.map(name => ({ kind: 'location', title: name, body: 'Frame location from ' + frame.title + '.' })),
            ...frame.seed.hooks.map(hook => ({ kind: 'rumor', title: hook, body: 'Starting hook from ' + frame.title + '.' })),
          ];
          for (const seed of seeds) this.canon.upsert(ctx.campaign, { ...seed, visibility: 'gm', source: frame.title });
          this.write(ctx.campaign, 'gm', marker, { frameId: frame.id, loadedAt: at });
          seeded = true;
        }
        const page = integer(args.page, frame.pageStart, frame.pageEnd, frame.pageStart);
        const read = readSourcebookPage(frame.source, page, Math.min(2, frame.pageEnd - page + 1));
        if (!read) throw new Error('Invalid campaign frame pages: install its sourcebook with tools/extract_sources.py first');
        const nextPage = page + read.pages.length <= frame.pageEnd ? page + read.pages.length : null;
        result = {
          frame: { id: frame.id, title: frame.title, source: frame.source, pageStart: frame.pageStart, pageEnd: frame.pageEnd, summary: frame.summary },
          seeded, page, nextPage, text: read.text, truncated: read.truncated,
        };
      }
      else if (name === 'write_prep') {
        const kind = text(args.kind, 20); if (!['setting', 'scenario'].includes(kind)) throw new Error('Invalid preparation kind');
        const fields = record(args.fields); if (Object.keys(fields).length > 12) throw new Error('Invalid fields');
        const id = kind === 'setting' ? 'setting' : text(args.id, 120, 'scenario:' + randomUUID());
        const existing = this.read(ctx.campaign, 'gm', id);
        if (existing && existing.kind !== kind) throw new Error('Invalid preparation ID: belongs to another document kind');
        const value = { kind, title: text(args.title, 200), fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [text(key, 60), text(value, 6000)])), environmentId: '', status: 'planned', updated: new Date().toISOString() };
        put('gm', id, value); result = { id, saved: true };
      }
      else if (name === 'write_note') {
        result = { id: this.campaigns.saveNote(ctx.owner, ctx.campaign, null, text(args.title, 200), text(args.body, 10000), args.shared === true ? 'shared' : 'private') };
      }
      else if (name === 'create_scene') {
        const id = randomUUID(); const value: Record<string, unknown> = { id, name: text(args.name, 100), order: this.docs(ctx.campaign, 'map').filter(doc => doc.id.indexOf('scene:') === 0).length, cols: integer(args.cols, 6, 100, 30), rows: integer(args.rows, 6, 100, 20), cell: 100, offsetX: 0, offsetY: 0, showGrid: true, boardStyle: 'midnight', ranges: [1, 3, 6, 12, 13] };
        if (args.assetId) {
          const asset = this.db.prepare("SELECT id FROM campaign_assets WHERE campaign_id = ? AND id = ? AND media_type LIKE 'image/%'").get(ctx.campaign, text(args.assetId, 120));
          if (!asset) throw new Error('Invalid map asset'); value.mapUrl = '/api/campaigns/' + ctx.campaign + '/assets/' + text(args.assetId, 120);
        }
        put('map', 'scene:' + id, value); put('map', 'active', { sceneId: id }); result = { sceneId: id, name: value.name };
      }
      else if (name === 'activate_scene') {
        const id = text(args.sceneId, 120); if (!this.read(ctx.campaign, 'map', 'scene:' + id)) throw new Error('Invalid scene');
        put('map', 'active', { sceneId: id }); result = { sceneId: id };
      }
      else if (name === 'place_token' || name === 'add_adversary') {
        const scene = activeScene(), id = randomUUID();
        let refId: string | undefined, combatId: string | undefined;
        let label = text(args.name, 100, name === 'add_adversary' ? 'Adversary' : 'Miniature');
        if (name === 'add_adversary') {
          const source = adversaries.find(item => item.id === args.catalogId); if (!source) throw new Error('Invalid adversary source');
          label = text(args.name, 100, source.name); combatId = 'adv:' + randomUUID();
          put('combat', combatId, { kind: 'adversary', sceneId: scene.id, catalogId: source.id, name: label, addedAt: Date.now(), hpMarked: 0, stressMarked: 0, groupSize: source.type === 'Minion' ? 1 : null, defeated: 0, conditions: { vulnerable: false, restrained: false, hidden: false }, counters: [] });
        } else if (args.heroId) refId = hero(args.heroId).id;
        const x = number(args.x, 0, scene.cols - 1, 3), y = number(args.y, 0, scene.rows - 1, 3);
        put('map', 'token:' + id, { id, name: label, sceneId: scene.id, kind: combatId ? 'adversary' : refId ? 'character' : 'npc', ...(refId ? { refId } : {}), ...(combatId ? { combatRefId: combatId } : {}), x: x * scene.cell, y: y * scene.cell, size: 1, hidden: false, color: combatId ? '#b1344a' : '#e5b04b', conditions: [], rotation: 0 });
        result = { tokenId: 'token:' + id, adversaryId: combatId, name: label };
      }
      else if (name === 'move_token') {
        const id = text(args.tokenId, 120), token = this.read(ctx.campaign, 'map', id); if (!token || id.indexOf('token:') !== 0) throw new Error('Invalid token');
        const scene = this.read(ctx.campaign, 'map', 'scene:' + token.sceneId); if (!scene) throw new Error('Invalid scene');
        put('map', id, { ...token, x: number(args.x, 0, scene.cols - 1) * scene.cell, y: number(args.y, 0, scene.rows - 1) * scene.cell }); result = { moved: id };
      }
      else if (name === 'fog_area') {
        const scene = activeScene(), id = randomUUID(), x = number(args.x, 0, scene.cols) * scene.cell, y = number(args.y, 0, scene.rows) * scene.cell;
        const width = number(args.width, .1, scene.cols) * scene.cell, height = number(args.height, .1, scene.rows) * scene.cell;
        put('map', 'fog:' + id, { id, sceneId: scene.id, mode: args.reveal === true ? 'reveal' : 'hide', points: [x, y, x + width, y, x + width, y + height, x, y + height], order: Date.now() }); result = { fogId: id };
      }
      else if (name === 'draw_on_scene') {
        const scene = activeScene(), id = randomUUID(), kind = text(args.kind, 20);
        if (!['line', 'rect', 'ellipse', 'text'].includes(kind)) throw new Error('Invalid drawing kind');
        const x = number(args.x, 0, scene.cols) * scene.cell, y = number(args.y, 0, scene.rows) * scene.cell;
        const width = number(args.width, 0, scene.cols) * scene.cell, height = number(args.height, 0, scene.rows) * scene.cell;
        put('map', 'drawing:' + id, { id, sceneId: scene.id, kind, points: [x, y, x + width, y + height], width: 3, color: '#e5b04b', ...(kind === 'text' ? { text: text(args.text, 500), fontSize: 24 } : {}) }); result = { drawingId: id };
      }
      else if (name === 'set_condition') {
        const id = text(args.targetId, 120), condition = text(args.condition, 30);
        if (!['vulnerable', 'restrained', 'hidden'].includes(condition) || typeof args.active !== 'boolean') throw new Error('Invalid condition');
        const ns = id.indexOf('token:') === 0 ? 'map' : 'combat', target = this.read(ctx.campaign, ns, id);
        if (!target || ns === 'combat' && target.kind !== 'adversary') throw new Error('Invalid condition target');
        if (ns === 'combat') put(ns, id, { ...target, conditions: { ...target.conditions, [condition]: args.active } });
        else {
          const label = condition.charAt(0).toUpperCase() + condition.slice(1), conditions = (target.conditions as string[]).filter(item => item.toLowerCase() !== condition);
          if (args.active) conditions.push(label); put(ns, id, { ...target, conditions });
          if (target.combatRefId) {
            const linked = this.read(ctx.campaign, 'combat', target.combatRefId);
            if (linked?.kind === 'adversary') put('combat', target.combatRefId, { ...linked, conditions: { ...linked.conditions, [condition]: args.active } });
          }
        }
        result = { targetId: id, condition, active: args.active, reason: text(args.reason, 800) };
      }
      else if (name === 'set_spotlight') {
        const holder = text(args.holder, 120), key = holder === 'GM' ? 'GM' : 'sheet:' + hero(holder).id;
        const current = this.read(ctx.campaign, 'combat', 'spotlight') ?? { kind: 'spotlight', tokensOn: false, tokenMax: 3, tokens: {} };
        put('combat', 'spotlight', { ...current, holder: key }); result = { holder: key, reason: text(args.reason, 800) };
      }
      else if (name === 'request_roll') {
        const sheet = hero(args.heroId); let trait = text(args.trait, 20);
        if (!['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'].includes(trait)) throw new Error('Invalid trait');
        const pending = this.db.prepare("SELECT id FROM ai_messages WHERE campaign_id = ? AND json_extract(interaction,'$.kind') = 'roll' AND json_extract(interaction,'$.resolved') = 0 LIMIT 1").get(ctx.campaign);
        if (pending) throw new Error('Invalid action: wait for the pending player roll');
        let difficulty = integer(args.difficulty, 1, 40); const enemyId = text(args.enemyId, 120, '');
        if (enemyId) {
          const enemy = this.read(ctx.campaign, 'combat', enemyId); const source = adversaries.find(item => item.id === enemy?.catalogId);
          if (!source) throw new Error('Invalid attack target');
          difficulty = source.difficulty;
          const weapon = weaponForSlot(sheet, 'primary'); if (!weapon) throw new Error('Invalid attack: equip a primary weapon');
          trait = weapon.trait.toLowerCase();
          if (trait === 'spellcast') trait = spellcastTraitName(sheet) ?? trait;
        }
        const id = this.message(ctx.campaign, chat, ctx.turn, 'gm', text(args.reason, 1500), { kind: 'roll', resolved: false, heroId: sheet.id, trait, difficulty, ...(enemyId ? { enemyId } : {}) });
        result = { requestId: id, hero: sheet.name, difficulty, waitingForPlayer: true };
      }
      else if (name === 'adversary_attack') {
        const enemy = this.read(ctx.campaign, 'combat', text(args.adversaryId, 120)), source = adversaries.find(item => item.id === enemy?.catalogId), sheet = hero(args.heroId);
        if (!enemy || !source || enemy.hpMarked >= source.hp || source.type === 'Minion' && enemy.defeated >= (enemy.groupSize ?? 1)) throw new Error('Invalid or defeated adversary');
        // Most adversaries have a flat attack modifier; some, like the Outer Realms Abomination, roll dice for it.
        const rawModifier = source.attack.modifier;
        const modifierNotation = typeof rawModifier === 'string' ? rawModifier : String(integer(Number(rawModifier), -30, 30));
        const attack = rollDice('1d20' + (modifierNotation.startsWith('-') ? '' : '+') + modifierNotation); rolls.push({ kind: 'dice', result: attack });
        const hit = attack.rolls[0] === 20 || attack.total >= evasion(sheet);
        let damage = 0;
        if (hit) {
          const notation = hordeDamage(source.features, enemy.hpMarked, source.hp, source.attack.damage);
          const rolled = rollDice(notation); damage = rolled.total;
          if (attack.rolls[0] === 20) damage += maxDiceTotal(notation);
          rolls.push({ kind: 'dice', result: rolled });
        }
        this.message(ctx.campaign, chat, ctx.turn, 'roll', enemy.name + ': attack ' + attack.total + ' vs ' + sheet.name + '’s Evasion ' + evasion(sheet) + ' — ' + (hit ? damage + ' damage' : 'miss') + '. ' + text(args.reason, 800), hit ? { kind: 'damage', resolved: false, heroId: sheet.id, damage, direct: false } : undefined);
        result = { hit, attack: attack.total, damage, playerConfirmsDamage: hit };
      }
      else if (name === 'deal_damage') {
        const sheet = hero(args.heroId), raw = text(args.damage, 40).trim(), direct = args.direct === true;
        let damage = 0;
        if (/^\d+$/.test(raw)) damage = integer(Number(raw), 1, 200);
        else if (/^\d*d\d+([+-]\d+)?$/i.test(raw)) {
          const rolled = rollDice(raw); damage = rolled.total; rolls.push({ kind: 'dice', result: rolled });
        } else throw new Error('Invalid damage');
        const condition = text(args.condition, 20, '');
        if (condition && !['vulnerable', 'restrained', 'hidden'].includes(condition)) throw new Error('Invalid condition');
        let conditionApplied = false;
        if (condition) {
          const label = condition.charAt(0).toUpperCase() + condition.slice(1);
          for (const token of this.docs(ctx.campaign, 'map')) {
            if (token.id.indexOf('token:') !== 0 || token.value.refId !== sheet.id) continue;
            const conditions = ((token.value.conditions as string[] | undefined) ?? []).filter(item => item.toLowerCase() !== condition);
            conditions.push(label);
            put('map', token.id, { ...token.value, conditions });
            conditionApplied = true;
          }
        }
        const detail = `${sheet.name}: ${damage} damage${raw === String(damage) ? '' : ` (${raw})`}${direct ? ' — direct, Armor ignored' : ''}${condition ? ` — ${condition}` : ''}. ${text(args.reason, 800)}`;
        const id = this.message(ctx.campaign, chat, ctx.turn, 'roll', detail, { kind: 'damage', resolved: false, heroId: sheet.id, damage, direct });
        result = { damage, direct, condition: condition || null, conditionApplied, requestId: id, playerConfirmsDamage: true };
      }
      else if (name === 'mark_stress') {
        const sheet = hero(args.heroId), amount = integer(args.amount, 1, 12), next = markStress(sheet, amount);
        const overflow = next.hpMarked > sheet.hpMarked;
        put('sheets', sheet.id, { ...next, updatedAt: new Date().toISOString() });
        this.message(ctx.campaign, chat, ctx.turn, 'roll', `${sheet.name}: marks ${amount} Stress${overflow ? ' — the track is full, so 1 HP is marked' : ''}. ${text(args.reason, 800)}`);
        result = { hero: sheet.name, stress: amount, overflowHp: overflow };
      }
      else if (name === 'spend_fear') {
        const amount = integer(args.amount, 1, 12), fear = this.read(ctx.campaign, 'combat', 'fear') ?? { kind: 'fear', value: 0 };
        if (fear.value < amount) throw new Error('Invalid action: not enough Fear');
        put('combat', 'fear', { kind: 'fear', value: fear.value - amount }); result = { spent: amount, remaining: fear.value - amount, reason: text(args.reason, 800) };
      }
      else if (name === 'create_countdown') {
        const id = 'cd:' + randomUUID(), start = integer(args.start, 1, 20), sides = [4, 6, 8, 10, 12, 20].find(size => size >= start)!;
        put('combat', id, { kind: 'countdown', name: text(args.name, 200), start, sides, value: start, visible: true, addedAt: Date.now() }); result = { countdownId: id, remaining: start };
      }
      else if (name === 'advance_countdown') {
        const id = text(args.countdownId, 120), countdown = this.read(ctx.campaign, 'combat', id); if (countdown?.kind !== 'countdown') throw new Error('Invalid countdown');
        const remaining = Math.max(0, countdown.value - integer(args.amount, 1, 3)); put('combat', id, { ...countdown, value: remaining }); result = { countdownId: id, remaining, complete: remaining === 0, reason: text(args.reason, 800) };
      }
      else if (name === 'roll_loot') {
        const rarity = text(args.rarity, 20);
        const pools: Record<string, [number, number]> = { Common: [1, 2], Uncommon: [2, 3], Rare: [3, 4], Legendary: [4, 5] };
        const range = pools[rarity];
        if (!range || !['items', 'consumables'].includes(String(args.table))) throw new Error('Invalid loot table or rarity');
        const count = args.dice === undefined ? range[0] : integer(args.dice, range[0], range[1]);
        const additional = text(args.set, 20, 'core') === 'additional';
        const tableName = (args.table === 'items' ? (additional ? 'Additional Items' : 'Core Set Items') : (additional ? 'Additional Consumables' : 'Core Set Consumables'));
        const pool = (args.table === 'items' ? items : consumables) as readonly { id: string; name: string; description: string; rollTable?: { name: string; roll: number } | null }[];
        const entries = pool.filter(entry => entry.rollTable?.name === tableName);
        if (!entries.length) throw new Error('Invalid loot table');
        const dice = Array.from({ length: count }, () => rollDie(12)), total = dice.reduce((a, b) => a + b, 0);
        const item = entries.find(entry => entry.rollTable?.roll === total); if (!item) throw new Error('Invalid loot result');
        const value = { kind: 'loot', table: args.table, set: additional ? 'additional' : 'core', tableName, dice, total, itemId: item.id, name: item.name, description: item.description, note: text(args.note, 500, ''), updated: new Date().toISOString() };
        put('gm', 'loot:' + randomUUID(), value); result = value;
      }
      else if (name === 'give_item') {
        const sheet = hero(args.heroId), item = [...items, ...consumables].find(entry => entry.id === args.catalogId); if (!item) throw new Error('Invalid item');
        const qty = integer(args.quantity, 1, 5), kind = consumables.some(value => value.id === item.id) ? 'consumable' : 'item';
        const inventory = [...sheet.inventory]; const existing = inventory.find(entry => entry.catalogId === item.id && entry.kind === kind);
        if (existing) existing.qty += qty; else inventory.push({ id: randomUUID(), name: item.name, description: item.description, catalogId: item.id, qty, kind });
        put('sheets', sheet.id, { ...sheet, inventory, updatedAt: new Date().toISOString() }); result = { given: item.name, quantity: qty, hero: sheet.name };
      }
      else if (name === 'solo_oracle') {
        result = new SoloService(this.db, this.campaigns).roll(ctx.owner, ctx.campaign, { requestId: randomUUID(), kind: text(args.kind, 30), question: text(args.question, 2000), likelihood: text(args.likelihood, 30, 'even') });
      }
      else if (name === 'offer_choices') {
        if (!Array.isArray(args.choices) || args.choices.length < 2 || args.choices.length > 4) throw new Error('Invalid choices');
        const choices = args.choices.map(choice => text(choice, 300));
        result = { requestId: this.message(ctx.campaign, chat, ctx.turn, 'gm', text(args.prompt, 1000), { kind: 'choices', resolved: false, choices }), waitingForPlayer: true };
      }
      else if (name === 'withdraw_request') {
        const id = text(args.messageId, 120), row = this.db.prepare('SELECT interaction FROM ai_messages WHERE campaign_id = ? AND id = ?').get(ctx.campaign, id) as { interaction: string | null } | undefined;
        const interaction = row?.interaction ? JSON.parse(row.interaction) as AiInteraction : null;
        if (!interaction || interaction.resolved || interaction.kind === 'damage') throw new Error('Invalid request to withdraw');
        this.db.prepare('UPDATE ai_messages SET interaction = ? WHERE id = ?').run(JSON.stringify({ ...interaction, resolved: true }), id);
        this.message(ctx.campaign, chat, ctx.turn, 'notice', 'Request withdrawn: ' + text(args.reason, 800)); result = { withdrawn: id };
      }
      this.recordEvent(name, args, result, ctx.campaign, chat, ctx.turn);
      const encoded = JSON.stringify(result ?? { done: true });
      this.db.prepare('INSERT INTO ai_actions(id,campaign_id,turn_id,call_id,tool,label,result,created) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), ctx.campaign, ctx.turn, ctx.callId, name, ACTION_LABELS[name] ?? name, encoded, new Date().toISOString());
    })();
    for (const doc of changed) ctx.publish(ctx.campaign, doc.ns, doc.id, doc.value);
    for (const roll of rolls) ctx.publishRoll(ctx.campaign, roll.kind, roll.result);
    return result ?? { done: true };
  }
}
