import { and, asc, eq, isNull } from 'drizzle-orm';

import type { Db } from '../db';
import { bookFiles, books } from '../schema';
import { chapterTitle } from './chapterNames';
import { bookChapters, getOwnChapters } from './ownChapters';
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
      ref: bookFiles.ref,
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
  const own = profileId === undefined ? null : getOwnChapters(db, profileId, bookId);
  const list = own ?? bookChapters(db, bookId);
  if (list.length < 2) return null;
  const at = chapterAt(list, bookPositionMs);
  const chapter = list[at];
  return chapter ? chapterTitle(chapter.title, at, chapter.found === true) : null;
}

/**
 * Keeps the length the player measured for a file stored without one, such as an add-on stream
 * that gave none, so the book's bar and timeline have a length (M140). A stored length stays.
 * Returns whether anything changed.
 */
export function learnFileDuration(db: Db, fileLocation: string, durationMs: number): boolean {
  if (!(durationMs > 0)) return false;
  const file = db
    .select({ id: bookFiles.id, bookId: bookFiles.bookId, durationMs: bookFiles.durationMs })
    .from(bookFiles)
    .where(eq(bookFiles.location, fileLocation))
    .get();
  const bookId = file?.bookId;
  if (!file || !bookId || file.durationMs > 0) return false;
  return db.transaction((tx) => {
    tx.update(bookFiles)
      .set({ durationMs: Math.round(durationMs) })
      .where(eq(bookFiles.id, file.id))
      .run();
    const total = tx
      .select({ durationMs: bookFiles.durationMs })
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), isNull(bookFiles.missingSince)))
      .all()
      .reduce((sum, f) => sum + Math.max(0, f.durationMs), 0);
    tx.update(books).set({ durationMs: total }).where(eq(books.id, bookId)).run();
    return true;
  });
}
