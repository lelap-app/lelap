import { and, asc, eq, isNull } from 'drizzle-orm';

import type { Db } from '../db';
import { bookFiles } from '../schema';

/** The files of a book that are on disk, in play order. */
export function presentFiles(db: Db, bookId: string) {
  return db
    .select({
      location: bookFiles.location,
      durationMs: bookFiles.durationMs,
      uri: bookFiles.uri,
      title: bookFiles.title,
      name: bookFiles.name,
    })
    .from(bookFiles)
    .where(and(eq(bookFiles.bookId, bookId), isNull(bookFiles.missingSince)))
    .orderBy(asc(bookFiles.idx))
    .all();
}
