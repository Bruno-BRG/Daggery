import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Sheet } from './types';
import { TRAIT_ORDER, TRAIT_LABELS, getClass, getSubclass, getCommunity, getArmor, getDomainCard, ancestryFeatures, heritageDisplayName, hpMax, stressMax, armorScore, evasion, damageThresholds, weaponForSlot, damageNotation } from './rules';

export interface PdfOptions {
  paper: 'a4' | 'letter';
  story: boolean;
  abilities: boolean;
  blank: boolean;
}
export const DEFAULT_PDF_OPTIONS: PdfOptions = { paper: 'a4', story: true, abilities: true, blank: false };

/** Local AcroForm export. Field values and appearance streams are both saved; never flatten. */
export async function createCharacterPdf(sheet: Sheet, options: PdfOptions, fontBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Full font embedding keeps newly typed characters available when editing after download.
  const font = await pdf.embedFont(fontBytes);
  const form = pdf.getForm();
  const [w, h] = options.paper === 'a4' ? [595.28, 841.89] : [612, 792];
  const margin = 32, gap = 16, width = w - margin * 2;
  const ink = rgb(.12, .14, .16), line = rgb(.65, .67, .69);
  let page: PDFPage;
  let fieldIndex = 0;
  const label = (text: string, x: number, top: number, size = 8) => page.drawText(text, { x, y: h - top - size, size, font, color: ink });
  const section = (text: string, x: number, top: number, size: number) => {
    label(text.toUpperCase(), x, top, 10);
    page.drawLine({ start: { x, y: h - top - 17 }, end: { x: x + size, y: h - top - 17 }, thickness: .7, color: line });
  };
  const newPage = (title: string) => {
    page = pdf.addPage([w, h]);
    label('DAGGERY / DAGGERHEART', margin, 20, 8);
    label(title, margin, 38, 18);
  };
  const field = (name: string, title: string, value: unknown, x: number, top: number, fw: number, height = 24, multiline = false) => {
    if (title) label(title.toUpperCase(), x, top, 7);
    const input = form.createTextField(name);
    input.setText(options.blank ? '' : String(value ?? '').replace(/\u2212/g, '-'));
    if (multiline) input.enableMultiline();
    input.addToPage(page, { x, y: h - top - 12 - height, width: fw, height, font, textColor: ink, borderColor: line, borderWidth: .5, backgroundColor: rgb(1, 1, 1) });
    input.setFontSize(multiline ? 9 : 0);
    return input;
  };
  const cls = getClass(sheet.classId);
  const subclass = getSubclass(sheet.classId, sheet.subclassId);
  const armor = getArmor(sheet.armorId);
  newPage('Character sheet');
  field('name', 'Name', sheet.name, margin, 76, width * .55);
  field('player', 'Player', sheet.playerName, margin + width * .55 + gap, 76, width * .45 - gap);
  const third = (width - gap * 2) / 3;
  field('class', 'Class', cls?.name ?? sheet.classId, margin, 120, third);
  field('subclass', 'Subclass', subclass?.name, margin + third + gap, 120, third);
  field('level', 'Level / Proficiency', `${sheet.level} / ${sheet.proficiency}`, margin + (third + gap) * 2, 120, third);
  field('heritage', 'Heritage', heritageDisplayName(sheet), margin, 164, width / 2 - gap / 2);
  field('community', 'Community', getCommunity(sheet.communityId)?.name, margin + width / 2 + gap / 2, 164, width / 2 - gap / 2);
  const traitWidth = (width - 5 * 8) / 6;
  TRAIT_ORDER.forEach((trait, i) => field(`trait_${trait}`, TRAIT_LABELS[trait], sheet.traits[trait], margin + i * (traitWidth + 8), 212, traitWidth));
  const left = 210, rightX = margin + left + gap, right = width - left - gap;
  section('Damage & health', margin, 267, left);
  const half = (left - 10) / 2;
  field('evasion', 'Evasion', evasion(sheet), margin, 291, half);
  field('armor_score', 'Armor score', armorScore(sheet), margin + half + 10, 291, half);
  const t = damageThresholds(sheet);
  field('major', 'Major threshold', t.major, margin, 335, half);
  field('severe', 'Severe threshold', t.severe, margin + half + 10, 335, half);
  field('hp', 'HP marked / maximum', `${sheet.hpMarked} / ${hpMax(sheet)}`, margin, 379, half);
  field('stress', 'Stress marked / maximum', `${sheet.stressMarked} / ${stressMax(sheet)}`, margin + half + 10, 379, half);
  field('hope', 'Hope / maximum', `${sheet.hope} / 6`, margin, 423, half);
  field('armor_marked', 'Armor slots used', sheet.armorSlotsMarked, margin + half + 10, 423, half);
  section('Experiences', margin, 476, left);
  // Additional Experiences continue in the editable appendix, without truncation.
  for (let i = 0; i < 3; i++) {
    const exp = sheet.experiences[i];
    field(`experience_${i}`, `Experience ${i + 1}`, exp ? `${exp.name} (${exp.modifier >= 0 ? '+' : ''}${exp.modifier})` : '', margin, 499 + i * 44, left);
  }
  field('gold', 'Gold (handfuls)', sheet.gold, margin, 639, left);
  section('Active weapons', rightX, 267, right);
  for (const [i, slot] of (['primary', 'secondary'] as const).entries()) {
    const weapon = weaponForSlot(sheet, slot);
    field(`weapon_${slot}`, `${slot} weapon`, weapon?.name, rightX, 291 + i * 88, right);
    field(`weapon_${slot}_stats`, 'Trait / Range / Damage', weapon ? `${weapon.trait} / ${weapon.range} / ${damageNotation(weapon.damage, sheet.proficiency)} ${weapon.damageType}` : '', rightX, 335 + i * 88, right);
  }
  section('Active armor', rightX, 476, right);
  field('armor', 'Name', armor?.name, rightX, 499, right);
  field('armor_feature', 'Feature', armor?.feature ? `${armor.feature.name}: ${armor.feature.text}` : '', rightX, 543, right, 66, true);
  field('equipment_notes', 'Equipment notes', '', rightX, 633, right, 56, true);

  // Text is split by measured line width and page capacity; long content is never silently cut.
  let top = 76;
  const appendix = (title: string) => { newPage(title); top = 76; };
  const wrap = (value: string) => {
    const lines: string[] = [];
    const widths = new Map<string, number>();
    const measure = (char: string) => {
      if (!widths.has(char)) widths.set(char, font.widthOfTextAtSize(char, 9));
      return widths.get(char)!;
    };
    for (const paragraph of value.replace(/\r/g, '').split('\n')) {
      let current = '';
      let currentWidth = 0;
      for (const char of paragraph) {
        if (current && currentWidth + measure(char) > width - 16) {
          const space = current.lastIndexOf(' ');
          const cut = space > 0 ? space + 1 : current.length;
          lines.push(current.slice(0, cut)); current = current.slice(cut);
          currentWidth = Array.from(current).reduce((sum, c) => sum + measure(c), 0);
        }
        current += char;
        currentWidth += measure(char);
      }
      lines.push(current);
    }
    return lines;
  };
  const block = (title: string, text: string, minHeight = 42) => {
    const lines = wrap(text || '');
    let offset = 0;
    do {
      if (h - top - 50 < 80) appendix('Character details - continued');
      const capacity = Math.max(1, Math.floor((h - top - 80) / 14));
      const part = lines.slice(offset, offset + capacity);
      const height = Math.max(Math.min(minHeight, h - top - 80), part.length * 14 + 12);
      field(`detail_${fieldIndex++}`, title + (offset ? ' (continued)' : ''), part.join('\n'), margin, top, width, height, true);
      top += height + 32;
      offset += part.length;
    } while (offset < lines.length);
  };
  appendix('Equipment & Experiences');
  block('Inventory', sheet.inventory.map(item => `${item.qty} x ${item.name}${item.description ? '\n' + item.description : ''}`).join('\n\n'), 220);
  if (sheet.experiences.length > 3) block('Additional Experiences', sheet.experiences.slice(3).map(e => `${e.name} (${e.modifier >= 0 ? '+' : ''}${e.modifier})`).join('\n'));
  for (const slot of ['primary', 'secondary'] as const) {
    const weapon = weaponForSlot(sheet, slot);
    if (weapon?.feature) block(`${slot} weapon feature`, `${weapon.feature.name}: ${weapon.feature.text}`);
  }
  if (options.abilities) {
    appendix('Features & abilities');
    if (cls?.hopeFeature) block(`Hope - ${cls.hopeFeature.name}`, cls.hopeFeature.text);
    for (const f of cls?.classFeatures ?? []) block(f.name, f.text);
    const subclassFeatures = [...(subclass?.foundation ?? []), ...(sheet.subclassUpgraded >= 1 ? subclass?.specialization ?? [] : []), ...(sheet.subclassUpgraded >= 2 ? subclass?.mastery ?? [] : [])];
    for (const f of subclassFeatures) block(`${subclass?.name} - ${f.name}`, f.text);
    for (const f of ancestryFeatures(sheet)) block(`${f.ancestryName} - ${f.name}`, f.text);
    const community = getCommunity(sheet.communityId);
    for (const f of community?.features ?? []) block(`${community?.name} - ${f.name}`, f.text);
    if (sheet.multiclassId) {
      const other = getClass(sheet.multiclassId);
      const foundation = getSubclass(sheet.multiclassId, sheet.multiclassSubclassId ?? null);
      for (const f of other?.classFeatures ?? []) block(`${other?.name} - ${f.name}`, f.text);
      for (const f of foundation?.foundation ?? []) block(`${foundation?.name} - ${f.name}`, f.text);
    }
    for (const id of sheet.domainCardIds) {
      const card = getDomainCard(id);
      if (card) block(`${sheet.loadoutIds.includes(id) ? 'Active' : 'Vault'} - ${card.name}`, `${card.domain} / Level ${card.level} / ${card.type} / Recall ${card.recallCost}\n${card.text}`);
    }
  }
  if (options.story) {
    appendix('Story & notes');
    for (const answer of sheet.background) block('Background', `${answer.question}\n${answer.answer}`);
    for (const answer of sheet.connections) block('Connection', `${answer.question}\n${answer.answer}`);
    block('Notes', sheet.notes, 220);
  }
  const count = pdf.getPageCount();
  pdf.getPages().forEach((p, i) => {
    p.drawText(`Editable character sheet / Daggery / ${i + 1} of ${count}`, { x: margin, y: 20, size: 7, font, color: ink });
  });
  pdf.setTitle(options.blank ? 'Blank Daggerheart character sheet' : `${sheet.name} - character sheet`);
  pdf.setCreator('Daggery');
  form.updateFieldAppearances(font);
  return pdf.save();
}

export function characterPdfFilename(name: string): string {
  const safe = name.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 100).replace(/[. ]+$/, '');
  return `${safe || 'character'}-sheet.pdf`;
}
