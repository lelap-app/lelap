import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import {
  Manifest,
  offersLibrary,
  readSettings,
  type ScrobbleEvent,
  scrobblePath,
  scrobblesWithSettings,
} from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { hostAllowed } from '../local';
import { bundledAddon } from './index';

const URL_ = 'lelap-local://app.lelap.openlibrary-log/manifest.json';
const KEYS = { access: 'AbCdEf0123456789', secret: 'ZyXwVu9876543210' };
const CLIENT = 'Lelap/1 (+https://example.test/source)';
const SESSION = '%2Fpeople%2Freader%2C2026-11-18T09%3A00%3A00%2C1a2b3%24c4d5e6f7';

type Init = { method?: string; headers?: Record<string, string>; body?: string };
type Call = { url: string; method: string; headers: Record<string, string>; body: string };
type Reply = { status: number; body?: string; setCookie?: string };
type Handlers = { manifest: unknown; scrobble: (args: unknown) => Promise<unknown> };

/**
 * Open Library as its source answers (`account_login_json`, `process_work_bookshelves`): the
 * JSON login with S3 keys sets `session` (and others; on Android the app hands the add-on the
 * `set-cookie` header joined with commas) or answers 400 with an error code; the bookshelves
 * endpoint answers `{ bookshelves_affected }`, or 200 with an `error` key, or 401 without the cookie.
 */
function openLibrary(options: { keys?: typeof KEYS; shelf?: (call: Call) => Reply } = {}) {
  const keys = options.keys ?? KEYS;
  return (call: Call): Reply => {
    const { pathname } = new URL(call.url);
    if (pathname === '/account/login' && call.method === 'POST') {
      const sent = JSON.parse(call.body || '{}') as { access?: string; secret?: string };
      if (sent.access !== keys.access || sent.secret !== keys.secret)
        return { status: 400, body: JSON.stringify({ error: 'invalid_s3keys' }) };
      return {
        status: 200,
        body: 'null',
        setCookie: `session=${SESSION}; Path=/; SameSite=Lax, pd=; expires=Thu, 01 Jan 1970 00:00:01 GMT; Path=/, s3=encrypted; Path=/; Secure; HttpOnly`,
      };
    }
    if (/^\/works\/OL\d+W\/bookshelves\.json$/.test(pathname) && call.method === 'POST') {
      if (options.shelf) return options.shelf(call);
      if (call.headers.Cookie !== `session=${SESSION}`)
        return { status: 401, body: '{"detail":"Authentication required"}' };
      return { status: 200, body: '{"bookshelves_affected":1}' };
    }
    return { status: 404, body: 'not found' };
  };
}

/**
 * Runs the add-on file the way the sandbox does: `addon({...})` hands over its handlers, and
 * `lelap.fetch` is the only way out, to the hosts the app would allow. Pauses resolve at once and
 * are recorded.
 */
function load(server: (call: Call) => Reply, hosts = ['openlibrary.org']) {
  let handlers: Handlers | null = null;
  const calls: Call[] = [];
  const waits: number[] = [];
  runInNewContext(readFileSync(new URL('./openlibrary-log.js', import.meta.url), 'utf8'), {
    addon: (definition: Handlers) => {
      handlers = definition;
    },
    lelap: {
      fetch: async (url: string, init?: Init) => {
        if (!hostAllowed(url, hosts)) throw new Error(`Not allowed: ${url}`);
        const call = {
          url,
          method: init?.method ?? 'GET',
          headers: init?.headers ?? {},
          body: init?.body ?? '',
        };
        calls.push(call);
        const reply = server(call);
        return {
          ok: reply.status >= 200 && reply.status < 300,
          status: reply.status,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'set-cookie' ? (reply.setCookie ?? null) : null,
          },
          text: async () => reply.body ?? '',
        };
      },
    },
    setTimeout: (go: () => void, ms: number) => {
      waits.push(ms);
      go();
    },
    URL,
    JSON,
    Map,
    Promise,
    Error,
  });
  if (!handlers) throw new Error('openlibrary-log.js never called addon()');
  const { scrobble } = handlers as Handlers;
  const run = (events: ScrobbleEvent[], settings: Record<string, string> = {}) =>
    scrobble({
      resource: 'scrobble',
      type: 'audiobook',
      id: 'all',
      settings: { ...KEYS, client: CLIENT, ...settings },
      events,
    });
  return { run, calls, waits };
}

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error: { status?: number }) => error.status ?? 500,
  );

