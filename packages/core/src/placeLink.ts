import { createWorkIndex, normalizeIds, splitAuthors } from '@lelap/sdk';
import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';

import type { Db } from './db';
import { isKidsProfile, shelfBookIds } from './kids';
import { bookFiles, books, episodes, podcasts, subscriptions, workLinks } from './schema';
import { bookIdForKey } from './sync/keys';

// A shared place (M85): a link that says which book and where in it, never the audio. It names
// the book by its title as the library shows it, a tagged or matched author, ISBN or ASIN and the
// catalog work, never a file path, and the one who opens it plays their own copy. A podcast
// episode (M88) is named by its show's public feed and the episode's guid instead.

/** A podcast episode: the feed it is in and its guid there. */
export type SharedEpisode = { feed: string; guid: string };

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
  /** Set for a podcast episode: `title` is the episode's and `author` the show's. */
  episode?: SharedEpisode;
};

/** A clip is at most this long. */
export const CLIP_MAX_MS = 5 * 60_000;
const TITLE_MAX = 300;
const IDS_MAX = 5;
const SHAREABLE_ID = /^(isbn|asin|ol):/;
const CATALOG_ID = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._-]{1,128}$/;
const FEED_MAX = 2048;
const GUID_MAX = 512;

// A path segment that looks like a subscriber's token: a UUID, or 20 or more letters and digits
// mixed. Public feeds name shows with short IDs or words.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const looksLikeToken = (segment: string) => {
  const name = segment.replace(/\.(xml|rss|atom)$/i, '');
  return (
    UUID.test(name) ||
    (/^[A-Za-z0-9_-]{20,}$/.test(name) && /\d/.test(name) && /[A-Za-z]/.test(name))
  );
};

/**
 * A feed address that may travel in a link: https or http, no login, no query and no path segment
 * that looks like a token, where private feeds keep their subscriber's key.
 */
export function isShareableFeed(url: string): boolean {
  if (url.length > FEED_MAX || !/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      !parsed.pathname.split('/').some(looksLikeToken)
    );
  } catch {
    return false;
  }
}

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
  if (place.episode) {
    params.set('f', place.episode.feed);
    params.set('g', place.episode.guid);
  }
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
  const feed = one(params.f)?.trim() ?? '';
  const guid = one(params.g)?.trim() ?? '';
  const episode =
    isShareableFeed(feed) && guid !== '' && guid.length <= GUID_MAX ? { feed, guid } : null;
  return { title, author, ids, work, atMs, toMs, ...(episode ? { episode } : {}) };
}

const clipEndOf = (atMs: number, toMs: number | null) =>
  toMs !== null && toMs > atMs ? Math.min(toMs, atMs + CLIP_MAX_MS) : null;

/**
 * What a link says about an episode: its show's feed and its guid. Null for a feed that looks
 * private, or an episode without a guid of its own.
 */
function placeOfEpisode(
  db: Db,
  bookId: string,
  atMs: number,
  toMs: number | null,
): SharedPlace | null {
  const row = db
    .select({
      title: episodes.title,
      guid: episodes.guid,
      url: episodes.url,
      show: podcasts.title,
      feed: podcasts.feedUrl,
    })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(eq(episodes.bookId, bookId))
    .get();
  if (!row || !isShareableFeed(row.feed) || row.guid.length > GUID_MAX) return null;
  // An item without a guid is kept by its audio's address, which must never travel in a link.
  if (row.guid === row.url) return null;
  return {
    title: row.title,
    author: row.show,
    ids: [],
    work: null,
    atMs: Math.max(0, atMs),
    toMs: clipEndOf(atMs, toMs),
    episode: { feed: row.feed, guid: row.guid },
  };
}

