/**
 * Duality Solo Engine: a d12 game master emulator for solo Daggerheart.
 *
 * The Fear pool plays the GM. The engine never creates Fear; a Fear Check
 * decides when to spend what the player's own rolls generated. Every function
 * takes the dice it needs as arguments, so the server rolls and these decide.
 */

const assertD12 = (value: number, name = 'd12') => {
  if (!Number.isInteger(value) || value < 1 || value > 12) throw new Error(`Invalid ${name} roll`);
};
const assertFear = (fear: number) => {
  if (!Number.isInteger(fear) || fear < 0 || fear > 12) throw new Error('Invalid Fear value');
};

export const DUALITY_MAX_FEAR = 12;

/** Passes when the d12 is equal to or under current Fear. At 0 Fear it always fails. */
export function fearCheck(roll: number, fear: number): boolean {
  assertD12(roll); assertFear(fear);
  return roll <= fear;
}

// ----------------------------------------------------------------------- oracle

/** `target` is the Hope + Fear total a yes needs. `chance` is exact over the 144 pairs. */
export const DUALITY_LIKELIHOODS = [
  { id: 'near-certain', label: 'Near certain', target: 7, chance: '90%' },
  { id: 'likely', label: 'Likely', target: 10, chance: '75%' },
  { id: 'even', label: '50 / 50', target: 13, chance: '54%' },
  { id: 'unlikely', label: 'Unlikely', target: 16, chance: '31%' },
  { id: 'long-shot', label: 'Long shot', target: 19, chance: '15%' },
] as const;
export type DualityLikelihoodId = (typeof DUALITY_LIKELIHOODS)[number]['id'];

/** Dice this far apart add a twist to the answer. */
export const DUALITY_TWIST_GAP = 4;
export type DualityTwist = 'favor' | 'against' | null;
export interface DualityAnswer {
  hope: number; fear: number; total: number; target: number;
  yes: boolean;
  /** Hope higher by the gap bends it the player's way; Fear higher bends it against them. */
  twist: DualityTwist;
  /** Doubles: answer as normal, then a Random Event occurs. */
  randomEvent: boolean;
}

export function resolveDualityOracle(hope: number, fear: number, likelihood: string): DualityAnswer {
  assertD12(hope, 'Hope die'); assertD12(fear, 'Fear die');
  const band = DUALITY_LIKELIHOODS.find(item => item.id === likelihood);
  if (!band) throw new Error('Invalid likelihood');
  const total = hope + fear;
  const twist: DualityTwist = hope - fear >= DUALITY_TWIST_GAP ? 'favor' : fear - hope >= DUALITY_TWIST_GAP ? 'against' : null;
  return { hope, fear, total, target: band.target, yes: total >= band.target, twist, randomEvent: hope === fear };
}

export function dualityAnswerLabel(answer: Pick<DualityAnswer, 'yes' | 'twist'>): string {
  if (!answer.twist) return answer.yes ? 'Yes' : 'No';
  if (answer.yes) return answer.twist === 'favor' ? 'Yes, and…' : 'Yes, but…';
  return answer.twist === 'favor' ? 'No, but…' : 'No, and…';
}

// ------------------------------------------------------------------------ scene

export type DualitySceneTest = 'expected' | 'altered' | 'interrupted';
/** A passed Fear Check changes the scene: odd roll Altered, even roll Interrupted. */
export function resolveDualityScene(roll: number, fear: number): DualitySceneTest {
  return !fearCheck(roll, fear) ? 'expected' : roll % 2 === 1 ? 'altered' : 'interrupted';
}

// ------------------------------------------------------------------------ moves

/** What prompts a GM Move. `stall` is the story stalling or a golden opportunity. */
export const DUALITY_MOVE_TRIGGERS = [
  { id: 'success-fear', label: 'Success with Fear', checks: false },
  { id: 'failure-hope', label: 'Failure with Hope', checks: false },
  { id: 'failure-fear', label: 'Failure with Fear', checks: true },
  { id: 'stall', label: 'Story stalls / golden opportunity', checks: true },
] as const;
export type DualityMoveTrigger = (typeof DUALITY_MOVE_TRIGGERS)[number]['id'];
export type DualityMove = 'soft' | 'hard' | 'none';
/**
 * Success with Fear and failure with Hope are always a Soft Move. Failure with
 * Fear makes a Fear Check: pass is a Hard Move (1 Fear), fail a Soft Move. A
 * stall only acts on a passed check.
 */
