/**
 * Pure helpers shared by the sourcebook search and the RAG coverage checker.
 *
 * Keeping them free of filesystem and model access makes the phrase picker and the
 * near-duplicate test cheap to unit test: the coverage tool and `search_sourcebook`
 * both rely on the exact same definition of "distinctive" and "duplicate".
 */

const DEDUPE_ACCENTS = /[̀-ͯ]/g;

/** Lowercase, strip accents and punctuation. Two pages with the same key are identical. */
export function normalizeForDedupe(text: string): string {
  return text
    .normalize('NFD')
    .replace(DEDUPE_ACCENTS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function dedupeTokens(text: string): string[] {
  const normalized = normalizeForDedupe(text);
  return normalized ? normalized.split(' ') : [];
}

/**
 * True when two page bodies are effectively the same. An exact normalized match is
 * always a duplicate; otherwise at least 12 shared tokens and 90% containment of the
 * smaller page is required, so a tile and a book printing of the same spread collapse
 * while two different pages that merely share a heading do not.
 */
export function isNearDuplicate(left: string, right: string): boolean {
  const leftKey = normalizeForDedupe(left);
  const rightKey = normalizeForDedupe(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const leftTokens = new Set(leftKey.split(' '));
  const rightTokens = new Set(rightKey.split(' '));
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  if (smaller < 12) return false;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared++;
  return shared / smaller >= 0.9;
}

/**
 * Source preference used when near-duplicate pages come from overlapping documents.
 * A book or a full supplement always beats a tile or card sheet printing of the same
 * page; a newer release beats the older one.
 */
export function sourcePriority(sourceId: string): number {
  const id = sourceId.toLowerCase();
  if (id === 'core-rulebook') return 100;
  if (id === 'hope-and-fear-book') return 95;
  if (id === 'sablewood') return 72;
  if (id.includes('2026-08') || id.includes('aug') || id.includes('aug25')) return 62;
  if (id.includes('character-guides') || id.includes('guides')) return 58;
  if (id.includes('sheets')) return 54;
  if (id.includes('cards')) return 50;
  if (id.includes('campaign-frame')) return 45;
  if (id.includes('2026-07') || id.includes('tile')) return 30;
  if (id.includes('map')) return 20;
  return 40;
}

/** Human-readable source kind shown next to a citation. */
export function sourceLabel(sourceId: string, explicit?: string | null): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const id = sourceId.toLowerCase();
  if (id === 'core-rulebook' || id === 'hope-and-fear-book') return 'Book';
  if (id.includes('card')) return 'Cards';
  if (id.includes('sheet')) return 'Sheets';
  if (id.includes('guide')) return 'Guides';
  if (id.includes('campaign-frame') || id.includes('campaign frame')) return 'Campaign frame';
  if (id.includes('map')) return 'Map';
  if (id === 'sablewood') return 'Supplement';
  return 'Source';
}

export interface PhrasePage { pdf: number; text: string }
export interface DistinctivePhrase { pdf: number; phrase: string; words: number }

const PHRASE_STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'you', 'your', 'are', 'was', 'were', 'this', 'that', 'have', 'has',
  'had', 'not', 'but', 'they', 'them', 'their', 'from', 'when', 'will', 'can', 'may', 'may', 'one', 'two',
  'who', 'what', 'how', 'all', 'any', 'each', 'into', 'its', 'our', 'out', 'use', 'using', 'used', 'roll',
  'page', 'pages', 'chapter', 'daggerheart', 'printed', 'pdf',
]);

/**
 * Function words that make a line look like prose. Windows are drawn from such lines
 * (or long lines) so a phrase is a real consecutive run of words, not four adjacent
 * form-field labels from different cells. That keeps the coverage check honest: the
 * phrase can actually match its page with the BM25 phrase boost.
 */
const PROSE_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'and', 'or', 'but', 'in', 'on', 'at', 'as', 'by', 'for', 'from', 'with',
  'without', 'into', 'over', 'under', 'after', 'before', 'when', 'while', 'if', 'then', 'than', 'that',
  'this', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'you', 'your', 'they',
  'their', 'them', 'it', 'its', 'can', 'may', 'must', 'will', 'would', 'should', 'not', 'no', 'any',
  'each', 'every', 'all', 'some', 'more', 'most', 'who', 'which', 'what', 'how', 'where', 'why',
]);

