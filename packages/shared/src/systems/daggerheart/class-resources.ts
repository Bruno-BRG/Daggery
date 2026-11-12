import type { ClassResourceValue, Sheet, SheetResources } from './sheet-types';
import { spellcastTraitName, spellcastTraitValue, tierForLevel } from './sheet-rules';

/**
 * A class-feature tracker. Some trackers are counters (Favor, Focus), some record a target or
 * form name (Ranger's Focus, Beastform), and some record state (Cloaked, Channel Raw Power).
 * The shared helpers never roll dice, spend Hope or Stress, or apply an ability's effects.
 */
export interface ClassResourceDefinition {
  id: string;
  classId: string;
  label: string;
  kind: 'counter' | 'text' | 'toggle' | 'list' | 'choice' | 'selection' | 'dice';
  defaultValue: ClassResourceValue;
  max?: number;
  min?: number;
  options?: { id: string; label: string }[];
  help: string;
  reset?: 'rest' | 'longRest' | 'scene' | 'session';
}

export interface MartialStance {
  id: string;
  label: string;
  tier: 1 | 2 | 3 | 4;
}

/**
 * Canonical Martial Stances in the order printed on the Brawler's Martial Stances sheet.
 * Ids are stable so saved tracker values survive content updates.
 */
export const MARTIAL_STANCES: MartialStance[] = [
  { id: 'favored', label: 'Favored', tier: 1 },
  { id: 'invigorating', label: 'Invigorating', tier: 1 },
  { id: 'quick', label: 'Quick', tier: 1 },
  { id: 'reliable', label: 'Reliable', tier: 1 },
  { id: 'aggressive', label: 'Aggressive', tier: 2 },
  { id: 'anchored', label: 'Anchored', tier: 2 },
  { id: 'defensive', label: 'Defensive', tier: 2 },
  { id: 'otherworldly', label: 'Otherworldly', tier: 2 },
  { id: 'grappling', label: 'Grappling', tier: 3 },
  { id: 'scary', label: 'Scary', tier: 3 },
  { id: 'stable', label: 'Stable', tier: 3 },
  { id: 'vigilant', label: 'Vigilant', tier: 3 },
  { id: 'crushing', label: 'Crushing', tier: 4 },
  { id: 'exacting', label: 'Exacting', tier: 4 },
  { id: 'honed', label: 'Honed', tier: 4 },
  { id: 'isolating', label: 'Isolating', tier: 4 },
];

/**
 * Ranger Companion training, one entry per printed checkbox in native sheet order. Eight
 * options share sixteen boxes: Intelligent, Vicious, Resilient, and Aware have three ranks
 * each; Light in the Dark, Creature Comfort, Armored, and Bonded have one. The first rank of
 * every option keeps the original base id so older saved values still select the first box.
 */
export const COMPANION_TRAINING: { id: string; label: string }[] = [
  { id: 'intelligent', label: 'Intelligent (1)' },
  { id: 'intelligent-2', label: 'Intelligent (2)' },
  { id: 'intelligent-3', label: 'Intelligent (3)' },
  { id: 'light-in-the-dark', label: 'Light in the Dark' },
  { id: 'creature-comfort', label: 'Creature Comfort' },
  { id: 'armored', label: 'Armored' },
  { id: 'vicious', label: 'Vicious (1)' },
  { id: 'vicious-2', label: 'Vicious (2)' },
  { id: 'vicious-3', label: 'Vicious (3)' },
  { id: 'resilient', label: 'Resilient (1)' },
  { id: 'resilient-2', label: 'Resilient (2)' },
  { id: 'resilient-3', label: 'Resilient (3)' },
  { id: 'bonded', label: 'Bonded' },
  { id: 'aware', label: 'Aware (1)' },
  { id: 'aware-2', label: 'Aware (2)' },
  { id: 'aware-3', label: 'Aware (3)' },
];

const MAX_FOCUS = 6;
const MAX_FAVOR = 6;
const MAX_COMPANION_STRESS = 6;
const MAX_COMPANION_EXPERIENCES = 5;
const PRAYER_DIE_FACES = 4;

/** Resources whose value lives in the legacy SheetResources fields instead of classResources. */
const ALIAS_FIELDS: Record<string, 'focusTargetId' | 'prayerDice'> = {
  'ranger-focus': 'focusTargetId',
  'seraph-prayer-dice': 'prayerDice',
};

