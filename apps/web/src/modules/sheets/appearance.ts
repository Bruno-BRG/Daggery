import type { Sheet } from './types';
import { classArt } from './rules';

export type CharacterImageSlot = 'portraitUrl' | 'bannerUrl' | 'tokenUrl';
export const CHARACTER_IMAGE_SLOTS: { key: CharacterImageSlot; title: string; aspect: number; size: number }[] = [
  { key: 'portraitUrl', title: 'Portrait', aspect: 1, size: 1024 },
  { key: 'bannerUrl', title: 'Banner', aspect: 3, size: 2048 },
  { key: 'tokenUrl', title: 'Table token', aspect: 1, size: 512 },
];
export const portraitImage = (sheet: Sheet) => sheet.portraitUrl || classArt(sheet.classId);
export const bannerImage = (sheet: Sheet) => sheet.bannerUrl || classArt(sheet.classId);
export const tokenImage = (sheet: Sheet) => sheet.tokenUrl || portraitImage(sheet);

export function imageCrop(width: number, height: number, aspect: number, focusX: number, focusY: number) {
  const cropWidth = Math.min(width, height * aspect);
  const cropHeight = Math.min(height, width / aspect);
  return { x: (width - cropWidth) * Math.max(0, Math.min(100, focusX)) / 100,
    y: (height - cropHeight) * Math.max(0, Math.min(100, focusY)) / 100, width: cropWidth, height: cropHeight };
}

export function validateCharacterImage(file: Pick<File, 'type' | 'size'>): void {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
}

/** Export the chosen crop once, keeping large originals out of the shared document and table renderer. */
export async function prepareCharacterImage(file: File, slot: CharacterImageSlot, focusX: number, focusY: number): Promise<File> {
  validateCharacterImage(file);
  const source = await createImageBitmap(file);
  try {
    if (source.width > 8192 || source.height > 8192 || source.width * source.height > 32_000_000) throw new Error('Choose an image no larger than 8192 pixels per side and 32 megapixels.');
    const settings = CHARACTER_IMAGE_SLOTS.find(s => s.key === slot)!;
    const crop = imageCrop(source.width, source.height, settings.aspect, focusX, focusY);
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(settings.size, Math.round(crop.width));
    canvas.height = Math.max(1, Math.round(canvas.width / settings.aspect));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this image.');
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare this image.')), 'image/webp', .9));
    return new File([blob], `${slot}.${blob.type === 'image/webp' ? 'webp' : 'png'}`, { type: blob.type });
  } finally { source.close(); }
}
