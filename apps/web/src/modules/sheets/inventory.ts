import { armor, weapons, items, consumables } from '@daggery/content';
import { inventoryEquipmentId } from './equipment';
import { makeId, type ArmorEntry, type WeaponEntry } from './rules';
import type { InventoryEntry, InventoryKind, Sheet } from './types';
import { isInventoryIcon } from './inventoryIcons';

export type CatalogKind = Exclude<InventoryKind,'custom'>;
export interface InventoryCatalogEntry {
  id:string; name:string; kind:CatalogKind; tier?:number; description:string;
  weapon?:WeaponEntry; armor?:ArmorEntry; feature?:{name:string;text:string}|null;
}
export const INVENTORY_KIND_LABELS:Record<InventoryKind,string> = {weapon:'Weapons',armor:'Armor',item:'Gear',consumable:'Consumables',custom:'Custom'};
export const INVENTORY_CATALOG:InventoryCatalogEntry[] = [
  {id:'starting-torch',name:'Torch',kind:'item',description:'A torch for lighting the way.'},
  {id:'starting-rope',name:'Rope (15 m)',kind:'item',description:'15 metres of rope.'},
  {id:'starting-supplies',name:'Basic supplies',kind:'item',description:'Everyday adventuring supplies.'},
  ...weapons.map(weapon=>({id:weapon.id,name:weapon.name,kind:'weapon' as const,tier:weapon.tier,weapon,feature:weapon.feature,description:`${weapon.trait} · ${weapon.range} · ${weapon.burden}${weapon.feature?`\n${weapon.feature.name}: ${weapon.feature.text}`:''}`})),
  ...armor.map(armor=>({id:armor.id,name:armor.name,kind:'armor' as const,tier:armor.tier,armor,feature:armor.feature,description:armor.feature?`${armor.feature.name}: ${armor.feature.text}`:''})),
  ...items.map(item=>({id:item.id,name:item.name,kind:'item' as const,description:item.description})),
  ...consumables.map(item=>({id:item.id,name:item.name,kind:'consumable' as const,description:item.description})),
];
export const catalogInventoryItem = (kind:InventoryKind,id:string|null|undefined) => INVENTORY_CATALOG.find(item=>item.kind===kind&&item.id===id);
export type InventoryAddition = {kind:'custom';name:string;description:string;qty:number;icon?:string}|{kind:CatalogKind;catalogId:string;qty:number};

/** Acquisition is separate from equipping. Adding gear never changes active slots or gold. */
export function addInventoryItem(sheet:Sheet,addition:InventoryAddition):Sheet {
  if (!Number.isInteger(addition.qty)||addition.qty<1||addition.qty>999) throw new Error('Choose a quantity from 1 to 999.');
  let entry:InventoryEntry;
  if (addition.kind==='custom') {
    const name=addition.name.trim().slice(0,120);
    if (!name) throw new Error('Give the item a name.');
    entry={id:makeId('inv'),kind:'custom',name,description:addition.description.trim().slice(0,4000),qty:addition.qty,...(isInventoryIcon(addition.icon)?{icon:addition.icon}:{})};
  } else {
    const item=catalogInventoryItem(addition.kind,addition.catalogId);
    if (!item) throw new Error('Item not found.');
    entry={id:makeId('inv'),kind:item.kind,name:item.name,catalogId:item.id,description:item.description,qty:addition.qty,...(item.weapon||item.armor?{equipmentId:item.id}:{}),...(item.armor?{armorSlotsMarked:0}:{})};
  }
  const existing=sheet.inventory.find(item=>{
    if (item.kind!==entry.kind) return false;
    if (entry.kind==='custom') return item.name===entry.name&&(item.description??'')===(entry.description??'')&&item.icon===entry.icon;
    if (entry.kind==='armor' && (item.armorSlotsMarked??0)>0) return false;
    if (entry.kind==='weapon'||entry.kind==='armor') return inventoryEquipmentId(item)===entry.equipmentId;
    return item.catalogId===entry.catalogId || (!item.catalogId&&item.name.toLowerCase()===entry.name.toLowerCase());
  });
  return {...sheet,inventory:existing?sheet.inventory.map(item=>item.id===existing.id?{...item,qty:item.qty+entry.qty,catalogId:entry.catalogId??item.catalogId,equipmentId:entry.equipmentId??item.equipmentId,description:item.description||entry.description}:item):[...sheet.inventory,entry]};
}
