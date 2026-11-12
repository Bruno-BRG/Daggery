# Daggery Solo: Mythic Game Master Emulator

Version 0.3 — solo play for Daggerheart driven by the tables and procedures of the
*Mythic Game Master Emulator, Second Edition*, the *One-Page Mythic Game Master
Emulator*, and the Adventure Crafter and Turning Point rules from *Mythic
Magazine Volume 29*. Daggerheart resolves everything about the characters —
actions, damage, Fear, rests, advancement. Mythic answers what the world does and
what happens next. This is an unofficial implementation; it is not endorsed by
Word Mill Games, and Daggery supplies its own table contents.

The workspace implements the Mythic procedures one to one: Fate Questions on
either the Fate Chart or the Fate Check, the Chaos Factor and its flavors,
Random Events and Event Focus, Lists, Meaning Tables, Scene Tests and
adjustments, end-of-scene bookkeeping, the Thread Progress Track with Discovery
Checks, Keyed Scenes, Peril Points, prepared adventures, the four Ws, and
Adventure Crafter Turning Points.

## Start playing

1. Create your character with Daggerheart, as usual. Pick a personal objective,
   someone who matters, and something already going wrong.
2. Write one unresolved **thread** — a question, conflict, or obligation — and
   give its opposition a motive and a next step. Add the important people as
   **characters**. These are your first two Lists.
3. Set the **Chaos Factor** to 5.
4. Frame your first scene, or discover it (see *Beginning an adventure*).
5. Ask **Fate Questions** when a world fact is uncertain. Roll normal action
   rolls when your character does something risky. Mythic does not replace the
   character's action.
6. End the scene when its question is answered, then do the end-of-scene
   bookkeeping below.

The workspace's **Scene** tab holds the scene tools, Lists, Thread Progress
Track, Keyed Scenes and Peril Points. The **Oracle** tab holds Fate Questions,
Random Events and Meaning Tables. The **Tables** tab browses and rolls every
installed table, the **Dice** tab rolls any notation, and the **Notes** tab is
your journal.

## The Chaos Factor

The Chaos Factor runs from **1 to 9** and starts at 5. It decides how chaotic
your adventure is: how likely scenes are to change, how often doubles trigger a
Random Event, and which column of the Fate Chart answers questions. High chaos
makes Yes more likely, low chaos makes No more likely; it also makes events more
frequent. At the end of each scene, if you were mostly **in control** lower it by
1; if you were mostly **not in control** raise it by 1 (always within 1–9).

### Chaos flavors

Mythic offers variants of the Chaos Factor. Choose one in the Scene tab's chaos
settings; Standard is the default.

| Flavor | What changes |
| --- | --- |
| Standard chaos | The full swing: each step of chaos moves one Fate Chart column or ±1 to ±5 on the Fate Check. |
| Mid-chaos | Chaos 1 reads as two steps lower, 2–3 one step lower, 4–6 unchanged, 7–8 one step higher, 9 two steps higher. |
| Low-chaos | Only chaos 1–2 (one step lower) and 8–9 (one step higher) differ from the middle. |
| No-chaos | The Chaos Factor does not bend answers or events at all. |
| One-Page Mythic | No Chaos Factor, and **any** double on a d100 or Fate Check roll is a Random Event. See *One-Page Mythic*. |

Answer-target shifts never go past the ends of the chart: they clamp to the
first or last cell.

## Fate Questions

A Fate Question is a yes/no question about something you, the player, cannot
decide. Phrase it so that Yes and No both mean something, choose its odds, and
roll. The app asks how the question is being used, because each purpose reads
the four answers differently:

- **Fate Question** — an ordinary world fact: “Is the tower occupied?”
- **NPC behavior** — “Does the captain recognize this seal?” An answer tells you
  what the NPC does, not whether your character succeeds.
- **NPC statistic** — “Is the captain's Willpower 11?” Expected values are
  adjusted by about 25% up or down.
- **Replace an RPG rule** — the oracle stands in for a rule you do not want to
  adjudicate. This purpose ignores the current Chaos Factor and uses chaos 5.

Choose odds from established facts before rolling, and default to 50/50:

