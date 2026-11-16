/**
 * Duality GME: oaths, moves, progress tracks and Pay
 * the Price, using the Daggerheart action roll as the move roll. Every
 * function takes its dice as arguments: the server rolls, these decide.
 *
 * Its structure follows Ironsworn and Starforged. Code ids keep the old `iron` and `vow` names
 * because saved campaigns store them (variant 'iron', track kind 'vow', rank ids).
 */
import { DUALITY_LIKELIHOODS } from './duality-engine';

const assertDie = (value: number, sides: number, name: string) => {
  if (!Number.isInteger(value) || value < 1 || value > sides) throw new Error(`Invalid ${name}`);
};

// ====================================================================== Duality GME

export const IRON_RANKS = [
  { id: 'troublesome', label: 'Minor', ticks: 12, mark: '3 boxes', difficulty: 10 },
  { id: 'dangerous', label: 'Serious', ticks: 8, mark: '2 boxes', difficulty: 13 },
  { id: 'formidable', label: 'Grave', ticks: 4, mark: '1 box', difficulty: 15 },
  { id: 'extreme', label: 'Dire', ticks: 2, mark: '2 ticks', difficulty: 18 },
  { id: 'epic', label: 'Legendary', ticks: 1, mark: '1 tick', difficulty: 20 },
] as const;
export type IronRank = (typeof IRON_RANKS)[number]['id'];
export const IRON_TRACK_TICKS = 40;
export const ironRank = (id: string) => {
  const found = IRON_RANKS.find(item => item.id === id);
  if (!found) throw new Error('Invalid rank');
  return found;
};
/** Ticks after marking progress once at a rank, capped at 10 full boxes. */
export const markIronProgress = (ticks: number, rank: string) => Math.min(IRON_TRACK_TICKS, ticks + ironRank(rank).ticks);
/** The progress score: full boxes, 0 to 10. */
export const ironProgressScore = (ticks: number) => Math.floor(Math.min(IRON_TRACK_TICKS, Math.max(0, ticks)) / 4);

export type IronOutcome = 'strong' | 'weak' | 'miss';
export const IRON_OUTCOME_LABELS: Record<IronOutcome, string> = { strong: 'Strong hit', weak: 'Weak hit', miss: 'Miss' };
/** A progress roll: the score must beat each challenge die (ties go to the dice). Matching dice: a twist. */
export function resolveIronProgress(score: number, challenge1: number, challenge2: number): { outcome: IronOutcome; match: boolean } {
  if (!Number.isInteger(score) || score < 0 || score > 10) throw new Error('Invalid progress score');
  assertDie(challenge1, 10, 'challenge die'); assertDie(challenge2, 10, 'challenge die');
  const beaten = Number(score > challenge1) + Number(score > challenge2);
  return { outcome: beaten === 2 ? 'strong' : beaten === 1 ? 'weak' : 'miss', match: challenge1 === challenge2 };
}

/** GME likelihoods over the Hope + Fear targets. */
export const IRON_LIKELIHOODS = DUALITY_LIKELIHOODS;
export const IRON_CLOCK_SIZES = [4, 6, 8] as const;

