import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

/**
 * Local, cost-free semantic retrieval.
 *
 * The embedder is a narrow interface so tests can inject a deterministic fake and the server can
 * fall back to BM25-only when the model cannot be loaded (offline, unsupported platform). Vectors
 * live in SQLite per campaign for canon and journal; sourcebook page vectors live in a cache file
 * next to the extracted books. Indexing is an asynchronous, debounced queue: a GM turn never waits
 * for it, and `flush()` lets tests (and shutdown) await it.
 */

export const RAG_ENABLED = (): boolean => process.env.DAGGERY_RAG !== 'off';

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export type EmbeddingKind = 'canon' | 'journal';

export interface EmbeddingRow { campaign_id: string; kind: EmbeddingKind; ref_id: string; text_hash: string; model: string; dim: number; vector: Buffer; updated: string }

/** SHA-256 of the exact text that was embedded, so unchanged text is never re-embedded. */
export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Scale a vector to unit length so cosine similarity is a plain dot product. Zero vectors stay zero. */
export function normalizeVector(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  if (sum === 0) return vector;
  const scale = 1 / Math.sqrt(sum);
  const out = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index++) out[index] = vector[index]! * scale;
  return out;
}

/** Cosine similarity. Stored vectors are already unit length, but the guard keeps injected ones honest. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0, left = 0, right = 0;
  for (let index = 0; index < length; index++) {
    const x = a[index]!, y = b[index]!;
    dot += x * y; left += x * x; right += y * y;
  }
  if (left === 0 || right === 0) return 0;
  return dot / Math.sqrt(left * right);
}

function encodeVector(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function decodeVector(buffer: Buffer, dim: number): Float32Array {
  const copy = Buffer.from(buffer);
  return new Float32Array(copy.buffer, copy.byteOffset, Math.min(dim, Math.floor(copy.byteLength / 4))).slice();
}

/** The query text for proactive recall: latest player messages plus the location, objective and scene. */
export interface EmbeddingIndexOptions {
  /** Debounce before a batch is embedded. Tests lower it; production keeps it small and off the turn path. */
  debounceMs?: number;
  /** How long a retrieval may wait for a cold model before falling back to BM25. */
  queryTimeoutMs?: number;
  /** Logs once when the model cannot be used, then stays quiet. */
  log?: (message: string) => void;
}

interface Pending { campaign: string; kind: EmbeddingKind; refId: string; text: string; hash: string }

function keyOf(item: { campaign: string; kind: EmbeddingKind; refId: string }): string {
  return item.campaign + '|' + item.kind + '|' + item.refId;
}

export class EmbeddingIndex {
  private pending = new Map<string, Pending>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private drainPromise: Promise<void> | null = null;
  private embedderPromise: Promise<Embedder | null> | null = null;
  private resolvedModel: string | null = null;
  private logged = false;
  /** Number of embed batches requested. Exposed for tests; not used in production logic. */
  embedCalls = 0;
  private readonly debounceMs: number;
  private readonly queryTimeoutMs: number;
  private readonly log: (message: string) => void;

  constructor(private db: Database.Database, private readonly provider?: () => Promise<Embedder | null>, options: EmbeddingIndexOptions = {}) {
    this.debounceMs = options.debounceMs ?? 40;
    this.queryTimeoutMs = options.queryTimeoutMs ?? 600;
    this.log = options.log ?? ((message: string) => console.warn(message));
  }

  get enabled(): boolean {
    return !!this.provider && RAG_ENABLED();
  }

  /** The model id once it has loaded, so callers can reject vectors from another model. */
  get model(): string | null {
    return this.resolvedModel;
  }

