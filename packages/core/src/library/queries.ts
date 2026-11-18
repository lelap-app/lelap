import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, type SQL } from 'drizzle-orm';

import type { Db } from '../db';
import {
  books,
  chapters,
  downloads,
  libraryEntries,
  progress,
  type StoredChapter,
} from '../schema';
import { presentFiles } from './bookFiles';
import { compareNatural } from './files';
import { kidFilter } from '../kids';
import { linkedMetaByKey } from './links';

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
  durationMs: number;
  bookPositionMs: number;
  addedAt: number;
  finishedAt: number | null;
  lastPlayedAt: number | null;
  missing: boolean;
};

export type LibrarySort = 'recent' | 'title' | 'author';

// Only the columns a list shows: whole rows would parse every book's add-on JSON as well.
function selectBooks(db: Db, profileId: string, where?: SQL): LibraryBook[] {
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
    .where(where)
    .all();
  const linked = linkedMetaByKey(db);
  return rows.map(({ missingSince, downloadState, bookPositionMs, location, ...book }) => {
    // Matched with a catalog by hand: the work's title, author and cover replace the tags'.
    const meta = linked.get(location);
    return {
      ...book,
      ...(meta && { title: meta.title, author: meta.author ?? book.author }),
      ...(meta?.cover && { coverPath: null, coverUrl: meta.cover }),
      downloaded: downloadState === 'done',
      bookPositionMs: bookPositionMs ?? 0,
      missing: missingSince !== null,
    };
  });
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

/** Every book and episode with this profile's progress, in no particular order. */
export function listAllBooks(db: Db, profileId: string): LibraryBook[] {
  return selectBooks(db, profileId);
}

/** Books in the Library; podcast episodes are listed under their podcast instead. */
export function listBooks(db: Db, profileId: string, sort: LibrarySort): LibraryBook[] {
  const kid = kidFilter<LibraryBook>(db, profileId);
  const shown = selectBooks(db, profileId, ne(books.source, 'feed'));
  return (kid === null ? shown : shown.filter(kid)).sort(SORTS[sort]);
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
  chapters: StoredChapter[];
  /** The chapters were found from silences on this device, and the listener may remove them. */
  foundChapters: boolean;
  speed: number;
};

export function getBook(db: Db, profileId: string, bookId: string): BookDetail | null {
  const [book] = selectBooks(db, profileId, eq(books.id, bookId));
  if (!book) return null;
  const entry = db
    .select({ speed: libraryEntries.speed })
    .from(libraryEntries)
    .where(and(eq(libraryEntries.profileId, profileId), eq(libraryEntries.bookId, bookId)))
    .get();
  const list = db
    .select({ title: chapters.title, startMs: chapters.startMs, found: chapters.found })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(asc(chapters.idx))
    .all();
  return {
    book,
    files: presentFiles(db, bookId),
    chapters: list.map(({ title, startMs }) => ({ title, startMs })),
    foundChapters: list.length > 0 && list.every((c) => c.found),
    speed: entry?.speed ?? 1,
  };
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
