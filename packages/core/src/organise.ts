import { and, asc, eq } from 'drizzle-orm';

import type { Db } from './db';
import type { IdGenerator } from './ids';
import { listeningStatus } from './library/byProgress';
import { type LibraryBook, listAllBooks } from './library/queries';
import { bookTags, playlists, type SmartRule } from './schema';
import { isShelf } from './kids';
import { bookIdForKey, bookKey, recordDeletion } from './sync/keys';

// Tags, hand-made playlists and smart lists. Tags are free text per book and profile; a smart
// list is a saved rule over the library, so it never needs updating by hand.

/** A tag as stored: trimmed, single spaces, lower case, without a leading `#`. */
export function normalizeTag(text: string): string {
  return text.trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase();
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter((t) => t.length > 0))].sort();
}

export function getTags(db: Db, profileId: string, bookId: string): string[] {
  return (
    db
      .select({ tags: bookTags.tags })
      .from(bookTags)
      .where(and(eq(bookTags.profileId, profileId), eq(bookTags.bookId, bookId)))
      .get()?.tags ?? []
  );
}

/** Replaces a book's tags; an empty list stays as a row so the removal syncs. */
export function setTags(
  db: Db,
  profileId: string,
  bookId: string,
  tags: string[],
  now: number,
): void {
  const row = { tags: cleanTags(tags), updatedAt: now };
  db.insert(bookTags)
    .values({ profileId, bookId, ...row })
    .onConflictDoUpdate({ target: [bookTags.profileId, bookTags.bookId], set: row })
    .run();
}