function phraseWords(text: string): string[] {
  const matches = text.normalize('NFD').replace(DEDUPE_ACCENTS, '').match(/[A-Za-z][A-Za-z'-]*/g);
  return matches ? matches.map(word => word.toLowerCase()) : [];
}

/** Word runs per line, keeping only lines that read like prose (or are long enough). */
function phraseLines(text: string): string[][] {
  const lines: string[][] = [];
  for (const raw of text.split(/\n+/)) {
    const letters = raw.replace(/[^A-Za-z]/g, '').length;
    const upper = raw.replace(/[^A-Z]/g, '').length;
    if (!letters) continue;
    const words = phraseWords(raw);
    if (words.length < 3) continue;
    // Long label runs (a map's place names, a card sheet) are useful even when they are
    // mostly capitalized; short heading lines are not.
    if (upper / letters >= 0.6 && words.length < 10) continue;
    const labelRun = words.length >= 3 && words.every(word => word.length >= 6);
    if (words.length < 8 && !words.some(word => PROSE_WORDS.has(word)) && !labelRun) continue;
    lines.push(words);
  }
  return lines;
}

/** Deterministic PRNG so the coverage report is reproducible for a given seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}

/**
 * Pick `count` rare 3-5 word phrases from the text pages of one source.
 *
 * A phrase is rare when at most two pages contain it and at least two of its words are
 * themselves uncommon (present on no more than 2% of the source's text pages, minimum
 * two pages). The phrases are drawn from shuffled pages/windows with a seeded PRNG, so
 * repeated runs produce the same coverage checks. Pages without usable text are skipped.
 */
export function pickDistinctivePhrases(pages: readonly PhrasePage[], count: number, seed = 7): DistinctivePhrase[] {
  const usable = pages
    .map(page => ({ pdf: page.pdf, words: phraseWords(page.text), lines: phraseLines(page.text) }))
    .filter(page => page.words.length >= 8 && page.lines.length > 0);
  if (!usable.length) return [];

  const candidatePages = usable;
  const documentFrequency = new Map<string, number>();
  const pageWordSets = new Map<number, Set<string>>();
  for (const page of candidatePages) {
    const set = new Set(page.words);
    pageWordSets.set(page.pdf, set);
    for (const word of set) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
  }
  const rareCeiling = Math.max(2, Math.ceil(candidatePages.length * 0.02));
  const isRare = (word: string) => (documentFrequency.get(word) ?? 0) <= rareCeiling;
  // A small source (a three-page map set, a short guide) has too few windows to demand
  // two rare words in every phrase; one still keeps the query distinctive.
  const rareWordsPerPhrase = candidatePages.length < 8 ? 1 : 2;

  const random = mulberry32(seed);
  const orderedPages = shuffled(usable, random);
  const seen = new Set<string>();
  const picked: DistinctivePhrase[] = [];

  // Round-robin over the shuffled pages: the first pass takes one phrase per page so the
  // checks are spread across the source; later passes only add another phrase per page when
  // the source has too few text pages to reach `count`.
  for (let round = 0; round < 4 && picked.length < count; round++) {
    for (const page of orderedPages) {
      if (picked.length >= count) return picked;
      const usedOnPage = picked.filter(phrase => phrase.pdf === page.pdf).length;
      if (usedOnPage > round) continue;
      const windows: { phrase: string; words: number; score: number }[] = [];
      for (const line of page.lines) {
        for (let size = 4; size >= 3; size--) {
          for (let start = 0; start + size <= line.length; start++) {
            const slice = line.slice(start, start + size);
            if (slice.some(word => word.length < 4 || PHRASE_STOPWORDS.has(word))) continue;
            if (slice.filter(isRare).length < rareWordsPerPhrase) continue;
            const phrase = slice.join(' ');
            if (seen.has(phrase)) continue;
            // Prefer phrases built from the rarest words.
            const score = slice.reduce((sum, word) => sum + 1 / (1 + (documentFrequency.get(word) ?? 0)), 0);
            windows.push({ phrase, words: size, score });
          }
        }
      }
      windows.sort((a, b) => b.score - a.score);
      for (const window of shuffled(windows.slice(0, 12), random)) {
        if (seen.has(window.phrase)) continue;
        // Keep phrases that are unique to one page whenever possible.
        const pageMatches = candidatePages.filter(candidate => {
          const set = pageWordSets.get(candidate.pdf);
          return window.phrase.split(' ').every(word => set?.has(word));
        }).length;
        if (pageMatches > 2) continue;
        seen.add(window.phrase);
        picked.push({ pdf: page.pdf, phrase: window.phrase, words: window.words });
        break;
      }
    }
  }
  return picked;
}
