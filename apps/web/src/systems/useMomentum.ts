import { useCallback, useMemo } from 'react';
import { parseMomentum, type MomentumTracker } from '@daggery/shared';
import { useDoc } from '../sync/store';

/**
 * The hero's Momentum, Supply, Debilities, Initiative and Experience: one synced document in the
 * `combat` namespace, next to the Fear pool. A missing or damaged document reads as a fresh tracker.
 */
export function useMomentum() {
  const [doc, setDoc] = useDoc<MomentumTracker>('combat', 'momentum');
  const tracker = useMemo(() => parseMomentum(doc), [doc]);
  /** Applies a pure change from `@daggery/shared` and saves the result. */
  const update = useCallback((change: (current: MomentumTracker) => MomentumTracker) => setDoc(change(tracker)), [tracker, setDoc]);
  return { tracker, update };
}

export const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
