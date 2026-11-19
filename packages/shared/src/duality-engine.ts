/**
 * Duality GME: shared tables and dice procedures for solo Daggerheart.
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
/** Printed Duality GME rules version. The full manual is the rules reference. */
export const DUALITY_ENGINE_VERSION = '0.1';

/** Passes when the d12 is equal to or under current Fear. At 0 Fear it always fails. */
export function fearCheck(roll: number, fear: number): boolean {
  assertD12(roll); assertFear(fear);
  return roll <= fear;
}

// ----------------------------------------------------------------------- oracle

/** `target` is the Hope + Fear total a yes needs. `chance` is exact over the 144 pairs. */
export const DUALITY_LIKELIHOODS = [
  { id: 'near-certain', label: 'Almost certain', target: 7, chance: '90%' },
  { id: 'likely', label: 'Likely', target: 10, chance: '75%' },
  { id: 'even', label: '50 / 50', target: 13, chance: '54%' },
  { id: 'unlikely', label: 'Unlikely', target: 16, chance: '31%' },
  { id: 'long-shot', label: 'Small chance', target: 19, chance: '15%' },
] as const;
export type DualityLikelihoodId = (typeof DUALITY_LIKELIHOODS)[number]['id'];

// ----------------------------------------------------------------------- tables

/** Table groups, in the order you reach for them during play. */
export type DualityTableGroup = 'start' | 'oracle' | 'meaning' | 'combat' | 'npc' | 'explore' | 'world' | 'iron';
export interface DualityTable {
  id: string;
  title: string;
  group: DualityTableGroup;
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
  table('how-much', 'How Much? How Well?', 'oracle', { Result: spread(
    [2, 'Far less than expected: scarce, weak, tiny'], [3, 'Somewhat less than expected'], [2, 'About what you would expect'],
    [3, 'Somewhat more than expected'], [2, 'Far more than expected: abundant, mighty, vast']) }),
  table('action', 'Action', 'meaning', {
    'Action A': ['Seek', 'Oppose', 'Communicate', 'Move', 'Harm', 'Create', 'Reveal', 'Command', 'Take', 'Protect', 'Assist', 'Transform'],
    'Action B': ['Deceive', 'Abandon', 'Betray', 'Pursue', 'Trap', 'Destroy', 'Hide', 'Bargain', 'Release', 'Delay', 'Summon', 'Sacrifice'] }),
  table('subject', 'Subject', 'meaning', {
    'Subject A': ['Enemy', 'Ally', 'Community', 'Home', 'Wealth', 'Knowledge', 'Magic', 'Path', 'Secret', 'Vow', 'Authority', 'Nature'],
    'Subject B': ['Monster', 'Stranger', 'Family', 'Ruin', 'Weapon', 'Relic', 'The gods', 'Border', 'Rumor', 'Debt', 'Rebellion', 'Death'] }),
  table('descriptor', 'Descriptor', 'meaning', {
    'Descriptor A': ['Ancient', 'Broken', 'Hidden', 'Sacred', 'Cursed', 'Wild', 'Gilded', 'Humble', 'Strange', 'Dangerous', 'Beautiful', 'Forgotten'],
    'Descriptor B': ['Fresh', 'Massive', 'Tiny', 'Stolen', 'False', 'Burning', 'Frozen', 'Haunted', 'Guarded', 'Fragile', 'Powerful', 'Familiar'] }),
  table('adversary-creature', 'Adversary: Creature and Situation', 'combat', {
    Creature: ['Beast or predator', 'Swarm or vermin', 'Outlaws, raiders, or soldiers', 'Cultists or zealots',
      'Undead: skeletons, zombies, ghouls', 'Ghost or restless spirit', 'Construct or golem', 'Elemental or living storm',
      'Fae or wild spirit', 'Demon or fiend', 'Giant, troll, or dragon-kin', 'Aberration: roll Descriptor + Subject'],
    Situation: ['Patrolling or on watch', 'Lying in ambush', 'Guarding something or someone', 'Feeding, resting, or camped',
      'Hunting you', 'Already fighting something else', 'Fleeing from something worse', 'Performing a ritual or a task',
      'Wounded, lost, or starving', 'Demanding a toll or a parley', 'Asleep or unaware', 'Holding captives'] }),
  table('adversary-type', 'Adversary Type', 'combat', { Type: [
    'Minion: falls to any damage; comes in numbers', 'Minion: falls to any damage; comes in numbers',
    'Horde: a crowd that fights as one', 'Standard: the rank and file', 'Standard: the rank and file',
    'Skulk: strikes from hiding, then slips away', 'Ranged: fights from Far range', 'Bruiser: tough and hits hard',
    'Support: aids allies, hinders you', 'Social: a threat of words, leverage, and status',
    'Leader: commands others and calls reinforcements', 'Solo: a whole fight on its own'] }),
  table('tactics', 'Adversary Tactics (free)', 'combat', { Tactics: spread(
    [3, 'Attack the nearest PC'], [2, 'Attack the most wounded PC'], [1, 'Attack whoever hurt it last'],
    [1, 'Move to a better position; attack if able'], [1, 'Use a feature that costs no Fear (else attack)'],
    [1, 'Protect or aid an ally: the leader or the wounded'], [1, 'Pursue its own objective and ignore you'],
    [1, 'Hinder: grab, disarm, or impose a condition'], [1, 'Act by nature. Below half HP: ask the Oracle if it flees or parleys']) }),
  table('fear-spend', 'Fear Spend', 'combat', { 'Fear Spend': spread(
    [5, 'Use a Fear feature, paying its cost (none? attack, then spotlight a second adversary for 1 Fear)'],
    [3, 'Attack, then spotlight a second adversary (1 Fear)'],
    [2, 'The environment acts: use its Fear feature or a hazard (1 Fear)'],
    [2, 'Severe Pay the Price (1 Fear)']) }),
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
  table('plot-hook', 'Plot Hook: Objective and Opposition', 'start', {
    Objective: ['Rescue someone', 'Recover an item', 'Escort or deliver', 'Defend a place', 'Hunt a creature', 'Explore the unknown',
      'Uncover a truth', 'Stop a ritual or plan', 'Broker a peace', 'Steal or infiltrate', 'Escape or survive', 'Destroy a threat at its source'],
    Opposition: ['Bandits or raiders', 'A cult', 'A corrupt authority', 'A beast or monster', 'Undead or restless spirits', 'A rival party',
      'A mage or witch', 'The wilds themselves', 'A fallen hero', 'A faction at war', 'Something from another realm', 'Someone you trust'] }),
  table('plot-stakes', 'Plot Hook: Reward and Twist', 'start', {
    Reward: ['Gold', 'Rare gear', 'A magic relic', 'A secret or lore', 'An ally or favor', 'A safe haven', 'Title or standing', 'A debt cleared',
      'A lead on a personal Thread', 'Healing or a cure', 'Passage or access', 'Only doing what is right'],
    Twist: ['The patron is lying', 'The victim is willing or guilty', 'A third party interferes', 'The clock is shorter', 'The target has moved',
      'The enemy is sympathetic', 'It is a trap', 'The reward is false or cursed', 'An old ally stands on the other side',
      'The real threat is far bigger', 'Success has a moral cost', 'It ties to your past'] }),
  table('rumor', 'Rumors and Leads', 'start', { 'Next scene: a rumor or lead': [
    'Lights where no one lives', 'A stranger asks about you', 'Travelers stop coming back', 'A reward for someone missing',
    'A storm uncovered old ruins', 'A merchant needs an escort', 'Animals flee one place', 'A friend sends for you',
    'Coins of a fallen kingdom', 'A festival hides a secret', 'A rival is on the move', 'A dream points the way'] }),
  table('site', 'Site Crawler', 'explore', {
    Area: ['Narrow passage', 'Narrow passage', 'Open chamber', 'Open chamber', 'Crossing or junction', 'Stairs, drop, or climb',
      'Collapsed or flooded section', 'Living or work quarters', 'Vault or storage', 'Shrine or sanctum', 'Cavern or overgrowth', 'Heart of the site'],
    Exits: spread([3, 'None'], [4, 'One'], [3, 'Two'], [2, 'Three']),
    Contents: spread([3, 'Empty; traces only'], [2, 'Hazard or trap'], [2, 'Adversaries'], [1, 'Adversaries guarding treasure'], [1, 'Treasure'],
      [1, 'An NPC'], [1, 'A clue to a Thread'], [1, 'Something strange (roll Meaning)']) }),
  table('hazard', 'Hazards and Traps', 'explore', {
    'Hazard (reaction roll)': ['Pit or collapsing floor (Agility)', 'Poison darts or needles (Agility)', 'Rockfall (Agility)',
      'Slick or crumbling footing (Finesse)', 'Rising water (Strength)', 'Fire or choking smoke (Instinct)',
      'Grasping thorns or vines (Strength)', 'Arcane ward (Knowledge)', 'Snare or net (Instinct)', 'Swinging blade (Agility)',
      'Spores or foul air (Instinct)', 'Illusion or false path (Knowledge)'],
    'On a failure': ['Fall: take physical damage', 'Mark a Stress; become Vulnerable', 'Take physical damage',
      'Separated from an ally or your gear', 'Lose or ruin an item', 'Mark a Stress', 'Become Restrained', 'Take magic damage',
      'Become Restrained', 'Take physical damage', 'Mark a Stress; disadvantage on your next roll', 'Lost: the way back is gone'] }),
  table('rest', 'Rest and Camp', 'explore', { 'While you rest': [
    'A quiet rest; nothing stirs', 'A quiet rest; nothing stirs', 'A traveler asks to share the fire', 'Sounds in the dark: ask the Oracle',
    'A dream about an open Thread', 'The weather turns on the camp', 'Something is missing at dawn', 'A memory surfaces: tell it',
    'Fresh tracks around the camp', 'A message or omen arrives', 'An NPC seeks you out', 'Interrupted: roll a Random Event'] }),
  table('journey', 'Journeys', 'explore', {
    'Danger (1 Fear)': ['Ambush', 'A predator stalks you', 'Storm or harsh weather', 'The path is lost', 'Hazardous crossing',
      'Supplies spoiled or lost', 'Hostile patrol', 'Sickness or exhaustion: mark a Stress', 'Pursuers catch up',
      'Cursed or haunted ground', 'Natural disaster', 'The lair of something big'],
    Discovery: ['A quiet road; nothing', 'Fellow travelers', 'Shelter or a good campsite', 'A ruin', 'A settlement or homestead',
      'A shrine or landmark', 'A useful resource', 'Tracks or signs', 'A trader', 'Someone in need', 'A hidden cache',
      'A wondrous sight: +1 momentum'] }),
  table('wilds', 'Wilds: Terrain, Weather and Landmark', 'explore', {
    Terrain: ['Open plains', 'Rolling hills', 'Dense forest', 'Old, quiet forest', 'Marsh or bog', 'Mountains or crags',
      'Highland moor', 'River valley', 'Coast or cliffs', 'Desert or badlands', 'Snowfields or tundra', 'Strange land (roll Descriptor)'],
    Weather: ['Clear and calm', 'Clear and calm', 'Overcast', 'Strong wind', 'Light rain', 'Heavy rain', 'Thick fog', 'Heat',
      'Bitter cold', 'Storm', 'Snow or hail', 'Unnatural weather'],
    Landmark: ['A lone great tree', 'Standing stones', 'A ruined tower', 'An old bridge', 'An old battlefield', 'A wayside shrine',
      'A cave mouth', 'Bones of something huge', 'A crossroads marker', 'A waterfall', 'An abandoned camp', 'A crater or scar'] }),
  table('place-name', 'Place Names', 'explore', {
    First: ['Ash', 'Bright', 'Cold', 'Crow', 'Elder', 'Fair', 'Gold', 'Hollow', 'Iron', 'Mist', 'Raven', 'Thorn'],
    Second: ['-barrow', '-brook', '-crest', '-fall', '-ford', '-gate', '-hold', '-mere', '-moor', '-reach', '-stead', '-wick'] }),
  table('settlement', 'Settlement', 'explore', {
    Size: spread([3, 'Hamlet or homestead'], [3, 'Village'], [3, 'Town'], [2, 'Walled city'], [1, 'Great city']),
    'Known for': ['Fine craft', 'Strong drink', 'A sacred site', 'Its market', 'A famous family', 'Horses or beasts',
      'Mines or quarries', 'The river or the sea', 'Ruins nearby', 'Scholars or a library', 'Mercenaries', 'Strange customs'],
    Trouble: ['Raiders on the roads', 'A sickness spreads', 'A feud between families', 'Someone is missing', 'Monster sightings',
      'A corrupt leader', 'A failing harvest', 'A cult in hiding', 'A debt to a powerful patron', 'Haunted nights',
      'Flood, fire, or drought', 'Strangers arrived recently'] }),
  table('names', 'Names', 'npc', {
    'Given A': ['Aster', 'Bram', 'Cass', 'Dain', 'Elowen', 'Fenn', 'Gwen', 'Hollis', 'Isra', 'Jory', 'Kestrel', 'Lio'],
    'Given B': ['Mara', 'Nim', 'Orrin', 'Pell', 'Quill', 'Rhea', 'Sorrel', 'Tamsin', 'Ulric', 'Vesper', 'Wren', 'Yara'],
    Family: ['Ashdown', 'Blackbriar', 'Coldwater', 'Dunmore', 'Emberly', 'Fallowmere', 'Greyhallow', 'Hartwick', 'Ironwood',
      'Larkspur', 'Mossgrave', 'Thorne'],
    Epithet: ['the Quiet', 'the Lucky', 'Half-Hand', 'the Elder', 'Two-Coins', 'of the Ford', 'the Grey', 'Oathbound',
      'the Unbowed', 'Lantern', 'the Wanderer', 'Saltblood'] }),
  // ------------------------------------------------------------------- Duality GME
  table('iron-price', 'Pay the Price', 'iron', { Price: [
    'Someone you trust acts against you', 'Something of value is lost or destroyed', 'The danger grows: tick a countdown',
    'You are separated from someone or something', 'Mark a Stress', 'Take damage (by tier)', 'A new danger or foe appears',
    'Lose progress: clear 1 box on a related track', 'The GM gains a Fear', 'An unwelcome truth comes out',
    'Time is lost; the world moves without you', 'Two prices: roll twice, both happen'] }),
  table('iron-vignette', 'Begin a Session: Vignette', 'iron', { 'Elsewhere…': [
    'A foe makes a move against you', 'A rival gains ground on your vow', 'Someone you care about is in trouble',
    'A secret is uncovered far away', 'A faction changes its plans', 'A threat grows: tick a countdown',
    'An omen appears to a stranger', 'An ally finds a lead for you', 'A place you know is changed',
    'Something old wakes up', 'A messenger is on the way to you', 'The goal of your vow moves or changes'] }),
  table('iron-waypoint', 'Waypoint', 'iron', { 'You reach…': [
    'A ruined outpost', 'A river crossing', 'A hunter’s camp', 'A shrine to a forgotten god', 'A cave system',
    'An old battlefield', 'An abandoned village', 'A lookout or tower', 'A strange monolith', 'A beast’s lair',
    'A trading post', 'A crossroads'] }),
  table('iron-opportunity', 'Find an Opportunity', 'iron', { Opportunity: [
    'The terrain favors you', 'A hidden path', 'Useful supplies', 'You learn a foe’s weakness', 'Shelter or safety',
    'A distraction you can use', 'Someone offers help', 'A clue to your vow', 'Something left behind',
    'High ground: advantage on your next roll', 'An enemy gives themselves away', 'Take +1 momentum'] }),
  table('iron-discovery', 'Make a Discovery', 'iron', { Discovery: [
    'An untouched place of power', 'A lost settlement, still alive', 'A great beast at peace', 'Ruins of a vanished people',
    'A gate to another realm', 'A trove of old knowledge', 'A sacred grove or spring', 'A relic fallen from the sky',
    'A hidden valley', 'A sleeping titan', 'A living legend', 'Something new: roll Descriptor + Subject'] }),
  table('iron-chaos', 'Confront Chaos', 'iron', { Chaos: [
    'Distances lie: the way twists back', 'Time slips: hours vanish', 'A voice speaks your name', 'The dead walk',
    'Shadows move wrong', 'Corruption spreads through the land', 'A creature not of this world', 'Magic runs wild',
    'A sickness of the mind: mark a Stress', 'Echoes of a battle long past', 'A door where none should be',
    'Something nameless: roll Action + Subject'] }),
  table('faction', 'Faction', 'world', {
    Faction: ['Merchant guild', 'Noble house', 'Temple or holy order', 'Thieves’ guild', 'Mercenary company', 'Circle of mages',
      'Rebels', 'Druidic circle', 'Secret society', 'Knightly order', 'Outlaw band', 'An ancient bloodline'],
    Wants: ['Wealth', 'Control of a place', 'Revenge', 'A lost relic', 'To protect its own', 'To spread its faith',
      'To topple a ruler', 'To bury a secret', 'Forbidden knowledge', 'Survival', 'New territory', 'To wake something old'],
    Method: ['Bribery', 'Open force', 'Blackmail', 'Diplomacy', 'Spies', 'Trade', 'Rituals', 'Rumors and lies',
      'Assassins', 'Alliances', 'Hiring heroes (you)', 'Patience'] }),
  table('treasure', 'Loot and Treasure', 'world', {
    Loot: spread([3, 'A handful of gold'], [2, 'Supplies: rations, rope, torches'], [1, 'A health or stamina potion'],
      [1, 'A tool or trade good'], [1, 'A fine weapon'], [1, 'Armor or a shield'], [1, 'Jewelry or art'],
      [1, 'A map, a key, or a letter'], [1, 'A magic item (roll Descriptor + Subject)']),
    Detail: ['Engraved with a name', 'Stained with old blood', 'Smells of smoke', 'Older than it should be',
      'Belonged to someone you know', 'Warm to the touch', 'Hums faintly', 'Wrapped in a note', 'Marked by a faction',
      'Cracked but whole', 'Lighter or heavier than it looks', 'Someone wants it back'] }),
];

