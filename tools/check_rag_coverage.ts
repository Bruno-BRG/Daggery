#!/usr/bin/env tsx
/**
 * Prove the AI GM's RAG actually covers every shipped source PDF.
 *
 *   npx tsx tools/check_rag_coverage.ts
 *
 * For every extracted source it:
 *   1. loads sources/rules/<id>.json (with the data-directory override applied, exactly
 *      as the server does) and checks every PDF page is present and accounted for;
 *   2. counts characters, OCR pages and image-only pages;
 *   3. ensures the page vectors exist (`ensureSourcebookEmbeddings`) and matches the
 *      expected page count;
 *   4. draws eight rare 3-5 word phrases from random text pages and asserts the
 *      originating page is in the top 3 hybrid `search_sourcebook` results. A page that
 *      was collapsed into a near-duplicate book page still counts, and is reported as
 *      "deduped" rather than a miss;
 *   5. runs a handful of hand-written semantic questions against the core rulebook and
 *      the Hope & Fear book and prints their citations.
 *
 * The summary is written to docs/rag-coverage.md.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogEntries, catalogVectors, ensureCatalogEmbeddings } from '../apps/server/src/ai/catalog-index';
import { localEmbedderProvider } from '../apps/server/src/ai/local-embedder';
import { isNearDuplicate, pickDistinctivePhrases } from '../apps/server/src/ai/rag-coverage';
import {
  ensureSourcebookEmbeddings,
  listSourcebooks,
  repoRulesDirectory,
  resetSourcebookCache,
  rulesDirectory,
  searchSourcebooks,
  sourcebookVectorInfo,
} from '../apps/server/src/ai/sourcebook';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCES_DIR = join(ROOT, 'sources');
const DOCS = join(ROOT, 'docs', 'rag-coverage.md');

/** The PDF each stable source id was extracted from. */
const PDF_FILES: Record<string, string> = {
  'core-rulebook': 'Daggerheart_Core_Full_Art_and_Printer_Friendly_Cards_-_9-09-25.pdf',
  'hope-and-fear-book': 'Daggerheart_HF_Full_Art_and_Printer_Friendly_Cards_-_8-14-26.pdf',
  'hope-and-fear-cards': 'Daggerheart-HF-Print-and-Play-Cards-08-14-2026.pdf',
  'hope-and-fear-sheets': 'AdditionalSheetsTile_HF_2026-08-25.pdf',
  'hope-and-fear-character-guides': 'CharacterGuidesAndSheetsTile_HF_2026-07-23.pdf',
  'hope-and-fear-campaign-frame': 'CampaignFrameMaterialsTile_HF_2026-07-23.pdf',
  sablewood: 'Sablewood-05-20-25.pdf',
  'additional-sheets-2026-08': 'Additional-Sheets-Daggerheart-Aug252026.pdf',
  'campaign-frame-materials-2026-08': 'Campaign-Frame-Materials-Aug252026.pdf',
  'character-sheets-guides-2026-08': 'Character-Sheets-and-Guides-Daggerheart-Aug252026.pdf',
  'blank-maps': 'Daggerheart-Blank-Maps-May202025.pdf',
};

interface JsonPage { pdf: number; printed: number | null; text: string; ocr?: boolean; imageOnly?: boolean }
interface JsonBook { sourceId: string; title: string; label?: string; pdfPageCount: number; pages: JsonPage[] }

function loadJsonBook(dir: string, id: string): JsonBook | null {
  const path = join(dir, id + '.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as JsonBook;
  } catch {
    return null;
  }
}

/** Mirrors the server: committed sources/rules first, data directory overrides. */
function loadAllBooks(): Map<string, JsonBook> {
  const books = new Map<string, JsonBook>();
  const dirs = [repoRulesDirectory(), rulesDirectory()].filter((dir): dir is string => !!dir);
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter(item => item.toLowerCase().endsWith('.json'))) {
      const id = name.replace(/\.json$/i, '');
      const book = loadJsonBook(dir, id);
      if (book) books.set(book.sourceId, book);
    }
  }
  return books;
}