export function resolveDualityMove(trigger: string, roll: number | undefined, fear: number): DualityMove {
  const found = DUALITY_MOVE_TRIGGERS.find(item => item.id === trigger);
  if (!found) throw new Error('Invalid move trigger');
  if (!found.checks) return 'soft';
  if (roll === undefined) throw new Error('Invalid d12 roll');
  if (fearCheck(roll, fear)) return 'hard';
  return trigger === 'stall' ? 'none' : 'soft';
}

// ----------------------------------------------------------------------- tables

export interface DualityTable {
  id: string;
  title: string;
  group: 'core' | 'meaning' | 'combat' | 'npc' | 'plot' | 'explore';
  /** One or more columns, each with exactly twelve entries (index 0 is a roll of 1). */
  columns: { label: string; entries: readonly string[] }[];
}
/** Spreads `[count, text]` runs over twelve rows, for tables with ranges. */
const spread = (...runs: [number, string][]): string[] => runs.flatMap(([count, text]) => Array<string>(count).fill(text));
const table = (id: string, title: string, group: DualityTable['group'], columns: Record<string, readonly string[]>): DualityTable => {
  const built = Object.entries(columns).map(([label, entries]) => ({ label, entries }));
  if (built.some(column => column.entries.length !== 12)) throw new Error(`Table ${id} needs twelve rows per column`);
  return { id, title, group, columns: built };
};

