import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { getDieShape, SUPPORTED_SIDES } from './shapes';
import { resultSymmetry, upwardResult } from './landing';
import { prepareThrow } from './simulation';
import { RollEchoes } from './echoes';
import { parseAppearance, paletteFor } from './appearance';
import type { RollLogEntry, RollPayload } from '@daggery/shared';
import { executeRoll } from './rollExecution';
import { diceForPayload } from './rollPlan';
import { parseChoice, pickQuality, QUALITY } from './quality';
import { faceLabel } from './faceLabels';
import { buildBevelledMesh } from './bevel';

test('every result mapping is a solid symmetry, preserving collider vertices and face numbers', () => {
  for (const sides of SUPPORTED_SIDES) {
    const shape = getDieShape(sides);
    for (let desired=1; desired<=sides; desired++) for (let physical=1; physical<=sides; physical++) {
      const rotation = resultSymmetry(shape,desired,physical);
      const result = new THREE.Vector3(...shape.results[desired-1]!.dir).applyQuaternion(rotation);
      assert.ok(result.distanceTo(new THREE.Vector3(...shape.results[physical-1]!.dir)) < 1e-5);
      for (const vertex of shape.vertices) {
        const moved = new THREE.Vector3(...vertex).applyQuaternion(rotation);
        assert.ok(shape.vertices.some(v=>moved.distanceToSquared(new THREE.Vector3(...v))<1e-9));
      }
    }
  }
});

test('prepared physics land on the requested result for every supported die without a landing correction', () => {
  let state = 12345;
  const rng = () => { state = (Math.imul(state,1664525)+1013904223)>>>0; return state/2**32; };
  const requests = SUPPORTED_SIDES.map(sides=>({sides,value:sides,colorway:'neutral' as const}));
  const motion = prepareThrow(requests,{minX:-6,maxX:6,minZ:-4,maxZ:4},rng);
  assert.ok(motion.duration > .5 && motion.duration <= 8.1);
  const end = motion.frames.at(-1)!;
  requests.forEach((request,i)=>{
    const q = end[i]!.quaternion.clone().multiply(motion.rotations[i]!);
    assert.equal(upwardResult(getDieShape(request.sides),q),request.value);
    const previous = motion.frames.at(-2)![i]!;
    assert.ok(previous.position.distanceTo(end[i]!.position)<.01, 'last pose must already be at rest');
    assert.ok(previous.quaternion.angleTo(end[i]!.quaternion)<.02, 'no last-frame face swap');
  });
});

test('local echoes use correlation IDs even when the server replaces the author; identical remote rolls still play', () => {
  const tracker = new RollEchoes();
  const payload: RollPayload = {kind:'dice',result:{notation:'1d6',rolls:[4],modifier:0,total:4},clientRollId:'local-1'};
  tracker.remember(payload,'Player');
  const entry: RollLogEntry = {...payload,id:1,at:'now',author:'account_username'};
  assert.equal(tracker.matches(entry),true);
  assert.equal(tracker.matches(entry),true,'repeated echoes must remain suppressed');
  assert.equal(tracker.matches({...entry,id:2,clientRollId:'other-client'}),false);
  assert.equal(tracker.matches({...entry,id:3,clientRollId:undefined}),false);
});

test('invalid saved appearances fall back safely and custom colors keep contrasting numerals', () => {
  assert.equal(parseAppearance('{broken').preset,'classic');
  const value = parseAppearance(JSON.stringify({preset:'nonexistent',effect:'unsupported',colors:{hope:'#ffffff',fear:'url(bad)'}}));
  assert.deepEqual(value.colors,{hope:'#ffffff'});
  assert.equal(paletteFor('hope',value).numeral,'#151624');
  assert.equal(paletteFor('fear',{...value,colors:{fear:'#000000'}}).numeral,'#fffdf6');
});

