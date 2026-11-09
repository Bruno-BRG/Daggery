import { paletteFor, type DiceAppearance } from './appearance';
import { FADE_MS, FLAT_THROW_SECONDS, HOLD_MS, MAX_PIXEL_RATIO, REDUCED_MOTION_SECONDS } from './motion';
import { MAX_TRAY_DICE, type DieRequest } from './rollPlan';
import type { StageHooks, TrayRect } from './stage';

/*
 * Flat dice for browsers where the 3D stage cannot start. Each roll shows the values already
 * computed for it, drawn on a 2D canvas. Queueing, the hold, and the fade follow DiceStage, and
 * the canvas is removed once the dice have faded, so an idle page keeps no canvas at all.
 */

interface FlatJob { requests: DieRequest[]; appearance: DiceAppearance; resolve: () => void; reject: (reason: Error) => void }
interface FlatDie { sides: number; value: number; fill: string; numeral: string; outline: string; x: number; restY: number; startY: number; size: number; spin: number }
interface ActiveFlat { job: FlatJob; elapsed: number; duration: number }

/** Outline of each die in units of its radius, so each size has its own silhouette. */
const SHAPES: Record<number, ReadonlyArray<readonly [number, number]>> = {
  4: [[0, -1], [0.92, 0.7], [-0.92, 0.7]],
  6: [[-0.82, -0.82], [0.82, -0.82], [0.82, 0.82], [-0.82, 0.82]],
  8: [[0, -1], [0.9, 0], [0, 1], [-0.9, 0]],
  10: [[0, -1.12], [0.78, 0], [0, 1.12], [-0.78, 0]],
  12: [[0, -1], [0.95, -0.31], [0.59, 0.81], [-0.59, 0.81], [-0.95, -0.31]],
  20: [[0, -1], [0.87, -0.5], [0.87, 0.5], [0, 1], [-0.87, 0.5], [-0.87, -0.5]],
};

/** Penner's bounce-out curve. The drop uses it, so each die bounces before it settles. */
function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) {
    const u = t - 1.5 / d;
    return n * u * u + 0.75;
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d;
    return n * u * u + 0.9375;
  }
  const u = t - 2.625 / d;
  return n * u * u + 0.984375;
}

/** A face shown while a die tumbles. It is visual only; the rolled value replaces it at the end. */
function tumbleFace(sides: number, index: number, elapsed: number): number {
  const step = Math.floor((elapsed * 1000) / 70);
  return 1 + ((step * 7 + index * 5) % sides);
}

/** Where a die is at progress t of its throw: falling with bounces, spinning down to flat. */
function pose(die: FlatDie, t: number): { x: number; y: number; angle: number; scale: number; lift: number } {
  const y = die.startY + (die.restY - die.startY) * bounceOut(t);
  const lift = Math.min(1, Math.max(0, (die.restY - y) / (die.restY - die.startY)));
  return { x: die.x, y, angle: die.spin * (1 - t) * (1 - t), scale: 1 + 0.12 * (1 - t), lift };
}

/** Flat fallback with the same surface contract as DiceStage. */
export class FlatStage {
  readonly kind = 'flat' as const;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly queue: FlatJob[] = [];
  private active: ActiveFlat | null = null;
  private dice: FlatDie[] = [];
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private progress = 1;
  private alpha = 1;
  private frameId = 0;
  private lastFrame = 0;
  private holdUntil = 0;
  private fadeStart: number | null = null;
  private rollsStarted = 0;
  private rollsCompleted = 0;
  private disposed = false;

