/**
 * Die geometry as plain math: convex solids, face frames, numeral placement and the
 * body-space direction that must face up for each result.
 *
 * Nothing here touches the DOM, three.js or cannon-es, so the geometry can be checked on
 * its own. Conventions:
 * - Vertices are scaled so the farthest one sits at distance 1 from the centre.
 * - Each face lists its vertices counter-clockwise when seen from outside the die.
 * - A result is shown by rotating the die until its `dir` points up.
 */

export type Vec3 = readonly [number, number, number];

export interface Face {
  /** Vertex indices, counter-clockwise when seen from outside. */
  readonly vertices: readonly number[];
  /** Unit outward normal. */
  readonly normal: Vec3;
  /** Centroid of the face's vertices. */
  readonly center: Vec3;
  /** Unit in-plane direction that reads as "up" on this face. */
  readonly textUp: Vec3;
  /** Unit in-plane direction that reads as "right" on this face, seen from outside. */
  readonly right: Vec3;
  /** Distance from the centre to the farthest face vertex. */
  readonly radius: number;
}

export interface Numeral {
  value: number;
  /** Index of the face whose atlas cell holds this numeral. */
  face: number;
  /** Body-space point the numeral is centred on. */
  anchor: Vec3;
  /** Body-space in-plane direction the top of the numeral points toward. */
  up: Vec3;
}

export interface Result {
  value: number;
  /** Body-space direction that must point straight up to show this value. */
  dir: Vec3;
  /** Body-space in-plane direction that should point away from the camera, so the numeral reads upright. */
  up: Vec3;
}

export interface DieShape {
  readonly sides: number;
  /** Vertices at unit distance from the centre. */
  readonly vertices: readonly Vec3[];
  readonly faces: readonly Face[];
  readonly numerals: readonly Numeral[];
  /** Indexed by value - 1. */
  readonly results: readonly Result[];
  /** Atlas grid: one cell per face. */
  readonly cols: number;
  readonly rows: number;
}

export const SUPPORTED_SIDES = [4, 6, 8, 10, 12, 20] as const;
export type DieSides = (typeof SUPPORTED_SIDES)[number];

export function isSupportedSides(sides: number): sides is DieSides {
  return (SUPPORTED_SIDES as readonly number[]).includes(sides);
}

/** How far a face's outer corners reach from the centre of its atlas cell, as a fraction of the half-cell. */
export const CELL_MARGIN = 0.9;

/** Where a d4 corner numeral sits, as a fraction of the way from the face centre to the corner. */
const CORNER_INSET = 0.6;

const PHI = (1 + Math.sqrt(5)) / 2;
const SIGNS = [-1, 1] as const;

const shapeCache = new Map<DieSides, DieShape>();

export function getDieShape(sides: number): DieShape {
  if (!isSupportedSides(sides)) {
    throw new RangeError(`Unsupported die: d${sides}`);
  }
  let shape = shapeCache.get(sides);
  if (!shape) {
    shape = buildShape(sides);
    shapeCache.set(sides, shape);
  }
  return shape;
}

/** Atlas position of a body-space point on a face, as fractions of the whole texture, y pointing down. */
export function atlasPoint(shape: DieShape, faceIndex: number, point: Vec3): [number, number] {
  const face = at(shape.faces, faceIndex);
  const d = sub(point, face.center);
  const x = dot(d, face.right) / face.radius;
  const y = dot(d, face.textUp) / face.radius;
  const col = faceIndex % shape.cols;
  const row = Math.floor(faceIndex / shape.cols);
  return [
    (col + 0.5 + 0.5 * CELL_MARGIN * x) / shape.cols,
    (row + 0.5 - 0.5 * CELL_MARGIN * y) / shape.rows,
  ];
}

