import type { Pool, Token } from '@daggery/shared';

/** Namespace of the shared doc store. Ids are prefixed: scene:<id>, token:<id>, fog:<id>, ping:<id>, and 'active'. */
export const NS = 'map';

/**
 * Client-side role. Map documents are currently served only to the GM; player sharing
 * must use server-side visibility filtering before it can be enabled.
 */
export type { Role } from '../../useRole';
export type Tool = 'select' | 'pan' | 'ruler' | 'fog-hide' | 'fog-reveal' | 'align' | 'pen' | 'line' | 'rect' | 'ellipse' | 'text' | 'eraser';

export const BOARD_STYLES = {
  midnight: { label: 'Midnight', surface: '#242732', grid: '#bcc6dc', edge: '#474d60' },
  parchment: { label: 'Parchment', surface: '#d5c7ab', grid: '#5f5545', edge: '#958365' },
  forest: { label: 'Forest', surface: '#34453b', grid: '#b2c6ac', edge: '#596e57' },
  stone: { label: 'Stone', surface: '#494b4e', grid: '#c1bdb3', edge: '#777775' },
} as const;
export type BoardStyle = keyof typeof BOARD_STYLES;

export interface MapScene {
  id: string;
  name: string;
  order: number;
  /** Uploaded map image (/assets/...). Without it the scene is a blank grid of cols x rows cells. */
  mapUrl?: string;
  mapWidth?: number;
  mapHeight?: number;
  cols: number;
  rows: number;
  /** Cell size in world pixels. */
  cell: number;
  /** Grid origin in world pixels. Token positions are relative to it. */
  offsetX: number;
  offsetY: number;
  showGrid: boolean;
  boardStyle?: BoardStyle;
  /** Edge-to-edge distance limits in cells for [Melee, Very Close, Close, Far, Very Far]. */
  ranges: number[];
}

export interface MapToken extends Token {
  sceneId: string;
  color: string;
  image?: string;
  hp?: Pool;
  stress?: Pool;
  conditions: string[];
  /** Degrees; the rotate button steps by 90. */
  rotation: number;
  locked?: boolean;
  assetType?: 'miniature' | 'animal' | 'prop' | 'effect';
  effect?: { shape: 'circle' | 'cone' | 'square'; opacity: number };
  statusColors?: Record<string, string>;
  combatRefId?: string;
}

export interface MapDrawing {
  id: string;
  sceneId: string;
  kind: 'pen' | 'line' | 'rect' | 'ellipse' | 'text';
  /** World pixels, independent of camera zoom and pan. */
  points: number[];
  color: string;
  width: number;
  text?: string;
  fontSize?: number;
}

export interface FogShape {
  id: string;
  sceneId: string;
  mode: 'hide' | 'reveal';
  /** Flat polygon [x0, y0, x1, y1, ...] in world pixels. */
  points: number[];
  order: number;
}

export interface MapPing {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  author: string;
  at: string;
}

export interface ActiveDoc {
  sceneId: string;
}

export type MapDoc = MapScene | MapToken | FogShape | MapPing | MapDrawing | ActiveDoc;

/** Range bands, in the order of Scene.ranges. */
export const BANDS = [
  { name: 'Melee', color: '#ef4444' },
  { name: 'Very Close', color: '#f97316' },
  { name: 'Close', color: '#eab308' },
  { name: 'Far', color: '#22c55e' },
  { name: 'Very Far', color: '#38bdf8' },
] as const;

/** Optional "Defined Ranges" rule (core rulebook, p. 103) on a 1-inch grid: 1 / 3 / 6 / 12 / 13+ squares. */
export const DEFAULT_RANGES = [1, 3, 6, 12, 13];

export const CONDITION_PRESETS = ['Hidden', 'Restrained', 'Vulnerable'] as const;

export const TOKEN_COLORS = ['#b91c1c', '#1d4ed8', '#15803d', '#a16207', '#7c3aed', '#0e7490', '#be185d', '#475569'];

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function newScene(name: string, order: number): MapScene {
  return {
    id: newId(),
    name,
    order,
    cols: 30,
    rows: 20,
    cell: 100,
    offsetX: 0,
    offsetY: 0,
    showGrid: true,
    boardStyle: 'midnight',
    ranges: [...DEFAULT_RANGES],
  };
}

/** Fills fields missing from docs written by older versions of the module. */
export function normalizeScene(s: MapScene): MapScene {
  const fallback: Partial<MapScene> = { cols: 30, rows: 20, cell: 100, offsetX: 0, offsetY: 0, showGrid: true, order: 0 };
  return {
    ...fallback,
    ...s,
    boardStyle: s.boardStyle && Object.hasOwn(BOARD_STYLES, s.boardStyle) ? s.boardStyle : 'midnight',
    ranges: s.ranges?.length === DEFAULT_RANGES.length ? s.ranges : [...DEFAULT_RANGES],
  } as MapScene;
}

export function normalizeToken(t: MapToken): MapToken {
  return {
    ...t,
    size: t.size || 1,
    color: t.color || TOKEN_COLORS[0] || '#b91c1c',
    conditions: t.conditions ?? [],
    rotation: t.rotation ?? 0,
    locked: t.locked ?? false,
  };
}

/** Find a nearby empty footprint when several miniatures are added together. */
export function freeTokenPosition(center: { x: number; y: number }, tokens: MapToken[], size = 1) {
  const base = { x: Math.floor(center.x), y: Math.floor(center.y) };
  const free = (x: number, y: number) => !tokens.some(token => x < token.x + token.size && x + size > token.x && y < token.y + token.size && y + size > token.y);
  if (free(base.x, base.y)) return base;
  for (let radius = 1; radius <= 20; radius++) {
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (Math.abs(x) !== radius && Math.abs(y) !== radius) continue;
        if (free(base.x + x, base.y + y)) return { x: base.x + x, y: base.y + y };
      }
    }
  }
  return base;
}

/** Pixel size of the scene: the map image when present, otherwise the blank grid. */
export function worldSize(scene: MapScene): { w: number; h: number } {
  if (scene.mapUrl && scene.mapWidth && scene.mapHeight) return { w: scene.mapWidth, h: scene.mapHeight };
  return { w: scene.cols * scene.cell, h: scene.rows * scene.cell };
}

/** World pixel position of a token's top-left cell corner. */
export function originOf(scene: MapScene, cellX: number, cellY: number): { x: number; y: number } {
  return { x: scene.offsetX + cellX * scene.cell, y: scene.offsetY + cellY * scene.cell };
}

/** Band index for an edge-to-edge gap in cells; ranges.length means out of range. */
export function bandOf(gap: number, ranges: readonly number[]): number {
  for (let i = 0; i < ranges.length; i++) {
    if (gap <= (ranges[i] ?? 0) + 1e-9) return i;
  }
  return ranges.length;
}

export function bandName(index: number): string {
  return BANDS[index]?.name ?? 'Out of range';
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : words[0]![0]! + words[1]![0]!;
  return letters.toUpperCase();
}

/** Reads a Pool from a loosely typed value: a number, or { current, max }. */
export function readPool(value: unknown): Pool | undefined {
  if (typeof value === 'number') return { current: value, max: value };
  if (value && typeof value === 'object') {
    const v = value as { current?: unknown; max?: unknown };
    if (typeof v.max === 'number') {
      return { current: typeof v.current === 'number' ? v.current : v.max, max: v.max };
    }
  }
  return undefined;
}
