import { AddonError, type Manifest, type ScrobbleEvent, type ScrobbleItem } from '@lelap/sdk';

import { OPEN_LIBRARY, workIdOf } from '../openlibrary';
import type { FetchLike } from '../upstream';
import type { ConfigurableAddon } from './mount';

// The listener's Open Library reading log. Starting a book puts its work on "Currently reading",
// finishing it on "Already read"; nothing else reaches Open Library, no times and no progress.
// Open Library takes no API token: its JSON login takes the listener's archive.org S3 keys and
// answers with a session cookie, which the bookshelves endpoint needs. The keys live only in the
// sealed add-on URL; the cookie lives for one request.

export const BASE_PATH = '/open-library';

/** Open Library's preset reading-log shelves. */
export const SHELF = { wantToRead: 1, currentlyReading: 2, alreadyRead: 3 } as const;
export type Shelf = (typeof SHELF)[keyof typeof SHELF];

/** archive.org S3 keys, from archive.org/account/s3.php. */
export type OpenLibraryConfig = { access: string; secret: string };

/** Open Library asks identified clients for no more than 3 requests a second. */
export const REQUEST_GAP_MS = 350;

export const openLibraryLogManifest: Manifest = {
  id: 'app.lelap.openlibrary-log',
  version: '1.0.0',
  protocol: 1,
  name: 'Open Library reading log',
  description:
    'Puts the books you start on Currently reading and the ones you finish on Already read in your Open Library reading log.',
  types: ['audiobook'],
  resources: ['scrobble'],
  catalogs: [],
  configurable: true,
};

const WORK = /^OL\d+W$/;

/** The Open Library work an item is, from its `ol:` ID or its `ol` external ID; never guessed. */
export function workOf(item: ScrobbleItem): string | null {
  const own = item.id ? workIdOf(item.id) : null;
  if (own) return own;
  const external = item.externalIds?.ol?.trim();
  return external && WORK.test(external) ? external : null;
}

/**
 * The shelf each work ends on: the last start or finish per work, oldest first. Progress, pauses,
 * abandons and ratings don't move a book on Open Library, so a batch of them sends nothing.
 */
export function shelvesFor(events: ScrobbleEvent[]): Map<string, Shelf> {
  const shelves = new Map<string, Shelf>();
  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    if (event.item.type !== 'audiobook') continue;
    if (event.event !== 'start' && event.event !== 'finish') continue;
    const work = workOf(event.item);
    if (!work) continue;
    shelves.set(work, event.event === 'finish' ? SHELF.alreadyRead : SHELF.currentlyReading);
  }
  return shelves;
}

const REJECTED =
  'Open Library did not accept these S3 keys. Copy them again from archive.org/account/s3.php.';

function cookiesOf(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const joined = headers.get('set-cookie');
  return joined ? [joined] : [];
}

/** The `session` cookie's value from a login answer, or null. */
export function sessionCookie(response: Response): string | null {
  for (const cookie of cookiesOf(response)) {
    const match = /(?:^|[,;]\s*)session=([^;,\s]+)/.exec(cookie);
    // An emptied cookie (`session=""`) is a logout, not a session.
    if (match?.[1] && match[1] !== '""') return match[1];
  }
  return null;
}

export type OpenLibraryLog = {
  /** Signs in with the keys; throws an `AddonError` (401) when Open Library refuses them. */
  login: () => Promise<string>;
  /** Puts a work on a shelf, leaving it there when it already is. */
  shelve: (session: string, work: string, shelf: Shelf) => Promise<void>;
};

export function openLibraryLog(
  fetch: FetchLike,
  config: OpenLibraryConfig,
  userAgent: string,
  base = OPEN_LIBRARY,
): OpenLibraryLog {
  const headers = { Accept: 'application/json', 'User-Agent': userAgent };
  const failed = (response: Response) => {
    if (response.status === 429) return new AddonError(503, 'Open Library asks to slow down');
    return new AddonError(502, `Open Library answered ${response.status}`);
  };
  return {
    async login() {
      // The JSON login takes S3 keys only; Open Library refuses passwords there.
      const response = await fetch(`${base}/account/login`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ access: config.access, secret: config.secret }),
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 400 || response.status === 401 || response.status === 403)
        throw new AddonError(401, REJECTED);
      if (response.status >= 400) throw failed(response);
      const session = sessionCookie(response);
      if (!session) throw new AddonError(401, REJECTED);
      return session;
    },
    async shelve(session, work, shelf) {
      const response = await fetch(`${base}/works/${work}/bookshelves.json`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: `session=${session}`,
        },
        // Without `dont_remove`, posting the shelf a work is already on takes it off again.
        body: new URLSearchParams({ bookshelf_id: String(shelf), dont_remove: 'true' }).toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw failed(response);
      // A refused write answers 200 with an `error` key.
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (body && typeof body === 'object' && body.error)
        throw new AddonError(502, `Open Library: ${String(body.error)}`);
    },
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function openLibraryLogAddon(
  fetch: FetchLike,
  userAgent: string,
  options: {
    /** Another Open Library, such as its development server; openlibrary.org by default. */
    base?: string;
    wait?: (ms: number) => Promise<unknown>;
  } = {},
): Omit<ConfigurableAddon<OpenLibraryConfig>, 'onError'> {
  const { base = OPEN_LIBRARY, wait = pause } = options;
  return {
    basePath: BASE_PATH,
    manifest: openLibraryLogManifest,
    intro:
      'Open Library signs you in with your archive.org S3 keys rather than your password. Make them at archive.org/account/s3.php while signed in with the account you use on Open Library, and paste both here. Lelap then puts books you start on Currently reading and books you finish on Already read. Only the book and the shelf are sent.',
    fields: [
      { name: 'access', label: 'S3 access key', type: 'text' },
      {
        name: 'secret',
        label: 'S3 secret key',
        type: 'password',
        hint: 'To stop the add-on, make new keys on the same page: the old ones stop working.',
      },
    ],
    parse: (form) => {
      const access = (form.access ?? '').trim();
      const secret = (form.secret ?? '').trim();
      if (!/^[A-Za-z0-9]{8,64}$/.test(access) || !/^[A-Za-z0-9]{8,64}$/.test(secret))
        throw new AddonError(
          400,
          'Those do not look like archive.org S3 keys. Copy both from archive.org/account/s3.php.',
        );
      return { access, secret };
    },
    check: async (config) => {
      await openLibraryLog(fetch, config, userAgent, base).login();
    },
    revive: (value) => {
      const { access, secret } = (value ?? {}) as { access?: unknown; secret?: unknown };
      return typeof access === 'string' && access && typeof secret === 'string' && secret
        ? { access, secret }
        : null;
    },
    handlers: (config) => ({
      scrobble: async ({ events }) => {
        const shelves = shelvesFor(events);
        // Most batches are progress and pauses: they move nothing, so they don't sign in.
        if (shelves.size === 0) return;
        const log = openLibraryLog(fetch, config, userAgent, base);
        const session = await log.login();
        let first = true;
        for (const [work, shelf] of shelves) {
          if (!first) await wait(REQUEST_GAP_MS);
          first = false;
          await log.shelve(session, work, shelf);
        }
      },
    }),
  };
}
