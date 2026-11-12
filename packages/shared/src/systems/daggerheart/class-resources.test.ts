import { describe, expect, test } from 'vitest';
import {
  COMPANION_TRAINING,
  MARTIAL_STANCES,
  classResourceDefinitions,
  classResourceFacts,
  classResourceValue,
  resetClassResources,
  setClassResource,
} from './class-resources';
import { beginRest } from './sheet-rules';
import type { ClassResourceValue, Sheet } from './sheet-types';

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

function resourceIds(sheet: Sheet): string[] {
  return classResourceDefinitions(sheet).map((definition) => definition.id);
}

function definition(sheet: Sheet, id: string) {
  return classResourceDefinitions(sheet).find((entry) => entry.id === id);
}

function value(sheet: Sheet, id: string): ClassResourceValue {
  return classResourceValue(sheet, id);
}

describe('canonical stance catalog', () => {
  test('sixteen stances keep the printed top-to-bottom order and tiers', () => {
    expect(MARTIAL_STANCES.map((stance) => stance.id)).toEqual([
      'favored', 'invigorating', 'quick', 'reliable',
      'aggressive', 'anchored', 'defensive', 'otherworldly',
      'grappling', 'scary', 'stable', 'vigilant',
      'crushing', 'exacting', 'honed', 'isolating',
    ]);
    expect(MARTIAL_STANCES.map((stance) => stance.tier)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4,
    ]);
    expect(new Set(MARTIAL_STANCES.map((stance) => stance.id)).size).toBe(16);
  });
});

describe('old sheets and defaults', () => {
  test('a Warlock sheet without classResources reads printed defaults', () => {
    const sheet = makeSheet({ classId: 'warlock', subclassId: null });
    expect(resourceIds(sheet)).toEqual(['warlock-patron', 'warlock-sphere', 'warlock-favor']);
    expect(value(sheet, 'warlock-patron')).toBe('');
    expect(value(sheet, 'warlock-sphere')).toBe('');
    expect(value(sheet, 'warlock-favor')).toBe(3);
    expect(definition(sheet, 'warlock-favor')?.max).toBe(6);
  });

  test('unknown resource ids are harmless', () => {
    expect(value(makeSheet(), 'not-a-resource')).toBe('');
  });

  test('classResources are optional on legacy sheets', () => {
    const legacy = makeSheet({ classId: 'rogue', subclassId: 'nightwalker' });
    expect(legacy.resources).toBeUndefined();
    expect(value(legacy, 'rogue-cloaked')).toBe(false);
  });
});

