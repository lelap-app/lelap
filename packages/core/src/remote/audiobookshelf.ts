import { z } from 'zod';

import type { FileTags, ListedFile } from '../library/scan';
import { isAudioFile } from '../library/files';
import type { RemoteSource, StoredChapter } from '../schema';
import { failure, type Fetch, RemoteError } from './http';
import type { RemotePlace } from './jellyfin';

/**
 * An Audiobookshelf server used as a library, signed in with an API key (Audiobookshelf 2.26 and
 * later). The key is sealed like a password and sent as it is; there is nothing to renew.
 * `profileId` is the Lelap profile whose places sync with it.
 */
export type AudiobookshelfSource = Omit<Extract<RemoteSource, { type: 'audiobookshelf' }>, 'type'>;

const WHAT = 'Audiobookshelf server';
const PAGE = 200;
const BATCH = 50;

/** Audiobookshelf answers 401 or 403 to a key that expired, was turned off or never existed. */
function refused(status: number): RemoteError {
  if (status === 401 || status === 403) {
    return new RemoteError(
      status,
      `The Audiobookshelf server refused the API key (HTTP ${status}). Ask for a new key in Audiobookshelf.`,
    );
  }
  return failure(status, WHAT);
}

export const audiobookshelfBase = (url: string) => url.trim().replace(/\/+$/, '');

type Call = {
  method?: string;
  /** Gives up after this long, so a server out of reach doesn't hold up the player. */
  timeoutMs?: number;
  body?: unknown;
  query?: Record<string, string>;
};

async function call(
  fetcher: Fetch,
  url: string,
  bearer: string,
  path: string,
  { method = 'GET', body, query, timeoutMs = 30_000 }: Call = {},
): Promise<Response> {
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(`${audiobookshelfBase(url)}${path}${search}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearer}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    // fetch only rejects when no answer came at all: offline, a wrong address, or (in a
    // browser) a server that doesn't allow this site.
    throw new RemoteError(0, `No answer from the Audiobookshelf server (${String(error)}).`);
  } finally {
    clearTimeout(timer);
  }
}

const Progress = z.object({
  libraryItemId: z.string(),
  episodeId: z.string().nullish(),
  currentTime: z.number().nullish(),
  duration: z.number().nullish(),
  isFinished: z.boolean().nullish(),
  lastUpdate: z.number().nullish(),
  finishedAt: z.number().nullish(),
});
export type AudiobookshelfProgress = z.infer<typeof Progress>;

const Me = z.object({
  id: z.string(),
  username: z.string().nullish(),
  mediaProgress: z.array(Progress).nullish(),
});
export type AudiobookshelfMe = z.infer<typeof Me>;

/** The key's user with their places (`/api/me`); also checks the key. */
export async function audiobookshelfMe(
  fetcher: Fetch,
  url: string,
  bearer: string,
): Promise<AudiobookshelfMe> {
  const response = await call(fetcher, url, bearer, '/api/me');
  if (!response.ok) throw refused(response.status);
  const parsed = Me.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new RemoteError(200, 'That address does not answer like Audiobookshelf.');
  }
  return parsed.data;
}

/**
 * The user's place in one book, read just before it plays so a place set in Audiobookshelf's own
 * player wins without a rescan. Null when the user hasn't started it there.
 */
export async function audiobookshelfItemProgress(
  fetcher: Fetch,
  url: string,
  bearer: string,
  itemId: string,
  timeoutMs = 5_000,
): Promise<AudiobookshelfProgress | null> {
  const response = await call(
    fetcher,
    url,
    bearer,
    `/api/me/progress/${encodeURIComponent(itemId)}`,
    { timeoutMs },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw refused(response.status);
  const parsed = Progress.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

export type AudiobookshelfLibrary = { id: string; name: string };

const Libraries = z.object({
  libraries: z.array(
    z.object({ id: z.string(), name: z.string().nullish(), mediaType: z.string() }),
  ),
});

/** The user's book libraries; podcast libraries are left out (Lelap follows podcasts by RSS). */
export async function listAudiobookshelfLibraries(
  fetcher: Fetch,
  url: string,
  bearer: string,
): Promise<AudiobookshelfLibrary[]> {
  const response = await call(fetcher, url, bearer, '/api/libraries');
  if (!response.ok) throw refused(response.status);
  const { libraries } = Libraries.parse(await response.json());
  return libraries.flatMap((l) =>
    l.mediaType === 'book' ? [{ id: l.id, name: l.name ?? 'Books' }] : [],
  );
}

const n = z.number().nullish();
const s = z.string().nullish();

const Track = z.object({
  index: n,
  ino: z.string(),
  duration: n,
  startOffset: n,
  title: s,
  contentUrl: s,
  metadata: z.object({ filename: s, ext: s, relPath: s, size: n, mtimeMs: n }).nullish(),
});

export const AudiobookshelfItem = z.object({
  id: z.string(),
  path: s,
  isMissing: z.boolean().nullish(),
  addedAt: n,
  mediaType: s,
  media: z.object({
    coverPath: s,
    duration: n,
    metadata: z
      .object({ title: s, subtitle: s, authorName: s, narratorName: s, seriesName: s })
      .nullish(),
    chapters: z.array(z.object({ start: n, end: n, title: s })).nullish(),
    tracks: z.array(Track).nullish(),
  }),
});
export type AudiobookshelfItem = z.infer<typeof AudiobookshelfItem>;

const ItemPage = z.object({ results: z.array(z.object({ id: z.string() })), total: n });
const Batch = z.object({ libraryItems: z.array(AudiobookshelfItem) });

/**
 * Every book in the picked libraries, with its tracks and chapters. The library listing only
 * gives short items, so the full ones are fetched in batches.
 */
export async function listAudiobookshelfItems(
  fetcher: Fetch,
  source: Pick<AudiobookshelfSource, 'url' | 'libraryIds'>,
  bearer: string,
): Promise<AudiobookshelfItem[]> {
  const ids: string[] = [];
  for (const libraryId of source.libraryIds) {
    for (let page = 0; ; page++) {
      const response = await call(
        fetcher,
        source.url,
        bearer,
        `/api/libraries/${encodeURIComponent(libraryId)}/items`,
        { query: { limit: String(PAGE), page: String(page), minified: '1' } },
      );
      if (!response.ok) throw refused(response.status);
      const result = ItemPage.parse(await response.json());
      ids.push(...result.results.map((r) => r.id));
      const total = result.total ?? 0;
      if (result.results.length === 0 || (page + 1) * PAGE >= total) break;
    }
  }
  const items: AudiobookshelfItem[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const response = await call(fetcher, source.url, bearer, '/api/items/batch/get', {
      method: 'POST',
      body: { libraryItemIds: ids.slice(i, i + BATCH) },
    });
    if (!response.ok) throw refused(response.status);
    items.push(...Batch.parse(await response.json()).libraryItems);
  }
  return items;
}

/** `audiobookshelf:host/base`: the server's place in the library, the same on every device. */
export function audiobookshelfRootLocation(url: string): string {
  try {
    const u = new URL(audiobookshelfBase(url));
    return `audiobookshelf:${u.host}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return `audiobookshelf:${audiobookshelfBase(url)}`;
  }
}

