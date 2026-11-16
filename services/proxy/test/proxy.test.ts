import { describe, expect, it } from 'vitest';

import { createApp, LIMITS, looksLikeXml, type Platform } from '../src/app';

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

describe('cover proxy', () => {
  it('passes raster images and refuses everything else', async () => {
    const png = setup(
      () =>
        new Response(new Uint8Array([0x89, 0x50]), { headers: { 'Content-Type': 'image/png' } }),
    );
    const ok = await png.get('/cover?url=http%3A%2F%2Fimg.example.org%2Fc.png');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    const svg = setup(
      () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    );
    expect((await svg.get('/cover?url=https%3A%2F%2Fimg.example.org%2Fc.svg')).status).toBe(415);
    const audio = setup(() => new Response('x', { headers: { 'Content-Type': 'audio/mpeg' } }));
    expect((await audio.get('/cover?url=https%3A%2F%2Fcdn.example.org%2Fa.mp3')).status).toBe(415);
  });
});
