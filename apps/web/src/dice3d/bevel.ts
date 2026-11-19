import { atlasPoint, type DieShape, type Vec3 } from './shapes';

/**
 * Triangles for a die with softly bevelled edges, as plain arrays (no three.js).
 *
 * Each face becomes a flat inner polygon plus a thin chamfer ring. The flat part sits exactly on the
 * collider's face plane, so a die rests on the floor with no gap. Only the outer ring is pulled a
 * little toward the centre, which rounds the corners and catches light along every edge.
 */
export interface BevelledMesh {
  positions: number[];
  normals: number[];
  uvs: number[];
}

/** How far each face shrinks toward its centre before the chamfer starts (fraction of the corner distance). */
export const BEVEL_INSET = 0.1;
/** How far the outer edge is pulled toward the die's centre (fraction of the radius). */
export const BEVEL_PULL = 0.032;
/** Share of the chamfer normal that tilts toward the edge. 0 is flat shading, 1 is 45 degrees. */
const EDGE_ROUNDING = 0.8;

export function buildBevelledMesh(shape: DieShape, radius: number): BevelledMesh {
  const out: BevelledMesh = { positions: [], normals: [], uvs: [] };

  const push = (faceIndex: number, point: Vec3, normal: Vec3, uvPoint: Vec3) => {
    out.positions.push(point[0] * radius, point[1] * radius, point[2] * radius);
    out.normals.push(normal[0], normal[1], normal[2]);
    const [u, v] = atlasPoint(shape, faceIndex, uvPoint);
    out.uvs.push(u, 1 - v);
  };

  shape.faces.forEach((face, faceIndex) => {
    const corners = face.vertices.map((i) => shape.vertices[i]!);
    const flat = corners.map((c): Vec3 => lerp(face.center, c, 1 - BEVEL_INSET));
    const rim = corners.map((c): Vec3 => [c[0] * (1 - BEVEL_PULL), c[1] * (1 - BEVEL_PULL), c[2] * (1 - BEVEL_PULL)]);
    const rimNormals = corners.map((c): Vec3 => {
      const outward = normalize(sub(c, face.center));
      return normalize([
        face.normal[0] + outward[0] * EDGE_ROUNDING,
        face.normal[1] + outward[1] * EDGE_ROUNDING,
        face.normal[2] + outward[2] * EDGE_ROUNDING,
      ]);
    });

    // Flat top: a fan, counter-clockwise from outside.
    for (let t = 1; t < flat.length - 1; t++) {
      for (const k of [0, t, t + 1]) push(faceIndex, flat[k]!, face.normal, flat[k]!);
    }
    // Chamfer ring: two triangles for every edge.
    for (let i = 0; i < flat.length; i++) {
      const j = (i + 1) % flat.length;
      push(faceIndex, rim[i]!, rimNormals[i]!, corners[i]!);
      push(faceIndex, rim[j]!, rimNormals[j]!, corners[j]!);
      push(faceIndex, flat[j]!, face.normal, flat[j]!);
      push(faceIndex, rim[i]!, rimNormals[i]!, corners[i]!);
      push(faceIndex, flat[j]!, face.normal, flat[j]!);
      push(faceIndex, flat[i]!, face.normal, flat[i]!);
    }
  });
  return out;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}
