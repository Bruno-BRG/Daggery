import assert from 'node:assert/strict';
import test from 'node:test';
import { imageCrop, portraitImage, bannerImage, tokenImage, validateCharacterImage } from './appearance';
import type { Sheet } from './types';
import { linkedTokenImage, sheetEntry } from '../map/sheetToken';

const sheet = { name: 'Hero', classId: 'guardian', ancestryId: 'human', hpMarked: 0, stressMarked: 0 } as Sheet;
test('separate character images fall back to portrait and class art for existing sheets', () => {
  assert.ok(portraitImage(sheet)?.startsWith('/cards/class/'));
  assert.equal(portraitImage({ ...sheet, classId: 'assassin' }), '/cards/class/assassin.webp', 'Hope & Fear classes use their extracted class art');
  const portrait = { ...sheet, portraitUrl: '/portrait.webp' };
  assert.equal(portraitImage(portrait), '/portrait.webp');
  assert.equal(tokenImage(portrait), '/portrait.webp');
  assert.equal(tokenImage({ ...portrait, tokenUrl: '/token.webp' }), '/token.webp');
  assert.equal(bannerImage({ ...portrait, bannerUrl: '/banner.webp' }), '/banner.webp');
  assert.equal(sheetEntry('hero', { ...portrait, tokenUrl: '/token.webp' })?.image, '/token.webp');
});
test('linked character tokens refresh artwork without replacing scene-specific overrides', () => {
  const linked = { id: 'hero', name: 'Hero', image: '/new-token.webp' };
  assert.equal(linkedTokenImage({ image: '/old-token.webp', useCharacterImage: true }, linked), '/new-token.webp');
  assert.equal(linkedTokenImage({ image: '/cards/class/guardian.webp' }, linked), '/new-token.webp');
  assert.equal(linkedTokenImage({ image: '/scene.webp' }, linked), '/scene.webp');
  assert.equal(linkedTokenImage({ image: '', useCharacterImage: false }, linked), '');
});
test('image crops match cover previews, preserve aspect ratio, and keep focal points within the image', () => {
  assert.deepEqual(imageCrop(1200, 600, 1, 0, 50), { x: 0, y: 0, width: 600, height: 600 });
  assert.deepEqual(imageCrop(1200, 600, 1, 100, 50), { x: 600, y: 0, width: 600, height: 600 });
  assert.deepEqual(imageCrop(600, 1200, 3, 50, 100), { x: 0, y: 1000, width: 600, height: 200 });
  assert.deepEqual(imageCrop(600, 1200, 3, 50, -20), { x: 0, y: 0, width: 600, height: 200 });
  assert.throws(() => validateCharacterImage({ type: 'image/svg+xml', size: 100 }), /PNG/);
  assert.throws(() => validateCharacterImage({ type: 'image/png', size: 11 * 1024 * 1024 }), /10 MB/);
});
