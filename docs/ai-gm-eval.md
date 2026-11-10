# AI GM manual evaluation

Automated tests cover the engine, the stored data and the assembled prompts. They do not
judge how narration reads. Use this checklist with a real key and a live model.

## Setup

Use a fresh campaign with two or three heroes, at least one personal bond or hook recorded
in the campaign state or canon. Note the model, the memory size and the prompt version shown
in the GM request (`gm-prompt-3` at the time of writing).

## Scenes

Run these in order, with short player messages.

1. Discovery: open the campaign and investigate one location. Note whether both heroes get
   the spotlight and whether the clue is actionable.
2. Negotiation: talk to an NPC with a conflicting interest. Note whether the NPC has a
   motive and whether the GM asks who speaks.
3. Small conflict: start a fight the party can retreat from. Note whether the GM states the
   stakes, requests named-hero rolls, and resolves damage through the cards.
4. Resumed session: compact or end and begin a new session, then return to the same
   situation. Note what the recap keeps and what it invents.

## Criteria

Rate each scene 1 (poor) to 5 (strong), with one concrete example.

- Agency: the players decide; no hero acts, speaks or feels for them.
- Consistency: names, NPC attitudes, time and place match the state, snapshot and journal.
- Useful clues: discoveries point somewhere and survive into later scenes.
- Rules timing: stakes come before the roll, rolls name the hero, and rules calls fit.
- Secret handling: GM-only material stays hidden; hints appear in play, not in reveals.
- Repeated phrasing: openings and descriptions vary; no stock line recurs every turn.
- Recall of small personal details: bonds, names and hooks return without being restated.

## Recording results

Keep one row per scene: date, model, memory size, prompt version, scene, the seven ratings
and a short quote for each low score. Save the rows with the session notes or in a scratch
file. Treat any score of 1 or 2 as a candidate prompt or tool bug; take it to the assistant
with the scene transcript and the exact request that produced it.