describe('class, subclass, and multiclass gating', () => {
  test('Martial Artist exposes Focus, stances, active stance, and the rest refresh', () => {
    const martial = makeSheet({ classId: 'brawler', subclassId: 'martial-artist' });
    expect(resourceIds(martial)).toEqual([
      'brawler-focus', 'brawler-stances', 'brawler-active-stance', 'brawler-focus-used',
    ]);
    expect(definition(martial, 'brawler-stances')?.max).toBe(2);
    expect(definition(martial, 'brawler-stances')?.options?.map((option) => option.id)).toEqual([
      'favored', 'invigorating', 'quick', 'reliable',
    ]);
    expect(definition(martial, 'brawler-active-stance')?.options).toEqual([]);
    expect(resourceIds(makeSheet({ classId: 'brawler', subclassId: 'juggernaut' }))).toEqual([]);
  });

  test('stance options grow with tier and the known cap grows with level', () => {
    const levelThree = makeSheet({ classId: 'brawler', subclassId: 'martial-artist', level: 3 });
    expect(definition(levelThree, 'brawler-stances')?.max).toBe(4);
    expect(definition(levelThree, 'brawler-stances')?.options).toHaveLength(8);
    const levelEight = makeSheet({ classId: 'brawler', subclassId: 'martial-artist', level: 8 });
    expect(definition(levelEight, 'brawler-stances')?.options).toHaveLength(16);
  });

  test('Assassin poisons are Poisoners Guild only and Mark is always available', () => {
    expect(resourceIds(makeSheet({ classId: 'assassin', subclassId: 'executioners-guild' }))).toEqual([
      'assassin-mark',
    ]);
    expect(resourceIds(makeSheet({ classId: 'assassin', subclassId: 'poisoners-guild' }))).toEqual([
      'assassin-mark', 'assassin-poison',
    ]);
  });

  test('Witch Hedge trackers appear at their printed stages', () => {
    const foundation = makeSheet({ classId: 'witch', subclassId: 'hedge', traits: { ...makeSheet().traits, knowledge: 2 } });
    expect(resourceIds(foundation)).toEqual([
      'witch-hexes', 'witch-commune-used', 'witch-talisman', 'witch-talisman-used',
    ]);
    expect(definition(foundation, 'witch-hexes')?.max).toBe(2);
    const specialization = makeSheet({ classId: 'witch', subclassId: 'hedge', subclassUpgraded: 1, traits: { ...makeSheet().traits, knowledge: 2 } });
    expect(resourceIds(specialization)).toContain('witch-spirit');
    expect(resourceIds(specialization)).not.toContain('witch-circle');
    expect(definition(specialization, 'witch-spirit')?.max).toBe(2);
    const mastery = makeSheet({ classId: 'witch', subclassId: 'hedge', subclassUpgraded: 2, traits: { ...makeSheet().traits, knowledge: 2 } });
    expect(resourceIds(mastery)).toContain('witch-circle');
  });

  test('Witch Moon only gains the phase counter at mastery', () => {
    expect(resourceIds(makeSheet({ classId: 'witch', subclassId: 'moon', subclassUpgraded: 1 }))).not.toContain('witch-phase');
    const mastery = makeSheet({ classId: 'witch', subclassId: 'moon', subclassUpgraded: 2 });
    expect(resourceIds(mastery)).toContain('witch-phase');
    expect(definition(mastery, 'witch-phase')?.min).toBe(0);
    expect(definition(mastery, 'witch-phase')?.defaultValue).toBe(0);
    expect(definition(mastery, 'witch-phase')?.max).toBe(6);
  });

  test('Warlock patron toggles follow their subclass foundation', () => {
    expect(resourceIds(makeSheet({ classId: 'warlock', subclassId: 'pact-of-the-endless' }))).toContain('warlock-mantle');
    expect(resourceIds(makeSheet({ classId: 'warlock', subclassId: 'pact-of-the-endless' }))).not.toContain('warlock-fury');
    expect(resourceIds(makeSheet({ classId: 'warlock', subclassId: 'pact-of-the-wrathful' }))).toContain('warlock-fury');
  });

  test('Beastbound adds the companion trackers but Wayfinder does not', () => {
    const beastbound = makeSheet({ classId: 'ranger', subclassId: 'beastbound' });
    expect(resourceIds(beastbound)).toEqual([
      'ranger-focus',
      'ranger-companion-name', 'ranger-companion-evasion', 'ranger-companion-stress',
      'ranger-companion-attack', 'ranger-companion-range', 'ranger-companion-experiences',
      'ranger-companion-training',
    ]);
    expect(resourceIds(makeSheet({ classId: 'ranger', subclassId: 'wayfinder' }))).toEqual(['ranger-focus']);
    expect(COMPANION_TRAINING.map((option) => option.id)).toEqual([
      'intelligent', 'intelligent-2', 'intelligent-3',
      'light-in-the-dark', 'creature-comfort', 'armored',
      'vicious', 'vicious-2', 'vicious-3',
      'resilient', 'resilient-2', 'resilient-3',
      'bonded', 'aware', 'aware-2', 'aware-3',
    ]);
    expect(definition(beastbound, 'ranger-companion-stress')?.max).toBe(6);
    expect(definition(beastbound, 'ranger-companion-training')?.max).toBe(16);
  });

  test('training keeps one base id per option and adds ranks in native box order', () => {
    const optionIds = COMPANION_TRAINING.map((option) => option.id);
    for (const base of ['intelligent', 'light-in-the-dark', 'creature-comfort', 'armored', 'vicious', 'resilient', 'bonded', 'aware']) {
      expect(optionIds).toContain(base);
    }
    const ranks = (prefix: string) => optionIds.filter((id) => id === prefix || id.startsWith(`${prefix}-`));
    expect(ranks('intelligent')).toHaveLength(3);
    expect(ranks('vicious')).toHaveLength(3);
    expect(ranks('resilient')).toHaveLength(3);
    expect(ranks('aware')).toHaveLength(3);
    expect(ranks('light-in-the-dark')).toHaveLength(1);
    expect(optionIds).toHaveLength(16);
  });

  test('Sorcerer subclass trackers are gated to their features', () => {
    expect(resourceIds(makeSheet({ classId: 'sorcerer', subclassId: 'elemental-origin' }))).toContain('sorcerer-element');
    expect(resourceIds(makeSheet({ classId: 'sorcerer', subclassId: 'primal-origin', subclassUpgraded: 1 }))).not.toContain('sorcerer-charged');
    expect(resourceIds(makeSheet({ classId: 'sorcerer', subclassId: 'primal-origin', subclassUpgraded: 2 }))).toContain('sorcerer-charged');
  });

  test('multiclass exposes only the foundation of the second class', () => {
    const sheet = makeSheet({
      classId: 'guardian', subclassId: 'stalwart', subclassUpgraded: 2,
      multiclassId: 'witch', multiclassSubclassId: 'hedge',
    });
    const ids = resourceIds(sheet);
    expect(ids).toContain('guardian-unstoppable');
    expect(ids).toContain('witch-talisman');
    expect(ids).not.toContain('witch-spirit');
    expect(ids).not.toContain('witch-circle');
    const martial = makeSheet({
      classId: 'guardian', subclassId: 'stalwart', multiclassId: 'brawler', multiclassSubclassId: 'martial-artist',
    });
    expect(resourceIds(martial)).toContain('brawler-focus');
    expect(resourceIds(martial)).toContain('brawler-active-stance');
  });
});

