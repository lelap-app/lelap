import { Hono } from 'hono';

export type Env = { ALLOW_ORIGIN?: string };

export type ResponseCache = {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
};

export type Platform = {
  /**
   * Called with `redirect: 'manual'`: the app follows redirects itself, so every hop goes through
   * this function. The Node build checks each address here; Workers cannot reach private networks.
   */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  cache?: ResponseCache;
};

export const LIMITS = {
  feedBytes: 10 * 1024 * 1024,
  coverBytes: 5 * 1024 * 1024,
  textBytes: 5 * 1024 * 1024,
  feedTtl: 15 * 60,
  textTtl: 24 * 60 * 60,
  coverTtl: 24 * 60 * 60,
} as const;

const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

/** Proxied bodies come from anywhere: never let a browser run them as a page on this origin. */
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;
const USER_AGENT = 'Lelap feed proxy (+https://github.com/lelap-app/lelap)';

export class Refused extends Error {
  constructor(
    readonly status: 400 | 403 | 413 | 415 | 502,
    message: string,
  ) {
    super(message);
  }
}

function targetOf(raw: string | undefined, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(raw ?? '', base);
  } catch {
    throw new Refused(400, 'Pass the address as ?url=.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Refused(400, 'Only http and https addresses.');
  }
  return url;
}

/** Reads at most `limit` bytes; anything longer is refused rather than cut. */
async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Refused(413, 'Too large.');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Refused(413, 'Too large.');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** A feed is XML: its first non-blank character (after a byte order mark) is `<`. */
export function looksLikeXml(body: Uint8Array): boolean {
  const head = new TextDecoder()
    .decode(body.subarray(0, 512))
    .replace(/^\uFEFF/, '')
    .trimStart();
  return head.startsWith('<');
}

const isMedia = (type: string) => /^(audio|video)\//i.test(type);

/** UTF-8 without NUL bytes: text, never a media file, whatever its Content-Type says. */
export function looksLikeText(body: Uint8Array): boolean {
  if (body.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(body);
    return true;
  } catch {
    return false;
  }
}

export function createApp(platform: Platform, env: Env): Hono {
  const app = new Hono();
  const origin = env.ALLOW_ORIGIN ?? '*';

  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('Access-Control-Allow-Origin', origin);
    c.res.headers.set('Access-Control-Expose-Headers', 'ETag, Last-Modified');
    c.res.headers.set('Vary', 'Origin');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
  });

  app.options('*', (c) =>
    c.body(null, 204, {
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'If-None-Match, If-Modified-Since',
      'Access-Control-Max-Age': '86400',
    }),
  );

  app.onError((error, c) =>
    error instanceof Refused
      ? c.json({ error: error.message }, error.status)
      : c.json({ error: 'The upstream could not be read.' }, 502),
  );

  // Redirects by hand, so each hop is checked like the first address.
  const upstream = async (first: URL, headers: Record<string, string>) => {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let url = first;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await platform.fetch(url.toString(), {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        redirect: 'manual',
        signal,
      });
      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
      await response.body?.cancel();
      url = targetOf(location, url);
    }
    throw new Refused(502, 'Too many redirects.');
  };

  app.get('/feed', async (c) => {
    const url = targetOf(c.req.query('url'));
    const key = `https://proxy.cache/feed?url=${encodeURIComponent(url.toString())}`;
    const cached = await platform.cache?.match(key).catch(() => undefined);
    if (cached) return new Response(cached.body, cached);

    const conditional: Record<string, string> = {
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    };
    // Browsers pass these in the query, which spares a preflight request per feed.
    const etag = c.req.header('if-none-match') ?? c.req.query('etag');
    const since = c.req.header('if-modified-since') ?? c.req.query('since');
    if (etag) conditional['If-None-Match'] = etag;
    if (since) conditional['If-Modified-Since'] = since;
    const response = await upstream(url, conditional);
    if (response.status === 304) return c.body(null, 304);
    if (!response.ok) throw new Refused(502, `The feed answered HTTP ${response.status}.`);
    const type = response.headers.get('content-type') ?? '';
    // Never audio: a media type or a body that is not XML is refused before it is passed on.
    if (isMedia(type)) throw new Refused(415, 'Not a feed.');
    const body = await readLimited(response, LIMITS.feedBytes);
    if (!looksLikeXml(body)) throw new Refused(415, 'Not a feed.');

    const headers = new Headers({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${LIMITS.feedTtl}`,
    });
    for (const name of ['etag', 'last-modified']) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    const result = new Response(body, { status: 200, headers });
    await platform.cache?.put(key, result.clone()).catch(() => undefined);
    return result;
  });

  app.get('/cover', async (c) => {
    const url = targetOf(c.req.query('url'));
    const key = `https://proxy.cache/cover?url=${encodeURIComponent(url.toString())}`;
    const cached = await platform.cache?.match(key).catch(() => undefined);
    if (cached) return new Response(cached.body, cached);

    const response = await upstream(url, { Accept: 'image/*' });
    if (!response.ok) throw new Refused(502, `The image answered HTTP ${response.status}.`);
    const type = response.headers.get('content-type') ?? '';
    // SVG can carry script; covers are raster images.
    if (!/^image\/(jpeg|png|webp|gif|avif)\b/i.test(type)) throw new Refused(415, 'Not an image.');
    const body = await readLimited(response, LIMITS.coverBytes);
    const result = new Response(body, {
      status: 200,
      headers: { 'Content-Type': type, 'Cache-Control': `public, max-age=${LIMITS.coverTtl}` },
    });
    await platform.cache?.put(key, result.clone()).catch(() => undefined);
    return result;
  });

  // Podcasting 2.0 chapters files and transcripts (JSON, SRT, WebVTT, HTML): served as plain
  // text, so the app parses them and the browser never renders them.
  app.get('/text', async (c) => {
    const url = targetOf(c.req.query('url'));
    const key = `https://proxy.cache/text?url=${encodeURIComponent(url.toString())}`;
    const cached = await platform.cache?.match(key).catch(() => undefined);
    if (cached) return new Response(cached.body, cached);

    const response = await upstream(url, { Accept: 'application/json, text/*;q=0.9, */*;q=0.5' });
    if (!response.ok) throw new Refused(502, `The file answered HTTP ${response.status}.`);
    if (isMedia(response.headers.get('content-type') ?? '')) throw new Refused(415, 'Not text.');
    const body = await readLimited(response, LIMITS.textBytes);
    if (!looksLikeText(body)) throw new Refused(415, 'Not text.');
    const result = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': `public, max-age=${LIMITS.textTtl}`,
      },
    });
    await platform.cache?.put(key, result.clone()).catch(() => undefined);
    return result;
  });

  app.get('/', (c) => c.text('Lelap feed, cover and transcript proxy. Never audio.'));
  app.notFound((c) => c.json({ error: 'Not found.' }, 404));
  return app;
}
