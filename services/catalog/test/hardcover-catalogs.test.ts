import type { Manifest, MetaPreview } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { cacheOwner, editionIds, retryAfter } from '../src/scrobble/hardcover-api';
const DRAFT_MS = 60 * 60 * 1000;
import { listLink, MAX_LISTS } from '../src/scrobble/hardcover-catalogs';
import { createSealer } from '../src/scrobble/sealed';
import type { FetchLike, ResponseCache } from '../src/upstream';

// A fake Hardcover GraphQL server with two listeners, so the tests can check that one never
// sees the other's lists. No real tokens anywhere.

const SECRET = 'test-secret-that-is-long-enough-1234567890';
const ORIGIN = 'https://addons.example';
const READER = 'Bearer reader-token-0123456789abcdef';
const OTHER = 'Bearer other-token-0123456789abcdef';
const NO_LISTS = 'Bearer catalog-only-token-0123456789';
const EXPIRED = 'Bearer expired-token-0123456789abcdef';

type Call = { query: string; variables: Record<string, unknown>; authorization: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const book = (id: number, title: string) => ({
  id,
  title,
  image: { url: `https://assets.hardcover.app/${id}.jpg` },
  contributions: [{ author: { name: `Author ${id}` } }],
});

/** Lists by ID: who owns them, whether they are public, and their books by position. */
const LISTS: Record<number, { name: string; user: number; public: boolean; slug: string }> = {
  10: { name: 'Listen next', user: 7, public: false, slug: 'listen-next' },
  11: { name: 'Favourites', user: 7, public: true, slug: 'favourites' },
  20: { name: 'Friends’ picks', user: 9, public: true, slug: 'friends-picks' },
  30: { name: 'Hardcover staff picks', user: 1, public: true, slug: 'staff-picks' },
  40: { name: 'Someone’s public list', user: 5, public: true, slug: 'cosy' },
  50: { name: 'Someone’s private list', user: 5, public: false, slug: 'secret' },
  60: { name: 'Other listener’s private list', user: 8, public: false, slug: 'mine' },
};
const USERS: Record<number, string> = { 1: 'hardcover', 5: 'someone', 7: 'reader', 8: 'other' };

function hardcover() {
  const calls: Call[] = [];
  let status: { code: number; body: unknown } | null = null;
  const fetch: FetchLike = async (url, init) => {
    if (url !== 'https://api.hardcover.app/v1/graphql') return new Response('', { status: 404 });
    const { query, variables } = JSON.parse(init.body ?? '{}') as Omit<Call, 'authorization'>;
    const authorization = init.headers.authorization ?? '';
    calls.push({ query, variables, authorization });
    if (status) return json(status.body, status.code);
    if (authorization === EXPIRED)
      return json({ error: 'invalid_token', error_description: 'expired' }, 401);
    const me =
      authorization === READER || authorization === NO_LISTS ? 7 : authorization === OTHER ? 8 : 0;
    if (!me) return json({ error: 'invalid_token' }, 401);
    const visible = (id: number) => LISTS[id] && (LISTS[id].public || LISTS[id].user === me);
    if (query.includes('query Me'))
      return json({ data: { me: [{ id: me, username: USERS[me] }] } });
    if (/lists|list_books/.test(query) && authorization === NO_LISTS)
      return json({ error: 'insufficient_scope', scope: 'read:lists' }, 403);
    if (query.includes('query Lists'))
      return json({
        data: {
          mine: Object.entries(LISTS)
            .filter(([, l]) => l.user === variables.user)
            .map(([id, l]) => ({ id: Number(id), name: l.name })),
          followed: me === 7 ? [{ list: { id: 20, name: LISTS[20]?.name } }, { list: null }] : [],
          featured: [{ id: 30, name: LISTS[30]?.name }],
        },
      });
    if (query.includes('query ListBySlug')) {
      const found = Object.entries(LISTS).find(
        ([, l]) => l.slug === variables.slug && USERS[l.user] === variables.user,
      );
      return json({
        data: {
          lists: found
            ? [
                {
                  id: Number(found[0]),
                  name: found[1].name,
                  public: found[1].public,
                  user_id: found[1].user,
                },
              ]
            : [],
        },
      });
    }
    if (query.includes('query ListBooks')) {
      const id = variables.id as number;
      if (!visible(id)) return json({ data: { lists: [] } });
      return json({
        data: {
          lists: [
            {
              id,
              name: LISTS[id]?.name,
              // Out of order, with a book twice and a missing one: the add-on sorts and cleans.
              list_books: [
                { position: 3, book: book(id * 100 + 3, `${id} third`) },
                { position: 1, book: book(id * 100 + 1, `${id} first`) },
                { position: 2, book: null },
                { position: 4, book: book(id * 100 + 1, `${id} first`) },
              ],
            },
          ],
        },
      });
    }
    if (query.includes('books_trending')) {
      const month = query.includes('duration: month');
      return json({ data: { books_trending: { ids: month ? [3, 1, 2] : [2, 1], error: null } } });
    }
    if (query.includes('query Books')) {
      const ids = variables.ids as number[];
      // Hardcover answers in its own order, not the ranked one.
      return json({ data: { books: [...ids].sort().map((id) => book(id, `Trending ${id}`)) } });
    }
    if (query.includes('query Book(')) {
      return json({
        data: {
          books: [
            {
              ...book(42, 'Walden'),
              slug: 'walden',
              editions: [
                { isbn_13: '9780141036144', isbn_10: null, asin: null, reading_format_id: 1 },
                { isbn_13: null, isbn_10: '0307577143', asin: 'B002RI9ZQ4', reading_format_id: 2 },
              ],
            },
          ],
        },
      });
    }
    if (query.includes('query AudioEditions')) {
      return json({
        data: {
          editions: [
            {
              id: 501,
              release_date: '2010-03-01',
              audio_seconds: 30_000,
              asin: 'B002RI9ZQ4',
              isbn_13: null,
              publisher: { name: 'Blackstone Audio' },
              image: { url: 'https://assets.hardcover.app/501.jpg' },
              contributions: [
                { contribution: 'Narrator', author: { name: 'Robert Bethune' } },
                { contribution: null, author: { name: 'Henry David Thoreau' } },
              ],
            },
            { id: 502, edition_format: 'Audible Audio', contributions: [] },
            { id: 501, edition_format: 'twice' },
          ],
        },
      });
    }
    return json({ errors: [{ message: `unexpected ${query}` }] });
  };
  return {
    fetch,
    calls,
    fail: (code: number, body: unknown) => {
      status = { code, body };
    },
    heal: () => {
      status = null;
    },
  };
}

/** A cache that records its keys, standing in for the Workers Cache API. */
function recordingCache() {
  const entries = new Map<string, string>();
  const cache: ResponseCache = {
    match: async (key) => {
      const text = entries.get(key);
      return text === undefined ? undefined : new Response(text);
    },
    put: async (key, response) => {
      entries.set(key, await response.text());
    },
  };
  return { cache, entries };
}

const appWith = (fetch: FetchLike, cache?: ResponseCache) =>
  createApp({ fetch, ...(cache ? { cache } : {}), now: () => 0 }, { CONFIG_SECRET: SECRET });

type App = ReturnType<typeof createApp>;

const postForm = (app: App, path: string, form: URLSearchParams) =>
  app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }),
  );