/** Static definition templates; builders add level- or value-dependent caps and options. */
const BASE = {
  'warlock-patron': {
    id: 'warlock-patron',
    classId: 'warlock',
    label: 'Patron',
    kind: 'text',
    defaultValue: '',
    help: "Write the entity your pact serves. Patron's Pact and its roleplay remain manual.",
  },
  'warlock-sphere': {
    id: 'warlock-sphere',
    classId: 'warlock',
    label: "Patron's Sphere",
    kind: 'text',
    defaultValue: '',
    help: 'The sphere of influence agreed with the GM (Nature, War, Death, and so on). Spend Favor manually when a roll relates to it.',
  },
  'warlock-favor': {
    id: 'warlock-favor',
    classId: 'warlock',
    label: 'Favor',
    kind: 'counter',
    defaultValue: 3,
    min: 0,
    max: MAX_FAVOR,
    help: 'Start with 3 Favor. Gain Favor with a downtime move or by choosing it instead of Hope; the maximum is 6. This tracker never resets automatically.',
  },
  'warlock-mantle': {
    id: 'warlock-mantle',
    classId: 'warlock',
    label: "Patron's Mantle Active",
    kind: 'toggle',
    defaultValue: false,
    reset: 'scene',
    help: "Patron's Mantle (Pact of the Endless): spend a Favor to gain tier bonus to damage thresholds and advantage on intimidation until you take Severe damage or the scene ends. Costs and effects stay manual.",
  },
  'warlock-fury': {
    id: 'warlock-fury',
    classId: 'warlock',
    label: "Patron's Fury Active",
    kind: 'toggle',
    defaultValue: false,
    reset: 'scene',
    help: "Patron's Fury (Pact of the Wrathful): spend a Favor to add tier Patron Dice to damage until you deal Severe damage or the scene ends. Costs and effects stay manual.",
  },
  'brawler-focus': {
    id: 'brawler-focus',
    classId: 'brawler',
    label: 'Focus',
    kind: 'counter',
    defaultValue: 0,
    min: 0,
    max: MAX_FOCUS,
    help: 'Spend Focus to shift martial stances or use Martial Artist features. Once per rest during a moment of calm, clear the track, roll d6s equal to Instinct, and gain Focus equal to the highest result. The maximum is 6.',
  },
  'brawler-focus-used': {
    id: 'brawler-focus-used',
    classId: 'brawler',
    label: 'Focus Refreshed',
    kind: 'toggle',
    defaultValue: false,
    reset: 'rest',
    help: 'Once per rest during a moment of calm, clear your Focus track then roll d6s equal to Instinct and gain Focus equal to the highest result. Resets on a rest.',
  },
  'brawler-stances': {
    id: 'brawler-stances',
    classId: 'brawler',
    label: 'Known Stances',
    kind: 'selection',
    defaultValue: [],
    help: 'Choose two Tier 1 stances at level 1, then one more stance of your tier or lower at each level. The known cap is your level + 1.',
  },
  'brawler-active-stance': {
    id: 'brawler-active-stance',
    classId: 'brawler',
    label: 'Active Stance',
    kind: 'choice',
    defaultValue: '',
    reset: 'scene',
    help: 'Spend a Focus to shift into a stance you know. It ends when you take Severe damage, mark your last Hit Point, shift stance, or the scene ends. Costs and effects stay manual.',
  },
  'assassin-mark': {
    id: 'assassin-mark',
    classId: 'assassin',
    label: 'Marked for Death',
    kind: 'text',
    defaultValue: '',
    reset: 'rest',
    help: 'One target at a time. Add tier dice manually: d4 normally, d6 with Executioners Guild foundation, or d8 with its mastery. Clear the mark on a rest, when the target is defeated, or when the GM spends Fear equal to your tier.',
  },
  'assassin-poison': {
    id: 'assassin-poison',
    classId: 'assassin',
    label: 'Poison Tokens',
    kind: 'counter',
    defaultValue: 0,
    min: 0,
    reset: 'longRest',
    help: 'Tokens placed with Toxic Concoctions (1d4+1). Spend one on a successful weapon attack and clear all unspent tokens on a long rest.',
  },
  'witch-hexes': {
    id: 'witch-hexes',
    classId: 'witch',
    label: 'Hexed Targets',
    kind: 'list',
    defaultValue: [],
    help: 'Record the targets you have Hexed, up to your Spellcast trait. Marking Stress and applying the penalty stay manual.',
  },
  'witch-commune-used': {
    id: 'witch-commune-used',
    classId: 'witch',
    label: 'Commune Used',
    kind: 'toggle',
    defaultValue: false,
    reset: 'longRest',
    help: 'Commune is once per long rest. This tracker only records that you used it; the question and chart roll stay manual.',
  },
  'witch-talisman': {
    id: 'witch-talisman',
    classId: 'witch',
    label: 'Talisman Tokens',
    kind: 'counter',
    defaultValue: 0,
    min: 0,
    reset: 'rest',
    help: 'Tokens placed with Enchanted Talisman by spending Hope. Spend a token to reduce Hit Points marked; clear all tokens on a rest.',
  },
  'witch-talisman-used': {
    id: 'witch-talisman-used',
    classId: 'witch',
    label: 'Talisman Used',
    kind: 'toggle',
    defaultValue: false,
    reset: 'rest',
    help: 'Enchanted Talisman is once per rest. This records the use only; placing tokens and spending Hope stay manual.',
  },
  'witch-spirit': {
    id: 'witch-spirit',
    classId: 'witch',
    label: 'Spirit Tokens',
    kind: 'counter',
    defaultValue: 0,
    min: 0,
    help: 'Tokens from Walk Between Worlds, equal to your Spellcast trait. Remove one each time a spirit answers a question.',
  },
  'witch-circle': {
    id: 'witch-circle',
    classId: 'witch',
    label: 'Circle Tokens',
    kind: 'counter',
    defaultValue: 0,
    min: 0,
    help: 'Tokens from Circle of Power, equal to your Spellcast trait. Remove one each time you or an ally in the circle makes an action roll or evades.',
  },
  'witch-phase': {
    id: 'witch-phase',
    classId: 'witch',
    label: 'Lunar Phase',
    kind: 'counter',
    reset: 'session',
    defaultValue: 0,
    min: 0,
    max: 6,
    help: '0 means no phase has been recorded. At the start of each session roll a d6 and set that value; once per rest you can spend a Hope to increase it, wrapping a 6 to 1. Nothing is rolled automatically.',
  },
  'guardian-unstoppable': {
    id: 'guardian-unstoppable',
    classId: 'guardian',
    label: 'Unstoppable Die',
    kind: 'counter',
    defaultValue: 0,
    min: 0,
    reset: 'scene',
    help: '0 means you are not Unstoppable. Once per long rest, become Unstoppable with the die at 1; increase it after a damage roll deals at least 1 Hit Point. Remove it when it would exceed the die maximum or the scene ends.',
  },
  'guardian-unstoppable-used': {
    id: 'guardian-unstoppable-used',
    classId: 'guardian',
    label: 'Unstoppable Used',
    kind: 'toggle',
    defaultValue: false,
    reset: 'longRest',
    help: 'Unstoppable is once per long rest. This records the use only; its damage and condition effects stay manual.',
  },
  'druid-beastform': {
    id: 'druid-beastform',
    classId: 'druid',
    label: 'Beastform',
    kind: 'text',
    defaultValue: '',
    help: 'Record the Beastform you are currently in. It ends when you choose to revert or mark your last Hit Point, not on a scene change. Transforming and marking Stress stay manual.',
  },
  'rogue-cloaked': {
    id: 'rogue-cloaked',
    classId: 'rogue',
    label: 'Cloaked',
    kind: 'toggle',
    defaultValue: false,
    help: 'Whether you are currently Cloaked. It can linger while you stay stationary; attacks, moves, and line of sight change it by the rules and the toggle does not alter rolls.',
  },
  'sorcerer-channel-used': {
    id: 'sorcerer-channel-used',
    classId: 'sorcerer',
    label: 'Channel Raw Power Used',
    kind: 'toggle',
    defaultValue: false,
    reset: 'longRest',
    help: 'Channel Raw Power is once per long rest: move a loadout card to your vault, then gain Hope or a damage bonus. This records the use only.',
  },
  'sorcerer-element': {
    id: 'sorcerer-element',
    classId: 'sorcerer',
    label: 'Element',
    kind: 'text',
    defaultValue: '',
    help: 'The element chosen at character creation for Elemental Origin (air, earth, fire, lightning, or water). Its effects stay manual.',
  },
  'sorcerer-charged': {
    id: 'sorcerer-charged',
    classId: 'sorcerer',
    label: 'Charged',
    kind: 'toggle',
    defaultValue: false,
    reset: 'longRest',
    help: 'Arcane Charge: become Charged from magic damage or by spending 2 Hope. Clear it at your next long rest; the damage or difficulty bonus stays manual.',
  },
  'bard-rally-used': {
    id: 'bard-rally-used',
    classId: 'bard',
    label: 'Rally Used',
    kind: 'toggle',
    defaultValue: false,
    reset: 'session',
    help: 'Rally is once per session. This records that you handed out Rally Dice; spending a die and its result stay manual.',
  },
  'bard-rally-held': {
    id: 'bard-rally-held',
    classId: 'bard',
    label: 'Rally Die Held',
    kind: 'toggle',
    defaultValue: false,
    reset: 'session',
    help: 'Whether this character still holds their own unspent Rally Die. Spending it manually; unspent dice clear at the end of the session.',
  },
  'ranger-focus': {
    id: 'ranger-focus',
    classId: 'ranger',
    label: "Ranger's Focus",
    kind: 'text',
    defaultValue: '',
    help: "The target of your current Ranger's Focus. The printed feature ends only when you make a different creature your Focus or choose to end it; it does not reset on a rest.",
  },
  'ranger-companion-name': {
    id: 'ranger-companion-name',
    classId: 'ranger',
    label: 'Companion Name',
    kind: 'text',
    defaultValue: '',
    help: 'The name of your Beastbound companion. Naming and roleplay stay manual.',
  },
  'ranger-companion-evasion': {
    id: 'ranger-companion-evasion',
    classId: 'ranger',
    label: 'Companion Evasion',
    kind: 'counter',
    defaultValue: 10,
    min: 0,
    help: 'Companion Evasion starts at 10. Apply training and other bonuses manually.',
  },
  'ranger-companion-stress': {
    id: 'ranger-companion-stress',
    classId: 'ranger',
    label: 'Companion Stress',
    kind: 'counter',
    defaultValue: 0,
    min: 0,
    max: MAX_COMPANION_STRESS,
    help: 'When the companion takes any damage they mark a Stress; at their last Stress they leave the scene. They return with 1 Stress cleared after your next long rest.',
  },
  'ranger-companion-attack': {
    id: 'ranger-companion-attack',
    classId: 'ranger',
    label: 'Companion Attack',
    kind: 'text',
    defaultValue: '',
    help: "Describe the companion's standard attack. At level 1 its damage die is d6 and its range is Melee; attack rolls stay manual.",
  },
  'ranger-companion-range': {
    id: 'ranger-companion-range',
    classId: 'ranger',
    label: 'Companion Range',
    kind: 'text',
    defaultValue: '',
    help: "The companion's attack range. It starts at Melee and can rise through training; nothing is applied automatically.",
  },
  'ranger-companion-experiences': {
    id: 'ranger-companion-experiences',
    classId: 'ranger',
    label: 'Companion Experiences',
    kind: 'list',
    defaultValue: [],
    max: MAX_COMPANION_EXPERIENCES,
    help: 'Companion Experiences start at +2 each. When you gain a new Experience, add one for the companion as well.',
  },
  'ranger-companion-training': {
    id: 'ranger-companion-training',
    classId: 'ranger',
    label: 'Companion Training',
    kind: 'selection',
    defaultValue: [],
    max: COMPANION_TRAINING.length,
    options: COMPANION_TRAINING,
    help: 'Mark one available option whenever your character levels up, plus the extra choices from Expert Training and Advanced Training. Options with numbered ranks may be chosen once per rank. Benefits stay manual.',
  },
  'seraph-prayer-dice': {
    id: 'seraph-prayer-dice',
    classId: 'seraph',
    label: 'Prayer Dice',
    kind: 'dice',
    defaultValue: [],
    reset: 'session',
    help: 'Unspent d4 Prayer Dice. At session start roll one per point of Spellcast; unspent dice clear at session end. Spending a die stays manual.',
  },
} satisfies Record<string, ClassResourceDefinition>;

