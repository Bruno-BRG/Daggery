#!/usr/bin/env python3
"""Parse Daggerheart SRD raw text into character-creation JSON data.

Reads data/extract/srd_raw.txt (pdftotext reading-order output, Windows-1252)
and writes classes.json, domains.json, domain-cards.json, ancestries.json,
communities.json and transformations.json to packages/content/.

Python 3.12, standard library only.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRD_PATH = ROOT / "data" / "extract" / "srd_raw.txt"
OUT_DIR = ROOT / "packages" / "content"

CLASS_NAMES = [
    "Assassin", "Bard", "Brawler", "Druid", "Guardian", "Ranger",
    "Rogue", "Seraph", "Sorcerer", "Warlock", "Warrior", "Witch", "Wizard",
]

DOMAIN_NAMES = [
    "Arcana", "Blade", "Bone", "Codex", "Dread", "Grace",
    "Midnight", "Sage", "Splendor", "Valor",
]

NON_ANCESTRY_HEADINGS = {
    "ANCESTRIES", "ANCESTRY FEATURES", "ANCESTRY FEATURE",
    "ELEMENTAL KIN", "MIXED ANCESTRY",
}

FOOTER_RE = re.compile(r"^(?:\d+\s+Daggerheart SRD|Daggerheart SRD \d+)$")


# ---------------------------------------------------------------------------
# helpers

def read_lines() -> list[str]:
    data = SRD_PATH.read_bytes().decode("cp1252", errors="replace")
    lines = data.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return lines


def is_footer(line: str) -> bool:
    return bool(FOOTER_RE.match(line.strip()))


def slugify(text: str) -> str:
    text = text.lower().replace("'", "").replace("’", "")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text


_MINOR_WORDS = {"of", "the", "a", "an", "and", "or", "in", "on", "at", "to",
                "for", "with", "from", "by"}


def smart_title(text: str) -> str:
    """Title-case a heading, keeping minor words lowercase (e.g. Of The)."""
    words = text.split()
    out: list[str] = []
    for i, word in enumerate(words):
        low = word.lower()
        if i > 0 and low in _MINOR_WORDS:
            out.append(low)
        else:
            out.append(word[:1].upper() + word[1:].lower() if word.isupper() else word)
    return " ".join(out)


def is_all_caps_heading(line: str) -> bool:
    s = line.strip()
    if not s or is_footer(s):
        return False
    if len(s) > 60:
        return False
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 2:
        return False
    return all(c.isupper() for c in letters)


def find_exact(lines: list[str], needle: str, start: int = 0, end: int | None = None) -> int:
    end = len(lines) if end is None else end
    for i in range(start, end):
        if lines[i].strip() == needle:
            return i
    raise ValueError(f"Could not find line {needle!r}")


def find_index_after(lines: list[str], predicate, start: int, end: int | None = None) -> int | None:
    end = len(lines) if end is None else end
    for i in range(start, end):
        if predicate(lines[i]):
            return i
    return None


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def join_paragraphs(lines: list[str]) -> str:
    """Join raw lines into a single normalized paragraph string."""
    return clean_text(" ".join(lines))


# ---------------------------------------------------------------------------
# feature parsing

FEATURE_STOPWORDS = {
    "Tip", "Note", "Example", "For", "The", "You", "If", "When",
    "While", "Once", "In", "On", "As", "To", "Then", "This", "These",
    "That", "Those", "Each", "Additionally", "Level", "Spells",
    "During", "After", "Before", "Your", "Also", "Instead", "All", "Any",
    "Some", "Other", "Their", "They", "It", "Its", "With", "Without",
    "From", "By", "And", "Or", "But", "Because", "However", "Whenever",
    "Where", "What", "Who", "Why", "How", "Stress",
}

_CONNECTORS = {"of", "the", "a", "an", "and", "or", "in", "on", "at", "to",
               "for", "with", "from", "by", "is", "are"}


def _valid_feature_name(name: str) -> bool:
    if not name or name.split()[0] in FEATURE_STOPWORDS:
        return False
    words = name.replace("&", " & ").split()
    if not words or len(words) > 5:
        return False
    if name in FEATURE_STOPWORDS:
        return False
    for word in words:
        if word in ("&",):
            continue
        # hyphenated compounds: each part must look like a name word
        parts = word.split("-")
        for part in parts:
            if not part:
                continue
            if part[0].islower() and part.lower() not in _CONNECTORS:
                return False
    return True

# A feature starts at a line start ("Name: text" or "Name. text") or, when it
# continues a paragraph, after ". " ("Name: text").
_NAME = r"([A-Z][A-Za-z'’&\-]*(?: [A-Za-z'’&\-]+){0,4})"
FEATURE_START_LINE_RE = re.compile(
    r"(?m)^" + _NAME + r"(?::|\.)\s"
)
FEATURE_START_MID_RE = re.compile(
    r"(?<=\. )" + _NAME + r":\s"
)


def _feature_matches(text: str) -> list[tuple[int, int, str]]:
    matches: list[tuple[int, int, str]] = []
    for m in FEATURE_START_LINE_RE.finditer(text):
        name = m.group(1).strip()
        if not _valid_feature_name(name):
            continue
        matches.append((m.start(), m.end(), name))
    for m in FEATURE_START_MID_RE.finditer(text):
        name = m.group(1).strip()
        if not _valid_feature_name(name):
            continue
        matches.append((m.start(), m.end(), name))
    matches.sort(key=lambda x: x[0])
    # drop matches that overlap a previously accepted match
    deduped: list[tuple[int, int, str]] = []
    for start, end, name in matches:
        if deduped and start < deduped[-1][1]:
            continue
        deduped.append((start, end, name))
    return deduped


def parse_features(lines: list[str]) -> list[dict[str, str]]:
    text = "\n".join(lines).strip()
    if not text:
        return []
    matches = _feature_matches(text)
    if not matches:
        return [{"name": "", "text": clean_text(text)}]
    features: list[dict[str, str]] = []
    for idx, (start, end, name) in enumerate(matches):
        stop = matches[idx + 1][0] if idx + 1 < len(matches) else len(text)
        body = clean_text(text[end:stop])
        features.append({"name": name, "text": body})
    return features


def parse_bullets(lines: list[str]) -> list[str]:
    text = "\n".join(lines)
    text = text.replace("•", "·")
    fragments = re.split(r"·", text)
    out: list[str] = []
    for frag in fragments:
        frag = clean_text(frag)
        if not frag:
            continue
        low = frag.lower()
        if low.startswith(("answer any of the following", "ask your fellow players",
                           "you can also create your own")):
            continue
        # Strip a leading list marker if it survived.
        frag = re.sub(r"^(?:\d+[.)]|[-*])\s*", "", frag)
        if frag:
            out.append(frag)
    return out


# ---------------------------------------------------------------------------
# domains

def parse_domains(lines: list[str]) -> list[dict]:
    start = find_exact(lines, "DOMAINS", 100)
    end = find_exact(lines, "DOMAIN CARDS", start)
    domain_lines = lines[start:end]
    upper_names = {n.upper(): n for n in DOMAIN_NAMES}
    positions: list[tuple[str, int]] = []
    for i, line in enumerate(domain_lines):
        s = line.strip()
        if s in upper_names:
            positions.append((upper_names[s], i))
    domains: list[dict] = []
    for j, (name, idx) in enumerate(positions):
        stop = positions[j + 1][1] if j + 1 < len(positions) else len(domain_lines)
        body: list[str] = []
        for line in domain_lines[idx + 1:stop]:
            s = line.strip()
            if not s or is_footer(s):
                continue
            if s.startswith("Class Domains"):
                break
            body.append(s)
        description = join_paragraphs(body)
        # The final sentence names the classes; parse it for reference.
        classes: list[str] = []
        m = re.search(r"accessed by the (.*?) classes?", description)
        if m:
            chunk = m.group(1)
            for cls in CLASS_NAMES:
                if re.search(r"\b" + re.escape(cls) + r"\b", chunk):
                    classes.append(slugify(cls))
        domains.append({
            "id": slugify(name),
            "name": name,
            "description": description,
            "classes": classes,
        })
    return domains


# ---------------------------------------------------------------------------
# classes

SUBCLASSES_RE = re.compile(r"^([A-Z][A-Z '&]*?) SUBCLASSES$")
CHOOSE_RE = re.compile(r"Choose either the (.+?) or (.+?) subclass\.?")

SECTION_HEADING_RE = re.compile(
    r"^(?:CLASS FEATURES?|SPELLCAST TRAIT|FOUNDATION FEATURES?|"
    r"SPECIALIZATION FEATURES?|MASTERY FEATURES?|BACKGROUND QUESTIONS|"
    r"CONNECTIONS|SPHERE OF INFLUENCE EXAMPLES)$"
)

FEATURE_TYPE_RE = re.compile(
    r"^(FOUNDATION|SPECIALIZATION|MASTERY) FEATURES?$"
)


def _is_class_heading(line: str) -> str | None:
    s = line.strip()
    for cls in CLASS_NAMES:
        if s == cls.upper():
            return cls
    return None


def _block_end(lines: list[str], start: int, limit: int) -> int:
    """Find the end of a prose/feature block (exclusive index)."""
    i = start
    while i < limit:
        s = lines[i].strip()
        if is_footer(s):
            i += 1
            continue
        if is_all_caps_heading(s):
            return i
        i += 1
    return limit


def _hope_feature_class(line: str) -> str | None:
    s = line.strip()
    m = re.match(r"^([A-Z][A-Z ']+)'S HOPE FEATURE$", s)
    if not m:
        return None
    raw = m.group(1).strip().title()
    for cls in CLASS_NAMES:
        if raw == cls:
            return cls
    # title() mangles e.g. nothing here, but handle case-insensitively
    for cls in CLASS_NAMES:
        if raw.lower() == cls.lower():
            return cls
    return None


def parse_classes(lines: list[str], domains: list[dict]) -> list[dict]:
    start = find_exact(lines, "ASSASSIN", 100)
    end = find_exact(lines, "ANCESTRIES", start)

    class_positions: list[tuple[str, int]] = []
    for i in range(start, end):
        cls = _is_class_heading(lines[i])
        if cls:
            class_positions.append((cls, i))
    class_positions.sort(key=lambda x: x[1])

    # ---- subclass names, keyed by class
    subclass_names: dict[str, list[str]] = {}
    for i in range(start, end):
        m = SUBCLASSES_RE.match(lines[i].strip())
        if not m:
            continue
        raw = m.group(1).strip().title()
        cls = next((c for c in CLASS_NAMES if c.lower() == raw.lower()), None)
        if not cls:
            continue
        choose = find_index_after(
            lines, lambda ln: "Choose either the" in ln, i + 1, min(i + 4, end)
        )
        if choose is not None:
            cm = CHOOSE_RE.search(lines[choose])
            if cm:
                subclass_names[cls] = [cm.group(1).strip(), cm.group(2).strip()]

    # ---- class feature blocks (assigned to a class)
    class_block_by_class: dict[str, list[str]] = {}
    for i in range(start, end):
        if not re.match(r"^CLASS FEATURES?$", lines[i].strip()):
            continue
        block_end = _block_end(lines, i + 1, end)
        block = lines[i + 1:block_end]
        # Determine owner: the next heading may be "<CLASS> SUBCLASSES".
        owner = None
        if block_end < end:
            sm = SUBCLASSES_RE.match(lines[block_end].strip())
            if sm:
                raw = sm.group(1).strip().title()
                owner = next((c for c in CLASS_NAMES if c.lower() == raw.lower()), None)
        if owner is None:
            # nearest hope feature above
            for j in range(i - 1, start - 1, -1):
                hc = _hope_feature_class(lines[j])
                if hc:
                    owner = hc
                    break
        if owner is None:
            # nearest class heading above
            for j in range(i - 1, start - 1, -1):
                hc = _is_class_heading(lines[j])
                if hc:
                    owner = hc
                    break
        if owner:
            class_block_by_class.setdefault(owner, [])
            class_block_by_class[owner].extend(block)

    classes: list[dict] = []
    for ci, (cls, pos) in enumerate(class_positions):
        region_end = class_positions[ci + 1][1] if ci + 1 < len(class_positions) else end
        region = lines[pos:region_end]

        # description = first line after the heading
        description = clean_text(region[1]) if len(region) > 1 else ""

        joined = "\n".join(region)

        m = re.search(r"DOMAINS\s*-\s*(.*?)(?:\s+STARTING|\n|$)", joined)
        domain_names = [d.strip() for d in m.group(1).split("&")] if m else []
        domain_ids = [slugify(d) for d in domain_names if d]

        m = re.search(r"STARTING EVASION\s*-\s*(\d+)", joined)
        evasion = int(m.group(1)) if m else None

        m = re.search(r"STARTING HIT POINTS\s*-\s*(\d+)", joined)
        hp = int(m.group(1)) if m else None

        # class items, possibly wrapped onto the next line(s)
        items = ""
        item_idx = next((k for k, ln in enumerate(region) if "CLASS ITEMS -" in ln), None)
        if item_idx is not None:
            tail = region[item_idx].split("CLASS ITEMS -", 1)[1].strip()
            parts = [tail] if tail else []
            k = item_idx + 1
            while k < len(region):
                nxt = region[k]
                stripped = nxt.strip()
                if not stripped:
                    break
                if stripped[0].islower():
                    parts.append(stripped)
                    k += 1
                    continue
                break
            items = clean_text(" ".join(parts))

        # hope feature
        hope = {"name": "", "text": ""}
        hope_idx = next((k for k, ln in enumerate(region)
                         if re.match(r"^[A-Z][A-Z ']+'S HOPE FEATURE$", ln.strip())), None)
        if hope_idx is not None:
            block_end = _block_end(region, hope_idx + 1, len(region))
            feats = parse_features(region[hope_idx + 1:block_end])
            if feats:
                hope = {"name": feats[0]["name"], "text": feats[0]["text"]}

        class_features = parse_features(class_block_by_class.get(cls, []))

        # background questions / connections
        bg: list[str] = []
        conns: list[str] = []
        bg_idx = next((k for k, ln in enumerate(region)
                       if ln.strip() == "BACKGROUND QUESTIONS"), None)
        if bg_idx is not None:
            bg_end = next((k for k in range(bg_idx + 1, len(region))
                           if region[k].strip() == "CONNECTIONS"
                           or is_all_caps_heading(region[k])), len(region))
            bg = parse_bullets(region[bg_idx + 1:bg_end])
        conn_idx = next((k for k, ln in enumerate(region)
                         if ln.strip() == "CONNECTIONS"), None)
        if conn_idx is not None:
            conn_end = next((k for k in range(conn_idx + 1, len(region))
                             if _is_class_heading(region[k])
                             or region[k].strip() in ("BACKGROUND QUESTIONS", "Example Companion Experiences")
                             or is_all_caps_heading(region[k])), len(region))
            conns = parse_bullets(region[conn_idx + 1:conn_end])

        # subclasses
        subs = build_subclasses(lines, cls, subclass_names.get(cls, []), start, end)

        classes.append({
            "id": slugify(cls),
            "name": cls,
            "description": description,
            "domains": domain_ids,
            "startingEvasion": evasion,
            "startingHP": hp,
            "classItems": items,
            "hopeFeature": hope,
            "classFeatures": class_features,
            "subclasses": subs,
            "backgroundQuestions": bg,
            "connections": conns,
        })

    # Fill domains[].classes from class metadata (more reliable than the prose).
    by_domain: dict[str, list[str]] = {d["id"]: [] for d in domains}
    for c in classes:
        for did in c["domains"]:
            if did in by_domain:
                by_domain[did].append(c["id"])
    for d in domains:
        if by_domain.get(d["id"]):
            d["classes"] = by_domain[d["id"]]

    return classes


def build_subclasses(lines: list[str], cls: str, names: list[str],
                     region_start: int, region_end: int) -> list[dict]:
    """Locate and parse the two subclasses of a class."""
    upper_names = [n.upper() for n in names]
    # Zone: from the class's "<CLASS> SUBCLASSES" heading up to the next
    # "<CLASS> SUBCLASSES" heading (the next class's), which avoids pulling in
    # the next class's subclass material while tolerating column interleaving.
    try:
        zone_start = find_exact(lines, f"{cls.upper()} SUBCLASSES", region_start, region_end)
    except ValueError:
        zone_start = region_start
    zone_end = len(lines)
    for i in range(zone_start + 1, region_end):
        if SUBCLASSES_RE.match(lines[i].strip()):
            zone_end = i
            break

    # subclass heading positions
    heading_pos: dict[str, int] = {}
    for i in range(zone_start, zone_end):
        s = lines[i].strip()
        if s in upper_names:
            heading_pos.setdefault(s, i)
    ordered_names = [n for n in upper_names if n in heading_pos]
    if not ordered_names:
        ordered_names = upper_names

    def nearest_subclass(idx: int) -> str:
        previous = [(h, name) for name, h in heading_pos.items() if h <= idx]
        if previous:
            return max(previous)[1]
        following = [(h, name) for name, h in heading_pos.items() if h > idx]
        if following:
            return min(following)[1]
        return ordered_names[0]

    # collect feature blocks by type
    blocks_by_type: dict[str, list[dict]] = {
        "foundation": [], "specialization": [], "mastery": []
    }
    for i in range(zone_start, zone_end):
        m = FEATURE_TYPE_RE.match(lines[i].strip())
        if not m:
            continue
        ftype = m.group(1).lower()
        block_end = _block_end(lines, i + 1, zone_end)
        feats = parse_features(lines[i + 1:block_end])
        if not feats:
            continue
        blocks_by_type[ftype].append({
            "owner": nearest_subclass(i),
            "idx": i,
            "features": feats,
        })

    # descriptions
    descriptions: dict[str, str] = {}
    for name in ordered_names:
        h = heading_pos.get(name)
        if h is None:
            descriptions[name] = ""
            continue
        k = h + 1
        while k < zone_end and (not lines[k].strip() or is_footer(lines[k])):
            k += 1
        descriptions[name] = clean_text(lines[k]) if k < zone_end else ""

    # spellcast traits
    spellcast: dict[str, str | None] = {n: None for n in ordered_names}
    for i in range(zone_start, zone_end):
        if lines[i].strip() != "SPELLCAST TRAIT":
            continue
        k = i + 1
        while k < zone_end and (not lines[k].strip() or is_footer(lines[k])):
            k += 1
        if k >= zone_end:
            continue
        trait = lines[k].strip()
        owner = nearest_subclass(i)
        if owner not in spellcast or spellcast[owner] is None:
            spellcast[owner] = trait

    # rebalance blocks: each subclass should own one block per type
    for ftype, blocks in blocks_by_type.items():
        counts = {n: sum(1 for b in blocks if b["owner"] == n) for n in ordered_names}
        if len(ordered_names) != 2:
            continue
        for _ in range(6):
            targets = [n for n in ordered_names if counts[n] == 0]
            sources = [n for n in ordered_names if counts[n] > 1]
            if not targets or not sources:
                break
            target = targets[0]
            source = max(sources, key=lambda n: counts[n])
            target_feature_names = []
            for b in blocks:
                if b["owner"] == target:
                    target_feature_names.extend(f["name"] for f in b["features"])
            if not target_feature_names:
                target_feature_names = [target]
            source_feature_names = []
            for b in blocks:
                if b["owner"] == source:
                    source_feature_names.extend(f["name"] for f in b["features"])
            source_feature_names = [n for n in source_feature_names if n]

            def score(block, names_to_find):
                body = " ".join(f["name"] + " " + f["text"] for f in block["features"]).lower()
                hits = 0
                for nm in names_to_find:
                    if nm and nm.lower() in body:
                        hits += 1
                return hits

            candidates = [b for b in blocks if b["owner"] == source]
            candidates.sort(key=lambda b: (-score(b, target_feature_names), score(b, source_feature_names)))
            chosen = candidates[0]
            chosen["owner"] = target
            counts[source] -= 1
            counts[target] += 1

    result: list[dict] = []
    for name in ordered_names:
        entry = {
            "id": slugify(name),
            "name": smart_title(name) if name.isupper() else name,
            "description": descriptions.get(name, ""),
            "spellcastTrait": spellcast.get(name),
            "foundation": [],
            "specialization": [],
            "mastery": [],
        }
        for ftype in ("foundation", "specialization", "mastery"):
            for b in blocks_by_type[ftype]:
                if b["owner"] == name:
                    entry[ftype].extend(b["features"])
        result.append(entry)
    return result


# ---------------------------------------------------------------------------
# domain cards

LEVEL_RE = re.compile(
    r"^Level (\d+) (Arcana|Blade|Bone|Codex|Dread|Grace|Midnight|Sage|Splendor|Valor) "
    r"(Spell|Ability|Grimoire) Recall Cost: (\d+)\s*(.*)$"
)


def parse_domain_cards(lines: list[str]) -> list[dict]:
    start = find_exact(lines, "Domain Card reference", 9000)
    section = lines[start:]

    # indices of card level lines
    card_indices: list[int] = []
    for i, line in enumerate(section):
        if LEVEL_RE.match(line.strip()):
            card_indices.append(i)

    cards: list[dict] = []
    used_ids: set[str] = set()
    for n, idx in enumerate(card_indices):
        m = LEVEL_RE.match(section[idx].strip())
        if not m:
            continue
        level, domain, ctype, cost, same_line = m.groups()
        # title: last non-empty, non-footer line before the level line
        t = idx - 1
        while t >= 0 and (not section[t].strip() or is_footer(section[t])):
            t -= 1
        title = clean_text(section[t]) if t >= 0 else ""
        if not title or LEVEL_RE.match(title) or len(title) > 70:
            continue

        body_end = card_indices[n + 1] if n + 1 < len(card_indices) else len(section)
        # Stop the body before the next card's title (which precedes its level line).
        if n + 1 < len(card_indices):
            nt = card_indices[n + 1] - 1
            while nt >= 0 and (not section[nt].strip() or is_footer(section[nt])):
                nt -= 1
            if nt > idx:
                body_end = nt
        body_lines: list[str] = []
        if same_line.strip():
            body_lines.append(same_line.strip())
        for line in section[idx + 1:body_end]:
            s = line.strip()
            if not s or is_footer(s):
                continue
            if s.endswith(" DOMAIN") and s.split()[0] in {d.upper() for d in DOMAIN_NAMES}:
                continue
            body_lines.append(s)

        cid = slugify(title)
        if cid in used_ids:
            cid = f"{slugify(domain)}-{cid}"
        used_ids.add(cid)
        cards.append({
            "id": cid,
            "name": title,
            "domain": slugify(domain),
            "level": int(level),
            "type": ctype,
            "recallCost": int(cost),
            "text": join_paragraphs(body_lines),
        })
    # Group by domain (SRD domain order) and then by level.
    domain_order = {slugify(n): i for i, n in enumerate(DOMAIN_NAMES)}
    cards.sort(key=lambda c: (domain_order.get(c["domain"], 99), c["level"]))
    return cards


# ---------------------------------------------------------------------------
# ancestries

def _ancestry_variants(name: str) -> list[str]:
    base = name.title()
    out = {base, base + "s", base + "es"}
    if name.lower() == "dwarf":
        out.add("Dwarves")
    if name.lower() == "elf":
        out.add("Elves")
    if name.lower() == "faerie":
        out.add("Faeries")
    return sorted(out, key=len, reverse=True)


def _desc_start_indices(lines: list[str], names: list[str], start: int,
                        end: int) -> dict[str, int]:
    result: dict[str, int] = {}
    for name in names:
        variants = _ancestry_variants(name)
        for i in range(start, end):
            s = lines[i].strip()
            if not s or is_footer(s) or is_all_caps_heading(s):
                continue
            if ": " in s[:50]:
                continue
            for v in variants:
                if s.startswith(v + " ") or s.startswith(v + ","):
                    result.setdefault(name, i)
                    break
            if name in result:
                break
    return result


def parse_ancestries(lines: list[str]) -> list[dict]:
    start = find_exact(lines, "ANCESTRIES", 1000)
    end = find_exact(lines, "COMMUNITIES", start)
    section = lines[start:end]

    names: list[str] = []
    for line in section:
        s = line.strip()
        if is_all_caps_heading(s) and s not in NON_ANCESTRY_HEADINGS:
            if s not in names:
                names.append(s)

    desc_starts = _desc_start_indices(lines, names, start, end)
    desc_start_idx = {n: desc_starts.get(n) for n in names}

    # find feature blocks
    blocks: list[dict] = []
    for i in range(start, end):
        if not re.match(r"^ANCESTRY FEATURES?$", lines[i].strip()):
            continue
        j = i + 1
        block_lines: list[str] = []
        while j < end:
            s = lines[j].strip()
            if is_footer(s):
                j += 1
                continue
            if not s:
                j += 1
                continue
            if is_all_caps_heading(s):
                break
            block_lines.append(lines[j])
            j += 1
        feats = parse_features(block_lines)
        if feats and any(f["name"] for f in feats):
            blocks.append({"idx": i, "features": feats})

    # descriptions
    descriptions: dict[str, str] = {}
    for name in names:
        ds = desc_start_idx.get(name)
        if ds is None:
            descriptions[name] = ""
            continue
        other_starts = {v for k, v in desc_start_idx.items() if k != name and v is not None}
        paras: list[str] = []
        j = ds
        while j < end:
            s = lines[j].strip()
            if j != ds:
                if is_footer(s):
                    j += 1
                    continue
                if not s:
                    j += 1
                    continue
                if is_all_caps_heading(s) or j in other_starts:
                    break
            paras.append(s)
            j += 1
        descriptions[name] = join_paragraphs(paras)

    # assign feature blocks to ancestries by description keyword match, then order
    all_names_lower = {n: descriptions.get(n, "").lower() for n in names}
    token_re = re.compile(r"[A-Za-z][A-Za-z'\-]+")
    stop = {"gain", "when", "once", "your", "their", "with", "this", "that",
            "from", "while", "each", "have", "make", "mark", "spend", "you",
            "the", "and", "for", "bonus", "during", "after", "creature",
            "creatures", "damage", "attack", "roll", "rolls", "range", "action"}

    def block_score(block: dict, name: str) -> int:
        body = all_names_lower.get(name, "")
        score = 0
        for feat in block["features"]:
            for word in set(token_re.findall(feat["name"].lower())):
                if len(word) >= 4 and word not in stop and word in body:
                    score += 1
        return score

    assignment: dict[str, dict] = {}
    remaining_blocks = list(blocks)
    remaining_names = list(names)
    # greedy on *strong* description matches; weak/ambiguous blocks fall back
    # to document order (the SRD lists ancestries and their cards in the same
    # order, with only isolated column-order swaps).
    while remaining_blocks and remaining_names:
        best = None
        for block in remaining_blocks:
            for name in remaining_names:
                sc = block_score(block, name)
                if sc >= 2 and (best is None or sc > best[0]):
                    best = (sc, block, name)
        if best is None:
            break
        _, block, name = best
        assignment[name] = block
        remaining_blocks.remove(block)
        remaining_names.remove(name)

    # fallback: document order
    remaining_blocks.sort(key=lambda b: b["idx"])
    for name, block in zip(remaining_names, remaining_blocks):
        assignment[name] = block

    result: list[dict] = []
    for name in names:
        block = assignment.get(name)
        result.append({
            "id": slugify(name),
            "name": smart_title(name),
            "description": descriptions.get(name, ""),
            "features": block["features"] if block else [],
        })
    return result


# ---------------------------------------------------------------------------
# communities

NON_COMMUNITY_HEADINGS = {"COMMUNITIES", "COMMUNITY FEATURE",
                          "T R A N S F O R M AT I O N S", "TRANSFORMATIONS"}


def parse_communities(lines: list[str]) -> list[dict]:
    start = find_exact(lines, "COMMUNITIES", 1000)
    end = next((i for i in range(start + 1, len(lines))
                if "T R A N S F O R M" in lines[i] or lines[i].strip() == "TRANSFORMATIONS"),
               len(lines))
    section = lines[start:end]

    names: list[str] = []
    for line in section:
        s = line.strip()
        if is_all_caps_heading(s) and s not in NON_COMMUNITY_HEADINGS:
            if s not in names:
                names.append(s)

    def desc_start(name: str) -> int | None:
        lower = name.lower()
        for i in range(start, end):
            s = lines[i].strip()
            if re.match(rf"^Being part of an? {re.escape(lower)} community means", s):
                return i
        if name == "REBORNE":
            for i in range(start, end):
                if lines[i].strip().startswith("You were once a member of a different community"):
                    return i
        return None

    def adjective_idx(name: str) -> int | None:
        pat = re.compile(rf"^{re.escape(name.title())} are often\b")
        for i in range(start, end):
            if pat.match(lines[i].strip()):
                return i
        return None

    desc_starts = {n: desc_start(n) for n in names}
    adj = {n: adjective_idx(n) for n in names}

    descriptions: dict[str, str] = {}
    for name in names:
        ds = desc_starts.get(name)
        if ds is None:
            descriptions[name] = ""
            continue
        adj_idx = adj.get(name)
        boundary = {v for k, v in desc_starts.items() if k != name and v is not None}
        paras: list[str] = []
        j = ds
        while j < end:
            s = lines[j].strip()
            if j != ds:
                if is_footer(s):
                    j += 1
                    continue
                if not s:
                    j += 1
                    continue
                if s == "COMMUNITY FEATURE" or j in boundary:
                    break
                if adj_idx is not None and j == adj_idx:
                    break
            paras.append(s)
            j += 1
        text = join_paragraphs(paras)
        if adj_idx is not None:
            adjectives = clean_text(lines[adj_idx])
            if adjectives and adjectives not in text:
                text = (text + " " + adjectives).strip()
        descriptions[name] = text

    # features: the COMMUNITY FEATURE block right after each adjective line
    features: dict[str, list[dict[str, str]]] = {n: [] for n in names}
    unassigned: list[tuple[int, list[dict[str, str]]]] = []
    for name in names:
        ai = adj.get(name)
        if ai is None:
            continue
        block_start = None
        for i in range(ai + 1, min(ai + 10, end)):
            s = lines[i].strip()
            if is_footer(s) or not s:
                continue
            if s == "COMMUNITY FEATURE":
                block_start = i
                break
            break
        if block_start is None:
            continue
        be = _block_end(lines, block_start + 1, end)
        feats = parse_features(lines[block_start + 1:be])
        if feats:
            features[name] = feats[0:1]

    # fallback: assign remaining feature blocks sequentially
    missing = [n for n in names if not features[n]]
    if missing:
        blocks = []
        for i in range(start, end):
            if lines[i].strip() != "COMMUNITY FEATURE":
                continue
            be = _block_end(lines, i + 1, end)
            feats = parse_features(lines[i + 1:be])
            if feats:
                blocks.append(feats[0:1])
        if len(blocks) == len(names):
            for name, blk in zip(names, blocks):
                if not features[name]:
                    features[name] = blk

    result: list[dict] = []
    for name in names:
        result.append({
            "id": slugify(name),
            "name": smart_title(name),
            "description": descriptions.get(name, ""),
            "features": features.get(name, []),
        })
    return result


# ---------------------------------------------------------------------------
# transformations

NON_TRANSFORMATION_HEADINGS = {
    "TRANSFORMATIONS", "GRANTING TRANSFORMATIONS",
    "TRANSFORMATION FEATURES", "TRANSFORMATION QUESTIONS",
    "T R A N S F O R M AT I O N S",
}


def _transformation_variants(name: str) -> list[str]:
    base = name.title()
    out = {base, base + "s", base + "es"}
    if name.lower().endswith("f"):
        out.add(base[:-1] + "ves")
    return sorted(out, key=len, reverse=True)


def parse_transformations(lines: list[str]) -> list[dict]:
    try:
        start = next(i for i in range(1000, len(lines))
                     if "T R A N S F O R M" in lines[i] or lines[i].strip() == "TRANSFORMATIONS")
    except StopIteration:
        return []
    end = find_exact(lines, "CORE MECHANICS", start)
    section = lines[start:end]

    names: list[str] = []
    for line in section:
        s = line.strip()
        if is_all_caps_heading(s) and s not in NON_TRANSFORMATION_HEADINGS:
            if s not in names:
                names.append(s)

    # description start for each
    desc_starts: dict[str, int] = {}
    for name in names:
        variants = _transformation_variants(name)
        for i in range(start, end):
            s = lines[i].strip()
            if not s or is_footer(s) or is_all_caps_heading(s):
                continue
            if ": " in s[:50]:
                continue
            if any(s.startswith(v + " ") for v in variants):
                desc_starts[name] = i
                break

    result: list[dict] = []
    for name in names:
        ds = desc_starts.get(name)
        if ds is None:
            result.append({"id": slugify(name), "name": smart_title(name),
                           "description": "", "features": [], "questions": []})
            continue
        # description until TRANSFORMATION FEATURES
        j = ds
        desc_lines: list[str] = []
        while j < end and lines[j].strip() != "TRANSFORMATION FEATURES":
            s = lines[j].strip()
            if s and not is_footer(s):
                desc_lines.append(s)
            j += 1
        description = join_paragraphs(desc_lines)

        # features
        feats: list[dict[str, str]] = []
        if j < end and lines[j].strip() == "TRANSFORMATION FEATURES":
            k = j + 1
            feat_lines: list[str] = []
            while k < end and lines[k].strip() != "TRANSFORMATION QUESTIONS":
                s = lines[k].strip()
                if s and not is_footer(s):
                    feat_lines.append(lines[k])
                k += 1
            feats = parse_features(feat_lines)
            j = k

        # questions
        questions: list[str] = []
        if j < end and lines[j].strip() == "TRANSFORMATION QUESTIONS":
            k = j + 1
            q_lines: list[str] = []
            while k < end:
                s = lines[k].strip()
                if is_all_caps_heading(s):
                    break
                q_lines.append(lines[k])
                k += 1
            questions = parse_bullets(q_lines)

        result.append({
            "id": slugify(name),
            "name": smart_title(name),
            "description": description,
            "features": feats,
            "questions": questions,
        })
    return result


# ---------------------------------------------------------------------------
# main

def write_json(name: str, data) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path} ({len(data)} entries)")


def main() -> int:
    if not SRD_PATH.exists():
        print(f"missing source: {SRD_PATH}", file=sys.stderr)
        return 1
    lines = read_lines()

    domains = parse_domains(lines)
    classes = parse_classes(lines, domains)
    cards = parse_domain_cards(lines)
    ancestries = parse_ancestries(lines)
    communities = parse_communities(lines)
    transformations = parse_transformations(lines)

    write_json("domains.json", domains)
    write_json("classes.json", classes)
    write_json("domain-cards.json", cards)
    write_json("ancestries.json", ancestries)
    write_json("communities.json", communities)
    write_json("transformations.json", transformations)

    print("\ncounts:")
    print(f"  classes: {len(classes)}")
    print(f"  domains: {len(domains)}")
    print(f"  domain cards: {len(cards)}")
    for d in DOMAIN_NAMES:
        n = sum(1 for c in cards if c["domain"] == slugify(d))
        print(f"    {d}: {n}")
    print(f"  ancestries: {len(ancestries)}")
    print(f"  communities: {len(communities)}")
    print(f"  transformations: {len(transformations)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
