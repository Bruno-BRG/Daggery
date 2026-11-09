import * as THREE from 'three';
import type { DieShape } from './shapes';

const UP = new THREE.Vector3(0, 1, 0);
const symmetries = new Map<string, THREE.Quaternion>();

/** The physical face/vertex nearest vertical. d4 results are read at the upper vertex. */
export function upwardResult(shape: DieShape, orientation: THREE.Quaternion): number {
  return shape.results.reduce((best, result) => {
    const height = new THREE.Vector3(...result.dir).applyQuaternion(orientation).y;
    return height > best.height ? { value: result.value, height } : best;
  }, { value: 1, height: -Infinity }).value;
}

/**
 * A fixed symmetry of the solid, chosen BEFORE playback. It moves the requested numeral
 * onto the face the simulation will land on. Every vertex still coincides with the collider;
 * the mesh follows the entire physical trajectory without a final correction or relabeling.
 */
export function resultSymmetry(shape: DieShape, desired: number, physical: number): THREE.Quaternion {
  const key = `${shape.sides}:${desired}:${physical}`;
  const cached = symmetries.get(key);
  if (cached) return cached.clone();
  const source = shape.results[desired - 1], target = shape.results[physical - 1];
  if (!source || !target) throw new RangeError('Invalid die result');
  const from = new THREE.Vector3(...source.dir), to = new THREE.Vector3(...target.dir);
  const vertex = shape.vertices.map(v => new THREE.Vector3(...v)).find(v => Math.abs(v.clone().normalize().dot(from)) < .98)!;
  const basis = (axis: THREE.Vector3, v: THREE.Vector3) => {
    const x = v.clone().addScaledVector(axis, -v.dot(axis)).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, axis, x.clone().cross(axis)));
  };
  const sourceBasis = basis(from, vertex).invert();
  for (const candidate of shape.vertices) {
    const v = new THREE.Vector3(...candidate);
    if (Math.abs(v.dot(to) - vertex.dot(from)) > 1e-5) continue;
    const rotation = basis(to, v).multiply(sourceBasis);
    if (!shape.vertices.every(point => {
      const transformed = new THREE.Vector3(...point).applyQuaternion(rotation);
      return shape.vertices.some(original => transformed.distanceToSquared(new THREE.Vector3(...original)) < 1e-9);
    })) continue;
    symmetries.set(key, rotation.clone());
    return rotation;
  }
  throw new Error(`No d${shape.sides} symmetry maps ${desired} to ${physical}`);
}

/**
 * Orientation that shows `value` on top. The die is turned so the result direction points up,
 * then spun about the vertical axis so the numeral's top points away from the camera. The camera
 * sits on the +Z side looking toward -Z, so the numeral reads upright from there.
 */
export function restingOrientation(shape: DieShape, value: number): THREE.Quaternion {
  const result = shape.results[value - 1];
  if (!result) throw new RangeError(`d${shape.sides} has no face ${value}`);

  const align = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(...result.dir),
    UP,
  );
  const reading = new THREE.Vector3(...result.up).applyQuaternion(align);
  // Yaw so the horizontal part of `reading` lands on -Z. Rotating by yaw moves its angle about Y by -yaw.
  const yaw = Math.atan2(reading.z, reading.x) + Math.PI / 2;
  return new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(align);
}