/** Fan triangulation of a face, each triangle counter-clockwise when seen from outside. */
export function faceTriangles(shape: DieShape, faceIndex: number): Vec3[][] {
  const face = at(shape.faces, faceIndex);
  const corners = face.vertices.map((i) => at(shape.vertices, i));
  const triangles: Vec3[][] = [];
  for (let t = 1; t < corners.length - 1; t++) {
    triangles.push([at(corners, 0), at(corners, t), at(corners, t + 1)]);
  }
  return triangles;
}

/** Face-plane components of a body-space direction: [along right, along textUp]. */
export function faceDirection(shape: DieShape, faceIndex: number, direction: Vec3): [number, number] {
  const face = at(shape.faces, faceIndex);
  return [dot(direction, face.right), dot(direction, face.textUp)];
}

function buildShape(sides: DieSides): DieShape {
  const vertices = scaleToUnitRadius(rawVertices(sides));
  const faces = hullFaces(vertices).map((hull) => describeFace(vertices, hull.vertices, hull.normal));
  const { numerals, results } = sides === 4 ? cornerNumerals(vertices, faces) : faceNumerals(faces);
  if (results.length !== sides) {
    throw new Error(`d${sides} built ${results.length} results`);
  }
  const cols = Math.ceil(Math.sqrt(faces.length));
  const rows = Math.ceil(faces.length / cols);
  return { sides, vertices, faces, numerals, results, cols, rows };
}

function rawVertices(sides: DieSides): Vec3[] {
  switch (sides) {
    case 4:
      // Regular tetrahedron. Results are read at the top vertex, so numerals sit at the corners.
      return [
        [1, 1, 1],
        [1, -1, -1],
        [-1, 1, -1],
        [-1, -1, 1],
      ];
    case 6:
      return cube();
    case 8:
      return [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ];
    case 10:
      return pentagonalTrapezohedron();
    case 12:
      return dodecahedron();
    case 20:
      return icosahedron();
  }
}

function cube(): Vec3[] {
  const out: Vec3[] = [];
  for (const x of SIGNS) for (const y of SIGNS) for (const z of SIGNS) out.push([x, y, z]);
  return out;
}

function dodecahedron(): Vec3[] {
  const out = cube();
  const inv = 1 / PHI;
  for (const s of SIGNS) {
    for (const t of SIGNS) {
      out.push([0, s * inv, t * PHI], [s * inv, t * PHI, 0], [t * PHI, 0, s * inv]);
    }
  }
  return out;
}

function icosahedron(): Vec3[] {
  const out: Vec3[] = [];
  for (const s of SIGNS) {
    for (const t of SIGNS) {
      out.push([0, s, t * PHI], [s, t * PHI, 0], [t * PHI, 0, s]);
    }
  }
  return out;
}

/**
 * Pentagonal trapezohedron: two apexes on the vertical axis and two staggered pentagonal
 * rings. The ring height is tan^2(18 degrees) of the apex height, which makes each of the
 * ten kite faces planar. The ring radius is free, and 0.85 gives a d10-like silhouette.
 */
function pentagonalTrapezohedron(): Vec3[] {
  const ringHeight = Math.tan(Math.PI / 10) ** 2;
  const ringRadius = 0.85;
  const out: Vec3[] = [
    [0, 1, 0],
    [0, -1, 0],
  ];
  for (let k = 0; k < 5; k++) {
    const upper = (2 * Math.PI * k) / 5;
    const lower = upper + Math.PI / 5;
    out.push([ringRadius * Math.cos(upper), ringHeight, ringRadius * Math.sin(upper)]);
    out.push([ringRadius * Math.cos(lower), -ringHeight, ringRadius * Math.sin(lower)]);
  }
  return out;
}

function scaleToUnitRadius(points: readonly Vec3[]): Vec3[] {
  const farthest = Math.max(...points.map((p) => len(p)));
  return points.map((p) => scale(p, 1 / farthest));
}

interface HullFace {
  vertices: number[];
  normal: Vec3;
}

