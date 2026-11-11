import { consumables, items } from '@daggery/content';
import { rollDie, type Rng } from '@daggery/shared';

export type LootTable = 'items' | 'consumables';
export const RARITIES = { Common: [1, 2], Uncommon: [2, 3], Rare: [3, 4], Legendary: [4, 5] } as const;
// The core catalog preserves the SRD table order. Consumables also carry explicit roll numbers.
// Supplements add entries to the compendium/inventory, but the d12 loot tables stay core-only.
export function lootEntries(table: LootTable) {
  return table === 'items'
    ? items.filter(item => item.source === 'core').map((item, index) => ({ ...item, roll: index + 1 }))
    : consumables.filter(item => item.source === 'core').map(item => ({ ...item, roll: item.rollTable!.roll }));
}
export function rollLoot(table: LootTable, count: number, rng?: Rng) {
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('Choose 1 to 5 d12s.');
  const dice = Array.from({ length: count }, () => rollDie(12, rng));
  const total = dice.reduce((sum, die) => sum + die, 0);
  const entry = lootEntries(table).find(item => item.roll === total);
  if (!entry) throw new Error('No loot entry for this result.');
  return { table, dice, total, name: entry.name, description: entry.description, itemId: entry.id };
}
export interface PrepDoc {
  kind: 'setting' | 'scenario';
  title: string;
  fields: Record<string, string>;
  environmentId: string;
  status: 'planned' | 'active' | 'complete';
  updated: string;
}
export interface LootDoc extends ReturnType<typeof rollLoot> {
  kind: 'loot';
  note: string;
  updated: string;
}
export type GmDoc = PrepDoc | LootDoc;
export const SETTING_FIELDS = [
  ['premise', 'Premise', 'What is this world about? What is changing?'],
  ['tone', 'Tone & themes', 'Touchstones, themes, and the kind of adventure you want to run.'],
  ['locations', 'Locations', 'Places the party can visit, and what makes each one matter.'],
  ['factions', 'Factions & NPCs', 'Who wants what? Who stands in their way?'],
  ['secrets', 'Secrets & open questions', 'What is hidden, and what will you discover together?'],
  ['agreements', 'Table agreements', 'Lines, veils, and expectations agreed with your players.'],
] as const;
export const SCENARIO_FIELDS = [
  ['hook', 'Hook & opening', 'Why does the party care? Where do we begin?'],
  ['stakes', 'Stakes & pressure', 'What happens if no one intervenes? What is running out?'],
  ['scenes', 'Scenes & discoveries', 'Locations, clues, obstacles, and possible developments.'],
  ['cast', 'NPCs & adversaries', 'Names, motives, and adversaries to prepare at the game table.'],
  ['rewards', 'Rewards', 'Loot, favors, information, or changes to the world.'],
  ['aftermath', 'Session notes & aftermath', 'What happened? What remains unresolved?'],
] as const;
