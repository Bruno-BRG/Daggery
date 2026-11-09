import { useEffect, useRef } from 'react';
import type { RollLogEntry } from '@daggery/shared';
import { replay, takeEcho } from './tray';

/**
 * Animates rolls that arrive on the shared log, so every client shows the same dice.
 *
 * The first change to `rolls` is the server's hello, which carries the history. That history is
 * recorded as already seen and never animated. Later entries are animated once each, except this
 * client's own rolls, which were animated when computed and are recognised by their echo.
 */
export function useRollReplay(rolls: readonly RollLogEntry[]): void {
  const initialRef = useRef(rolls);
  const seenIdRef = useRef<number | null>(null);

  useEffect(() => {
    // Skip the mount run, where `rolls` is still the initial empty list.
    if (rolls === initialRef.current) return;

    if (seenIdRef.current === null) {
      seenIdRef.current = rolls.reduce((max, entry) => Math.max(max, entry.id), 0);
      return;
    }

    for (const entry of rolls) {
      if (entry.id <= seenIdRef.current) continue;
      seenIdRef.current = entry.id;
      if (takeEcho(entry)) continue;
      void replay(entry);
    }
  }, [rolls]);
}
