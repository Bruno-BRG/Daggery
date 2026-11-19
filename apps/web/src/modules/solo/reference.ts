import type { IconName } from '../../components/Icon';
import { DUALITY_LIKELIHOODS, FOE_RANKS, IRON_RANKS } from '@daggery/shared';

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

/** Foe ranks, straight from the engine so harm and progress cannot drift. */
const FOE_RANK_ROWS: readonly (readonly [string, string])[] = FOE_RANKS.map(
  (rank): readonly [string, string] => [`${rank.label} (${rank.ironsworn})`, `${rank.foe}. Harm ${rank.harm}; ${rank.progress}. Look for: ${rank.fits}.`],
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
          ['On a vow', 'Lose progress, the goal moves, a rival gets there first.'],
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
          ['Plot hook', 'For an inciting incident or a new vow: what must be done, and who stands in the way.'],
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
    intro: 'Fights run on initiative and Momentum, as in Ironsworn. Daggerheart stat blocks give you each foe’s features; the foe’s rank gives its harm and its progress track. When a foe has initiative, the Fear Check runs it.',
    tables: ['adversary-creature', 'adversary-type', 'tactics', 'fear-spend'],
    reference: [
      {
        title: 'Running a fight',
        rows: [
          ['1. Choose your foes', 'Use the adversaries the story calls for, or roll Foe rank, Creature and Situation, and Adversary Type. Give each foe (or each pack) a rank and a progress track on the Challenges page.'],
          ['2. Enter the Fray', 'Roll Presence (face off), Finesse (strike first) or Instinct (ambushed). A strong hit: take +2 momentum and you have initiative.'],
          ['3. With initiative', 'You act: Strike, Secure an Advantage, Face Danger, Aid Your Ally, Compel or End the Fight.'],
          ['4. Without initiative', 'The foe acts: roll Combat Action, or the GM turn. You react: Clash, Face Danger, Compel or Turn the Tide.'],
          ['5. Keep or lose the lead', 'A strong hit takes or keeps initiative. A weak hit or a miss passes it to your foe.'],
          ['6. End the Fight', 'When you score a strong hit on a decisive move, roll a progress roll on the foe’s track. Reach a Milestone if the fight mattered to a vow.'],
        ],
      },
      {
        title: 'Foe ranks',
        note: 'A foe’s rank sets the harm it deals you (marks Hit Points, or Stress) and how much each of your harm marks on its track.',
        rows: FOE_RANK_ROWS,
      },
      {
        title: 'From stat block to rank',
        note: 'rank = tier − 1 + role bonus, from Minor (0) to Legendary (4).',
        rows: [
          ['Role bonus', 'Minion −1. Standard, Skulk, Ranged, Support, Social 0. Horde, Bruiser, Leader +1. Solo +2.'],
          ['Examples', 'Tier 1 Standard: Minor. Tier 2 Bruiser: Grave. Tier 3 Solo: Legendary.'],
          ['Packs', 'Fight a group of Minor or Serious foes as one pack with one track: a small pack (3 to 5) is one rank higher, a large pack (6 to 10) two.'],
          ['Your harm', '2 harm with a deadly weapon. 1 harm when unarmed or with a simple weapon. Strike on a strong hit, or Clash and find an opening, add 1.'],
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
          ['Joining and fleeing', 'Enter the Fray decides who has initiative. Breaking away is Face Danger; a long pursuit is a scene challenge.'],
        ],
      },
    ],
  },
  {
    id: 'momentum',
    label: 'Momentum and trackers',
    icon: 'spark',
    intro: 'Momentum is the hero’s side of the table, as Fear is the world’s. It says how well your quest is going, and you can burn it to turn a roll your way. Keep it on the Momentum tracker in the top bar.',
    tables: [],
    reference: [
      {
        title: 'Momentum',
        note: 'From −6 to +10. It starts at +2. Each moves says when to take or suffer it.',
        rows: [
          ['Take +N', 'Add N, up to your maximum (+10, minus 1 for each Debility).'],
          ['Suffer −N', 'Subtract N, down to −6. If Momentum is already −6, Face a Setback.'],
          ['Burn Momentum', 'After an action roll, if Momentum is higher than your Fear die, you may burn it: ignore the Fear die, improve the outcome one step (a miss becomes a weak hit, a weak hit a strong hit), and the world does not gain Fear from the roll. Then Momentum resets.'],
          ['Reset', '+2. With one Debility, +1. With two or more, 0.'],
          ['Negative Momentum', 'If Momentum is below 0 and its number matches your Hope die, cancel that die: subtract it from the total, and the roll cannot be with Hope.'],
          ['Progress rolls', 'Momentum is ignored: you cannot burn it, and a negative value does not hurt you.'],
        ],
      },
      {
        title: 'Initiative',
        note: 'Initiative is the spotlight in a fight: who is acting, and who is reacting.',
        rows: [
          ['Take or keep it', 'A strong hit on a combat move.'],
          ['Lose it', 'A weak hit or a miss on a combat move: your foe has it.'],
          ['Turn the Tide', 'Once per fight you may steal initiative to make a move (not a progress move): add +2, and take +1 momentum on a hit. On a failure, Pay the Price (severe).'],
        ],
      },
      {
        title: 'Supply, Debilities and Experience',
        rows: [
          ['Supply', '0 to 5. At 0, mark Unprepared. Each extra loss while Unprepared is paid with Hit Points, Stress or Momentum (Out of Supply).'],
          ['Conditions', 'Wounded, Shaken, Unprepared, Encumbered. Each clears with the moves that name it.'],
          ['Banes and burdens', 'Maimed, Corrupted (banes), Cursed, Tormented (burdens). Burdens clear only by finishing the quest that caused them.'],
          ['Debility cost', 'Each marked Debility lowers your maximum Momentum by 1 and your reset (+2, then +1, then 0).'],
          ['Experience', 'Fulfill Your Vow marks it by rank. Advance spends 3 for a new asset or 2 to upgrade one.'],
          ['Hit Points and Stress', 'Ironsworn’s health and spirit are the Hit Points and Stress on your sheet.'],
        ],
      },
      {
        title: 'Ironsworn stats and Duality traits',
        rows: [
          ['Edge', 'Agility: speed, agility, precision.'],
          ['Heart', 'Presence: charm, loyalty, courage.'],
          ['Iron', 'Strength: aggressive action, forceful defense, endurance.'],
          ['Shadow', 'Finesse: deception, stealth, trickery.'],
          ['Wits', 'Instinct or Knowledge: observation, insight, expertise.'],
          ['+1 on a roll', 'Is +2 here. The Duality Dice are bigger.'],
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
          ['When', 'After a hard fight, at the heart of a site, or as the reward of a fulfilled vow. Not for every corpse.'],
          ['What it is', 'Weapons, armor and gold work as Daggerheart says; the table says what it is and why it matters.'],
          ['Detail', 'Roll a detail that makes the loot a story.'],
        ],
      },
    ],
  },
];
