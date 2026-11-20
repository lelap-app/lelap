import { readFileSync } from 'node:fs';

import type { Manifest, Meta, MetaPreview } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { instanceUrl, parseShelfRss, throttle, userName } from '../src/bookwyrm/instance';
import { bookPath } from '../src/bookwyrm/match';
import type { FetchLike } from '../src/upstream';
import { fixture } from './helpers';

// A fake BookWyrm instance at books.example, shaped like bookwyrm.social's answers (0.9.4), with
// one user, `reader`. No real accounts anywhere.

const SECRET = 'test-secret-that-is-long-enough-1234567890';
const ORIGIN = 'https://addons.example';
const INSTANCE = 'https://books.example';

type Mode = { signed?: boolean; private?: boolean; down?: boolean };

const raw = (name: string) => readFileSync(`${import.meta.dirname}/fixtures/${name}`, 'utf8');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const THREE_MEN = {
  docs: [
    {
      key: '/works/OL15016W',
      title: 'Three Men in a Boat',
      author_name: ['Jerome K. Jerome'],
      first_publish_year: 1889,
      cover_i: 6593213,
    },
  ],
};

function world(mode: Mode = {}) {
  const calls: URL[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.origin === 'https://openlibrary.org' && url.pathname === '/search.json') {
      const q = url.searchParams.get('q');
      if (q === 'edition_key:OL7170283M' || q === 'isbn:9780141321066')
        return json(fixture('openlibrary-search-secret-garden.json'));
      if (q === 'isbn:9781862052215') return json(THREE_MEN);
      return json({ numFound: 0, docs: [] });
    }
    if (url.origin !== INSTANCE) return new Response('', { status: 404 });
    if (mode.down) throw new TypeError('fetch failed');
    if (url.pathname === '/.well-known/webfinger')
      return url.searchParams.get('resource') === 'acct:reader@books.example'
        ? json(fixture('bookwyrm-webfinger.json'))
        : json({ error: 'not found' }, 404);
    const shelf = /^\/user\/([^/]+)\/books\/([\w-]+)(\.json|\/rss)$/.exec(url.pathname);
    const book = /^\/book\/(\d+)\.json$/.exec(url.pathname);
    if (mode.signed && url.pathname.endsWith('.json'))
      return new Response('Invalid signature', { status: 403 });
    if (book) {
      const found = (
        fixture('bookwyrm-to-read-page-1.json') as { orderedItems: { id: string }[] }
      ).orderedItems.find((b) => b.id === `${INSTANCE}/book/${book[1]}`);
      return found ? json(found) : json({}, 404);
    }
    if (!shelf || shelf[1] !== 'reader' || mode.private) return new Response('', { status: 404 });
    const [, , name, kind] = shelf;
    if (kind === '/rss')
      return name === 'to-read'
        ? new Response(raw('bookwyrm-to-read.rss'), {
            headers: { 'Content-Type': 'application/rss+xml' },
          })
        : new Response('<rss><channel></channel></rss>');
    if (name === 'to-read')
      return json(fixture(`bookwyrm-to-read-page-${url.searchParams.get('page') ?? '1'}.json`));
    return json(fixture('bookwyrm-read-empty.json'));
  };
  return { fetch, calls };
}

const appWith = (fetch: FetchLike) =>
  createApp({ fetch, now: () => 0, wait: async () => undefined }, { CONFIG_SECRET: SECRET });

type App = ReturnType<typeof appWith>;

