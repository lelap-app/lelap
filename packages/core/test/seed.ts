import type { Db } from '../src/db';
import { bookFiles, books, libraryRoots } from '../src/schema';
import { ROOT } from './files';

let counter = 0;
const id = (prefix: string) => `${prefix}-${++counter}`;

/** Inserts a book with the given files under one test root, and returns its ID. */
export function seedBook(
  db: Db,
  location: string,
  files: { location: string; durationMs: number }[],
): string {
  const rootId = 'root';
  db.insert(libraryRoots)
    .values({
      id: rootId,
      uri: 'content://root',
      name: 'Audiobooks',
      location: ROOT,
      addedAt: 0,
      updatedAt: 0,
    })
    .onConflictDoNothing()
    .run();
  const bookId = id('book');
  db.insert(books)
    .values({
      id: bookId,
      rootId,
      location,
      kind: 'folder',
      title: location,
      author: null,
      coverPath: null,
      durationMs: files.reduce((sum, f) => sum + f.durationMs, 0),
      addedAt: 0,
      updatedAt: 0,
    })
    .run();
  for (const [idx, file] of files.entries()) {
    db.insert(bookFiles)
      .values({
        id: id('file'),
        location: file.location,
        rootId,
        bookId,
        idx,
        uri: `content://${file.location}`,
        relPath: file.location,
        name: file.location,
        size: 1,
        modifiedAt: 1,
        durationMs: file.durationMs,
        chaptersJson: [],
        updatedAt: 0,
      })
      .run();
  }
  return bookId;
}
