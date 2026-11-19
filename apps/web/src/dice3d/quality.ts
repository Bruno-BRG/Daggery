import { useSyncExternalStore } from 'react';
import { readPreference, savePreference } from '../storage';

/**
 * How much the 3D dice may ask of the GPU. A tablet draws every frame on a full-screen layer, so it gets a lighter
 * profile than a desktop: fewer pixels, a smaller shadow map, smaller textures and plainer materials. The look stays:
 * the dice keep their bevels, clear coat, reflections and engraved numerals.
 */
export type DiceQualityChoice = 'auto' | 'full' | 'light';
export type DiceQualityId = 'full' | 'light';

export interface DiceQuality {
  id: DiceQualityId;
  /** Most device pixels per CSS pixel the canvas draws. */
  pixelRatio: number;
  shadowMapSize: number;
  /** Pixels per face on the texture atlas. */
  atlasCellPx: number;
  anisotropy: number;
  /** Size of one side of the reflection cube. */
  envSize: number;
  /** Pearl's iridescence and sheen. They cost the most per pixel. */
  fancyMaterials: boolean;
}

export const QUALITY: Record<DiceQualityId, DiceQuality> = {
  full: { id: 'full', pixelRatio: 1.5, shadowMapSize: 2048, atlasCellPx: 256, anisotropy: 8, envSize: 256, fancyMaterials: true },
  light: { id: 'light', pixelRatio: 1.1, shadowMapSize: 1024, atlasCellPx: 160, anisotropy: 2, envSize: 128, fancyMaterials: false },
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
