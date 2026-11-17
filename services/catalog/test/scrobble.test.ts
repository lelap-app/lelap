import { readFileSync } from 'node:fs';

import type { ScrobbleEvent } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { enclosuresByGuid, playActions, serverUrl } from '../src/scrobble/gpodder';
import { firstSearchHit, latestPerItem } from '../src/scrobble/hardcover';
import { createSealer } from '../src/scrobble/sealed';
import type { FetchLike } from '../src/upstream';

const SECRET = 'test-secret-that-is-long-enough-1234567890';
const FEED = readFileSync(`${import.meta.dirname}/fixtures/feed-example.xml`, 'utf8');

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
};

/** Answers from a handler; records every request so tests can check what left the server. */
function fake(answer: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, method: init.method ?? 'GET', headers: init.headers, body: init.body };
    calls.push(call);
    return answer(call) ?? new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const appWith = (fetch: FetchLike, secret: string | undefined = SECRET) =>
  createApp({ fetch, userFetch: fetch, now: () => 0 }, { CONFIG_SECRET: secret });

async function configure(
  app: ReturnType<typeof createApp>,
  path: string,
  form: Record<string, string>,
) {
  const response = await app.fetch(
    new Request(`https://addons.example${path}/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    }),
  );
  const html = await response.text();
  // Empty when the page shows an error instead of a link.
  const url = /<code>([^<]+manifest\.json)<\/code>/.exec(html)?.[1] ?? '';
  return { response, html, url };
}

const event = (over: Partial<ScrobbleEvent> & Pick<ScrobbleEvent, 'event'>): ScrobbleEvent => ({
  eventId: `evt-${Math.random().toString(36).slice(2, 12)}`,
  at: Date.UTC(2026, 10, 17, 9),
  item: { type: 'audiobook', name: 'Walden', author: 'Henry David Thoreau', durationMs: 3_600_000 },
  positionMs: 600_000,
  ...over,
});

const post = (app: ReturnType<typeof createApp>, manifestUrl: string, events: ScrobbleEvent[]) =>
  app.fetch(
    new Request(manifestUrl.replace(/manifest\.json$/, 'scrobble'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    }),
  );

function sealerFor(secret: string, addon: string) {
  const sealer = createSealer(secret, addon);
  if (!sealer) throw new Error('no sealer');
  return sealer;
}

describe('sealed settings', () => {
  it('round-trips, and refuses tampering, other keys and other add-ons', async () => {
    const sealer = sealerFor(SECRET, 'hardcover');
    const sealed = await sealer.seal({ token: 'abc' });
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain('abc');
    expect(await sealer.open(sealed)).toEqual({ token: 'abc' });
    // A character in the middle: the last one can carry bits base64url decoders ignore, so
    // changing it sometimes leaves the bytes as they were.
    const at = Math.floor(sealed.length / 2);
    const flipped = sealed.slice(0, at) + (sealed[at] === 'A' ? 'B' : 'A') + sealed.slice(at + 1);
    expect(await sealer.open(flipped)).toBe(null);
    expect(await sealerFor(`${SECRET}x`, 'hardcover').open(sealed)).toBe(null);
    expect(await sealerFor(SECRET, 'gpodder').open(sealed)).toBe(null);
  });

  it('needs a long secret', () => {
    expect(createSealer(undefined, 'x')).toBe(null);
    expect(createSealer('short', 'x')).toBe(null);
  });
});

describe('configure pages', () => {
  it('serves a form with its own CSP and no caching', async () => {
    const app = appWith(fake(() => undefined).fetch);
    const response = await app.fetch(new Request('https://addons.example/hardcover/configure'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("form-action 'self'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('<form method="post"');
  });

  it('says so without a CONFIG_SECRET', async () => {
    const app = appWith(fake(() => undefined).fetch, '');
    const response = await app.fetch(new Request('https://addons.example/gpodder/configure'));
    expect(response.status).toBe(503);
  });

  it('answers 401 before it is configured', async () => {
    const app = appWith(fake(() => undefined).fetch);
    const manifest = await app.fetch(new Request('https://addons.example/hardcover/manifest.json'));
    expect(((await manifest.json()) as { configurable: boolean }).configurable).toBe(true);
    const response = await post(app, 'https://addons.example/hardcover/manifest.json', [
      event({ event: 'start' }),
    ]);
    expect(response.status).toBe(401);
    const garbage = await app.fetch(
      new Request('https://addons.example/hardcover/v1.nope/manifest.json'),
    );
    expect(garbage.status).toBe(401);
  });
});

describe('Hardcover', () => {
  const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiJ9.test-token';

  /** A small in-memory Hardcover: one user, one book found by ISBN. */
  function hardcover() {
    const state = {
      userBook: null as null | { id: number; status_id: number },
      read: null as null | Record<string, unknown>,
      updates: [] as Record<string, unknown>[],
    };
    const server = fake((call) => {
      if (call.url !== 'https://api.hardcover.app/v1/graphql') return undefined;
      if (call.headers.authorization !== TOKEN)
        return json({ errors: [{ message: 'invalid jwt' }] });
      const { query, variables } = JSON.parse(call.body ?? '{}') as {
        query: string;
        variables: Record<string, unknown>;
      };
      if (query.includes('query Me'))
        return json({ data: { me: [{ id: 7, username: 'reader' }] } });
      if (query.includes('query WantToRead'))
        return json({
          data: {
            user_books: [
              {
                book: {
                  id: 42,
                  title: 'Walden',
                  release_year: 1854,
                  image: { url: 'https://assets.hardcover.app/walden.jpg' },
                  contributions: [{ author: { name: 'Henry David Thoreau' } }],
                },
              },
              { book: null },
            ],
          },
        });
      if (query.includes('query Edition'))
        return json({
          data: { editions: variables.isbn === '9780141036144' ? [{ book_id: 42 }] : [] },
        });
      if (query.includes('query Search'))
        return json({
          data: { search: { results: JSON.stringify({ hits: [{ document: { id: '42' } }] }) } },
        });
      if (query.includes('query UserBook'))
        return json({
          data: {
            user_books: state.userBook
              ? [
                  {
                    ...state.userBook,
                    user_book_reads: state.read
                      ? [{ id: 900, finished_at: state.read.finished_at ?? null }]
                      : [],
                  },
                ]
              : [],
          },
        });
      if (query.includes('insert_user_book(')) {
        state.userBook = { id: 500, status_id: variables.status as number };
        return json({ data: { insert_user_book: { id: 500, error: null } } });
      }
      if (query.includes('update_user_book(')) {
        const object = variables.object as Record<string, unknown>;
        state.updates.push(object);
        if (state.userBook && typeof object.status_id === 'number')
          state.userBook.status_id = object.status_id;
        return json({ data: { update_user_book: { id: 500, error: null } } });
      }
      if (query.includes('insert_user_book_read')) {
        state.read = { ...(variables.read as Record<string, unknown>) };
        return json({ data: { insert_user_book_read: { id: 900, error: null } } });
      }
      if (query.includes('update_user_book_read')) {
        state.read = { ...state.read, ...(variables.object as Record<string, unknown>) };
        return json({ data: { update_user_book_read: { id: 900, error: null } } });
      }
      return json({ errors: [{ message: `unexpected ${query}` }] });
    });
    return { ...server, state };
  }

  it('checks the token while configuring and never puts it in the link', async () => {
    const { fetch } = hardcover();
    const app = appWith(fetch);
    const bad = await configure(app, '/hardcover', { token: 'Bearer wrong-token-0123456789' });
    expect(bad.response.status).toBe(400);
    expect(bad.html).toContain('did not accept the token');

    const good = await configure(app, '/hardcover', { token: TOKEN });
    expect(good.response.status).toBe(200);
    expect(good.url).toMatch(/^https:\/\/addons\.example\/hardcover\/v1\.[\w-]+\/manifest\.json$/);
    expect(good.html).not.toContain('test-token');
  });

  it('lists the Want to read shelf as a catalog', async () => {
    const { fetch } = hardcover();
    const app = appWith(fetch);
    const { url } = await configure(app, '/hardcover', { token: TOKEN });
    const manifest = (await (await app.fetch(new Request(url))).json()) as {
      catalogs: { shelf?: string }[];
    };
    expect(manifest.catalogs[0]?.shelf).toBe('want-to-read');
    const response = await app.fetch(
      new Request(url.replace('manifest.json', 'catalog/audiobook/want-to-read.json')),
    );
    expect(await response.json()).toEqual({
      metas: [
        {
          id: 'hardcover:42',
          type: 'audiobook',
          name: 'Walden',
          author: 'Henry David Thoreau',
          cover: 'https://assets.hardcover.app/walden.jpg',
          year: 1854,
        },
      ],
      cacheMaxAge: 0,
    });
  });

  it('moves a book to reading with its progress, then to read', async () => {
    const { fetch, state } = hardcover();
    const app = appWith(fetch);
    const { url } = await configure(app, '/hardcover', { token: TOKEN });
    const item = {
      type: 'audiobook' as const,
      name: 'Walden',
      externalIds: { isbn: '9780141036144' },
    };

    expect((await post(app, url, [event({ event: 'progress', item })])).status).toBe(200);
    expect(state.userBook).toEqual({ id: 500, status_id: 2 });
    expect(state.read).toEqual({ progress_seconds: 600, started_at: '2026-11-17' });

    // Sent twice after a lost answer: no second read is started.
    await post(app, url, [event({ event: 'progress', item, positionMs: 900_000 })]);
    await post(app, url, [event({ event: 'progress', item, positionMs: 900_000 })]);
    expect(state.read).toEqual({ progress_seconds: 900, started_at: '2026-11-17' });

    await post(app, url, [
      event({ event: 'finish', item, positionMs: 3_600_000, at: Date.UTC(2026, 10, 18) }),
      event({ event: 'pause', item, positionMs: 3_600_000, at: Date.UTC(2026, 10, 18, 0, 1) }),
    ]);
    expect(state.userBook?.status_id).toBe(3);
    expect(state.read).toMatchObject({ finished_at: '2026-11-18', progress_seconds: 3600 });
  });

  it('finds a book by title when it has no ISBN, and rates it', async () => {
    const { fetch, state } = hardcover();
    const app = appWith(fetch);
    const { url } = await configure(app, '/hardcover', { token: TOKEN });
    await post(app, url, [event({ event: 'rate', rating: 4.5 })]);
    expect(state.updates).toContainEqual({ rating: 4.5 });
  });

  it('ignores episodes', async () => {
    const { fetch, calls } = hardcover();
    const app = appWith(fetch);
    const { url } = await configure(app, '/hardcover', { token: TOKEN });
    const before = calls.length;
    await post(app, url, [event({ event: 'pause', item: { type: 'episode', name: 'Ep' } })]);
    // Only the `me` lookup.
    expect(calls.length - before).toBe(1);
  });

  it('keeps the last state per book', () => {
    const item = { type: 'audiobook' as const, name: 'A' };
    const kept = latestPerItem([
      event({ event: 'pause', item, at: 3 }),
      event({ event: 'start', item, at: 1 }),
      event({ event: 'rate', item, at: 2, rating: 3 }),
    ]);
    expect(kept.map((e) => e.event).sort()).toEqual(['pause', 'rate']);
  });

  it('reads Typesense hits as text or JSON', () => {
    expect(firstSearchHit({ hits: [{ document: { id: 3 } }] })).toBe(3);
    expect(firstSearchHit('{"hits":[]}')).toBe(null);
  });
});

describe('gPodder', () => {
  const episode = {
    type: 'episode' as const,
    name: 'Episode 2',
    durationMs: 1_800_000,
    podcast: { feed: 'https://feeds.example.org/show.xml', title: 'Example Show' },
    episodeGuid: 'ep-2',
  };

  function server(flavor: 'gpodder' | 'nextcloud') {
    const uploads: Call[] = [];
    const { fetch, calls } = fake((call) => {
      if (call.url === 'https://feeds.example.org/old.xml')
        return new Response(null, { status: 301, headers: { location: '/show.xml' } });
      if (call.url === 'https://feeds.example.org/show.xml') return new Response(FEED);
      const expected =
        flavor === 'nextcloud'
          ? 'https://cloud.example.org/index.php/apps/gpoddersync/episode_action/create'
          : 'https://gpodder.example.org/api/2/episodes/me%40home.json';
      if (call.url !== expected) return undefined;
      if (call.headers.Authorization !== `Basic ${btoa('me@home:s3cret')}`)
        return new Response('no', { status: 401 });
      uploads.push(call);
      return json({ timestamp: 1, update_urls: [] });
    });
    return { fetch, calls, uploads };
  }

  it('reads enclosures by guid, decoding entities and CDATA', () => {
    const found = enclosuresByGuid(FEED);
    expect(found.get('ep-2')).toBe('https://media.example.org/ep2.mp3?a=1&b=2');
    expect(found.get('https://media.example.org/ep1.mp3')).toBe(
      'https://media.example.org/ep1.mp3',
    );
  });

  it('turns pauses into play actions with started, position and total in seconds', async () => {
    const { fetch } = server('gpodder');
    const actions = await playActions(
      fetch,
      [
        event({ event: 'start', item: episode, positionMs: 0 }),
        event({ event: 'pause', item: episode, positionMs: 125_400, sessionStartMs: 15_000 }),
        event({ event: 'pause', item: { ...episode, episodeGuid: 'unknown' } }),
      ],
      'Lelap/1',
    );
    expect(actions).toEqual([
      {
        podcast: 'https://feeds.example.org/show.xml',
        episode: 'https://media.example.org/ep2.mp3?a=1&b=2',
        guid: 'ep-2',
        action: 'play',
        timestamp: '2026-11-17T09:00:00',
        started: 15,
        position: 125,
        total: 1800,
      },
    ]);
  });

  it('follows a moved feed', async () => {
    const { fetch } = server('gpodder');
    const moved = { ...episode, podcast: { feed: 'https://feeds.example.org/old.xml' } };
    const actions = await playActions(fetch, [event({ event: 'finish', item: moved })], 'Lelap/1');
    expect(actions[0]?.episode).toBe('https://media.example.org/ep2.mp3?a=1&b=2');
  });

  for (const flavor of ['gpodder', 'nextcloud'] as const) {
    it(`uploads to a ${flavor} server with the sealed login`, async () => {
      const { fetch, uploads } = server(flavor);
      const app = appWith(fetch);
      const { url, html } = await configure(app, '/gpodder', {
        flavor,
        server:
          flavor === 'nextcloud' ? 'https://cloud.example.org/' : 'https://gpodder.example.org',
        username: 'me@home',
        password: 's3cret',
      });
      expect(html).not.toContain('s3cret');
      expect(url).not.toBe('');
      // The empty check upload while configuring.
      expect(uploads).toHaveLength(1);
      const response = await post(app, url, [
        event({ event: 'progress', item: episode, positionMs: 60_000, sessionStartMs: 0 }),
      ]);
      expect(response.status).toBe(200);
      expect(JSON.parse(uploads[1]?.body ?? '[]')).toHaveLength(1);
    });
  }

  it('refuses a wrong login while configuring', async () => {
    const { fetch } = server('gpodder');
    const app = appWith(fetch);
    const { response, html } = await configure(app, '/gpodder', {
      flavor: 'gpodder',
      server: 'https://gpodder.example.org',
      username: 'me@home',
      password: 'wrong',
    });
    expect(response.status).toBe(400);
    expect(html).toContain('did not accept the login');
  });

  it('takes only https server addresses', () => {
    expect(serverUrl('https://gpodder.net/')).toBe('https://gpodder.net');
    expect(() => serverUrl('http://gpodder.net')).toThrow('https');
    expect(() => serverUrl('https://me:pw@gpodder.net')).toThrow();
    expect(() => serverUrl('not a url')).toThrow();
  });
});
