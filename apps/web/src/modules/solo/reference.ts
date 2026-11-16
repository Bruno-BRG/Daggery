import type { IconName } from '../../components/Icon';
import { DUALITY_LIKELIHOODS, IRON_RANKS } from '@daggery/shared';

export interface RefBlock { title: string; note?: string; rows: readonly (readonly [string, string])[] }
export interface SoloSection {
  id: string; label: string; icon: IconName;
  /** One or two sentences from the manual on when you use this section during play. */
  intro: string;
  /** d12 table ids from DUALITY_TABLES, in manual order. Every DUALITY_TABLES id must appear in exactly one section. */
  tables: readonly string[];
  /** Short non-roll reference charts from the manual (rules summaries). Two columns: label, text. */
  reference: readonly RefBlock[];
}

/** The oracle chart, straight from the engine's likelihoods so the targets cannot drift. */
const ORACLE_ROWS: readonly (readonly [string, string])[] = [
  ...DUALITY_LIKELIHOODS.map((item): readonly [string, string] => [item.label, `${item.target}+ (${item.chance})`]),
  ['Doubles', 'An extreme result or a twist: “yes, and more than you hoped” or “no, and worse.”'],
];

/** The ranks chart, straight from the engine's ranks so the marks and Difficulties cannot drift. */
const RANK_ROWS: readonly (readonly [string, string])[] = IRON_RANKS.map(
  (rank): readonly [string, string] => [rank.label, `Mark ${rank.mark}. Difficulty ${rank.difficulty}.`],
);

