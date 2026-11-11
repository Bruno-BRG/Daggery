import assert from 'node:assert/strict';
import test from 'node:test';
import { changeResourceCount, resourceTrack } from './resource-track';

test('fresh HP, Stress and Armor show zero marks, not remaining capacity', () => {
  for (const max of [7, 6, 3]) {
    assert.deepEqual(resourceTrack(0, max), { value: 0, slots: max, canIncrease: true });
    assert.equal(changeResourceCount(0, 1, max), 1);
    assert.equal(resourceTrack(1, max).value, 1);
    assert.equal(changeResourceCount(1, 0, max), 0);
  }
});

test('Hope displays held points with the same direct-count track', () => {
  assert.equal(resourceTrack(2, 6).value, 2);
  assert.equal(changeResourceCount(2, 3, 6), 3);
  assert.equal(changeResourceCount(2, 1, 6), 1);
});

test('marking respects computed capacity and cannot go negative', () => {
  assert.equal(changeResourceCount(5, 99, 6), 6);
  assert.equal(changeResourceCount(0, -1, 6), 0);
  assert.equal(resourceTrack(6, 6).canIncrease, false);
  assert.deepEqual(resourceTrack(0, 0), { value: 0, slots: 0, canIncrease: false });
});

test('rendering 24 slots does not cap boosted maxima or marks', () => {
  assert.deepEqual(resourceTrack(150, 206), { value: 150, slots: 24, canIncrease: true });
  assert.equal(changeResourceCount(150, 151, 206), 151);
  assert.equal(changeResourceCount(205, 206, 206), 206);
  assert.equal(resourceTrack(206, 206).canIncrease, false);
});

test('removing extra capacity preserves stored marks and lets them clear', () => {
  assert.deepEqual(resourceTrack(9, 6), { value: 9, slots: 6, canIncrease: false });
  assert.equal(changeResourceCount(9, 8, 6), 8);
  assert.equal(changeResourceCount(9, 10, 6), 9);
  assert.equal(changeResourceCount(9, 0, 6), 0);
});
