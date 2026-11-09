import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG, NO_CONDITIONS, pcViews, type AdversaryDoc } from '../combat/model';
import { encounterToken, patchEncounter } from './encounterLink';
import type { MapToken } from './model';

const source = CATALOG.find((s) => s.type !== 'Minion' && s.stress && s.hp > 2)!;
const encounter: AdversaryDoc = {
  kind: 'adversary',
  catalogId: source.id,
  name: source.name,
  sceneId: 'forest',
  addedAt: 1,
  hpMarked: 2,
  stressMarked: 1,
  groupSize: null,
  defeated: 0,
  conditions: { ...NO_CONDITIONS, vulnerable: true },
  counters: [],
};
const token: MapToken = {
  id: 'mini',
  sceneId: 'forest',
  combatRefId: 'adv:guard',
  name: source.name,
  kind: 'adversary',
  x: 0,
  y: 0,
  size: 1,
  color: '#ff0000',
  hidden: false,
  rotation: 0,
  conditions: ['Hidden', 'Blessed'],
};
test('encounter health and core conditions are live while custom miniature attachments survive', () => {
  const linked = encounterToken(token, encounter);
  assert.deepEqual(linked.hp, { max: source.hp, current: source.hp - 2 });
  assert.equal(linked.stress?.current, source.stress! - 1);
  assert.deepEqual(linked.conditions, ['Blessed', 'Vulnerable']);
  assert.deepEqual(token.conditions, ['Hidden', 'Blessed']);
});
test('miniature edits update marked slots, preserve encounter identity and clamp invalid maximums', () => {
  const updated = patchEncounter(encounter, {
    hp: { current: 1, max: 999 },
    stress: { current: 999, max: 999 },
    conditions: ['Restrained', 'Blessed'],
  });
  assert.equal(updated.hpMarked, source.hp - 1);
  assert.equal(updated.stressMarked, 0);
  assert.equal(updated.sceneId, encounter.sceneId);
  assert.deepEqual(updated.conditions, { hidden: false, vulnerable: false, restrained: true });
  assert.equal(encounter.hpMarked, 2);
});
test('minion group miniatures show survivors and edit defeated count independently of HP slots', () => {
  const group = { ...encounter, groupSize: 4, defeated: 1 };
  assert.deepEqual(encounterToken(token, group).hp, { max: 4, current: 3 });
  assert.equal(patchEncounter(group, { hp: { current: 2, max: 4 } }).defeated, 2);
  assert.equal(patchEncounter(group, { hp: { current: 2, max: 4 } }).hpMarked, group.hpMarked);
});
test('combat roster reads modern character slots and keeps legacy pool documents compatible', () => {
  const pcs = pcViews({ hero: { name: 'Ash', classId: 'guardian', ancestryId: 'human', hpMarked: 2, stressMarked: 3, level: 1 }, legacy: { name: 'Old hero', hp: { current: 3, max: 6 }, stress: { current: 2, max: 6 }, evasion: 10 } }, {});
  assert.deepEqual(pcs[0]!.sheetHp, { max: 7, current: 5 });
  assert.deepEqual(pcs[0]!.sheetStress, { max: 7, current: 4 });
  assert.equal(pcs[0]!.evasion, 9);
  assert.deepEqual(pcs[1]!.sheetHp, { max: 6, current: 3 });
});
