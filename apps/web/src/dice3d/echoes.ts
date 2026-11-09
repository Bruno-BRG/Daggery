import type { RollLogEntry, RollPayload } from '@daggery/shared';
import { payloadKey } from './rollPlan';

/** IDs survive author canonicalization and distinguish identical rolls from different players. */
export class RollEchoes {
  private readonly recent = new Map<string, number>();
  private readonly legacy = new Map<string, number>();
  constructor(private readonly now = Date.now) {}
  remember(payload: RollPayload, author?: string): void {
    this.prune();
    if (payload.clientRollId) this.recent.set(payload.clientRollId, this.now());
    else if (author !== undefined) this.legacy.set(payloadKey(author, payload), this.now());
  }
  matches(entry: RollLogEntry): boolean {
    this.prune();
    if (entry.clientRollId) return this.recent.has(entry.clientRollId);
    const key = payloadKey(entry.author, entry);
    if (!this.legacy.has(key)) return false;
    this.legacy.delete(key);
    return true;
  }
  private prune(): void {
    for (const map of [this.recent, this.legacy]) {
      for (const [key, at] of map) if (this.now() - at > 600_000) map.delete(key);
      while (map.size > 512) map.delete(map.keys().next().value!);
    }
  }
}
