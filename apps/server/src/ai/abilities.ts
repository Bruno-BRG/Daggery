import { rollDie, type Rng } from '@daggery/shared';
import { spellcastTraitValue } from '@daggery/shared/daggerheart';
import type { Sheet } from '@daggery/shared/daggerheart/types';

/**
 * Class-feature resources for the two campaign PCs. The printed text implemented here is:
 *
 * Ranger's Focus: "Spend a Hope and make an attack against a target. On a success, deal your
 * attack's normal damage and temporarily make the attack's target your Focus. ... When you deal
 * damage to them, they must mark a Stress."
 *
 * Prayer Dice: "At the beginning of each session, roll a number of d4s equal to your subclass's
 * Spellcast trait ... You can spend any number of Prayer Dice ... to reduce incoming damage, add
 * to a roll's result after the roll is made, or gain Hope equal to the result."
 */

export const PRAYER_DIE_SIDES = 4;

/** Only the Seraph has Prayer Dice. */
export function hasPrayerDice(sheet: Sheet): boolean {
  return sheet.classId === 'seraph';
}

/** Number of d4s rolled at session start: the subclass's Spellcast trait value. */
export function prayerDiceCount(sheet: Sheet): number {
  return hasPrayerDice(sheet) ? Math.max(0, spellcastTraitValue(sheet)) : 0;
}

/** Rolls the session-start Prayer Dice. Pure apart from the injected RNG. */
export function rollPrayerDice(sheet: Sheet, rng: Rng = Math.random): number[] {
  return Array.from({ length: prayerDiceCount(sheet) }, () => rollDie(PRAYER_DIE_SIDES, rng));
}

/** The unspent Prayer Dice on the sheet, oldest first. */
export function prayerDice(sheet: Sheet): number[] {
  return [...(sheet.resources?.prayerDice ?? [])];
}

/**
 * Removes one die and returns its value. Index validation is kept here so both the damage and
 * roll timing paths reject exactly the same input.
 */
export function spendPrayerDie(sheet: Sheet, index: number): { sheet: Sheet; value: number } {
  const dice = prayerDice(sheet);
  if (!hasPrayerDice(sheet) || !Number.isInteger(index) || index < 0 || index >= dice.length) {
    throw new Error('Invalid action: that Prayer Die is not available');
  }
  const value = dice[index]!;
  return {
    sheet: { ...sheet, resources: { ...sheet.resources, prayerDice: dice.filter((_, position) => position !== index) } },
    value,
  };
}

/** Only the Ranger has Ranger's Focus. */
export function hasRangersFocus(sheet: Sheet): boolean {
  return sheet.classId === 'ranger';
}

export function focusTargetId(sheet: Sheet): string | null {
  return sheet.resources?.focusTargetId ?? null;
}

/** Marks an adversary as this hero's Focus; replaces a previous target. */
export function setFocusTarget(sheet: Sheet, enemyId: string): Sheet {
  return { ...sheet, resources: { ...sheet.resources, focusTargetId: enemyId } };
}

/** Ends the Focus, for example when its target is defeated. */
export function clearFocusTarget(sheet: Sheet): Sheet {
  if (sheet.resources?.focusTargetId === undefined) return sheet;
  return { ...sheet, resources: { ...sheet.resources, focusTargetId: null } };
}