export const DUALITY_TABLES: readonly DualityTable[] = [
  table('how-much', 'How Much? How Well?', 'core', { Result: spread(
    [2, 'Far less than expected: scarce, weak, tiny'], [3, 'Somewhat less than expected'], [2, 'About what you would expect'],
    [3, 'Somewhat more than expected'], [2, 'Far more than expected: abundant, mighty, vast']) }),
  table('altered-scene', 'Altered Scene', 'core', { 'Altered Scene': [
    'The place is not as described', 'An expected NPC is absent', 'An unexpected NPC is present', 'Someone got here first',
    'The danger is greater than expected', 'The danger is elsewhere, for now', 'Weather, light, or terrain turns',
    'Something valuable is missing', 'A countdown is already running', 'An old Thread intrudes',
    'Remove one element of the scene', 'Add a Scene Complication'] }),
  table('scene-complication', 'Scene Complication', 'core', { 'Scene Complication': [
    'Hostile forces oppose you', 'An obstacle blocks your way', 'Wouldn’t it be bad if…', 'An NPC acts suddenly',
    'All is not as it seems', 'Things actually go as planned', 'Time is shorter than you thought', 'Innocents are caught in it',
    'A rival wants the same thing', 'Your gear or magic misbehaves', 'The environment turns dangerous', 'A debt or the past comes due'] }),
  table('soft-move', 'Soft Move', 'core', { 'Soft Move': [
    'Show how the world reacts', 'Reveal an unwelcome truth', 'Signal a threat approaching off-screen', 'Offer what you want, at a cost',
    'Mark a Stress', 'Shift the environment against you', 'An NPC acts on their Motive', 'Tick a countdown',
    'Put an item or resource at risk', 'Close off the easy path', 'Your background or a past choice catches up', 'Add a Scene Complication'] }),
  table('hard-move', 'Hard Move (costs 1 Fear)', 'core', { 'Hard Move': [
    'An adversary strikes: take damage', 'A new danger arrives', 'Separate you from an ally or your gear',
    'You are captured, pinned, or cornered', 'An opportunity is lost for good', 'Enemy reinforcements arrive',
    'Force a choice between two losses', 'A countdown ticks twice', 'Someone or something you care about is harmed',
    'Your success is turned against you', 'The environment erupts: collapse, fire, flood',
    'Spend 1 more Fear if able: roll twice, both happen'] }),
  table('event-focus', 'Event Focus', 'core', { 'Event Focus': [
    'Something far away changes', 'A strange omen or mystery', 'A new NPC enters', 'A known NPC acts', 'Bad for an NPC',
    'Good for an NPC', 'A Thread advances', 'A Thread is set back', 'A Thread closes or transforms', 'Bad for you',
    'Good for you', 'The environment acts'] }),
  table('action', 'Action', 'meaning', {
    'Action A': ['Seek', 'Oppose', 'Communicate', 'Move', 'Harm', 'Create', 'Reveal', 'Command', 'Take', 'Protect', 'Assist', 'Transform'],
    'Action B': ['Deceive', 'Abandon', 'Betray', 'Pursue', 'Trap', 'Destroy', 'Hide', 'Bargain', 'Release', 'Delay', 'Summon', 'Sacrifice'] }),
  table('subject', 'Subject', 'meaning', {
    'Subject A': ['Enemy', 'Ally', 'Community', 'Home', 'Wealth', 'Knowledge', 'Magic', 'Path', 'Secret', 'Oath', 'Authority', 'Nature'],
    'Subject B': ['Monster', 'Stranger', 'Family', 'Ruin', 'Weapon', 'Relic', 'The gods', 'Border', 'Rumor', 'Debt', 'Rebellion', 'Death'] }),
  table('descriptor', 'Descriptor', 'meaning', {
    'Descriptor A': ['Ancient', 'Broken', 'Hidden', 'Sacred', 'Cursed', 'Wild', 'Gilded', 'Humble', 'Strange', 'Dangerous', 'Beautiful', 'Forgotten'],
    'Descriptor B': ['Fresh', 'Massive', 'Tiny', 'Stolen', 'False', 'Burning', 'Frozen', 'Haunted', 'Guarded', 'Fragile', 'Powerful', 'Familiar'] }),
  table('tactics', 'Adversary Tactics (free)', 'combat', { Tactics: spread(
    [3, 'Attack the nearest PC'], [2, 'Attack the most wounded PC'], [1, 'Attack whoever hurt it last'],
    [1, 'Move to a better position; attack if able'], [1, 'Use a feature that costs no Fear (else attack)'],
    [1, 'Protect or aid an ally: the leader or the wounded'], [1, 'Pursue its own objective and ignore you'],
    [1, 'Hinder: grab, disarm, or impose a condition'], [1, 'Act by nature. Below half HP: ask the Oracle if it flees or parleys']) }),
  table('fear-spend', 'Fear Spend', 'combat', { 'Fear Spend': spread(
    [5, 'Use a Fear feature, paying its cost (none? attack, then spotlight a second adversary for 1 Fear)'],
    [3, 'Attack, then spotlight a second adversary (1 Fear)'],
    [2, 'The environment acts: use its Fear feature or a hazard (1 Fear)'],
    [2, 'Hard Move: roll on the Hard Move table (1 Fear)']) }),
  table('npc-identity', 'NPC: Role and Motive', 'npc', {
    Role: ['Farmer or laborer', 'Merchant', 'Soldier or guard', 'Outlaw', 'Priest or devotee', 'Scholar or sage', 'Noble or official',
      'Artisan', 'Wanderer or scout', 'Spellcaster', 'Entertainer or trickster', 'Leader or elder'],
    Motive: ['Survival', 'Wealth', 'Protecting loved ones', 'Revenge', 'Knowledge', 'Power', 'Duty', 'Freedom', 'Redemption', 'Faith', 'Love', 'Glory'] }),
  table('npc-manner', 'NPC: Attitude, Quirk and Topic', 'npc', {
    Attitude: spread([1, 'Hostile'], [2, 'Suspicious'], [2, 'Wary'], [2, 'Indifferent'], [2, 'Curious'], [2, 'Friendly'], [1, 'Eager to help']),
    Quirk: ['Scarred', 'Soft-spoken', 'Boastful', 'Superstitious', 'Always eating', 'Nervous laugh', 'Well dressed', 'Hums or sings',
      'Blunt', 'Forgetful', 'Collects oddities', 'Hides a secret'],
    Topic: ['A rumor', 'Their trouble', 'Local rulers', 'Recent event', 'The past', 'A warning', 'A job offer', 'NPC gossip',
      'The road ahead', 'Magic or gods', 'You', 'A Thread'] }),
  table('plot-hook', 'Plot Hook: Objective and Opposition', 'plot', {
    Objective: ['Rescue someone', 'Recover an item', 'Escort or deliver', 'Defend a place', 'Hunt a creature', 'Explore the unknown',
      'Uncover a truth', 'Stop a ritual or plan', 'Broker a peace', 'Steal or infiltrate', 'Escape or survive', 'Destroy a threat at its source'],
    Opposition: ['Bandits or raiders', 'A cult', 'A corrupt authority', 'A beast or monster', 'Undead or restless spirits', 'A rival party',
      'A mage or witch', 'The wilds themselves', 'A fallen hero', 'A faction at war', 'Something from another realm', 'Someone you trust'] }),
  table('plot-stakes', 'Plot Hook: Reward and Twist', 'plot', {
    Reward: ['Gold', 'Rare gear', 'A magic relic', 'A secret or lore', 'An ally or favor', 'A safe haven', 'Title or standing', 'A debt cleared',
      'A lead on a personal Thread', 'Healing or a cure', 'Passage or access', 'Only doing what is right'],
    Twist: ['The patron is lying', 'The victim is willing or guilty', 'A third party interferes', 'The clock is shorter', 'The target has moved',
      'The enemy is sympathetic', 'It is a trap', 'The reward is false or cursed', 'An old ally stands on the other side',
      'The real threat is far bigger', 'Success has a moral cost', 'It ties to your past'] }),
  table('site', 'Site Crawler', 'explore', {
    Area: ['Narrow passage', 'Narrow passage', 'Open chamber', 'Open chamber', 'Crossing or junction', 'Stairs, drop, or climb',
      'Collapsed or flooded section', 'Living or work quarters', 'Vault or storage', 'Shrine or sanctum', 'Cavern or overgrowth', 'Heart of the site'],
    Exits: spread([3, 'None'], [4, 'One'], [3, 'Two'], [2, 'Three']),
    Contents: spread([3, 'Empty; traces only'], [2, 'Hazard or trap'], [2, 'Adversaries'], [1, 'Adversaries guarding treasure'], [1, 'Treasure'],
      [1, 'An NPC'], [1, 'A clue to a Thread'], [1, 'Something strange (roll Meaning)']) }),
  table('journey', 'Journeys', 'explore', {
    'Danger (1 Fear)': ['Ambush', 'A predator stalks you', 'Storm or harsh weather', 'The path is lost', 'Hazardous crossing',
      'Supplies spoiled or lost', 'Hostile patrol', 'Sickness or exhaustion: mark a Stress', 'Pursuers catch up',
      'Cursed or haunted ground', 'Natural disaster', 'The lair of something big'],
    Discovery: ['A quiet road; nothing', 'Fellow travelers', 'Shelter or a good campsite', 'A ruin', 'A settlement or homestead',
      'A shrine or landmark', 'A useful resource', 'Tracks or signs', 'A trader', 'Someone in need', 'A hidden cache',
      'A wondrous sight: gain a Hope'] }),
];

