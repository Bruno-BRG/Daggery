import {
  ancestries,
  armor,
  cardsIndex,
  classes,
  communities,
  consumables,
  domainCards,
  items,
  weapons,
  cardUrl,
} from '@daggery/content';
import type { DualityResult } from '../../dice';
import type { TraitName, Traits } from '../../types';
import type { DamageSeverity, Sheet } from './sheet-types';

export const TRAIT_ORDER: TraitName[] = [
  'agility',
  'strength',
  'finesse',
  'instinct',
  'presence',
  'knowledge',
];

export const TRAIT_LABELS: Record<TraitName, string> = {
  agility: 'Agility',
  strength: 'Strength',
  finesse: 'Finesse',
  instinct: 'Instinct',
  presence: 'Presence',
  knowledge: 'Knowledge',
};

/** Character-creation array used by the wizard (task spec). */
export const STARTING_TRAIT_VALUES = [2, 1, 1, 0, 0, -1] as const;

export function swapTraits(traits: Traits, first: TraitName, second: TraitName): Traits {
  return { ...traits, [first]: traits[second], [second]: traits[first] };
}

export function hasStartingTraits(traits: Traits): boolean {
  const actual = TRAIT_ORDER.map((trait) => traits[trait]).sort((a, b) => a - b);
  const expected = [...STARTING_TRAIT_VALUES].sort((a, b) => a - b);
  return actual.every((value, index) => value === expected[index]);
}

export const MAX_HOPE = 6;
export const MAX_HP = 12;
export const MAX_STRESS = 12;
export const MAX_LOADOUT = 5;
export const MAX_LEVEL = 10;
export const MAX_ARMOR_SCORE = 12;

export const RANGE_LABELS: Record<string, string> = {
  Melee: 'Melee',
  'Very Close': 'Very Close',
  Close: 'Close',
  Far: 'Far',
  'Very Far': 'Very Far',
};

export const DOMAIN_LABELS: Record<string, string> = {
  arcana: 'Arcana',
  blade: 'Blade',
  bone: 'Bone',
  codex: 'Codex',
  dread: 'Dread',
  grace: 'Grace',
  midnight: 'Midnight',
  sage: 'Sage',
  splendor: 'Splendor',
  valor: 'Valor',
};

export type ClassEntry = (typeof classes)[number];
export type SubclassEntry = ClassEntry['subclasses'][number];
export type AncestryEntry = (typeof ancestries)[number];
export type CommunityEntry = (typeof communities)[number];
export type ArmorEntry = (typeof armor)[number];
export type WeaponEntry = (typeof weapons)[number];
export type DomainCardEntry = (typeof domainCards)[number];
export type ContentItem = (typeof items)[number];
export type Consumable = (typeof consumables)[number];

export function tierForLevel(level: number): 1 | 2 | 3 | 4 {
  if (level >= 8) return 4;
  if (level >= 5) return 3;
  if (level >= 2) return 2;
  return 1;
}

export function tierLabel(level: number): string {
  return `Tier ${tierForLevel(level)}`;
}

export function getClass(id: string | null | undefined): ClassEntry | undefined {
  return id ? classes.find((entry) => entry.id === id) : undefined;
}

export function getSubclass(
  classId: string | null | undefined,
  subclassId: string | null | undefined,
): SubclassEntry | undefined {
  const cls = getClass(classId);
  return cls && subclassId ? cls.subclasses.find((entry) => entry.id === subclassId) : undefined;
}

export function getAncestry(id: string | null | undefined): AncestryEntry | undefined {
  return id ? ancestries.find((entry) => entry.id === id) : undefined;
}

export function getCommunity(id: string | null | undefined): CommunityEntry | undefined {
  return id ? communities.find((entry) => entry.id === id) : undefined;
}

export function getArmor(id: string | null | undefined): ArmorEntry | undefined {
  return id ? armor.find((entry) => entry.id === id) : undefined;
}

export function getWeapon(id: string | null | undefined): WeaponEntry | undefined {
  return id ? weapons.find((entry) => entry.id === id) : undefined;
}

export function getDomainCard(id: string | null | undefined): DomainCardEntry | undefined {
  return id ? domainCards.find((entry) => entry.id === id) : undefined;
}

export function getItem(id: string | null | undefined): ContentItem | undefined {
  return id ? items.find((entry) => entry.id === id) : undefined;
}

export function getConsumable(id: string | null | undefined): Consumable | undefined {
  return id ? consumables.find((entry) => entry.id === id) : undefined;
}

