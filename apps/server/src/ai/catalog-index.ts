import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  adversaries, ancestries, armor, classes, communities, conditions, consumables,
  domainCards, domains, environments, items, ranges, transformations, weapons,
} from '@daggery/content';
import type { Embedder } from './embeddings';
import { cosine } from './embeddings';
import { DEFAULT_MIN_SIMILARITY } from './retrieval';
import { dataDirectory } from './sourcebook';

/**
 * Semantic index over every structured catalog entry bundled in `@daggery/content` — the
 * core book plus the Hope & Fear and Sablewood supplements. It is derived at startup and
 * cached on disk under `<data dir>/catalog-index.vec`, keyed by a content hash plus the
 * model id and dimension, so a normal start loads vectors instead of embedding them again.
 * `search_rules` and proactive recall use it to find entries by meaning (for example
 * "water monster" finding the Ahuizotl) even when the words do not match.
 *
 * Nothing is committed: the cache lives under the gitignored data directory and is rebuilt
 * whenever the content package or the embedding model changes.
 */

export interface CatalogEntry {
  category: string;
  id: string;
  name: string;
  source: string;
  text: string;
  entry: object;
}

type CatalogItem = { id: string; name?: string; source?: string };

const CATALOG: [string, readonly CatalogItem[]][] = [
  ['adversaries', adversaries],
  ['ancestries', ancestries],
  ['communities', communities],
  ['environments', environments],
  ['items', items],
  ['consumables', consumables],
  ['weapons', weapons],
  ['armor', armor],
  ['cards', domainCards],
  ['classes', classes],
  ['transformations', transformations],
  ['domains', domains],
  ['conditions', conditions],
  ['ranges', ranges],
];

const MAX_TEXT = 2000;
const CACHE_VERSION = 1;
const CACHE_FILE = 'catalog-index.vec';

/** Every string in an entry, so features, motives, questions, subclass and card text all become searchable. */
function strings(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(item => strings(item, depth + 1));
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'id' && key !== 'source')
    .flatMap(([, item]) => strings(item, depth + 1));
  return [];
}

function entryText(category: string, entry: CatalogItem): string {
  const name = entry.name ?? entry.id;
  return (category + ' ' + name + '\n' + strings(entry).join(' ')).slice(0, MAX_TEXT);
}

/** Every structured entry from every bundled source and category. */
export function catalogEntries(): CatalogEntry[] {
  const found: CatalogEntry[] = [];
  for (const [category, list] of CATALOG) {
    for (const entry of list) {
      const source = (entry as { source?: string }).source ?? 'core';
      found.push({ category, id: entry.id, name: entry.name ?? entry.id, source, text: entryText(category, entry), entry });
    }
  }
  return found;
}

interface CatalogState { signature: string; model: string; dim: number; entries: CatalogEntry[]; vectors: Map<string, Float32Array> }
let state: CatalogState | null = null;
let building: Promise<number> | null = null;

/** Content hash: ids and text, independent of order and of the runtime. */
function signatureOf(entries: CatalogEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of entries.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
    hash.update(entry.category).update('/').update(entry.id).update('\u0000').update(entry.text).update('\u0001');
  }
  return hash.digest('hex');
}

function keyOf(entry: CatalogEntry): string {
  return entry.category + ':' + entry.id;
}

function cachePath(): string {
  return join(dataDirectory(), CACHE_FILE);
}

/** Tests run against fixtures and must never read or write the developer's cache. */
function cacheEnabled(): boolean {
  return !process.env.NODE_TEST_CONTEXT && process.env.DAGGERY_CATALOG_CACHE !== 'off';
}

function readCache(signature: string, model: string, dim: number, entries: CatalogEntry[]): Map<string, Float32Array> | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      version?: unknown; hash?: unknown; model?: unknown; dim?: unknown; vectors?: unknown;
    };
    if (parsed.version !== CACHE_VERSION || parsed.hash !== signature || parsed.model !== model || parsed.dim !== dim) return null;
    if (!Array.isArray(parsed.vectors) || parsed.vectors.length !== entries.length) return null;
    const keyed = new Map(entries.map(entry => [keyOf(entry), entry] as const));
    const vectors = new Map<string, Float32Array>();
    for (const row of parsed.vectors) {
      if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !Array.isArray(row[1])) return null;
      if (!keyed.has(row[0]) || row[1].length !== dim) return null;
      vectors.set(row[0], Float32Array.from(row[1].filter(value => typeof value === 'number') as number[]));
    }
    return vectors.size === entries.length ? vectors : null;
  } catch {
    return null;
  }
}

function writeCache(signature: string, model: string, dim: number, vectors: Map<string, Float32Array>): void {
  try {
    mkdirSync(dataDirectory(), { recursive: true });
    const payload = {
      version: CACHE_VERSION,
      hash: signature,
      model,
      dim,
      vectors: [...vectors.entries()].map(([key, vector]) => [key, Array.from(vector)]),
    };
    writeFileSync(cachePath(), JSON.stringify(payload));
  } catch {
    // A read-only data directory only costs a rebuild on the next start.
  }
}

/** The vectors built at startup, or null when the background build has not finished. */
export function catalogVectors(): Map<string, Float32Array> | null {
  return state?.vectors ?? null;
}

/** Builds (or rebuilds) the catalog index, reusing the on-disk cache when it still matches. */
export async function ensureCatalogEmbeddings(embedder: Embedder): Promise<number> {
  const entries = catalogEntries();
  const signature = signatureOf(entries);
  if (state && state.signature === signature && state.model === embedder.model && state.dim === embedder.dim) return state.vectors.size;
  if (building) return building;
  building = (async () => {
    const sorted = entries.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    if (cacheEnabled()) {
      const cached = readCache(signature, embedder.model, embedder.dim, sorted);
      if (cached) {
        state = { signature, model: embedder.model, dim: embedder.dim, entries: sorted, vectors: cached };
        return cached.size;
      }
    }
    const vectors = new Map<string, Float32Array>();
    for (let start = 0; start < sorted.length; start += 32) {
      const chunk = sorted.slice(start, start + 32);
      const embedded = await embedder.embed(chunk.map(entry => entry.text));
      chunk.forEach((entry, index) => {
        const vector = embedded[index];
        if (vector?.length) vectors.set(keyOf(entry), vector);
      });
    }
    state = { signature, model: embedder.model, dim: embedder.dim, entries: sorted, vectors };
    if (cacheEnabled()) writeCache(signature, embedder.model, embedder.dim, vectors);
    return vectors.size;
  })().finally(() => { building = null; });
  return building;
}

export interface CatalogHit { entry: CatalogEntry; similarity: number }

/** Semantic catalog search with a similarity floor, optionally limited to one catalog category. */
export function catalogSemantic(queryVector: Float32Array | null | undefined, options: { category?: string; limit?: number; minSimilarity?: number } = {}): CatalogHit[] {
  const store = state;
  if (!queryVector || !store) return [];
  const floor = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const hits: CatalogHit[] = [];
  for (const entry of store.entries) {
    if (options.category && entry.category !== options.category) continue;
    const vector = store.vectors.get(keyOf(entry));
    if (!vector) continue;
    const similarity = cosine(queryVector, vector);
    if (similarity >= floor) hits.push({ entry, similarity });
  }
  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, Math.max(1, options.limit ?? 6));
}

/** True once the startup build has completed, so callers know whether semantic hits are available yet. */
export function catalogReady(): boolean {
  return !!state;
}
