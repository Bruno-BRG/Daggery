import type { TraitName, Traits } from '../../types';

/** A starting/level-up Experience. SRD: two at creation, both at +2. */
export interface Experience {
  id: string;
  name: string;
  modifier: number;
}

export type WeaponSlot = 'primary' | 'secondary';

/** An equipped weapon. Equipment is looked up in @daggery/content by id. */
export interface SheetWeapon {
  weaponId: string;
  slot: WeaponSlot;
}

export type InventoryKind = 'item' | 'consumable' | 'weapon' | 'armor' | 'custom';

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
  /** Catalog identity for stowed gear, allowing it to be equipped again. */
  equipmentId?: string;
  /** Damage belongs to this armor, including while it is stowed. */
  armorSlotsMarked?: number;
}

export interface BackgroundAnswer {
  question: string;
  answer: string;
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
  /** Permanent extra HP slots from advancements (max HP is capped at 12). */
  bonusHpSlots: number;
  /** Permanent extra Stress slots from advancements (max Stress is capped at 12). */
  bonusStressSlots: number;
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
  /**
   * History of advancements taken, used to enforce once-per-tier options (Core Rulebook
   * level-up sheet). Optional for backward compatibility with older sheets.
   */
  advancementHistory?: Array<{ level: number; advancement: string }>;
  createdAt: string;
  updatedAt: string;
}
