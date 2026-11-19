#!/usr/bin/env python3
"""Builds packages/shared/src/lodestar-oracles.ts from sources/Ironsworn-Lodestar-Digital.pdf.

    python3 tools/build_lodestar_oracles.py

Needs `pdftotext` (poppler). It reads the d100 oracle tables of Ironsworn Lodestar, checks that
every column covers 1 to 100 with no gap or overlap (00 counts as 100), and writes the TypeScript
data file. The text of the tables is (c) Shawn Tomkin, CC BY-NC-SA 4.0; see sources/IRONSWORN-LODESTAR.md.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / 'sources' / 'Ironsworn-Lodestar-Digital.pdf'
OUT = ROOT / 'packages' / 'shared' / 'src' / 'lodestar-oracles.ts'

text = subprocess.run(['pdftotext', '-layout', '-f', '19', '-l', '36', str(PDF), '-'], check=True, capture_output=True, text=True).stdout
lines = text.split('\n')

IGNORED = []
RANGE = re.compile(r'^(\d{1,3})(?:-(\d{1,3}))?$')
RANGE_TEXT = re.compile(r'^(\d{1,3})(?:-(\d{1,3}))?\s+(\S.*)$')
SEGMENT = re.compile(r'\S+(?: \S+)*')


def number(raw):
    value = int(raw)
    return 100 if raw == '00' else value


def section(start, end=None):
    """Lines between a heading line (exact match, start of line) and the next heading."""
    first = next(i for i, line in enumerate(lines) if line.strip() == start or line.startswith(start + '  '))
    stop = len(lines)
    if end:
        stop = next(i for i, line in enumerate(lines) if i > first and (line.strip() == end or line.startswith(end + '  ')))
    return lines[first + 1:stop]


def parse_cells(block, window=None):
    """Reads cells of (from, to, text) from a block laid out in text columns, joining wrapped lines."""
    cells = []  # each: dict(from, to, text, start)
    for raw in block:
        line = raw[window[0]:window[1]] if window else raw
        if not line.strip() or line.strip().isdigit():
            # Blank lines and bare page numbers.
            continue
        base = window[0] if window else 0
        current = None
        for match in SEGMENT.finditer(line):
            seg, pos = match.group(0), match.start()
            pure = RANGE.match(seg)
            with_text = RANGE_TEXT.match(seg)
            if pure or with_text:
                m = pure or with_text
                low = number(m.group(1))
                high = number(m.group(2)) if m.group(2) else low
                if m.group(2) == '00' or m.group(1) == '00':
                    high = 100 if m.group(2) == '00' else high
                cell = {'from': low, 'to': high, 'text': with_text.group(3) if with_text else '', 'start': pos + (len(seg) - len(with_text.group(3)) if with_text else 0)}
                cells.append(cell)
                current = cell
            elif current is not None and not current['text']:
                current['text'] = seg
                current['start'] = pos
            else:
                # A wrapped line: attach it to the nearest cell by where its text begins.
                target = None
                for cell in reversed(cells):
                    if cell['text'] and abs(cell['start'] - pos) <= 3:
                        target = cell
                        break
                if target is None:
                    # Intro paragraphs before the first row and notes after the last one are not table text.
                    IGNORED.append(seg)
                    continue
                target['text'] += ' ' + seg
    return cells


def table_rows(cells):
    return sorted(((c['from'], c['to'], c['text'].strip()) for c in cells), key=lambda row: row[0])


def check(name, rows):
    expected = 1
    for low, high, label in rows:
        if low != expected or high < low or not label:
            raise SystemExit(f'{name}: row {low}-{high} {label!r} breaks the 1-100 sequence at {expected}')
        expected = high + 1
    if expected != 101:
        raise SystemExit(f'{name}: ends at {expected - 1}, not 100')
    return rows


# ------------------------------------------------------------------------------ hand-read blocks
# The Settlement Name oracle nests: a category roll, then ten examples per category.
SETTLEMENT = {
    'A feature of the landscape': ['Highmount', 'Brackwater', 'Frostwood', 'Redcrest', 'Grimtree', 'Stoneford', 'Deepwater', 'Whitefall', 'Graycliff', 'Three Rivers'],
    'A manmade edifice': ['Whitebridge', 'Lonefort', 'Highcairn', 'Redhall', 'Darkwell', 'Timberwall', 'Stonetower', 'Thornhall', 'Cinderhome', 'Fallowfield'],
    'A creature': ['Ravencliff', 'Bearmark', 'Wolfcrag', 'Eaglespire', "Wyvern's Rest", 'Boarwood', 'Foxhollow', 'Elderwatch', 'Elkfield', 'Dragonshadow'],
    'A historical event': ['Swordbreak', "Fool's Fall", 'Firstmeet', 'Brokenhelm', 'Mournhaunt', "Olgar's Stand", 'Lostwater', "Rojirra's Lament", 'Lastmarch', 'Rockfall'],
    'A word in an Old World language': ['Abon', 'Daveza', 'Damula', 'Essus', 'Sina', 'Kazeera', 'Khazu', 'Sova', 'Nabuma', 'Tiza'],
    'A season or environmental aspect': ['Winterhome', 'Windhaven', 'Stormrest', 'Bleakfrost', 'Springtide', 'Duskmoor', 'Frostcrag', 'Springbrook', 'Icebreak', 'Summersong'],
    'Something else': ['A trade good (Ironhome)', 'An Old World city (New Arkesh)', "A founder or famous settler (Kei's Hall)", 'A god (Elisora)', 'A historical item (Blackhelm)',
                       'A firstborn race (Elfbrook)', 'An elvish word or name (Nessana)', 'A mythic belief or event (Ghostwalk)', 'A positive term (Hope)', 'A negative term (Forsaken)'],
}
SETTLEMENT_PROMPTS = {
    'A feature of the landscape': 'Envision what it is. What makes it unusual or distinctive?',
    'A manmade edifice': 'What is it? Why is it important to this settlement’s history?',
    'A creature': 'Why have the people of this settlement chosen this creature as their totem? How is it represented in art or rituals?',
    'A historical event': 'What happened here? What place or practice commemorates this event?',
    'A word in an Old World language': 'What culture is represented by this word? What does it translate to?',
    'A season or environmental aspect': 'What influence does the weather have on this settlement?',
    'Something else': 'Pick an example, or invent one that fits.',
}
SETTLEMENT_RANGES = [(1, 15), (16, 30), (31, 45), (46, 60), (61, 75), (76, 90), (91, 100)]
TEN = [(i * 10 + 1, i * 10 + 10) for i in range(10)]

CHALLENGE = [
    (1, 20, 'Troublesome', 'A challenging quest with a small number of obstacles', 'Traveling a moderate distance within a single region', 'Common enemies'),
    (21, 55, 'Dangerous', 'An involved quest with several tough obstacles', 'Traveling a long distance within a single region, or across rough terrain', 'Capable fighters and deadly creatures'),
    (56, 80, 'Formidable', 'A complex quest with many intimidating obstacles', 'Traveling from one region to another, or across especially challenging terrain', 'Exceptional fighters and mighty creatures'),
    (81, 93, 'Extreme', 'An overwhelming quest of staggering proportions', 'Traveling through multiple regions', 'Foes of overwhelming skill or power'),
    (94, 100, 'Epic', 'A life-defining quest of unknowable scope', 'Traveling from one end of the Ironlands to another, or to a separate land', 'Legendary foes of mythic power'),
]


def quick_settlement(block):
    rows = []
    for raw in block:
        segs = SEGMENT.findall(raw)
        for i in range(0, len(segs) - 2, 3):
            m = RANGE.match(segs[i])
            if m:
                rows.append((number(m.group(1)), number(m.group(2)) if m.group(2) else number(m.group(1)), segs[i + 1], segs[i + 2]))
    rows.sort()
    return rows


def other_names(block):
    columns = {'Giants': [], 'Varou': [], 'Trolls': []}
    for raw in block:
        segs = SEGMENT.findall(raw)
        if len(segs) == 4 and RANGE.match(segs[0]):
            m = RANGE.match(segs[0])
            low, high = number(m.group(1)), number(m.group(2))
            for name, value in zip(columns, segs[1:]):
                columns[name].append((low, high, value))
    return columns


def esc(value):
    return value.replace('\\', '\\\\').replace("'", "\\'")


def ts_rows(rows):
    return '[' + ', '.join(f"[{low}, {high}, '{esc(label)}']" for low, high, label in rows) + ']'


tables = []  # (id, title, group, intro, [(label, rows, note)])


def add(id, title, group, intro, columns):
    tables.append((id, title, group, intro, columns))


def single(name, block, window=None):
    return check(name, table_rows(parse_cells(block, window)))


# ------------------------------------------------------------------------------ the tables
start = next(i for i, l in enumerate(lines) if 'The harm is mortal' in l)
end = next(i for i, l in enumerate(lines) if 'You are battered but still standing' in l)
add('endure-harm', 'Endure Harm', 'moves', 'When you miss on Endure Harm with no health left, roll here.', [('Result', single('endure-harm', lines[start:end + 1], (0, 52)), '')])
start = next(i for i, l in enumerate(lines) if 'You are overwhelmed. Face Desolation' in l)
end = next(i for i, l in enumerate(lines) if 'You persevere.' in l)
add('endure-stress', 'Endure Stress', 'moves', 'When you miss on Endure Stress with no spirit left, roll here.', [('Result', single('endure-stress', lines[start:end + 1], (0, 56)), '')])
start = next(i for i, l in enumerate(lines) if l.startswith('1-2      Roll again and apply'))
end = next(i for i, l in enumerate(lines) if l.startswith('99-00    Roll twice more'))
add('pay-the-price', 'Pay the Price', 'moves', 'When you suffer the outcome of a move.', [('Result', single('pay-the-price', lines[start:end + 3], (0, 55)), '')])

add('action', 'Action', 'prompt', 'Inspires a discovery, event, goal or situation. Combine with Theme for an action and a subject.', [('Action', single('action', section('ACTION', 'THEME')), '')])
add('theme', 'Theme', 'prompt', 'Answers questions or builds a situation. Combine with Action.', [('Theme', single('theme', section('THEME', 'REGION')), '')])

add('region', 'Region', 'place', 'Picks a region of the Ironlands at random.', [('Region', single('region', section('REGION', 'LOCATION')), '')])
add('location', 'Location', 'place', 'A point of interest while traveling, or where someone or something can be found.', [('Location', single('location', section('LOCATION', 'COASTAL WATERS LOCATION')), '')])
add('coastal-location', 'Coastal Waters Location', 'place', 'A point of interest or destination when traveling by ship or boat.', [('Location', single('coastal-location', section('COASTAL WATERS LOCATION', 'LOCATION DESCRIPTOR')), '')])
add('location-descriptor', 'Location Descriptor', 'place', 'Adds detail to a Location, or describes a place by itself. Roll more than once for more detail.', [('Descriptor', single('location-descriptor', section('LOCATION DESCRIPTOR', 'SETTLEMENT NAME')), '')])

settlement_columns = [('Category', [(low, high, f'{name}. {SETTLEMENT_PROMPTS[name]}') for (low, high), name in zip(SETTLEMENT_RANGES, SETTLEMENT)], 'Roll once for the category, then once for an example.')]
for name, examples in SETTLEMENT.items():
    settlement_columns.append((name, [(low, high, example) for (low, high), example in zip(TEN, examples)], ''))
for label, rows, _ in settlement_columns:
    expected = 1
    for low, high, _t in rows:
        if low != expected:
            raise SystemExit(f'settlement-name/{label}: gap at {expected}')
        expected = high + 1
    if expected != 101:
        raise SystemExit(f'settlement-name/{label}: ends at {expected - 1}')
add('settlement-name', 'Settlement Name', 'settlement', 'Roll for the category, then again for an example. Or keep the category and invent a name that fits.', settlement_columns)

quick = quick_settlement(section('QUICK SETTLEMENT NAME GENERATOR', 'SETTLEMENT TROUBLE'))
add('quick-settlement-name', 'Quick Settlement Name', 'settlement', 'Roll once for the prefix and once for the suffix. If it does not work, check adjacent rows or reverse the digits.',
    [('Prefix', check('quick prefix', [(a, b, c) for a, b, c, _d in quick]), ''), ('Suffix', check('quick suffix', [(a, b, d) for a, b, _c, d in quick]), '')])
add('settlement-trouble', 'Settlement Trouble', 'settlement', 'A hook for a problem a community faces, or a vow for your hero.', [('Trouble', single('settlement-trouble', section('SETTLEMENT TROUBLE', 'CHARACTER ROLE')), '')])

add('character-role', 'Character Role', 'character', 'A background for a character, or a random encounter.', [('Role', single('character-role', section('CHARACTER ROLE', 'CHARACTER GOAL')), '')])
add('character-goal', 'Character Goal', 'character', 'The motivation of an NPC or faction, or the start of a personal quest.', [('Goal', single('character-goal', section('CHARACTER GOAL', 'CHARACTER DESCRIPTOR')), '')])
add('character-descriptor', 'Character Descriptor', 'character', 'Personality or looks. Roll more than once for more detail.', [('Descriptor', single('character-descriptor', section('CHARACTER DESCRIPTOR', 'CHARACTER DISPOSITION')), '')])
add('character-disposition', 'Character Disposition', 'character', 'The tone of a first meeting with an NPC or faction.', [('Disposition', single('character-disposition', section('CHARACTER DISPOSITION', 'IRONLANDER NAMES')), '')])

names_block = section('IRONLANDER NAMES', 'ELF NAMES')
# The second table starts on the next page, under its own "NAME ORACLES" running header.
page_break = next(i for i, l in enumerate(names_block) if l.strip() == 'NAME ORACLES')
add('ironlander-names-a', 'Ironlander Names (first table)', 'names', 'Surnames are not used in the Ironlands, and names are often gender-neutral. Roll on either table.', [('Name', single('ironlander-a', names_block[:page_break]), '')])
add('ironlander-names-b', 'Ironlander Names (second table)', 'names', 'The second Ironlander name table.', [('Name', single('ironlander-b', names_block[page_break + 1:]), '')])
add('elf-names', 'Elf Names', 'names', 'A name for an elf character.', [('Name', single('elf-names', section('ELF NAMES', 'OTHER NAMES')), '')])
others = other_names(section('OTHER NAMES', 'COMBAT ACTION'))
add('other-names', 'Other Names', 'names', 'Names for other firstborn characters.', [(name, check(f'other-{name}', rows), '') for name, rows in others.items()])

add('combat-action', 'Combat Action', 'turning', 'Inspires an action for a foe, especially when it has initiative.', [('Action', single('combat-action', section('COMBAT ACTION', 'MYSTIC BACKLASH')), '')])
add('mystic-backlash', 'Mystic Backlash', 'turning', 'When magic goes wrong. Add to or replace Pay the Price after a failed ritual.', [('Backlash', single('mystic-backlash', section('MYSTIC BACKLASH', 'MAJOR PLOT TWIST')), '')])
add('major-plot-twist', 'Major Plot Twist', 'turning', 'A narrative surprise. Use it for a match at a crucial moment.', [('Twist', single('major-plot-twist', section('MAJOR PLOT TWIST', 'CHALLENGE RANK')), '')])
add('challenge-rank', 'Challenge Rank', 'turning', 'Picks the rank of a quest, a journey, or a foe at random.',
    [('Rank', check('challenge rank', [(a, b, c) for a, b, c, _q, _j, _f in CHALLENGE]), ''), ('Quest', check('challenge quest', [(a, b, q) for a, b, _c, q, _j, _f in CHALLENGE]), ''),
     ('Journey', check('challenge journey', [(a, b, j) for a, b, _c, _q, j, _f in CHALLENGE]), ''), ('Foes', check('challenge foes', [(a, b, f) for a, b, _c, _q, _j, f in CHALLENGE]), '')])

# ------------------------------------------------------------------------------ write
out = [
    '/**',
    ' * The d100 oracle tables of Ironsworn Lodestar (Shawn Tomkin, CC BY-NC-SA 4.0).',
    ' *',
    ' * GENERATED by tools/build_lodestar_oracles.py from sources/Ironsworn-Lodestar-Digital.pdf.',
    ' * Do not edit by hand: run the tool again. See sources/IRONSWORN-LODESTAR.md for the licence.',
    ' *',
    ' * Each row is [from, to, text]. A roll of 00 on the dice is 100 here.',
    ' */',
    '',
    "export type LodestarGroup = 'moves' | 'prompt' | 'place' | 'settlement' | 'character' | 'names' | 'turning';",
    'export type LodestarRow = readonly [from: number, to: number, text: string];',
    'export interface LodestarColumn { label: string; rows: readonly LodestarRow[]; note?: string }',
    'export interface LodestarTable { id: string; title: string; group: LodestarGroup; intro: string; columns: readonly LodestarColumn[] }',
    '',
    'export const LODESTAR_GROUPS: { id: LodestarGroup; label: string }[] = [',
    "  { id: 'moves', label: 'Move tables' }, { id: 'prompt', label: 'Action and Theme' }, { id: 'place', label: 'Places' },",
    "  { id: 'settlement', label: 'Settlements' }, { id: 'character', label: 'Characters' }, { id: 'names', label: 'Names' },",
    "  { id: 'turning', label: 'Turning points' },",
    '];',
    '',
    'export const LODESTAR_TABLES: readonly LodestarTable[] = [',
]
for id, title, group, intro, columns in tables:
    out.append('  {')
    out.append(f"    id: '{id}', title: '{esc(title)}', group: '{group}',")
    out.append(f"    intro: '{esc(intro)}',")
    out.append('    columns: [')
    for label, rows, note in columns:
        extra = f", note: '{esc(note)}'" if note else ''
        out.append(f"      {{ label: '{esc(label)}', rows: {ts_rows(rows)}{extra} }},")
    out.append('    ],')
    out.append('  },')
out += [
    '];',
    '',
    '/** Finds the row a d100 roll (1 to 100) lands on. */',
    'export function readLodestarColumn(column: LodestarColumn, roll: number): LodestarRow {',
    "  if (!Number.isInteger(roll) || roll < 1 || roll > 100) throw new RangeError('A d100 roll is 1 to 100');",
    '  const row = column.rows.find(([from, to]) => roll >= from && roll <= to);',
    "  if (!row) throw new Error('Table has a gap');",
    '  return row;',
    '}',
    '',
    'export function lodestarTable(id: string): LodestarTable {',
    '  const found = LODESTAR_TABLES.find(table => table.id === id);',
    "  if (!found) throw new Error('Invalid Lodestar table');",
    '  return found;',
    '}',
    '',
]
OUT.write_text('\n'.join(out), encoding='utf-8')
for seg in IGNORED:
    print('  ignored:', seg[:90])
print(f'Wrote {OUT.relative_to(ROOT)}: {len(tables)} tables, {sum(len(c[1]) for t in tables for c in t[4])} rows')