  constructor(private readonly container: HTMLElement, private readonly rect: TrayRect, private readonly hooks: StageHooks = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.dataset.diceFlat = 'true';
    this.canvas.dataset.rollState = 'idle';
    this.canvas.dataset.rollsStarted = '0';
    this.canvas.dataset.rollsCompleted = '0';
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', display: 'block', width: '100%', height: '100%' });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available.');
    this.ctx = ctx;
    container.appendChild(this.canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Queues a roll. Resolves once the dice have landed, as DiceStage does. */
  enqueue(requests: DieRequest[], appearance: DiceAppearance): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed || !requests.length) {
        resolve();
        return;
      }
      this.queue.push({ requests: requests.slice(0, MAX_TRAY_DICE), appearance, resolve, reject });
      this.pump();
    });
  }

  /** Rejects the rolls still waiting here, then releases the canvas. */
  abort(reason: Error): void {
    if (this.disposed) return;
    const pending = this.active ? [this.active.job] : [];
    pending.push(...this.queue.splice(0));
    this.active = null;
    this.dispose();
    pending.forEach((job) => job.reject(reason));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.active?.job.resolve();
    this.active = null;
    this.queue.splice(0).forEach((job) => job.resolve());
    this.dice = [];
    this.canvas.remove();
  }

  private resize(): void {
    if (this.disposed) return;
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.paint();
  }

  private pump(): void {
    if (this.active || this.disposed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.dice = this.layout(job);
    const duration = this.reducedMotion.matches ? REDUCED_MOTION_SECONDS : FLAT_THROW_SECONDS;
    this.active = { job, elapsed: 0, duration };
    this.progress = 0;
    this.alpha = 1;
    this.fadeStart = null;
    this.canvas.dataset.rollState = 'rolling';
    this.canvas.dataset.rollsStarted = String(++this.rollsStarted);
    this.canvas.dataset.visibleValues = '';
    this.paint();
    this.lastFrame = performance.now();
    this.ensureLoop();
  }

  /** Places each die across the tray, in request order: Hope and Fear first, then any advantage die. */
  private layout(job: FlatJob): FlatDie[] {
    const left = this.rect.left * this.width;
    const right = this.rect.right * this.width;
    const top = this.rect.top * this.height;
    const bottom = this.rect.bottom * this.height;
    const slot = (right - left) / job.requests.length;
    const size = Math.max(28, Math.min(slot * 0.78, (bottom - top) * 0.42, 132));
    const restY = top + (bottom - top) * 0.55;
    return job.requests.map((request, index) => {
      const palette = paletteFor(request.colorway, job.appearance);
      return {
        sides: request.sides,
        value: request.value,
        fill: palette.body,
        numeral: palette.numeral,
        outline: palette.outline,
        x: left + slot * (index + 0.5),
        restY,
        startY: top - size,
        size,
        spin: (index % 2 === 0 ? 1 : -1) * (3 + (index % 3)) * Math.PI,
      };
    });
  }

  private readonly frame = (now: number): void => {
    this.frameId = 0;
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    let faded = false;
    if (this.active) {
      const active = this.active;
      active.elapsed = Math.min(active.duration, active.elapsed + dt);
      this.progress = active.elapsed / active.duration;
      if (active.elapsed >= active.duration) {
        this.progress = 1;
        this.active = null;
        this.holdUntil = now + HOLD_MS;
        this.canvas.dataset.rollState = 'settled';
        this.canvas.dataset.visibleValues = this.dice.map((die) => String(die.value)).join(',');
        this.canvas.dataset.rollsCompleted = String(++this.rollsCompleted);
        active.job.resolve();
        this.pump();
      }
    } else if (this.dice.length && now >= this.holdUntil) {
      this.fadeStart ??= now;
      this.alpha = Math.max(0, 1 - (now - this.fadeStart) / FADE_MS);
      if (!this.alpha) {
        this.dice = [];
        this.canvas.dataset.rollState = 'idle';
        faded = true;
      }
    }
    this.paint();
    if (this.active || this.dice.length) this.ensureLoop();
    else if (faded) this.hooks.onIdle?.();
  };

  private ensureLoop(): void {
    if (!this.frameId && !this.disposed) this.frameId = requestAnimationFrame(this.frame);
  }

  /** Draws the current frame: every shadow first, then each die with its numeral. */
  private paint(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.dice.length) return;
    const elapsed = this.active ? this.active.elapsed : 0;
    const poses = this.dice.map((die) => pose(die, this.progress));
    this.dice.forEach((die, index) => {
      const p = poses[index]!;
      ctx.save();
      ctx.globalAlpha = this.alpha * (0.22 + 0.16 * (1 - p.lift));
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(die.x, die.restY + die.size * 0.5, die.size * (0.55 + 0.2 * (1 - p.lift)), die.size * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    this.dice.forEach((die, index) => {
      const p = poses[index]!;
      const face = this.progress < 0.72 ? tumbleFace(die.sides, index, elapsed) : die.value;
      const radius = die.size / 2;
      const outline = SHAPES[die.sides] ?? SHAPES[6]!;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(p.scale, p.scale);
      ctx.beginPath();
      outline.forEach(([vx, vy], corner) => {
        if (corner === 0) ctx.moveTo(vx * radius, vy * radius);
        else ctx.lineTo(vx * radius, vy * radius);
      });
      ctx.closePath();
      ctx.fillStyle = die.fill;
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1.5, die.size * 0.05);
      ctx.strokeStyle = die.outline;
      ctx.stroke();
      ctx.font = `600 ${Math.round(die.size * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, die.size * 0.06);
      ctx.strokeStyle = die.outline;
      ctx.strokeText(String(face), 0, 0);
      ctx.fillStyle = die.numeral;
      ctx.fillText(String(face), 0, 0);
      ctx.restore();
    });
  }
}

