import type { MapDrawing } from './model';

function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** Hit-test strokes rather than their empty bounding boxes. Tolerance is world pixels. */
export function hitDrawing(drawing: MapDrawing, x: number, y: number, tolerance: number): boolean {
  const p = drawing.points;
  const ax = p[0] ?? 0, ay = p[1] ?? 0;
  const bx = p[2] ?? ax, by = p[3] ?? ay;
  const pad = tolerance + drawing.width / 2;
  if (drawing.kind === 'text') {
    const size = drawing.fontSize ?? 28;
    const lines = (drawing.text ?? '').split('\n');
    return x >= ax - pad && y >= ay - pad && x <= ax + Math.max(...lines.map(line => line.length), 1) * size * .66 + pad && y <= ay + lines.length * size * 1.3 + pad;
  }
  if (drawing.kind === 'ellipse') {
    const rx = Math.abs(bx - ax) / 2, ry = Math.abs(by - ay) / 2;
    if (!rx || !ry) return false;
    const radius = Math.hypot((x - (ax + bx) / 2) / rx, (y - (ay + by) / 2) / ry);
    return Math.abs(radius - 1) * Math.min(rx, ry) <= pad;
  }
  if (drawing.kind === 'rect') return [[ax, ay, bx, ay], [bx, ay, bx, by], [bx, by, ax, by], [ax, by, ax, ay]].some(s => segmentDistance(x, y, s[0]!, s[1]!, s[2]!, s[3]!) <= pad);
  for (let i = 2; i < p.length; i += 2) if (segmentDistance(x, y, p[i - 2]!, p[i - 1]!, p[i]!, p[i + 1]!) <= pad) return true;
  return false;
}

export function translateDrawing(drawing: MapDrawing, dx: number, dy: number): MapDrawing {
  return { ...drawing, points: drawing.points.map((point, index) => point + (index % 2 ? dy : dx)) };
}
