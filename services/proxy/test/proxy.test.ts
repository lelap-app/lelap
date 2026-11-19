import { describe, expect, it } from 'vitest';

import { createApp, imageTypeOf, LIMITS, looksLikeXml, type Platform } from '../src/app';

const FEED = '<?xml version="1.0"?><rss><channel><title>T</title></channel></rss>';

function setup(answer: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const store = new Map<string, Response>();
  const platform: Platform = {
    fetch: (url, init) => {
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return Promise.resolve(answer(url, init));
    },
    cache: {
      match: (key) => Promise.resolve(store.get(key)?.clone()),
      put: (key, response) => {
        store.set(key, response);
        return Promise.resolve();
      },
    },
  };
  const app = createApp(platform, { ALLOW_ORIGIN: 'https://listen.example.org' });
  const get = (path: string, headers: Record<string, string> = {}) =>
    app.request(`https://proxy.example.org${path}`, { headers });
  return { get, calls };
}

const feedUrl = (url: string) => `/feed?url=${encodeURIComponent(url)}`;

describe('feed proxy', () => {
  it('passes a feed on with CORS and its validators, and caches it', async () => {
    const { get, calls } = setup(
      () =>
        new Response(FEED, {
          headers: { 'Content-Type': 'application/rss+xml', ETag: '"v1"' },
        }),
    );
    const response = await get(feedUrl('https://feeds.example.org/a.xml'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(FEED);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://listen.example.org');
    expect(response.headers.get('etag')).toBe('"v1"');
    expect(response.headers.get('access-control-expose-headers')).toContain('ETag');
    await get(feedUrl('https://feeds.example.org/a.xml'));
    expect(calls).toHaveLength(1);
  });

  it('forwards conditional requests and passes 304 on', async () => {
    const { get, calls } = setup(() => new Response(null, { status: 304 }));
    const response = await get(feedUrl('https://feeds.example.org/a.xml'), {
      'If-None-Match': '"v1"',
    });
    expect(response.status).toBe(304);
    expect(calls[0]?.headers['If-None-Match']).toBe('"v1"');
  });

  it('takes the validators from the query too, so browsers need no preflight', async () => {
    const { get, calls } = setup(() => new Response(null, { status: 304 }));
    const query = new URLSearchParams({
      url: 'https://feeds.example.org/a.xml',
      etag: '"v2"',
      since: 'Mon, 16 Nov 2026 10:00:00 GMT',
    });
    expect((await get(`/feed?${query.toString()}`)).status).toBe(304);
    expect(calls[0]?.headers).toMatchObject({
      'If-None-Match': '"v2"',
      'If-Modified-Since': 'Mon, 16 Nov 2026 10:00:00 GMT',
    });
  });

  it('never passes audio, whatever the server calls it', async () => {
    const audio = setup(
      () =>
        new Response(new Uint8Array([0x49, 0x44, 0x33]), {
          headers: { 'Content-Type': 'audio/mpeg' },
        }),
    );
    expect((await audio.get(feedUrl('https://cdn.example.org/ep.mp3'))).status).toBe(415);
    const disguised = setup(
      () =>
        new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
          headers: { 'Content-Type': 'text/xml' },
        }),
    );
    expect((await disguised.get(feedUrl('https://cdn.example.org/ep.mp3'))).status).toBe(415);
  });

  it('refuses large bodies, other schemes and missing addresses', async () => {
    const big = setup(
      () =>
        new Response('<rss/>', {
          headers: { 'Content-Type': 'text/xml', 'Content-Length': String(LIMITS.feedBytes + 1) },
        }),
    );
    expect((await big.get(feedUrl('https://feeds.example.org/a.xml'))).status).toBe(413);
    const { get } = setup(() => new Response(FEED));
    expect((await get(feedUrl('file:///etc/passwd'))).status).toBe(400);
    expect((await get('/feed')).status).toBe(400);
  });

  it('reports upstream failures as 502', async () => {
    const { get } = setup(() => new Response('nope', { status: 500 }));
    expect((await get(feedUrl('https://feeds.example.org/a.xml'))).status).toBe(502);
  });

  it('sniffs XML after a byte order mark and whitespace', () => {
    const enc = new TextEncoder();
    expect(looksLikeXml(enc.encode('﻿  \n<rss/>'))).toBe(true);
    expect(looksLikeXml(enc.encode('ID3'))).toBe(false);
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49]);
const coverUrl = (url: string) => `/cover?url=${encodeURIComponent(url)}`;
const ascii = (text: string) => new TextEncoder().encode(text);

describe('cover proxy', () => {
  it('passes raster images with the type their first bytes name', async () => {
    const png = setup(() => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }));
    const ok = await png.get(coverUrl('http://img.example.org/c.png'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    const octets = setup(
      () => new Response(PNG, { headers: { 'Content-Type': 'application/octet-stream' } }),
    );
    const sniffed = await octets.get(coverUrl('http://img.example.org/c'));
    expect(sniffed.status).toBe(200);
    expect(sniffed.headers.get('content-type')).toBe('image/png');
  });

  it('refuses SVG, HTML and audio whatever their Content-Type says', async () => {
    const svg = setup(() => new Response('<svg/>', { headers: { 'Content-Type': 'image/png' } }));
    expect((await svg.get(coverUrl('https://img.example.org/c.svg'))).status).toBe(415);
    const html = setup(
      () => new Response('<!doctype html><p>hi</p>', { headers: { 'Content-Type': 'image/jpeg' } }),
    );
    expect((await html.get(coverUrl('https://img.example.org/c.jpg'))).status).toBe(415);
    const audio = setup(() => new Response(PNG, { headers: { 'Content-Type': 'audio/mpeg' } }));
    expect((await audio.get(coverUrl('https://cdn.example.org/a.mp3'))).status).toBe(415);
    const m4a = new Uint8Array([0, 0, 0, 32, ...ascii('ftypM4A '), 0, 0, 0, 0]);
    const octets = setup(
      () => new Response(m4a, { headers: { 'Content-Type': 'application/octet-stream' } }),
    );
    expect((await octets.get(coverUrl('https://cdn.example.org/a'))).status).toBe(415);
  });

  it('stops reading a body sent under another type once its first bytes are not an image', async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulls++;
        controller.enqueue(
          new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        );
      },
    });
    const octets = setup(
      () => new Response(endless, { headers: { 'Content-Type': 'application/octet-stream' } }),
    );
    expect((await octets.get(coverUrl('https://cdn.example.org/episode'))).status).toBe(415);
    expect(pulls).toBeLessThan(4);
  });

  it('allows artwork up to the cover limit', async () => {
    const big = new Uint8Array(LIMITS.coverBytes);
    big.set(PNG);
    const ok = setup(() => new Response(big));
    expect((await ok.get(coverUrl('https://img.example.org/big.png'))).status).toBe(200);
    const over = new Uint8Array(LIMITS.coverBytes + 1);
    over.set(PNG);
    const tooBig = setup(() => new Response(over));
    expect((await tooBig.get(coverUrl('https://img.example.org/huge.png'))).status).toBe(413);
  });

  it('names each image type by its signature', () => {
    const pad = new Uint8Array(8);
    const of = (...parts: (number[] | string | Uint8Array)[]) =>
      imageTypeOf(
        new Uint8Array(
          parts.flatMap((part) => (typeof part === 'string' ? [...ascii(part)] : [...part])),
        ),
      );
    expect(of([0xff, 0xd8, 0xff, 0xe0], pad)).toBe('image/jpeg');
    expect(of('GIF89a', pad)).toBe('image/gif');
    expect(of('RIFF', [0, 0, 0, 0], 'WEBP', pad)).toBe('image/webp');
    expect(of([0, 0, 0, 24], 'ftypavif', pad)).toBe('image/avif');
    expect(of([0, 0, 0, 24], 'ftypisom', pad)).toBeNull();
    expect(of('ID3', pad, pad)).toBeNull();
  });
});

