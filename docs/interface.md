# Responsive interface

The interface keeps the existing React 19 and Tailwind 4 stack. Shared icons,
semantic theme colors, native modal dialogs, and CSS container queries supply
the new interface without another component framework.

## Design references

- [Owlbear Rodeo](https://docs.owlbear.rodeo/docs/getting-started/): a map-centered tabletop with controls that adapt to mobile and desktop.
- [shadcn/ui Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar) and [Sheet](https://ui.shadcn.com/docs/components/radix/sheet): grouped navigation, compact rails, and temporary panels. These are pattern references; shadcn is not installed.
- [web.dev touch targets](https://web.dev/articles/accessible-tap-targets): use pointer capability to enlarge controls for touch, including large tablets.

## Layout

| Available width | Navigation and panels |
| --- | --- |
| Below 768px | Labeled bottom navigation; More opens all sections and profile settings. |
| 768–1199px | Compact sidebar with accessible labels, tooltips, and profile access. |
| 1200px and above | Full grouped sidebar and a campaign switcher. Map scenes are docked. |
| 1440px and above | Collapsible dice sidebar on pages other than the map. |
| 1600px and above | Map scene/token settings are also docked. |

Dice, map scenes, and map settings use modal drawers when they are not docked.
Native dialogs supply focus trapping, Escape dismissal, and focus restoration.
Quick navigation is available through the sidebar or Ctrl/Cmd+K.

Compendium, combat, notes, and character sheet columns respond to their own
available pane width. Opening a sidebar therefore cannot force a desktop
layout into a narrow pane. The map observes its actual container and refits
when its dimensions change.

## Touch and accessibility

- Pinch to zoom and use two fingers to pan the map; drag tokens with one finger.
- Starting a pinch cancels an in-progress fog gesture or hold-to-ping timer.
- Touch controls are enlarged using `pointer: coarse`; mobile inputs use a
  readable size to avoid automatic browser zoom.
- Bottom navigation respects the device safe area; the shell uses dynamic
  viewport height and independently scrolling content.
- Keyboard focus, a skip link, reduced motion, and both color themes are supported.
- The 3D dice overlay stays mounted when the controls close, so sheet and combat
  rolls remain available. A drawer roll closes the drawer to show the 3D result.

## Verification

Browser checks used a separate local QA account and campaign, without changing
existing campaign content. Checked widths include 320px and 390px phones,
834px tablet, and 1536px/1920px desktop. Checks covered navigation, quick search,
compendium search/detail, map setup and settings drawers, dice rolls and history,
notes, campaign switching, and the complete eight-step character wizard.

Run `npm run typecheck`, `npm test`, and `npm run build` from the project root.
Map camera tests cover anchored pinch zoom, two-finger panning, zoom limits,
and coincident touch points. Physical touch devices have not been tested.

The build still reports large chunks for the game renderer/content. Bundle
splitting and renderer loading are separate performance work.

## Previews

- [Desktop](ui-preview/desktop.jpg)
- [Tablet](ui-preview/tablet.jpg)
- [Phone](ui-preview/phone.jpg)