export function startingWeapons(): WeaponEntry[] {
  return weapons.filter((entry) => entry.tier === 1);
}

export function startingArmor(): ArmorEntry[] {
  return armor.filter((entry) => entry.tier === 1);
}

/** The single domain granted by the multiclass class, if any. */
export function multiclassDomain(sheet: Sheet): string | null {
  if (!sheet.multiclassId) return null;
  const cls = getClass(sheet.multiclassId);
  if (!cls) return null;
  if (sheet.multiclassDomain && cls.domains.includes(sheet.multiclassDomain)) {
    return sheet.multiclassDomain;
  }
  // Legacy sheets stored only the class; keep every domain accessible.
  return null;
}

/** All domains a character can pick cards from. */
export function accessibleDomains(sheet: Sheet): string[] {
  const domains = new Set<string>();
  const cls = getClass(sheet.classId);
  cls?.domains.forEach((domain) => domains.add(domain));
  const chosen = multiclassDomain(sheet);
  if (chosen) domains.add(chosen);
  else getClass(sheet.multiclassId)?.domains.forEach((domain) => domains.add(domain));
  return [...domains];
}

/**
 * Cards from the character's domains up to `level`, not owned yet. Multiclass domain cards are
 * limited to half the character's level (rounded up), per the Core Rulebook.
 */
export function eligibleDomainCards(sheet: Sheet, level: number): DomainCardEntry[] {
  const domains = accessibleDomains(sheet);
  const chosen = multiclassDomain(sheet);
  const multiclassCap = Math.ceil(level / 2);
  const owned = new Set(sheet.domainCardIds);
  return domainCards.filter((card) => {
    if (!domains.includes(card.domain) || owned.has(card.id)) return false;
    const cap = chosen && card.domain === chosen ? multiclassCap : level;
    return card.level <= cap;
  });
}

export interface HeritageFeature {
  name: string;
  text: string;
  ancestryId: string;
  ancestryName: string;
}

/**
 * Features granted by the character's heritage. A mixed ancestry takes the first feature of one
 * ancestry and the second feature of the other (Core Rulebook p. 71).
 */
export function ancestryFeatures(sheet: Sheet): HeritageFeature[] {
  const primary = getAncestry(sheet.ancestryId);
  const mixed = getAncestry(sheet.mixedAncestryId);
  const describe = (entry: AncestryEntry) =>
    entry.features.map((feature) => ({
      ...feature,
      ancestryId: entry.id,
      ancestryName: entry.name,
    }));
  if (!primary) return [];
  if (!mixed || mixed.id === primary.id) return describe(primary);
  const firstFromPrimary = sheet.ancestryFeatureOrder !== 'mixed-first';
  if (firstFromPrimary) {
    const first = primary.features[0];
    const second = mixed.features[1];
    return [
      first && { ...first, ancestryId: primary.id, ancestryName: primary.name },
      second && { ...second, ancestryId: mixed.id, ancestryName: mixed.name },
    ].filter((feature): feature is HeritageFeature => !!feature);
  }
  const first = mixed.features[0];
  const second = primary.features[1];
  return [
    first && { ...first, ancestryId: mixed.id, ancestryName: mixed.name },
    second && { ...second, ancestryId: primary.id, ancestryName: primary.name },
  ].filter((feature): feature is HeritageFeature => !!feature);
}

/** Display name for the heritage (Core Rulebook, Mixed Ancestry step 1). */
export function heritageDisplayName(sheet: Sheet): string {
  if (sheet.heritageName?.trim()) return sheet.heritageName.trim();
  const names = sheetAncestries(sheet).map((entry) => entry.name);
  if (names.length === 0) return 'No heritage';
  if (names.length === 1) return names[0]!;
  return names.join('-');
}

export interface HeritageBonuses {
  evasionBonus: number;
  hpSlots: number;
  stressSlots: number;
  armorScoreBonus: number;
  thresholdsBonus: number;
  notes: string[];
}

/**
 * Automatic mechanical bonuses from the *selected* heritage features (Core Rulebook p. 71).
 * Only the chosen features count, so a mixed heritage does not grant both first features.
 * - Simiah Nimble: +1 Evasion | Giant Endurance: +1 HP slot | Human High Stamina: +1 Stress slot
 * - Earthkin Stoneskin: +1 Armor Score and +1 thresholds
 * Other heritage features (experience bonuses, advantages, special actions) remain manual.
 */
