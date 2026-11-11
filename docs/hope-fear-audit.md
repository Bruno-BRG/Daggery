# Hope & Fear content audit

Source audited: `Daggerheart_HF_Full_Art_and_Printer_Friendly_Cards_-_8-14-26.pdf`
(211 PDF pages, now in `sources/`). The contents-page evidence gives:

- **printed page = PDF page − 1** (PDF 5 = printed 4 "Introduction", PDF 8 =
  printed 7 "Chapter 1", PDF 129 = printed 128 "Reign of the Weredragon").
- PDF pages 1–4 are unnumbered front matter; PDF pages 198–211 are the unnumbered
  full-art/printer-friendly card sheets.
- Chapter ranges used by the app: Castle High 116–127, Reign of the Weredragon
  128–143, Dark Heart of Andaluria 144–157, Journey to Horizon 158–179.

Extraction command (output: `data/rules/hope-and-fear-book.json`; the current
extractor also writes the committed copy under `sources/rules/`):

```
python tools/extract_sources.py sources/Daggerheart_HF_Full_Art_and_Printer_Friendly_Cards_-_8-14-26.pdf \
  --id hope-and-fear-book --title "Daggerheart: Hope & Fear" \
  --printed-offset 1 --front-matter 4 --back-matter 198 --engine pymupdf --out data/rules
```

Poppler (`pdftotext`) silently drops the book's display-face numerals on many
stat-block pages, so PyMuPDF is used. The extractor also repairs the private-use
numerals (`` → 1, `` → 0, …) and ligature splits (`Diﬃ culty`,
`eff ect`, `off er`).

## Counts: book vs app before/after

| Category | In the book | Before | After |
|---|---:|---:|---:|
| Classes | 4 | 4 | 4 |
| Subclasses | 8 | 8 | 8 |
| Domains | 1 (Dread) | 1 | 1 |
| Dread domain cards | 21 | 21 | 21 |
| Ancestries | 6 (Elemental Kin is an umbrella intro, not a seventh playable ancestry) | 6 | 6 |
| Communities | 6 | 6 | 6 |
| Transformations | 6 | 6 | 6 |
| Primary weapons | 84 | 84 | 84 |
| Secondary weapons | 36 | 36 | 36 |
| Armor | 35 (4 / 11 / 10 / 10 by tier) | 35 | 35 |
| Items | 60 (rolls 1–60) | 60 | 60 |
| Consumables | 60 (rolls 1–60) | 60 | 60 |
| Adversaries | 135 | **136** | **135** |
| Environments | 28 | 28 | 28 |
| Card art (domain/subclass/ancestry/community/transformation) | 63 | 0 | 63 |
| Class portraits | 4 | 0 | 4 |

## What was wrong, missing, or removed

**Adversaries.** One entry was not in the book at all: **Outer Realms Corrupter**
(it came from non-HF material). It was removed. Every other adversary was
re-parsed from its stat block; tier, type, difficulty and HP agree with the old
data, but the text and several numerals were repaired. Example: Ghastly Legion's
Horde feature was `Horde (2d+)` and is now `Horde (2d6+5)`. Names with apostrophes
are now correct (`Will-o'-the-Wisps`, `Jack-o'-Lantern`).

**Environments.** All 28 re-parsed. Environment questions are now clean
(`...?`, not `...??`) and ligature damage is gone (`o cials` → `officials`,
`off ended` → `offended`). The book name is **Convergence, City of Portals**;
the stable id `convergence-the-city-of-portals` was kept.

**Classes and subclasses.** All four classes and eight subclasses were
re-parsed from the book rather than the card tiles. Two class features that the
old card import had truncated are complete again:
- Assassin — *Get In & Get Out* (ends "...has advantage.").
- Warlock — *Favor* (ends "...gain a Favor instead of a Hope.").
The two class tables now read correctly: Witch *Commune* (`1–3 / 4–5 / 6`) and
Moon *Lunar Phases* (`1 New / 2–3 Waxing / 4 Full / 5–6 Waning`). Subclass
features no longer absorb the Background Questions/Connections text.

**Transformations.** Descriptions were one sentence each; they are now the full
book entries. The six Transformation Questions lists (six questions each) were
missing entirely and are now present. The Reborne community's "When to Choose
the Reborne Community" sidebar no longer leaks into its feature text.

**Ancestries and communities.** All twelve entries were re-parsed; descriptions,
features and the italic personality lines are complete. The Aetheris sidebar
("Angels in the Hallows Above") is no longer mixed into the description.

**Dread domain cards.** The 21 cards were compared against the Domain Card
Reference (pp. 180–181) and the card faces. Names, levels, recall costs, types
and text all match; no card data changed.

**Equipment and loot.** All 84 primary weapons, 36 secondary weapons and 35
armor entries were re-derived from the tables. Unicode names now match the book
(`Cupbearer's Bezoar`, `Möbius Orb`, `Ethereal Zweihänder`). Two armor rows had
absorbed the next tier label in the old import (`Banded Armor Tier 2 (levels
2–4)`, `Deep-Forged Coral Armor Tier 4 (levels 8–10)`); the names are fixed and
the old ids were preserved. Items and consumables keep their roll order 1–60.
No id collisions with the core catalog were introduced; all previous ids were
preserved except the removed Outer Realms Corrupter.

## Unparseable / not machine-readable