describe('values, clamps, and sanitization', () => {
  test('Favor defaults to 3 and clamps to 0..6', () => {
    const sheet = makeSheet({ classId: 'warlock', subclassId: null });
    expect(setClassResource(sheet, 'warlock-favor', Number.NaN).resources?.classResources?.['warlock-favor']).toBe(3);
    expect(value(setClassResource(sheet, 'warlock-favor', -2), 'warlock-favor')).toBe(0);
    expect(value(setClassResource(sheet, 'warlock-favor', 99), 'warlock-favor')).toBe(6);
    expect(value(setClassResource(sheet, 'warlock-favor', 2.9), 'warlock-favor')).toBe(2);
  });

  test('counters sanitize NaN and negatives and respect dynamic caps', () => {
    const martial = makeSheet({ classId: 'brawler', subclassId: 'martial-artist' });
    expect(value(setClassResource(martial, 'brawler-focus', -1), 'brawler-focus')).toBe(0);
    expect(value(setClassResource(martial, 'brawler-focus', Number.NaN), 'brawler-focus')).toBe(0);
    expect(value(setClassResource(martial, 'brawler-focus', 9), 'brawler-focus')).toBe(6);

    const moon = makeSheet({ classId: 'witch', subclassId: 'moon', subclassUpgraded: 2 });
    expect(value(moon, 'witch-phase')).toBe(0);
    expect(value(setClassResource(moon, 'witch-phase', 0), 'witch-phase')).toBe(0);
    expect(value(setClassResource(moon, 'witch-phase', 7), 'witch-phase')).toBe(6);
    expect(value(setClassResource(moon, 'witch-phase', Number.NaN), 'witch-phase')).toBe(0);

    const guardian = makeSheet({ classId: 'guardian', subclassId: 'stalwart', level: 5 });
    expect(definition(guardian, 'guardian-unstoppable')?.max).toBe(6);
    expect(value(setClassResource(guardian, 'guardian-unstoppable', 9), 'guardian-unstoppable')).toBe(6);
    expect(definition(makeSheet(), 'guardian-unstoppable')?.max).toBe(4);
  });

  test('poison tokens have no arbitrary game cap but stay nonnegative', () => {
    const sheet = makeSheet({ classId: 'assassin', subclassId: 'poisoners-guild' });
    expect(value(setClassResource(sheet, 'assassin-poison', 99), 'assassin-poison')).toBe(99);
    expect(value(setClassResource(sheet, 'assassin-poison', -3), 'assassin-poison')).toBe(0);
    expect(value(setClassResource(sheet, 'assassin-poison', Number.NaN), 'assassin-poison')).toBe(0);
  });

  test('companion evasion defaults to 10 and companion stress caps at 6', () => {
    const sheet = makeSheet({ classId: 'ranger', subclassId: 'beastbound' });
    expect(value(sheet, 'ranger-companion-evasion')).toBe(10);
    expect(value(setClassResource(sheet, 'ranger-companion-evasion', -4), 'ranger-companion-evasion')).toBe(0);
    expect(value(setClassResource(sheet, 'ranger-companion-stress', 9), 'ranger-companion-stress')).toBe(6);
  });

  test('selecting a stance respects tier access, duplicates, and the known cap', () => {
    const sheet = makeSheet({ classId: 'brawler', subclassId: 'martial-artist' });
    const next = setClassResource(sheet, 'brawler-stances', ['favored', 'aggressive', 'favored', 'quick', 'reliable']);
    expect(value(next, 'brawler-stances')).toEqual(['favored', 'quick']);
    const levelThree = makeSheet({ classId: 'brawler', subclassId: 'martial-artist', level: 3 });
    expect(value(setClassResource(levelThree, 'brawler-stances', ['favored', 'anchored', 'scary', 'quick', 'reliable']), 'brawler-stances')).toEqual([
      'favored', 'anchored', 'quick', 'reliable',
    ]);
  });

  test('the active stance only accepts a known stance and blank is inactive', () => {
    const sheet = makeSheet({ classId: 'brawler', subclassId: 'martial-artist' });
    const known = setClassResource(sheet, 'brawler-stances', ['favored']);
    expect(value(setClassResource(known, 'brawler-active-stance', 'favored'), 'brawler-active-stance')).toBe('favored');
    expect(value(setClassResource(known, 'brawler-active-stance', 'quick'), 'brawler-active-stance')).toBe('');
    expect(value(setClassResource(known, 'brawler-active-stance', ''), 'brawler-active-stance')).toBe('');
  });

  test('list and selection values trim, deduplicate, filter, and cap', () => {
    const ranger = makeSheet({ classId: 'ranger', subclassId: 'beastbound' });
    expect(value(setClassResource(ranger, 'ranger-companion-experiences', [' Scout ', 'Scout', '', 'Guard', 'Nimble', 'Fetch', 'Brave', 'Loyal']), 'ranger-companion-experiences')).toEqual([
      'Scout', 'Guard', 'Nimble', 'Fetch', 'Brave',
    ]);
    const training = COMPANION_TRAINING.map((option) => option.id);
    expect(value(setClassResource(ranger, 'ranger-companion-training', [...training, 'made-up']), 'ranger-companion-training')).toEqual(training);
    const witch = makeSheet({ classId: 'witch', subclassId: 'hedge', traits: { ...makeSheet().traits, knowledge: 1 } });
    expect(value(setClassResource(witch, 'witch-hexes', ['Goblin', 'Goblin', 'Ogre']), 'witch-hexes')).toEqual(['Goblin']);
  });
});

