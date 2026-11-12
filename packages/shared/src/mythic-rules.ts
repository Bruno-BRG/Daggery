/**
 * Mythic Game Master Emulator (second edition) mechanics as pure functions.
 *
 * Every function takes the dice it needs as arguments, so the server rolls and
 * these only decide. Word tables are data and live in packages/content/mythic.
 */

export type MythicAnswer = 'exceptionalYes' | 'yes' | 'no' | 'exceptionalNo';
export const MYTHIC_ANSWER_LABELS: Record<MythicAnswer, string> = {
  exceptionalYes: 'Exceptional Yes', yes: 'Yes', no: 'No', exceptionalNo: 'Exceptional No',
};

/** Odds from least to most likely. `check` is the Fate Check roll modifier. */
export const MYTHIC_ODDS = [
  { id: 'impossible', label: 'Impossible', check: -5 },
  { id: 'nearly-impossible', label: 'Nearly Impossible', check: -4 },
  { id: 'very-unlikely', label: 'Very Unlikely', check: -2 },
  { id: 'unlikely', label: 'Unlikely', check: -1 },
  { id: 'fifty-fifty', label: '50/50', check: 0 },
  { id: 'likely', label: 'Likely', check: 1 },
  { id: 'very-likely', label: 'Very Likely', check: 2 },
  { id: 'nearly-certain', label: 'Nearly Certain', check: 4 },
  { id: 'certain', label: 'Certain', check: 5 },
] as const;
export type MythicOddsId = (typeof MYTHIC_ODDS)[number]['id'];
const ODDS_ALIASES: Record<string, MythicOddsId> = { '50-50-or-unknown': 'fifty-fifty', '50-50': 'fifty-fifty', '50/50': 'fifty-fifty' };

export function mythicOddsIndex(odds: string): number {
  const id = ODDS_ALIASES[odds] ?? odds;
  const index = MYTHIC_ODDS.findIndex(item => item.id === id);
  if (index < 0) throw new Error('Invalid Mythic odds');
  return index;
}

/**
 * How strongly the Chaos Factor bends Fate Question answers.
 * `one-page` is the One-Page emulator: no Chaos Factor, any double is an event.
 */
export const MYTHIC_CHAOS_FLAVORS = [
  { id: 'standard', label: 'Standard chaos' },
  { id: 'mid', label: 'Mid-chaos' },
  { id: 'low', label: 'Low-chaos' },
  { id: 'none', label: 'No-chaos' },
  { id: 'one-page', label: 'One-Page Mythic' },
] as const;
export type MythicChaosFlavor = (typeof MYTHIC_CHAOS_FLAVORS)[number]['id'];
export const isChaosFlavor = (value: unknown): value is MythicChaosFlavor => MYTHIC_CHAOS_FLAVORS.some(item => item.id === value);

const assertChaos = (chaos: number) => {
  if (!Number.isInteger(chaos) || chaos < 1 || chaos > 9) throw new Error('Invalid chaos factor');
};
const assertDie = (value: number, sides: number) => {
  if (!Number.isInteger(value) || value < 1 || value > sides) throw new Error(`Invalid d${sides} roll`);
};

/** Columns the chart moves away from the Chaos Factor 5 column. */
export function chaosColumnShift(chaos: number, flavor: MythicChaosFlavor = 'standard'): number {
  assertChaos(chaos);
  if (flavor === 'none' || flavor === 'one-page') return 0;
  if (flavor === 'low') return chaos <= 2 ? -1 : chaos >= 8 ? 1 : 0;
  if (flavor === 'mid') return chaos === 1 ? -2 : chaos <= 3 ? -1 : chaos <= 6 ? 0 : chaos <= 8 ? 1 : 2;
  return chaos - 5;
}