type BaseId = keyof typeof BASE;

function template(id: BaseId): ClassResourceDefinition {
  return { ...BASE[id] };
}

interface OwnedTrack {
  classId: string;
  subclassId: string | null;
  /** 0 foundation, 1 specialization, 2 mastery. Multiclass tracks never advance. */
  stage: number;
}

function ownedTracks(sheet: Sheet): OwnedTrack[] {
  const primaryStage = Math.max(0, Math.min(2, Math.trunc(sheet.subclassUpgraded || 0)));
  const tracks: OwnedTrack[] = [
    { classId: sheet.classId, subclassId: sheet.subclassId, stage: primaryStage },
  ];
  if (sheet.multiclassId && sheet.multiclassId !== sheet.classId) {
    // A multiclass only ever contributes its foundation, whatever the primary subclass has reached.
    tracks.push({
      classId: sheet.multiclassId,
      subclassId: sheet.multiclassSubclassId ?? null,
      stage: 0,
    });
  }
  return tracks;
}

function stanceTierLimit(sheet: Sheet): number {
  return tierForLevel(sheet.level);
}

function allowedStances(sheet: Sheet): MartialStance[] {
  const limit = stanceTierLimit(sheet);
  return MARTIAL_STANCES.filter((stance) => stance.tier <= limit);
}

