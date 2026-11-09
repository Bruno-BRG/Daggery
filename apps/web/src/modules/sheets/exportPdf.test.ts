import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFArray, PDFRawStream, PDFName } from 'pdf-lib';
import { createCharacterPdf, characterPdfFilename, DEFAULT_PDF_OPTIONS, ORIGINAL_SHEETS } from './exportPdf';
import type { Sheet } from './types';

const font = new Uint8Array(readFileSync(new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)));
const template = new Uint8Array(readFileSync(new URL('../../assets/pdf/original-character-sheets.pdf', import.meta.url)));
const sheet: Sheet = {
  id: 'pdf-test', name: 'João — Éowyn', playerName: 'Bárbara', level: 1, proficiency: 1,
  classId: 'guardian', subclassId: 'stalwart', ancestryId: 'human', communityId: null,
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 }, traitMarks: [],
  evasionBonus: 0, armorId: 'chainmail-armor', armorSlotsMarked: 1, hpMarked: 2, stressMarked: 1, hope: 3,
  bonusHpSlots: 0, bonusStressSlots: 0, experiences: [{ id: 'e1', name: 'Knows the coast', modifier: 2 }],
  weapons: [{ slot: 'primary', weaponId: 'broadsword' }],
  inventory: [{ id: 'i1', name: 'Rope', kind: 'item', qty: 2, description: 'A long rope.' }],
  gold: 5, domainCardIds: ['i-see-it-coming'], loadoutIds: ['i-see-it-coming'],
  background: [{ question: 'Where are you from?', answer: 'São Paulo' }], connections: [], notes: 'Find the lighthouse.',
  subclassUpgraded: 0, multiclassId: null, advancements: [], createdAt: '', updatedAt: '',
};

test('original Guardian sheet keeps editable values and tracker states after saving', async () => {
  const original = structuredClone(sheet);
  const bytes = await createCharacterPdf(sheet, DEFAULT_PDF_OPTIONS, font, template);
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  assert.equal(form.getTextField('name').getText(), sheet.name);
  assert.equal(form.getTextField('major').getText(), '8');
  assert.equal(form.getTextField('armor_thresholds').getText(), '7 / 15');
  assert.equal(form.getTextField('experience_0').getText(), 'Knows the coast');
  assert.equal(form.getTextField('experience_0_modifier').getText(), '+2');
  assert.equal(form.getTextField('weapon_primary_damage').getText(), '1d8 phy');
  assert.ok(form.getCheckBox('hp_0').isChecked());
  assert.ok(form.getCheckBox('hp_1').isChecked());
  assert.equal(form.getCheckBox('hp_2').isChecked(), false);
  assert.equal(form.getCheckBox('hope_3').isChecked(), false);
  for (const f of form.getFields()) {
    assert.equal(f.isReadOnly(), false);
    assert.ok(f.acroField.getWidgets().every(w => w.getNormalAppearance()));
  }
  form.getTextField('name').setText('Updated hero');
  form.getCheckBox('hope_3').check();
  const edited = await PDFDocument.load(await doc.save());
  assert.equal(edited.getForm().getTextField('name').getText(), 'Updated hero');
  assert.equal(edited.getForm().getCheckBox('hope_3').isChecked(), true);
  assert.deepEqual(sheet, original);
});

const contentBytes = (doc: PDFDocument, index: number) => {
  const contents = doc.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => doc.context.lookup(ref)) : [contents];
  return streams.map(stream => Buffer.from((stream as PDFRawStream).getContents()).toString('base64'));
};

test('every class uses the original source page content and original dimensions', async () => {
  const source = await PDFDocument.load(template);
  for (const [classId, pages] of Object.entries(ORIGINAL_SHEETS)) {
    const bytes = await createCharacterPdf({ ...sheet, classId }, { blank: true, guide: false, references: false }, font, template);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    assert.equal(doc.getPage(0).getWidth(), source.getPage(pages.sheet).getWidth());
    // Copying the source may append an empty stream for form registration. Original streams remain identical.
    const copied = contentBytes(doc, 0);
    for (const stream of contentBytes(source, pages.sheet)) assert.ok(copied.includes(stream), classId);
    for (const f of doc.getForm().getFields()) {
      if (f instanceof PDFTextField) assert.ok(!f.getText());
      if (f instanceof PDFCheckBox) assert.equal(f.isChecked(), false);
    }
  }
});

