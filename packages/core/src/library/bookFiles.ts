import { and, asc, eq, isNull } from 'drizzle-orm';

import type { Db } from '../db';
import { bookFiles, books } from '../schema';
import { bookChapters, chaptersOf } from './ownChapters';
import { chapterAt } from './timeline';

/** The files of a book that are on disk, in play order. */
export function presentFiles(db: Db, bookId: string) {
  return db
    .select({
      location: bookFiles.location,
      durationMs: bookFiles.durationMs,
      uri: bookFiles.uri,
      title: bookFiles.title,
      name: bookFiles.name,
      downloadPath: bookFiles.downloadPath,
      rootId: bookFiles.rootId,
    })
    .from(bookFiles)
    .where(and(eq(bookFiles.bookId, bookId), isNull(bookFiles.missingSince)))
    .orderBy(asc(bookFiles.idx))
    .all();
}

/**
 * The book that now holds `fileLocation` when `bookId` is gone because a rescan regrouped its
 * files; null while the book is still there or no present file is at that location.
 */
export function regroupedBook(db: Db, bookId: string, fileLocation: string): string | null {
  if (db.select({ id: books.id }).from(books).where(eq(books.id, bookId)).get()) return null;
  const file = db
    .select({ bookId: bookFiles.bookId })
    .from(bookFiles)
    .where(and(eq(bookFiles.location, fileLocation), isNull(bookFiles.missingSince)))
    .get();
  return file?.bookId ?? null;
}

/**
 * The title of the chapter at a place in the book; null for a book with one chapter or none.
 * With `profileId`, that profile's own chapters (M85) count when it has them.
 */
export function chapterTitleAt(
  db: Db,
  bookId: string,
  bookPositionMs: number,
  profileId?: string,
): string | null {
  const list =
    profileId === undefined ? bookChapters(db, bookId) : chaptersOf(db, profileId, bookId);
  if (list.length < 2) return null;
  return list[chapterAt(list, bookPositionMs)]?.title ?? null;
}
