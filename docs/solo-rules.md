# Duality Solo Engine

Rules version 1.0. A d12 game master emulator for solo and GM-less Daggerheart.
Daggerheart resolves the characters; the Fear pool plays the GM.

The printable two-page version, with every table, is
`docs/duality-solo-engine/duality-solo-engine.pdf`. The tables themselves live
in `packages/shared/src/duality-engine.ts` and are shown on the Tables tab.

## How to play

1. **Frame the scene** you expect, then test it (Scene setup).
2. **Play your character** with the normal rules. Whenever you would ask a GM
   something, ask the Oracle.
3. When you fail or roll with Fear, the engine makes a **GM Move**.
4. When an answer needs inspiration, roll on the **Meaning** tables and
   interpret the words in context.
5. **End the scene:** update your Threads (open goals) and NPCs. Each list holds
   at most 12 open lines, so a d12 can pick from it.

Always take the first interpretation that makes sense. If nothing fits, the
obvious thing happens.

## Fear and the Fear Check

Track Fear exactly as the rules say: it grows when you roll with Fear and when
you rest, to a maximum of 12. The engine never invents Fear. It only decides
when to spend what you generate.

**Fear Check:** roll a d12. If it is equal to or under current Fear, the check
passes: the GM spends Fear and acts. Otherwise it fails. At 0 Fear it always
fails.

## The Oracle

Ask a yes or no question, pick a likelihood, roll the Hope and Fear dice and add
them. Oracle rolls never generate Hope or Fear.

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

## Scene setup

Describe the scene you expect, then make a Fear Check.

- **Fails:** the scene starts as expected.
- **Passes on an odd roll:** spend 1 Fear. The scene is Altered: roll the
  Altered Scene table.
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

Unofficial fan-made rules for use with Daggerheart. Inspired by One Page Solo
Engine (Karl Hendricks) and the Mythic Game Master Emulator (Tana Pigeon).
