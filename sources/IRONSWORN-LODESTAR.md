# Ironsworn Lodestar

`Ironsworn-Lodestar-Digital.pdf` is the reference guide for the Ironsworn RPG
(Shawn Tomkin, updated June 9, 2019, <https://www.ironswornrpg.com>).

The PDF belongs in this folder next to the other source PDFs, which are Git LFS files
(`sources/*.pdf` in `.gitattributes`). Add it with `git lfs` from a machine that can reach
the LFS server. `tools/build_lodestar_oracles.py` reads it to rebuild the oracle tables.

**Licence.** The text is licensed under Creative Commons
Attribution-NonCommercial-ShareAlike 4.0 International
(<https://creativecommons.org/licenses/by-nc-sa/4.0/>). Ironsworn is © 2018 Shawn Tomkin.

What Daggery builds from it:

- The move list and the oracle tables in `packages/shared/src/lodestar-oracles.ts`, which
  `tools/build_lodestar_oracles.py` generates from this PDF.
- The move wording in `packages/shared/src/duality-variants.ts`, adapted to the Daggerheart
  Duality Dice. Names are the Ironsworn names on purpose, so the two games are easy to compare.
- The Duality GME manual, reference sheet and playkit in `docs/duality-solo-engine/`.

Because of the ShareAlike term, those adapted parts stay under CC BY-NC-SA 4.0 and must not
be sold. They say so in their credits. Daggery itself is a personal, non-commercial project.
