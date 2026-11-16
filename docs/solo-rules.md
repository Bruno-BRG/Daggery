# Duality Solo Engine

Rules version 2.0. A d12 game master emulator for solo and GM-less Daggerheart.
Daggerheart resolves the characters; the Fear pool plays the GM.

The printable three-page version, with every table, is
`docs/duality-solo-engine/duality-solo-engine.pdf`. The tables themselves live
in `packages/shared/src/duality-engine.ts`; `npx tsx tools/build_duality_pdf.ts`
rebuilds the HTML and the PDF from them. The solo screen's **Play** tab follows
the loop below, step by step, with each step's tables beside it.

## How to play

Version 2.0 follows the play loop of the One Page Solo Engine:

1. **Create your character** with the Daggerheart rules.
2. Roll a starting **Plot Hook** and a **Random Event**, then **Set the Scene**.
3. Ask the **Oracle** whenever you would ask a GM something. Interpret answers
   in context.
4. **Play the game** to overcome the scene. When trouble turns to a fight, roll
   an **Encounter**.
5. Use **GM Moves** to move the action when you roll with Fear, fail, or stall.
6. **Set the Scene** for the next thing your character wants to do.

Always take the first interpretation that makes sense. If nothing fits, the
obvious thing happens. Threads (open goals) and NPCs are optional lists of at
most 12 open lines each, so a d12 can pick from them; keep them in the app or in
your own notebook.

## Fear and the Fear Check

Track Fear exactly as the rules say: it grows when you roll with Fear and when
you rest, to a maximum of 12. The engine never invents Fear. It only decides
when to spend what you generate.

**Fear Check:** roll a d12. If it is equal to or under current Fear, the check
passes: the GM spends Fear and acts. Otherwise it fails. At 0 Fear it always
fails.

## The Oracle

Ask a yes or no question, pick a likelihood, roll the Hope and Fear dice and add
them. Oracle rolls never generate Hope or Fear. On the solo screen the question
is optional, for players who write it in their notebook (the AI GM must still
state its question). If you roll your own dice, switch the
form to **My physical dice** and type the two d12 faces; the app resolves them as
player-reported dice and remembers the choice for this campaign.

| Likelihood | Yes on | Chance |
| --- | --- | --- |
| Near certain | 7+ | 90% |
| Likely | 10+ | 75% |
| 50 / 50 | 13+ | 54% |
| Unlikely | 16+ | 31% |
| Long shot | 19+ | 15% |

- **Twist:** if the dice are 4 or more apart, add a twist. Hope higher bends it
  your way (Yes, and… / No, but…). Fear higher bends it against you (Yes, but… /
  No, and…).
- **Doubles:** answer as normal, then a Random Event occurs.

## Set the scene

Describe where your character is and what they are trying to accomplish, then
roll a **Scene Complication**. Then make a Fear Check.

- **Fails:** the scene plays with its complication.
- **Passes on an odd roll:** spend 1 Fear. The scene is Altered: roll the
  Altered Scene table as well.
- **Passes on an even roll:** spend 1 Fear. The scene is Interrupted: a Random
  Event replaces it.

## GM Moves

- **Success with Fear** or **failure with Hope:** Soft Move.
- **Failure with Fear:** Fear Check. Pass: spend 1 Fear, Hard Move. Fail: Soft
  Move.
- **Story stalls**, or you hand the world a golden opportunity: Fear Check.
  Pass: spend 1 Fear, Hard Move. Fail: nothing happens.

A Hard Move roll of 12 spends 1 more Fear, if there is any, and two Hard Moves
happen.

## Random Events

Triggered by Oracle doubles or an Interrupted scene. Roll the Event Focus, then
Action + Subject for what happens. A focus of 4 to 6 picks an NPC from your
list; 7 to 9 picks a Thread.

## Meaning tables

Action, Subject and Descriptor each have two columns of twelve words. Roll both
Duality Dice for each word: the Hope die picks the row, the Fear die picks the
column (odd A, even B). Combine Action + Subject for events and Descriptor +
Subject for things and places.

## Encounters

When trouble turns to a fight, roll **Creature** and **Situation** (what it is
doing when you meet it), then the **Adversary Type**: Minion, Horde, Standard,
Skulk, Ranged, Bruiser, Support, Social, Leader or Solo. Pick a stat block of
that type and your tier, reskinning one to fit the creature, and build the fight
with Battle Points. The app suggests up to three catalog adversaries of that
type and tier, preferring ones that match the creature. Ask the Oracle whether
they notice you first.

## Adversaries in combat

When the spotlight passes to the GM, pick the adversary that makes the most
sense and make a Fear Check.

- **Fails:** it acts for free. Roll Tactics.
- **Passes:** roll Fear Spend, pay the cost, resolve it. A Fear feature costs
  what the adversary's stat block says; the other results cost 1 Fear.
- **Chain:** after each GM action, make another Fear Check. On a pass, spend 1
  Fear and spotlight another adversary (Tactics). The GM turn ends on the first
  failed check.

## Generators

- **NPC:** Role, Motive, Attitude, Quirk, Topic.
- **Plot hook:** Objective, Opposition, Reward, Twist.
- **Site crawler:** Area, Exits, Contents for each new area.
- **Journeys:** a Fear Check for each leg. Pass: spend 1 Fear and roll Danger.
  Fail: roll Discovery.
- **Generic:** Descriptor + Subject for what it is, Action for what it does, How
  Much for its size or strength.

## World tables

Rolled whole (one d12 per column) on the Generators tab, and printed in the PDF:

- **Names:** Given name (Hope die picks the row, Fear die the column: odd A,
  even B), Family name, Epithet. The NPC generator rolls a name too.
- **Settlements:** a name from a First and a Second part (Ash + ford: Ashford),
  then Size, Known for and Trouble.
- **Wilds:** Terrain, Weather and a Landmark for each region or day of travel.
- **Hazards and traps:** the hazard with its reaction roll, and what happens on
  a failure. Difficulty and damage follow the tier, as for an environment.
- **Rest and camp:** what happens while you rest. Rests still add Fear.
- **Rumors and leads:** where the next scene could come from.
- **Factions:** who they are, what they want, and how they get it.
- **Loot and treasure:** Loot and a Detail that makes it a story.

## Countdowns

Give every looming threat a countdown. Soft and Hard Moves tick it; at zero it
happens, with no Fear needed.

## Daggery integration notes

- Rolls are made on the server (`apps/server/src/solo-duality.ts`) and saved
  with their dice. Roll kinds start with `duality-`.
- The engine reads and spends the campaign Fear pool (`combat/fear`). A roll
  that spends Fear saves the pool and the journal entry together.
- Fear features have their own printed cost, so the engine asks the player to
  pay that on the Fear tracker.
- The earlier Hope & Fear homebrew oracle (`oracle`, `scene`, `prompt` roll
  kinds) is still accepted by the server for old campaigns, but the solo screen
  no longer uses it.

Unofficial fan-made rules for use with Daggerheart. Play loop after One Page
Solo Engine (Karl Hendricks, CC-BY-SA 4.0); also inspired by the Mythic Game
Master Emulator (Tana Pigeon).
