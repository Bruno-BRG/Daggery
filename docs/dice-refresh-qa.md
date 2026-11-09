# Dice mechanics and customization — November 8, 2026

Result: passed for the implemented scope.

## Causes and fixes

1. The previous renderer ran uncontrolled physics, waited for rest, then hopped and rotated every die onto the RNG result over 650ms. The new renderer first simulates the throw, chooses a fixed symmetry of the solid before its first visible frame, and plays the recorded poses. The same face numbers remain fixed throughout. The rendered vertices coincide with the physics collider, including d4 corner numerals and d10 kite faces. There is no post-landing rotation, number swap, or corrective hop.
2. Echo suppression keyed rolls by display author and result. The server correctly replaced the display author with the authenticated username, so the key changed and the sender replayed its own broadcast. Each local roll now has a unique correlation ID, which the server validates and echoes without changing account attribution. The sender remembers IDs; identical results from another client still animate normally. The ID generator supports local-network HTTP sessions where randomUUID is unavailable.
3. An attack could synchronously enqueue damage inside its onComputed callback before reserving the attack's animation. Animation slots are now reserved before that callback. Rapid clicks in the dice controls are also guarded until the current throw completes.

## Customization

- Six color sets: Classic, Nebula, Ember, Glacier, Verdant, Obsidian.
- Custom Hope, Fear, and other-dice body colors, with automatic numeral contrast.
- Matte, polished, and metal finishes; None, Glow, and Sparks effects. Sparks include trails and a brief landing effect.
- Preferences use the existing browser preference storage and apply to the shared overlay regardless of the control's location. This is a device appearance preference, not a remotely synchronized player cosmetic.
- A preview throws Hope 12, Fear 7, and d20 20 without a game roll, history entry, or Fear change.
- The overlay follows the open native dialog into its top layer, keeping previews and rolls visible over mobile drawers and recovery dialogs.
- Reduced-motion preferences suppress particle effects and shorten playback. Throws use a maximum playback duration of 2.6 seconds (shorter with reduced motion), followed by a hold and fade. WebGL failure still permits ordinary roll results.

## Verification

- Automated tests check every value-to-value rotation for all d4/d6/d8/d10/d12/d20 solids against their original collider vertices.
- A deterministic mixed physics throw verifies the requested final faces and that the last poses are already resting, without an end-frame correction.
- Regression tests cover different display/account names, duplicate echoes, identical remote outcomes, attack-before-damage ordering, invalid stored appearance data, and numeral contrast.
- The server WebSocket test verifies the roll ID survives authenticated author canonicalization and remains isolated to its campaign.
- Browser QA used the existing UI Preview campaign. A d20 click added exactly one history entry and one animation; its physical result and log both showed 1.
- Two independent browser clients of the QA account received a d6 result of 2. Both canvases reported exactly one started and completed throw, both displayed 2, and both histories contained one new entry. Neither replayed the existing history on joining.
- The display name remained Player while the authenticated username was responsive_qa_1107, reproducing the original mismatch condition.
- Preview faces were 12, 7, 20; history stayed at five entries through previews. Nebula/Metal/Sparks survived reload and loaded in a fresh client.
- Desktop viewport: 1440 × 1000. Phone viewport: 390 × 844. The mobile preview canvas measured 390 × 844 and was inside the open dialog's top layer. Original desktop/tablet/mobile gameplay controls continue using the same persistent overlay.
- Final browser errors: none observed. Temporary viewport overrides were reset; the extra comparison tab was closed.

## Checks

- `npm test`: 75 passed (12 server, 31 web, 32 shared).
- `npm run typecheck`: passed across workspaces.
- `npm run build`: passed across workspaces, including final source updates. Existing large-chunk warnings remain.
- Evidence: [Desktop preview](dice-style-desktop.jpg), [mobile preview](dice-style-mobile.jpg).