/** The Fate Check roll modifier for the Chaos Factor. */
export function chaosCheckModifier(chaos: number, flavor: MythicChaosFlavor = 'standard'): number {
  if (flavor !== 'standard') return chaosColumnShift(chaos, flavor);
  assertChaos(chaos);
  return [-5, -4, -2, -1, 0, 1, 2, 4, 5][chaos - 1]!;
}

/**
 * The Fate Chart is one ladder of thirteen cells read diagonally: each step of
 * odds or of chaos moves one cell. A cell is [exceptional yes at or under,
 * yes at or under, exceptional no at or over]; 0 and 101 mean "cannot happen".
 */
const FATE_LADDER: readonly (readonly [number, number, number])[] = [
  [0, 1, 81], [1, 5, 82], [2, 10, 83], [3, 15, 84], [5, 25, 86], [7, 35, 88], [10, 50, 91],
  [13, 65, 94], [15, 75, 96], [17, 85, 98], [18, 90, 99], [19, 95, 100], [20, 99, 101],
];
export interface FateCell { exceptionalYes: number; yes: number; exceptionalNo: number }

export function fateChartCell(odds: string, chaos: number, flavor: MythicChaosFlavor = 'standard'): FateCell {
  const index = Math.min(FATE_LADDER.length - 1, Math.max(0, mythicOddsIndex(odds) + 2 + chaosColumnShift(chaos, flavor)));
  const [exceptionalYes, yes, exceptionalNo] = FATE_LADDER[index]!;
  return { exceptionalYes, yes, exceptionalNo };
}

/** Roll ranges of a chart cell, for display. A missing range cannot be rolled. */
export function fateCellRanges(cell: FateCell): Partial<Record<MythicAnswer, [number, number]>> {
  const ranges: Partial<Record<MythicAnswer, [number, number]>> = {};
  if (cell.exceptionalYes >= 1) ranges.exceptionalYes = [1, cell.exceptionalYes];
  ranges.yes = [cell.exceptionalYes + 1, cell.yes];
  if (cell.yes + 1 <= Math.min(100, cell.exceptionalNo - 1)) ranges.no = [cell.yes + 1, Math.min(100, cell.exceptionalNo - 1)];
  if (cell.exceptionalNo <= 100) ranges.exceptionalNo = [cell.exceptionalNo, 100];
  return ranges;
}

/** A d100 double (11 to 99) whose digit is within the Chaos Factor. One-Page: any double. */
export function isRandomEventRoll(roll: number, chaos: number, flavor: MythicChaosFlavor = 'standard'): boolean {
  if (roll < 11 || roll > 99 || roll % 11 !== 0) return false;
  return flavor === 'one-page' || roll / 11 <= chaos;
}

export interface FateResult { answer: MythicAnswer; randomEvent: boolean; cell?: FateCell; total?: number; modifier?: number }

export function resolveFateChart(roll: number, odds: string, chaos: number, flavor: MythicChaosFlavor = 'standard'): FateResult {
  assertDie(roll, 100);
  const cell = fateChartCell(odds, chaos, flavor);
  const answer: MythicAnswer = roll <= cell.exceptionalYes ? 'exceptionalYes' : roll <= cell.yes ? 'yes' : roll >= cell.exceptionalNo ? 'exceptionalNo' : 'no';
  return { answer, cell, randomEvent: isRandomEventRoll(roll, chaos, flavor) };
}

/**
 * Fate Check: 2d10 plus the odds and chaos modifiers. 11 or more is Yes,
 * 18 or more Exceptional Yes, 4 or less Exceptional No. Matching dice whose
 * face is within the Chaos Factor also bring a Random Event.
 */
export function resolveFateCheck(first: number, second: number, odds: string, chaos: number, flavor: MythicChaosFlavor = 'standard'): FateResult {
  assertDie(first, 10); assertDie(second, 10);
  const modifier = MYTHIC_ODDS[mythicOddsIndex(odds)]!.check + chaosCheckModifier(chaos, flavor);
  const total = first + second + modifier;
  const answer: MythicAnswer = total >= 18 ? 'exceptionalYes' : total >= 11 ? 'yes' : total <= 4 ? 'exceptionalNo' : 'no';
  const randomEvent = first === second && first <= 9 && (flavor === 'one-page' || first <= chaos);
  return { answer, total, modifier, randomEvent };
}

