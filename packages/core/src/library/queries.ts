import { and, asc, eq } from 'drizzle-orm';

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

function selectBooks(db: Db, profileId: string, bookId?: string): LibraryBook[] {
  const rows = db
    .select({
      book: books,
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
    .where(bookId === undefined ? undefined : eq(books.id, bookId))
    .all();
  return rows.map(({ book, bookPositionMs, finishedAt, lastPlayedAt, downloadState }) => ({
    id: book.id,
    title: book.title,
    author: book.author,
    coverPath: book.coverPath,
    coverUrl: book.coverUrl,
    source: book.source,
    downloaded: downloadState === 'done',
    durationMs: book.durationMs,
    bookPositionMs: bookPositionMs ?? 0,
    addedAt: book.addedAt,
    finishedAt,
    lastPlayedAt,
    missing: book.missingSince !== null,
  }));
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

/** Books in the Library; podcast episodes are listed under their podcast instead. */
export function listBooks(db: Db, profileId: string, sort: LibrarySort): LibraryBook[] {
  return selectBooks(db, profileId)
    .filter((b) => b.source !== 'feed')
    .sort(SORTS[sort]);
}

/** The latest played book that is neither finished nor missing. */
export function continueListening(db: Db, profileId: string): LibraryBook | null {
  return (
    selectBooks(db, profileId)
      .filter((b) => b.lastPlayedAt !== null && b.finishedAt === null && !b.missing)
      .sort(byRecent)[0] ?? null
  );
}

export type BookDetail = {
  book: LibraryBook;
  files: ReturnType<typeof presentFiles>;
  chapters: StoredChapter[];
  speed: number;
};

export function getBook(db: Db, profileId: string, bookId: string): BookDetail | null {
  const [book] = selectBooks(db, profileId, bookId);
  if (!book) return null;
  const entry = db
    .select({ speed: libraryEntries.speed })
    .from(libraryEntries)
    .where(and(eq(libraryEntries.profileId, profileId), eq(libraryEntries.bookId, bookId)))
    .get();
  return {
    book,
    files: presentFiles(db, bookId),
    chapters: db
      .select({ title: chapters.title, startMs: chapters.startMs })
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .orderBy(asc(chapters.idx))
      .all(),
    speed: entry?.speed ?? 1,
  };
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

export function setFinished(
  db: Db,
  profileId: string,
  bookId: string,
  finished: boolean,
  now: number,
): void {
  upsertEntry(db, profileId, bookId, { finishedAt: finished ? now : null }, now);
}
