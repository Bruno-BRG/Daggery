import { randomUUID } from 'node:crypto';
import { armor, classes, domainCards, weapons } from '@daggery/content';
import { getClass, spellcastTraitName } from '@daggery/shared/daggerheart';
import type { Sheet } from '@daggery/shared/daggerheart/types';
import type { TraitName } from '@daggery/shared';

export function quickHero(name: string, classId: string): Sheet {
  const cls = getClass(classId);
  if (!cls) throw new Error('Invalid class');
  const subclass = cls.subclasses[0]!;
  const preferred: Record<string, string> = { bard: 'rapier', druid: 'staff', guardian: 'battleaxe', ranger: 'shortbow', rogue: 'dagger', seraph: 'hallowed-axe', sorcerer: 'wand', warrior: 'broadsword', wizard: 'staff' };
  const weapon = weapons.find(weapon => weapon.id === preferred[classId] && weapon.tier === 1) ?? weapons.find(weapon => weapon.id === 'broadsword')!;
  const equipped = armor.find(armor => armor.id === 'leather-armor') ?? armor.find(armor => armor.tier === 1)!;
  const traits = { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 };
  const order = [...new Set([weapon.trait.toLowerCase() as TraitName, 'instinct', 'agility', 'presence', 'strength', 'finesse', 'knowledge'])] as TraitName[];
  order.forEach((trait, index) => { traits[trait] = [2, 1, 1, 0, 0, -1][index] ?? 0; });
  const cards = domainCards.filter(card => cls.domains.includes(card.domain) && card.level === 1).slice(0, 2).map(card => card.id);
  const at = new Date().toISOString();
  const sheet: Sheet = { id: randomUUID(), name: name.trim() || 'Traveler', playerName: 'Player', level: 1, proficiency: 1,
    classId, subclassId: subclass.id, ancestryId: 'human', communityId: 'wanderborne', traits, traitMarks: [], evasionBonus: 0,
    armorId: equipped.id, armorSlotsMarked: 0, hpMarked: 0, stressMarked: 0, hope: 2, bonusHpSlots: 0, bonusStressSlots: 0,
    experiences: [{ id: randomUUID(), name: 'Life on the road', modifier: 2 }, { id: randomUUID(), name: 'Someone worth protecting', modifier: 2 }],
    weapons: [{ weaponId: weapon.id, slot: 'primary' }], inventory: [{ id: randomUUID(), name: 'Torch', kind: 'item', qty: 1 }, { id: randomUUID(), name: 'Rope', kind: 'item', qty: 1 }, { id: randomUUID(), name: 'Minor Health Potion', kind: 'consumable', qty: 1, catalogId: 'minor-health-potion' }],
    gold: 1, domainCardIds: cards, loadoutIds: cards, background: [], connections: [], notes: 'Quick-start hero. Customize heritage, equipment, Experiences, and domain cards in Characters.',
    subclassUpgraded: 0, multiclassId: null, advancements: [], createdAt: at, updatedAt: at };
  const spellcast = spellcastTraitName(sheet);
  if (spellcast && spellcast !== order[0]) { const main = order[0]!; const old = sheet.traits[spellcast]; sheet.traits[spellcast] = 2; sheet.traits[main] = old; }
  return sheet;
}
export const QUICK_CLASSES = classes.map(cls => ({ id: cls.id, name: cls.name }));
