import type { ScrobbleEvent } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { mountConfigurable } from '../src/scrobble/mount';
import {
  openLibraryLogAddon,
  REQUEST_GAP_MS,
  SHELF,
  sessionCookie,
  shelvesFor,
  workOf,
} from '../src/scrobble/openlibrary';
import { createSealer } from '../src/scrobble/sealed';
import type { FetchLike } from '../src/upstream';

const SECRET = 'test-secret-that-is-long-enough-1234567890';
const KEYS = { access: 'AbCdEf0123456789', secret: 'ZyXwVu9876543210' };
const SESSION = '%2Fpeople%2Freader%2C2026-11-18T09%3A00%3A00%2C1a2b3%24c4d5e6f7';

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
  redirect?: string | undefined;
};

/**
 * Open Library as its source answers: `POST /account/login` with S3 keys in JSON sets the
 * `session` cookie (and others) or answers 400 with an error; `POST /works/…/bookshelves.json`
 * answers `{ bookshelves_affected }`, or 200 with an `error` key, or 401 without the cookie.
 */
function openLibrary(options: { keys?: typeof KEYS; shelf?: (call: Call) => Response } = {}) {
  const keys = options.keys ?? KEYS;
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = {
      url,
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body,
      redirect: init.redirect,
    };
    calls.push(call);
    const { pathname } = new URL(url);
    if (pathname === '/account/login' && call.method === 'POST') {
      const sent = JSON.parse(call.body ?? '{}') as { access?: string; secret?: string };
      if (sent.access !== keys.access || sent.secret !== keys.secret)
        return new Response(
          JSON.stringify({
            error: 'invalid_s3keys',
            errorDisplayString: 'Login attempted with invalid Internet Archive s3 credentials.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      const headers = new Headers({ 'Content-Type': 'application/json' });
      headers.append('Set-Cookie', `session=${SESSION}; Path=/; SameSite=Lax`);
      headers.append('Set-Cookie', 'pd=; expires=Thu, 01 Jan 1970 00:00:01 GMT; Path=/');
      headers.append('Set-Cookie', 's3=encrypted; Path=/; Secure; HttpOnly; SameSite=Lax');
      return new Response('null', { status: 200, headers });
    }
    if (/^\/works\/OL\d+W\/bookshelves\.json$/.test(pathname) && call.method === 'POST') {
      if (options.shelf) return options.shelf(call);
      if (call.headers.Cookie !== `session=${SESSION}`)
        return Response.json({ detail: 'Authentication required' }, { status: 401 });
      return Response.json({ bookshelves_affected: 1 });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

const appWith = (fetch: FetchLike) =>
  createApp(
    { fetch, userFetch: fetch, now: () => 0 },
    {
      CONFIG_SECRET: SECRET,
      SOURCE_URL: 'https://github.com/lelap-app/lelap',
    },
  );

/** The add-on alone, without the pause between requests. */
const quickMount = (fetch: FetchLike) =>
  mountConfigurable(
    openLibraryLogAddon(fetch, 'Lelap/1 (+https://example.test/source)', {
      wait: async () => undefined,
    }),
    createSealer(SECRET, 'openlibrary-log'),
  );

async function configure(serve: (request: Request) => Response | Promise<Response>, form = KEYS) {
  const response = await serve(
    new Request('https://addons.example/open-library/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    }),
  );
  const html = await response.text();
  const url = /<code>([^<]+manifest\.json)<\/code>/.exec(html)?.[1] ?? '';
  return { response, html, url };
}

const event = (over: Partial<ScrobbleEvent> & Pick<ScrobbleEvent, 'event'>): ScrobbleEvent => ({
  eventId: `evt-${Math.random().toString(36).slice(2, 12)}`,
  at: Date.UTC(2026, 10, 17, 9),
  item: { type: 'audiobook', id: 'ol:OL69612W', name: 'Walden', author: 'Henry David Thoreau' },
  positionMs: 600_000,
  sessionStartMs: 0,
  ...over,
});

const post = (
  serve: (request: Request) => Response | Promise<Response>,
  manifestUrl: string,
  events: ScrobbleEvent[],
) =>
  serve(
    new Request(manifestUrl.replace(/manifest\.json$/, 'scrobble'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    }),
  );

const shelfCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/bookshelves.json'));

describe('Open Library reading log', () => {
  it('is listed at the root and serves its form under /open-library', async () => {
    const app = appWith(openLibrary().fetch);
    const root = (await (await app.request('https://addons.test/')).json()) as {
      configure: string[];
    };
    expect(root.configure).toContain('https://addons.test/open-library/configure');
    const form = await app.request('https://addons.test/open-library/configure');
    const html = await form.text();
    expect(form.headers.get('Cache-Control')).toBe('no-store');
    expect(html).toContain('name="access"');
    expect(html).toContain('name="secret" id="secret" required type="password"');
    expect(html).toContain('archive.org/account/s3.php');
    const manifest = await app.request('https://addons.test/open-library/manifest.json');
    expect(((await manifest.json()) as { id: string }).id).toBe('app.lelap.openlibrary-log');
  });

  it('signs in with the S3 keys while configuring, and never puts them in the link', async () => {
    const { fetch, calls } = openLibrary();
    const { response, url } = await configure((r) => appWith(fetch).fetch(r));
    expect(response.status).toBe(200);
    expect(url).toMatch(/^https:\/\/addons\.example\/open-library\/v1\.[\w-]+\/manifest\.json$/);
    expect(url).not.toContain(KEYS.access);
    expect(url).not.toContain(KEYS.secret);
    expect(calls).toHaveLength(1);
    const [login] = calls;
    expect(login?.url).toBe('https://openlibrary.org/account/login');
    expect(login?.headers['Content-Type']).toBe('application/json');
    expect(login?.headers['User-Agent']).toBe('Lelap/1 (+https://github.com/lelap-app/lelap)');
    expect(login?.redirect).toBe('manual');
    expect(JSON.parse(login?.body ?? '')).toEqual(KEYS);
  });

  it('says so when Open Library refuses the keys, and checks their shape first', async () => {
    const { fetch, calls } = openLibrary();
    const serve = (r: Request) => appWith(fetch).fetch(r);
    const wrong = await configure(serve, { access: 'AbCdEf0123456789', secret: 'Wrong000000000' });
    expect(wrong.response.status).toBe(400);
    expect(wrong.html).toContain('Open Library did not accept these S3 keys');
    expect(wrong.url).toBe('');
    // An email and password are not keys: refused before anything is sent.
    const before = calls.length;
    const password = await configure(serve, { access: 'reader@example.com', secret: 'hunter2' });
    expect(password.html).toContain('do not look like archive.org S3 keys');
    expect(calls).toHaveLength(before);
  });

  it('puts a started book on Currently reading and a finished one on Already read', async () => {
    const { fetch, calls } = openLibrary();
    const serve = quickMount(fetch);
    const { url } = await configure(serve);
    calls.length = 0;

    const started = await post(serve, url, [event({ event: 'start' })]);
    expect(started.status).toBe(200);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/account/login',
      '/works/OL69612W/bookshelves.json',
    ]);
    const shelf = calls[1];
    expect(shelf?.headers.Cookie).toBe(`session=${SESSION}`);
    expect(shelf?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    // Only the shelf: no times, no progress, no edition.
    expect(Object.fromEntries(new URLSearchParams(shelf?.body))).toEqual({
      bookshelf_id: String(SHELF.currentlyReading),
      dont_remove: 'true',
    });

    calls.length = 0;
    await post(serve, url, [event({ event: 'finish', positionMs: 3_600_000 })]);
    expect(new URLSearchParams(shelfCalls(calls)[0]?.body).get('bookshelf_id')).toBe(
      String(SHELF.alreadyRead),
    );
  });

  it('sends only the work and the shelf, nothing about the listening', async () => {
    const { fetch, calls } = openLibrary();
    const serve = quickMount(fetch);
    const { url } = await configure(serve);
    calls.length = 0;
    await post(serve, url, [event({ event: 'start', at: 1_763_370_000_000 })]);
    const sent = JSON.stringify(calls);
    for (const leak of ['Walden', 'Thoreau', '1763370000', '600', 'evt-', 'positionMs'])
      expect(sent).not.toContain(leak);
  });

  it('does not sign in for progress, pauses, abandons or ratings', async () => {
    const { fetch, calls } = openLibrary();
    const serve = quickMount(fetch);
    const { url } = await configure(serve);
    calls.length = 0;
    const response = await post(serve, url, [
      event({ event: 'progress' }),
      event({ event: 'pause' }),
      event({ event: 'abandon' }),
      event({ event: 'rate', rating: 4 }),
    ]);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it('skips books without an Open Library work and never searches for one', async () => {
    const { fetch, calls } = openLibrary();
    const serve = quickMount(fetch);
    const { url } = await configure(serve);
    calls.length = 0;
    await post(serve, url, [
      event({ event: 'start', item: { type: 'audiobook', name: 'My own recording' } }),
      event({
        event: 'start',
        item: { type: 'audiobook', id: 'librivox:59', name: 'Walden', externalIds: { isbn: '1' } },
      }),
      event({ event: 'start', item: { type: 'episode', id: 'ol:OL1W', name: 'An episode' } }),
    ]);
    expect(calls).toHaveLength(0);
  });

  it('uses the ol external ID of books from other add-ons, and only a work ID', () => {
    expect(
      workOf({
        type: 'audiobook',
        id: 'librivox:59',
        name: 'Walden',
        externalIds: { ol: 'OL69612W' },
      }),
    ).toBe('OL69612W');
    expect(workOf({ type: 'audiobook', id: 'ol:OL69612W', name: 'Walden' })).toBe('OL69612W');
    for (const ol of ['OL7353617M', '/works/OL1W', 'OL1W/../../account', 'ol:OL1W', ''])
      expect(workOf({ type: 'audiobook', name: 'x', externalIds: { ol } })).toBe(null);
    expect(workOf({ type: 'audiobook', id: 'ol:OL1M', name: 'x' })).toBe(null);
  });

  it('keeps the last start or finish per work', () => {
    const at = (minutes: number) => Date.UTC(2026, 10, 17, 9, minutes);
    const shelves = shelvesFor([
      event({ event: 'finish', at: at(30) }),
      event({ event: 'start', at: at(0) }),
      event({ event: 'pause', at: at(31) }),
      event({ event: 'start', at: at(5), item: { type: 'audiobook', id: 'ol:OL2W', name: 'B' } }),
    ]);
    expect([...shelves]).toEqual([
      ['OL69612W', SHELF.alreadyRead],
      ['OL2W', SHELF.currentlyReading],
    ]);
  });

  it('signs in once per batch and spaces the shelf requests', async () => {
    const { fetch, calls } = openLibrary();
    const waits: number[] = [];
    const serve = mountConfigurable(
      openLibraryLogAddon(fetch, 'Lelap/1', {
        wait: async (ms) => {
          waits.push(ms);
        },
      }),
      createSealer(SECRET, 'openlibrary-log'),
    );
    const { url } = await configure(serve);
    calls.length = 0;
    await post(
      serve,
      url,
      [1, 2, 3].map((n) =>
        event({ event: 'start', item: { type: 'audiobook', id: `ol:OL${n}W`, name: `Book ${n}` } }),
      ),
    );
    expect(calls.filter((c) => c.url.endsWith('/account/login'))).toHaveLength(1);
    expect(shelfCalls(calls)).toHaveLength(3);
    expect(waits).toEqual([REQUEST_GAP_MS, REQUEST_GAP_MS]);
  });

  it('answers 401 when the keys stop working, so the app shows the add-on needs setting up', async () => {
    const { fetch } = openLibrary();
    const serve = quickMount(fetch);
    const { url } = await configure(serve);
    // The listener made new keys on archive.org: the old ones are refused.
    const revoked = quickMount(
      openLibrary({ keys: { ...KEYS, secret: 'NewSecret0000000' } }).fetch,
    );
    const response = await post(revoked, url, [event({ event: 'start' })]);
    expect(response.status).toBe(401);
  });

  it('retries later when Open Library is busy or refuses a write', async () => {
    const busy = openLibrary({ shelf: () => new Response('slow down', { status: 429 }) });
    const serve = quickMount(busy.fetch);
    const { url } = await configure(serve);
    expect((await post(serve, url, [event({ event: 'start' })])).status).toBe(503);

    const refused = quickMount(
      openLibrary({ shelf: () => Response.json({ error: 'Invalid bookshelf' }) }).fetch,
    );
    expect((await post(refused, url, [event({ event: 'start' })])).status).toBe(502);
  });

  it('reads the session cookie from one or several Set-Cookie headers', () => {
    const several = new Headers();
    several.append('Set-Cookie', 'pd=; Path=/');
    several.append('Set-Cookie', `session=${SESSION}; Path=/`);
    expect(sessionCookie(new Response(null, { headers: several }))).toBe(SESSION);
    const logout = new Headers({ 'Set-Cookie': 'session=""; expires=Thu, 01 Jan 1970' });
    expect(sessionCookie(new Response(null, { headers: logout }))).toBe(null);
    expect(sessionCookie(new Response(null))).toBe(null);
  });

  it('signs in at another Open Library when OPEN_LIBRARY_URL names one', async () => {
    const { fetch, calls } = openLibrary();
    const app = createApp(
      { fetch, now: () => 0 },
      { CONFIG_SECRET: SECRET, OPEN_LIBRARY_URL: 'http://localhost:8080/' },
    );
    await configure((r) => app.fetch(r));
    expect(calls[0]?.url).toBe('http://localhost:8080/account/login');
  });

  it('does not open a link sealed for another add-on', async () => {
    const hardcover = createSealer(SECRET, 'hardcover');
    const sealed = await hardcover?.seal(KEYS);
    const serve = quickMount(openLibrary().fetch);
    const response = await serve(
      new Request(`https://addons.example/open-library/${sealed}/manifest.json`),
    );
    expect(response.status).toBe(401);
  });
});
