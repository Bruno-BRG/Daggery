import assert from 'node:assert/strict';
import test from 'node:test';
import { weapons, armor } from '@daggery/content';
import { equipEquipment, inventoryEquipmentId, inventoryEquipmentSlot, secondaryBlocked } from './equipment';
import { armorScore, damageNotation, damageThresholds, evasion, weaponForSlot } from './rules';
import type { Sheet } from './types';
import { addInventoryItem, customWeaponDamage, INVENTORY_CATALOG, inventoryCatalogEntry, type CustomWeaponInput } from './inventory';

const oneHanded = weapons.find(w=>w.tier===1&&w.category==='Primary'&&w.burden==='One-Handed')!;
const twoHanded = weapons.find(w=>w.tier===1&&w.category==='Primary'&&w.burden==='Two-Handed')!;
const secondary = weapons.find(w=>w.tier===1&&w.category==='Secondary')!;
const originalArmor = armor.find(a=>a.id==='chainmail-armor')!;
const replacementArmor = armor.find(a=>a.id==='gambeson-armor')!;
const makeSheet = ():Sheet => ({id:'test',name:'Hero',playerName:'Player',level:1,proficiency:1,classId:'guardian',subclassId:'stalwart',ancestryId:'human',communityId:null,traits:{agility:2,strength:1,finesse:1,instinct:0,presence:0,knowledge:-1},traitMarks:[],evasionBonus:0,armorId:originalArmor.id,armorSlotsMarked:1,hpMarked:2,stressMarked:1,hope:3,bonusHpSlots:0,bonusStressSlots:0,experiences:[],weapons:[{slot:'primary',weaponId:oneHanded.id},{slot:'secondary',weaponId:secondary.id}],inventory:[],gold:5,domainCardIds:[],loadoutIds:[],background:[],connections:[],notes:'',subclassUpgraded:0,multiclassId:null,advancements:[],createdAt:'',updatedAt:''});

test('two-handed swaps stow both old weapons; re-equipping inventory consumes the owned copy',()=>{
  const source = addInventoryItem(makeSheet(),{kind:'weapon',catalogId:twoHanded.id,qty:1});
  const changed = equipEquipment(source,'primary',twoHanded.id);
  assert.deepEqual(changed.weapons,[{slot:'primary',weaponId:twoHanded.id}]);
  assert.deepEqual(changed.inventory.map(i=>i.equipmentId),[oneHanded.id,secondary.id]);
  const restored = equipEquipment(equipEquipment(changed,'primary',oneHanded.id),'secondary',secondary.id);
  assert.deepEqual(restored.weapons,source.weapons);
  assert.deepEqual(restored.inventory.map(i=>i.equipmentId),[twoHanded.id]);
  assert.equal(source.inventory.length,1);
  assert.equal(restored.gold,source.gold);
});

test('armor swaps update derived defenses and preserve the old armor damage in inventory',()=>{
  const source=addInventoryItem(makeSheet(),{kind:'armor',catalogId:replacementArmor.id,qty:1});
  const changed=equipEquipment(source,'armor',replacementArmor.id);
  assert.equal(changed.armorSlotsMarked,0);
  assert.equal(changed.inventory[0]?.armorSlotsMarked,1);
  assert.equal(armorScore(changed),replacementArmor.baseScore);
  assert.notDeepEqual(damageThresholds(changed),damageThresholds(source));
  assert.notEqual(evasion(changed),evasion(source));
  const restored=equipEquipment(changed,'armor',originalArmor.id);
  assert.equal(restored.armorSlotsMarked,1);
  assert.equal(restored.hpMarked,2);
  assert.equal(restored.stressMarked,1);
  assert.equal(restored.hope,3);
});

test('equipping requires an owned, positive-quantity inventory copy',()=>{
  const source=makeSheet();
  assert.throws(()=>equipEquipment(source,'primary',twoHanded.id),/inventory before/);
  assert.throws(()=>equipEquipment(source,'armor',replacementArmor.id),/inventory before/);
  source.inventory=[{id:'empty',kind:'weapon',name:twoHanded.name,equipmentId:twoHanded.id,qty:0}];
  assert.throws(()=>equipEquipment(source,'primary',twoHanded.id,'empty'),/inventory before/);
});