export const DUALITY_TABLE_GROUPS: { id: DualityTable['group']; label: string }[] = [
  { id: 'core', label: 'Scenes, moves and events' }, { id: 'meaning', label: 'Meaning' }, { id: 'combat', label: 'Adversaries in combat' },
  { id: 'npc', label: 'NPCs' }, { id: 'plot', label: 'Plot hooks' }, { id: 'explore', label: 'Exploration' },
];

export function dualityTable(id: string): DualityTable {
  const found = DUALITY_TABLES.find(item => item.id === id);
  if (!found) throw new Error('Invalid table');
  return found;
}
/** Reads one cell: a d12 roll on a column of a table. */
export function readDualityTable(id: string, roll: number, column = 0): string {
  assertD12(roll);
  const entries = dualityTable(id).columns[column]?.entries;
  if (!entries) throw new Error('Invalid table column');
  return entries[roll - 1]!;
}

// ---------------------------------------------------------------------- meaning

export type DualityMeaningTable = 'action' | 'subject' | 'descriptor';
/** The Hope die picks the row; the Fear die picks the column (odd A, even B). */
export function readDualityMeaning(id: DualityMeaningTable, hope: number, fear: number): string {
  assertD12(hope, 'Hope die'); assertD12(fear, 'Fear die');
  return readDualityTable(id, hope, fear % 2 === 1 ? 0 : 1);
}
/** Word combinations the engine uses. `generic` also rolls an Action and How Much. */
export const DUALITY_MEANING_CHOICES = [
  { id: 'action-subject', label: 'Action + Subject (events)', tables: ['action', 'subject'] },
  { id: 'descriptor-subject', label: 'Descriptor + Subject (things and places)', tables: ['descriptor', 'subject'] },
  { id: 'action', label: 'Action', tables: ['action'] },
  { id: 'subject', label: 'Subject', tables: ['subject'] },
  { id: 'descriptor', label: 'Descriptor', tables: ['descriptor'] },
] as const satisfies readonly { id: string; label: string; tables: readonly DualityMeaningTable[] }[];

// ----------------------------------------------------------------- random event

export type DualityList = 'threads' | 'characters';
/** The List an Event Focus roll invokes, if any. */
export function eventFocusList(roll: number): DualityList | null {
  assertD12(roll);
  return roll >= 4 && roll <= 6 ? 'characters' : roll >= 7 && roll <= 9 ? 'threads' : null;
}

// -------------------------------------------------------------------- adversary

/** Fear Spend rows 1 to 5 use a Fear feature at its printed cost; the rest cost 1 Fear. */
export function resolveFearSpend(roll: number): { action: string; cost: number; featureCost: boolean; hardMove: boolean } {
  const action = readDualityTable('fear-spend', roll);
  return { action, cost: roll <= 5 ? 0 : 1, featureCost: roll <= 5, hardMove: roll >= 11 };
}
