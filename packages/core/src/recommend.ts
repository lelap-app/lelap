import type { MetaPreview } from '@lelap/sdk';
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';

import {
  browseCatalogs,
  type CatalogRef,
  type InstalledAddon,
  WANT_TO_READ,
} from './addons/client';
import type { Db } from './db';
import { sameAuthor, titleKey } from './importers/match';
import { kidFilter } from './kids';
import { books, downloads, libraryEntries, listeningLog, progress } from './schema';

// “Because you finished …” rows on Home (M46). Everything here runs on the device: the catalogs
// it reads are the ones Home already loads, and nothing about the listener goes into a request.

/** A finished book a row is built around. */
export type Seed = {
  bookId: string;
  title: string;
  author: string | null;
  finishedAt: number;
  /** The add-on a streamed book came from. */
  addonUrl: string | null;
  /** From the metadata saved with a download, when there is one. */
  genres: string[];
};

/** An item from a catalog page Home already loaded. */
export type Candidate = { meta: MetaPreview; addonUrl: string };

/** What the library already has, so it is never suggested. */
export type Owned = {
  /** `type\nid` of streamed books. */
  keys: Set<string>;
  books: { title: string; author: string | null }[];
};

export type SuggestionRow = { because: { bookId: string; title: string }; items: MetaPreview[] };

export type RecommendInput = {
  /** Most recently finished first. */
  seeds: Seed[];
  candidates: Candidate[];
  owned: Owned;
  /** Listening time per author from the stats log, keyed by `authorKey`. */
  authorListening: Map<string, number>;
  maxRows?: number;
  perRow?: number;
};

// The few seeds that count: the books finished last.
const SEEDS = 5;
// What ties a suggestion to the finished book: the same author (6), two distinctive title words
// (2 each) or a genre and a title word (2 each). One shared word is not enough.
const MIN_LINK = 3;
const HOUR = 3_600_000;

// Words that say nothing about which book it is.
const STOP = new Set([
  'the',
  'and',
  'with',
  'from',
  'book',
  'volume',
  'part',
  'other',
  'stories',
  'tales',
  'collection',
  'complete',
  'unabridged',
  'dramatic',
  'reading',
  'version',
  'adventures',
  'adventure',
  'story',
  'history',
  'life',
  'works',
  'poems',
  'selected',
  'short',
]);
// Genres so broad that nearly every book has them.
const BROAD_GENRES = new Set(['fiction', 'nonfiction', 'literature', 'general', 'classics']);

const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Words long enough to mean something, such as “sherlock” and “holmes”. */
const words = (text: string) =>
  new Set(
    fold(text)
      .split(' ')
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );

/** The words of a name without initials or titles: “Sir Arthur Conan Doyle”, “H. G. Wells”. */
const nameWords = (author: string) =>
  new Set(
    fold(author)
      .split(' ')
      .filter((w) => w.length >= 2 && !['sir', 'dr', 'mr', 'mrs', 'jr'].includes(w)),
  );

/** An author's name folded so “Doyle, Arthur Conan” and “Arthur Conan Doyle” agree. */
export const authorKey = (author: string) => [...nameWords(author)].sort().join(' ');

const known = (author: string | null | undefined): author is string =>
  !!author && nameWords(author).size > 0;

/**
 * The same person: one name's words are all in the other's, so “Arthur Conan Doyle” and “Sir
 * Arthur Conan Doyle” agree, while “Charles Dickens” and “Charles Darwin” don't.
 */
function samePerson(a: string, b: string): boolean {
  const left = nameWords(a);
  const right = nameWords(b);
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  return small.size > 0 && [...small].every((w) => large.has(w));
}

const keyOf = (meta: { type: string; id: string }) => `${meta.type}\n${meta.id}`;
// The same work under another add-on's ID.
const workOf = (meta: MetaPreview) =>
  `${titleKey(meta.name)}\n${meta.author ? authorKey(meta.author) : ''}`;

function isOwned(meta: MetaPreview, owned: Owned): boolean {
  if (owned.keys.has(keyOf(meta))) return true;
  const title = titleKey(meta.name);
  return owned.books.some(
    (b) =>
      titleKey(b.title) === title &&
      (b.author === null || !meta.author || sameAuthor(b.author, meta.author)),
  );
}

function genreHits(genres: string[], text: Set<string>): number {
  return genres.filter((g) => {
    const genre = [...words(g)];
    // Every word must appear: “science fiction”, not any book that says “science”.
    return (
      genre.length > 0 &&
      !genre.every((w) => BROAD_GENRES.has(w)) &&
      genre.every((w) => text.has(w))
    );
  }).length;
}

/** How closely a candidate is tied to the seed, and how much to prefer it among those that are. */
function score(
  seed: Seed,
  candidate: Candidate,
  authorListening: Map<string, number>,
): { link: number; total: number } {
  const { meta } = candidate;
  let link = 0;
  if (known(seed.author) && known(meta.author) && samePerson(seed.author, meta.author)) link += 6;
  const title = words(meta.name);
  link += Math.min(4, 2 * [...words(seed.title)].filter((w) => title.has(w)).length);
  if (seed.genres.length > 0) {
    link += Math.min(
      4,
      2 * genreHits(seed.genres, words(`${meta.name} ${meta.description ?? ''}`)),
    );
  }
  let total = link;
  // Authors the profile spends hours with weigh more, up to 2 points at 10 hours.
  if (known(meta.author)) {
    total += Math.min(2, (authorListening.get(authorKey(meta.author)) ?? 0) / (5 * HOUR));
  }
  if (seed.addonUrl !== null && seed.addonUrl === candidate.addonUrl) total += 1;
  return { link, total };
}

