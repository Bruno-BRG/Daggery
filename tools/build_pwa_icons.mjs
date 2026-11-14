// Renders the PWA icons in apps/web/public/icons from the app mark. Run: node tools/build_pwa_icons.mjs
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../apps/web/public/icons/', import.meta.url));

/** The mark on a full-bleed background. `scale` shrinks the mark toward the centre (maskable safe zone). */
function mark(scale, rounded) {
  const t = (1 - scale) * 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" ${rounded ? 'rx="16"' : ''} fill="#1e2231"/>
  <g transform="translate(${t} ${t}) scale(${scale})">
    <path d="M32 11 50 21.5v21L32 53 14 42.5v-21Z" fill="#a57cf5" fill-opacity="0.18" stroke="#bb99ff" stroke-width="3" stroke-linejoin="round"/>
    <path d="M14 21.5 32 32l18-10.5M32 32v21" fill="none" stroke="#d6c0ff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
  </g>
</svg>`;
}

const icons = [
  ['icon-192.png', 192, mark(1, true)],
  ['icon-512.png', 512, mark(1, true)],
  ['maskable-512.png', 512, mark(0.72, false)],
  ['apple-touch-icon.png', 180, mark(0.86, false)],
];
for (const [name, size, svg] of icons) {
  await sharp(Buffer.from(svg), { density: size * 1.5 }).resize(size, size).png().toFile(out + name);
  console.log('wrote', name);
}