function brawlerStanceMax(sheet: Sheet): number {
  return Math.max(1, Math.floor(sheet.level) + 1);
}

function spellTraitMax(sheet: Sheet): number {
  return Math.max(0, Math.trunc(spellcastTraitValue(sheet)));
}

/** Unknown Spellcast (for example a legacy Seraph with no subclass) must not erase saved dice. */
function prayerDiceMax(sheet: Sheet): number | null {
  return spellcastTraitName(sheet) ? spellTraitMax(sheet) : null;
}

function withMax(definition: ClassResourceDefinition, max: number | null): ClassResourceDefinition {
  return max === null ? definition : { ...definition, max };
}

function hexMax(sheet: Sheet): number {
  return spellTraitMax(sheet);
}

function unstoppableDieMax(sheet: Sheet): number {
  return sheet.level >= 5 ? 6 : 4;
}

function knownStanceIds(sheet: Sheet): string[] {
  const allowed = allowedStances(sheet).map((stance) => stance.id);
  return normalizeIdList(sheet.resources?.classResources?.['brawler-stances'], allowed, brawlerStanceMax(sheet));
}

function stanceOptions(sheet: Sheet): { id: string; label: string }[] {
  return allowedStances(sheet).map((stance) => ({ id: stance.id, label: stance.label }));
}

