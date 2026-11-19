import type { DieRequest } from './rollPlan';
import { prepareThrow, type Bounds, type PreparedThrow } from './simulation';
import { unpackThrow, type PackedThrow } from './simulationPack';

type Reply = { id: number; ok: true; packed: PackedThrow } | { id: number; ok: false; message: string };
interface Waiting { resolve: (value: PreparedThrow) => void; reject: (reason: unknown) => void; fallback: () => PreparedThrow }

/** Settles a waiting throw by running it on the page. */
function runHere(entry: Waiting): void {
  try { entry.resolve(entry.fallback()); } catch (error) { entry.reject(error); }
}

let worker: Worker | null = null;
let failed = false;
let sequence = 0;
const waiting = new Map<number, Waiting>();

function startWorker(): Worker | null {
  if (failed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    const created = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<Reply>) => {
      const entry = waiting.get(event.data.id);
      if (!entry) return;
      waiting.delete(event.data.id);
      // A failed simulation in the worker is retried here, where an error reaches the caller as it always did.
      if (event.data.ok) entry.resolve(unpackThrow(event.data.packed)); else runHere(entry);
    };
    created.onerror = () => {
      // The worker could not start (a blocked script, an old browser). Run everything on the page from now on.
      failed = true;
      worker = null;
      created.terminate();
      for (const entry of waiting.values()) runHere(entry);
      waiting.clear();
    };
    worker = created;
    return created;
  } catch {
    failed = true;
    return null;
  }
}

/** Simulates a throw in a worker when the browser allows it, and on the page when it does not. */
export function prepareThrowOffThread(requests: readonly DieRequest[], bounds: Bounds): Promise<PreparedThrow> {
  const fallback = () => prepareThrow(requests, bounds);
  const active = startWorker();
  if (!active) {
    // Let the page paint before the simulation blocks it.
    return new Promise((resolve, reject) => setTimeout(() => { try { resolve(fallback()); } catch (error) { reject(error); } }, 0));
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    waiting.set(id, { resolve, reject, fallback });
    active.postMessage({ id, requests: [...requests], bounds });
  });
}
