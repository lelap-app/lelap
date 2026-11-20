import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, type SQL, sql } from 'drizzle-orm';

import type { Db } from '../db';
import {
  bookFiles,
  books,
  chapters,
  downloads,
  libraryEntries,
  progress,
  type StoredChapter,
} from '../schema';
import { presentFiles } from './bookFiles';
import { namedChapters } from './chapterNames';
import { compareNatural } from './files';
import { kidFilter } from '../kids';
import { linkedMetaByKey, linkedSeriesByKey } from './links';
import { notHidden, onlyHidden } from './hidden';
import { bookChapters, getOwnChapters } from './ownChapters';

export type LibraryBook = {
  id: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  /** For streamed books. */
  coverUrl: string | null;
  /** `feed`: a podcast episode. */
  source: 'local' | 'addon' | 'feed';
  /** A streamed book whose download finished. */
  downloaded: boolean;
  /** 0 while a part has no length yet (M152); `partsDone` then tells how far in. */
  durationMs: number;
  bookPositionMs: number;
  /**
   * For a book without a total: the share of its parts before the one playing, 0 to 1; null
   * when the book has a total or no place.
   */
  partsDone?: number | null;
  addedAt: number;
  finishedAt: number | null;
  lastPlayedAt: number | null;
  missing: boolean;
};

export type LibrarySort = 'recent' | 'title' | 'author';

/**
 * Which books a list reads (M77): every list leaves out the books the profile hid, except the
 * Library's Hidden view and lookups of one book (the player, a book's page).
 */
export type HiddenFilter = 'visible' | 'hidden' | 'all';

const hiddenWhere = (profileId: string, show: HiddenFilter): SQL | undefined =>
  show === 'visible' ? notHidden(profileId) : show === 'hidden' ? onlyHidden(profileId) : undefined;

// Only the columns a list shows: whole rows would parse every book's add-on JSON as well.
function selectBooks(
  db: Db,
  profileId: string,
  where?: SQL,
  show: HiddenFilter = 'visible',
): LibraryBook[] {
  const rows = db
    .select({
      id: books.id,
      location: books.location,
      title: books.title,
      author: books.author,
      coverPath: books.coverPath,
      coverUrl: books.coverUrl,
      source: books.source,
      durationMs: books.durationMs,
      addedAt: books.addedAt,
      missingSince: books.missingSince,
      bookPositionMs: progress.bookPositionMs,
      // Only for books without a total, so a library of measured books reads no extra rows.
      partsDone: sql<
        number | null
      >`CASE WHEN ${books.durationMs} = 0 AND ${progress.fileLocation} IS NOT NULL THEN (SELECT CAST(f.idx AS REAL) / (SELECT COUNT(*) FROM ${bookFiles} c WHERE c.book_id = ${books.id} AND c.missing_since IS NULL) FROM ${bookFiles} f WHERE f.location = ${progress.fileLocation} AND f.book_id = ${books.id}) END`,
      finishedAt: libraryEntries.finishedAt,
      lastPlayedAt: libraryEntries.lastPlayedAt,
      downloadState: downloads.state,
    })
    .from(books)
    .leftJoin(progress, and(eq(progress.bookId, books.id), eq(progress.profileId, profileId)))
    .leftJoin(
      libraryEntries,
      and(eq(libraryEntries.bookId, books.id), eq(libraryEntries.profileId, profileId)),
    )
    .leftJoin(downloads, eq(downloads.bookId, books.id))
    .where(and(where, hiddenWhere(profileId, show)))
    .all();
  // A few books (one book's page, Continue listening) read only their own links.
  const linked = linkedMetaByKey(db, rows.length <= 50 ? rows.map((r) => r.location) : undefined);
  return rows.map(({ missingSince, downloadState, bookPositionMs, location, ...book }) => {
    // Matched with a catalog by hand: the work's title, author and cover replace the tags'.
    const meta = linked.get(location);
    return {
      ...book,
      ...(meta && { title: meta.title, author: meta.author ?? book.author }),
      ...(meta?.cover && { coverPath: null, coverUrl: meta.cover }),
      downloaded: downloadState === 'done',
      bookPositionMs: bookPositionMs ?? 0,
      partsDone: book.partsDone ?? null,
      missing: missingSince !== null,
    };
  });
}

/**
 * How far into a book, 0 to 1: by time once the book has a total, else by parts (M152), so a
 * book of unmeasured parts still shows progress.
 */
