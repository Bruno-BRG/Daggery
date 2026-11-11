import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundledPaths, runtimePaths } from '../storage';
export { dataDirectory } from '../storage';
import type { Embedder } from './embeddings';
import { isNearDuplicate, sourceLabel, sourcePriority } from './rag-coverage';
import { DEFAULT_MIN_SIMILARITY, fuseRanked, type Scored } from './retrieval';

/**
 * Installed source books. tools/extract_sources.py writes one JSON file per book under
 * sources/rules/ (committed) and, when used locally, under
 * <DAGGERY_DATA_DIR>/rules/ (gitignored). Both folders are loaded; a data-directory file
 * with the same id wins, so a local re-extraction can override the committed copy. The
 * folder may be absent altogether; every lookup then reports that nothing is installed.
 */
export interface SourcebookPage {
  pdf: number;
  printed: number | null;
  text: string;
  /** Text came from OCR because the PDF page carries no text layer. */
  ocr?: boolean;
  /** Pure map/illustration page: text is a generated label, not printed prose. */
  imageOnly?: boolean;
}
export interface Sourcebook {
  sourceId: string;
  title: string;
  label?: string;
  pdfPageCount: number;
  printedPageOffset?: number;
  pages: SourcebookPage[];
}
export interface SourcebookInfo { sourceId: string; title: string; label: string; pdfPageCount: number }
export interface SearchHit {
  source: string;
  title: string;
  /** Short source kind: Book, Cards, Sheets, Map, Supplement, ... */
  sourceLabel: string;
  /** Printed page when the book has one, otherwise the PDF page. */
  page: number;
  pdfPage: number;
  score: number;
  snippet: string;
  ocr: boolean;
  imageOnly: boolean;
}
export interface SearchOptions { source?: string; limit?: number; queryVector?: Float32Array | null; minSimilarity?: number; embedderModel?: string }
export interface PageRead {
  source: string;
  title: string;
  pages: { page: number; pdfPage: number }[];
  text: string;
  truncated: boolean;
}

/** Each request may return at most this much page text. */
export const PAGE_CHARS = 6000;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const PHRASE_BOOST = 3;
const SNIPPET_CHARS = 320;

interface IndexedPage { book: number; page: number; tf: Map<string, number>; length: number; norm: string }
interface BookIndex { books: Sourcebook[]; pages: IndexedPage[]; df: Map<string, number>; averageLength: number }

let cached: { dir: string; signature: string; index: BookIndex } | null = null;
let ensured: { signature: string; model: string; dim: number } | null = null;
/** Page vectors stay in memory: a search must not re-parse every `.vec` file. */
let pageVectorCache: { signature: string; books: Map<string, BookVectors | null> } | null = null;

export function rulesDirectory(): string {
  return runtimePaths().rules;
}

/** Bundled rules use the shared storage layout, never a working-directory fallback. */
export function repoRulesDirectory(): string | null {
  if (process.env.DAGGERY_REPO_RULES === 'off') return null;
  return existsSync(bundledPaths.rules) ? bundledPaths.rules : null;
}

/** Rule folders in load order: committed sources first, then the data directory (which wins). */
export function sourcebookDirectories(): string[] {
  const dirs: string[] = [];
  const repo = repoRulesDirectory();
  if (repo) dirs.push(repo);
  const data = rulesDirectory();
  if (!dirs.includes(data)) dirs.push(data);
  return dirs;
}

/** Drops the loaded books. Tests point DAGGERY_DATA_DIR at a fixture folder and call this. */
export function resetSourcebookCache(): void {
  cached = null;
  ensured = null;
  pageVectorCache = null;
}

function displayPage(page: SourcebookPage): number {
  return page.printed ?? page.pdf;
}

function normalize(value: string): string {
  // Punctuation becomes a space so the whole-query phrase boost still matches prose
  // ("spending fear" inside "Spending Fear, then...").
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalize(value).match(/[a-z0-9]+/g) ?? [];
}

