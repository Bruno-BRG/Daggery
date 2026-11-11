#!/usr/bin/env python3
"""Extract Hope & Fear full-art cards into the same art pipeline as the core set.

The Hope & Fear book prints 63 full-art cards on PDF pages 198-204 (the
printer-friendly duplicates on 205-211 are ignored):

    198-200  the 21 Dread domain cards
    200-202  the 8 subclasses x Foundation / Specialization / Mastery
    203      six ancestry cards and three community cards
    204      the other three community cards and six transformation cards

Like the core sheets, each page is a 3 x 3 grid of 2.5" x 3.5" cards:

    x = 36 + 180 * column      (points)
    y = 18 + 252 * row         (points)

The four class portraits are cropped from the lower-right illustration panel of
the second page of each class spread.

Outputs (shipped with the code, next to the core card art):
    packages/content/cards/<kind>/<slug>.webp
    packages/content/cards/thumbs/<kind>/<slug>.webp
    packages/content/cards-index.json (appended entries, sourcePdf set)

Run:  python tools/extract_hf_cards.py [--pdf path]
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "packages" / "content"
CARDS = CONTENT / "cards"
INDEX = CONTENT / "cards-index.json"
DEFAULT_PDF = ROOT / "sources" / "Daggerheart_HF_Full_Art_and_Printer_Friendly_Cards_-_8-14-26.pdf"
PDF_NAME = "Daggerheart_HF_Full_Art_and_Printer_Friendly_Cards_-_8-14-26.pdf"

CARD_PAGES = range(198, 205)
CARD_W = 180.0
CARD_H = 252.0
COL_X0 = 36.0
ROW_Y0 = 18.0

CLASS_PAGES = {"assassin": 10, "brawler": 12, "warlock": 16, "witch": 18}
CLASS_CLIP = (305.0, 372.0, 605.0, 700.0)

SMALL_WORDS = {
    "a", "an", "and", "as", "at", "but", "by", "de", "for", "from", "in",
    "into", "nor", "o", "of", "on", "or", "the", "to", "with",
}


def norm(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", value.lower())


def slug(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = value.lower().replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")


def title_case(value: str) -> str:
    words = value.replace("’", "'").split()
    out = []
    for index, word in enumerate(words):
        pieces = []
        for piece in word.split("-"):
            bare = piece.strip("'").lower()
            if bare in SMALL_WORDS and (index > 0 or len(word.split("-")) > 1):
                pieces.append(piece.lower())
            else:
                pieces.append(piece[:1].upper() + piece[1:].lower())
        out.append("-".join(pieces))
    return " ".join(out).replace("'S", "'s")


def load(name: str):
    return json.loads((CONTENT / f"{name}.json").read_text(encoding="utf-8"))


def cell_box(row: int, column: int) -> pymupdf.Rect:
    x0 = COL_X0 + CARD_W * column
    y0 = ROW_Y0 + CARD_H * row
    return pymupdf.Rect(x0, y0, x0 + CARD_W, y0 + CARD_H)


def cell_spans(page, rect: pymupdf.Rect):
    spans = []
    for block in page.get_text("dict", clip=rect)["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                if span["text"].strip():
                    spans.append(span)
    return spans


def card_title(spans) -> str | None:
    candidates = [
        span for span in spans
        if span["font"].startswith("Eveleth")
        and 7.0 <= span["size"] <= 16.5
        and not span["text"].strip().isdigit()
    ]
    if not candidates:
        return None
    title = max(candidates, key=lambda span: (span["size"], len(span["text"].strip())))
    return title["text"].strip()


def rendered_crop(page, rect: pymupdf.Rect, dpi: int) -> Image.Image:
    pix = page.get_pixmap(matrix=pymupdf.Matrix(dpi / 72, dpi / 72), clip=rect, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def save_webp(image: Image.Image, path: Path, quality: int, thumb_width: int | None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=quality, method=6)
    if thumb_width:
        thumb = image.copy()
        thumb.thumbnail((thumb_width, thumb_width), Image.LANCZOS)
        save_webp(thumb, CARDS / "thumbs" / path.relative_to(CARDS), quality, None)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--quality", type=int, default=85)
    parser.add_argument("--thumb-width", type=int, default=300)
    args = parser.parse_args()
    if not args.pdf.exists():
        raise SystemExit(f"Hope & Fear PDF not found: {args.pdf}")

    domain_cards = load("domain-cards")
    classes = load("classes")
    ancestries = load("ancestries")
    communities = load("communities")
    transformations = load("transformations")

    by_name: dict[str, tuple[str, dict]] = {}
    for record in domain_cards:
        by_name[norm(record["name"])] = ("domain", record)
    for record in ancestries:
        by_name[norm(record["name"])] = ("ancestry", record)
    for record in communities:
        by_name[norm(record["name"])] = ("community", record)
    for record in transformations:
        by_name[norm(record["name"])] = ("transformation", record)

    subclasses = {}
    for cls in classes:
        for subclass in cls["subclasses"]:
            subclasses[norm(subclass["name"])] = subclass

    doc = pymupdf.open(args.pdf)
    entries: list[dict] = []
    for page_no in CARD_PAGES:
        page = doc[page_no - 1]
        for row in range(3):
            for column in range(3):
                rect = cell_box(row, column)
                spans = cell_spans(page, rect)
                if not spans:
                    continue
                title = card_title(spans)
                if not title:
                    continue
                part = next(
                    (value.lower() for value in ("Foundation", "Specialization", "Mastery")
                     if any(span["text"].strip() == value for span in spans)),
                    None,
                )
                key = norm(title)
                if part and key in subclasses:
                    subclass = subclasses[key]
                    entry_id = f"{subclass['id']}-{part}"
                    kind = "subclass"
                    name = title_case(subclass["name"])
                    file = f"subclass/{entry_id}.webp"
                elif key in by_name:
                    kind, record = by_name[key]
                    entry_id = record["id"]
                    name = title_case(record["name"])
                    if kind == "domain":
                        file = f"domain/dread/{entry_id}.webp"
                    else:
                        file = f"{kind}/{entry_id}.webp"
                else:
                    raise SystemExit(f"page {page_no} cell {row},{column}: unmatched card {title!r}")
                image = rendered_crop(page, rect, args.dpi)
                save_webp(image, CARDS / file, args.quality, args.thumb_width)
                entry = {
                    "id": entry_id,
                    "name": name,
                    "kind": kind,
                    "file": file,
                    "sourcePdf": PDF_NAME,
                    "page": page_no,
                    "bbox": [round(value, 2) for value in rect],
                }
                if kind == "domain":
                    entry["domain"] = "dread"
                    entry["level"] = record["level"]
                entries.append(entry)

    for class_id, page_no in CLASS_PAGES.items():
        rect = pymupdf.Rect(*CLASS_CLIP)
        image = rendered_crop(doc[page_no - 1], rect, args.dpi)
        save_webp(image, CARDS / "class" / f"{class_id}.webp", args.quality, args.thumb_width)

    doc.close()

    if len(entries) != 63:
        raise SystemExit(f"expected 63 Hope & Fear cards, found {len(entries)}")

    existing = json.loads(INDEX.read_text(encoding="utf-8"))
    kept = [entry for entry in existing if entry.get("sourcePdf") != PDF_NAME]
    kind_order = {"domain": 0, "subclass": 1, "community": 2, "ancestry": 3, "transformation": 4}
    entries.sort(key=lambda entry: (kind_order.get(entry["kind"], 9), entry.get("domain", ""), entry["name"]))
    kept.extend(entries)
    INDEX.write_text(json.dumps(kept, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    counts: dict[str, int] = {}
    for entry in entries:
        counts[entry["kind"]] = counts.get(entry["kind"], 0) + 1
    print(f"wrote {len(entries)} cards {counts} and 4 class portraits; index now {len(kept)} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