| Odds | Fate Check modifier |
| --- | ---: |
| Impossible | −5 |
| Nearly Impossible | −4 |
| Very Unlikely | −2 |
| Unlikely | −1 |
| 50/50 | 0 |
| Likely | +1 |
| Very Likely | +2 |
| Nearly Certain | +4 |
| Certain | +5 |

### The Fate Chart (d100)

Roll d100 and read the cell for your odds and Chaos Factor. Each cell shows
three numbers: **Exceptional Yes at or under / Yes at or under / Exceptional No
at or over**. Everything between the second and third number is No; 0 and 101
mean that result cannot happen.

| Odds | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Impossible | 0/1/81 | 0/1/81 | 0/1/81 | 1/5/82 | 2/10/83 | 3/15/84 | 5/25/86 | 7/35/88 | 10/50/91 |
| Nearly Impossible | 0/1/81 | 0/1/81 | 1/5/82 | 2/10/83 | 3/15/84 | 5/25/86 | 7/35/88 | 10/50/91 | 13/65/94 |
| Very Unlikely | 0/1/81 | 1/5/82 | 2/10/83 | 3/15/84 | 5/25/86 | 7/35/88 | 10/50/91 | 13/65/94 | 15/75/96 |
| Unlikely | 1/5/82 | 2/10/83 | 3/15/84 | 5/25/86 | 7/35/88 | 10/50/91 | 13/65/94 | 15/75/96 | 17/85/98 |
| 50/50 | 2/10/83 | 3/15/84 | 5/25/86 | 7/35/88 | 10/50/91 | 13/65/94 | 15/75/96 | 17/85/98 | 18/90/99 |
| Likely | 3/15/84 | 5/25/86 | 7/35/88 | 10/50/91 | 13/65/94 | 15/75/96 | 17/85/98 | 18/90/99 | 19/95/100 |
| Very Likely | 5/25/86 | 7/35/88 | 10/50/91 | 13/65/94 | 15/75/96 | 17/85/98 | 18/90/99 | 19/95/100 | 20/99/101 |
| Nearly Certain | 7/35/88 | 10/50/91 | 13/65/94 | 15/75/96 | 17/85/98 | 18/90/99 | 19/95/100 | 20/99/101 | 20/99/101 |
| Certain | 10/50/91 | 13/65/94 | 15/75/96 | 17/85/98 | 18/90/99 | 19/95/100 | 20/99/101 | 20/99/101 | 20/99/101 |

The chart is one diagonal ladder: a step of odds and a step of chaos move the
same way. Reading across a row is the same as raising the odds; reading down a
column is the same as raising the chaos.

**Random Events on the chart.** If the d100 is a double from 11 to 99 whose digit
is at or under the Chaos Factor, the answer also brings a Random Event. At chaos
5 that is 11, 22, 33, 44 and 55. It is possible for the event to be the more
important result than the answer.

### The Fate Check (2d10)

The Fate Check is the alternative to the chart. Roll 2d10 and add the odds
modifier and the Chaos Factor modifier. The app rolls and applies both.

| Chaos | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Modifier | −5 | −4 | −2 | −1 | 0 | +1 | +2 | +4 | +5 |

| Total | Answer |
| ---: | --- |
| 18 or more | Exceptional Yes |
| 11 to 17 | Yes |
| 5 to 10 | No |
| 4 or less | Exceptional No |

If the dice match (and are not double 10) and the face is at or under the Chaos
Factor, the answer also brings a Random Event. In One-Page mode any matching
dice except double 10 do.

### Reading the answers

- **Yes** — your expectation holds.
- **Exceptional Yes** — yes, and more than you expected. For an NPC statistic,
  about 25% higher.
- **No** — go with the next most expected outcome.
- **Exceptional No** — no, and the opposite of what you expected or an
  intensified no. For an NPC statistic, about 50% lower.

NPC behavior and rule replacement have their own readings, shown with every
result: an NPC does the expected thing, or the next most expected thing, or the
opposite with greater intensity; a replaced rule resolves the way you posed it,
or the other way, using degrees only if the replaced rule has them. When the
answer is a Random Event, the app adds the event to the result.

## Random Events

