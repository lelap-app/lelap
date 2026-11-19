import {
  AddonError,
  type Edition,
  type Manifest,
  type Meta,
  type ScrobbleEvent,
  type ScrobbleItem,
} from '@lelap/sdk';

import { type FetchLike, type ResponseCache, TTL } from '../upstream';
import {
  type Book,
  editionIds,
  type GraphQL,
  HARDCOVER_SITE,
  hardcoverClient,
  memoryCache,
  MissingScope,
  NEW_TOKEN_URL,
  PREFIX,
  preview,
  refused,
  SCOPES,
  tokenCache,
} from './hardcover-api';
import {
  applyPicks,
  availableLists,
  catalogFor,
  DEFAULT_SHOWN,
  NO_LISTS,
  pickFields,
  reviveShown,
  reviveStoredShown,
  storeShown,
  type Shown,
  shownCatalogs,
} from './hardcover-catalogs';
import type { ScrobbleAddon } from './mount';

// Hardcover (hardcover.app), a reading tracker with a GraphQL API. Listening moves a book to
// "Currently reading" with its progress, a finished book to "Read", an abandoned one to "Did not
// finish". The "Want to read" shelf, trending books and the listener's chosen lists come back as
// catalogs (M76). The listener's API token lives only in their sealed add-on URL.

export { HARDCOVER_API, PREFIX } from './hardcover-api';
export const BASE_PATH = '/hardcover';

/** Hardcover's reading statuses. */
export const STATUS = { wantToRead: 1, reading: 2, read: 3, didNotFinish: 5 } as const;

/** `shown` is missing in links made before M76. */
export type HardcoverConfig = { token: string; shown?: Shown };

const WANT_TO_READ_CATALOG = {
  type: 'audiobook',
  id: 'want-to-read',
  name: 'Want to read',
  shelf: 'want-to-read',
} as const;

export const hardcoverManifest: Manifest = {
  id: 'app.lelap.hardcover',
  version: '1.2.0',
  protocol: 1,
  name: 'Hardcover',
  description:
    'Keeps your Hardcover shelves up to date as you listen, and shows your Want to read shelf, trending books and your lists. Book data from Hardcover.',
  types: ['audiobook'],
  resources: ['catalog', { name: 'meta', idPrefixes: [PREFIX] }, 'scrobble'],
  idPrefixes: [PREFIX],
  catalogs: [WANT_TO_READ_CATALOG],
  configurable: true,
};

/** One listener's manifest: Want to read, then the trending rows and lists they chose. */
export function manifestFor(config: HardcoverConfig): Manifest {
  return {
    ...hardcoverManifest,
    catalogs: [WANT_TO_READ_CATALOG, ...shownCatalogs(config.shown ?? DEFAULT_SHOWN)],
  };
}

const ME = `query Me { me { id username } }`;

const WANT_TO_READ = `query WantToRead($user: Int!, $status: Int!) {
  user_books(where: { user_id: { _eq: $user }, status_id: { _eq: $status } }, order_by: { updated_at: desc }, limit: 100) {
    book { id title description release_year image { url } contributions { author { name } } }
  }
}`;

const BOOK = `query Book($id: Int!) {
  books(where: { id: { _eq: $id } }, limit: 1) {
    id title description release_year slug image { url } contributions { author { name } }
    editions(
      where: { _or: [{ isbn_13: { _is_null: false } }, { isbn_10: { _is_null: false } }, { asin: { _is_null: false } }] }
      order_by: { users_count: desc }
      limit: 20
    ) { isbn_10 isbn_13 asin reading_format_id }
  }
}`;

// Reading format 2 is audio. Contributions name the narrators.
const AUDIO_EDITIONS = `query AudioEditions($id: Int!) {
  editions(where: { book_id: { _eq: $id }, reading_format_id: { _eq: 2 } }, order_by: { users_count: desc }, limit: 20) {
    id title release_date audio_seconds isbn_10 isbn_13 asin edition_format image { url } publisher { name }
    contributions { contribution author { name } }
  }
}`;

