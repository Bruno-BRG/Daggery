import type { Sheet } from './types';

export type ExtraSlotField = 'extraHpSlots' | 'extraStressSlots';

/** Extra slots never replace advancement bonuses or change marked damage/Stress. */
export function setExtraResourceSlots(sheet: Sheet, field: ExtraSlotField, raw: string): Sheet {
  const value = raw.trim() === '' ? 0 : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return sheet;
  return { ...sheet, [field]: value };
}
