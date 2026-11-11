import { describe, expect, test } from 'vitest';
import {
  MAX_HOPE,
  MAX_SHORT_RESTS,
  REST_MOVES,
  advanceProject,
  advancementSlots,
  applyDualityEffects,
  armorScore,
  beginRest,
  canTakeShortRest,
  damageThresholds,
  doubleDutyBonus,
  evasion,
  gainHope,
  hpMax,
  isValidPickCount,
  markStress,
  maxLoadout,
  shortRestsTaken,
  stressMax,
  traitValue,
  weaponDamageNotation,
  weaponForSlot,
} from './sheet-rules';
import type { Sheet } from './sheet-types';

function makeSheet(overrides: Partial<Sheet> = {}): Sheet {
  return {
    id: 'test', name: 'Hero', playerName: 'Player', level: 1, proficiency: 1,
    classId: 'guardian', subclassId: 'stalwart', ancestryId: null, communityId: null,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    traitMarks: [], evasionBonus: 0, armorId: null, armorSlotsMarked: 0, hpMarked: 0,
    stressMarked: 0, hope: 2, bonusHpSlots: 0, bonusStressSlots: 0, experiences: [],
    weapons: [], inventory: [], gold: 0, domainCardIds: [], loadoutIds: [], background: [],
    connections: [], notes: '', subclassUpgraded: 0, multiclassId: null, advancements: [],
    createdAt: '', updatedAt: '',
    ...overrides,
  } as Sheet;
}

describe('marking Stress', () => {
  test('partial overflow marks exactly 1 HP, not the whole overflow', () => {
    const sheet = makeSheet({ stressMarked: 5 });
    const next = markStress(sheet, 2);
    expect(next.stressMarked).toBe(stressMax(sheet));
    expect(next.hpMarked).toBe(1);
  });

  test('a full Stress track takes 1 HP no matter how much Stress was forced', () => {
    const sheet = makeSheet({ stressMarked: stressMax(makeSheet()) });
    const next = markStress(sheet, 3);
    expect(next.stressMarked).toBe(stressMax(sheet));
    expect(next.hpMarked).toBe(1);
  });

  test('Stress that fits marks no HP', () => {
    const sheet = makeSheet({ stressMarked: 1 });
    const next = markStress(sheet, 2);
    expect(next.stressMarked).toBe(3);
    expect(next.hpMarked).toBe(0);
  });

  test('extra HP slots raised by advancements are not clamped to 12', () => {
    expect(hpMax(makeSheet({ bonusHpSlots: 8 }))).toBeGreaterThan(12);
  });
});

describe('advancement slots', () => {
  test('Hit Points and Stress can be taken twice per tier; most options once', () => {
    expect(advancementSlots('hp')).toBe(2);
    expect(advancementSlots('stress')).toBe(2);
    expect(advancementSlots('evasion')).toBe(1);
    expect(advancementSlots('multiclass')).toBe(1);
  });

  test('taking Hit Points twice uses both level-up slots', () => {
    expect(isValidPickCount(['hp', 'hp'])).toBe(true);
    expect(isValidPickCount(['hp', 'stress'])).toBe(true);
    expect(isValidPickCount(['hp', 'multiclass'])).toBe(false);
  });
});

describe('heritage and gear automation', () => {
  test('Galapa Shell adds Proficiency to both damage thresholds', () => {
    const sheet = makeSheet({ ancestryId: 'galapa', proficiency: 2 });
    expect(damageThresholds(sheet).major).toBe(1 + 2);
    expect(damageThresholds(sheet).severe).toBe(2 + 2);
  });

  test('Attuned adds tier to thresholds and lowers the loadout cap', () => {
    const sheet = makeSheet({ armorId: 'rune-forged-exosuit', level: 5 });
    const t = damageThresholds(sheet);
    expect(t.major).toBe(12 + 5 + 3);
    expect(t.severe).toBe(39 + 5 + 3);
    expect(maxLoadout(sheet)).toBe(4);
    expect(maxLoadout(makeSheet({ armorId: null }))).toBe(5);
  });

  test('Magnificent and weapon Armor Score bonuses count toward Armor Score', () => {
    const magnificent = makeSheet({
      armorId: 'granminsters-finery',
      traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 2, knowledge: 0 },
    });
    expect(armorScore(magnificent)).toBe(2 + 2);
    const shield = makeSheet({
      armorId: 'gambeson-armor',
      weapons: [{ slot: 'secondary', weaponId: 'round-shield' }],
    });
    expect(armorScore(shield)).toBe(3 + 1);
  });

  test('gear trait modifiers apply to trait values, including "all character traits"', () => {
    const cumbersome = makeSheet({ weapons: [{ slot: 'primary', weaponId: 'halberd' }] });
    expect(traitValue(cumbersome, 'finesse')).toBe(1 - 1);
    expect(traitValue(cumbersome, 'agility')).toBe(2);
    const difficult = makeSheet({ armorId: 'savior-chainmail' });
    for (const trait of ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'] as const) {
      expect(traitValue(difficult, trait)).toBe(difficult.traits[trait] - 1);
    }
  });

  test('Evasion modifiers from gear apply, including "+1 Evasion" and "and Evasion"', () => {
    const base = evasion(makeSheet());
    expect(evasion(makeSheet({ armorId: 'spidersilk-tunic' }))).toBe(base + 1);
    expect(evasion(makeSheet({ armorId: 'savior-chainmail' }))).toBe(base - 1);
    expect(evasion(makeSheet({ armorId: 'chainmail-armor' }))).toBe(base - 1);
  });
});

