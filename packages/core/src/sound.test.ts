import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { getBook, setSpeed } from './library/queries';
import { episodeBook, listEpisodes, saveFeed, subscribe } from './podcasts/repository';
import { parseFeed } from './podcasts/rss';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { getSettings } from './settings';
import {
  bookSound,
  chooseSound,
  NO_OVERRIDES,
  setBookSound,
  setOverrides,
  syncedOverrides,
} from './sound';
import { applyOps, collectOps, type Op } from './sync/ops';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;
const DEFAULTS = { voiceEq: false, skipSilence: true, evenLoudness: false };

describe('chooseSound', () => {
  it('takes each override where there is one, the default otherwise', () => {
    expect(chooseSound(undefined, DEFAULTS)).toEqual(DEFAULTS);
    expect(chooseSound(NO_OVERRIDES, DEFAULTS)).toEqual(DEFAULTS);
    expect(chooseSound({ skipSilence: false, evenLoudness: true }, DEFAULTS)).toEqual({
      voiceEq: false,
      skipSilence: false,
      evenLoudness: true,
    });
  });

  it('starts with every effect off', () => {
    expect(chooseSound(undefined, getSettings(createTestDb(), ME))).toEqual({
      voiceEq: false,
      skipSilence: false,
      evenLoudness: false,
    });
  });

  it('sends only the overrides that are set', () => {
    expect(setOverrides({ voiceEq: true, skipSilence: null, evenLoudness: false })).toEqual({
      voiceEq: true,
      evenLoudness: false,
    });
  });
});

describe('bookSound', () => {
  it('keeps a book’s own choice beside its speed, per profile', () => {
    const db = createTestDb();
    const bookId = seedBook(db, 'Books/Dune', [{ location: 'Books/Dune/1.mp3', durationMs: 1000 }]);
    expect(bookSound(db, ME, bookId)).toEqual({ scope: 'book', overrides: NO_OVERRIDES });
    setSpeed(db, ME, bookId, 1.5, 1);
    setBookSound(db, ME, bookId, { skipSilence: true }, 2);
    setBookSound(db, ME, bookId, { evenLoudness: false }, 3);
    expect(bookSound(db, ME, bookId).overrides).toEqual({
      voiceEq: null,
      skipSilence: true,
      evenLoudness: false,
    });
    expect(getBook(db, ME, bookId)?.speed).toBe(1.5);
    expect(bookSound(db, 'someone-else', bookId).overrides).toEqual(NO_OVERRIDES);
    setBookSound(db, ME, bookId, { skipSilence: null, evenLoudness: null }, 4);
    expect(bookSound(db, ME, bookId).overrides).toEqual(NO_OVERRIDES);
  });

  it('gives an episode its show’s choice once the profile follows the show', async () => {
    const db = createTestDb();
    const xml = `<rss><channel><title>Garden Hour</title><item><title>One</title><guid>g1</guid>
      <enclosure url="https://cdn.example/1.mp3" type="audio/mpeg" length="1"/></item></channel></rss>`;
    const { podcastId } = saveFeed(
      db,
      'https://feeds.example/garden.xml',
      await parseFeed(xml),
      { etag: null, lastModified: null },
      1,
      newId,
    );
    const episode = listEpisodes(db, ME, podcastId)[0];
    const bookId = episodeBook(db, episode?.id ?? '', 2, newId);
    // Not followed: the episode is a book of its own.
    expect(bookSound(db, ME, bookId).scope).toBe('book');
    subscribe(db, ME, podcastId, 3);
    setBookSound(db, ME, bookId, { voiceEq: true }, 4);
    expect(bookSound(db, ME, bookId)).toEqual({
      scope: 'show',
      overrides: { voiceEq: true, skipSilence: null, evenLoudness: null },
    });
    const ops = collectOps(db, 3).filter((op) => op.type === 'subscription');
    expect(ops[0]?.data).toMatchObject({ voiceEq: true, skipSilence: null });
  });
});

describe('syncing a book’s sound', () => {
  const setUp = () => {
    const phone = createTestDb();
    const laptop = createTestDb();
    const files = [{ location: 'Books/Emma/1.mp3', durationMs: 1000 }];
    return {
      phone,
      laptop,
      phoneBook: seedBook(phone, 'Books/Emma', files),
      laptopBook: seedBook(laptop, 'Books/Emma', files),
    };
  };

  it('carries the choice with the speed', () => {
    const { phone, laptop, phoneBook, laptopBook } = setUp();
    setSpeed(phone, ME, phoneBook, 1.25, 10);
    setBookSound(phone, ME, phoneBook, { skipSilence: true, voiceEq: false }, 11);
    applyOps(laptop, collectOps(phone, 0), 20, newId);
    expect(getBook(laptop, ME, laptopBook)?.speed).toBe(1.25);
    expect(bookSound(laptop, ME, laptopBook).overrides).toEqual({
      voiceEq: false,
      skipSilence: true,
      evenLoudness: null,
    });
  });

  it('keeps the choice here when an older device sends a change without it', () => {
    const { phone, laptop, phoneBook, laptopBook } = setUp();
    setBookSound(laptop, ME, laptopBook, { evenLoudness: true }, 5);
    setSpeed(phone, ME, phoneBook, 2, 10);
    const old = collectOps(phone, 0).map((op): Op => {
      if (op.type !== 'entry') return op;
      const { speed, lastPlayedAt, finishedAt } = op.data;
      return { ...op, data: { speed, lastPlayedAt, finishedAt } };
    });
    applyOps(laptop, old, 20, newId);
    expect(getBook(laptop, ME, laptopBook)?.speed).toBe(2);
    expect(bookSound(laptop, ME, laptopBook).overrides.evenLoudness).toBe(true);
  });

  it('drops anything but a boolean or null', () => {
    expect(syncedOverrides({ voiceEq: 'yes', skipSilence: null, evenLoudness: 1 })).toEqual({
      skipSilence: null,
    });
  });
});