function knownStanceOptions(sheet: Sheet): { id: string; label: string }[] {
  const known = new Set(knownStanceIds(sheet));
  return MARTIAL_STANCES.filter((stance) => known.has(stance.id)).map((stance) => ({
    id: stance.id,
    label: stance.label,
  }));
}

function trackDefinitions(sheet: Sheet, track: OwnedTrack): ClassResourceDefinition[] {
  switch (track.classId) {
    case 'warlock': {
      const definitions: ClassResourceDefinition[] = [
        template('warlock-patron'),
        template('warlock-sphere'),
        template('warlock-favor'),
      ];
      if (track.subclassId === 'pact-of-the-endless') definitions.push(template('warlock-mantle'));
      if (track.subclassId === 'pact-of-the-wrathful') definitions.push(template('warlock-fury'));
      return definitions;
    }
    case 'brawler': {
      if (track.subclassId !== 'martial-artist') return [];
      return [
        template('brawler-focus'),
        {
          ...template('brawler-stances'),
          max: brawlerStanceMax(sheet),
          options: stanceOptions(sheet),
        },
        { ...template('brawler-active-stance'), options: knownStanceOptions(sheet) },
        template('brawler-focus-used'),
      ];
    }
    case 'assassin': {
      const definitions: ClassResourceDefinition[] = [template('assassin-mark')];
      if (track.subclassId === 'poisoners-guild') definitions.push(template('assassin-poison'));
      return definitions;
    }
    case 'witch': {
      const definitions: ClassResourceDefinition[] = [
        { ...template('witch-hexes'), max: hexMax(sheet) },
        template('witch-commune-used'),
      ];
      if (track.subclassId === 'hedge') {
        definitions.push(template('witch-talisman'), template('witch-talisman-used'));
        if (track.stage >= 1) {
          definitions.push({ ...template('witch-spirit'), max: spellTraitMax(sheet) });
        }
        if (track.stage >= 2) {
          definitions.push({ ...template('witch-circle'), max: spellTraitMax(sheet) });
        }
      }
      if (track.subclassId === 'moon' && track.stage >= 2) definitions.push(template('witch-phase'));
      return definitions;
    }
    case 'guardian':
      return [
        { ...template('guardian-unstoppable'), max: unstoppableDieMax(sheet) },
        template('guardian-unstoppable-used'),
      ];
    case 'druid':
      return [template('druid-beastform')];
    case 'rogue':
      return [template('rogue-cloaked')];
    case 'sorcerer': {
      const definitions: ClassResourceDefinition[] = [template('sorcerer-channel-used')];
      if (track.subclassId === 'elemental-origin') definitions.push(template('sorcerer-element'));
      if (track.subclassId === 'primal-origin' && track.stage >= 2) {
        definitions.push(template('sorcerer-charged'));
      }
      return definitions;
    }
    case 'bard':
      return [template('bard-rally-used'), template('bard-rally-held')];
    case 'ranger': {
      const definitions: ClassResourceDefinition[] = [template('ranger-focus')];
      if (track.subclassId === 'beastbound') {
        definitions.push(
          template('ranger-companion-name'),
          template('ranger-companion-evasion'),
          template('ranger-companion-stress'),
          template('ranger-companion-attack'),
          template('ranger-companion-range'),
          template('ranger-companion-experiences'),
          template('ranger-companion-training'),
        );
      }
      return definitions;
    }
    case 'seraph':
      return [withMax(template('seraph-prayer-dice'), prayerDiceMax(sheet))];
    default:
      return [];
  }
}