describe('printed caps', () => {
  test('Armor Score never exceeds 12 even with all bonuses', () => {
    const sheet = makeSheet({
      armorId: 'granminsters-finery',
      traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 20, knowledge: 0 },
      weapons: [{ slot: 'secondary', weaponId: 'spiked-shield' }],
    });
    expect(armorScore(sheet)).toBe(12);
  });

  test('Hope never exceeds 6, from a beat or from an effect', () => {
    const full = makeSheet({ hope: MAX_HOPE });
    const beat = applyDualityEffects(full, {
      hope: 12, fear: 3, total: 15, difficulty: null, modifier: 0,
      withHope: true, withFear: false, critical: false, advantageDie: null, advantage: 'normal',
    } as never);
    expect(beat.sheet.hope).toBe(MAX_HOPE);
    expect(gainHope(full, 2).hope).toBe(MAX_HOPE);
    expect(gainHope(makeSheet({ hope: 5 }), 2).hope).toBe(MAX_HOPE);
  });
});

describe('rests', () => {
  test('a party can take three short rests before a long rest', () => {
    expect(REST_MOVES).toBe(2);
    expect(canTakeShortRest(makeSheet({ shortRestsSinceLong: MAX_SHORT_RESTS - 1 }))).toBe(true);
    expect(canTakeShortRest(makeSheet({ shortRestsSinceLong: MAX_SHORT_RESTS }))).toBe(false);
    expect(shortRestsTaken(beginRest(makeSheet(), 'short'))).toBe(1);
  });

  test('the short-rest count never passes the printed maximum and a long rest resets it', () => {
    const atLimit = makeSheet({ shortRestsSinceLong: MAX_SHORT_RESTS });
    expect(shortRestsTaken(beginRest(atLimit, 'short'))).toBe(MAX_SHORT_RESTS);
    expect(shortRestsTaken(beginRest(atLimit, 'long'))).toBe(0);
  });

  test('recovery happens through rest moves, not automatically at the start', () => {
    const hurt = makeSheet({ hpMarked: 3, stressMarked: 2, armorSlotsMarked: 1 });
    const resting = beginRest(hurt, 'long');
    expect(resting.hpMarked).toBe(3);
    expect(resting.stressMarked).toBe(2);
    expect(resting.armorSlotsMarked).toBe(1);
  });
});

describe('downtime projects', () => {
  test('a progress countdown ticks down and is removed on completion', () => {
    const sheet = makeSheet({ projects: [{ id: 'p1', name: 'Translate the codex', start: 2, value: 2 }] });
    const first = advanceProject(sheet, 'p1');
    expect(first.completed).toBe(false);
    expect(first.sheet.projects?.[0]?.value).toBe(1);
    const second = advanceProject(first.sheet, 'p1');
    expect(second.completed).toBe(true);
    expect(second.name).toBe('Translate the codex');
    expect(second.sheet.projects).toEqual([]);
  });
});

describe('Double Duty', () => {
  test('the Spiked Shield adds +1 to a Melee primary weapon, not to itself', () => {
    const sheet = makeSheet({
      weapons: [
        { slot: 'primary', weaponId: 'longsword' },
        { slot: 'secondary', weaponId: 'spiked-shield' },
      ],
    });
    const primary = weaponForSlot(sheet, 'primary')!;
    const secondary = weaponForSlot(sheet, 'secondary')!;
    expect(doubleDutyBonus(sheet, primary)).toBe(1);
    expect(doubleDutyBonus(sheet, secondary)).toBe(0);
    expect(weaponDamageNotation(sheet, primary)).toBe('1d10+4');
  });

  test('a ranged primary weapon gets no Double Duty bonus', () => {
    const sheet = makeSheet({
      weapons: [
        { slot: 'primary', weaponId: 'longbow' },
        { slot: 'secondary', weaponId: 'spiked-shield' },
      ],
    });
    const primary = weaponForSlot(sheet, 'primary')!;
    expect(doubleDutyBonus(sheet, primary)).toBe(0);
    expect(weaponDamageNotation(sheet, primary)).toBe('1d8+3');
  });
});
