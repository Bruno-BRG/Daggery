# Storage conventions

Use the same layout for core content, Hope & Fear, Sablewood, and future supplements.
Separate read-only files shipped with a release from state written by a running server.
The server's canonical path definitions are in `apps/server/src/storage.ts`.

## Bundled content (read-only at runtime)

| Path | Purpose |
| --- | --- |
| `packages/content/*.json` | Core catalog and shared manifests |
| `packages/content/<supplement>/*.json` | Supplement catalog, merged by the content package |
| `packages/content/cards-index.json` | Card identifiers and paths relative to the art root |
| `packages/content/cards/<kind>/[<domain>/]<id>.webp` | Full-size card art and class portraits |
| `packages/content/cards/thumbs/<kind>/[<domain>/]<id>.webp` | Matching thumbnails |
| `sources/*.pdf` | Extraction inputs tracked through Git LFS; excluded from Docker |
| `sources/rules/<sourceId>.json` | Extracted sourcebook text, committed and included in Docker |
| `apps/web/dist/` | Generated web build, included in Docker but not committed |

All card art shares `/cards/<relative-file>` URLs regardless of sourcebook. Class portraits
use the `class` kind. Do not add supplement-specific HTTP roots or read art from `data/`.
Art uses stable filenames with ETags and immediate revalidation, not immutable caching.
Only the art tree is publicly served; the source PDFs and extracted rules are not static roots.

The extractors already write to these canonical locations:

- `tools/extract_cards.py`: core art, thumbnails, and card index.
- `tools/extract_hf_cards.py`: Hope & Fear art, thumbnails, and appended index entries.
- `tools/build_core_catalog.py`: core catalog and class portraits.
- `tools/extract_sources.py`: sourcebook JSON under `sources/rules/` by default.

Commit generated catalog, sourcebook JSON, art, and thumbnails together. Fresh clones and
production builds do not need to extract PDFs or copy art into a persistent volume.
Regenerate only when changing source content. Respect source-material licensing and repository visibility.

## Runtime state (writable, never bundled)

The root is `DAGGERY_DATA_DIR`, defaulting to repository `data/` in development and
`/app/data` in Docker. Mount the production volume only at this runtime root.

| Relative path | Purpose | Backup |
| --- | --- | --- |
| `daggery.db` | Accounts, campaigns, sessions | Required; use a consistent SQLite backup |
| `ai-keyring.key` | Saved-provider-key encryption, unless `DAGGERY_AI_SECRET` is supplied | Required; keep secret |
| `campaign-assets/` | User uploads, accessed through authorized routes | Required |
| `assets/` | Legacy uploads retained for migration | Preserve |
| `backups/` | Pre-migration backups | Preserve |
| `rules/*.json` | Optional local sourcebook additions/overrides | Preserve if used |
| `rules/*.vec` | Generated sourcebook embedding caches | Rebuildable |
| `models/` | Downloaded local embedding models | Rebuildable |
| `catalog-index.vec` | Generated catalog embedding cache | Rebuildable |

`DAGGERY_DB` may override the database path only; it does not relocate uploads, keys, or
caches. Back up that path separately if it is outside the runtime root. Sourcebook JSON
in runtime `rules/` deliberately overrides bundled text with the same source id;
`DAGGERY_REPO_RULES=off` disables bundled sourcebooks for isolated fixtures.

## Compatibility and checks

This convention does not rename existing runtime files or migrate/delete production data.
Old `data/cards/` folders are ignored, not copied or used as a fallback. Bundled paths are
module-relative and do not change with the shell's working directory or runtime root.

Server tests check path separation and serve every indexed card and class portrait, including
thumbnails, verifying WebP signatures, content types, cache revalidation, and missing-file 404s.
Web tests check that catalog and wizard lookups reference available art.

Run the checks with `npm test` and `npm run typecheck` at the repository root.