export function heritageBonuses(sheet: Sheet): HeritageBonuses {
  const bonuses: HeritageBonuses = {
    evasionBonus: 0,
    hpSlots: 0,
    stressSlots: 0,
    armorScoreBonus: 0,
    thresholdsBonus: 0,
    notes: [],
  };
  for (const feature of ancestryFeatures(sheet)) {
    const name = feature.name.toLowerCase();
    if (feature.ancestryId === 'simiah' && name === 'nimble') {
      bonuses.evasionBonus += 1;
      bonuses.notes.push('Simiah — Nimble: +1 Evasion');
    }
    if (feature.ancestryId === 'giant' && name === 'endurance') {
      bonuses.hpSlots += 1;
      bonuses.notes.push('Giant — Endurance: +1 Hit Point slot');
    }
    if (feature.ancestryId === 'human' && name === 'high stamina') {
      bonuses.stressSlots += 1;
      bonuses.notes.push('Human — High Stamina: +1 Stress slot');
    }
    if (feature.ancestryId === 'earthkin' && name === 'stoneskin') {
      bonuses.armorScoreBonus += 1;
      bonuses.thresholdsBonus += 1;
      bonuses.notes.push('Earthkin — Stoneskin: +1 Armor Score and +1 thresholds');
    }
  }
  return bonuses;
}

/** Both ancestries of a mixed heritage, primary first. */
export function sheetAncestries(sheet: Sheet): AncestryEntry[] {
  return [getAncestry(sheet.ancestryId), getAncestry(sheet.mixedAncestryId)].filter(
    (entry): entry is AncestryEntry => !!entry,
  );
}

export function traitNameFromWeapon(trait: string): TraitName | null {
  const label = trait.toLowerCase();
  return (TRAIT_ORDER as string[]).includes(label) ? (label as TraitName) : null;
}

function traitFromSpellcast(raw: string | null | undefined): TraitName | null {
  if (!raw) return null;
  const label = raw.toLowerCase();
  return (TRAIT_ORDER as string[]).includes(label) ? (label as TraitName) : null;
}

/** Spellcast traits available from the primary and multiclass subclasses (Core Rulebook p. 111). */
export function spellcastTraitOptions(sheet: Sheet): TraitName[] {
  const primary = traitFromSpellcast(getSubclass(sheet.classId, sheet.subclassId)?.spellcastTrait);
  const secondary = traitFromSpellcast(
    getSubclass(sheet.multiclassId, sheet.multiclassSubclassId)?.spellcastTrait,
  );
  const options: TraitName[] = [];
  if (primary) options.push(primary);
  if (secondary && secondary !== primary) options.push(secondary);
  return options;
}

/**
 * The Spellcast trait comes from the subclass. After multiclassing, the player may use either the
 * original subclass trait or the multiclass foundation trait (Core Rulebook p. 111). The
 * `spellcastTraitOverride` field stores that choice.
 */
export function spellcastTraitName(sheet: Sheet): TraitName | null {
  const options = spellcastTraitOptions(sheet);
  if (options.length === 0) return null;
  if (sheet.spellcastTraitOverride && options.includes(sheet.spellcastTraitOverride)) {
    return sheet.spellcastTraitOverride;
  }
  return options[0] ?? null;
}

export function spellcastTraitValue(sheet: Sheet): number {
  const trait = spellcastTraitName(sheet);
  return trait ? sheet.traits[trait] : 0;
}

/** Advancements that consume both level-up slots (Core Rulebook black box). */
export const DOUBLE_SLOT_ADVANCEMENTS = ['multiclass', 'proficiency'] as const;
export type DoubleSlotAdvancement = (typeof DOUBLE_SLOT_ADVANCEMENTS)[number];
export function isDoubleSlotAdvancement(id: string): boolean {
  return (DOUBLE_SLOT_ADVANCEMENTS as readonly string[]).includes(id);
}
/** A double-slot advancement must be the only pick that level. */
export function isValidPickCount(chosen: readonly string[]): boolean {
  if (chosen.length === 0) return false;
  const hasDoubleSlot = chosen.some((id) => isDoubleSlotAdvancement(id));
  if (hasDoubleSlot) return chosen.length === 1;
  return chosen.length === 2;
}

/** Maximum domain-card level from the multiclass domain (Core Rulebook p. 111). */
export function multiclassCardCap(sheet: Sheet): number {
  return Math.ceil(sheet.level / 2);
}

/** Whether a subclass can still be upgraded to mastery after multiclassing (it cannot). */
export function canGainMastery(sheet: Sheet, chosen: readonly string[] = []): boolean {
  if (sheet.subclassUpgraded >= 2) return false;
  if (sheet.multiclassId) return sheet.subclassUpgraded < 1;
  if (chosen.includes('multiclass')) return sheet.subclassUpgraded < 1;
  return true;
}