/**
 * Faces of a convex point set, found by brute force: any plane through three points with
 * every other point on one side is a supporting plane, and its coplanar points form a face.
 * Fine for the handful of vertices a die has.
 */
function hullFaces(points: readonly Vec3[]): HullFace[] {
  const eps = 1e-7;
  const faces = new Map<string, HullFace>();
  const n = points.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = at(points, i);
        const raw = cross(sub(at(points, j), a), sub(at(points, k), a));
        const length = len(raw);
        if (length < eps) continue;

        const normal = scale(raw, 1 / length);
        const offset = dot(normal, a);
        let above = false;
        let below = false;
        const on: number[] = [];
        for (let m = 0; m < n; m++) {
          const side = dot(normal, at(points, m)) - offset;
          if (side > eps) above = true;
          else if (side < -eps) below = true;
          else on.push(m);
        }
        // Points on both sides means the plane cuts the solid; points on neither means degenerate.
        if (above === below) continue;

        const outward = above ? scale(normal, -1) : normal;
        const key = on.join(',');
        if (!faces.has(key)) {
          faces.set(key, { vertices: orderCounterClockwise(points, on, outward), normal: outward });
        }
      }
    }
  }
  return [...faces.values()];
}

function orderCounterClockwise(points: readonly Vec3[], indices: readonly number[], outward: Vec3): number[] {
  const corners = indices.map((i) => at(points, i));
  const center = average(corners);
  const e1 = norm(sub(at(corners, 0), center));
  const e2 = cross(outward, e1);
  const angle = new Map<number, number>();
  for (const i of indices) {
    const d = sub(at(points, i), center);
    angle.set(i, Math.atan2(dot(d, e2), dot(d, e1)));
  }
  return [...indices].sort((p, q) => (angle.get(p) ?? 0) - (angle.get(q) ?? 0));
}

function describeFace(points: readonly Vec3[], indices: readonly number[], normal: Vec3): Face {
  const corners = indices.map((i) => at(points, i));
  const center = average(corners);
  const textUp = norm(sub(at(corners, 0), center));
  const right = cross(textUp, normal);
  const radius = Math.max(...corners.map((c) => len(sub(c, center))));
  return { vertices: indices, normal, center, textUp, right, radius };
}

function faceNumerals(faces: readonly Face[]): { numerals: Numeral[]; results: Result[] } {
  const numerals: Numeral[] = [];
  const results: Result[] = [];
  faces.forEach((face, index) => {
    const value = index + 1;
    numerals.push({ value, face: index, anchor: face.center, up: face.textUp });
    results.push({ value, dir: face.normal, up: face.textUp });
  });
  return { numerals, results };
}

/** d4: every corner carries its vertex's value. The result is the vertex pointing up. */
function cornerNumerals(
  points: readonly Vec3[],
  faces: readonly Face[],
): { numerals: Numeral[]; results: Result[] } {
  const numerals: Numeral[] = [];
  const results: Result[] = [];
  points.forEach((vertex, index) => {
    const value = index + 1;
    let home: Face | undefined;
    for (const [faceIndex, face] of faces.entries()) {
      if (!face.vertices.includes(index)) continue;
      home ??= face;
      numerals.push({
        value,
        face: faceIndex,
        anchor: lerp(face.center, vertex, CORNER_INSET),
        up: norm(sub(vertex, face.center)),
      });
    }
    if (!home) throw new Error(`d4 vertex ${index} is on no face`);
    results.push({ value, dir: norm(vertex), up: norm(sub(vertex, home.center)) });
  });
  return { numerals, results };
}

function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new RangeError(`Index ${index} out of range`);
  return item;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(a, scale(sub(b, a), t));
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function len(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

function norm(a: Vec3): Vec3 {
  return scale(a, 1 / len(a));
}

function average(points: readonly Vec3[]): Vec3 {
  const sum = points.reduce<Vec3>((acc, p) => add(acc, p), [0, 0, 0]);
  return scale(sum, 1 / points.length);
}