  /** Loads the model lazily. Failure is logged once and every later operation falls back to BM25. */
  private embedder(): Promise<Embedder | null> {
    if (!this.provider || !RAG_ENABLED()) return Promise.resolve(null);
    if (!this.embedderPromise) {
      this.embedderPromise = this.provider().then(embedder => {
        this.resolvedModel = embedder?.model ?? null;
        return embedder;
      }).catch(error => {
        if (!this.logged) {
          this.logged = true;
          this.log('Semantic search is unavailable (' + (error instanceof Error ? error.message : 'model load failed') + '); using BM25 only.');
        }
        return null;
      });
    }
    return this.embedderPromise;
  }

  /** Enqueues a canon or journal body for background embedding. Archives/removals delete instead. */
  enqueue(kind: EmbeddingKind, campaign: string, refId: string, text: string): void {
    if (!this.enabled) return;
    const item: Pending = { campaign, kind, refId, text, hash: textHash(text) };
    this.pending.set(keyOf(item), item);
    this.schedule();
  }

  enqueueCanon(campaign: string, refId: string, title: string, body: string): void {
    this.enqueue('canon', campaign, refId, title + '\n' + body);
  }

  enqueueJournal(campaign: string, refId: string, title: string, body: string): void {
    this.enqueue('journal', campaign, refId, title + '\n' + body);
  }

  /** Deletes a vector and cancels a queued job for an archived canon entry or a removed journal entry. */
  remove(kind: EmbeddingKind, campaign: string, refId: string): void {
    this.pending.delete(keyOf({ campaign, kind, refId }));
    this.db.prepare('DELETE FROM ai_embeddings WHERE campaign_id = ? AND kind = ? AND ref_id = ?').run(campaign, kind, refId);
  }

  /** Synchronously reads the vectors already stored for one campaign. Used by hybrid ranking. */
  vectorsFor(campaign: string, kind: EmbeddingKind): Map<string, Float32Array> {
    const rows = this.db.prepare('SELECT ref_id, dim, vector FROM ai_embeddings WHERE campaign_id = ? AND kind = ?').all(campaign, kind) as { ref_id: string; dim: number; vector: Buffer }[];
    return new Map(rows.map(row => [row.ref_id, decodeVector(row.vector, row.dim)]));
  }

  /** One stored vector, or undefined when the entry has not been embedded yet. */
  vectorFor(campaign: string, kind: EmbeddingKind, refId: string): Float32Array | undefined {
    const row = this.db.prepare('SELECT dim, vector FROM ai_embeddings WHERE campaign_id = ? AND kind = ? AND ref_id = ?').get(campaign, kind, refId) as { dim: number; vector: Buffer } | undefined;
    return row ? decodeVector(row.vector, row.dim) : undefined;
  }

