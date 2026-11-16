// Renders the app icons and iOS splash screens into public/. Run with
// `pnpm --filter @lelap/site icons` after changing the logo or the device list.
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { splashImages } from '../src/splash-screens.ts';

const ACCENT = '#F5B041';
const INK = '#1A1305';
const NIGHT = '#0D0E11';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

// The equaliser bars from the logo, drawn in a 24×24 box.
const BARS =
  '<rect x="3" y="9" width="3" height="6" rx="1.5"/><rect x="8" y="5" width="3" height="14" rx="1.5"/>' +
  '<rect x="13" y="7" width="3" height="10" rx="1.5"/><rect x="18" y="10" width="3" height="4" rx="1.5"/>';

interface Tile {
  size: number;
  x?: number;
  y?: number;
  rounded: boolean;
  glyph: number;
}

// An amber tile with the bars centred; `glyph` is the bars' box as a share of the tile.
function tile({ size, x = 0, y = 0, rounded, glyph }: Tile): string {
  const box = size * glyph;
  const offset = (size - box) / 2;
  const radius = rounded ? size * 0.28 : 0;
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${radius}" fill="${ACCENT}"/>` +
    `<svg x="${x + offset}" y="${y + offset}" width="${box}" height="${box}" viewBox="0 0 24 24">` +
    `<g fill="${INK}">${BARS}</g></svg>`
  );
}

function svg(width: number, height: number, body: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  );
}

async function render(file: string, image: Buffer): Promise<void> {
  await sharp(image)
    .png({ compressionLevel: 9 })
    .toFile(publicDir + file);
}

const icons: { file: string; size: number; rounded: boolean; glyph: number }[] = [
  // iOS masks the corners itself and shows transparency as black, so this one is full-bleed.
  { file: 'apple-touch-icon.png', size: 180, rounded: false, glyph: 0.6 },
  { file: 'icons/icon-192.png', size: 192, rounded: true, glyph: 0.6 },
  { file: 'icons/icon-512.png', size: 512, rounded: true, glyph: 0.6 },
  // Maskable icons get cropped to a circle; keep the bars inside the 80 % safe zone.
  { file: 'icons/icon-maskable-512.png', size: 512, rounded: false, glyph: 0.46 },
];

await mkdir(publicDir + 'icons', { recursive: true });
for (const { file, size, rounded, glyph } of icons) {
  await render(file, svg(size, size, tile({ size, rounded, glyph })));
}

await rm(publicDir + 'splash', { recursive: true, force: true });
await mkdir(publicDir + 'splash', { recursive: true });
for (const { href, pixelWidth: w, pixelHeight: h } of splashImages) {
  const size = Math.round(Math.min(w, h) * 0.24);
  const body =
    `<rect width="${w}" height="${h}" fill="${NIGHT}"/>` +
    tile({ size, x: (w - size) / 2, y: (h - size) / 2, rounded: true, glyph: 0.6 });
  await render(href.slice(1), svg(w, h, body));
}

console.log(`Wrote ${icons.length} icons and ${splashImages.length} splash screens.`);
