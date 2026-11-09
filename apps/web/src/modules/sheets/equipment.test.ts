import assert from 'node:assert/strict';
import test from 'node:test';
import { weapons, armor } from '@daggery/content';
import { equipEquipment } from './equipment';
import { armorScore, damageThresholds, evasion } from './rules';
import type { Sheet } from './types';
import { addInventoryItem, INVENTORY_CATALOG } from './inventory';

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
