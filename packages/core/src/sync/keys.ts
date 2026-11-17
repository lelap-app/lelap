import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { books, episodes, podcasts, tombstones } from '../schema';

// Row IDs are made on each device, so synced data names books by what they are: a local or
// streamed book by its location, a podcast episode by its feed address and guid.

const FEED = 'feed:';

export const episodeKey = (feedUrl: string, guid: string) =>
  `${FEED}${encodeURIComponent(feedUrl)}:${encodeURIComponent(guid)}`;

export function parseEpisodeKey(key: string): { feedUrl: string; guid: string } | null {
  if (!key.startsWith(FEED)) return null;
  const [feed, guid] = key.slice(FEED.length).split(':');
  if (feed === undefined || guid === undefined) return null;
  return { feedUrl: decodeURIComponent(feed), guid: decodeURIComponent(guid) };
}

/** The synced name of a book on this device. */
export function bookKey(db: Db, bookId: string): string | null {
  const book = db
    .select({ location: books.location, source: books.source })
    .from(books)
    .where(eq(books.id, bookId))
    .get();
  if (!book) return null;
  if (book.source !== 'feed') return book.location;
  const episode = db
    .select({ guid: episodes.guid, feedUrl: podcasts.feedUrl })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(eq(episodes.bookId, bookId))
    .get();
  return episode ? episodeKey(episode.feedUrl, episode.guid) : null;
}

/** The book on this device with that synced name, if there is one. */
export function bookIdForKey(db: Db, key: string): string | null {
  const episode = parseEpisodeKey(key);
  if (!episode) {
    return db.select({ id: books.id }).from(books).where(eq(books.location, key)).get()?.id ?? null;
  }
  return (
    db
      .select({ bookId: episodes.bookId })
      .from(episodes)
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(and(eq(podcasts.feedUrl, episode.feedUrl), eq(episodes.guid, episode.guid)))
      .get()?.bookId ?? null
  );
}

export type TombstoneKind =
  'bookmark' | 'upNext' | 'subscription' | 'book' | 'profile' | 'playlist';

/** Remembers a deletion so the next sync tells the other devices. */
export function recordDeletion(
  db: Db,
  kind: TombstoneKind,
  key: string,
  profileId: string | null,
  now: number,
): void {
  const profile = profileId ?? '';
  db.insert(tombstones)
    .values({ kind, key, profileId: profile, deletedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [tombstones.kind, tombstones.key, tombstones.profileId],
      set: { deletedAt: now, updatedAt: now },
    })
    .run();
}
