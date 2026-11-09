export interface Point { x: number; y: number }
export interface Camera extends Point { s: number }
export interface Pinch { center: Point; distance: number }

export function pinchPose(a: Point, b: Point): Pinch {
  return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) };
}

/** Keep the world point between the fingers anchored while zooming and panning. */
export function pinchCamera(camera: Camera, previous: Pinch, next: Pinch): Camera {
  const anchor = { x: (previous.center.x - camera.x) / camera.s, y: (previous.center.y - camera.y) / camera.s };
  const s = Math.min(6, Math.max(0.05, camera.s * next.distance / previous.distance));
  return { s, x: next.center.x - anchor.x * s, y: next.center.y - anchor.y * s };
}