/** Table groups in the GME manual's reference order. */
export const DUALITY_TABLE_GROUPS: { id: DualityTableGroup; label: string }[] = [
  { id: 'iron', label: 'Moves and progress' }, { id: 'start', label: 'Inciting incidents' },
  { id: 'oracle', label: 'Oracle' }, { id: 'meaning', label: 'Meaning' },
  { id: 'combat', label: 'Adversaries' }, { id: 'npc', label: 'NPCs and names' },
  { id: 'explore', label: 'Exploration and places' }, { id: 'world', label: 'Factions and loot' },
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

/** The Daggerheart adversary type a row of the Adversary Type table names, such as `Solo`. */
export function adversaryTypeName(roll: number): string {
  return readDualityTable('adversary-type', roll).split(':')[0]!;
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

/** Saved Threads and NPC lists, usable by GME's generators. */
export type DualityList = 'threads' | 'characters';

// -------------------------------------------------------------------- adversary

/** Fear Spend rows 1 to 5 use a Fear feature at its printed cost; the rest cost 1 Fear. */
export function resolveFearSpend(roll: number): { action: string; cost: number; featureCost: boolean; hardMove: boolean } {
  const action = readDualityTable('fear-spend', roll);
  return { action, cost: roll <= 5 ? 0 : 1, featureCost: roll <= 5, hardMove: roll >= 11 };
}
