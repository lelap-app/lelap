import {
  addonPlaceReport,
  addonSettings,
  addonSourceHosts,
  DEFAULT_PROFILE_ID,
  getBook,
  getProfile,
  listRoots,
  sameAddonCode,
  ScrobbleTracker,
  type TimelineFile,
  toBookPosition,
  toFilePosition,
  type TrackedEvent,
} from '@lelap/core';
import { offersPlaces } from '@lelap/sdk';

import { codeFingerprint, sourceManifest } from './addonSources';
import { db } from './db';
import type { PlayerState } from './platform/audio';
import { callAddonPlace } from './sandbox';

// Tells add-on servers that keep places (revision 6, such as Subsonic's bookmarks) where the
// listener is, at the moments the app saves its own place: on start and pause, about every five
// minutes while playing, and at the end of a book. Only for the profile that added the server.
// Best effort, as with Jellyfin: a report that fails is not retried, and the next scan settles
// any difference (the newest place wins).

const tracker = new ScrobbleTracker();

type Part = TimelineFile & { uri: string; rootId: string | null };
let timeline: { key: string; files: Part[] } | null = null;
function partsOf(bookId: string, profile: string): Part[] {
  const key = `${profile}/${bookId}`;
  if (timeline?.key !== key) timeline = { key, files: getBook(db, profile, bookId)?.files ?? [] };
  return timeline.files;
}

/** Forgets the cached parts of the playing book; a scan may have changed them. */
export function forgetAddonPlaceParts(): void {
  timeline = null;
}

function serverOf(parts: Part[], profile: string) {
  const rootId = parts[0]?.rootId;
  if (!rootId || parts.some((p) => p.rootId !== rootId)) return null;
  const root = listRoots(db).find((r) => r.id === rootId);
  const remote = root?.remote;
  if (!root || remote?.type !== 'addon' || root.needsLogin) return null;
  const owner =
    remote.profileId && getProfile(db, remote.profileId) ? remote.profileId : DEFAULT_PROFILE_ID;
  if (owner !== profile) return null;
  // Another file under the add-on's ID gets none of the login entered for the old one.
  if (!sameAddonCode(remote, codeFingerprint(remote.addonUrl))) return null;
  const manifest = sourceManifest(remote.addonUrl);
  if (!manifest || !offersPlaces(manifest)) return null;
  return { root, remote, manifest };
}

function report(events: TrackedEvent[], profile: string): void {
  for (const event of events) {
    const parts = partsOf(event.bookId, profile);
    const server = serverOf(parts, profile);
    // A file of unknown length would put the place in the wrong file.
    if (!server || parts.slice(0, -1).some((p) => p.durationMs <= 0)) continue;
    const finished = event.event === 'finish';
    const last = parts.at(-1);
    const at = finished
      ? { location: last?.location ?? '', positionMs: last?.durationMs ?? 0 }
      : toFilePosition(parts, event.positionMs);
    const place = addonPlaceReport(server.root.location, parts, {
      location: at.location,
      positionMs: at.positionMs,
      when: event.at,
      finished,
    });
    if (!place) continue;
    void callAddonPlace({
      addonUrl: server.remote.addonUrl,
      sandboxId: server.root.id,
      hosts: addonSourceHosts(server.manifest, server.remote.settings),
      settings: addonSettings(server.remote),
      place,
    }).catch(() => {});
  }
}

/** Feeds a player state; called on every state the player reports. */
export function trackAddonPlaces(state: PlayerState, profile: string): void {
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
export function addonPlacesFinished(bookId: string, at: number, profile: string): void {
  report([tracker.finished(bookId, at, 0)], profile);
}
