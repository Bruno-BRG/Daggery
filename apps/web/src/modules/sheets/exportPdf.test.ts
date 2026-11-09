import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFTextField } from 'pdf-lib';
import { createCharacterPdf, characterPdfFilename, DEFAULT_PDF_OPTIONS } from './exportPdf';
import type { Sheet } from './types';

const font = new Uint8Array(readFileSync(new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)));
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

test('export keeps editable fields, visible appearances, derived stats, and values after a PDF edit', async () => {
  const original = structuredClone(sheet);
  const bytes = await createCharacterPdf(sheet, DEFAULT_PDF_OPTIONS, font);
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  assert.equal(form.getTextField('name').getText(), sheet.name);
  assert.equal(form.getTextField('player').getText(), sheet.playerName);
  assert.equal(form.getTextField('hp').getText(), '2 / 7');
  assert.equal(form.getTextField('experience_0').getText(), 'Knows the coast (+2)');
  assert.equal(form.getTextField('weapon_primary_stats').getText(), 'Agility / Melee / 1d8 phy');
  assert.ok(form.getFields().length > 35);
  for (const f of form.getFields()) {
    assert.ok(f instanceof PDFTextField);
    assert.equal(f.isReadOnly(), false);
    assert.ok(f.acroField.getWidgets().every(w => w.getNormalAppearance()));
  }
  form.getTextField('hope').setText('5 / 6');
  const edited = await PDFDocument.load(await doc.save());
  assert.equal(edited.getForm().getTextField('hope').getText(), '5 / 6');
  assert.deepEqual(sheet, original);
});

test('Letter export omits optional private story and abilities and can leave every field blank', async () => {
  const bytes = await createCharacterPdf(sheet, { paper: 'letter', story: false, abilities: false, blank: true }, font);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPage(0).getWidth(), 612);
  assert.equal(doc.getPage(0).getHeight(), 792);
  assert.equal(doc.getPageCount(), 2);
  assert.ok(doc.getForm().getFields().every(f => !(f as PDFTextField).getText()));
});

test('long notes and inventory paginate without losing text or overlapping the footer', async () => {
  const notes = 'A promise to return. '.repeat(900) + 'FINAL_SENTENCE';
  const bytes = await createCharacterPdf({ ...sheet, notes }, { ...DEFAULT_PDF_OPTIONS, abilities: false }, font);
  const doc = await PDFDocument.load(bytes);
  const values = doc.getForm().getFields().filter(f => f.getName().startsWith('detail_')).map(f => (f as PDFTextField).getText() ?? '').join('\n');
  assert.ok(values.includes('FINAL_SENTENCE'));
  assert.ok(values.replace(/\n/g, '').includes(notes));
  assert.ok(doc.getPageCount() > 3);
  for (const f of doc.getForm().getFields()) {
    for (const widget of f.acroField.getWidgets()) {
      const r = widget.getRectangle();
      assert.ok(r.y >= 40, `${f.getName()} overlaps footer`);
      assert.ok(r.x >= 30 && r.x + r.width < 566);
    }
  }
});

test('download filename removes path and control characters', () => {
  assert.equal(characterPdfFilename('../hero:/name?'), '..heroname-sheet.pdf');
  assert.equal(characterPdfFilename('   '), 'character-sheet.pdf');
  assert.equal(characterPdfFilename('João'), 'João-sheet.pdf');
});