/** The library item behind a file location (`…/<itemId>/<ino>`). */
export function audiobookshelfItemId(location: string): string | null {
  if (!location.startsWith('audiobookshelf:')) return null;
  const parts = location.split('/');
  return parts.length >= 3 ? (parts[parts.length - 2] ?? null) : null;
}

const pad = (value: number, width: number) => String(Math.max(0, value)).padStart(width, '0');
const ms = (seconds: number | null | undefined) => Math.round((seconds ?? 0) * 1000);

export type AudiobookshelfScan = {
  listed: ListedFile[];
  tags: Map<string, FileTags>;
  /** Cover image URLs by the book's location. */
  covers: Map<string, string>;
  places: RemotePlace[];
};

type Part = { location: string; startMs: number; durationMs: number };

/** The user's place in a book, as places in its parts, so `applyRemotePlaces` can merge it. */
function placesOf(progress: AudiobookshelfProgress, parts: Part[]): RemotePlace[] {
  const at = progress.lastUpdate ?? 0;
  if (progress.isFinished) {
    const finished = progress.finishedAt ?? at;
    return parts.map((p) => ({
      fileLocation: p.location,
      positionMs: 0,
      played: true,
      at: finished,
    }));
  }
  const timeMs = ms(progress.currentTime);
  if (timeMs <= 0) return [];
  const part = [...parts].reverse().find((p) => p.startMs <= timeMs) ?? parts[0];
  if (!part) return [];
  return [
    {
      fileLocation: part.location,
      positionMs: Math.min(timeMs - part.startMs, part.durationMs || Number.MAX_SAFE_INTEGER),
      played: false,
      at,
    },
  ];
}

/** The same, for a book already in the library: its files in play order. */
export function audiobookshelfPlaces(
  progress: AudiobookshelfProgress,
  files: { location: string; durationMs: number }[],
): RemotePlace[] {
  let startMs = 0;
  const parts = files.map((f) => {
    const part = { location: f.location, startMs, durationMs: Math.max(0, f.durationMs) };
    startMs += part.durationMs;
    return part;
  });
  return placesOf(progress, parts);
}

