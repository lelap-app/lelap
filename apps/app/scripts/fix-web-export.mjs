// Cloudflare Pages does not upload anything under a `node_modules` folder, and Expo's web export
// puts packaged assets (sql.js's WebAssembly, navigation icons) at paths like
// `assets/__node_modules/.pnpm/sql.js@1.15.2/node_modules/sql.js/…`. Those requests then fall
// through to index.html. This renames the folders and rewrites every reference to them.
//
// It also writes `_headers` (Cloudflare Pages) with the Content-Security-Policy and other security
// headers, built from the same configuration as the app, and the same headers as a Caddy snippet
// when LELAP_CADDY_HEADERS names a file (the Docker image).
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultAddons, downloadsBase, proxyBase, syncBase } from '../src/config.ts';

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

const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Add-ons, WebDAV servers, S3 buckets, covers and audio can be on any https host the user picks,
 * so those directives allow `https:`; the configured hosts are listed too, for plain-http ones
 * during development. The policy's real work is scripts: only this origin's files, no inline
 * code, no eval (WebAssembly for sql.js excepted), no plugins, no framing.
 */
function securityHeaders() {
  const hosts = [
    ...new Set([proxyBase, syncBase, downloadsBase, ...defaultAddons].map(origin).filter(Boolean)),
  ];
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    // react-native-web adds its styles as <style> elements at run time.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https: ${origin(proxyBase)}`,
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${hosts.join(' ')} https:`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}

function writeHeaders(dir) {
  const headers = Object.entries(securityHeaders());
  writeFileSync(
    join(dir, '_headers'),
    `/*\n${headers.map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n`,
  );
  const caddy = process.env.LELAP_CADDY_HEADERS;
  if (caddy) {
    const lines = headers.map(([name, value]) => `\t${name} "${value}"`).join('\n');
    writeFileSync(caddy, `header {\n${lines}\n}\n`);
  }
}

renameFolders(root);
addInstallLinks(root);
writeHeaders(root);
console.log(`fix-web-export: rewrote references in ${rewrite(root)} files`);
