import {
  addonPlaceReport,
  addonSettings,
  addonSourceHosts,
  audiobookshelfItemId,
  duePlaces,
  getBook,
  jellyfinItemId,
  listRoots,
  markJellyfinPlayed,
  nextPlaceDue,
  type PendingPlace,
  placeDone,
  placeFailed,
  placeOwner,
  placeToSend,
  queuePlace,
  RemoteError,
  reportAudiobookshelfProgress,
  reportJellyfinProgress,
  sameAddonCode,
  ScrobbleTracker,
  startsBeforePlace,
  type TimelineFile,
  toBookPosition,
  toFilePosition,
  type TrackedEvent,
} from '@lelap/core';
import { offersPlaces } from '@lelap/sdk';

import { codeFingerprint, sourceManifest } from './addonSources';
import { withKey } from './audiobookshelf';
import { db } from './db';
import type { PlayerState } from './platform/audio';
import { callAddonPlace } from './sandbox';

// Tells servers that keep places (Jellyfin, Audiobookshelf, add-ons with `place` such as
// Subsonic's bookmarks) where the listener is, at the moments the app saves its own place: on
// start and pause, about every five minutes while playing, and at the end of a book. Only for the
// server's owner: the profile that added it, else the first one. Each place waits in the outbox
// until the server takes it (M65), so one reported offline goes out later; a scan in between
// settles any difference (the newest place wins).

const tracker = new ScrobbleTracker();
const send = (url: string, init?: RequestInit) => fetch(url, init);

type Part = TimelineFile & { uri: string; rootId: string | null };
type Root = ReturnType<typeof listRoots>[number];

let timeline: { key: string; files: Part[] } | null = null;
function partsOf(bookId: string, profile: string): Part[] {
  const key = `${profile}/${bookId}`;
  if (timeline?.key !== key) timeline = { key, files: getBook(db, profile, bookId)?.files ?? [] };
  return timeline.files;
}

/** Forgets the cached parts of the playing book; a scan may have changed them. */
export function forgetServerPlaceParts(): void {
  timeline = null;
}

/** Whether an add-on server takes places, with the login entered for the add-on it runs. */
function addonKeepsPlaces(remote: Extract<NonNullable<Root['remote']>, { type: 'addon' }>) {
  // Another file under the add-on's ID gets none of the login entered for the old one.
  if (!sameAddonCode(remote, codeFingerprint(remote.addonUrl))) return null;
  const manifest = sourceManifest(remote.addonUrl);
  return manifest && offersPlaces(manifest) ? manifest : null;
}

/** The server that keeps places for these files, and the profile it keeps them for. */
function serverOf(rootId: string | null | undefined): { root: Root; owner: string } | null {
  const root = rootId ? listRoots(db).find((r) => r.id === rootId) : undefined;
  const remote = root?.remote;
  if (!root || !remote) return null;
  if (remote.type === 'addon') {
    if (!addonKeepsPlaces(remote)) return null;
  } else if (remote.type !== 'jellyfin' && remote.type !== 'audiobookshelf') {
    return null;
  }
  return { root, owner: placeOwner(db, remote.profileId) };
}

function report(events: TrackedEvent[], profile: string): void {
  let queued = false;
  for (const event of events) {
    const parts = partsOf(event.bookId, profile);
    const rootId = parts[0]?.rootId;
    if (!rootId || parts.some((p) => p.rootId !== rootId)) continue;
    const server = serverOf(rootId);
    if (!server || server.owner !== profile || server.root.needsLogin) continue;
    if (
      event.event === 'start' &&
      startsBeforePlace(event, getBook(db, profile, event.bookId)?.book.bookPositionMs ?? 0)
    ) {
      continue;
    }
    queuePlace(db, rootId, event);
    queued = true;
  }
  if (queued) void flushServerPlaces();
}

