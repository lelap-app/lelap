import { gt, max, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { bookChanges } from '../schema';
import { type LibraryBook, listAllBooks, listBooksById } from './queries';

// A Library that rereads only the books that changed (M126). Triggers note each book whose row a
// list shows changes: the book itself, a profile's place or entry, its download, hiding it and a
// link with a catalog (by the book's location). Triggers rather than every writer saying what it
// touched, so a scan, sync's apply or a writer added later can't leave a stale row. Writers must
// not use `insert or replace` on these tables: the row it removes fires no trigger.

// Tables keyed by book id; `hidden_books` and `work_links` are keyed by the book's location.
const BY_ID = ['books', 'progress', 'library_entries', 'downloads'] as const;
const BY_KEY = ['hidden_books', 'work_links'] as const;

function triggerSql(table: string, event: 'insert' | 'update' | 'delete'): string {
  const rows = event === 'insert' ? ['new'] : event === 'delete' ? ['old'] : ['old', 'new'];
  const column = table === 'books' ? 'id' : 'book_id';
  // Delete, then insert, for a new `seq`: an `or replace` here would give way to the conflict
  // rule of an upsert that fired the trigger, and fail on the unique book id.
  const notes = rows.map((row) => {
    const ids = (BY_KEY as readonly string[]).includes(table)
      ? `select id from books where location = ${row}.book_key`
      : `select ${row}.${column}`;
    return `delete from book_changes where book_id in (${ids}); insert into book_changes (book_id) ${ids};`;
  });
  return `create trigger if not exists book_changes_${table}_${event} after ${event} on ${table} begin ${notes.join(' ')} end`;
}

const TABLES = [...BY_ID, ...BY_KEY];
const EVENTS = ['insert', 'update', 'delete'] as const;

/**
 * Drops the triggers, before migrations: those on other tables name `books`, so a migration that
 * rebuilds `books` (copy, drop, rename) would fail on them.
 */
export function unwatchBookChanges(db: Db): void {
  for (const table of TABLES) {
    for (const event of EVENTS)
      db.run(sql.raw(`drop trigger if exists book_changes_${table}_${event}`));
  }
}

/**
 * Creates the triggers that note changed books, after migrations (`migrateSafely`). In code
 * rather than a migration: drizzle-kit rebuilds a table to change it, which drops its triggers.
 */
export function watchBookChanges(db: Db): void {
  for (const table of TABLES) {
    for (const event of EVENTS) db.run(sql.raw(triggerSql(table, event)));
  }
}

/**
 * Forgets the changes of books that are gone, such as old podcast episodes. Only at start
 * (`migrateSafely`), before any reader has read: one that had would miss the book leaving.
 */
export function forgetGoneBooks(db: Db): void {
  db.run(sql`delete from book_changes where book_id not in (select id from books)`);
}

/** The latest change noted, 0 before any. */
export function latestBookChange(db: Db): number {
  return (
    db
      .select({ seq: max(bookChanges.seq) })
      .from(bookChanges)
      .get()?.seq ?? 0
  );
}

/** The books changed after `seq`, and the latest change. */
export function booksChangedSince(db: Db, seq: number): { ids: string[]; latest: number } {
  const rows = db
    .select({ seq: bookChanges.seq, bookId: bookChanges.bookId })
    .from(bookChanges)
    .where(gt(bookChanges.seq, seq))
    .all();
  let latest = seq;
  for (const row of rows) if (row.seq > latest) latest = row.seq;
  return { ids: rows.map((r) => r.bookId), latest };
}

// Past this many changed books (a scan, a first sync) one read of everything is quicker.
const WHOLE_READ_AT = 2_000;

export type LibraryBooks = {
  /**
   * `listAllBooks(db, profileId)`, reading again only the books that changed since the last
   * call. The same array while nothing changed, and the same objects for books that didn't.
   */
  read(profileId: string): LibraryBook[];
};

export function libraryBooks(db: Db): LibraryBooks {
  let profile: string | null = null;
  let seen = 0;
  let byId = new Map<string, LibraryBook>();
  let list: LibraryBook[] = [];

  const readAll = (profileId: string) => {
    watchBookChanges(db);
    seen = latestBookChange(db);
    list = listAllBooks(db, profileId);
    byId = new Map(list.map((b) => [b.id, b]));
    profile = profileId;
    return list;
  };

  return {
    read(profileId) {
      if (profile !== profileId) return readAll(profileId);
      const { ids, latest } = booksChangedSince(db, seen);
      if (ids.length === 0) return list;
      if (ids.length > WHOLE_READ_AT) return readAll(profileId);
      seen = latest;
      // Visible books only: one hidden, removed or gone missing from the table leaves the list.
      const fresh = new Map(listBooksById(db, profileId, ids).map((b) => [b.id, b]));
      for (const id of ids) {
        const book = fresh.get(id);
        if (book) byId.set(id, book);
        else byId.delete(id);
      }
      list = [...byId.values()];
      return list;
    },
  };
}
