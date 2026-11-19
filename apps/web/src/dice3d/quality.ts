import { useSyncExternalStore } from 'react';
import { readPreference, savePreference } from '../storage';

/**
 * How much the 3D dice may ask of the GPU. A tablet draws every frame on a full-screen layer, so it starts lighter than
 * a desktop: fewer pixels while the dice move, a smaller shadow map and plainer materials. The numerals stay sharp:
 * the textures keep their size, and once the dice rest the canvas is drawn at full resolution.
 */
export type DiceQualityChoice = 'auto' | 'full' | 'light';
export type DiceQualityId = 'full' | 'light';

export interface DiceQuality {
  id: DiceQualityId;
  /** Device pixels per CSS pixel while dice move. The stage lowers it, down to `minRatio`, if frames run slow. */
  moveRatio: number;
  minRatio: number;
  /** Device pixels per CSS pixel once the dice rest: the numerals are drawn sharp, as one frame. */
  restRatio: number;
  shadowMapSize: number;
  /** Pixels per face on the texture atlas. The numerals are cut from it, so it stays high on every profile. */
  atlasCellPx: number;
  anisotropy: number;
  /** Size of one side of the reflection cube. */
  envSize: number;
  /** Pearl's iridescence and sheen. They cost the most per pixel. */
  fancyMaterials: boolean;
}

export const QUALITY: Record<DiceQualityId, DiceQuality> = {
  full: { id: 'full', moveRatio: 1.5, minRatio: 1, restRatio: 2, shadowMapSize: 2048, atlasCellPx: 256, anisotropy: 8, envSize: 256, fancyMaterials: true },
  light: { id: 'light', moveRatio: 1.25, minRatio: 1, restRatio: 2, shadowMapSize: 1024, atlasCellPx: 256, anisotropy: 4, envSize: 128, fancyMaterials: false },
};

export interface DeviceSignals { coarsePointer: boolean; cores: number; memoryGb: number }

/** Auto picks the light profile for touch devices, and for any device with few cores or little memory. */
export function pickQuality(choice: DiceQualityChoice, signals: DeviceSignals): DiceQuality {
  if (choice !== 'auto') return QUALITY[choice];
  return signals.coarsePointer || signals.cores <= 4 || signals.memoryGb <= 4 ? QUALITY.light : QUALITY.full;
}

function readSignals(): DeviceSignals {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    cores: nav.hardwareConcurrency || 4,
    memoryGb: nav.deviceMemory ?? 8,
  };
}

const KEY = 'daggery:dice-quality:v1';
const listeners = new Set<() => void>();
let choice: DiceQualityChoice = parseChoice(readPreference(KEY));

export function parseChoice(raw: string | null): DiceQualityChoice {
  return raw === 'full' || raw === 'light' ? raw : 'auto';
}
export const getQualityChoice = (): DiceQualityChoice => choice;
export const getDiceQuality = (): DiceQuality => pickQuality(choice, readSignals());
export function setQualityChoice(next: DiceQualityChoice): void {
  choice = next;
  savePreference(KEY, next);
  listeners.forEach(listener => listener());
}
export function subscribeQuality(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useQualityChoice(): DiceQualityChoice {
  return useSyncExternalStore(subscribeQuality, getQualityChoice, getQualityChoice);
}