/** What a Fate Question is being used for. Each purpose reads the four answers its own way. */
export const MYTHIC_QUESTION_PURPOSES = [
  { id: 'question', label: 'Fate Question' },
  { id: 'npc-behavior', label: 'NPC behavior: does the NPC do this?' },
  { id: 'npc-statistic', label: 'NPC statistic: is the value this?' },
  { id: 'rpg-rule', label: 'Replace an RPG rule' },
] as const;
export type MythicQuestionPurpose = (typeof MYTHIC_QUESTION_PURPOSES)[number]['id'];

const ANSWER_GUIDES: Record<MythicQuestionPurpose | 'discovery', Record<MythicAnswer, string> & { event: string }> = {
  question: {
    yes: 'Yes. Your expectation holds.',
    exceptionalYes: 'Yes, and more than you expected.',
    no: 'No. Go with the next most expected outcome.',
    exceptionalNo: 'No, and the opposite of what you expected, or an intensified no.',
    event: 'A Random Event happens as well as this answer.',
  },
  'npc-behavior': {
    yes: 'The NPC does what you expected, or keeps doing what they were doing.',
    exceptionalYes: 'The NPC does the expected action, or keeps going, with greater intensity.',
    no: 'The NPC does the next most expected thing. Unsure what that is? Roll a Meaning Table.',
    exceptionalNo: 'The NPC does the opposite, or the next most expected thing with greater intensity. Unsure? Roll a Meaning Table and intensify it.',
    event: 'Roll a Meaning Table for an additional action from this NPC.',
  },
  'npc-statistic': {
    yes: 'The value is what you expected.',
    exceptionalYes: 'The value is higher than expected, by about 25%.',
    no: 'The value is lower than expected, by about 25%.',
    exceptionalNo: 'The value is much lower than expected, by about 50%.',
    event: 'A special condition is attached to this statistic.',
  },
  'rpg-rule': {
    yes: 'Yes. The rule resolves the way you posed it.',
    exceptionalYes: 'Yes. Use the stronger degree only if the replaced rule has degrees of success.',
    no: 'No. The rule resolves the other way.',
    exceptionalNo: 'No. Use the stronger degree only if the replaced rule has degrees of failure.',
    event: 'Ignore this Random Event unless it makes sense with the replaced rule.',
  },
  discovery: {
    yes: 'Something is discovered. One roll on the Thread Discovery Check.',
    exceptionalYes: 'Something is discovered. Two rolls on the Thread Discovery Check, combined.',
    no: 'Nothing useful is found.',
    exceptionalNo: 'Nothing useful is found, and no more Discovery Checks this Scene.',
    event: 'A Random Event happens as well as this answer.',
  },
};
export const fateAnswerGuide = (purpose: MythicQuestionPurpose | 'discovery', answer: MythicAnswer) => ANSWER_GUIDES[purpose][answer];
export const fateEventGuide = (purpose: MythicQuestionPurpose | 'discovery') => ANSWER_GUIDES[purpose].event;

// ---------------------------------------------------------------- random events

export type MythicList = 'threads' | 'characters' | 'features';
export interface EventFocus { id: string; label: string; range: [number, number]; list?: MythicList; hint: string }

