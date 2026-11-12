import { PDFDocument, PDFHexString, PDFName, TextAlignment, drawCheckMark, rgb, type PDFFont, type PDFForm, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Sheet } from './types';
import guideLayout from './pdfGuideLayout.json';
import hopeGuideLayout from './pdfHopeGuideLayout.json';
import { TRAIT_ORDER, getClass, getSubclass, getCommunity, getArmor, getWeapon, heritageDisplayName, hpMax, stressMax, armorScore, evasion, damageThresholds, weaponForSlot, weaponDamageNotation, traitValue, spellcastTraitName, spellcastTraitValue, weaponModifier, classResourceDefinitions, classResourceValue, classResourceFacts, MARTIAL_STANCES } from './rules';

type ResourceDefinition = ReturnType<typeof classResourceDefinitions>[number];

export interface PdfOptions { blank: boolean; guide: boolean; references: boolean }
export const DEFAULT_PDF_OPTIONS: PdfOptions = { blank: false, guide: true, references: true };
// Zero-based indices in the original-page bundle: 22 core pages, then 9 Hope & Fear pages.
export const ORIGINAL_SHEETS: Record<string, { sheet: number; guide: number; references?: number[] }> = {
  assassin: { sheet: 22, guide: 23 }, brawler: { sheet: 24, guide: 26, references: [25] },
  warlock: { sheet: 27, guide: 28 }, witch: { sheet: 29, guide: 30 },
  bard: { sheet: 0, guide: 1 }, druid: { sheet: 2, guide: 5, references: [3, 4] },
  guardian: { sheet: 6, guide: 7 }, ranger: { sheet: 8, guide: 10, references: [9] },
  rogue: { sheet: 11, guide: 12 }, seraph: { sheet: 13, guide: 14 },
  sorcerer: { sheet: 15, guide: 16 }, warrior: { sheet: 17, guide: 18 }, wizard: { sheet: 19, guide: 20 },
};

export interface ClassResourceAppendixRow {
  id: string;
  label: string;
  value: string;
  detail?: string;
}

const resourceIsPersisted = (sheet: Sheet, id: string): boolean => {
  const resources = sheet.resources;
  if (!resources) return false;
  if (resources.classResources && Object.prototype.hasOwnProperty.call(resources.classResources, id)) return true;
  if (id === 'ranger-focus') return resources.focusTargetId != null;
  if (id === 'seraph-prayer-dice') return (resources.prayerDice?.length ?? 0) > 0;
  return false;
};

/**
 * True when a resource available to this character is actually recorded. A leftover key from a
 * previously chosen class is not enough to append a page of defaults for the new class.
 */
export function hasClassResourceState(sheet: Sheet): boolean {
  return classResourceDefinitions(sheet).some(definition => resourceIsPersisted(sheet, definition.id));
}

const optionLabel = (definition: ResourceDefinition, id: string): string =>
  definition.options?.find(option => option.id === id)?.label
  ?? (definition.classId === 'brawler' ? MARTIAL_STANCES.find(stance => stance.id === id)?.label : undefined)
  ?? id;

/** Human-readable value: labels (never raw option ids), dice faces and counter maximums. */
const resourceDisplayValue = (definition: ResourceDefinition, value: unknown): string => {
  if (definition.kind === 'counter') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? (definition.max != null ? `${numeric} / ${definition.max}` : String(numeric)) : String(value ?? '');
  }
  if (definition.kind === 'toggle') return value === true ? 'Marked' : 'Not marked';
  if (definition.kind === 'dice') {
    const faces = Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];
    return faces.length > 0 ? faces.join(', ') : 'None';
  }
  if (definition.kind === 'list') {
    // Free-text targets (for example a marked adversary) are already labels, not option ids.
    const entries = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
    return entries.length > 0 ? entries.map(String).join(', ') : 'None';
  }
  if (definition.kind === 'selection') {
    const entries = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
    return entries.length > 0 ? entries.map(entry => optionLabel(definition, String(entry))).join(', ') : 'None';
  }
  if (definition.kind === 'choice') return value == null || value === '' ? 'None' : optionLabel(definition, String(value));
  return value == null ? '' : String(value);
};