/**
 * Every tracker owned by the character: primary class first, then a multiclass foundation.
 * Subclass-locked trackers only appear for the chosen subclass and stage.
 */
export function classResourceDefinitions(sheet: Sheet): ClassResourceDefinition[] {
  const definitions: ClassResourceDefinition[] = [];
  const seen = new Set<string>();
  for (const track of ownedTracks(sheet)) {
    for (const definition of trackDefinitions(sheet, track)) {
      if (seen.has(definition.id)) continue;
      seen.add(definition.id);
      definitions.push(definition);
    }
  }
  return definitions;
}

function clampNumber(definition: ClassResourceDefinition, value: number): number {
  const fallback =
    typeof definition.defaultValue === 'number' && Number.isFinite(definition.defaultValue)
      ? definition.defaultValue
      : 0;
  const raw = Number.isFinite(value) ? Math.trunc(value) : fallback;
  const min = typeof definition.min === 'number' && Number.isFinite(definition.min) ? definition.min : 0;
  const max =
    typeof definition.max === 'number' && Number.isFinite(definition.max)
      ? Math.max(min, definition.max)
      : Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, raw));
}

function normalizeList(value: unknown, max?: number): string[] {
  const raw = Array.isArray(value) ? value : [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const entry = item.trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  if (typeof max === 'number' && Number.isFinite(max)) return result.slice(0, Math.max(0, Math.trunc(max)));
  return result;
}

function normalizeIdList(value: unknown, allowed: readonly string[], max?: number): string[] {
  const allowedSet = new Set(allowed);
  const raw = Array.isArray(value) ? value : [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id) || !allowedSet.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  if (typeof max === 'number' && Number.isFinite(max)) return result.slice(0, Math.max(0, Math.trunc(max)));
  return result;
}

function normalizeChoice(definition: ClassResourceDefinition, value: unknown): string {
  if (typeof value !== 'string') return '';
  const choice = value.trim();
  if (!choice) return '';
  const options = definition.options ?? [];
  return options.some((option) => option.id === choice) ? choice : '';
}

function normalizeDice(definition: ClassResourceDefinition, value: unknown): number[] {
  const raw = Array.isArray(value) ? value : [];
  const faces: number[] = [];
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isFinite(item)) continue;
    faces.push(Math.min(PRAYER_DIE_FACES, Math.max(1, Math.trunc(item))));
  }
  if (typeof definition.max === 'number' && Number.isFinite(definition.max)) {
    return faces.slice(0, Math.max(0, Math.trunc(definition.max)));
  }
  return faces;
}

