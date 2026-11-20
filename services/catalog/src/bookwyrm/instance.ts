import { AddonError } from '@lelap/sdk';
import { z } from 'zod';

import { htmlToText } from '../text';
import type { FetchLike, ResponseCache } from '../upstream';

// Reading a listener's BookWyrm instance (M130): public shelves as ActivityPub JSON, or as RSS on
// an instance that requires signed GET for JSON. Read only: nothing is ever posted to BookWyrm.

/** The four reading shelves, by their identifier on every BookWyrm instance. */
export const SHELVES = ['to-read', 'reading', 'read', 'stopped-reading'] as const;
export type Shelf = (typeof SHELVES)[number];

/** A shelf for 15 minutes, so a busy Home doesn't ask the instance on every open. */
export const SHELF_TTL = 15 * 60;
/** A book's own JSON changes rarely. */
export const BOOK_TTL = 24 * 60 * 60;
/** At most one request a second to one instance, from this server. */
const SPACING_MS = 1000;
/** A longer queue for one instance is refused, so a row comes back empty rather than late. */
const MAX_QUEUE_MS = 8000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5_000_000;

export type Account = { instance: string; user: string };

/** A shelved book, from shelf JSON or RSS. */
export type ShelvedBook = {
  /** The book's address on the instance, such as `https://books.example/book/12`. */
  url: string;
  title: string;
  author?: string;
  cover?: string;
  description?: string;
  /** Open Library edition key, such as `OL123M`; JSON only. */
  openLibrary?: string;
  isbn?: string;
};

/** An https origin (BookWyrm runs at the root); throws an `AddonError` (400) with what to fix. */
export function instanceUrl(input: string): string {
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new AddonError(400, 'Enter your BookWyrm instance, such as https://bookwyrm.social.');
  }
  if (url.protocol !== 'https:') throw new AddonError(400, 'The instance must use https.');
  if (url.username || url.password || url.search || url.hash)
    throw new AddonError(400, 'Enter only the instance address, without a login or query.');
  return url.origin;
}

/** `reader`, `@reader` or `@reader@books.example` as `reader`; null for anything else. */
export function userName(input: string, instance: string): string | null {
  const host = new URL(instance).host.toLowerCase();
  const match = /^@?([\w.-]+)(?:@([\w.-]+(?::\d+)?))?$/.exec(input.trim());
  if (!match?.[1]) return null;
  if (match[2] && match[2].toLowerCase() !== host) return null;
  return match[1];
}

export type Answer = { status: number; text: string };

export type Instance = {
  /**
   * GETs a page of the instance through the cache. 200 and 403 answers are kept; a 404 is not,
   * so a listener who makes their shelves public sees them on the next try.
   */
  get: (url: string, accept: string, ttl: number) => Promise<Answer>;
};

/**
 * Waits so that requests to one host are at least a second apart, in this isolate; throws an
 * `AddonError` (503) when the queue for the host is already too long.
 */
export function throttle(wait: (ms: number) => Promise<void>, now: () => number) {
  const next = new Map<string, number>();
  return async (host: string) => {
    const time = now();
    const at = Math.max(time, next.get(host) ?? 0);
    if (at - time > MAX_QUEUE_MS) throw new AddonError(503, `${host} is busy; try again soon`);
    if (next.size > 1000) for (const [key, value] of next) if (value <= time) next.delete(key);
    next.set(host, at + SPACING_MS);
    if (at > time) await wait(at - time);
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createInstance(
  fetch: FetchLike,
  userAgent: string,
  options: { cache?: ResponseCache; now?: () => number; wait?: (ms: number) => Promise<void> } = {},
): Instance {
  const { cache } = options;
  const turn = throttle(options.wait ?? sleep, options.now ?? Date.now);
  return {
    async get(url, accept, ttl) {
      // Keyed by the URL itself: the Workers Cache API takes only http(s) keys.
      const key = url;
      const cached = await cache?.match(key).catch(() => undefined);
      if (cached) return (await cached.json()) as Answer;
      await turn(new URL(url).host);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Accept: accept, 'User-Agent': userAgent },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new AddonError(502, `${new URL(url).host} did not answer`);
      }
      const text = response.ok ? await response.text() : '';
      if (text.length > MAX_BYTES) throw new AddonError(502, 'The instance answered too much');
      const answer = { status: response.status, text };
      if (cache && (response.status === 200 || response.status === 403))
        await cache
          .put(
            key,
            new Response(JSON.stringify(answer), {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': `public, max-age=${ttl}`,
              },
            }),
          )
          .catch(() => undefined);
      return answer;
    },
  };
}

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const EditionJson = z.object({
  id: z.string(),
  title: z.string().min(1),
  subtitle: lenient(z.string()),
  description: lenient(z.string()),
  openlibraryKey: lenient(z.string().regex(/^OL\d+[MW]$/)),
  isbn13: lenient(z.string()),
  isbn10: lenient(z.string()),
  cover: lenient(z.object({ url: lenient(z.string()), name: lenient(z.string()) })),
});

