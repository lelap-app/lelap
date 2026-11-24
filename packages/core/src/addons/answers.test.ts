import { describe, expect, it } from 'vitest';

import {
  AnswerCache,
  answerMaxAge,
  cachingFetcher,
  MAX_ANSWER_SECONDS,
  MAX_ANSWERS,
} from './answers';
import type { Fetcher } from './client';

const BASE = 'https://a.example/';
const CATALOG = `${BASE}catalog/audiobook/top.json`;
const init = (fresh = false) => ({
  signal: new AbortController().signal,
  headers: {},
  ...(fresh ? { cache: 'no-store' as const } : {}),
});

/** A fetcher that counts its calls and answers `body` with `header` as its Cache-Control. */
function counting(body: unknown, { status = 200, header = null as string | null } = {}) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    return {
      ok: status < 400,
      status,
      json: async () => body,
      headers: { get: (name: string) => (name.toLowerCase() === 'cache-control' ? header : null) },
    };
  };
  return { calls, fetcher };
}

describe('answerMaxAge', () => {
  it('takes the body’s cacheMaxAge first', () => {
    expect(answerMaxAge({ cacheMaxAge: 60 }, 'max-age=10')).toBe(60);
    expect(answerMaxAge({ cacheMaxAge: 0 }, 'max-age=10')).toBe(0);
  });

  it('falls back to Cache-Control', () => {
    expect(answerMaxAge({}, 'public, max-age=3600')).toBe(3600);
    expect(answerMaxAge({}, 'no-store, max-age=3600')).toBe(0);
    expect(answerMaxAge({}, 'no-cache')).toBe(0);
    expect(answerMaxAge({}, null)).toBe(0);
    expect(answerMaxAge(null, undefined)).toBe(0);
  });

  it('keeps nothing for odd values and at most a day', () => {
    expect(answerMaxAge({ cacheMaxAge: -5 }, null)).toBe(0);
    expect(answerMaxAge({ cacheMaxAge: Number.NaN }, 'max-age=9')).toBe(9);
    expect(answerMaxAge({ cacheMaxAge: 10 * MAX_ANSWER_SECONDS }, null)).toBe(MAX_ANSWER_SECONDS);
  });
});

describe('cachingFetcher', () => {
  it('answers again from memory while the add-on’s answer is fresh', async () => {
    let clock = 1_000;
    const { calls, fetcher } = counting({ metas: [], cacheMaxAge: 60 });
    const cached = cachingFetcher(fetcher, new AnswerCache(), () => clock);
    expect(await (await cached(CATALOG, init())).json()).toEqual({ metas: [], cacheMaxAge: 60 });
    clock += 59_000;
    const again = await cached(CATALOG, init());
    expect(again.ok).toBe(true);
    expect(await again.json()).toEqual({ metas: [], cacheMaxAge: 60 });
    expect(calls).toHaveLength(1);
    clock += 2_000;
    await cached(CATALOG, init());
    expect(calls).toHaveLength(2);
  });

  it('asks every time without an age', async () => {
    const { calls, fetcher } = counting({ metas: [] });
    const cached = cachingFetcher(fetcher, new AnswerCache());
    await cached(CATALOG, init());
    await cached(CATALOG, init());
    expect(calls).toHaveLength(2);
  });

  it('uses Cache-Control when the body has no age', async () => {
    const { calls, fetcher } = counting({ meta: {} }, { header: 'max-age=600' });
    const cached = cachingFetcher(fetcher, new AnswerCache());
    await cached(`${BASE}meta/audiobook/x.json`, init());
    await cached(`${BASE}meta/audiobook/x.json`, init());
    expect(calls).toHaveLength(1);
  });

  it('never keeps the manifest, /health, errors or other addresses', async () => {
    const { calls, fetcher } = counting({ cacheMaxAge: 600 }, { header: 'max-age=600' });
    const cached = cachingFetcher(fetcher, new AnswerCache());
    for (const url of [`${BASE}manifest.json`, `${BASE}health`, 'https://feeds.example/x.json']) {
      await cached(url, init());
      await cached(url, init());
    }
    expect(calls).toHaveLength(6);
    const failing = counting({ cacheMaxAge: 600 }, { status: 503 });
    const cachedFailing = cachingFetcher(failing.fetcher, new AnswerCache());
    expect((await cachedFailing(CATALOG, init())).status).toBe(503);
    await cachedFailing(CATALOG, init());
    expect(failing.calls).toHaveLength(2);
  });

  it('asks past the cache for a second look and keeps the new answer', async () => {
    let body: unknown = { streams: [], cacheMaxAge: 600 };
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => body };
    };
    const cached = cachingFetcher(fetcher, new AnswerCache());
    const url = `${BASE}stream/audiobook/x.json`;
    await cached(url, init());
    body = { streams: [{ url: 'https://x' }], cacheMaxAge: 600 };
    expect(await (await cached(url, init(true))).json()).toEqual(body);
    expect(await (await cached(url, init())).json()).toEqual(body);
    expect(calls).toHaveLength(2);
  });

  it('passes on a body that is not JSON and keeps nothing', async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: () => Promise.reject(new SyntaxError('bad')) };
    };
    const cached = cachingFetcher(fetcher, new AnswerCache());
    await expect((await cached(CATALOG, init())).json()).rejects.toThrow('bad');
    await cached(CATALOG, init());
    expect(calls).toHaveLength(2);
  });
});

describe('AnswerCache', () => {
  it('keeps at most MAX_ANSWERS, dropping the oldest', () => {
    const cache = new AnswerCache();
    for (let i = 0; i <= MAX_ANSWERS; i++)
      cache.set(`${BASE}meta/audiobook/${i}.json`, { status: 200, body: i, until: 10 });
    expect(cache.size).toBe(MAX_ANSWERS);
    expect(cache.get(`${BASE}meta/audiobook/0.json`, 0)).toBeNull();
    expect(cache.get(`${BASE}meta/audiobook/1.json`, 0)?.body).toBe(1);
  });

  it('forgets one add-on’s answers', () => {
    const cache = new AnswerCache();
    cache.set(`${BASE}meta/audiobook/1.json`, { status: 200, body: 1, until: 10 });
    cache.set('https://b.example/meta/audiobook/1.json', { status: 200, body: 2, until: 10 });
    cache.forget(BASE);
    expect(cache.size).toBe(1);
    cache.forget();
    expect(cache.size).toBe(0);
  });
});
