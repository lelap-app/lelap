import {
  createWorkIndex,
  type Meta,
  normalizeIds,
  splitAuthors,
  titleKey,
  type WorkInfo,
} from '@lelap/sdk';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { workIds } from '../addons/sources';
import type { Db } from '../db';
import { bookFiles, books, type LinkedMeta, workLinks } from '../schema';

// “Your copy” (M56): which book in the listener's own library is the work on an add-on's page.
// Everything here reads this device's database and nothing else; no request leaves the phone,
// so matching tells no one what is in the library. A test guards that.

/** The work on a book's page, as the page knows it from the add-on's meta. */
export type LinkableWork = {
  type: string;
  id: string;
  title?: string | null;
  author?: string | null;
  externalIds?: Meta['externalIds'];
  /** Its number in its series. */
  series?: number | null;
};

/**
 * The library book that is this work. `linked`: confirmed by the listener or Match with catalog.
 * `id`: the same ISBN or ASIN, linked without asking. `offer`: the same title and author, shown as
 * “In your library?” until the listener says yes or no.
 */
export type YourCopy = {
  bookId: string;
  title: string;
  author: string | null;
  how: 'linked' | 'id' | 'offer';
};

const idsOf = (work: LinkableWork) => normalizeIds(workIds(work.id, work.externalIds));

/** The book's synced name; links are kept by it, so they match on every device. */
const keyOf = (db: Db, bookId: string) =>
  db.select({ location: books.location }).from(books).where(eq(books.id, bookId)).get()?.location ??
  null;

/** Stored links that name this work, by its own ID or any ID it shares. */
function linksOf(db: Db, work: LinkableWork) {
  const ids = new Set(idsOf(work));
  return db
    .select()
    .from(workLinks)
    .where(eq(workLinks.workType, work.type))
    .orderBy(asc(workLinks.updatedAt))
    .all()
    .filter((l) => l.workId === work.id || l.ids.some((id) => ids.has(id)));
}

type Candidate = { id: string; location: string; title: string; author: string | null };

/** Books from the phone's folder and the listener's servers that are there now. */
function libraryBooks(db: Db): Candidate[] {
  return db
    .select({ id: books.id, location: books.location, title: books.title, author: books.author })
    .from(books)
    .where(and(eq(books.source, 'local'), isNull(books.missingSince)))
    .all();
}

/**
 * What the library knows about each book, for the matcher: IDs from every file's tags, and the
 * title and author. Without any tags the title is a folder or file name, so names like
 * “Frank Herbert - Dune” are tried both ways round.
 */
function workInfo(db: Db, candidates: Candidate[]): (WorkInfo & { item: Candidate })[] {
  const files = new Map<string, { ids: Set<string>; tagged: boolean }>();
  for (const f of db
    .select({
      bookId: bookFiles.bookId,
      ids: bookFiles.ids,
      album: bookFiles.album,
      artist: bookFiles.artist,
      albumArtist: bookFiles.albumArtist,
    })
    .from(bookFiles)
    .where(and(isNotNull(bookFiles.bookId), isNotNull(bookFiles.rootId)))
    .all()) {
    if (!f.bookId) continue;
    const entry = files.get(f.bookId) ?? { ids: new Set<string>(), tagged: false };
    for (const id of f.ids ?? []) entry.ids.add(id);
    entry.tagged ||= f.album !== null || f.artist !== null || f.albumArtist !== null;
    files.set(f.bookId, entry);
  }
  return candidates.flatMap((book) => {
    const known = files.get(book.id);
    const ids = [...(known?.ids ?? [])];
    if (known?.tagged !== false) {
      return [{ item: book, ids, title: book.title, authors: splitAuthors(book.author) }];
    }
    // A number in the whole name (“02 - Dune”) still tells the series apart in each half.
    const series = titleKey(book.title).number;
    const names = [
      { item: book, ids, series, title: book.title, authors: splitAuthors(book.author) },
    ];
    const [left, right, ...rest] = book.title.split(/\s+[-–—]\s+/);
    if (left && right && rest.length === 0) {
      names.push(
        { item: book, ids, series, title: right, authors: [left] },
        { item: book, ids, series, title: left, authors: [right] },
        { item: book, ids, series, title: right, authors: splitAuthors(book.author) },
      );
    }
    return names;
  });
}

/**
 * The listener's own copy of a work, if the library has one, for the work's page. A link the
 * listener confirmed comes first; then a shared ISBN or ASIN; then the same title and author,
 * to be confirmed. Books the listener said are not this work are left out.
 */