const configure = async (app: App, form: Record<string, string>) => {
  const response = await app.fetch(
    new Request(`${ORIGIN}/bookwyrm/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    }),
  );
  const html = await response.text();
  return { html, url: /<code>([^<]+manifest\.json)<\/code>/.exec(html)?.[1] ?? '' };
};

const get = (app: App, url: string) => app.fetch(new Request(url));
const shelf = async (app: App, url: string, id: string, skip = 0) => {
  const path = skip ? `catalog/audiobook/${id}/skip=${skip}.json` : `catalog/audiobook/${id}.json`;
  const response = await get(app, url.replace('manifest.json', path));
  expect(response.status).toBe(200);
  return ((await response.json()) as { metas: MetaPreview[] }).metas;
};

describe('BookWyrm settings', () => {
  it('reads instance addresses and user names', () => {
    expect(instanceUrl('bookwyrm.social')).toBe('https://bookwyrm.social');
    expect(instanceUrl('https://books.example/user/reader')).toBe(INSTANCE);
    expect(() => instanceUrl('http://books.example')).toThrow('https');
    expect(userName('@reader', INSTANCE)).toBe('reader');
    expect(userName('@reader@books.example', INSTANCE)).toBe('reader');
    expect(userName('reader@elsewhere.example', INSTANCE)).toBeNull();
    expect(userName('a b', INSTANCE)).toBeNull();
  });

  it('reads book IDs, books only', () => {
    expect(bookPath('bookwyrm:books.example/book/15')).toEqual({
      host: 'books.example',
      path: '/book/15',
    });
    expect(bookPath('bookwyrm:books.example/user/reader')).toBeNull();
    expect(bookPath('bookwyrm:books.example/book/15/../../admin')).toBeNull();
  });

  it('spaces requests to one host a second apart', async () => {
    let now = 0;
    const waits: number[] = [];
    const turn = throttle(
      async (ms) => {
        waits.push(ms);
      },
      () => now,
    );
    await turn('a');
    await turn('a');
    await turn('b');
    now = 5000;
    await turn('a');
    expect(waits).toEqual([1000]);
    // A queue of more than eight seconds is refused.
    for (let i = 0; i < 9; i++) await turn('c');
    await expect(turn('c')).rejects.toThrow('busy');
  });
});

describe('BookWyrm configure page', () => {
  it('seals instance and user into the add-on and lists the four shelves', async () => {
    const app = appWith(world().fetch);
    const { url } = await configure(app, { instance: 'books.example', user: '@reader' });
    expect(url).toMatch(/^https:\/\/addons\.example\/bookwyrm\/e2\.[\w-]+\/manifest\.json$/);
    const manifest = (await (await get(app, url)).json()) as Manifest;
    expect(manifest.catalogs.map((c) => [c.id, c.name, c.shelf])).toEqual([
      ['to-read', 'Want to read on BookWyrm', 'want-to-read'],
      ['reading', 'Currently reading on BookWyrm', undefined],
      ['read', 'Read on BookWyrm', undefined],
      ['stopped-reading', 'Stopped reading on BookWyrm', undefined],
    ]);
    expect(manifest.configurable).toBe(true);
    // Listed at the root with the other configure pages.
    const root = (await (await get(app, `${ORIGIN}/`)).json()) as { configure: string[] };
    expect(root.configure).toContain(`${ORIGIN}/bookwyrm/configure`);
  });

  it('asks for no password', async () => {
    const html = await (await get(appWith(world().fetch), `${ORIGIN}/bookwyrm/configure`)).text();
    expect(html).not.toContain('type="password"');
    expect(html).toContain('never asks for your password');
  });

  it('says when the user is unknown', async () => {
    const { html, url } = await configure(appWith(world().fetch), {
      instance: INSTANCE,
      user: 'nobody',
    });
    expect(url).toBe('');
    expect(html).toContain('books.example has no user called nobody.');
  });

  it('says when the shelves are private', async () => {
    const { html, url } = await configure(appWith(world({ private: true }).fetch), {
      instance: INSTANCE,
      user: 'reader',
    });
    expect(url).toBe('');
    expect(html).toContain('Your shelves on books.example are private.');
  });

  it('says when the instance doesn’t answer', async () => {
    const { html, url } = await configure(appWith(world({ down: true }).fetch), {
      instance: INSTANCE,
      user: 'reader',
    });
    expect(url).toBe('');
    expect(html).toContain('books.example did not answer');
  });

  it('accepts an instance that requires signed GET', async () => {
    const { url } = await configure(appWith(world({ signed: true }).fetch), {
      instance: INSTANCE,
      user: 'reader',
    });
    expect(url).not.toBe('');
  });
});

describe('BookWyrm shelves', () => {
  it('shows a shelf from JSON, matched to Open Library works, page by page', async () => {
    const { fetch, calls } = world();
    const app = appWith(fetch);
    const { url } = await configure(app, { instance: INSTANCE, user: 'reader' });
    const first = await shelf(app, url, 'to-read');
    expect(first).toEqual([
      {
        id: 'ol:OL69612W',
        type: 'audiobook',
        name: 'The Secret Garden',
        author: 'Frances Hodgson Burnett',
        cover: `${INSTANCE}/images/covers/11.jpg`,
        year: 1911,
      },
      {
        id: 'ol:OL15016W',
        type: 'audiobook',
        name: 'Three Men in a Boat',
        author: 'Jerome K. Jerome',
        cover: `${INSTANCE}/images/covers/13.jpg`,
        year: 1889,
      },
    ]);
    // Page 1 has two books, so skip=2 is page 2.
    const second = await shelf(app, url, 'to-read', 2);
    expect(second).toEqual([
      {
        id: 'bookwyrm:books.example/book/15',
        type: 'audiobook',
        // No cover, so no caption to name the author.
        name: 'A Very Obscure Pamphlet',
      },
    ]);
    expect(calls.some((c) => c.searchParams.get('page') === '2')).toBe(true);
    // Without an author, no search by title alone.
    expect(calls.some((c) => c.searchParams.has('title'))).toBe(false);
    expect(await shelf(app, url, 'read')).toEqual([]);
  });

  it('opens an unmatched book with a link to its page on the instance', async () => {
    const { fetch, calls } = world();
    const app = appWith(fetch);
    const { url } = await configure(app, { instance: INSTANCE, user: 'reader' });
    const response = await get(
      app,
      url.replace('manifest.json', 'meta/audiobook/bookwyrm%3Abooks.example%2Fbook%2F11.json'),
    );
    const { meta } = (await response.json()) as { meta: Meta };
    expect(meta).toMatchObject({
      name: 'The Secret Garden',
      author: 'Frances Hodgson Burnett',
      description: 'A girl finds a & garden.',
      externalIds: { isbn: '9780141321066' },
      link: `${INSTANCE}/book/11`,
    });
    // A book from another instance on no shelf: named plainly, and that instance is never asked.
    const before = calls.length;
    const elsewhere = await get(
      app,
      url.replace('manifest.json', 'meta/audiobook/bookwyrm%3Aother.example%2Fbook%2F11.json'),
    );
    expect(((await elsewhere.json()) as { meta: Meta }).meta).toMatchObject({
      name: 'A book on BookWyrm',
      link: 'https://other.example/book/11',
    });
    expect(calls.slice(before).some((c) => c.host === 'other.example')).toBe(false);
  });

  it('reads RSS when the instance requires signed GET', async () => {
    const { fetch, calls } = world({ signed: true });
    const app = appWith(fetch);
    const { url } = await configure(app, { instance: INSTANCE, user: 'reader' });
    const metas = await shelf(app, url, 'to-read');
    expect(metas.map((m) => [m.id, m.name, m.author])).toEqual([
      ['ol:OL69612W', 'The Secret Garden', 'Frances Hodgson Burnett'],
      ['bookwyrm:books.example/book/15', 'A Very Obscure Pamphlet: Part Two', 'Nobody Known'],
      // First added on another instance; its title alone finds no match.
      ['bookwyrm:other.example/book/9', 'Elsewhere', undefined],
    ]);
    expect(calls.some((c) => c.pathname === '/user/reader/books/to-read/rss')).toBe(true);
    // RSS has no further pages.
    expect(await shelf(app, url, 'to-read', 2)).toEqual([]);
    // The book's JSON is refused too; its name comes from the shelf's RSS.
    const response = await get(
      app,
      url.replace('manifest.json', 'meta/audiobook/bookwyrm%3Abooks.example%2Fbook%2F15.json'),
    );
    const { meta } = (await response.json()) as { meta: Meta };
    expect(meta).toMatchObject({
      name: 'A Very Obscure Pamphlet: Part Two',
      link: `${INSTANCE}/book/15`,
    });
  });

  it('shows an empty row for a shelf made private, or an instance that went away', async () => {
    const mode: Mode = {};
    const { fetch } = world(mode);
    const app = appWith(fetch);
    const { url } = await configure(app, { instance: INSTANCE, user: 'reader' });
    mode.private = true;
    expect(await shelf(app, url, 'reading')).toEqual([]);
    mode.private = false;
    mode.down = true;
    expect(await shelf(app, url, 'stopped-reading')).toEqual([]);
  });

  it('never posts to the instance', async () => {
    const posts: string[] = [];
    const { fetch } = world();
    const watched: FetchLike = (url, init) => {
      if (init.method && init.method !== 'GET') posts.push(url);
      return fetch(url, init);
    };
    const app = appWith(watched);
    const { url } = await configure(app, { instance: INSTANCE, user: 'reader' });
    for (const id of ['to-read', 'reading', 'read', 'stopped-reading']) await shelf(app, url, id);
    expect(posts).toEqual([]);
  });
});

describe('BookWyrm shelf RSS', () => {
  it('reads title, author, ISBN and the book’s address, from any instance', () => {
    expect(parseShelfRss(raw('bookwyrm-to-read.rss'), INSTANCE)).toEqual([
      {
        url: `${INSTANCE}/book/11`,
        title: 'The Secret Garden',
        author: 'Frances Hodgson Burnett',
        isbn: '9780141321066',
      },
      {
        url: `${INSTANCE}/book/15`,
        title: 'A Very Obscure Pamphlet: Part Two',
        author: 'Nobody Known',
      },
      { url: 'https://other.example/book/9', title: 'Elsewhere' },
    ]);
  });
});
