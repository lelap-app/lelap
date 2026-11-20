import { describe, expect, it } from 'vitest';

import { fetchLimit, type ManualFetch, sandboxFetch } from './sandboxFetch';

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string };
type Answer = { status: number; type?: string; url?: string; headers?: Record<string, string> };

/**
 * A network like React Native's own fetch on Android: OkHttp follows a redirect, a 307 with the
 * posted body and the headers, unless the request says `redirect: 'manual'`.
 */
function network(answer: (url: string) => Answer) {
  const sent: Sent[] = [];
  const fetch: ManualFetch = async (url, init) => {
    let at = url;
    for (let hop = 0; hop < 5; hop++) {
      sent.push({
        url: at,
        method: init.method,
        headers: init.headers ?? {},
        ...(init.body === undefined ? {} : { body: init.body }),
      });
      const reply = answer(at);
      const location = reply.headers?.location;
      if (reply.status >= 300 && reply.status < 400 && location && init.redirect !== 'manual') {
        at = location;
        continue;
      }
      const headers = new Headers(reply.headers ?? {});
      return {
        status: reply.status,
        ...(reply.type ? { type: reply.type } : {}),
        url: reply.url ?? at,
        headers: { get: (name: string) => headers.get(name) },
        text: async () => {
          if (reply.headers?.['content-length'] === '999999') throw new Error('read in full');
          return 'answer';
        },
      };
    }
    throw new Error('too many redirects');
  };
  return { fetch, sent };
}

const options = { timeoutMs: 5_000, maxChars: 1_000, tooLarge: 'Too large' };
const LOGIN = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{"access":"AbCdEf0123456789","secret":"ZyXwVu9876543210"}',
};