function validBook(value: unknown): Sourcebook | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const book = value as Record<string, unknown>;
  if (typeof book.sourceId !== 'string' || !book.sourceId.trim()) return null;
  if (!Array.isArray(book.pages)) return null;
  const pages = book.pages.flatMap((raw): SourcebookPage[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const page = raw as Record<string, unknown>;
    if (typeof page.pdf !== 'number' || !Number.isInteger(page.pdf) || typeof page.text !== 'string') return [];
    return [{
      pdf: page.pdf,
      printed: typeof page.printed === 'number' ? page.printed : null,
      text: page.text,
      ...(page.ocr === true ? { ocr: true } : {}),
      ...(page.imageOnly === true ? { imageOnly: true } : {}),
    }];
  });
  if (!pages.length) return null;
  return {
    sourceId: book.sourceId.trim(),
    title: typeof book.title === 'string' && book.title.trim() ? book.title.trim() : book.sourceId.trim(),
    label: typeof book.label === 'string' && book.label.trim() ? book.label.trim() : undefined,
    pdfPageCount: typeof book.pdfPageCount === 'number' ? book.pdfPageCount : pages.length,
    ...(typeof book.printedPageOffset === 'number' ? { printedPageOffset: book.printedPageOffset } : {}),
    pages,
  };
}

function loadBooksFrom(dir: string): Sourcebook[] {
  if (!existsSync(dir)) return [];
  const books: Sourcebook[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown;
      const book = validBook(parsed);
      if (book) books.push(book);
    } catch {
      // A broken or half-written extraction must not take the whole sourcebook shelf down.
    }
  }
  return books;
}

/**
 * Every installed book, keyed by sourceId. The committed folder loads first and the data
 * directory second, so a local copy of the same id replaces the committed one.
 */
