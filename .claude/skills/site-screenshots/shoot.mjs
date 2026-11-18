// Makes reference shots of the real app from a demo library, to keep the landing page's drawn
// mock-ups faithful. See SKILL.md next to this file.
//
//   node .claude/skills/site-screenshots/shoot.mjs [--reuse-export] [--lang en|ms] [--debug] [--out dir]
//
// It exports the web app pointed at a local demo add-on, serves both from one local port, drives a
// headless Chrome with a fresh profile through the app, and writes PNG files to the work folder.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { launchChrome } from './chrome.mjs';
import { COVER_KEYS, coverSource, demoLibrary, LANGUAGES } from './library.mjs';

const { values: args } = parseArgs({
  options: {
    'reuse-export': { type: 'boolean', default: false },
    lang: { type: 'string', multiple: true },
    debug: { type: 'boolean', default: false },
    port: { type: 'string', default: '8197' },
    work: { type: 'string', default: join(tmpdir(), 'lelap-site-screenshots') },
    out: { type: 'string' },
  },
});

const ROOT = resolve(import.meta.dirname, '../../..');
const APP = join(ROOT, 'apps/app');
const SITE = join(ROOT, 'apps/site');
const WORK = resolve(args.work);
// References only: the site draws its pictures, so these never go into the repository.
const OUT = resolve(args.out ?? join(WORK, 'shots'));
const WEB = join(WORK, 'web');
const PORT = Number(args.port);
const ORIGIN = `http://localhost:${PORT}`;
// A large phone in portrait (Pixel 10 Pro XL, 448 × 997 dp), the shape of the site's phone frame.
const PHONE = { width: 448, height: 997, scale: 2 };
const FONTS = {
  'space-grotesk.woff2':
    '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2',
  'inter.woff2': '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
};

const log = (...line) => console.log('·', ...line);

// 1. The web app, built against the demo add-on. The build bakes these in; nothing points at lelap.app.
function exportApp() {
  if (args['reuse-export'] && existsSync(join(WEB, 'index.html'))) return log('reusing', WEB);
  log('exporting the web app (a minute or two)');
  const off = `${ORIGIN}/off`;
  execFileSync('pnpm', ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', WEB], {
    cwd: APP,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      // Every other host the app derives from the domain: `.invalid` never resolves.
      EXPO_PUBLIC_LELAP_DOMAIN: 'demo.invalid',
      EXPO_PUBLIC_LELAP_UPDATES: off,
      EXPO_PUBLIC_LELAP_ADDONS: `${ORIGIN}/demo/manifest.json`,
      EXPO_PUBLIC_LELAP_PROXY: `${ORIGIN}/proxy`,
      EXPO_PUBLIC_LELAP_SYNC: off,
      EXPO_PUBLIC_LELAP_DOWNLOADS: off,
    },
  });
}

// 2. Silent audio: a WAV of any length, made on the fly so nothing large is written or kept.
const RATE = 8000;
function wavHeader(bytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE, 28);
  h.writeUInt16LE(1, 32);
  h.writeUInt16LE(8, 34); // 8-bit, where 128 is silence
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}

function sendSilence(req, res, durationMs) {
  const data = Math.round((durationMs / 1000) * RATE);
  const total = 44 + data;
  if (!Number.isFinite(data) || data <= 0) return res.writeHead(404).end();
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
  if (start >= total || end < start) {
    return res.writeHead(416, { 'Content-Range': `bytes */${total}` }).end();
  }
  const body = Buffer.alloc(end - start + 1, 128);
  if (start < 44) wavHeader(data).copy(body, 0, start, Math.min(44, end + 1));
  res.writeHead(range ? 206 : 200, {
    'Content-Type': 'audio/wav',
    'Accept-Ranges': 'bytes',
    'Content-Length': body.length,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
  });
  res.end(body);
}

// 3. The demo add-on, in whichever language is being shot.
const state = { lang: 'en', covers: new Map() };