export const EVENT_FOCUS_TABLE: readonly EventFocus[] = [
  { id: 'remote-event', label: 'Remote Event', range: [1, 5], hint: 'Something happened elsewhere and your character learns of it.' },
  { id: 'ambiguous-event', label: 'Ambiguous Event', range: [6, 10], hint: 'Something neither good nor bad happens. A detail worth a closer look.' },
  { id: 'new-npc', label: 'New NPC', range: [11, 20], hint: 'A new character enters the adventure. Add them to the Characters List.' },
  { id: 'npc-action', label: 'NPC Action', range: [21, 40], list: 'characters', hint: 'This character does something.' },
  { id: 'npc-negative', label: 'NPC Negative', range: [41, 45], list: 'characters', hint: 'Something bad happens to this character.' },
  { id: 'npc-positive', label: 'NPC Positive', range: [46, 50], list: 'characters', hint: 'Something good happens to this character.' },
  { id: 'move-toward-thread', label: 'Move Toward A Thread', range: [51, 55], list: 'threads', hint: 'Something brings this thread closer to being resolved.' },
  { id: 'move-away-from-thread', label: 'Move Away From A Thread', range: [56, 65], list: 'threads', hint: 'Something makes this thread harder to resolve.' },
  { id: 'close-thread', label: 'Close A Thread', range: [66, 70], list: 'threads', hint: 'Something ends this thread, or makes it stop mattering.' },
  { id: 'pc-negative', label: 'PC Negative', range: [71, 80], hint: 'Something bad happens to your character.' },
  { id: 'pc-positive', label: 'PC Positive', range: [81, 85], hint: 'Something good happens to your character.' },
  { id: 'current-context', label: 'Current Context', range: [86, 100], hint: 'The event grows out of what is happening right now.' },
];
/** Used instead of the regular table while playing a prepared adventure. */
export const PREPARED_EVENT_FOCUS_TABLE: readonly EventFocus[] = [
  { id: 'adventure-feature', label: 'Adventure Feature', range: [1, 20], list: 'features', hint: 'This feature of the prepared adventure comes into play.' },
  { id: 'npc-action', label: 'NPC Action', range: [21, 40], list: 'characters', hint: 'This character does something.' },
  { id: 'npc-negative', label: 'NPC Negative', range: [41, 50], list: 'characters', hint: 'Something bad happens to this character.' },
  { id: 'npc-positive', label: 'NPC Positive', range: [51, 55], list: 'characters', hint: 'Something good happens to this character.' },
  { id: 'pc-negative', label: 'PC Negative', range: [56, 70], hint: 'Something bad happens to your character.' },
  { id: 'pc-positive', label: 'PC Positive', range: [71, 80], hint: 'Something good happens to your character.' },
  { id: 'current-context', label: 'Current Context', range: [81, 100], hint: 'The event grows out of what is happening right now.' },
];
/** When choosing the focus instead of rolling: the situation each focus suits. */
export const EVENT_FOCUS_REASONS: Record<string, string> = {
  'remote-event': 'You are expecting news from afar.',
  'ambiguous-event': 'The adventure has slowed and you want a mystery to pursue.',
  'new-npc': 'There is a logical reason for someone new to appear.',
  'npc-action': 'You are waiting on NPCs to move things forward.',
  'npc-negative': 'You want the focus to shift onto an NPC.',
  'npc-positive': 'You want the focus to shift onto an NPC.',
  'move-toward-thread': 'The adventure has stalled and needs a push. Good for an Interrupt Scene.',
  'move-away-from-thread': 'You want a new challenge for your character.',
  'pc-negative': 'You want a new challenge for your character.',
  'pc-positive': 'Your character is having a hard time and could use a break.',
  'close-thread': 'The adventure has grown complicated and the Threads List needs thinning.',
  'current-context': 'The event could explain a Fate Question result, or disrupt the current action.',
  'adventure-feature': 'A feature of the prepared adventure should come into play.',
};

export const eventFocusTable = (prepared: boolean) => (prepared ? PREPARED_EVENT_FOCUS_TABLE : EVENT_FOCUS_TABLE);

/**
 * Reads the Event Focus for a d100. A focus that needs a List with nothing on
 * it cannot be used: Current Context is the focus instead.
 */
