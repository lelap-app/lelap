// Renders the home screen icon for bookmarks into public/. Run with
// `pnpm --filter @lelap/site icons` after changing the logo. The site is not installable: only
// the web app at the web app host is.
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ACCENT = '#F5B041';
const INK = '#1A1305';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

// The equaliser bars from the logo, drawn in a 24×24 box.
const BARS =
  '<rect x="3" y="9" width="3" height="6" rx="1.5"/><rect x="8" y="5" width="3" height="14" rx="1.5"/>' +
  '<rect x="13" y="7" width="3" height="10" rx="1.5"/><rect x="18" y="10" width="3" height="4" rx="1.5"/>';

interface Tile {
  size: number;
  rounded: boolean;
  glyph: number;
}

// An amber tile with the bars centred; `glyph` is the bars' box as a share of the tile.
function tile({ size, rounded, glyph }: Tile): string {
  const box = size * glyph;
  const offset = (size - box) / 2;
  const radius = rounded ? size * 0.28 : 0;
  return (
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${ACCENT}"/>` +
    `<svg x="${offset}" y="${offset}" width="${box}" height="${box}" viewBox="0 0 24 24">` +
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

// iOS masks the corners itself and shows transparency as black, so the icon is full-bleed.
const size = 180;
await render('apple-touch-icon.png', svg(size, size, tile({ size, rounded: false, glyph: 0.6 })));
console.log('Wrote apple-touch-icon.png.');
