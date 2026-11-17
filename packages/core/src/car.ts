import type { Db } from './db';
import { continueListening, type LibraryBook, listBooks } from './library/queries';
import { newestUnfinishedEpisodes } from './podcasts/repository';
import { listUpNext } from './upNext';

/** An episode to offer in the car: its book exists once it was played or downloaded. */
export type CarEpisode = { episodeId: string; bookId: string | null };

/**
 * What Android Auto lists while the app may be closed. The app turns these into playable books
 * and hands them to the playback service, which builds the browse tree from them.
 */
export type CarShelves = {
  /** Started and unfinished, most recent first; episodes included. */
  continueListening: string[];
  /** Books on the phone, finished ones too: local folders and finished downloads. */
  onPhone: string[];
  /** The newest unfinished episode of each subscription, newest first. */
  latestEpisodes: CarEpisode[];
  upNext: string[];
};

const playable = (b: LibraryBook) => !b.missing && b.finishedAt === null;

export function carShelves(db: Db, profileId: string, limit = 20): CarShelves {
  const recent = listBooks(db, profileId, 'recent');
  const latest = continueListening(db, profileId);
  const started = recent.filter((b) => playable(b) && b.lastPlayedAt !== null);
  // Episodes are left out of listBooks; the latest one played may still be one.
  if (latest && !started.some((b) => b.id === latest.id)) started.unshift(latest);
  const episodes = newestUnfinishedEpisodes(db, profileId).sort(
    (a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0),
  );
  return {
    continueListening: started.slice(0, limit).map((b) => b.id),
    onPhone: recent
      .filter((b) => !b.missing && (b.source === 'local' || b.downloaded))
      .slice(0, limit)
      .map((b) => b.id),
    latestEpisodes: episodes.slice(0, limit).map((e) => ({ episodeId: e.id, bookId: e.bookId })),
    upNext: listUpNext(db, profileId)
      .slice(0, limit)
      .map((item) => item.bookId),
  };
}
