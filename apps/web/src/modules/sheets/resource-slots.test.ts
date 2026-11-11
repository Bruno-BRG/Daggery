import assert from 'node:assert/strict';
import test from 'node:test';
import { setExtraResourceSlots } from './resource-slots';
import { hpMax, stressMax } from './rules';
import type { Sheet } from './types';

function makeSheet(overrides: Partial<Sheet> = {}): Sheet {
  return {
    id: 'test', name: 'Hero', playerName: 'Player', level: 1, proficiency: 1,
    classId: 'guardian', subclassId: 'stalwart', ancestryId: null, communityId: null,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    traitMarks: [], evasionBonus: 0, armorId: null, armorSlotsMarked: 0, hpMarked: 0,
    stressMarked: 0, hope: 2, bonusHpSlots: 0, bonusStressSlots: 0, experiences: [],
    weapons: [], inventory: [], gold: 0, domainCardIds: [], loadoutIds: [], background: [],
    connections: [], notes: '', subclassUpgraded: 0, multiclassId: null, advancements: [],
    createdAt: '', updatedAt: '', ...overrides,
  };
}

test('editing extra slots increases level-one maxima, not marked resources', () => {
  const sheet = makeSheet({ hpMarked: 2, stressMarked: 3 });
  const hp = setExtraResourceSlots(sheet, 'extraHpSlots', '2');
  const next = setExtraResourceSlots(hp, 'extraStressSlots', '4');
  assert.equal(hpMax(next), hpMax(sheet) + 2);
  assert.equal(stressMax(next), stressMax(sheet) + 4);
  assert.equal(next.hpMarked, 2);
  assert.equal(next.stressMarked, 3);
  assert.equal(sheet.extraHpSlots, undefined);
});

test('removing an effect preserves heritage, advancement bonuses, and other effects', () => {
  const sheet = makeSheet({ ancestryId: 'human', bonusHpSlots: 2, bonusStressSlots: 1, extraHpSlots: 3, extraStressSlots: 4 });
  const next = setExtraResourceSlots(sheet, 'extraHpSlots', '');
  assert.equal(next.extraHpSlots, 0);
  assert.equal(next.extraStressSlots, 4);
  assert.equal(next.bonusHpSlots, 2);
  assert.equal(next.bonusStressSlots, 1);
  assert.equal(hpMax(next), hpMax(sheet) - 3);
  assert.equal(stressMax(next), stressMax(sheet));
  const saved = JSON.parse(JSON.stringify(next)) as Sheet;
  assert.equal(stressMax(saved), stressMax(next));
});

test('slot inputs accept values beyond old caps and reject invalid counts', () => {
  const sheet = makeSheet();
  for (const field of ['extraHpSlots', 'extraStressSlots'] as const) {
    assert.equal(setExtraResourceSlots(sheet, field, '150')[field], 150);
    for (const raw of ['-1', '1.5', 'no', 'Infinity', '1e309', '9007199254740992']) {
      assert.equal(setExtraResourceSlots(sheet, field, raw), sheet);
    }
  }
});

test('later advancements stack with extras and removing extras restores progression totals', () => {
  const sheet = makeSheet({ ancestryId: 'giant', bonusHpSlots: 1, bonusStressSlots: 2 });
  const extraHp = setExtraResourceSlots(sheet, 'extraHpSlots', '3');
  const boosted = setExtraResourceSlots(extraHp, 'extraStressSlots', '4');
  const advanced = { ...boosted, bonusHpSlots: boosted.bonusHpSlots + 1, bonusStressSlots: boosted.bonusStressSlots + 1 };
  assert.equal(hpMax(advanced), hpMax(boosted) + 1);
  assert.equal(stressMax(advanced), stressMax(boosted) + 1);
  const removed = setExtraResourceSlots(setExtraResourceSlots(advanced, 'extraHpSlots', '0'), 'extraStressSlots', '0');
  assert.equal(hpMax(removed), hpMax(sheet) + 1);
  assert.equal(stressMax(removed), stressMax(sheet) + 1);
});