test('adding catalog items preserves active slots, includes rules, and stacks quantities',()=>{
  const source=makeSheet();
  const potion=INVENTORY_CATALOG.find(item=>item.kind==='consumable')!;
  const first=addInventoryItem(source,{kind:'consumable',catalogId:potion.id,qty:2});
  const second=addInventoryItem(first,{kind:'consumable',catalogId:potion.id,qty:3});
  assert.equal(second.inventory.length,1);
  assert.equal(second.inventory[0]?.qty,5);
  assert.equal(second.inventory[0]?.description,potion.description);
  assert.deepEqual(second.weapons,source.weapons);
  assert.equal(second.armorId,source.armorId);
  assert.equal(second.gold,source.gold);
  const gear=addInventoryItem(source,{kind:'weapon',catalogId:twoHanded.id,qty:2});
  assert.equal(gear.inventory[0]?.equipmentId,twoHanded.id);
  assert.equal(equipEquipment(gear,'primary',twoHanded.id,gear.inventory[0]!.id).inventory.find(item=>item.equipmentId===twoHanded.id)?.qty,1);
});

test('armor copy selection preserves each copy damage, including swaps with the same armor type',()=>{
  const source=makeSheet();
  source.inventory=[{id:'damaged-copy',kind:'armor',name:originalArmor.name,equipmentId:originalArmor.id,armorSlotsMarked:2,qty:1}];
  const withNew=addInventoryItem(source,{kind:'armor',catalogId:originalArmor.id,qty:1});
  assert.equal(withNew.inventory.length,2,'new armor must not merge into a damaged copy');
  const changed=equipEquipment(withNew,'armor',originalArmor.id,'damaged-copy');
  assert.equal(changed.armorSlotsMarked,2);
  assert.ok(changed.inventory.some(item=>item.equipmentId===originalArmor.id&&item.armorSlotsMarked===1));
  assert.ok(changed.inventory.some(item=>item.equipmentId===originalArmor.id&&item.armorSlotsMarked===0));
});

test('custom inventory items support quantities and notes without conflating different notes',()=>{
  const first=addInventoryItem(makeSheet(),{kind:'custom',name:' Silver key ',description:'Opens the cellar',qty:1});
  const second=addInventoryItem(first,{kind:'custom',name:'Silver key',description:'Opens the cellar',qty:2});
  assert.equal(second.inventory[0]?.qty,3);
  assert.equal(second.inventory[0]?.name,'Silver key');
  assert.equal(addInventoryItem(second,{kind:'custom',name:'Silver key',description:'Opens the tower',qty:1}).inventory.length,2);
  assert.throws(()=>addInventoryItem(first,{kind:'custom',name:' ',description:'',qty:1}),/name/);
  assert.throws(()=>addInventoryItem(first,{kind:'custom',name:'Key',description:'',qty:0}),/quantity/);
});

test('unequipping retains gear and does not allow invalid secondary or wrong-category weapons',()=>{
  const source=makeSheet();
  const unarmed=equipEquipment(source,'primary',null);
  assert.deepEqual(unarmed.weapons,[]);
  assert.equal(unarmed.inventory.length,2);
  assert.throws(()=>equipEquipment(unarmed,'secondary',secondary.id),/one-handed/);
  assert.throws(()=>equipEquipment(source,'primary',secondary.id),/different slot/);
  assert.throws(()=>equipEquipment(source,'armor','missing-item'),/not found/);
  assert.equal(equipEquipment(source,'primary',oneHanded.id),source);
  const noArmor=equipEquipment(source,'armor',null);
  assert.equal(armorScore(noArmor),0);
  assert.equal(equipEquipment(noArmor,'armor',originalArmor.id).armorSlotsMarked,1);
});