export function bookFraction(
  book: Pick<LibraryBook, 'durationMs' | 'bookPositionMs' | 'partsDone'>,
): number {
  if (book.durationMs > 0) return Math.min(1, book.bookPositionMs / book.durationMs);
  return Math.min(1, Math.max(0, book.partsDone ?? 0));
}

const byRecent = (a: LibraryBook, b: LibraryBook) =>
  (b.lastPlayedAt ?? -1) - (a.lastPlayedAt ?? -1) ||
  b.addedAt - a.addedAt ||
  compareNatural(a.title, b.title);

const SORTS: Record<LibrarySort, (a: LibraryBook, b: LibraryBook) => number> = {
  recent: byRecent,
  title: (a, b) => compareNatural(a.title, b.title),
  author: (a, b) =>
    compareNatural(a.author ?? '￿', b.author ?? '￿') || compareNatural(a.title, b.title),
};

/**
 * Every book and episode with this profile's progress, in no particular order; hidden books only
 * with `show: 'all'`.
 */
export function listAllBooks(
  db: Db,
  profileId: string,
  show: HiddenFilter = 'visible',
): LibraryBook[] {
  return selectBooks(db, profileId, undefined, show);
}

/**
 * The visible books and episodes with these ids, in no particular order: a list that plays reads
 * only its own items, not the whole library (M119).
 */
export function listBooksById(db: Db, profileId: string, ids: readonly string[]): LibraryBook[] {
  const unique = [...new Set(ids)];
  const found: LibraryBook[] = [];
  // Within SQLite's limit on bound values, for a very long list.
  for (let at = 0; at < unique.length; at += 500) {
    found.push(...selectBooks(db, profileId, inArray(books.id, unique.slice(at, at + 500))));
  }
  return found;
}

/**
 * Books in the Library; podcast episodes are listed under their podcast instead. `show: 'hidden'`
 * is the Hidden view.
 */
export function listBooks(
  db: Db,
  profileId: string,
  sort: LibrarySort,
  show: Exclude<HiddenFilter, 'all'> = 'visible',
): LibraryBook[] {
  const kid = kidFilter<LibraryBook>(db, profileId);
  const shown = selectBooks(db, profileId, ne(books.source, 'feed'), show);
  return (kid === null ? shown : shown.filter(kid)).sort(SORTS[sort]);
}

/**
 * `listBooks` with the visible books taken from `listAllBooks`, so a screen that needs both reads
 * the library once (M106).
 */
export function listBooksFrom(
  db: Db,
  profileId: string,
  all: LibraryBook[],
  sort: LibrarySort,
): LibraryBook[] {
  const kid = kidFilter<LibraryBook>(db, profileId);
  return all.filter((b) => b.source !== 'feed' && (kid === null || kid(b))).sort(SORTS[sort]);
}

/** The latest played book that is neither finished nor missing. */
export function continueListening(db: Db, profileId: string): LibraryBook | null {
  const kid = kidFilter<LibraryBook>(db, profileId);
  // Started books only, through the index on when they were last played, instead of every book.
  const started = db
    .select({ bookId: libraryEntries.bookId })
    .from(libraryEntries)
    .innerJoin(books, eq(books.id, libraryEntries.bookId))
    .where(
      and(
        eq(libraryEntries.profileId, profileId),
        isNotNull(libraryEntries.lastPlayedAt),
        isNull(libraryEntries.finishedAt),
        isNull(books.missingSince),
        notHidden(profileId),
      ),
    )
    .orderBy(desc(libraryEntries.lastPlayedAt), desc(books.addedAt))
    .all()
    .map((r) => r.bookId);
  // A kids profile may not see the first ones, so look further in small steps.
  for (let i = 0; i < started.length; i += 50) {
    const chunk = selectBooks(db, profileId, inArray(books.id, started.slice(i, i + 50)));
    const [first] = (kid === null ? chunk : chunk.filter(kid)).sort(byRecent);
    if (first) return first;
  }
  return null;
}

