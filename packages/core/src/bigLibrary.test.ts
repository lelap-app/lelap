import { beforeAll, describe, expect, it } from 'vitest';

import { createPlannedDb } from '../test/db';
import { hasBigLibrary, removeBigLibrary, seedBigLibrary } from './bigLibrary';
import { bookFiles, books, chapters, episodes, playlists, podcasts, progress } from './schema';
import { carShelves } from './car';
import type { Db } from './db';
import { continueListening, getBook, listBooks } from './library/queries';
import { listPlaylists, listPlaylistsWithCounts, playlistBooks } from './organise';
import {
  getSubscription,
  listEpisodes,
  listSubscriptions,
  newestUnfinishedEpisodes,
} from './podcasts/repository';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { bookKey } from './sync/keys';

// A small copy of M43's big library: the same shape, so the answers and the query plans are
// those of 10,000 books. The timings are in bench/library.bench.ts.

const NOW = Date.UTC(2026, 10, 1);
let db: Db;
let plans: ReturnType<typeof createPlannedDb>['plans'];

beforeAll(() => {
  ({ db, plans } = createPlannedDb());
  seedBigLibrary(db, ME, { books: 300, podcasts: 20, episodesPerPodcast: 10, now: NOW });
});

/** Every table a query reads from start to end; only `books` may be, for the Library list. */
const fullScans = (run: () => unknown) =>
  plans(run).flatMap((q) => q.plan.filter((line) => /^SCAN \w+$/.test(line)));

describe('a big library', () => {
  it('lists the books, not the episodes, with the missing ones marked', () => {
    const books = listBooks(db, ME, 'title');
    expect(books).toHaveLength(300);
    expect(books.filter((b) => b.missing).map((b) => b.id)).toEqual(
      expect.arrayContaining(['bench-book-7', 'bench-book-207']),
    );
  });

  it('continues with the latest played unfinished book or episode', () => {
    expect(continueListening(db, ME)?.id).toBe('bench-episode-book-0-0');
  });

  it('counts unplayed episodes per subscription in one query', () => {
    const subs = listSubscriptions(db, ME);
    expect(subs).toHaveLength(20);
    expect(subs[0]).toMatchObject({ podcastId: 'bench-podcast-0', latestAt: NOW, unplayed: 9 });
    expect(getSubscription(db, ME, 'bench-podcast-3')?.unplayed).toBe(9);
    // The same as counting the episode list.
    const episodes = listEpisodes(db, ME, 'bench-podcast-3');
    expect(episodes.filter((e) => !e.finished)).toHaveLength(9);
  });

  it('offers the newest unfinished episode of each podcast in the car', () => {
    expect(newestUnfinishedEpisodes(db, ME)).toHaveLength(20);
    expect(carShelves(db, ME).latestEpisodes[0]).toEqual({
      episodeId: 'bench-episode-0-0',
      bookId: 'bench-episode-book-0-0',
    });
  });

  it('counts every list from one read of the library', () => {
    expect(listPlaylistsWithCounts(db, ME)).toEqual(
      listPlaylists(db, ME).map((list) => ({
        list,
        count: playlistBooks(db, ME, list).length,
      })),
    );
  });
});

describe('removeBigLibrary', () => {
  it('takes away every made-up row and leaves the rest', () => {
    const { db: own } = createPlannedDb();
    own
      .insert(books)
      .values({
        id: 'real',
        location: 'primary:Audiobooks/Real',
        kind: 'folder',
        title: 'Real',
        durationMs: 1,
        addedAt: 0,
        updatedAt: 0,
      })
      .run();
    seedBigLibrary(own, ME, { books: 20, podcasts: 2, episodesPerPodcast: 3 });
    expect(hasBigLibrary(own)).toBe(true);
    removeBigLibrary(own);
    expect(hasBigLibrary(own)).toBe(false);
    expect(own.select({ id: books.id }).from(books).all()).toEqual([{ id: 'real' }]);
    for (const table of [bookFiles, chapters, podcasts, episodes, progress, playlists]) {
      expect(own.select().from(table).all()).toEqual([]);
    }
  });
});

describe('query plans', () => {
  it('finds the book to continue through the index on when it was played', () => {
    const lines = plans(() => continueListening(db, ME)).flatMap((q) => q.plan);
    expect(lines.join('\n')).toContain('USING INDEX library_entries_played_idx');
    expect(fullScans(() => continueListening(db, ME))).toEqual([]);
  });

  it('finds the episode of a book without reading every episode', () => {
    expect(fullScans(() => bookKey(db, 'bench-episode-book-5-0'))).toEqual([]);
  });

  it('reads one book, its files and chapters through indexes', () => {
    expect(fullScans(() => getBook(db, ME, 'bench-book-42'))).toEqual([]);
  });

  it('reads podcasts and episodes through indexes', () => {
    expect(fullScans(() => listSubscriptions(db, ME))).toEqual([]);
    expect(fullScans(() => listEpisodes(db, ME, 'bench-podcast-3'))).toEqual([]);
  });

  it('reads the Library list in one pass over the books', () => {
    expect(fullScans(() => listBooks(db, ME, 'recent'))).toEqual(['SCAN books']);
  });
});