/**
 * Turns Audiobookshelf books into the files and tags a folder scan gives: each book's tracks sit
 * in a folder of their own, in play order, so the folder rules make one book of them.
 */
export function audiobookshelfScan(
  source: Pick<AudiobookshelfSource, 'url'>,
  items: AudiobookshelfItem[],
  progress: AudiobookshelfMe['mediaProgress'] = [],
): AudiobookshelfScan {
  const root = audiobookshelfRootLocation(source.url);
  const base = audiobookshelfBase(source.url);
  const listed: ListedFile[] = [];
  const tags = new Map<string, FileTags>();
  const covers = new Map<string, string>();
  const partsOf = new Map<string, Part[]>();

  for (const item of items) {
    const tracks = item.media.tracks ?? [];
    if (item.isMissing || tracks.length === 0) continue;
    const meta = item.media.metadata;
    const itemId = encodeURIComponent(item.id);
    const bookChapters = (item.media.chapters ?? []).map((c, i) => ({
      title: c.title?.trim() || `Chapter ${i + 1}`,
      startMs: ms(c.start),
    }));
    const parts: Part[] = [];
    let offset = 0;
    tracks.forEach((track, i) => {
      const startMs = track.startOffset != null ? ms(track.startOffset) : offset;
      const durationMs = ms(track.duration);
      offset = startMs + durationMs;
      const file = track.metadata?.filename ?? track.title ?? `${track.ino}`;
      const name = isAudioFile(file)
        ? file
        : `${file}.${track.metadata?.ext?.replace('.', '') || 'mp3'}`;
      const location = `${root}/${item.id}/${track.ino}`;
      parts.push({ location, startMs, durationMs });
      listed.push({
        location,
        relPath: `${item.id}/${pad(i + 1, 4)} ${name}`,
        name,
        size: track.metadata?.size ?? 0,
        modifiedAt: track.metadata?.mtimeMs ?? 0,
        uri: `${base}${track.contentUrl ?? `/api/items/${itemId}/file/${encodeURIComponent(track.ino)}`}`,
      });
      // A one-file book keeps every chapter. In a book of several files, chapters inside a file
      // would split it into a book per file, so each file is a chapter named after the one it
      // starts in.
      const own: StoredChapter[] = tracks.length === 1 ? bookChapters : [];
      const startsIn = [...bookChapters].reverse().find((c) => c.startMs <= startMs + 1000);
      tags.set(location, {
        durationMs,
        title: tracks.length === 1 ? (meta?.title ?? null) : (startsIn?.title ?? null),
        album: meta?.title ?? null,
        artist: null,
        albumArtist: meta?.authorName || null,
        coverPath: null,
        chapters: own,
      });
    });
    partsOf.set(item.id, parts);
    // Current servers send covers without a login; no token goes into an address that is stored.
    if (item.media.coverPath) covers.set(`${root}/${item.id}`, `${base}/api/items/${itemId}/cover`);
  }

  const places = (progress ?? []).flatMap((p) => {
    const parts = !p.episodeId ? partsOf.get(p.libraryItemId) : undefined;
    return parts ? placesOf(p, parts) : [];
  });
  return { listed, tags, covers, places };
}

/**
 * Where a track streams from, as the server stores it. With [headers] false (a browser's audio
 * element can't send any) the token goes in the address instead.
 */
export function audiobookshelfStream(
  bearer: string,
  uri: string,
  headers: boolean,
): { uri: string; headers: Record<string, string> } {
  if (headers) return { uri, headers: { Authorization: `Bearer ${bearer}` } };
  const sep = uri.includes('?') ? '&' : '?';
  return { uri: `${uri}${sep}token=${encodeURIComponent(bearer)}`, headers: {} };
}

/** Tells the server where the user is in a book, in seconds of the whole book, or that it is done. */
export async function reportAudiobookshelfProgress(
  fetcher: Fetch,
  url: string,
  bearer: string,
  itemId: string,
  place: { positionMs: number; durationMs: number; finished: boolean },
): Promise<void> {
  const currentTime = Math.max(0, place.positionMs) / 1000;
  const duration = Math.max(0, place.durationMs) / 1000;
  const body = place.finished
    ? { isFinished: true }
    : {
        currentTime,
        duration,
        progress: duration > 0 ? Math.min(1, currentTime / duration) : 0,
        isFinished: false,
      };
  const response = await call(
    fetcher,
    url,
    bearer,
    `/api/me/progress/${encodeURIComponent(itemId)}`,
    { method: 'PATCH', body },
  );
  if (!response.ok) throw refused(response.status);
}
