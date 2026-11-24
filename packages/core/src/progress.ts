import { and, eq } from 'drizzle-orm';

import type { Db } from './db';
import { presentFiles } from './library/bookFiles';
import { noteFileChange } from './library/folderPodcast';
import { isLiveBook } from './live';
import { type FilePosition, toBookPosition, toFilePosition } from './library/timeline';
import { bookFiles, books, libraryEntries, progress } from './schema';

/** A saved place, from the app or from the playback service's journal. */
export type JournalEntry = {
  bookId: string;
  fileLocation: string;
  filePositionMs: number;
  savedAt: number;
};

/**
 * Where a saved place came from. The app saves what the player reports right now, so its saves
 * always win; the service's journal can lag the app by a tick, so it only wins when newer.
 */
export type ProgressOrigin = 'app' | 'journal';

/**
 * Stores a place. The place belongs to whichever book now holds its file, so a save for a book
 * that a rescan regrouped still lands. Returns whether it was written.
 */
export function saveProgress(
  db: Db,
  profileId: string,
  entry: JournalEntry,
  origin: ProgressOrigin = 'journal',
): boolean {
  return db.transaction((tx) => {
    const file = tx
      .select({ bookId: bookFiles.bookId, missingSince: bookFiles.missingSince })
      .from(bookFiles)
      .where(eq(bookFiles.location, entry.fileLocation))
      .get();
    const bookId =
      file?.bookId && file.missingSince === null
        ? file.bookId
        : tx.select({ id: books.id }).from(books).where(eq(books.id, entry.bookId)).get()?.id;
    if (!bookId) return false;
    // A live stream keeps no place, so it never shows up in Continue listening (M154).
    if (isLiveBook(tx, bookId)) return false;

    const key = and(eq(progress.profileId, profileId), eq(progress.bookId, bookId));
    const stored = tx
      .select({
        updatedAt: progress.updatedAt,
        bookPositionMs: progress.bookPositionMs,
        fileLocation: progress.fileLocation,
        filePositionMs: progress.filePositionMs,
      })
      .from(progress)
      .where(key)
      .get();
    if (origin === 'journal' && stored && stored.updatedAt >= entry.savedAt) return false;
    // An unchanged place keeps its time: a newer place synced from another device must win.
    if (
      stored &&
      stored.fileLocation === entry.fileLocation &&
      stored.filePositionMs === Math.max(0, entry.filePositionMs)
    ) {
      return false;
    }

    const files = presentFiles(tx, bookId);
    // A place in a missing file cannot be put on the book timeline; keep the last known offset.
    const bookPositionMs = files.some((f) => f.location === entry.fileLocation)
      ? toBookPosition(files, entry.fileLocation, entry.filePositionMs)
      : (stored?.bookPositionMs ?? 0);
    const values = {
      fileLocation: entry.fileLocation,
      filePositionMs: Math.max(0, entry.filePositionMs),
      bookPositionMs,
      updatedAt: entry.savedAt,
    };
    // A book shown as a podcast marks the file it left (M157).
    if (stored && stored.fileLocation !== entry.fileLocation) {
      noteFileChange(tx, profileId, bookId, stored, entry.fileLocation, origin, entry.savedAt);
    }
    tx.insert(progress)
      .values({ profileId, bookId, ...values })
      .onConflictDoUpdate({ target: [progress.profileId, progress.bookId], set: values })
      .run();
    tx.insert(libraryEntries)
      .values({ profileId, bookId, lastPlayedAt: entry.savedAt, updatedAt: entry.savedAt })
      .onConflictDoUpdate({
        target: [libraryEntries.profileId, libraryEntries.bookId],
        set: { lastPlayedAt: entry.savedAt, updatedAt: entry.savedAt },
      })
      .run();
    return true;
  });
}

/**
 * Where to start a book: the saved file if it is still part of it, else the saved book offset.
 * Null when none of the book's files is on disk.
 */
export function resumePoint(db: Db, profileId: string, bookId: string): FilePosition | null {
  const files = presentFiles(db, bookId);
  if (files.length === 0) return null;
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
