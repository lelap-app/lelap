import { and, count, eq, inArray, isNull, not, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { bookFiles, books, chapters, libraryRoots } from '../schema';
import { decidedMusic } from './hidden';
import { musicScore } from './music';

/**
 * Row IDs of library books that look like music to this profile (M77): single files the
 * listener has neither hidden nor kept, scored by `musicScore`. Only a suggestion; nothing is
 * hidden until the listener says so.
 */
export function musicSuggestions(db: Db, profileId: string): string[] {
  // Audiobookshelf only holds books; its items are never suggested.
  const bookRoots = new Set(
    db
      .select({ id: libraryRoots.id, remote: libraryRoots.remote })
      .from(libraryRoots)
      .all()
      .filter((r) => r.remote?.type === 'audiobookshelf')
      .map((r) => r.id),
  );
  // Books of one present file; a book of several parts is never suggested.
  const single = db
    .select({ bookId: bookFiles.bookId })
    .from(bookFiles)
    .where(isNull(bookFiles.missingSince))
    .groupBy(bookFiles.bookId)
    .having(sql`${count()} = 1`);
  const rows = db
    .select({
      id: books.id,
      rootId: books.rootId,
      title: books.title,
      durationMs: bookFiles.durationMs,
      name: bookFiles.name,
      album: bookFiles.album,
      kindTags: bookFiles.kindTags,
    })
    .from(books)
    .innerJoin(bookFiles, eq(bookFiles.bookId, books.id))
    .where(
      and(
        eq(books.source, 'local'),
        isNull(books.missingSince),
        isNull(bookFiles.missingSince),
        inArray(books.id, single),
        not(decidedMusic(profileId)),
        sql`not exists (select 1 from ${chapters} where ${chapters.bookId} = ${books.id})`,
      ),
    )
    .all();
  return rows
    .filter(
      (r) =>
        musicScore({
          fileCount: 1,
          durationMs: r.durationMs,
          chapterCount: 0,
          fileName: r.name,
          title: r.title,
          album: r.album,
          tags: r.kindTags,
          bookSource: r.rootId !== null && bookRoots.has(r.rootId),
        }).suggest,
    )
    .map((r) => r.id);
}
