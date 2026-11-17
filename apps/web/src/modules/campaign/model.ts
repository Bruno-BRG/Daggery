import type { LootDoc, PrepDoc } from './loot';

/**
 * The campaign page reuses the saved documents from the previous campaign preparation
 * page, so settings, scenarios and loot logs written before this page keep showing up:
 *
 * - `setting` keeps its single document id and field keys.
 * - `scenario:<uuid>` keeps the scenario kind and field keys; the page calls them threads.
 * - `loot` documents stay in the loot log.
 *
 * People and places are new document kinds in the same 'gm' namespace.
 */
export { lootEntries, lootTableName, RARITIES } from './loot';
export type { LootDoc, LootSet, LootTable, PrepDoc } from './loot';

/** A person in the story: an ally, a rival, or someone met on the road. */
export interface NpcDoc {
  kind: 'npc';
  name: string;
  /** Role or relationship, such as "the innkeeper" or "an old rival". */
  role: string;
  notes: string;
  updated: string;
}

/** A place the hero can visit. */
export interface PlaceDoc {
  kind: 'place';
  name: string;
  /** What kind of place it is: town, ruin, wilderness, and so on. */
  type: string;
  notes: string;
  updated: string;
}

export type EntityDoc = NpcDoc | PlaceDoc;
export type CampaignDoc = PrepDoc | LootDoc | NpcDoc | PlaceDoc;

/** The editable form for a person or place, with its second field normalised for the editor. */
export interface EntityDraft {
  name: string;
  /** `role` on a person, `type` on a place. */
  detail: string;
  notes: string;
}

export function entityDraft(doc?: EntityDoc): EntityDraft {
  if (!doc) return { name: '', detail: '', notes: '' };
  return { name: doc.name, detail: doc.kind === 'npc' ? doc.role : doc.type, notes: doc.notes };
}

/** Setting field keys match the previous setting, so old documents load unchanged. */
export const SETTING_FIELDS = [
  ['premise', 'Premise', 'What is this world about? What is changing?'],
  ['tone', 'Tone & themes', 'Touchstones, themes, and the kind of adventure you want.'],
  ['locations', 'Locations', 'Places worth visiting, and what makes each one matter.'],
  ['factions', 'Factions & people', 'Who wants what? Who stands in the hero’s way?'],
  ['secrets', 'Secrets & open questions', 'What is hidden, and what will you discover together?'],
  ['agreements', 'Your agreements', 'Lines, veils, and the expectations you keep at your table.'],
] as const;

/** Thread field keys match the previous scenario, so saved scenarios appear as threads. */
export const THREAD_FIELDS = [
  ['hook', 'Hook & opening', 'Why does your hero care? Where does the story begin?'],
  ['stakes', 'Stakes & pressure', 'What happens if no one intervenes? What is running out?'],
  ['scenes', 'Scenes & discoveries', 'Locations, clues, obstacles, and possible developments.'],
  ['cast', 'People & adversaries', 'Names, motives, and adversaries to meet at the table.'],
  ['rewards', 'Rewards', 'Loot, favors, information, or changes to the world.'],
  ['aftermath', 'Session notes & aftermath', 'What happened? What remains unresolved?'],
] as const;
