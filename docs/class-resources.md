# Class resource trackers

The **Play** tab includes **Class resources** for the character's class and multiclass. Only available class/subclass features are shown. These trackers use the same saved, synchronized Sheet document as HP, Stress, equipment and other character details; no separate browser-only storage is used.

## Available trackers

- **Warlock:** patron, sphere, Favor and the chosen pact's active state.
- **Brawler / Martial Artist:** Focus, rest refresh, known stances and active stance; Combo Die reflects recorded advancements.
- **Assassin:** Marked for Death and Poisoners Guild tokens.
- **Witch:** Hexed targets and Commune use, Hedge talisman/spirit/circle tokens, Moon mastery phase.
- **Bard, Guardian and Seraph:** Rally use/held die, Unstoppable die/use, and individually recorded Prayer Dice.
- **Ranger:** Focus and Beastbound companion details, marked Stress, experiences and repeatable training ranks.
- **Druid, Rogue and Sorcerer:** active Beastform, Cloaked state, Channel Raw Power use and applicable subclass states.

Subclass and upgrade requirements apply to the primary class. A multiclass gains only its foundation trackers. Companion training benefits, available Stress slots and damage-die improvements are resolved manually; recording a training box does not alter other statistics.

## Manual resolution

These are manual play aids, not an ability automation engine. Recording a target, activating a state, changing a counter or spending a recorded die does **not** pay Hope/Stress costs, roll dice, resolve an attack, alter damage, apply threshold/Evasion bonuses, move domain cards or change another character. Follow the feature's printed rules and use the sheet's normal controls for those effects. Record the outcome here.

Derived facts show applicable resource dice. Patron/Favor starts at the printed default of 3 Favor when no value has yet been saved. Unrolled dice, unnamed patrons, targets and unknown stance choices are not invented. Record actual dice faces after rolling them.

## Lifetimes and synchronization

Starting a short or long rest through **Take a rest** resets the corresponding class trackers once, not on each downtime move. The **Scene & session changes** disclosure provides manual scene/session resets for tabletop play. A session reset clears unspent session dice, session-use marks and the recorded Lunar Phase; roll and record new dice as directed by the rules. Permanent choices and Warlock Favor are not replenished by these resets.

The existing solo/AI session lifecycle remains responsible for its automatic Seraph session-start Prayer Dice. The sheet controls share the original `resources.prayerDice` and `resources.focusTargetId` values with that mode, rather than keeping duplicate trackers. Other manual state lives in the optional `resources.classResources` bag. Old sheets need no migration; defaults are resolved when reading them. Hidden resources from an earlier class are not displayed or exported for an unrelated class.

Context-dependent expiration still requires the player to update the tracker: for example, when a marked target dies, a temporary Hex ends, a stance breaks, or a specific damage event ends a Warlock effect. No tracker infers events from narrative text.

## PDF

The exporter retains the original class sheet and fills available native resource spaces. Saved resources without an appropriate writing space are included on an editable **Class resources** supplement after the original pages. Blank exports do not include character-specific resource state. See [Original editable character sheets](character-pdf.md) for export limits and reader behavior.