const PageJson = z.object({
  orderedItems: z.array(z.unknown()),
  next: lenient(z.string()),
});

const ShelfJson = z.object({ totalItems: lenient(z.number().int().nonnegative()) });

const httpsOn = (value: string | undefined, origin: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value, origin);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const isbnOf = (value: string | undefined) => {
  const digits = value?.replace(/[^0-9X]/gi, '');
  return digits && /^(\d{13}|\d{9}[\dX])$/i.test(digits) ? digits.toUpperCase() : undefined;
};

/**
 * One edition from shelf or book JSON. Authors are links there; their names only appear in the
 * cover's caption, which BookWyrm writes as `Authors: Title (format, year, publisher)`.
 */
export function editionOf(raw: unknown, origin: string): ShelvedBook | null {
  const parsed = EditionJson.safeParse(raw);
  if (!parsed.success) return null;
  const edition = parsed.data;
  // A book first added on another instance keeps that instance's address.
  const url = httpsOn(edition.id, origin);
  if (!url) return null;
  const caption = edition.cover?.name ?? '';
  const at = caption.indexOf(`: ${edition.title}`);
  const author = at > 0 ? caption.slice(0, at).trim() : undefined;
  const cover = httpsOn(edition.cover?.url, origin);
  const description = edition.description ? htmlToText(edition.description) : '';
  const isbn = isbnOf(edition.isbn13) ?? isbnOf(edition.isbn10);
  return {
    url,
    title: edition.title,
    ...(author ? { author } : {}),
    ...(cover ? { cover } : {}),
    ...(description ? { description } : {}),
    ...(edition.openlibraryKey?.endsWith('M') ? { openLibrary: edition.openlibraryKey } : {}),
    ...(isbn ? { isbn } : {}),
  };
}

const decodeXml = (text: string) =>
  text
    .replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code: string) => {
      const point = code[0] === 'x' || code[0] === 'X' ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/&amp;/g, '&');

const tag = (item: string, name: string) =>
  decodeXml(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(item)?.[1] ?? '');

/**
 * The books of a shelf's RSS feed, newest first. An item's title is `Authors: Title`; its
 * description starts `‘Title’ by Authors` and lists the ISBN.
 */
export function parseShelfRss(xml: string, origin: string): ShelvedBook[] {
  const books: ShelvedBook[] = [];
  for (const [, item = ''] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const link = httpsOn(tag(item, 'link').trim(), origin);
    const path = link ? /^(\/book\/\d+)/.exec(new URL(link).pathname)?.[1] : undefined;
    if (!link || !path) continue;
    const heading = tag(item, 'title').trim();
    const text = htmlToText(tag(item, 'description'));
    const by = /’\s+by\s+(.+)/.exec(text)?.[1]?.trim();
    const title =
      by && heading.startsWith(`${by}: `) ? heading.slice(by.length + 2).trim() : heading;
    if (!title) continue;
    const isbn = isbnOf(/ISBN 13:\s*([\dX-]+)/i.exec(text)?.[1]);
    books.push({
      url: `${new URL(link).origin}${path}`,
      title,
      ...(by ? { author: by } : {}),
      ...(isbn ? { isbn } : {}),
    });
  }
  return books;
}

const shelfPath = (account: Account, shelf: Shelf) =>
  `${account.instance}/user/${encodeURIComponent(account.user)}/books/${shelf}`;

const JSON_ACCEPT = 'application/activity+json, application/json';
const RSS_ACCEPT = 'application/rss+xml, application/xml, text/xml';

export type ShelfPage = {
  books: ShelvedBook[];
  /** How many books a JSON page holds, to find the page for a `skip`; null from RSS. */
  pageSize: number | null;
  hasMore: boolean;
};

/**
 * Why a shelf can't be read: `hidden` when the instance answers 404 (a private shelf, a private
 * profile or no such user), `refused` when it turns the request away.
 */
export class ShelfUnavailable extends Error {
  constructor(readonly reason: 'hidden' | 'refused') {
    super(`Shelf ${reason}`);
  }
}

