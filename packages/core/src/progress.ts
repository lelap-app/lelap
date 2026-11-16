import { and, eq } from 'drizzle-orm';

import type { Db } from './db';
import { presentFiles } from './library/bookFiles';
import { type FilePosition, toBookPosition, toFilePosition } from './library/timeline';
import { books, libraryEntries, progress } from './schema';

/** A saved place, from the app or from the playback service's journal. */
export type JournalEntry = {
  bookId: string;
  fileLocation: string;
  filePositionMs: number;
  savedAt: number;
};

/** Stores a place unless a newer one is already stored. Returns whether it was written. */
export function saveProgress(db: Db, profileId: string, entry: JournalEntry): boolean {
  return db.transaction((tx) => {
    const book = tx.select({ id: books.id }).from(books).where(eq(books.id, entry.bookId)).get();
    if (!book) return false;

    const key = and(eq(progress.profileId, profileId), eq(progress.bookId, entry.bookId));
    const stored = tx.select({ updatedAt: progress.updatedAt }).from(progress).where(key).get();
    if (stored && stored.updatedAt >= entry.savedAt) return false;

    const bookPositionMs = toBookPosition(
      presentFiles(tx, entry.bookId),
      entry.fileLocation,
      entry.filePositionMs,
    );
    const values = {
      fileLocation: entry.fileLocation,
      filePositionMs: Math.max(0, entry.filePositionMs),
      bookPositionMs,
      updatedAt: entry.savedAt,
    };
    tx.insert(progress)
      .values({ profileId, bookId: entry.bookId, ...values })
      .onConflictDoUpdate({ target: [progress.profileId, progress.bookId], set: values })
      .run();
    tx.insert(libraryEntries)
      .values({
        profileId,
        bookId: entry.bookId,
        lastPlayedAt: entry.savedAt,
        updatedAt: entry.savedAt,
      })
      .onConflictDoUpdate({
        target: [libraryEntries.profileId, libraryEntries.bookId],
        set: { lastPlayedAt: entry.savedAt, updatedAt: entry.savedAt },
      })
      .run();
    return true;
  });
}

/** Where to start a book: the saved file if it is still part of it, else the saved book offset. */
export function resumePoint(db: Db, profileId: string, bookId: string): FilePosition {
  const files = presentFiles(db, bookId);
  const stored = db
    .select()
    .from(progress)
    .where(and(eq(progress.profileId, profileId), eq(progress.bookId, bookId)))
    .get();
  if (!stored) return toFilePosition(files, 0);

  const index = files.findIndex((f) => f.location === stored.fileLocation);
  if (index >= 0)
    return { index, location: stored.fileLocation, positionMs: stored.filePositionMs };
  return toFilePosition(files, stored.bookPositionMs);
}