export function resolveEventFocus(roll: number, lineCounts: Record<MythicList, number>, prepared = false): { focus: EventFocus; rolled: EventFocus; replaced: boolean } {
  assertDie(roll, 100);
  const table = eventFocusTable(prepared);
  const rolled = table.find(item => roll >= item.range[0] && roll <= item.range[1])!;
  if (rolled.list && lineCounts[rolled.list] === 0) return { focus: table[table.length - 1]!, rolled, replaced: true };
  return { focus: rolled, rolled, replaced: false };
}
export function eventFocusById(id: string, prepared = false): EventFocus {
  const focus = eventFocusTable(prepared).find(item => item.id === id);
  if (!focus) throw new Error('Invalid event focus');
  return focus;
}

// ------------------------------------------------------------------------ lists

export const MYTHIC_LIST_LINES = 25;
/** The die that picks a section when that many sections of a List hold something. 0: no roll. */
export function listSectionDie(lineCount: number, full = false): 0 | 4 | 6 | 8 | 10 {
  const sections = full ? 5 : Math.ceil(Math.min(lineCount, MYTHIC_LIST_LINES) / 5);
  return ([0, 0, 4, 6, 8, 10] as const)[sections]!;
}
export interface ListRoll { sectionDie: number; sectionRoll?: number; lineRoll: number; line: number; index: number | null }
/**
 * Picks a line of a List: a section of five lines first, then a d10 for the
 * line in it. `index` is null on an empty line, where the player chooses any
 * element or rolls again. `full` rolls over all five sections (Adventure Crafter).
 */
export function resolveListRoll(lineCount: number, lineRoll: number, sectionRoll?: number, full = false): ListRoll {
  assertDie(lineRoll, 10);
  const sectionDie = listSectionDie(lineCount, full);
  let section = 0;
  if (sectionDie) {
    if (sectionRoll === undefined) throw new Error('Invalid list roll: a section roll is needed');
    assertDie(sectionRoll, sectionDie);
    section = Math.ceil(sectionRoll / 2) - 1;
  }
  const line = section * 5 + Math.ceil(lineRoll / 2);
  return { sectionDie, sectionRoll: sectionDie ? sectionRoll : undefined, lineRoll, line, index: line <= lineCount ? line - 1 : null };
}

// ----------------------------------------------------------------------- scenes

export type SceneTest = 'expected' | 'altered' | 'interrupt';
/** d10 over the Chaos Factor: Expected. Within it: odd Altered, even Interrupt. */
export function resolveSceneTest(roll: number, chaos: number): SceneTest {
  assertDie(roll, 10); assertChaos(chaos);
  return roll > chaos ? 'expected' : roll % 2 === 1 ? 'altered' : 'interrupt';
}

export const SCENE_ADJUSTMENTS = [
  'Remove a character', 'Add a character', 'Reduce or remove an activity',
  'Increase an activity', 'Remove an object', 'Add an object',
] as const;
/**
 * Scene Adjustment Table. 7 to 10 means two adjustments: keep reading rolls,
 * ignoring further 7 to 10 results, until two are found. Pass enough rolls.
 */
export function resolveSceneAdjustments(rolls: readonly number[]): { adjustments: string[]; used: number[] } {
  const used: number[] = [], adjustments: string[] = [];
  let wanted = 1;
  for (const roll of rolls) {
    assertDie(roll, 10);
    used.push(roll);
    if (roll >= 7) { if (used.length === 1) wanted = 2; continue; }
    adjustments.push(SCENE_ADJUSTMENTS[roll - 1]!);
    if (adjustments.length >= wanted) return { adjustments, used };
  }
  throw new Error('Invalid scene adjustment: not enough rolls');
}

