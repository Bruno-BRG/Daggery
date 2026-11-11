#!/usr/bin/env python3
"""Parse Daggerheart: Hope & Fear into packages/content JSON.

The full Hope & Fear book (``Daggerheart_HF_Full_Art_and_Printer_Friendly_Cards``)
is the primary source for every Hope & Fear entry:

  * classes, subclasses, class features, questions and connections (pp. 7-17)
  * ancestries (pp. 18-25), communities (pp. 26-33), transformations (pp. 34-42)
  * the 21 Dread domain cards (Appendix reference, pp. 180-181)
  * primary/secondary weapons (pp. 43-51), armor (52-53)
  * items (54-56), consumables (57-60)
  * adversaries (61-98) and environments (98-114)

The print-and-play PDFs used by the earlier version of this script are no longer
needed for Hope & Fear. Only Sablewood still comes from its own PDF, and its
parsing is unchanged.

The book's stat blocks print their numerals in a display font whose glyphs land
in the private-use area; PyMuPDF is used throughout because poppler silently
drops those numerals. Ligatures ("fi rst", "o cials") are repaired as well.

Run:  python tools/parse_hope_fear.py [--pdf-dir C:/Users/you/Downloads]
"""

from __future__ import annotations

import argparse
import dataclasses
import difflib
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "packages" / "content"
HF_DIR = CONTENT / "hope-and-fear"
SW_DIR = CONTENT / "sablewood"

PDF_NAMES = {
    "book": "Daggerheart_HF_Full_Art_and_Printer_Friendly_Cards_-_8-14-26.pdf",
    "sablewood": "Sablewood-05-20-25.pdf",
}
PDFTOTEXT = shutil.which("pdftotext") or r"C:\Program Files\Git\mingw64\bin\pdftotext.exe"

PAGE_WIDTH = 612.0

SHARED_TRAITS = {"Agility", "Strength", "Finesse", "Instinct", "Presence", "Knowledge"}
RANGES = {"Melee", "Very Close", "Close", "Far", "Very Far"}
ADVERSARY_TYPES = {"Bruiser", "Horde", "Leader", "Minion", "Ranged", "Skulk", "Social", "Solo", "Standard", "Support"}
ENVIRONMENT_TYPES = {"Exploration", "Social", "Traversal", "Event"}