function pdfPageCount(id: string): number | null {
  const file = PDF_FILES[id];
  if (!file) return null;
  const pdf = join(SOURCES_DIR, file);
  if (!existsSync(pdf)) return null;
  try {
    const output = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
    const match = output.match(/^Pages:\s+(\d+)\s*$/m);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function jsonBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
}

interface SourceReport {
  sourceId: string;
  title: string;
  label: string;
  pages: number;
  pdfPages: number | null;
  pageProblem: string | null;
  characters: number;
  ocr: number;
  imageOnly: number;
  textPages: number;
  vectors: number;
  vectorProblem: string | null;
  queries: number;
  directHits: number;
  dedupedHits: number;
  sourceOnlyHits: number;
  misses: { phrase: string; pdf: number; top: string[] }[];
  skipped: string | null;
}

const SEMANTIC_QUERIES: { source: string; question: string }[] = [
  { source: 'core-rulebook', question: 'how does a ghost transformation work' },
  { source: 'core-rulebook', question: 'what is the Dread domain' },
  { source: 'core-rulebook', question: 'Castle High campaign frame' },
  { source: 'core-rulebook', question: 'how do you gain and spend Hope' },
  { source: 'core-rulebook', question: 'what happens when you take a scar' },
  { source: 'hope-and-fear-book', question: 'how does a ghost transformation work' },
  { source: 'hope-and-fear-book', question: 'what is the Dread domain' },
  { source: 'hope-and-fear-book', question: 'Reign of the Weredragon campaign frame' },
  { source: 'hope-and-fear-book', question: 'what spells does the witch class have' },
  { source: 'hope-and-fear-book', question: 'how do transformations change a character' },
];

async function main(): Promise<void> {
  resetSourcebookCache();
  const provider = localEmbedderProvider({ log: message => console.error(message) });
  const embedder = await provider();
  if (!embedder) {
    console.error('The local embedding model is unavailable; coverage needs hybrid search. Aborting.');
    process.exitCode = 1;
    return;
  }

  const books = loadAllBooks();
  const listed = new Map(listSourcebooks().map(info => [info.sourceId, info]));
  const building = await ensureSourcebookEmbeddings(embedder);
  const vectorInfo = new Map(sourcebookVectorInfo().map(info => [info.sourceId, info]));
  console.log(`Embedded ${building.pages} pages across ${building.built} rebuilt book(s); model ${embedder.model}.`);

  // The structured catalog is part of the same RAG surface. Build (or load the cache)
  // and report how long the startup work takes with the real model.
  const catalog = catalogEntries();
  const catalogByCategory = new Map<string, number>();
  for (const entry of catalog) catalogByCategory.set(entry.category, (catalogByCategory.get(entry.category) ?? 0) + 1);
  const catalogStarted = Date.now();
  const catalogCount = await ensureCatalogEmbeddings(embedder);
  const catalogMs = Date.now() - catalogStarted;
  const catalogVectorsCount = catalogVectors()?.size ?? 0;
  console.log(`Catalog: ${catalogCount}/${catalog.length} entries embedded in ${(catalogMs / 1000).toFixed(1)}s.`);

  const reports: SourceReport[] = [];
  const ids = [...books.keys()].sort((a, b) => a.localeCompare(b));
  let seed = 11;
  for (const id of ids) {
    const book = books.get(id)!;
    const pdfPages = pdfPageCount(id);
    const pageProblem = pdfPages === null
      ? 'no PDF mapping (or pdfinfo unavailable)'
      : pdfPages !== book.pages.length || pdfPages !== book.pdfPageCount
        ? `PDF has ${pdfPages} pages, JSON has ${book.pages.length} (pdfPageCount ${book.pdfPageCount})`
        : null;
    const characters = book.pages.reduce((sum, page) => sum + page.text.length, 0);
    const ocr = book.pages.filter(page => page.ocr).length;
    const imageOnly = book.pages.filter(page => page.imageOnly).length;
    const textPages = book.pages.filter(page => !page.imageOnly && page.text.trim().length >= 12);
    const info = vectorInfo.get(id);
    const vectorProblem = !info
      ? 'no vector cache'
      : info.vectors !== book.pages.length || !info.current
        ? `${info.vectors}/${book.pages.length} cached vectors`
        : null;

    const phrases = pickDistinctivePhrases(book.pages, 8, seed++);
    // Embed this source's phrases in one batch; a per-query model call dominated the run.
    const phraseVectors = phrases.length ? await embedder.embed(phrases.map(candidate => candidate.phrase)) : [];
    let directHits = 0;
    let dedupedHits = 0;
    let sourceOnlyHits = 0;
    const misses: SourceReport['misses'] = [];
    for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex++) {
      const candidate = phrases[phraseIndex]!;
      const queryVector = phraseVectors[phraseIndex] ?? null;
      const results = searchSourcebooks(candidate.phrase, {
        limit: 3,
        queryVector,
        embedderModel: embedder.model,
      });
      const direct = results.some(hit => hit.source === id && hit.pdfPage === candidate.pdf);
      const origin = book.pages.find(page => page.pdf === candidate.pdf);
      const deduped = !direct && results.some(hit => {
        const other = books.get(hit.source);
        const otherPage = other?.pages.find(page => page.pdf === hit.pdfPage);
        return !!origin && !!otherPage && isNearDuplicate(origin.text, otherPage.text);
      });
      if (direct) directHits++;
      else if (deduped) dedupedHits++;
      else {
        // A common phrase can be outranked by another book even though the page is
        // retrievable. Retry restricted to this source: that still exercises hybrid
        // search, and separates "bad query" from "page not indexed".
        const restricted = searchSourcebooks(candidate.phrase, {
          source: id,
          limit: 3,
          queryVector,
          embedderModel: embedder.model,
        });
        if (restricted.some(hit => hit.source === id && hit.pdfPage === candidate.pdf)) sourceOnlyHits++;
        else {
          misses.push({
            phrase: candidate.phrase,
            pdf: candidate.pdf,
            top: results.map(hit => `${hit.source}:${hit.pdfPage}`),
          });
        }
      }
    }

    reports.push({
      sourceId: id,
      title: book.title,
      label: listed.get(id)?.label ?? book.label ?? 'Source',
      pages: book.pages.length,
      pdfPages,
      pageProblem,
      characters,
      ocr,
      imageOnly,
      textPages: textPages.length,
      vectors: info?.vectors ?? 0,
      vectorProblem,
      queries: phrases.length,
      directHits,
      dedupedHits,
      sourceOnlyHits,
      misses,
      skipped: phrases.length === 0 ? (textPages.length ? 'no distinctive phrases found' : 'no text pages') : null,
    });
    const strict = directHits + dedupedHits;
    const reachable = strict + sourceOnlyHits;
    console.log(`${id}: ${reachable}/${phrases.length} reachable (${directHits} direct, ${dedupedHits} deduped, ${sourceOnlyHits} source-only); strict ${strict}/${phrases.length}`);
  }

  // Hand-written semantic questions, printed with citations for manual review.
  const semantic: string[] = [];
  const semanticQuestions = SEMANTIC_QUERIES.filter(entry => books.has(entry.source));
  const semanticVectors = semanticQuestions.length
    ? await embedder.embed(semanticQuestions.map(entry => entry.question))
    : [];
  for (let questionIndex = 0; questionIndex < semanticQuestions.length; questionIndex++) {
    const entry = semanticQuestions[questionIndex]!;
    const queryVector = semanticVectors[questionIndex] ?? null;
    const hits = searchSourcebooks(entry.question, { limit: 3, queryVector, embedderModel: embedder.model });
    console.log(`\nQ (${entry.source}): ${entry.question}`);
    for (const hit of hits) {
      console.log(`  ${hit.title}, p. ${hit.page} (PDF ${hit.pdfPage}) — ${hit.snippet.slice(0, 140)}`);
    }
    semantic.push(
      `### ${entry.question}\n\n_Asked against \`${entry.source}\`._\n\n` +
      (hits.length
        ? hits.map(hit => `- **${hit.title}**, p. ${hit.page} (PDF ${hit.pdfPage}), score ${hit.score}: ${hit.snippet.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n')
        : '- No results.') +
      '\n',
    );
  }

  const rulesDir = repoRulesDirectory() ?? join(ROOT, 'sources', 'rules');
  const dataDir = rulesDirectory();
  const knownGaps: string[] = [];
  for (const report of reports) {
    if (report.pageProblem) knownGaps.push(`**${report.sourceId}**: ${report.pageProblem}.`);
    if (report.vectorProblem) knownGaps.push(`**${report.sourceId}**: ${report.vectorProblem}.`);
    if (report.imageOnly > report.pages * 0.25) {
      knownGaps.push(`**${report.sourceId}**: ${report.imageOnly}/${report.pages} pages are image-only (maps/art with no usable text).`);
    }
    if (report.queries < 8) {
      knownGaps.push(`**${report.sourceId}**: only ${report.queries} distinctive-phrase queries were possible (${report.skipped ?? 'few text pages'}).`);
    }
    if (report.sourceOnlyHits) {
      knownGaps.push(`**${report.sourceId}**: ${report.sourceOnlyHits} phrase(s) were outranked globally by a more common page but found in the top 3 when the search is restricted to this source.`);
    }
    if (report.misses.length) {
      for (const miss of report.misses) {
        knownGaps.push(`**${report.sourceId}** missed \`${miss.phrase}\` (PDF ${miss.pdf}); top: ${miss.top.join(', ') || 'none'}.`);
      }
    }
  }
  if (!knownGaps.length) knownGaps.push('None found: every PDF page is present, every text page has a vector, and all phrase queries hit.');

  const totalPages = reports.reduce((sum, report) => sum + report.pages, 0);
  const totalOcr = reports.reduce((sum, report) => sum + report.ocr, 0);
  const totalImageOnly = reports.reduce((sum, report) => sum + report.imageOnly, 0);
  const totalChars = reports.reduce((sum, report) => sum + report.characters, 0);
  const totalQueries = reports.reduce((sum, report) => sum + report.queries, 0);
  const totalHits = reports.reduce((sum, report) => sum + report.directHits + report.dedupedHits, 0);
  const totalSourceOnly = reports.reduce((sum, report) => sum + report.sourceOnlyHits, 0);
  const totalReachable = totalHits + totalSourceOnly;

  const table = [
    '| Source | Label | Pages | PDF pages | Characters | OCR | Image-only | Vectors | Strict hybrid | Source-restricted |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...reports.map(report => {
      const strict = report.queries ? `${report.directHits + report.dedupedHits}/${report.queries}` : 'n/a';
      const reachable = report.queries ? `${report.directHits + report.dedupedHits + report.sourceOnlyHits}/${report.queries}` : 'n/a';
      return `| \`${report.sourceId}\` | ${report.label} | ${report.pages} | ${report.pdfPages ?? '?'} | ${report.characters.toLocaleString('en-US')} | ${report.ocr} | ${report.imageOnly} | ${report.vectors} | ${strict} | ${reachable} |`;
    }),
  ].join('\n');

  const ocrNotes = reports
    .filter(report => report.ocr > 0)
    .map(report => {
      const rough = report.label === 'Map' || report.sourceId.includes('campaign-frame');
      return `- **${report.sourceId}**: ${report.ocr} OCR page(s)${rough ? ', mostly map/art labels; the recognizer concatenates place-name words, so use them for lookup rather than prose quotations' : ''}.`;
    });

  const markdown = `# RAG coverage

Generated by \`npx tsx tools/check_rag_coverage.ts\` on ${new Date().toISOString().slice(0, 10)}.
Each row is one installed source: every PDF page must exist in the extracted JSON, every
non-empty page must have an embedding, and eight automatically chosen rare phrases per
source are searched with hybrid \`search_sourcebook\`; the originating page must appear in
the top 3. "Deduped" hits are pages that correctly collapsed into a near-duplicate book page.
A phrase built from common words can be outranked across the whole corpus; the
source-restricted column retries exactly those with \`source\` set, which still runs the
hybrid ranker over that book's pages and separates a weak phrase from a missing page.

- Sources: **${reports.length}**
- Pages: **${totalPages.toLocaleString('en-US')}** (${totalOcr.toLocaleString('en-US')} OCR, ${totalImageOnly.toLocaleString('en-US')} image-only)
- Extracted characters: **${totalChars.toLocaleString('en-US')}**
- Embedding model: \`${embedder.model}\` (${embedder.dim} dimensions)
- Phrase-query strict hit rate (whole corpus): **${totalQueries ? `${totalHits}/${totalQueries} (${Math.round((totalHits / totalQueries) * 100)}%)` : 'n/a'}**
- Phrase-query reachability (retry restricted to the source): **${totalQueries ? `${totalReachable}/${totalQueries} (${Math.round((totalReachable / totalQueries) * 100)}%)` : 'n/a'}**
- Structured catalog: **${catalogCount}/${catalog.length} entries embedded** (${catalogVectorsCount} vectors) in ${(catalogMs / 1000).toFixed(1)}s; ${[...catalogByCategory.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, count]) => `${category} ${count}`).join(', ')}
- \`sources/rules\` JSON size: **${(jsonBytes(rulesDir) / 1024).toFixed(0)} KiB** (data-directory copy: ${(jsonBytes(dataDir) / 1024).toFixed(0)} KiB)

## Per source

${table}

## OCR quality

${ocrNotes.length ? ocrNotes.join('\n') : '- No page required OCR.'}

## Known gaps

${knownGaps.map(gap => '- ' + gap).join('\n')}

## Hand-written semantic queries

${semantic.join('\n')}
`;

  writeFileSync(DOCS, markdown, 'utf8');
  console.log(`\nWrote ${DOCS}`);
  console.log(`Reachable: ${totalQueries ? `${totalReachable}/${totalQueries}` : 'n/a'} (strict ${totalHits}; source-only ${totalSourceOnly}); OCR ${totalOcr}; image-only ${totalImageOnly}.`);

  const structuralProblems = reports.filter(report => report.pageProblem || report.vectorProblem);
  if (structuralProblems.length) process.exitCode = 1;
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
