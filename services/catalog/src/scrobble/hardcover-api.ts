import { AddonError, type MetaPreview } from '@lelap/sdk';

import type { FetchLike, ResponseCache } from '../upstream';

// Talking to Hardcover's GraphQL API with one listener's own token, and remembering answers for
// that token only. Shared by the scrobbler and the catalogs.

export const HARDCOVER_API = 'https://api.hardcover.app/v1/graphql';
export const HARDCOVER_SITE = 'https://hardcover.app';
export const PREFIX = 'hardcover:';

/**
 * What the add-on asks of a token: `me` (read:me), shelves and reads (read:library,
 * write:library), books, editions, search and trending (read:catalog), lists (read:lists).
 */
export const SCOPES = ['read:me', 'read:library', 'write:library', 'read:catalog', 'read:lists'];

/** Hardcover's form for a new token, with these scopes already ticked. */
export const NEW_TOKEN_URL = `${HARDCOVER_SITE}/account/api/keys/new?scope=${SCOPES.join('+')}`;

export type GraphQL = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

const SET_UP_AGAIN = 'Hardcover did not accept the token; configure the add-on again';

export const refused = (message = SET_UP_AGAIN) => new AddonError(401, message);

/** Hardcover's answer to a refused request as an `AddonError`; 401 means “set up again”. */
async function failure(response: Response): Promise<AddonError> {
  const { status } = response;
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    errors?: unknown;
    scope?: unknown;
  } | null;
  const codes = [body?.error, ...(Array.isArray(body?.errors) ? body.errors : [])];
  if (status === 401) return refused();
  if (status === 403) {
    if (codes.includes('insufficient_scope')) {
      const scope = typeof body?.scope === 'string' ? body.scope : 'a permission';
      return refused(
        `The Hardcover token lacks ${scope}; make a new token with it and configure the add-on again`,
      );
    }
    // Too many top-level fields in one request: a bug here, not the listener's token.
    if (codes.includes('request_exceeds_capacity') || codes.includes('unsupported_operation'))
      return new AddonError(502, `Hardcover refused the request (${String(codes.find(Boolean))})`);
    return new AddonError(403, 'Hardcover did not allow this; the list may be private now');
  }
  if (status === 408) return new AddonError(504, 'Hardcover took too long to answer');
  if (status === 429) return new AddonError(503, 'Hardcover asks to slow down');
  if (status === 503) return new AddonError(503, 'Hardcover is briefly unavailable');
  return new AddonError(502, `Hardcover answered ${status}`);
}

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
    if (!response.ok) throw await failure(response);
    const body = (await response.json()) as { data?: T; errors?: { message?: string }[] };
    if (body.errors?.length || !body.data) {
      const message = body.errors?.[0]?.message ?? 'no data';
      // Hasura answers an invalid token with a 200 and an error.
      if (/jwt|auth|token/i.test(message)) throw refused();
      throw new AddonError(502, `Hardcover: ${message}`);
    }
    return body.data;
  };
}

/** Remembers an answer for one token; `what` names the answer, such as `list:12`. */
export type TokenCache = <T>(what: string, ttl: number, load: () => Promise<T>) => Promise<T>;

const encoder = new TextEncoder();

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A small cache in memory, for a server without the Workers Cache API (Docker). */
export function memoryCache(limit = 500): ResponseCache {
  const entries = new Map<string, { text: string; expires: number }>();
  return {
    match: async (key) => {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return new Response(entry.text);
    },
    put: async (key, response) => {
      const maxAge = /max-age=(\d+)/.exec(response.headers.get('Cache-Control') ?? '')?.[1];
      entries.delete(key);
      entries.set(key, {
        text: await response.text(),
        expires: Date.now() + Number(maxAge) * 1000,
      });
      if (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
  };
}

/**
 * Answers keyed on a hash of the token, never the token itself, so a cache key can't be read
 * back as a token and one listener's private lists are never another's answer.
 */
export function tokenCache(cache: ResponseCache, token: string): TokenCache {
  const owner = sha256(`lelap hardcover cache v1\n${token}`);
  return async (what, ttl, load) => {
    const key = `${HARDCOVER_API}?owner=${await owner}&what=${encodeURIComponent(what)}`;
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return (await hit.json()) as Awaited<ReturnType<typeof load>>;
    const value = await load();
    await cache
      .put(
        key,
        new Response(JSON.stringify(value), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${ttl}`,
          },
        }),
      )
      .catch(() => undefined);
    return value;
  };
}

export type Book = {
  id: number;
  title: string;
  description?: string | null;
  release_year?: number | null;
  slug?: string | null;
  image?: { url?: string | null } | null;
  contributions?: { author?: { name?: string | null } | null }[] | null;
  editions?: Edition[] | null;
};

export type Edition = {
  isbn_10?: string | null;
  isbn_13?: string | null;
  asin?: string | null;
  reading_format_id?: number | null;
};

/** The fields of a book a catalog tile needs. */
export const BOOK_FIELDS = 'id title release_year image { url } contributions { author { name } }';

const authorOf = (book: Book) =>
  (book.contributions ?? [])
    .map((c) => c.author?.name)
    .filter((n): n is string => Boolean(n))
    .join(', ') || undefined;

const httpsUrl = (url?: string | null) => (url && /^https?:\/\//.test(url) ? url : undefined);

export function preview(book: Book): MetaPreview {
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

/** Reading formats 2 (audio) and 3 (both) are audiobooks. */
const isAudio = (edition: Edition) =>
  edition.reading_format_id === 2 || edition.reading_format_id === 3;

/**
 * An ISBN and an ASIN for the work, from an audiobook edition when there is one, so a listener's
 * tagged copy and Open Library link to it.
 */
export function editionIds(editions: Edition[]): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const edition of [...editions.filter(isAudio), ...editions]) {
    const isbn = edition.isbn_13 ?? edition.isbn_10;
    if (isbn) ids.isbn ??= isbn;
    if (edition.asin) ids.asin ??= edition.asin;
  }
  return ids;
}