/** Feeds a player state; called on every state the player reports. */
export function trackServerPlaces(state: PlayerState, profile: string): void {
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

/** The player finished a book: the server hears so too. */
export function serverPlacesFinished(bookId: string, at: number, profile: string): void {
  report([tracker.finished(bookId, at, 0)], profile);
}

type Place = ReturnType<typeof placeToSend> & { retried: boolean };

/** Sends one place; false when the server will never take it, such as for a file it dropped. */
async function sendPlace(root: Root, files: Part[], place: Place, at: number): Promise<boolean> {
  const remote = root.remote;
  const finished = place.event === 'finish';
  if (remote?.type === 'jellyfin') {
    if (finished) {
      for (const part of files) {
        const id = jellyfinItemId(part.location);
        if (id) await markJellyfinPlayed(send, remote, id);
      }
      return true;
    }
    const file = toFilePosition(files, place.positionMs);
    const id = jellyfinItemId(file.location);
    if (!id) return false;
    // A place sent late opens no playing session on the server.
    const state =
      place.event === 'pause' || place.retried
        ? 'pause'
        : place.event === 'start'
          ? 'start'
          : 'progress';
    await reportJellyfinProgress(send, remote, id, file.positionMs, state);
    return true;
  }
  if (remote?.type === 'audiobookshelf') {
    const itemId = audiobookshelfItemId(files[0]?.location ?? '');
    if (!itemId) return false;
    await withKey(
      root.id,
      reportAudiobookshelfProgress(send, remote.url, remote.token, itemId, {
        positionMs: place.positionMs,
        durationMs: files.reduce((sum, p) => sum + Math.max(0, p.durationMs), 0),
        finished,
      }),
    );
    return true;
  }
  if (remote?.type === 'addon') {
    const manifest = addonKeepsPlaces(remote);
    // A file of unknown length would put the place in the wrong file.
    if (!manifest || files.slice(0, -1).some((p) => p.durationMs <= 0)) return false;
    const last = files.at(-1);
    const file = finished
      ? { location: last?.location ?? '', positionMs: last?.durationMs ?? 0 }
      : toFilePosition(files, place.positionMs);
    const report = addonPlaceReport(root.location, files, {
      location: file.location,
      positionMs: file.positionMs,
      when: at,
      finished,
    });
    if (!report) return false;
    const { status } = await callAddonPlace({
      addonUrl: remote.addonUrl,
      sandboxId: root.id,
      hosts: addonSourceHosts(manifest, remote.settings),
      settings: addonSettings(remote),
      place: report,
    });
    if (status !== 200) throw new RemoteError(status, `The add-on answered ${status}.`);
    return true;
  }
  return false;
}

// 4xx other than a refused login, a timeout or too many requests: sending again won't help.
const isPermanent = (error: unknown) =>
  error instanceof RemoteError &&
  error.status >= 400 &&
  error.status < 500 &&
  ![401, 403, 408, 429].includes(error.status);

const LATE_MS = 30_000;

async function sendDue(now: number, all: boolean): Promise<void> {
  // One failure per server per round: the rest of its places wait with it.
  const unreachable = new Set<string>();
  const rows: PendingPlace[] = duePlaces(db, now, all);
  for (const row of rows) {
    const server = serverOf(row.rootId);
    const files = server ? (getBook(db, server.owner, row.bookId)?.files ?? []) : [];
    if (!server || files.length === 0) {
      placeDone(db, row);
      continue;
    }
    if (server.root.needsLogin || unreachable.has(row.rootId)) {
      placeFailed(db, row, now);
      continue;
    }
    // Late: tried before, or waited while the app was closed or a send ran.
    const retried = row.attempts > 0 || now - row.at > LATE_MS;
    const place = { ...placeToSend(db, server.owner, row), retried };
    try {
      await sendPlace(server.root, files, place, row.at);
      placeDone(db, row);
    } catch (error) {
      if (isPermanent(error)) {
        placeDone(db, row);
      } else {
        unreachable.add(row.rootId);
        placeFailed(db, row, Date.now());
      }
    }
  }
}

let sending: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
// Asked for every waiting place while a round was running: one more round after it.
let allAfter = false;

/**
 * Sends the places that are due and plans the next try. `all` sends every waiting place now,
 * such as when the app comes to the front. Never throws; offline is normal.
 */
export function flushServerPlaces(all = false): Promise<void> {
  if (sending) {
    if (all) allAfter = true;
    return sending;
  }
  sending = (async () => {
    let everything = all;
    try {
      for (;;) {
        await sendDue(Date.now(), everything);
        if (!allAfter) break;
        allAfter = false;
        everything = true;
      }
    } catch {
      // The outbox keeps the places; the next flush tries again.
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
  const due = nextPlaceDue(db);
  if (due === null) return;
  timer = setTimeout(() => void flushServerPlaces(), Math.max(1_000, due - Date.now()));
}
