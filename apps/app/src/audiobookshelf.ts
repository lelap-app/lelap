import {
  applyRemotePlaces,
  audiobookshelfItemId,
  audiobookshelfItemProgress,
  audiobookshelfPlaces,
  type AudiobookshelfSource,
  getBook,
  isKeyRefused,
  listRoots,
  reportAudiobookshelfProgress,
  ScrobbleTracker,
  setAudiobookshelfKeyRefused,
  type TimelineFile,
  toBookPosition,
  type TrackedEvent,
} from '@lelap/core';

import { db } from './db';
import type { PlayerState } from './platform/audio';

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
 * Audiobookshelf's own player continues there without a rescan. Gives up after 5 s.
 */
export async function prepareAudiobookshelfBook(bookId: string, profile: string): Promise<void> {
  const files = getBook(db, profile, bookId)?.files ?? [];
  const server = serverById(files[0]?.rootId);
  const itemId = audiobookshelfItemId(files[0]?.location ?? '');
  if (!server || !itemId || server.profileId !== profile) return;
  const progress = await withKey(
    server.rootId,
    audiobookshelfItemProgress(send, server.url, server.token, itemId),
  ).catch(() => null);
  if (progress) applyRemotePlaces(db, profile, audiobookshelfPlaces(progress, files), Date.now());
}

// Tells Audiobookshelf servers where the listener is, at the moments the app saves its own place:
// on start and pause, about every five minutes while playing, and at the end of a book. Only for
// the profile that added the server. Best effort: a report that fails is not retried, and the
// next scan settles any difference (the newest place wins).

const tracker = new ScrobbleTracker();

type Part = TimelineFile & { rootId: string | null };
let timeline: { key: string; files: Part[] } | null = null;
function partsOf(bookId: string, profile: string): Part[] {
  const key = `${profile}/${bookId}`;
  if (timeline?.key !== key) timeline = { key, files: getBook(db, profile, bookId)?.files ?? [] };
  return timeline.files;
}

/** Forgets the cached parts of the playing book; a scan may have changed them. */
export function forgetAudiobookshelfParts(): void {
  timeline = null;
}

async function report(event: TrackedEvent, profile: string): Promise<void> {
  const parts = partsOf(event.bookId, profile);
  const server = serverById(parts[0]?.rootId);
  const itemId = audiobookshelfItemId(parts[0]?.location ?? '');
  if (!server || server.profileId !== profile || !itemId) return;
  await withKey(
    server.rootId,
    reportAudiobookshelfProgress(send, server.url, server.token, itemId, {
      positionMs: event.positionMs,
      durationMs: parts.reduce((sum, p) => sum + Math.max(0, p.durationMs), 0),
      finished: event.event === 'finish',
    }),
  );
}

function reportAll(events: TrackedEvent[], profile: string): void {
  for (const event of events) void report(event, profile).catch(() => {});
}

/** Feeds a player state; called on every state the player reports. */
export function trackAudiobookshelf(state: PlayerState, profile: string): void {
  const bookId = state.connected ? state.bookId : null;
  const positionMs =
    bookId && state.fileLocation
      ? toBookPosition(partsOf(bookId, profile), state.fileLocation, state.positionMs)
      : 0;
  reportAll(
    tracker.update({ playing: state.playing && !state.ended, bookId, positionMs }, Date.now()),
    profile,
  );
}

/** The player finished a book: it is finished on the server too. */
export function audiobookshelfFinished(bookId: string, at: number, profile: string): void {
  reportAll([tracker.finished(bookId, at, 0)], profile);
}