test('original guide and class reference pages are optional; unknown classes use the source generic sheet', async () => {
  for (const [classId, count] of [['druid', 4], ['ranger', 3], ['guardian', 2], ['custom', 1]] as const) {
    const doc = await PDFDocument.load(await createCharacterPdf({ ...sheet, classId }, DEFAULT_PDF_OPTIONS, font, template));
    assert.equal(doc.getPageCount(), count);
    assert.equal(doc.getPage(0).getWidth(), 612);
    assert.equal(doc.getPage(0).getHeight(), 792);
    if (classId === 'ranger') {
      const form = doc.getForm();
      form.getTextField('companion_name').setText('Moss');
      form.getCheckBox('companion_training_0').check();
      assert.equal(form.getFields().filter(f => f.getName().startsWith('companion_training_')).length, 16);
      const edited = await PDFDocument.load(await doc.save());
      assert.equal(edited.getForm().getTextField('companion_name').getText(), 'Moss');
      assert.ok(edited.getForm().getCheckBox('companion_training_0').isChecked());
    }
  }
});

test('inventory uses individual printed lines and continues extra items on original sheets', async () => {
  const inventory = Array.from({ length: 8 }, (_, i) => ({ ...sheet.inventory[0]!, id: String(i), name: `Item ${i + 1}`, description: 'Full description. '.repeat(300) + 'FINAL_SENTENCE' }));
  const doc = await PDFDocument.load(await createCharacterPdf({ ...sheet, inventory }, DEFAULT_PDF_OPTIONS, font, template));
  assert.equal(doc.getPageCount(), 3);
  const fields = doc.getForm();
  for (let i = 0; i < 8; i++) {
    const field = fields.getTextField(`inventory_${i}`);
    assert.equal(field.getText(), `2 x Item ${i + 1}`);
    const rect = field.acroField.getWidgets()[0]!.getRectangle();
    assert.ok(Math.abs(rect.y - (792 - 489 - (i % 5) * 20.22 - 16)) < .01);
    assert.ok(rect.height <= 16);
    assert.ok(field.acroField.dict.get(PDFName.of('TU')));
  }
  assert.ok(!fields.getFields().some(f => f.getName() === 'inventory'));
});

test('resource widgets match the original drawing bounds and use readable default text sizes', async () => {
  const doc = await PDFDocument.load(await createCharacterPdf(sheet, DEFAULT_PDF_OPTIONS, font, template));
  const form = doc.getForm();
  const bounds = (name: string) => form.getField(name).acroField.getWidgets()[0]!.getRectangle();
  for (const [name, x, top, width, height] of [
    ['hope_5',217.19,302.3,14.4,14.4], ['hp_11',243.50,230.59,15.29,7.64],
    ['stress_0',62.86,252.65,13.45,7.64], ['stress_11',244.54,252.65,13.45,7.64],
    ['proficiency_5',496.72,172.5,8.92,8.92], ['gold_handful_8',115.18,513.32,7.69,7.69],
  ] as const) {
    const rect = bounds(name);
    assert.ok(Math.abs(rect.x-x)<.02,name);
    assert.ok(Math.abs(rect.y-(792-top-height))<.02,name);
    assert.ok(Math.abs(rect.width-width)<.02,name);
  }
  assert.match(form.getTextField('name').acroField.getDefaultAppearance() ?? '', /10 Tf/);
  assert.match(form.getTextField('trait_agility').acroField.getDefaultAppearance() ?? '', /16 Tf/);
});

test('level-up guide boxes are editable and reflect advancement history including double-slot choices', async () => {
  const advanced = { ...sheet, level: 6, advancementHistory: [
    { level: 2, advancement: 'hp' }, { level: 2, advancement: 'traits' },
    { level: 5, advancement: 'proficiency' }, { level: 6, advancement: 'subclass' },
  ] };
  for (const classId of ['guardian','warrior']) {
    const doc = await PDFDocument.load(await createCharacterPdf({ ...advanced,classId }, DEFAULT_PDF_OPTIONS, font, template));
    const form = doc.getForm();
    assert.equal(form.getFields().filter(f => f.getName().startsWith('advance_')).length,40);
    for (const name of ['advance_2_hp_0','advance_2_traits_0','advance_3_proficiency_0','advance_3_proficiency_1','advance_3_subclass_0']) assert.ok(form.getCheckBox(name).isChecked(),name);
    const widget = form.getCheckBox('advance_2_traits_0').acroField.getWidgets()[0]!.getRectangle();
    assert.ok(Math.abs(widget.x-(classId==='warrior'?15.59:24.10))<.02);
    form.getCheckBox('advance_2_traits_1').check();
    const edited = await PDFDocument.load(await doc.save());
    assert.ok(edited.getForm().getCheckBox('advance_2_traits_1').isChecked());
  }
});

test('download filename removes path and control characters', () => {
  assert.equal(characterPdfFilename('../hero:/name?'), '..heroname-sheet.pdf');
  assert.equal(characterPdfFilename('   '), 'character-sheet.pdf');
  assert.equal(characterPdfFilename('João'), 'João-sheet.pdf');
});