function loadBooks(): Sourcebook[] {
  const byId = new Map<string, Sourcebook>();
  for (const dir of sourcebookDirectories()) {
    for (const book of loadBooksFrom(dir)) byId.set(book.sourceId.toLowerCase(), book);
  }
  return [...byId.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

function buildIndex(books: Sourcebook[]): BookIndex {
  const pages: IndexedPage[] = [];
  const df = new Map<string, number>();
  let totalLength = 0;
  books.forEach((book, bookIndex) => {
    book.pages.forEach((page, pageIndex) => {
      const tokens = tokenize(page.text);
      const tf = new Map<string, number>();
      for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
      for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
      totalLength += tokens.length;
      pages.push({ book: bookIndex, page: pageIndex, tf, length: tokens.length, norm: normalize(page.text) });
    });
  });
  return { books, pages, df, averageLength: pages.length ? totalLength / pages.length : 0 };
}

/**
 * The directory signature (names, sizes and modification times) makes a book added or replaced at
 * runtime visible on the next search without a restart. Extracted books are small in number, so the
 * scan is cheap; parsing only happens when the signature changes.
 */
function directorySignature(dir: string): string {
  if (!existsSync(dir)) return '';
  const names = readdirSync(dir).filter(name => name.toLowerCase().endsWith('.json')).sort();
  return names.map(name => {
    try {
      const stat = statSync(join(dir, name));
      return name + ':' + String(stat.size) + ':' + String(Math.floor(stat.mtimeMs));
    } catch {
      return name + ':?';
    }
  }).join('|');
}

/** A change in either the committed folder or the data folder invalidates the index. */
function sourcesSignature(): string {
  return sourcebookDirectories().map(dir => dir + '#' + directorySignature(dir)).join('||');
}

function index(): BookIndex {
  const signature = sourcesSignature();
  if (cached?.dir !== 'multi' || cached.signature !== signature) cached = { dir: 'multi', signature, index: buildIndex(loadBooks()) };
  return cached.index;
}

/**
 * Page vectors are cached under `<data dir>/rules/` as `<sourceId>.vec` (JSON). They never
 * live beside the committed JSON in sources/rules/. The file records the content hash,
 * model and dimension; a book is re-embedded only when its text changes or the model does.
 */
interface BookVectors { hash: string; model: string; dim: number; vectors: Float32Array[] }

function bookHash(book: Sourcebook): string {
  return createHash('sha256').update(book.sourceId).update('\u0000').update(book.title).update('\u0000').update(book.pages.map(page => page.text).join('\u0001')).digest('hex');
}

function vectorCachePath(book: Sourcebook): string {
  return join(rulesDirectory(), book.sourceId + '.vec');
}

function readBookVectors(book: Sourcebook): BookVectors | null {
  const path = vectorCachePath(book);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { hash?: unknown; model?: unknown; dim?: unknown; vectors?: unknown };
    if (parsed.hash !== bookHash(book) || typeof parsed.model !== 'string' || typeof parsed.dim !== 'number' || !Array.isArray(parsed.vectors)) return null;
    const vectors = parsed.vectors.map(row => Array.isArray(row) ? Float32Array.from(row.filter(value => typeof value === 'number') as number[]) : null);
    if (vectors.length !== book.pages.length || vectors.some(vector => !vector || vector.length !== parsed.dim)) return null;
    return { hash: parsed.hash, model: parsed.model, dim: parsed.dim, vectors: vectors as Float32Array[] };
  } catch {
    return null;
  }
}

function writeBookVectors(book: Sourcebook, model: string, vectors: Float32Array[]): void {
  const dim = vectors[0]?.length ?? 0;
  const payload = { hash: bookHash(book), model, dim, vectors: vectors.map(vector => Array.from(vector)) };
  mkdirSync(rulesDirectory(), { recursive: true });
  writeFileSync(vectorCachePath(book), JSON.stringify(payload));
  // The next search reads the fresh cache rather than a stale in-memory copy.
  pageVectorCache?.books.delete(book.sourceId);
}

/** Embedding-cache state per installed book. Used by the coverage checker and diagnostics. */
export interface SourcebookVectorInfo {
  sourceId: string;
  pages: number;
  vectors: number;
  model: string | null;
  dim: number | null;
  current: boolean;
}

export function sourcebookVectorInfo(): SourcebookVectorInfo[] {
  return loadBooks().map(book => {
    const cache = readBookVectors(book);
    return {
      sourceId: book.sourceId,
      pages: book.pages.length,
      vectors: cache?.vectors.length ?? 0,
      model: cache?.model ?? null,
      dim: cache?.dim ?? null,
      current: !!cache,
    };
  });
}

/**
 * Builds or refreshes the page-vector cache for every installed book. Runs on the background
 * indexing queue at startup and whenever a book is added. A stale or missing cache is rebuilt; an
 * unchanged one is left alone. Returns how many books were (re)built.
 */
export async function ensureSourcebookEmbeddings(embedder: Embedder): Promise<{ built: number; pages: number }> {
  const signature = sourcesSignature();
  if (ensured && ensured.signature === signature && ensured.model === embedder.model && ensured.dim === embedder.dim) return { built: 0, pages: 0 };
  const store = buildIndex(loadBooks());
  let built = 0, pages = 0;
  for (const book of store.books) {
    const current = readBookVectors(book);
    if (current && current.model === embedder.model && current.dim === embedder.dim) continue;
    const vectors: Float32Array[] = [];
    for (let start = 0; start < book.pages.length; start += 32) {
      const chunk = book.pages.slice(start, start + 32).map(page => page.text);
      const embedded = await embedder.embed(chunk);
      for (const vector of embedded) vectors.push(vector);
    }
    if (vectors.length !== book.pages.length) continue;
    writeBookVectors(book, embedder.model, vectors);
    built++;
    pages += vectors.length;
  }
  ensured = { signature, model: embedder.model, dim: embedder.dim };
  return { built, pages };
}

/** Loads every cached page vector, keyed by the page's global position in the BM25 index. */
function loadPageVectors(store: BookIndex, model?: string): Map<number, Float32Array> {
  const signature = sourcesSignature();
  if (!pageVectorCache || pageVectorCache.signature !== signature) {
    pageVectorCache = { signature, books: new Map() };
  }
  const found = new Map<number, Float32Array>();
  let position = 0;
  for (const book of store.books) {
    let cache: BookVectors | null;
    if (pageVectorCache.books.has(book.sourceId)) cache = pageVectorCache.books.get(book.sourceId)!;
    else {
      cache = readBookVectors(book);
      pageVectorCache.books.set(book.sourceId, cache);
    }
    // A cache built by another model cannot be compared with this query vector.
    const usable = cache && (!model || cache.model === model) ? cache : null;
    for (let index = 0; index < book.pages.length; index++) {
      const vector = usable?.vectors[index];
      if (vector) found.set(position + index, vector);
    }
    position += book.pages.length;
  }
  return found;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0, left = 0, right = 0;
  for (let index = 0; index < length; index++) {
    const x = a[index]!, y = b[index]!;
    dot += x * y; left += x * x; right += y * y;
  }
  return left === 0 || right === 0 ? 0 : dot / Math.sqrt(left * right);
}

/** Installed books, for the frame registry, the tools and tests. */
export function listSourcebooks(): SourcebookInfo[] {
  return index().books.map(book => ({
    sourceId: book.sourceId,
    title: book.title,
    label: sourceLabel(book.sourceId, book.label),
    pdfPageCount: book.pdfPageCount,
  }));
}

export function hasSourcebook(sourceId: string): boolean {
  const wanted = sourceId.toLowerCase();
  return index().books.some(book => book.sourceId.toLowerCase() === wanted);
}

function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 3));
  const end = Math.min(text.length, start + SNIPPET_CHARS);
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + body + (end < text.length ? '…' : '');
}