const draftOf = (html: string) => /name="draft" value="([^"]+)"/.exec(html)?.[1] ?? '';
const linkOf = (html: string) => /<code>([^<]+manifest\.json)<\/code>/.exec(html)?.[1] ?? '';
const ticked = (html: string) =>
  [...html.matchAll(/name="(\w+)" value="([^"]+)" checked/g)].map(
    ([, name, value]) => `${name}=${value}`,
  );

/** Both settings pages: the token, then the rows. */
async function configure(app: App, token: string, picks: Record<string, string[]>) {
  const first = await (
    await postForm(app, '/hardcover/configure', new URLSearchParams({ token }))
  ).text();
  const form = new URLSearchParams({ draft: draftOf(first) });
  for (const [name, values] of Object.entries(picks))
    for (const value of values) form.append(name, value);
  const response = await postForm(app, '/hardcover/configure', form);
  const html = await response.text();
  return { first, response, html, url: linkOf(html) };
}

const get = (app: App, url: string) => app.fetch(new Request(url));
const catalog = async (app: App, url: string, id: string) =>
  get(app, url.replace('manifest.json', `catalog/audiobook/${id}.json`));
const names = async (response: Response) =>
  ((await response.json()) as { metas: MetaPreview[] }).metas.map((m) => m.name);

