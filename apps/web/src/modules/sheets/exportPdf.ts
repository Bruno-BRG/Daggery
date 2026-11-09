import { PDFDocument, PDFHexString, PDFName, TextAlignment, drawCheckMark, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Sheet } from './types';
import { TRAIT_ORDER, getClass, getSubclass, getCommunity, getArmor, getWeapon, heritageDisplayName, hpMax, stressMax, armorScore, evasion, damageThresholds, weaponForSlot, damageNotation } from './rules';

export interface PdfOptions { blank: boolean; guide: boolean; references: boolean }
export const DEFAULT_PDF_OPTIONS: PdfOptions = { blank: false, guide: true, references: true };
// Zero-based page indices in the unmodified source PDF, including its class guides.
export const ORIGINAL_SHEETS: Record<string, { sheet: number; guide: number; references?: number[] }> = {
  bard: { sheet: 0, guide: 1 }, druid: { sheet: 2, guide: 5, references: [3, 4] },
  guardian: { sheet: 6, guide: 7 }, ranger: { sheet: 8, guide: 10, references: [9] },
  rogue: { sheet: 11, guide: 12 }, seraph: { sheet: 13, guide: 14 },
  sorcerer: { sheet: 15, guide: 16 }, warrior: { sheet: 17, guide: 18 }, wizard: { sheet: 19, guide: 20 },
};

