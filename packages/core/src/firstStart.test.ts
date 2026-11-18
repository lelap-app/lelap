import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { installAddon, removeAddon } from './addons/repository';
import { firstStartDone, libraryIsEmpty, needsFirstStart, setFirstStartDone } from './firstStart';
import { subscribe } from './podcasts/repository';
import { createProfile, DEFAULT_PROFILE_ID } from './profiles';
import { libraryRoots, podcasts, syncState } from './schema';
import { recordListening } from './stats';

let n = 0;
const newId = () => `f-${++n}`;
const me = DEFAULT_PROFILE_ID;

describe('first start', () => {
  it('shows on an empty device until it is finished or skipped', () => {
    const db = createTestDb();
    expect(needsFirstStart(db, me)).toBe(true);
    setFirstStartDone(db, me, 1);
    setFirstStartDone(db, me, 2);
    expect(firstStartDone(db, me)).toBe(true);
    expect(needsFirstStart(db, me)).toBe(false);
  });

  it('never shows on a device that already has a book', () => {
    const db = createTestDb();
    expect(libraryIsEmpty(db)).toBe(true);
    seedBook(db, 'Book', [{ location: 'b.mp3', durationMs: 1000 }]);
    expect(libraryIsEmpty(db)).toBe(false);
    expect(needsFirstStart(db, me)).toBe(false);
  });

  it('never shows once a folder or server is added, even before a scan finds books', () => {
    const db = createTestDb();
    db.insert(libraryRoots)
      .values({
        id: 'r',
        uri: 'https://dav.example/books',
        name: 'NAS',
        location: 'https://dav.example/books',
        addedAt: 1,
        updatedAt: 1,
      })
      .run();
    expect(needsFirstStart(db, me)).toBe(false);
  });

  it('never shows to a profile with a podcast', () => {
    const db = createTestDb();
    db.insert(podcasts)
      .values({ id: 'p', feedUrl: 'https://feed.example/rss', title: 'Show', updatedAt: 1 })
      .run();
    subscribe(db, me, 'p', 1);
    expect(needsFirstStart(db, me)).toBe(false);
  });

  it('ignores the default add-ons, but not one the listener added or removed', () => {
    const url = 'https://a.example/manifest.json';
    const manifest = {
      id: 'x',
      version: '1.0.0',
      protocol: 1 as const,
      name: 'X',
      description: '',
      resources: [],
      types: [],
      catalogs: [],
    };
    const db = createTestDb();
    installAddon(db, { url, manifest, builtin: true, now: 1, newId });
    expect(needsFirstStart(db, me)).toBe(true);

    const own = createTestDb();
    installAddon(own, { url, manifest, now: 1, newId });
    expect(needsFirstStart(own, me)).toBe(false);

    const removed = createTestDb();
    installAddon(removed, { url, manifest, builtin: true, now: 1, newId });
    removeAddon(removed, url, 2);
    expect(needsFirstStart(removed, me)).toBe(false);
  });

  it('never shows on a device in a sync group', () => {
    const db = createTestDb();
    db.insert(syncState)
      .values({ key: 'membership', value: JSON.stringify({ groupId: 'g' }), updatedAt: 1 })
      .run();
    expect(needsFirstStart(db, me)).toBe(false);
  });

  it('never shows to a profile with listening history, even with its books gone', () => {
    const db = createTestDb();
    recordListening(db, me, { day: '2026-11-01', bookId: 'gone', title: 'Book', ms: 60_000 });
    expect(needsFirstStart(db, me)).toBe(false);
  });

  it('is per profile, and never for a kids profile', () => {
    const db = createTestDb();
    const other = createProfile(db, { name: 'Sam', avatar: null, kids: false }, 1, newId);
    const kid = createProfile(db, { name: 'Ida', avatar: null, kids: true }, 1, newId);
    setFirstStartDone(db, me, 2);
    expect(needsFirstStart(db, other)).toBe(true);
    expect(needsFirstStart(db, kid)).toBe(false);
  });
});
