import assert from 'node:assert/strict';
import test from 'node:test';
import { hitDrawing, translateDrawing } from './annotations';
import { copyScene, sceneFromTemplate } from './scenes';
import type { MapDrawing } from './model';

const drawing = (kind: MapDrawing['kind'], points: number[]): MapDrawing => ({ id: 'stroke', sceneId: 'forest', kind, points, color: '#facc15', width: 4 });
test('drawing hit tests select outlines without intercepting the empty map inside them', () => {
  assert.equal(hitDrawing(drawing('rect', [0, 0, 100, 100]), 50, 50, 3), false);
  assert.equal(hitDrawing(drawing('rect', [100, 100, 0, 0]), 100, 50, 3), true);
  assert.equal(hitDrawing(drawing('ellipse', [0, 0, 100, 100]), 50, 50, 3), false);
  assert.equal(hitDrawing(drawing('ellipse', [0, 0, 100, 100]), 100, 50, 3), true);
  assert.equal(hitDrawing(drawing('line', [0, 0, 100, 100]), 50, 52, 3), true);
  assert.equal(hitDrawing(drawing('pen', [0, 0, 20, 40, 100, 50]), 60, 45, 3), true);
  assert.equal(hitDrawing(drawing('line', [0, 0, 100, 100]), 50, 70, 3), false);
});
test('moving drawings preserves every point in world space without changing the original', () => {
  const original = drawing('pen', [5, 10, 15, 20, 25, 30]);
  assert.deepEqual(translateDrawing(original, -5, 7).points, [0, 17, 10, 27, 20, 37]);
  assert.deepEqual(original.points, [5, 10, 15, 20, 25, 30]);
  const text = { ...drawing('text', [100, 100]), text: 'Danger\nKeep out', fontSize: 20 };
  assert.equal(hitDrawing(text, 120, 140, 2), true);
  assert.equal(hitDrawing(text, 90, 140, 2), false);
});
test('duplicating scenes includes drawings without sharing their points', () => {
  const scene = sceneFromTemplate('rocky-forest', 'Forest');
  const note = { ...drawing('text', [5, 10]), sceneId: scene.id, text: 'Crossing' };
  const copy = copyScene(scene, [], [], [note, drawing('pen', [0, 0, 20, 20])]);
  assert.equal(copy.drawings.length, 1);
  assert.notEqual(copy.drawings[0]!.id, note.id);
  assert.equal(copy.drawings[0]!.sceneId, copy.scene.id);
  copy.drawings[0]!.points[0] = 99;
  assert.equal(note.points[0], 5);
});
