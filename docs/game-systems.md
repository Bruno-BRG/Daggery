# Campaign systems and solo play

Every signed-in user can create a campaign. The creator manages that campaign;
there is no global GM account requirement.

Creation and **Campaign settings** select a game system and one of its rulesets.
The shipped system is Daggerheart, with **Daggerheart · Group** and **Daggerheart
Solo**. Solo supports a lone hero, a hero with a lightweight companion, and a
two- or three-character party controlled by one player.

**Game Master** is a separate selector: human/oracles or **AI Game Master**. AI
campaigns open Adventure and connect an OpenCode Console or OpenRouter key. See
[AI GM setup and architecture](ai-gm.md). Old configurations omit `gmController`
and retain human control.

## Campaign configuration

```json
{
  "systemId": "daggerheart",
  "rulesetId": "solo",
  "options": {
    "partyMode": "companion",
    "fearThreshold": 3,
    "partySize": 2
  }
}
```

`systemId` and `rulesetId` are stable identifiers, not display names or a closed
TypeScript enum. Options belong to the selected ruleset and are normalized by
that ruleset on the server. Party size matters only in small-party mode. A solo
campaign starts with one Fear per full PC; a lightweight companion adds none.
Keep existing ruleset IDs compatible when updating their implementation. A
breaking edition should receive a separate ruleset ID or an explicit migration;
existing campaign IDs should not silently acquire incompatible rules.

The version 3 migration gives every existing campaign the Daggerheart Group
configuration. Existing documents, rolls, accounts, and memberships are preserved.
The server's existing pre-migration backup flow remains in use. Migration tests
cover version 1, version 2, and legacy data, including repeat migration calls.

A campaign's system is fixed after creation because the existing sheets and
documents belong to that system. Changing systems means creating another campaign.
Rulesets within a system can change through settings. Group-to-solo conversion
requires no other campaign members and revokes pending invitations. Solo-to-group
retains preparations and history. Changing a Daggerheart ruleset or solo party
mode expires the current action beat and any pending assistance; it does not reset
Fear, delete character sheets, or grant another starting Fear allocation.

## Extension boundaries

The platform handles authentication, campaigns, invitations, notes, assets,
document storage, and transport. A system owns its rulesets, validated options,
enabled features, document policies, starting documents, and configuration-change
effects.

- `packages/shared/src/systems/types.ts`: system/ruleset contracts and document
  policies, with no Daggerheart-specific behavior.
- `packages/shared/src/systems/registry.ts`: registered systems, configuration
  validation, feature lookup, and document access helpers. Unknown systems and
  rulesets fail closed.
- `packages/shared/src/systems/daggerheart/definition.ts`: Daggerheart's group and
  solo manifests, option validation, starting Fear, and transition behavior.
- `packages/shared/src/systems/daggerheart/solo.ts` and `themes.ts`: pure solo
  rules, result types, original thematic content, and dice resolution.
- `apps/web/src/systems/types.ts`: a UI adapter's contract for modules, optional
  setup fields, dice controls, and dice overlay.
- `apps/web/src/systems/daggerheart.tsx`: Daggerheart's adapter. Existing character,
  map/combat, compendium, and GM implementations are registered here rather than
  being assumed to exist for every game.
- `apps/web/src/modules.ts`: UI registry and feature-filtered module selection.
  Campaign navigation and search use the selected adapter's pages.
- `apps/server/src/solo.ts`: Daggerheart Solo's authenticated API and persistence.
  It requires the namespaced `daggerheart.solo` feature, not merely any solo mode.
- `apps/web/src/modules/solo`: the solo workspace and embedded rules reference.
- `apps/web/src/systems/useSoloAssistance.ts`: the Daggerheart character-sheet
  bridge for consuming paid companion assistance.

To add another system:

1. Add a shared system definition with its own ID, rulesets, versioned rules,
   options validator, namespaced feature IDs, and document policies. Register it
   in `GAME_SYSTEMS`.
2. Implement its own character/rules modules and any system-specific API handlers.
   Validate requests and gate handlers on the system's own feature IDs.
3. Add a UI adapter and register it in `apps/web/src/modules.ts`. Give modules
   unique page IDs; `home`, `notes`, and `library` are reserved platform pages.
   Supply setup fields and dice controls when the game needs them.
4. Add engine, configuration, authorization, and migration tests as appropriate.
   A synthetic future-system test verifies independent options and document
   policies without inheriting Daggerheart features.

