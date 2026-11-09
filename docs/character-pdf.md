# Editable character PDF

Open a character and select **PDF** in the toolbar. On phones, select **Character actions** (the three dots), then **Export editable PDF**.

Choose A4 or US Letter. The export includes current identity, traits, calculated defenses and thresholds, resource counts, Experiences, weapons, armor, and inventory. Features and domain cards, and background/connections/notes, are optional. Leave all fields blank to download an empty form using the same sections.

The layout follows the organization of the character-sheet reference under `sources/`, using a separate, printer-friendly Daggery layout. The reference PDF is not needed at runtime. Long entries continue on extra pages. Inventory and notes have spare space for later additions.

The downloaded PDF contains standard AcroForm text fields, with embedded Noto Sans and saved appearances. Open it in a PDF reader that supports forms, edit fields, and save a copy. These are document edits; they do not synchronize back to the campaign, and they do not recalculate other fields. Layout changes, such as moving or adding fields, require a PDF editor.

Generation happens in the browser. The PDF library and local font load when you select Download; exporting sends no character data to a third-party service.

Verification: web build and 47 tests, including editable save/reopen, field appearances, blank Letter output, safe filenames, and long-text pagination. Browser checks at 1440px and 320px cover the export dialog and a Letter download with story excluded. Independent checks with pypdf compare the canonical field tree with each page widget and its appearance. All sample A4 and Letter pages were rendered and inspected.