function normalizeValue(definition: ClassResourceDefinition, value: unknown): ClassResourceValue {
  switch (definition.kind) {
    case 'counter':
      return clampNumber(definition, typeof value === 'number' ? value : Number.NaN);
    case 'text':
      return typeof value === 'string' ? value : String(definition.defaultValue);
    case 'toggle':
      return typeof value === 'boolean' ? value : definition.defaultValue === true;
    case 'list':
      return normalizeList(value, definition.max);
    case 'choice':
      return normalizeChoice(definition, value);
    case 'selection':
      return normalizeIdList(value, (definition.options ?? []).map((option) => option.id), definition.max);
    case 'dice':
      return normalizeDice(definition, value);
    default:
      return definition.defaultValue;
  }
}

/**
 * The current value of one tracker. Old sheets and missing keys fall back to the printed default.
 * Ranger's Focus and Prayer Dice read and write the legacy resources fields, never a duplicate.
 */
export function classResourceValue(sheet: Sheet, id: string): ClassResourceValue {
  const definition = classResourceDefinitions(sheet).find((entry) => entry.id === id);
  if (!definition) {
    const fallback = (BASE as Record<string, ClassResourceDefinition>)[id];
    return fallback ? fallback.defaultValue : '';
  }
  const alias = ALIAS_FIELDS[id];
  const source = alias ? sheet.resources?.[alias] : sheet.resources?.classResources?.[id];
  return normalizeValue(definition, source === undefined ? definition.defaultValue : source);
}

/**
 * Records a tracker value with sanitized input. Unknown or unavailable ids leave the sheet
 * untouched, and unrelated trackers (including unknown saved keys) are preserved.
 */
export function setClassResource(sheet: Sheet, id: string, value: ClassResourceValue): Sheet {
  const definition = classResourceDefinitions(sheet).find((entry) => entry.id === id);
  if (!definition) return sheet;
  const normalized = normalizeValue(definition, value);
  const resources: SheetResources = { ...(sheet.resources ?? {}) };
  const alias = ALIAS_FIELDS[id];
  if (alias === 'focusTargetId') {
    const target = typeof normalized === 'string' ? normalized.trim() : '';
    resources.focusTargetId = target || null;
  } else if (alias === 'prayerDice') {
    resources.prayerDice = Array.isArray(normalized)
      ? normalized.filter((face): face is number => typeof face === 'number')
      : [];
  } else {
    resources.classResources = { ...(resources.classResources ?? {}), [id]: normalized };
  }
  return { ...sheet, resources };
}

function resetApplies(
  reset: NonNullable<ClassResourceDefinition['reset']>,
  event: 'rest' | 'longRest' | 'scene' | 'session',
): boolean {
  if (reset === event) return true;
  // A long rest also clears everything a short rest clears.
  return event === 'longRest' && reset === 'rest';
}

/**
 * Clears transient trackers for a rest, scene end, or session end. Persistent choices such as
 * Favor, the patron name, known stances, and Hexed targets are retained.
 */
export function resetClassResources(
  sheet: Sheet,
  event: 'rest' | 'longRest' | 'scene' | 'session',
): Sheet {
  const definitions = classResourceDefinitions(sheet);
  let next = sheet;
  for (const definition of definitions) {
    if (!definition.reset || !resetApplies(definition.reset, event)) continue;
    next = setClassResource(next, definition.id, definition.defaultValue);
  }
  return next;
}

function comboDie(sheet: Sheet): string {
  // The Combo Die starts at d4 and rises one step for each recorded Combo Die advancement.
  const history =
    sheet.advancementHistory ?? sheet.advancements.map((advancement) => ({ level: sheet.level, advancement }));
  const upgrades = Math.min(3, Math.max(0, history.filter((entry) => entry.advancement === 'combo-die').length));
  return `d${4 + 2 * upgrades}`;
}

function patronDie(sheet: Sheet): string {
  return sheet.level >= 5 ? 'd8' : 'd6';
}

function unstoppableDie(sheet: Sheet): string {
  return sheet.level >= 5 ? 'd6' : 'd4';
}

