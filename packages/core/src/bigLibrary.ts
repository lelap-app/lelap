import { eq, like } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { Db } from './db';
import {
  bookFiles,
  bookmarks,
  books,
  bookTags,
  chapters,
  downloads,
  episodes,
  libraryEntries,
  playlists,
  podcasts,
  progress,
  subscriptions,
} from './schema';

// A made-up library of the size M43 is measured with, the same every time: benchmarks, tests and
// the app's developer settings use it. Books have no files on the device and never play.

export type BigLibraryOptions = {
  books?: number;
  podcasts?: number;
  episodesPerPodcast?: number;
  now?: number;
};

export const BIG_LIBRARY = { books: 10_000, podcasts: 500, episodesPerPodcast: 40 } as const;

/** Location prefix of every made-up book, so they can be told apart and removed. */
export const BIG_LIBRARY_PREFIX = 'bench:';

const FILES_PER_BOOK = 3;
const CHAPTERS_PER_FILE = 4;
const HOUR = 3_600_000;
const TAGS = ['fantasy', 'crime', 'history', 'science', 'kids', 'sleep', 'travel', 'classics'];
const WORDS = ['night', 'river', 'lantern', 'harbour', 'winter', 'garden', 'tower', 'island'];

// Expo's SQLite build allows 999 variables per statement.
function insertChunked<T extends Record<string, unknown>>(db: Db, table: SQLiteTable, rows: T[]) {
  if (rows.length === 0) return;
  const per = Math.max(1, Math.floor(999 / Object.keys(rows[0] as object).length));
  for (let i = 0; i < rows.length; i += per) {
    db.insert(table)
      .values(rows.slice(i, i + per) as never)
      .run();
  }
}

/** A small linear congruential generator, so every run makes the same library. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/**
 * Fills the database with made-up books, podcasts and listening for one profile: by default
 * 10,000 books of three files, 500 subscribed podcasts of 40 episodes, 1,500 books started.
 */