function addon(path) {
  const lib = demoLibrary(state.lang);
  const all = [lib.laksa, ...lib.rows.flatMap((row) => row.books)];
  const preview = (b) => ({
    id: b.id,
    type: 'audiobook',
    name: b.name,
    author: b.author,
    cover: `${ORIGIN}/demo/covers/${state.lang}/${b.cover}.png`,
    durationMs: b.durationMs,
  });
  if (path === 'manifest.json') {
    return {
      id: 'app.lelap.demo',
      version: '1.0.0',
      protocol: 1,
      protocolVersion: 2,
      name: 'Demo',
      description: 'Made-up books with drawn covers and silent audio, for screenshots.',
      types: ['audiobook'],
      resources: ['catalog', 'meta', 'stream'],
      idPrefixes: ['demo:'],
      catalogs: lib.rows.map((row) => ({ type: 'audiobook', id: row.id, name: row.name })),
    };
  }
  let m = /^catalog\/audiobook\/([\w-]+)(?:\/[^/]*)?\.json$/.exec(path);
  if (m) {
    const row = lib.rows.find((r) => r.id === m[1]);
    return { metas: row ? row.books.map(preview) : [] };
  }
  m = /^meta\/audiobook\/(.+)\.json$/.exec(path);
  if (m) {
    const book = all.find((b) => b.id === decodeURIComponent(m[1]));
    if (!book) return null;
    let at = 0;
    const chapters = book.chapters.map((c) => {
      const chapter = { title: c.title, startMs: at };
      at += c.durationMs;
      return chapter;
    });
    return {
      meta: { ...preview(book), description: book.description, language: state.lang, chapters },
    };
  }
  m = /^stream\/audiobook\/(.+)\.json$/.exec(path);
  if (m) {
    const book = all.find((b) => b.id === decodeURIComponent(m[1]));
    if (!book) return null;
    // The shelves are real titles, so they stay metadata only, as a reading list's would: only
    // the made-up book has audio.
    if (book.id !== lib.laksa.id) return { streams: [] };
    return {
      streams: [
        {
          sourceKey: `${book.id}:silent`,
          name: 'Demo',
          title: 'Silent audio',
          mime: 'audio/wav',
          downloadable: false,
          parts: book.chapters.map((c) => ({
            title: c.title,
            url: `${ORIGIN}/demo/audio/${c.durationMs}.wav`,
            durationMs: c.durationMs,
          })),
        },
      ],
    };
  }
  return null;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

async function serve(req, res) {
  const url = new URL(req.url, ORIGIN);
  const path = decodeURIComponent(url.pathname);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (path.startsWith('/demo/audio/')) return sendSilence(req, res, Number(path.slice(12, -4)));
  // The web app sends plain-http covers through its proxy; this stands in for it, for our own only.
  // The player's cover arrives proxied twice, so unwrap until a plain path is left.
  let target = url;
  while (target.pathname === '/proxy/cover') {
    target = new URL(target.searchParams.get('url') ?? '/', ORIGIN);
  }
  const cover = decodeURIComponent(target.pathname);
  if (cover.startsWith('/demo/covers/')) {
    const png = state.covers.get(cover.slice(13, -4));
    if (!png) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(png);
  }
  if (path.startsWith('/demo/')) {
    const body = addon(path.slice(6));
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(body));
  }
  if (path.startsWith('/cover-src/')) {
    const [lang, key] = path.slice(11).split('/');
    const title = demoLibrary(lang).laksa.name;
    const source = coverSource(key, title);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(
      source.html ??
        `<!doctype html><style>html,body{margin:0}svg{display:block}</style>${source.svg}`,
    );
  }
  if (path.startsWith('/fonts/') && FONTS[path.slice(7)]) {
    res.writeHead(200, { 'Content-Type': 'font/woff2' });
    return res.end(await readFile(join(SITE, 'node_modules', FONTS[path.slice(7)])));
  }
  if (path.startsWith('/off/')) return res.writeHead(404).end();
  // The exported app; any other path is a route of the single-page app.
  let file = join(WEB, normalize(path));
  if (relative(WEB, file).startsWith('..') || !(await stat(file).catch(() => null))?.isFile()) {
    file = join(WEB, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}

// 4. Covers: drawn by the browser, so the hero cover gets the site's own fonts.
async function renderCovers(browser, lang) {
  const page = await browser.newPage({ width: 600, height: 600, scale: 1 });
  for (const key of COVER_KEYS) {
    await page.goto(`${ORIGIN}/cover-src/${lang}/${key}`);
    await page.eval('document.fonts.ready.then(() => true)');
    const png = await page.screenshot({ x: 0, y: 0, width: 600, height: 600 });
    state.covers.set(`${lang}/${key}`, png);
  }
  await page.dispose();
}

// 5. The app, driven like a person would: through its own buttons, found by their labels in the
// language being shot (the app's catalog), so the flow fails loudly when the UI changes.
async function shootLanguage(browser, lang) {
  state.lang = lang;
  await renderCovers(browser, lang);
  const catalog =
    lang === 'en'
      ? {}
      : JSON.parse(await readFile(join(APP, `src/i18n/catalogs/${lang}.json`), 'utf8'));
  const ui = (text, vars = {}) => {
    const line = lang === 'en' ? text : catalog[text];
    if (!line) throw new Error(`The app has no ${lang} line for “${text}”.`);
    return line.replace(/\{(\w+)\}/g, (_, key) => String(vars[key]));
  };
  const lib = demoLibrary(lang);
  const page = await browser.newPage(PHONE);
  state.page = page;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const debug = async (name) => {
    if (args.debug)
      await writeFile(join(WORK, `debug-${lang}-${name}.png`), await page.screenshot());
  };
  const settle = async (still) => {
    await page.waitFor(
      () => [...document.images].every((img) => img.complete && img.naturalWidth > 0),
      'the covers',
    );
    // Source badges arrive one by one as the app asks the add-on; wait until the screen is still.
    // Not on the player, whose clocks never stop.
    if (still) await page.waitStill(() => document.body.innerText);
    await pause(800); // covers fade in
  };
  // Book time of chapter 3 at 12:04: 18:12 + 23:40 + 12:04.
  const jump = async () => {
    await page.click(/^\d+:\d\d$/); // the elapsed time opens Jump to
    await page.click(ui('Time to jump to'));
    await page.type('53:56');
    await page.click(ui('Go'));
  };

  await page.goto(`${ORIGIN}/`);
  // An empty device starts with the welcome (M82); skip it to reach Home.
  const opened = await page.find(new RegExp(`^(Skip|${lib.rows[1].name})$`), 40_000);
  if (opened && (await page.has('Skip'))) await page.click('Skip');
  await page.find(lib.rows[1].name, 40_000);
  if (lang !== 'en') {
    await page.goto(`${ORIGIN}/settings`);
    await page.click(catalog['@language']);
    await page.find(ui('Language'));
    await pause(2500); // the web app saves its database a moment after a change
  }

  // Start the hero book, so Home has something to continue.
  await page.goto(`${ORIGIN}/item?type=audiobook&id=${encodeURIComponent(lib.laksa.id)}`);
  await page.click(ui('Play'));
  await jump();
  await pause(2500); // the position is saved every few seconds
  await debug('first-play');

  // Home after a fresh start: the book to continue, then the add-on's rows.
  await page.goto(`${ORIGIN}/`);
  await page.find(ui('Continue listening'), 40_000);
  await page.find(lib.rows[1].name);
  await settle(true);
  const shots = { home: await page.screenshot() };

  // The player, picked up from Home, a little faster and with a sleep timer running.
  await page.click(ui('Continue listening'));
  await page.click(ui('Speed, {speed}×', { speed: 1 }));
  await page.click('1.25×');
  if (await page.has(ui('Close'))) await page.click(ui('Close'));
  await page.click(ui('Sleep'));
  await page.click(ui('{n} minutes', { n: 30 }));
  if (await page.has(ui('Close'))) await page.click(ui('Close'));
  await jump();
  await settle();
  shots.player = await page.screenshot();
  if (page.errors.length) log('page errors:', page.errors.join('\n'));
  state.page = null;
  await page.dispose();
  return shots;
}

// 6. PNG at the phone's full size, to compare with the site's mock-ups.
async function save(lang, shots) {
  await mkdir(OUT, { recursive: true });
  for (const [screen, png] of Object.entries(shots)) {
    const file = join(OUT, `${screen}-${lang}.png`);
    await writeFile(file, png);
    log('wrote', file, `${((await stat(file)).size / 1024).toFixed(0)} kB`);
  }
}

async function main() {
  exportApp();
  const server = createServer((req, res) =>
    serve(req, res).catch((error) => {
      console.error(error);
      res.writeHead(500).end();
    }),
  );
  await new Promise((r) => server.listen(PORT, 'localhost', r));
  const browser = await launchChrome();
  try {
    for (const lang of args.lang ?? LANGUAGES) {
      log('shooting', lang);
      await save(lang, await shootLanguage(browser, lang));
    }
  } catch (error) {
    // A broken page must not hide the error that broke it.
    const png = await state.page?.screenshot().catch(() => null);
    if (png) {
      await writeFile(join(WORK, 'failed.png'), png);
      log(`failed; the last screen is in ${join(WORK, 'failed.png')}`);
    }
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
