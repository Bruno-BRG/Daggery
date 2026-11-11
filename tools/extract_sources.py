#!/usr/bin/env python3
"""Turn Daggerheart source PDFs (or an already extracted text) into rules JSON.

The server reads every JSON file under `sources/rules/` (committed, private repo)
and under `<DAGGERY_DATA_DIR>/rules/` (local, gitignored; wins on a duplicate id)
and indexes its pages for the AI GM's sourcebook tools (`search_sourcebook`,
`read_sourcebook_page`). The output format is:

    {
      "sourceId": "hope-and-fear-cards",
      "title": "Daggerheart Hope & Fear Print-and-Play Cards",
      "pdfPageCount": 7,
      "printedPageOffset": 1,             # optional
      "pages": [
        {"pdf": 1, "printed": null, "text": "..."},
        {"pdf": 2, "printed": 6, "text": "...", "ocr": true},
        {"pdf": 3, "printed": null, "text": "Map page; no machine-readable text.", "imageOnly": true},
        ...
      ]
    }

`printed` is the page number printed in the book. It is null when the page has no
printed number (front matter, card sheets). `printedPageOffset` follows the core
book convention: pdf_page = printed_page + offset, so printed = pdf - offset.

Text extraction
---------------
PDFs are extracted page by page with PyMuPDF (`--engine pymupdf`, column-aware,
default) or poppler (`--engine poppler`), or with plain MuPDF block order
(`--engine pymupdf-plain`) for card sheets. PyMuPDF also repairs the Hope & Fear
display-face digits and ligature glyphs that poppler silently drops.

Pages that carry no extractable text are rendered at `--ocr-dpi` (200 by default)
and passed through RapidOCR (`pip install rapidocr-onnxruntime`). Recognized text
is stored with `"ocr": true`. A page whose OCR result is essentially unusable
(pure map or illustration) is kept and marked `"imageOnly": true` with a short
generated label, so the page still appears in listings and can be cited.

Batch mode
----------
`--all` processes every PDF in `sources/` with a stable id, title and page offset
(see `SOURCES` below). Printed offsets for the core rulebook and the Hope & Fear
book are detected from the printed footers and cross-checked against the values
verified on their contents pages.

Examples
--------
    python tools/extract_sources.py --all
    python tools/extract_sources.py --all --no-ocr
    python tools/extract_sources.py "C:/Users/me/Downloads/Sablewood-05-20-25.pdf" \
        --id sablewood --title "Sablewood"
    python tools/extract_sources.py --raw-text data/extract/corebook_raw.txt \
        --metadata data/extract/corebook_pages.json \
        --id core-rulebook --title "Daggerheart Core Rulebook"

The default output folder is `sources/rules/`, which is committed (the repository
is private). `.vec` embedding caches never live there: the server keeps them under
the gitignored data directory.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCES = ROOT / "sources"
DEFAULT_OUT = ROOT / "sources" / "rules"
SOURCE_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
MIN_TEXT_CHARS = 40  # fewer alphanumeric characters than this and the page is OCR'd
MIN_OCR_CHARS = 24   # fewer recognizable characters than this and the page is image-only

# Every PDF shipped in sources/, with its stable id, citation title, text engine
# and the page-number evidence verified against the printed contents pages.
SOURCES: list[dict] = [
    {
        "file": "Daggerheart_Core_Full_Art_and_Printer_Friendly_Cards_-_9-09-25.pdf",
        "id": "core-rulebook",
        "title": "Daggerheart Core Rulebook",
        "engine": "pymupdf",
        # pdf 255 = printed 254 ("The Witherwild"); pdf 5 = printed 4 ("Introduction").
        "offset": 1,
        "front_matter": 4,   # cover, credits and contents are unnumbered
        "back_matter": 368,  # pdf 368-427 are unnumbered card sheets
        "label": "Core rulebook",
    },
    {
        "file": "Daggerheart_HF_Full_Art_and_Printer_Friendly_Cards_-_8-14-26.pdf",
        "id": "hope-and-fear-book",
        "title": "Daggerheart: Hope & Fear",
        "engine": "pymupdf",
        # pdf 5 = printed 4 ("Introduction"); pdf 8 = printed 7 (Chapter 1).
        "offset": 1,
        "front_matter": 4,
        "back_matter": 198,  # pdf 198-211 are unnumbered card sheets
        "label": "Book",
    },
    {
        "file": "Daggerheart-HF-Print-and-Play-Cards-08-14-2026.pdf",
        "id": "hope-and-fear-cards",
        "title": "Daggerheart Hope & Fear Print-and-Play Cards",
        "engine": "pymupdf-plain",
        "label": "Cards",
    },
    {
        "file": "AdditionalSheetsTile_HF_2026-08-25.pdf",
        "id": "hope-and-fear-sheets",
        "title": "Daggerheart Hope & Fear Additional Sheets",
        "engine": "pymupdf-plain",
        "label": "Sheets",
    },
    {
        "file": "CharacterGuidesAndSheetsTile_HF_2026-07-23.pdf",
        "id": "hope-and-fear-character-guides",
        "title": "Daggerheart Hope & Fear Character Guides and Sheets",
        "engine": "pymupdf",
        "label": "Guides",
    },
    {
        "file": "CampaignFrameMaterialsTile_HF_2026-07-23.pdf",
        "id": "hope-and-fear-campaign-frame",
        "title": "Daggerheart Hope & Fear Campaign Frame Materials",
        "engine": "pymupdf",
        "label": "Campaign frame",
    },
    {
        "file": "Sablewood-05-20-25.pdf",
        "id": "sablewood",
        "title": "Sablewood",
        "engine": "pymupdf",
        "label": "Supplement",
    },
    {
        "file": "Additional-Sheets-Daggerheart-Aug252026.pdf",
        "id": "additional-sheets-2026-08",
        "title": "Daggerheart Additional Sheets (August 2026)",
        "engine": "pymupdf-plain",
        "label": "Sheets",
    },
    {
        "file": "Campaign-Frame-Materials-Aug252026.pdf",
        "id": "campaign-frame-materials-2026-08",
        "title": "Daggerheart Campaign Frame Materials (August 2026)",
        "engine": "pymupdf",
        "label": "Campaign frame",
    },
    {
        "file": "Character-Sheets-and-Guides-Daggerheart-Aug252026.pdf",
        "id": "character-sheets-guides-2026-08",
        "title": "Daggerheart Character Sheets and Guides (August 2026)",
        "engine": "pymupdf",
        "label": "Guides",
    },
    {
        "file": "Daggerheart-Blank-Maps-May202025.pdf",
        "id": "blank-maps",
        "title": "Daggerheart Blank Maps",
        "engine": "pymupdf-plain",
        "label": "Map",
    },
]


def find_tool(name: str) -> str:
    """Locate pdftotext/pdfinfo on PATH, with the usual Windows/MSYS fallbacks."""
    candidates = [shutil.which(name), shutil.which(name + ".exe")]
    candidates += [
        f"/mingw64/bin/{name}",
        f"/mingw64/bin/{name}.exe",
        f"/usr/bin/{name}",
        f"/usr/local/bin/{name}",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit(
        f"{name} was not found. Install poppler-utils (pdftotext and pdfinfo) or add it to PATH."
    )


def pdf_page_count(pdf: Path) -> int:
    pdfinfo = find_tool("pdfinfo")
    result = subprocess.run(
        [pdfinfo, str(pdf)], capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        raise SystemExit(f"pdfinfo failed for {pdf}: {result.stderr.strip()}")
    match = re.search(r"^Pages:\s+(\d+)\s*$", result.stdout, re.MULTILINE)
    if not match:
        raise SystemExit(f"pdfinfo did not report a page count for {pdf}")
    return int(match.group(1))


def clean_text(text: str) -> str:
    text = text.replace("\x0c", "\n").replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def page_text(pdf: Path, page: int, pdftotext: str) -> str:
    result = subprocess.run(
        [
            pdftotext,
            "-layout",
            "-enc",
            "UTF-8",
            "-f",
            str(page),
            "-l",
            str(page),
            str(pdf),
            "-",
        ],
        capture_output=True,
    )
    if result.returncode != 0:
        error = result.stderr.decode("utf-8", errors="replace").strip()
        raise SystemExit(f"pdftotext failed on page {page} of {pdf}: {error}")
    text = result.stdout.decode("utf-8", errors="replace").replace("ﬁ", "fi").replace("ﬂ", "fl")
    return clean_text(normalize_ligatures(text))


_LIGATURE_GAP = re.compile(r"(fi|fl|ffi|ffl)\s{1,2}(?=[a-z])")

# Hope & Fear prints digits in a display face whose glyphs land in the private
# use area (e.g. "Tier 􏕁 Skulk"). Map them back to ordinary numerals.
_PUA_DIGITS = {
    0xE53F: "0",
    0xE541: "1",
    0xE542: "2",
    0xE543: "3",
    0xE544: "4",
    0xE545: "5",
    0xE546: "6",
    0xE547: "7",
    0xE548: "8",
    0xE549: "9",
}


def normalize_ligatures(text: str) -> str:
    """Rejoin words split after a ligature glyph (MuPDF emits 'fi rst')."""
    text = unicodedata.normalize("NFKC", text).translate(_PUA_DIGITS)
    return _LIGATURE_GAP.sub(r"\1", text)


def _block_text(block) -> str:
    return normalize_ligatures(block[4]).strip("\n")


def pymupdf_text(doc, page: int) -> str:
    """Read one page with PyMuPDF, column-aware.

    MuPDF's plain text order interleaves the two columns of a stat-block page,
    so blocks are grouped into the left and right column and emitted one column
    at a time. Full-width blocks above or below the columns (chapter intros,
    table rows, footers) keep their place.
    """
    pdf_page = doc[page - 1]
    width = pdf_page.rect.width
    middle = width / 2
    blocks = []
    for block in pdf_page.get_text("blocks"):
        if block[6] != 0:
            continue
        text = _block_text(block)
        if not text:
            continue
        blocks.append((block[0], block[1], block[2], block[3], text))
    if not blocks:
        return ""

    wide = [b for b in blocks if b[2] - b[0] > width * 0.6]
    narrow = [b for b in blocks if b not in wide]
    left = [b for b in narrow if (b[0] + b[2]) / 2 < middle]
    right = [b for b in narrow if (b[0] + b[2]) / 2 >= middle]

    def stream(group):
        return "\n".join(b[4] for b in sorted(group, key=lambda b: (b[1], b[0])))

    if left and right:
        # Full-width blocks (tables, chapter banners) separate the two-column regions.
        # Every full-width block is emitted in place instead of being dropped, and the
        # narrow blocks above each one are emitted left column then right column.
        parts = []
        remaining_left, remaining_right = list(left), list(right)
        for wide_block in sorted(wide, key=lambda b: (b[1], b[0])):
            top = wide_block[1]
            above_left = [b for b in remaining_left if (b[1] + b[3]) / 2 < top]
            above_right = [b for b in remaining_right if (b[1] + b[3]) / 2 < top]
            remaining_left = [b for b in remaining_left if b not in above_left]
            remaining_right = [b for b in remaining_right if b not in above_right]
            for part in (stream(above_left), stream(above_right), wide_block[4]):
                if part.strip():
                    parts.append(part)
        for part in (stream(remaining_left), stream(remaining_right)):
            if part.strip():
                parts.append(part)
    else:
        parts = [stream(blocks)]
    return clean_text("\n\n".join(part for part in parts if part.strip()))


def pymupdf_plain_text(doc, page: int) -> str:
    """MuPDF block order without column grouping. Used for card sheets and maps."""
    return clean_text(normalize_ligatures(doc[page - 1].get_text("text")))


class Ocr:
    """Lazy RapidOCR wrapper. Failure disables OCR for the rest of the run."""

    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled
        self.engine = None
        self.failed = False

    def _load(self):
        if self.engine is not None or self.failed:
            return self.engine
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError as error:
            self.failed = True
            print(
                "OCR is unavailable (pip install rapidocr-onnxruntime); image-only pages "
                f"will be marked with a label: {error}",
                file=sys.stderr,
            )
            return None
        self.engine = RapidOCR()
        return self.engine

    def read(self, doc, page: int, dpi: int) -> str:
        if not self.enabled:
            return ""
        engine = self._load()
        if engine is None:
            return ""
        try:
            import numpy as np
        except ImportError:
            self.failed = True
            print("OCR is unavailable (pip install numpy)", file=sys.stderr)
            return ""
        pix = doc[page - 1].get_pixmap(dpi=dpi)
        array = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            array = array[:, :, :3]
        # RapidOCR (through OpenCV) expects BGR.
        array = array[:, :, ::-1]
        result, _ = engine(array)
        if not result:
            return ""
        lines = []
        for row in result:
            if len(row) < 2:
                continue
            text = str(row[1]).strip()
            score = float(row[2]) if len(row) > 2 else 1.0
            if text and score >= 0.35:
                lines.append(text)
        return clean_text(normalize_ligatures("\n".join(lines)))


def alnum_count(text: str) -> int:
    return sum(1 for char in text if char.isalnum())


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9]+", unicodedata.normalize("NFKD", text)))


def image_only_label(source: dict, pdf_page: int) -> str:
    if "map" in source["id"] or "map" in source["title"].lower():
        return f"Map page (PDF p. {pdf_page}); no machine-readable text."
    return f"Illustration page (PDF p. {pdf_page}); no machine-readable text."


def printed_number(
    pdf_page: int, offset: int | None, front_matter: int, back_matter: int | None
) -> int | None:
    if offset is None or pdf_page <= front_matter or (back_matter and pdf_page >= back_matter):
        return None
    printed = pdf_page - offset
    return printed if printed >= 1 else None


def detect_offset(
    texts: list[str], front_matter: int, back_matter: int | None
) -> tuple[int | None, Counter]:
    """Infer `pdf - printed` from page footers/headers, for cross-checking a book."""
    diffs: Counter = Counter()
    for pdf_page, text in enumerate(texts, 1):
        if pdf_page <= front_matter or (back_matter and pdf_page >= back_matter):
            continue
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if not lines:
            continue
        # Printed folios are either standalone numbers or trailing/leading numbers in
        # the running header/footer, which can sit one or two lines in from the edge.
        for line in set(lines[:3] + lines[-3:]):
            if re.fullmatch(r"\d{1,3}", line):
                value = int(line)
                diff = pdf_page - value
                if 0 <= diff <= 5:
                    diffs[diff] += 1
                continue
            start = re.match(r"^(\d{1,3})\b", line)
            end = re.search(r"\b(\d{1,3})$", line)
            for match in (start, end):
                if not match:
                    continue
                value = int(match.group(1))
                if 1 <= value <= 999:
                    diff = pdf_page - value
                    if 0 <= diff <= 5:
                        diffs[diff] += 1
    return (diffs.most_common(1)[0][0] if diffs else None), diffs


def build_page(source: dict, pdf_page: int, text: str, offset: int | None) -> dict:
    printed = printed_number(
        pdf_page, offset, source.get("front_matter", 0), source.get("back_matter")
    )
    return {"pdf": pdf_page, "printed": printed, "text": text}


def extract_pages(pdf: Path, page_count: int, engine: str, ocr: Ocr, dpi: int, source: dict) -> list[dict]:
    """Extract every page. Returns page records with `ocr` / `imageOnly` flags."""
    doc = None
    pdftotext = None
    if engine in ("pymupdf", "pymupdf-plain"):
        try:
            import pymupdf
        except ImportError as error:  # pragma: no cover - environment dependent
            raise SystemExit("PyMuPDF is required (pip install pymupdf)") from error
        doc = pymupdf.open(pdf)
    else:
        pdftotext = find_tool("pdftotext")

    texts: list[str] = []
    flags: list[dict] = []
    try:
        for page in range(1, page_count + 1):
            if engine == "pymupdf":
                text = pymupdf_text(doc, page)
            elif engine == "pymupdf-plain":
                text = pymupdf_plain_text(doc, page)
            else:
                text = page_text(pdf, page, pdftotext)
            flag: dict = {}
            if alnum_count(text) < MIN_TEXT_CHARS and doc is not None:
                recognized = ocr.read(doc, page, dpi)
                if recognized:
                    flag["ocr"] = True
                    text = recognized
            if alnum_count(text) < MIN_OCR_CHARS or word_count(text) < 4:
                flag["imageOnly"] = True
                text = image_only_label(source, page)
            texts.append(text)
            flags.append(flag)
            if page % 25 == 0 or page == page_count:
                print(f"  page {page}/{page_count}", file=sys.stderr)
    finally:
        if doc is not None:
            doc.close()

    # The printed offset is detected from the extracted footers and checked against
    # the value verified on the contents page. A mismatch is reported, never hidden.
    always_none = source.get("offset") is None
    if not always_none:
        front = source.get("front_matter", 0)
        back = source.get("back_matter")
        detected, diffs = detect_offset(texts, front, back)
        expected = source["offset"]
        if detected is not None and detected != expected:
            print(
                f"  WARNING: detected printed offset {detected} ({dict(diffs.most_common(4))}) "
                f"differs from the verified offset {expected}; using {expected}.",
                file=sys.stderr,
            )
        elif detected is not None:
            print(f"  printed offset verified: {detected}", file=sys.stderr)

    pages = []
    for index, (text, flag) in enumerate(zip(texts, flags), 1):
        record = build_page(source, index, text, source.get("offset"))
        record.update(flag)
        pages.append(record)
    return pages


def extract_raw_text(
    raw: Path, page_count: int, offset: int | None, front_matter: int, back_matter: int | None
) -> list[dict]:
    text = raw.read_text(encoding="utf-8", errors="replace")
    parts = text.split("\f")
    if parts and parts[-1].strip() == "":
        parts.pop()
    if len(parts) != page_count:
        raise SystemExit(
            f"{raw} has {len(parts)} form-feed pages but the expected page count is {page_count}. "
            "Pass --page-count to override, or re-extract the PDF with pdftotext."
        )
    source = {"offset": offset, "front_matter": front_matter, "back_matter": back_matter}
    return [
        build_page(source, index + 1, clean_text(part), offset) for index, part in enumerate(parts)
    ]


def load_metadata(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not read metadata {path}: {error}") from error


def write_source(source: dict, pages: list[dict], out: Path) -> dict:
    payload: dict = {
        "sourceId": source["id"],
        "title": source["title"],
        "label": source.get("label", "Source"),
        "pdfPageCount": len(pages),
    }
    if source.get("offset") is not None:
        payload["printedPageOffset"] = source["offset"]
    payload["pages"] = pages

    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{source['id']}.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    characters = sum(len(page["text"]) for page in pages)
    ocr_pages = sum(1 for page in pages if page.get("ocr"))
    image_only = sum(1 for page in pages if page.get("imageOnly"))
    empty = sum(1 for page in pages if not page["text"].strip())
    print(
        f"Wrote {target} ({len(pages)} pages, {characters:,} characters, "
        f"{ocr_pages} OCR, {image_only} image-only, {empty} empty)",
        file=sys.stderr,
    )
    return {
        "id": source["id"],
        "pages": len(pages),
        "characters": characters,
        "ocr": ocr_pages,
        "imageOnly": image_only,
    }


def run_all(args, ocr: Ocr) -> None:
    sources_dir: Path = args.sources
    if not sources_dir.is_dir():
        raise SystemExit(f"Sources folder not found: {sources_dir}")
    known = {entry["file"]: entry for entry in SOURCES}
    discovered = sorted(path.name for path in sources_dir.glob("*.pdf"))
    unknown = [name for name in discovered if name not in known]
    if unknown:
        print(f"Ignoring unrecognized PDFs: {', '.join(unknown)}", file=sys.stderr)

    summaries = []
    for name in discovered:
        entry = known.get(name)
        if not entry:
            continue
        pdf = sources_dir / name
        page_count = pdf_page_count(pdf)
        engine = args.engine if args.engine else entry.get("engine", "pymupdf")
        print(f"Extracting {name} -> {entry['id']} ({page_count} pages, engine {engine})", file=sys.stderr)
        pages = extract_pages(pdf, page_count, engine, ocr, args.ocr_dpi, entry)
        summaries.append(write_source(entry, pages, args.out))

    print("\nSummary", file=sys.stderr)
    for row in summaries:
        print(
            f"  {row['id']:<34} {row['pages']:>4} pages  {row['characters']:>9,} chars  "
            f"OCR {row['ocr']:>3}  image-only {row['imageOnly']:>3}",
            file=sys.stderr,
        )
    total = sum(row["characters"] for row in summaries)
    print(f"  total {total:,} characters across {len(summaries)} sources", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract Daggerheart sources into sources/rules/<id>.json."
    )
    parser.add_argument("pdf", nargs="?", type=Path, help="source PDF (omit with --raw-text or --all)")
    parser.add_argument("--all", action="store_true", help="extract every known PDF in --sources")
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES, help=f"PDF folder for --all (default: {DEFAULT_SOURCES})")
    parser.add_argument("--raw-text", type=Path, help="already extracted text with form-feed page breaks")
    parser.add_argument("--metadata", type=Path, help="existing extraction metadata (page count, offset, front matter)")
    parser.add_argument("--id", dest="source_id", help="source ID, lowercase letters, digits and dashes")
    parser.add_argument("--title", help="title shown in citations")
    parser.add_argument("--label", help="short source-type label (Book, Cards, Sheets, Map, ...)")
    parser.add_argument("--printed-offset", type=int, help="printed = pdf - offset")
    parser.add_argument("--front-matter", type=int, default=0, help="pages up to and including this PDF page are unnumbered")
    parser.add_argument("--back-matter", type=int, help="PDF pages from this page on are unnumbered (card sheets, maps)")
    parser.add_argument("--page-count", type=int, help="override the page count (raw text mode)")
    parser.add_argument(
        "--engine",
        choices=("poppler", "pymupdf", "pymupdf-plain"),
        help="PDF text engine; defaults to the per-source choice under --all, poppler otherwise",
    )
    parser.add_argument("--ocr", dest="ocr", action="store_true", default=True, help="OCR pages without text (default)")
    parser.add_argument("--no-ocr", dest="ocr", action="store_false", help="skip OCR and label image-only pages")
    parser.add_argument("--ocr-dpi", type=int, default=200, help="render resolution for OCR (default: 200)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output folder (default: {DEFAULT_OUT})")
    args = parser.parse_args()

    ocr = Ocr(args.ocr)

    if args.all:
        if args.pdf or args.raw_text:
            parser.error("--all cannot be combined with a PDF path or --raw-text")
        run_all(args, ocr)
        return

    if bool(args.pdf) == bool(args.raw_text):
        parser.error("give exactly one source: a PDF path, --raw-text or --all")
    if not args.source_id or not SOURCE_ID.match(args.source_id):
        parser.error("--id must be lowercase letters, digits and dashes, starting with a letter or digit")
    if not args.title:
        parser.error("--title is required")

    metadata = load_metadata(args.metadata) if args.metadata else {}
    page_count = args.page_count or metadata.get("pdfPageCount")
    offset = args.printed_offset if args.printed_offset is not None else metadata.get("printedPageOffset")
    front_matter = args.front_matter or (metadata.get("frontMatter") or {}).get("pdfEnd", 0) or 0
    back_matter = args.back_matter
    engine = args.engine or "poppler"

    source = {
        "id": args.source_id,
        "title": args.title,
        "label": args.label or "Source",
        "offset": offset,
        "front_matter": front_matter,
        "back_matter": back_matter,
    }

    if args.raw_text:
        raw = args.raw_text
        if not raw.exists():
            raise SystemExit(f"Raw text not found: {raw}")
        if not page_count:
            raise SystemExit("Raw text mode needs --page-count or --metadata with pdfPageCount")
        print(f"Reading {raw} ({page_count} pages)", file=sys.stderr)
        pages = extract_raw_text(raw, page_count, offset, front_matter, back_matter)
    else:
        pdf = args.pdf
        assert pdf is not None
        if not pdf.exists():
            raise SystemExit(f"PDF not found: {pdf}")
        page_count = page_count or pdf_page_count(pdf)
        print(f"Extracting {pdf} ({page_count} pages, engine {engine})", file=sys.stderr)
        pages = extract_pages(pdf, page_count, engine, ocr, args.ocr_dpi, source)

    write_source(source, pages, args.out)


if __name__ == "__main__":
    main()
