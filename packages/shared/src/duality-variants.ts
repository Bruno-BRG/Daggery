/**
 * Duality GME: vows, moves, progress tracks and Pay
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

export type IronMoveGroup = 'session' | 'quest' | 'adventure' | 'exploration' | 'connection' | 'scene' | 'combat' | 'suffer' | 'fate';
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
  { id: 'exploration', label: 'Exploration moves' }, { id: 'connection', label: 'Relationship moves' },
  { id: 'scene', label: 'Scene challenge' }, { id: 'combat', label: 'Combat moves' }, { id: 'suffer', label: 'Suffer moves' },
  { id: 'fate', label: 'Fate moves' },
];

/**
 * Every move in Ironsworn Lodestar, by its Ironsworn name. Duality GME has all of them. The rest of
 * the catalog (session moves, expedition moves, scene challenges, the GM turn) is Duality GME's own.
 */
export const LODESTAR_MOVE_NAMES = [
  'Face Danger', 'Secure an Advantage', 'Gather Information', 'Heal', 'Resupply', 'Make Camp', 'Undertake a Journey', 'Reach Your Destination',
  'Compel', 'Sojourn', 'Draw the Circle', 'Forge a Bond', 'Test Your Bond', 'Aid Your Ally', 'Write Your Epilogue',
  'Enter the Fray', 'Strike', 'Clash', 'Turn the Tide', 'End the Fight', 'Battle',
  'Endure Harm', 'Face Death', 'Companion Endure Harm', 'Endure Stress', 'Face Desolation', 'Out of Supply', 'Face a Setback',
  'Swear an Iron Vow', 'Reach a Milestone', 'Fulfill Your Vow', 'Forsake Your Vow', 'Advance',
  'Pay the Price', 'Ask the Oracle',
] as const;
export const isLodestarMove = (move: Pick<IronMove, 'name'>) => (LODESTAR_MOVE_NAMES as readonly string[]).includes(move.name);

/*
 * How the Ironsworn words read here:
 *   strong hit = success with Hope (or a critical success); weak hit = success with Fear; miss = failure.
 *   +edge, +heart, +iron, +shadow, +wits = Agility, Presence, Strength, Finesse, Instinct or Knowledge.
 *   health and spirit = Hit Points and Stress on your sheet. "Suffer -1 health" = mark 1 Hit Point.
 *   "Take +1 health" = clear 1 Hit Point. "Suffer -1 spirit" = mark 1 Stress.
 *   Ironsworn's "+1" on a roll is +2 here, because the Duality Dice are bigger.
 *   Momentum and Supply are on the Momentum tracker.
 */
