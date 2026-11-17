import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { getActiveCampaign } from '../../campaign-context';
import { useDocs } from '../../sync/store';
import type { Sheet } from './types';

/** Fired in the same tab whenever the active hero changes, so every hook instance re-reads it. */
export const ACTIVE_HERO_EVENT = 'daggery:active-hero';

const STORAGE_PREFIX = 'daggery:active-hero:';

/** The fields the fallback logic needs, so it can be tested without a full sheet. */
export type HeroSummary = Pick<Sheet, 'id' | 'name' | 'createdAt'>;

export function activeHeroStorageKey(campaignId: string): string {
  return `${STORAGE_PREFIX}${campaignId}`;
}

/** Heroes in creation order, with the name breaking ties (old sheets may share a timestamp). */
export function sortHeroes<T extends HeroSummary>(heroes: readonly T[]): T[] {
  return [...heroes].sort((left, right) => {
    const byCreated = (left.createdAt ?? '').localeCompare(right.createdAt ?? '');
    return byCreated !== 0 ? byCreated : left.name.localeCompare(right.name);
  });
}

/**
 * The stored hero when it still exists, otherwise the first hero by creation order/name.
 * Undefined only when there are no heroes at all.
 */
export function chooseActiveHero<T extends HeroSummary>(
  heroes: readonly T[],
  storedId: string | null | undefined,
): T | undefined {
  if (heroes.length === 0) return undefined;
  const ordered = sortHeroes(heroes);
  return (storedId ? ordered.find((hero) => hero.id === storedId) : undefined) ?? ordered[0];
}

function currentCampaignId(): string | null {
  try {
    return getActiveCampaign().id;
  } catch {
    return null; // Before a campaign is selected there is nowhere to keep the preference.
  }
}

function readStored(key: string | null): string | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // Storage may be blocked; the first hero is still a fine fallback.
  }
}

function writeStored(key: string, id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, id);
  } catch {
    /* storage blocked */
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(ACTIVE_HERO_EVENT, onChange);
  // Another tab switching heroes updates this one too.
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(ACTIVE_HERO_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * The campaign's active hero. The choice lives in localStorage per campaign and falls back
 * to the first hero when unset or deleted, so deleting the active hero opens the next one.
 */
export function useActiveHero(): { hero: Sheet | undefined; heroes: Sheet[]; select(id: string): void } {
  const { items } = useDocs<Sheet>('sheets');
  // The app mounts once per campaign, so the key is fixed for the hook's lifetime.
  const key = useMemo(() => {
    const campaignId = currentCampaignId();
    return campaignId ? activeHeroStorageKey(campaignId) : null;
  }, []);
  const storedId = useSyncExternalStore(subscribe, () => readStored(key), () => null);
  const heroes = useMemo(() => sortHeroes(Object.values(items)), [items]);
  const hero = useMemo(() => chooseActiveHero(heroes, storedId), [heroes, storedId]);
  const select = useCallback(
    (id: string) => {
      if (!key) return;
      writeStored(key, id);
      window.dispatchEvent(new Event(ACTIVE_HERO_EVENT));
    },
    [key],
  );
  return useMemo(() => ({ hero, heroes, select }), [hero, heroes, select]);
}

/** For the app shell to label the characters tab with the hero's name. */
export function useActiveHeroName(): string | undefined {
  return useActiveHero().hero?.name;
}
