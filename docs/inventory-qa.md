# Inventory-based equipment — November 8, 2026

Result: passed. This replaces the earlier equipment picker's catalog-direct flow.

## Behavior

- Change equipment shows compatible positive-quantity carried items only. The swap model also rejects unowned gear, independent of UI filtering.
- The full catalog is available through Add items. Weapons, armor, gear, and consumables include source descriptions/features; quantity is selected before adding. Custom items accept a name, quantity, and notes. Starter torch, rope, and supplies are available alongside the content catalog.
- Adding items does not equip them or spend gold. Matching stacks merge. New armor stays separate from damaged copies. An acquisition confirmation is shown, and inventory search/category filters reset to reveal the inventory.
- Inventory rows provide Equip. Equipping uses one specific carried copy and stows the replaced gear. Armor damage stays with its copy, including swaps between two copies of the same catalog armor.
- Add items can be opened from the equipment picker, carrying the current search into the catalog. Adding or canceling returns to the owned-equipment picker.
- The inventory itself has text search and category filtering. Searches/categories also apply to catalog acquisition; tier filtering is available for catalog weapons/armor.

## Tests and browser checks

- `npm run test -w @daggery/web`: 39 passed. New regressions cover rejecting unowned/zero-quantity equipment, catalog acquisition and stack quantities, specific armor-copy damage, and custom notes/quantity validation. Existing swap tests now acquire gear before equipping it.
- `npm run build -w @daggery/web`: passed, including TypeScript. Existing large-chunk warnings remain.
- Used the existing Ash QA character; the user's Solo campaign was not modified.
- Its primary picker initially contained only the carried Broadsword. Searching for an unowned Longbow produced no owned match.
- Added two Longbows through Add items. The current Longsword stayed equipped; the owned picker then showed Longbow ×2. Equipping one left one in the inventory, and equipping the original Longsword stowed the Longbow back into its stack of two.
- Added two Minor Health Potions, merging into the existing stack for a total of three. The source description became available through Details.
- Created a custom Silver key with quantity one and cellar notes on a phone viewport, then verified the saved note through inventory search and Details.
- Reloaded and verified Longbow quantities, potion quantity three, custom item, original equipped Longsword/Chainmail, and original armor remaining 3/4 persisted. Gold remained one. New QA acquisitions remain as demo inventory; original possessions were retained.
- Searching for Crossbow in the owned picker forwarded that query to Add items. Canceling returned to the owned picker without acquiring the Crossbow.
- Inspected desktop at 1440 × 1000, tablet at 1024 × 768, and phone at 390 × 844. Phone document width equaled the viewport, and the equip/add confirmation stays visible within the selected item's preview. Temporary viewport overrides were reset.
- Final browser error log: empty.

## Evidence

- [Add catalog items](inventory-add-desktop.jpg)
- [Owned equipment picker](inventory-owned-equipment.jpg)
- [Custom item on phone](inventory-custom-mobile.jpg)
- [Owned equipment on phone](inventory-owned-mobile.jpg)
- [Catalog on tablet](inventory-add-tablet.jpg)
- [Final inventory and equipment](inventory-equipment-flow.jpg)
