# Character folio and game table

This pass extends the existing React, Tailwind, and Pixi implementation. It adds
no new runtime dependencies and leaves campaign authentication and map-sharing
permissions unchanged.

## Character folio

- A panoramic class-art header with character identity, Evasion, and level.
- Hit Points, Stress, Hope, and Armor cards available above every sheet tab.
  The large number shows the remaining resource; the smaller caption explicitly
  shows marked slots. The plus/minus controls and slot buttons update the same
  saved sheet data as the previous controls.
- Trait roll buttons, collapsible roll preparation, numerical result feedback,
  and keyboard-operable Play / Features / Equipment / Story tabs.
- An active-loadout search and expandable ability descriptions on Play, with
  the full card/vault and class/heritage management in Features.
- Focused damage and rest dialogs with operation feedback. Existing threshold,
  armor, rest, Experience, and Duality rules remain in the existing rules code.
- Destructive character actions are separate from the primary play controls.

## Game table

- Scene cards distinguish the scene being previewed from the active scene.
  Scenes can be searched, renamed, duplicated, activated, and deleted.
- Scene creation offers a new original vector battle map, Moonfall ruins, plus
  parchment and midnight canvases. Custom map uploads remain available.
- A miniature roster can search and filter party members, adversaries, and
  markers. Selecting a roster entry centers and zooms to its miniature.
- Party miniatures use class portraits and live sheet resources. Changing a
  linked miniature's current HP or Stress updates the underlying sheet; changing
  the sheet updates every miniature referencing that character. Maximum pools
  remain determined by character progression.
- New miniatures find a nearby unoccupied footprint, including larger bases.
- Miniatures have a selection dock with rotation, visibility, movement locking,
  editing, and duplication. On larger screens it also offers quick HP changes.
- Floating selection, hand, ruler, fog, and grid-alignment tools replace the
  long horizontal toolbar. Fog shape/undo controls appear only when relevant.
- Grid, snapping, range bands, zoom, and fit controls remain close to the canvas.
  Range bands start hidden to keep the map clear.
- Immersive view fills the browser workspace and exits with Escape. It does
  not change the browser's own fullscreen setting.
- The map canvas is keyboard focusable: arrows pan, Shift+arrow pans farther,
  plus/minus zoom, and Home fits the scene. Space still works normally on buttons.

Copies receive new scene, token, and fog identifiers and independent placement,
conditions, and fog data. A copied party miniature still represents the same
character, so its linked sheet resources intentionally remain shared.

## References

- [Official Daggerheart character sheets](https://www.daggerheart.com/downloads/)
  for the game's character information and resource organization.
- [Owlbear Rodeo](https://docs.owlbear.rodeo/docs/getting-started/) for a
  map-centered tabletop with accessible tools and responsive controls.
- [Alchemy's gamemaster orientation](https://help.alchemyrpg.com/en/articles/9714185-gamemaster-orientation)
  for scene previews, scene management, and deliberate activation.

These inform organization and interaction; no third-party interface or map art
was copied. The new SVG map is a local, editable asset in
`apps/web/public/maps/moonfall-ruins.svg`.

## Verification

Automated tests cover anchored pinch/pan behavior, zoom bounds, independent
scene copies (including fog), template sizing, non-overlapping placement,
modern/legacy sheet resource conversion, and bounded updates to linked sheets.

Browser checks use the separate local UI-preview account/campaign. They cover
resource synchronization in both directions, prepared trait rolls, keyboard
sheet tabs, armor-reduced damage, rest feedback, active-ability search, scene
creation/activation/duplication, roster selection, custom markers, dragging,
movement locking, rectangle fog and undo, immersive mode, keyboard zoom, and
Space activation of map tools. Layouts are checked at phone, tablet, desktop,
and a short landscape viewport, with both themes.

Run `npm run typecheck`, `npm test`, and `npm run build` at the project root.
Physical touch devices have not been tested. The existing large renderer/content
bundle warnings remain.

## Existing player limitation

The server still deliberately withholds map documents and campaign assets from
players. This pass improves the GM table and shared character-sheet experience;
it does not implement a secure player map projection or relax that restriction.

## Previews

- [Desktop character folio](ui-preview/folio-desktop.jpg)
- [Phone character folio](ui-preview/folio-phone.jpg)
- [Desktop game table](ui-preview/tabletop-desktop.jpg)
- [Phone game table](ui-preview/tabletop-phone.jpg)