describe('legacy aliases', () => {
  test("Ranger's Focus writes focusTargetId and never duplicates the resource", () => {
    const sheet = makeSheet({ classId: 'ranger', subclassId: 'wayfinder', resources: { prayerDice: [2] } });
    const focused = setClassResource(sheet, 'ranger-focus', 'adv:one');
    expect(focused.resources?.focusTargetId).toBe('adv:one');
    expect(focused.resources?.classResources?.['ranger-focus']).toBeUndefined();
    expect(focused.resources?.prayerDice).toEqual([2]);
    expect(value(focused, 'ranger-focus')).toBe('adv:one');
    expect(setClassResource(focused, 'ranger-focus', '').resources?.focusTargetId).toBeNull();
    expect(value(setClassResource(focused, 'ranger-focus', ''), 'ranger-focus')).toBe('');
  });

  test('Prayer Dice write prayerDice, cap their count at Spellcast, and keep d4 faces', () => {
    const sheet = makeSheet({
      classId: 'seraph', subclassId: 'divine-wielder',
      traits: { ...makeSheet().traits, strength: 2 },
      resources: { focusTargetId: 'adv:keep' },
    });
    expect(definition(sheet, 'seraph-prayer-dice')?.max).toBe(2);
    const rolled = setClassResource(sheet, 'seraph-prayer-dice', [1, 5, 3]);
    expect(rolled.resources?.prayerDice).toEqual([1, 4]);
    expect(rolled.resources?.classResources?.['seraph-prayer-dice']).toBeUndefined();
    expect(rolled.resources?.focusTargetId).toBe('adv:keep');
    expect(value(rolled, 'seraph-prayer-dice')).toEqual([1, 4]);
  });

  test('a legacy Seraph without a known Spellcast keeps recorded dice', () => {
    const sheet = makeSheet({
      classId: 'seraph', subclassId: null,
      resources: { prayerDice: [4, 2] },
    });
    expect(definition(sheet, 'seraph-prayer-dice')?.max).toBeUndefined();
    expect(value(sheet, 'seraph-prayer-dice')).toEqual([4, 2]);
  });
});