interface CandidateHit {
  position: number;
  score: number;
  sourceId: string;
  title: string;
  sourceLabel: string;
  page: SourcebookPage;
  priority: number;
}

/**
 * Collapses pages that print the same material (an older tile and the newer release, a
 * card sheet and the full book). Clusters are built in score order, but each cluster is
 * represented by its most authoritative source, so citing a hit prefers the book or the
 * newest release over a duplicated sheet. Image-only pages are never merged: their
 * generated labels are identical but the pages themselves are distinct maps or art.
 */
function collapseDuplicates(candidates: CandidateHit[], limit: number): CandidateHit[] {
  const clusters: { representative: CandidateHit; texts: string[]; imageOnly: boolean }[] = [];
  for (const candidate of candidates) {
    const imageOnly = candidate.page.imageOnly === true;
    if (!imageOnly) {
      const cluster = clusters.find(entry => !entry.imageOnly && entry.texts.some(text => isNearDuplicate(candidate.page.text, text)));
      if (cluster) {
        cluster.texts.push(candidate.page.text);
        const current = cluster.representative;
        if (candidate.priority > current.priority || (candidate.priority === current.priority && candidate.score > current.score)) {
          cluster.representative = candidate;
        }
        continue;
      }
    }
    clusters.push({ representative: candidate, texts: [candidate.page.text], imageOnly });
  }
  return clusters
    .map(cluster => cluster.representative)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, limit);
}

/**
 * BM25 over every installed page, with a phrase boost when the whole normalized query
 * appears on the page. Empty or absent sourcebooks return an empty list. Near-duplicate
 * pages from overlapping sources collapse into one hit, with the book preferred.
 */
