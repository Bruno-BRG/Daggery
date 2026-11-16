/**
 * Rebuilds the printable Duality Solo Engine from the engine's own tables, then prints it to PDF.
 *   npx tsx tools/build_duality_pdf.ts            (writes the HTML and the PDF)
 *   npx tsx tools/build_duality_pdf.ts --html     (writes the HTML only)
 * Printing needs Microsoft Edge or Google Chrome; set DAGGERY_BROWSER to use another Chromium.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DUALITY_LIKELIHOODS, DUALITY_TABLES } from '../packages/shared/src/duality-engine';

const html = fileURLToPath(new URL('../docs/duality-solo-engine/duality-solo-engine.html', import.meta.url));
const pdf = html.replace(/\.html$/, '.pdf');

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
type Printed = { h: string[]; c: string[][]; n?: string[]; nonum?: boolean };
const printed: Record<string, Printed> = {
  oracle: { h: ['Likelihood', 'Yes on', 'Chance'], nonum: true, c: [
    DUALITY_LIKELIHOODS.map(row => row.label), DUALITY_LIKELIHOODS.map(row => `${row.target}+`), DUALITY_LIKELIHOODS.map(row => row.chance)] },
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

const source = readFileSync(html, 'utf8');
const begin = '// BEGIN TABLES', end = '// END TABLES';
const from = source.indexOf(begin), to = source.indexOf(end);
if (from < 0 || to < from) throw new Error('Table markers not found in the engine HTML');
writeFileSync(html, `${source.slice(0, from + begin.length)}\nconst T = ${JSON.stringify(printed, null, 1)};\n${source.slice(to)}`);
console.log(`Wrote ${html}`);

if (!process.argv.includes('--html')) {
  const browser = [process.env.DAGGERY_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome']
    .find(path => path && existsSync(path));
  if (!browser) throw new Error('No Chromium browser found; set DAGGERY_BROWSER');
  const dom = execFileSync(browser, ['--headless=new', '--disable-gpu', '--dump-dom', pathToFileURL(html).href], { encoding: 'utf8' });
  const overflow = /data-overflow="([^"]*)"/.exec(dom)?.[1];
  if (overflow === undefined) throw new Error('The overflow check did not run');
  if (overflow) throw new Error(`These blocks do not fit their page and would be cut off: ${overflow}`);
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { stdio: 'inherit' });
  console.log(`Wrote ${pdf}`);
}
