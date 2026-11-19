import type { RollLogEntry, RollPayload } from '@daggery/shared';
import { computeRoll, diceForPayload, type DieRequest, type RollSpec } from './rollPlan';
import { DEFAULT_TRAY_RECT, DiceStage } from './stage';
import { FlatStage } from './flatStage';
import { RollEchoes } from './echoes';
import { getDiceAppearance, type DiceAppearance } from './appearance';
import { executeRoll } from './rollExecution';

export interface RollOptions {
  /**
   * Display author. Echo recognition uses the roll ID, never a mutable display name.
   */
  author?: string;
  /** Called as soon as the result exists, before any dice move. Send the roll to the server here. */
  onComputed?: (payload: RollPayload) => void;
}

/**
 * How rolls are drawn right now. detached: no overlay is mounted. untested: 3D has not been tried
 * yet, because its canvas is created by the first roll. three: 3D works. flat: 3D could not start
 * in this browser, so rolls use flat dice. none: nothing can animate, and results still appear in
 * the history.
 */
export type DiceTrayStatus = 'detached' | 'untested' | 'three' | 'flat' | 'none';
type Capability = Exclude<DiceTrayStatus, 'detached'>;

/** Whatever draws a roll right now. The 3D stage and the flat fallback both match this shape. */
interface TraySurface {
  readonly kind: 'three' | 'flat';
  /** True when nothing is playing or waiting and no die is on screen. */
  readonly idle?: boolean;
  enqueue(requests: DieRequest[], appearance: DiceAppearance): Promise<void>;
  abort(reason: Error): void;
  dispose(): void;
}

/*
 * One tray per page. The app mounts a single <DiceOverlay />, which registers its container here.
 * Canvases exist only while dice are in play: the first roll creates one, and it is released when
 * its dice have faded, so an idle page holds no WebGL context. Rolls still resolve with no
 * container, they just do not animate.
 */
let container: HTMLElement | null = null;
let surface: TraySurface | null = null;
let capability: Capability = 'untested';
const listeners = new Set<() => void>();
const echoes = new RollEchoes();
let rollSequence = 0;
/**
 * A 3D stage stays alive this long after its dice fade, hidden and not drawing. Starting one costs real time on a
 * tablet (the GPU context, the reflections, the shaders), and rolls often come a few seconds apart. After this
 * long with no roll it is released, so a quiet page still holds no WebGL context.
 */
