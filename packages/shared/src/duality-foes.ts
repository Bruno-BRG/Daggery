/**
 * Foes: how a Daggerheart adversary becomes an Ironsworn foe rank, and back.
 *
 * Ironsworn gives every foe a rank. The rank decides how hard it hits you (harm) and how fast
 * your blows wear it down (progress per harm). Daggerheart gives every adversary a tier and a
 * type. This file is the bridge, so one fight can use a Daggerheart stat block for its
 * features and an Ironsworn progress track for its health.
 *
 *   rank = tier - 1 + role bonus, from Troublesome (0) to Epic (4)
 *
 * Role bonuses: Minion -1; Standard, Skulk, Ranged, Support and Social 0; Horde, Bruiser and
 * Leader +1; Solo +2. So a tier 1 Standard is Troublesome, a tier 2 Bruiser is Formidable, and
 * a tier 3 Solo is already Epic.
 */
import { IRON_RANKS, type IronRank } from './duality-variants';

/** The Daggerheart adversary types, as the catalog spells them. */
export const ADVERSARY_TYPES = ['Minion', 'Standard', 'Skulk', 'Ranged', 'Support', 'Social', 'Horde', 'Bruiser', 'Leader', 'Solo'] as const;
export type AdversaryType = (typeof ADVERSARY_TYPES)[number];

export const ROLE_BONUS: Record<AdversaryType, number> = {
  Minion: -1, Standard: 0, Skulk: 0, Ranged: 0, Support: 0, Social: 0, Horde: 1, Bruiser: 1, Leader: 1, Solo: 2,
};

/** One row of the printed foe chart: rank, what it looks like, and what it costs you. */
export interface FoeRank {
  id: IronRank;
  /** The Duality GME name: Minor, Serious, Grave, Dire or Legendary. */
  label: string;
  /** The Ironsworn name of the same rank: Troublesome, Dangerous, Formidable, Extreme or Epic. */
  ironsworn: string;
  /** Ironsworn's own description of this rank of foe. */
  foe: string;
  /** Harm a foe of this rank inflicts: mark this many Hit Points, or this much Stress. */
  harm: number;
  /** What each harm you inflict marks on the foe's progress track. */
  progress: string;
  /** Daggerheart adversaries that fit, by tier. */
  fits: string;
}

const FOE_TEXT: Record<IronRank, { foe: string; fits: string }> = {
  troublesome: { foe: 'Common enemies', fits: 'Tier 1-2 Minion; tier 1 Standard, Skulk, Ranged, Support or Social' },
  dangerous: { foe: 'Capable fighters and deadly creatures', fits: 'Tier 3 Minion; tier 2 Standard, Skulk, Ranged, Support or Social; tier 1 Horde, Bruiser or Leader' },
  formidable: { foe: 'Exceptional fighters and mighty creatures', fits: 'Tier 4 Minion; tier 3 Standard, Skulk, Ranged, Support or Social; tier 2 Horde, Bruiser or Leader; tier 1 Solo' },
  extreme: { foe: 'Foes of overwhelming skill or power', fits: 'Tier 4 Standard, Skulk, Ranged, Support or Social; tier 3 Horde, Bruiser or Leader; tier 2 Solo' },
  epic: { foe: 'Legendary foes of mythic power', fits: 'Tier 4 Horde, Bruiser or Leader; tier 3-4 Solo' },
};

export const FOE_RANKS: readonly FoeRank[] = IRON_RANKS.map((rank, index) => ({
  id: rank.id, label: rank.label, ironsworn: rank.id[0]!.toUpperCase() + rank.id.slice(1), ...FOE_TEXT[rank.id], harm: index + 1,
  progress: rank.ticks >= 4 ? `${rank.ticks / 4} ${rank.ticks === 4 ? 'box' : 'boxes'} per harm` : `${rank.ticks} ${rank.ticks === 1 ? 'tick' : 'ticks'} per harm`,
}));

export const isAdversaryType = (value: string): value is AdversaryType => (ADVERSARY_TYPES as readonly string[]).includes(value);

/** The rank of a Daggerheart adversary. Unknown types count as Standard. */
export function foeRankFor(type: string, tier: number): IronRank {
  if (!Number.isInteger(tier) || tier < 1 || tier > 4) throw new RangeError('Adversary tier must be 1 to 4');
  const bonus = isAdversaryType(type) ? ROLE_BONUS[type] : 0;
  return IRON_RANKS[Math.min(IRON_RANKS.length - 1, Math.max(0, tier - 1 + bonus))]!.id;
}

/** Harm a foe of this rank inflicts when it hurts you: 1 (Troublesome) to 5 (Epic). */
export function foeHarm(rank: IronRank): number {
  const index = IRON_RANKS.findIndex(item => item.id === rank);
  if (index < 0) throw new Error('Invalid rank');
  return index + 1;
}

/** Progress ticks marked on a foe's track for each harm you inflict. */
export function ticksPerHarm(rank: IronRank): number {
  const found = IRON_RANKS.find(item => item.id === rank);
  if (!found) throw new Error('Invalid rank');
  return found.ticks;
}

/** Your own harm: 2 with a deadly weapon, 1 when unarmed or with a simple weapon. */
export const heroHarm = (weapon: 'deadly' | 'simple'): number => (weapon === 'deadly' ? 2 : 1);

export type PackSize = 'single' | 'small' | 'large';
/**
 * A group of Troublesome or Dangerous foes fights as one pack with a single track.
 * A small pack (about 3 to 5) is one rank higher. A large pack (about 6 to 10) is two higher.
 */
export function packRank(rank: IronRank, size: PackSize): IronRank {
  const index = IRON_RANKS.findIndex(item => item.id === rank);
  if (index < 0) throw new Error('Invalid rank');
  if (size !== 'single' && index > 1) throw new Error('Only Troublesome and Dangerous foes form a pack');
  const raise = size === 'small' ? 1 : size === 'large' ? 2 : 0;
  return IRON_RANKS[Math.min(IRON_RANKS.length - 1, index + raise)]!.id;
}

/** Every (type, tier) pair that makes a foe of this rank: what to look for in the stat blocks. */
export function adversariesForRank(rank: IronRank): { type: AdversaryType; tier: number }[] {
  const out: { type: AdversaryType; tier: number }[] = [];
  for (const type of ADVERSARY_TYPES) for (let tier = 1; tier <= 4; tier++) if (foeRankFor(type, tier) === rank) out.push({ type, tier });
  return out;
}

/** Which Duality trait rolls what Ironsworn calls a stat. */
export const STAT_TRAITS = [
  { stat: 'edge', trait: 'Agility', acts: 'speed, agility or precision' },
  { stat: 'heart', trait: 'Presence', acts: 'charm, loyalty or courage' },
  { stat: 'iron', trait: 'Strength', acts: 'aggressive action, forceful defense, strength or endurance' },
  { stat: 'shadow', trait: 'Finesse', acts: 'deception, stealth or trickery' },
  { stat: 'wits', trait: 'Instinct or Knowledge', acts: 'expertise, insight or observation' },
] as const;
