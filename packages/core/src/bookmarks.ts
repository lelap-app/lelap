import { and, asc, eq } from 'drizzle-orm';

import type { Db } from './db';
import type { IdGenerator } from './ids';
import { presentFiles } from './library/bookFiles';
import { toBookPosition } from './library/timeline';
import { bookmarks } from './schema';

export type Bookmark = typeof bookmarks.$inferSelect;

export function addBookmark(
  db: Db,
  profileId: string,
  newId: IdGenerator,
  mark: {
    bookId: string;
    fileLocation: string;
    filePositionMs: number;
    note: string | null;
    now: number;
  },
): string {
  const id = newId();
  const bookPositionMs = toBookPosition(
    presentFiles(db, mark.bookId),
    mark.fileLocation,
    mark.filePositionMs,
  );
  db.insert(bookmarks)
    .values({
      id,
      profileId,
      bookId: mark.bookId,
      fileLocation: mark.fileLocation,
      filePositionMs: mark.filePositionMs,
      bookPositionMs,
      note: mark.note,
      createdAt: mark.now,
      updatedAt: mark.now,
    })
    .run();
  return id;
}

export function listBookmarks(db: Db, profileId: string, bookId: string): Bookmark[] {
  return db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.profileId, profileId), eq(bookmarks.bookId, bookId)))
    .orderBy(asc(bookmarks.bookPositionMs))
    .all();
}

export function deleteBookmark(db: Db, profileId: string, id: string): void {
  db.delete(bookmarks)
    .where(and(eq(bookmarks.profileId, profileId), eq(bookmarks.id, id)))
    .run();
}

/** Sets or clears (blank) a bookmark's note. */
export function setBookmarkNote(
  db: Db,
  profileId: string,
  id: string,
  note: string,
  now: number,
): void {
  const text = note.trim();
  db.update(bookmarks)
    .set({ note: text === '' ? null : text, updatedAt: now })
    .where(and(eq(bookmarks.profileId, profileId), eq(bookmarks.id, id)))
    .run();
}
