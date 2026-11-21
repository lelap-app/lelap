// Fails when a screen sets a text size off the type scale (M149): Tailwind's own sizes such as
// text-sm, a pixel size such as text-[10px], or a fontSize in a style. The scale's names are in
// tailwind.config.js. Drawings that size their letters to the drawing are listed below.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Initials that grow with their circle or cover, the shared stats image, and the M1 test screen.
const DRAWINGS = new Set([
  'src/components/Avatar.tsx',
  'src/components/BookCover.tsx',
  'src/components/Stats.tsx',
  'src/components/Icon.tsx',
  'src/dev/SpikeScreen.tsx',
]);

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });

const OFF_SCALE = /(?<![\w-])text-(?:xs|sm|base|lg|[2-9]?xl|\[\d+(?:\.\d+)?(?:px|rem)\])(?![\w-])/;
const STYLE_SIZE = /\bfontSize\s*:/;
const problems = [];
for (const file of [...files(join(root, 'app')), ...files(join(root, 'src'))]) {
  const name = relative(root, file);
  if (DRAWINGS.has(name)) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const found = line.match(OFF_SCALE)?.[0] ?? (STYLE_SIZE.test(line) ? 'fontSize' : null);
      if (found) problems.push(`${name}:${i + 1}: ${found} is off the type scale`);
    });
}
if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(
    '\nUse text-title, text-heading, text-section, text-body, text-detail or text-caption.',
  );
  process.exit(1);
}
console.log('Type scale: every text size is on the scale.');