describe('Hardcover catalogs', () => {
  it('names the scopes it needs and links to a token form with them', async () => {
    const app = appWith(hardcover().fetch);
    const html = await (await get(app, `${ORIGIN}/hardcover/configure`)).text();
    expect(html).toContain('read:me, read:library, write:library, read:catalog, read:lists');
    expect(html).toContain(
      'https://hardcover.app/account/api/keys/new?scope=read:me+read:library+write:library+read:catalog+read:lists',
    );
  });

  it('offers own, followed and featured lists, own ones ticked, without the token in the page', async () => {
    const app = appWith(hardcover().fetch);
    const response = await postForm(
      app,
      '/hardcover/configure',
      new URLSearchParams({ token: READER }),
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).not.toContain('reader-token');
    for (const name of ['Listen next', 'Favourites', 'Friends’ picks', 'Hardcover staff picks'])
      expect(html).toContain(name);
    expect(html).not.toContain('Other listener');
    expect(ticked(html)).toEqual(['trending=month', 'trending=all', 'mine=10', 'mine=11']);
  });

  it('shows the chosen rows, credited to Hardcover', async () => {
    const app = appWith(hardcover().fetch);
    const { url, html } = await configure(app, READER, {
      trending: ['month'],
      mine: ['10'],
      followed: ['20'],
      featured: ['30'],
      links: ['https://hardcover.app/@someone/lists/cosy'],
    });
    expect(html).not.toContain('reader-token');
    expect(url).toMatch(/^https:\/\/addons\.example\/hardcover\/e2\.[\w-]+\/manifest\.json$/);
    const manifest = (await (await get(app, url)).json()) as Manifest;
    expect(manifest.catalogs.map((c) => [c.id, c.name])).toEqual([
      ['want-to-read', 'Want to read'],
      ['trending-month', 'Trending this month on Hardcover'],
      ['list-10', 'Listen next on Hardcover'],
      ['list-20', 'Friends’ picks on Hardcover'],
      ['list-30', 'Hardcover staff picks on Hardcover'],
      ['list-40', 'Someone’s public list on Hardcover'],
    ]);
    expect((await catalog(app, url, 'trending-all')).status).toBe(404);
    expect((await catalog(app, url, 'list-11')).status).toBe(404);
  });

  it('refuses a link to someone else’s private list, and too many lists', async () => {
    const app = appWith(hardcover().fetch);
    const secret = await configure(app, READER, {
      links: ['https://hardcover.app/@someone/lists/secret'],
    });
    expect(secret.response.status).toBe(400);
    expect(secret.html).toContain('Hardcover has no public list at');
    expect(secret.html).toContain('name="draft"');

    const notAList = await configure(app, READER, { links: ['https://example.org/@a/lists/b'] });
    expect(notAList.html).toContain('is not a link to a Hardcover list');

    const many = await configure(app, READER, {
      mine: ['10', '11'],
      followed: ['20'],
      featured: ['30'],
      // One text field: several links in it, apart by spaces.
      links: [
        Array.from({ length: MAX_LISTS }, () => 'https://hardcover.app/@someone/lists/cosy').join(
          ' ',
        ),
      ],
    });
    expect(many.html).toContain(`Pick up to ${MAX_LISTS} lists.`);
  });

  it('keeps the trending rank and asks Hardcover once per token', async () => {
    const server = hardcover();
    const app = appWith(server.fetch);
    const { url } = await configure(app, READER, { trending: ['month', 'all'] });
    const before = server.calls.length;
    const response = await catalog(app, url, 'trending-month');
    expect(response.status).toBe(200);
    expect(await names(response)).toEqual(['Trending 3', 'Trending 1', 'Trending 2']);
    expect(server.calls.length - before).toBe(2);
    expect(await names(await catalog(app, url, 'trending-month'))).toEqual([
      'Trending 3',
      'Trending 1',
      'Trending 2',
    ]);
    expect(server.calls.length - before).toBe(2);
    expect(await names(await catalog(app, url, 'trending-all'))).toEqual([
      'Trending 2',
      'Trending 1',
    ]);
  });

  it('lists a list’s books in its own order, kept out of shared caches', async () => {
    const app = appWith(hardcover().fetch);
    const { url } = await configure(app, READER, { mine: ['10'] });
    const response = await catalog(app, url, 'list-10');
    const body = (await response.json()) as { metas: MetaPreview[]; cacheMaxAge: number };
    expect(body.metas.map((m) => [m.id, m.name, m.cover])).toEqual([
      ['hardcover:1001', '10 first', 'https://assets.hardcover.app/1001.jpg'],
      ['hardcover:1003', '10 third', 'https://assets.hardcover.app/1003.jpg'],
    ]);
    expect(body.cacheMaxAge).toBe(0);
  });

  it('keys the cache on a hash of the token, one listener apart from another', async () => {
    const server = hardcover();
    const { cache, entries } = recordingCache();
    const app = appWith(server.fetch, cache);
    const reader = await configure(app, READER, { mine: ['10'] });
    expect(await names(await catalog(app, reader.url, 'list-10'))).toEqual([
      '10 first',
      '10 third',
    ]);

    // Another listener's link that names the same list: Hardcover is asked with their own token,
    // and the reader's cached private list is never their answer.
    const sealer = createSealer(SECRET, 'hardcover');
    const forged = await sealer?.seal({
      token: OTHER,
      shown: { trending: [], lists: [{ id: 10, name: 'Listen next' }] },
    });
    const other = `${ORIGIN}/hardcover/${forged}/manifest.json`;
    expect(await names(await catalog(app, other, 'list-10'))).toEqual([]);

    expect(entries.size).toBeGreaterThan(0);
    for (const key of entries.keys()) {
      expect(key).not.toContain('token');
      expect(key).not.toContain('0123456789abcdef');
      expect(key).toMatch(/^https:\/\/api\.hardcover\.app\/v1\/graphql\?owner=[0-9a-f]{64}&what=/);
    }
    const owners = new Set([...entries.keys()].map((k) => /owner=(\w+)/.exec(k)?.[1]));
    expect(owners.size).toBe(2);
  });

  it('asks to set up again when the token is refused, expired or lacks a scope', async () => {
    const server = hardcover();
    const app = appWith(server.fetch);
    const { url } = await configure(app, READER, { trending: ['month'], mine: ['10'] });

    server.fail(401, { error: 'invalid_token', error_description: 'expired' });
    const expired = await catalog(app, url, 'list-10');
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({
      error: 'Hardcover did not accept the token; configure the add-on again',
    });

    server.fail(403, { error: 'insufficient_scope', scope: 'read:catalog' });
    const scope = await catalog(app, url, 'trending-month');
    expect(scope.status).toBe(401);
    expect(((await scope.json()) as { error: string }).error).toContain('lacks read:catalog');

    server.fail(429, { error: 'Too Many Requests' });
    expect((await catalog(app, url, 'trending-month')).status).toBe(503);
    server.fail(408, { error: 'Request timeout' });
    expect((await catalog(app, url, 'trending-month')).status).toBe(504);
    server.fail(403, { errors: ['request_exceeds_capacity'], message: 'too many fields' });
    expect((await catalog(app, url, 'trending-month')).status).toBe(502);
  });

  it('sets up a token without read:lists with the trending rows only', async () => {
    const app = appWith(hardcover().fetch);
    const response = await postForm(
      app,
      '/hardcover/configure',
      new URLSearchParams({ token: NO_LISTS }),
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('lacks read:lists');
    expect(html).not.toContain('name="links"');
    const { url } = await configure(app, NO_LISTS, { trending: ['all'] });
    const manifest = (await (await get(app, url)).json()) as Manifest;
    expect(manifest.catalogs.map((c) => c.id)).toEqual(['want-to-read', 'trending-all']);
  });

  it('does not take an error about an author for a refused token', async () => {
    const server = hardcover();
    const app = appWith(server.fetch);
    const { url } = await configure(app, READER, { trending: ['month'] });
    server.fail(200, {
      errors: [{ message: "field 'author' not found in type: 'contributions'" }],
    });
    expect((await catalog(app, url, 'trending-month')).status).toBe(502);
    server.fail(403, { error: 'You do not have access' });
    expect((await catalog(app, url, 'trending-month')).status).toBe(401);
    server.fail(200, {
      errors: [{ message: 'Could not verify JWT', extensions: { code: 'invalid-jwt' } }],
    });
    expect((await catalog(app, url, 'trending-month')).status).toBe(401);
  });

  it('refuses a draft that is not one of its own', async () => {
    const app = appWith(hardcover().fetch);
    for (const draft of ['v1.abcde', 'v1.not-sealed-by-this-server-at-all', 'nonsense']) {
      const response = await postForm(app, '/hardcover/configure', new URLSearchParams({ draft }));
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('Start again');
    }
  });

  it('shows the trending rows on links made before M76', async () => {
    const app = appWith(hardcover().fetch);
    const sealed = await createSealer(SECRET, 'hardcover')?.seal({ token: READER });
    const manifest = (await (
      await get(app, `${ORIGIN}/hardcover/${sealed}/manifest.json`)
    ).json()) as Manifest;
    expect(manifest.catalogs.map((c) => c.id)).toEqual([
      'want-to-read',
      'trending-month',
      'trending-all',
    ]);
    // Configured, so the app installs it rather than opening the configure page.
    expect(manifest.behaviorHints?.configurationRequired).toBe(false);
    expect(manifest.behaviorHints?.configurable).toBe(true);
  });

  it('keeps the ticks and typed links when the choices page shows an error', async () => {
    const app = appWith(hardcover().fetch);
    const { response, html } = await configure(app, READER, {
      trending: ['all'],
      followed: ['20'],
      links: ['https://hardcover.app/@someone/lists/secret'],
    });
    expect(response.status).toBe(400);
    expect(ticked(html)).toEqual(['trending=all', 'followed=20']);
    expect(html).toContain('value="https://hardcover.app/@someone/lists/secret"');
  });

  it('seals drafts apart from links, and they run out', async () => {
    let now = 0;
    const app = createApp({ fetch: hardcover().fetch, now: () => now }, { CONFIG_SECRET: SECRET });
    const first = await (
      await postForm(app, '/hardcover/configure', new URLSearchParams({ token: READER }))
    ).text();
    const draft = draftOf(first);
    // A draft from the page's source is not an add-on link.
    expect((await get(app, `${ORIGIN}/hardcover/${draft}/manifest.json`)).status).toBe(403);
    now = DRAFT_MS + 1;
    const late = await postForm(app, '/hardcover/configure', new URLSearchParams({ draft }));
    expect(late.status).toBe(400);
    expect(await late.text()).toContain('ran out');
    // A finished link is not a draft either.
    const link = await createSealer(SECRET, 'hardcover')?.seal({ token: READER });
    const wrong = await postForm(
      app,
      '/hardcover/configure',
      new URLSearchParams({ draft: link ?? '' }),
    );
    expect(wrong.status).toBe(400);
  });

  it('reads Hardcover’s Retry-After in seconds or as a date, at most a day', () => {
    expect(retryAfter('120')).toBe(120);
    expect(retryAfter('999999')).toBe(86_400);
    expect(retryAfter(new Date(61_000).toUTCString(), 1_000)).toBe(60);
    expect(retryAfter(null)).toBe(null);
    expect(retryAfter('soon')).toBe(null);
  });

  it('names a token in the cache by an HMAC keyed with the server’s secret', async () => {
    const plain = await cacheOwner(READER);
    const keyed = await cacheOwner(READER, SECRET);
    expect(keyed).toMatch(/^[0-9a-f]{64}$/);
    expect(keyed).not.toBe(plain);
    expect(await cacheOwner(READER, `${SECRET}x`)).not.toBe(keyed);
  });

  it('changes the rows from the link without asking for the token again', async () => {
    const app = appWith(hardcover().fetch);
    const { url } = await configure(app, READER, {
      followed: ['20'],
      links: ['https://hardcover.app/@someone/lists/cosy'],
    });
    const html = await (await get(app, url.replace('manifest.json', 'configure'))).text();
    expect(html).toContain('name="draft"');
    expect(html).not.toContain('reader-token');
    expect(ticked(html)).toEqual(['followed=20', 'linked=40']);
    expect(html).toContain('Added by link');
  });

  it('gives a book’s ISBN and ASIN from its audiobook edition', async () => {
    const app = appWith(hardcover().fetch);
    const { url } = await configure(app, READER, {});
    const response = await get(
      app,
      url.replace('manifest.json', 'meta/audiobook/hardcover:42.json'),
    );
    const { meta } = (await response.json()) as { meta: { externalIds?: Record<string, string> } };
    expect(meta.externalIds).toEqual({ isbn: '0307577143', asin: 'B002RI9ZQ4' });
    expect(editionIds([{ isbn_13: '9780141036144', reading_format_id: 1 }])).toEqual({
      isbn: '9780141036144',
    });
  });

  it('lists the audiobook editions of a work, with their narrators', async () => {
    const app = appWith(hardcover().fetch);
    const { url } = await configure(app, READER, {});
    const response = await get(
      app,
      url.replace('manifest.json', 'meta/audiobook/hardcover:42.json'),
    );
    const { meta } = (await response.json()) as { meta: { editions?: unknown[] } };
    expect(meta.editions).toEqual([
      {
        key: '501',
        name: 'Blackstone Audio, 2010',
        year: 2010,
        narrators: ['Robert Bethune'],
        publisher: 'Blackstone Audio',
        cover: 'https://assets.hardcover.app/501.jpg',
        durationMs: 30_000_000,
        externalIds: { asin: 'B002RI9ZQ4' },
      },
      { key: '502', name: 'Audible Audio' },
    ]);
  });

  it('reads list links', () => {
    expect(listLink('https://hardcover.app/@reader/lists/sci-fi')).toEqual({
      user: 'reader',
      slug: 'sci-fi',
    });
    expect(listLink('https://www.hardcover.app/@reader/lists/sci-fi/')).toEqual({
      user: 'reader',
      slug: 'sci-fi',
    });
    expect(listLink('https://hardcover.app/books/walden')).toBe(null);
    expect(listLink('https://hardcover.app.evil.example/@a/lists/b')).toBe(null);
    expect(listLink('not a link')).toBe(null);
  });
});