export function findYourCopy(db: Db, work: LinkableWork): YourCopy | null {
  if (work.type !== 'audiobook') return null;
  // Per book, the newest stored word on this work decides: linked, or not this book.
  const said = new Map<string, 'linked' | 'rejected'>();
  for (const link of linksOf(db, work)) said.set(link.bookKey, link.state);
  const present = libraryBooks(db);
  const copy = (book: Candidate, how: YourCopy['how']): YourCopy => ({
    bookId: book.id,
    title: book.title,
    author: book.author,
    how,
  });

  const linked = present.find((b) => said.get(b.location) === 'linked');
  if (linked) return copy(linked, 'linked');

  // A book linked to another work is that work; it is neither offered nor linked here.
  const elsewhere = new Set(
    db
      .select({ bookKey: workLinks.bookKey })
      .from(workLinks)
      .where(eq(workLinks.state, 'linked'))
      .all()
      .map((l) => l.bookKey),
  );
  const index = createWorkIndex(
    workInfo(
      db,
      present.filter((b) => !said.has(b.location) && !elsewhere.has(b.location)),
    ),
  );
  const [best] = index.find({
    title: work.title ?? null,
    authors: splitAuthors(work.author),
    ids: idsOf(work),
    series: work.series ?? null,
  });
  if (!best) return null;
  return copy(best.item, best.strength === 'id' ? 'id' : 'offer');
}

function upsertLink(
  db: Db,
  bookKey: string,
  work: LinkableWork,
  state: 'linked' | 'rejected',
  meta: LinkedMeta | null,
  now: number,
): void {
  const values = { state, ids: idsOf(work), meta, updatedAt: now };
  db.insert(workLinks)
    .values({ bookKey, workType: work.type, workId: work.id, ...values })
    .onConflictDoUpdate({
      target: [workLinks.bookKey, workLinks.workType, workLinks.workId],
      set: values,
    })
    .run();
}

/** Turns a stored link into “not this book”, keeping the IDs it was stored with. */
function rejectStored(db: Db, bookKey: string, link: BookLink, now: number): void {
  db.update(workLinks)
    .set({ state: 'rejected', meta: null, updatedAt: now })
    .where(
      and(
        eq(workLinks.bookKey, bookKey),
        eq(workLinks.workType, link.workType),
        eq(workLinks.workId, link.workId),
      ),
    )
    .run();
}

/**
 * Remembers that a library book is this work. `meta` comes from Match with catalog…: the book
 * then shows the work's title, author and cover. A book is one work, so links to other works go.
 */
export function linkBook(
  db: Db,
  bookId: string,
  work: LinkableWork,
  now: number,
  meta: LinkedMeta | null = null,
): void {
  const bookKey = keyOf(db, bookId);
  if (!bookKey) return;
  db.transaction((tx) => {
    const ids = new Set(idsOf(work));
    for (const other of bookLinks(tx, bookId)) {
      if (other.workId === work.id || other.ids.some((id) => ids.has(id))) continue;
      rejectStored(tx, bookKey, other, now);
    }
    upsertLink(tx, bookKey, work, 'linked', meta, now);
  });
}

/**
 * “Not this book”, from the work's page: for a book that was offered, or to unlink the linked
 * copy. The page stops offering and linking this book for this work, also by a shared ISBN.
 */
export function rejectLink(db: Db, bookId: string, work: LinkableWork, now: number): void {
  const bookKey = keyOf(db, bookId);
  if (!bookKey) return;
  db.transaction((tx) => {
    const ids = new Set(idsOf(work));
    for (const link of bookLinks(tx, bookId)) {
      if (link.workId === work.id || link.ids.some((id) => ids.has(id))) {
        rejectStored(tx, bookKey, link, now);
      }
    }
    upsertLink(tx, bookKey, work, 'rejected', null, now);
  });
}

export type BookLink = {
  workType: string;
  workId: string;
  ids: string[];
  meta: LinkedMeta | null;
};

/** The works a library book is linked to. */
export function bookLinks(db: Db, bookId: string): BookLink[] {
  const bookKey = keyOf(db, bookId);
  if (!bookKey) return [];
  return db
    .select({
      workType: workLinks.workType,
      workId: workLinks.workId,
      ids: workLinks.ids,
      meta: workLinks.meta,
    })
    .from(workLinks)
    .where(and(eq(workLinks.bookKey, bookKey), eq(workLinks.state, 'linked')))
    .all();
}

/** Unlinks a library book from every work; its own title and cover come back. */
export function unlinkBook(db: Db, bookId: string, now: number): void {
  const bookKey = keyOf(db, bookId);
  if (!bookKey) return;
  for (const link of bookLinks(db, bookId)) rejectStored(db, bookKey, link, now);
}

/**
 * Title, author and cover from Match with catalog…, by book location; only for `keys` when given,
 * so reading one book doesn't read every link.
 */
export function linkedMetaByKey(db: Db, keys?: string[]): Map<string, LinkedMeta> {
  if (keys?.length === 0) return new Map();
  const rows = db
    .select({ bookKey: workLinks.bookKey, meta: workLinks.meta })
    .from(workLinks)
    .where(
      and(
        eq(workLinks.state, 'linked'),
        isNotNull(workLinks.meta),
        keys ? inArray(workLinks.bookKey, keys) : undefined,
      ),
    )
    .orderBy(asc(workLinks.updatedAt))
    .all();
  const out = new Map<string, LinkedMeta>();
  for (const row of rows) if (row.meta) out.set(row.bookKey, row.meta);
  return out;
}
