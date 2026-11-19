import * as THREE from 'three';
import type { Impact, PreparedThrow } from './simulation';

/**
 * A prepared throw as plain numbers, so it can cross from a worker to the page without copying objects.
 * Each frame holds, for every die: x, y, z, then the quaternion x, y, z, w.
 */
export interface PackedThrow {
  dice: number;
  frameCount: number;
  /** frameCount * dice * 7 numbers. */
  frames: Float64Array;
  /** dice * 4 numbers: the symmetry that puts the requested face on the face the physics landed on. */
  rotations: Float64Array;
  impacts: Impact[];
  duration: number;
}

const STRIDE = 7;

export function packThrow(throwData: PreparedThrow): PackedThrow {
  const dice = throwData.rotations.length;
  const frames = new Float64Array(throwData.frames.length * dice * STRIDE);
  throwData.frames.forEach((frame, f) => frame.forEach((pose, d) => {
    const at = (f * dice + d) * STRIDE;
    frames.set([pose.position.x, pose.position.y, pose.position.z, pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w], at);
  }));
  const rotations = new Float64Array(dice * 4);
  throwData.rotations.forEach((q, d) => rotations.set([q.x, q.y, q.z, q.w], d * 4));
  return { dice, frameCount: throwData.frames.length, frames, rotations, impacts: throwData.impacts, duration: throwData.duration };
}

export function unpackThrow(packed: PackedThrow): PreparedThrow {
  const { dice, frameCount, frames, rotations } = packed;
  const out: PreparedThrow['frames'] = [];
  for (let f = 0; f < frameCount; f++) {
    const frame: PreparedThrow['frames'][number] = [];
    for (let d = 0; d < dice; d++) {
      const at = (f * dice + d) * STRIDE;
      frame.push({
        position: new THREE.Vector3(frames[at], frames[at + 1], frames[at + 2]),
        quaternion: new THREE.Quaternion(frames[at + 3], frames[at + 4], frames[at + 5], frames[at + 6]),
      });
    }
    out.push(frame);
  }
  const symmetries = Array.from({ length: dice }, (_, d) => new THREE.Quaternion(rotations[d * 4], rotations[d * 4 + 1], rotations[d * 4 + 2], rotations[d * 4 + 3]));
  return { frames: out, rotations: symmetries, impacts: packed.impacts, duration: packed.duration };
}
