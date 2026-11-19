import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { resultSymmetry, upwardResult } from './landing';
import { getDieShape } from './shapes';
import { MAX_TRAY_DICE, type DieRequest } from './rollPlan';

export const DIE_RADIUS = .7;
export const PHYSICS_STEP = 1 / 60;
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Pose { position: THREE.Vector3; quaternion: THREE.Quaternion }
/** A die hitting the floor or another die: when (physics seconds), where, and how hard. */
export interface Impact { time: number; x: number; z: number; strength: number }
export interface PreparedThrow {
  frames: Pose[][];
  rotations: THREE.Quaternion[];
  /** Hard hits in order, for rings, dust and camera shake. Cosmetic: they never change a result. */
  impacts: Impact[];
  duration: number;
}
/** Hits slower than this are rolling contact, not an impact. */
const MIN_IMPACT_SPEED = 1.6;
const MAX_IMPACTS = 40;

/** Simulate once, then play these exact poses. Frame-rate drops cannot alter the result. */
export function prepareThrow(requests: readonly DieRequest[], bounds: Bounds, rng = Math.random): PreparedThrow {
  const list = requests.slice(0, MAX_TRAY_DICE);
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -34, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  const floorMaterial = new CANNON.Material('floor'), diceMaterial = new CANNON.Material('dice');
  world.addContactMaterial(new CANNON.ContactMaterial(floorMaterial, diceMaterial, { friction: .4, restitution: .3 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMaterial, diceMaterial, { friction: .3, restitution: .25 }));
  const floor = new CANNON.Body({ mass: 0, material: floorMaterial });
  floor.addShape(new CANNON.Plane()); floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0); world.addBody(floor);
  const { minX, maxX, minZ, maxZ } = bounds;
  const wall = (x: number, z: number, hx: number, hz: number) => {
    const body = new CANNON.Body({ mass: 0, material: floorMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(hx, 4, hz))); body.position.set(x, 4, z); world.addBody(body);
  };
  wall(minX - .5, (minZ + maxZ) / 2, .5, (maxZ - minZ) / 2 + .5);
  wall(maxX + .5, (minZ + maxZ) / 2, .5, (maxZ - minZ) / 2 + .5);
  wall((minX + maxX) / 2, minZ - .5, (maxX - minX) / 2 + .5, .5);
  wall((minX + maxX) / 2, maxZ + .5, (maxX - minX) / 2 + .5, .5);
  const random = (low: number, high: number) => low + rng() * (high - low);
  const impacts: Impact[] = [];
  const bodies = list.map((request, index) => {
    const shape = getDieShape(request.sides);
    const body = new CANNON.Body({ mass: 1, material: diceMaterial, linearDamping: .16, angularDamping: .2 });
    body.addShape(new CANNON.ConvexPolyhedron({ vertices: shape.vertices.map(([x,y,z]) => new CANNON.Vec3(x*DIE_RADIUS,y*DIE_RADIUS,z*DIE_RADIUS)), faces: shape.faces.map(face=>[...face.vertices]) }));
    body.position.set(minX + (maxX-minX)*(index+1)/(list.length+1), random(2.6,3.6) + Math.floor(index/6)*.6, maxZ - 1 - random(0,.6));
    body.quaternion.setFromEuler(random(0,Math.PI*2),random(0,Math.PI*2),random(0,Math.PI*2));
    body.velocity.set(random(-1.2,1.2),random(1.5,3),-random(4.5,7));
    body.angularVelocity.set(random(-16,16),random(-16,16),random(-16,16));
    body.addEventListener('collide', (event: { contact: CANNON.ContactEquation }) => {
      const strength = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (strength < MIN_IMPACT_SPEED || impacts.length >= MAX_IMPACTS) return;
      // One landing touches the floor at several points in a row. Keep the first.
      const last = impacts.at(-1);
      if (last && world.time - last.time < .08 && Math.hypot(last.x - body.position.x, last.z - body.position.z) < 1) return;
      impacts.push({ time: world.time, x: body.position.x, z: body.position.z, strength });
    });
    world.addBody(body); return body;
  });
  const capture = () => bodies.map(body => ({ position: new THREE.Vector3(body.position.x,body.position.y,body.position.z), quaternion: new THREE.Quaternion(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w) }));
  const frames = [capture()];
  let rest = 0;
  for (let step = 0; step < 480; step++) {
    world.step(PHYSICS_STEP);
    frames.push(capture());
    rest = bodies.every(body => body.velocity.length() < .12 && body.angularVelocity.length() < .15) ? rest + PHYSICS_STEP : 0;
    if (rest >= .25) break;
    // Break a rare pile-up while still in the unseen simulation; never correct a visible landing.
    if (step === 240) for (const body of bodies) if (body.position.y > DIE_RADIUS * 1.5) body.applyImpulse(new CANNON.Vec3(random(-1,1),1,random(-1,1)));
  }
  const final = frames[frames.length-1]!;
  const rotations = list.map((request,index) => {
    const shape = getDieShape(request.sides);
    return resultSymmetry(shape, request.value, upwardResult(shape, final[index]!.quaternion));
  });
  return { frames, rotations, impacts, duration: (frames.length-1)*PHYSICS_STEP };
}