/** Copies original vector pages, then adds transparent AcroForm widgets. Never redraw or flatten the source. */
export async function createCharacterPdf(sheet: Sheet, options: PdfOptions, fontBytes: Uint8Array, templateBytes: Uint8Array): Promise<Uint8Array> {
  const source = await PDFDocument.load(templateBytes);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes);
  const form = pdf.getForm();
  const mapping = ORIGINAL_SHEETS[sheet.classId];
  const indices = [mapping?.sheet ?? 21];
  if (options.guide && mapping) indices.push(mapping.guide);
  if (options.references && mapping?.references) indices.push(...mapping.references);
  const pages = await pdf.copyPages(source, indices);
  pages.forEach(page => pdf.addPage(page));
  let page: PDFPage = pages[0]!;
  const ink = rgb(.08, .09, .1);
  const field = (name: string, value: unknown, x: number, top: number, width: number, height: number, multiline = false, centered = false) => {
    const input = form.createTextField(name);
    const text = options.blank ? '' : String(value ?? '').replace(/\u2212/g, '-');
    // A fixed-size original form displays only its opening lines. Avoid laying out megabytes
    // of invisible overflow, while retaining the complete value for scrolling/editing in a reader.
    input.setText(multiline ? text.slice(0, 1200) : text);
    if (multiline) input.enableMultiline();
    if (centered) input.setAlignment(TextAlignment.Center);
    input.addToPage(page, { x, y: page.getHeight() - top - height, width, height, font,
      textColor: ink, borderWidth: 0, backgroundColor: undefined, borderColor: undefined });
    input.setFontSize(multiline ? 7 : 0);
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
  field('subclass', mapping ? subclass?.name : `${getClass(sheet.classId)?.name ?? sheet.classId} / ${subclass?.name ?? ''}`, 409, 30, 120, 14);
  field('level', sheet.level, 557, 20, 28, 25, false, true);
  TRAIT_ORDER.forEach((trait, i) => {
    field(`trait_${trait}`, sheet.traits[trait], 209 + i * 67.2, 83, 33, 24, false, true);
    check(`trait_mark_${trait}`, sheet.traitMarks.includes(trait), 249 + i * 67.2, 68, 10, 10);
  });
  field('evasion', evasion(sheet), 27, 90, 24, 23, false, true);
  field('armor_score', armorScore(sheet), 91, 90, 27, 23, false, true);
  // The source's armor icons are a 3-column / 4-row tracker.
  for (let i = 0; i < 12; i++) check(`armor_slot_${i}`, i < sheet.armorSlotsMarked, 137 + (i % 3) * 12.6, 80 + Math.floor(i / 3) * 14.4, 7, 9);
  const thresholds = damageThresholds(sheet);
  field('major', thresholds.major, 84, 191, 22, 18, false, true);
  field('severe', thresholds.severe, 171, 191, 22, 18, false, true);
  for (let i = 0; i < 12; i++) {
    check(`hp_${i}`, i < sheet.hpMarked, 38 + i * 16.8, 231, 12, 6);
    check(`stress_${i}`, i < sheet.stressMarked, 38 + i * 16.8, 253, 12, 6);
  }
  // Tooltips retain maximums without changing any original labels or artwork.
  form.getCheckBox('hp_0').acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(`HP marked: ${sheet.hpMarked}; maximum: ${hpMax(sheet)}`));
  form.getCheckBox('stress_0').acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(`Stress marked: ${sheet.stressMarked}; maximum: ${stressMax(sheet)}`));
  for (let i = 0; i < 6; i++) check(`hope_${i}`, i < sheet.hope, 43 + i * 35.6, 305, 8, 8);
  for (let i = 0; i < 6; i++) check(`proficiency_${i}`, i < sheet.proficiency, 439 + i * 11.2, 174, 7, 7);
  for (let i = 0; i < 5; i++) {
    const exp = sheet.experiences[i];
    field(`experience_${i}`, exp?.name, 22, 381 + i * 19.4, 193, 15);
    field(`experience_${i}_modifier`, exp ? `${exp.modifier >= 0 ? '+' : ''}${exp.modifier}` : '', 225, 381 + i * 19.4, 26, 15, false, true);
  }
  // Original gold tracks: ten handfuls per bag, ten bags per chest.
  for (let i = 0; i < 10; i++) {
    check(`gold_handful_${i}`, i < sheet.gold % 10, 17 + i * 11.05, 514, 7, 7);
    check(`gold_bag_${i}`, i < Math.floor(sheet.gold / 10) % 10, 137 + i * 10.4, 514, 7, 7);
  }
  field('gold_chests', Math.floor(sheet.gold / 100) || '', 244, 511, 12, 12, false, true);
  const weaponFields = (prefix: string, weapon: ReturnType<typeof weaponForSlot>, row: number) => {
    field(`${prefix}_name`, weapon?.name, 295, row, 115, 17);
    field(`${prefix}_trait`, weapon ? `${weapon.trait} / ${weapon.range}` : '', 416, row, 90, 17);
    field(`${prefix}_damage`, weapon ? `${damageNotation(weapon.damage, sheet.proficiency)} ${weapon.damageType}` : '', 513, row, 78, 17);
    field(`${prefix}_feature`, weapon?.feature ? `${weapon.feature.name}: ${weapon.feature.text}` : '', 298, row + 30, 292, 14);
  };
  weaponFields('weapon_primary', weaponForSlot(sheet, 'primary'), 193);
  weaponFields('weapon_secondary', weaponForSlot(sheet, 'secondary'), 286);
  const armor = getArmor(sheet.armorId);
  field('armor_name', armor?.name, 295, 391, 151, 17);
  field('armor_thresholds', armor ? `${armor.baseThresholds.major} / ${armor.baseThresholds.severe}` : '', 454, 391, 69, 17, false, true);
  field('armor_base_score', armor?.baseScore, 539, 391, 49, 17, false, true);
  field('armor_feature', armor?.feature ? `${armor.feature.name}: ${armor.feature.text}` : '', 298, 421, 292, 14);
  // Keep full inventory text editable even when it exceeds the original's fixed space.
  field('inventory', sheet.inventory.map(item => `${item.qty} x ${item.name}${item.description ? ': ' + item.description : ''}`).join('\n'), 293, 493, 298, 99, true);
  const stowed = sheet.inventory.filter(item => item.kind === 'weapon');
  for (let i = 0; i < 2; i++) {
    const item = stowed[i];
    const weapon = getWeapon(item?.equipmentId ?? item?.catalogId ?? null);
    weaponFields(`inventory_weapon_${i}`, weapon, 614 + i * 90.5);
  }
  if (!mapping) {
    const cls = getClass(sheet.classId);
    field('hope_feature', cls?.hopeFeature ? `${cls.hopeFeature.name}: ${cls.hopeFeature.text}` : '', 23, 326, 230, 23, true);
    field('class_feature', cls?.classFeatures.map(f => `${f.name}: ${f.text}`).join('\n\n'), 23, 566, 230, 187, true);
  }
  if (options.guide && mapping) {
    page = pages[1]!;
    // Most guides have an 8.504pt bleed around the original Letter artwork; Warrior does not.
    const offset = (page.getWidth() - 612) / 2;
    const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cls = getClass(sheet.classId);
    const backgrounds = cls?.backgroundQuestions ?? [];
    const connections = cls?.connections ?? [];
    for (let i = 0; i < 3; i++) {
      const answer = sheet.background.find(a => normalized(a.question) === normalized(backgrounds[i] ?? ''));
      const connection = sheet.connections.find(a => normalized(a.question) === normalized(connections[i] ?? ''));
      field(`background_${i}`, answer?.answer, 32 + offset, 282 + i * 54 + offset, 265, 28, true);
      field(`connection_${i}`, connection?.answer, 332 + offset, 282 + i * 54 + offset, 255, 28, true);
    }
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
