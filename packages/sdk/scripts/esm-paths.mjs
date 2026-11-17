// Adds `.js` to relative imports in dist/. The source keeps extensionless imports, which every
// workspace bundler (Metro, Vite, Wrangler) resolves; Node's ESM loader needs the extension.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const relative =
  /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+?)(?<!\.js|\.json)\2/g;

for (const name of readdirSync(dist)) {
  if (!name.endsWith('.js') && !name.endsWith('.d.ts')) continue;
  const file = new URL(name, dist);
  const source = readFileSync(file, 'utf8');
  const fixed = source.replace(
    relative,
    (_, keyword, quote, path) => `${keyword}${quote}${path}.js${quote}`,
  );
  if (fixed !== source) writeFileSync(file, fixed);
}