- **Maps and illustrations are image-only**: book pp. 187–191 (PDF 188–192,
  campaign-frame maps), plus the interior art pages (PDF 6–7, 42–43, 114–115).
  The extractor marks these `imageOnly`; nothing was invented to fill them.
- **CampaignFrameMaterialsTile** pages 4–24 are maps/illustrations with no text
  layer. Its villain-builder prompts (pp. 1–2) and Journey to Horizon doom track
  (p. 3) are text and were read.
- The frames chapter itself did **not** need OCR: all four frames extracted from
  the native text layer. The extractor's 12 OCR pages are incidental map/index
  pages.
- The book's "Elemental Kin" page (printed 20) is an umbrella description of the
  four kin ancestries and has no ancestry features, so it is correctly not a
  seventh ancestry entry.

## Card art

The book's full-art pages (PDF 198–204, 63 cards) were extracted into the same
pipeline as the core set by `tools/extract_hf_cards.py`:

- 21 Dread domain cards, 24 subclass cards (8 subclasses × 3 parts), 6 ancestry,
  6 community and 6 transformation cards.
- 4 class portraits cropped from the class spreads (Assassin, Brawler, Warlock,
  Witch).
- Files live under `data/cards/` (gitignored, exactly like core art), and the new
  entries were appended to `packages/content/cards-index.json` (now 333 entries).
- `packages/content/index.ts` now sets `art: true` for the Hope & Fear classes;
  the compendium also maps transformation cards. Run
  `python tools/extract_hf_cards.py` after a fresh clone to materialise the
  binary WebP files. The printer-friendly duplicates on PDF 205–211 are ignored.

## Other supplied sources: what exists and what the app uses

| Source | Contents | App status / recommendation |
|---|---|---|
| `AdditionalSheetsTile_HF_2026-08-25.pdf` | Equipment (p. 1), generic multiclass sheet (p. 2), Warlock/Witch/Assassin/Brawler multiclass sheets (pp. 3–6), adversary sheets (p. 7) | Equipment is imported. The app has multiclass mechanics but no printable multiclass/adversary sheet view. No content is missing; printable sheets are a UI/print recommendation only. |
| `CharacterGuidesAndSheetsTile_HF_2026-07-23.pdf` | Class sheets and guides for the four classes; Martial Stances sheet with Focus track and stance list | Class/sheet data is modelled. **Martial stances are not data**: only the "take the Martial Stances sheet" text exists. Recommendation: add the stance list/Focus track if the app should track it. |
| `CampaignFrameMaterialsTile_HF_2026-07-23.pdf` | Reign villain-builder prompts (pp. 1–2), Journey to Horizon doom track (p. 3), maps/art (pp. 4–24, image-only) | The four frames and page ranges are now in `frames.ts`. The villain-builder prompts and a playable doom-track widget are not modelled. Recommendation only; no new content was invented. |
| `Daggerheart-HF-Print-and-Play-Cards-08-14-2026.pdf` | The same 63 cards in printer-friendly form | Used only as a cross-check; the book card pages are the primary art source. |
| `Sablewood-05-20-25.pdf` | 2 weapons, 1 armor, 3 items, 3 consumables, 3 adversaries, 3 environments | Unchanged and fully modelled; Sablewood remains `source: sablewood`. |
| `Additional-Sheets-Daggerheart-Aug252026.pdf`, `Campaign-Frame-Materials-Aug252026.pdf`, `Character-Sheets-and-Guides-Daggerheart-Aug252026.pdf`, `Daggerheart-Blank-Maps-May202025.pdf` | Generic/blank map and sheet bundles | No Hope & Fear content beyond what is listed above; maps are image-only. |

## Campaign frames

`apps/server/src/ai/frames.ts` now lists all four Hope & Fear frames with source
`hope-and-fear-book` and the book's printed ranges: Castle High 116–127, Reign of
the Weredragon 128–143, Dark Heart of Andaluria 144–157, Journey to Horizon
158–179. Each has authored one-sentence summary and brief seeds (tone, factions,
NPCs, locations, hooks). The older campaign-frame tile PDF is noted in
`sourceNote`: it had text only on pages 1–3 and pages 4+ are image-only.

## Verification

- `npm run typecheck` (all workspaces): pass.
- `npm test` in `apps/web`: 64/64 pass.
- `npx tsx --test src/ai-frames.test.ts` in `apps/server`: 4/4 pass.
- `npm test` in `apps/server`: 149/149 pass.

## Files changed

- `tools/parse_hope_fear.py` — rewritten to use the book as primary source.
- `tools/extract_sources.py` — PyMuPDF engine, private-use numeral and ligature
  repair, back-matter numbering (also touched by the concurrent RAG work).
- `tools/extract_hf_cards.py` — new 63-card + 4-class-portrait extractor.
- `packages/content/hope-and-fear/*.json` — regenerated.
- `packages/content/cards-index.json` — 63 Hope & Fear card entries appended.
- `packages/content/index.ts` — Hope & Fear `art: true`.
- `apps/web/src/modules/compendium/data.ts` + `data.test.ts` — transformation
  art lookup and updated art expectations.
- `apps/web/src/modules/sheets/appearance.test.ts` — Hope & Fear class art.
- `apps/server/src/ai/frames.ts` + `ai-frames.test.ts` — four frames and tests.
