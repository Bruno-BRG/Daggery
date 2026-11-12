import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFArray, PDFRawStream, PDFName } from 'pdf-lib';
import { createCharacterPdf, characterPdfFilename, DEFAULT_PDF_OPTIONS, ORIGINAL_SHEETS, classResourceAppendixRows, hasClassResourceState } from './exportPdf';
import type { Sheet } from './types';
import { MARTIAL_STANCES } from './rules';
import { classes } from '@daggery/content';

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

test('original guide and class reference pages are optional; unknown classes are rejected', async () => {
  for (const [classId, count] of [['druid', 4], ['ranger', 3], ['guardian', 2]] as const) {
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
  await assert.rejects(
    () => createCharacterPdf({ ...sheet, classId: 'custom' }, DEFAULT_PDF_OPTIONS, font, template),
    (error: unknown) => error instanceof Error && /custom/i.test(error.message) && /class/i.test(error.message),
  );
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

test('inventory continuation pages keep the class original sheet artwork', async () => {
  const source = await PDFDocument.load(template);
  const inventory = Array.from({ length: 8 }, (_, i) => ({ ...sheet.inventory[0]!, id: String(i), name: `Item ${i + 1}` }));
  const doc = await PDFDocument.load(await createCharacterPdf({ ...sheet, classId: 'guardian', inventory }, { blank: false, guide: false, references: false }, font, template));
  assert.equal(doc.getPageCount(), 2);
  const copied = contentBytes(doc, 1);
  for (const stream of contentBytes(source, ORIGINAL_SHEETS.guardian!.sheet)) assert.ok(copied.includes(stream));
  assert.equal(doc.getForm().getTextField('inventory_5').getText(), '2 x Item 6');
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

test('bundled pages preserve both original source PDFs, including all guides and references', async () => {
  const bundle = await PDFDocument.load(template);
  let offset = 0;
  for (const filename of ['Character-Sheets-and-Guides-Daggerheart-Aug252026.pdf', 'CharacterGuidesAndSheetsTile_HF_2026-07-23.pdf']) {
    const original = await PDFDocument.load(readFileSync(new URL(`../../../../../sources/${filename}`, import.meta.url)));
    for (let i = 0; i < original.getPageCount(); i++) {
      assert.deepEqual(bundle.getPage(offset + i).getSize(), original.getPage(i).getSize());
      assert.deepEqual(contentBytes(bundle, offset + i), contentBytes(original, i));
    }
    offset += original.getPageCount();
  }
  assert.equal(bundle.getPageCount(), offset);
});

test('computed spellcast, attack modifiers and resource totals stay visible as editable fields', async () => {
  const doc = await PDFDocument.load(await createCharacterPdf({ ...sheet, classId: 'bard', subclassId: 'troubadour', traits: { ...sheet.traits, presence: 3 } }, DEFAULT_PDF_OPTIONS, font, template));
  const form = doc.getForm();
  assert.equal(form.getTextField('spellcast').getText(), 'Spellcast: presence +3');
  assert.equal(form.getTextField('weapon_primary_trait').getText(), 'Agility +2 / Melee');
  assert.match(form.getTextField('resource_totals').getText() ?? '', /^HP 2\/\d+ marked \| Stress 1\/\d+ marked \| Armor 1\/4 used$/);
});

test('Hope & Fear resource spaces stay editable and legacy Warlock Favor starts at three', async () => {
  const brawler = await PDFDocument.load(await createCharacterPdf({ ...sheet, classId: 'brawler', subclassId: 'juggernaut', advancementHistory: [{ level: 3, advancement: 'combo-die' }] }, DEFAULT_PDF_OPTIONS, font, template));
  const form = brawler.getForm();
  assert.ok(form.getCheckBox('combo_die_d6').isChecked());
  assert.equal(form.getCheckBox('combo_die_d4').isChecked(), false);
  assert.equal(form.getFields().filter(f => f.getName().startsWith('martial_stance_')).length, 16);
  form.getCheckBox('martial_stance_15').check();
  form.getCheckBox('martial_focus_5').check();
  const reopened = (await PDFDocument.load(await brawler.save())).getForm();
  assert.ok(reopened.getCheckBox('martial_stance_15').isChecked());
  assert.ok(reopened.getCheckBox('martial_focus_5').isChecked());
  const warlock = await PDFDocument.load(await createCharacterPdf({ ...sheet, classId: 'warlock' }, DEFAULT_PDF_OPTIONS, font, template));
  assert.equal(warlock.getForm().getTextField('patron_name').getText(), undefined);
  // Favor begins at 3 by rule even for sheets that predate resource storage.
  assert.ok(warlock.getForm().getCheckBox('favor_0').isChecked());
  assert.ok(warlock.getForm().getCheckBox('favor_1').isChecked());
  assert.ok(warlock.getForm().getCheckBox('favor_2').isChecked());
  assert.equal(warlock.getForm().getCheckBox('favor_3').isChecked(), false);
  warlock.getForm().getTextField('patron_name').setText('The Lantern');
  warlock.getForm().getCheckBox('favor_2').check();
  const saved = (await PDFDocument.load(await warlock.save())).getForm();
  assert.equal(saved.getTextField('patron_name').getText(), 'The Lantern');
  assert.ok(saved.getCheckBox('favor_2').isChecked());
});

test('download filename removes path and control characters', () => {
  assert.equal(characterPdfFilename('../hero:/name?'), '..heroname-sheet.pdf');
  assert.equal(characterPdfFilename('   '), 'character-sheet.pdf');
  assert.equal(characterPdfFilename('João'), 'João-sheet.pdf');
});

test('every known class, including Hope & Fear classes, has an original sheet mapping', () => {
  assert.deepEqual(Object.keys(ORIGINAL_SHEETS).sort(), classes.map(entry => entry.id).sort());
  assert.deepEqual(ORIGINAL_SHEETS.assassin, { sheet: 22, guide: 23 });
  assert.deepEqual(ORIGINAL_SHEETS.brawler, { sheet: 24, guide: 26, references: [25] });
  assert.deepEqual(ORIGINAL_SHEETS.warlock, { sheet: 27, guide: 28 });
  assert.deepEqual(ORIGINAL_SHEETS.witch, { sheet: 29, guide: 30 });
});

test('Hope & Fear class sheets, class references and guides copy their original source pages', async () => {
  const source = await PDFDocument.load(template);
  for (const [classId, count, reference] of [['assassin', 2, null], ['brawler', 3, 25], ['warlock', 2, null], ['witch', 2, null]] as const) {
    const doc = await PDFDocument.load(await createCharacterPdf({ ...sheet, classId }, DEFAULT_PDF_OPTIONS, font, template));
    assert.equal(doc.getPageCount(), count, classId);
    if (reference !== null) {
      const copied = contentBytes(doc, count - 1);
      for (const stream of contentBytes(source, reference)) assert.ok(copied.includes(stream), classId);
    }
  }
});

test('Hope & Fear level-up guides expose their original advancement boxes', async () => {
  const advanced = { ...sheet, level: 6, advancementHistory: [{ level: 2, advancement: 'hp' }, { level: 5, advancement: 'proficiency' }] };
  for (const [classId, count] of [['assassin', 40], ['warlock', 40], ['witch', 40], ['brawler', 43]] as const) {
    const doc = await PDFDocument.load(await createCharacterPdf({ ...advanced, classId }, DEFAULT_PDF_OPTIONS, font, template));
    const advance = doc.getForm().getFields().filter(f => f.getName().startsWith('advance_'));
    assert.equal(advance.length, count, classId);
  }
});

test('Brawler combo-die advancements mark their original guide box', async () => {
  const advanced = { ...sheet, classId: 'brawler', level: 6, advancementHistory: [{ level: 5, advancement: 'combo-die' }] };
  const doc = await PDFDocument.load(await createCharacterPdf(advanced, DEFAULT_PDF_OPTIONS, font, template));
  const checked = doc.getForm().getFields()
    .filter(f => f.getName().startsWith('advance_') && f instanceof PDFCheckBox && f.isChecked())
    .map(f => f.getName());
  assert.ok(checked.some(name => name.includes('combo-die')), checked.join(','));
});

test('exported traits include worn gear modifiers', async () => {
  const doc = await PDFDocument.load(await createCharacterPdf({ ...sheet, armorId: 'full-plate-armor' }, DEFAULT_PDF_OPTIONS, font, template));
  const form = doc.getForm();
  assert.equal(form.getTextField('trait_agility').getText(), '1');
  assert.equal(form.getTextField('trait_strength').getText(), '1');
});

test('blank exports keep one inventory page and never expose maximums through hidden tooltips', async () => {
  const inventory = Array.from({ length: 8 }, (_, i) => ({ ...sheet.inventory[0]!, id: String(i), name: `Item ${i + 1}` }));
  const doc = await PDFDocument.load(await createCharacterPdf({ ...sheet, inventory }, { blank: true, guide: false, references: false }, font, template));
  assert.equal(doc.getPageCount(), 1);
  const form = doc.getForm();
  assert.ok(!form.getFields().some(f => f.getName().startsWith('inventory_5')));
  for (const name of ['hp_0', 'stress_0']) {
    assert.equal(form.getCheckBox(name).acroField.dict.get(PDFName.of('TU')), undefined, name);
  }
});

test('long single-line values shrink with a readable minimum and preserve the full value', async () => {
  const longName = 'W'.repeat(20);
  const doc = await PDFDocument.load(await createCharacterPdf({ ...sheet, name: longName }, DEFAULT_PDF_OPTIONS, font, template));
  const field = doc.getForm().getTextField('name');
  assert.equal(field.getText(), longName);
  const size = Number(/(\d+(?:\.\d+)?) Tf/.exec(field.acroField.getDefaultAppearance() ?? '')?.[1]);
  assert.ok(size >= 7 && size < 10, `expected 7 <= ${size} < 10`);
});

test('Warlock stored patron, sphere and Favor prefill the original spaces and the appendix', async () => {
  const warlock: Sheet = {
    ...sheet, classId: 'warlock', subclassId: 'pact-of-the-endless',
    resources: { classResources: { 'warlock-patron': 'The Lantern', 'warlock-sphere': 'Embers', 'warlock-favor': 2 } },
  };
  assert.ok(hasClassResourceState(warlock));
  const rows = classResourceAppendixRows(warlock);
  assert.equal(rows.find(row => row.id === 'warlock-patron')?.value, 'The Lantern');
  assert.equal(rows.find(row => row.id === 'warlock-sphere')?.value, 'Embers');
  assert.match(rows.find(row => row.id === 'warlock-favor')?.value ?? '', /^2 \/ 6$/);
  assert.ok(rows.every(row => row.label !== row.id));
  const doc = await PDFDocument.load(await createCharacterPdf(warlock, DEFAULT_PDF_OPTIONS, font, template));
  const form = doc.getForm();
  assert.equal(form.getTextField('patron_name').getText(), 'The Lantern');
  assert.equal(form.getTextField('patron_sphere').getText(), 'Embers');
  assert.ok(form.getCheckBox('favor_0').isChecked());
  assert.ok(form.getCheckBox('favor_1').isChecked());
  assert.equal(form.getCheckBox('favor_2').isChecked(), false);
  assert.equal(doc.getPageCount(), 3); // original sheet + guide + supplemental page
  // The appendix stays editable in the downloaded PDF.
  assert.equal(form.getTextField('appendix_warlock-patron_0').getText(), 'The Lantern');
  assert.equal(form.getTextField('appendix_warlock-sphere_0').getText(), 'Embers');
  assert.match(form.getTextField('appendix_warlock-favor_0').getText() ?? '', /^2 \/ 6$/);
  assert.equal(form.getTextField('appendix_warlock-patron_0').isReadOnly(), false);
});

test('legacy Warlock Favor starts at three without an appendix', async () => {
  const warlock: Sheet = { ...sheet, classId: 'warlock', subclassId: 'pact-of-the-wrathful' };
  assert.equal(hasClassResourceState(warlock), false);
  assert.deepEqual(classResourceAppendixRows(warlock), []);
  const doc = await PDFDocument.load(await createCharacterPdf(warlock, DEFAULT_PDF_OPTIONS, font, template));
  assert.equal(doc.getPageCount(), 2);
  const form = doc.getForm();
  for (let i = 0; i < 3; i++) assert.ok(form.getCheckBox(`favor_${i}`).isChecked(), `favor_${i}`);
  assert.equal(form.getCheckBox('favor_3').isChecked(), false);
});

test('Brawler Focus and known stances prefill only for Martial Artist, using printed stance order', async () => {
  assert.ok(MARTIAL_STANCES.length >= 16);
  const first = MARTIAL_STANCES[0]!;
  const second = MARTIAL_STANCES[1]!;
  const third = MARTIAL_STANCES[2]!;
  const state = {
    classResources: {
      'brawler-focus': 2,
      'brawler-stances': [first.id, second.id],
      'brawler-active-stance': second.id,
      'brawler-focus-used': true,
    },
  };
  const martial: Sheet = { ...sheet, classId: 'brawler', subclassId: 'martial-artist', resources: state };
  const doc = await PDFDocument.load(await createCharacterPdf(martial, DEFAULT_PDF_OPTIONS, font, template));
  const form = doc.getForm();
  assert.ok(form.getCheckBox('martial_focus_0').isChecked());
  assert.ok(form.getCheckBox('martial_focus_1').isChecked());
  assert.equal(form.getCheckBox('martial_focus_2').isChecked(), false);
  assert.ok(form.getCheckBox('martial_stance_0').isChecked());
  assert.ok(form.getCheckBox('martial_stance_1').isChecked());
  assert.equal(form.getCheckBox('martial_stance_2').isChecked(), false);
  assert.equal(doc.getPageCount(), 4); // brawler sheet + reference + guide + appendix
  const rows = classResourceAppendixRows(martial);
  const stances = rows.find(row => row.id === 'brawler-stances');
  assert.ok(stances?.value.includes(first.label), stances?.value);
  assert.ok(stances?.value.includes(second.label));
  assert.ok(!stances?.value.includes(third.id));
  assert.equal(rows.find(row => row.id === 'brawler-active-stance')?.value, second.label);
  assert.ok(rows.some(row => row.id === 'brawler-focus-used'));

  const juggernaut: Sheet = { ...martial, subclassId: 'juggernaut' };
  const juggernautDoc = await PDFDocument.load(await createCharacterPdf(juggernaut, DEFAULT_PDF_OPTIONS, font, template));
  const juggernautForm = juggernautDoc.getForm();
  assert.equal(juggernautForm.getCheckBox('martial_focus_0').isChecked(), false);
  assert.equal(juggernautForm.getCheckBox('martial_stance_0').isChecked(), false);
  // Martial Artist definitions are unavailable to another subclass, so the persisted trackers do not resurface.
  assert.ok(!classResourceAppendixRows(juggernaut).some(row => row.id === 'brawler-focus'));
});

test('Prayer Dice and Ranger Focus aliases append the page, filtered to current and multiclass classes', async () => {
  const seraph: Sheet = { ...sheet, classId: 'seraph', subclassId: null, resources: { prayerDice: [4, 2] } };
  assert.ok(hasClassResourceState(seraph));
  const prayer = classResourceAppendixRows(seraph).find(row => row.id === 'seraph-prayer-dice');
  assert.equal(prayer?.value, '4, 2');
  const seraphDoc = await PDFDocument.load(await createCharacterPdf(seraph, DEFAULT_PDF_OPTIONS, font, template));
  assert.equal(seraphDoc.getPageCount(), 3); // sheet + guide + appendix

  const ranger: Sheet = { ...sheet, classId: 'ranger', subclassId: null, resources: { focusTargetId: 'adversary-archer' } };
  const rangerDoc = await PDFDocument.load(await createCharacterPdf(ranger, DEFAULT_PDF_OPTIONS, font, template));
  assert.equal(rangerDoc.getPageCount(), 4); // sheet + companion + guide + appendix
  assert.ok(classResourceAppendixRows(ranger).some(row => row.id === 'ranger-focus'));

  const guardian: Sheet = {
    ...sheet, classId: 'guardian', multiclassId: 'seraph',
    resources: { prayerDice: [3], classResources: { 'witch-phase': 2 } },
  };
  const rows = classResourceAppendixRows(guardian);
  assert.ok(rows.some(row => row.id === 'seraph-prayer-dice'));
  assert.ok(!rows.some(row => row.id.startsWith('witch-')));
  const guardianDoc = await PDFDocument.load(await createCharacterPdf(guardian, DEFAULT_PDF_OPTIONS, font, template));
  assert.equal(guardianDoc.getPageCount(), 3); // guardian sheet + guide + appendix
});

test('Beastbound companion resources fill the original companion page while invalid subclasses stay blank', async () => {
  const beastbound: Sheet = {
    ...sheet, classId: 'ranger', subclassId: 'beastbound',
    resources: { classResources: {
      'ranger-companion-name': 'Moss', 'ranger-companion-evasion': 12,
      'ranger-companion-stress': 2, 'ranger-companion-attack': 'Bite', 'ranger-companion-range': 'Melee',
      'ranger-companion-experiences': ['Tracker', 'Guard dog'],
      'ranger-companion-training': ['intelligent', 'aware', 'aware-3'],
    } },
  };
  const doc = await PDFDocument.load(await createCharacterPdf(beastbound, DEFAULT_PDF_OPTIONS, font, template));
  const form = doc.getForm();
  assert.equal(form.getTextField('companion_name').getText(), 'Moss');
  assert.equal(form.getTextField('companion_evasion').getText(), '12');
  assert.equal(form.getTextField('companion_attack').getText(), 'Bite');
  assert.equal(form.getTextField('companion_range').getText(), 'Melee');
  assert.equal(form.getTextField('companion_experience_0').getText(), 'Tracker');
  assert.equal(form.getTextField('companion_experience_1').getText(), 'Guard dog');
  assert.ok(!form.getTextField('companion_experience_0_modifier').getText());
  assert.ok(form.getCheckBox('companion_stress_0').isChecked());
  assert.ok(form.getCheckBox('companion_stress_1').isChecked());
  assert.equal(form.getCheckBox('companion_stress_2').isChecked(), false);
  // Each stored training option maps directly to its printed box.
  assert.ok(form.getCheckBox('companion_training_0').isChecked());
  assert.equal(form.getCheckBox('companion_training_3').isChecked(), false);
  assert.ok(form.getCheckBox('companion_training_13').isChecked());
  assert.equal(form.getCheckBox('companion_training_14').isChecked(), false);
  assert.ok(form.getCheckBox('companion_training_15').isChecked());

  // The fixture uses the Guardian subclass with a Ranger class id; it must not receive companion data.
  const invalid = await PDFDocument.load(await createCharacterPdf({ ...sheet, classId: 'ranger', subclassId: 'stalwart' }, DEFAULT_PDF_OPTIONS, font, template));
  assert.ok(!invalid.getForm().getTextField('companion_name').getText());
  assert.equal(invalid.getForm().getCheckBox('companion_stress_0').isChecked(), false);
});

test('blank exports never include class resources, their appendix or their values', async () => {
  const warlock: Sheet = {
    ...sheet, classId: 'warlock', subclassId: 'pact-of-the-endless',
    resources: { classResources: { 'warlock-patron': 'Secret Patron', 'warlock-favor': 5 } },
  };
  const doc = await PDFDocument.load(await createCharacterPdf(warlock, { blank: true, guide: false, references: false }, font, template));
  assert.equal(doc.getPageCount(), 1);
  const form = doc.getForm();
  assert.ok(!form.getTextField('patron_name').getText());
  assert.equal(form.getCheckBox('favor_0').isChecked(), false);
  for (const field of form.getFields()) {
    if (field instanceof PDFTextField) assert.ok(!(field.getText() ?? '').includes('Secret Patron'));
    if (field instanceof PDFCheckBox) assert.equal(field.isChecked(), false);
  }
});

test('stale resource keys from another class never append an appendix of unrelated defaults', async () => {
  const guardian: Sheet = {
    ...sheet, classId: 'guardian', subclassId: 'stalwart',
    resources: { classResources: { 'witch-phase': 2, 'brawler-focus': 1 } },
  };
  assert.equal(hasClassResourceState(guardian), false);
  assert.deepEqual(classResourceAppendixRows(guardian), []);
  const doc = await PDFDocument.load(await createCharacterPdf(guardian, DEFAULT_PDF_OPTIONS, font, template));
  assert.equal(doc.getPageCount(), 2);
  assert.ok(!doc.getForm().getFields().some(field => field.getName().startsWith('appendix_')));
});

test('page counts stay unchanged for every class when no resource state exists', async () => {
  for (const [classId, count] of [['guardian', 2], ['ranger', 3], ['druid', 4], ['brawler', 3], ['warlock', 2], ['seraph', 2]] as const) {
    const doc = await PDFDocument.load(await createCharacterPdf({ ...sheet, classId, subclassId: null }, DEFAULT_PDF_OPTIONS, font, template));
    assert.equal(doc.getPageCount(), count, classId);
  }
});

test('long appendix values wrap across pages without truncation and survive save/reopen', async () => {
  const longPatron = 'Patron of the endless lanterns and forgotten names. '.repeat(40).trim();
  const warlock: Sheet = {
    ...sheet, classId: 'warlock', subclassId: 'pact-of-the-endless',
    resources: { classResources: { 'warlock-patron': longPatron, 'warlock-favor': 4 } },
  };
  assert.equal(classResourceAppendixRows(warlock).find(row => row.id === 'warlock-patron')?.value, longPatron);
  const doc = await PDFDocument.load(await createCharacterPdf(warlock, DEFAULT_PDF_OPTIONS, font, template));
  assert.ok(doc.getPageCount() > 3, `expected multiple appendix pages, got ${doc.getPageCount()}`);
  assert.deepEqual(doc.getPage(doc.getPageCount() - 1).getSize(), { width: 612, height: 792 });
  const chunks = doc.getForm().getFields()
    .filter(field => field.getName().startsWith('appendix_warlock-patron_'))
    .sort((a, b) => Number(a.getName().split('_').pop()) - Number(b.getName().split('_').pop()))
    .map(field => (field as PDFTextField).getText() ?? '');
  assert.ok(chunks.length > 1, `expected wrapped value lines, got ${chunks.length}`);
  assert.equal(chunks.join(' '), longPatron);
  doc.getForm().getTextField('patron_name').setText('The Lantern');
  doc.getForm().getTextField('appendix_warlock-patron_0').setText('The Lantern');
  const reopened = await PDFDocument.load(await doc.save());
  assert.equal(reopened.getPageCount(), doc.getPageCount());
  assert.equal(reopened.getForm().getTextField('patron_name').getText(), 'The Lantern');
  assert.equal(reopened.getForm().getTextField('appendix_warlock-patron_0').getText(), 'The Lantern');
  assert.ok(reopened.getForm().getCheckBox('favor_3').isChecked());
});
