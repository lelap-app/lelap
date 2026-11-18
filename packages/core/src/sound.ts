import { and, eq } from 'drizzle-orm';

import type { Db } from './db';
import { episodes, libraryEntries, subscriptions } from './schema';
import type { Settings } from './settings';

/**
 * Voice boost, skip silence and even loudness (M84): a listener default in Settings, and a book's
 * or show's own choice on top, stored and synced beside the book's speed or the show's intro and
 * outro. The Android service resolves them again (`SoundChoice` in modules/audio) for books it
 * starts by itself; keep the two in step.
 */
export const BOOK_SOUND_KEYS = ['voiceEq', 'skipSilence', 'evenLoudness'] as const;

export type BookSoundKey = (typeof BOOK_SOUND_KEYS)[number];

/** A book's or show's own choices; null follows the listener's default. */
export type SoundOverrides = Record<BookSoundKey, boolean | null>;

export type BookSound = {
  /** An episode of a show the profile follows takes the show's choice; anything else its own. */
  scope: 'book' | 'show';
  overrides: SoundOverrides;
};

export const NO_OVERRIDES: SoundOverrides = {
  voiceEq: null,
  skipSilence: null,
  evenLoudness: null,
};

/** What plays: each override where there is one, the listener's default otherwise. */
export function chooseSound(
  overrides: Partial<SoundOverrides> | undefined,
  defaults: Pick<Settings, BookSoundKey>,
): Record<BookSoundKey, boolean> {
  const pick = (key: BookSoundKey) => overrides?.[key] ?? defaults[key];
  return {
    voiceEq: pick('voiceEq'),
    skipSilence: pick('skipSilence'),
    evenLoudness: pick('evenLoudness'),
  };
}

/** Only the keys that are set, as the player's `BookLoad` carries them. */
export function setOverrides(overrides: SoundOverrides): Partial<Record<BookSoundKey, boolean>> {
  const out: Partial<Record<BookSoundKey, boolean>> = {};
  for (const key of BOOK_SOUND_KEYS) {
    const value = overrides[key];
    if (value !== null) out[key] = value;
  }
  return out;
}

const pickOverrides = (row: Partial<SoundOverrides> | undefined): SoundOverrides => ({
  voiceEq: row?.voiceEq ?? null,
  skipSilence: row?.skipSilence ?? null,
  evenLoudness: row?.evenLoudness ?? null,
});

function showOf(db: Db, profileId: string, bookId: string): string | null {
  const row = db
    .select({ podcastId: subscriptions.podcastId })
    .from(episodes)
    .innerJoin(
      subscriptions,
      and(eq(subscriptions.podcastId, episodes.podcastId), eq(subscriptions.profileId, profileId)),
    )
    .where(eq(episodes.bookId, bookId))
    .get();
  return row?.podcastId ?? null;
}

/** The book's own sound, or its show's for an episode of a show the profile follows. */
export function bookSound(db: Db, profileId: string, bookId: string): BookSound {
  const podcastId = showOf(db, profileId, bookId);
  if (podcastId) {
    const row = db
      .select({
        voiceEq: subscriptions.voiceEq,
        skipSilence: subscriptions.skipSilence,
        evenLoudness: subscriptions.evenLoudness,
      })
      .from(subscriptions)
      .where(and(eq(subscriptions.profileId, profileId), eq(subscriptions.podcastId, podcastId)))
      .get();
    return { scope: 'show', overrides: pickOverrides(row) };
  }
  const row = db
    .select({
      voiceEq: libraryEntries.voiceEq,
      skipSilence: libraryEntries.skipSilence,
      evenLoudness: libraryEntries.evenLoudness,
    })
    .from(libraryEntries)
    .where(and(eq(libraryEntries.profileId, profileId), eq(libraryEntries.bookId, bookId)))
    .get();
  return { scope: 'book', overrides: pickOverrides(row) };
}

/**
 * Sets the book's (or its show's) own choices; null goes back to the default. Like speed, the
 * row's time moves so the change syncs.
 */
export function setBookSound(
  db: Db,
  profileId: string,
  bookId: string,
  change: Partial<SoundOverrides>,
  now: number,
): void {
  const set: Partial<SoundOverrides> = {};
  for (const key of BOOK_SOUND_KEYS) if (key in change) set[key] = change[key] ?? null;
  const podcastId = showOf(db, profileId, bookId);
  if (podcastId) {
    db.update(subscriptions)
      .set({ ...set, updatedAt: now })
      .where(and(eq(subscriptions.profileId, profileId), eq(subscriptions.podcastId, podcastId)))
      .run();
    return;
  }
  db.insert(libraryEntries)
    .values({ profileId, bookId, ...set, updatedAt: now })
    .onConflictDoUpdate({
      target: [libraryEntries.profileId, libraryEntries.bookId],
      set: { ...set, updatedAt: now },
    })
    .run();
}

/**
 * The sound choices in a change from another device, when it sent them: absent keys (older
 * devices) keep what this device has; anything but a boolean or null is dropped.
 */
export function syncedOverrides(data: object): Partial<SoundOverrides> {
  const out: Partial<SoundOverrides> = {};
  for (const key of BOOK_SOUND_KEYS) {
    if (!(key in data)) continue;
    const value: unknown = (data as Record<string, unknown>)[key];
    if (value === null || typeof value === 'boolean') out[key] = value;
  }
  return out;
}