const EDITION = `query Edition($isbn: String, $asin: String) {
  editions(where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }, { asin: { _eq: $asin } }] }, limit: 1) { book_id }
}`;

const SEARCH = `query Search($query: String!) {
  search(query: $query, query_type: "Book", per_page: 1, page: 1) { results }
}`;

const USER_BOOK = `query UserBook($user: Int!, $book: Int!) {
  user_books(where: { user_id: { _eq: $user }, book_id: { _eq: $book } }, limit: 1) {
    id status_id
    user_book_reads(order_by: { id: desc }, limit: 1) { id finished_at }
  }
}`;

const INSERT_USER_BOOK = `mutation AddBook($book: Int!, $status: Int!) {
  insert_user_book(object: { book_id: $book, status_id: $status }) { id error }
}`;

const UPDATE_USER_BOOK = `mutation UpdateBook($id: Int!, $object: UserBookUpdateInput!) {
  update_user_book(id: $id, object: $object) { id error }
}`;

const INSERT_READ = `mutation AddRead($userBook: Int!, $read: DatesReadInput!) {
  insert_user_book_read(user_book_id: $userBook, user_book_read: $read) { id error }
}`;

const UPDATE_READ = `mutation UpdateRead($id: Int!, $object: DatesReadInput!) {
  update_user_book_read(id: $id, object: $object) { id error }
}`;

/** A UTC date as Hardcover's date fields take it. */
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function currentUser(gql: GraphQL): Promise<number> {
  const data = await gql<{ me: { id: number }[] | { id: number } }>(ME);
  const me = Array.isArray(data.me) ? data.me[0] : data.me;
  if (!me) throw refused();
  return me.id;
}

/** The Hardcover book an event is about: by ID, ISBN or ASIN, else by title and author. */
async function findBook(gql: GraphQL, item: ScrobbleItem): Promise<number | null> {
  const ids = { ...item.externalIds };
  if (item.id) {
    const at = item.id.indexOf(':');
    ids[item.id.slice(0, at)] ??= item.id.slice(at + 1);
  }
  const direct = Number(ids.hardcover);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const isbn = ids.isbn ?? ids.isbn_13 ?? ids.isbn13 ?? ids.isbn_10;
  const asin = ids.asin;
  if (isbn || asin) {
    const data = await gql<{ editions: { book_id: number }[] }>(EDITION, {
      isbn: isbn ?? null,
      asin: asin ?? null,
    });
    const found = data.editions[0]?.book_id;
    if (found) return found;
  }
  const query = [item.name, item.author].filter(Boolean).join(' ');
  const data = await gql<{ search: { results?: unknown } }>(SEARCH, { query });
  return firstSearchHit(data.search.results);
}