describe('the sandbox’s fetch', () => {
  it('never re-posts a login to where a 307 points', async () => {
    const { fetch, sent } = network((url) =>
      url.startsWith('https://openlibrary.org/')
        ? { status: 307, headers: { location: 'https://evil.example/collect' } }
        : { status: 200 },
    );
    const reply = await sandboxFetch(
      fetch,
      'https://openlibrary.org/account/login',
      LOGIN,
      ['openlibrary.org'],
      options,
    );
    expect(reply).toEqual({
      error: 'Not allowed: the server answered with a redirect, which add-ons don’t follow.',
    });
    expect(sent.map((s) => s.url)).toEqual(['https://openlibrary.org/account/login']);
  });

  it('never sends a cookie on to where a 302 points, even on the same host', async () => {
    const { fetch, sent } = network((url) =>
      url.endsWith('/bookshelves.json')
        ? { status: 302, headers: { location: 'https://openlibrary.org/account/login' } }
        : { status: 200 },
    );
    const reply = await sandboxFetch(
      fetch,
      'https://openlibrary.org/works/OL1W/bookshelves.json',
      { method: 'POST', headers: { Cookie: 'session=abc' }, body: 'bookshelf_id=2' },
      ['openlibrary.org'],
      options,
    );
    expect(reply).toHaveProperty('error');
    expect(sent).toHaveLength(1);
  });

  it('asks for no cookies and no redirects, and treats a browser’s hidden redirect as one', async () => {
    const asked: Parameters<ManualFetch>[1][] = [];
    const fetch: ManualFetch = async (_url, init) => {
      asked.push(init);
      return {
        status: 0,
        type: 'opaqueredirect',
        headers: { get: () => null },
        text: async () => '',
      };
    };
    const reply = await sandboxFetch(
      fetch,
      'https://openlibrary.org/',
      undefined,
      ['openlibrary.org'],
      options,
    );
    expect(reply).toHaveProperty('error');
    expect(asked[0]).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual' });
  });

  it('reaches only declared hosts, over https unless a port is written out', async () => {
    const { fetch, sent } = network(() => ({ status: 200 }));
    for (const url of [
      'https://evil.example/',
      'http://openlibrary.org/account/login',
      'file:///etc/passwd',
    ]) {
      expect(await sandboxFetch(fetch, url, LOGIN, ['openlibrary.org'], options)).toHaveProperty(
        'error',
      );
    }
    expect(sent).toHaveLength(0);
    // A typed LAN address carries its port, so plain http works there (HTTP folder, M57).
    const lan = await sandboxFetch(
      fetch,
      'http://nas.local:8080/books/',
      undefined,
      ['nas.local:8080'],
      options,
    );
    expect(lan).toMatchObject({ status: 200 });
  });

  it('hands the add-on the type and a login’s cookie, nothing else, and refuses another host’s answer', async () => {
    const { fetch } = network(() => ({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'session=abc; Path=/',
        'x-other': 'no',
      },
    }));
    expect(
      await sandboxFetch(
        fetch,
        'https://openlibrary.org/',
        undefined,
        ['openlibrary.org'],
        options,
      ),
    ).toEqual({
      status: 200,
      text: 'answer',
      headers: { 'content-type': 'application/json', 'set-cookie': 'session=abc; Path=/' },
    });
    // A login challenge, for an add-on that answers Digest itself (M135).
    const challenge = 'Digest realm="calibre", nonce="abc", qop="auth"';
    const refused = network(() => ({ status: 401, headers: { 'www-authenticate': challenge } }));
    expect(
      await sandboxFetch(
        refused.fetch,
        'https://openlibrary.org/',
        undefined,
        ['openlibrary.org'],
        options,
      ),
    ).toMatchObject({ status: 401, headers: { 'www-authenticate': challenge } });
    const moved = network(() => ({ status: 200, url: 'https://evil.example/' }));
    expect(
      await sandboxFetch(
        moved.fetch,
        'https://openlibrary.org/',
        undefined,
        ['openlibrary.org'],
        options,
      ),
    ).toEqual({ error: 'Not allowed: the answer came from another host.' });
  });

  it('leaves out headers that name the host or the connection', async () => {
    const { fetch, sent } = network(() => ({ status: 200 }));
    await sandboxFetch(
      fetch,
      'https://openlibrary.org/',
      { headers: { Host: 'router.home', 'Transfer-Encoding': 'chunked', Cookie: 'a=1' } },
      ['openlibrary.org'],
      options,
    );
    expect(sent[0]?.headers).toEqual({ Cookie: 'a=1' });
  });

  it('refuses an answer that is too large', async () => {
    const { fetch } = network(() => ({ status: 200 }));
    const reply = await sandboxFetch(
      fetch,
      'https://openlibrary.org/',
      undefined,
      ['openlibrary.org'],
      {
        ...options,
        maxChars: 2,
      },
    );
    expect(reply).toEqual({ error: 'Too large' });
    // A server that says how large it is gets refused before its answer is read.
    const big = network(() => ({ status: 200, headers: { 'content-length': '999999' } }));
    expect(
      await sandboxFetch(
        big.fetch,
        'https://openlibrary.org/',
        undefined,
        ['openlibrary.org'],
        options,
      ),
    ).toEqual({ error: 'Too large' });
  });

  it('lets only addresses the listener typed reach the home network', async () => {
    const seen: boolean[] = [];
    const fetch: ManualFetch = async (_url, init) => {
      seen.push(init.localNetwork);
      return { status: 200, headers: { get: () => null }, text: async () => '' };
    };
    const hosts = ['api.example', 'nas.local:8080'];
    const typed = ['nas.local:8080'];
    await sandboxFetch(fetch, 'https://api.example/', undefined, hosts, { ...options, typed });
    await sandboxFetch(fetch, 'http://nas.local:8080/', undefined, hosts, { ...options, typed });
    await sandboxFetch(fetch, 'http://nas.local:8080/', undefined, hosts, options);
    expect(seen).toEqual([false, true, false]);
  });
});

describe('the limit on parallel fetches', () => {
  it('runs a few at a time, in order', async () => {
    const limit = fetchLimit(2);
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const task = (n: number) => async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      order.push(n);
      if (n === 1) throw new Error('fails');
      return n;
    };
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => limit(task(n))));
    expect(most).toBe(2);
    expect(order).toEqual([1, 2, 3, 4, 5]);
    // A failed task still frees its slot.
    expect(results.map((r) => r.status)).toEqual([
      'rejected',
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ]);
  });
});
