import {
  AddonError,
  type Manifest,
  type Meta,
  type MetaPreview,
  type ScrobbleEvent,
  type ScrobbleItem,
} from '@lelap/sdk';

import type { FetchLike } from '../upstream';
import type { ConfigurableAddon } from './mount';

// Hardcover (hardcover.app), a reading tracker with a GraphQL API. Listening moves a book to
// "Currently reading" with its progress, a finished book to "Read", an abandoned one to "Did not
// finish". The "Want to read" shelf comes back as a catalog for Home. The listener's API token
// lives only in their sealed add-on URL.

export const BASE_PATH = '/hardcover';
export const HARDCOVER_API = 'https://api.hardcover.app/v1/graphql';
export const PREFIX = 'hardcover:';

/** Hardcover's reading statuses. */
export const STATUS = { wantToRead: 1, reading: 2, read: 3, didNotFinish: 5 } as const;

export type HardcoverConfig = { token: string };

export const hardcoverManifest: Manifest = {
  id: 'app.lelap.hardcover',
  version: '1.0.0',
  protocol: 1,
  name: 'Hardcover',
  description:
    'Keeps your Hardcover shelves up to date as you listen, and shows your Want to read shelf on Home.',
  types: ['audiobook'],
  resources: ['catalog', { name: 'meta', idPrefixes: [PREFIX] }, 'scrobble'],
  idPrefixes: [PREFIX],
  catalogs: [
    { type: 'audiobook', id: 'want-to-read', name: 'Want to read', shelf: 'want-to-read' },
  ],
  configurable: true,
};

type GraphQL = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

/** A GraphQL client for one listener. Never logs or echoes the token. */
export function hardcoverClient(fetch: FetchLike, token: string, userAgent: string): GraphQL {
  const authorization = /^bearer /i.test(token) ? token : `Bearer ${token}`;
  return async <T>(query: string, variables: Record<string, unknown> = {}) => {
    const response = await fetch(HARDCOVER_API, {
      method: 'POST',
      headers: {
        authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403)
      throw new AddonError(401, 'Hardcover did not accept the token; configure the add-on again');
    if (response.status === 429) throw new AddonError(503, 'Hardcover asks to slow down');
    if (!response.ok) throw new AddonError(502, `Hardcover answered ${response.status}`);
    const body = (await response.json()) as { data?: T; errors?: { message?: string }[] };
    if (body.errors?.length || !body.data) {
      const message = body.errors?.[0]?.message ?? 'no data';
      // Hasura answers an invalid token with a 200 and an error.
      if (/jwt|auth|token/i.test(message))
        throw new AddonError(401, 'Hardcover did not accept the token; configure the add-on again');
      throw new AddonError(502, `Hardcover: ${message}`);
    }
    return body.data;
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
    editions(where: { _or: [{ isbn_13: { _is_null: false } }, { asin: { _is_null: false } }] }, limit: 5) { isbn_13 asin }
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

type Book = {
  id: number;
  title: string;
  description?: string | null;
  release_year?: number | null;
  slug?: string | null;
  image?: { url?: string | null } | null;
  contributions?: { author?: { name?: string | null } | null }[] | null;
  editions?: { isbn_13?: string | null; asin?: string | null }[] | null;
};

const authorOf = (book: Book) =>
  (book.contributions ?? [])
    .map((c) => c.author?.name)
    .filter((n): n is string => Boolean(n))
    .join(', ') || undefined;

const httpsUrl = (url?: string | null) => (url && /^https?:\/\//.test(url) ? url : undefined);

function preview(book: Book): MetaPreview {
  const author = authorOf(book);
  const cover = httpsUrl(book.image?.url);
  return {
    id: `${PREFIX}${book.id}`,
    type: 'audiobook',
    name: book.title || 'Untitled',
    ...(author ? { author } : {}),
    ...(cover ? { cover } : {}),
    ...(book.description ? { description: book.description } : {}),
    ...(book.release_year ? { year: book.release_year } : {}),
  };
}

/** A UTC date as Hardcover's date fields take it. */
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function currentUser(gql: GraphQL): Promise<number> {
  const data = await gql<{ me: { id: number }[] | { id: number } }>(ME);
  const me = Array.isArray(data.me) ? data.me[0] : data.me;
  if (!me)
    throw new AddonError(401, 'Hardcover did not accept the token; configure the add-on again');
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
  if (event.event === 'rate' && event.rating !== undefined) update.rating = event.rating;
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

/** Keeps the last event per book: Hardcover holds a state, not a history. */
export function latestPerItem(events: ScrobbleEvent[]): ScrobbleEvent[] {
  const key = (e: ScrobbleEvent) =>
    `${e.event === 'rate' ? 'rate' : 'state'} ${e.item.id ?? ''} ${e.item.name} ${e.item.author ?? ''}`;
  const last = new Map<string, ScrobbleEvent>();
  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    const previous = last.get(key(event));
    // A pause right after a finish must not make the book "reading" again.
    if (previous?.event === 'finish' && event.event !== 'start') continue;
    last.set(key(event), event);
  }
  return [...last.values()];
}

export function hardcoverAddon(
  fetch: FetchLike,
  userAgent: string,
): Omit<ConfigurableAddon<HardcoverConfig>, 'onError'> {
  const client = (config: HardcoverConfig) => hardcoverClient(fetch, config.token, userAgent);
  return {
    basePath: BASE_PATH,
    manifest: hardcoverManifest,
    intro:
      'Paste your Hardcover API token (hardcover.app → Settings → Hardcover API). Lelap then moves books to Currently reading, Read or Did not finish as you listen, and shows your Want to read shelf on Home.',
    fields: [{ name: 'token', label: 'API token', type: 'password', placeholder: 'Bearer eyJ…' }],
    parse: (form) => {
      const token = (form.token ?? '').trim();
      if (token.length < 20)
        throw new AddonError(400, 'That does not look like a Hardcover token.');
      return { token };
    },
    check: async (config) => {
      await currentUser(client(config));
    },
    revive: (value) => {
      const token = (value as { token?: unknown } | null)?.token;
      return typeof token === 'string' && token.length > 0 ? { token } : null;
    },
    handlers: (config) => ({
      catalog: async () => {
        const gql = client(config);
        const user = await currentUser(gql);
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
        const data = await client(config)<{ books: Book[] }>(BOOK, { id: bookId });
        const book = data.books[0];
        if (!book) return null;
        const externalIds: Record<string, string> = {};
        for (const edition of book.editions ?? []) {
          if (edition.isbn_13) externalIds.isbn ??= edition.isbn_13;
          if (edition.asin) externalIds.asin ??= edition.asin;
        }
        const meta: Meta = {
          ...preview(book),
          ...(Object.keys(externalIds).length > 0 ? { externalIds } : {}),
          ...(book.slug
            ? { link: `https://hardcover.app/books/${encodeURIComponent(book.slug)}` }
            : {}),
        };
        return { meta, cacheMaxAge: 3600 };
      },
      scrobble: async ({ events }) => {
        const gql = client(config);
        const user = await currentUser(gql);
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
