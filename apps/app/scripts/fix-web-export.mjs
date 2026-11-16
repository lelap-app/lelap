// Cloudflare Pages does not upload anything under a `node_modules` folder, and Expo's web export
// puts packaged assets (sql.js's WebAssembly, navigation icons) at paths like
// `assets/__node_modules/.pnpm/sql.js@1.15.2/node_modules/sql.js/…`. Those requests then fall
// through to index.html. This renames the folders and rewrites every reference to them.
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'dist-web';
const RENAMES = { __node_modules: '__nm', node_modules: 'nm' };
const TEXT = /\.(js|mjs|html|json|css|map|txt)$/;

/** Renames the deepest folders first, so parent paths stay valid while walking. */
function renameFolders(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    renameFolders(path);
    const to = RENAMES[name];
    if (to) renameSync(path, join(dir, to));
  }
}

function rewrite(dir) {
  let files = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files += rewrite(path);
    } else if (TEXT.test(name)) {
      const text = readFileSync(path, 'utf8');
      const fixed = text
        .replace(/\/__node_modules\//g, '/__nm/')
        .replace(/\/node_modules\//g, '/nm/');
      if (fixed !== text) {
        writeFileSync(path, fixed);
        files++;
      }
    }
  }
  return files;
}

renameFolders(root);
console.log(`fix-web-export: rewrote references in ${rewrite(root)} files`);
