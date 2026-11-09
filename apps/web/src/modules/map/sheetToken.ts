import { classArt, getClass, hpMax, stressMax } from '../sheets/rules';
import type { Sheet } from '../sheets/types';
import { readPool, type MapToken } from './model';

export interface SheetEntry {
  id: string; name: string; className?: string; image?: string;
  hp?: ReturnType<typeof readPool>; stress?: ReturnType<typeof readPool>;
}

/** Modern sheets store marked slots; older documents may contain explicit pools. */
export function sheetEntry(id: string, value: unknown): SheetEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'Unnamed character';
  const modern = typeof v.classId === 'string' && typeof v.hpMarked === 'number' && typeof v.stressMarked === 'number';
  if (!modern) return { id, name, hp: readPool(v.hitPoints ?? v.hp), stress: readPool(v.stress) };
  const sheet = { ...v, bonusHpSlots: Number(v.bonusHpSlots) || 0, bonusStressSlots: Number(v.bonusStressSlots) || 0 } as unknown as Sheet;
  const hp = hpMax(sheet), stress = stressMax(sheet);
  return { id, name, image: classArt(sheet.classId), className: getClass(sheet.classId)?.name, hp: { current: Math.max(0, hp - sheet.hpMarked), max: hp }, stress: { current: Math.max(0, stress - sheet.stressMarked), max: stress } };
}

export function patchLinkedPools(sheet: Sheet, patch: Partial<MapToken>): Sheet {
  const normalized = { ...sheet, bonusHpSlots: Number(sheet.bonusHpSlots) || 0, bonusStressSlots: Number(sheet.bonusStressSlots) || 0 };
  const next = { ...sheet };
  if (patch.hp && Number.isFinite(patch.hp.current)) next.hpMarked = hpMax(normalized) - Math.max(0, Math.min(hpMax(normalized), patch.hp.current));
  if (patch.stress && Number.isFinite(patch.stress.current)) next.stressMarked = stressMax(normalized) - Math.max(0, Math.min(stressMax(normalized), patch.stress.current));
  return { ...next, updatedAt: new Date().toISOString() };
}
