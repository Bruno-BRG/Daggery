import { packThrow } from './simulationPack';
import { prepareThrow, type Bounds } from './simulation';
import type { DieRequest } from './rollPlan';

/**
 * Runs the throw simulation off the page's thread. It takes a moment on a tablet, and on the page's thread it
 * would freeze every tap and animation until it finished.
 */
interface Request { id: number; requests: DieRequest[]; bounds: Bounds }
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { id, requests, bounds } = event.data;
  try {
    const packed = packThrow(prepareThrow(requests, bounds));
    scope.postMessage({ id, ok: true, packed }, [packed.frames.buffer, packed.rotations.buffer]);
  } catch (error) {
    scope.postMessage({ id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
