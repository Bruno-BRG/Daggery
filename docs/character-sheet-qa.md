# Character sheet refresh — November 8, 2026

Result: passed for the implemented scope.

The user asked for larger, more visual class/domain features, then extended the same style to the rest of the digital sheet for online and in-person play.

## Implementation

- Reusable ability panels show a short effect, a prominent numerical effect where useful, cost/trigger facts, and icon-led benefits. Full original rules remain available in native expandable panels. Long unknown features receive bounded previews without changing source content.
- The same panel language now covers Play, Equipment, and Story: larger resource values and trait buttons, readable defenses, weapon damage and range blocks, armor thresholds, inventory quantities, background questions, progression, and notes.
- The Play loadout is searchable and uses compact expandable versions of the same ability component. Weapon and armor features use it too.
- Focus hides campaign navigation and the dice sidebar, while retaining sheet rolls, editing, recovery, and the Table shortcut. Sticky controls keep Exit focus and section tabs available. Escape exits focus unless a native sheet dialog is open.
- All four tabs remain visible on phones. Tablet and phone layouts reflow panels and inventory controls. Light and dark themes use appropriate ability accent colors.
- This is an online digital sheet with an in-person viewing mode; offline storage or offline synchronization was not added.

## Browser checks

Used the existing QA campaign and Guardian character, rather than the user's Solo campaign.

- Desktop: 1366 × 900; tablet portrait: 1024 × 1366; tablet landscape/light theme: 1024 × 768; phone: 390 × 844. These are browser viewport checks, not physical-device touch tests.
- Inspected all four sections, light/dark rendering, compact ability expansion, original full-rule disclosure, recovery dialog, mobile character actions, and inventory layout.
- Increased Hope from 1 to 2 and decreased it back to 1. Reloaded the app and verified the original QA resource values were retained: HP 7/7, Stress 5/7, Hope 1/6, Armor 3/4.
- Searched for `shield`: one matching active ability. Clearing the search restored both cards.
- Verified keyboard Home selects Play from Story and Escape restores the campaign shell from focus mode.
- At tablet width, the resource stepper controls measured 44px tall. Original expanded rules measured 16px on phone. The document width matched the viewport at 1024px and 390px.
- A clean reload loaded the saved sheet successfully; no new runtime errors followed it. Two historical Vite HMR reload errors were logged while the new module files were being assembled, before the completed build passed.
- Temporary viewport overrides were reset after capture.

## Automated checks

- `npm run test -w @daggery/web`: 26 passed. Four new presentation tests cover Bone formulas, Ranger Focus conditions, explicit Hope/Stress costs, and bounded fallback previews.
- `npm run build -w @daggery/web`: passed, including TypeScript. Existing large-bundle warnings remain.
- Frontend `/` responded 200; backend `/health` returned `{"ok":true}`.

## Screenshots

| View | Evidence |
|---|---|
| Focused sheet and resources | [Desktop](character-session-desktop.jpg) |
| Play panels and active ability | [Desktop](character-play-desktop.jpg) |
| Domain and class panels | [Desktop](character-abilities-desktop.jpg) |
| Weapons, armor, inventory | [Desktop](character-equipment-desktop.jpg) |
| Background questions | [Desktop](character-story-desktop.jpg) |
| Tablet sheet | [Portrait](character-session-tablet.jpg) |
| Phone sheet | [Resources](character-session-mobile.jpg) |
| Phone full rules | [Ability](character-abilities-mobile.jpg) |
| Phone inventory | [Equipment](character-equipment-mobile.jpg) |
| Light theme | [Ability panels](character-abilities-light.jpg) |