describe('rejections and preservation', () => {
  test('unavailable ids leave the same sheet untouched', () => {
    const warrior = makeSheet({ classId: 'warrior', subclassId: 'call-of-the-brave' });
    expect(setClassResource(warrior, 'warlock-favor', 1)).toBe(warrior);
    expect(warrior.resources).toBeUndefined();
  });

  test('unrelated and unknown saved keys survive writes and resets', () => {
    const sheet = makeSheet({
      classId: 'warlock', subclassId: null,
      resources: { classResources: { 'homebrew-flag': 'keep', 'warlock-patron': 'The Fox' }, featuresStartedFor: 'chat-1' },
    });
    const favored = setClassResource(sheet, 'warlock-favor', 5);
    expect(favored.resources?.classResources?.['homebrew-flag']).toBe('keep');
    expect(favored.resources?.classResources?.['warlock-patron']).toBe('The Fox');
    const rested = beginRest(favored, 'long');
    expect(rested.resources?.classResources?.['homebrew-flag']).toBe('keep');
    expect(rested.resources?.featuresStartedFor).toBe('chat-1');
    expect(value(rested, 'warlock-favor')).toBe(5);
  });
});

describe('rest, scene, and session resets', () => {
  test('a short rest clears rest trackers but not long-rest trackers', () => {
    const sheet = makeSheet({
      classId: 'assassin', subclassId: 'poisoners-guild',
      resources: {
        classResources: { 'assassin-mark': 'Ogre', 'assassin-poison': 3 },
        featuresStartedFor: 'chat-1',
      },
    });
    const short = beginRest(sheet, 'short');
    expect(value(short, 'assassin-mark')).toBe('');
    expect(value(short, 'assassin-poison')).toBe(3);
    expect(short.shortRestsSinceLong).toBe(1);
    const long = beginRest(short, 'long');
    expect(value(long, 'assassin-mark')).toBe('');
    expect(value(long, 'assassin-poison')).toBe(0);
    expect(long.shortRestsSinceLong).toBe(0);
    expect(long.resources?.featuresStartedFor).toBe('chat-1');
  });

  test('long rest resets both rest and long-rest trackers exactly once', () => {
    const sheet = makeSheet({
      classId: 'guardian', subclassId: 'stalwart',
      resources: { classResources: { 'guardian-unstoppable-used': true, 'guardian-unstoppable': 3 } },
    });
    const rested = beginRest(sheet, 'long');
    expect(value(rested, 'guardian-unstoppable-used')).toBe(false);
    expect(value(rested, 'guardian-unstoppable')).toBe(3); // scene feature, not a long-rest reset
    expect(beginRest(sheet, 'short').resources?.classResources?.['guardian-unstoppable-used']).toBe(true);
  });

  test('scene resets clear Guardian, Warlock, and stance state but not Beastform or Cloaked', () => {
    const guardian = makeSheet({ classId: 'guardian', subclassId: 'stalwart' });
    const withDie = setClassResource(guardian, 'guardian-unstoppable', 3);
    expect(value(resetClassResources(withDie, 'scene'), 'guardian-unstoppable')).toBe(0);
    const warlock = makeSheet({ classId: 'warlock', subclassId: 'pact-of-the-endless' });
    expect(value(resetClassResources(setClassResource(warlock, 'warlock-mantle', true), 'scene'), 'warlock-mantle')).toBe(false);
    const martial = makeSheet({ classId: 'brawler', subclassId: 'martial-artist' });
    const active = setClassResource(setClassResource(martial, 'brawler-stances', ['favored']), 'brawler-active-stance', 'favored');
    expect(value(resetClassResources(active, 'scene'), 'brawler-active-stance')).toBe('');
    expect(value(resetClassResources(active, 'scene'), 'brawler-stances')).toEqual(['favored']);
    const druid = makeSheet({ classId: 'druid', subclassId: 'warden-of-renewal' });
    expect(value(resetClassResources(setClassResource(druid, 'druid-beastform', 'Wolf'), 'scene'), 'druid-beastform')).toBe('Wolf');
    const rogue = makeSheet({ classId: 'rogue', subclassId: 'nightwalker' });
    expect(value(resetClassResources(setClassResource(rogue, 'rogue-cloaked', true), 'scene'), 'rogue-cloaked')).toBe(true);
  });

  test('session resets clear Rally and Prayer Dice without touching rest trackers', () => {
    const bard = makeSheet({ classId: 'bard', subclassId: 'troubadour' });
    const rallied = setClassResource(setClassResource(bard, 'bard-rally-used', true), 'bard-rally-held', true);
    expect(value(resetClassResources(rallied, 'session'), 'bard-rally-used')).toBe(false);
    expect(value(resetClassResources(rallied, 'session'), 'bard-rally-held')).toBe(false);
    expect(value(resetClassResources(rallied, 'rest'), 'bard-rally-used')).toBe(true);

    const seraph = makeSheet({
      classId: 'seraph', subclassId: 'divine-wielder',
      traits: { ...makeSheet().traits, strength: 2 },
      resources: { prayerDice: [4, 2], featuresStartedFor: 'chat-1' },
    });
    const session = resetClassResources(seraph, 'session');
    expect(session.resources?.prayerDice).toEqual([]);
    expect(session.resources?.featuresStartedFor).toBe('chat-1');
    expect(resetClassResources(seraph, 'longRest').resources?.prayerDice).toEqual([4, 2]);
  });

  test('a session clears a recorded lunar phase without inventing the next roll', () => {
    const moon = makeSheet({ classId: 'witch', subclassId: 'moon', subclassUpgraded: 2 });
    const recorded = setClassResource(moon, 'witch-phase', 5);
    expect(value(resetClassResources(recorded, 'session'), 'witch-phase')).toBe(0);
    expect(value(resetClassResources(recorded, 'rest'), 'witch-phase')).toBe(5);
  });

  test('persistent choices and Favor survive every reset', () => {
    const sheet = makeSheet({
      classId: 'warlock', subclassId: 'pact-of-the-endless',
      resources: { classResources: { 'warlock-patron': 'The Fox', 'warlock-sphere': 'Mischief', 'warlock-favor': 5 } },
    });
    for (const event of ['rest', 'longRest', 'scene', 'session'] as const) {
      const reset = resetClassResources(sheet, event);
      expect(value(reset, 'warlock-patron')).toBe('The Fox');
      expect(value(reset, 'warlock-sphere')).toBe('Mischief');
      expect(value(reset, 'warlock-favor')).toBe(5);
    }
  });
});

