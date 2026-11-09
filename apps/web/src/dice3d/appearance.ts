import { useSyncExternalStore } from 'react';
import { readPreference, savePreference } from '../storage';
import { COLORWAYS, type Colorway, type ColorwayId } from './colorways';

export const DICE_PRESETS = [
  { id: 'classic', name: 'Classic', colors: ['#e3b04b','#64256e','#d9d4c7'] },
  { id: 'nebula', name: 'Nebula', colors: ['#41dddb','#a64fe8','#6d59d9'] },
  { id: 'ember', name: 'Ember', colors: ['#ffb24a','#a32140','#d75b25'] },
  { id: 'glacier', name: 'Glacier', colors: ['#a8f3f1','#266194','#65b6d5'] },
  { id: 'verdant', name: 'Verdant', colors: ['#bddd72','#205e60','#458867'] },
  { id: 'obsidian', name: 'Obsidian', colors: ['#dfb866','#634b83','#333347'] },
] as const;
export type DicePresetId = typeof DICE_PRESETS[number]['id'];
export interface DiceAppearance {
  preset: DicePresetId;
  finish: 'matte' | 'polished' | 'metal';
  effect: 'none' | 'glow' | 'sparks';
  colors: Partial<Record<'hope' | 'fear' | 'neutral', string>>;
}
export const DEFAULT_APPEARANCE: DiceAppearance = { preset: 'classic', finish: 'polished', effect: 'none', colors: {} };

export function parseAppearance(raw: string | null): DiceAppearance {
  try {
    const input = JSON.parse(raw ?? '{}');
    const colors: DiceAppearance['colors'] = {};
    for (const key of ['hope','fear','neutral'] as const) if (/^#[\da-f]{6}$/i.test(input?.colors?.[key])) colors[key] = input.colors[key];
    return {
      preset: DICE_PRESETS.some(p=>p.id===input?.preset) ? input.preset : 'classic',
      finish: ['matte','polished','metal'].includes(input?.finish) ? input.finish : 'polished',
      effect: ['none','glow','sparks'].includes(input?.effect) ? input.effect : 'none', colors,
    };
  } catch { return { ...DEFAULT_APPEARANCE, colors: {} }; }
}

export function paletteFor(role: ColorwayId, appearance: DiceAppearance): Colorway {
  const preset = DICE_PRESETS.find(p=>p.id===appearance.preset) ?? DICE_PRESETS[0];
  const roleIndex = role === 'hope' ? 0 : role === 'fear' ? 1 : 2;
  const override = role === 'hope' || role === 'fear' || role === 'neutral' ? appearance.colors[role] : undefined;
  const body = override ?? (appearance.preset === 'classic' ? COLORWAYS[role].body : role === 'advantage' ? '#2f8a69' : role === 'disadvantage' ? '#626577' : preset.colors[roleIndex]);
  const rgb = [1,3,5].map(index=>Number.parseInt(body.slice(index,index+2),16)/255).map(channel=>channel<=.04045 ? channel/12.92 : ((channel+.055)/1.055)**2.4);
  const luminance = .2126*rgb[0]! + .7152*rgb[1]! + .0722*rgb[2]!;
  return { body, numeral: luminance > .4 ? '#151624' : '#fffdf6', outline: luminance > .4 ? '#ffffff' : '#121320' };
}
const KEY = 'daggery:dice-appearance:v1';
let appearance = parseAppearance(readPreference(KEY));
const listeners = new Set<()=>void>();
export const getDiceAppearance = () => appearance;
export function setDiceAppearance(next: DiceAppearance): void {
  appearance = parseAppearance(JSON.stringify(next));
  savePreference(KEY, JSON.stringify(appearance));
  listeners.forEach(listener=>listener());
}
export function useDiceAppearance() {
  return useSyncExternalStore(callback=>{ listeners.add(callback); return ()=>{listeners.delete(callback);}; },getDiceAppearance,getDiceAppearance);
}