export type BookDetail = {
  book: LibraryBook;
  files: ReturnType<typeof presentFiles>;
  /** Ready to show: untitled ones are named in the profile's language (M99). */
  chapters: StoredChapter[];
  /** The chapters are the listener's own, edited by hand (M85), and may be reset. */
  ownChapters: boolean;
  /** The chapters were found from silences on this device, and the listener may remove them. */
  foundChapters: boolean;
  speed: number;
  /** From the first file's tags: a narrator tag, or what a server says (M65). */
  narrator: string | null;
  /**
   * The book's series as `Dune #1, Dune Chronicles #1`: from the work it was matched with, else
   * from a server, its tags or its add-on (M65, M109).
   */
  series: string | null;
  /** What the book is about and its language, as its server or add-on says (M135). */
  description: string | null;
  language: string | null;
};

export function getBook(db: Db, profileId: string, bookId: string): BookDetail | null {
  // A hidden book still opens and plays.
  const [book] = selectBooks(db, profileId, eq(books.id, bookId), 'all');
  if (!book) return null;
  const entry = db
    .select({ speed: libraryEntries.speed })
    .from(libraryEntries)
    .where(and(eq(libraryEntries.profileId, profileId), eq(libraryEntries.bookId, bookId)))
    .get();
  const list = bookChapters(db, bookId);
  const own = getOwnChapters(db, profileId, bookId);
  const first = db
    .select({ kindTags: bookFiles.kindTags })
    .from(bookFiles)
    .where(and(eq(bookFiles.bookId, bookId), isNull(bookFiles.missingSince)))
    .orderBy(asc(bookFiles.idx))
    .limit(1)
    .get();
  // A song's composer is no narrator.
  const music = first?.kindTags?.mediaKind === 'music';
  return {
    book,
    files: presentFiles(db, bookId),
    chapters: namedChapters(own ?? list).map(({ title, startMs }) => ({ title, startMs })),
    ownChapters: own !== null,
    foundChapters: own === null && list.length > 0 && list.every((c) => c.found),
    speed: entry?.speed ?? 1,
    narrator: (!music && first?.kindTags?.narrator?.trim()) || null,
    series: linkedSeries(db, bookId) ?? (first?.kindTags?.series?.trim() || null),
    description: first?.kindTags?.description?.trim() || null,
    language: first?.kindTags?.language?.trim() || null,
  };
}

function linkedSeries(db: Db, bookId: string): string | null {
  const location = db
    .select({ location: books.location })
    .from(books)
    .where(eq(books.id, bookId))
    .get()?.location;
  return (location && linkedSeriesByKey(db, [location]).get(location)) || null;
}

/**
 * Stores chapters found from silences, only while the book has no chapters at all: found ones
 * never replace chapters from tags, a feed or an add-on. Returns whether they were stored.
 */
export function saveFoundChapters(
  db: Db,
  bookId: string,
  list: StoredChapter[],
  now: number,
  newId: () => string,
): boolean {
  if (list.length === 0) return false;
  return db.transaction((tx) => {
    if (!tx.select({ id: books.id }).from(books).where(eq(books.id, bookId)).get()) return false;
    if (tx.select({ id: chapters.id }).from(chapters).where(eq(chapters.bookId, bookId)).get()) {
      return false;
    }
    tx.insert(chapters)
      .values(
        list.map((c, idx) => ({
          id: newId(),
          bookId,
          idx,
          title: c.title,
          startMs: c.startMs,
          found: true,
          updatedAt: now,
        })),
      )
      .run();
    return true;
  });
}

/** Removes the chapters found from silences; chapters from anywhere else stay. */
export function removeFoundChapters(db: Db, bookId: string): void {
  db.delete(chapters)
    .where(and(eq(chapters.bookId, bookId), eq(chapters.found, true)))
    .run();
}

function upsertEntry(
  db: Db,
  profileId: string,
  bookId: string,
  set: { speed?: number; finishedAt?: number | null },
  now: number,
): void {
  db.insert(libraryEntries)
    .values({ profileId, bookId, ...set, updatedAt: now })
    .onConflictDoUpdate({
      target: [libraryEntries.profileId, libraryEntries.bookId],
      set: { ...set, updatedAt: now },
    })
    .run();
}

export function setSpeed(
  db: Db,
  profileId: string,
  bookId: string,
  speed: number,
  now: number,
): void {
  upsertEntry(db, profileId, bookId, { speed }, now);
}

/** Marks a book finished (at `at`, for imports of older marks) or not finished. */
export function setFinished(
  db: Db,
  profileId: string,
  bookId: string,
  finished: boolean,
  now: number,
  at = now,
): void {
  upsertEntry(db, profileId, bookId, { finishedAt: finished ? at : null }, now);
}
