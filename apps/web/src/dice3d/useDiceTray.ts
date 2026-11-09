import { useMemo, useSyncExternalStore } from 'react';
import type { RollPayload } from '@daggery/shared';
import { replay, roll, subscribeTray, trayStatus, type DiceTrayStatus, type RollOptions } from './tray';
import type { RollSpec } from './rollPlan';

export interface DiceTrayApi {
  /**
   * Computes a roll, then animates it on the tray. Resolves with the result once the dice have
   * landed. The options.onComputed callback fires before the dice move, which is the place to send it.
   */
  roll: (spec: RollSpec, options?: RollOptions) => Promise<RollPayload>;
  /** Animates a result computed elsewhere, such as a roll from the shared log. */
  replay: (payload: RollPayload) => Promise<void>;
  /** True while the persistent <DiceOverlay /> is mounted, so rolls have a place to animate. */
  ready: boolean;
  /**
   * How rolls are drawn: 3D once it has started, flat dice if 3D could not start, or not yet
   * tried. The 3D canvas is created by the first roll, so this stays untested until then.
   */
  status: DiceTrayStatus;
}

export function useDiceTray(): DiceTrayApi {
  const status = useSyncExternalStore(subscribeTray, trayStatus, () => 'detached' as const);
  return useMemo(() => ({ roll, replay, ready: status !== 'detached', status }), [status]);
}

export type { RollOptions, RollSpec };

