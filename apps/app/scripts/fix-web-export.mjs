// Cloudflare Pages does not upload anything under a `node_modules` folder, and Expo's web export
// puts packaged assets (sql.js's WebAssembly, navigation icons) at paths like
// `assets/__node_modules/.pnpm/sql.js@1.15.2/node_modules/sql.js/…`. Those requests then fall
// through to index.html. This renames the folders and rewrites every reference to them.
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'dist-web';
// `.pnpm` too: the deploy passes the build as a GitHub artifact, which leaves out hidden folders.
const RENAMES = { __node_modules: '__nm', node_modules: 'nm', '.pnpm': '_pnpm' };
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
        .replace(/\/node_modules\//g, '/nm/')
        .replace(/\/\.pnpm\//g, '/_pnpm/');
      if (fixed !== text) {
        writeFileSync(path, fixed);
        files++;
      }
    }
  }
  return files;
}

// Makes the web app installable: the manifest and icons come from public/, the links go here.
const HEAD = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="/icons/icon-192.png">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
].join('');

function addInstallLinks(dir) {
  const index = join(dir, 'index.html');
  const html = readFileSync(index, 'utf8');
  if (!html.includes('rel="manifest"'))
    writeFileSync(index, html.replace('</head>', `${HEAD}</head>`));
}

renameFolders(root);
addInstallLinks(root);
console.log(`fix-web-export: rewrote references in ${rewrite(root)} files`);