test('attack reserves its animation before publishing can trigger a damage roll', async () => {
  const order: string[] = [];
  const attack: RollPayload = {kind:'dice',clientRollId:'attack',result:{notation:'1d20',rolls:[15],modifier:0,total:15}};
  const damage: RollPayload = {kind:'dice',clientRollId:'damage',result:{notation:'1d6',rolls:[4],modifier:0,total:4}};
  const animate = async (payload: RollPayload) => { order.push(`animate:${payload.clientRollId}`); };
  await executeRoll(attack,animate,()=>{
    order.push('publish:attack');
    void executeRoll(damage,animate,()=>order.push('publish:damage'));
  });
  assert.deepEqual(order,['animate:attack','publish:attack','animate:damage','publish:damage']);
});

test('a d100 roll shows as two d10 whose faces add up to the result', () => {
  for (let value = 1; value <= 100; value++) {
    const payload: RollPayload = { kind: 'dice', clientRollId: 'p', result: { notation: '1d100', rolls: [value], modifier: 0, total: value } };
    const [tens, units, ...rest] = diceForPayload(payload);
    assert.equal(rest.length, 0);
    assert.ok(tens && units);
    assert.equal(tens.sides, 10);
    assert.equal(units.sides, 10);
    assert.equal(tens.reading, 'tens');
    assert.equal(units.reading, 'units');
    const printed = Number(faceLabel(tens.value, 'tens')) + Number(faceLabel(units.value, 'units'));
    assert.equal(printed === 0 ? 100 : printed, value, `d100 result ${value}`);
  }
});

test('d100 mixes with other dice, and out-of-range values are dropped', () => {
  const mixed: RollPayload = { kind: 'dice', clientRollId: 'm', result: { notation: '1d100+1d6', rolls: [42, 5], modifier: 0, total: 47 } };
  assert.deepEqual(diceForPayload(mixed).map((die) => die.sides), [10, 10, 6]);
  const bad: RollPayload = { kind: 'dice', clientRollId: 'b', result: { notation: '1d100', rolls: [101], modifier: 0, total: 101 } };
  assert.deepEqual(diceForPayload(bad), []);
});

test('d12 results map to a face of the d12', () => {
  const payload: RollPayload = { kind: 'dice', clientRollId: 'd12', result: { notation: '1d12', rolls: [12], modifier: 0, total: 12 } };
  assert.deepEqual(diceForPayload(payload), [{ sides: 12, value: 12, colorway: 'neutral' }]);
});

test('the d100 pair lands on the requested faces through the physics', () => {
  let state = 99;
  const rng = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const payload: RollPayload = { kind: 'dice', clientRollId: 'x', result: { notation: '1d100', rolls: [70], modifier: 0, total: 70 } };
  const requests = diceForPayload(payload);
  const motion = prepareThrow(requests, { minX: -6, maxX: 6, minZ: -4, maxZ: 4 }, rng);
  const end = motion.frames.at(-1)!;
  requests.forEach((request, i) => {
    const q = end[i]!.quaternion.clone().multiply(motion.rotations[i]!);
    assert.equal(upwardResult(getDieShape(request.sides), q), request.value);
  });
});

test('every die has outward-facing bevelled triangles with matching normals, UVs and counts', () => {
  for (const sides of SUPPORTED_SIDES) {
    const shape = getDieShape(sides);
    const mesh = buildBevelledMesh(shape, 1);
    assert.equal(mesh.positions.length, mesh.normals.length);
    assert.equal(mesh.positions.length / 3, mesh.uvs.length / 2);
    assert.equal((mesh.positions.length / 3) % 3, 0);
    assert.ok(mesh.positions.every(Number.isFinite) && mesh.uvs.every(Number.isFinite));
    const perFace = mesh.positions.length / 3 / 3 / shape.faces.length;
    // Every face: (n - 2) fan triangles plus 2n chamfer triangles.
    const expected = shape.faces.reduce((sum, face) => sum + face.vertices.length - 2 + 2 * face.vertices.length, 0);
    assert.equal(mesh.positions.length / 9, expected);
    assert.ok(perFace > 0);
    // Counter-clockwise from outside: each triangle's geometric normal must point away from the die's centre.
    for (let t = 0; t < mesh.positions.length; t += 9) {
      const p = (k: number) => new THREE.Vector3(mesh.positions[t + k * 3], mesh.positions[t + k * 3 + 1], mesh.positions[t + k * 3 + 2]);
      const normal = p(1).clone().sub(p(0)).cross(p(2).clone().sub(p(0)));
      const centroid = p(0).add(p(1)).add(p(2)).divideScalar(3);
      assert.ok(normal.dot(centroid) > 0, `d${sides}: triangle at ${t} faces inward`);
    }
  }
});

