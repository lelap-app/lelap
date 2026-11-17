import {
  applyRemotePlaces,
  audiobookshelfItemId,
  audiobookshelfItemProgress,
  audiobookshelfPlaces,
  type AudiobookshelfSource,
  getBook,
  listRoots,
  refreshAudiobookshelf,
  RemoteError,
  reportAudiobookshelfProgress,
  ScrobbleTracker,
  type TimelineFile,
  toBookPosition,
  tokenExpiry,
  type TrackedEvent,
  updateRemoteRoot,
} from '@lelap/core';

import { db } from './db';
import type { PlayerState } from './platform/audio';

const send = (url: string, init?: RequestInit) => fetch(url, init);

// Servers from Audiobookshelf 2.26 on hand out access tokens that last about an hour, and a
// refresh token that is kept sealed. Access tokens live only in memory and are renewed shortly
// before they run out; the rotated refresh token replaces the stored one each time.

const MARGIN_MS = 15 * 60 * 1000;
/** After a server didn't answer, it isn't asked again for this long, so playback isn't held up. */
const BACKOFF_MS = 2 * 60 * 1000;
const access = new Map<string, { token: string; obtainedAt: number; expiresAt: number }>();
const pending = new Map<string, Promise<string | null>>();
const unreachableUntil = new Map<string, number>();

type Root = ReturnType<typeof listRoots>[number];
type Server = AudiobookshelfSource & { rootId: string };

function serverOf(root: Root | undefined): Server | null {
  const remote = root?.remote;
  if (!root || remote?.type !== 'audiobookshelf' || root.needsLogin) return null;
  return { ...remote, rootId: root.id };
}

const serverById = (rootId: string | null | undefined) =>
  rootId ? serverOf(listRoots(db).find((r) => r.id === rootId)) : null;

/** Keeps an access token for a server, until shortly before it expires. */
export function rememberAccess(rootId: string, token: string): void {
  const now = Date.now();
  access.set(rootId, {
    token,
    obtainedAt: now,
    expiresAt: tokenExpiry(token) ?? now + 30 * 60 * 1000,
  });
}

/** The token to send now; empty when a refresh is due and has not happened yet. */
export function audiobookshelfBearer(rootId: string, remote: AudiobookshelfSource): string {
  if (!remote.refresh) return remote.token;
  return access.get(rootId)?.token ?? '';
}

/** Stores a server's new secret, unless it was changed meanwhile (a login entered again). */
function storeToken(server: Server, token: string): void {
  const now = serverById(server.rootId);
  if (!now || now.token !== server.token) return;
  const { rootId, ...remote } = server;
  updateRemoteRoot(db, rootId, { type: 'audiobookshelf', ...remote, token }, Date.now());
}

/**
 * The secret no longer works (an expired refresh token, a revoked API key): clearing it makes
 * Settings ask for the login again.
 */
export function loginExpired(server: Server): void {
  storeToken(server, '');
  access.delete(server.rootId);
}

async function renew(server: Server): Promise<string | null> {
  const cached = access.get(server.rootId);
  try {
    const tokens = await refreshAudiobookshelf(send, server.url, server.token);
    storeToken(server, tokens.refreshToken);
    rememberAccess(server.rootId, tokens.accessToken);
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof RemoteError && (error.status === 401 || error.status === 403)) {
      loginExpired(server);
      return null;
    }
    if (error instanceof RemoteError && error.status === 0) {
      unreachableUntil.set(server.rootId, Date.now() + BACKOFF_MS);
    }
    // Offline or the server is down: keep what we have while it lasts.
    return cached && cached.expiresAt > Date.now() ? cached.token : null;
  }
}

/** A token good for a while yet, renewing it first when needed; null when none can be had. */
export async function freshBearer(rootId: string): Promise<string | null> {
  const server = serverById(rootId);
  if (!server) return null;
  if (!server.refresh) return server.token;
  const cached = access.get(rootId);
  const now = Date.now();
  // A quarter of the token's life, for servers set to tokens shorter than an hour.
  const margin = cached ? Math.min(MARGIN_MS, (cached.expiresAt - cached.obtainedAt) / 4) : 0;
  if (cached && cached.expiresAt - now > margin) return cached.token;
  if ((unreachableUntil.get(rootId) ?? 0) > now) {
    return cached && cached.expiresAt > now ? cached.token : null;
  }
  // One renewal at a time: the server rotates the refresh token on each.
  let job = pending.get(rootId);
  if (!job) {
    job = renew(server).finally(() => pending.delete(rootId));
    pending.set(rootId, job);
  }
  return job;
}

/** The Audiobookshelf servers the streamed (not downloaded) files of these books are on. */
function streamedRoots(bookIds: string[], profile: string): Set<string> {
  const roots = new Set<string>();
  for (const bookId of bookIds) {
    for (const file of getBook(db, profile, bookId)?.files ?? []) {
      if (file.rootId && !file.downloadPath) roots.add(file.rootId);
    }
  }
  return roots;
}

/** Renews the tokens these books stream with, before their addresses are handed out. */
export async function freshAudiobookshelfTokens(bookIds: string[], profile: string): Promise<void> {
  const ids = [...streamedRoots(bookIds, profile)].filter((id) => serverById(id));
  await Promise.all(ids.map((id) => freshBearer(id).catch(() => null)));
}

/**
 * Before a book plays: renews its token and takes the place from Audiobookshelf when it is
 * newer, so a book left in Audiobookshelf's own player continues there without a rescan.
 */
export async function prepareAudiobookshelfBook(bookId: string, profile: string): Promise<void> {
  const files = getBook(db, profile, bookId)?.files ?? [];
  const server = serverById(files[0]?.rootId);
  const itemId = audiobookshelfItemId(files[0]?.location ?? '');
  if (!server || !itemId) return;
  const bearer = await freshBearer(server.rootId).catch(() => null);
  if (!bearer || server.profileId !== profile) return;
  if ((unreachableUntil.get(server.rootId) ?? 0) > Date.now()) return;
  try {
    const progress = await audiobookshelfItemProgress(send, server.url, bearer, itemId);
    if (progress) applyRemotePlaces(db, profile, audiobookshelfPlaces(progress, files), Date.now());
  } catch (error) {
    if (error instanceof RemoteError && error.status === 0) {
      unreachableUntil.set(server.rootId, Date.now() + BACKOFF_MS);
    }
  }
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
  const bearer = await freshBearer(server.rootId);
  if (!bearer) return;
  await reportAudiobookshelfProgress(send, server.url, bearer, itemId, {
    positionMs: event.positionMs,
    durationMs: parts.reduce((sum, p) => sum + Math.max(0, p.durationMs), 0),
    finished: event.event === 'finish',
  });
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
