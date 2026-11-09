import { Application, Assets, CanvasSource, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';

import { hitDrawing, translateDrawing } from './annotations';

import type { Pool } from '@daggery/shared';

import { pinchCamera, pinchPose, type Pinch } from './camera';

import {
  BANDS,
  BOARD_STYLES,
  bandName,
  bandOf,
  initials,
  originOf,
  worldSize,
  type FogShape,
  type MapPing,
  type MapDrawing,
  type MapScene,
  type MapToken,
  type Role,
  type Tool,
} from './model';

export interface ViewCallbacks {
  onZoomChange?(percent: number): void;

  onSelectionPosition?(point: Pt | null): void;

  onDrawingAdd?(drawing: Pick<MapDrawing, 'kind' | 'points'>): void;

  onDrawingMove?(drawing: MapDrawing): void;

  onDrawingSelect?(id: string | null): void;

  onDrawingErase?(id: string): void;

  onText?(point: Pt): void;

  onSelect(id: string | null): void;

  onMoveToken(id: string, x: number, y: number, final: boolean): void;

  onFogAdd(mode: 'hide' | 'reveal', points: number[]): void;

  onAlignGrid(offsetX: number, offsetY: number, final: boolean): void;

  onPing(x: number, y: number): void;
}

export interface ViewState {
  scene: MapScene | undefined;

  /** Tokens of the scene. Hidden ones are dropped by the view for players. */

  tokens: MapToken[];

  fog: FogShape[];

  pings: MapPing[];

  drawings?: MapDrawing[];

  selectedDrawingId?: string | null;

  drawColor?: string;

  drawWidth?: number;

  role: Role;

  tool: Tool;

  fogShape: 'rect' | 'poly';

  snap: boolean;

  showRanges: boolean;

  selectedId: string | null;

  fitKey: number;

  callbacks: ViewCallbacks;
}

interface Pt {
  x: number;

  y: number;
}

type Gesture =
  | { kind: 'pan'; lx: number; ly: number }
  | { kind: 'pending'; sx: number; sy: number; timer: number }
  | {
      kind: 'token';

      id: string;

      grabX: number;

      grabY: number;

      sx: number;

      sy: number;

      moved: boolean;

      last: number;

      pos: Pt;
    }
  | { kind: 'ruler' }
  | { kind: 'draw'; drawing: MapDrawing }
  | { kind: 'drawing-move'; drawing: MapDrawing; start: Pt; dx: number; dy: number }
  | { kind: 'fog'; a: Pt; b: Pt; mode: 'hide' | 'reveal' }
  | {
      kind: 'align';

      wx: number;

      wy: number;

      ox0: number;

      oy0: number;

      ox: number;

      oy: number;

      sx: number;

      sy: number;

      moved: boolean;

      last: number;
    };

/** About 15 doc writes per second while dragging; the final position is written on release. */

const WRITE_INTERVAL_MS = 66;

const PING_HOLD_MS = 450;

const PING_LIFE_MS = 1400;

const FOG_MAX_SIDE = 3072;

const CONDITION_COLORS: Record<string, number> = {
  hidden: 0x475569,

  restrained: 0x7c3aed,

  vulnerable: 0xbe123c,
};

/**

 * Imperative Pixi.js renderer and pointer controller for the map. React owns the data;

 * this class draws it and reports user intent through ViewState.callbacks.

 */

export class MapView {
  private readonly canvas: HTMLCanvasElement;

  private readonly world = new Container();

  private readonly bg = new Graphics();

  private readonly mapSprite = new Sprite();

  private readonly grid = new Graphics();

  private readonly rings = new Graphics();

  private readonly ringLabels: Text[] = [];

  private readonly tokensLayer = new Container();

  private readonly drawingsLayer = new Container();

  private drawingsKey = '';

  private readonly fogSprite = new Sprite();

  private readonly overlay = new Graphics();

  private readonly rulerLabel = new Text({
    text: '',

    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 14,
      fontWeight: '600',
      fill: '#e5b04b',
      stroke: { color: '#0d0b13', width: 4 },
    },
  });

  private readonly pingLayer = new Container();

  private state: ViewState | null = null;

  private gesture: Gesture | null = null;

  private readonly touches = new Map<number, Pt>();

  private pinch: Pinch | null = null;

  private cam = { x: 0, y: 0, s: 1 };

  private spaceDown = false;

  private dragPos: { id: string; x: number; y: number } | null = null;

  private ruler: { a: Pt; b: Pt } | null = null;

  private poly: number[] = [];

  private polyCursor: Pt | null = null;

  private tokenViews = new Map<string, { node: Container; sig: string }>();

  private seenPings = new Set<string>();

  private pingAnims: { g: Graphics; x: number; y: number; t0: number }[] = [];

  private loading = new Set<string>();

  private mapKey = '';

  private gridKey = '';

  private fogKey = '';

  private fitSceneId = '';

  private fitSize = '';

  private fitKey = -1;

  private fitted = false;

  private screenSize = '';

  private reportedZoom = 0;

  private fogCanvas: HTMLCanvasElement | null = null;

  private fogSource: CanvasSource | null = null;

  private destroyed = false;

  /** Pending requestRender frame, or 0 when none is queued. */

  private frameId = 0;

  constructor(private readonly app: Application) {
    this.canvas = app.canvas as HTMLCanvasElement;

    this.tokensLayer.sortableChildren = true;

    this.world.addChild(
      this.bg,

      this.mapSprite,

      this.grid,

      this.rings,

      this.tokensLayer,

      this.drawingsLayer,

      this.fogSprite,

      this.overlay,

      this.pingLayer,
    );

    for (const band of BANDS) {
      const label = new Text({
        text: band.name,

        style: { fontFamily: 'system-ui, sans-serif', fontWeight: '600', fontSize: 14, fill: band.color },
      });

      label.anchor.set(0.5, 1);

      label.visible = false;

      this.ringLabels.push(label);

      this.world.addChild(label);
    }

    this.world.addChild(this.rulerLabel);

    this.rulerLabel.anchor.set(0.5, 1);

    this.rulerLabel.visible = false;

    this.canvas.style.touchAction = 'none';

    this.canvas.tabIndex = 0;

    this.canvas.setAttribute('role', 'img');

    this.canvas.addEventListener('pointerdown', this.onDown);

    this.canvas.addEventListener('pointermove', this.onMove);

    this.canvas.addEventListener('pointerup', this.onUp);

    this.canvas.addEventListener('pointercancel', this.onUp);

    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.canvas.addEventListener('contextmenu', this.onContextMenu);

    window.addEventListener('keydown', this.onKeyDown);

    window.addEventListener('keyup', this.onKeyUp);

    app.ticker.add(this.tick);

    app.stage.addChild(this.world);
  }

  destroy() {
    if (this.destroyed) return;

    this.destroyed = true;

    if (this.frameId) cancelAnimationFrame(this.frameId);

    if (this.gesture?.kind === 'pending') clearTimeout(this.gesture.timer);

    this.touches.clear();

    this.canvas.removeEventListener('pointerdown', this.onDown);

    this.canvas.removeEventListener('pointermove', this.onMove);

    this.canvas.removeEventListener('pointerup', this.onUp);

    this.canvas.removeEventListener('pointercancel', this.onUp);

    this.canvas.removeEventListener('wheel', this.onWheel);

    this.canvas.removeEventListener('contextmenu', this.onContextMenu);

    window.removeEventListener('keydown', this.onKeyDown);

    window.removeEventListener('keyup', this.onKeyUp);

    this.app.ticker.remove(this.tick);

    this.app.ticker.stop();

    this.world.destroy({ children: true });
  }

  /** Centre of the visible area in cell coordinates, used to place new tokens. */

  viewCenterCell(): Pt | null {
    const scene = this.state?.scene;

    if (!scene) return null;

    const c = this.toWorld(this.app.screen.width / 2, this.app.screen.height / 2);

    return {
      x: Math.floor((c.x - scene.offsetX) / scene.cell),

      y: Math.floor((c.y - scene.offsetY) / scene.cell),
    };
  }

  zoomBy(factor: number) {
    const x = this.app.screen.width / 2,
      y = this.app.screen.height / 2;

    const anchor = this.toWorld(x, y);

    this.cam.s = Math.min(6, Math.max(0.05, this.cam.s * factor));

    this.cam.x = x - anchor.x * this.cam.s;

    this.cam.y = y - anchor.y * this.cam.s;

    this.applyCam();
  }

  focusToken(id: string) {
    const token = this.state?.tokens.find((item) => item.id === id);

    const scene = this.state?.scene;

    if (!token || !scene) return;

    const point = originOf(scene, token.x, token.y);

    this.cam.s = Math.max(this.cam.s, 0.65);

    this.cam.x = this.app.screen.width / 2 - (point.x + (token.size * scene.cell) / 2) * this.cam.s;

    this.cam.y = this.app.screen.height / 2 - (point.y + (token.size * scene.cell) / 2) * this.cam.s;

    this.applyCam();
  }

  update(next: ViewState) {
    if (this.destroyed) return;

    this.state = next;

    this.requestRender();

    this.canvas.setAttribute(
      'aria-label',
      `Scene map: ${next.scene?.name ?? 'No scene'}. Arrow keys pan; plus and minus zoom; Home fits the scene.`,
    );

    const scene = next.scene;

    if (!scene) {
      this.world.visible = false;

      return;
    }

    this.world.visible = true;

    const { w, h } = worldSize(scene);

    const mapTex = scene.mapUrl ? this.texture(scene.mapUrl) : undefined;

    const mapKey = `${scene.id}|${scene.mapUrl ?? ''}|${scene.boardStyle}|${w}x${h}|${mapTex ? 1 : 0}`;

    if (mapKey !== this.mapKey) {
      this.mapKey = mapKey;

      this.gridKey = '';

      this.fogKey = '';

      this.drawBackground(w, h, mapTex);
    }

    // Refit when the scene changes or its size does (e.g. a new map image was uploaded).

    if (scene.id !== this.fitSceneId || `${w}x${h}` !== this.fitSize) {
      this.fitSceneId = scene.id;

      this.fitSize = `${w}x${h}`;

      this.fitted = false;
    }

    if (next.fitKey !== this.fitKey) {
      this.fitKey = next.fitKey;

      this.fitted = false;
    }

    if (!this.fitted) this.fitted = this.fit();

    const gridKey = `${scene.cell}|${scene.offsetX}|${scene.offsetY}|${scene.showGrid}|${scene.boardStyle}|${w}x${h}`;

    if (gridKey !== this.gridKey) {
      this.gridKey = gridKey;

      this.drawGrid(scene, w, h);
    }

    const fogKey = `${scene.id}|${w}x${h}|${next.fog.map((f) => f.id + f.mode).join(',')}`;

    if (fogKey !== this.fogKey) {
      this.fogKey = fogKey;

      this.drawFog(next.fog, w, h);
    }

    // GM sees through the fog; players see it opaque.

    this.fogSprite.alpha = next.role === 'GM' ? 0.55 : 1;

    // Switching tools drops the ruler and any unfinished fog polygon.

    if (next.tool !== 'ruler') this.ruler = null;

    if (!next.tool.startsWith('fog')) this.cancelPoly();

    this.syncTokens(next, scene);

    this.drawRings(next, scene);

    this.syncPings(next, scene);

    this.drawAnnotations();

    this.reportSelection();

    this.drawOverlay();

    this.canvas.style.cursor = this.cursor();
  }

  // ---- Rendering -----------------------------------------------------------------------------

  private texture(url: string): Texture | undefined {
    if (Assets.cache.has(url)) return Assets.cache.get<Texture>(url);

    if (!this.loading.has(url)) {
      this.loading.add(url);

      // Authenticated asset URLs end in an ID, so Pixi cannot infer their image loader from an extension.
      Assets.load<Texture>(/^\/api\/campaigns\/[^/]+\/assets\//.test(url) ? { src: url, parser: 'texture' } : url).then(
        () => {
          this.loading.delete(url);

          this.invalidate();
        },

        () => this.loading.delete(url),
      );
    }

    return undefined;
  }

  private invalidate() {
    if (this.destroyed) return;

    this.mapKey = '';

    for (const v of this.tokenViews.values()) v.sig = '';

    if (this.state) this.update(this.state);
  }

  private drawBackground(w: number, h: number, tex: Texture | undefined) {
    this.bg.clear();

    const palette = BOARD_STYLES[this.state?.scene?.boardStyle ?? 'midnight'];

    this.bg.rect(0, 0, w, h).fill({ color: palette.surface });

    this.bg.rect(0, 0, w, h).stroke({ width: 3, color: palette.edge });

    this.bg.visible = !tex;

    this.mapSprite.visible = !!tex;

    if (tex) {
      this.mapSprite.texture = tex;

      this.mapSprite.setSize(w, h);
    }
  }

  private drawGrid(scene: MapScene, w: number, h: number) {
    const g = this.grid;

    g.clear();

    const c = scene.cell;

    if (!scene.showGrid || c < 4) return;

    const mod = (v: number) => ((v % c) + c) % c;

    for (let x = mod(scene.offsetX); x <= w; x += c) g.moveTo(x, 0).lineTo(x, h);

    for (let y = mod(scene.offsetY); y <= h; y += c) g.moveTo(0, y).lineTo(w, y);

    g.stroke({
      width: Math.max(1, c * 0.012),
      color: BOARD_STYLES[scene.boardStyle ?? 'midnight'].grid,
      alpha: scene.mapUrl ? 0.23 : 0.2,
    });
  }

  /** Fog is one canvas: each shape in order paints (hide) or erases (reveal). Redrawn only when shapes change. */

  private drawFog(fog: FogShape[], w: number, h: number) {
    const k = Math.min(1, FOG_MAX_SIDE / Math.max(w, h, 1));

    const cw = Math.max(1, Math.ceil(w * k));

    const ch = Math.max(1, Math.ceil(h * k));

    if (!this.fogCanvas || this.fogCanvas.width !== cw || this.fogCanvas.height !== ch) {
      this.fogCanvas = document.createElement('canvas');

      this.fogCanvas.width = cw;

      this.fogCanvas.height = ch;

      this.fogSource = new CanvasSource({ resource: this.fogCanvas });

      this.fogSprite.texture = new Texture({ source: this.fogSource });
    }

    const ctx = this.fogCanvas.getContext('2d');

    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.clearRect(0, 0, cw, ch);

    ctx.setTransform(k, 0, 0, k, 0, 0);

    ctx.fillStyle = '#000';

    for (const f of fog) {
      const p = f.points;

      if (p.length < 6) continue;

      ctx.globalCompositeOperation = f.mode === 'hide' ? 'source-over' : 'destination-out';

      ctx.beginPath();

      ctx.moveTo(p[0] ?? 0, p[1] ?? 0);

      for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i] ?? 0, p[i + 1] ?? 0);

      ctx.closePath();

      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    this.fogSource?.update();

    this.fogSprite.setSize(w, h);

    this.fogSprite.visible = fog.length > 0;
  }

  private visibleTokens(st: ViewState): MapToken[] {
    return st.role === 'GM' ? st.tokens : st.tokens.filter((t) => !t.hidden);
  }

  private syncTokens(st: ViewState, scene: MapScene) {
    const seen = new Set<string>();

    const cell = scene.cell;

    for (const t of this.visibleTokens(st)) {
      seen.add(t.id);

      const selected = t.id === st.selectedId;

      const tex = t.image ? this.texture(t.image) : undefined;

      const sig = JSON.stringify([
        t.name,

        t.size,

        t.color,

        t.image ?? '',

        !!tex,

        t.hp ?? null,

        t.stress ?? null,

        t.conditions,

        t.statusColors,

        t.effect,

        t.rotation,

        t.hidden,

        t.locked,

        selected,

        st.role,

        cell,

        Math.round(this.cam.s * 10),
      ]);

      let view = this.tokenViews.get(t.id);

      if (!view || view.sig !== sig) {
        view?.node.destroy({ children: true });

        view = { node: this.buildToken(t, cell, selected, tex), sig };

        this.tokensLayer.addChild(view.node);

        this.tokenViews.set(t.id, view);
      }

      view.node.zIndex = t.effect ? 0 : selected ? 3 : 2;

      const d = this.dragPos;

      const pos = d && d.id === t.id ? d : t;

      this.placeToken(scene, t.id, pos.x, pos.y);
    }

    for (const [id, v] of this.tokenViews) {
      if (!seen.has(id)) {
        v.node.destroy({ children: true });

        this.tokenViews.delete(id);
      }
    }
  }

  private placeToken(scene: MapScene, id: string, x: number, y: number) {
    const v = this.tokenViews.get(id);

    if (!v) return;

    const o = originOf(scene, x, y);

    v.node.position.set(o.x, o.y);

    this.requestRender();
  }

  private buildToken(t: MapToken, cell: number, selected: boolean, tex: Texture | undefined): Container {
    const root = new Container();

    root.alpha = t.hidden ? 0.45 : 1;

    const px = t.size * cell;

    const r = px * 0.44;

    if (t.effect) {
      const g = new Graphics();

      const line = { width: Math.max(2 / this.cam.s, cell * 0.035), color: t.color, alpha: 0.96 };

      if (t.effect.shape === 'circle') {
        g.circle(px / 2, px / 2, px / 2).fill({ color: t.color, alpha: t.effect.opacity });

        for (let i = 0; i < 40; i++) {
          const angle = (i * Math.PI) / 20;

          g.moveTo(px / 2 + (Math.cos(angle) * px) / 2, px / 2 + (Math.sin(angle) * px) / 2)

            .arc(px / 2, px / 2, px / 2, angle, ((i + 0.56) * Math.PI) / 20)
            .stroke(line);
        }
      } else if (t.effect.shape === 'square') g.rect(0, 0, px, px).fill({ color: t.color, alpha: t.effect.opacity }).stroke(line);
      else {
        const a = -Math.PI / 2 + (t.rotation * Math.PI) / 180;

        const points = [px / 2, px / 2];

        for (let i = 0; i <= 24; i++) {
          const theta = a - Math.PI / 6 + (i * Math.PI) / 72;
          points.push(px / 2 + (Math.cos(theta) * px) / 2, px / 2 + (Math.sin(theta) * px) / 2);
        }

        g.poly(points).fill({ color: t.color, alpha: t.effect.opacity }).stroke(line);
      }

      if (selected) g.circle(px / 2, px / 2, cell * 0.09).fill({ color: '#e5b04b' });

      root.addChild(g);

      return root;
    }

    // The body rotates (image, facing marker); labels stay upright.

    const body = new Container();

    body.position.set(px / 2, px / 2);

    body.rotation = (t.rotation * Math.PI) / 180;

    root.addChild(body);

    const disc = new Graphics();

    disc.circle(cell * 0.035, cell * 0.065, r + cell * 0.035).fill({ color: 0x05040a, alpha: 0.5 });

    disc.circle(0, 0, r + cell * 0.045).fill({ color: 0x24232a });

    disc.circle(0, 0, r).fill({ color: t.color });

    body.addChild(disc);

    if (tex) {
      const img = new Sprite(tex);

      img.anchor.set(0.5);

      img.scale.set((2 * r) / Math.min(tex.width, tex.height));

      const clip = new Graphics();

      clip.circle(0, 0, r).fill({ color: 0xffffff });

      img.mask = clip;

      body.addChild(img, clip);
    } else {
      const letters = new Text({
        text: initials(t.name),

        style: { fontFamily: 'system-ui, sans-serif', fontWeight: '700', fontSize: Math.round(r * 0.8), fill: '#f8fafc' },
      });

      letters.anchor.set(0.5);

      letters.position.set(px / 2, px / 2);

      root.addChild(letters);
    }

    const rim = new Graphics();

    rim.circle(0, 0, r).stroke({ width: Math.max(2, cell * 0.035), color: selected ? 0xe5b04b : t.color });

    rim.circle(0, 0, r - cell * 0.045).stroke({ width: cell * 0.012, color: 0xfff6df, alpha: 0.4 });

    if (selected) rim.circle(0, 0, r + cell * 0.1).stroke({ width: cell * 0.025, color: 0xe5b04b, alpha: 0.6 });

    body.addChild(rim);

    t.conditions.forEach((condition, index) => {
      const ring = new Graphics();

      ring
        .circle(px / 2, px / 2, r + cell * (0.1 + index * 0.065))
        .stroke({
          width: Math.max(2 / this.cam.s, cell * 0.04),
          color: t.statusColors?.[condition] ?? CONDITION_COLORS[condition.toLowerCase()] ?? 0x38bdf8,
          alpha: 0.95,
        });

      root.addChild(ring);
    });

    const facing = new Graphics();

    const tip = -r - cell * 0.03;

    const base = -r + cell * 0.12;

    const half = cell * 0.08;

    facing.poly([0, tip, half, base, -half, base]).fill({ color: selected ? 0xe5b04b : 0xf8fafc });

    body.addChild(facing);

    let y = px + cell * 0.03;

    const name = new Text({
      text: t.name.length > 24 ? `${t.name.slice(0, 22)}…` : t.name,

      style: {
        fontFamily: 'system-ui, sans-serif',

        fontWeight: '600',

        fontSize: Math.max(12 / this.cam.s, Math.round(cell * 0.16)),

        fill: '#f3f0ea',

        stroke: { color: '#0d0b13', width: Math.max(2 / this.cam.s, cell * 0.03) },
      },
    });

    name.anchor.set(0.5, 0);

    name.position.set(px / 2, y);

    name.visible = selected || this.cam.s >= 0.35;

    root.addChild(name);

    if (name.visible) y += name.height + cell * 0.02;

    const barW = px * 0.8;

    const barH = Math.max(3 / this.cam.s, cell * 0.06);

    const bar = (pool: Pool | undefined, color: number) => {
      if (!pool || pool.max <= 0) return;

      const g = new Graphics();

      g.rect(0, 0, barW, barH).fill({ color: 0x0d0b13, alpha: 0.85 });

      const f = Math.max(0, Math.min(1, pool.current / pool.max));

      if (f > 0) g.rect(0, 0, barW * f, barH).fill({ color });

      g.position.set(px * 0.1, y);

      root.addChild(g);

      y += barH + cell * 0.02;
    };

    bar(t.hp, 0x5fd69f);

    bar(t.stress, 0xe5b04b);

    return root;
  }

  private drawRings(st: ViewState, scene: MapScene) {
    const g = this.rings;

    g.clear();

    this.requestRender();

    for (const l of this.ringLabels) l.visible = false;

    if (!st.showRanges || !st.selectedId) return;

    const t = this.visibleTokens(st).find((tk) => tk.id === st.selectedId);

    if (!t) return;

    const d = this.dragPos;

    const pos = d && d.id === t.id ? d : t;

    const o = originOf(scene, pos.x, pos.y);

    const c = scene.cell;

    const cx = o.x + (t.size * c) / 2;

    const cy = o.y + (t.size * c) / 2;

    const rA = (t.size * c) / 2;

    const fontSize = Math.max(10, Math.round(c * 0.16));

    BANDS.forEach((band, i) => {
      const rad = rA + (scene.ranges[i] ?? 0) * c;

      g.circle(cx, cy, rad).stroke({ width: Math.max(2, c * 0.03), color: band.color, alpha: 0.9 });

      const label = this.ringLabels[i];

      if (!label) return;

      label.style.fontSize = fontSize;

      label.style.fill = band.color;

      label.position.set(cx, cy - rad - c * 0.04);

      label.visible = true;
    });
  }

  private syncPings(st: ViewState, scene: MapScene) {
    const live = new Set<string>();

    for (const p of st.pings) {
      if (p.sceneId !== scene.id) continue;

      live.add(p.id);

      if (this.seenPings.has(p.id)) continue;

      this.seenPings.add(p.id);

      if (Date.now() - Date.parse(p.at) < 10_000) this.spawnPing(p.x, p.y);
    }

    for (const id of this.seenPings) {
      if (!live.has(id)) this.seenPings.delete(id);
    }
  }

  private spawnPing(x: number, y: number) {
    const g = new Graphics();

    this.pingLayer.addChild(g);

    this.pingAnims.push({ g, x, y, t0: performance.now() });

    if (!this.app.ticker.started) this.app.ticker.start();
  }

  /**
   * Queues one render for the next animation frame. Calls before that frame share it. Nothing is queued while the
   * ticker runs: the ticker renders every frame during pings.
   */
  requestRender() {
    if (this.destroyed || this.frameId || this.app.ticker.started) return;

    this.frameId = requestAnimationFrame(this.renderFrame);
  }

  private renderFrame = () => {
    if (this.destroyed) return;

    // Refit before the frame id is cleared, so a refit here does not queue a second frame.
    this.syncScreen();

    this.frameId = 0;

    this.app.render();
  };

  /** Refits when the canvas changed size. A canvas without a size cannot fit yet; the next resize renders again. */
  private syncScreen() {
    const size = `${this.app.screen.width}x${this.app.screen.height}`;

    if (size !== this.screenSize) {
      this.screenSize = size;
      this.fitted = false;
    }

    if (!this.fitted && this.state?.scene) this.fitted = this.fit();
  }

  private tick = () => {
    this.syncScreen();

    if (this.pingAnims.length === 0) {
      this.app.ticker.stop();

      return;
    }

    const now = performance.now();

    const cell = this.state?.scene?.cell ?? 100;

    this.pingAnims = this.pingAnims.filter((a) => {
      const t = (now - a.t0) / PING_LIFE_MS;

      if (t >= 1) {
        a.g.destroy();

        return false;
      }

      a.g.clear();

      for (let k = 0; k < 2; k++) {
        const p = t - k * 0.25;

        if (p < 0 || p > 1) continue;

        a.g.circle(a.x, a.y, cell * (0.2 + 1.3 * p)).stroke({ width: cell * 0.06 * (1 - p) + 1, color: 0xe5b04b, alpha: 1 - p });
      }

      return true;
    });

    // Pings are the only animation. When the last one fades, the ticker stops and drawing is on demand again.

    if (this.pingAnims.length === 0) this.app.ticker.stop();
  };

  /** Ruler, fog preview and polygon in progress. */

  private drawOverlay() {
    const g = this.overlay;

    g.clear();

    this.requestRender();

    const st = this.state;

    const scene = st?.scene;

    if (!st || !scene) {
      this.rulerLabel.visible = false;

      return;
    }

    const gest = this.gesture;

    if (gest?.kind === 'fog') {
      const r = rectOf(gest.a, gest.b);

      g.rect(r.x, r.y, r.w, r.h).fill({ color: gest.mode === 'hide' ? 0x000000 : 0x5ec5de, alpha: 0.35 });

      g.rect(r.x, r.y, r.w, r.h).stroke({ width: 2, color: 0xf3f0ea, alpha: 0.8 });
    }

    if (this.poly.length >= 2) {
      const pts = this.polyCursor ? [...this.poly, this.polyCursor.x, this.polyCursor.y] : this.poly;

      const color = st.tool === 'fog-reveal' ? 0x5ec5de : 0x000000;

      if (pts.length >= 6) g.poly(pts).fill({ color, alpha: 0.3 });

      g.moveTo(this.poly[0] ?? 0, this.poly[1] ?? 0);

      for (let i = 2; i + 1 < pts.length; i += 2) g.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0);

      g.stroke({ width: 2, color: 0xf3f0ea, alpha: 0.9 });

      for (let i = 0; i + 1 < this.poly.length; i += 2) {
        g.circle(this.poly[i] ?? 0, this.poly[i + 1] ?? 0, scene.cell * 0.06).fill({ color: 0xf3f0ea });
      }
    }

    this.drawRuler(st, scene);
  }

  private drawRuler(st: ViewState, scene: MapScene) {
    const r = this.ruler;

    if (!r) {
      this.rulerLabel.visible = false;

      return;
    }

    const a = this.anchor(r.a, scene, st);

    const b = this.anchor(r.b, scene, st);

    const c = scene.cell;

    this.overlay

      .moveTo(a.x, a.y)

      .lineTo(b.x, b.y)

      .stroke({ width: Math.max(2, c * 0.04), color: 0xe5b04b, alpha: 0.95 });

    this.overlay.circle(a.x, a.y, c * 0.1).fill({ color: 0xe5b04b });

    this.overlay.circle(b.x, b.y, c * 0.1).fill({ color: 0xe5b04b });

    const cells = Math.hypot(b.x - a.x, b.y - a.y) / c;

    const gap = Math.max(0, cells - a.r - b.r);

    const band = bandOf(gap, scene.ranges);

    this.rulerLabel.text = `${cells.toFixed(1)} cel. · borda ${gap.toFixed(1)} · ${bandName(band)}`;

    this.rulerLabel.style.fontSize = Math.max(12 / this.cam.s, Math.round(c * 0.2));

    this.rulerLabel.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 - c * 0.2);

    this.rulerLabel.visible = true;
  }

  /** Measure anchor: the centre of a token under the point (with its radius in cells), or the point itself. */

  private anchor(p: Pt, scene: MapScene, st: ViewState): Pt & { r: number } {
    const t = this.hitToken(p, scene, this.visibleTokens(st), null);

    if (!t) return { x: p.x, y: p.y, r: 0 };

    const o = originOf(scene, t.x, t.y);

    const half = (t.size * scene.cell) / 2;

    return { x: o.x + half, y: o.y + half, r: t.size / 2 };
  }

  /** Centres and scales the scene to the canvas. Returns false when the canvas has no size yet. */

  private fit(): boolean {
    const scene = this.state?.scene;

    if (!scene) return false;

    const { w, h } = worldSize(scene);

    const sw = this.app.screen.width;

    const sh = this.app.screen.height;

    if (!sw || !sh || !w || !h) return false;

    const usableHeight = Math.max(200, sh - 150);

    const s = sw < 700 && this.fitKey === 0 ? Math.max((sw - 32) / w, (sh - 240) / h) * .94 : Math.min((sw - (sw < 700 ? 32 : 120)) / w, usableHeight / h) * .98;

    this.cam = { s, x: (sw - w * s) / 2, y: (usableHeight - h * s) / 2 + 12 };

    this.applyCam();

    return true;
  }

  private applyCam() {
    this.world.position.set(this.cam.x, this.cam.y);

    this.world.scale.set(this.cam.s);

    this.requestRender();

    const percent = Math.round(this.cam.s * 100);

    this.reportSelection();

    if (percent !== this.reportedZoom) {
      this.reportedZoom = percent;
      this.state?.callbacks.onZoomChange?.(percent);
    }
  }

  clientToCell(clientX: number, clientY: number): Pt | null {
    const scene = this.state?.scene;

    if (!scene) return null;

    const r = this.canvas.getBoundingClientRect(),
      world = this.toWorld(clientX - r.left, clientY - r.top);

    const x = (world.x - scene.offsetX) / scene.cell,
      y = (world.y - scene.offsetY) / scene.cell;

    return { x: this.state?.snap ? Math.floor(x) : x, y: this.state?.snap ? Math.floor(y) : y };
  }

  private reportSelection() {
    const token = this.state?.tokens.find((t) => t.id === this.state?.selectedId),
      scene = this.state?.scene;

    if (!token || !scene) {
      this.state?.callbacks.onSelectionPosition?.(null);
      return;
    }

    const position = this.dragPos?.id === token.id ? this.dragPos : token;

    const p = originOf(scene, position.x, position.y);

    this.state?.callbacks.onSelectionPosition?.({
      x: this.cam.x + (p.x + (token.size * scene.cell) / 2) * this.cam.s,
      y: this.cam.y + (p.y + token.size * scene.cell) * this.cam.s,
    });
  }

  private drawAnnotations() {
    const st = this.state;

    if (!st) return;

    const gest = this.gesture;

    const drawings = (st.drawings ?? []).map((d) =>
      gest?.kind === 'drawing-move' && gest.drawing.id === d.id ? translateDrawing(d, gest.dx, gest.dy) : d,
    );

    if (gest?.kind === 'draw') drawings.push(gest.drawing);

    const key = JSON.stringify([drawings, st.selectedDrawingId]);

    if (key === this.drawingsKey) return;

    this.drawingsKey = key;

    this.requestRender();

    for (const child of this.drawingsLayer.removeChildren()) child.destroy({ children: true });

    for (const drawing of drawings) {
      const p = drawing.points,
        x = p[0] ?? 0,
        y = p[1] ?? 0,
        bx = p[2] ?? x,
        by = p[3] ?? y;

      if (drawing.kind === 'text') {
        const text = new Text({
          text: drawing.text ?? '',
          style: {
            fontFamily: 'system-ui, sans-serif',
            fontSize: drawing.fontSize ?? 28,
            fontWeight: '600',
            fill: drawing.color,
            stroke: { color: '#0d0b13', width: 3 },
          },
        });

        text.position.set(x, y);
        this.drawingsLayer.addChild(text);
      } else {
        const g = new Graphics(),
          style = { color: drawing.color, width: drawing.width, cap: 'round' as const, join: 'round' as const };

        if (drawing.kind === 'rect') g.rect(Math.min(x, bx), Math.min(y, by), Math.abs(bx - x), Math.abs(by - y)).stroke(style);
        else if (drawing.kind === 'ellipse')
          g.ellipse((x + bx) / 2, (y + by) / 2, Math.abs(bx - x) / 2, Math.abs(by - y) / 2).stroke(style);
        else {
          g.moveTo(x, y);
          for (let i = 2; i < p.length; i += 2) g.lineTo(p[i]!, p[i + 1]!);
          g.stroke(style);
        }

        this.drawingsLayer.addChild(g);
      }

      if (drawing.id === st.selectedDrawingId) {
        const selection = new Graphics().circle(x, y, 7).fill({ color: '#ffffff' }).stroke({ color: '#e5b04b', width: 3 });

        this.drawingsLayer.addChild(selection);
      }
    }
  }

  // ---- Pointer and keyboard ------------------------------------------------------------------

  private screenPos(e: { clientX: number; clientY: number }): Pt {
    const r = this.canvas.getBoundingClientRect();

    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private toWorld(sx: number, sy: number): Pt {
    return { x: (sx - this.cam.x) / this.cam.s, y: (sy - this.cam.y) / this.cam.s };
  }

  private hitToken(p: Pt, scene: MapScene, tokens: MapToken[], preferId: string | null): MapToken | null {
    let last: MapToken | null = null;

    let preferred: MapToken | null = null;

    for (const t of [...tokens].sort((a, b) => Number(!a.effect) - Number(!b.effect))) {
      const d = this.dragPos;

      const pos = d && d.id === t.id ? d : t;

      const o = originOf(scene, pos.x, pos.y);

      const size = t.size * scene.cell;

      if (p.x >= o.x && p.x <= o.x + size && p.y >= o.y && p.y <= o.y + size) {
        if (
          t.effect?.shape === 'circle' &&
          Math.abs(Math.hypot(p.x - o.x - size / 2, p.y - o.y - size / 2) - size / 2) > 12 / this.cam.s &&
          Math.hypot(p.x - o.x - size / 2, p.y - o.y - size / 2) > 12 / this.cam.s
        )
          continue;

        last = t;

        if (t.id === preferId && !t.effect) preferred = t;
      }
    }

    return preferred ?? last;
  }

  /** Snaps to grid corners (fog) or cell centres (ruler) when snapping is on. */

  private snapPoint(p: Pt, scene: MapScene, center: boolean): Pt {
    if (!this.state?.snap) return p;

    const c = scene.cell;

    if (center) {
      return {
        x: scene.offsetX + (Math.floor((p.x - scene.offsetX) / c) + 0.5) * c,

        y: scene.offsetY + (Math.floor((p.y - scene.offsetY) / c) + 0.5) * c,
      };
    }

    return {
      x: scene.offsetX + Math.round((p.x - scene.offsetX) / c) * c,

      y: scene.offsetY + Math.round((p.y - scene.offsetY) / c) * c,
    };
  }

  private cursor(): string {
    if (this.gesture?.kind === 'pan' || this.spaceDown || this.state?.tool === 'pan')
      return this.gesture?.kind === 'pan' ? 'grabbing' : 'grab';

    return this.state?.tool === 'select' ? 'default' : 'crosshair';
  }

  private onContextMenu = (e: Event) => e.preventDefault();

  private onDown = (e: PointerEvent) => {
    const st = this.state;

    if (!st?.scene || this.destroyed) return;

    const scene = st.scene;

    if (e.button === 0) this.canvas.focus({ preventScroll: true });

    const s = this.screenPos(e);

    const w = this.toWorld(s.x, s.y);

    if (e.button === 2) {
      this.cancelPoly();

      this.ruler = null;

      this.drawOverlay();

      return;
    }

    this.canvas.setPointerCapture(e.pointerId);

    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, s);

      if (this.touches.size >= 2) {
        if (this.gesture?.kind === 'pending') clearTimeout(this.gesture.timer);

        if (this.gesture?.kind === 'token' && this.dragPos)
          st.callbacks.onMoveToken(this.dragPos.id, this.dragPos.x, this.dragPos.y, true);

        this.gesture = null;

        this.dragPos = null;

        this.ruler = null;

        const [a, b] = [...this.touches.values()] as [Pt, Pt];

        this.pinch = pinchPose(a, b);

        this.drawOverlay();

        this.drawAnnotations();

        return;
      }
    }

    if (e.button === 1 || (e.button === 0 && (this.spaceDown || st.tool === 'pan'))) {
      this.gesture = { kind: 'pan', lx: s.x, ly: s.y };

      this.canvas.style.cursor = 'grabbing';

      return;
    }

    if (e.button !== 0) return;

    switch (st.tool) {
      case 'select': {
        const hit = this.hitToken(w, scene, this.visibleTokens(st), st.selectedId);

        if (hit) {
          st.callbacks.onDrawingSelect?.(null);

          st.callbacks.onSelect(hit.id);

          if (hit.locked) {
            this.gesture = null;
            return;
          }

          const o = originOf(scene, hit.x, hit.y);

          this.gesture = {
            kind: 'token',

            id: hit.id,

            grabX: w.x - o.x,

            grabY: w.y - o.y,

            sx: s.x,

            sy: s.y,

            moved: false,

            last: 0,

            pos: { x: hit.x, y: hit.y },
          };
        } else {
          st.callbacks.onSelect(null);

          const drawing = [...(st.drawings ?? [])].reverse().find((d) => hitDrawing(d, w.x, w.y, 9 / this.cam.s));

          st.callbacks.onDrawingSelect?.(drawing?.id ?? null);

          if (drawing && st.role === 'GM') {
            this.gesture = { kind: 'drawing-move', drawing, start: w, dx: 0, dy: 0 };
            return;
          }

          // Click-and-hold on empty map pings; dragging pans.

          const timer = window.setTimeout(() => {
            if (this.gesture?.kind !== 'pending') return;

            this.gesture = null;

            this.state?.callbacks.onPing(w.x, w.y);
          }, PING_HOLD_MS);

          this.gesture = { kind: 'pending', sx: s.x, sy: s.y, timer };
        }

        break;
      }

      case 'pen':
      case 'line':
      case 'rect':
      case 'ellipse':
        if (st.role !== 'GM') return;

        this.gesture = {
          kind: 'draw',
          drawing: {
            id: 'draft',
            sceneId: scene.id,
            kind: st.tool,
            points: [w.x, w.y, w.x, w.y],
            color: st.drawColor ?? '#facc15',
            width: st.drawWidth ?? 4,
          },
        };

        break;

      case 'text':
        if (st.role === 'GM') st.callbacks.onText?.(w);

        return;

      case 'eraser': {
        if (st.role !== 'GM') return;

        const drawing = [...(st.drawings ?? [])].reverse().find((d) => hitDrawing(d, w.x, w.y, 12 / this.cam.s));

        if (drawing) st.callbacks.onDrawingErase?.(drawing.id);

        return;
      }

      case 'ruler': {
        const a = this.snapPoint(w, scene, true);

        this.ruler = { a, b: a };

        this.gesture = { kind: 'ruler' };

        break;
      }

      case 'fog-hide':

      case 'fog-reveal': {
        const mode = st.tool === 'fog-hide' ? 'hide' : 'reveal';

        if (st.fogShape === 'poly') {
          const p = this.snapPoint(w, scene, false);

          const first = this.poly.length >= 6 ? { x: this.poly[0] ?? 0, y: this.poly[1] ?? 0 } : null;

          const lastX = this.poly[this.poly.length - 2];

          const lastY = this.poly[this.poly.length - 1];

          if (first && Math.hypot(p.x - first.x, p.y - first.y) * this.cam.s < 14) {
            this.commitPoly(mode);
          } else if (p.x !== lastX || p.y !== lastY) {
            this.poly.push(p.x, p.y);
          }

          this.drawOverlay();

          return;
        }

        const a = this.snapPoint(w, scene, false);

        this.gesture = { kind: 'fog', a, b: a, mode };

        break;
      }

      case 'align':
        this.gesture = {
          kind: 'align',

          wx: w.x,

          wy: w.y,

          ox0: scene.offsetX,

          oy0: scene.offsetY,

          ox: scene.offsetX,

          oy: scene.offsetY,

          sx: s.x,

          sy: s.y,

          moved: false,

          last: 0,
        };

        break;
    }

    this.drawOverlay();
  };

  private onMove = (e: PointerEvent) => {
    const st = this.state;

    if (!st?.scene || this.destroyed) return;

    const scene = st.scene;

    const s = this.screenPos(e);

    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, s);

    if (this.pinch && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()] as [Pt, Pt];

      const next = pinchPose(a, b);

      this.cam = pinchCamera(this.cam, this.pinch, next);

      this.pinch = next;

      this.applyCam();

      return;
    }

    const w = this.toWorld(s.x, s.y);

    const g = this.gesture;

    if (!g) {
      if (this.poly.length > 0) {
        this.polyCursor = this.snapPoint(w, scene, false);

        this.drawOverlay();
      }

      return;
    }

    switch (g.kind) {
      case 'pan':
        this.cam.x += s.x - g.lx;

        this.cam.y += s.y - g.ly;

        g.lx = s.x;

        g.ly = s.y;

        this.applyCam();

        break;

      case 'pending':
        if (Math.hypot(s.x - g.sx, s.y - g.sy) > 5) {
          clearTimeout(g.timer);

          this.gesture = { kind: 'pan', lx: s.x, ly: s.y };

          this.canvas.style.cursor = 'grabbing';
        }

        break;

      case 'token': {
        if (!g.moved && Math.hypot(s.x - g.sx, s.y - g.sy) < 3) break;

        g.moved = true;

        const cx = (w.x - g.grabX - scene.offsetX) / scene.cell;

        const cy = (w.y - g.grabY - scene.offsetY) / scene.cell;

        const x = st.snap ? Math.round(cx) : cx;

        const y = st.snap ? Math.round(cy) : cy;

        if (x === g.pos.x && y === g.pos.y) break;

        g.pos = { x, y };

        this.dragPos = { id: g.id, x, y };

        this.placeToken(scene, g.id, x, y);

        this.reportSelection();

        this.drawRings(st, scene);

        const now = performance.now();

        if (now - g.last >= WRITE_INTERVAL_MS) {
          g.last = now;

          st.callbacks.onMoveToken(g.id, x, y, false);
        }

        break;
      }

      case 'draw': {
        const points = g.drawing.points;

        if (g.drawing.kind === 'pen') {
          if (Math.hypot(w.x - points[points.length - 2]!, w.y - points[points.length - 1]!) * this.cam.s >= 2)
            points.push(w.x, w.y);
        } else g.drawing.points = [points[0]!, points[1]!, w.x, w.y];

        this.drawAnnotations();

        break;
      }

      case 'drawing-move':
        g.dx = w.x - g.start.x;
        g.dy = w.y - g.start.y;

        this.drawAnnotations();

        break;

      case 'fog':
        g.b = this.snapPoint(w, scene, false);

        this.drawOverlay();

        break;

      case 'ruler':
        if (this.ruler) this.ruler.b = this.snapPoint(w, scene, true);

        this.drawOverlay();

        break;

      case 'align': {
        if (!g.moved && Math.hypot(s.x - g.sx, s.y - g.sy) < 3) break;

        g.moved = true;

        // Relative to the offset at drag start: the scene offset changes as the writes come back.

        g.ox = Math.round(g.ox0 + (w.x - g.wx));

        g.oy = Math.round(g.oy0 + (w.y - g.wy));

        const now = performance.now();

        if (now - g.last >= WRITE_INTERVAL_MS) {
          g.last = now;

          st.callbacks.onAlignGrid(g.ox, g.oy, false);
        }

        break;
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);

    this.touches.delete(e.pointerId);

    if (this.pinch) {
      if (this.touches.size < 2) this.pinch = null;

      this.gesture = null;

      this.canvas.style.cursor = this.cursor();

      return;
    }

    const g = this.gesture;

    this.gesture = null;

    const st = this.state;

    this.canvas.style.cursor = this.cursor();

    if (!st?.scene || !g) return;

    switch (g.kind) {
      case 'pending':
        clearTimeout(g.timer);

        break;

      case 'token': {
        const d = this.dragPos;

        this.dragPos = null;

        if (d && g.moved) st.callbacks.onMoveToken(g.id, d.x, d.y, true);

        this.drawRings(st, st.scene);

        break;
      }

      case 'draw':
        if (
          e.type !== 'pointercancel' &&
          Math.hypot(
            g.drawing.points[0]! - g.drawing.points[g.drawing.points.length - 2]!,
            g.drawing.points[1]! - g.drawing.points[g.drawing.points.length - 1]!,
          ) > 2
        )
          st.callbacks.onDrawingAdd?.(g.drawing);

        this.drawingsKey = '';
        this.drawAnnotations();

        break;

      case 'drawing-move':
        if (e.type !== 'pointercancel' && (g.dx || g.dy)) st.callbacks.onDrawingMove?.(translateDrawing(g.drawing, g.dx, g.dy));

        this.drawingsKey = '';
        this.drawAnnotations();

        break;

      case 'fog': {
        if (e.type === 'pointercancel') {
          this.drawOverlay();
          break;
        }

        const r = rectOf(g.a, g.b);

        if (r.w > 2 && r.h > 2) {
          st.callbacks.onFogAdd(g.mode, [r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h]);
        }

        this.drawOverlay();

        break;
      }

      case 'align':
        if (g.moved) st.callbacks.onAlignGrid(g.ox, g.oy, true);

        break;
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();

    const s = this.screenPos(e);

    const before = this.toWorld(s.x, s.y);

    const lines = e.deltaMode === 1 ? 16 : 1;

    const factor = Math.exp(-e.deltaY * lines * 0.0015);

    this.cam.s = Math.min(6, Math.max(0.05, this.cam.s * factor));

    this.cam.x = s.x - before.x * this.cam.s;

    this.cam.y = s.y - before.y * this.cam.s;

    this.applyCam();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;

    const buttonFocused = e.target instanceof HTMLElement && e.target.closest('button, a, summary');

    if (e.target === this.canvas && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(e.key)) {
      e.preventDefault();

      if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
      else if (e.key === '-') this.zoomBy(1 / 1.25);
      else if (e.key === 'Home') this.fit();
      else {
        const step = (this.state?.scene?.cell ?? 100) * this.cam.s * (e.shiftKey ? 3 : 1);

        this.cam.x += e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;

        this.cam.y += e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;

        this.applyCam();
      }

      return;
    }

    if (e.code === 'Space' && !buttonFocused) {
      e.preventDefault();

      this.spaceDown = true;

      if (!this.gesture) this.canvas.style.cursor = 'grab';

      return;
    }

    if (e.key === 'Enter' && !buttonFocused && this.poly.length >= 6 && this.state) {
      this.commitPoly(this.state.tool === 'fog-reveal' ? 'reveal' : 'hide');
    }

    if (e.key === 'Escape') {
      if (this.gesture?.kind === 'pending') clearTimeout(this.gesture.timer);

      this.gesture = null;

      this.cancelPoly();

      this.ruler = null;

      this.drawOverlay();

      this.drawAnnotations();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      this.spaceDown = false;

      this.canvas.style.cursor = this.cursor();
    }
  };

  private cancelPoly() {
    this.poly = [];

    this.polyCursor = null;
  }

  private commitPoly(mode: 'hide' | 'reveal') {
    const st = this.state;

    if (st && this.poly.length >= 6) st.callbacks.onFogAdd(mode, [...this.poly]);

    this.cancelPoly();

    this.drawOverlay();
  }
}

function rectOf(a: Pt, b: Pt): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return !!target.closest('dialog[open]') || target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
