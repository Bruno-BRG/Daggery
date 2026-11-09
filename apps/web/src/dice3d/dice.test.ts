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