/** Attack modifier for a weapon: its trait, or the subclass Spellcast trait for Spellcast weapons. */
export function weaponModifier(sheet: Sheet, weapon: WeaponEntry): number {
  if (weapon.trait === 'Spellcast') return spellcastTraitValue(sheet);
  const trait = traitNameFromWeapon(weapon.trait);
  return trait ? sheet.traits[trait] : 0;
}

/** Sums explicit "+1 to Evasion" / "−1 to Evasion" modifiers from armor and weapon features. */
function featureModifierToEvasion(text: string | undefined): number {
  if (!text) return 0;
  const match = /([+−–-])\s*(\d+)\s+to\s+evasion/i.exec(text);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  return sign * Number(match[2]);
}

export function armorScore(sheet: Sheet): number {
  const equipped = getArmor(sheet.armorId);
  if (!equipped) return 0;
  const heritage = heritageBonuses(sheet).armorScoreBonus;
  return Math.min(MAX_ARMOR_SCORE, equipped.baseScore + heritage);
}

export function evasion(sheet: Sheet): number {
  const cls = getClass(sheet.classId);
  const base = cls?.startingEvasion ?? 10;
  let bonus = sheet.evasionBonus + heritageBonuses(sheet).evasionBonus;
  const equipped = getArmor(sheet.armorId);
  bonus += featureModifierToEvasion(equipped?.feature?.text);
  for (const weapon of getEquippedWeapons(sheet)) {
    bonus += featureModifierToEvasion(weapon.feature?.text);
  }
  return Math.max(0, base + bonus);
}

export interface Thresholds {
  major: number;
  severe: number;
}

/** Armor base thresholds + level (+ Spellcast trait for the "Enchanted" feature + Earthkin Stoneskin). */
export function damageThresholds(sheet: Sheet): Thresholds {
  const equipped = getArmor(sheet.armorId);
  const enchantBonus = equipped?.feature?.name === 'Enchanted' ? spellcastTraitValue(sheet) : 0;
  const heritage = heritageBonuses(sheet).thresholdsBonus;
  if (!equipped) {
    return {
      major: sheet.level + heritage + enchantBonus,
      severe: sheet.level * 2 + heritage + enchantBonus,
    };
  }
  return {
    major: equipped.baseThresholds.major + sheet.level + enchantBonus + heritage,
    severe: equipped.baseThresholds.severe + sheet.level + enchantBonus + heritage,
  };
}

export function hpMax(sheet: Sheet): number {
  const cls = getClass(sheet.classId);
  const heritage = heritageBonuses(sheet).hpSlots;
  return Math.min(MAX_HP, (cls?.startingHP ?? 6) + sheet.bonusHpSlots + heritage);
}

export function stressMax(sheet: Sheet): number {
  const heritage = heritageBonuses(sheet).stressSlots;
  return Math.min(MAX_STRESS, 6 + sheet.bonusStressSlots + heritage);
}

export function getEquippedWeapons(sheet: Sheet): WeaponEntry[] {
  return sheet.weapons
    .map((entry) => getWeapon(entry.weaponId))
    .filter((entry): entry is WeaponEntry => entry !== undefined);
}

export function weaponForSlot(sheet: Sheet, slot: 'primary' | 'secondary'): WeaponEntry | undefined {
  return getWeapon(sheet.weapons.find((entry) => entry.slot === slot)?.weaponId);
}

/** Turns a weapon damage string into the number of dice granted by Proficiency: d8+3 -> 2d8+3. */
export function damageNotation(weaponDamage: string, proficiency: number): string {
  const match = /^(\d*)d(\d+)(.*)$/i.exec(weaponDamage.trim());
  if (!match) return weaponDamage;
  const baseCount = Math.max(1, Number(match[1] || 1));
  const count = Math.max(1, proficiency) * baseCount;
  return `${count}d${match[2]}${match[3] ?? ''}`;
}

export type { DamageSeverity };

const SEVERITY_ORDER: DamageSeverity[] = ['none', 'minor', 'major', 'severe', 'massive'];
const SEVERITY_HP: Record<DamageSeverity, number> = {
  none: 0,
  minor: 1,
  major: 2,
  severe: 3,
  massive: 4,
};

