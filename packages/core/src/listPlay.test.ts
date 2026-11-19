import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import type { Db } from './db';
import { setFinished } from './library/queries';
import {
  followedList,
  followedListItems,
  listPlayOrder,
  listPrevious,
  listStart,
  listUpcoming,
  playsFromStart,
  setFollowedList,
} from './listPlay';
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  setPlaylistKeepFinished,
} from './organise';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { saveProgress } from './progress';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}

describe('playing a list', () => {
  let db: Db;
  let a: string;
  let b: string;
  let c: string;
  let n = 0;
  const newId = () => `pl-${++n}`;
  const ids = (books: { id: string }[]) => books.map((x) => x.id);

  beforeEach(() => {
    db = createTestDb();
    a = seedBook(db, 'A', [{ location: 'a', durationMs: 60_000 }]);
    b = seedBook(db, 'B', [{ location: 'b', durationMs: 60_000 }]);
    c = seedBook(db, 'C', [{ location: 'c', durationMs: 60_000 }]);
  });

  function handMade(): string {
    const id = createPlaylist(db, ME, newId, { name: 'Trip', rule: null }, 1);
    for (const book of [a, b, c]) addToPlaylist(db, ME, id, book, 2);
    return id;
  }

  it('starts at the first unfinished item and skips finished ones after it', () => {
    const id = handMade();
    setFinished(db, ME, a, true, 3);
    setFinished(db, ME, c, true, 3);
    const items = listPlayOrder(db, ME, must(getPlaylist(db, ME, id)));
    expect(listStart(items, false, null)?.id).toBe(b);
    expect(ids(listUpcoming(items, b, false))).toEqual([]);
    expect(listPrevious(items, b, false)).toBeNull();
  });

  it('keeps finished items when the list says so, and plays them from the start', () => {
    const id = handMade();
    setPlaylistKeepFinished(db, ME, id, true, 3);
    setFinished(db, ME, a, true, 4);
    setFinished(db, ME, b, true, 4);
    setFinished(db, ME, c, true, 4);
    const list = must(getPlaylist(db, ME, id));
    expect(list.keepFinished).toBe(true);
    const items = listPlayOrder(db, ME, list);
    expect(listStart(items, true, null)?.id).toBe(a);
    // After the last item, round to the top.
    expect(listStart(items, true, c)?.id).toBe(a);
    expect(listStart(items, true, a)?.id).toBe(b);
    expect(ids(listUpcoming(items, a, true))).toEqual([b, c]);
    expect(listPrevious(items, c, true)?.id).toBe(b);
    expect(playsFromStart(must(items[0]), true)).toBe(true);
    expect(playsFromStart(must(items[0]), false)).toBe(false);
  });

  it('resumes an item in progress when the list keeps finished ones', () => {
    const id = handMade();
    setPlaylistKeepFinished(db, ME, id, true, 3);
    saveProgress(
      db,
      ME,
      { bookId: b, fileLocation: 'b', filePositionMs: 5_000, savedAt: 4 },
      'app',
    );
    const items = listPlayOrder(db, ME, must(getPlaylist(db, ME, id)));
    expect(listStart(items, true, b)?.id).toBe(b);
  });

  it('resumes a finished item heard again part way, in a list that keeps them', () => {
    const id = handMade();
    setPlaylistKeepFinished(db, ME, id, true, 3);
    setFinished(db, ME, b, true, 4);
    saveProgress(
      db,
      ME,
      { bookId: b, fileLocation: 'b', filePositionMs: 20_000, savedAt: 5 },
      'app',
    );
    const items = listPlayOrder(db, ME, must(getPlaylist(db, ME, id)));
    const replayed = must(items.find((x) => x.id === b));
    expect(listStart(items, true, b)?.id).toBe(b);
    expect(playsFromStart(replayed, true)).toBe(false);
    // At its end again, it plays from the start next time.
    saveProgress(
      db,
      ME,
      { bookId: b, fileLocation: 'b', filePositionMs: 59_000, savedAt: 6 },
      'app',
    );
    const ended = must(
      listPlayOrder(db, ME, must(getPlaylist(db, ME, id))).find((x) => x.id === b),
    );
    expect(playsFromStart(ended, true)).toBe(true);
  });

  it('plays a smart list in the order it had when Play was pressed', () => {
    const id = createPlaylist(db, ME, newId, { name: 'New', rule: { status: 'notStarted' } }, 1);
    const list = must(getPlaylist(db, ME, id));
    const order = [c, a, b];
    setFollowedList(db, ME, { listId: id, bookId: c, order }, 2);
    // Started now, so the rule no longer matches it; the snapshot still has it.
    saveProgress(
      db,
      ME,
      { bookId: c, fileLocation: 'c', filePositionMs: 5_000, savedAt: 3 },
      'app',
    );
    const items = listPlayOrder(db, ME, list);
    expect(ids(items)).toEqual(order);
    expect(ids(listUpcoming(items, c, false))).toEqual([a, b]);
  });

  it('remembers the followed list per profile and forgets a deleted list', () => {
    const id = handMade();
    expect(followedList(db, ME)).toBeNull();
    setFollowedList(db, ME, { listId: id, bookId: a, order: null }, 2);
    expect(followedList(db, ME)).toEqual({ listId: id, bookId: a, order: null });
    expect(followedList(db, 'someone-else')).toBeNull();
    expect(ids(must(followedListItems(db, ME, 3)).items)).toEqual([a, b, c]);
    deletePlaylist(db, ME, id, 4);
    expect(followedListItems(db, ME, 5)).toBeNull();
    expect(followedList(db, ME)).toBeNull();
    setFollowedList(db, ME, null, 6);
    expect(followedList(db, ME)).toBeNull();
  });
});
