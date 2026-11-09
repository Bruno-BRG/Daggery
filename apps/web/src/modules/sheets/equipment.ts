import { armorScore, getArmor, getWeapon, makeId, weaponForSlot } from './rules';
import type { InventoryEntry, Sheet } from './types';
import { armor, weapons } from '@daggery/content';

export type EquipmentSlot = 'primary' | 'secondary' | 'armor';
export const EQUIPMENT_LABELS: Record<EquipmentSlot,string> = {primary:'Primary weapon',secondary:'Secondary weapon',armor:'Armor'};

export function secondaryBlocked(sheet: Sheet): boolean {
  const primary = weaponForSlot(sheet,'primary');
  return !primary || primary.burden === 'Two-Handed';
}

/** Swap gear atomically, preserving stowed items and their armor damage. */
export function equipEquipment(sheet: Sheet, slot: EquipmentSlot, id: string | null, inventoryEntryId?: string): Sheet {
  const currentId = slot === 'armor' ? sheet.armorId : sheet.weapons.find(w=>w.slot===slot)?.weaponId ?? null;
  if (id===currentId && !inventoryEntryId) return sheet;
  const picked = slot==='armor' ? getArmor(id) : getWeapon(id);
  if (id && !picked) throw new Error('Equipment not found.');
  if (id && slot!=='armor' && getWeapon(id)?.category !== (slot==='primary'?'Primary':'Secondary')) throw new Error('This weapon belongs in a different slot.');
  if (id && slot==='secondary' && secondaryBlocked(sheet)) throw new Error('A secondary weapon needs a one-handed primary weapon.');
  let inventory = sheet.inventory.map(entry=>({...entry}));
  const kind = slot==='armor' ? 'armor' : 'weapon';
  const ownedIndex = id ? inventory.findIndex(entry=>(!inventoryEntryId||entry.id===inventoryEntryId) && inventoryEquipmentId(entry)===id && entry.kind===kind && entry.qty>0) : -1;
  if (id && ownedIndex<0) throw new Error('Add this item to your inventory before equipping it.');
  const owned = ownedIndex>=0 ? inventory[ownedIndex] : undefined;
  const armorMarks = owned?.armorSlotsMarked ?? 0;
  if (ownedIndex>=0) inventory = inventory.flatMap((entry,index)=>index!==ownedIndex ? [entry] : entry.qty>1 ? [{...entry,qty:entry.qty-1}] : []);
  const stow = (gearId: string | null, gearKind: 'armor'|'weapon', marks?: number) => {
    const gear = gearKind==='armor' ? getArmor(gearId) : getWeapon(gearId);
    if (!gear) return;
    const existing = inventory.find(entry=>inventoryEquipmentId(entry)===gear.id && entry.kind===gearKind && (gearKind!=='armor' || (entry.armorSlotsMarked??0)===(marks??0)));
    if (existing) { existing.qty+=1; existing.equipmentId=gear.id; }
    else inventory.push({id:makeId('gear'),equipmentId:gear.id,name:gear.name,kind:gearKind,qty:1,...(gearKind==='armor'?{armorSlotsMarked:marks??0}:{})});
  };
  if (slot==='armor') {
    stow(sheet.armorId,'armor',sheet.armorSlotsMarked);
    const next = {...sheet,armorId:id,inventory,armorSlotsMarked:0};
    return {...next,armorSlotsMarked:Math.max(0,Math.min(armorScore(next),armorMarks))};
  }
  stow(currentId,'weapon');
  let equipped = sheet.weapons.filter(weapon=>weapon.slot!==slot);
  if (slot==='primary' && (!id || getWeapon(id)?.burden==='Two-Handed')) {
    equipped.filter(weapon=>weapon.slot==='secondary').forEach(weapon=>stow(weapon.weaponId,'weapon'));
    equipped = equipped.filter(weapon=>weapon.slot!=='secondary');
  }
  if (id) equipped.push({slot,weaponId:id});
  return {...sheet,weapons:equipped,inventory};
}

export function inventoryEquipmentId(entry: InventoryEntry): string | null {
  const catalog = entry.kind==='armor' ? armor : entry.kind==='weapon' ? weapons : [];
  if (entry.equipmentId && catalog.some(item=>item.id===entry.equipmentId)) return entry.equipmentId;
  const matches = catalog.filter(item=>item.name.toLowerCase()===entry.name.trim().toLowerCase());
  return matches.length===1 ? matches[0]!.id : null;
}

export function inventoryEquipmentSlot(entry: InventoryEntry): EquipmentSlot | null {
  const id = inventoryEquipmentId(entry);
  if (entry.kind==='armor' && getArmor(id)) return 'armor';
  if (entry.kind==='weapon') {
    const weapon = getWeapon(id);
    if (weapon) return weapon.category==='Secondary'?'secondary':'primary';
  }
  return null;
}