A Random Event is something that happens outside your expectations. Roll the
Event Focus on d100, then let it pick an element from a List and give it meaning.
You can also choose the Focus when the situation clearly calls for one; the app
lists which situations each Focus suits.

| d100 | Event Focus | What it does |
| ---: | --- | --- |
| 1–5 | Remote Event | Something happens elsewhere and your character learns of it. |
| 6–10 | Ambiguous Event | Something neither good nor bad; a detail worth a closer look. |
| 11–20 | New NPC | A new character enters; add them to the Characters List. |
| 21–40 | NPC Action | Roll on the Characters List: this character does something. |
| 41–45 | NPC Negative | Something bad happens to this character. |
| 46–50 | NPC Positive | Something good happens to this character. |
| 51–55 | Move Toward A Thread | Roll on the Threads List: this thread moves closer to resolution. |
| 56–65 | Move Away From A Thread | Something makes this thread harder to resolve. |
| 66–70 | Close A Thread | Something ends this thread, or makes it stop mattering. |
| 71–80 | PC Negative | Something bad happens to your character. |
| 81–85 | PC Positive | Something good happens to your character. |
| 86–100 | Current Context | The event grows out of what is happening right now. |

A Focus that needs a List with nothing on it is replaced by Current Context.
Then the app rolls the List element and a Meaning word pair. Interpret the
event against the current scene: the Focus says what kind of thing happens, the
List says who or which thread it involves, the Meaning says how.

**Prepared adventures.** While the prepared-adventure option is on, a different
Focus table is used: Adventure Feature 1–20, NPC Action 21–40, NPC Negative
41–50, NPC Positive 51–55, PC Negative 56–70, PC Positive 71–80, Current
Context 81–100. Adventure Feature rolls on the Adventure Features List.

**Flashpoints and Conclusions.** A Flashpoint event is a dramatic, important
event about the Focus Thread that does not resolve it. A Conclusion event can
resolve and end the Focus Thread. Generate both from the Thread Progress Track
panel; they force Current Context so the event stays about your thread.

**Plot Armor.** While a Thread Progress Track runs, the thread cannot be
resolved before the Track's Conclusion. If a Close A Thread focus lands on the
track's own thread, the event may look like it closes the thread, but it does
not.

## Lists

Mythic keeps three Lists: **Threads** (unresolved plots), **Characters** (people
in the adventure), and — in a prepared adventure — **Adventure Features**. Each
holds up to 25 lines, five per section.

To pick an element, the app rolls a section die and a d10 for the line: a d4 for
Lines 1–5, d6 for 1–10, d8 for 1–15, d10 for 1–20 or all 25. A list with up to
five open lines needs only the d10. Landing on an empty line means the list
invites a new element: choose any element on the List, or roll again. The app
tells you which line you hit and what it held.

Maintain Lists at the end of each scene: add what mattered, repeat what mattered
again, remove what no longer does. A repeated element may appear on up to
**three lines** — the duplicate button adds a copy; more than three is not
allowed. The app enforces this and the 25-line limit. Crossing an element off
(removing it from play) is not the same as deleting it.

## Meaning Tables

When you need a word rather than an answer, roll a Meaning Table.

- **Actions** and **Descriptions** each roll two tables and combine the results
  into one phrase: Actions 1 + Actions 2, Descriptions 1 + Descriptions 2.
- **Elements** tables (Characters, Locations, Objects, and the other 42 subjects)
  roll the same table twice as a pair.
- **One-Page Mythic** rolls one word at a time instead: the Discover Meaning
  table's Action column or Description column.

Read the words as a whole phrase and bend it to fit the context; if it makes no
sense, roll again or take one word. Do not treat a Meaning roll as a command to
undo established facts.

The app ships word data for the core Actions and Descriptions tables, the
Characters, Locations and Objects Elements tables, and the One-Page Discover
Meaning table. The other **42 of the 47 Meaning Table choices have no data
installed yet** and are shown greyed out. Until they are added, Actions and
Descriptions fall back to the One-Page table's two columns when their own
tables are missing, and the One-Page single-word mode is always available.

## Scenes

At the start of a scene, write what you expect to happen. Then test it:

1. Roll d10. **Greater than the Chaos Factor** — the scene begins as expected.
2. **At or under the Chaos Factor and odd** — an **Altered** scene.
3. **At or under the Chaos Factor and even** — an **Interrupt** scene.

