import {
  enqueueScrobble,
  getBook,
  getProfile,
  type InstalledAddon,
  listAddons,
  nextScrobbleDue,
  type Poster,
  ScrobbleTracker,
  scrobbleEventFor,
  sendScrobbles,
  type TimelineFile,
  toBookPosition,
  type TrackedEvent,
} from '@lelap/core';

import { db, newId } from './db';
import type { PlayerState } from './platform/audio';

// Reports listening to add-ons that declare `scrobble`. Events wait in the outbox in the
// database, so what was played offline goes out later with its own timestamps.

const tracker = new ScrobbleTracker();
const post: Poster = (url, init) => fetch(url, init);

/** The add-ons a profile sees: a grown-up can hide a scrobbler from a child's profile. */
function addonsFor(profile: string): InstalledAddon[] {
  const hidden = new Set(getProfile(db, profile)?.hiddenAddons ?? []);
  return listAddons(db).filter((a) => !hidden.has(a.url));
}

// The loaded book's files, for turning a file position into a whole-book one every tick.
let timeline: { bookId: string; files: TimelineFile[]; durationMs: number } | null = null;
function timelineOf(bookId: string, profile: string) {
  if (timeline?.bookId !== bookId) {
    const detail = getBook(db, profile, bookId);
    timeline = {
      bookId,
      files: detail?.files ?? [],
      durationMs: detail?.book.durationMs ?? 0,
    };
  }
  return timeline;
}

function enqueue(events: TrackedEvent[], profile: string): void {
  if (events.length === 0) return;
  const addons = addonsFor(profile);
  for (const tracked of events) {
    const event = scrobbleEventFor(db, tracked);
    if (event) enqueueScrobble(db, { profileId: profile, addons, event, newId });
  }
  void flushScrobbles();
}

/** Feeds a player state to the tracker; called on every state the player reports. */
export function trackPlayerState(state: PlayerState, profile: string): void {
  const bookId = state.connected ? state.bookId : null;
  const positionMs =
    bookId && state.fileLocation
      ? toBookPosition(timelineOf(bookId, profile).files, state.fileLocation, state.positionMs)
      : 0;
  enqueue(
    tracker.update({ playing: state.playing && !state.ended, bookId, positionMs }, Date.now()),
    profile,
  );
}

/** The player finished a book at `at` (possibly while the app was closed). */
export function trackFinished(bookId: string, at: number, profile: string): void {
  const durationMs = getBook(db, profile, bookId)?.book.durationMs ?? 0;
  enqueue([tracker.finished(bookId, at, durationMs)], profile);
}

let sending: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Sends what is due and plans the next try. Never throws; offline is normal. */
export function flushScrobbles(): Promise<void> {
  sending ??= (async () => {
    try {
      await sendScrobbles(db, post, listAddons(db), Date.now());
    } catch {
      // The outbox keeps the events; the next flush tries again.
    } finally {
      sending = null;
      schedule();
    }
  })();
  return sending;
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const due = nextScrobbleDue(db);
  if (due === null) return;
  timer = setTimeout(() => void flushScrobbles(), Math.max(1_000, due - Date.now()));
}