export const SOLO_SECTIONS: readonly SoloSection[] = [
  {
    id: 'core',
    label: 'Core rolls',
    icon: 'dice',
    intro: 'The rolls every scene runs on: the action roll and the Difficulty you set before it, the Fear Check that lets the world act, and the oracle you ask when the story cannot answer.',
    tables: ['how-much', 'iron-price'],
    reference: [
      {
        title: 'Action roll outcomes',
        note: 'Roll the Duality Dice, add both plus the trait and modifiers; equal to or over the Difficulty is a success.',
        rows: [
          ['Success with Hope', 'Strong hit: you do it cleanly. Gain a Hope.'],
          ['Success with Fear', 'Weak hit: you do it, but at a cost. The world gains a Fear.'],
          ['Failure with Hope', 'Miss: Pay the Price. Gain a Hope.'],
          ['Failure with Fear', 'Miss: Pay the Price; the world gains a Fear and may spend 1 to make it severe.'],
          ['Critical success', 'Doubles: strong hit, gain a Hope and clear a Stress.'],
        ],
      },
      {
        title: 'Set the Difficulty',
        note: 'Set it before rolling, from facts already in the scene, and lock it in.',
        rows: [
          ['1. Use an existing value', 'The rule or move’s Difficulty, an adversary’s defined Difficulty, or the challenge rank’s Difficulty; add no obstacle increases.'],
          ['2. Otherwise start at 13', 'Count Resistance, Demand and Conditions once each: 0 / 1 / 2 / 3 obstacles gives 13 / 15 / 18 / 20.'],
          ['3. Easy, certain or impossible', '10 if a concrete fact makes it simple; no roll if success is evident; if impossible now, change the situation first.'],
          ['Lock it in', 'Say the number and the reason before rolling; do not change it after seeing the dice. Danger is not Difficulty.'],
        ],
      },
      {
        title: 'Fear Check',
        rows: [
          ['Roll', 'A d12 equal to or under the current Fear passes: the world spends Fear and acts. At 0 Fear it always fails.'],
          ['When', 'The GM turn in a fight, a failure with Fear on Explore a Waypoint, each Journey leg, or to test a severe price.'],
        ],
      },
      {
        title: 'Ask the Oracle',
        note: 'Phrase a yes or no question, pick the likelihood, roll the Duality Dice and add them. Oracle rolls never give Hope or Fear.',
        rows: ORACLE_ROWS,
      },
      {
        title: 'Progress roll',
        note: 'Count full boxes only: the score runs 0 to 10. Roll two d10 and compare the score to each.',
        rows: [
          ['Strong hit', 'Your score beats both dice.'],
          ['Weak hit', 'Your score beats one die.'],
          ['Miss', 'Your score beats neither.'],
          ['Ties and matches', 'Ties go to the challenge dice. A match is a twist: a favor on a hit, a dire turn on a miss.'],
          ['No modifiers', 'Progress rolls never give Hope or Fear; no trait, Experience or Hope can change them.'],
        ],
      },
      {
        title: 'Ranks',
        note: 'A track has 10 boxes of 4 ticks. Mark progress by the rank, and count full boxes for the progress score.',
        rows: RANK_ROWS,
      },
      {
        title: 'Tension clock',
        rows: [
          ['Size', '4 segments at a disadvantage, 6 on even footing, 8 with an advantage.'],
          ['Fill a segment', 'When something makes the danger worse. When the clock is full, the danger arrives.'],
        ],
      },
      {
        title: 'Questions worth asking',
        rows: [
          ['Ask', 'Is anyone here? Is it guarded? Do they believe me? Is it what it seems? Does it get worse? Is there another way?'],
        ],
      },
      {
        title: 'Prices by situation',
        note: 'On a miss, make the obvious outcome happen, ask the oracle between two, or roll Pay the Price. A severe price rolls twice.',
        rows: [
          ['In a fight', 'Damage, a lost weapon, a new foe, an ally down.'],
          ['On the road', 'Lost time, lost supplies, a wrong turn, bad weather.'],
          ['Among people', 'A lost friend, a broken promise, a rumor about you.'],
          ['On an oath', 'Lose progress, the goal moves, a rival gets there first.'],
        ],
      },
    ],
  },
  {
    id: 'session',
    label: 'Start a session',
    icon: 'sun',
    intro: 'Sit down with the world already moving. Begin a Session, recap, and let the Vignette show what happens elsewhere while you set the first scene.',
    tables: ['iron-vignette', 'plot-hook', 'plot-stakes', 'rumor'],
    reference: [
      {
        title: 'A session at a glance',
        note: 'From the Quick Reference chapter.',
        rows: [
          ['Begin a Session', 'Flags, recap, scene, Vignette.'],
          ['Envision', 'Make moves. Read the outcome.'],
          ['When unsure', 'Miss: Pay the Price. Unsure: Ask the Oracle.'],
          ['Milestones', 'Mark progress. Ready: make a progress roll.'],
          ['End a Session', 'Note what comes next.'],
        ],
      },
      {
        title: 'When to roll these',
        rows: [
          ['Vignette', 'What happens elsewhere while you are away. Envision it, then gain a Hope as you return to your character.'],
          ['Plot hook', 'For an inciting incident or a new oath: what must be done, and who stands in the way.'],
          ['Reward and twist', 'What it is worth, and what nobody has told you yet. Write the twist down and save it.'],
          ['Rumor', 'When the story needs a push: something heard in a tavern, or a sign on the road.'],
        ],
      },
    ],
  },
  {
    id: 'meaning',
    label: 'Meaning',
    icon: 'book',
    intro: 'When a yes or no cannot answer the question, roll a word. Read the pair loosely and take the first reading that fits the scene.',
    tables: ['action', 'subject', 'descriptor'],
    reference: [
      {
        title: 'How to read meaning',
        note: 'Roll both Duality Dice for each word.',
        rows: [
          ['Hope die', 'Picks the row, 1 to 12.'],
          ['Fear die', 'Picks the column: odd = A, even = B.'],
          ['Action + Subject', 'What someone wants, or what happens.'],
          ['Descriptor + Subject', 'What something is, or what a place is like.'],
          ['Reading a pair', 'Take the first reading that fits; if it does not, look a row above or below, or roll again. Keep it small.'],
        ],
      },
    ],
  },
  {
    id: 'exploration',
    label: 'Exploration',
    icon: 'compass',
    intro: 'The road, the wilds, sites and rests. Roll only when the journey itself is the challenge; an ordinary road uses Journeys, a story-length journey an expedition.',
    tables: ['journey', 'wilds', 'iron-waypoint', 'iron-discovery', 'iron-chaos', 'iron-opportunity', 'site', 'hazard', 'rest'],
    reference: [
      {
        title: 'An expedition',
        note: 'A journey through dangerous ground with a rank and a progress track. A Minor trip takes about four good segments; a Grave one, ten.',
        rows: [
          ['1. Undertake', 'Name it, rank it, and roll for the first segment.'],
          ['2. Reach a waypoint', 'On a hit, mark progress and reach a waypoint; Explore a Waypoint if it is worth a look.'],
          ['3. Keep going', 'Roll segments and deal with what you find until you feel ready.'],
          ['4. Finish', 'Make a progress roll when you reach the destination.'],
        ],
      },
      {
        title: 'Travel and the land',
        rows: [
          ['Journey leg', 'Make a Fear Check. Pass: spend 1 Fear and roll Danger. Fail: roll Discovery.'],
          ['Wilds', 'For each new region or day of travel: the land, the weather, and a landmark to steer by.'],
          ['Waypoint', 'Roll when an expedition reaches a waypoint; a good one has a feature, a danger and a question.'],
          ['Site crawler', 'For each new area roll Area, Exits and Contents. The first Area 12 is the heart of the site.'],
          ['Hazard', 'Make the reaction roll named; set the Difficulty and damage by tier.'],
          ['Rest and Camp', 'After Make Camp. A Random Event result means roll a Vignette.'],
        ],
      },
      {
        title: 'Ranking an expedition',
        rows: [
          ['Minor', 'A day on a bad road, a short climb.'],
          ['Serious', 'Several days through wild country.'],
          ['Grave', 'Weeks across hostile land, or a deep ruin.'],
          ['Dire', 'An unmapped wilderness, a cursed realm.'],
          ['Legendary', 'The edge of the world.'],
        ],
      },
    ],
  },
  {
    id: 'combat',
    label: 'Combat',
    icon: 'combat',
    intro: 'Keep Daggerheart combat. Your attacks and the adversaries’ stat blocks work as the core rules say; the Fear Check runs the opposition when the spotlight passes to the GM.',
    tables: ['adversary-creature', 'adversary-type', 'tactics', 'fear-spend'],
    reference: [
      {
        title: 'Running a full fight',
        rows: [
          ['1. Choose your foes', 'Use the adversaries the story calls for, or roll Creature and Situation and Adversary Type, then pick a stat block of your tier.'],
          ['2. Join the Fray', 'Roll to see who acts first.'],
          ['3. Your spotlight', 'A success with Hope keeps the spotlight; a roll with Fear or a failure passes it to the GM.'],
          ['4. The GM turn', 'Pick an adversary. Fear Check: fail = free action (Tactics); pass = roll Fear Spend and pay the cost.'],
          ['Chain checks', 'After each GM action check again: a pass spends 1 Fear and brings in another adversary (Tactics). The first fail ends the turn.'],
          ['5. End the fight', 'When the foes fall, flee or yield, or when you do. If the fight mattered to an oath, Reach a Milestone.'],
        ],
      },
      {
        title: 'Playing the adversaries',
        rows: [
          ['Give them a goal', 'Few foes fight to the death. Decide what each wants: the loot, the door, your surrender.'],
          ['Use their features', 'When Fear Spend calls for a feature, pick the one that fits the moment best.'],
          ['Let them break', 'When a fight turns against them, Ask the Oracle whether they run: Likely for minions, Unlikely for solos.'],
          ['Hard Move', 'There is no Hard Move table in Duality GME: treat a Hard Move result as a severe Pay the Price.'],
        ],
      },
      {
        title: 'Picking a stat block',
        rows: [
          ['Tier by level', 'Tier 1 at level 1, tier 2 at levels 2 to 4, tier 3 at levels 5 to 7, tier 4 at levels 8 to 10.'],
          ['Roles', 'Minions and hordes come in numbers; standards are the backbone; bruisers hit hard; skulks hide.'],
          ['More roles', 'Leaders and supports make the others dangerous; social adversaries fight with words; a solo is a whole fight.'],
          ['Joining and fleeing', 'Join the Fray decides who acts first. Breaking away is Face Danger; a long pursuit is a scene challenge.'],
        ],
      },
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: 'users',
    intro: 'Who someone is, what they want, and how they meet you. Three rolls are enough to play an NPC; the rest you learn by playing.',
    tables: ['npc-identity', 'npc-manner', 'names'],
    reference: [
      {
        title: 'An NPC in thirty seconds',
        rows: [
          ['Roll', 'A Name, a Role and Motive, and an Attitude. Give them one physical detail.'],
          ['Decide', 'What they want from your character right now. That is enough; learn the rest by playing.'],
          ['Names', 'Hope die: the given name. Fear die: the column. Then roll a family name.'],
          ['Manner', 'Attitude is how they meet you; the quirk makes them memorable; the topic is what they talk about.'],
        ],
      },
    ],
  },
  {
    id: 'places',
    label: 'Places & loot',
    icon: 'map',
    intro: 'Settlements, place names, factions and loot. Name what you find, then let the table tell you why it matters.',
    tables: ['settlement', 'place-name', 'faction', 'treasure'],
    reference: [
      {
        title: 'Settlements and names',
        rows: [
          ['Name a settlement', 'Roll First + Second (Ash + ford: Ashford), then its size, what it is known for, and its trouble.'],
          ['Place names', 'For rivers, hills, forests and ruins.'],
          ['Naming the land', 'Name a place when your character would: someone tells them, or they reach it.'],
          ['Faction', 'Who they are, what they want, and how they get it.'],
        ],
      },
      {
        title: 'When to roll loot',
        rows: [
          ['When', 'After a hard fight, at the heart of a site, or as the reward of a fulfilled oath. Not for every corpse.'],
          ['What it is', 'Weapons, armor and gold work as Daggerheart says; the table says what it is and why it matters.'],
          ['Detail', 'Roll a detail that makes the loot a story.'],
        ],
      },
    ],
  },
];
