import {
  enqueueScrobble,
  getBook,
  getProfile,
  type InstalledAddon,
  isLocalAddonUrl,
  listAddons,
  mergeServiceAccounting,
  nextScrobbleDue,
  type Poster,
  ScrobbleTracker,
  scrobbleEventFor,
  sendScrobbles,
  type TimelineFile,
  toBookPosition,
  type TrackedEvent,
} from '@lelap/core';
import { wantsScrobble } from '@lelap/sdk';

import { db, newId } from './db';
import * as audio from './platform/audio';
import { postLocalScrobble } from './scrobblers';

// Reports listening to add-ons that declare `scrobble`. Events wait in the outbox in the
// database, so what was played offline goes out later with its own timestamps.

const tracker = new ScrobbleTracker();
// Scrobblers inside the app (M61) get their events in their sandbox, not over HTTP.
const post: Poster = (url, init) =>
  isLocalAddonUrl(url) ? postLocalScrobble(url, init.body) : fetch(url, init);

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

/**
 * Feeds a player state to the tracker; called on every state the player reports. Where the
 * playback service keeps the sessions itself (Android), they come from `foldServiceAccounting`.
 */
export function trackPlayerState(state: audio.PlayerState, profile: string): void {
  if (audio.countsInService) return;
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

/**
 * “Mark as finished” in a book's menu: the add-ons hear `finish`, as when the player reaches the
 * end, so a reading log moves the book to read.
 */
export function trackMarkedFinished(bookId: string, profile: string): void {
  const durationMs = getBook(db, profile, bookId)?.book.durationMs ?? 0;
  enqueue([{ event: 'finish', bookId, at: Date.now(), positionMs: durationMs }], profile);
}

/** “Stop reading” in a book's menu: the add-ons hear `abandon`, such as Did not finish. */
export function trackAbandoned(bookId: string, profile: string): void {
  const positionMs = getBook(db, profile, bookId)?.book.bookPositionMs ?? 0;
  enqueue([{ event: 'abandon', bookId, at: Date.now(), positionMs }], profile);
}

/** Whether any add-on this profile sees hears about this book, so a menu can offer Stop reading. */
export function scrobblesFor(bookId: string, profile: string): boolean {
  const tracked = { event: 'abandon' as const, bookId, at: Date.now(), positionMs: 0 };
  const event = scrobbleEventFor(db, tracked);
  return (
    event !== null &&
    addonsFor(profile).some((a) => wantsScrobble(a.manifest, event.item.type, event.item.id))
  );
}

let folding: Promise<boolean> | null = null;

/**
 * Merges what the playback service heard (M51) into `profile`'s stats and the scrobble outbox,
 * then lets the service drop it. Resolves to whether listening time was added. Never throws.
 */
export function foldServiceAccounting(profile: string): Promise<boolean> {
  if (!audio.countsInService) return Promise.resolve(false);
  // One at a time; a second merge of the same records would be skipped anyway.
  folding ??= (async () => {
    try {
      const batch = await audio.takeAccounting();
      const merged = mergeServiceAccounting(db, {
        profileId: profile,
        batch,
        addons: addonsFor(profile),
        now: Date.now(),
      });
      if (merged.through !== null) await audio.ackAccounting(batch.epoch, merged.through);
      if (merged.scrobbles > 0) void flushScrobbles();
      return merged.listenedMs > 0;
    } catch {
      // Unacknowledged records stay with the service for the next try.
      return false;
    } finally {
      folding = null;
    }
  })();
  return folding;
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
