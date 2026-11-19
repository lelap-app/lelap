import type { Manifest } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import type { InstalledAddon } from './addons/client';
import { setFinished } from './library/queries';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { cleanRating, getRating, setRating } from './ratings';
import { scrobbleOutbox } from './schema';
import { enqueueScrobble, scrobbleEventFor, scrobbleItemKey } from './scrobble';
import { applyOps, collectOps } from './sync/ops';

// M102: the listener's own ratings, and what reaches which add-on (revision 10).

let n = 0;
const newId = () => `evt-${String(++n).padStart(8, '0')}`;
const must = <T>(value: T | null): T => {
  if (value === null) throw new Error('missing');
  return value;
};

const manifest = (resources: Manifest['resources']): Manifest => ({
  id: 'org.example.tracker',
  version: '1.0.0',
  protocol: 1,
  name: 'Tracker',
  description: '',
  types: ['audiobook'],
  resources,
  catalogs: [],
});
const addon = (url: string, resources: Manifest['resources']): InstalledAddon => ({
  id: url,
  url,
  manifest: manifest(resources),
  builtin: false,
});

describe('ratings', () => {
  it('keeps half stars from 0.5 to 5 and nothing else', () => {
    expect(cleanRating(4.5)).toBe(4.5);
    expect(cleanRating('3')).toBe(3);
    for (const bad of [0, 5.5, 4.25, -1, 'x', null, Number.NaN])
      expect(cleanRating(bad)).toBe(null);
  });

  it('keeps a rating per profile by the book, and takes it back', () => {
    const db = createTestDb();
    const book = seedBook(db, 'Walden', [{ location: 'walden/1.mp3', durationMs: 1000 }]);
    expect(getRating(db, ME, book)).toBe(null);
    expect(setRating(db, ME, book, 4.5, 10)).toBe(true);
    expect(setRating(db, ME, book, 4.5, 11)).toBe(false);
    expect(setRating(db, ME, book, 4.25, 12)).toBe(false);
    expect(getRating(db, ME, book)).toBe(4.5);
    expect(setRating(db, ME, book, null, 13)).toBe(true);
    expect(getRating(db, ME, book)).toBe(null);
    expect(setRating(db, ME, 'gone', 3, 14)).toBe(false);
  });

  it('syncs a rating and its removal, the newer one winning', () => {
    const db = createTestDb();
    const other = createTestDb();
    const book = seedBook(db, 'Walden', [{ location: 'walden/1.mp3', durationMs: 1000 }]);
    const there = seedBook(other, 'Walden', [{ location: 'walden/1.mp3', durationMs: 1000 }]);
    setRating(db, ME, book, 4, 20);
    const ops = collectOps(db, 0).filter((o) => o.type === 'rating');
    expect(ops).toEqual([
      { type: 'rating', profile: ME, key: 'Walden', at: 20, data: { rating: 4 } },
    ]);
    applyOps(other, ops, 30, newId);
    const first = ops[0];
    if (first?.type !== 'rating') throw new Error('no op');
    expect(getRating(other, ME, there)).toBe(4);
    // An older change and a rating that isn't one change nothing.
    applyOps(other, [{ ...first, at: 10, data: { rating: 2 } }], 31, newId);
    applyOps(other, [{ ...first, at: 40, data: { rating: 7 } }], 32, newId);
    expect(getRating(other, ME, there)).toBe(4);
    setRating(db, ME, book, null, 50);
    applyOps(
      other,
      collectOps(db, 20).filter((o) => o.type === 'rating'),
      60,
      newId,
    );
    expect(getRating(other, ME, there)).toBe(null);
  });
});

describe('scrobbles in revision 10', () => {
  const tracker = addon('https://tracker.example/manifest.json', ['scrobble']);
  const shelf = addon('https://shelf.example/manifest.json', [
    { name: 'scrobble', events: ['start', 'finish'] },
  ]);

  it('sends a rating only to add-ons that take one, without a rating once taken back', () => {
    const db = createTestDb();
    const book = seedBook(db, 'Walden', [{ location: 'walden/1.mp3', durationMs: 1000 }]);
    const rate = (rating?: number) =>
      scrobbleEventFor(
        db,
        { event: 'rate', bookId: book, at: 5, positionMs: 0 },
        rating === undefined ? {} : { rating },
      );
    enqueueScrobble(db, { profileId: ME, addons: [tracker, shelf], event: must(rate(4)), newId });
    enqueueScrobble(db, { profileId: ME, addons: [tracker, shelf], event: must(rate()), newId });
    const rows = db.select().from(scrobbleOutbox).all();
    expect(rows.map((r) => [r.addonUrl, r.event.rating])).toEqual([
      [tracker.url, 4],
      [tracker.url, undefined],
    ]);
  });

  it('sends resumed only to an add-on that heard of the book, unless the book is finished', () => {
    const db = createTestDb();
    const book = seedBook(db, 'Walden', [{ location: 'walden/1.mp3', durationMs: 600_000 }]);
    const start = (at: number) =>
      must(scrobbleEventFor(db, { event: 'start', bookId: book, at, positionMs: 120_000 }));
    expect(start(1).resumed).toBe(true);
    const sent = () =>
      db
        .select()
        .from(scrobbleOutbox)
        .all()
        .map((r) => [r.addonUrl, r.event.resumed ?? false]);

    // Set up after the book was begun: its first start is a plain one, the next carries on.
    enqueueScrobble(db, { profileId: ME, addons: [shelf], event: start(1), newId, bookId: book });
    enqueueScrobble(db, { profileId: ME, addons: [shelf], event: start(2), newId, bookId: book });
    expect(sent()).toEqual([
      [shelf.url, false],
      [shelf.url, true],
    ]);

    // A finished book keeps resumed even for an add-on that never heard of it.
    setFinished(db, ME, book, true, 3);
    enqueueScrobble(db, { profileId: ME, addons: [tracker], event: start(4), newId, bookId: book });
    expect(sent().at(-1)).toEqual([tracker.url, true]);
  });

  it('names an item by its ID, a work ID, an episode or its title and author', () => {
    expect(scrobbleItemKey({ type: 'audiobook', id: 'ol:OL1W', name: 'A' })).toBe('ol:OL1W');
    expect(
      scrobbleItemKey({ type: 'audiobook', name: 'A', externalIds: { isbn: '978', ol: 'OL1W' } }),
    ).toBe('ol:OL1W');
    expect(scrobbleItemKey({ type: 'audiobook', name: 'Walden', author: 'Thoreau' })).toBe(
      'name:walden\nthoreau',
    );
  });
});