The registries contain bundled code, not arbitrary executable plugins uploaded
by a campaign owner. A new system still requires its actual rules and UI to be
implemented; configuration alone does not translate Daggerheart sheets into it.
Generic dice and Duality results use the existing normalized roll transport. A
system with a different result structure must add its transport validator and
presentation rather than masquerading as a Daggerheart action.

## Solo workspace

- **Engine:** the Duality Solo Engine (`docs/solo-rules.md`), a d12 emulator
  in which the campaign Fear pool plays the GM. A Fear Check (d12 at or under
  current Fear) decides when the engine spends Fear and acts.
- **Oracle:** yes/no questions on Hope + Fear against five likelihoods, with
  twists when the dice are 4 or more apart and Random Events on doubles.
  Results are generated on the server and saved with their raw dice and rules
  version. Request IDs make retries idempotent.
- **Scene & moves:** scene setup with Altered and Interrupted scenes, Soft and
  Hard GM Moves after action rolls, and Random Events with an Event Focus.
- **Lists & countdowns:** Threads and NPCs lists of up to 12 open lines, picked
  by a d12, and countdowns for looming threats.
- **Generators:** adversary spotlight with Tactics and Fear Spend, NPCs, plot
  hooks, a site crawler, journeys, and Action/Subject/Descriptor meaning words.
- **Companion:** available in companion mode; profile, derived defenses, marked
  HP/Stress, one contribution per action beat, and recovery controls.
- **Journal:** accepted interpretations, notes, and procedural records, with
  cursor-based access to older history. Raw, uninterpreted rolls remain available.
- **Tables:** every engine table, each rollable on its own.

Oracle, scene, meaning, and prompt rolls are independent of ordinary character
action handlers: they never award Hope/Fear, clear Stress, or advance clocks.
Only actual character actions use the normal action mechanics. Scene/oracle tone
is inherited by a theme prompt; fresh content dice do not create another twist.

An action **beat** is explicitly started before a character action. Within it,
countdowns accept one action outcome, each companion contributes at most once,
and the solo Fear procedure spends at most once. Oracle questions do not reset
these limits. Apply only relevant dynamic countdowns; printed standard countdowns
retain their original triggers at the game table.

Companion Assist pays one hero Hope and one companion Stress in a single database
transaction, publishes the updated sheet, and prepares advantage for that hero's
next character-sheet action. Consuming it is revision-checked and cannot happen
twice. It cancels disadvantage and does not add a second advantage die. Strike
together rolls and records the extra d6; Cover records its Stress cost and effect.
The player applies those damage/HP changes at the appropriate resolution point.
Recovery controls are used after the hero's completed rest, whose normal resource
and Fear changes remain on the character sheet.

The player confirms fictional positioning, feature triggers, and the full Fear
cost before using procedures. The system does not invent damage or activate an
enemy attack merely because a prompt sounded dangerous. This is the homebrew
playtest ruleset; encounter and companion balance still require actual play.

## Persistence and permissions

Campaign configurations are validated and stored in `campaigns.configuration`.
Solo preparation and history use the campaign-scoped `solo` document namespace.
Preparation uses a revision counter; conflicting writes return HTTP 409 and keep
the local draft available until the user reloads it. Costs, beat changes, and
procedural journal records commit atomically.

Solo documents are server-managed: ordinary WebSocket document writes cannot
replace them. Only the live state belongs in WebSocket snapshots; journal history
is loaded through the paginated API. Manifest document policies control member
versus GM reads/writes, server-only writes, public IDs, and protected IDs. Fear
is a protected Daggerheart document changed through its dedicated operations.

Solo invitations are rejected on the server, and solo endpoints require both GM
access and the Daggerheart Solo feature. Even an imported player membership cannot
read solo preparations through the API. Group campaigns cannot call solo endpoints.

## Validation

`npm test` passes 95 tests. `npm run build` passes, including workspace type checks.
Tests cover configuration validation, future-system registration, old campaign
migration, invitations, HTTP/session/origin boundaries, oracle math over every
ordered d12 pair, history pagination, concurrency, resource isolation, costs,
companion assistance, and countdown/Fear deduplication.

Browser checks use a temporary database and separate API/preview processes. They
cover campaign creation in all three solo modes, settings conversion, saved state
and journals, character-sheet assistance, navigation protection, dark/light themes,
and layouts at 320, 390, 834, and 1440 pixels. Screenshots and the check report are
in `docs/solo-preview`. Test processes are stopped when validation finishes.
