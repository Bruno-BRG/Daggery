import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Sheet } from '@daggery/shared/daggerheart/types';
import { clearFocusTarget, focusTargetId, prayerDice, prayerDiceCount, rollPrayerDice, setFocusTarget, spendPrayerDie } from './ai/abilities';
import { quickHero } from './ai/daggerheart';

/** A Seraph with the quick-start trait spread, whose subclass Spellcast trait is Strength +2. */
function seraph(): Sheet {
  return quickHero('Sera', 'seraph');
}

test('Prayer Dice count is the subclass Spellcast trait value and only Seraphs have them', () => {
  const hero = seraph();
  assert.equal(hero.classId, 'seraph');
  assert.equal(hero.subclassId, 'divine-wielder');
  assert.equal(hero.traits.strength, 2);
  assert.equal(prayerDiceCount(hero), 2);
  assert.equal(prayerDiceCount(quickHero('Ash', 'warrior')), 0);
  assert.deepEqual(rollPrayerDice(quickHero('Ash', 'warrior')), []);
});

test('rollPrayerDice rolls one d4 per die, and spendPrayerDie removes exactly that die', () => {
  const hero = seraph();
  const faces = [0.99, 0.5];
  let cursor = 0;
  const dice = rollPrayerDice(hero, () => faces[cursor++]!);
  assert.deepEqual(dice, [4, 3]);

  const withDice: Sheet = { ...hero, resources: { prayerDice: dice } };
  const spent = spendPrayerDie(withDice, 0);
  assert.equal(spent.value, 4);
  assert.deepEqual(spent.sheet.resources?.prayerDice, [3]);
  assert.deepEqual(prayerDice(withDice), [4, 3], 'the source sheet is not mutated');

  for (const index of [2, -1, 0.5]) assert.throws(() => spendPrayerDie(withDice, index), { message: /^Invalid action: / }, String(index));
  assert.throws(() => spendPrayerDie(quickHero('Ash', 'warrior'), 0), { message: /^Invalid action: / }, 'a warrior has no Prayer Dice');
});

test('Ranger Focus helpers mark, replace and clear the stored target without mutating the source sheet', () => {
  const ranger = quickHero('Rin', 'ranger');
  assert.equal(focusTargetId(ranger), null, 'an older sheet has no Focus');
  const first = setFocusTarget(ranger, 'adv:one');
  assert.equal(focusTargetId(first), 'adv:one');
  const second = setFocusTarget(first, 'adv:two');
  assert.equal(focusTargetId(second), 'adv:two', 'a new Focus replaces the old target');
  assert.equal(focusTargetId(clearFocusTarget(second)), null);
  assert.equal(focusTargetId(ranger), null, 'the source sheet is not mutated');
});
