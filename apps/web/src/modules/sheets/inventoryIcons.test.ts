import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryItemIcon, isInventoryIcon } from './inventoryIcons';
import { addInventoryItem } from './inventory';
import type { Sheet } from './types';

test('inventory icons distinguish physical item roles and preserve explicit custom choices',()=>{
  assert.equal(inventoryItemIcon({kind:'weapon',name:'Round Shield'}),'shield');
  assert.equal(inventoryItemIcon({kind:'weapon',name:'Longbow'}),'ranged');
  assert.equal(inventoryItemIcon({kind:'weapon',name:'Dagger'}),'dagger');
  assert.equal(inventoryItemIcon({kind:'armor',name:'Leather Armor'}),'armor');
  assert.equal(inventoryItemIcon({kind:'consumable',name:'Health Potion'}),'potion');
  assert.equal(inventoryItemIcon({kind:'custom',name:'Silver key'}),'key');
  assert.equal(inventoryItemIcon({kind:'custom',name:'Monkey paw'}),'tag');
  assert.equal(inventoryItemIcon({kind:'custom',name:'Wandering stone'}),'tag');
  assert.equal(inventoryItemIcon({kind:'custom',name:'Silver key',icon:'gem'}),'gem');
  assert.equal(inventoryItemIcon({kind:'custom',name:'Silver key',icon:'unknown-icon'}),'key');
});

test('custom icon choices persist and different choices are not merged into one stack',()=>{
  const sheet={inventory:[]} as unknown as Sheet;
  const request={kind:'custom' as const,name:'Talisman',description:'A keepsake',qty:1,icon:'gem'};
  const first=addInventoryItem(sheet,request);
  const second=addInventoryItem(first,{...request,icon:'feather'});
  assert.equal(first.inventory[0]?.icon,'gem');
  assert.equal(second.inventory.length,2);
  assert.equal(addInventoryItem(first,request).inventory[0]?.qty,2);
  assert.equal(addInventoryItem(sheet,{...request,icon:'not-a-real-icon'}).inventory[0]?.icon,undefined);
  assert.equal(isInventoryIcon('gem'),true);
  assert.equal(isInventoryIcon('auto'),false);
});
