# Daggery interface review

Custom items and icons: [November 8 icon verification](docs/icons-qa.md), covering the visible Custom item source, saved icon choices, automatic inventory symbols, and shared icons across the sheet, navigation, compendium, and table.

Inventory-based equipment: [November 8 inventory verification](docs/inventory-qa.md). The full catalog now belongs to Add items; equipping is limited to owned carried gear. This supersedes the earlier catalog-direct equipment picker.

Equipped gear: [November 8 equipment verification](docs/equipment-qa.md), covering the new Change/Equip/Unequip controls, searchable picker, inventory retention, and armor damage persistence.

Dice mechanics and customization: [November 8 dice verification](docs/dice-refresh-qa.md), covering natural landings, roll echo IDs, attack/damage order, appearance settings, and two-client replay checks.

Latest character-sheet extension: [November 8 character-sheet verification](docs/character-sheet-qa.md), including ability quick references, Play/Equipment/Story styling, focus mode, and desktop/tablet/phone evidence. The original app-wide review below records the earlier scope.

final result: passed

Reviewed the implemented local application against the user-provided Owlbear Rodeo screenshot and the user's subsequent requests for an app-wide visual system, table-only combat, a consistent compendium, and readable text.

## Evidence

The reference and the saved desktop tabletop screenshot were opened together for direct visual comparison. Browser chrome and unrelated browser tabs in the reference were excluded from the design target.

| View | Screenshot | Viewport |
|---|---|---|
| Floating table and asset tray | docs/tabletop-desktop.jpg | 1366 × 900 |
| Tablet table | docs/tabletop-tablet.jpg | 1024 × 768 |
| Mobile table | docs/tabletop-mobile.jpg | 390 × 844 |
| Overview and shared app chrome | docs/overview-desktop.jpg | 1366 × 900 |
| Compendium, class reader | docs/compendium-final-desktop.jpg | 1366 × 900 |
| Compendium, armor without artwork | docs/compendium-desktop.jpg | 1366 × 900 |
| Mobile compendium reader | docs/compendium-mobile.jpg | 390 × 844 |
| Quick navigation | docs/quick-navigation-desktop.jpg | 1366 × 900 |

## Visual comparison

- Full-screen map with slate/purple floating surfaces, compact left panel navigation, a right tool rail, a bottom asset tray, and a contextual miniature action bar matches the reference's composition.
- Background grid, rounded panel edges, subtle borders/shadows, circular miniature bases, colored attachment rings, and dashed area effects were inspected at full view and in their respective UI regions.
- Original illustrated forest/animal artwork replaces reference artwork. The scene's 16:10 aspect ratio, Daggerheart range terminology, app branding, and Phosphor icon equivalents are intentional differences.
- Text is intentionally larger than the reference after the user's readability request. UI metadata has a 12px floor; navigation and controls generally use 14px, and the compendium reader uses 15px body text. Long overviews and feature explanations expand on demand.
- Shared app surfaces, selection states, navigation icons, dialogs, overview, and character library use the same slate/purple language. Light mode remains available with matching purple accents.
- The compendium consistently uses text rows plus a reader for all categories. Original card images appear only after an explicit preview action. Armor and other entries without images reserve no artwork space.

## Functional verification

- Dragged a saddled horse from the tray to a specific point on the map; moved a wolf with two attached status rings and verified that its rings followed.
- Added an aura and inspected its dashed circle; corrected unwanted lines between dash segments.
- Created an ellipse, undid it, redid it, and verified the resulting scene. Added persistent map text. Scene objects survived the application reload caused by dependency optimization.
- Rolled a d20 from the table panel and verified the 3D dice and new shared log entry.
- Opened a character's live folio from its miniature, changed HP, and verified the miniature editor reflected it. Restored the test character's original HP.
- Added an adversary through the in-table encounter builder. It appeared on the map and in the encounter. Changed encounter HP and verified the miniature's remaining HP; restored its original HP.
- Verified combat's party roster reads modern character HP, Stress, Evasion, and thresholds rather than obsolete pool fields.
- Uploaded a local QA PDF and rendered it with PDF.js after the browser's PDF frame failed to display it. Verified the rendered page, disabled first/last-page controls for the one-page handout, and readable extracted page text on mobile. Multi-page controls are implemented; the browser handout used for this check had one page.
- Verified Players lists actual campaign membership and roles without inventing online presence.
- Verified Characters → Table opens the saved scene and selects an existing miniature rather than adding a duplicate.
- Verified main navigation and quick navigation contain no standalone Combat entry. Combat remains accessible from the table's left menu.
- Verified class, ancestry, armor, and domain entries; domain artwork still opens correctly on demand. Expanded a class feature in the mobile reader.
- DOM measurements showed no page-level horizontal overflow at desktop, tablet, or phone widths. Mobile canvas fills the full viewport after removing the hidden main navigation's reserved bottom padding.
- The final visible-text audit found zero rendered UI text elements below 12px. The final browser error log was empty. Temporary viewport overrides were reset.

## Issues resolved

| Severity | Finding | Resolution |
|---|---|---|
| P1 | Browser PDF embedding stayed blank | Added a lazy-loaded PDF.js reader with zoom and a readable text view |
| P1 | Character resources were absent in the combat roster | Read current marked-slot sheets using the shared sheet rules |
| P2 | Mobile table retained space for hidden app navigation | Removed table shell padding; verified canvas equals viewport |
| P2 | Character shortcut selection was cleared by StrictMode effects | Reset selection only when the actual scene changes |
| P2 | Mixed compendium card/list layouts left useless art areas | Unified all categories into text rows and a reader |
| P2 | Navigation and metadata were too small | Raised text sizes, shortened UI copy, and added progressive disclosure |
| P2 | Mobile character toolbar wrapped labels awkwardly | Used an accessible icon back button on small screens and kept action labels on one line |
| P2 | Floating panels could extend behind the bottom tray | Limited panel scroll height at desktop/tablet/mobile breakpoints |

No unresolved P0, P1, or P2 findings within this interface update.

## Checks and existing limits

- `npm run typecheck`: passed across workspaces.
- `npm test`: passed, 66 tests (12 server, 22 web, 32 shared).
- `npm run build`: passed; final web build after the last source edit also passed.
- Existing Vite warnings for large application/content chunks remain. The PDF reader and worker are loaded only when needed.
- Server visibility restrictions remain intact: map documents and uploaded PDFs are currently GM-only. This interface update does not enable player map/file sharing. Membership, asset authorization, and campaign-isolation tests pass.
- Undo/redo is session-local and checks the current document before reverting an edit, to avoid overwriting a subsequent change.
- The QA account/campaign were used for interaction testing. The sample map and animal assets are available to other campaigns without replacing their existing scenes.

## Research and asset provenance

Interaction references: [Owlbear image dock and image types](https://docs.owlbear.rodeo/docs/images/), [Owlbear drawing tools](https://docs.owlbear.rodeo/docs/drawing/). Implementation references: [Phosphor React icons](https://github.com/phosphor-icons/react), [Mozilla PDF.js rendering examples](https://mozilla.github.io/pdf.js/examples/).

Original image prompts, output paths, and dimensions are recorded in docs/tabletop-assets.md. Work scopes and completion are recorded in docs/tabletop-refresh-ledger.md.