/** `search.results` is Typesense's answer as JSON: `{ hits: [{ document: { id } }] }`. */
export function firstSearchHit(results: unknown): number | null {
  const parsed = typeof results === 'string' ? (JSON.parse(results) as unknown) : results;
  const hits = (parsed as { hits?: { document?: { id?: unknown } }[] } | null)?.hits;
  const id = Number(hits?.[0]?.document?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type UserBook = {
  id: number;
  status_id: number;
  user_book_reads: { id: number; finished_at: string | null }[];
};

function mutationId(result: { id?: number | null; error?: string | null } | undefined): number {
  if (!result?.id) throw new AddonError(502, `Hardcover: ${result?.error ?? 'nothing changed'}`);
  return result.id;
}

/**
 * Applies one event. Each step sets a state rather than adding to one, so an event sent twice
 * after a lost answer changes nothing the second time.
 */
async function apply(gql: GraphQL, user: number, book: number, event: ScrobbleEvent) {
  const found = await gql<{ user_books: UserBook[] }>(USER_BOOK, { user, book });
  let userBook = found.user_books[0];
  // Carrying on with a book already marked read, such as its last minutes again, isn't a new
  // reading; only a fresh start (revision 9: a start without `resumed`) is.
  if (userBook?.status_id === STATUS.read && carriesOn(event)) return;
  // A rating taken back (revision 10) for a book not on a shelf leaves nothing to change.
  if (event.event === 'rate' && event.rating === undefined && !userBook) return;
  const wanted =
    event.event === 'finish'
      ? STATUS.read
      : event.event === 'abandon'
        ? STATUS.didNotFinish
        : event.event === 'rate'
          ? null
          : STATUS.reading;

  if (!userBook) {
    const id = mutationId(
      (
        await gql<{ insert_user_book: { id: number; error?: string } }>(INSERT_USER_BOOK, {
          book,
          status: wanted ?? STATUS.read,
        })
      ).insert_user_book,
    );
    userBook = { id, status_id: wanted ?? STATUS.read, user_book_reads: [] };
  }

  const update: Record<string, unknown> = {};
  // Listening again to a book marked read counts as reading it again.
  if (wanted !== null && userBook.status_id !== wanted) update.status_id = wanted;
  if (event.event === 'rate') update.rating = event.rating ?? null;
  if (Object.keys(update).length > 0)
    mutationId(
      (
        await gql<{ update_user_book: { id: number; error?: string } }>(UPDATE_USER_BOOK, {
          id: userBook.id,
          object: update,
        })
      ).update_user_book,
    );

  if (event.event === 'rate' || event.event === 'abandon') return;
  const seconds = Math.round((event.positionMs ?? 0) / 1000);
  const open = userBook.user_book_reads.find((r) => r.finished_at === null);
  const read: Record<string, unknown> = { progress_seconds: seconds };
  if (event.event === 'finish') read.finished_at = day(event.at);
  if (open) {
    mutationId(
      (
        await gql<{ update_user_book_read: { id: number; error?: string } }>(UPDATE_READ, {
          id: open.id,
          object: read,
        })
      ).update_user_book_read,
    );
  } else {
    mutationId(
      (
        await gql<{ insert_user_book_read: { id: number; error?: string } }>(INSERT_READ, {
          userBook: userBook.id,
          read: { ...read, started_at: day(event.at) },
        })
      ).insert_user_book_read,
    );
  }
}

/** Progress, a pause or a resumed start: the listener goes on with a reading already begun. */
const carriesOn = (event: ScrobbleEvent) =>
  event.event === 'progress' ||
  event.event === 'pause' ||
  (event.event === 'start' && event.resumed === true);

/** Keeps the last event per book: Hardcover holds a state, not a history. */
export function latestPerItem(events: ScrobbleEvent[]): ScrobbleEvent[] {
  const key = (e: ScrobbleEvent) =>
    `${e.event === 'rate' ? 'rate' : 'state'} ${e.item.id ?? ''} ${e.item.name} ${e.item.author ?? ''}`;
  const last = new Map<string, ScrobbleEvent>();
  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    const previous = last.get(key(event));
    // A pause right after a finish must not make the book "reading" again.
    if (previous?.event === 'finish' && (event.event !== 'start' || event.resumed === true))
      continue;
    // A fresh start followed by progress stays a fresh start, at the later position.
    if (previous?.event === 'start' && previous.resumed !== true && carriesOn(event)) {
      const fresh: ScrobbleEvent = { ...event, event: 'start' };
      delete fresh.resumed;
      last.set(key(event), fresh);
      continue;
    }
    last.set(key(event), event);
  }
  return [...last.values()];
}

type AudioEdition = {
  id: number;
  title?: string | null;
  release_date?: string | null;
  audio_seconds?: number | null;
  isbn_10?: string | null;
  isbn_13?: string | null;
  asin?: string | null;
  edition_format?: string | null;
  image?: { url?: string | null } | null;
  publisher?: { name?: string | null } | null;
  contributions?:
    { contribution?: string | null; author?: { name?: string | null } | null }[] | null;
};

/** Hardcover's audiobook editions of a work, as the item page lists them (M102). */
export function audioEditions(list: AudioEdition[]): Edition[] {
  const seen = new Set<string>();
  return list.flatMap((e) => {
    const key = String(e.id);
    if (!Number.isInteger(e.id) || seen.has(key)) return [];
    seen.add(key);
    const year = Number(/^(\d{4})/.exec(e.release_date ?? '')?.[1]) || undefined;
    const publisher = e.publisher?.name?.trim() || undefined;
    const narrators = [
      ...new Set(
        (e.contributions ?? []).flatMap((c) =>
          /narrat|reader/i.test(c.contribution ?? '') && c.author?.name?.trim()
            ? [c.author.name.trim()]
            : [],
        ),
      ),
    ].slice(0, 20);
    const name =
      [publisher, year].filter(Boolean).join(', ') ||
      e.edition_format?.trim() ||
      e.title?.trim() ||
      'Audiobook';
    const isbn = e.isbn_13 ?? e.isbn_10;
    const externalIds: Record<string, string> = {
      ...(isbn ? { isbn } : {}),
      ...(e.asin ? { asin: e.asin } : {}),
    };
    const cover = e.image?.url && /^https?:\/\//.test(e.image.url) ? e.image.url : undefined;
    const edition: Edition = {
      key,
      name: name.slice(0, 200),
      ...(year ? { year } : {}),
      ...(narrators.length > 0 ? { narrators } : {}),
      ...(publisher ? { publisher: publisher.slice(0, 200) } : {}),
      ...(cover ? { cover } : {}),
      ...(e.audio_seconds && e.audio_seconds > 0 ? { durationMs: e.audio_seconds * 1000 } : {}),
      ...(Object.keys(externalIds).length > 0 ? { externalIds } : {}),
    };
    return [edition];
  });
}

/** Settings as the SDK keeps them, or from a sealed link made before M102 (`shown` object). */
export function reviveHardcover(value: unknown): HardcoverConfig | null {
  const raw = value as { token?: unknown; shown?: unknown; trending?: unknown; lists?: unknown };
  const token = raw?.token;
  if (typeof token !== 'string' || token.length === 0) return null;
  if (raw.shown !== undefined) return { token, shown: reviveShown(raw.shown) };
  if (raw.trending === undefined && raw.lists === undefined) return { token };
  return { token, shown: reviveStoredShown(raw.trending, raw.lists) };
}

export function hardcoverAddon(
  fetch: FetchLike,
  userAgent: string,
  /** The Workers Cache API; without one (Docker), answers are kept in memory. */
  cache: ResponseCache = memoryCache(),
  /** `CONFIG_SECRET`, which keys the cache's names for tokens. */
  secret?: string,
): ScrobbleAddon<HardcoverConfig> {
  const client = (config: HardcoverConfig) => hardcoverClient(fetch, config.token, userAgent);
  const cachedFor = (config: HardcoverConfig) => tokenCache(cache, config.token, secret);
  // A token belongs to one account for good, so its user ID can be kept for a day.
  const userOf = (gql: GraphQL, config: HardcoverConfig) =>
    cachedFor(config)('me', TTL.item, () => currentUser(gql));
  const listsOf = async (config: HardcoverConfig) => {
    const gql = client(config);
    const user = await userOf(gql, config);
    try {
      // Kept briefly: the choices page reads them again when its form comes back.
      const available = await cachedFor(config)('lists', 600, () => availableLists(gql, user));
      return { gql, user, available, canReadLists: true };
    } catch (error) {
      // A token made for scrobbling alone still sets up, with the trending rows only.
      if (!(error instanceof MissingScope)) throw error;
      return { gql, user, available: NO_LISTS, canReadLists: false };
    }
  };
  return {
    basePath: BASE_PATH,
    manifest: hardcoverManifest,
    manifestFor,
    text: {
      intro:
        'Lelap moves books to Currently reading, Read or Did not finish as you listen, sends your ratings, and shows your Want to read shelf, trending books and the lists you choose. For that it needs an API token from your Hardcover account.',
      link: { href: NEW_TOKEN_URL, label: 'Make a token on Hardcover' },
      steps: [
        'Tap the button above. Hardcover opens its New API Key form with the right permissions already ticked. Sign in first if it asks.',
        'Name the key, for example Lelap, and choose when it expires. When it runs out, Lelap asks you to set up again.',
        'Create the key and copy it. It starts with hc_pat_, and Hardcover shows it only once.',
        'Come back to this page and paste it below.',
      ],
      note: `Permissions it needs: ${SCOPES.join(', ')}. A token made before August 2026 has them all. To see or revoke your tokens later: hardcover.app → Settings → Hardcover API.`,
    },
    fields: [
      {
        key: 'token',
        label: 'API token',
        type: 'password',
        required: true,
        placeholder: 'hc_pat_…',
      },
    ],
    parse: (form) => {
      const token = typeof form.token === 'string' ? form.token.trim() : '';
      if (token.length < 20)
        throw new AddonError(400, 'That does not look like a Hardcover token.');
      const config = reviveHardcover({ ...form, token });
      if (!config) throw new AddonError(400, 'That does not look like a Hardcover token.');
      return config;
    },
    check: async (config) => {
      await currentUser(client(config));
    },
    choose: {
      intro:
        'Choose the rows to show in Lelap. Each list is one row, in its own order. Everything here comes from Hardcover, read with your token only.',
      fields: async (config) => {
        const { available, canReadLists } = await listsOf(config);
        return pickFields(available, config.shown, canReadLists);
      },
      apply: async (config, chosen) => {
        const { gql, user, available } = await listsOf(config);
        const shown = await applyPicks(gql, user, available, chosen, config.shown);
        return { token: config.token, shown };
      },
    },
    revive: reviveHardcover,
    store: (config) => ({
      token: config.token,
      ...(config.shown ? storeShown(config.shown) : {}),
    }),
    handlers: (config) => ({
      catalog: async ({ id }) => {
        const gql = client(config);
        const shown = catalogFor(id, gql, cachedFor(config));
        if (shown) return shown;
        const user = await userOf(gql, config);
        const data = await gql<{ user_books: { book: Book | null }[] }>(WANT_TO_READ, {
          user,
          status: STATUS.wantToRead,
        });
        return {
          metas: data.user_books.flatMap((row) => (row.book ? [preview(row.book)] : [])),
          // Private to this listener: never in a shared cache for long.
          cacheMaxAge: 0,
        };
      },
      meta: async ({ id }) => {
        const bookId = Number(id.slice(PREFIX.length));
        if (!Number.isInteger(bookId) || bookId <= 0) return null;
        const gql = client(config);
        const book = await cachedFor(config)(`book:${bookId}`, TTL.item, async () => {
          const data = await gql<{ books: Book[] }>(BOOK, { id: bookId });
          return data.books[0] ?? null;
        });
        if (!book) return null;
        // Apart from the book, so a field Hardcover renames costs the editions, not the page.
        const editions = await cachedFor(config)(`editions:${bookId}`, TTL.item, async () => {
          const data = await gql<{ editions: AudioEdition[] }>(AUDIO_EDITIONS, { id: bookId });
          return audioEditions(data.editions);
        }).catch(() => [] as Edition[]);
        const externalIds = editionIds(book.editions ?? []);
        const meta: Meta = {
          ...preview(book),
          ...(Object.keys(externalIds).length > 0 ? { externalIds } : {}),
          ...(book.slug
            ? { link: `${HARDCOVER_SITE}/books/${encodeURIComponent(book.slug)}` }
            : {}),
          // The item page lists editions from two on.
          ...(editions.length > 1 ? { editions } : {}),
        };
        return { meta, cacheMaxAge: 3600 };
      },
      scrobble: async ({ events }) => {
        const gql = client(config);
        const user = await userOf(gql, config);
        for (const event of latestPerItem(events)) {
          if (event.item.type !== 'audiobook') continue;
          const book = await findBook(gql, event.item);
          // A book Hardcover doesn't know is skipped, not retried forever.
          if (book === null) continue;
          await apply(gql, user, book, event);
        }
      },
    }),
  };
}
