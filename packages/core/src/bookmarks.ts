import { and, asc, desc, eq } from 'drizzle-orm';

import type { Db } from './db';
import type { IdGenerator } from './ids';
import { chapterTitleAt, presentFiles } from './library/bookFiles';
import { toBookPosition } from './library/timeline';
import { bookmarks, books } from './schema';
import { recordDeletion } from './sync/keys';

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

export function deleteBookmark(db: Db, profileId: string, id: string, now = Date.now()): void {
  db.delete(bookmarks)
    .where(and(eq(bookmarks.profileId, profileId), eq(bookmarks.id, id)))
    .run();
  recordDeletion(db, 'bookmark', id, profileId, now);
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

/** A bookmark with what the list of all bookmarks shows of its book (M85). */
export type BookmarkInBook = Bookmark & {
  book: {
    title: string;
    author: string | null;
    coverPath: string | null;
    coverUrl: string | null;
    source: 'local' | 'addon' | 'feed';
  };
  /** The chapter the bookmark is in, when the book has two or more. */
  chapter: string | null;
};

/** Every bookmark of a profile, across its books, newest first. */
export function listAllBookmarks(db: Db, profileId: string): BookmarkInBook[] {
  return db
    .select({
      mark: bookmarks,
      book: {
        title: books.title,
        author: books.author,
        coverPath: books.coverPath,
        coverUrl: books.coverUrl,
        source: books.source,
      },
    })
    .from(bookmarks)
    .innerJoin(books, eq(books.id, bookmarks.bookId))
    .where(eq(bookmarks.profileId, profileId))
    .orderBy(desc(bookmarks.createdAt), asc(bookmarks.id))
    .all()
    .map(({ mark, book }) => ({
      ...mark,
      book,
      chapter: chapterTitleAt(db, mark.bookId, mark.bookPositionMs, profileId),
    }));
}