# Numerals in the book's display face.
PUA_DIGITS = {
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
LIGATURE_GAP = re.compile(r"(fi|fl|ffi|ffl)\s{1,2}(?=[a-z])")


# ---------------------------------------------------------------------------
# text helpers


# The book's "ff" ligature maps to "ff " in the text layer. These are the
# places where that space splits a real word; "off or" and "staff member" are
# genuine word boundaries and are left alone.
LIGATURE_WORD_FIX = re.compile(
    r"(?:eff|aff|diff) ect(?:ed|ing|s|ion|ions|ive|ively)?"
    r"|suff er(?:ed|ing|s)?"
    r"|diff er(?:ent|ently|ence|ences|ing|ed|s)?"
    r"|\boff er(?:ing|s|ed)?"
    r"|\boff end(?:ed|ing|s)?"
    r"|\bquaff s"
    r"|\bpuff s",
    re.IGNORECASE,
)


def fix_ligature_word(match: re.Match) -> str:
    broken = match.group(0)
    fixed = broken.replace(" ", "")
    return fixed[:1].upper() + fixed[1:] if broken[:1].isupper() else fixed


def tidy(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\u00ad", "")
    text = text.translate(PUA_DIGITS)
    text = LIGATURE_GAP.sub(r"\1", text)
    text = LIGATURE_WORD_FIX.sub(fix_ligature_word, text)
    text = text.replace("off -limits", "off-limits")
    return re.sub(r"\s+", " ", text).strip()


def slug(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = value.lower().replace("'", "").replace("\u2019", "")
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")


def norm_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", value.lower())


def smart_title(value: str) -> str:
    small = {
        "a", "an", "and", "as", "at", "but", "by", "for", "from", "in",
        "de", "into", "nor", "o", "of", "on", "or", "the", "to", "with",
    }
    # The book prints names in caps; keep internal apostrophes and dashes.
    words = value.replace("\u2019", "'").split()
    out: list[str] = []
    for index, word in enumerate(words):
        pieces = word.split("-")
        titled: list[str] = []
        for piece in pieces:
            bare = piece.strip("'").lower()
            if bare in small and (index > 0 or len(pieces) > 1):
                titled.append(piece.lower())
            else:
                titled.append(piece[:1].upper() + piece[1:].lower())
        word = "-".join(titled)
        if 0 < index < len(words) - 1 and word.lower() in small:
            word = word.lower()
        out.append(word)
    return " ".join(out).replace("'S", "'s")


def split_damage(value: str) -> tuple[str, str]:
    match = re.fullmatch(
        r"([0-9d+\-\u2212\u2013\u2014]+)\s+((?:direct )?(?:phy/mag|phy|mag))", tidy(value)
    )
    if not match:
        raise ValueError(f"cannot parse damage: {value!r}")
    return match.group(1), match.group(2)


def parse_bonus(value: str) -> int:
    return int(value.replace("\u2212", "-").replace("\u2013", "-").replace("\u2014", "-").replace("+", ""))


# ---------------------------------------------------------------------------
# PDF lines


@dataclasses.dataclass(frozen=True)
class Line:
    text: str
    fonts: frozenset[str]
    x0: float
    y0: float
    x1: float
    y1: float
    size: float

    @property
    def center(self) -> float:
        return (self.y0 + self.y1) / 2


class Book:
    def __init__(self, path: Path):
        self.doc = pymupdf.open(path)
        self.path = path
        self.cache: dict[int, list[Line]] = {}

    def close(self) -> None:
        self.doc.close()

    def lines(self, printed: int) -> list[Line]:
        """Lines of the page whose printed number is ``printed``."""
        return self.page_lines(printed + 1)

    def page_lines(self, pdf_page: int) -> list[Line]:
        if pdf_page in self.cache:
            return self.cache[pdf_page]
        page = self.doc[pdf_page - 1]
        result: list[Line] = []
        for block in page.get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                spans = line["spans"]
                text = tidy("".join(span["text"] for span in spans))
                if not text:
                    continue
                visible = [span for span in spans if span["text"].strip()]
                result.append(
                    Line(
                        text=text,
                        fonts=frozenset(span["font"] for span in visible),
                        x0=line["bbox"][0],
                        y0=line["bbox"][1],
                        x1=line["bbox"][2],
                        y1=line["bbox"][3],
                        size=max(round(span["size"], 1) for span in visible),
                    )
                )
        self.cache[pdf_page] = result
        return result

    def stream(self, printed: int) -> list[Line]:
        """Page lines in column reading order (left column, then right)."""
        return column_stream(self.lines(printed))

    def blocks(self, printed: int):
        page = self.doc[printed]
        for block in page.get_text("blocks"):
            if block[6] != 0:
                continue
            text = unicodedata.normalize("NFKC", block[4]).replace("­", "")
            text = text.translate(PUA_DIGITS)
            text = LIGATURE_GAP.sub(r"\1", text)
            text = "\n".join(line.strip() for line in text.splitlines()).strip()
            if text:
                yield (block[0], block[1], block[2], block[3], text)


def column_stream(lines: list[Line]) -> list[Line]:
    if not lines:
        return []
    wide = [line for line in lines if line.x1 - line.x0 > PAGE_WIDTH * 0.6]
    narrow = [line for line in lines if line not in wide]
    left = [line for line in narrow if (line.x0 + line.x1) / 2 < PAGE_WIDTH / 2]
    right = [line for line in narrow if (line.x0 + line.x1) / 2 >= PAGE_WIDTH / 2]
    if not (left and right):
        return sorted(lines, key=lambda line: (line.y0, line.x0))
    top_y = min(line.y0 for line in left + right)
    bottom_y = max(line.y1 for line in left + right)
    above = [line for line in wide if line.y1 <= top_y]
    below = [line for line in wide if line.y0 >= bottom_y]

    def ordered(group: list[Line]) -> list[Line]:
        return sorted(group, key=lambda line: (line.y0, line.x0))

    return ordered(above) + ordered(left) + ordered(right) + ordered(below)


def is_art(line: Line) -> bool:
    return any(font.startswith("EllisHand") for font in line.fonts)


def is_footer(line: Line) -> bool:
    return (
        ("EvelethCleanRegular" in line.fonts and line.text.isdigit())
        or line.text.startswith("Chapter ")
        or line.text.startswith("Campaign Frame")
    )


def body_lines(lines: list[Line], *, include_italic: bool = True) -> list[Line]:
    result = []
    for line in lines:
        if is_art(line) or is_footer(line):
            continue
        fonts = " ".join(line.fonts)
        if (
            any(font.startswith("Questa") for font in line.fonts)
            or "EvelethCleanThin" in fonts
            or "Overpass-Regular" in line.fonts
        ):
            # Plain italic body lines carry community personality paragraphs;
            # callers that only want the running prose can filter later.
            if include_italic or "Italic" not in fonts or "Bold" in fonts:
                result.append(line)
    return result


# ---------------------------------------------------------------------------
# classes


CLASS_PAGES = {
    "assassin": ("Assassin", (8, 9)),
    "brawler": ("Brawler", (10, 11)),
    "warlock": ("Warlock", (14, 15)),
    "witch": ("Witch", (16, 17)),
}

SECTION_LABELS = {
    "DOMAINS", "STARTING EVASION", "STARTING HIT POINTS", "CLASS ITEMS",
    "CLASS FEATURES", "BACKGROUND QUESTIONS", "CONNECTIONS",
}
SUBCLASS_SECTION = re.compile(r"^(FOUNDATION|SPECIALIZATION|MASTERY) FEATURES?$")
FEATURE_COLON = re.compile(r"^([A-Z][^:]{1,80}):\s*(.*)$")
FEATURE_BULLET = re.compile(r"^[\u2022\u00b7]\s*(.*)$")


def join_lines(lines: list[Line]) -> str:
    return tidy(" ".join(line.text for line in lines))


def is_bold_heading(line: Line) -> bool:
    """A sidebar heading, not body text that merely contains a bold word."""
    return (
        any("Bold" in font for font in line.fonts)
        and not any(font.startswith("QuestaSans-Light") for font in line.fonts)
    )


def collect_colon_features(lines: list[Line]) -> list[dict]:
    tables = {start: (end, rows) for start, end, rows in class_tables(lines)}
    features: list[dict] = []
    current: dict | None = None
    index = 0
    while index < len(lines):
        if index in tables:
            end, rows = tables[index]
            if current:
                current["text"] = tidy(current["text"] + " " + " ".join(rows))
            index = end
            continue
        line = lines[index]
        index += 1
        text = line.text.strip()
        if not text:
            continue
        if text.startswith("\u2022") or text.startswith("\u00b7"):
            if current:
                current["text"] = tidy(current["text"] + " " + FEATURE_BULLET.match(text).group(1))
            continue
        match = FEATURE_COLON.match(text)
        if match and not text.isupper():
            if current:
                features.append(current)
            current = {"name": match.group(1).strip(), "text": match.group(2).strip()}
        elif current:
            current["text"] = tidy(current["text"] + " " + text)
    if current:
        features.append(current)
    return features


SENTENCE_STARTS = {
    "A", "After", "An", "At", "Choose", "Each", "If", "In", "It", "Make",
    "Mark", "On", "Once", "Roll", "Spend", "The", "Their", "This", "When",
    "While", "You", "Your", "Effect",
}


def class_tables(lines: list[Line]) -> list[tuple[int, int, list[str]]]:
    """Collapse the small Roll/Effect tables inside class features.

    The book sets these tables in two columns; reading order interleaves the
    cells ("1 Spend a Hope ... New"). Reconstruct them as readable rows.
    """
    tables: list[tuple[int, int, list[str]]] = []
    index = 0
    while index < len(lines):
        header = lines[index]
        if header.text.replace(" ", "") not in {"Roll", "RollPhase"}:
            index += 1
            continue
        effect = next(
            (line for line in lines if abs(line.y0 - header.y0) < 5 and "Effect" in line.text),
            None,
        )
        if effect is None:
            index += 1
            continue
        effect_x = effect.x0 - 4
        table_lines = [
            line for line in lines
            if header.y0 < line.y0 < header.y0 + 120 and (line.x0 < effect_x or line.y0 > header.y0)
        ]
        anchor_ys = sorted(
            {
                round(line.y0)
                for line in table_lines
                if line.x0 < effect_x
                and re.fullmatch(r"\d+(?:\s*[–\-]\s*\d+)?[A-Za-z]*", line.text)
            }
        )
        if not anchor_ys:
            index += 1
            continue
        last_y = max(anchor_ys)
        rows: list[str] = []
        for anchor in anchor_ys:
            left_lines = [
                line for line in table_lines
                if line.x0 < effect_x and abs(line.y0 - anchor) < 5
            ]
            right_lines = [
                line for line in table_lines
                if line.x0 >= effect_x and abs(line.y0 - anchor) < 8
            ]
            left = join_lines(sorted(left_lines, key=lambda line: line.x0))
            right = join_lines(sorted(right_lines, key=lambda line: (line.y0, line.x0)))
            left = re.sub(r"(\d)\s*([A-Z][a-z])", r"\1 \2", left)
            if left and right:
                rows.append(f"{left}: {right}")
        if rows:
            end = index + 1
            while end < len(lines) and lines[end].y0 <= last_y + 8:
                end += 1
            tables.append((index, end, rows))
            index = end
        else:
            index += 1
    return tables


def parse_class_features(lines: list[Line]) -> list[dict]:
    """Class-level features have their name on its own line (no colon)."""
    tables = {start: (end, rows) for start, end, rows in class_tables(lines)}
    features: list[dict] = []
    current: dict | None = None
    index = 0
    while index < len(lines):
        if index in tables:
            end, rows = tables[index]
            if current:
                current["text"] = tidy(current["text"] + " " + " ".join(rows))
            index = end
            continue
        line = lines[index]
        index += 1
        text = line.text.strip()
        if not text:
            continue
        if text in {"Roll", "Effect"} or text.startswith("\u2022"):
            if current:
                current["text"] = tidy(current["text"] + " " + text)
            continue
        first = re.split(r"\s+", text)[0]
        is_heading = (
            len(text) <= 42
            and not text.endswith((".", "!", "?", ","))
            and text[0].isupper()
            and first not in SENTENCE_STARTS
            and not text.startswith("Choose ")
        )
        if is_heading:
            if current:
                features.append(current)
            current = {"name": text, "text": ""}
        elif current:
            current["text"] = tidy(current["text"] + " " + text)
    if current:
        features.append(current)
    return features


def parse_bullet_questions(lines: list[Line], label: str, stop_prefixes: tuple[str, ...]) -> list[str]:
    result: list[str] = []
    current: list[str] | None = None
    started = False
    for line in lines:
        text = line.text.strip()
        if text == label:
            started = True
            continue
        if not started:
            continue
        if any(text.startswith(prefix) for prefix in stop_prefixes):
            break
        if text.startswith("\u2022") or text.startswith("\u00b7"):
            if current is not None:
                result.append(tidy(" ".join(current)))
            current = [FEATURE_BULLET.match(text).group(1).strip()]
        elif current is not None:
            current.append(text)
    if current is not None:
        result.append(tidy(" ".join(current)))
    return [question for question in result if question]


def parse_classes(book: Book) -> list[dict]:
    classes: list[dict] = []
    for class_id, (name, pages) in CLASS_PAGES.items():
        lines: list[Line] = []
        for printed in pages:
            lines.extend(body_lines(book.stream(printed)))
        texts = [line.text for line in lines]

        heading = next(
            index for index, text in enumerate(texts) if text == name.upper()
        )
        domains_index = texts.index("DOMAINS", heading)
        description = join_lines(lines[heading + 1:domains_index])
        domains_text = join_lines(lines[domains_index + 1:domains_index + 2])
        domains = [part.strip().lower() for part in re.split(r"\s+and\s+", domains_text, maxsplit=1)]

        def value_after(label: str) -> str:
            index = next(i for i, text in enumerate(texts) if text.startswith(label) and i > heading)
            following = []
            for line in lines[index + 1:]:
                if line.text in SECTION_LABELS or line.text.endswith("HOPE FEATURE") or line.text == "CLASS FEATURES":
                    break
                following.append(line)
            return join_lines(following)

        evasion_text = value_after("STARTING EVASION")
        evasion = int(re.search(r"\d+", evasion_text).group(0))
        hp_text = value_after("STARTING HIT POINTS")
        starting_hp = int(re.search(r"\d+", hp_text).group(0))
        class_items = value_after("CLASS ITEMS")

        hope_label = next(i for i, text in enumerate(texts) if text.endswith("HOPE FEATURE"))
        hope_parts = []
        for line in lines[hope_label + 1:]:
            if line.text == "CLASS FEATURES":
                break
            hope_parts.append(line)
        hope_text = join_lines(hope_parts)
        hope_name, _, hope_body = hope_text.partition(":")
        if not hope_body:
            raise ValueError(f"no hope feature body for {name}")

        features_label = texts.index("CLASS FEATURES", heading)
        subclass_label = min(
            i for i, text in enumerate(texts)
            if i + 1 < len(texts) and text.isupper() and texts[i + 1].startswith("Play the ")
        )
        choose_index = next(
            (i for i in range(features_label + 1, subclass_label) if texts[i].startswith("Choose either")),
            subclass_label,
        )
        class_features = parse_class_features(lines[features_label + 1:choose_index])

        # Subclasses: a heading followed by "Play the ...".
        subclass_heads = [
            i for i, text in enumerate(texts)
            if text.isupper()
            and len(text) > 3
            and i + 1 < len(texts)
            and texts[i + 1].startswith("Play the ")
        ]
        subclasses: list[dict] = []
        for position, head in enumerate(subclass_heads):
            stop = subclass_heads[position + 1] if position + 1 < len(subclass_heads) else len(lines)
            chunk = lines[head:stop]
            chunk_texts = [line.text for line in chunk]
            if "SPHERE OF INFLUENCE EXAMPLES" in chunk_texts:
                cutoff = chunk_texts.index("SPHERE OF INFLUENCE EXAMPLES")
                chunk = chunk[:cutoff]
                chunk_texts = chunk_texts[:cutoff]
            description_end = next(
                (
                    i for i, text in enumerate(chunk_texts)
                    if text == "SPELLCAST TRAIT" or SUBCLASS_SECTION.match(text)
                ),
                len(chunk),
            )
            subclass_name = smart_title(chunk_texts[0])
            subclass_description = join_lines(chunk[1:description_end])
            spellcast = None
            if "SPELLCAST TRAIT" in chunk_texts:
                trait_index = chunk_texts.index("SPELLCAST TRAIT")
                if trait_index + 1 < len(chunk_texts):
                    spellcast = smart_title(chunk_texts[trait_index + 1])

            def section(label_regex: str) -> list[Line]:
                start = next(
                    (i for i, text in enumerate(chunk_texts) if re.fullmatch(label_regex, text)),
                    None,
                )
                if start is None:
                    return []
                end = next(
                    (
                        i for i in range(start + 1, len(chunk_texts))
                        if SUBCLASS_SECTION.match(chunk_texts[i])
                        or chunk_texts[i] in {"BACKGROUND QUESTIONS", "CONNECTIONS", "SPHERE OF INFLUENCE EXAMPLES"}
                    ),
                    len(chunk_texts),
                )
                return chunk[start + 1:end]

            subclasses.append(
                {
                    "id": slug(subclass_name),
                    "name": subclass_name,
                    "description": subclass_description,
                    "spellcastTrait": spellcast,
                    "foundation": collect_colon_features(section(r"FOUNDATION FEATURES?")),
                    "specialization": collect_colon_features(section(r"SPECIALIZATION FEATURES?")),
                    "mastery": collect_colon_features(section(r"MASTERY FEATURES?")),
                }
            )

        questions = parse_bullet_questions(lines, "BACKGROUND QUESTIONS", ("CONNECTIONS",))
        connections = parse_bullet_questions(lines, "CONNECTIONS", ())
        classes.append(
            {
                "id": class_id,
                "name": name,
                "description": description,
                "domains": domains,
                "startingEvasion": evasion,
                "startingHP": starting_hp,
                "classItems": class_items,
                "hopeFeature": {"name": hope_name.strip(), "text": tidy(hope_body)},
                "classFeatures": class_features,
                "subclasses": subclasses,
                "backgroundQuestions": questions,
                "connections": connections,
                "source": "hope-and-fear",
                "art": False,
            }
        )
    if len(classes) != 4:
        raise ValueError(f"expected 4 Hope & Fear classes, found {len(classes)}")
    return classes


# ---------------------------------------------------------------------------
# ancestries, communities, transformations


ANCESTRIES = [
    ("Aetheris", 19),
    ("Earthkin", 21),
    ("Emberkin", 22),
    ("Skykin", 23),
    ("Tidekin", 24),
    ("Gnome", 25),
]
COMMUNITIES = [
    ("Duneborne", 27),
    ("Freeborne", 28),
    ("Frostborne", 29),
    ("Hearthborne", 30),
    ("Reborne", 31),
    ("Warborne", 32),
]
TRANSFORMATIONS = [
    ("Demigod", 35),
    ("Ghost", 36),
    ("Reanimated", 37),
    ("Shapeshifter", 38),
    ("Vampire", 39),
    ("Werewolf", 40),
]


def parse_description(lines: list[Line], heading: str, stop_labels: set[str]) -> str:
    start = next(i for i, line in enumerate(lines) if line.text == heading.upper())
    collected: list[Line] = []
    for line in lines[start + 1:]:
        if line.text in stop_labels:
            break
        if is_art(line) or is_footer(line):
            continue
        if is_bold_heading(line):
            # Sidebar heading such as "Angels in the Hallows Above".
            break
        collected.append(line)
    return join_lines(collected)


def parse_feature_block(lines: list[Line], label: str) -> list[dict]:
    start = next(i for i, line in enumerate(lines) if line.text == label)
    block: list[Line] = []
    started = False
    for line in lines[start + 1:]:
        if is_art(line) or is_footer(line) or line.text.startswith("Chapter "):
            continue
        if line.text in {"TRANSFORMATION QUESTIONS", "TRANSFORMATION", "QUESTIONS"}:
            break
        if started and is_bold_heading(line):
            # A sidebar (for example Reborne's "When to Choose...").
            break
        if FEATURE_COLON.match(line.text) and not line.text.isupper():
            started = True
        block.append(line)
    return collect_colon_features(block)


def parse_questions(lines: list[Line], label: str) -> list[str]:
    start = next(
        (
            i for i, line in enumerate(lines)
            if line.text in {label, "TRANSFORMATION", "QUESTIONS"}
        ),
        None,
    )
    if start is None:
        return []
    result: list[str] = []
    current: list[str] | None = None
    for line in lines[start + 1:]:
        if is_art(line) or is_footer(line):
            continue
        text = line.text.strip()
        if text.startswith("•") or text.startswith("·"):
            if current is not None:
                result.append(tidy(" ".join(current)))
            current = [FEATURE_BULLET.match(text).group(1).strip()]
        elif current is not None:
            current.append(text)
    if current is not None:
        result.append(tidy(" ".join(current)))
    return [question for question in result if question]


def parse_ancestries(book: Book) -> list[dict]:
    records = []
    for name, printed in ANCESTRIES:
        lines = book.stream(printed)
        description = parse_description(lines, name, {"ANCESTRY FEATURES"})
        features = parse_feature_block(lines, "ANCESTRY FEATURES")
        if len(features) != 2:
            raise ValueError(f"expected 2 features for {name}, found {[f['name'] for f in features]}")
        records.append(
            {
                "id": slug(name),
                "name": name,
                "description": description,
                "features": features,
                "source": "hope-and-fear",
            }
        )
    if len(records) != 6:
        raise ValueError(f"expected 6 ancestries, found {len(records)}")
    return records


def parse_communities(book: Book) -> list[dict]:
    records = []
    for name, printed in COMMUNITIES:
        lines = book.stream(printed)
        description = parse_description(lines, name, {"COMMUNITY FEATURE"})
        features = parse_feature_block(lines, "COMMUNITY FEATURE")
        if not features:
            raise ValueError(f"no community feature for {name}")
        records.append(
            {
                "id": slug(name),
                "name": name,
                "description": description,
                "features": features,
                "source": "hope-and-fear",
            }
        )
    if len(records) != 6:
        raise ValueError(f"expected 6 communities, found {len(records)}")
    return records


def parse_transformations(book: Book) -> list[dict]:
    records = []
    for name, printed in TRANSFORMATIONS:
        lines = book.stream(printed)
        description = parse_description(lines, name, {"TRANSFORMATION FEATURES"})
        features = parse_feature_block(lines, "TRANSFORMATION FEATURES")
        questions = parse_questions(lines, "TRANSFORMATION QUESTIONS")
        if not features:
            raise ValueError(f"no transformation features for {name}")
        records.append(
            {
                "id": slug(name),
                "name": name,
                "description": description,
                "features": features,
                "questions": questions,
                "source": "hope-and-fear",
            }
        )
    if len(records) != 6:
        raise ValueError(f"expected 6 transformations, found {len(records)}")
    return records


# ---------------------------------------------------------------------------
# domain cards (Appendix reference, printed 180-181)


CARD_HEADER = re.compile(
    r"^(.+?)\nLevel (\d+) Dread (Spell|Ability)\nRecall Cost: (\d+)$", re.DOTALL
)


def parse_domain_cards(book: Book) -> list[dict]:
    cards: list[dict] = []
    for printed in (180, 181):
        blocks = list(book.blocks(printed))
        # Three reference columns: x ~68, ~234, ~399.
        columns: dict[int, list[tuple[float, float, float, float, str]]] = {0: [], 1: [], 2: []}
        for x0, y0, x1, y1, text in blocks:
            if y0 > 750 or x0 < 50:
                continue
            column = 0 if x0 < 200 else (1 if x0 < 360 else 2)
            columns[column].append((y0, y1, x0, x1, text))

        for column in (0, 1, 2):
            items = sorted(columns[column], key=lambda item: item[0])
            current: dict | None = None
            for _, _, _, _, text in items:
                match = CARD_HEADER.match(text)
                if match:
                    if current:
                        cards.append(current)
                    name = tidy(match.group(1).replace("\n", " ")).upper()
                    current = {
                        "id": slug(name),
                        "name": name,
                        "domain": "dread",
                        "level": int(match.group(2)),
                        "type": match.group(3),
                        "recallCost": int(match.group(4)),
                        "text": "",
                    }
                elif current is not None:
                    current["text"] = tidy(current["text"] + " " + text)
            if current:
                cards.append(current)
    for card in cards:
        card["text"] = tidy(card["text"])
        card["source"] = "hope-and-fear"
    if len(cards) != 21:
        raise ValueError(f"expected 21 Dread domain cards, found {len(cards)}")
    cards.sort(key=lambda card: (card["level"], card["name"]))
    return cards


def parse_dread_domain() -> list[dict]:
    return [
        {
            "id": "dread",
            "name": "Dread",
            "description": (
                "Dread is the domain of nightmares and fear. Those who choose this path can call "
                "forth monstrosities, enfeeble their foes, and channel terrifying magic to destroy "
                "their enemies. Dread grants its adherents power over forces most are too afraid to "
                "employ. The Dread domain can be accessed by the Warlock and Witch classes."
            ),
            "classes": ["warlock", "witch"],
            "source": "hope-and-fear",
        }
    ]


# ---------------------------------------------------------------------------
# equipment tables


def table_header(lines: list[Line], labels: tuple[str, ...]) -> tuple[float, dict[str, float]] | None:
    """Find a header row containing all labels; return its y and x positions."""
    for line in lines:
        if line.text not in labels:
            continue
        y = line.y0
        found: dict[str, float] = {}
        for other in lines:
            if abs(other.y0 - y) < 4 and other.text in labels:
                found[other.text] = other.x0
        if all(label in found for label in labels):
            return y, found
    return None


def column_for(x: float, positions: list[tuple[str, float]], fallback: str) -> str:
    result = fallback
    for label, left in positions:
        if x >= left - 6:
            result = label
    return result


def assign_rows(
    lines: list[Line], anchors: list[float], columns: list[tuple[str, float]], fallback: str
) -> dict[int, dict[str, list[Line]]]:
    rows: dict[int, dict[str, list[Line]]] = {
        index: {name: [] for name, _ in columns} for index in range(len(anchors))
    }
    for line in lines:
        if not anchors:
            continue
        row = min(range(len(anchors)), key=lambda i: abs(anchors[i] - line.center))
        column = column_for(line.x0, columns, fallback)
        rows[row][column].append(line)
    for row in rows.values():
        for column in row:
            row[column].sort(key=lambda line: (line.y0, line.x0))
    return rows


TABLE_NOISE = re.compile(
    r"^(?:TIER \d|Physical Weapons|Magic Weapons|All magic weapons require|Name$|Trait$|Range$|Damage$|Burden$|Feature$)"
)


def table_noise(line: Line) -> bool:
    return bool(TABLE_NOISE.match(line.text))


def feature_text(lines: list[Line]) -> dict | None:
    text = join_lines(lines)
    if not text or text in {"\u2014", "--", "-"}:
        return None
    match = FEATURE_COLON.match(text)
    if not match:
        return {"name": "", "text": text}
    return {"name": match.group(1).strip(), "text": match.group(2).strip()}


WEAPON_PAGES = {
    43: ("Primary", 1),
    44: ("Primary", 2),
    45: ("Primary", 2),
    46: ("Primary", 3),
    47: ("Primary", 3),
    48: ("Primary", 4),
    49: ("Primary", 4),
    50: ("Secondary", None),
    51: ("Secondary", None),
}
ARMOR_PAGES = {52: None, 53: None}


def parse_weapon_table(
    book: Book, printed: int, category: str, page_tier: int | None
) -> list[dict]:
    lines = [line for line in book.page_lines(printed + 1) if not is_footer(line) and not is_art(line)]
    headers = []
    labels = ("Name", "Trait", "Range", "Damage", "Burden", "Feature")
    y = 0.0
    while True:
        found = table_header([line for line in lines if line.y0 >= y], labels)
        if not found:
            break
        headers.append(found)
        y = found[0] + 5

    weapons: list[dict] = []
    for index, (header_y, positions) in enumerate(headers):
        end_y = headers[index + 1][0] - 5 if index + 1 < len(headers) else 745
        table_lines = [line for line in lines if header_y + 5 <= line.y0 < end_y and not table_noise(line)]
        # Tier printed just above the header, if any.
        tier = page_tier
        for line in lines:
            match = re.match(r"TIER (\d+)", line.text)
            if match and line.y0 < header_y and header_y - line.y0 < 160:
                tier = int(match.group(1))
        if tier is None:
            raise ValueError(f"no tier for weapon table on printed page {printed}")

        columns = [
            ("Name", positions["Name"]),
            ("Trait", positions["Trait"]),
            ("Range", positions["Range"]),
            ("Damage", positions["Damage"]),
            ("Burden", positions["Burden"]),
            ("Feature", positions["Feature"]),
        ]
        anchors = sorted(
            line.center
            for line in table_lines
            if column_for(line.x0, columns, "Name") == "Trait"
            and line.text in SHARED_TRAITS
        )
        if not anchors:
            continue
        rows = assign_rows(table_lines, anchors, columns, "Feature")
        for row in rows.values():
            name = join_lines(row["Name"])
            trait = join_lines(row["Trait"])
            range_value = join_lines(row["Range"])
            damage_value = join_lines(row["Damage"])
            burden = join_lines(row["Burden"])
            if not name:
                continue
            if not (trait and range_value and damage_value and burden):
                raise ValueError(
                    f"incomplete weapon row on printed page {printed}: "
                    f"{name!r} {trait!r} {range_value!r} {damage_value!r} {burden!r}"
                )
            damage, damage_type = split_damage(damage_value)
            weapons.append(
                {
                    "id": slug(name),
                    "name": smart_title(name),
                    "category": category,
                    "tier": tier,
                    "trait": trait,
                    "range": range_value,
                    "damage": damage,
                    "damageType": damage_type,
                    "burden": burden,
                    "feature": feature_text(row["Feature"]),
                    "source": "hope-and-fear",
                }
            )
    return weapons


def parse_armor_table(book: Book, printed: int) -> list[dict]:
    lines = [line for line in book.page_lines(printed + 1) if not is_footer(line) and not is_art(line)]
    labels = ("Name", "Base", "Thresholds", "Score", "Feature")
    headers = []
    y = 0.0
    while True:
        # "Base" appears twice (Thresholds and Score); the header search only
        # needs one of each label, so look for "Name" plus "Thresholds" first.
        found = table_header([line for line in lines if line.y0 >= y], ("Name", "Thresholds", "Feature"))
        if not found:
            break
        header_y, positions = found
        for line in lines:
            if abs(line.y0 - header_y) < 4 and line.text in {"Name", "Thresholds", "Score", "Feature"}:
                positions[line.text] = line.x0
        headers.append((header_y, positions))
        y = header_y + 5

    armor: list[dict] = []
    for index, (header_y, positions) in enumerate(headers):
        end_y = headers[index + 1][0] - 5 if index + 1 < len(headers) else 745
        table_lines = [line for line in lines if header_y + 5 <= line.y0 < end_y and not table_noise(line)]
        tier = None
        for line in lines:
            match = re.match(r"TIER (\d+)", line.text)
            if match and line.y0 < header_y and header_y - line.y0 < 260:
                tier = int(match.group(1))
        if tier is None:
            raise ValueError(f"no tier for armor table on printed page {printed}")

        columns = [
            ("Name", positions["Name"]),
            ("Thresholds", positions["Thresholds"]),
            ("Score", positions["Score"]),
            ("Feature", positions["Feature"]),
        ]
        anchors = sorted(
            line.center
            for line in table_lines
            if column_for(line.x0, columns, "Name") == "Thresholds"
            and re.fullmatch(r"\d+\s*/\s*\d+", line.text)
        )
        rows = assign_rows(table_lines, anchors, columns, "Feature")
        for row in rows.values():
            name = join_lines(row["Name"])
            threshold_text = join_lines(row["Thresholds"])
            score_text = join_lines(row["Score"])
            if not name:
                continue
            threshold_match = re.search(r"(\d+)\s*/\s*(\d+)", threshold_text)
            if not threshold_match or not re.search(r"\d+", score_text):
                raise ValueError(f"incomplete armor row on printed page {printed}: {name!r} {threshold_text!r} {score_text!r}")
            armor.append(
                {
                    "id": slug(name),
                    "name": smart_title(name),
                    "tier": tier,
                    "baseThresholds": {
                        "major": int(threshold_match.group(1)),
                        "severe": int(threshold_match.group(2)),
                    },
                    "baseScore": int(re.search(r"\d+", score_text).group(0)),
                    "feature": feature_text(row["Feature"]),
                    "source": "hope-and-fear",
                }
            )
    return armor


def parse_equipment(book: Book) -> dict:
    weapons: list[dict] = []
    for printed in sorted(WEAPON_PAGES):
        category, tier = WEAPON_PAGES[printed]
        weapons.extend(parse_weapon_table(book, printed, category, tier))
    armor: list[dict] = []
    for printed in sorted(ARMOR_PAGES):
        armor.extend(parse_armor_table(book, printed))

    if len(weapons) != 120:
        raise ValueError(f"expected 120 Hope & Fear weapons, found {len(weapons)}")
    if len(armor) != 35:
        raise ValueError(f"expected 35 Hope & Fear armor entries, found {len(armor)}")
    return {"weapons": weapons, "armor": armor}


# ---------------------------------------------------------------------------
# loot tables (items and consumables)


LOOT_PAGES = {
    "items": (54, 55, 56),
    "consumables": (57, 58, 59),
}


def parse_loot_rows(book: Book, kind: str) -> list[tuple[int, str, str]]:
    """Return (roll, name, description) in printed roll order."""
    rows_found: list[tuple[int, str, str]] = []
    for printed in LOOT_PAGES[kind]:
        lines = [line for line in book.page_lines(printed + 1) if not is_art(line) and not is_footer(line)]
        header = table_header(lines, ("ROLL", "Loot", "description"))
        if not header:
            continue
        header_y, positions = header
        table_lines = [line for line in lines if line.y0 >= header_y + 4 and line.y0 < 750]
        columns = [
            ("Roll", positions["ROLL"]),
            ("Name", positions["Loot"]),
            ("Description", positions["description"]),
        ]
        roll_lines = sorted(
            (
                line
                for line in table_lines
                if column_for(line.x0, columns, "Name") == "Roll" and re.fullmatch(r"\d+", line.text)
            ),
            key=lambda line: line.center,
        )
        rows = assign_rows(table_lines, [line.center for line in roll_lines], columns, "Description")
        for roll_line, row in zip(roll_lines, rows.values()):
            number = int(roll_line.text)
            name = join_lines(row["Name"])
            if not name:
                raise ValueError(f"missing {kind} name for roll {number}")
            rows_found.append((number, smart_title(name), join_lines(row["Description"])))
    rows_found.sort(key=lambda item: item[0])
    return rows_found


def parse_items(book: Book) -> list[dict]:
    records = [
        {
            "id": slug(name),
            "name": name,
            "description": description,
            "feature": None,
            "source": "hope-and-fear",
        }
        for _, name, description in parse_loot_rows(book, "items")
    ]
    if len(records) != 60:
        raise ValueError(f"expected 60 items, found {len(records)}")
    return records


def parse_consumables(book: Book) -> list[dict]:
    records = [
        {
            "id": slug(name),
            "name": name,
            "description": description,
            "rollTable": {"name": "Additional Consumables", "roll": number},
            "source": "hope-and-fear",
        }
        for number, name, description in parse_loot_rows(book, "consumables")
    ]
    if len(records) != 60:
        raise ValueError(f"expected 60 consumables, found {len(records)}")
    return records


# ---------------------------------------------------------------------------
# adversaries


TIER_LINE = re.compile(
    r"^Tier (\d+)\s+(Bruiser|Horde|Leader|Minion|Ranged|Skulk|Social|Solo|Standard|Support)"
    r"(?:\s*\(([^)]*)/HP\))?$"
)
NAME_LINE = re.compile(r"^[A-Z][A-Z0-9\u2019'&,.\- ]{2,}$")
FEATURE_KIND = re.compile(r"^(.+?) - (Action|Passive|Reaction|Evolution):\s*(.*)$")
ATTACK = re.compile(
    r"ATK:\s*(\u2212|\u2013|\u2014|[+\-\u2212\u2013\u2014]?\d+)\s*\|\s*(.+?):\s*"
    r"(Melee|Very Close|Close|Far|Very Far)\s*\|\s*"
    r"([0-9d+\-\u2212\u2013\u2014]+)\s+((?:direct )?(?:phy/mag|phy|mag))"
)
DIFFICULTY_LINE = re.compile(r"Difficulty:\s*(\d+|Special[^|]*)")
THRESHOLDS = re.compile(r"Thresholds:\s*(None|\d+)\s*(?:/\s*(None|\d+))?")
HP = re.compile(r"HP:\s*(None|\d+)")
STRESS = re.compile(r"Stress:\s*(None|\d+)")


def block_name(lines: list[Line], tier_index: int) -> tuple[str, int]:
    start = tier_index
    while start > 0 and NAME_LINE.match(lines[start - 1].text) and not lines[start - 1].text.startswith("TIER"):
        start -= 1
    name = join_lines(lines[start:tier_index])
    return smart_title(name), start


def parse_adversaries(book: Book) -> list[dict]:
    adversaries: list[dict] = []
    for printed in range(62, 98):
        lines = [line for line in book.stream(printed) if not is_art(line) and not is_footer(line)]
        heads: list[tuple[int, str]] = []
        for index, line in enumerate(lines):
            if TIER_LINE.match(line.text):
                name, start = block_name(lines, index)
                heads.append((start, name))
        for position, (start, name) in enumerate(heads):
            stop = heads[position + 1][0] if position + 1 < len(heads) else len(lines)
            block = lines[start:stop]
            tier_index = next(i for i, line in enumerate(block) if TIER_LINE.match(line.text))
            match = TIER_LINE.match(block[tier_index].text)
            tier, kind, horde = int(match.group(1)), match.group(2), match.group(3)

            body = block[tier_index + 1:]
            texts = [line.text for line in body]
            motives_index = next((i for i, text in enumerate(texts) if text.startswith("Motives & Tactics:")), None)
            if motives_index is None:
                raise ValueError(f"no motives for {name}")
            description = join_lines(body[:motives_index])
            difficulty_index = next(
                (i for i, text in enumerate(texts) if text.startswith("Difficulty:")), None
            )
            if difficulty_index is None:
                raise ValueError(f"no difficulty for {name}: {texts[:6]}")
            motives = join_lines(body[motives_index:difficulty_index]).replace("Motives & Tactics:", "").strip()
            features_index = next((i for i, text in enumerate(texts) if text == "FEATURES"), len(texts))
            stats = join_lines(body[difficulty_index:features_index])

            difficulty = DIFFICULTY_LINE.search(stats)
            thresholds = THRESHOLDS.search(stats)
            hp = HP.search(stats)
            stress = STRESS.search(stats)
            attack = ATTACK.search(stats)
            if not (difficulty and thresholds and hp and stress and attack):
                raise ValueError(f"incomplete stat line for {name}: {stats!r}")
            experience_match = re.search(r"Experience:\s*(.*?)(?:\s*FEATURES|$)", stats)
            experiences = []
            if experience_match:
                for part in experience_match.group(1).split(","):
                    found = re.search(r"(.+?)\s*\+(\d+)", part)
                    if found:
                        experiences.append({"name": found.group(1).strip(), "bonus": int(found.group(2))})

            damage, damage_type = split_damage(attack.group(4) + " " + attack.group(5))
            modifier = 0 if attack.group(1) in {"\u2212", "\u2013", "\u2014"} else parse_bonus(attack.group(1))
            features = parse_kind_features(body[features_index + 1:] if features_index < len(texts) else [])
            adversaries.append(
                {
                    "id": slug(name),
                    "name": name,
                    "tier": tier,
                    "type": kind,
                    "description": description,
                    "motives": motives,
                    "difficulty": int(difficulty.group(1)),
                    "thresholds": (
                        None
                        if thresholds.group(1) == "None"
                        else {
                            "major": int(thresholds.group(1)),
                            "severe": None if thresholds.group(2) in {None, "None"} else int(thresholds.group(2)),
                        }
                    ),
                    "hp": None if hp.group(1) == "None" else int(hp.group(1)),
                    "stress": None if stress.group(1) == "None" else int(stress.group(1)),
                    "attack": {
                        "modifier": modifier,
                        "name": attack.group(2).strip(),
                        "range": attack.group(3),
                        "damage": damage,
                        "damageType": damage_type,
                    },
                    "experiences": experiences,
                    "features": features,
                    "source": "hope-and-fear",
                }
            )
    if len(adversaries) != 135:
        raise ValueError(f"expected 135 Hope & Fear adversaries, found {len(adversaries)}")
    return adversaries


def parse_kind_features(lines: list[Line]) -> list[dict]:
    features: list[dict] = []
    current: dict | None = None
    for line in lines:
        text = line.text.strip()
        if not text:
            continue
        match = FEATURE_KIND.match(text)
        if match:
            if current:
                features.append(current)
            current = {"name": match.group(1).strip(), "kind": match.group(2), "text": match.group(3).strip()}
        elif current:
            current["text"] = tidy(current["text"] + " " + text)
    if current:
        features.append(current)
    return features


# ---------------------------------------------------------------------------
# environments


ENVIRONMENT_TIER = re.compile(r"^Tier (\d+)\s+(Exploration|Social|Traversal|Event)$")


def is_question(line: Line) -> bool:
    return "QuestaSlab-Italic" in line.fonts


def split_questions(text: str) -> list[str]:
    return [tidy(part) for part in re.findall(r"[^?]+\?", text)]


def parse_environments(book: Book) -> list[dict]:
    environments: list[dict] = []
    for printed in range(99, 114):
        raw = book.stream(printed)
        lines = [line for line in raw if not is_art(line) and not is_footer(line)]
        heads: list[tuple[int, str]] = []
        for index, line in enumerate(lines):
            if ENVIRONMENT_TIER.match(line.text):
                name, start = block_name(lines, index)
                heads.append((start, name))
        for position, (start, name) in enumerate(heads):
            stop = heads[position + 1][0] if position + 1 < len(heads) else len(lines)
            block = lines[start:stop]
            tier_index = next(i for i, line in enumerate(block) if ENVIRONMENT_TIER.match(line.text))
            match = ENVIRONMENT_TIER.match(block[tier_index].text)
            tier, kind = int(match.group(1)), match.group(2)
            body = block[tier_index + 1:]
            texts = [line.text for line in body]
            impulses_index = next((i for i, text in enumerate(texts) if text.startswith("Impulses:")), None)
            if impulses_index is None:
                raise ValueError(f"no impulses for environment {name}")
            description = join_lines(body[:impulses_index])
            difficulty_index = next(i for i, text in enumerate(texts) if text.startswith("Difficulty:"))
            impulses = join_lines(body[impulses_index:difficulty_index]).replace("Impulses:", "").strip()
            features_index = next((i for i, text in enumerate(texts) if text == "FEATURES"), len(texts))
            stats = join_lines(body[difficulty_index:features_index])
            difficulty_match = re.search(r"Difficulty:\s*([^|]+?)(?:\s*Potential Adversaries:|$)", stats)
            potential_match = re.search(r"Potential Adversaries:\s*(.*?)(?:\s*FEATURES|$)", stats)
            if not difficulty_match:
                raise ValueError(f"no difficulty for environment {name}")
            difficulty_text = tidy(difficulty_match.group(1))
            difficulty: int | str
            difficulty = int(difficulty_text) if difficulty_text.isdigit() else difficulty_text
            potential = tidy(potential_match.group(1)) if potential_match else ""
            features = parse_environment_features(body[features_index + 1:] if features_index < len(texts) else [])
            environments.append(
                {
                    "id": slug(name),
                    "name": smart_title(name),
                    "tier": tier,
                    "type": kind,
                    "description": description,
                    "impulses": impulses,
                    "difficulty": difficulty,
                    "potentialAdversaries": potential,
                    "features": features,
                    "source": "hope-and-fear",
                }
            )
    if len(environments) != 28:
        raise ValueError(f"expected 28 Hope & Fear environments, found {len(environments)}")
    return environments


def parse_environment_features(lines: list[Line]) -> list[dict]:
    features: list[dict] = []
    current: dict | None = None
    for line in lines:
        text = line.text.strip()
        if not text:
            continue
        if is_question(line):
            if current is not None:
                current.setdefault("_questions", "")
                current["_questions"] = tidy(current["_questions"] + " " + text)
            continue
        match = FEATURE_KIND.match(text)
        if match:
            if current:
                features.append(current)
            current = {
                "name": match.group(1).strip(),
                "kind": match.group(2),
                "text": match.group(3).strip(),
            }
        elif current:
            current["text"] = tidy(current["text"] + " " + text)
    if current:
        features.append(current)
    for feature in features:
        questions = split_questions(feature.pop("_questions", ""))
        if questions:
            feature["questions"] = questions
    return features


# ---------------------------------------------------------------------------
# id preservation


def fuzzy_id(record: dict, current: list[dict]) -> str:
    wanted = norm_name(record["name"])
    best = None
    best_ratio = 0.0
    for existing in current:
        ratio = difflib.SequenceMatcher(None, wanted, norm_name(existing["name"])).ratio()
        if ratio > best_ratio:
            best, best_ratio = existing, ratio
    if best is not None and best_ratio >= 0.84:
        return best["id"]
    return record["id"]


def preserve_ids(records: list[dict], current: list[dict]) -> list[dict]:
    for record in records:
        record["id"] = fuzzy_id(record, current)
    return records


# ---------------------------------------------------------------------------
# Sablewood (unchanged: its own PDF, pdftotext -raw)

SABLEWOOD_NAMES = {
    "weapons": ["Sableblade", "Eeligator Scale Shield"],
    "armor": ["Thistlefolk Armor"],
    "items": ["Returning Stone", "Ward of the Whitefire Arcanist", "Sableleaf Shoes"],
    "consumables": ["Bugbane Berry", "Sable Sap", "Vial of Briarpowder"],
    "adversaries": ["Bullfrog", "Strixwolf", "Eeligator"],
    "environments": ["Bandit Hideout", "Underroot Tunnels", "The Village of Hush"],
}


def pdf_text(pdf: Path, mode: str) -> str:
    command = [PDFTOTEXT, "-enc", "UTF-8", f"-{mode}", str(pdf), "-"]
    result = subprocess.run(command, check=True, capture_output=True)
    return result.stdout.decode("utf-8", errors="replace")


def pdf_pages(pdf: Path, mode: str) -> list[str]:
    return pdf_text(pdf, mode).split("\f")


def section_between(lines: list[str], start: str, end: str | None) -> list[str]:
    start_index = next(i for i, line in enumerate(lines) if line.strip() == start)
    end_index = len(lines)
    if end is not None:
        end_index = next(
            i for i, line in enumerate(lines[start_index + 1:], start_index + 1)
            if line.strip() == end
        )
    return [line.strip() for line in lines[start_index + 1:end_index] if line.strip()]


def parse_named_text_block(lines: list[str], names: list[str]) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    current_name: str | None = None
    current: list[str] = []
    for line in lines:
        match = next((name for name in names if line.startswith(f"{name}:")), None)
        if match:
            if current_name is not None:
                result.append((current_name, tidy(" ".join(current))))
            current_name = match
            current = [line[len(match) + 1:].strip()]
        elif current_name is not None:
            current.append(line)
    if current_name is not None:
        result.append((current_name, tidy(" ".join(current))))
    return result


def split_named_blocks(lines: list[str], names: list[str]) -> list[tuple[str, list[str]]]:
    positions = []
    for name in names:
        positions.append((next(i for i, line in enumerate(lines) if line == name), name))
    positions.sort()
    blocks: list[tuple[str, list[str]]] = []
    for index, (start, name) in enumerate(positions):
        stop = positions[index + 1][0] if index + 1 < len(positions) else len(lines)
        blocks.append((name, lines[start + 1:stop]))
    return blocks


def parse_feature_cell(text: str) -> dict | None:
    value = tidy(text)
    if not value or value in {"\u2014", "--", "-", "\u00ad"}:
        return None
    match = FEATURE_COLON.match(value)
    if not match:
        return {"name": "", "text": value}
    return {"name": match.group(1).strip(), "text": tidy(match.group(2))}


def parse_sablewood_equipment(lines: list[str]) -> tuple[list[dict], list[dict]]:
    weapon_blocks = split_named_blocks(lines, SABLEWOOD_NAMES["weapons"])
    armor_blocks = split_named_blocks(lines, SABLEWOOD_NAMES["armor"])

    weapons: list[dict] = []
    for name, block in weapon_blocks:
        match = re.fullmatch(
            r"(Agility|Strength|Finesse|Instinct|Presence|Knowledge) "
            r"(Melee|Very Close|Close|Far|Very Far) - ([0-9d+\-]+) \((phy|mag)\) - (One-Handed|Two-Handed)",
            block[0],
        )
        if not match:
            raise ValueError(f"cannot parse Sablewood weapon {name}: {block[0]}")
        feature_lines: list[str] = []
        for line in block[1:]:
            if re.fullmatch(r"(Primary|Secondary) Weapon - Tier \d+", line):
                break
            feature_lines.append(line)
        weapons.append(
            {
                "id": slug(name),
                "name": name,
                "category": "Primary" if name == "Sableblade" else "Secondary",
                "tier": 1,
                "trait": match.group(1),
                "range": match.group(2),
                "damage": match.group(3),
                "damageType": match.group(4),
                "burden": match.group(5),
                "feature": parse_feature_cell(" ".join(feature_lines)),
                "source": "sablewood",
            }
        )

    armor: list[dict] = []
    for name, block in armor_blocks:
        match = re.search(r"Base Score:\s*(\d+)\s*-\s*Base Thresholds:\s*(\d+)\s*/\s*(\d+)", block[0])
        if not match:
            raise ValueError(f"cannot parse Sablewood armor {name}: {block[0]}")
        score, major, severe = (int(value) for value in match.groups())
        feature_lines: list[str] = []
        for line in block[1:]:
            if re.fullmatch(r"Armor - Tier \d+", line):
                break
            feature_lines.append(line)
        armor.append(
            {
                "id": slug(name),
                "name": name,
                "tier": 1,
                "baseThresholds": {"major": major, "severe": severe},
                "baseScore": score,
                "feature": parse_feature_cell(" ".join(feature_lines)),
                "source": "sablewood",
            }
        )
    return weapons, armor


def parse_sablewood(pdf: Path) -> dict:
    raw = pdf_pages(pdf, "raw")
    loot_page = [line.strip() for line in raw[8].splitlines() if line.strip()]
    environment_page = [line.strip() for line in raw[9].splitlines() if line.strip()]
    equipment = section_between(loot_page, "EQUIPMENT", "ITEMS")
    weapons, armor = parse_sablewood_equipment(equipment)
    items = [
        {"id": slug(name), "name": name, "description": text, "feature": None, "source": "sablewood"}
        for name, text in parse_named_text_block(
            section_between(loot_page, "ITEMS", "CONSUMABLES"), SABLEWOOD_NAMES["items"]
        )
    ]
    consumables = [
        {"id": slug(name), "name": name, "description": text, "rollTable": None, "source": "sablewood"}
        for name, text in parse_named_text_block(
            section_between(loot_page, "CONSUMABLES", "ADVERSARIES"), SABLEWOOD_NAMES["consumables"]
        )
    ]
    adversaries = parse_sablewood_adversaries(section_between(loot_page, "ADVERSARIES", None))
    environments = parse_sablewood_environments(environment_page)
    return {
        "weapons": weapons,
        "armor": armor,
        "items": items,
        "consumables": consumables,
        "adversaries": adversaries,
        "environments": environments,
    }


def parse_sablewood_adversaries(lines: list[str]) -> list[dict]:
    header = re.compile(r"^(.+?)\s*-\s*Tier (\d+) (Bruiser|Horde|Leader|Minion|Ranged|Skulk|Social|Solo|Standard|Support)$")
    starts = [i for i, line in enumerate(lines) if header.match(line)]
    if len(starts) != 3:
        raise ValueError(f"expected 3 Sablewood adversaries, found {len(starts)}")
    adversaries: list[dict] = []
    for position, start in enumerate(starts):
        stop = starts[position + 1] if position + 1 < len(starts) else len(lines)
        match = header.match(lines[start])
        name, tier, kind = match.group(1).strip(), int(match.group(2)), match.group(3)
        body = lines[start + 1:stop]
        description = next((line.split(":", 1)[1].strip() for line in body if line.startswith("Description:")), "")
        motives = next((line.split(":", 1)[1].strip() for line in body if line.startswith("Motives & Tactics:")), "")
        experiences: list[dict] = []
        for line in body:
            if not line.startswith("Experience:"):
                continue
            for part in line[len("Experience:"):].split(","):
                found = re.search(r"(.+?)\s*\+(\d+)", part)
                if found:
                    experiences.append({"name": found.group(1).strip(), "bonus": int(found.group(2))})
        attack_line = next(
            (line for line in body if re.match(r"^.+?: (Melee|Very Close|Close|Far|Very Far) - .+ \(\w+\)$", line)),
            None,
        )
        if not attack_line:
            raise ValueError(f"no attack for {name}")
        attack_match = re.match(r"^(.+?): (Melee|Very Close|Close|Far|Very Far) - ([0-9d+\-]+) \((\w+)\)$", attack_line)
        attack = {
            "modifier": int(re.search(r"ATK:\s*\+(\d+)", "\n".join(body)).group(1)),
            "name": attack_match.group(1).strip(),
            "range": attack_match.group(2),
            "damage": attack_match.group(3),
            "damageType": attack_match.group(4),
        }
        difficulty = int(re.search(r"Difficulty:\s*(\d+)", "\n".join(body)).group(1))
        threshold_match = re.search(r"Thresholds:\s*(\d+)\s*/\s*(\d+)", "\n".join(body))
        hp = int(re.search(r"HP:\s*(\d+)", "\n".join(body)).group(1))
        stress = int(re.search(r"Stress:\s*(\d+)", "\n".join(body)).group(1))
        feature_lines = body[body.index("FEATURES") + 1:] if "FEATURES" in body else []
        adversaries.append(
            {
                "id": slug(name),
                "name": name,
                "tier": tier,
                "type": kind,
                "description": description,
                "motives": motives,
                "difficulty": difficulty,
                "thresholds": {"major": int(threshold_match.group(1)), "severe": int(threshold_match.group(2))},
                "hp": hp,
                "stress": stress,
                "attack": attack,
                "experiences": experiences,
                "features": parse_kind_feature_strings(feature_lines),
                "source": "sablewood",
            }
        )
    return adversaries


def parse_kind_feature_strings(lines: list[str]) -> list[dict]:
    features: list[dict] = []
    current: dict | None = None
    for line in lines:
        match = FEATURE_KIND.match(line)
        if match:
            if current:
                features.append(current)
            current = {"name": match.group(1).strip(), "kind": match.group(2), "text": match.group(3).strip()}
            continue
        plain = FEATURE_COLON.match(line)
        if plain:
            if current:
                features.append(current)
            kind = "Action" if re.match(r"Spend (?:a )?(?:Fear|Hope)\b", plain.group(2)) else "Passive"
            current = {"name": plain.group(1).strip(), "kind": kind, "text": plain.group(2).strip()}
        elif current:
            current["text"] = tidy(current["text"] + " " + line)
    if current:
        features.append(current)
    return features


def labeled_paragraph(lines: list[str], label: str, stop_labels: tuple[str, ...]) -> str:
    for index, line in enumerate(lines):
        if not line.startswith(label):
            continue
        parts = [line[len(label):].strip()]
        for following in lines[index + 1:]:
            if following.startswith(stop_labels):
                break
            parts.append(following)
        return tidy(" ".join(parts))
    return ""


def parse_sablewood_environments(lines: list[str]) -> list[dict]:
    header = re.compile(r"^(.+?)\s*-\s*Tier (\d+) (Exploration|Social|Traversal|Event)$")
    starts = [i for i, line in enumerate(lines) if header.match(line)]
    if len(starts) != 3:
        raise ValueError(f"expected 3 Sablewood environments, found {len(starts)}")
    environments: list[dict] = []
    for position, start in enumerate(starts):
        stop = starts[position + 1] if position + 1 < len(starts) else len(lines)
        match = header.match(lines[start])
        name, tier, kind = match.group(1).strip(), int(match.group(2)), match.group(3)
        body = lines[start + 1:stop]
        description = labeled_paragraph(body, "Description:", ("Impulses:",))
        impulses = labeled_paragraph(body, "Impulses:", ("Potential Adversaries:", "Difficulty:"))
        potential: list[str] = []
        collecting = False
        for line in body:
            if line.startswith("Potential Adversaries:"):
                collecting = True
                potential.append(line.split(":", 1)[1].strip())
            elif collecting:
                if line.startswith("Difficulty:"):
                    break
                potential.append(line)
        difficulty = int(re.search(r"Difficulty:\s*(\d+)", "\n".join(body)).group(1))
        feature_lines = body[body.index("FEATURES") + 1:] if "FEATURES" in body else []
        environments.append(
            {
                "id": slug(name.replace("The ", "", 1)) if name.startswith("The ") else slug(name),
                "name": name.replace("The ", "", 1) if name.startswith("The ") else name,
                "tier": tier,
                "type": kind,
                "description": description,
                "impulses": impulses,
                "difficulty": difficulty,
                "potentialAdversaries": tidy(" ".join(potential)),
                "features": parse_kind_feature_strings(feature_lines),
                "source": "sablewood",
            }
        )
    return environments


# ---------------------------------------------------------------------------
# assembly


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build(pdf_dir: Path) -> dict:
    paths = {key: pdf_dir / name for key, name in PDF_NAMES.items()}
    for key, path in paths.items():
        if not path.exists():
            raise FileNotFoundError(f"missing {key} PDF: {path}")

    existing = {
        name: read_json(HF_DIR / f"{name}.json")
        for name in (
            "adversaries", "ancestries", "armor", "classes", "communities", "consumables",
            "domain-cards", "domains", "environments", "items", "transformations", "weapons",
        )
    }

    book = Book(paths["book"])
    try:
        classes = parse_classes(book)
        domain_cards = parse_domain_cards(book)
        ancestries = parse_ancestries(book)
        communities = parse_communities(book)
        transformations = parse_transformations(book)
        equipment = parse_equipment(book)
        items = parse_items(book)
        consumables = parse_consumables(book)
        adversaries = parse_adversaries(book)
        environments = parse_environments(book)
    finally:
        book.close()

    for name, records in (
        ("classes", classes),
        ("ancestries", ancestries),
        ("communities", communities),
        ("transformations", transformations),
        ("weapons", equipment["weapons"]),
        ("armor", equipment["armor"]),
        ("items", items),
        ("consumables", consumables),
        ("adversaries", adversaries),
        ("environments", environments),
        ("domain-cards", domain_cards),
    ):
        preserve_ids(records, existing[name])

    sablewood = parse_sablewood(paths["sablewood"])

    payloads = {
        HF_DIR / "classes.json": classes,
        HF_DIR / "domains.json": parse_dread_domain(),
        HF_DIR / "domain-cards.json": domain_cards,
        HF_DIR / "ancestries.json": ancestries,
        HF_DIR / "communities.json": communities,
        HF_DIR / "transformations.json": transformations,
        HF_DIR / "weapons.json": equipment["weapons"],
        HF_DIR / "armor.json": equipment["armor"],
        HF_DIR / "items.json": items,
        HF_DIR / "consumables.json": consumables,
        HF_DIR / "adversaries.json": adversaries,
        HF_DIR / "environments.json": environments,
        SW_DIR / "weapons.json": sablewood["weapons"],
        SW_DIR / "armor.json": sablewood["armor"],
        SW_DIR / "items.json": sablewood["items"],
        SW_DIR / "consumables.json": sablewood["consumables"],
        SW_DIR / "adversaries.json": sablewood["adversaries"],
        SW_DIR / "environments.json": sablewood["environments"],
    }
    for path, payload in payloads.items():
        write_json(path, payload)

    return {str(path.relative_to(CONTENT)): len(payload) for path, payload in payloads.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pdf-dir",
        type=Path,
        help="folder holding the Hope & Fear and Sablewood PDFs (default: sources/, then ~/Downloads)",
    )
    args = parser.parse_args()
    pdf_dir = args.pdf_dir
    if pdf_dir is None:
        shipped = ROOT / "sources"
        pdf_dir = shipped if (shipped / PDF_NAMES["book"]).exists() else Path.home() / "Downloads"
    counts = build(pdf_dir)
    print(json.dumps(counts, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
