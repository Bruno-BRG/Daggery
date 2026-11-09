import type { RollPayload } from '@daggery/shared';

/** Reserve the animation slot before publishing: publishing an attack can trigger its damage. */
export async function executeRoll(payload: RollPayload, animate: (value: RollPayload)=>Promise<void>, onComputed?: (value: RollPayload)=>void): Promise<RollPayload> {
  const animation = animate(payload);
  onComputed?.(payload);
  await animation;
  return payload;
}
