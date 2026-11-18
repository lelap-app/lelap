import { createWorkIndex, normalizeIds, splitAuthors } from '@lelap/sdk';
import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';

import type { Db } from './db';
import { bookFiles, books, workLinks } from './schema';
import { bookIdForKey } from './sync/keys';

// A shared place (M85): a link that says which book and where in it, never the audio. It names
// the book by what anyone may know about it (title, author, ISBN or ASIN, the catalog work), not
// by its file or folder, and the one who opens it plays their own copy.

export type SharedPlace = {
  title: string;
  author: string | null;
  /** `isbn:…`, `asin:…` or `ol:…`, normalised. */
  ids: string[];
  /** The catalog work the book is, when known: its page can find a copy to stream. */
  work: { type: string; id: string } | null;
  atMs: number;
  /** The end of a short clip; null for a place alone. */
  toMs: number | null;
};

/** A clip is at most this long. */
export const CLIP_MAX_MS = 5 * 60_000;
const TITLE_MAX = 300;
const IDS_MAX = 5;
const SHAREABLE_ID = /^(isbn|asin|ol):/;

const seconds = (ms: number) => String(Math.max(0, Math.floor(ms / 1000)));

/** The link's query: short keys, times in whole seconds. */
export function placeQuery(place: SharedPlace): string {
  const params = new URLSearchParams();
  params.set('t', place.title.slice(0, TITLE_MAX));
  if (place.author) params.set('a', place.author.slice(0, TITLE_MAX));
  const ids = place.ids.filter((id) => SHAREABLE_ID.test(id)).slice(0, IDS_MAX);
  if (ids.length > 0) params.set('ids', ids.join(','));
  if (place.work) params.set('w', `${place.work.type}:${place.work.id}`);
  params.set('at', seconds(place.atMs));
  if (place.toMs !== null && place.toMs > place.atMs) params.set('to', seconds(place.toMs));
  return params.toString();
}

/** The link to share: `base` is the web app's address, which opens it in Lelap for anyone. */
export function placeUrl(base: string, place: SharedPlace): string {
  return `${base.replace(/\/$/, '')}/place?${placeQuery(place)}`;
}

const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

function wholeSeconds(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,7}$/.test(value)) return null;
  return Number(value) * 1000;
}

/** A link's place, checked: it came from anyone. Null when it names no book or no time. */
export function parsePlace(
  params: Record<string, string | string[] | undefined>,
): SharedPlace | null {
  const title = one(params.t)?.trim().slice(0, TITLE_MAX);
  const atMs = wholeSeconds(one(params.at));
  if (!title || atMs === null) return null;
  const author = one(params.a)?.trim().slice(0, TITLE_MAX) || null;
  const ids = normalizeIds((one(params.ids) ?? '').split(','))
    .filter((id) => SHAREABLE_ID.test(id))
    .slice(0, IDS_MAX);
  const w = one(params.w) ?? '';
  const colon = w.indexOf(':');
  const workType = w.slice(0, colon);
  const workId = w.slice(colon + 1);
  const work =
    colon > 0 &&
    /^[a-z][a-z0-9_-]{0,31}$/.test(workType) &&
    workId.length > 0 &&
    workId.length <= 512
      ? { type: workType, id: workId }
      : null;
  const to = wholeSeconds(one(params.to));
  const toMs = to !== null && to > atMs ? Math.min(to, atMs + CLIP_MAX_MS) : null;
  return { title, author, ids, work, atMs, toMs };
}

/** What a link says about a book on this device. Null for a podcast episode or a missing book. */
export function placeOfBook(
  db: Db,
  bookId: string,
  atMs: number,
  toMs: number | null = null,
): SharedPlace | null {
  const book = db
    .select({
      title: books.title,
      author: books.author,
      location: books.location,
      source: books.source,
      addonItem: books.addonItem,
    })
    .from(books)
    .where(eq(books.id, bookId))
    .get();
  if (!book || book.source === 'feed') return null;
  const fileIds = db
    .select({ ids: bookFiles.ids })
    .from(bookFiles)
    .where(and(eq(bookFiles.bookId, bookId), isNotNull(bookFiles.ids)))
    .all()
    .flatMap((f) => f.ids ?? []);
  const link = db
    .select({ type: workLinks.workType, id: workLinks.workId, ids: workLinks.ids })
    .from(workLinks)
    .where(and(eq(workLinks.bookKey, book.location), eq(workLinks.state, 'linked')))
    .orderBy(desc(workLinks.updatedAt))
    .get();
  const work = book.addonItem
    ? { type: book.addonItem.type, id: book.addonItem.id }
    : link
      ? { type: link.type, id: link.id }
      : null;
  const ids = normalizeIds([...fileIds, ...(link?.ids ?? [])]).filter((id) =>
    SHAREABLE_ID.test(id),
  );
  const clipEnd = toMs !== null && toMs > atMs ? Math.min(toMs, atMs + CLIP_MAX_MS) : null;
  return {
    title: book.title,
    author: book.author,
    ids: ids.slice(0, IDS_MAX),
    work,
    atMs: Math.max(0, atMs),
    toMs: clipEnd,
  };
}

/**
 * The listener's own copy of a shared book: one streamed from that work or linked to it, then one
 * with the same ISBN or ASIN, then one with the same title and author. Only this device's
 * database is read.
 */
export function findPlaceBook(db: Db, place: SharedPlace): string | null {
  const present = db
    .select({
      id: books.id,
      location: books.location,
      title: books.title,
      author: books.author,
      addonItem: books.addonItem,
    })
    .from(books)
    .where(and(ne(books.source, 'feed'), isNull(books.missingSince)))
    .all();
  const { work } = place;
  if (work) {
    const streamed = present.find(
      (b) => b.addonItem?.type === work.type && b.addonItem.id === work.id,
    );
    if (streamed) return streamed.id;
    const linked = db
      .select({ bookKey: workLinks.bookKey })
      .from(workLinks)
      .where(
        and(
          eq(workLinks.workType, work.type),
          eq(workLinks.workId, work.id),
          eq(workLinks.state, 'linked'),
        ),
      )
      .all()
      .map((l) => bookIdForKey(db, l.bookKey))
      .find((id): id is string => id !== null && present.some((b) => b.id === id));
    if (linked) return linked;
  }
  const ids = new Map<string, string[]>();
  for (const f of db
    .select({ bookId: bookFiles.bookId, ids: bookFiles.ids })
    .from(bookFiles)
    .where(
      and(isNotNull(bookFiles.bookId), isNotNull(bookFiles.ids), isNull(bookFiles.missingSince)),
    )
    .all()) {
    if (f.bookId) ids.set(f.bookId, [...(ids.get(f.bookId) ?? []), ...(f.ids ?? [])]);
  }
  const index = createWorkIndex(
    present.map((b) => ({
      item: b.id,
      title: b.title,
      authors: splitAuthors(b.author),
      ids: ids.get(b.id) ?? [],
    })),
  );
  const [best] = index.find({
    title: place.title,
    authors: splitAuthors(place.author),
    ids: place.ids,
  });
  return best?.item ?? null;
}
