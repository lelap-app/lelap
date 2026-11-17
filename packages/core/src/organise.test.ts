import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import type { Db } from './db';
import { listAllBooks, setFinished } from './library/queries';
import {
  addToPlaylist,
  booksWithTag,
  createPlaylist,
  deletePlaylist,
  getTags,
  listPlaylists,
  listTags,
  matchesRule,
  movePlaylistItem,
  normalizeTag,
  playlistBooks,
  removeFromPlaylist,
  setTags,
} from './organise';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { tombstones } from './schema';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing');
  return value;
}

describe('organise', () => {
  let db: Db;
  let short: string;
  let long: string;
  let n = 0;
  const newId = () => `pl-${++n}`;

  beforeEach(() => {
    db = createTestDb();
    short = seedBook(db, 'Short', [{ location: 's', durationMs: 3_600_000 }]);
    long = seedBook(db, 'Long', [{ location: 'l', durationMs: 20 * 3_600_000 }]);
  });

  it('normalizes tags', () => {
    expect(normalizeTag('  #For  the Flight ')).toBe('for the flight');
    setTags(db, ME, short, ['Sleep', 'sleep', ' ', '#crime'], 1);
    expect(getTags(db, ME, short)).toEqual(['crime', 'sleep']);
  });

  it('counts tags and finds books by tag', () => {
    setTags(db, ME, short, ['sleep'], 1);
    setTags(db, ME, long, ['sleep', 'classic'], 1);
    expect(listTags(db, ME)).toEqual([
      { tag: 'sleep', count: 2 },
      { tag: 'classic', count: 1 },
    ]);
    expect(booksWithTag(db, ME, 'Classic').map((b) => b.id)).toEqual([long]);
  });

  it('keeps a hand-made list in order without duplicates', () => {
    const id = createPlaylist(db, ME, newId, { name: ' Bedtime ', rule: null }, 1);
    addToPlaylist(db, ME, id, short, 2);
    addToPlaylist(db, ME, id, long, 3);
    addToPlaylist(db, ME, id, short, 4);
    movePlaylistItem(db, ME, id, long, 0, 5);
    const list = listPlaylists(db, ME)[0];
    expect(list?.name).toBe('Bedtime');
    expect(playlistBooks(db, ME, must(list)).map((b) => b.id)).toEqual([long, short]);
    removeFromPlaylist(db, ME, id, long, 6);
    expect(playlistBooks(db, ME, must(listPlaylists(db, ME)[0])).map((b) => b.id)).toEqual([short]);
  });

  it('fills a smart list from its rule', () => {
    setFinished(db, ME, long, true, 10);
    const id = createPlaylist(
      db,
      ME,
      newId,
      {
        name: 'Short and not started',
        rule: { status: 'notStarted', maxDurationMs: 3 * 3_600_000 },
      },
      1,
    );
    const list = must(listPlaylists(db, ME).find((p) => p.id === id));
    expect(playlistBooks(db, ME, list).map((b) => b.id)).toEqual([short]);
    const finished = { ...list, rule: { status: 'finished' as const } };
    expect(playlistBooks(db, ME, finished).map((b) => b.id)).toEqual([long]);
  });

  it('matches offline and kind rules', () => {
    const book = must(listAllBooks(db, ME).find((b) => b.id === short));
    expect(matchesRule(book, [], { offline: true })).toBe(true);
    expect(matchesRule(book, [], { kind: 'episode' })).toBe(false);
    expect(matchesRule({ ...book, source: 'addon' }, [], { offline: true })).toBe(false);
    expect(matchesRule(book, ['sleep'], { tags: ['#Sleep'] })).toBe(true);
  });

  it('remembers a deleted list for sync', () => {
    const id = createPlaylist(db, ME, newId, { name: 'Gone', rule: null }, 1);
    deletePlaylist(db, ME, id, 2);
    expect(listPlaylists(db, ME)).toEqual([]);
    expect(db.select().from(tombstones).all()).toMatchObject([{ kind: 'playlist', key: id }]);
  });
});
