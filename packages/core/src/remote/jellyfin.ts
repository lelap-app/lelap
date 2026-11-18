import { idsFromTags } from '@lelap/sdk';
import { z } from 'zod';

import type { FileTags, ListedFile } from '../library/scan';
import { isAudioFile } from '../library/files';
import type { RemoteSource, StoredChapter } from '../schema';
import { failure, type Fetch, RemoteError } from './http';

/**
 * A Jellyfin server used as a library. Only the access token is kept, never the password; the
 * token is tied to `deviceId`, so signing in again on this device replaces it. `libraryIds` are
 * the libraries the user picked; `profileId` is the Lelap profile whose places sync with it.
 */
export type JellyfinSource = Omit<Extract<RemoteSource, { type: 'jellyfin' }>, 'type'>;

export const JELLYFIN_CLIENT = 'Lelap';
/** Jellyfin counts time in ticks of 100 ns. */
const TICKS_PER_MS = 10_000;
const PAGE = 500;

export const jellyfinBase = (url: string) => url.trim().replace(/\/+$/, '');

const quoted = (value: string) => `"${value.replace(/["\\,]/g, '_')}"`;

/** The `Authorization` header Jellyfin wants on every call: who the client is, and its token. */
export function jellyfinAuthorization(deviceId: string, token?: string, version = '1'): string {
  const parts = [
    `Client=${quoted(JELLYFIN_CLIENT)}`,
    `Device=${quoted(JELLYFIN_CLIENT)}`,
    `DeviceId=${quoted(deviceId)}`,
    `Version=${quoted(version)}`,
  ];
  if (token) parts.push(`Token=${quoted(token)}`);
  return `MediaBrowser ${parts.join(', ')}`;
}

export const jellyfinHeaders = (source: Pick<JellyfinSource, 'deviceId' | 'token'>) => ({
  Authorization: jellyfinAuthorization(source.deviceId, source.token),
});

type Call = { method?: string; body?: unknown; query?: Record<string, string> };

