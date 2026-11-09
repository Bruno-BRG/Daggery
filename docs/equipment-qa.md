# Equipped gear controls — November 8, 2026

Result: passed.

The sheet previously displayed equipped weapons/armor but only the creation wizard allowed selection. Equipment cards now offer Change and Unequip, and empty weapon/armor slots offer Equip. Weapon controls are available in both Play and Equipment. Inventory gear can be equipped again directly.

The picker provides catalog search, a tier filter, and a stat/feature preview before an explicit Equip action. It defaults to the character's current tier and allows selecting other tiers. It does not purchase gear or change gold. Existing attack/damage and defense calculations read the updated equipped IDs.

Gear replacement is an atomic sheet mutation. Replaced gear is stowed in inventory. Equipping a two-handed primary, or unequipping the primary, stows the secondary too. A secondary requires a one-handed primary, matching the existing creation wizard. Armor damage is preserved on the individual stowed item and restored when that item is equipped again. The inventory schema additions are optional and compatible with older sheets; unambiguous catalog-named weapon/armor entries are also recognized without a stored catalog ID.

## Automated validation

- `npm run test -w @daggery/web`: 35 passed, including four new equipment tests.
- New regressions cover two-handed swaps, inventory consumption, armor damage preservation, derived defenses, invalid slots, unequipping, and legacy inventory stacks without mutating the original sheet.
- `npm run build -w @daggery/web`: passed, including TypeScript. Existing large-chunk warnings remain.

## Browser validation

Used Ash in the existing UI Preview campaign, leaving the user's Solo campaign untouched.

- Changed Longsword to Broadsword through search and explicit Equip, then equipped a Round Shield in the secondary slot.
- Selected Longsword again. Its preview explained that both hands were needed and the Round Shield would move to inventory. The resulting sheet had Longsword equipped and both Broadsword and Round Shield stowed.
- Swapped Chainmail for Gambeson. Live Armor changed from 3/4 remaining to 3/3, Evasion from 8 to 10, and thresholds from 8/16 to 6/12. Re-equipped Chainmail from inventory: Armor returned to 3/4, preserving its previously used slot, and Evasion returned to 8.
- Reloaded the app and verified original equipped Longsword/Chainmail and restored resource values persisted. The three newly tried catalog items remain in the QA character's inventory as demo gear; none of its original inventory was removed.
- Inspected the picker at desktop 1440 × 1000, tablet 1024 × 768, and phone 390 × 844. The phone uses a vertical layout with an Equip action that stays visible at the bottom of its preview. Tablet document width equaled the viewport; the dialog fit inside it.
- Closed a selected armor preview without applying it and confirmed the equipped armor remained unchanged.
- Final browser error log was empty. Temporary viewport overrides were reset.

Evidence: [Desktop picker](equipment-picker-desktop.jpg), [tablet picker](equipment-picker-tablet.jpg), [phone picker](equipment-picker-mobile.jpg), [equipment controls](equipment-controls.jpg).
