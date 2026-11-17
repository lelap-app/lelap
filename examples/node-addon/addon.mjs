// A Lelap add-on with nothing but Node's standard library: one catalog, meta and streams.
import { createServer } from 'node:http';

export const manifest = {
  // Use a reverse-DNS ID of a domain you control.
  id: 'org.example.node',
  version: '1.0.0',
  protocol: 1,
  // Revision 2 adds `behaviorHints` and `GET /health`; older apps ignore both.
  protocolVersion: 2,
  name: 'Node example',
  description: 'Two public-domain LibriVox recordings, served without a framework.',
  types: ['audiobook'],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['example:'],
  catalogs: [{ type: 'audiobook', id: 'classics', name: 'Classics', extra: [{ name: 'skip' }] }],
  behaviorHints: { health: true },
};

// Replace these with your own source. Only serve audio you are allowed to share.
const archive = (item, file) => `https://archive.org/download/${item}/${file}`;

const BOOKS = [
  {
    meta: {
      id: 'example:raven',
      type: 'audiobook',
      name: 'The Raven',
      author: 'Edgar Allan Poe',
      cover: 'https://archive.org/services/img/raven',
      year: 1845,
      durationMs: 570_000,
      description: 'A grieving narrator is visited at midnight by a talking raven.',
      language: 'en',
    },
    streams: [
      {
        sourceKey: 'example:raven:64kb',
        name: 'Node example',
        title: 'LibriVox recording',
        url: archive('raven', 'raven_poe_64kb.mp3'),
        durationMs: 570_000,
        mime: 'audio/mpeg',
        downloadable: true,
      },
    ],
  },
  {
    meta: {
      id: 'example:christmas-carol',
      type: 'audiobook',
      name: 'A Christmas Carol',
      author: 'Charles Dickens',
      cover: 'https://archive.org/services/img/A_Christmas_Carol',
      year: 1843,
      durationMs: 11_669_000,
      description: 'Ebenezer Scrooge is visited by three spirits on Christmas Eve.',
      language: 'en',
    },
    streams: [
      {
        sourceKey: 'example:christmas-carol:64kb',
        name: 'Node example',
        title: 'LibriVox recording',
        mime: 'audio/mpeg',
        downloadable: true,
        parts: [
          [
            'Preface and Stave 1',
            'A_Christmas_Carol_Preface_and_Stave_1_Dickens_64kb.mp3',
            2_680_000,
          ],
          ['Stave 2', 'A_Christmas_Carol_Stave_2_Dickens_64kb.mp3', 2_660_000],
          ['Stave 3', 'A_Christmas_Carol_Stave_3_Dickens_64kb.mp3', 2_674_000],
          ['Stave 4', 'A_Christmas_Carol_Stave_4_Dickens_64kb.mp3', 2_529_000],
          ['Stave 5', 'A_Christmas_Carol_Stave_5_Dickens_64kb.mp3', 1_126_000],
        ].map(([title, file, durationMs]) => ({
          title,
          url: archive('A_Christmas_Carol', file),
          durationMs,
        })),
      },
    ],
  },
];

const PAGE = 50;
const DAY = 86_400;

const preview = ({ id, type, name, author, cover, year }) => ({
  id,
  type,
  name,
  author,
  cover,
  year,
});

/** Answers one request: `{ status, body, maxAge? }`. Pure, so tests need no server. */
export function route(pathname) {
  if (pathname === '/manifest.json') return { status: 200, body: manifest, maxAge: 3600 };
  // Check what your add-on relies on here; `degraded` or `down` with a short `message`.
  if (pathname === '/health') return { status: 200, body: { status: 'ok' }, maxAge: 0 };
  // /{resource}/{type}/{id}.json or /catalog/{type}/{id}/{extra}.json, IDs percent-encoded.
  const match = /^\/(catalog|meta|stream)\/([^/]+)\/([^/]+?)(?:\/([^/]*))?\.json$/.exec(pathname);
  if (!match) return notFound();
  const [, resource, type, rawId, rawExtra] = match;
  let id;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return notFound();
  }
  if (type !== 'audiobook') return notFound();

  if (resource === 'catalog') {
    if (id !== 'classics') return notFound('Unknown catalog');
    // Extras are a query string in a path segment, so URLSearchParams decodes them (`+` too).
    const skip = Number(new URLSearchParams(rawExtra ?? '').get('skip') ?? 0);
    if (!Number.isInteger(skip) || skip < 0)
      return { status: 400, body: { error: 'skip must be a whole number' } };
    const metas = BOOKS.slice(skip, skip + PAGE).map((book) => preview(book.meta));
    return { status: 200, body: { metas, cacheMaxAge: 6 * 3600 }, maxAge: 6 * 3600 };
  }
  if (rawExtra !== undefined) return notFound();

  const book = BOOKS.find((b) => b.meta.id === id);
  if (resource === 'meta') {
    if (!book) return notFound();
    return { status: 200, body: { meta: book.meta, cacheMaxAge: DAY }, maxAge: DAY };
  }
  // No streams is an empty list, not an error.
  return { status: 200, body: { streams: book?.streams ?? [], cacheMaxAge: DAY }, maxAge: DAY };
}

const notFound = (error = 'Not found') => ({ status: 404, body: { error } });

// Every response, errors included, needs CORS: the web app calls add-ons from the browser.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export function createAddonServer() {
  return createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end();
      return;
    }
    const answer =
      req.method === 'GET' || req.method === 'HEAD'
        ? route(new URL(req.url ?? '/', 'http://addon').pathname)
        : { status: 405, body: { error: 'Method not allowed' } };
    const headers = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };
    if (answer.maxAge !== undefined) headers['Cache-Control'] = `public, max-age=${answer.maxAge}`;
    res.writeHead(answer.status, headers);
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(answer.body));
  });
}
