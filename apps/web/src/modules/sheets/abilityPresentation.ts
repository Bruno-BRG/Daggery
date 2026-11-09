import type { IconName } from '../../components/Icon';

export interface AbilityFact { label: string; value: string; icon: IconName }
export interface AbilityBenefit { text: string; icon: IconName }
export interface AbilityPresentation {
  summary: string;
  facts: AbilityFact[];
  benefits?: AbilityBenefit[];
  metric?: { value: string; label: string };
  icon?: IconName;
}

/** Display-only quick references. Original source text remains the full rules. */
const REFERENCES: Record<string, AbilityPresentation> = {
  'i see it coming': {
    summary: '',
    facts: [{ label: 'Cost', value: '1 Stress', icon: 'stress' }, { label: 'Trigger', value: 'Beyond Melee', icon: 'target' }],
    metric: { value: '+1d4', label: 'Evasion for this attack' }, icon: 'eye',
  },
  untouchable: {
    summary: '',
    facts: [{ label: 'Activation', value: 'Passive', icon: 'shield' }],
    metric: { value: '+½ Agility', label: 'Evasion bonus' }, icon: 'shield',
  },
  'get back up': {
    summary: '',
    facts: [{ label: 'Cost', value: '1 Stress', icon: 'stress' }, { label: 'Trigger', value: 'Severe damage', icon: 'heart' }],
    metric: { value: '−1 step', label: 'damage severity' }, icon: 'heart',
  },
  'i am your shield': {
    summary: 'Step in for a nearby ally and become the target of the attack.',
    facts: [{ label: 'Cost', value: '1 Stress', icon: 'stress' }, { label: 'Ally range', value: 'Very Close', icon: 'users' }],
    benefits: [{ text: 'When you take that damage, you can mark any number of Armor Slots.', icon: 'shield' }], icon: 'shield',
  },
  'hold them off': {
    summary: 'After a successful weapon attack, use the same roll against two more adversaries in that attack’s range.',
    facts: [{ label: 'Cost', value: '3 Hope', icon: 'spark' }],
    metric: { value: '+2', label: 'additional adversaries' }, icon: 'combat',
  },
  "ranger's focus": {
    summary: 'Make an attack. On a success, deal normal damage and make that target your Focus.',
    facts: [{ label: 'Cost', value: '1 Hope', icon: 'spark' }], icon: 'target',
    benefits: [
      { text: 'Know exactly which direction your Focus is in.', icon: 'compass' },
      { text: 'When you damage your Focus, they mark a Stress.', icon: 'stress' },
      { text: 'Miss an attack? End Focus to reroll your Duality Dice.', icon: 'dice' },
    ],
  },
  'frontline tank': {
    summary: '',
    facts: [{ label: 'Cost', value: '3 Hope', icon: 'spark' }],
    metric: { value: '2', label: 'Armor Slots cleared' }, icon: 'armor',
  },
  unstoppable: {
    summary: 'Enter Unstoppable and build your die as you deal damage.',
    facts: [{ label: 'Recharge', value: 'Long rest', icon: 'moon' }], icon: 'shield',
    benefits: [
      { text: 'Reduce physical damage severity by one threshold.', icon: 'shield' },
      { text: 'Add your Unstoppable Die’s current value to damage.', icon: 'combat' },
      { text: 'You can’t be Restrained or Vulnerable while Unstoppable.', icon: 'lock' },
    ],
  },
  rally: { summary: 'Rally the party and give everyone a Rally Die to spend on rolls or clearing Stress.', facts: [{ label: 'Recharge', value: 'Once per session', icon: 'users' }], icon: 'users' },
  beastform: { summary: 'Transform into a creature of your tier or lower. Use its features, Evasion bonus, and attack trait.', facts: [{ label: 'Cost', value: '1 Stress', icon: 'stress' }], icon: 'compass' },
  cloaked: { summary: 'Become Cloaked whenever you would be Hidden. Stay unseen while stationary, even if an adversary moves into view.', facts: [], icon: 'eyeOff' },
  'sneak attack': { summary: 'On a successful attack while Cloaked—or with an ally in Melee range of the target—add damage dice equal to your tier.', facts: [], metric: { value: '+tier d6', label: 'damage dice' }, icon: 'combat' },
  'prayer dice': { summary: 'Roll your Prayer Dice at the start of the session. Spend them to reduce damage, improve rolls, or gain Hope.', facts: [{ label: 'Ally range', value: 'Far', icon: 'users' }], icon: 'dice' },
  'channel raw power': { summary: 'Move a domain card from your loadout to your vault. Choose Hope equal to its level, or a spell-damage bonus of twice its level.', facts: [{ label: 'Recharge', value: 'Long rest', icon: 'moon' }], icon: 'spark' },
  'attack of opportunity': { summary: 'React when an adversary tries to leave Melee range. A successful reaction gives you one effect; a critical gives you two.', facts: [], benefits: [{ text: 'Stop their movement, deal primary-weapon damage, or move with them.', icon: 'combat' }], icon: 'combat' },
  'strange patterns': { summary: 'Choose a number from 1–12. Roll it on a Duality Die to gain Hope or clear Stress.', facts: [{ label: 'Change number', value: 'Long rest', icon: 'moon' }], icon: 'dice' },
};

export function presentAbility(name: string, text: string): AbilityPresentation {
  const key = name.replace(/^Hope:\s*/i, '').trim().toLowerCase().replace(/[’‘]/g, "'");
  const reference = REFERENCES[key];
  if (reference) return reference;
  const firstSentence = text.trim().match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? text.trim();
  let summary = firstSentence.length > 210 ? `${firstSentence.slice(0, 207).replace(/\s+\S*$/, '')}…` : firstSentence;
  const cost = text.match(/^(?:Spend|Mark)\s+(a|an|\d+)\s+(Hope|Stress)\b/i);
  if (cost) {
    summary = summary.replace(/^(?:Spend|Mark)\s+(?:a|an|\d+)\s+(?:Hope|Stress)\s+to\s+/i, '');
    summary = summary.charAt(0).toUpperCase() + summary.slice(1);
  }
  const facts: AbilityFact[] = cost ? [{ label: 'Cost', value: `${/^a[n]?$/i.test(cost[1]!) ? '1' : cost[1]} ${cost[2]}`, icon: cost[2]!.toLowerCase() === 'hope' ? 'spark' : 'stress' }] : [];
  return { summary, facts };
}