/**
 * Rows of suggestions, one per recently finished book that has any. Pure: the same input gives
 * the same rows. Never suggests a book the library has or one shown in an earlier row.
 */
export function recommend(input: RecommendInput): SuggestionRow[] {
  const { seeds, owned, authorListening, maxRows = 2, perRow = 12 } = input;
  // The first copy of an item wins; catalogs often share books.
  const seen = new Set<string>();
  const candidates = input.candidates.filter((c) => {
    const keys = [keyOf(c.meta), workOf(c.meta)];
    if (c.meta.type !== 'audiobook' || keys.some((k) => seen.has(k)) || isOwned(c.meta, owned)) {
      return false;
    }
    for (const k of keys) seen.add(k);
    return true;
  });

  const shown = new Set<string>();
  const rows: SuggestionRow[] = [];
  for (const seed of seeds.slice(0, SEEDS)) {
    if (rows.length >= maxRows) break;
    const items = candidates
      .map((c, order) => ({ c, order, ...score(seed, c, authorListening) }))
      .filter((s) => s.link >= MIN_LINK && !shown.has(keyOf(s.c.meta)))
      .sort((a, b) => b.total - a.total || a.order - b.order)
      .slice(0, perRow)
      .map((s) => s.c.meta);
    if (items.length === 0) continue;
    for (const meta of items) shown.add(keyOf(meta));
    rows.push({ because: { bookId: seed.bookId, title: seed.title }, items });
  }
  return rows;
}

/**
 * The catalogs suggestions come from: the audiobook catalogs Home already shows as rows, read
 * with the same first-page request. It takes no profile, so no request can depend on one.
 */
export function recommendationCatalogs(addons: InstalledAddon[]): CatalogRef[] {
  return browseCatalogs(addons, ['audiobook']).filter((ref) => ref.catalog.shelf !== WANT_TO_READ);
}

/** The books this profile finished, last first, as far as a kids profile may see them. */
export function recommendationSeeds(db: Db, profileId: string): Seed[] {
  const rows = db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      source: books.source,
      addonItem: books.addonItem,
      finishedAt: libraryEntries.finishedAt,
      lastPlayedAt: libraryEntries.lastPlayedAt,
      bookPositionMs: progress.bookPositionMs,
      meta: downloads.meta,
    })
    .from(libraryEntries)
    .innerJoin(books, eq(books.id, libraryEntries.bookId))
    .leftJoin(progress, and(eq(progress.bookId, books.id), eq(progress.profileId, profileId)))
    .leftJoin(downloads, eq(downloads.bookId, books.id))
    .where(
      and(
        eq(libraryEntries.profileId, profileId),
        isNotNull(libraryEntries.finishedAt),
        ne(books.source, 'feed'),
      ),
    )
    .orderBy(desc(libraryEntries.finishedAt))
    .all();
  const kid = kidFilter<{
    id: string;
    source: string;
    lastPlayedAt: number | null;
    bookPositionMs: number;
  }>(db, profileId);
  return rows
    .filter((r) => kid === null || kid({ ...r, bookPositionMs: r.bookPositionMs ?? 0 }))
    .map((r) => ({
      bookId: r.id,
      title: r.title,
      author: r.author,
      finishedAt: r.finishedAt ?? 0,
      addonUrl: r.addonItem?.addonUrl ?? null,
      genres: r.meta?.genres ?? [],
    }));
}

/** Every book on this device, podcast episodes aside. */
export function ownedWorks(db: Db): Owned {
  const rows = db
    .select({ title: books.title, author: books.author, addonItem: books.addonItem })
    .from(books)
    .where(ne(books.source, 'feed'))
    .all();
  return {
    keys: new Set(rows.flatMap((r) => (r.addonItem ? [keyOf(r.addonItem)] : []))),
    books: rows.map((r) => ({ title: r.title, author: r.author })),
  };
}

/** This profile's listening time per author, from the stats log (M24). */
export function authorListening(db: Db, profileId: string): Map<string, number> {
  const rows = db
    .select({ ms: listeningLog.ms, author: books.author })
    .from(listeningLog)
    .innerJoin(books, eq(books.id, listeningLog.bookId))
    .where(eq(listeningLog.profileId, profileId))
    .all();
  const byAuthor = new Map<string, number>();
  for (const { ms, author } of rows) {
    if (!known(author)) continue;
    const key = authorKey(author);
    byAuthor.set(key, (byAuthor.get(key) ?? 0) + ms);
  }
  return byAuthor;
}

/** The items of the catalog pages Home loaded, with the add-on each came from. */
export function candidatesFrom(
  refs: CatalogRef[],
  pages: (MetaPreview[] | undefined)[],
): Candidate[] {
  return refs.flatMap((ref, i) =>
    (pages[i] ?? []).map((meta) => ({ meta, addonUrl: ref.addon.url })),
  );
}

/** This profile's rows from catalog items already on the device. Reads only the database. */
export function suggestionRows(
  db: Db,
  profileId: string,
  candidates: Candidate[],
): SuggestionRow[] {
  return recommend({
    seeds: recommendationSeeds(db, profileId),
    candidates,
    owned: ownedWorks(db),
    authorListening: authorListening(db, profileId),
  });
}