const resourceValueIsEmpty = (definition: ResourceDefinition, value: unknown): boolean => {
  if (definition.kind === 'toggle') return false;
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false;
};

/** Keep rule text out of the page; only a concise reminder and the reset rule are printed. */
const resourceDetail = (definition: ResourceDefinition, persisted: boolean): string | undefined => {
  if (!persisted) return undefined;
  const parts: string[] = [];
  if (typeof definition.help === 'string') {
    const help = definition.help.trim().replace(/\s+/g, ' ');
    if (help && help.length <= 90) parts.push(help);
  }
  if (definition.reset === 'scene') parts.push('Resets when the scene ends');
  else if (definition.reset === 'session') parts.push('Resets each session');
  else if (definition.reset === 'rest') parts.push('Resets after a rest');
  else if (definition.reset === 'longRest') parts.push('Resets after a long rest');
  return parts.length > 0 ? parts.join(' · ') : undefined;
};

/**
 * Rows for the supplemental "Class resources" page. Definitions are limited to the current class
 * and its multiclass so stale resources from a previously chosen class can never leak.
 */
export function classResourceAppendixRows(sheet: Sheet): ClassResourceAppendixRow[] {
  if (!hasClassResourceState(sheet)) return [];
  const definitions = classResourceDefinitions(sheet).filter(definition =>
    definition.classId === sheet.classId || (sheet.multiclassId != null && definition.classId === sheet.multiclassId));
  const rows: ClassResourceAppendixRow[] = [];
  const seenLabels = new Set<string>();
  for (const definition of definitions) {
    const persisted = resourceIsPersisted(sheet, definition.id);
    let value: unknown = classResourceValue(sheet, definition.id);
    if (value == null) value = definition.defaultValue;
    if (!persisted && resourceValueIsEmpty(definition, value)) continue;
    rows.push({ id: definition.id, label: definition.label, value: resourceDisplayValue(definition, value) || '—', detail: resourceDetail(definition, persisted) });
    seenLabels.add(definition.label);
  }
  for (const fact of classResourceFacts(sheet)) {
    if (!fact?.label || !fact.value || seenLabels.has(fact.label)) continue;
    rows.push({ id: `fact:${fact.label}`, label: fact.label, value: fact.value });
  }
  return rows;
}

const wrapLines = (font: PDFFont, text: string, size: number, maxWidth: number): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(''); continue; }
    let line = '';
    for (let word of words) {
      // Break a word that is wider than the column rather than clipping it.
      while (font.widthOfTextAtSize(word, size) > maxWidth && word.length > 1) {
        let split = 1;
        while (split < word.length && font.widthOfTextAtSize(word.slice(0, split + 1), size) <= maxWidth) split++;
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, split));
        word = word.slice(split);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
};

