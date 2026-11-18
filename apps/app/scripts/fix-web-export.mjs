// Cloudflare Pages does not upload anything under a `node_modules` folder, and Expo's web export
// puts packaged assets (sql.js's WebAssembly, navigation icons) at paths like
// `assets/__node_modules/.pnpm/sql.js@1.15.2/node_modules/sql.js/…`. Those requests then fall
// through to index.html. This renames the folders and rewrites every reference to them.
//
// It also writes `_headers` (Cloudflare Pages) with the Content-Security-Policy and other security
// headers, built from the same configuration as the app, and the same headers as a Caddy snippet
// when LELAP_CADDY_HEADERS names a file (the Docker image).
//
// It writes the Android App Links file for shared places when LELAP_ANDROID_CERT_SHA256 names the
// signing certificates (see writeAssetLinks).
//
// Last, it writes the service worker (`web/sw.js` with the list of files to cache) and the
// script that registers it, after the renames so the cached paths are the served ones.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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
  // The worker is checked on every visit, so a new build is found right away.
  writeFileSync(
    join(dir, '_headers'),
    `/*\n${headers.map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n` +
      `/sw.js\n  Cache-Control: no-cache\n`,
  );
  const caddy = process.env.LELAP_CADDY_HEADERS;
  if (caddy) {
    const lines = headers.map(([name, value]) => `\t${name} "${value}"`).join('\n');
    writeFileSync(caddy, `header {\n${lines}\n}\nheader /sw.js Cache-Control "no-cache"\n`);
  }
}

/**
 * `/.well-known/assetlinks.json` lets Android open this host's `/place` links in the app (M90).
 * LELAP_ANDROID_CERT_SHA256 lists the SHA-256 fingerprints of the certificates that sign the APKs,
 * comma-separated; a fork or self-hoster sets its own, and without it there is no file. The file
 * lives in `well-known/`, since GitHub artifacts leave out hidden folders; the host serves it at
 * the real path (`_redirects` here, `docker/Caddyfile` for the image).
 */
function writeAssetLinks(dir) {
  const fingerprints = (process.env.LELAP_ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter((f) => f !== '');
  if (fingerprints.length === 0) return 0;
  for (const f of fingerprints) {
    if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f))
      throw new Error(`LELAP_ANDROID_CERT_SHA256: not a SHA-256 fingerprint: ${f}`);
  }
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const links = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: app.expo.android.package,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
  mkdirSync(join(dir, 'well-known'), { recursive: true });
  writeFileSync(
    join(dir, 'well-known', 'assetlinks.json'),
    `${JSON.stringify(links, null, 2)}
`,
  );
  writeFileSync(
    join(dir, '_redirects'),
    '/.well-known/assetlinks.json /well-known/assetlinks.json 200\n',
  );
  return fingerprints.length;
}

/** Every file of the export, as the URL paths the browser asks for. */
function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

// Not part of the shell: headers for the host, source maps, and the worker itself.
const NOT_SHELL = /(^\/_headers$|^\/_redirects$|^\/sw\.js$|^\/well-known\/|\.map$)/;

function writeServiceWorker(dir) {
  const files = listFiles(dir)
    .map((path) => ({ path, url: `/${relative(dir, path).split(sep).join('/')}` }))
    .filter(({ url }) => !NOT_SHELL.test(url))
    .sort((a, b) => (a.url < b.url ? -1 : 1));
  const source = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');
  // The worker's own code counts too: a changed worker starts from a fresh cache.
  const hash = createHash('sha256').update(source);
  for (const { path, url } of files) hash.update(url).update(readFileSync(path));
  const build = hash.digest('hex').slice(0, 16);
  // Cloudflare Pages redirects `/index.html` to `/`, and a redirect can't answer a navigation.
  const shell = files.map(({ url }) => (url === '/index.html' ? '/' : encodeURI(url)));
  const constants = [
    `const BUILD = ${JSON.stringify(build)};`,
    `const SHELL = ${JSON.stringify(shell)};`,
    `const NEVER_CACHE = ${JSON.stringify([origin(syncBase)].filter(Boolean))};`,
  ].join('\n');
  writeFileSync(join(dir, 'sw.js'), `${constants}\n${source}`);
  // A file, not inline code: the Content-Security-Policy allows scripts from this origin only.
  writeFileSync(
    join(dir, 'sw-register.js'),
    "if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));\n",
  );
  const index = join(dir, 'index.html');
  const html = readFileSync(index, 'utf8');
  if (!html.includes('sw-register.js'))
    writeFileSync(
      index,
      html.replace('</head>', '<script src="/sw-register.js" defer></script></head>'),
    );
  return { build, files: shell.length };
}

renameFolders(root);
addInstallLinks(root);
writeHeaders(root);
console.log(`fix-web-export: rewrote references in ${rewrite(root)} files`);
const certificates = writeAssetLinks(root);
if (certificates > 0)
  console.log(`fix-web-export: App Links for ${certificates} signing certificate(s)`);
const worker = writeServiceWorker(root);
console.log(`fix-web-export: service worker ${worker.build} caches ${worker.files} files`);
