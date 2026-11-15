/** Digital or physical dice, remembered per campaign in localStorage. */
export type DiceMode = 'digital' | 'physical';

/** Storage shape used here, so the helper is testable without a browser. */
export interface DiceModeStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

export const diceModeKey = (campaignId: string) => `daggery:dice-mode:${campaignId}`;

function defaultStore(): DiceModeStore | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** The saved mode for a campaign; digital when nothing (or no storage) is available. */
export function diceModeFor(campaignId: string, storage: DiceModeStore | null = defaultStore()): DiceMode {
  try { return storage?.getItem(diceModeKey(campaignId)) === 'physical' ? 'physical' : 'digital'; } catch { return 'digital'; }
}

/** Saves the player's choice. Storage failures are ignored, so play continues with the in-memory mode. */
export function setDiceMode(campaignId: string, mode: DiceMode, storage: DiceModeStore | null = defaultStore()): void {
  try { storage?.setItem(diceModeKey(campaignId), mode); } catch { /* storage unavailable */ }
}
