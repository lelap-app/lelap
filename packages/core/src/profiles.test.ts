import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { getBook } from './library/queries';
import {
  checkPin,
  createProfile,
  DEFAULT_PROFILE_ID,
  deleteProfile,
  getActiveProfile,
  getProfile,
  hashPin,
  listProfiles,
  setActiveProfile,
  setPin,
  updateProfile,
} from './profiles';
import { saveProgress } from './progress';
import { getSettings, setSetting } from './settings';

let n = 0;
const newId = () => `profile-${++n}`;

describe('profiles', () => {
  it('starts with the default profile and remembers the active one per device', () => {
    const db = createTestDb();
    expect(listProfiles(db).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
    expect(getActiveProfile(db)).toBe(DEFAULT_PROFILE_ID);
    const kid = createProfile(db, { name: ' Mia ', avatar: 'owl', kids: true }, 10, newId);
    setActiveProfile(db, kid, 11);
    expect(getActiveProfile(db)).toBe(kid);
    expect(getProfile(db, kid)).toMatchObject({
      name: 'Mia',
      avatar: 'owl',
      kids: true,
      hiddenAddons: [],
    });
    updateProfile(db, kid, { hiddenAddons: ['https://a.example/manifest.json'], name: '' }, 12);
    expect(getProfile(db, kid)).toMatchObject({
      name: 'Listener',
      hiddenAddons: ['https://a.example/manifest.json'],
    });
  });

  it('keeps places and settings apart', () => {
    const db = createTestDb();
    const bookId = seedBook(db, 'Book', [{ location: 'a', durationMs: 10_000 }]);
    const other = createProfile(db, { name: 'Sam', avatar: null, kids: false }, 1, newId);
    saveProgress(db, DEFAULT_PROFILE_ID, {
      bookId,
      fileLocation: 'a',
      filePositionMs: 4_000,
      savedAt: 2,
    });
    setSetting(db, other, 'skipIntervalMs', 10_000, 3);
    expect(getBook(db, other, bookId)?.book.bookPositionMs).toBe(0);
    expect(getBook(db, DEFAULT_PROFILE_ID, bookId)?.book.bookPositionMs).toBe(4_000);
    expect(getSettings(db, DEFAULT_PROFILE_ID).skipIntervalMs).toBe(30_000);
    expect(getSettings(db, other).skipIntervalMs).toBe(10_000);
  });

  it('checks a four-digit PIN by its hash', () => {
    const db = createTestDb();
    expect(checkPin(db, DEFAULT_PROFILE_ID, '0000')).toBe(true);
    setPin(db, DEFAULT_PROFILE_ID, '1234', 5);
    expect(getProfile(db, DEFAULT_PROFILE_ID)?.pinHash).toBe(hashPin(DEFAULT_PROFILE_ID, '1234'));
    expect(checkPin(db, DEFAULT_PROFILE_ID, '1234')).toBe(true);
    expect(checkPin(db, DEFAULT_PROFILE_ID, '4321')).toBe(false);
    expect(() => setPin(db, DEFAULT_PROFILE_ID, '12a4', 6)).toThrow('four digits');
    setPin(db, DEFAULT_PROFILE_ID, null, 7);
    expect(checkPin(db, DEFAULT_PROFILE_ID, '9999')).toBe(true);
  });

  it('deletes a profile with its own data, never the last one', () => {
    const db = createTestDb();
    const bookId = seedBook(db, 'Book', [{ location: 'a', durationMs: 10_000 }]);
    const other = createProfile(db, { name: 'Sam', avatar: null, kids: false }, 1, newId);
    saveProgress(db, other, { bookId, fileLocation: 'a', filePositionMs: 4_000, savedAt: 2 });
    expect(deleteProfile(db, other, 3)).toBe(true);
    expect(listProfiles(db).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
    expect(getBook(db, DEFAULT_PROFILE_ID, bookId)).not.toBeNull();
    expect(deleteProfile(db, DEFAULT_PROFILE_ID, 4)).toBe(false);
  });
});