function rallyDie(sheet: Sheet, tracks: OwnedTrack[]): string {
  const epicPoetry = tracks.some(
    (track) => track.classId === 'bard' && track.subclassId === 'wordsmith' && track.stage >= 2,
  );
  if (epicPoetry) return 'd10';
  return sheet.level >= 5 ? 'd8' : 'd6';
}

function stanceLabel(id: string): string {
  return MARTIAL_STANCES.find((stance) => stance.id === id)?.label ?? id;
}

function currentNumber(sheet: Sheet, id: string): number {
  const value = classResourceValue(sheet, id);
  return typeof value === 'number' ? value : 0;
}

function currentText(sheet: Sheet, id: string): string {
  const value = classResourceValue(sheet, id);
  return typeof value === 'string' ? value : '';
}

function currentCount(sheet: Sheet, id: string): number {
  const value = classResourceValue(sheet, id);
  return Array.isArray(value) ? value.length : 0;
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function spellcastLine(sheet: Sheet): string | null {
  const trait = spellcastTraitName(sheet);
  if (!trait) return null;
  return `${titleCase(trait)} ${Math.max(0, spellcastTraitValue(sheet))}`;
}

/**
 * Derived readouts for the character sheet: die sizes from progression and counts from the
 * current trackers. These are display facts only; nothing here rolls or spends anything.
 */
export function classResourceFacts(sheet: Sheet): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  const tracks = ownedTracks(sheet);
  for (const track of tracks) {
    switch (track.classId) {
      case 'brawler': {
        facts.push({ label: 'Combo Die', value: comboDie(sheet) });
        if (track.subclassId === 'martial-artist') {
          facts.push({
            label: 'Known Stances',
            value: `${currentCount(sheet, 'brawler-stances')} / ${brawlerStanceMax(sheet)}`,
          });
          const active = currentText(sheet, 'brawler-active-stance');
          facts.push({ label: 'Active Stance', value: active ? stanceLabel(active) : 'None' });
        }
        break;
      }
      case 'warlock': {
        facts.push({ label: 'Patron Die', value: patronDie(sheet) });
        facts.push({ label: 'Favor', value: `${currentNumber(sheet, 'warlock-favor')} / ${MAX_FAVOR}` });
        break;
      }
      case 'bard': {
        facts.push({ label: 'Rally Die', value: rallyDie(sheet, tracks) });
        break;
      }
      case 'guardian': {
        facts.push({ label: 'Unstoppable Die', value: unstoppableDie(sheet) });
        break;
      }
      case 'seraph': {
        const spellcast = spellcastLine(sheet);
        if (spellcast) facts.push({ label: `${titleCase(track.classId)} Spellcast`, value: spellcast });
        const maxDice = prayerDiceMax(sheet);
        facts.push({
          label: 'Prayer Dice',
          value: `${maxDice ?? currentCount(sheet, 'seraph-prayer-dice')}d4`,
        });
        break;
      }
      case 'witch': {
        const spellcast = spellcastLine(sheet);
        if (spellcast) facts.push({ label: `${titleCase(track.classId)} Spellcast`, value: spellcast });
        facts.push({ label: 'Hexed Targets', value: `${currentCount(sheet, 'witch-hexes')} / ${hexMax(sheet)}` });
        break;
      }
      case 'ranger': {
        const focus = currentText(sheet, 'ranger-focus');
        facts.push({ label: 'Focus', value: focus || 'None' });
        break;
      }
      case 'assassin': {
        const mark = currentText(sheet, 'assassin-mark');
        facts.push({ label: 'Marked for Death', value: mark || 'None' });
        break;
      }
      case 'druid': {
        const form = currentText(sheet, 'druid-beastform');
        facts.push({ label: 'Beastform', value: form || 'None' });
        break;
      }
      case 'rogue': {
        facts.push({ label: 'Cloaked', value: classResourceValue(sheet, 'rogue-cloaked') === true ? 'Yes' : 'No' });
        break;
      }
      case 'sorcerer': {
        const used = classResourceValue(sheet, 'sorcerer-channel-used') === true;
        facts.push({ label: 'Channel Raw Power', value: used ? 'Used' : 'Available' });
        break;
      }
      default:
        break;
    }
  }
  return facts;
}
