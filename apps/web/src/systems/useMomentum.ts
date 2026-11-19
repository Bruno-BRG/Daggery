import { useCallback, useMemo } from 'react';
import { debilitiesOf, parseMomentum, trackFight, withDebilities, type MomentumTracker } from '@daggery/shared';
import { useDoc, useDocs } from '../sync/store';
import { useActiveHero } from '../modules/sheets/activeHero';
import type { Sheet } from '../modules/sheets/types';

/**
 * The hero's Momentum, Supply, Initiative and the Momentum of each fight: one synced document in the
 * `combat` namespace, next to the Fear pool. A missing or damaged document reads as a fresh tracker.
 *
 * Debilities are conditions on the character sheet. When a hero is active, the sheet is the only place
 * they are kept: they are read from it, and a change that marks one (such as Supply reaching 0) is
 * written back to it. Without a hero they stay in the tracker document.
 */
export function useMomentum() {
  const [doc, setDoc] = useDoc<MomentumTracker>('combat', 'momentum');
  const { hero } = useActiveHero();
  const { set: setSheet } = useDocs<Sheet>('sheets');
  const sheetDebilities = hero ? debilitiesOf(hero.conditions ?? []) : null;
  const tracker = useMemo(
    () => parseMomentum(sheetDebilities ? { ...(doc as object), debilities: sheetDebilities } : doc),
    [doc, sheetDebilities?.join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  );
  /** Applies a pure change from `@daggery/shared` and saves the result. */
  const update = useCallback((change: (current: MomentumTracker) => MomentumTracker) => {
    const next = trackFight(change(tracker));
    if (hero) {
      if (next.debilities.join(',') !== (sheetDebilities ?? []).join(',')) {
        setSheet(hero.id, { ...hero, conditions: withDebilities(hero.conditions ?? [], next.debilities), updatedAt: new Date().toISOString() });
      }
      setDoc({ ...next, debilities: [] });
    } else setDoc(next);
  }, [tracker, setDoc, hero, setSheet, sheetDebilities]);
  return { tracker, update };
}

export const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
