/**
 * Ranked multi-term retrieval shared by durable canon, the adventure journal and proactive recall.
 *
 * Campaign data is small, so scoring happens in JavaScript over the rows already filtered by the
 * SQL query (campaign, visibility, status and kind). This keeps the database schema untouched and
 * lets the same tokenizer handle possessives, plurals and accents for search, filters and recall.
 */

const STOPWORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been',
  'before', 'being', 'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself',
  'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most',
  'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under',
  'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will',
  'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves',
]);

const BM25_K1 = 1.2;
const BM25_B = 0.75;
/** A title match counts several times a body match: names are what the table searches for. */
export const TITLE_WEIGHT = 4;
/** Extra credit when the query terms appear together, in order, in one field. */
export const PHRASE_BONUS = 3;

export interface Scored<T> { item: T; score: number }

/** Lowercase, strip accents and normalize apostrophes. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Light plural and possessive handling. Possessives are removed before word boundaries. */
export function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !/(?:ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

/** Words of a normalized value, with possessives removed but plurals left as written. Used by the journal filter. */
export function filterTerms(value: string): string[] {
  const clean = normalizeText(value).replace(/['’]s(?![a-z0-9])/g, ' ').replace(/['’]/g, ' ');
  const raw = clean.match(/[a-z0-9]+/g) ?? [];
  return raw.filter(token => token.length > 1 && !STOPWORDS.has(token));
}

/** Search tokens: filter terms with light stemming. Duplicates are kept so term frequency still counts. */
export function tokenize(value: string): string[] {
  return filterTerms(value).map(stemToken);
}

export function hasQueryTerms(value: string): boolean {
  return tokenize(value).length > 0;
}

function frequencies(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

interface FieldStats { df: Map<string, number>; averageLength: number }

function fieldStats(lengths: number[], counts: Map<string, number>[]): FieldStats {
  const df = new Map<string, number>();
  for (const frequency of counts) for (const token of frequency.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return { df, averageLength: lengths.length ? total / lengths.length : 0 };
}

function bm25(frequency: Map<string, number>, length: number, stats: FieldStats, documents: number, term: string): number {
  const tf = frequency.get(term) ?? 0;
  if (!tf) return 0;
  const df = stats.df.get(term) ?? 0;
  const idf = Math.log(1 + (documents - df + 0.5) / (df + 0.5));
  const lengthNorm = stats.averageLength > 0 ? 1 - BM25_B + BM25_B * (length / stats.averageLength) : 1;
  return (idf * (tf * (BM25_K1 + 1))) / (tf + BM25_K1 * lengthNorm);
}

function newestFirst<T>(items: T[], recency: ((item: T) => string) | undefined): T[] {
  if (!recency) return items.slice();
  return items.slice().sort((a, b) => recency(b).localeCompare(recency(a)));
}

export interface RankOptions<T> {
  title: (item: T) => string;
  body: (item: T) => string;
  /** ISO timestamp used as the tiebreak, and as the order for an empty query. */
  recency?: (item: T) => string;
  /** Multiplies the final score, for example to down-weight engine events. */
  weight?: (item: T) => number;
  limit?: number;
  /** Hits below this score are dropped. Recall uses it to stay silent when nothing is relevant. */
  minScore?: number;
  /** Stored semantic vector per item, when the caller has embedded it. */
  vector?: (item: T) => Float32Array | undefined;
  /** Query embedding. When absent, ranking is BM25-only. */
  queryVector?: Float32Array | null;
  /** Minimum cosine similarity for a semantic-only hit. Junk below it is never returned. */
  minSimilarity?: number;
}

/** Reciprocal-rank-fusion constant. Ranks (not raw scores) are combined, so BM25 and cosine need no shared scale. */
export const RRF_K = 20;
const BM25_FUSION_WEIGHT = 1;
const SEMANTIC_FUSION_WEIGHT = 0.9;
/** A query vector must clear this cosine similarity before it can add an item on its own. */
export const DEFAULT_MIN_SIMILARITY = 0.32;
/** Safety cap for brute-force cosine over one campaign; campaign records are far below this. */
export const SEMANTIC_SCAN_LIMIT = 20000;

/**
 * Combines a BM25 ranking and a cosine ranking with reciprocal rank fusion. Items are matched by
 * their position in the original list (callers pass the same objects), so exact-name BM25 hits keep
 * their lead while a synonym hit the words missed can still surface.
 */
export function fuseRanked<T>(bm25: Scored<T>[], semantic: Scored<T>[], recency?: (item: T) => string): Scored<T>[] {
  const fused = new Map<T, number>();
  const add = (item: T, score: number) => fused.set(item, (fused.get(item) ?? 0) + score);
  bm25.forEach((hit, rank) => add(hit.item, BM25_FUSION_WEIGHT / (RRF_K + rank + 1)));
  semantic.forEach((hit, rank) => add(hit.item, SEMANTIC_FUSION_WEIGHT / (RRF_K + rank + 1)));
  return [...fused.entries()]
    .map(([item, score]) => ({ item, score }))
    .sort((a, b) => b.score - a.score || (recency ? recency(b.item).localeCompare(recency(a.item)) : 0));
}

/** Semantic hits with a real similarity floor: unrelated content must not leak into results. */
export function semanticHits<T>(items: T[], queryVector: Float32Array | null | undefined, vector: ((item: T) => Float32Array | undefined) | undefined, minSimilarity = DEFAULT_MIN_SIMILARITY): Scored<T>[] {
  if (!queryVector || !vector) return [];
  const hits: Scored<T>[] = [];
  let scanned = 0;
  for (const item of items) {
    if (++scanned > SEMANTIC_SCAN_LIMIT) break;
    const candidate = vector(item);
    if (!candidate) continue;
    const similarity = cosine(queryVector, candidate);
    if (similarity >= minSimilarity) hits.push({ item, score: similarity });
  }
  return hits.sort((a, b) => b.score - a.score);
}

function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0, left = 0, right = 0;
  for (let index = 0; index < length; index++) {
    const x = a[index]!, y = b[index]!;
    dot += x * y; left += x * x; right += y * y;
  }
  return left === 0 || right === 0 ? 0 : dot / Math.sqrt(left * right);
}

/**
 * Ranks items against a multi-term query: BM25 over body and title (title weighted), a phrase
 * bonus, an optional per-item weight, then recency as the tiebreak. An empty query returns the
 * newest items, which matches the old "list the newest" behaviour.
 */
export function rankObjects<T>(items: T[], query: string, options: RankOptions<T>): Scored<T>[] {
  if (!items.length) return [];
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) {
    return newestFirst(items, options.recency).slice(0, options.limit ?? items.length).map(item => ({ item, score: 0 }));
  }
  const titles = items.map(item => tokenize(options.title(item)));
  const bodies = items.map(item => tokenize(options.body(item)));
  const titleCounts = titles.map(frequencies);
  const bodyCounts = bodies.map(frequencies);
  const titleStats = fieldStats(titles.map(tokens => tokens.length), titleCounts);
  const bodyStats = fieldStats(bodies.map(tokens => tokens.length), bodyCounts);
  const documents = items.length;
  const phrase = terms.join(' ');
  const scored: Scored<T>[] = [];
  items.forEach((item, index) => {
    let score = 0;
    for (const term of terms) {
      score += TITLE_WEIGHT * bm25(titleCounts[index]!, titles[index]!.length, titleStats, documents, term);
      score += bm25(bodyCounts[index]!, bodies[index]!.length, bodyStats, documents, term);
    }
    if (score > 0 && terms.length > 1) {
      if (titles[index]!.join(' ').includes(phrase) || bodies[index]!.join(' ').includes(phrase)) score += PHRASE_BONUS;
    }
    const weight = options.weight?.(item) ?? 1;
    const weighted = score * weight;
    if (weighted > 0 && weighted >= (options.minScore ?? 0)) scored.push({ item, score: weighted });
  });
  scored.sort((a, b) => b.score - a.score || (options.recency ? options.recency(b.item).localeCompare(options.recency(a.item)) : 0));
  const semantic = semanticHits(items, options.queryVector, options.vector, options.minSimilarity);
  if (semantic.length) {
    return fuseRanked(scored, semantic, options.recency).slice(0, options.limit ?? scored.length);
  }
  return scored.slice(0, options.limit ?? scored.length);
}