const KEEP_WARM_MS = 30_000;
let warmTimer = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeTray(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for useSyncExternalStore. Returns a string, so unchanged reads compare equal. */
export function trayStatus(): DiceTrayStatus {
  return container ? capability : 'detached';
}

export function isTrayAttached(): boolean {
  return container !== null;
}

function setCapability(next: Capability): void {
  if (capability === next) return;
  capability = next;
  emit();
}

/** Registers the overlay container. Returns the cleanup that unregisters it. */
export function attachTray(target: HTMLElement): () => void {
  container = target;
  emit();
  return () => {
    if (container !== target) return;
    container = null;
    window.clearTimeout(warmTimer);
    const live = surface;
    surface = null;
    live?.dispose();
    emit();
  };
}

/** Removes canvases that a failed constructor left in the container. */
function removeStrayCanvases(host: HTMLElement): void {
  host.querySelectorAll(':scope > canvas').forEach((canvas) => canvas.remove());
}

/**
 * Returns the surface for the next roll, creating one if none is live. 3D is tried whenever a
 * surface is created, unless it already failed on this page. A failure switches the page to flat
 * dice; a reload tries 3D again.
 */
function ensureSurface(): TraySurface | null {
  if (surface) {
    window.clearTimeout(warmTimer);
    return surface;
  }
  const host = container;
  if (!host || capability === 'none') return null;
  if (capability !== 'flat') {
    try {
      const stage: DiceStage = new DiceStage(host, DEFAULT_TRAY_RECT, {
        onIdle: () => keepWarm(stage),
        onLost: () => retire(stage, new Error('The WebGL context was lost.')),
      });
      surface = stage;
      setCapability('three');
      return stage;
    } catch (error) {
      console.warn('3D dice could not start in this browser. Rolls will show as flat dice.', error);
      removeStrayCanvases(host);
      setCapability('flat');
    }
  }
  try {
    const flat: FlatStage = new FlatStage(host, DEFAULT_TRAY_RECT, { onIdle: () => release(flat) });
    surface = flat;
    return flat;
  } catch (error) {
    console.warn('Dice animation is unavailable in this browser. Results still appear in the history.', error);
    removeStrayCanvases(host);
    setCapability('none');
    return null;
  }
}

/** Lets a faded stage rest for a while before it is released. A new roll cancels this. */
function keepWarm(target: TraySurface): void {
  window.clearTimeout(warmTimer);
  warmTimer = window.setTimeout(() => { if (target.idle !== false) release(target); }, KEEP_WARM_MS);
}

/** Drops an idle stage now, so the next roll builds one with the current quality setting. */
export function refreshDiceQuality(): void {
  if (surface && surface.idle) release(surface);
}

/** Releases a surface whose dice have faded. The next roll builds a fresh one. */
function release(target: TraySurface): void {
  window.clearTimeout(warmTimer);
  if (surface !== target) return;
  surface = null;
  target.dispose();
}

/** A 3D surface failed. Later rolls use flat dice, and any roll it was still playing is replayed flat. */
function retire(target: TraySurface, reason: Error): void {
  if (surface === target) surface = null;
  setCapability('flat');
  target.abort(reason);
}

/** Plays a roll on the live surface. A 3D failure moves that roll, and every later one, to flat dice. */
function play(requests: DieRequest[], appearance: DiceAppearance): Promise<void> {
  const target = ensureSurface();
  if (!target) return Promise.resolve();
  return target.enqueue(requests, appearance).catch((error: unknown) => {
    const reason = error instanceof Error ? error : new Error(String(error));
    if (target.kind === 'flat') {
      console.warn('Flat dice could not animate this roll. The result is still recorded.', reason);
      return;
    }
    console.warn('3D dice stopped during a roll. Showing that roll as flat dice.', reason);
    retire(target, reason);
    return play(requests, appearance);
  });
}

/**
 * Computes a roll with the shared rules, reports it, then animates it on the tray. Resolves
 * once the dice have landed with the payload to send to the server.
 */
export async function roll(spec: RollSpec, options: RollOptions = {}): Promise<RollPayload> {
  const payload = computeRoll(spec);
  // randomUUID requires HTTPS; local-network tablet sessions can also use plain HTTP.
  payload.clientRollId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++rollSequence}`;
  echoes.remember(payload, options.author);
  return executeRoll(payload, replay, options.onComputed);
}

/** Animates a roll that came from somewhere else, such as another player. */
export function replay(payload: RollPayload): Promise<void> {
  if (!container) return Promise.resolve();
  return play(diceForPayload(payload), getDiceAppearance());
}

/** Cosmetic preview: no game randomness, Fear changes, or shared log entries. */
export function previewDice(): Promise<void> {
  return play([
    { sides: 12, value: 12, colorway: 'hope' },
    { sides: 12, value: 7, colorway: 'fear' },
    { sides: 6, value: 5, colorway: 'advantage' },
    { sides: 20, value: 20, colorway: 'neutral' },
    { sides: 10, value: 7, colorway: 'percentile', reading: 'tens' },
    { sides: 10, value: 3, colorway: 'neutral', reading: 'units' },
    { sides: 8, value: 8, colorway: 'neutral' },
    { sides: 4, value: 4, colorway: 'neutral' },
  ], getDiceAppearance());
}

/**
 * True for every server echo of a locally animated roll, including duplicate broadcasts.
 */
export function takeEcho(entry: RollLogEntry): boolean {
  return echoes.matches(entry);
}

