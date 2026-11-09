import { type Colorway } from './colorways';
import { atlasPoint, faceDirection, type DieShape } from './shapes';

/** Pixels per atlas cell. One cell per face. */
const CELL_PX = 192;

/** Numeral height as a fraction of the cell, tuned per shape so numerals fit their faces. */
const NUMERAL_SIZE: Record<number, number> = { 4: 0.2, 6: 0.5, 8: 0.32, 10: 0.3, 12: 0.4, 20: 0.28 };

/**
 * Paints a die's faces: body colour everywhere, numerals placed on their faces. Each numeral
 * is rotated so its top points along the face's text-up direction, which is what makes it
 * read upright once the die is set to that result.
 */
export function buildAtlas(shape: DieShape, palette: Colorway): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = shape.cols * CELL_PX;
  canvas.height = shape.rows * CELL_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');

  ctx.fillStyle = palette.body;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const px = (NUMERAL_SIZE[shape.sides] ?? 0.3) * CELL_PX;
  ctx.font = `700 ${px}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = px * 0.14;
  ctx.strokeStyle = palette.outline;
  ctx.fillStyle = palette.numeral;

  for (const numeral of shape.numerals) {
    const [fx, fy] = atlasPoint(shape, numeral.face, numeral.anchor);
    const [dx, dy] = faceDirection(shape, numeral.face, numeral.up);
    const text = String(numeral.value);

    ctx.save();
    ctx.translate(fx * canvas.width, fy * canvas.height);
    // Canvas y points down, so the face's up axis is (dx, -dy) on screen. This angle maps canvas-up onto it.
    ctx.rotate(Math.atan2(dx, dy));
    ctx.strokeText(text, 0, 0);
    ctx.fillText(text, 0, 0);
    // Underline 6 and 9 so they cannot be misread.
    if (numeral.value === 6 || numeral.value === 9) {
      ctx.fillRect(-px * 0.3, px * 0.42, px * 0.6, px * 0.06);
    }
    ctx.restore();
  }
  return canvas;
}
