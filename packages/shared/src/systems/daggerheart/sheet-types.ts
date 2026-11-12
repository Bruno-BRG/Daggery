import type { TraitName, Traits } from '../../types';

/** A starting/level-up Experience. SRD: two at creation, both at +2. */
export interface Experience {
  id: string;
  name: string;
  modifier: number;
}

export type WeaponSlot = 'primary' | 'secondary';

/** An equipped weapon. Catalog gear is looked up in @daggery/content by id; player-made gear
 * carries its stats on the source inventory entry, found through `equipmentId`. */
export interface SheetWeapon {
  weaponId: string;
  slot: WeaponSlot;
}

export type InventoryKind = 'item' | 'consumable' | 'weapon' | 'armor' | 'custom';

/**
 * Full stats for a weapon the player invented. Stored inline on the inventory entry so it keeps
 * working without a content-catalog entry. Matches the @daggery/content weapon shape.
 */
export interface InlineWeapon {
  id: string;
  name: string;
  category: string;
  tier: number;
  trait: string;
  range: string;
  damage: string;
  damageType: string;
  burden: string;
  feature?: { name: string; text: string } | null;
}

/** Full stats for armor the player invented. Matches the @daggery/content armor shape. */
export interface InlineArmor {
  id: string;
  name: string;
  tier: number;
  baseThresholds: { major: number; severe: number };
  baseScore: number;
  feature?: { name: string; text: string } | null;
}

export interface InventoryEntry {
  id: string;
  name: string;
  kind: InventoryKind;
  qty: number;
  description?: string;
  /** Source item in the inventory catalog (including consumables and adventuring gear). */
  catalogId?: string;
  /** Optional decorative icon chosen for a custom item. Older sheets infer it from the item. */
  icon?: string;
  /** Catalog identity for stowed gear, allowing it to be equipped again. For player-made gear
   * this is the inline weapon/armor id instead of a catalog id. */
  equipmentId?: string;
  /** Damage belongs to this armor, including while it is stowed. */
  armorSlotsMarked?: number;
  /** Inline stats for a player-made weapon (kind 'weapon'). Absent on catalog gear. */
  weapon?: InlineWeapon;
  /** Inline stats for player-made armor (kind 'armor'). Absent on catalog gear. */
  armor?: InlineArmor;
}

export interface BackgroundAnswer {
  question: string;
  answer: string;
}

/**
 * Class-feature resources that live on the sheet. Optional so sheets saved before these
 * features existed stay valid. They persist with the whole sheet document.
 */
/** A downtime project tracked as a progress countdown (Core Rulebook p. 181). */
export interface SheetProject {
  id: string;
  name: string;
  /** The countdown's starting value. */
  start: number;
  /** Remaining progress; the project completes at 0. */
  value: number;
}

/**
 * A manual class-resource tracker value. Numeric trackers are counters, text trackers hold a
 * target or form name, toggles record state, and the array forms hold selected ids or dice faces.
 */
export type ClassResourceValue = string | number | boolean | string[] | number[];

export interface SheetResources {
  /** The adversary this hero's Ranger's Focus feature currently marks. */
  focusTargetId?: string | null;
  /** Face values of the Seraph's unspent Prayer Dice (d4s). */
  prayerDice?: number[];
  /** The session chat whose opening rolled the session-start features. Guards against a second roll. */
  featuresStartedFor?: string | null;
  /**
   * Manual class-feature trackers keyed by resource id (see class-resources.ts). Older sheets
   * leave this undefined; the shared helpers supply each resource's printed default.
   */
  classResources?: Record<string, ClassResourceValue>;
}

export type DamageSeverity = 'none' | 'minor' | 'major' | 'severe' | 'massive';

/**
 * Everything the Sheets module persists for one character. Kept inside this folder (not in
 * packages/shared) so the module can evolve without touching the other modules.
 */
export interface Sheet {
  id: string;
  name: string;
  playerName: string;
  /** Shared campaign images uploaded for this character. Older sheets use class art. */
  portraitUrl?: string;
  bannerUrl?: string;
  tokenUrl?: string;
  /** 1..10. */
  level: number;
  /** Damage dice count for weapon attacks. Starts at 1, raised by advancements. */
  proficiency: number;
  classId: string;
  subclassId: string | null;
  ancestryId: string | null;
  /**
   * Mixed Ancestry (Core Rulebook p. 71): a second lineage. The character takes the first
   * feature of one ancestry and the second feature of the other.
   */
  mixedAncestryId?: string | null;
  /** Which lineage supplies the first feature when the ancestry is mixed. */
  ancestryFeatureOrder?: 'primary-first' | 'mixed-first';
  /** Custom heritage label, e.g. "Goblin-Orc" (Core Rulebook, Mixed Ancestry step 1). */
  heritageName?: string | null;
  /** Spellcast trait override chosen after multiclassing (Core Rulebook p. 111). */
  spellcastTraitOverride?: TraitName | null;
  communityId: string | null;
  traits: Traits;
  /** Traits raised since the last tier reset; resets at levels 5 and 8. */
  traitMarks: (keyof Traits)[];
  /** Permanent Evasion bonuses from advancements. */
  evasionBonus: number;
  armorId: string | null;
  armorSlotsMarked: number;
  hpMarked: number;
  stressMarked: number;
  /** Current Hope, 0..6. */
  hope: number;
  /** Permanent extra HP slots from advancements. */
  bonusHpSlots: number;
  /** Permanent extra Stress slots from advancements. */
  bonusStressSlots: number;
  /** Manually recorded HP slots from items, transformations, or other effects. */
  extraHpSlots?: number;
  /** Manually recorded Stress slots from items, transformations, or other effects. */
  extraStressSlots?: number;
  experiences: Experience[];
  weapons: SheetWeapon[];
  inventory: InventoryEntry[];
  /** Gold in "handfuls" (the SRD keeps gold abstract). */
  gold: number;
  /** Every domain card the character owns, loadout + vault. */
  domainCardIds: string[];
  /** Up to 5 active domain cards. */
  loadoutIds: string[];
  background: BackgroundAnswer[];
  connections: BackgroundAnswer[];
  notes: string;
  /** 0 = foundation, 1 = specialization, 2 = mastery. */
  subclassUpgraded: number;
  /** Multiclass class chosen at level 5+ (Core Rulebook p. 111). Once per character. */
  multiclassId: string | null;
  /** The single domain taken from the multiclass class. */
  multiclassDomain?: string | null;
  /** Foundation subclass from the multiclass class, placed in the loadout. */
  multiclassSubclassId?: string | null;
  /** Advancement ids already chosen at the current level (two per level). */
  advancements: string[];
  /** Current class-feature resources and targets. Absent on older sheets. */
  resources?: SheetResources;
  /** Short rests taken since the last long rest (Core Rulebook p. 106: at most three). */
  shortRestsSinceLong?: number;
  /** Long-rest projects tracked as progress countdowns (Core Rulebook p. 181). */
  projects?: SheetProject[];
  /**
   * History of advancements taken, used to enforce once-per-tier options (Core Rulebook
   * level-up sheet). Optional for backward compatibility with older sheets.
   */
  advancementHistory?: Array<{ level: number; advancement: string }>;
  createdAt: string;
  updatedAt: string;
}