export function damageSeverity(damage: number, thresholds: Thresholds): DamageSeverity {
  if (damage <= 0) return 'none';
  // Massive (optional SRD rule) applies when damage reaches 2x Severe.
  if (damage >= thresholds.severe * 2) return 'massive';
  if (damage >= thresholds.severe) return 'severe';
  if (damage >= thresholds.major) return 'major';
  return 'minor';
}

/** HP marked by a hit; using an Armor Slot reduces the severity by one threshold step. */
export function damageHp(severity: DamageSeverity, useArmor: boolean): number {
  let index = SEVERITY_ORDER.indexOf(severity);
  if (useArmor && index > 0) index -= 1;
  return SEVERITY_HP[SEVERITY_ORDER[index] ?? 'none'];
}

export const SEVERITY_LABELS: Record<DamageSeverity, string> = {
  none: 'None',
  minor: 'Minor',
  major: 'Major',
  severe: 'Severe',
  massive: 'Massive',
};

/**
 * Applies the Hope/Fear effects of a Duality roll (rules-notes.md):
 * with Hope -> +1 Hope; critical -> +1 Hope and clear 1 Stress; with Fear -> GM gains 1 Fear.
 * A critical counts as with Hope, but only grants one Hope.
 */
export function applyDualityEffects(
  sheet: Sheet,
  result: DualityResult,
): { sheet: Sheet; notes: string[] } {
  const notes: string[] = [];
  let hope = sheet.hope;
  let stressMarked = sheet.stressMarked;

  if (result.critical) {
    const before = hope;
    hope = Math.min(MAX_HOPE, hope + 1);
    notes.push(before < MAX_HOPE ? '+1 Hope (critical)' : 'Critical (Hope already at maximum)');
    if (stressMarked > 0) {
      stressMarked -= 1;
      notes.push('Clears 1 Stress (critical)');
    } else {
      notes.push('No Stress to clear (critical)');
    }
  } else if (result.withHope) {
    const before = hope;
    hope = Math.min(MAX_HOPE, hope + 1);
    notes.push(before < MAX_HOPE ? '+1 Hope' : 'With Hope (already at maximum)');
  }

  if (result.withFear) {
    notes.push('GM gains 1 Fear');
  }

  return { sheet: { ...sheet, hope, stressMarked }, notes };
}

/** Marks n Stress; overflow past the track marks HP instead (SRD). */
export function markStress(sheet: Sheet, amount: number): Sheet {
  const max = stressMax(sheet);
  let stressMarked = sheet.stressMarked + amount;
  let overflowHp = 0;
  if (stressMarked > max) {
    overflowHp = stressMarked - max;
    stressMarked = max;
  }
  return {
    ...sheet,
    stressMarked,
    hpMarked: Math.min(hpMax(sheet), sheet.hpMarked + overflowHp),
  };
}

export function clearStress(sheet: Sheet, amount: number): Sheet {
  return { ...sheet, stressMarked: Math.max(0, sheet.stressMarked - amount) };
}

export function clearHp(sheet: Sheet, amount: number): Sheet {
  return { ...sheet, hpMarked: Math.max(0, sheet.hpMarked - amount) };
}

export function clearArmor(sheet: Sheet, amount: number): Sheet {
  return { ...sheet, armorSlotsMarked: Math.max(0, sheet.armorSlotsMarked - amount) };
}

/** Card art lookup; returns undefined when the card has no extracted image. */
export function cardImage(id: string, kind?: 'domain' | 'subclass' | 'ancestry' | 'community'): string | undefined {
  const contentCard = kind === 'domain' ? getDomainCard(id) : undefined;
  const normalizeName = (name: string) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const entry = contentCard
    ? cardsIndex.find((card) => card.kind === 'domain' && card.domain === contentCard.domain && normalizeName(card.name) === normalizeName(contentCard.name))
    : cardsIndex.find((card) => card.id === id && (!kind || card.kind === kind));
  return entry ? cardUrl(entry.file) : undefined;
}

export function subclassImage(sheet: Sheet): string | undefined {
  if (!sheet.subclassId) return undefined;
  const stage = sheet.subclassUpgraded >= 2 ? 'mastery' : sheet.subclassUpgraded >= 1 ? 'specialization' : 'foundation';
  return cardImage(`${sheet.subclassId}-${stage}`, 'subclass');
}

/** Full-art class illustration used as the character sheet banner. */
export function classArt(classId: string | null | undefined): string | undefined {
  return classId ? cardUrl(`class/${classId}.webp`) : undefined;
}

export function makeId(prefix: string): string {
  const random = (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  return random ? `${prefix}-${random}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
