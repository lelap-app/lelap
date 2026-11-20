import type { Badges } from '@lelap/sdk';
import { eq } from 'drizzle-orm';

import { type WorkRef, workKey } from './addons/availability';
import type { Db } from './db';
import { findBook, titleKey } from './importers/match';
import { bookFraction, type LibraryBook, listAllBooks } from './library/queries';
import { books } from './schema';

/** What this profile has done with an item: finished it, or got `progress` (0 to 1) into it. */
export type ListeningState = { finished: boolean; progress: number };

/**
 * One badge on a cover. Add-ons send `new` and `rating` as data (protocol revision 4); `finished`
 * and `progress` are the app's own, from the library.
 */
export type CoverBadge =
  | { kind: 'finished' }
  | { kind: 'progress'; percent: number }
  | { kind: 'new'; count: number }
  | { kind: 'rating'; stars: number };

/** A library book's own state, for its cover's badges. */
export const listeningOf = (book: LibraryBook): ListeningState => ({
  finished: book.finishedAt !== null,
  progress: bookFraction(book),
});

/**
 * The badges a cover shows, most personal first: finished or how far in, then new episodes,
 * then the rating. `max` keeps small covers readable.
 */
export function coverBadges(
  badges: Badges | undefined,
  listening: ListeningState | null | undefined,
  max = 3,
): CoverBadge[] {
  const list: CoverBadge[] = [];
  if (listening?.finished) list.push({ kind: 'finished' });
  else if (listening) {
    // The same whole percent the Library row shows; never 100 % until marked finished.
    const percent = Math.min(99, Math.floor(listening.progress * 100));
    if (percent >= 1) list.push({ kind: 'progress', percent });
  }
  if (badges?.newEpisodes) list.push({ kind: 'new', count: badges.newEpisodes });
  if (badges?.rating !== undefined && Number.isFinite(badges.rating)) {
    list.push({
      kind: 'rating',
      stars: Math.round(Math.min(5, Math.max(0, badges.rating)) * 10) / 10,
    });
  }
  return list.slice(0, Math.max(0, max));
}

const ADDON_LOCATION = /^addon:([^:]+):(.+)$/;

/**
 * Finds what this profile has done with catalog items: the streamed book added from the item (or
 * from another item that plays the same recording), else, for audiobooks, a library book with the
 * same title and author. Reads the library once, on the first lookup; make a new one when the
 * library changes.
 */
export function listeningLookup(
  db: Db,
  profileId: string,
): (work: WorkRef) => ListeningState | null {
  let loaded: { byItem: Map<string, LibraryBook>; index: Map<string, LibraryBook[]> } | null = null;
  const load = () => {
    if (loaded) return loaded;
    const all = listAllBooks(db, profileId);
    const byId = new Map(all.map((b) => [b.id, b]));
    // The same index `bookIndex` builds, from the one read.
    const index = new Map<string, LibraryBook[]>();
    for (const book of all) {
      if (book.source === 'feed' || book.missing) continue;
      const key = titleKey(book.title);
      index.set(key, [...(index.get(key) ?? []), book]);
    }
    const byItem = new Map<string, LibraryBook>();
    const streamed = db
      .select({ id: books.id, location: books.location, addonItem: books.addonItem })
      .from(books)
      .where(eq(books.source, 'addon'))
      .all();
    // The item a book was added from wins over another item that plays the same recording.
    for (const row of streamed) {
      const book = byId.get(row.id);
      if (book && row.addonItem) byItem.set(workKey(row.addonItem), book);
    }
    for (const row of streamed) {
      const book = byId.get(row.id);
      const match = ADDON_LOCATION.exec(row.location);
      if (book && match?.[1] && match[2])
        byItem.set(workKey({ type: match[1], id: match[2] }), book);
    }
    return (loaded = { byItem, index });
  };
  const answers = new Map<string, ListeningState | null>();
  return (work) => {
    const key = workKey(work);
    if (answers.has(key)) return answers.get(key) ?? null;
    const { byItem, index } = load();
    const book =
      byItem.get(key) ??
      (work.type === 'audiobook'
        ? findBook(index, work.name, work.author ? [work.author] : [])
        : null);
    const answer = book ? listeningOf(book) : null;
    answers.set(key, answer);
    return answer;
  };
}