/**
 * What a link says about a book on this device. Null for a missing book, or an episode of a show
 * whose feed can't travel.
 */
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
  if (!book) return null;
  if (book.source === 'feed') return placeOfEpisode(db, bookId, atMs, toMs);
  const files = db
    .select({ ids: bookFiles.ids, artist: bookFiles.artist, albumArtist: bookFiles.albumArtist })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, bookId))
    .all();
  const fileIds = files.flatMap((f) => f.ids ?? []);
  const link = db
    .select({
      type: workLinks.workType,
      id: workLinks.workId,
      ids: workLinks.ids,
      meta: workLinks.meta,
    })
    .from(workLinks)
    .where(and(eq(workLinks.bookKey, book.location), eq(workLinks.state, 'linked')))
    .orderBy(desc(workLinks.updatedAt))
    .get();
  // An add-on's item ID can hold a server's path or settings; only a plain `prefix:id` travels.
  const item =
    book.addonItem && CATALOG_ID.test(book.addonItem.id)
      ? { type: book.addonItem.type, id: book.addonItem.id }
      : null;
  const work = link ? { type: link.type, id: link.id } : item;
  const ids = normalizeIds([...fileIds, ...(link?.ids ?? [])]).filter((id) =>
    SHAREABLE_ID.test(id),
  );
  // A folder book's author may be its parent folder's name: only a tagged or matched one goes.
  const tagged = new Set(files.flatMap((f) => [f.artist, f.albumArtist]));
  const author =
    link?.meta?.author ??
    (book.source !== 'local' || (book.author !== null && tagged.has(book.author))
      ? book.author
      : null);
  const clipEnd = clipEndOf(atMs, toMs);
  return {
    title: link?.meta?.title ?? book.title,
    author,
    ids: ids.slice(0, IDS_MAX),
    work,
    atMs: Math.max(0, atMs),
    toMs: clipEnd,
  };
}

/**
 * The listener's own copy of a shared book: one streamed from that work or linked to it, then one
 * with the same ISBN or ASIN, then one with the same title and author. Only this device's
 * database is read. A kids profile finds only the books on its shelf.
 */
export function findPlaceBook(db: Db, profileId: string, place: SharedPlace): string | null {
  const shelf = isKidsProfile(db, profileId) ? shelfBookIds(db, profileId) : null;
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
    .all()
    .filter((b) => shelf === null || shelf.has(b.id));
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

/** Where a shared episode stands on this device. */
export type PlaceEpisode =
  /** The episode is here: `bookId` is null until it was first played or downloaded. */
  | { kind: 'here'; episodeId: string; bookId: string | null }
  /**
   * The show is here, but this device's copy of its feed doesn't list the episode: it may be new
   * since the last refresh, or gone from the feed. `subscribed` is this profile's subscription.
   */
  | { kind: 'missing'; podcastId: string; subscribed: boolean }
  /** The show is not on this device: it can be subscribed to from the link's feed. */
  | { kind: 'unknown' };

/**
 * The listener's copy of a shared episode, by the feed and the guid. Only this device's database
 * is read. A kids profile finds only an episode on its shelf, and never follows a new show.
 */
export function findPlaceEpisode(
  db: Db,
  profileId: string,
  episode: SharedEpisode,
): PlaceEpisode | null {
  const kids = isKidsProfile(db, profileId);
  const podcast = db
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(eq(podcasts.feedUrl, episode.feed))
    .get();
  if (!podcast) return kids ? null : { kind: 'unknown' };
  const found = db
    .select({ id: episodes.id, bookId: episodes.bookId })
    .from(episodes)
    .where(and(eq(episodes.podcastId, podcast.id), eq(episodes.guid, episode.guid)))
    .get();
  if (kids) {
    const shelf = shelfBookIds(db, profileId);
    return found?.bookId && shelf.has(found.bookId)
      ? { kind: 'here', episodeId: found.id, bookId: found.bookId }
      : null;
  }
  if (!found) {
    const subscribed = db
      .select({ id: subscriptions.podcastId })
      .from(subscriptions)
      .where(and(eq(subscriptions.profileId, profileId), eq(subscriptions.podcastId, podcast.id)))
      .get();
    return { kind: 'missing', podcastId: podcast.id, subscribed: subscribed !== undefined };
  }
  return { kind: 'here', episodeId: found.id, bookId: found.bookId };
}
