# GM tools

Open **GM tools** in the campaign navigation, or under **More** on a phone.
Only Game Masters see the section. The server also rejects player writes and
excludes GM documents from player snapshots and live broadcasts.

- **Loot tables:** searchable Core Set item and consumable tables, rarity-based
  d12 pools, private rolls, and a saved loot log with recipient/context notes.
  Keeping a result saves a copy of its effect for future reference; it does not
  add equipment to a character automatically.
- **Setting:** one editable campaign reference covering premise, tone, places,
  factions/NPCs, secrets, and table agreements.
- **Scenarios:** separate preparations with planned/active/complete status,
  hook, stakes, scenes, cast, rewards, aftermath, and an optional environment
  reference with its rules.

Preparation uses explicit save buttons. Saves show success after the server
echoes the document. Navigation warns about unsaved preparation. Everything
is persisted per campaign in the existing `campaign_docs` store under the
GM-only `gm` namespace; no schema migration is needed.

Loot pools and the 1–60 table order follow the Core Set tables in the
[Daggerheart SRD 2.0](https://www.daggerheart.com/wp-content/uploads/2026/08/DH_SRD_2_2026_08_25.pdf),
printed pages 75–77 and 80–81. This interface uses the repository's existing
Core Set catalog; expansion tables are not included.

## Validation

- Type checking and production build pass.
- All 87 tests pass, including pool boundaries, summed dice lookup, server
  persistence, GM document deletion, campaign isolation, and player read/write
  restrictions.
- Browser checks cover creation, editing, save/reload, deletion, table search,
  rarity changes, unsaved navigation protection, and player navigation.
- Layout checks at 320, 390, 834, and 1440 pixels found no page or control
  overflow. Screenshots and the browser-check report are in `docs/gm-preview`.
- Browser validation uses a temporary database and separate API/preview
  processes, which are stopped when validation finishes.