describe('redirects and headers', () => {
  it('follows redirects itself, so every hop goes through the platform fetch', async () => {
    const { get, calls } = setup((url, init) => {
      expect(init.redirect).toBe('manual');
      return url === 'https://old.example.org/a.xml'
        ? new Response(null, { status: 301, headers: { Location: '/b.xml' } })
        : new Response(FEED, { headers: { 'Content-Type': 'text/xml' } });
    });
    const response = await get(feedUrl('https://old.example.org/a.xml'));
    expect(response.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      'https://old.example.org/a.xml',
      'https://old.example.org/b.xml',
    ]);
  });

  it('refuses redirects to other schemes and endless redirects', async () => {
    const other = setup(
      () => new Response(null, { status: 302, headers: { Location: 'file:///etc/passwd' } }),
    );
    expect((await other.get(feedUrl('https://a.example.org/f.xml'))).status).toBe(400);
    expect(other.calls).toHaveLength(1);

    const loop = setup(
      (url) => new Response(null, { status: 307, headers: { Location: `${url}x` } }),
    );
    expect((await loop.get(feedUrl('https://a.example.org/f'))).status).toBe(502);
    expect(loop.calls).toHaveLength(6);
  });

  it('marks every answer as a sandboxed, non-sniffable resource', async () => {
    const { get } = setup(() => new Response(FEED, { headers: { 'Content-Type': 'text/xml' } }));
    const response = await get(feedUrl('https://feeds.example.org/a.xml'));
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('text proxy', () => {
  const textUrl = (url: string) => `/text?url=${encodeURIComponent(url)}`;

  it('passes chapters and transcripts on as plain text, and caches them', async () => {
    const chapters = '{"version":"1.2.0","chapters":[{"startTime":0,"title":"Intro"}]}';
    const { get, calls } = setup(
      () => new Response(chapters, { headers: { 'Content-Type': 'application/json+chapters' } }),
    );
    const response = await get(textUrl('https://example.org/chapters.json'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe(chapters);
    await get(textUrl('https://example.org/chapters.json'));
    expect(calls).toHaveLength(1);
  });

  it('never passes audio or other binary files', async () => {
    const audio = setup(() => new Response('ID3', { headers: { 'Content-Type': 'audio/mpeg' } }));
    expect((await audio.get(textUrl('https://example.org/a.srt'))).status).toBe(415);
    const binary = setup(
      () =>
        new Response(new Uint8Array([0x49, 0x44, 0x33, 0x00, 0xff]), {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    );
    expect((await binary.get(textUrl('https://example.org/a.srt'))).status).toBe(415);
    const large = setup(
      () => new Response('x', { headers: { 'Content-Length': String(LIMITS.textBytes + 1) } }),
    );
    expect((await large.get(textUrl('https://example.org/a.srt'))).status).toBe(413);
  });
});
