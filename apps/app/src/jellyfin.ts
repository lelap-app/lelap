import {
  getBook,
  jellyfinItemId,
  type JellyfinSource,
  listRoots,
  markJellyfinPlayed,
  reportJellyfinProgress,
  ScrobbleTracker,
  type TimelineFile,
  toBookPosition,
  toFilePosition,
  type TrackedEvent,
} from '@lelap/core';

import { db } from './db';
import type { PlayerState } from './platform/audio';

// Tells Jellyfin servers where the listener is, at the moments the app saves its own place:
// on start and pause, about every five minutes while playing, and at the end of a book. Only for
// the profile that added the server. Best effort: a report that fails is not retried, and the
// next scan settles any difference (the newest place wins).

const tracker = new ScrobbleTracker();
const send = (url: string, init?: RequestInit) => fetch(url, init);

type Part = TimelineFile & { rootId: string | null };
let timeline: { bookId: string; files: Part[] } | null = null;
function partsOf(bookId: string, profile: string): Part[] {
  if (timeline?.bookId !== bookId) {
    timeline = { bookId, files: getBook(db, profile, bookId)?.files ?? [] };
  }
  return timeline.files;
}

/** The server a book's files are on, when it is a Jellyfin server synced with this profile. */
function serverOf(parts: Part[], profile: string): JellyfinSource | null {
  const rootId = parts[0]?.rootId;
  if (!rootId) return null;
  const root = listRoots(db).find((r) => r.id === rootId);
  const remote = root?.remote;
  if (remote?.type !== 'jellyfin' || root?.needsLogin || remote.profileId !== profile) return null;
  return remote;
}

function report(events: TrackedEvent[], profile: string): void {
  for (const event of events) {
    const parts = partsOf(event.bookId, profile);
    const server = serverOf(parts, profile);
    if (!server) continue;
    if (event.event === 'finish') {
      for (const part of parts) {
        const id = jellyfinItemId(part.location);
        if (id) void markJellyfinPlayed(send, server, id).catch(() => {});
      }
      continue;
    }
    const at = toFilePosition(parts, event.positionMs);
    const id = jellyfinItemId(at.location);
    const state =
      event.event === 'start' ? 'start' : event.event === 'pause' ? 'pause' : 'progress';
    if (id) void reportJellyfinProgress(send, server, id, at.positionMs, state).catch(() => {});
  }
}

/** Feeds a player state; called on every state the player reports. */
export function trackJellyfin(state: PlayerState, profile: string): void {
  const bookId = state.connected ? state.bookId : null;
  const positionMs =
    bookId && state.fileLocation
      ? toBookPosition(partsOf(bookId, profile), state.fileLocation, state.positionMs)
      : 0;
  report(
    tracker.update({ playing: state.playing && !state.ended, bookId, positionMs }, Date.now()),
    profile,
  );
}

/** The player finished a book: every part of it is played on the server. */
export function jellyfinFinished(bookId: string, at: number, profile: string): void {
  report([tracker.finished(bookId, at, 0)], profile);
}