async function jsonPage(
  instance: Instance,
  account: Account,
  shelf: Shelf,
  page: number,
): Promise<ShelfPage | 'signed'> {
  const answer = await instance.get(
    `${shelfPath(account, shelf)}.json?page=${page}`,
    JSON_ACCEPT,
    SHELF_TTL,
  );
  // “Require signed GET” answers 403 to every unsigned JSON request.
  if (answer.status === 403 || answer.status === 401) return 'signed';
  if (answer.status === 404 || answer.status === 410) throw new ShelfUnavailable('hidden');
  if (answer.status !== 200) throw new AddonError(502, `BookWyrm answered ${answer.status}`);
  let data: unknown;
  try {
    data = JSON.parse(answer.text);
  } catch {
    // An HTML page instead of JSON: an instance in front of a login or a challenge.
    return 'signed';
  }
  const parsed = PageJson.safeParse(data);
  if (!parsed.success) {
    // Page 1 of an empty shelf is the collection itself, without items.
    if (ShelfJson.safeParse(data).success) return { books: [], pageSize: null, hasMore: false };
    throw new AddonError(502, 'BookWyrm answered a shelf in an unknown form');
  }
  const books = parsed.data.orderedItems.flatMap((raw) => {
    const book = editionOf(raw, account.instance);
    return book ? [book] : [];
  });
  return {
    books,
    pageSize: parsed.data.orderedItems.length || null,
    hasMore: Boolean(parsed.data.next),
  };
}

async function rssShelf(instance: Instance, account: Account, shelf: Shelf): Promise<ShelfPage> {
  const answer = await instance.get(`${shelfPath(account, shelf)}/rss`, RSS_ACCEPT, SHELF_TTL);
  if (answer.status === 404 || answer.status === 410) throw new ShelfUnavailable('hidden');
  if (answer.status === 403 || answer.status === 401) throw new ShelfUnavailable('refused');
  if (answer.status !== 200) throw new AddonError(502, `BookWyrm answered ${answer.status}`);
  return { books: parseShelfRss(answer.text, account.instance), pageSize: null, hasMore: false };
}

/**
 * The books from `skip` on, from one page of the shelf. JSON pages are as long as the instance's
 * own page length, learnt from page 1. RSS has the newest books only, with no further pages.
 */
export async function readShelf(
  instance: Instance,
  account: Account,
  shelf: Shelf,
  skip = 0,
): Promise<ShelfPage> {
  const first = await jsonPage(instance, account, shelf, 1);
  if (first === 'signed') {
    if (skip > 0) return { books: [], pageSize: null, hasMore: false };
    return rssShelf(instance, account, shelf);
  }
  const size = first.pageSize;
  if (skip === 0) return first;
  if (!size || !first.hasMore) return { ...first, books: first.books.slice(skip), hasMore: false };
  const number = Math.floor(skip / size) + 1;
  const page = await jsonPage(instance, account, shelf, number);
  if (page === 'signed') return { books: [], pageSize: size, hasMore: false };
  return { ...page, books: page.books.slice(skip % size) };
}

/** Whether the instance knows the user, through WebFinger (allowed even with signed GET on). */
export async function userExists(instance: Instance, account: Account): Promise<boolean> {
  const host = new URL(account.instance).host;
  const resource = encodeURIComponent(`acct:${account.user}@${host}`);
  const answer = await instance.get(
    `${account.instance}/.well-known/webfinger?resource=${resource}`,
    'application/jrd+json, application/json',
    SHELF_TTL,
  );
  if (answer.status === 404 || answer.status === 410) return false;
  if (answer.status === 403)
    throw new AddonError(400, `${host} turns away requests from outside apps.`);
  if (answer.status !== 200)
    throw new AddonError(400, `${host} answered ${answer.status}; is it a BookWyrm instance?`);
  try {
    const data = JSON.parse(answer.text) as { subject?: unknown };
    return typeof data.subject === 'string';
  } catch {
    throw new AddonError(400, `${host} doesn’t answer like a BookWyrm instance.`);
  }
}

/** A book's own JSON, or null when the instance refuses or doesn't have it. */
export async function readBook(
  instance: Instance,
  account: Account,
  path: string,
): Promise<ShelvedBook | null> {
  try {
    const answer = await instance.get(`${account.instance}${path}.json`, JSON_ACCEPT, BOOK_TTL);
    if (answer.status !== 200) return null;
    return editionOf(JSON.parse(answer.text), account.instance);
  } catch {
    return null;
  }
}
