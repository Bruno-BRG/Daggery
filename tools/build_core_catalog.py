#!/usr/bin/env python3
"""Build the core-book allowlist and class thumbnails from the local core PDF.

Requires PyMuPDF and Pillow. Does not modify the original catalog or source PDF.
"""
import json
import re
import unicodedata
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'packages' / 'content'
PDF = ROOT / 'sources' / 'Daggerheart_Core_Full_Art_and_Printer_Friendly_Cards_-_9-09-25.pdf'
CARDS = CONTENT / 'cards'

CLASS_PAGES = {'bard': 30, 'druid': 32, 'guardian': 38, 'ranger': 40, 'rogue': 44,
               'seraph': 46, 'sorcerer': 48, 'warrior': 50, 'wizard': 52}


def norm(text):
    text = unicodedata.normalize('NFKD', text).lower()
    text = text.replace('’', "'").replace("'", '')
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def content(name):
    return json.loads((CONTENT / f'{name}.json').read_text(encoding='utf-8'))


def main():
    doc = pymupdf.open(PDF)
    cards = content('cards-index')
    # Restrict name matching to the corresponding core-book tables or indexes.
    def pages(start, end):
        return ' ' + norm(' '.join(doc[i - 1].get_text() for i in range(start, end + 1))) + ' '

    regions = {
        'weapons': pages(116, 126), 'armor': pages(127, 129),
        'items': pages(130, 132), 'consumables': pages(132, 134),
        'adversaries': pages(210, 210), 'environments': pages(243, 243),
    }
    manifest = {
        'classes': list(CLASS_PAGES),
        'domains': ['arcana', 'blade', 'bone', 'codex', 'grace', 'midnight', 'sage', 'splendor', 'valor'],
        'ancestries': [c['id'] for c in cards if c['kind'] == 'ancestry'],
        'communities': [c['id'] for c in cards if c['kind'] == 'community'],
    }
    # Domain cards are identified against the core card sheets by name AND domain.
    card_keys = {(norm(c['name']).replace(' ', ''), c['domain']) for c in cards if c['kind'] == 'domain'}
    manifest['domainCards'] = [c['id'] for c in content('domain-cards') if (norm(c['name']).replace(' ', ''), c['domain']) in card_keys]
    manifest['subclasses'] = [c['id'].removesuffix('-foundation') for c in cards
                              if c['kind'] == 'subclass' and c['id'].endswith('-foundation')]
    for key, region in regions.items():
        manifest[key] = [item['id'] for item in content(key)
                         if ' ' + norm(item['name']) + ' ' in region]
    (CONTENT / 'core-catalog.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    for name, page in CLASS_PAGES.items():
        # The lower right panel of the second class page contains its artwork.
        pix = doc[page - 1].get_pixmap(matrix=pymupdf.Matrix(2, 2), clip=pymupdf.Rect(220, 315, 612, 685), alpha=False)
        image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        for folder, width in [(CARDS, 586), (CARDS / 'thumbs', 300)]:
            out = folder / 'class' / f'{name}.webp'
            out.parent.mkdir(parents=True, exist_ok=True)
            result = image.copy()
            result.thumbnail((width, width))
            result.save(out, 'WEBP', quality=85, method=6)
    doc.close()
    print({key: len(value) for key, value in manifest.items()})


if __name__ == '__main__':
    main()
