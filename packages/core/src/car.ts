import type { Db } from './db';
import { continueListening, type LibraryBook, listBooks } from './library/queries';
import { followedList, listPlayOrder, listStart, playsFromStart } from './listPlay';
import { type Library, listPlaylists, readLibrary, smartBooks } from './organise';
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

/** A list in Android Auto's Lists shelf (M119), to play from the car with the app closed. */
export type CarList = {
  id: string;
  name: string;
  keepFinished: boolean;
  /** A smart list's order, which playing it from the car keeps (see `ListFollow.order`). */
  order: string[] | null;
  /** Where Play list starts, as on the list's own screen. */
  start: string | null;
  /** The items offered, in play order: from a few before `start` on. */
  items: { bookId: string; fromStart: boolean }[];
};

const finished = (b: LibraryBook) => b.finishedAt !== null;

/**
 * The profile's lists for the car, in their own order. Each brings a window of its items around
 * where it stands, so the service can play on from there and step back a few.
 */
export function carLists(db: Db, profileId: string, lists = 10, items = 12): CarList[] {
  const follow = followedList(db, profileId);
  // Read once, and only when a smart list is not the one playing.
  let library: Library | null = null;
  return listPlaylists(db, profileId)
    .slice(0, lists)
    .map((list) => {
      const followed = follow?.listId === list.id ? follow : null;
      const all =
        list.rule && !followed?.order
          ? smartBooks((library ??= readLibrary(db, profileId)), list.rule)
          : listPlayOrder(db, profileId, list, followed);
      const playable = all.filter((b) => list.keepFinished || !finished(b));
      const start = listStart(all, list.keepFinished, followed?.bookId ?? null);
      const at = Math.max(0, playable.findIndex((b) => b.id === start?.id) - 3);
      return {
        id: list.id,
        name: list.name,
        keepFinished: list.keepFinished,
        order: list.rule ? (followed?.order ?? all.map((b) => b.id)) : null,
        start: start?.id ?? null,
        items: playable.slice(at, at + items).map((b) => ({
          bookId: b.id,
          fromStart: playsFromStart(b, list.keepFinished),
        })),
      };
    });
}