export function seedBigLibrary(db: Db, profileId: string, options: BigLibraryOptions = {}): void {
  const count = options.books ?? BIG_LIBRARY.books;
  const podcastCount = options.podcasts ?? BIG_LIBRARY.podcasts;
  const perPodcast = options.episodesPerPodcast ?? BIG_LIBRARY.episodesPerPodcast;
  const now = options.now ?? Date.UTC(2026, 10, 1);
  const rand = random(43);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)] as T;

  db.transaction((tx) => {
    const bookRows: (typeof books.$inferInsert)[] = [];
    const fileRows: (typeof bookFiles.$inferInsert)[] = [];
    const chapterRows: (typeof chapters.$inferInsert)[] = [];
    const entryRows: (typeof libraryEntries.$inferInsert)[] = [];
    const progressRows: (typeof progress.$inferInsert)[] = [];
    const tagRows: (typeof bookTags.$inferInsert)[] = [];
    const bookmarkRows: (typeof bookmarks.$inferInsert)[] = [];
    const downloadRows: (typeof downloads.$inferInsert)[] = [];

    for (let n = 0; n < count; n++) {
      const id = `bench-book-${n}`;
      const author = `Author ${n % 1_200}`;
      const title = `The ${pick(WORDS)} ${pick(WORDS)} ${n}`;
      const location = `${BIG_LIBRARY_PREFIX}${author}/${title}`;
      const fileMs = Math.round((1 + rand() * 5) * HOUR);
      bookRows.push({
        id,
        rootId: null,
        location,
        kind: 'folder',
        source: n % 10 === 9 ? 'addon' : 'local',
        title,
        author,
        coverPath: null,
        durationMs: fileMs * FILES_PER_BOOK,
        missingSince: n % 200 === 7 ? now : null,
        addedAt: now - n * 60_000,
        updatedAt: now,
      });
      for (let f = 0; f < FILES_PER_BOOK; f++) {
        const fileLocation = `${location}/${String(f + 1).padStart(2, '0')}.mp3`;
        fileRows.push({
          id: `${id}-file-${f}`,
          location: fileLocation,
          rootId: null,
          bookId: id,
          idx: f,
          uri: `file:///bench/${n}/${f}.mp3`,
          relPath: `${author}/${title}/${f + 1}.mp3`,
          name: `${String(f + 1).padStart(2, '0')}.mp3`,
          size: 40_000_000,
          modifiedAt: now,
          durationMs: fileMs,
          title: `Part ${f + 1}`,
          album: title,
          artist: author,
          albumArtist: author,
          coverPath: null,
          chaptersJson: [],
          updatedAt: now,
        });
        for (let c = 0; c < CHAPTERS_PER_FILE; c++) {
          const idx = f * CHAPTERS_PER_FILE + c;
          chapterRows.push({
            id: `${id}-chapter-${idx}`,
            bookId: id,
            idx,
            title: `Chapter ${idx + 1}`,
            startMs: f * fileMs + Math.round((c * fileMs) / CHAPTERS_PER_FILE),
            updatedAt: now,
          });
        }
      }
      // Every sixth book started, a third of those finished.
      if (n % 6 === 0) {
        const finished = n % 18 === 0;
        const positionMs = Math.round(rand() * fileMs * FILES_PER_BOOK);
        entryRows.push({
          profileId,
          bookId: id,
          speed: 1,
          lastPlayedAt: now - n * 3_600_000,
          finishedAt: finished ? now - n * 3_600_000 : null,
          updatedAt: now,
        });
        progressRows.push({
          profileId,
          bookId: id,
          fileLocation: `${location}/01.mp3`,
          filePositionMs: Math.min(positionMs, fileMs),
          bookPositionMs: positionMs,
          updatedAt: now,
        });
        bookmarkRows.push({
          id: `${id}-bookmark`,
          profileId,
          bookId: id,
          fileLocation: `${location}/01.mp3`,
          filePositionMs: 60_000,
          bookPositionMs: 60_000,
          note: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (n % 5 === 0) {
        tagRows.push({
          profileId,
          bookId: id,
          tags: [pick(TAGS), pick(TAGS)].filter((t, i, all) => all.indexOf(t) === i).sort(),
          updatedAt: now,
        });
      }
      if (n % 10 === 9 && n % 50 === 49) {
        downloadRows.push({
          bookId: id,
          state: 'done',
          bytesTotal: 120_000_000,
          requestedAt: now,
          completedAt: now,
          updatedAt: now,
        });
      }
    }

    const podcastRows: (typeof podcasts.$inferInsert)[] = [];
    const subscriptionRows: (typeof subscriptions.$inferInsert)[] = [];
    const episodeRows: (typeof episodes.$inferInsert)[] = [];
    const description = `${WORDS.join(' ')}. `.repeat(8);
    for (let p = 0; p < podcastCount; p++) {
      const podcastId = `bench-podcast-${p}`;
      const title = `Podcast ${p}`;
      podcastRows.push({
        id: podcastId,
        feedUrl: `https://feeds.invalid/bench/${p}.xml`,
        title,
        author: `Host ${p}`,
        description,
        fetchedAt: now,
        updatedAt: now,
      });
      subscriptionRows.push({ profileId, podcastId, subscribedAt: now, updatedAt: now });
      for (let e = 0; e < perPodcast; e++) {
        const guid = `${p}-${e}`;
        const played = e < 2;
        const bookId = played ? `bench-episode-book-${guid}` : null;
        if (bookId) {
          bookRows.push({
            id: bookId,
            rootId: null,
            location: `${BIG_LIBRARY_PREFIX}feed/${guid}`,
            kind: 'file',
            source: 'feed',
            title: `Episode ${e} of ${title}`,
            author: title,
            durationMs: HOUR,
            addedAt: now,
            updatedAt: now,
          });
          entryRows.push({
            profileId,
            bookId,
            lastPlayedAt: now - (p * perPodcast + e) * 60_000,
            finishedAt: e === 1 ? now : null,
            updatedAt: now,
          });
          progressRows.push({
            profileId,
            bookId,
            fileLocation: `${BIG_LIBRARY_PREFIX}feed/${guid}/file`,
            filePositionMs: 600_000,
            bookPositionMs: 600_000,
            updatedAt: now,
          });
        }
        episodeRows.push({
          id: `bench-episode-${guid}`,
          podcastId,
          guid,
          title: `Episode ${e} of ${title}`,
          description,
          publishedAt: now - e * 7 * 24 * HOUR - p * 60_000,
          season: null,
          number: perPodcast - e,
          durationMs: HOUR,
          url: `https://feeds.invalid/bench/${p}/${e}.mp3`,
          mime: 'audio/mpeg',
          size: 50_000_000,
          bookId,
          updatedAt: now,
        });
      }
    }

    insertChunked(tx, books, bookRows);
    insertChunked(tx, bookFiles, fileRows);
    insertChunked(tx, chapters, chapterRows);
    insertChunked(tx, libraryEntries, entryRows);
    insertChunked(tx, progress, progressRows);
    insertChunked(tx, bookTags, tagRows);
    insertChunked(tx, bookmarks, bookmarkRows);
    insertChunked(tx, downloads, downloadRows);
    insertChunked(tx, podcasts, podcastRows);
    insertChunked(tx, subscriptions, subscriptionRows);
    insertChunked(tx, episodes, episodeRows);

    const keyOf = (n: number) => bookRows[n % count]?.location as string;
    const lists: (typeof playlists.$inferInsert)[] = [
      { name: 'Short and not started', rule: { status: 'notStarted', maxDurationMs: 3 * HOUR } },
      { name: 'In progress', rule: { status: 'inProgress' } },
      { name: 'Finished', rule: { status: 'finished' } },
      { name: 'Sleep', rule: { tags: ['sleep'] } },
      { name: 'Next up', rule: null, items: Array.from({ length: 50 }, (_, i) => keyOf(i * 7)) },
      { name: 'Road trip', rule: null, items: Array.from({ length: 50 }, (_, i) => keyOf(i * 13)) },
    ].map((list, i) => ({
      id: `bench-list-${i}`,
      profileId,
      name: list.name,
      rule: list.rule as typeof playlists.$inferInsert.rule,
      items: list.items ?? [],
      createdAt: now,
      updatedAt: now,
    }));
    insertChunked(tx, playlists, lists);
  });
}

export function hasBigLibrary(db: Db): boolean {
  return (
    db.select({ id: books.id }).from(books).where(eq(books.id, 'bench-book-0')).get() !== undefined
  );
}

/** Removes everything `seedBigLibrary` made; places, tags and the rest go with their books. */
export function removeBigLibrary(db: Db): void {
  db.transaction((tx) => {
    tx.delete(bookFiles).where(like(bookFiles.id, 'bench-%')).run();
    tx.delete(books)
      .where(like(books.location, `${BIG_LIBRARY_PREFIX}%`))
      .run();
    tx.delete(podcasts).where(like(podcasts.id, 'bench-podcast-%')).run();
    tx.delete(playlists).where(like(playlists.id, 'bench-list-%')).run();
  });
}
