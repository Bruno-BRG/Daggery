import { armor, weapons, items, consumables } from '@daggery/content';
import { inventoryEquipmentId } from './equipment';
import { MAX_ARMOR_SCORE, makeId, type ArmorStats, type WeaponStats } from './rules';
import type { InlineArmor, InlineWeapon, InventoryEntry, InventoryKind, Sheet } from './types';
import { isInventoryIcon } from './inventoryIcons';

export type CatalogKind = Exclude<InventoryKind,'custom'>;
export interface InventoryCatalogEntry {
  id:string; name:string; kind:CatalogKind; tier?:number; description:string;
  weapon?:WeaponStats; armor?:ArmorStats; feature?:{name:string;text:string}|null;
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

/** Resolve an inventory entry to a catalog-shaped record, including player-made gear. */
export function inventoryCatalogEntry(entry:InventoryEntry):InventoryCatalogEntry|undefined {
  const id = inventoryEquipmentId(entry);
  const catalog = id ? catalogInventoryItem(entry.kind, id) : undefined;
  if (catalog) return catalog;
  if (entry.kind==='weapon' && entry.weapon) return {id:entry.weapon.id,name:entry.weapon.name,kind:'weapon',tier:entry.weapon.tier,description:entry.description??'',weapon:entry.weapon,feature:entry.weapon.feature??null};
  if (entry.kind==='armor' && entry.armor) return {id:entry.armor.id,name:entry.armor.name,kind:'armor',tier:entry.armor.tier,description:entry.description??'',armor:entry.armor,feature:entry.armor.feature??null};
  return undefined;
}

export const CUSTOM_WEAPON_TRAITS = ['Agility','Strength','Finesse','Instinct','Presence','Knowledge'] as const;
export const CUSTOM_WEAPON_RANGES = ['Melee','Very Close','Close','Far','Very Far'] as const;
export const CUSTOM_WEAPON_CATEGORIES = ['Primary','Secondary'] as const;
export const CUSTOM_WEAPON_BURDENS = ['One-Handed','Two-Handed'] as const;
export const CUSTOM_DAMAGE_DICE = ['d4','d6','d8','d10','d12','d20'] as const;
export const CUSTOM_TIERS = [1,2,3,4] as const;

export interface CustomWeaponInput {
  trait:string; range:string; category:string; damage:string; damageType:string; burden:string; tier:number;
  feature?:{name:string;text:string}|null;
}
export interface CustomArmorInput {
  baseThresholds:{major:number;severe:number}; baseScore:number; tier:number;
  feature?:{name:string;text:string}|null;
}
export type InventoryAddition =
  | {kind:'custom';name:string;description:string;qty:number;icon?:string;weapon?:CustomWeaponInput;armor?:CustomArmorInput}
  | {kind:CatalogKind;catalogId:string;qty:number};

const clamp=(value:string,max:number)=>value.trim().slice(0,max);

/** Build the canonical damage string used by @daggery/content ("d8", "2d6+3", or a flat "4"). */
export function customWeaponDamage(count:number,die:string,bonus:number):string {
  if (!Number.isInteger(count)||count<0||count>20) throw new Error('Choose 0 to 20 damage dice.');
  if (!(CUSTOM_DAMAGE_DICE as readonly string[]).includes(die)) throw new Error('Choose a damage die from d4 to d20.');
  if (!Number.isInteger(bonus)||bonus<0||bonus>99) throw new Error('The damage bonus must be between 0 and 99.');
  if (count===0) {
    if (bonus<1) throw new Error('A flat damage value needs at least 1.');
    return String(bonus);
  }
  return `${count===1?'':count}${die}${bonus>0?`+${bonus}`:''}`;
}

/** Accepts the canonical notation from the form, plus a plain flat modifier. */
function normalizeDamage(raw:string):string {
  const value=raw.trim().toLowerCase();
  const match=/^(\d{0,2})d(4|6|8|10|12|20)(?:\+(\d{1,2}))?$/.exec(value);
  if (match) {
    const count=Number(match[1]||1);
    const bonus=Number(match[3]||0);
    if (count<1||count>20) throw new Error('Use between 1 and 20 damage dice.');
    if (bonus>99) throw new Error('The damage bonus must be 99 or less.');
    return `${count===1?'':count}d${match[2]}${bonus>0?`+${bonus}`:''}`;
  }
  if (/^\d{1,2}$/.test(value) && Number(value)>0) return String(Number(value));
  throw new Error('Use damage dice (like d8 or 2d6+3) or a flat number.');
}

function normalizeFeature(feature?:{name?:string;text?:string}|null):{name:string;text:string}|null {
  const name=clamp(feature?.name??'',120);
  if (!name) return null;
  return {name,text:(feature?.text??'').trim().slice(0,2000)};
}

function tierValue(tier:number):number {
  if (!(CUSTOM_TIERS as readonly number[]).includes(tier)) throw new Error('Choose a tier from 1 to 4.');
  return tier;
}

function customWeapon(name:string,description:string,input:CustomWeaponInput):InventoryEntry {
  const trait=input.trait.trim();
  if (!(CUSTOM_WEAPON_TRAITS as readonly string[]).includes(trait)) throw new Error('Choose a valid attack trait.');
  const range=input.range.trim();
  if (!(CUSTOM_WEAPON_RANGES as readonly string[]).includes(range)) throw new Error('Choose a valid weapon range.');
  const category=input.category.trim();
  if (!(CUSTOM_WEAPON_CATEGORIES as readonly string[]).includes(category)) throw new Error('Choose a primary or secondary weapon.');
  const burden=input.burden.trim();
  if (!(CUSTOM_WEAPON_BURDENS as readonly string[]).includes(burden)) throw new Error('Choose a one- or two-handed weapon.');
  if (input.damageType!=='phy'&&input.damageType!=='mag') throw new Error('Choose physical or magic damage.');
  const id=makeId('custom-weapon');
  const weapon:InlineWeapon={id,name,category,tier:tierValue(input.tier),trait,range,damage:normalizeDamage(input.damage),damageType:input.damageType,burden,feature:normalizeFeature(input.feature)};
  return {id:makeId('inv'),kind:'weapon',name,description,qty:0,equipmentId:id,weapon};
}

function customArmor(name:string,description:string,input:CustomArmorInput):InventoryEntry {
  const major=input.baseThresholds?.major;
  const severe=input.baseThresholds?.severe;
  if (!Number.isInteger(major)||!Number.isInteger(severe)||major<0||severe<0||major>99||severe>99) throw new Error('Enter major and severe thresholds between 0 and 99.');
  if (severe<major) throw new Error('The severe threshold cannot be lower than the major threshold.');
  if (!Number.isInteger(input.baseScore)||input.baseScore<0||input.baseScore>MAX_ARMOR_SCORE) throw new Error(`Choose an Armor Score from 0 to ${MAX_ARMOR_SCORE}.`);
  const id=makeId('custom-armor');
  const armorStats:InlineArmor={id,name,tier:tierValue(input.tier),baseThresholds:{major,severe},baseScore:input.baseScore,feature:normalizeFeature(input.feature)};
  return {id:makeId('inv'),kind:'armor',name,description,qty:0,equipmentId:id,armorSlotsMarked:0,armor:armorStats};
}

/** Acquisition is separate from equipping. Adding gear never changes active slots or gold. */
export function addInventoryItem(sheet:Sheet,addition:InventoryAddition):Sheet {
  if (!Number.isInteger(addition.qty)||addition.qty<1||addition.qty>999) throw new Error('Choose a quantity from 1 to 999.');
  let entry:InventoryEntry;
  if (addition.kind==='custom') {
    const name=clamp(addition.name,120);
    if (!name) throw new Error('Give the item a name.');
    const description=addition.description.trim().slice(0,4000);
    if (addition.weapon && addition.armor) throw new Error('Choose either a weapon or armor, not both.');
    if (addition.weapon) entry={...customWeapon(name,description,addition.weapon),qty:addition.qty};
    else if (addition.armor) entry={...customArmor(name,description,addition.armor),qty:addition.qty};
    else entry={id:makeId('inv'),kind:'custom',name,description,qty:addition.qty};
    if (isInventoryIcon(addition.icon)) entry={...entry,icon:addition.icon};
  } else {
    const item=catalogInventoryItem(addition.kind,addition.catalogId);
    if (!item) throw new Error('Item not found.');
    entry={id:makeId('inv'),kind:item.kind,name:item.name,catalogId:item.id,description:item.description,qty:addition.qty,...(item.weapon||item.armor?{equipmentId:item.id}:{}),...(item.armor?{armorSlotsMarked:0}:{})};
  }
  const gearKey=(item:InventoryEntry)=>item.weapon
    ? JSON.stringify([item.weapon.category,item.weapon.trait,item.weapon.range,item.weapon.damage,item.weapon.damageType,item.weapon.burden,item.weapon.tier,item.weapon.feature??null])
    : item.armor
      ? JSON.stringify([item.armor.baseThresholds.major,item.armor.baseThresholds.severe,item.armor.baseScore,item.armor.tier,item.armor.feature??null])
      : '';
  const existing=sheet.inventory.find(item=>{
    if (item.kind!==entry.kind) return false;
    if (entry.weapon||entry.armor) return item.name===entry.name&&(item.description??'')===(entry.description??'')&&item.icon===entry.icon&&gearKey(item)===gearKey(entry);
    if (entry.kind==='custom') return item.name===entry.name&&(item.description??'')===(entry.description??'')&&item.icon===entry.icon;
    if (entry.kind==='armor' && (item.armorSlotsMarked??0)>0) return false;
    if (entry.kind==='weapon'||entry.kind==='armor') return inventoryEquipmentId(item)===entry.equipmentId;
    return item.catalogId===entry.catalogId || (!item.catalogId&&item.name.toLowerCase()===entry.name.toLowerCase());
  });
  return {...sheet,inventory:existing?sheet.inventory.map(item=>{
    if (item.id!==existing.id) return item;
    // Keep the existing stack's identity (and inline stats) when merging player-made gear.
    if (item.weapon||item.armor) return {...item,qty:item.qty+entry.qty};
    return {...item,qty:item.qty+entry.qty,catalogId:entry.catalogId??item.catalogId,equipmentId:entry.equipmentId??item.equipmentId,description:item.description||entry.description};
  }):[...sheet.inventory,entry]};
}