  /** Embeds a query for hybrid ranking. Returns null quickly when the model is not ready. */
  async embedQuery(text: string, timeoutMs = this.queryTimeoutMs): Promise<Float32Array | null> {
    if (!this.enabled || !text.trim()) return null;
    try {
      const embedder = await this.withTimeout(this.embedder(), timeoutMs);
      if (!embedder) return null;
      const vectors = await this.withTimeout(embedder.embed([text]), timeoutMs);
      return vectors?.[0] ?? null;
    } catch {
      return null;
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), ms);
      timer.unref?.();
      promise.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
    });
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.drain(); }, this.debounceMs);
    this.timer.unref?.();
  }

  private drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.runDrain().finally(() => { this.drainPromise = null; });
    return this.drainPromise;
  }

  private async runDrain(): Promise<void> {
    const embedder = await this.embedder();
    if (!embedder) { this.pending.clear(); return; }
    while (this.pending.size) {
      const batch = [...this.pending.values()];
      this.pending.clear();
      // Coalesce by text_hash: an entry whose stored hash, model and dimension already match is skipped.
      const changed = batch.filter(item => {
        const row = this.db.prepare('SELECT text_hash, model, dim FROM ai_embeddings WHERE campaign_id = ? AND kind = ? AND ref_id = ?').get(item.campaign, item.kind, item.refId) as { text_hash: string; model: string; dim: number } | undefined;
        return !row || row.text_hash !== item.hash || row.model !== embedder.model || row.dim !== embedder.dim;
      });
      if (!changed.length) continue;
      let vectors: Float32Array[];
      try {
        this.embedCalls++;
        vectors = await embedder.embed(changed.map(item => item.text));
      } catch (error) {
        if (!this.logged) {
          this.logged = true;
          this.log('Unable to embed content (' + (error instanceof Error ? error.message : 'embedding failed') + '); using BM25 only.');
        }
        return;
      }
      const at = new Date().toISOString();
      const write = this.db.transaction(() => {
        changed.forEach((item, index) => {
          const vector = vectors[index];
          if (!vector || !vector.length) return;
          this.db.prepare('INSERT INTO ai_embeddings(campaign_id,kind,ref_id,text_hash,model,dim,vector,updated) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id,kind,ref_id) DO UPDATE SET text_hash=excluded.text_hash, model=excluded.model, dim=excluded.dim, vector=excluded.vector, updated=excluded.updated')
            .run(item.campaign, item.kind, item.refId, item.hash, embedder.model, vector.length, encodeVector(vector), at);
        });
      });
      write();
    }
  }

  /**
   * Waits for every queued embedding. Tests call this to make a write semantically searchable at
   * once. A drain that was already running is awaited, and jobs queued meanwhile are drained too.
   */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    for (let round = 0; round < 100; round++) {
      if (this.drainPromise) await this.drainPromise;
      if (!this.pending.size) return;
      await this.drain();
    }
  }

  /**
   * Enqueues a background backfill of every existing canon and journal row. Rows whose stored hash,
   * model and dimension already match are skipped during the drain, so this is cheap on restart.
   */
  backfill(): void {
    if (!this.enabled) return;
    const canon = this.db.prepare("SELECT id, campaign_id, title, body FROM ai_canon WHERE status = 'active'").all() as { id: string; campaign_id: string; title: string; body: string }[];
    for (const row of canon) this.enqueueCanon(row.campaign_id, row.id, row.title, row.body);
    const journal = this.db.prepare('SELECT id, campaign_id, title, body FROM ai_journal').all() as { id: string; campaign_id: string; title: string; body: string }[];
    for (const row of journal) this.enqueueJournal(row.campaign_id, row.id, row.title, row.body);
  }

  /** Startup: backfill in the background. Never blocks server start. */
  start(): void {
    if (!this.enabled) return;
    const timer = setTimeout(() => {
      try {
        this.backfill();
        void this.drain().catch(() => {});
        void this.ensureSourcebooks();
        void this.ensureCatalog();
      } catch {
        // A startup backfill must never take the server (or a test) down.
      }
    }, 0);
    timer.unref?.();
  }

  /** Builds the structured Hope & Fear / Sablewood catalog vectors (in memory) in the background. */
  async ensureCatalog(): Promise<void> {
    const embedder = await this.embedder();
    if (!embedder) return;
    try {
      const { ensureCatalogEmbeddings } = await import('./catalog-index');
      await ensureCatalogEmbeddings(embedder);
    } catch (error) {
      if (!this.logged) {
        this.logged = true;
        this.log('Unable to index the catalog (' + (error instanceof Error ? error.message : 'unknown error') + '); keyword search still works.');
      }
    }
  }

  /** Builds the sourcebook vector cache in the background (lazily, only for changed books). */
  async ensureSourcebooks(): Promise<void> {
    const embedder = await this.embedder();
    if (!embedder) return;
    try {
      const { ensureSourcebookEmbeddings } = await import('./sourcebook');
      await ensureSourcebookEmbeddings(embedder);
    } catch (error) {
      if (!this.logged) {
        this.logged = true;
        this.log('Unable to index the sourcebooks (' + (error instanceof Error ? error.message : 'unknown error') + '); BM25 search still works.');
      }
    }
  }

  close(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending.clear();
  }
}
