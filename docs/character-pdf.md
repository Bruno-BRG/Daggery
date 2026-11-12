# Original editable character sheets

Open a character and select **PDF** in the toolbar. On phones, select **Character actions** (the three dots), then **Export editable PDF**.

## Original pages for every class

All 13 supported classes use their own original sheet: the nine core classes and Assassin, Brawler, Warlock and Witch from Hope & Fear. Unsupported class IDs produce an explicit error instead of silently selecting a generic sheet.

The bundle at `apps/web/src/assets/pdf/original-character-sheets.pdf` contains the 22 original core pages followed by the nine Hope & Fear pages. Rebuild it with `node tools/build_character_pdf.mjs` from:

- `sources/Character-Sheets-and-Guides-Daggerheart-Aug252026.pdf`
- `sources/CharacterGuidesAndSheetsTile_HF_2026-07-23.pdf`

Exports copy only the selected pages, preserving vector artwork, class features, printed rules, typography, copyright notices, page boxes and sizes. The source is not redrawn or flattened.

## Guides and references

The matching character guide and class references are enabled by default; either can be excluded explicitly. Guides contain all original tier and level-up instructions. All advancement checkboxes are editable and prefill from recorded advancement history, filling available earlier-tier slots before later ones. Proficiency and multiclass each consume two slots. Brawler includes the three Combo Die advancement options. Older characters without advancement history can only prefill their stored current-level choices; missing historical choices cannot be reconstructed.

References include Druid Beastform pages, the Ranger companion and Brawler Martial Stances. Native class-resource spaces prefill only from valid, matching state: Warlock Patron name, sphere and Favor; Brawler Focus and known stances for the Martial Artist subclass; and Beastbound Ranger companion name, evasion, stress, attack, range and experiences. Other subclasses and older sheets without state keep those original spaces as editable blanks. Training boxes fill only when typed training options exist in the shared model. Brawler's main-sheet Combo Die is derived from recorded Combo Die advancements, starting at d4. Warlock Favor starts at 3 by rule even for legacy sheets. No state from another class or subclass leaks into these spaces.

Background and connection answers fill only when their question matches an original class question. Custom questions, general app notes and domain cards are not included. The original form has five Experience rows; additional Experiences are not exported.

## Class resources page

A filled export appends a readable, ink-and-rule **Class resources** page after the original pages whenever the sheet stores state for a resource available to this character (current class or multiclass, including the legacy Ranger Focus and Seraph Prayer Dice fields). A leftover key from a previously chosen class alone does not add the page. The page lists the character name, class/subclass, labels, values, dice faces and derived facts. Selection and choice values print their labels rather than stored ids, and counters show their maximum. Only definitions available to the current class and its multiclass are shown, so stale resources from a previously chosen class cannot leak.

The page uses the same embedded Noto Sans font with at least 9pt text, wraps long values and paginates instead of truncating them. Each value is a transparent, 10pt editable field over the drawn folio, so reader edits can still be saved. Each entry may include a concise help reminder and reset rule; long rules text is omitted so the page stays a folio summary. Values that already have a native original space may repeat here for a complete overview. Companion training maps each printed box to its own stored option in native sheet order; its benefits remain manual.

The page is never included in a blank export. Blank exports also withhold stored values and resource tooltips. A filled export with no persisted resource state keeps its original page count and shows only the printed starting values (for example, Warlock Favor 3).

## Filled information and legibility

Transparent AcroForm fields overlay the original writing spaces and remain editable after download. Regular writing spaces default to 10pt, traits and defenses to 16pt, and level to 18pt. Single-line labels shrink as needed, down to a 7pt floor. Extremely long text can still extend beyond the visible printed area; its full value remains editable. Multiline answers also retain their full value, but only the visible opening lines print.

Traits include worn-equipment modifiers. Attack fields include computed attack modifiers, Spellcast shows the selected casting trait and modifier, and the subclass field includes multiclass identity when present. Armor thresholds in the equipment section are base thresholds; the health section uses calculated thresholds. Numeric HP/Stress/Armor usage and maximums are visible between the health trackers, including capacities beyond the twelve printed slots. HP/Stress tracker tooltips also expose those totals.

Each printed inventory line is an individual quantity/name field. Descriptions are retained in field tooltips, not printed. More than five items continue on copies of the same class-specific sheet, five items per page, with only the character name and inventory filled on continuation pages. A blank export always uses one main sheet and contains no prefilled values, marks or character-specific tooltips.

PDF edits do not recalculate values, update the app or synchronize with a campaign. Save changes in a PDF reader that supports AcroForm fields. Class-resource trackers are manual records: adjusting one does not spend Hope or Stress, roll dice, or apply an ability's effects.

## Loading and verification

The font and bundled source use Vite content-hashed asset URLs and load only on download. Generation happens locally in the browser. The bundle is about 3.2 MB; exports include only the needed pages plus the embedded editable font.

Regression tests cover all 13 class mappings, source-content preservation against both original PDFs, guide/reference selection, editable save/reopen, blank exports and resource privacy, inventory continuation, computed modifiers, native class-resource prefill (Warlock Favor default, Martial Artist gating, Beastbound companion fields), supplemental page pagination and stale-state filtering, tracker geometry, font fitting and tier advancement history. Representative core and Hope & Fear exports are also rendered for visual inspection.
