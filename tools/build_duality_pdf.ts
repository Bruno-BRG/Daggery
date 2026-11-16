/**
 * Rebuilds the printable Duality GME references from the engine's own tables, then prints them to PDF.
 *   npx tsx tools/build_duality_pdf.ts                    (manual and quick reference: HTML and PDF)
 *   npx tsx tools/build_duality_pdf.ts duality-gme        (one engine, by file name)
 *   npx tsx tools/build_duality_pdf.ts --html             (HTML only)
 * References: duality-gme and the Duality GME manual duality-gme-manual
 * (docs/duality-solo-engine/<name>.html).
 * Each template keeps `// BEGIN TABLES` and `// END TABLES` markers; between them this writes
 * `const T` (every table, by id) and `const M` (the Duality GME moves). The build fails when a
 * template marks a block that would be cut off (`data-overflow` on the body).
 * Printing needs Microsoft Edge or Google Chrome; set DAGGERY_BROWSER to use another Chromium.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DUALITY_TABLES } from '../packages/shared/src/duality-engine';
import { IRON_LIKELIHOODS, IRON_MOVE_GROUPS, IRON_MOVES, IRON_RANKS } from '../packages/shared/src/duality-variants';

const ENGINES = ['duality-gme', 'duality-gme-manual'];
const folder = new URL('../docs/duality-solo-engine/', import.meta.url);

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
type Printed = { h: string[]; c: string[][]; n?: string[]; nonum?: boolean };
const printed: Record<string, Printed> = {
  'iron-oracle': { h: ['Likelihood', 'Yes on', 'Chance'], nonum: true, c: [
    IRON_LIKELIHOODS.map(row => row.label), IRON_LIKELIHOODS.map(row => `${row.target}+`), IRON_LIKELIHOODS.map(row => row.chance)] },
  'iron-ranks': { h: ['Rank', 'Mark progress', 'Difficulty'], nonum: true, c: [
    IRON_RANKS.map(row => row.label), IRON_RANKS.map(row => row.mark), IRON_RANKS.map(row => String(row.difficulty))] },
};
for (const table of DUALITY_TABLES) {
  const single = table.columns.length === 1;
  const entries = table.columns.map(column => column.entries.map(escape));
  const header = single ? [table.title] : table.columns.map(column => column.label);
  // A one-column table with repeated rows prints as ranges (1-3, 4-5, ...).
  if (single && new Set(entries[0]).size < 12) {
    const rows: string[] = [], nums: string[] = [];
    entries[0]!.forEach((entry, index) => {
      if (rows.at(-1) === entry) { nums[nums.length - 1] = `${nums.at(-1)!.split('-')[0]}-${index + 1}`; return; }
      rows.push(entry); nums.push(String(index + 1));
    });
    printed[table.id] = { h: header, c: [rows], n: nums };
  } else printed[table.id] = { h: header, c: entries };
}
/** Moves by group: `M[group] = { label, moves: [{ id, name, trigger, roll?, strong?, weak?, miss?, text? }] }`. */
const moves = Object.fromEntries(IRON_MOVE_GROUPS.map(group => [group.id, {
  label: group.label,
  moves: IRON_MOVES.filter(move => move.group === group.id).map(({ group: _group, ...move }) =>
    Object.fromEntries(Object.entries(move).map(([key, value]) => [key, escape(value)]))),
}]));

const wanted = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const browser = [process.env.DAGGERY_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(path => path && existsSync(path));

for (const name of wanted.length ? wanted : ENGINES) {
  if (!ENGINES.includes(name)) throw new Error(`Unknown engine ${name}`);
  const html = fileURLToPath(new URL(`${name}.html`, folder)), pdf = html.replace(/\.html$/, '.pdf');
  if (!existsSync(html)) { console.log(`Skipped ${name}: no template yet`); continue; }
  const source = readFileSync(html, 'utf8');
  const begin = '// BEGIN TABLES', end = '// END TABLES';
  const from = source.indexOf(begin), to = source.indexOf(end);
  if (from < 0 || to < from) throw new Error(`Table markers not found in ${name}.html`);
  writeFileSync(html, `${source.slice(0, from + begin.length)}\nconst T = ${JSON.stringify(printed, null, 1)};\nconst M = ${JSON.stringify(moves, null, 1)};\n${source.slice(to)}`);
  console.log(`Wrote ${html}`);
  if (process.argv.includes('--html')) continue;
  if (!browser) throw new Error('No Chromium browser found; set DAGGERY_BROWSER');
  const dom = execFileSync(browser, ['--headless=new', '--disable-gpu', '--dump-dom', pathToFileURL(html).href], { encoding: 'utf8' });
  const overflow = /data-overflow="([^"]*)"/.exec(dom)?.[1];
  if (overflow === undefined) throw new Error(`The overflow check did not run in ${name}.html`);
  if (overflow) throw new Error(`${name}: these blocks do not fit their page and would be cut off: ${overflow}`);
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { stdio: 'inherit' });
  console.log(`Wrote ${pdf}`);
}
