# Original editable character sheets

Open a character and select **PDF** in the toolbar. On phones, select **Character actions** (the three dots), then **Export editable PDF**.

Exports now copy pages directly from `sources/Character-Sheets-and-Guides-Daggerheart-Aug252026.pdf`. The exact source is bundled as `apps/web/src/assets/pdf/original-character-sheets.pdf`. Original artwork, class features, typography, copyright notices, page boxes and sizes remain intact. No recreated Daggery pages are added. All nine core classes select their corresponding original sheet; unknown classes use the original generic page.

Transparent AcroForm fields overlay the original writing spaces. Text and tracker checkboxes are editable after download. Current traits, defenses, equipment, inventory, Experiences, gold and resource marks are filled. Armor thresholds in the equipment section are the base thresholds; the health section uses calculated thresholds. HP/Stress maximums are available in tracker tooltips. Unchecking the prefill option leaves every field empty.

Optional original pages include the matching character guide and Druid Beastform or Ranger companion sheets. Reference pages retain their original printed content. The guide fills background and connection answers only when their question matches an original class question; custom questions, general notes and domain cards are not part of the original form. Extra Experiences beyond its five rows are not exported. These fixed-space originals do not grow new pages: long inventory text remains in its editable, scrollable field. No recalculation or synchronization happens when the downloaded PDF is edited.

The font and source PDF use Vite content-hashed asset URLs and load only on download. Generation happens locally in the browser.

Verification includes source content-stream preservation for all nine classes, blank fields and trackers, editable save/reopen, page selection, complete long-text field values, rendered samples and a pixel-for-pixel comparison between the blank original Guardian export and its source page.
