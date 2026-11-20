import {
  applyRemotePlaces,
  audiobookshelfItemId,
  audiobookshelfItemProgress,
  audiobookshelfPlaces,
  type AudiobookshelfSource,
  getBook,
  isKeyRefused,
  listRoots,
  placeOwner,
  setAudiobookshelfKeyRefused,
} from '@lelap/core';

import { atServer } from './addresses';
import { db } from './db';

const send = (url: string, init?: RequestInit) => fetch(url, init);

type Root = ReturnType<typeof listRoots>[number];
type Server = AudiobookshelfSource & { rootId: string };

function serverOf(root: Root | undefined): Server | null {
  const remote = root?.remote;
  if (!root || remote?.type !== 'audiobookshelf' || root.needsLogin) return null;
  return { ...remote, rootId: root.id };
}

const serverById = (rootId: string | null | undefined) =>
  rootId ? serverOf(listRoots(db).find((r) => r.id === rootId)) : null;

/**
 * Notes whether a server took its API key: a refused key shows “Change key” in Settings, and the
 * mark goes as soon as a request with the key works again. Rethrows the error, if any.
 */
export async function withKey<T>(rootId: string, request: Promise<T>): Promise<T> {
  try {
    const result = await request;
    setAudiobookshelfKeyRefused(db, rootId, false, Date.now());
    return result;
  } catch (error) {
    if (isKeyRefused(error)) setAudiobookshelfKeyRefused(db, rootId, true, Date.now());
    throw error;
  }
}

/**
 * Before a book plays: takes the place from Audiobookshelf when it is newer, so a book left in
 * Audiobookshelf's own player continues there without a rescan. Gives up after 5 s. Places are
 * sent back by `serverPlaces`.
 */
export async function prepareAudiobookshelfBook(bookId: string, profile: string): Promise<void> {
  const files = getBook(db, profile, bookId)?.files ?? [];
  const server = serverById(files[0]?.rootId);
  const itemId = audiobookshelfItemId(files[0]?.location ?? '');
  if (!server || !itemId || placeOwner(db, server.profileId) !== profile) return;
  const progress = await withKey(
    server.rootId,
    atServer(server.rootId, { type: 'audiobookshelf', ...server }, (at) =>
      audiobookshelfItemProgress(send, at.url, at.token, itemId),
    ),
  ).catch(() => null);
  if (progress) applyRemotePlaces(db, profile, audiobookshelfPlaces(progress, files), Date.now());
}