/** Draws the readable folio page after the original pages. Values are transparent, still-editable 10pt fields. */
function drawClassResourceAppendix(pdf: PDFDocument, form: PDFForm, font: PDFFont, sheet: Sheet, rows: ClassResourceAppendixRow[]): void {
  const width = 612;
  const height = 792;
  const margin = 54;
  const bottom = 68;
  const ink = rgb(.08, .09, .1);
  const faded = rgb(.38, .39, .4);
  const rule = rgb(.58, .58, .6);
  const labelWidth = 158;
  const valueX = margin + labelWidth + 18;
  const valueWidth = width - margin - valueX;
  const usedNames = new Set<string>();
  let page!: PDFPage;
  let y = 0;
  const drawValueLine = (id: string, text: string, lineIndex: number, baseline: number) => {
    if (!text) return;
    let name = `appendix_${id.replace(/[^A-Za-z0-9_-]/g, '_')}_${lineIndex}`;
    while (usedNames.has(name)) name += '_';
    usedNames.add(name);
    const input = form.createTextField(name);
    input.setText(text);
    input.addToPage(page, { x: valueX, y: baseline - 3.2, width: valueWidth, height: 13.6, font,
      textColor: ink, borderWidth: 0, backgroundColor: undefined, borderColor: undefined });
    input.setFontSize(10);
    input.updateAppearances(font);
  };
  const newPage = (continued: boolean) => {
    page = pdf.addPage([width, height]);
    page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderColor: rule, borderWidth: .6 });
    page.drawText('DAGGERY', { x: margin, y: height - 76, size: 8, font, color: faded });
    page.drawText(continued ? 'Class resources (continued)' : 'Class resources', { x: margin, y: height - 104, size: 18, font, color: ink });
    page.drawLine({ start: { x: margin, y: height - 116 }, end: { x: width - margin, y: height - 116 }, thickness: .7, color: rule });
    y = height - 144;
    const nameLines = wrapLines(font, sheet.name || (continued ? '' : 'Unnamed character'), continued ? 9.5 : 11.5, width - margin * 2);
    for (const line of nameLines) {
      page.drawText(line, { x: margin, y, size: continued ? 9.5 : 11.5, font, color: continued ? faded : ink });
      y -= continued ? 13 : 15;
    }
    if (!continued) {
      const classLine = [getClass(sheet.classId)?.name ?? sheet.classId, getSubclass(sheet.classId, sheet.subclassId)?.name].filter(Boolean).join(' · ');
      const multiclass = sheet.multiclassId ? getClass(sheet.multiclassId)?.name ?? sheet.multiclassId : null;
      for (const line of wrapLines(font, multiclass ? `${classLine}   ·   Multiclass: ${multiclass}` : classLine, 9.5, width - margin * 2)) {
        page.drawText(line, { x: margin, y, size: 9.5, font, color: faded });
        y -= 13;
      }
      y -= 12;
    } else {
      y -= 8;
    }
  };
  newPage(false);
  for (const row of rows) {
    const labelLines = wrapLines(font, row.label, 10.5, labelWidth);
    const valueLines = wrapLines(font, row.value, 10, valueWidth);
    const detailLines = row.detail ? wrapLines(font, row.detail, 9, valueWidth) : [];
    const needed = Math.max(labelLines.length, valueLines.length) * 13.5 + detailLines.length * 11.5 + 24;
    if (y - Math.min(needed, 60) < bottom + 8) newPage(true);
    page.drawLine({ start: { x: margin, y: y + 7 }, end: { x: width - margin, y: y + 7 }, thickness: .35, color: rule });
    y -= 3;
    let labelIndex = 0;
    let valueIndex = 0;
    while (labelIndex < labelLines.length || valueIndex < valueLines.length) {
      if (y < bottom) newPage(true);
      if (labelIndex < labelLines.length) { page.drawText(labelLines[labelIndex]!, { x: margin, y, size: 10.5, font, color: ink }); labelIndex++; }
      if (valueIndex < valueLines.length) { drawValueLine(row.id, valueLines[valueIndex]!, valueIndex, y); valueIndex++; }
      y -= 13.5;
    }
    for (const detail of detailLines) {
      if (y < bottom) newPage(true);
      page.drawText(detail, { x: valueX, y, size: 9, font, color: faded });
      y -= 11.5;
    }
    y -= 7;
  }
}

