import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { addToShelf, kidCanSee, removeFromShelf, shelfBookIds } from './kids';
import {
  continueListening,
  listAllBooks,
  listBooks,
  listBooksFrom,
  setFinished,
} from './library/queries';
import { createPlaylist, listPlaylists } from './organise';
import { createProfile } from './profiles';
import { saveProgress } from './progress';

let n = 0;
const newId = () => `k-${++n}`;

describe('kids profile', () => {
  it('sees only shelf books among local files, and keeps the shelf out of its lists', () => {
    const db = createTestDb();
    const story = seedBook(db, 'Story', [{ location: 's', durationMs: 1000 }]);
    const grownUp = seedBook(db, 'Thriller', [{ location: 't', durationMs: 1000 }]);
    const kid = createProfile(db, { name: 'Ida', avatar: null, kids: true }, 1, newId);

    expect(listBooks(db, kid, 'title')).toEqual([]);
    addToShelf(db, kid, story, 2);
    addToShelf(db, kid, story, 3);
    expect(listBooks(db, kid, 'title').map((b) => b.id)).toEqual([story]);
    expect(shelfBookIds(db, kid)).toEqual(new Set([story]));

    createPlaylist(db, kid, newId, { name: 'Bedtime', rule: null }, 4);
    expect(listPlaylists(db, kid).map((p) => p.name)).toEqual(['Bedtime']);

    // A grown-up's local book never shows, even after the kid played it somehow.
    saveProgress(
      db,
      kid,
      { bookId: grownUp, fileLocation: 't', filePositionMs: 10, savedAt: 5 },
      'app',
    );
    setFinished(db, kid, grownUp, false, 5);
    expect(listBooks(db, kid, 'title').map((b) => b.id)).toEqual([story]);
    expect(listBooksFrom(db, kid, listAllBooks(db, kid), 'title').map((b) => b.id)).toEqual([
      story,
    ]);
    expect(continueListening(db, kid)).toBeNull();

    removeFromShelf(db, kid, story, 6);
    expect(listBooks(db, kid, 'title')).toEqual([]);
  });

  it('grown-ups see everything', () => {
    const db = createTestDb();
    seedBook(db, 'A', [{ location: 'a', durationMs: 1000 }]);
    const adult = createProfile(db, { name: 'Pat', avatar: null, kids: false }, 1, newId);
    expect(listBooks(db, adult, 'title')).toHaveLength(1);
  });

  it('lets a kid keep streamed books they started', () => {
    const book = { id: 'b', source: 'addon', lastPlayedAt: null, bookPositionMs: 0 };
    expect(kidCanSee(book, new Set())).toBe(false);
    expect(kidCanSee({ ...book, lastPlayedAt: 1 }, new Set())).toBe(true);
    expect(kidCanSee({ ...book, source: 'local', lastPlayedAt: 1 }, new Set())).toBe(false);
    expect(kidCanSee({ ...book, source: 'local' }, new Set(['b']))).toBe(true);
  });
});
