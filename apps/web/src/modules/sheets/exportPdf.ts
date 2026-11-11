import { PDFDocument, PDFHexString, PDFName, TextAlignment, drawCheckMark, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Sheet } from './types';
import guideLayout from './pdfGuideLayout.json';
import hopeGuideLayout from './pdfHopeGuideLayout.json';
import { TRAIT_ORDER, getClass, getSubclass, getCommunity, getArmor, getWeapon, heritageDisplayName, hpMax, stressMax, armorScore, evasion, damageThresholds, weaponForSlot, weaponDamageNotation, traitValue, spellcastTraitName, spellcastTraitValue, weaponModifier } from './rules';

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

/** Copies original vector pages, then adds transparent AcroForm widgets. Never redraw or flatten the source. */
export async function createCharacterPdf(sheet: Sheet, options: PdfOptions, fontBytes: Uint8Array, templateBytes: Uint8Array): Promise<Uint8Array> {
  const source = await PDFDocument.load(templateBytes);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes);
  const form = pdf.getForm();
  const mapping = ORIGINAL_SHEETS[sheet.classId];
  if (!mapping) throw new Error(`No original character sheet is available for class "${sheet.classId}". Choose a supported class before exporting.`);
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
    // Companion state is managed separately from Sheet; these original spaces remain editable blanks.
    field('companion_name', '', 185, 64, 285, 17);
    field('companion_evasion', '', 504, 34, 30, 23, false, true, 16);
    for (let i = 0; i < 5; i++) {
      field(`companion_experience_${i}`, '', 173, 346 + i * 19.665, 194, 16);
      field(`companion_experience_${i}_modifier`, '', 378, 346 + i * 19.665, 32, 16, false, true);
    }
    field('companion_attack', '', 169, 518, 69, 17);
    field('companion_range', '', 242, 518, 90, 17);
    for (let i = 0; i < 4; i++) check(`companion_damage_${[6, 8, 10, 12][i]}`, false, 172.904 + i * 30.496, 555.88, 5.976, 5.976);
    const training = [
      [353.28,550.49],[365.59,550.49],[377.90,550.49],[377.90,581.16],
      [377.90,601.49],[377.93,633.50],[353.28,663.83],[365.59,663.83],[377.90,663.83],
      [353.28,686.50],[365.59,686.50],[377.90,686.50],[377.90,700.67],
      [353.28,748.84],[365.59,748.84],[377.90,748.84],
    ];
    training.forEach(([x,y], i) => check(`companion_training_${i}`, false, x!, y!, 9.13, 9.13));
    check('companion_hope', false, 458.33, 580.97, 10.85, 10.85);
    for (let i = 0; i < 6; i++) check(`companion_stress_${i}`, false, 207.97 + i * 20.146, 656.17 - i * .75, 18.35, 7.03 + i * .75);
  }
  page = pages[0]!;
  if (sheet.classId === 'brawler') {
    // Combo Die is derived from recorded advancement choices; other class resources have no Sheet state.
    const history = sheet.advancementHistory ?? sheet.advancements.map(advancement => ({ level: sheet.level, advancement }));
    const upgrades = Math.min(3, history.filter(entry => entry.advancement === 'combo-die').length);
    [115.30, 146.30, 177.30, 209.30].forEach((x, i) => check(`combo_die_d${[4, 6, 8, 10][i]}`, i === upgrades, x, 649.24, 10.57, 10.58));
  }
  if (sheet.classId === 'warlock') {
    // Do not invent Patron/Favor values that the app does not store; provide editable original spaces.
    field('patron_name', '', 20, 672, 116, 17);
    field('patron_sphere', '', 143, 672, 116, 17);
    for (let i = 0; i < 6; i++) check(`favor_${i}`, false, 54.45 + i * 13, 701.18, 9.22, 9.22);
  }
  if (options.references && mapping.references?.includes(25)) {
    page = pages[inventoryPageCount + (options.guide ? 1 : 0) + mapping.references.indexOf(25)]!;
    [400.89, 431.26, 461.64, 492.02, 522.39, 552.76].forEach((x, i) => check(`martial_focus_${i}`, false, x, 172.44, 12.11, 12.12));
    const stanceTops = [221.09, 245.12, 273.40, 299.34, 365.96, 395.25, 423.53, 451.82, 519.78, 545.72, 567.41, 591.44, 655.66, 679.70, 703.73, 728.26];
    stanceTops.forEach((top, i) => check(`martial_stance_${i}`, false, 325.84, top, 11.34, 11.34));
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