export const ALTERED_SCENE_STRATEGIES = [
  'The next expectation: the scene is what you would next most expect.',
  'A tweak: change one element of the Expected Scene.',
  'Ask a Fate Question to decide how the scene changes.',
  'Roll a Meaning Table word pair for inspiration.',
  'Roll on the Scene Adjustment Table.',
] as const;

/** End of Scene: in control lowers the Chaos Factor, out of control raises it. */
export function adjustChaos(chaos: number, inControl: boolean): number {
  assertChaos(chaos);
  return Math.min(9, Math.max(1, chaos + (inControl ? -1 : 1)));
}

// -------------------------------------------------------- thread progress track

export const THREAD_TRACK_LENGTHS = [10, 15, 20] as const;
export interface ThreadTrack {
  threadId: string;
  name: string;
  length: number;
  points: number;
  /** One flag per phase that has a Flashpoint box: did a Flashpoint happen in it? */
  flashpoints: boolean[];
  /** An Exceptional No stops Discovery Checks until the next Scene. */
  discoveryBlocked: boolean;
  /** Flashpoints the Track has triggered that are still to be played. */
  pendingFlashpoints: number;
  concluded: boolean;
}
export function newThreadTrack(threadId: string, name: string, length: number): ThreadTrack {
  if (!(THREAD_TRACK_LENGTHS as readonly number[]).includes(length)) throw new Error('Invalid track length');
  return { threadId, name, length, points: 0, flashpoints: Array<boolean>(length / 5 - 1).fill(false), discoveryBlocked: false, pendingFlashpoints: 0, concluded: false };
}
/**
 * Marks Progress Points. `flashpoint` records that a Flashpoint was played in
 * the current phase. Ending a phase with no Flashpoint triggers one, worth 2
 * more points. Returns how many the Track triggered.
 */
export function advanceThreadTrack(track: ThreadTrack, points: number, flashpoint = false): { track: ThreadTrack; triggered: number } {
  if (!Number.isInteger(points) || points < 0 || points > 6) throw new Error('Invalid progress points');
  const next: ThreadTrack = { ...track, flashpoints: [...track.flashpoints] };
  if (next.concluded) return { track: next, triggered: 0 };
  if (flashpoint) {
    const phase = Math.floor(next.points / 5);
    if (phase < next.flashpoints.length) next.flashpoints[phase] = true;
  }
  next.points += points;
  let triggered = 0;
  for (let phase = 0; phase < next.flashpoints.length; phase++) {
    if (next.points >= (phase + 1) * 5 && !next.flashpoints[phase]) {
      next.flashpoints[phase] = true;
      next.points += 2;
      triggered++;
    }
  }
  next.points = Math.min(next.length, next.points);
  next.concluded = next.points >= next.length;
  next.pendingFlashpoints += triggered;
  return { track: next, triggered };
}

export interface DiscoveryResult { label: string; points: number; flashpoint: boolean; hint: string }
/** Thread Discovery Check: d10 plus the Progress Points already marked. */
export function resolveThreadDiscovery(roll: number, progress: number): DiscoveryResult & { total: number } {
  assertDie(roll, 10);
  const total = roll + progress;
  const result: DiscoveryResult =
    total <= 9 ? { label: 'Progress +2', points: 2, flashpoint: false, hint: 'You discover something that moves you closer to the Focus Thread.' }
    : total === 10 ? { label: 'Flashpoint +2', points: 2, flashpoint: true, hint: 'You discover something dramatic and important about the Focus Thread.' }
    : total <= 14 ? { label: 'Track +1', points: 1, flashpoint: false, hint: 'Nothing useful is found, but the attempt itself moves you along the Track.' }
    : total <= 17 ? { label: 'Progress +3', points: 3, flashpoint: false, hint: 'You discover something that moves you closer to the Focus Thread.' }
    : total === 18 ? { label: 'Flashpoint +3', points: 3, flashpoint: true, hint: 'You discover something dramatic and important about the Focus Thread.' }
    : total === 19 ? { label: 'Track +2', points: 2, flashpoint: false, hint: 'Nothing useful is found, but the attempt itself moves you along the Track.' }
    : total <= 24 ? { label: 'Strengthen Progress +1', points: 1, flashpoint: false, hint: 'Earlier progress is reinforced. Tie this to a previous discovery.' }
    : { label: 'Strengthen Progress +2', points: 2, flashpoint: false, hint: 'Earlier progress is reinforced. Tie this to a previous discovery.' };
  return { ...result, total };
}
/** Discovery Check odds can never be worse than 50/50. */
export const discoveryOdds = (odds: string): MythicOddsId => MYTHIC_ODDS[Math.max(4, mythicOddsIndex(odds))]!.id;