You can also start a scene as an Interrupt deliberately, without testing.

- **Altered scene** — the scene is not what you expected. By default it is the
  next thing you would most expect; otherwise change one element, ask a Fate
  Question, roll a Meaning pair, or roll the Scene Adjustment Table.
- **Interrupt scene** — something else happens instead. A Random Event opens the
  scene.

For entering a new area too, “is the scene as expected?” is the same test.

### Scene Adjustment Table (d10)

| d10 | Adjustment |
| ---: | --- |
| 1 | Remove a character |
| 2 | Add a character |
| 3 | Reduce or remove an activity |
| 4 | Increase an activity |
| 5 | Remove an object |
| 6 | Add an object |
| 7–10 | Two adjustments: roll again, keep reading results of 1–6 until you have two |

### Prepared adventures

While the prepared-adventure option is on, the scene always begins as expected
regardless of the test, but any Altered or Interrupt result instead means the
scene starts with a **Random Event** from the Prepared Event Focus table. The
Adventure Features List records the fixed pieces of the published adventure, and
Event Focus rolls can put them into play.

### Keyed Scenes

A Keyed Scene is a scene you know is coming the moment a trigger happens: “when
the alarm sounds, the guards seal the exits.” Write the trigger and the event
and mark it triggered in the Keyed Scenes panel. The next scene test reports any
triggered Keyed Scene as due; the app does not force the scene, you decide. Up
to 12 Keyed Scenes are kept.

### End of a scene

When the scene's immediate question is answered, record what changed and press
**End the scene**, choosing whether you were mostly in control, mostly not in
control, or neither:

- In control: Chaos Factor −1. Not in control: +1. Neither: unchanged.
- The scene counter advances, the scene's title and expectation clear, and any
  Discovery Check dead end lifts (it lasts until the next scene).
- Update the Lists. Add a Thread or Character when the fiction introduced one.

## Thread Progress Track

The Thread Progress Track is Mythic's way of letting one thread unfold into a
full story: discovery, setbacks, flashpoints, and a conclusion. Start one from
an open thread with a length of **10, 15 or 20 points**. Only one runs at a
time.

Progress is marked in points. Between scenes you can simply mark +2 for
progress. In play, a **Discovery Check** finds out whether the scene turned up
something useful about the thread:

- Fate Question: “Is something discovered?”
- Odds can never be worse than 50/50; better odds are allowed.
- **Yes** — one roll on the Thread Discovery Check. **Exceptional Yes** — two
  rolls, combined. **No** — nothing useful. **Exceptional No** — nothing useful,
  and no more Discovery Checks this scene (the panel shows the dead end).

### Thread Discovery Check

Roll d10 and add the Progress Points already marked:

| d10 + progress | Result |
| --- | --- |
| 9 or less | Progress +2 — something moves you closer to the thread |
| 10 | Flashpoint +2 — something dramatic and important about the thread |
| 11–14 | Track +1 — nothing useful, but the attempt itself moves you along |
| 15–17 | Progress +3 |
| 18 | Flashpoint +3 |
| 19 | Track +2 |
| 20–24 | Strengthen Progress +1 — tie it to an earlier discovery |
| 25 or more | Strengthen Progress +2 |

### Phases, Flashpoints, Conclusion

The track is divided into phases of five points. Each phase but the last has a
**Flashpoint** box. Ending a phase without a Flashpoint having happened triggers
one: the Track adds 2 points and the app flags the Flashpoint as due — generate
it with the Flashpoint event (Current Context, about the Focus Thread) now or at
the start of the next scene. Marking a Flashpoint in the current phase checks
its box so the phase does not trigger a second one.

When the Track reaches its length it is **complete**: generate the **Conclusion**
event — one that can resolve and end the thread. The thread can only resolve
through that Conclusion, not through a stray Event Focus roll. Clear the Track
afterwards if the thread is done.

## Turning Points

The Adventure Crafter's Turning Point gives a five-beat twist to an adventure.
Press **Turning Point** on the Scene tab:

1. The **first Plot Point** uses your adventure theme — the theme set in the
   Scene tab, or, if none is set, a rolled theme.
