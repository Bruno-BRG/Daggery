#!/usr/bin/env python3
"""Parse the Daggerheart SRD raw text into adversary and environment JSON.

Input : data/extract/srd_raw.txt (pdftotext, reading order, cp1252)
Output: packages/content/adversaries.json
        packages/content/environments.json

Python 3.12, standard library only.

Notes on the source text
------------------------
* Stat blocks are delimited by an ALL-CAPS name line immediately followed by a
  line beginning with ``Tier``.  The tier *number* is not part of that line in
  this extraction, so it is taken from the enclosing section heading
  (``TIER 1 ADVERSARIES (LEVEL 1)`` etc.).
* Page footers (``94 Daggerheart SRD`` / ``Daggerheart SRD 94``), form feeds and
  the section headings themselves can appear in the middle of a block and are
  removed.
* PDF page 102 is rendered with a broken font: digits and punctuation are
  missing from the text layer.  Those six Tier 1 blocks are transcribed from
  the page image and supplied via OVERRIDES below.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "extract" / "srd_raw.txt"
OUT_ADVERSARIES = ROOT / "packages" / "content" / "adversaries.json"
OUT_ENVIRONMENTS = ROOT / "packages" / "content" / "environments.json"

ADVERSARY_TYPES = {
    "Solo", "Skulk", "Standard", "Bruiser", "Horde", "Minion",
    "Leader", "Ranged", "Social", "Support",
}
ENVIRONMENT_TYPES = {"Exploration", "Traversal", "Social", "Event"}
FEATURE_KINDS = ("Passive", "Action", "Reaction", "Fear", "Evolution")
RANGES = ("Very Close", "Close", "Far", "Very Far", "Melee")

FOOTER_RE = re.compile(
    r"^\s*(?:\d+\s+Daggerheart\s+SRD|Daggerheart\s+SRD\s+\d+)\s*$"
)
SECTION_HEADER_RE = re.compile(
    r"^TIER\s+[1-4]\s+(?:ADVERSARIES|ENVIRONMENTS)\b"
)
FEATURE_RE = re.compile(
    r"^(?P<name>[A-Z\"'](?:(?!\. ).){0,70}?)\s+-\s+(?P<kind>"
    + "|".join(FEATURE_KINDS)
    + r"):\s*(?P<text>.*)$"
)
# Some source lines merge two features onto one line, e.g.
# "Libre - Passive: ... Heel Turn - Action: ...".  Matches a feature heading
# that immediately follows sentence-ending punctuation.
EMBEDDED_FEATURE_RE = re.compile(
    r"(?<=[.!?])\s+(?P<name>[A-Z\"'](?:(?!\. ).){0,80}?)\s+-\s+(?P<kind>"
    + "|".join(FEATURE_KINDS)
    + r"):\s"
)
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


class ParseError(Exception):
    pass


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def clean(line: str) -> str:
    """Strip form feeds and surrounding whitespace."""
    return line.replace("\x0c", "").strip()


def is_noise(line: str) -> bool:
    s = clean(line)
    return not s or bool(FOOTER_RE.match(s)) or bool(SECTION_HEADER_RE.match(s))


def slugify(name: str) -> str:
    # Match the existing content convention: drop apostrophes ("keeper's" ->
    # "keepers") and turn every other run of non-alphanumerics into a hyphen.
    s = name.lower().replace("’", "").replace("'", "")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


MINOR_WORDS = {
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
    "nor", "of", "on", "onto", "or", "over", "per", "the", "to", "via",
    "with", "vs",
}
_TITLE_WORD_RE = re.compile(r"[A-Za-z0-9’']+(?:-[A-Za-z0-9’']+)*")


def _capitalize_token(token: str, first_word: bool) -> str:
    parts = token.split("-")
    out = []
    for index, part in enumerate(parts):
        first = first_word and index == 0
        plain = part.replace("'", "").replace("’", "")
        if part in ("o'", "o’"):
            out.append(part)  # Will-o'-the-Wisps / Jack-o'-Lantern
        elif plain in MINOR_WORDS and not first:
            out.append(part.lower())
        else:
            out.append(part[:1].upper() + part[1:].lower())
    return "-".join(out)


def smart_title(name: str) -> str:
    """Title-case an ALL CAPS SRD name, preserving minor words and apostrophes."""
    s = " ".join(name.split()).lower()
    pieces: list[str] = []
    last = 0
    word_no = 0
    for match in _TITLE_WORD_RE.finditer(s):
        pieces.append(s[last:match.start()])
        pieces.append(_capitalize_token(match.group(0), word_no == 0))
        last = match.end()
        word_no += 1
    pieces.append(s[last:])
    return "".join(pieces)


def _is_question(sentence: str) -> bool:
    tail = sentence.rstrip().rstrip("\"”’'")
    return tail.endswith("?")


def _clean_fragment(text: str) -> str:
    """Strip bullet glyphs/whitespace left over from list formatting."""
    return text.lstrip("·•–—-* \t").strip()


def split_trailing_questions(text: str) -> tuple[str, list[str]]:
    """Split a feature paragraph into prose + trailing questions.

    The SRD places feature questions at the end of a feature, sometimes on the
    same paragraph line and sometimes on following lines.  Only the trailing
    run of question sentences is extracted; prose that merely mentions a
    question mark stays in the body.
    """
    text = text.strip()
    if not text:
        return "", []
    parts = [p.strip() for p in SENTENCE_SPLIT_RE.split(text) if p.strip()]
    questions: list[str] = []
    while parts and _is_question(parts[-1]):
        questions.insert(0, _clean_fragment(parts.pop()))
    body = " ".join(parts).strip()
    # A line that contained only a bullet and a question leaves the bullet.
    if not re.sub(r"[·•–—\-*. ]+", "", body):
        body = ""
    return body, questions


def parse_modifier(raw: str):
    raw = raw.strip()
    if re.fullmatch(r"[+-]?\d+", raw):
        return int(raw)
    return raw.lstrip("+")


def parse_int_or_none(raw: str):
    raw = raw.strip()
    if raw.lower() == "none":
        return None
    if re.fullmatch(r"\d+", raw):
        return int(raw)
    return raw


def parse_experiences(text: str) -> list[dict]:
    out = []
    for chunk in re.split(r",\s*", text.strip()):
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.match(r"^(?P<name>.+?)\s*(?P<bonus>[+-]\d+)\s*$", chunk)
        if not m:
            raise ParseError(f"cannot parse experience {chunk!r}")
        out.append(
            {"name": m.group("name").strip(), "bonus": int(m.group("bonus"))}
        )
    return out


def split_embedded_features(text: str) -> list[tuple]:
    """Split prose containing merged feature headings.

    Returns an ordered list of ``("text", str)`` and
    ``("feature", name, kind, text)`` tuples.
    """
    matches = list(EMBEDDED_FEATURE_RE.finditer(text))
    if not matches:
        return [("text", text)] if text.strip() else []

    events: list[tuple] = []
    prefix = text[: matches[0].start()].strip()
    if prefix:
        events.append(("text", prefix))
    for idx, match in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        events.append(
            (
                "feature",
                match.group("name").strip(),
                match.group("kind"),
                text[match.end():end].strip(),
            )
        )
    return events


def parse_attack(stat_line: str) -> tuple[dict, str]:
    """Parse the attack portion.

    Returns (attack dict, leftover text after the damage, which may hold an
    inline ``Experience:`` section).
    """
    m = re.search(
        r"\|\s*(?P<name>[^|]+?):\s*(?P<range>"
        + "|".join(re.escape(r) for r in RANGES)
        + r")\s*\|\s*(?P<rest>.+)$",
        stat_line,
    )
    if not m:
        raise ParseError(f"cannot parse attack from {stat_line!r}")

    damage_part = m.group("rest").strip()
    leftover = ""
    inline = re.search(r"\bExperience:\s*(.+)$", damage_part)
    if inline:
        leftover = inline.group(1).strip()
        damage_part = damage_part[: inline.start()].strip()

    dmg_m = re.match(
        r"^(?P<damage>.+?)\s+(?P<damage_type>(?:direct\s+)?(?:phy|mag)"
        r"(?:/(?:phy|mag))?)$",
        damage_part,
    )
    if not dmg_m:
        raise ParseError(f"cannot parse damage from {damage_part!r}")

    atk_m = re.search(r"ATK:\s*(?P<mod>[+-][^\s|]+)", stat_line)
    if not atk_m:
        raise ParseError(f"cannot parse attack modifier from {stat_line!r}")

    return (
        {
            "modifier": parse_modifier(atk_m.group("mod")),
            "name": m.group("name").strip(),
            "range": m.group("range").strip(),
            "damage": dmg_m.group("damage").strip(),
            "damageType": dmg_m.group("damage_type").strip(),
        },
        leftover,
    )


# ---------------------------------------------------------------------------
# Block discovery
# ---------------------------------------------------------------------------

def section_ranges(lines: list[str], kind: str, end_marker: str) -> list[tuple[int, int, int]]:
    """Return [(start, end, tier)] for ``TIER n <kind>`` sections."""
    header_re = re.compile(rf"^TIER\s+([1-4])\s+{kind}\b")
    headers = []
    for i, line in enumerate(lines):
        m = header_re.match(clean(line))
        if m:
            headers.append((i, int(m.group(1))))
    if not headers:
        raise ParseError(f"no {kind} section headers found")

    try:
        end_default = next(
            i for i, line in enumerate(lines) if clean(line).upper() == end_marker
        )
    except StopIteration:
        end_default = len(lines)

    ranges = []
    for idx, (start, tier) in enumerate(headers):
        end = headers[idx + 1][0] if idx + 1 < len(headers) else end_default
        if end <= start:
            raise ParseError(f"bad range for {kind} tier {tier}")
        ranges.append((start, end, tier))
    return ranges


def find_blocks(lines: list[str], start: int, end: int, tier: int) -> list[dict]:
    """Find ``NAME`` / ``Tier ...`` pairs inside a section range."""
    blocks = []
    for i in range(start, end):
        if not lines[i].startswith("Tier "):
            continue
        j = i - 1
        while j > start and not clean(lines[j]):
            j -= 1
        name = clean(lines[j])
        if not name or SECTION_HEADER_RE.match(name):
            continue
        blocks.append({"name": name, "tier": tier, "tier_index": i, "start": j, "end": -1})

    for idx, block in enumerate(blocks):
        block["end"] = blocks[idx + 1]["start"] if idx + 1 < len(blocks) else end
    return blocks


def block_lines(lines: list[str], block: dict) -> list[str]:
    return [clean(lines[i]) for i in range(block["tier_index"] + 1, block["end"])]


# ---------------------------------------------------------------------------
# Adversary parsing
# ---------------------------------------------------------------------------

def parse_adversary_block(lines: list[str], block: dict) -> dict:
    name = block["name"]
    tier_line = clean(lines[block["tier_index"]])
    body = block_lines(lines, block)

    m = re.match(r"^Tier\s+([A-Za-z]+)\b\s*(.*)$", tier_line)
    if not m:
        raise ParseError(f"{name}: cannot parse tier line")
    adv_type = m.group(1)
    if adv_type not in ADVERSARY_TYPES:
        raise ParseError(f"{name}: unknown adversary type {adv_type!r}")
    rest = m.group(2).strip()
    # Horde blocks carry an "(/HP)" annotation between type and description.
    rest = re.sub(r"^\([^)]*\)\s*", "", rest)

    if "Motives & Tactics:" not in rest:
        raise ParseError(f"{name}: no motives")
    description, motives = rest.split("Motives & Tactics:", 1)
    description = description.strip()
    motives = motives.strip()

    stat_idx = next((k for k, line in enumerate(body) if line.startswith("Difficulty:")), None)
    if stat_idx is None:
        raise ParseError(f"{name}: no difficulty line")
    stat_line = body[stat_idx]

    diff_m = re.search(r"Difficulty:\s*(\d+)", stat_line)
    thr_m = re.search(r"Thresholds:\s*(\w+)(?:\s*/\s*(\w+))?", stat_line)
    hp_m = re.search(r"HP:\s*(\d+)", stat_line)
    st_m = re.search(r"Stress:\s*(\w+)", stat_line)
    if not (diff_m and thr_m and hp_m and st_m):
        raise ParseError(f"{name}: incomplete stat line {stat_line!r}")

    attack, inline_exp = parse_attack(stat_line)

    experiences: list[dict] = []
    exp_lines = []
    if inline_exp:
        exp_lines.append(inline_exp)
    for line in body[stat_idx + 1:]:
        if line.startswith("Experience:"):
            exp_lines.append(line[len("Experience:"):].strip())
        elif line == "FEATURES":
            break
    for exp in exp_lines:
        experiences.extend(parse_experiences(exp))

    if "FEATURES" not in body:
        raise ParseError(f"{name}: no FEATURES")
    fi = body.index("FEATURES")

    features = []
    current = None

    def append_text(chunk: str) -> None:
        if current is None:
            raise ParseError(f"{name}: orphan feature text {chunk!r}")
        sep = " " if current["text"] else ""
        current["text"] = (current["text"] + sep + chunk).strip()

    def add_events(events: list[tuple]) -> None:
        nonlocal current
        for event in events:
            if event[0] == "text":
                if event[1].strip():
                    append_text(event[1].strip())
            else:
                current = {"name": event[1], "kind": event[2], "text": event[3].strip()}
                features.append(current)

    for raw in body[fi + 1:]:
        if is_noise(raw):
            continue
        fm = FEATURE_RE.match(raw)
        if fm:
            current = {
                "name": fm.group("name").strip(),
                "kind": fm.group("kind"),
                "text": "",
            }
            features.append(current)
            if current["kind"] == "Evolution":
                append_text(fm.group("text").strip())
            else:
                add_events(split_embedded_features(fm.group("text")))
        elif current is not None and current["kind"] == "Evolution":
            # Nested features in an Evolution block stay part of its text.
            append_text(raw)
        else:
            add_events(split_embedded_features(raw))

    if not features:
        raise ParseError(f"{name}: empty FEATURES")

    thresholds = None
    if adv_type != "Minion":
        thresholds = {
            "major": parse_int_or_none(thr_m.group(1)),
            "severe": parse_int_or_none(thr_m.group(2)) if thr_m.group(2) else None,
        }

    return {
        "id": slugify(name),
        "name": smart_title(name),
        "tier": block["tier"],
        "type": adv_type,
        "description": description,
        "motives": motives,
        "difficulty": int(diff_m.group(1)),
        "thresholds": thresholds,
        "hp": int(hp_m.group(1)),
        "stress": parse_int_or_none(st_m.group(1)),
        "attack": attack,
        "experiences": experiences,
        "features": features,
    }


# ---------------------------------------------------------------------------
# Environment parsing
# ---------------------------------------------------------------------------

def parse_environment_block(lines: list[str], block: dict) -> dict:
    name = block["name"]
    tier_line = clean(lines[block["tier_index"]])
    body = block_lines(lines, block)

    m = re.match(r"^Tier\s+([A-Za-z]+)\b\s*(.*)$", tier_line)
    if not m:
        raise ParseError(f"{name}: cannot parse tier line")
    env_type = m.group(1)
    if env_type not in ENVIRONMENT_TYPES:
        raise ParseError(f"{name}: unknown environment type {env_type!r}")
    rest = m.group(2).strip()
    if "Impulses:" not in rest:
        raise ParseError(f"{name}: no impulses")
    description, impulses = rest.split("Impulses:", 1)

    stat_idx = next((k for k, line in enumerate(body) if line.startswith("Difficulty:")), None)
    if stat_idx is None:
        raise ParseError(f"{name}: no difficulty line")
    stat_line = body[stat_idx]
    sm = re.match(
        r"^Difficulty:\s*(?P<diff>.+?)\s+Potential Adversaries:\s*(?P<adv>.*)$",
        stat_line,
    )
    if not sm:
        raise ParseError(f"{name}: bad difficulty line {stat_line!r}")
    diff_raw = sm.group("diff").strip()
    difficulty = int(diff_raw) if diff_raw.isdigit() else diff_raw

    if "FEATURES" not in body:
        raise ParseError(f"{name}: no FEATURES")
    fi = body.index("FEATURES")

    features: list[dict] = []
    current = None

    def add_chunk(chunk: str) -> None:
        """Add prose/questions from one line to the current feature."""
        nonlocal current
        if current is None:
            raise ParseError(f"{name}: orphan feature text {chunk!r}")
        text, questions = split_trailing_questions(chunk)
        if text:
            sep = " " if current["text"] else ""
            current["text"] = (current["text"] + sep + text).strip()
        current["questions"].extend(questions)

    for raw in body[fi + 1:]:
        if is_noise(raw):
            continue
        fm = FEATURE_RE.match(raw)
        if fm:
            current = {
                "name": fm.group("name").strip(),
                "kind": fm.group("kind"),
                "text": "",
                "questions": [],
            }
            features.append(current)
            add_chunk(fm.group("text"))
        else:
            add_chunk(raw)

    if not features:
        raise ParseError(f"{name}: empty FEATURES")

    return {
        "id": slugify(name),
        "name": smart_title(name),
        "tier": block["tier"],
        "type": env_type,
        "description": description.strip(),
        "impulses": impulses.strip(),
        "difficulty": difficulty,
        "potentialAdversaries": sm.group("adv").strip(),
        "features": features,
    }


# ---------------------------------------------------------------------------
# Overrides for the corrupted text layer on PDF page 102
# (HARPY through JAGGED KNIFE LACKEY).  Transcribed from the page image.
# ---------------------------------------------------------------------------

OVERRIDES: dict[str, dict] = {
    "HARPY": {
        "description": "A fierce and foul-smelling bird with an eight-foot wingspan and the upper body and face of a human.",
        "motives": "Defend nest, drop enemies from a great height, maraud from the air, screech incessantly",
        "difficulty": 12, "thresholds": {"major": 3, "severe": 7},
        "hp": 3, "stress": 3,
        "attack": {"modifier": 0, "name": "Talons", "range": "Melee", "damage": "1d8+1", "damageType": "phy"},
        "experiences": [{"name": "Islands", "bonus": 3}],
        "features": [
            {"name": "Toxic Aura", "kind": "Passive", "text": "The Harpy emits a foul stench that renders all non-Harpies Vulnerable while within Very Close range."},
            {"name": "Swooping Attack", "kind": "Action", "text": "Mark a Stress to have the Harpy move in a straight line to a point within Far range and make an attack against a target in the Harpy's path. On a success, the Harpy deals 3d6 physical damage."},
        ],
    },
    "JAGGED KNIFE HEXER": {
        "description": "A staff-wielding bandit in a cloak adorned with magical paraphernalia, using curses to vex their foes.",
        "motives": "Command, hex, profit",
        "difficulty": 13, "thresholds": {"major": 5, "severe": 9},
        "hp": 4, "stress": 4,
        "attack": {"modifier": 2, "name": "Staff", "range": "Far", "damage": "1d6+2", "damageType": "mag"},
        "experiences": [{"name": "Magical Knowledge", "bonus": 2}],
        "features": [
            {"name": "Curse", "kind": "Action", "text": "Choose a target within Far range and temporarily Curse them. While the target is Cursed, you can mark a Stress when that target rolls with Hope to make the roll be with Fear instead."},
            {"name": "Chaotic Flux", "kind": "Action", "text": "Make an attack against up to three targets within Very Close range. Mark a Stress to deal 2d6+3 magic damage to targets the Hexer succeeded against."},
        ],
    },
    "HARRIER": {
        "description": "A nimble fighter armed with javelins.",
        "motives": "Flank, harry, kite, profit",
        "difficulty": 12, "thresholds": {"major": 5, "severe": 9},
        "hp": 3, "stress": 3,
        "attack": {"modifier": 1, "name": "Javelin", "range": "Close", "damage": "1d6+2", "damageType": "phy"},
        "experiences": [{"name": "Camouflage", "bonus": 2}],
        "features": [
            {"name": "Maintain Distance", "kind": "Passive", "text": "After making a standard attack, the Harrier can move anywhere within Far range."},
            {"name": "Fall Back", "kind": "Reaction", "text": "When a creature moves into Melee range to make an attack, you can mark a Stress before the attack roll to move anywhere within Close range and make an attack against that creature. On a success, deal 1d10+2 physical damage."},
        ],
    },
    "JAGGED KNIFE BANDIT": {
        "description": "A cunning criminal in a cloak bearing one of the gang's iconic knives.",
        "motives": "Escape, profit, steal, throw smoke",
        "difficulty": 12, "thresholds": {"major": 8, "severe": 14},
        "hp": 5, "stress": 3,
        "attack": {"modifier": 1, "name": "Daggers", "range": "Melee", "damage": "1d8+1", "damageType": "phy"},
        "experiences": [{"name": "Thief", "bonus": 2}],
        "features": [
            {"name": "Climber", "kind": "Passive", "text": "The Bandit climbs just as easily as they run."},
            {"name": "From Above", "kind": "Passive", "text": "When the Bandit succeeds on a standard attack from above a target, they deal 1d10+1 physical damage instead of their standard damage."},
        ],
    },
    "JAGGED KNIFE KNEEBREAKER": {
        "description": "An imposing brawler carrying a large club.",
        "motives": "Grapple, intimidate, profit, steal",
        "difficulty": 12, "thresholds": {"major": 7, "severe": 14},
        "hp": 7, "stress": 4,
        "attack": {"modifier": -3, "name": "Club", "range": "Melee", "damage": "1d4+6", "damageType": "phy"},
        "experiences": [{"name": "Thief", "bonus": 2}, {"name": "Unveiled Threats", "bonus": 3}],
        "features": [
            {"name": "I've Got 'Em", "kind": "Passive", "text": "Creatures Restrained by the Kneebreaker take double damage from attacks by other adversaries."},
            {"name": "Hold Them Down", "kind": "Action", "text": "Make an attack against a target within Melee range. On a success, the target takes no damage but is Restrained and Vulnerable. The target can break free, clearing both conditions, with a successful Strength Roll, or is freed automatically if the Kneebreaker takes Major or greater damage."},
        ],
    },
    "JAGGED KNIFE LACKEY": {
        "description": "A thief with simple clothes and small daggers, eager to prove themselves.",
        "motives": "Escape, profit, throw smoke",
        "difficulty": 9, "thresholds": None,
        "hp": 1, "stress": 1,
        "attack": {"modifier": -2, "name": "Daggers", "range": "Melee", "damage": "2", "damageType": "phy"},
        "experiences": [{"name": "Thief", "bonus": 2}],
        "features": [
            {"name": "Minion (3)", "kind": "Passive", "text": "The Lackey is defeated when they take any damage. For every 3 damage a PC deals to the Lackey, defeat an additional Minion within range the attack would succeed against."},
            {"name": "Group Attack", "kind": "Action", "text": "Spend a Fear to choose a target and spotlight all Jagged Knife Lackeys within Close range of them. Those Minions move into Melee range of the target and make one shared attack roll. On a success, they deal 2 physical damage each. Combine this damage."},
        ],
    },
}


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def parse_adversaries(lines: list[str]) -> list[dict]:
    sections = section_ranges(lines, "ADVERSARIES", "USING ENVIRONMENTS")
    out = []
    for start, end, tier in sections:
        for block in find_blocks(lines, start, end, tier):
            name = block["name"]
            if name in OVERRIDES:
                rec = {
                    "id": slugify(name),
                    "name": smart_title(name),
                    "tier": tier,
                    "type": "Minion" if "LACKEY" in name else {
                        "HARPY": "Skulk",
                        "JAGGED KNIFE HEXER": "Support",
                        "HARRIER": "Standard",
                        "JAGGED KNIFE BANDIT": "Standard",
                        "JAGGED KNIFE KNEEBREAKER": "Bruiser",
                    }[name],
                    **OVERRIDES[name],
                }
            else:
                rec = parse_adversary_block(lines, block)
            out.append(rec)
    return out


def parse_environments(lines: list[str]) -> list[dict]:
    sections = section_ranges(lines, "ENVIRONMENTS", "ADDITIONAL GM GUIDANCE")
    out = []
    for start, end, tier in sections:
        for block in find_blocks(lines, start, end, tier):
            out.append(parse_environment_block(lines, block))
    return out


def validate(adversaries: list[dict], environments: list[dict]) -> None:
    ids = [a["id"] for a in adversaries] + [e["id"] for e in environments]
    if len(ids) != len(set(ids)):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        raise ParseError(f"duplicate ids: {dupes}")

    for a in adversaries:
        for key in ("id", "name", "tier", "type", "description", "motives",
                    "difficulty", "thresholds", "hp", "stress", "attack",
                    "experiences", "features"):
            if key not in a:
                raise ParseError(f"{a.get('name')}: missing {key}")
        if not a["description"] or not a["motives"]:
            raise ParseError(f"{a['name']}: empty description/motives")
        if a["type"] == "Minion" and a["thresholds"] is not None:
            raise ParseError(f"{a['name']}: minion with thresholds")
        if a["type"] != "Minion" and a["thresholds"] is None:
            raise ParseError(f"{a['name']}: non-minion without thresholds")
        for f in a["features"]:
            if not f["text"]:
                raise ParseError(f"{a['name']}: empty feature {f['name']!r}")

    for e in environments:
        for key in ("id", "name", "tier", "type", "description", "impulses",
                    "difficulty", "potentialAdversaries", "features"):
            if key not in e:
                raise ParseError(f"{e.get('name')}: missing {key}")
        if not e["description"] or not e["impulses"]:
            raise ParseError(f"{e['name']}: empty description/impulses")
        for f in e["features"]:
            if not f["text"] and not f["questions"]:
                raise ParseError(f"{e['name']}: empty feature {f['name']!r}")


def summarize(adversaries: list[dict], environments: list[dict]) -> None:
    from collections import Counter

    print(f"adversaries: {len(adversaries)}")
    print("  by tier:", dict(sorted(Counter(a["tier"] for a in adversaries).items())))
    print("  by type:", dict(sorted(Counter(a["type"] for a in adversaries).items())))
    print("  features:", sum(len(a["features"]) for a in adversaries))
    print("  minions:", sum(1 for a in adversaries if a["type"] == "Minion"))
    print(f"environments: {len(environments)}")
    print("  by tier:", dict(sorted(Counter(e["tier"] for e in environments).items())))
    print("  by type:", dict(sorted(Counter(e["type"] for e in environments).items())))
    print("  features:", sum(len(e["features"]) for e in environments))
    print("  questions:", sum(len(f["questions"]) for e in environments for f in e["features"]))


def main() -> int:
    lines = SOURCE.read_text(encoding="cp1252").splitlines()
    adversaries = parse_adversaries(lines)
    environments = parse_environments(lines)
    validate(adversaries, environments)

    for path, data in (
        (OUT_ADVERSARIES, adversaries),
        (OUT_ENVIRONMENTS, environments),
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {path.relative_to(ROOT)}")

    summarize(adversaries, environments)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ParseError as exc:
        print(f"parse error: {exc}", file=sys.stderr)
        sys.exit(1)
