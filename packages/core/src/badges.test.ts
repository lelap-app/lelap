import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import type { WorkRef } from './addons/availability';
import { addStreamedBook } from './addons/streamed';
import { coverBadges, listeningLookup } from './badges';
import type { Db } from './db';
import { setFinished } from './library/queries';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { books, progress } from './schema';

describe('coverBadges', () => {
  it('puts the listener’s own state first, then new episodes, then the rating', () => {
    expect(
      coverBadges({ rating: 4.25, newEpisodes: 3 }, { finished: false, progress: 0.426 }),
    ).toEqual([
      { kind: 'progress', percent: 42 },
      { kind: 'new', count: 3 },
      { kind: 'rating', stars: 4.3 },
    ]);
  });

  it('shows finished instead of progress', () => {
    expect(coverBadges(undefined, { finished: true, progress: 0.5 })).toEqual([
      { kind: 'finished' },
    ]);
  });

  it('waits for the first whole percent and never says 100 % before finished', () => {
    expect(coverBadges(undefined, { finished: false, progress: 0.009 })).toEqual([]);
    expect(coverBadges(undefined, { finished: false, progress: 0.01 })).toEqual([
      { kind: 'progress', percent: 1 },
    ]);
    expect(coverBadges(undefined, { finished: false, progress: 1 })).toEqual([
      { kind: 'progress', percent: 99 },
    ]);
  });

  it('draws nothing for an untouched item without data, or zero new episodes', () => {
    expect(coverBadges(undefined, null)).toEqual([]);
    expect(coverBadges({ newEpisodes: 0 }, { finished: false, progress: 0 })).toEqual([]);
  });

  it('keeps a rating of zero stars', () => {
    expect(coverBadges({ rating: 0 }, null)).toEqual([{ kind: 'rating', stars: 0 }]);
  });

  it('keeps only as many as fit', () => {
    expect(coverBadges({ rating: 4, newEpisodes: 2 }, { finished: true, progress: 1 }, 2)).toEqual([
      { kind: 'finished' },
      { kind: 'new', count: 2 },
    ]);
  });
});

describe('listeningLookup', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const work = (id: string, name = id, author?: string): WorkRef => ({
    type: 'audiobook',
    id,
    name,
    ...(author ? { author } : {}),
  });

  const stream = (id: string, name: string, bookId: string) =>
    addStreamedBook(db, {
      addonUrl: 'https://librivox.example/manifest.json',
      meta: { type: 'audiobook', id, name, durationMs: 1000 },
      stream: { sourceKey: id, name: 'LibriVox', url: `https://audio.example/${bookId}.mp3` },
      now: 1,
      newId: () => bookId,
    });

  const place = (bookId: string, bookPositionMs: number) =>
    db
      .insert(progress)
      .values({
        profileId: ME,
        bookId,
        fileLocation: 'x',
        filePositionMs: bookPositionMs,
        bookPositionMs,
        updatedAt: 1,
      })
      .run();

  it('finds progress and finished marks of streamed books', () => {
    place(stream('librivox:walden', 'Walden', 'b1'), 250);
    setFinished(db, ME, stream('librivox:emma', 'Emma', 'b2'), true, 5);
    const lookup = listeningLookup(db, ME);
    expect(lookup(work('librivox:walden', 'Walden'))).toEqual({ finished: false, progress: 0.25 });
    expect(lookup(work('librivox:emma', 'Emma'))).toEqual({ finished: true, progress: 0 });
    expect(lookup(work('librivox:dune', 'Dune'))).toBeNull();
  });

  it('matches a library folder book by title and author', () => {
    db.insert(books)
      .values({
        id: 'b3',
        location: 'primary:Audiobooks/Dune',
        kind: 'folder',
        source: 'local',
        title: 'Dune',
        author: 'Frank Herbert',
        durationMs: 1000,
        addedAt: 1,
        updatedAt: 1,
      })
      .run();
    place('b3', 500);
    const lookup = listeningLookup(db, ME);
    expect(lookup(work('ol:OL1W', 'Dune', 'Herbert, Frank'))).toEqual({
      finished: false,
      progress: 0.5,
    });
    // Podcasts are never matched by title.
    expect(lookup({ type: 'podcast', id: 'pi:1', name: 'Dune' })).toBeNull();
  });

  it('keeps each profile’s own state', () => {
    setFinished(db, ME, stream('librivox:emma', 'Emma', 'b2'), true, 5);
    expect(listeningLookup(db, 'someone-else')(work('librivox:emma', 'Emma'))).toEqual({
      finished: false,
      progress: 0,
    });
  });
});
