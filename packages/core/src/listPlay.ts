import type { Db } from './db';
import { listeningStatus } from './library/byProgress';
import type { LibraryBook } from './library/queries';
import { getPlaylist, type Playlist, playlistBooks, readLibrary, smartBooks } from './organise';
import { deviceValue, setDeviceValue } from './profiles';

// Playing a list from start to end (M112). The list the player follows is kept on this device,
// per profile: it says what plays now, so like the loaded book it is not synced.

export type ListFollow = {
  listId: string;
  /** The list's item playing now, or the last one that did while Up Next plays in between. */
  bookId: string;
  /**
   * A smart list's order when Play was pressed. Its own order follows what was played last, and
   * playing an item can take it out of the rule (“Not started”), so it plays from this instead.
   */
  order: string[] | null;
};

const key = (profileId: string) => `listFollow:${profileId}`;

export function followedList(db: Db, profileId: string): ListFollow | null {
  const raw = deviceValue(db, key(profileId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ListFollow>;
    if (typeof value.listId !== 'string' || typeof value.bookId !== 'string') return null;
    return {
      listId: value.listId,
      bookId: value.bookId,
      order: Array.isArray(value.order) ? value.order.filter((id) => typeof id === 'string') : null,
    };
  } catch {
    return null;
  }
}

/** Starts following a list, moves along it, or stops following (null). */
export function setFollowedList(
  db: Db,
  profileId: string,
  follow: ListFollow | null,
  now: number,
): void {
  setDeviceValue(db, key(profileId), follow ? JSON.stringify(follow) : '', now);
}

const finished = (book: LibraryBook) => listeningStatus(book) === 'finished';

/**
 * A finished item heard again, part way: played after it was finished, with its place short of the
 * end. It stays finished (marked finished wins), so a list that keeps finished items resumes it.
 */
const REPLAY_END_MARGIN_MS = 30_000;
const replaying = (book: LibraryBook) =>
  book.finishedAt !== null &&
  book.lastPlayedAt !== null &&
  book.lastPlayedAt > book.finishedAt &&
  book.bookPositionMs > 0 &&
  book.durationMs > 0 &&
  book.bookPositionMs < book.durationMs - REPLAY_END_MARGIN_MS;

/**
 * The items a list plays through, in order: a hand-made list's own order (edits reach what comes
 * next), or a smart list's order as it was when Play was pressed.
 */
export function listPlayOrder(
  db: Db,
  profileId: string,
  list: Playlist,
  follow: ListFollow | null = followedList(db, profileId),
): LibraryBook[] {
  if (!list.rule) return playlistBooks(db, profileId, list);
  const library = readLibrary(db, profileId);
  if (follow?.listId !== list.id || !follow.order) return smartBooks(library, list.rule);
  const byId = new Map(library.books.map((b) => [b.id, b]));
  return follow.order
    .map((id) => byId.get(id))
    .filter((b): b is LibraryBook => b !== undefined && !b.missing);
}

/**
 * Where Play on a list starts. Without finished items: the first unfinished one. With them: the
 * item played last if it isn't done, else the one after it, round to the top at the end.
 */
export function listStart(
  items: readonly LibraryBook[],
  keepFinished: boolean,
  lastBookId: string | null,
): LibraryBook | null {
  if (!keepFinished) return items.find((b) => !finished(b)) ?? null;
  if (items.length === 0) return null;
  const at = lastBookId ? items.findIndex((b) => b.id === lastBookId) : -1;
  if (at < 0) return items[0] ?? null;
  const last = items[at];
  if (last && (!finished(last) || replaying(last))) return last;
  return items[(at + 1) % items.length] ?? null;
}

/** What comes after `bookId` in the list, in order; finished items only when the list keeps them. */
export function listUpcoming(
  items: readonly LibraryBook[],
  bookId: string,
  keepFinished: boolean,
): LibraryBook[] {
  const at = items.findIndex((b) => b.id === bookId);
  if (at < 0) return [];
  return items.slice(at + 1).filter((b) => keepFinished || !finished(b));
}

/** The item before `bookId` in the list, for Previous in the player; null at the top. */
export function listPrevious(
  items: readonly LibraryBook[],
  bookId: string,
  keepFinished: boolean,
): LibraryBook | null {
  const at = items.findIndex((b) => b.id === bookId);
  if (at <= 0) return null;
  return (
    items
      .slice(0, at)
      .reverse()
      .find((b) => keepFinished || !finished(b)) ?? null
  );
}

/** Whether an item plays from its start: a finished one in a list that keeps them, unless heard again part way. */
export const playsFromStart = (book: LibraryBook, keepFinished: boolean) =>
  keepFinished && finished(book) && !replaying(book);

/** The list being followed with its items, or null; a deleted list ends following it. */
export function followedListItems(
  db: Db,
  profileId: string,
  now: number,
): { follow: ListFollow; list: Playlist; items: LibraryBook[] } | null {
  const follow = followedList(db, profileId);
  if (!follow) return null;
  const list = getPlaylist(db, profileId, follow.listId);
  if (!list) {
    setFollowedList(db, profileId, null, now);
    return null;
  }
  return { follow, list, items: listPlayOrder(db, profileId, list, follow) };
}
