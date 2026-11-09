#!/usr/bin/env python3
"""Parse the Daggerheart SRD equipment chapter into JSON content files.

Source: sources/DH_SRD_2_2026_08_25.pdf
Output: packages/content/{weapons,armor,items,consumables,conditions,ranges}.json

Only the Python standard library is required. The PDF is read through the
xpdf ``pdftotext`` utility:

  * ``-table`` keeps table columns aligned (weapons, items, consumables),
  * ``-raw`` keeps content-stream order (armor tables, which are single-line),
  * ``-layout`` keeps the two-column page layout (conditions, ranges).

Run from anywhere:  python tools/parse_equipment.py
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "sources" / "DH_SRD_2_2026_08_25.pdf"
OUT_DIR = ROOT / "packages" / "content"

RANGES = ("Melee", "Very Close", "Close", "Far", "Very Far")
DAMAGE_RE = re.compile(r"^d(\d+)(?:\+(\d+))?\s*(phy/mag|phy|mag)$")
TIER_RE = re.compile(r"TIER\s+(\d)")
FOOTER_RE = re.compile(r"^(?:\d+\s+)?Daggerheart SRD\s*\d*\s*$")

WEAPON_HEADER_RE = re.compile(
    r"^\s*Name\s+(?:Tier\s+)?Trait\s+Range\s+Damage\s+Burden\s+Feature\s*$"
)
LOOT_HEADER_RE = re.compile(r"ROLL\s+Loot\s+description", re.IGNORECASE)
ARMOR_ROW_RE = re.compile(r"^(.+?)\s+(\d+)\s*/\s*(\d+)\s+(\d+)\s+(.*)$")

WEAPON_SECTION_RE = re.compile(
    r"^(?:PRIMARY WEAPON TABLES|SECONDARY WEAPON TABLES|Combat Wheelchair|"
    r"Physical Weapons|Magic Weapons|All magic weapons require.*|"
    r"Light Frame Models|Heavy Frame Models|Arcane Frame Models)$"
)


def slug(text: str) -> str:
    text = text.lower().replace("'", "").replace("’", "")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return re.sub(r"-+", "-", text)


def run_pdftotext(first: int, last: int, mode: str | None) -> list[str]:
    exe = shutil.which("pdftotext")
    if exe is None:
        sys.exit("pdftotext (xpdf/poppler) not found on PATH")
    cmd = [exe]
    if mode:
        cmd.append("-" + mode)
    cmd += ["-enc", "UTF-8", "-f", str(first), "-l", str(last), str(PDF), "-"]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace")
    if proc.returncode != 0:
        sys.exit(f"pdftotext failed: {proc.stderr}")
    return proc.stdout.split("\f")


def norm(text: str) -> str:
    text = text.replace("\u00ad", "")  # soft hyphens from PDF extraction
    return re.sub(r"\s+", " ", text).strip()


def join_text(current: str, extra: str) -> str:
    """Join wrapped text, keeping hyphenated words hyphenated across lines."""
    extra = norm(extra)
    if not extra:
        return current
    if not current:
        return extra
    if current.endswith(("-", "–")):
        return current + extra
    return current + " " + extra


STATS_RE = re.compile(
    r"^(?P<name>.*?)\s+(?:(?P<tier>\d)\s+)?"
    r"(?P<trait>Agility|Strength|Finesse|Instinct|Presence|Knowledge|Spellcast)\s+"
    r"(?P<range>Very\s+Close|Very\s+Far|Melee|Close|Far)\s+"
    r"(?P<damage>d\d+(?:\+\d+)?(?:\s+(?:phy\s*/\s*mag|phy|mag))?)\s+"
    r"(?P<burden>One-Handed|Two-Handed)\s+"
    r"(?P<feature>.*)$"
)


def parse_feature(text: str):
    """Split "Name: rules text" into {name, text}; a dash means no feature."""
    text = norm(text)
    if not text or text in ("--", "—", "–", "-"):
        return None
    m = re.match(r"^([A-Z][A-Za-z'\-’ ]{0,30}?):\s*(.+)$", text)
    if m:
        return {"name": m.group(1).strip(), "text": norm(m.group(2))}
    return {"name": "", "text": text}


# --------------------------------------------------------------------------
# Weapons
# --------------------------------------------------------------------------

def parse_weapons() -> list[dict]:
    pages = run_pdftotext(55, 71, "table")
    weapons: list[dict] = []
    row: dict | None = None
    xpos: dict[str, int] = {}
    tier = 1
    category = "Primary"

    def finish() -> None:
        nonlocal row
        if not row:
            return
        dmg = norm(row.get("damage", ""))
        m = DAMAGE_RE.match(dmg)
        name = norm(row.get("name", ""))
        if m and name:
            die = "d" + m.group(1) + (("+" + m.group(2)) if m.group(2) else "")
            weapons.append({
                "id": "",
                "name": name,
                "category": row["category"],
                "tier": row["tier"],
                "trait": norm(row.get("trait", "")),
                "range": norm(row.get("range", "")),
                "damage": die,
                "damageType": m.group(3),
                "burden": norm(row.get("burden", "")),
                "feature": parse_feature(row.get("feature", "")),
            })
        row = None

    for page in pages:
        for line in page.splitlines():
            stripped = line.strip()
            if not stripped or FOOTER_RE.match(stripped):
                continue
            m_tier = TIER_RE.search(line)
            if m_tier and "(" in line:
                finish()
                tier = int(m_tier.group(1))
                continue
            if WEAPON_SECTION_RE.match(stripped):
                finish()
                if stripped == "SECONDARY WEAPON TABLES":
                    category = "Secondary"
                elif stripped == "Combat Wheelchair":
                    category = "Primary"
                continue
            if WEAPON_HEADER_RE.match(line):
                finish()
                continue

            stats = STATS_RE.match(line.rstrip())
            if stats:
                finish()
                row = {
                    "name": norm(stats.group("name")),
                    "trait": stats.group("trait"),
                    "range": stats.group("range"),
                    "damage": norm(stats.group("damage")),
                    "burden": stats.group("burden"),
                    "feature": stats.group("feature"),
                    "category": category,
                    "tier": int(stats.group("tier")) if stats.group("tier") else tier,
                }
                xpos = {key: stats.start(key) for key in
                        ("trait", "range", "damage", "burden", "feature")}
                continue

            if row is None or not xpos:
                continue
            # Continuation line: name text sits left of the trait column,
            # wrapped damage-type text inside the damage column, and the rest
            # belongs to the feature column.
            name_part = norm(line[:xpos["trait"]])
            damage_part = norm(line[xpos["damage"]:xpos["burden"]])
            feature_part = norm(line[xpos["burden"]:])
            if name_part:
                row["name"] = join_text(row["name"], name_part)
            if damage_part:
                row["damage"] = join_text(row["damage"], damage_part)
            if feature_part:
                row["feature"] = join_text(row["feature"], feature_part)
    finish()
    return weapons


# --------------------------------------------------------------------------
# Armor
# --------------------------------------------------------------------------

JUNK_ARMOR = ("Base", "Thresholds", "Score Feature", "ARMOR", "TIER", "Name")


def parse_armor() -> list[dict]:
    pages = run_pdftotext(72, 74, "raw")
    armor: list[dict] = []
    tier = 1
    current: dict | None = None

    def finish() -> None:
        nonlocal current
        if current:
            armor.append(current)
            current = None

    for page in pages:
        for line in page.splitlines():
            line = line.strip()
            if not line:
                continue
            if FOOTER_RE.match(line) or re.fullmatch(r"\d+", line):
                continue
            m_tier = TIER_RE.search(line)
            if m_tier and "(" in line:
                tier = int(m_tier.group(1))
                finish()
                continue
            if line.startswith(JUNK_ARMOR) or line.startswith("Every armor"):
                continue
            m = ARMOR_ROW_RE.match(line)
            if m and not line.startswith("Base"):
                finish()
                current = {
                    "id": "",
                    "name": norm(m.group(1)),
                    "tier": tier,
                    "baseThresholds": {"major": int(m.group(2)),
                                       "severe": int(m.group(3))},
                    "baseScore": int(m.group(4)),
                    "feature": parse_feature(m.group(5)),
                }
                continue
            if current:  # wrapped feature text
                feat = current["feature"]
                if feat:
                    feat["text"] = join_text(feat["text"], line)
                else:
                    current["feature"] = parse_feature(line)
    finish()
    return armor


# --------------------------------------------------------------------------
# Loot items / consumables (same table shape)
# --------------------------------------------------------------------------

def parse_roll_tables(first: int, last: int, labels: tuple[str, ...]) -> list[dict]:
    pages = run_pdftotext(first, last, "table")
    results: list[dict] = []
    current_label = labels[0]

    for page in pages:
        # Each table region on a page is a (region_start, region_end, roll_x,
        # loot_x, desc_x) tuple.  A page can hold two side-by-side tables.
        regions: list[tuple[int, int, int, int, int]] = []
        actives: list[dict | None] = []

        def flush(index: int | None = None) -> None:
            indexes = range(len(actives)) if index is None else [index]
            for i in indexes:
                rec = actives[i]
                if rec:
                    rec["name"] = norm(rec["name"])
                    rec["description"] = norm(rec["description"])
                    results.append(rec)
                    actives[i] = None

        for line in page.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if FOOTER_RE.match(stripped):
                continue
            for label in labels:
                if stripped == label or stripped.startswith(label + " "):
                    current_label = label
            if (any(stripped == label or stripped.startswith(label + " ")
                    for label in labels)
                    or stripped.startswith("The following table")):
                # Section heading between tables: close the running table so
                # its prose is not merged into the previous entry.
                flush()
                regions = []
                actives = []
                continue
            spans = list(LOOT_HEADER_RE.finditer(line))
            if spans:
                flush()
                regions = []
                actives = []
                for i, span in enumerate(spans):
                    start = span.start()
                    roll_x = line.index("ROLL", start)
                    loot_x = line.lower().index("loot", start)
                    desc_x = line.lower().index("description", start)
                    if i + 1 < len(spans):
                        end = spans[i + 1].start()
                    else:
                        # A trailing side-bar heading (e.g. "GOLD" on the last
                        # consumables page) marks where the table column ends.
                        tail = line[desc_x + len("description"):]
                        extra = re.search(r"\b[A-Z]{3,}\b", tail)
                        end = (desc_x + len("description") + extra.start()
                               if extra else 10 ** 6)
                    regions.append((start, end, roll_x, loot_x, desc_x))
                actives = [None] * len(regions)
                continue
            if not regions:
                continue

            for idx, (region_start, region_end, roll_x, loot_x, desc_x) in enumerate(regions):
                end = min(region_end, len(line))
                if line[region_start:end].strip() == "":
                    continue
                roll = line[roll_x:loot_x].strip() if roll_x < end else ""
                name = line[loot_x:desc_x] if loot_x < end else ""
                desc = line[desc_x:end] if desc_x < end else ""
                if re.fullmatch(r"\d{1,2}", roll):
                    flush(idx)
                    actives[idx] = {
                        "name": name,
                        "description": desc,
                        "roll": int(roll),
                        "table": current_label,
                    }
                elif actives[idx] is not None:
                    if name.strip():
                        actives[idx]["name"] = join_text(actives[idx]["name"], name)
                    if desc.strip():
                        actives[idx]["description"] = join_text(actives[idx]["description"], desc)
        flush()
    order = {label: i for i, label in enumerate(labels)}
    results.sort(key=lambda r: (order.get(r["table"], len(labels)), r["roll"]))
    return results


# --------------------------------------------------------------------------
# Conditions and ranges (two-column layout pages)
# --------------------------------------------------------------------------

def split_columns(page: str, width: int = 66) -> tuple[list[str], list[str]]:
    left, right = [], []
    for line in page.splitlines():
        left.append(line[:width])
        right.append(line[width:])
    return left, right


def parse_ranges() -> list[dict]:
    page = run_pdftotext(51, 51, "layout")[0]
    left, right = split_columns(page)
    entries: dict[str, str] = {}
    for column in (left, right):
        current = None
        buffer: list[str] = []
        for line in column:
            m = re.match(r"^\s+(%s):\s*(.*)$" % "|".join(RANGES), line)
            if m:
                if current:
                    entries[current] = norm(" ".join(buffer))
                current = m.group(1)
                buffer = [m.group(2)]
                continue
            if current:
                if line.strip() == "":
                    entries[current] = norm(" ".join(buffer))
                    current = None
                    buffer = []
                elif line.startswith("   "):
                    buffer.append(line.strip())
                else:
                    entries[current] = norm(" ".join(buffer))
                    current = None
                    buffer = []
        if current:
            entries[current] = norm(" ".join(buffer))
    return [{"id": slug(r), "name": r, "distance": entries.get(r, "")}
            for r in RANGES]


def parse_conditions() -> list[dict]:
    page = run_pdftotext(52, 52, "layout")[0]
    left, _ = split_columns(page)
    names = ("Hidden", "Restrained", "Vulnerable")
    entries: dict[str, str] = {}
    current = None
    buffer: list[str] = []

    def flush() -> None:
        nonlocal current, buffer
        if current:
            entries[current] = norm(" ".join(buffer))
        current, buffer = None, []

    for line in left:
        m = re.match(r"^\s{3}(HIDDEN|RESTRAINED|VULNERABLE)\s*$", line)
        if m:
            flush()
            current = m.group(1).title()
            continue
        if current:
            if line.strip() == "":
                if buffer:  # blank line after the paragraph closes it
                    flush()
            elif line.startswith("   "):
                buffer.append(line.strip())
            else:
                flush()
    flush()
    return [{"id": slug(n), "name": n, "text": entries.get(n, "")} for n in names]


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------

def unique_ids(records: list[dict], key: str = "id") -> None:
    seen: dict[str, int] = {}
    for rec in records:
        base = slug(rec["name"])
        n = seen.get(base, 0)
        seen[base] = n + 1
        rec[key] = base if n == 0 else f"{base}-{n + 1}"


def write_json(name: str, data) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    print(f"wrote {path} ({len(data)} entries)")


def main() -> None:
    weapons = parse_weapons()
    unique_ids(weapons)

    armor = parse_armor()
    unique_ids(armor)

    raw_items = parse_roll_tables(75, 79, ("Core Set Items", "Additional Items"))
    items = []
    for rec in raw_items:
        feature = None
        marker = "following feature."
        idx = rec["description"].find(marker)
        if idx >= 0:  # e.g. Valorstone, Bloodstone, Greatstone
            feature = parse_feature(rec["description"][idx + len(marker):])
        items.append({
            "id": "",
            "name": rec["name"],
            "description": rec["description"],
            "feature": feature,
        })
    unique_ids(items)

    consumables = parse_roll_tables(80, 84, ("Core Set Consumables",
                                             "Additional Consumables"))
    consumables = [{
        "id": "",
        "name": r["name"],
        "description": r["description"],
        "rollTable": {"name": r["table"], "roll": r["roll"]},
    } for r in consumables]
    unique_ids(consumables)

    conditions = parse_conditions()
    ranges = parse_ranges()

    write_json("weapons.json", weapons)
    write_json("armor.json", armor)
    write_json("items.json", items)
    write_json("consumables.json", consumables)
    write_json("conditions.json", conditions)
    write_json("ranges.json", ranges)


if __name__ == "__main__":
    main()
