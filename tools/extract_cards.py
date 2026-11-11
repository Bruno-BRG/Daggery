#!/usr/bin/env python3
"""Extract Daggerheart cards from the full-art card sheets PDF.

The core PDF (Daggerheart_Core_Full_Art_and_Printer_Friendly_Cards_-_9-09-25.pdf)
contains, after the rulebook, 30 full-art card sheets (PDF pages 368-397).  Each
sheet is a 3 x 3 grid of 2.5" x 3.5" cards:

    x = 36 + 180 * column      (points)
    y = 18 + 252 * row         (points)
    card = 180 x 252 points

Pages 368-388 hold the 189 domain cards (level label is printed on the sheet),
389-394 hold the 54 subclass cards (foundation / specialization / mastery),
395 holds the 9 community cards, 396-397 hold the 18 ancestry cards.  That is
the complete 270-card set.  Pages 398+ are the printer-friendly duplicates and
are intentionally ignored.

Card names are recovered from the PDF text layer; a card's domain and level are
looked up in the SRD appendix (sources/DH_SRD_2_2026_08_25.pdf), whose domain
card reference lists "<NAME>" followed by "Level N <Domain> <Type>".

Outputs:
    packages/content/cards/<kind>/[<domain>/]<slug>.webp      full art, quality 85
    packages/content/cards/thumbs/<kind>/[<domain>/]<slug>.webp   width 300 thumbnail
    packages/content/cards-index.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources"
CORE_PDF = SOURCES / "Daggerheart_Core_Full_Art_and_Printer_Friendly_Cards_-_9-09-25.pdf"
SRD_PDF = SOURCES / "DH_SRD_2_2026_08_25.pdf"
CARDS_DIR = ROOT / "packages" / "content" / "cards"
INDEX_PATH = ROOT / "packages" / "content" / "cards-index.json"

PAGE_SIZE = (612.0, 792.0)
CARD_W = 180.0
CARD_H = 252.0
COL_X0 = 36.0
ROW_Y0 = 18.0

DOMAIN_RE = re.compile(
    r"^Level\s+(\d+)\s+(Arcana|Blade|Bone|Codex|Grace|Midnight|Sage|Splendor|Valor)"
    r"\s+(Ability|Spell|Grimoire)$"
)

# PDF page (1-based) ranges of the full-art sheets.
DOMAIN_PAGES = range(368, 389)      # 21 sheets / 189 cards
SUBCLASS_PAGES = {
    389: "foundation", 390: "foundation",
    391: "specialization", 392: "specialization",
    393: "mastery", 394: "mastery",
}
COMMUNITY_PAGES = [395]
ANCESTRY_PAGES = [396, 397]

SMALL_WORDS = {
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
    "nor", "of", "on", "or", "the", "to", "with",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return re.sub(r"[^a-z0-9]", "", s.lower())


def smart_title(s: str) -> str:
    """Title-case a card name, keeping small words lowercase (except edges)."""
    for dash in ("‐", "‑", "‒", "–", "—"):
        s = s.replace(dash, "-")
    words = s.split()
    out = []
    for i, word in enumerate(words):
        parts = [p.capitalize() for p in word.split("-")]
        word = "-".join(parts)
        if 0 < i < len(words) - 1 and word.lower() in SMALL_WORDS:
            word = word.lower()
        out.append(word)
    return " ".join(out)


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = s.replace("'", "").replace("’", "")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)


def page_spans(page):
    spans = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"].strip()
                if text:
                    spans.append(
                        (span["bbox"][0], span["bbox"][1], span["size"], text)
                    )
    return spans


def cell_of(x: float, y: float) -> tuple[int, int]:
    col = 0 if x < 216 else (1 if x < 396 else 2)
    row = 0 if y < 270 else (1 if y < 522 else 2)
    return row, col


def cell_box(row: int, col: int):
    x0 = COL_X0 + CARD_W * col
    y0 = ROW_Y0 + CARD_H * row
    return (x0, y0, x0 + CARD_W, y0 + CARD_H)


def read_srd_domains() -> dict[str, tuple[str, str, int, str]]:
    """Return {normalized name: (raw name, domain, level, type)} from the SRD."""
    if not SRD_PDF.exists():
        raise SystemExit(f"SRD not found: {SRD_PDF}")
    doc = pymupdf.open(SRD_PDF)
    mapping: dict[str, tuple[str, str, int, str]] = {}
    for page in doc:
        spans = page_spans(page)
        for x, y, size, text in spans:
            m = DOMAIN_RE.match(text)
            if not m:
                continue
            # Card names are size-11 all-caps spans directly above the level line.
            best = None
            for xx, yy, ss, tt in spans:
                if abs(xx - x) > 15 or ss <= 10 or yy >= y or y - yy > 35:
                    continue
                if tt.upper() != tt or not any(ch.isalpha() for ch in tt):
                    continue
                if best is None or yy > best[0]:
                    best = (yy, tt)
            if best is None:
                continue
            raw = best[1]
            mapping[norm(raw)] = (raw, m.group(2), int(m.group(1)), m.group(3))
    doc.close()
    if len(mapping) != 189:
        raise SystemExit(
            f"SRD domain-card parse produced {len(mapping)} cards, expected 189"
        )
    return mapping


def collect_sheet_titles(doc, page_no: int, min_size: float, max_size: float):
    """Return {(row, col): title} for one full-art sheet."""
    page = doc[page_no - 1]
    found: dict[tuple[int, int], str] = {}
    for x, y, size, text in page_spans(page):
        if not (min_size <= size <= max_size):
            continue
        if x >= 560:  # vertical sheet label in the right margin
            continue
        if text.lower() in {"ability", "spell", "grimoire"}:
            continue
        if len(text) < 2:
            continue
        cell = cell_of(x, y)
        # Keep the first (the title is the only span of this size in a card).
        found.setdefault(cell, text)
    return found


def render_page(doc, page_no: int, dpi: int) -> Image.Image:
    page = doc[page_no - 1]
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def crop_card(image: Image.Image, box, dpi: float) -> Image.Image:
    scale = dpi / 72.0
    x0, y0, x1, y1 = box
    return image.crop(
        (
            round(x0 * scale),
            round(y0 * scale),
            round(x1 * scale),
            round(y1 * scale),
        )
    )


def save_webp(image: Image.Image, path: Path, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=quality, method=6)


def build_entries(doc, domain_map):
    entries = []

    # ---- domain cards -----------------------------------------------------
    for page_no in DOMAIN_PAGES:
        titles = collect_sheet_titles(doc, page_no, 7.5, 8.5)
        label = re.search(
            r"DOMAIN LEVEL (\d+)", doc[page_no - 1].get_text() or ""
        )
        sheet_level = int(label.group(1)) if label else None
        if len(titles) != 9:
            raise SystemExit(f"page {page_no}: found {len(titles)} domain titles")
        for (row, col), raw in sorted(titles.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            key = norm(raw)
            if key not in domain_map:
                raise SystemExit(f"page {page_no}: '{raw}' missing from SRD index")
            _, domain, level, _type = domain_map[key]
            if sheet_level is not None and level != sheet_level:
                raise SystemExit(
                    f"page {page_no}: '{raw}' mapped to level {level}, sheet says {sheet_level}"
                )
            name = smart_title(domain_map[key][0])
            entries.append(
                {
                    "name": name,
                    "kind": "domain",
                    "domain": domain.lower(),
                    "level": level,
                    "page": page_no,
                    "bbox": cell_box(row, col),
                    "file": f"domain/{domain.lower()}/{slugify(name)}.webp",
                }
            )

    # ---- subclass cards ---------------------------------------------------
    for page_no, tier in SUBCLASS_PAGES.items():
        titles = collect_sheet_titles(doc, page_no, 7.5, 8.5)
        if len(titles) != 9:
            raise SystemExit(f"page {page_no}: found {len(titles)} subclass titles")
        for (row, col), raw in sorted(titles.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            name = smart_title(raw)
            slug = f"{slugify(name)}-{tier}"
            entries.append(
                {
                    "name": name,
                    "kind": "subclass",
                    "page": page_no,
                    "bbox": cell_box(row, col),
                    "file": f"subclass/{slug}.webp",
                }
            )

    # ---- community cards --------------------------------------------------
    for page_no in COMMUNITY_PAGES:
        titles = collect_sheet_titles(doc, page_no, 12.0, 16.0)
        if len(titles) != 9:
            raise SystemExit(f"page {page_no}: found {len(titles)} community titles")
        for (row, col), raw in sorted(titles.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            name = smart_title(raw)
            entries.append(
                {
                    "name": name,
                    "kind": "community",
                    "page": page_no,
                    "bbox": cell_box(row, col),
                    "file": f"community/{slugify(name)}.webp",
                }
            )

    # ---- ancestry cards ---------------------------------------------------
    for page_no in ANCESTRY_PAGES:
        titles = collect_sheet_titles(doc, page_no, 12.0, 16.0)
        if len(titles) != 9:
            raise SystemExit(f"page {page_no}: found {len(titles)} ancestry titles")
        for (row, col), raw in sorted(titles.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            name = smart_title(raw)
            entries.append(
                {
                    "name": name,
                    "kind": "ancestry",
                    "page": page_no,
                    "bbox": cell_box(row, col),
                    "file": f"ancestry/{slugify(name)}.webp",
                }
            )

    # ids / uniqueness
    seen = set()
    for entry in entries:
        base = Path(entry["file"]).stem
        entry_id = base
        if entry_id in seen:
            raise SystemExit(f"duplicate id '{entry_id}'")
        seen.add(entry_id)
        entry["id"] = entry_id
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--quality", type=int, default=85)
    parser.add_argument("--thumb-width", type=int, default=300)
    parser.add_argument("--thumb-quality", type=int, default=80)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not CORE_PDF.exists():
        raise SystemExit(f"core PDF not found: {CORE_PDF}")

    domain_map = read_srd_domains()
    doc = pymupdf.open(CORE_PDF)
    if doc.page_count != 427:
        print(f"warning: expected 427 pages, got {doc.page_count}", file=sys.stderr)

    entries = build_entries(doc, domain_map)
    counts = {}
    for entry in entries:
        counts[entry["kind"]] = counts.get(entry["kind"], 0) + 1
    print("cards found:", counts, "total", len(entries))
    if len(entries) != 270:
        raise SystemExit(f"expected 270 cards, found {len(entries)}")
    if args.dry_run:
        doc.close()
        return 0

    CARDS_DIR.mkdir(parents=True, exist_ok=True)
    thumbs_dir = CARDS_DIR / "thumbs"

    # Render each source sheet once, crop its nine cells, save.
    by_page: dict[int, list[dict]] = {}
    for entry in entries:
        by_page.setdefault(entry["page"], []).append(entry)

    done = 0
    for page_no in sorted(by_page):
        image = render_page(doc, page_no, args.dpi)
        for entry in by_page[page_no]:
            crop = crop_card(image, entry["bbox"], args.dpi)
            out = CARDS_DIR / entry["file"]
            save_webp(crop, out, args.quality)
            thumb = crop.copy()
            width = args.thumb_width
            height = round(thumb.height * width / thumb.width)
            thumb = thumb.resize((width, height), Image.LANCZOS)
            save_webp(thumb, thumbs_dir / entry["file"], args.thumb_quality)
            done += 1
        print(f"page {page_no}: {len(by_page[page_no])} cards  [{done}/{len(entries)}]")
    doc.close()

    # Write the index, ordered by kind then name.
    kind_order = {"domain": 0, "subclass": 1, "community": 2, "ancestry": 3}
    entries.sort(
        key=lambda e: (kind_order.get(e["kind"], 9), e.get("domain", ""), e["name"])
    )
    payload = []
    for entry in entries:
        payload.append(
            {
                "id": entry["id"],
                "name": entry["name"],
                "kind": entry["kind"],
                **({"domain": entry["domain"]} if "domain" in entry else {}),
                **({"level": entry["level"]} if "level" in entry else {}),
                "file": entry["file"],
                "sourcePdf": CORE_PDF.name,
                "page": entry["page"],
                "bbox": [round(v, 2) for v in entry["bbox"]],
            }
        )
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"wrote {INDEX_PATH} ({len(payload)} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