describe('derived facts', () => {
  test('Combo Die follows recorded Combo Die advancements, not level alone', () => {
    const die = (history: Sheet['advancementHistory']) =>
      classResourceFacts(makeSheet({ classId: 'brawler', subclassId: 'juggernaut', level: 8, advancementHistory: history }))
        .find((fact) => fact.label === 'Combo Die')?.value;
    expect(die([])).toBe('d4');
    expect(die([{ level: 2, advancement: 'combo-die' }])).toBe('d6');
    expect(die([
      { level: 2, advancement: 'combo-die' },
      { level: 5, advancement: 'combo-die' },
    ])).toBe('d8');
    expect(die([
      { level: 2, advancement: 'combo-die' },
      { level: 5, advancement: 'combo-die' },
      { level: 8, advancement: 'combo-die' },
      { level: 9, advancement: 'combo-die' },
    ])).toBe('d10');
    const legacy = makeSheet({ classId: 'brawler', subclassId: 'juggernaut', advancements: ['combo-die'] });
    expect(classResourceFacts(legacy).find((fact) => fact.label === 'Combo Die')?.value).toBe('d6');
  });

  test('Patron and Unstoppable dice step up at level 5', () => {
    const patron = (level: number) =>
      classResourceFacts(makeSheet({ classId: 'warlock', subclassId: null, level }))
        .find((fact) => fact.label === 'Patron Die')?.value;
    expect(patron(4)).toBe('d6');
    expect(patron(5)).toBe('d8');
    const unstoppable = (level: number) =>
      classResourceFacts(makeSheet({ classId: 'guardian', subclassId: 'stalwart', level }))
        .find((fact) => fact.label === 'Unstoppable Die')?.value;
    expect(unstoppable(4)).toBe('d4');
    expect(unstoppable(5)).toBe('d6');
  });

  test('Rally Die uses level and Wordsmith mastery, not just level 5', () => {
    const rally = (subclassId: string, level: number, upgraded: number) =>
      classResourceFacts(makeSheet({ classId: 'bard', subclassId, level, subclassUpgraded: upgraded }))
        .find((fact) => fact.label === 'Rally Die')?.value;
    expect(rally('troubadour', 1, 0)).toBe('d6');
    expect(rally('troubadour', 5, 0)).toBe('d8');
    expect(rally('wordsmith', 5, 1)).toBe('d8');
    expect(rally('wordsmith', 5, 2)).toBe('d10');
    expect(rally('troubadour', 8, 2)).toBe('d8');
  });

  test('multiclass foundations contribute their own facts', () => {
    const sheet = makeSheet({ classId: 'brawler', subclassId: 'juggernaut', multiclassId: 'warlock', multiclassSubclassId: null });
    const labels = classResourceFacts(sheet).map((fact) => fact.label);
    expect(labels).toContain('Combo Die');
    expect(labels).toContain('Patron Die');
    expect(labels).toContain('Favor');
  });
});

describe('serialized roundtrip', () => {
  test('trackers survive JSON persistence and keep normalizing on read', () => {
    const sheet = makeSheet({
      classId: 'brawler', subclassId: 'martial-artist', level: 3,
      resources: {
        classResources: {
          'brawler-stances': ['favored', 'anchored'],
          'brawler-active-stance': 'favored',
          'brawler-focus': 2,
          'homebrew': 'kept',
        },
      },
    });
    const restored = JSON.parse(JSON.stringify(sheet)) as Sheet;
    expect(resourceIds(restored)).toEqual(resourceIds(sheet));
    expect(value(restored, 'brawler-stances')).toEqual(['favored', 'anchored']);
    expect(value(restored, 'brawler-active-stance')).toBe('favored');
    expect(value(restored, 'brawler-focus')).toBe(2);
    expect(restored.resources?.classResources?.['homebrew']).toBe('kept');
    const changed = setClassResource(restored, 'brawler-focus', 99);
    expect(value(changed, 'brawler-focus')).toBe(6);
    expect(JSON.parse(JSON.stringify(changed)).resources.classResources['brawler-focus']).toBe(6);
  });
});
