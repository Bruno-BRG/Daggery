# Custom items and shared icons — November 8, 2026

Result: passed.

## Changes

- Add items has a visible Custom item source button alongside Catalog. Custom items accept a name, quantity, notes, and an optional icon choice.
- An Automatic option infers icons from item type and name. Sixteen explicit choices are available for custom items; the chosen icon is saved with the inventory entry.
- Existing inventory entries receive appropriate symbols without a data migration. Weapons, armor, potions, keys, rope, tools, and other items have distinct icons and restrained color accents.
- Shared Phosphor rendering uses duotone semantic symbols and bold utility controls. Navigation, character traits and equipment, domain emblems, compendium categories/results, table controls, file types, and dice appearance controls use the updated treatment.
- Icons remain decorative beside visible text or accessible control labels. Custom icon choices have named buttons and at least 46px target height.

## Verification

- Web tests: `npm run test -w @daggery/web` — 41 passed. New cases cover name/type inference, substring false positives, explicit overrides, persistence, stacking, and unknown-icon rejection.
- Web build: `npm run build -w @daggery/web` — passed after the final source edits.
- Desktop browser: created Moonstone token with a Gem icon in the dedicated UI Preview character. Reloaded and confirmed the saved icon. Existing entries retained their quantities and inferred appropriate icons.
- Phone browser at 390 × 844: inspected the Custom item form and expanded icon picker with a Feather-icon draft. Canceled the draft without adding it. Shortened the source button label to Catalog to keep the selector compact.
- Inspected compendium category/result icons in light mode at 1440 × 1000 and the floating table controls in dark mode. Restored dark mode and reset the temporary viewport override.
- Final browser error log: empty. Testing used responsive_qa_1107 / The Ashen Wilds · UI Preview; the user's Solo campaign was not changed.

## Evidence

- [Desktop custom item picker](custom-item-icons-desktop.jpg)
- [Mobile custom item picker](custom-item-icons-mobile.jpg)
- [Light compendium](icons-compendium-light.jpg)
- [Table controls](icons-table.jpg)

Custom items in this flow are inventory entries with notes. This change does not add custom weapon or armor rule authoring.
