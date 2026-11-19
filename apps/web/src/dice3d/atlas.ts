import { mixHex } from './appearance';
import { type Colorway } from './colorways';
import { faceLabel, type FaceReading } from './faceLabels';
import { atlasPoint, faceDirection, type DieShape } from './shapes';

/** Pixels per atlas cell, by default. One cell per face. */
const CELL_PX = 256;

/** Numeral height as a fraction of the cell, tuned per shape so numerals fit their faces. */
const NUMERAL_SIZE: Record<number, number> = { 4: 0.2, 6: 0.5, 8: 0.32, 10: 0.3, 12: 0.4, 20: 0.28 };

export interface AtlasOptions {
  finish?: 'matte' | 'polished' | 'metal' | 'pearl' | 'marble';
  reading?: FaceReading;
  /** Pixels per face. Tablets use fewer. */
  cellPx?: number;
}

/** Small seeded generator, so the same die always gets the same marble pattern. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Soft light and dark veins over the body colour, like a stone or swirled resin die. */
function paintMarble(ctx: CanvasRenderingContext2D, width: number, height: number, body: string, seed: number): void {
  const random = seeded(seed);
  const light = mixHex(body, '#ffffff', 0.55);
  const dark = mixHex(body, '#000000', 0.4);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, mixHex(body, '#ffffff', 0.12));
  gradient.addColorStop(0.5, body);
  gradient.addColorStop(1, mixHex(body, '#000000', 0.18));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let vein = 0; vein < 70; vein++) {
    const bright = vein % 3 !== 0;
    ctx.strokeStyle = bright ? light : dark;
    ctx.globalAlpha = bright ? 0.28 + random() * 0.3 : 0.22 + random() * 0.26;
    // A wide, soft stroke first, then a thin crisp one on top.
    for (const [lineWidth, alphaScale] of [[14 + random() * 22, 0.35], [1.2 + random() * 3.2, 1]] as const) {
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha *= alphaScale;
      let x = random() * width;
      let y = random() * height;
      let angle = random() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let step = 0; step < 14; step++) {
        angle += (random() - 0.5) * 1.2;
        const length = 22 + random() * 44;
        x += Math.cos(angle) * length;
        y += Math.sin(angle) * length;
        ctx.quadraticCurveTo(x - Math.cos(angle) * length * 0.5 + (random() - 0.5) * 30, y - Math.sin(angle) * length * 0.5 + (random() - 0.5) * 30, x, y);
      }
      ctx.stroke();
      ctx.globalAlpha /= alphaScale;
    }
  }
  ctx.globalAlpha = 1;
}

/** Fine speckle that breaks up flat colour, so resin does not look like plastic paint. */
function paintGrain(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number): void {
  const random = seeded(seed);
  const count = Math.round((width * height) / 90);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
    ctx.fillRect(random() * width, random() * height, 1 + random() * 1.6, 1 + random() * 1.6);
  }
}

function makeCanvas(shape: DieShape, cellPx = CELL_PX): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = shape.cols * cellPx;
  canvas.height = shape.rows * cellPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  return { canvas, ctx };
}

/** Calls `draw` once for every numeral, with the canvas moved and rotated so the numeral reads upright on its face. */
function eachNumeral(
  shape: DieShape,
  ctx: CanvasRenderingContext2D,
  reading: FaceReading | undefined,
  draw: (text: string, px: number) => void,
): void {
  const base = (NUMERAL_SIZE[shape.sides] ?? 0.3) * ctx.canvas.width / shape.cols;
  for (const numeral of shape.numerals) {
    const text = faceLabel(numeral.value, reading);
    // Two-digit labels are wider, so they shrink to stay on the face.
    const px = base * (text.length > 1 ? 0.82 : 1);
    ctx.font = `700 ${px}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const [fx, fy] = atlasPoint(shape, numeral.face, numeral.anchor);
    const [dx, dy] = faceDirection(shape, numeral.face, numeral.up);
    ctx.save();
    ctx.translate(fx * ctx.canvas.width, fy * ctx.canvas.height);
    // Canvas y points down, so the face's up axis is (dx, -dy) on screen. This angle maps canvas-up onto it.
    ctx.rotate(Math.atan2(dx, dy));
    draw(text, px);
    ctx.restore();
  }
}

const NEEDS_UNDERLINE = new Set(['6', '9', '60', '90']);

/**
 * Paints a die's faces: body colour everywhere, numerals placed on their faces. Each numeral
 * is rotated so its top points along the face's text-up direction, which is what makes it
 * read upright once the die is set to that result.
 */
export function buildAtlas(shape: DieShape, palette: Colorway, options: AtlasOptions = {}): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(shape, options.cellPx);
  const seed = hashText(`${shape.sides}:${palette.body}`);
  if (options.finish === 'marble') {
    paintMarble(ctx, canvas.width, canvas.height, palette.body, seed);
  } else {
    ctx.fillStyle = palette.body;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (options.finish !== 'metal') paintGrain(ctx, canvas.width, canvas.height, seed);
  }

  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.outline;
  ctx.fillStyle = palette.numeral;
  eachNumeral(shape, ctx, options.reading, (text, px) => {
    // A thin dark edge, so the numeral stays legible against marble veins and bright resin.
    ctx.lineWidth = px * 0.07;
    ctx.globalAlpha = 0.7;
    ctx.strokeText(text, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillText(text, 0, 0);
    // Underline 6 and 9 so they cannot be misread.
    if (NEEDS_UNDERLINE.has(text)) ctx.fillRect(-px * 0.3 * text.length, px * 0.42, px * 0.6 * text.length, px * 0.06);
  });
  return canvas;
}

/**
 * Height map for engraved numerals: white is the surface, black is cut into it. The shader reads
 * it as a bump map, so the numerals look carved into the die, as on a real one.
 */
export function buildBumpAtlas(shape: DieShape, reading?: FaceReading, cellPx?: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(shape, cellPx);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#8a8a8a';
  ctx.fillStyle = '#000000';
  eachNumeral(shape, ctx, reading, (text, px) => {
    // The grey halo makes a shallow slope around the cut instead of a hard step.
    ctx.lineWidth = px * 0.16;
    ctx.strokeText(text, 0, 0);
    ctx.fillText(text, 0, 0);
    if (NEEDS_UNDERLINE.has(text)) ctx.fillRect(-px * 0.3 * text.length, px * 0.42, px * 0.6 * text.length, px * 0.06);
  });
  return canvas;
}

// ------------------------------------------------------------------------------------------------ cache
// The face canvases are plain 2D canvases: they do not belong to a GL context, so a new stage can reuse them.
// Painting them is the slowest part of starting a roll on a tablet, so each style is painted once.
const CACHE_LIMIT = 48;
const cache = new Map<string, HTMLCanvasElement>();

function remember(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const made = make();
  cache.set(key, made);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return made;
}

export function cachedAtlas(shape: DieShape, palette: Colorway, options: AtlasOptions = {}): HTMLCanvasElement {
  return remember(`c|${shape.sides}|${palette.body}|${palette.numeral}|${palette.outline}|${options.finish ?? ''}|${options.reading ?? ''}|${options.cellPx ?? CELL_PX}`, () => buildAtlas(shape, palette, options));
}
export function cachedBumpAtlas(shape: DieShape, reading?: FaceReading, cellPx?: number): HTMLCanvasElement {
  return remember(`b|${shape.sides}|${reading ?? ''}|${cellPx ?? CELL_PX}`, () => buildBumpAtlas(shape, reading, cellPx));
}