// ---------------------------------------------------------------- meaning tables

/**
 * Meaning Tables the emulator defines. `tables` are the ids rolled for one
 * word pair: Actions and Descriptions each use two tables, an Elements table
 * is rolled twice. Tables without data installed are listed as missing.
 */
export const MYTHIC_ELEMENT_TABLES = [
  'Adventure Tone', 'Alien Species Descriptors', 'Animal Actions', 'Army Descriptors', 'Cavern Descriptors', 'Characters',
  'Character Actions, Combat', 'Character Actions, General', 'Character Appearance', 'Character Background',
  'Character Conversations', 'Character Descriptors', 'Character Identity', 'Character Motivations', 'Character Personality',
  'Character Skills', 'Character Traits & Flaws', 'City Descriptors', 'Civilization Descriptors', 'Creature Abilities',
  'Creature Descriptors', 'Cryptic Message', 'Curses', 'Domicile Descriptors', 'Dungeon Descriptors', 'Dungeon Traps',
  'Forest Descriptors', 'Gods', 'Legends', 'Locations', 'Magic Item Descriptors', 'Mutation Descriptors', 'Names', 'Noble House',
  'Objects', 'Plot Twists', 'Powers', 'Scavenging Results', 'Smells', 'Sounds', 'Spell Effects', 'Starship Descriptors',
  'Terrain Descriptors', 'Undead Descriptors', 'Visions & Dreams',
] as const;
export const mythicSlug = (title: string) => title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export interface MeaningChoice { id: string; label: string; tables: [string, string]; group: 'core' | 'elements' }
export const MYTHIC_MEANING_CHOICES: readonly MeaningChoice[] = [
  { id: 'actions', label: 'Actions', tables: ['meaning-actions-1', 'meaning-actions-2'], group: 'core' },
  { id: 'descriptions', label: 'Descriptions', tables: ['meaning-descriptions-1', 'meaning-descriptions-2'], group: 'core' },
  ...MYTHIC_ELEMENT_TABLES.map((title): MeaningChoice => {
    const id = `meaning-elements-${mythicSlug(title)}`;
    return { id: `elements-${mythicSlug(title)}`, label: title, tables: [id, id], group: 'elements' };
  }),
];
/** First Scene by the four Ws: which Meaning Table answers each. */
export const FOUR_W = [
  { label: 'Who', choice: 'elements-characters' }, { label: 'What', choice: 'actions' },
  { label: 'Where', choice: 'elements-locations' }, { label: 'Why', choice: 'actions' },
] as const;

/** Guidance for the variations that are advice and not dice. */
export const PLAYER_VS_PC_KNOWLEDGE = [
  { strategy: 'Test it, ask it, then it is real', solution: 'Your character checks for the thing before you ask a Fate Question about whether it exists.' },
  { strategy: 'Reliable or unreliable information', solution: 'What you know as a player is not canon until your character discovers it, so it may turn out wrong.' },
  { strategy: 'Going with it', solution: 'Accept what you know and enjoy the whole adventure from a cinematic view, more than its surprises.' },
  { strategy: 'Extra knowledge as an opportunity', solution: 'What you know opens a chance for your character to earn it in play.' },
] as const;