export function searchSourcebooks(query: string, options: SearchOptions = {}): SearchHit[] {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const store = index();
  if (!store.pages.length) return [];
  const wanted = options.source?.trim().toLowerCase();
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 6)));
  const phrase = terms.join(' ');
  const scored: { position: number; score: number }[] = [];
  store.pages.forEach((page, position) => {
    const book = store.books[page.book]!;
    if (wanted && book.sourceId.toLowerCase() !== wanted) return;
    let score = 0;
    for (const term of terms) {
      const tf = page.tf.get(term);
      if (!tf) continue;
      const df = store.df.get(term) ?? 0;
      const idf = Math.log(1 + (store.pages.length - df + 0.5) / (df + 0.5));
      const lengthNorm = store.averageLength > 0 ? 1 - BM25_B + BM25_B * (page.length / store.averageLength) : 1;
      score += idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lengthNorm);
    }
    if (score <= 0) return;
    if (terms.length > 1 && page.norm.includes(phrase)) score += PHRASE_BOOST;
    scored.push({ position, score });
  });
  scored.sort((a, b) => b.score - a.score || a.position - b.position);
  const bm25: Scored<number>[] = scored.map(hit => ({ item: hit.position, score: hit.score }));
  let ranked: Scored<number>[] = bm25;
  if (options.queryVector) {
    // Semantic pages are merged with the BM25 ranking. Pages without a cached vector stay reachable
    // through BM25, and a similarity floor keeps unrelated pages out of the results.
    const vectors = loadPageVectors(store, options.embedderModel);
    const floor = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
    const semantic: Scored<number>[] = [];
    store.pages.forEach((page, position) => {
      const book = store.books[page.book]!;
      if (wanted && book.sourceId.toLowerCase() !== wanted) return;
      const vector = vectors.get(position);
      if (!vector) return;
      const similarity = cosineSimilarity(options.queryVector!, vector);
      if (similarity >= floor) semantic.push({ item: position, score: similarity });
    });
    semantic.sort((a, b) => b.score - a.score || a.item - b.item);
    if (semantic.length) ranked = fuseRanked(bm25, semantic);
  }

  // Score enough candidates to see duplicates from a lower-ranked source before trimming.
  const candidates: CandidateHit[] = ranked.slice(0, Math.max(limit * 20, 80)).map(hit => {
    const indexed = store.pages[hit.item]!;
    const book = store.books[indexed.book]!;
    const page = book.pages[indexed.page]!;
    return {
      position: hit.item,
      score: hit.score,
      sourceId: book.sourceId,
      title: book.title,
      sourceLabel: sourceLabel(book.sourceId, book.label),
      page,
      priority: sourcePriority(book.sourceId),
    };
  });
  return collapseDuplicates(candidates, limit).map(candidate => ({
    source: candidate.sourceId,
    title: candidate.title,
    sourceLabel: candidate.sourceLabel,
    page: displayPage(candidate.page),
    pdfPage: candidate.page.pdf,
    score: Math.round(candidate.score * 1000) / 1000,
    snippet: snippet(candidate.page.text, terms),
    ocr: candidate.page.ocr === true,
    imageOnly: candidate.page.imageOnly === true,
  }));
}

/** Full text of one page (or two consecutive pages), capped so a tool result stays bounded. */
export function readSourcebookPage(source: string, page: number, span = 1): PageRead | null {
  const store = index();
  const wanted = source.trim().toLowerCase();
  const book = store.books.find(item => item.sourceId.toLowerCase() === wanted);
  if (!book) return null;
  let position = book.pages.findIndex(item => displayPage(item) === page);
  if (position < 0) position = book.pages.findIndex(item => item.pdf === page);
  if (position < 0) return null;
  const count = Math.max(1, Math.min(2, Math.floor(span)));
  const selected = book.pages.slice(position, position + count);
  const chunks = selected.map(item => {
    const label = item.printed === null ? 'PDF p. ' + item.pdf : 'p. ' + item.printed + ' (PDF ' + item.pdf + ')';
    return '[' + book.title + ', ' + label + ']' + String.fromCharCode(10) + (item.text.trim() || '(no text on this page)');
  });
  let text = chunks.join(String.fromCharCode(10, 10));
  let truncated = false;
  if (text.length > PAGE_CHARS) {
    text = text.slice(0, PAGE_CHARS).trimEnd() + String.fromCharCode(10) + '… (page text truncated)';
    truncated = true;
  }
  return {
    source: book.sourceId,
    title: book.title,
    pages: selected.map(item => ({ page: displayPage(item), pdfPage: item.pdf })),
    text,
    truncated,
  };
}