test('existing catalog-named inventory stacks equip one copy and leave the rest intact',()=>{
  const source=makeSheet();
  source.inventory=[{id:'legacy',kind:'weapon',name:twoHanded.name,qty:2}];
  const changed=equipEquipment(source,'primary',twoHanded.id);
  assert.equal(changed.inventory.find(item=>item.id==='legacy')?.qty,1);
  assert.equal(source.inventory[0]?.qty,2);
  const restored=equipEquipment(changed,'primary',oneHanded.id);
  assert.equal(restored.inventory.find(item=>item.id==='legacy')?.qty,2);
});

test('player-made weapons store full stats, equip, derive damage, and stow back',()=>{
  const base:Sheet={...makeSheet(),weapons:[],armorId:null,armorSlotsMarked:0};
  const weapon:CustomWeaponInput={trait:'Finesse',range:'Close',category:'Primary',damage:customWeaponDamage(2,'d6',3),damageType:'mag',burden:'One-Handed',tier:2,feature:{name:'Moonlit',text:'+1 to Evasion'}};
  const added=addInventoryItem(base,{kind:'custom',name:'Moonlit blade',description:'A silvered blade.',qty:1,weapon});
  const entry=added.inventory[0]!;
  assert.equal(entry.kind,'weapon');
  assert.equal(entry.weapon?.damage,'2d6+3');
  assert.equal(entry.weapon?.damageType,'mag');
  assert.equal(inventoryEquipmentSlot(entry),'primary');
  assert.equal(inventoryEquipmentId(entry),entry.weapon?.id);
  assert.equal(inventoryCatalogEntry(entry)?.weapon?.name,'Moonlit blade');
  const equipped=equipEquipment(added,'primary',inventoryEquipmentId(entry)!,entry.id);
  const primary=weaponForSlot(equipped,'primary')!;
  assert.equal(primary.name,'Moonlit blade');
  assert.equal(damageNotation(primary.damage,equipped.proficiency),'2d6+3');
  assert.equal(evasion(equipped),evasion(base)+1);
  assert.equal(equipped.inventory.find(item=>item.id===entry.id)?.qty,0,'inline stats stay resolvable while equipped');
  const stowed=equipEquipment(equipped,'primary',null);
  assert.equal(weaponForSlot(stowed,'primary'),undefined);
  const back=stowed.inventory.find(item=>item.id===entry.id)!;
  assert.equal(back.qty,1);
  assert.equal(back.weapon?.name,'Moonlit blade');
});

test('player-made two-handed weapons occupy both hands and stow the secondary',()=>{
  const added=addInventoryItem(makeSheet(),{kind:'custom',name:'Great maul',description:'',qty:1,weapon:{trait:'Strength',range:'Melee',category:'Primary',damage:'2d10+2',damageType:'phy',burden:'Two-Handed',tier:2}});
  const entry=added.inventory[0]!;
  const id=inventoryEquipmentId(entry)!;
  const equipped=equipEquipment(added,'primary',id,entry.id);
  assert.deepEqual(equipped.weapons,[{slot:'primary',weaponId:id}]);
  assert.equal(secondaryBlocked(equipped),true);
  assert.ok(equipped.inventory.some(item=>item.equipmentId===secondary.id&&item.qty===1));
  assert.ok(equipped.inventory.some(item=>item.equipmentId===oneHanded.id&&item.qty===1));
});

test('player-made armor drives armor score, thresholds, evasion, and stows back',()=>{
  const base:Sheet={...makeSheet(),weapons:[],armorId:null,armorSlotsMarked:0};
  const added=addInventoryItem(base,{kind:'custom',name:'Thornweave coat',description:'Woven from briars.',qty:1,armor:{baseThresholds:{major:6,severe:12},baseScore:3,tier:2,feature:{name:'Spiked',text:'+2 to Evasion'}}});
  const entry=added.inventory[0]!;
  assert.equal(entry.kind,'armor');
  assert.equal(entry.armor?.baseScore,3);
  assert.equal(inventoryEquipmentSlot(entry),'armor');
  const equipped=equipEquipment(added,'armor',inventoryEquipmentId(entry)!,entry.id);
  assert.equal(armorScore(equipped),3);
  assert.deepEqual(damageThresholds(equipped),{major:6+equipped.level,severe:12+equipped.level});
  assert.equal(evasion(equipped),evasion(base)+2);
  assert.equal(equipped.inventory.find(item=>item.id===entry.id)?.qty,0);
  const stowed=equipEquipment(equipped,'armor',null);
  assert.equal(armorScore(stowed),0);
  assert.equal(stowed.inventory.find(item=>item.id===entry.id)?.qty,1);
});

