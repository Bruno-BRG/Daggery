// Bundle the official class sheets without redrawing or flattening their artwork.
// Keep the core pages first: exportPdf.ts and pdfGuideLayout.json use their source indices.
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const root = new URL('../', import.meta.url);
const sources = [
  ['sources/Character-Sheets-and-Guides-Daggerheart-Aug252026.pdf', 22],
  ['sources/CharacterGuidesAndSheetsTile_HF_2026-07-23.pdf', 9],
];
const bundle = await PDFDocument.create();
for (const [path, expectedPages] of sources) {
  const source = await PDFDocument.load(await readFile(new URL(path, root)));
  if (source.getPageCount() !== expectedPages) throw new Error(`Unexpected page count in ${path}; recheck the class page mappings.`);
  const pages = await bundle.copyPages(source, source.getPageIndices());
  pages.forEach(page => bundle.addPage(page));
}
bundle.setTitle('Original Daggerheart and Hope & Fear character sheets and guides');
await writeFile(new URL('apps/web/src/assets/pdf/original-character-sheets.pdf', root), await bundle.save());
console.log(`Bundled ${bundle.getPageCount()} original pages (core + Hope & Fear).`);