async function call(
  fetcher: Fetch,
  source: Pick<JellyfinSource, 'url' | 'deviceId' | 'token'>,
  path: string,
  { method = 'GET', body, query }: Call = {},
): Promise<Response> {
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  let response: Response;
  try {
    response = await fetcher(`${jellyfinBase(source.url)}${path}${search}`, {
      method,
      headers: {
        ...jellyfinHeaders(source),
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    // fetch only rejects when no answer came at all: offline, a wrong address, or (in a
    // browser) a server that doesn't allow this site.
    throw new RemoteError(0, `No answer from the Jellyfin server (${String(error)}).`);
  }
  return response;
}

/**
 * Jellyfin 10.9 moved user routes (`/Users/{id}/Views` → `/UserViews?userId=`); older servers only
 * know the old ones. Tries the new route, then the old one on 404.
 */
async function callEither(
  fetcher: Fetch,
  source: Pick<JellyfinSource, 'url' | 'deviceId' | 'token'>,
  paths: [string, string],
  init: Call = {},
): Promise<Response> {
  const first = await call(fetcher, source, paths[0], init);
  if (first.status !== 404) return first;
  // The old routes carry the user in the path, not the query.
  return call(fetcher, source, paths[1], {
    ...(init.method !== undefined ? { method: init.method } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
}

const AuthResult = z.object({
  AccessToken: z.string(),
  User: z.object({ Id: z.string(), Name: z.string().nullish() }),
});

/** Signs in with a username and password; returns the token to keep (the password is not). */
export async function signInJellyfin(
  fetcher: Fetch,
  login: { url: string; username: string; password: string; deviceId: string },
): Promise<{ userId: string; token: string }> {
  const response = await call(fetcher, { ...login, token: '' }, '/Users/AuthenticateByName', {
    method: 'POST',
    body: { Username: login.username, Pw: login.password },
  });
  if (!response.ok) throw failure(response.status, 'Jellyfin server');
  const parsed = AuthResult.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new RemoteError(200, 'That address does not answer like Jellyfin.');
  return { userId: parsed.data.User.Id, token: parsed.data.AccessToken };
}

export type JellyfinLibrary = {
  id: string;
  name: string;
  kind: 'books' | 'music';
};

const Views = z.object({
  Items: z.array(
    z.object({ Id: z.string(), Name: z.string().nullish(), CollectionType: z.string().nullish() }),
  ),
});

/** The user's book and music libraries; other kinds (films, shows) are left out. */
export async function listJellyfinLibraries(
  fetcher: Fetch,
  source: Pick<JellyfinSource, 'url' | 'deviceId' | 'token' | 'userId'>,
): Promise<JellyfinLibrary[]> {
  const userId = encodeURIComponent(source.userId);
  const response = await callEither(fetcher, source, ['/UserViews', `/Users/${userId}/Views`], {
    query: { userId: source.userId },
  });
  if (!response.ok) throw failure(response.status, 'Jellyfin server');
  const views = Views.parse(await response.json());
  return views.Items.flatMap((v) => {
    const kind =
      v.CollectionType === 'books' ? 'books' : v.CollectionType === 'music' ? 'music' : null;
    return kind ? [{ id: v.Id, name: v.Name ?? kind, kind }] : [];
  });
}

const n = z.number().nullish();
const s = z.string().nullish();

export const JellyfinItem = z.object({
  Id: z.string(),
  Name: s,
  Type: s,
  Album: s,
  AlbumId: s,
  AlbumArtist: s,
  Artists: z.array(z.string()).nullish(),
  ParentId: s,
  IndexNumber: n,
  ParentIndexNumber: n,
  RunTimeTicks: n,
  Container: s,
  Path: s,
  DateCreated: s,
  ImageTags: z.record(z.string(), z.string()).nullish(),
  AlbumPrimaryImageTag: s,
  People: z.array(z.object({ Name: s, Type: s, Role: s })).nullish(),
  Chapters: z.array(z.object({ Name: s, StartPositionTicks: n })).nullish(),
  MediaSources: z.array(z.object({ Size: n, Container: s })).nullish(),
  ProviderIds: z.record(z.string(), z.string().nullish()).nullish(),
  Genres: z.array(z.string()).nullish(),
  ProductionYear: n,
  UserData: z
    .object({ PlaybackPositionTicks: n, Played: z.boolean().nullish(), LastPlayedDate: s })
    .nullish(),
});
export type JellyfinItem = z.infer<typeof JellyfinItem>;

const ItemPage = z.object({ Items: z.array(JellyfinItem), TotalRecordCount: n });

const ITEM_FIELDS =
  'Path,Chapters,People,MediaSources,DateCreated,ParentId,ProviderIds,Genres,ProductionYear';

/** Every audio item in the picked libraries, with chapters, people and the user's place. */
export async function listJellyfinItems(
  fetcher: Fetch,
  source: JellyfinSource,
): Promise<JellyfinItem[]> {
  const items: JellyfinItem[] = [];
  for (const libraryId of source.libraryIds) {
    for (let start = 0; ; start += PAGE) {
      const response = await call(fetcher, source, '/Items', {
        query: {
          userId: source.userId,
          ParentId: libraryId,
          Recursive: 'true',
          IncludeItemTypes: 'Audio,AudioBook',
          Fields: ITEM_FIELDS,
          EnableUserData: 'true',
          SortBy: 'SortName',
          StartIndex: String(start),
          Limit: String(PAGE),
        },
      });
      if (!response.ok) throw failure(response.status, 'Jellyfin server');
      const page = ItemPage.parse(await response.json());
      items.push(...page.Items);
      const total = page.TotalRecordCount ?? 0;
      if (page.Items.length === 0 || start + page.Items.length >= total) break;
    }
  }
  return items;
}

/** `jellyfin:host/base`: the server's place in the library, the same on every device. */
export function jellyfinRootLocation(url: string): string {
  try {
    const u = new URL(jellyfinBase(url));
    return `jellyfin:${u.host}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return `jellyfin:${jellyfinBase(url)}`;
  }
}

/** The item behind a file location (`…/<group>/<itemId>`). */
export function jellyfinItemId(location: string): string | null {
  if (!location.startsWith('jellyfin:')) return null;
  return location.slice(location.lastIndexOf('/') + 1) || null;
}

/** A path's last folder or file name (`from` 2: the one above), with `/` or `\` between. */
export const lastSegment = (path: string | null | undefined, from = 1): string | null => {
  const parts = (path ?? '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - from] ?? null;
};

const pad = (value: number | null | undefined, width: number) =>
  String(Math.max(0, value ?? 0)).padStart(width, '0');

const peopleOf = (item: JellyfinItem, types: string[]) =>
  (item.People ?? [])
    .filter((p) => p.Name && types.includes(p.Type ?? ''))
    .map((p) => p.Name as string);

/** Authors and narrators as Jellyfin lists them; narrators often sit in the composer tag. */
export function jellyfinPeople(item: JellyfinItem): { authors: string[]; narrators: string[] } {
  const authors = peopleOf(item, ['Author', 'Writer']);
  const narrators = peopleOf(item, ['Narrator', 'Composer']);
  return {
    authors:
      authors.length > 0 ? authors : [item.AlbumArtist ?? item.Artists?.[0] ?? ''].filter(Boolean),
    narrators,
  };
}

function fileName(item: JellyfinItem): string {
  const base = lastSegment(item.Path);
  if (base && isAudioFile(base)) return base;
  const container = (item.MediaSources?.[0]?.Container ?? item.Container ?? '').split(',');
  const ext = container.find((c) => isAudioFile(`x.${c}`)) ?? 'mp3';
  return `${base ?? item.Name ?? item.Id}.${ext}`;
}

const msOf = (ticks: number | null | undefined) => Math.round((ticks ?? 0) / TICKS_PER_MS);

/** A place on the server: where the user is in one item, and when they were last there. */
export type RemotePlace = {
  fileLocation: string;
  positionMs: number;
  played: boolean;
  /** 0 when the server doesn't say. */
  at: number;
};

export type JellyfinScan = {
  listed: ListedFile[];
  tags: Map<string, FileTags>;
  /** Cover image URLs by the book's location. */
  covers: Map<string, string>;
  places: RemotePlace[];
};

/** ISBNs and ASINs among an item's provider IDs; the Audible plugins keep the ASIN as `Audible`. */
function providerIds(ids: JellyfinItem['ProviderIds']): string[] {
  const named: Record<string, string | null | undefined> = {};
  for (const [key, value] of Object.entries(ids ?? {})) {
    named[key.toLowerCase() === 'audible' ? 'asin' : key] = value;
  }
  return idsFromTags(named);
}

/**
 * Turns Jellyfin items into the same files and tags a folder scan gives, so the same rules make
 * books: items of one album (music) or one folder (books) form one book.
 */
export function jellyfinScan(
  source: Pick<JellyfinSource, 'url'>,
  items: JellyfinItem[],
): JellyfinScan {
  const root = jellyfinRootLocation(source.url);
  const base = jellyfinBase(source.url);
  const listed: ListedFile[] = [];
  const tags = new Map<string, FileTags>();
  const covers = new Map<string, string>();
  const places: RemotePlace[] = [];
  for (const item of items) {
    const group = item.AlbumId ?? item.ParentId ?? item.Id;
    const name = fileName(item);
    const location = `${root}/${group}/${item.Id}`;
    // Disc and track first, so a book's parts sort in play order whatever the file names.
    const relPath = `${group}/${pad(item.ParentIndexNumber, 3)}-${pad(item.IndexNumber, 4)} ${name}`;
    const created = Date.parse(item.DateCreated ?? '');
    listed.push({
      location,
      relPath,
      name,
      size: item.MediaSources?.[0]?.Size ?? 0,
      modifiedAt: Number.isFinite(created) ? created : 0,
      uri: `${base}/Audio/${encodeURIComponent(item.Id)}/stream?static=true`,
    });
    const { authors, narrators } = jellyfinPeople(item);
    const chapters: StoredChapter[] = (item.Chapters ?? []).map((c, i) => ({
      title: c.Name?.trim() || `Chapter ${i + 1}`,
      startMs: msOf(c.StartPositionTicks),
    }));
    tags.set(location, {
      durationMs: msOf(item.RunTimeTicks),
      title: item.Name ?? null,
      // Without an album tag the book is named after its folder on the server.
      album: item.Album ?? lastSegment(item.Path, 2) ?? item.Name ?? null,
      artist: item.Artists?.join(', ') || null,
      albumArtist: authors.join(', ') || null,
      coverPath: null,
      chapters,
      ids: providerIds(item.ProviderIds),
      // For the “looks like music” suggestions (M77); an AudioBook item is never suggested.
      kindTags: {
        genre: item.Genres?.join(', ') || null,
        isrc: null,
        track: item.IndexNumber != null ? String(item.IndexNumber) : null,
        year: item.ProductionYear != null ? String(item.ProductionYear) : null,
        narrator: narrators.join(', ') || null,
        mediaKind: item.Type === 'AudioBook' ? 'audiobook' : null,
      },
    });
    const cover = item.ImageTags?.Primary
      ? item.Id
      : item.AlbumId && item.AlbumPrimaryImageTag
        ? item.AlbumId
        : null;
    if (cover) {
      const url = `${base}/Items/${encodeURIComponent(cover)}/Images/Primary?maxHeight=600`;
      // Both the folder book and a single-file book from this item can use it.
      if (!covers.has(`${root}/${group}`)) covers.set(`${root}/${group}`, url);
      covers.set(location, url);
    }
    const data = item.UserData;
    if (data && (data.Played || (data.PlaybackPositionTicks ?? 0) > 0)) {
      const at = Date.parse(data.LastPlayedDate ?? '');
      places.push({
        fileLocation: location,
        positionMs: msOf(data.PlaybackPositionTicks),
        played: data.Played === true,
        at: Number.isFinite(at) ? at : 0,
      });
    }
  }
  return { listed, tags, covers, places };
}

/**
 * Where an item streams from: the original file, never transcoded. With [headers] false (a
 * browser's audio element can't send any) the token goes in the address instead.
 */
export function jellyfinStream(
  source: Pick<JellyfinSource, 'deviceId' | 'token'>,
  uri: string,
  headers: boolean,
): { uri: string; headers: Record<string, string> } {
  if (headers) return { uri, headers: jellyfinHeaders(source) };
  const sep = uri.includes('?') ? '&' : '?';
  return { uri: `${uri}${sep}api_key=${encodeURIComponent(source.token)}`, headers: {} };
}

/** Tells the server where the user is in an item (on pause and every few minutes). */
export async function reportJellyfinProgress(
  fetcher: Fetch,
  source: JellyfinSource,
  itemId: string,
  positionMs: number,
  state: 'start' | 'progress' | 'pause',
): Promise<void> {
  const response = await call(
    fetcher,
    source,
    state === 'start' ? '/Sessions/Playing' : '/Sessions/Playing/Progress',
    {
      method: 'POST',
      body: {
        ItemId: itemId,
        PositionTicks: Math.max(0, Math.round(positionMs)) * TICKS_PER_MS,
        IsPaused: state === 'pause',
        CanSeek: true,
        PlayMethod: 'DirectPlay',
      },
    },
  );
  if (!response.ok) throw failure(response.status, 'Jellyfin server');
}

/** Marks an item played for the user. */
export async function markJellyfinPlayed(
  fetcher: Fetch,
  source: JellyfinSource,
  itemId: string,
): Promise<void> {
  const id = encodeURIComponent(itemId);
  const userId = encodeURIComponent(source.userId);
  const response = await callEither(
    fetcher,
    source,
    [`/UserPlayedItems/${id}`, `/Users/${userId}/PlayedItems/${id}`],
    { method: 'POST', query: { userId: source.userId } },
  );
  if (!response.ok) throw failure(response.status, 'Jellyfin server');
}