/** Every tag this profile uses, most used first. */
export function listTags(db: Db, profileId: string): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of db
    .select({ tags: bookTags.tags })
    .from(bookTags)
    .where(eq(bookTags.profileId, profileId))
    .all()) {
    for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function tagsByBook(db: Db, profileId: string): Map<string, string[]> {
  return new Map(
    db
      .select({ bookId: bookTags.bookId, tags: bookTags.tags })
      .from(bookTags)
      .where(eq(bookTags.profileId, profileId))
      .all()
      .map((r) => [r.bookId, r.tags]),
  );
}

/** Whether a book belongs in a smart list. */
export function matchesRule(book: LibraryBook, tags: string[], rule: SmartRule): boolean {
  if (rule.tags?.some((t) => !tags.includes(normalizeTag(t)))) return false;
  if (rule.kind === 'book' && book.source === 'feed') return false;
  if (rule.kind === 'episode' && book.source !== 'feed') return false;
  if (rule.offline && !(book.source === 'local' || book.downloaded)) return false;
  if (
    rule.maxDurationMs !== undefined &&
    !(book.durationMs > 0 && book.durationMs <= rule.maxDurationMs)
  ) {
    return false;
  }
  if (rule.status && listeningStatus(book) !== rule.status) return false;
  return !book.missing;
}

/** Library books with a tag, newest played first. */
export function booksWithTag(db: Db, profileId: string, tag: string): LibraryBook[] {
  return smartBooks(readLibrary(db, profileId), { tags: [tag] });
}

const byRecent = (a: LibraryBook, b: LibraryBook) =>
  (b.lastPlayedAt ?? -1) - (a.lastPlayedAt ?? -1) || b.addedAt - a.addedAt;

/** Every book with its tags, read once for several lists. */
export type Library = { books: LibraryBook[]; tags: Map<string, string[]> };

export const readLibrary = (db: Db, profileId: string): Library => ({
  books: listAllBooks(db, profileId),
  tags: tagsByBook(db, profileId),
});

export function smartBooks(library: Library, rule: SmartRule): LibraryBook[] {
  return library.books
    .filter((b) => matchesRule(b, library.tags.get(b.id) ?? [], rule))
    .sort(byRecent);
}

export type Playlist = {
  id: string;
  name: string;
  /** Null for a hand-made list. */
  rule: SmartRule | null;
  /** Synced book keys, in order; empty for a smart list. */
  items: string[];
  /** Playing the list goes through finished items too, from their start (M112). */
  keepFinished: boolean;
  createdAt: number;
};

export function listPlaylists(db: Db, profileId: string): Playlist[] {
  return db
    .select({
      id: playlists.id,
      name: playlists.name,
      rule: playlists.rule,
      items: playlists.items,
      keepFinished: playlists.keepFinished,
      createdAt: playlists.createdAt,
    })
    .from(playlists)
    .where(eq(playlists.profileId, profileId))
    .orderBy(asc(playlists.createdAt))
    .all()
    .filter((p) => !isShelf(p.id));
}

export function getPlaylist(db: Db, profileId: string, id: string): Playlist | null {
  return listPlaylists(db, profileId).find((p) => p.id === id) ?? null;
}

export function createPlaylist(
  db: Db,
  profileId: string,
  newId: IdGenerator,
  input: { name: string; rule: SmartRule | null },
  now: number,
): string {
  const id = newId();
  db.insert(playlists)
    .values({
      id,
      profileId,
      name: input.name.trim() || 'New list',
      rule: input.rule,
      items: [],
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function update(
  db: Db,
  profileId: string,
  id: string,
  change: Partial<Pick<Playlist, 'name' | 'rule' | 'items' | 'keepFinished'>>,
  now: number,
): void {
  db.update(playlists)
    .set({ ...change, updatedAt: now })
    .where(and(eq(playlists.id, id), eq(playlists.profileId, profileId)))
    .run();
}

export function renamePlaylist(db: Db, profileId: string, id: string, name: string, now: number) {
  const trimmed = name.trim();
  if (trimmed) update(db, profileId, id, { name: trimmed }, now);
}

export function setPlaylistRule(
  db: Db,
  profileId: string,
  id: string,
  rule: SmartRule,
  now: number,
): void {
  update(db, profileId, id, { rule }, now);
}

/** Whether playing the list goes through finished items too (a list of favourites to hear again). */
export function setPlaylistKeepFinished(
  db: Db,
  profileId: string,
  id: string,
  keepFinished: boolean,
  now: number,
): void {
  update(db, profileId, id, { keepFinished }, now);
}

export function deletePlaylist(db: Db, profileId: string, id: string, now: number): void {
  db.delete(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.profileId, profileId)))
    .run();
  recordDeletion(db, 'playlist', id, profileId, now);
}

/**
 * Adds a book at the end of a hand-made list; a book is in a list once. True when it was added,
 * false when it was there already or the list takes no books.
 */
export function addToPlaylist(
  db: Db,
  profileId: string,
  id: string,
  bookId: string,
  now: number,
): boolean {
  const list = getPlaylist(db, profileId, id);
  const key = bookKey(db, bookId);
  if (!list || list.rule !== null || !key || list.items.includes(key)) return false;
  update(db, profileId, id, { items: [...list.items, key] }, now);
  return true;
}

export function removeFromPlaylist(
  db: Db,
  profileId: string,
  id: string,
  bookId: string,
  now: number,
): void {
  const list = getPlaylist(db, profileId, id);
  const key = bookKey(db, bookId);
  if (!list || !key) return;
  update(db, profileId, id, { items: list.items.filter((k) => k !== key) }, now);
}

/** Moves a book to `index` among the list's items. */
export function movePlaylistItem(
  db: Db,
  profileId: string,
  id: string,
  bookId: string,
  index: number,
  now: number,
): void {
  const list = getPlaylist(db, profileId, id);
  const key = bookKey(db, bookId);
  if (!list || !key || !list.items.includes(key)) return;
  const items = list.items.filter((k) => k !== key);
  items.splice(Math.max(0, Math.min(index, items.length)), 0, key);
  update(db, profileId, id, { items }, now);
}

/** The books in a list that are on this device: in order for hand-made lists. */
export function playlistBooks(
  db: Db,
  profileId: string,
  list: Playlist,
  library: Library = readLibrary(db, profileId),
): LibraryBook[] {
  if (list.rule) return smartBooks(library, list.rule);
  const all = new Map(library.books.map((b) => [b.id, b]));
  return list.items
    .map((key) => bookIdForKey(db, key))
    .map((bookId) => (bookId ? all.get(bookId) : undefined))
    .filter((b): b is LibraryBook => b !== undefined && !b.missing);
}

/** The profile's lists with how many books each shows; the library is read once for all. */
export function listPlaylistsWithCounts(
  db: Db,
  profileId: string,
): { list: Playlist; count: number }[] {
  const lists = listPlaylists(db, profileId);
  if (lists.length === 0) return [];
  const library = readLibrary(db, profileId);
  return lists.map((list) => ({
    list,
    count: playlistBooks(db, profileId, list, library).length,
  }));
}

/** Smart lists offered when making a new one. */
export const SMART_PRESETS: { name: string; rule: SmartRule }[] = [
  { name: 'Short and not started', rule: { status: 'notStarted', maxDurationMs: 3 * 3_600_000 } },
  { name: 'For the flight', rule: { offline: true, status: 'notStarted' } },
  { name: 'In progress', rule: { status: 'inProgress' } },
  { name: 'Finished', rule: { status: 'finished' } },
];