const event = (over: Partial<ScrobbleEvent> & Pick<ScrobbleEvent, 'event'>): ScrobbleEvent => ({
  eventId: `evt-${Math.random().toString(36).slice(2, 12)}`,
  at: Date.UTC(2026, 10, 17, 9),
  item: { type: 'audiobook', id: 'ol:OL69612W', name: 'Walden', author: 'Henry David Thoreau' },
  positionMs: 600_000,
  sessionStartMs: 0,
  ...over,
});

const book = (n: number) => ({ type: 'audiobook' as const, id: `ol:OL${n}W`, name: `Book ${n}` });
const shelves = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/bookshelves.json'));
const shelfOf = (call: Call | undefined) => new URLSearchParams(call?.body).get('bookshelf_id');

describe('Open Library reading log', () => {
  it('comes with the app as a scrobbler with settings that reaches only openlibrary.org', () => {
    const bundled = bundledAddon(URL_);
    if (!bundled) throw new Error('not bundled');
    const manifest = Manifest.parse(bundled.manifest);
    expect(scrobblesWithSettings(manifest)).toBe(true);
    expect(offersLibrary(manifest)).toBe(false);
    expect(manifest.sandbox?.hosts).toEqual(['openlibrary.org']);
    expect(manifest.settings?.map((f) => [f.key, f.type, f.required])).toEqual([
      ['access', 'text', true],
      ['secret', 'password', true],
    ]);
    expect(manifest.settings?.some((f) => f.host)).toBe(false);
    expect(readSettings(manifest.settings ?? [], { access: '', secret: 'x' })).toHaveProperty(
      'error',
    );
    expect(scrobblePath()).toBe('scrobble/audiobook/all.json');
  });

  it('signs in with the S3 keys as JSON when it is set up, and sends nothing else', async () => {
    const { run, calls } = load(openLibrary());
    expect(await run([])).toEqual({ received: 0 });
    expect(calls).toHaveLength(1);
    const [login] = calls;
    expect(login?.url).toBe('https://openlibrary.org/account/login');
    expect(login?.headers['Content-Type']).toBe('application/json');
    expect(login?.headers['User-Agent']).toBe(CLIENT);
    expect(JSON.parse(login?.body ?? '')).toEqual(KEYS);
  });

  it('puts a started book on Currently reading and a finished one on Already read', async () => {
    const { run, calls } = load(openLibrary());
    await run([event({ event: 'start' })]);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/account/login',
      '/works/OL69612W/bookshelves.json',
    ]);
    const shelf = calls[1];
    expect(shelf?.headers.Cookie).toBe(`session=${SESSION}`);
    expect(shelf?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    // Only the shelf: no times, no progress, no edition.
    expect(Object.fromEntries(new URLSearchParams(shelf?.body))).toEqual({
      bookshelf_id: '2',
      dont_remove: 'true',
    });
    calls.length = 0;
    await run([event({ event: 'finish', positionMs: 3_600_000 })]);
    expect(shelfOf(shelves(calls)[0])).toBe('3');
  });

  it('sends only the work and the shelf, nothing about the listening', async () => {
    const { run, calls } = load(openLibrary());
    await run([event({ event: 'start', at: 1_763_370_000_000 })]);
    const sent = JSON.stringify(calls);
    for (const leak of ['Walden', 'Thoreau', '1763370000', '600000', 'evt-', 'positionMs'])
      expect(sent).not.toContain(leak);
  });

  it('does not sign in for progress, pauses, abandons or ratings', async () => {
    const { run, calls } = load(openLibrary());
    await run([
      event({ event: 'progress' }),
      event({ event: 'pause' }),
      event({ event: 'abandon' }),
      event({ event: 'rate', rating: 4 }),
    ]);
    expect(calls).toHaveLength(0);
  });

  it('skips books without an Open Library work and never searches for one', async () => {
    const { run, calls } = load(openLibrary());
    await run([
      event({ event: 'start', item: { type: 'audiobook', name: 'My own recording' } }),
      event({
        event: 'start',
        item: { type: 'audiobook', id: 'librivox:59', name: 'Walden', externalIds: { isbn: '1' } },
      }),
      event({ event: 'start', item: { type: 'episode', id: 'ol:OL1W', name: 'An episode' } }),
      event({ event: 'start', item: { type: 'audiobook', id: 'ol:OL1M', name: 'An edition' } }),
    ]);
    expect(calls).toHaveLength(0);
  });

  it('uses the ol external ID of books from other add-ons, and only a work ID', async () => {
    const { run, calls } = load(openLibrary());
    const item = (ol: string) => ({
      type: 'audiobook' as const,
      id: 'librivox:59',
      name: 'Walden',
      externalIds: { ol },
    });
    await run([
      event({ event: 'start', item: item('OL69612W') }),
      ...['OL7353617M', '/works/OL1W', 'OL1W/../../account', 'ol:OL1W', ''].map((ol) =>
        event({ event: 'start', item: item(ol) }),
      ),
    ]);
    expect(shelves(calls).map((c) => new URL(c.url).pathname)).toEqual([
      '/works/OL69612W/bookshelves.json',
    ]);
  });

  it('keeps the last start or finish per work, and spaces the requests after one sign-in', async () => {
    const at = (minutes: number) => Date.UTC(2026, 10, 17, 9, minutes);
    const { run, calls, waits } = load(openLibrary());
    await run([
      event({ event: 'finish', at: at(30) }),
      event({ event: 'start', at: at(0) }),
      event({ event: 'pause', at: at(31) }),
      event({ event: 'start', at: at(5), item: book(2) }),
      event({ event: 'start', at: at(6), item: book(3) }),
    ]);
    expect(calls.filter((c) => c.url.endsWith('/account/login'))).toHaveLength(1);
    expect(shelves(calls).map((c) => [new URL(c.url).pathname, shelfOf(c)])).toEqual([
      ['/works/OL69612W/bookshelves.json', '3'],
      ['/works/OL2W/bookshelves.json', '2'],
      ['/works/OL3W/bookshelves.json', '2'],
    ]);
    // At most 3 requests a second, as Open Library asks of identified clients.
    expect(waits).toEqual([350, 350]);
  });

  it('tells account problems (401) from passing failures (5xx) at sign-in', async () => {
    const at = (reply: Reply) => status(load(() => reply).run([event({ event: 'start' })]));
    const code = (error: string) => ({ status: 400, body: JSON.stringify({ error }) });
    expect(await at(code('invalid_s3keys'))).toBe(401);
    expect(await at(code('account_blocked'))).toBe(401);
    expect(await at(code('ia_account_not_verified'))).toBe(401);
    expect(await at(code('request_timeout'))).toBe(502);
    expect(await at({ status: 400, body: 'oops' })).toBe(502);
    expect(await at({ status: 429 })).toBe(503);
    expect(await at({ status: 503 })).toBe(502);
    // Signed in without a session is the keys not being taken.
    expect(await at({ status: 200, body: 'null' })).toBe(401);
    expect(await at({ status: 200, body: 'null', setCookie: 'session=""; Path=/' })).toBe(401);
  });

  it('answers 401 when the keys stop working, so the app asks to set it up again', async () => {
    const revoked = load(openLibrary({ keys: { ...KEYS, secret: 'NewSecret0000000' } }));
    expect(await status(revoked.run([event({ event: 'start' })]))).toBe(401);
    expect(await status(revoked.run([]))).toBe(401);
  });

  it('retries later when Open Library is busy, and skips a work it refuses', async () => {
    const busy = load(openLibrary({ shelf: () => ({ status: 429 }) }));
    expect(await status(busy.run([event({ event: 'start' })]))).toBe(503);

    const picky = load(
      openLibrary({
        shelf: (call) =>
          call.url.includes('/OL1W/')
            ? { status: 200, body: '{"error":"Invalid bookshelf"}' }
            : { status: 200, body: '{"bookshelves_affected":1}' },
      }),
    );
    expect(
      await status(
        picky.run([
          event({ event: 'start', item: book(1) }),
          event({ event: 'start', item: book(2) }),
        ]),
      ),
    ).toBe(200);
    expect(shelves(picky.calls)).toHaveLength(2);
  });

  it('keeps the keys out of every message it gives', async () => {
    const messages: string[] = [];
    for (const reply of [
      { status: 400, body: '{"error":"invalid_s3keys"}' },
      { status: 400, body: '{"error":"something_new"}' },
      { status: 500 },
      { status: 200, body: 'null' },
    ]) {
      await load(() => reply)
        .run([event({ event: 'start' })])
        .catch((error: Error) => messages.push(error.message));
    }
    expect(messages).toHaveLength(4);
    for (const secret of [KEYS.access, KEYS.secret, SESSION])
      expect(messages.join('\n')).not.toContain(secret);
  });

  it('reaches only openlibrary.org, or the stand-in a development build names', async () => {
    // A stand-in the app did not allow is refused by the sandbox, keys and all.
    const refused = load(openLibrary());
    await expect(refused.run([], { server: 'http://localhost:18480' })).rejects.toThrow(
      'Not allowed',
    );
    expect(refused.calls).toHaveLength(0);

    const standIn = load(openLibrary(), ['openlibrary.org', 'localhost:18480']);
    await standIn.run([event({ event: 'start' })], { server: 'http://localhost:18480/' });
    expect(standIn.calls.map((c) => c.url)).toEqual([
      'http://localhost:18480/account/login',
      'http://localhost:18480/works/OL69612W/bookshelves.json',
    ]);
  });
});
