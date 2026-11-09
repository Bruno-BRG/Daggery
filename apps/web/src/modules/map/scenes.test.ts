import assert from 'node:assert/strict';
import test from 'node:test';
import { copyScene, sceneFromTemplate } from './scenes';
import { freeTokenPosition, normalizeScene, type FogShape, type MapToken } from './model';
import { patchLinkedPools, sheetEntry } from './sheetToken';
import type { Sheet } from '../sheets/types';

const token = (id: string, sceneId: string, x = 0, y = 0, size = 1): MapToken => ({ id, sceneId, x, y, size, name: 'Guard', kind: 'adversary', color: '#a35a68', conditions: ['Vulnerable'], rotation: 0, hidden: false, hp: { current: 3, max: 4 } });

test('scene copies have fresh IDs, preserve fog and never share mutable token state', () => {
  const source = sceneFromTemplate('ruins', 'Sanctuary');
  const original = token('guard', source.id);
  const fog: FogShape = { id: 'area', sceneId: source.id, mode: 'hide', points: [0, 0, 100, 0, 100, 100], order: 1 };
  const copy = copyScene(source, [original, token('unrelated', 'other-scene')], [fog]);
  assert.notEqual(copy.scene.id, source.id);
  assert.equal(copy.tokens.length, 1);
  assert.notEqual(copy.tokens[0]!.id, original.id);
  assert.equal(copy.tokens[0]!.sceneId, copy.scene.id);
  assert.equal(copy.fog[0]!.sceneId, copy.scene.id);
  copy.tokens[0]!.conditions.push('Hidden');
  copy.tokens[0]!.hp!.current = 1;
  copy.fog[0]!.points[0] = 999;
  assert.deepEqual(original.conditions, ['Vulnerable']);
  assert.equal(original.hp!.current, 3);
  assert.equal(fog.points[0], 0);
});

test('scene templates preserve map dimensions and constrain custom grid sizes', () => {
  const map = sceneFromTemplate('ruins', '  Moonfall  ');
  assert.equal(map.name, 'Moonfall');
  assert.equal(map.mapWidth, map.cols * map.cell);
  assert.equal(map.mapHeight, map.rows * map.cell);
  assert.equal(map.showGrid, false);
  assert.equal(sceneFromTemplate('parchment', '', -50, 1000).cols, 4);
  assert.equal(sceneFromTemplate('parchment', '', -50, 1000).rows, 100);
  assert.equal(normalizeScene({ ...map, boardStyle: 'invalid' as never }).boardStyle, 'midnight');
});

test('new miniatures find an unoccupied footprint, including large bases', () => {
  const occupied = [token('one', 'scene', 0, 0, 2), token('two', 'scene', -1, -1)];
  const position = freeTokenPosition({ x: 0.4, y: 0.3 }, occupied, 2);
  assert.ok(occupied.every(t => !(position.x < t.x + t.size && position.x + 2 > t.x && position.y < t.y + t.size && position.y + 2 > t.y)));
  assert.deepEqual(freeTokenPosition({ x: 2.9, y: 5.2 }, []), { x: 2, y: 5 });
});

const humanGuardian = { id: 'hero', name: 'Ash', classId: 'guardian', ancestryId: 'human', hpMarked: 2, stressMarked: 3, bonusHpSlots: 0, bonusStressSlots: 0 } as Sheet;
test('party miniatures read current character slots rather than obsolete pool fields', () => {
  const entry = sheetEntry('hero', humanGuardian)!;
  assert.deepEqual(entry.hp, { current: 5, max: 7 });
  assert.deepEqual(entry.stress, { current: 4, max: 7 });
  assert.equal(entry.className, 'Guardian');
  assert.ok(entry.image?.includes('guardian'));
  assert.equal(sheetEntry('bad', null), null);
  assert.deepEqual(sheetEntry('old', { name: 'Old hero', hp: { current: 4, max: 6 } })?.hp, { current: 4, max: 6 });
});

test('editing linked miniature resources updates marked slots without changing maximums', () => {
  const next = patchLinkedPools(humanGuardian, { hp: { current: 1, max: 999 }, stress: { current: 99, max: 999 } });
  assert.equal(next.hpMarked, 6);
  assert.equal(next.stressMarked, 0);
  assert.equal(humanGuardian.hpMarked, 2);
  assert.equal(next.bonusHpSlots, 0);
  assert.equal(patchLinkedPools(humanGuardian, { hp: { current: Number.NaN, max: 7 } }).hpMarked, humanGuardian.hpMarked);
  const old = { ...humanGuardian, bonusHpSlots: undefined, bonusStressSlots: undefined } as unknown as Sheet;
  assert.equal(patchLinkedPools(old, { hp: { current: 5, max: 7 } }).hpMarked, 2);
});