const TRAITS = 'Agility (speed, agility, precision), Presence (charm, loyalty, courage), Strength (aggressive action, forceful defense, endurance), Finesse (deception, stealth, trickery), Instinct or Knowledge (expertise, insight, observation)';
export const IRON_MOVES: readonly IronMove[] = [
  { id: 'begin-session', group: 'session', name: 'Begin a Session', trigger: 'When you begin a significant session.',
    text: 'Set or review your flags, recap where you left off, and set the scene: where you are and what you intend. You may spotlight a danger, opportunity or insight elsewhere: roll a Vignette, envision it, and take +1 momentum as you return to your character.' },
  { id: 'set-flag', group: 'session', name: 'Set a Flag', trigger: 'When you want to avoid or handle with care some content.',
    text: 'Note it. When it comes up, use Change Your Fate.' },
  { id: 'change-fate', group: 'session', name: 'Change Your Fate', trigger: 'When flagged content comes up, or a result does not fit the story you want.',
    text: 'Reframe or replace it: reroll the oracle, or choose another outcome that keeps the stakes.' },
  { id: 'take-break', group: 'session', name: 'Take a Break', trigger: 'When you pause during a session.',
    text: 'Note what was happening and what you intend, so you can pick it up.' },
  { id: 'end-session', group: 'session', name: 'End a Session', trigger: 'When you end a session.',
    text: 'If there is a vow, connection or situation you want to focus on next time, note it and take +1 momentum.' },

  // ------------------------------------------------------------------ Quest moves
  { id: 'swear-vow', group: 'quest', name: 'Swear an Iron Vow', trigger: 'When you swear upon iron to complete a quest, write your vow and give the quest a rank.', roll: 'Presence. If you make this vow to a person or community with whom you share a bond, add +2.',
    strong: 'You are emboldened and it is clear what you must do next (Ask the Oracle if unsure). Take +2 momentum.',
    weak: 'You are determined, but you begin your quest with more questions than answers. Take +1 momentum, and envision what you do to find a path forward.',
    miss: 'You face a significant obstacle before you can begin. Envision what stands in your way (Ask the Oracle if unsure), and choose one: you press on (suffer -2 momentum, and do what you must to overcome the obstacle), or you give up (Forsake Your Vow).' },
  { id: 'milestone', group: 'quest', name: 'Reach a Milestone', trigger: 'When you make significant progress in your quest by overcoming a critical obstacle, completing a perilous journey, solving a complex mystery, defeating a powerful threat, gaining vital support, or acquiring a crucial item, you may mark progress.',
    text: 'Mark progress on the vow at its rank: Minor 3 boxes, Serious 2 boxes, Grave 1 box, Dire 2 ticks, Legendary 1 tick.' },
  { id: 'fulfill-vow', group: 'quest', name: 'Fulfill Your Vow', trigger: 'When you achieve what you believe to be the fulfillment of your vow.', roll: 'Progress roll. Momentum is ignored.',
    strong: 'Your quest is complete. Mark experience: Minor 1, Serious 2, Grave 3, Dire 4, Legendary 5.',
    weak: 'There is more to be done or you realize the truth of your quest. Envision what you discover (Ask the Oracle if unsure). Then mark experience: Minor 0, Serious 1, Grave 2, Dire 3, Legendary 4. You may Swear an Iron Vow to set things right, and add +2.',
    miss: 'Your quest is undone. Envision what happens (Ask the Oracle if unsure), and choose one: you recommit (clear all but one filled progress, and raise the quest’s rank by one if not already Legendary), or you give up (Forsake Your Vow).' },
  { id: 'forsake-vow', group: 'quest', name: 'Forsake Your Vow', trigger: 'When you renounce your quest, betray your promise, or the goal is lost to you.',
    text: 'Clear the vow and Endure Stress. You suffer -spirit (mark Stress) by the rank of your quest: Minor 1, Serious 2, Grave 3, Dire 4, Legendary 5. If the vow was made to a person or community with whom you share a bond, Test Your Bond when you next meet.' },
  { id: 'advance', group: 'quest', name: 'Advance', trigger: 'When you focus on your skills, receive training, find inspiration, earn a reward, or gain a companion.',
    text: 'You may spend 3 experience to add a new asset, or 2 experience to upgrade an asset. In Duality GME an asset is a Daggerheart choice: a domain card, an Experience, or a companion. Use this instead of levelling up by milestones, or alongside it.' },

  // ------------------------------------------------------------------ Adventure moves
  { id: 'face-danger', group: 'adventure', name: 'Face Danger', trigger: 'When you attempt something risky or react to an imminent threat, envision your action and roll.', roll: TRAITS,
    strong: 'You are successful. Take +1 momentum.',
    weak: 'You succeed, but face a troublesome cost. Choose one: you are delayed, lose advantage or face a new danger (suffer -1 momentum); you are tired or hurt (Endure Harm, 1 harm); you are dispirited or afraid (Endure Stress, 1 stress); you sacrifice resources (suffer -1 supply).',
    miss: 'You fail, or your progress is undermined by a dramatic and costly turn of events. Pay the Price.' },
  { id: 'secure-advantage', group: 'adventure', name: 'Secure an Advantage', trigger: 'When you assess a situation, make preparations, or attempt to gain leverage, envision your action and roll.', roll: TRAITS,
    strong: 'You gain advantage. Choose one: take control (make another move now, not a progress move, with advantage); or prepare to act (take +2 momentum).',
    weak: 'Your advantage is short-lived. Take +1 momentum.',
    miss: 'You fail or your assumptions betray you. Pay the Price.' },
  { id: 'gather-information', group: 'adventure', name: 'Gather Information', trigger: 'When you search an area, ask questions, conduct an investigation, or follow a track.', roll: 'Instinct or Knowledge. If you act within a community or ask questions of a person with whom you share a bond, add +2.',
    strong: 'You discover something helpful and specific. The path you must follow or action you must take to make progress is made clear. Envision what you learn (Ask the Oracle if unsure), and take +2 momentum.',
    weak: 'The information complicates your quest or introduces a new danger. Envision what you discover (Ask the Oracle if unsure), and take +1 momentum.',
    miss: 'Your investigation unearths a dire threat or reveals an unwelcome truth that undermines your quest. Pay the Price.' },
  { id: 'heal', group: 'adventure', name: 'Heal', trigger: 'When you treat an injury or ailment.', roll: 'Knowledge. If you are mending your own wounds, roll Knowledge or Strength, whichever is lower.',
    strong: 'Your care is helpful. If you (or the ally under your care) are Wounded, you may clear it. Then, clear up to 2 Hit Points: take them yourself or give them.',
    weak: 'As above, but you must suffer -1 supply or -1 momentum (your choice).',
    miss: 'Your aid is ineffective. Pay the Price.' },
  { id: 'resupply', group: 'adventure', name: 'Resupply', trigger: 'When you hunt, forage, or scavenge.', roll: 'Instinct',
    strong: 'You bolster your resources. Take +2 supply.',
    weak: 'Take up to +2 supply, but suffer -1 momentum for each.',
    miss: 'You find nothing helpful. Pay the Price.' },
  { id: 'make-camp', group: 'adventure', name: 'Make Camp', trigger: 'When you rest and recover for several hours in the wild.', roll: 'Instinct, adding your supply (to a maximum of +3).',
    strong: 'You and your allies may each choose two. Recuperate: clear 1 Hit Point for you and any companions. Partake: suffer -1 supply and clear 1 Hit Point for you and any companions. Relax: clear 1 Stress. Focus: take +1 momentum. Prepare: when you break camp, add +2 if you Undertake a Journey.',
    weak: 'As above, but choose one.',
    miss: 'You take no comfort. Pay the Price.' },
  { id: 'undertake-expedition', group: 'adventure', name: 'Undertake a Journey', trigger: 'When you travel across hazardous or unfamiliar lands, set the rank of your journey: Minor, Serious, Grave, Dire or Legendary. Then, for each segment of your journey, roll.', roll: 'Instinct, against the rank’s Difficulty. If you are setting off from a community with which you share a bond, add +2 to your initial roll.',
    strong: 'You reach a waypoint. If the waypoint is unknown to you, envision it (Ask the Oracle if unsure). Then choose one: you make good use of your resources (mark progress); or you move at speed (mark progress and take +1 momentum, but suffer -1 supply).',
    weak: 'You reach a waypoint and mark progress, but suffer -1 supply.',
    miss: 'You are waylaid by a perilous event. Pay the Price.' },
  { id: 'finish-expedition', group: 'adventure', name: 'Reach Your Destination', trigger: 'When your journey comes to an end.', roll: 'Progress roll. Momentum is ignored.',
    strong: 'The situation at your destination favors you. Choose one: make another move now (not a progress move), and add +2; or take +1 momentum.',
    weak: 'You arrive but face an unforeseen hazard or complication. Envision what you find (Ask the Oracle if unsure).',
    miss: 'You have gone hopelessly astray, your objective is lost to you, or you were misled about your destination. If your journey continues, clear all but one filled progress, and raise the journey’s rank by one (if not already Legendary).' },

  // ------------------------------------------------------------------ Exploration extras
  { id: 'explore-waypoint', group: 'exploration', name: 'Explore a Waypoint', trigger: 'When you reach a waypoint and look around.', roll: 'Instinct or Knowledge',
    strong: 'Find an Opportunity. On a critical, Make a Discovery instead.', weak: 'You find a detail and face a choice: a risk for a reward.',
    miss: 'Peril: Pay the Price. On a failure with Fear, make a Fear Check: a pass spends 1 Fear and you Confront Chaos.' },
  { id: 'make-discovery', group: 'exploration', name: 'Make a Discovery', trigger: 'When you find something wondrous.',
    text: 'Roll Make a Discovery and envision it. Take +1 momentum, or Reach a Milestone if it bears on a vow.' },
  { id: 'confront-chaos', group: 'exploration', name: 'Confront Chaos', trigger: 'When you meet something strange and wrong.',
    text: 'Roll Confront Chaos and envision it. Face Danger to endure or escape it.' },

  // ------------------------------------------------------------------ Relationship moves
  { id: 'compel', group: 'connection', name: 'Compel', trigger: 'When you attempt to persuade someone to do something, envision your approach and roll.', roll: 'Presence to charm, pacify, barter or convince (add +2 if you share a bond). Strength to threaten or incite. Finesse to lie or swindle.',
    strong: 'They’ll do what you want or share what they know. Take +1 momentum. If you use this exchange to Gather Information, make that move now and add +2.',
    weak: 'As above, but they ask something of you in return. Envision what they want (Ask the Oracle if unsure).',
    miss: 'They refuse or make a demand which costs you greatly. Pay the Price.' },
  { id: 'sojourn', group: 'connection', name: 'Sojourn', trigger: 'When you spend time in a community seeking assistance.', roll: 'Presence. If you share a bond, add +2.',
    strong: 'You and your allies may each choose two from the categories below. If you share a bond, choose one more.',
    weak: 'Choose one. If you share a bond, choose one more.',
    miss: 'You find no help here. Pay the Price.',
    text: 'On a hit, you and your allies may each focus on one of your chosen Recover actions and roll Presence again. If you share a bond, add +2. On a strong hit, take +2 more for that action. On a weak hit, take +1 more. On a miss, it goes badly and you lose all benefits for that action. CLEAR A CONDITION: Mend (clear Wounded and take +1 health: clear 1 Hit Point); Hearten (clear Shaken and clear 1 Stress); Equip (clear Unprepared and take +1 supply). RECOVER: Recuperate (clear 2 Hit Points for you and any companions); Consort (clear 2 Stress); Provision (take +2 supply); Plan (take +2 momentum). PROVIDE AID: Take a quest. Envision what this community needs, or what trouble it is facing (Ask the Oracle if unsure). If you chose to help, Swear an Iron Vow and add +2.' },
  { id: 'draw-circle', group: 'connection', name: 'Draw the Circle', trigger: 'When you challenge someone to a formal duel, or accept a challenge.', roll: 'Presence. If you share a bond with this community, add +2.',
    strong: 'Take +1 momentum. You may also choose up to two boasts and take +1 momentum for each.',
    weak: 'You may choose one boast in exchange for +1 momentum.',
    miss: 'You begin the duel at a disadvantage. Your foe has initiative. Pay the Price.',
    text: 'BOASTS: Grant first strike (your foe has initiative). Bare yourself (take no benefit of armor or shield; your foe’s harm is +1). Hold no iron (take no benefit of weapons; your harm is 1). Bloody yourself (Endure Harm, 1 harm). To the death (one way or another, this fight must end with death). Then make moves to resolve the fight. If you are the victor, you may make a lawful demand, and your opponent must comply or forfeit their honor and standing. If you refuse the challenge, surrender, or are defeated, they make a demand of you.' },
  { id: 'make-connection', group: 'connection', name: 'Make a Connection', trigger: 'When you build a relationship with someone.', roll: 'Presence',
    strong: 'They become a connection: give them a role (guide, healer, smuggler). Take +1 momentum.', weak: 'They become a connection after you do something for them first.',
    miss: 'They distrust you or want too much: Pay the Price.' },
  { id: 'forge-bond', group: 'connection', name: 'Forge a Bond', trigger: 'When you spend significant time with a person or community, stand together to face hardships, or make sacrifices for their cause, you can attempt to create a bond.', roll: 'Presence. If you make this move after you successfully Fulfill Your Vow to their benefit, you may reroll any dice.',
    strong: 'Make note of the bond, mark a tick on your bonds track, and choose one: clear 1 Stress (take +1 spirit); or take +2 momentum.',
    weak: 'They ask something more of you first. Envision what it is (Ask the Oracle if unsure), do it (or Swear an Iron Vow), and mark the bond. If you refuse or fail, Pay the Price.',
    miss: 'They reject you. Pay the Price.' },
  { id: 'test-bond', group: 'connection', name: 'Test Your Bond', trigger: 'When your bond is tested through conflict, betrayal, or circumstance.', roll: 'Presence',
    strong: 'This test has strengthened your bond. Choose one: clear 1 Stress (take +1 spirit); or take +2 momentum.',
    weak: 'Your bond is fragile and you must prove your loyalty. Envision what they ask of you (Ask the Oracle if unsure), and do it (or Swear an Iron Vow). If you refuse or fail, clear the bond and Pay the Price.',
    miss: 'Clear the bond and Pay the Price. The same happens if you have no interest in maintaining this relationship.' },
  { id: 'aid-ally', group: 'connection', name: 'Aid Your Ally', trigger: 'When you Secure an Advantage in direct support of an ally.',
    text: 'If you score a hit, they (instead of you) can take the benefits of the move. If you are in combat and score a strong hit, you and your ally have initiative. In solo play your ally is a companion or an NPC who fights beside you.' },
  { id: 'write-epilogue', group: 'connection', name: 'Write Your Epilogue', trigger: 'When you retire from your life as Ironsworn, envision two things: what you hope for, and what you fear. Then roll the challenge dice and compare to your bonds.', roll: 'Progress roll on your bonds. Momentum is ignored.',
    strong: 'Things come to pass as you hoped.',
    weak: 'Your life takes an unexpected turn, but not necessarily for the worse. You find yourself spending your days with someone or in a place you did not foresee. Envision it (Ask the Oracle if unsure).',
    miss: 'Your fears are realized.' },

  // ------------------------------------------------------------------ Scene challenge
  { id: 'begin-scene', group: 'scene', name: 'Begin the Scene', trigger: 'When you face a tense, extended situation: a chase, an infiltration, a debate.',
    text: 'Name the objective and give it a Grave track. Set a tension clock: 4 segments at a disadvantage, 6 on even footing, 8 with an advantage.' },
  { id: 'scene-action', group: 'scene', name: 'Face Danger or Secure an Advantage (in a scene)', trigger: 'When you act within a scene challenge.', roll: 'The trait that fits',
    strong: 'Mark progress.', weak: 'Mark progress and fill 1 clock segment.', miss: 'Fill 1 segment (2 on a failure with Fear) and Pay the Price.' },
  { id: 'finish-scene', group: 'scene', name: 'Finish the Scene', trigger: 'When the track or the clock is full, or the story ends it.', roll: 'Progress roll',
    strong: 'You achieve your objective.', weak: 'You achieve it at a cost, or only in part.', miss: 'You fail: Pay the Price.' },

  // ------------------------------------------------------------------ Combat moves
  { id: 'enter-fray', group: 'combat', name: 'Enter the Fray', trigger: 'When you enter into combat, set the rank of each of your foes (Minor, Serious, Grave, Dire or Legendary), then roll to determine who is in control.', roll: 'Presence if you face off against your foe. Finesse if you move into position against an unaware foe, or strike without warning. Instinct if you are ambushed.',
    strong: 'Take +2 momentum. You have initiative.',
    weak: 'Choose one: bolster your position (take +2 momentum), or prepare to act (take initiative).',
    miss: 'Combat begins with you at a disadvantage. Pay the Price. Your foe has initiative.' },
  { id: 'strike', group: 'combat', name: 'Strike', trigger: 'When you have initiative and attack in close quarters, or you have initiative and attack at range.', roll: 'Strength in close quarters. Agility at range.',
    strong: 'Inflict +1 harm. You retain initiative.',
    weak: 'Inflict your harm and lose initiative.',
    miss: 'Your attack fails and you must Pay the Price. Your foe has initiative.' },
  { id: 'clash', group: 'combat', name: 'Clash', trigger: 'When your foe has initiative and you fight with them in close quarters, or you exchange a volley at range, or shoot at an advancing foe.', roll: 'Strength in close quarters. Agility at range.',
    strong: 'Inflict your harm and choose one. You have the initiative. You bolster your position (take +1 momentum), or you find an opening (inflict +1 harm).',
    weak: 'Inflict your harm, but then Pay the Price. Your foe has initiative.',
    miss: 'You are outmatched and must Pay the Price. Your foe has initiative.' },
  { id: 'turn-tide', group: 'combat', name: 'Turn the Tide', trigger: 'Once per fight, when you risk it all, you may steal initiative from your foe to make a move (not a progress move).',
    text: 'When you do, add +2 and take +1 momentum on a hit. If you fail to score a hit on that move, you must suffer a dire outcome: Pay the Price, and make it severe.' },
  { id: 'end-fight', group: 'combat', name: 'End the Fight', trigger: 'When you make a move to take decisive action, and score a strong hit, you may resolve the outcome of this fight. If you do, roll the challenge dice and compare to your progress.', roll: 'Progress roll on the foe’s track. Momentum is ignored.',
    strong: 'This foe is no longer in the fight. They are killed, out of action, flee, or surrender as appropriate to the situation and your intent (Ask the Oracle if unsure).',
    weak: 'As above, but you must also choose one: it’s worse than you thought (Endure Harm); you are overcome (Endure Stress); your victory is short-lived (a new danger or foe appears, or an existing danger worsens); you suffer collateral damage (something of value is lost or broken, or someone important must pay the cost); you’ll pay for it (an objective falls out of reach); others won’t forget (you are marked for vengeance).',
    miss: 'You have lost this fight. Pay the Price.' },
  { id: 'battle', group: 'combat', name: 'Battle', trigger: 'When you fight a battle, and it happens in a blur, envision your objective and roll.', roll: 'Agility if you fight at range, or use your speed and the terrain. Presence if you fight depending on courage, allies or companions. Strength if you fight in close to overpower. Finesse if you fight with trickery to befuddle. Knowledge if you fight with careful tactics to outsmart.',
    strong: 'You achieve your objective unconditionally. Take +2 momentum.',
    weak: 'You achieve your objective, but not without cost. Pay the Price.',
    miss: 'You are defeated and the objective is lost to you. Pay the Price.' },
  { id: 'gm-turn', group: 'combat', name: 'The GM turn', trigger: 'When your foe has initiative and acts, or the spotlight passes to the GM in a full fight.',
    text: 'Make a Fear Check: a fail is a free action (Tactics); a pass spends Fear (Fear Spend). Chain until a check fails. Or roll Combat Action for what the foe does. Then you react: Clash, Face Danger, Compel or Turn the Tide.' },

  // ------------------------------------------------------------------ Suffer moves
  { id: 'endure-harm', group: 'suffer', name: 'Endure Harm', trigger: 'When you face physical damage, suffer -health equal to your foe’s rank or as appropriate to the situation: mark that many Hit Points. If you have no Hit Points left, suffer -momentum equal to any remaining harm. Then roll.', roll: 'Strength, or your unmarked Hit Points (to a maximum of +3), whichever is higher.',
    strong: 'Choose one. Shake it off: if you still have an unmarked Hit Point, suffer -1 momentum in exchange for clearing 1 Hit Point. Embrace the pain: take +1 momentum.',
    weak: 'You press on.',
    miss: 'Also suffer -1 momentum. If you have no unmarked Hit Points left, you must mark Wounded or Maimed (if currently unmarked) or roll on the Endure Harm table.' },
  { id: 'face-death', group: 'suffer', name: 'Face Death', trigger: 'When you are brought to the brink of death, and glimpse the world beyond. Use this in place of the Daggerheart death move.', roll: 'Presence',
    strong: 'Death rejects you. You are cast back into the mortal world.',
    weak: 'Choose one. You die, but not before making a noble sacrifice (envision your final moments). Or death desires something of you in exchange for your life: envision what it wants (Ask the Oracle if unsure), and Swear an Iron Vow (Grave or Dire) to complete that quest. If you fail to score a hit when you Swear an Iron Vow, or refuse the quest, you are dead. Otherwise, you return to the mortal world and are now Cursed. You may only clear the Cursed debility by completing the quest.',
    miss: 'You are dead.' },
  { id: 'companion-endure-harm', group: 'suffer', name: 'Companion Endure Harm', trigger: 'When your companion faces physical damage, they suffer -health equal to the harm inflicted. If your companion’s health is 0, exchange any leftover -health for -momentum. Then roll.', roll: 'Presence, or your companion’s unmarked Hit Points (to a maximum of +3), whichever is higher.',
    strong: 'Your companion rallies. Give them +1 health.',
    weak: 'Your companion is battered. If their health is 0, they cannot assist you until they gain at least +1 health.',
    miss: 'Also suffer -1 momentum. If your companion’s health is 0, they are gravely wounded and out of action. Without aid, they die in an hour or two. If you roll a miss and your Hope die shows 1, and your companion’s health is 0, they are now dead: take 1 experience for each marked ability on your companion, and remove it.' },
  { id: 'endure-stress', group: 'suffer', name: 'Endure Stress', trigger: 'When you face mental shock or despair, suffer -spirit equal to your foe’s rank or as appropriate to the situation: mark that much Stress. If you have no unmarked Stress left, suffer -momentum equal to any remaining stress. Then roll.', roll: 'Presence, or your unmarked Stress (to a maximum of +3), whichever is higher.',
    strong: 'Choose one. Shake it off: if you still have unmarked Stress, suffer -1 momentum in exchange for clearing 1 Stress. Embrace the darkness: take +1 momentum.',
    weak: 'You press on.',
    miss: 'Also suffer -1 momentum. If you have no unmarked Stress left, you must mark Shaken or Corrupted (if currently unmarked) or roll on the Endure Stress table.' },
  { id: 'face-desolation', group: 'suffer', name: 'Face Desolation', trigger: 'When you are brought to the brink of desolation.', roll: 'Presence',
    strong: 'You resist and press on.',
    weak: 'Choose one. Your spirit or sanity breaks, but not before you make a noble sacrifice (envision your final moments). Or you see a vision of a dreaded event coming to pass: envision that dark future (Ask the Oracle if unsure), and Swear an Iron Vow (Grave or Dire) to prevent it. If you fail to score a hit when you Swear an Iron Vow, or refuse the quest, you are lost. Otherwise, you return to your senses and are now Tormented. You may only clear the Tormented debility by completing the quest.',
    miss: 'You succumb to despair or horror and are lost.' },
  { id: 'out-of-supply', group: 'suffer', name: 'Out of Supply', trigger: 'When your supply is exhausted (reduced to 0), mark Unprepared.',
    text: 'If you suffer additional -supply while Unprepared, you must exchange each additional -supply for any combination of -health (mark Hit Points), -spirit (mark Stress) or -momentum, as appropriate to the circumstances.' },
  { id: 'face-setback', group: 'suffer', name: 'Face a Setback', trigger: 'When your momentum is at its minimum (-6), and you suffer additional -momentum, choose one.',
    text: 'Exchange each additional -momentum for any combination of -health (mark Hit Points), -spirit (mark Stress) or -supply, as appropriate to the circumstances. Or envision an event or discovery (Ask the Oracle if unsure) which undermines your progress in a current quest, journey or fight. Then, for each additional -momentum, clear 1 unit of progress on that track by its rank: Minor clears 3 boxes, Serious 2 boxes, Grave 1 box, Dire 2 ticks, Legendary 1 tick.' },

  // ------------------------------------------------------------------ Fate moves
  { id: 'ask-oracle', group: 'fate', name: 'Ask the Oracle', trigger: 'When you seek to resolve questions, discover details in the world, determine how other characters respond, or trigger encounters or events.', roll: 'Duality Dice vs likelihood',
    text: 'Choose one. Draw a conclusion: decide the answer from the most interesting and obvious result. Ask a yes/no question: decide the odds of a yes, and roll the Duality Dice against the likelihood. Pick two: envision two options, rate one as likely, and roll to see if it is true; if not, it is the other. Spark an idea: brainstorm, or roll a random prompt on Meaning (or the d100 Action and Theme oracles). Doubles bring an extreme result or a twist.' },
  { id: 'pay-price', group: 'fate', name: 'Pay the Price', trigger: 'When you suffer the outcome of a move, choose one.', roll: 'Pay the Price table',
    text: 'Make the most obvious negative outcome happen. Or envision two negative outcomes, rate one as likely, and Ask the Oracle: on a yes, make that outcome happen, otherwise make the other. Or roll on the Pay the Price table. If you have difficulty interpreting the result, roll again. A severe price (a failure with Fear, or a move that says so) rolls twice: the world may spend 1 Fear to make it so.' },
];