test('the bevelled mesh keeps every face flat on its collider plane, so dice rest without a gap', () => {
  for (const sides of SUPPORTED_SIDES) {
    const shape = getDieShape(sides);
    const mesh = buildBevelledMesh(shape, 1);
    // The farthest a flat-top vertex may sit beyond its face plane is zero. Chamfer vertices only move inward.
    for (let v = 0; v < mesh.positions.length; v += 3) {
      const point = new THREE.Vector3(mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]);
      const limit = Math.max(...shape.faces.map((face) => point.dot(new THREE.Vector3(...face.normal)) - new THREE.Vector3(...face.normal).dot(new THREE.Vector3(...face.center))));
      assert.ok(limit < 1e-6, `d${sides}: vertex pokes out of the collider`);
    }
  }
});

test('hard impacts are reported in time order, inside the throw', () => {
  const requests = [{ sides: 20, value: 7, colorway: 'neutral' as const }, { sides: 6, value: 3, colorway: 'neutral' as const }];
  const motion = prepareThrow(requests, { minX: -6, maxX: 6, minZ: -4, maxZ: 4 });
  assert.ok(motion.impacts.length > 0, 'a thrown die must hit the floor at least once');
  motion.impacts.forEach((impact, i) => {
    assert.ok(impact.time >= 0 && impact.time <= motion.duration + 1e-6);
    assert.ok(impact.strength > 0);
    if (i > 0) assert.ok(impact.time >= motion.impacts[i - 1]!.time);
  });
});

test('saved appearances accept the new finishes and presets', () => {
  for (const finish of ['pearl', 'marble']) assert.equal(parseAppearance(JSON.stringify({ finish })).finish, finish);
  assert.equal(parseAppearance(JSON.stringify({ preset: 'abyss' })).preset, 'abyss');
  const tens = paletteFor('percentile', parseAppearance('{}'));
  const units = paletteFor('neutral', parseAppearance('{}'));
  assert.notEqual(tens.body, units.body);
});

test('auto quality gives touch devices and small machines the light profile, and a choice always wins', () => {
  const desktop = { coarsePointer: false, cores: 12, memoryGb: 16 };
  assert.equal(pickQuality('auto', desktop).id, 'full');
  assert.equal(pickQuality('auto', { ...desktop, coarsePointer: true }).id, 'light');
  assert.equal(pickQuality('auto', { ...desktop, cores: 4 }).id, 'light');
  assert.equal(pickQuality('auto', { ...desktop, memoryGb: 4 }).id, 'light');
  assert.equal(pickQuality('full', { ...desktop, coarsePointer: true }).id, 'full');
  assert.equal(pickQuality('light', desktop).id, 'light');
  assert.equal(parseChoice('light'), 'light');
  assert.equal(parseChoice('weird'), 'auto');
  assert.equal(parseChoice(null), 'auto');
});

test('the light profile asks for less of everything it can', () => {
  assert.ok(QUALITY.light.pixelRatio < QUALITY.full.pixelRatio);
  assert.ok(QUALITY.light.shadowMapSize < QUALITY.full.shadowMapSize);
  assert.ok(QUALITY.light.atlasCellPx < QUALITY.full.atlasCellPx);
  assert.ok(QUALITY.light.envSize < QUALITY.full.envSize);
  assert.equal(QUALITY.light.fancyMaterials, false);
});
