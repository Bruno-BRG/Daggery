import type { IconName } from '../../components/Icon';
import type { InventoryEntry } from './types';

export const CUSTOM_ITEM_ICONS = [
  {id:'backpack',label:'Backpack'},{id:'potion',label:'Potion'},{id:'scroll',label:'Scroll'},
  {id:'book',label:'Book'},{id:'key',label:'Key'},{id:'gem',label:'Gem'},
  {id:'coins',label:'Coins'},{id:'torch',label:'Torch'},{id:'rope',label:'Rope'},
  {id:'tools',label:'Tools'},{id:'chest',label:'Chest'},{id:'ring',label:'Ring'},
  {id:'feather',label:'Feather'},{id:'weapon',label:'Weapon'},{id:'armor',label:'Armor'},
  {id:'tag',label:'Token'},
] as const satisfies readonly {id:IconName;label:string}[];
export type InventoryIconId = typeof CUSTOM_ITEM_ICONS[number]['id'];
export function isInventoryIcon(value:unknown):value is InventoryIconId {
  return CUSTOM_ITEM_ICONS.some(icon=>icon.id===value);
}
export function inventoryItemIcon(item:Pick<InventoryEntry,'kind'|'name'|'icon'>):IconName {
  if (isInventoryIcon(item.icon)) return item.icon;
  const name=item.name.toLowerCase();
  if (item.kind==='armor') return 'armor';
  if (item.kind==='consumable') return 'potion';
  if (item.kind==='weapon') {
    if (/shield/.test(name)) return 'shield';
    if (/bow|sling/.test(name)) return 'ranged';
    if (/staff|wand|scepter|rune/.test(name)) return 'magic';
    if (/axe|halberd/.test(name)) return 'axe';
    if (/dagger|knife/.test(name)) return 'dagger';
    return 'weapon';
  }
  const match:readonly [RegExp,IconName][] = [[/\bkeys?\b/,'key'],[/\b(potion|elixir|vial)s?\b/,'potion'],[/\bscrolls?\b/,'scroll'],[/book|\b(tome|journal)s?\b/,'book'],[/\b(torch|lantern)(es|s)?\b/,'torch'],[/\b(rope|cord)s?\b/,'rope'],[/\b(coins?|gold|silver pieces)\b/,'coins'],[/\b(gem|crystal|jewel)s?\b/,'gem'],[/\b(earrings?|rings?)\b/,'ring'],[/\bfeathers?\b/,'feather'],[/\btools?\b|supplies/,'tools'],[/\b(chest|coffer)s?\b/,'chest']];
  return match.find(([pattern])=>pattern.test(name))?.[1]??(item.kind==='custom'?'tag':'backpack');
}
export function inventoryIconTone(icon:IconName):string {
  if (['weapon','dagger','axe'].includes(icon)) return 'rose';
  if (['armor','shield','ranged'].includes(icon)) return 'sky';
  if (['potion','rope','tools','backpack'].includes(icon)) return 'green';
  if (['coins','key','torch','chest','ring'].includes(icon)) return 'gold';
  return 'violet';
}