export type IronMoveGroup = 'session' | 'quest' | 'adventure' | 'exploration' | 'connection' | 'scene' | 'combat' | 'fate';
export interface IronMove {
  id: string; group: IronMoveGroup; name: string;
  /** When you make the move. */
  trigger: string;
  /** The roll, if any: a trait, "progress roll", or a table. */
  roll?: string;
  strong?: string; weak?: string; miss?: string;
  /** For moves without outcomes: what to do. */
  text?: string;
}
export const IRON_MOVE_GROUPS: { id: IronMoveGroup; label: string }[] = [
  { id: 'session', label: 'Session moves' }, { id: 'quest', label: 'Quest moves' }, { id: 'adventure', label: 'Adventure moves' },
  { id: 'exploration', label: 'Exploration moves' }, { id: 'connection', label: 'Connection moves' },
  { id: 'scene', label: 'Scene challenge' }, { id: 'combat', label: 'Combat moves' }, { id: 'fate', label: 'Fate moves' },
];
export const IRON_MOVES: readonly IronMove[] = [
  { id: 'begin-session', group: 'session', name: 'Begin a Session', trigger: 'When you begin a significant session.',
    text: 'Set or review your flags, recap where you left off, and set the scene: where you are and what you intend. You may spotlight a danger, opportunity or insight elsewhere: roll a Vignette, envision it, and gain a Hope as you return to your character.' },
  { id: 'set-flag', group: 'session', name: 'Set a Flag', trigger: 'When you want to avoid or handle with care some content.',
    text: 'Note it. When it comes up, use Change Your Fate.' },
  { id: 'change-fate', group: 'session', name: 'Change Your Fate', trigger: 'When flagged content comes up, or a result does not fit the story you want.',
    text: 'Reframe or replace it: reroll the oracle, or choose another outcome that keeps the stakes.' },
  { id: 'take-break', group: 'session', name: 'Take a Break', trigger: 'When you pause during a session.',
    text: 'Note what was happening and what you intend, so you can pick it up.' },
  { id: 'end-session', group: 'session', name: 'End a Session', trigger: 'When you end a session.',
    text: 'If there is an oath, connection or situation you want to focus on next time, note it and gain a Hope.' },

  { id: 'swear-vow', group: 'quest', name: 'Take an Oath', trigger: 'When you swear an oath to complete a quest.', roll: 'Presence vs the rank’s Difficulty',
    strong: 'You know what to do next. Gain a Hope.', weak: 'The next step is unclear: ask the Oracle or Gather Information.',
    miss: 'A significant obstacle stands in your way before you can begin: envision it, or Pay the Price.' },
  { id: 'milestone', group: 'quest', name: 'Reach a Milestone', trigger: 'When you make significant progress on an oath: overcome an obstacle, learn a truth, reach a place.',
    text: 'Mark progress on the oath at its rank.' },
  { id: 'fulfill-vow', group: 'quest', name: 'Keep Your Oath', trigger: 'When you reach the end of a quest.', roll: 'Progress roll',
    strong: 'Your oath is kept. If Serious or higher, it is a milestone for levelling up.',
    weak: 'It is done, but there is more to it: take a new oath to finish it, or accept a lesser outcome.',
    miss: 'It is undone or you were deceived: take a new oath at a higher rank, or break this one.' },
  { id: 'forsake-vow', group: 'quest', name: 'Break Your Oath', trigger: 'When you abandon an oath.',
    text: 'Clear the track and mark 2 Stress. Someone may hold it against you.' },

  { id: 'face-danger', group: 'adventure', name: 'Face Danger', trigger: 'When you act despite a threat or under pressure.', roll: 'The trait that fits',
    strong: 'You do it.', weak: 'You do it, but at a cost: mark a Stress, lose time, or something slips.', miss: 'You fail or your progress is undermined: Pay the Price.' },
  { id: 'secure-advantage', group: 'adventure', name: 'Secure an Advantage', trigger: 'When you prepare, assess, or gain leverage.', roll: 'The trait that fits',
    strong: 'Take advantage on your next roll, or gain a Hope.', weak: 'Take advantage on your next roll.', miss: 'It goes wrong: Pay the Price.' },
  { id: 'gather-information', group: 'adventure', name: 'Gather Information', trigger: 'When you search, investigate, or ask questions.', roll: 'Knowledge or Instinct',
    strong: 'You learn something helpful and specific. If it advances an oath, Reach a Milestone.', weak: 'You learn something, but it complicates things: ask the Oracle what.',
    miss: 'Your search turns up a hard truth or a danger: Pay the Price.' },
  { id: 'compel', group: 'adventure', name: 'Compel', trigger: 'When you persuade, threaten, or bargain.', roll: 'Presence',
    strong: 'They do what you want.', weak: 'They do it, but ask something in return.', miss: 'They refuse or turn against you: Pay the Price.' },
  { id: 'make-camp', group: 'adventure', name: 'Make Camp', trigger: 'When you rest in the wild.',
    text: 'Take a Daggerheart rest (the GM gains Fear as the rules say), then roll Rest and Camp for what happens.' },

  { id: 'undertake-expedition', group: 'exploration', name: 'Undertake an Expedition', trigger: 'When you travel through dangerous ground. Give it a rank and a track; roll for each segment.', roll: 'Instinct, Agility or Knowledge vs the rank’s Difficulty',
    strong: 'Mark progress and reach a waypoint.', weak: 'Mark progress, but suffer a cost (supplies, a Stress, a delay) or Pay the Price.',
    miss: 'You are waylaid: Pay the Price, no progress.' },
  { id: 'explore-waypoint', group: 'exploration', name: 'Explore a Waypoint', trigger: 'When you reach a waypoint and look around.', roll: 'Instinct or Knowledge',
    strong: 'Find an Opportunity. On a critical, Make a Discovery instead.', weak: 'You find a detail and face a choice: a risk for a reward.',
    miss: 'Peril: Pay the Price. On a failure with Fear, make a Fear Check: a pass spends 1 Fear and you Confront Chaos.' },
  { id: 'make-discovery', group: 'exploration', name: 'Make a Discovery', trigger: 'When you find something wondrous.',
    text: 'Roll Make a Discovery and envision it. Gain a Hope, or Reach a Milestone if it bears on an oath.' },
  { id: 'confront-chaos', group: 'exploration', name: 'Confront Chaos', trigger: 'When you meet something strange and wrong.',
    text: 'Roll Confront Chaos and envision it. Face Danger to endure or escape it.' },
  { id: 'finish-expedition', group: 'exploration', name: 'Finish an Expedition', trigger: 'When you reach the destination.', roll: 'Progress roll',
    strong: 'You arrive safely; the place is as you hoped.', weak: 'You arrive, but at a cost, or the place is not what you expected.',
    miss: 'You are lost or turned back: Pay the Price, then raise the rank and keep going, or abandon it.' },

  { id: 'make-connection', group: 'connection', name: 'Make a Connection', trigger: 'When you build a relationship with someone.', roll: 'Presence',
    strong: 'They become a connection: give them a role and a rank, and a track.', weak: 'They become a connection after you do something for them first.',
    miss: 'They distrust you or want too much: Pay the Price.' },
  { id: 'develop-relationship', group: 'connection', name: 'Develop Your Relationship', trigger: 'When you share a meaningful moment or help a connection.',
    text: 'Mark progress on their track.' },
  { id: 'forge-bond', group: 'connection', name: 'Forge a Bond', trigger: 'When your relationship is ready to become a bond.', roll: 'Progress roll',
    strong: 'The bond is forged. Once per session they can help you: an advantage die (d6).', weak: 'They ask one more thing of you first.',
    miss: 'Something comes between you: Pay the Price.' },

  { id: 'begin-scene', group: 'scene', name: 'Begin the Scene', trigger: 'When you face a tense, extended situation: a chase, an infiltration, a debate.',
    text: 'Name the objective and give it a Grave track. Set a tension clock: 4 segments at a disadvantage, 6 on even footing, 8 with an advantage.' },
  { id: 'scene-action', group: 'scene', name: 'Face Danger or Secure an Advantage (in a scene)', trigger: 'When you act within a scene challenge.', roll: 'The trait that fits',
    strong: 'Mark progress.', weak: 'Mark progress and fill 1 clock segment.', miss: 'Fill 1 segment (2 on a failure with Fear) and Pay the Price.' },
  { id: 'finish-scene', group: 'scene', name: 'Finish the Scene', trigger: 'When the track or the clock is full, or the story ends it.', roll: 'Progress roll',
    strong: 'You achieve your objective.', weak: 'You achieve it at a cost, or only in part.', miss: 'You fail: Pay the Price.' },

  { id: 'enter-fray', group: 'combat', name: 'Join the Fray', trigger: 'When a fight begins.', roll: 'Instinct or Agility',
    strong: 'You act first.', weak: 'The GM takes the spotlight first.', miss: 'The GM takes the spotlight first, and something goes wrong: Pay the Price.' },
  { id: 'battle', group: 'combat', name: 'Battle', trigger: 'When you resolve a minor fight in one roll.', roll: 'The trait that fits',
    strong: 'You win.', weak: 'You win, and Pay the Price.', miss: 'You lose, and Pay the Price.' },
  { id: 'gm-turn', group: 'combat', name: 'The GM turn', trigger: 'When the spotlight passes to the GM in a full fight.',
    text: 'Make a Fear Check: a fail is a free action (Tactics); a pass spends Fear (Fear Spend). Chain until a check fails.' },

  { id: 'ask-oracle', group: 'fate', name: 'Ask the Oracle', trigger: 'When you need an answer.', roll: 'Duality Dice vs likelihood',
    text: 'Pick a likelihood; doubles bring an extreme result or a twist. For open questions, roll Meaning.' },
  { id: 'pay-price', group: 'fate', name: 'Pay the Price', trigger: 'When a move tells you to.', roll: 'Pay the Price table',
    text: 'Choose the most obvious negative outcome, or roll. A severe price (failure with Fear, the GM spends 1 Fear) rolls twice.' },
];