2. Four more Plot Points are generated; each rolls a theme and then a d100 on
   that theme's column of the Plot Points table.
3. Read all five together as one turning point: a sequence of connected changes
   in tone, stakes or direction. A “Conclusion” result wraps up a storyline; if
   that makes no sense yet, treat it as “None.” “None” adds nothing.

Themes are Action, Tension, Mystery, Social and Personal. Turning Points are
inspiration, not mechanics: they introduce no new rules and change no
character resources.

## Beginning an adventure

You can begin in one of two ways:

- **The only choice** — you know exactly where the adventure starts. Frame the
  scene and play.
- **Discover the first scene** — ask the four Ws, each a Meaning pair:
  **Who** (Characters table) is involved, **What** (Actions) is happening,
  **Where** (Locations) it happens, and **Why** (Actions) it matters. Combine
  them into the opening scene.

Then ask a Fate Question if you still need a fact, and play.

## Peril Points

Peril Points protect the adventure from an outcome that would end it. You start
with 2 (configurable 0–5, refillable each session). When a result would kill the
protagonist, end the adventure, or otherwise stop play, you may spend a Peril
Point instead: something averts that outcome — capture, rescue, a lucky escape —
and play continues. Spending is player-facing bookkeeping; the app logs it. This
is Mythic's optional protection, not a Daggerheart death rule: character death
moves still work normally when you are not using it.

## One-Page Mythic

The One-Page emulator is the lightest way to play. Choose the **One-Page
Mythic** chaos flavor:

- There is no Chaos Factor. Fate Questions use the 50/50 cell of the chart and
  no chaos modifier on the Fate Check.
- **Any** double on the d100 or on the 2d10 Fate Check is a Random Event (double
  10 aside).
- Events and Meaning use a **single word** at a time from the Discover Meaning
  table, read against the current context — not word pairs, not Lists, not
  Scenes.
- Ignore the Scene tab's scenes, Lists and Thread Track if you are playing
  One-Page style. The Oracle and Tables tabs are all you need.

Daggery does not forbid the other tools in this mode; it just leaves them
optional.

## Player knowledge vs. character knowledge

You will sometimes know things your character does not. Mythic offers four ways
to handle that:

- **Test it, ask it, then it is real** — have the character check before you ask
  a Fate Question whether the thing exists.
- **Reliable or unreliable information** — what you know is not canon until the
  character discovers it, so it may turn out wrong.
- **Going with it** — accept what you know and enjoy the adventure from a
  cinematic view.
- **Extra knowledge as an opportunity** — what you know opens a chance for the
  character to earn it in play.

## Daggery integration notes

Choose **Daggerheart Solo** in campaign creation. The Solo workspace runs on
`SOLO_RULES_VERSION` 0.3 and stores everything per campaign: the Chaos Factor
and flavor, the Lists (threads, characters, features), the scene and scene
counter, the Thread Progress Track, Keyed Scenes, Peril Points, the adventure
theme, and every roll — question, odds, method, purpose, dice, answer, result
and interpretation.

- The **Scene** tab sets chaos and flavors, tests scenes, manages Lists, the
  Thread Progress Track, Keyed Scenes and Peril Points.
- The **Oracle** tab asks Fate Questions (chart or check, with purpose), rolls
  Random Events with a chosen or rolled Focus, and rolls Meaning Tables.
- The **Tables** tab rolls any installed Mythic table, with the row highlighted
  and multi-column tables readable by column. The **Dice** tab rolls quick dice
  and arbitrary notation. The **Notes** tab keeps the journal.

Mythic mechanics are pure functions in `packages/shared/src/mythic-rules.ts`
and roll resolution lives in `apps/server/src/solo-mythic.ts`; word tables are
data in `packages/content/mythic/`. Covered by
`packages/shared/src/mythic-rules.test.ts` and
`apps/server/src/solo-mythic.test.ts`; run `npm test` at the repository root.

The earlier Hope & Fear oracle (rules version 0.2) still resolves old journal
entries and older campaigns, but the workspace now uses the Mythic procedures
above. The homebrew scene pools in [Thematic scene pools](solo-themes.md) remain
as optional inspiration, not part of the Mythic flow.
