import assert from 'node:assert/strict';
import test from 'node:test';
import { pinchCamera, pinchPose } from './camera';

test('pinching keeps the map position under the fingers stable', () => {
  const camera = { x: -120, y: 30, s: 2 };
  const before = pinchPose({ x: 100, y: 100 }, { x: 200, y: 100 });
  const after = pinchPose({ x: 50, y: 100 }, { x: 250, y: 100 });
  const next = pinchCamera(camera, before, after);
  assert.equal(next.s, 4);
  assert.equal((after.center.x - next.x) / next.s, (before.center.x - camera.x) / camera.s);
  assert.equal((after.center.y - next.y) / next.s, (before.center.y - camera.y) / camera.s);
});

test('moving both fingers pans without changing the zoom', () => {
  const before = pinchPose({ x: 0, y: 0 }, { x: 100, y: 0 });
  const after = pinchPose({ x: 40, y: 70 }, { x: 140, y: 70 });
  assert.deepEqual(pinchCamera({ x: 10, y: 20, s: 1 }, before, after), { x: 50, y: 90, s: 1 });
});

test('zoom limits still preserve the world point at the pinch center', () => {
  for (const distance of [0.001, 100000]) {
    const result = pinchCamera({ x: 0, y: 0, s: 1 }, { center: { x: 100, y: 200 }, distance: 100 }, { center: { x: 100, y: 200 }, distance });
    assert.ok(result.s >= 0.05 && result.s <= 6);
    assert.ok(Math.abs((100 - result.x) / result.s - 100) < 0.000001);
    assert.ok(Math.abs((200 - result.y) / result.s - 200) < 0.000001);
  }
});

test('coincident fingers never produce an invalid camera', () => {
  const pose = pinchPose({ x: 50, y: 50 }, { x: 50, y: 50 });
  const result = pinchCamera({ x: 0, y: 0, s: 1 }, pose, pose);
  assert.ok(Object.values(result).every(Number.isFinite));
});