test('player-made gear validates traits, tiers, thresholds, damage, and dupe rules',()=>{
  const base=makeSheet();
  assert.throws(()=>addInventoryItem(base,{kind:'custom',name:'Bad blade',description:'',qty:1,weapon:{trait:'Luck',range:'Melee',category:'Primary',damage:'d8',damageType:'phy',burden:'One-Handed',tier:1}}),/trait/);
  assert.throws(()=>addInventoryItem(base,{kind:'custom',name:'Bad blade',description:'',qty:1,weapon:{trait:'Agility',range:'Melee',category:'Primary',damage:'d8',damageType:'phy',burden:'One-Handed',tier:5}}),/tier/);
  assert.throws(()=>addInventoryItem(base,{kind:'custom',name:'Bad blade',description:'',qty:1,weapon:{trait:'Agility',range:'Melee',category:'Primary',damage:'d7',damageType:'phy',burden:'One-Handed',tier:1}}),/damage/);
  assert.throws(()=>addInventoryItem(base,{kind:'custom',name:'Bad armor',description:'',qty:1,armor:{baseThresholds:{major:12,severe:6},baseScore:2,tier:1}}),/severe/);
  assert.throws(()=>addInventoryItem(base,{kind:'custom',name:'Bad armor',description:'',qty:1,armor:{baseThresholds:{major:4,severe:8},baseScore:100,tier:1}}),/Armor Score/);
  assert.throws(()=>addInventoryItem(base,{kind:'custom',name:'Bad weapon',description:'',qty:1,weapon:{trait:'Agility',range:'Nowhere',category:'Primary',damage:'d8',damageType:'phy',burden:'One-Handed',tier:1}}),/range/);
  assert.throws(()=>addInventoryItem(base,{kind:'custom',name:'Bad weapon',description:'',qty:1,weapon:{trait:'Agility',range:'Melee',category:'Primary',damage:'d8',damageType:'fire',burden:'One-Handed',tier:1}}),/physical or magic/);
});

test('identical player-made gear stacks while different stats stay separate',()=>{
  const weapon:CustomWeaponInput={trait:'Strength',range:'Melee',category:'Primary',damage:'d10',damageType:'phy',burden:'Two-Handed',tier:1};
  const first=addInventoryItem(makeSheet(),{kind:'custom',name:'Maul',description:'',qty:1,weapon});
  const second=addInventoryItem(first,{kind:'custom',name:'Maul',description:'',qty:2,weapon});
  assert.equal(second.inventory.length,1);
  assert.equal(second.inventory[0]?.qty,3);
  assert.equal(second.inventory[0]?.weapon?.damage,'d10');
  const different=addInventoryItem(second,{kind:'custom',name:'Maul',description:'',qty:1,weapon:{...weapon,damage:'2d10'}});
  assert.equal(different.inventory.length,2);
});

test('weapon features that add to damage thresholds (Padded, Brave) are included',()=>{
  const cloak=weapons.find(w=>w.id==='fighting-cloak')!;
  const brave=weapons.find(w=>w.id==='bravesword')!;
  const base:Sheet={...makeSheet(),weapons:[]};
  const plain=damageThresholds(base);
  assert.deepEqual(damageThresholds({...base,weapons:[{slot:'secondary',weaponId:cloak.id}]}),{major:plain.major+2,severe:plain.severe+2});
  assert.deepEqual(damageThresholds({...base,weapons:[{slot:'primary',weaponId:brave.id}]}),{major:plain.major,severe:plain.severe+3});
});
