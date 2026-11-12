# Key rules (Core Rulebook, ch. 2) for the VTT engine

Source: `sources/Daggerheart_Core_Full_Art_...pdf` (PDF page = book page + 1). Extracted text: `data/extract/core_mine.txt`.

## Dice and rolls
- Action roll = Hope d12 + Fear d12 + trait + modifiers (Experience = +mod for 1 Hope) + extra dice (advantage d6 adds, disadvantage d6 subtracts, Rally Die etc.). Success: total >= Difficulty.
- Hope > Fear: "with Hope" -> player gains 1 Hope (even on failure). Fear > Hope: "with Fear" -> GM gains 1 Fear (even on success).
- **Critical (equal dice)**: automatic success, counts as Hope (+1 Hope) **and clears 1 Stress**; on attack, extra damage. The engine already returns `critical`, `withHope=true`/`withFear=false`; the sheet applies +1 Hope, clears 1 Stress and computes critical damage (maximum of dice + normal roll).
- Rolls with Fear record +1 Fear automatically on the GM (`fear:add` atomic on the server), with no race between clients. Hope max 6. Spending Hope: Help an Ally (d6 advantage), Utilize Experience, Tag Team (3 Hope), Hope Feature (3 Hope).
- Damage: Proficiency (1–6) = number of weapon dice; fixed modifier does not scale. Critical: damage = maximum dice + normal roll (+ modifier).
- Total damage per move is summed before comparing with thresholds.

## Damage and HP
- Final thresholds = armor + level. Damage >= Severe: 3 HP; >= Major: 2 HP; below: 1 HP; reduced to 0: none.
- HP max 12, Stress max 12 (starting Stress 6). Last Stress marked -> Vulnerable until 1 Stress is cleared. Extra Stress with full slots -> 1 HP.
- Last HP -> Death Move: Blaze of Glory / Avoid Death / Risk It All (Hope die > Fear die = survive and clear HP/Stress = Hope die value; critical clears everything).
- Direct damage ignores Armor Slots. Types: phy / mag.

## Combat and ranges
- No initiative or rounds; spotlight passes narratively. Player with Fear/failure -> GM may act (spends Fear for spotlight/Fear moves). Optional: Spotlight Tracker (3 action tokens per PC).
- Ranges: Melee, Very Close (5–10 ft, ~2–3" on map), Close (10–30 ft, ~5–6"), Far (30–100 ft, ~11–12"), Very Far (100–300 ft). Optional "Defined Ranges" on 1" grid.
- Countdowns = adjusted die decremented.

## Multiclassing (Core Rulebook p. 111)
- From level 5 (Tier 3), multiclassing may be taken as a level-up option and uses **both level-up slots** (black box).
- Choose an additional class, one domain you do not already have, the class feature, and a foundation subclass card. Each character multiclasses only once; afterwards you cannot gain a mastery subclass card.
- Domain cards from the new domain are limited to half your level (rounded up). Attacks, spells and moves use your current level; the half-level limit only applies to card selection.
- If the foundation card has a Spellcast trait, choose to use it or your original subclass Spellcast trait.

## Mixed ancestry (Core Rulebook p. 71)
- Name your heritage (e.g. "Goblin-Orc"), choose two lineages, and take the first feature of one ancestry and the second feature of the other.
- If heritage includes more than two ancestries, only features from two are chosen; additional lineages appear via appearance and backstory.
- Automatic bonuses implemented: Simiah Nimble (+1 Evasion), Giant Endurance (+1 HP slot), Human High Stamina (+1 Stress slot), Earthkin Stoneskin (+1 Armor Score and +1 thresholds).

## Rest
- Short: 2 moves (Tend to Wounds / Clear Stress / Repair Armor = 1d4+tier; Prepare = +1 Hope, 2 with ally). GM gains 1d4 Fear.
- Long: 2 moves (clear everything, Prepare, Work on a Project). GM gains 1d4 + number of PCs Fear.