/** Copies original vector pages, then adds transparent AcroForm widgets. Never redraw or flatten the source. */
export async function createCharacterPdf(sheet: Sheet, options: PdfOptions, fontBytes: Uint8Array, templateBytes: Uint8Array): Promise<Uint8Array> {
  const source = await PDFDocument.load(templateBytes);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes);
  const form = pdf.getForm();
  const mapping = ORIGINAL_SHEETS[sheet.classId];
  if (!mapping) throw new Error(`No original character sheet is available for class "${sheet.classId}". Choose a supported class before exporting.`);
  // Persisted class resources, with each definition's starting value as the legacy fallback.
  const resourceDefinitions = classResourceDefinitions(sheet);
  const definitionById = new Map(resourceDefinitions.map(definition => [definition.id, definition]));
  const resourceValue = (id: string): unknown => {
    const value = classResourceValue(sheet, id);
    return value == null ? definitionById.get(id)?.defaultValue : value;
  };
  const indices = [mapping.sheet];
  const inventoryPageCount = options.blank ? 1 : Math.max(1, Math.ceil(sheet.inventory.filter(item => item.qty > 0).length / 5));
  for (let i = 1; i < inventoryPageCount; i++) indices.push(mapping.sheet);
  if (options.guide && mapping) indices.push(mapping.guide);
  if (options.references && mapping?.references) indices.push(...mapping.references);
  const pages = await pdf.copyPages(source, indices);
  pages.forEach(page => pdf.addPage(page));
  let page: PDFPage = pages[0]!;
  const ink = rgb(.08, .09, .1);
  const field = (name: string, value: unknown, x: number, top: number, width: number, height: number, multiline = false, centered = false, fontSize = multiline ? 8.5 : 10) => {
    const input = form.createTextField(name);
    const text = options.blank ? '' : String(value ?? '').replace(/\u2212/g, '-');
    // A fixed-size original form displays only its opening lines. Avoid laying out megabytes
    // of invisible overflow, while retaining the complete value for scrolling/editing in a reader.
    input.setText(multiline ? text.slice(0, 1200) : text);
    if (multiline) input.enableMultiline();
    if (centered) input.setAlignment(TextAlignment.Center);
    input.addToPage(page, { x, y: page.getHeight() - top - height, width, height, font,
      textColor: ink, borderWidth: 0, backgroundColor: undefined, borderColor: undefined });
    // Fit ordinary long labels without making print smaller than 7pt. The full value stays editable.
    const fittedSize = !multiline && text ? Math.max(7, Math.min(fontSize, fontSize * (width - 4) / Math.max(1, font.widthOfTextAtSize(text, fontSize)))) : fontSize;
    input.setFontSize(fittedSize);
    input.updateAppearances(font);
    if (multiline && text.length > 1200) input.acroField.setValue(PDFHexString.fromText(text));
    return input;
  };
  const check = (name: string, checked: boolean, x: number, top: number, width: number, height: number) => {
    const input = form.createCheckBox(name);
    input.addToPage(page, { x, y: page.getHeight() - top - height, width, height,
      borderWidth: 0, backgroundColor: undefined, borderColor: undefined, textColor: ink });
    if (!options.blank && checked) input.check();
    input.updateAppearances((_field, widget) => {
      const rect = widget.getRectangle();
      const on = drawCheckMark({ x: rect.width / 2, y: rect.height / 2, size: Math.min(rect.width, rect.height) * .8, thickness: .9, color: ink });
      return { normal: { on, off: [] }, down: { on, off: [] } };
    });
  };
  field('name', sheet.name, 233, 10, 160, 14);
  field('pronouns', '', 440, 10, 89, 14);
  field('heritage', [heritageDisplayName(sheet), getCommunity(sheet.communityId)?.name].filter(Boolean).join(' / '), 236, 30, 125, 14);
  const subclass = getSubclass(sheet.classId, sheet.subclassId);
  const secondarySubclass = getSubclass(sheet.multiclassId, sheet.multiclassSubclassId);
  field('subclass', [subclass?.name, sheet.multiclassId ? `${getClass(sheet.multiclassId)?.name ?? sheet.multiclassId}${secondarySubclass ? `: ${secondarySubclass.name}` : ''}` : ''].filter(Boolean).join(' / '), 409, 30, 120, 14);
  field('level', sheet.level, 557, 20, 28, 25, false, true, 18);
  TRAIT_ORDER.forEach((trait, i) => {
    field(`trait_${trait}`, traitValue(sheet, trait), 209 + i * 67.2, 83, 33, 24, false, true, 16);
    const markerX = [247.93, 316.23, 382.66, 449.29, 517.59, 584.03][i]!;
    check(`trait_mark_${trait}`, sheet.traitMarks.includes(trait), markerX, 66.9, 12.74, 12.74);
  });
  field('evasion', evasion(sheet), 27, 90, 24, 23, false, true, 16);
  field('armor_score', armorScore(sheet), 91, 90, 27, 23, false, true, 16);
  // The source's armor icons are a 3-column / 4-row tracker.
  for (let i = 0; i < 12; i++) check(`armor_slot_${i}`, i < sheet.armorSlotsMarked, 135.94 + (i % 3) * 13.07, 78.95 + Math.floor(i / 3) * 14.38, 10.31, 11.53);
  const thresholds = damageThresholds(sheet);
  field('major', thresholds.major, 84, 191, 22, 18, false, true);
  field('severe', thresholds.severe, 171, 191, 22, 18, false, true);
  for (let i = 0; i < 12; i++) {
    check(`hp_${i}`, i < sheet.hpMarked, 36.96 + i * 18.776, 230.59, 15.29, 7.64);
    check(`stress_${i}`, i < sheet.stressMarked, 62.86 + i * 16.516, 252.65, 13.45, 7.64);
  }
  // Keep numeric totals visible in print, including capacities beyond the twelve printed slots.
  field('resource_totals', `HP ${sheet.hpMarked}/${hpMax(sheet)} marked | Stress ${sheet.stressMarked}/${stressMax(sheet)} marked | Armor ${sheet.armorSlotsMarked}/${armorScore(sheet)} used`, 28, 240, 230, 10, false, false, 7);
  // Tooltips also expose the totals to readers that support form hints.
  if (!options.blank) {
    form.getCheckBox('hp_0').acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(`HP marked: ${sheet.hpMarked}; maximum: ${hpMax(sheet)}`));
    form.getCheckBox('stress_0').acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(`Stress marked: ${sheet.stressMarked}; maximum: ${stressMax(sheet)}`));
  }
  for (let i = 0; i < 6; i++) check(`hope_${i}`, i < sheet.hope, 39.86 + i * 35.466, 302.3, 14.4, 14.4);
  for (let i = 0; i < 6; i++) check(`proficiency_${i}`, i < sheet.proficiency, 439.51 + i * 11.442, 172.5, 8.92, 8.92);
  const castingTrait = spellcastTraitName(sheet);
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;
  field('spellcast', castingTrait ? `Spellcast: ${castingTrait} ${signed(spellcastTraitValue(sheet))}` : '', 415, 184, 175, 9, false, false, 7.5);
  for (let i = 0; i < 5; i++) {
    const exp = sheet.experiences[i];
    field(`experience_${i}`, exp?.name, 22, 381 + i * 19.4, 193, 15);
    field(`experience_${i}_modifier`, exp ? `${exp.modifier >= 0 ? '+' : ''}${exp.modifier}` : '', 225, 381 + i * 19.4, 26, 15, false, true);
  }
  // Original gold tracks: ten handfuls per bag, ten bags per chest.
  const handfulX = [15.47, 27.8, 40.14, 52.73, 65.06, 77.92, 90.25, 102.58, 115.18];
  for (let i = 0; i < 9; i++) {
    check(`gold_handful_${i}`, i < sheet.gold % 10, handfulX[i]!, 513.32, 7.69, 7.69);
    check(`gold_bag_${i}`, i < Math.floor(sheet.gold / 10) % 10, 133.81 + i * 11.253, 510.7, 10.2, 12.83);
  }
  field('gold_chests', Math.floor(sheet.gold / 100) || '', 244, 511, 12, 12, false, true);
  const weaponFields = (prefix: string, weapon: ReturnType<typeof weaponForSlot>, row: number) => {
    field(`${prefix}_name`, weapon?.name, 295, row, 115, 17);
    field(`${prefix}_trait`, weapon ? `${weapon.trait} ${signed(weaponModifier(sheet, weapon))} / ${weapon.range}` : '', 416, row, 90, 17);
    field(`${prefix}_damage`, weapon ? `${weaponDamageNotation(sheet, weapon)} ${weapon.damageType}` : '', 513, row, 78, 17);
    field(`${prefix}_feature`, weapon?.feature ? `${weapon.feature.name}: ${weapon.feature.text}` : '', 298, row + 30, 292, 17, false, false, 8.5);
  };
  weaponFields('weapon_primary', weaponForSlot(sheet, 'primary'), 193);
  weaponFields('weapon_secondary', weaponForSlot(sheet, 'secondary'), 286);
  const armor = getArmor(sheet.armorId, sheet);
  field('armor_name', armor?.name, 295, 391, 151, 17);
  field('armor_thresholds', armor ? `${armor.baseThresholds.major} / ${armor.baseThresholds.severe}` : '', 454, 391, 69, 17, false, true);
  field('armor_base_score', armor?.baseScore, 539, 391, 49, 17, false, true);
  field('armor_feature', armor?.feature ? `${armor.feature.name}: ${armor.feature.text}` : '', 298, 421, 292, 17, false, false, 8.5);
  // Each ruled line is a separate field. Extra items keep the same original class artwork.
  const inventoryItems = sheet.inventory.filter(item => item.qty > 0);
  for (let inventoryPage = 0; inventoryPage < inventoryPageCount; inventoryPage++) {
    page = pages[inventoryPage]!;
    if (inventoryPage > 0) field(`inventory_page_${inventoryPage}_name`, sheet.name, 233, 10, 160, 14);
    for (let row = 0; row < 5; row++) {
      const index = inventoryPage * 5 + row;
      const item = inventoryItems[index];
      const input = field(`inventory_${index}`, item ? `${item.qty} x ${item.name}` : '', 294, 489 + row * 20.22, 296, 16);
      if (item?.description && !options.blank) input.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(item.description));
    }
  }
  page = pages[0]!;
  const stowed = sheet.inventory.filter(item => item.kind === 'weapon' && item.qty > 0);
  for (let i = 0; i < 2; i++) {
    const item = stowed[i];
    const weapon = getWeapon(item?.equipmentId ?? item?.catalogId ?? null, sheet);
    weaponFields(`inventory_weapon_${i}`, weapon, 614 + i * 90.5);
    check(`inventory_weapon_${i}_primary`, weapon?.category === 'Primary', 499.107, 606.6 + i * 90.539, 7.164, 7.164);
    check(`inventory_weapon_${i}_secondary`, weapon?.category === 'Secondary', 548.995, 606.6 + i * 90.539, 7.164, 7.164);
  }
  if (options.guide && mapping) {
    page = pages[inventoryPageCount]!;
    // Most guides have an 8.504pt bleed around the original Letter artwork; Warrior does not.
    const offset = (page.getWidth() - 612) / 2;
    const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cls = getClass(sheet.classId);
    const backgrounds = cls?.backgroundQuestions ?? [];
    const connections = cls?.connections ?? [];
    for (let i = 0; i < 3; i++) {
      const answer = sheet.background.find(a => normalized(a.question) === normalized(backgrounds[i] ?? ''));
      const connection = sheet.connections.find(a => normalized(a.question) === normalized(connections[i] ?? ''));
      field(`background_${i}`, answer?.answer, 32 + offset, 281 + i * 54 + offset, 265, 31, true);
      field(`connection_${i}`, connection?.answer, 332 + offset, 281 + i * 54 + offset, 255, 31, true);
    }
    const layouts = mapping.guide >= 22 ? hopeGuideLayout : guideLayout;
    const layoutKey = mapping.guide >= 22 ? mapping.guide - 22 : mapping.guide;
    const layout = (layouts as Record<string, { tier: number; option: string; slot: number; rect: number[] }[]>)[String(layoutKey)]!;
    const marked = new Set<string>();
    const history = sheet.advancementHistory ?? sheet.advancements.map(advancement => ({ level: sheet.level, advancement }));
    for (const entry of [...history].sort((a, b) => a.level - b.level)) {
      const tier = entry.level < 5 ? 2 : entry.level < 8 ? 3 : 4;
      const available = layout.filter(box => box.option === entry.advancement && box.tier <= tier && !marked.has(`${box.tier}_${box.option}_${box.slot}`));
      const chosen = available.slice(0, ['multiclass', 'proficiency'].includes(entry.advancement) ? 2 : 1);
      chosen.forEach(box => marked.add(`${box.tier}_${box.option}_${box.slot}`));
    }
    for (const box of layout) {
      const key = `${box.tier}_${box.option}_${box.slot}`;
      const [x, y, right, bottom] = box.rect as [number, number, number, number];
      check(`advance_${key}`, marked.has(key), x, y, right - x, bottom - y);
    }
  }
  if (options.references && mapping?.references?.includes(9)) {
    page = pages[inventoryPageCount + (options.guide ? 1 : 0) + mapping.references.indexOf(9)]!;
    // Companion trackers belong to the Beastbound subclass; other Rangers keep the original spaces blank.
    const beastbound = sheet.classId === 'ranger' && sheet.subclassId === 'beastbound';
    // Only recorded companion state fills the native spaces; printed defaults stay editable blanks.
    const companionValue = (id: string): unknown => beastbound && resourceIsPersisted(sheet, id) ? resourceValue(id) : undefined;
    const companionText = (id: string) => { const value = companionValue(id); return typeof value === 'string' ? value : ''; };
    const companionNumber = (id: string) => { const value = Number(companionValue(id)); return Number.isFinite(value) ? Math.trunc(value) : 0; };
    field('companion_name', companionText('ranger-companion-name'), 185, 64, 285, 17);
    field('companion_evasion', companionNumber('ranger-companion-evasion') || '', 504, 34, 30, 23, false, true, 16);
    const experiences = companionValue('ranger-companion-experiences');
    const experienceNames = Array.isArray(experiences) ? experiences.map(String) : [];
    for (let i = 0; i < 5; i++) {
      field(`companion_experience_${i}`, experienceNames[i], 173, 346 + i * 19.665, 194, 16);
      // The companion sheet lets the player write each modifier by hand.
      field(`companion_experience_${i}_modifier`, '', 378, 346 + i * 19.665, 32, 16, false, true);
    }
    field('companion_attack', companionText('ranger-companion-attack'), 169, 518, 69, 17);
    field('companion_range', companionText('ranger-companion-range'), 242, 518, 90, 17);
    for (let i = 0; i < 4; i++) check(`companion_damage_${[6, 8, 10, 12][i]}`, false, 172.904 + i * 30.496, 555.88, 5.976, 5.976);
    const training = [
      [353.28,550.49],[365.59,550.49],[377.90,550.49],[377.90,581.16],
      [377.90,601.49],[377.93,633.50],[353.28,663.83],[365.59,663.83],[377.90,663.83],
      [353.28,686.50],[365.59,686.50],[377.90,686.50],[377.90,700.67],
      [353.28,748.84],[365.59,748.84],[377.90,748.84],
    ];
    // Each printed training box has its own option id, in native companion-sheet order.
    const trainingOptions = definitionById.get('ranger-companion-training')?.options ?? [];
    const trainingValue = companionValue('ranger-companion-training');
    const trained = new Set(Array.isArray(trainingValue) ? trainingValue.map(String) : []);
    training.forEach(([x,y], i) => {
      const option = trainingOptions.length === training.length ? trainingOptions[i] : undefined;
      check(`companion_training_${i}`, option ? trained.has(option.id) : false, x!, y!, 9.13, 9.13);
    });
    check('companion_hope', false, 458.33, 580.97, 10.85, 10.85);
    const stress = Math.max(0, Math.min(6, companionNumber('ranger-companion-stress')));
    for (let i = 0; i < 6; i++) check(`companion_stress_${i}`, i < stress, 207.97 + i * 20.146, 656.17 - i * .75, 18.35, 7.03 + i * .75);
  }
  page = pages[0]!;
  if (sheet.classId === 'brawler') {
    // Combo Die is derived from recorded advancement choices; other class resources have no Sheet state.
    const history = sheet.advancementHistory ?? sheet.advancements.map(advancement => ({ level: sheet.level, advancement }));
    const upgrades = Math.min(3, history.filter(entry => entry.advancement === 'combo-die').length);
    [115.30, 146.30, 177.30, 209.30].forEach((x, i) => check(`combo_die_d${[4, 6, 8, 10][i]}`, i === upgrades, x, 649.24, 10.57, 10.58));
  }
  if (sheet.classId === 'warlock') {
    const patron = resourceValue('warlock-patron');
    const sphere = resourceValue('warlock-sphere');
    // Favor begins at 3 by rule, including legacy sheets with no stored resources.
    const rawFavor = Number(resourceValue('warlock-favor'));
    const favor = Number.isFinite(rawFavor) ? Math.max(0, Math.min(6, Math.trunc(rawFavor))) : 3;
    field('patron_name', typeof patron === 'string' ? patron : '', 20, 672, 116, 17);
    field('patron_sphere', typeof sphere === 'string' ? sphere : '', 143, 672, 116, 17);
    for (let i = 0; i < 6; i++) check(`favor_${i}`, i < favor, 54.45 + i * 13, 701.18, 9.22, 9.22);
  }
  if (options.references && mapping.references?.includes(25)) {
    page = pages[inventoryPageCount + (options.guide ? 1 : 0) + mapping.references.indexOf(25)]!;
    // Focus and known stances belong to the Martial Artist subclass; other Brawlers keep the spaces blank.
    const martialArtist = sheet.classId === 'brawler' && sheet.subclassId === 'martial-artist';
    const rawFocus = Number(resourceValue('brawler-focus'));
    const focus = martialArtist && Number.isFinite(rawFocus) ? Math.max(0, Math.min(6, Math.trunc(rawFocus))) : 0;
    [400.89, 431.26, 461.64, 492.02, 522.39, 552.76].forEach((x, i) => check(`martial_focus_${i}`, i < focus, x, 172.44, 12.11, 12.12));
    const stanceTops = [221.09, 245.12, 273.40, 299.34, 365.96, 395.25, 423.53, 451.82, 519.78, 545.72, 567.41, 591.44, 655.66, 679.70, 703.73, 728.26];
    const knownStances = resourceValue('brawler-stances');
    const known = new Set(Array.isArray(knownStances) ? knownStances.map(String) : []);
    // The printed sheet lists every stance; definitions.options is tier-filtered, so use the printed order.
    stanceTops.forEach((top, i) => check(`martial_stance_${i}`, martialArtist && known.has(MARTIAL_STANCES[i]?.id ?? ''), 325.84, top, 11.34, 11.34));
  }
  if (!options.blank && hasClassResourceState(sheet)) {
    const rows = classResourceAppendixRows(sheet);
    if (rows.length > 0) drawClassResourceAppendix(pdf, form, font, sheet, rows);
  }
  pdf.setTitle(options.blank ? 'Original Daggerheart character sheet' : `${sheet.name} - original character sheet`);
  pdf.setCreator('Daggery');
  form.updateFieldAppearances(font);
  return pdf.save();
}

export function characterPdfFilename(name: string): string {
  const safe = name.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 100).replace(/[. ]+$/, '');
  return `${safe || 'character'}-sheet.pdf`;
}
