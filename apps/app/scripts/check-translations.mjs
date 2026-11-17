// Checks the Malay catalog against the English text in the source: every key must still be used,
// and a translation must keep the same {holes}. Missing lines are listed but don't fail, since
// the app shows English until a translation arrives.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ms } from '../src/i18n/ms.ts';

const root = new URL('..', import.meta.url).pathname;
const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });

// t('…') and t("…"), also when the formatter put the text on its own line.
const call = /\bt\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
const used = new Set();
for (const file of [...files(join(root, 'app')), ...files(join(root, 'src'))]) {
  for (const m of readFileSync(file, 'utf8').matchAll(call)) {
    const quoted = m[1];
    used.add(quoted.slice(1, -1).replace(/\\(.)/g, '$1'));
  }
}

const holes = (s) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
const problems = [];
for (const [key, line] of Object.entries(ms)) {
  if (!used.has(key)) problems.push(`Not used in the app any more: ${JSON.stringify(key)}`);
  else if (holes(key) !== holes(line))
    problems.push(`Different {holes} than the English: ${JSON.stringify(key)}`);
}
const missing = [...used].filter((key) => !(key in ms)).sort();

if (missing.length > 0) {
  console.log(`${missing.length} lines without Malay yet (English shows):`);
  for (const key of missing) console.log(`  ${JSON.stringify(key)}`);
}
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`Malay: ${Object.keys(ms).length} of ${used.size} lines.`);
