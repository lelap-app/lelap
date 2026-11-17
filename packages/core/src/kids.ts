import { eq } from 'drizzle-orm';

import type { Db } from './db';
import { playlists, profiles } from './schema';
import { bookIdForKey, bookKey } from './sync/keys';

// A kids profile sees the books a grown-up put on its shelf, and streamed books it started itself
// from the catalogs it is allowed; never the rest of the phone's local files. The shelf is a hidden
// hand-made list owned by the kids profile, so it syncs like any list and needs no table of its own.

const SHELF = 'kidshelf:';

export const shelfId = (kidProfileId: string) => `${SHELF}${kidProfileId}`;

/** Lists that are shelves don't show among the profile's own lists. */
export const isShelf = (playlistId: string) => playlistId.startsWith(SHELF);

export function isKidsProfile(db: Db, profileId: string): boolean {
  return (
    db.select({ kids: profiles.kids }).from(profiles).where(eq(profiles.id, profileId)).get()
      ?.kids ?? false
  );
}

function shelfKeys(db: Db, kidProfileId: string): string[] {
  return (
    db
      .select({ items: playlists.items })
      .from(playlists)
      .where(eq(playlists.id, shelfId(kidProfileId)))
      .get()?.items ?? []
  );
}

/** Row IDs of the books on a kid's shelf that are on this device. */
export function shelfBookIds(db: Db, kidProfileId: string): Set<string> {
  return new Set(
    shelfKeys(db, kidProfileId)
      .map((key) => bookIdForKey(db, key))
      .filter((id): id is string => id !== null),
  );
}

function saveShelf(db: Db, kidProfileId: string, items: string[], now: number): void {
  const row = { items, updatedAt: now };
  db.insert(playlists)
    .values({
      id: shelfId(kidProfileId),
      profileId: kidProfileId,
      name: 'Shelf',
      rule: null,
      createdAt: now,
      ...row,
    })
    .onConflictDoUpdate({ target: playlists.id, set: row })
    .run();
}

export function addToShelf(db: Db, kidProfileId: string, bookId: string, now: number): void {
  const key = bookKey(db, bookId);
  const items = shelfKeys(db, kidProfileId);
  if (!key || items.includes(key)) return;
  saveShelf(db, kidProfileId, [...items, key], now);
}

export function removeFromShelf(db: Db, kidProfileId: string, bookId: string, now: number): void {
  const key = bookKey(db, bookId);
  const items = shelfKeys(db, kidProfileId);
  if (!key || !items.includes(key)) return;
  saveShelf(
    db,
    kidProfileId,
    items.filter((k) => k !== key),
    now,
  );
}

/**
 * Whether a kids profile sees a book: on its shelf, or a streamed book it has started itself.
 * Local files (on the phone or a server) only through the shelf.
 */
export function kidCanSee(
  book: { id: string; source: string; lastPlayedAt: number | null; bookPositionMs: number },
  shelf: Set<string>,
): boolean {
  if (shelf.has(book.id)) return true;
  return book.source !== 'local' && (book.lastPlayedAt !== null || book.bookPositionMs > 0);
}

/** For a kids profile, the test a book must pass to show; null for everyone else. */
export function kidFilter<
  B extends { id: string; source: string; lastPlayedAt: number | null; bookPositionMs: number },
>(db: Db, profileId: string): ((book: B) => boolean) | null {
  if (!isKidsProfile(db, profileId)) return null;
  const shelf = shelfBookIds(db, profileId);
  return (book) => kidCanSee(book, shelf);
}
