// Run by check-accessibility.mjs. Fails when a screen in `app/` is missing from `src/routes.ts`, or the list names one that is
// gone: a screen left out could open twice on a quick double tap.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCREENS } from '../src/routes.ts';

const appDir = fileURLToPath(new URL('../app', import.meta.url));

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name.startsWith('(') ? [] : files(path);
    return /\.tsx$/.test(name) && !name.startsWith('_') && !name.startsWith('+') ? [path] : [];
  });

const onDisk = new Set(files(appDir).map((f) => relative(appDir, f).replace(/\.tsx$/, '')));
const listed = new Set(SCREENS);
const problems = [
  ...[...onDisk].filter((s) => !listed.has(s)).map((s) => `app/${s}.tsx is not in src/routes.ts`),
  ...[...listed]
    .filter((s) => !onDisk.has(s))
    .map((s) => `src/routes.ts lists ${s}, which is gone`),
];
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`routes: ${onDisk.size} screens, all singular`);
