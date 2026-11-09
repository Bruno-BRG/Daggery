# Floating tabletop implementation

Reference: user-supplied Owlbear Rodeo screenshot, 1920 × 1080 (84px browser chrome).
Target: existing Daggery map screen, a full-viewport table with dark floating chrome.

## Asset production

| Task | Scope | Consumer | Status |
|---|---|---|---|
| rocky_map | public/maps/rocky-forest.png | Scene map, Maps tray, overview | Complete · 1586 × 992 |
| wolf_token | public/tokens/wolf.png | Animals tray and miniature | Complete · 1254 × 1254 |
| horse_token | public/tokens/horse.png | Animals tray and miniature | Complete · 1254 × 1254 |

## Implementation

- Main agent: floating room layout; left room panels; bottom categorized tray;
  right tools; drawings, text, effects and attached statuses; persistence and undo.
- Asset agents: raster generation only; no source-code edits or browser use.
- Final gate: tests/build/typecheck plus source/screenshot comparison in design-qa.md.

## Expanded user requests

- Applied the slate/purple visual language and Phosphor icons throughout the app.
- Removed Combat from MODULES, main navigation, quick navigation, and overview shortcuts.
- Combat stays inside the table, with scene-linked adversaries and live miniature resources.
- Unified the compendium into text rows plus a reader, with optional original-card previews.
- Raised UI metadata to at least 12px, body/control text generally 14–15px, and collapsed long rule explanations.
- Added a lazy-loaded PDF.js reader after browser PDF embedding failed visual QA.

Final evidence and constraints: ../design-qa.md. Asset prompts: tabletop-assets.md.
