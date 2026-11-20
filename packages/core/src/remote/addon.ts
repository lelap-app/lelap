import {
  applySignin,
  type LibraryResponse,
  type LocateRequest,
  type LocateResponse,
  type Manifest,
  normalizeIds,
  type PlaceReport,
  type QueryParams,
  type RequestHeaders,
  settingHosts,
  type Settings,
} from '@lelap/sdk';

import { hostAllowed } from '../addons/local';
import type { FileTags, ListedFile, ServerKinds } from '../library/scan';
import { formatSeries } from '../library/seriesNames';
import type { RemoteSource } from '../schema';
import type { RemotePlace } from './jellyfin';

// An add-on inside the app used as a library source (M57). Its settings and the headers it asks
// for stay on the phone, sealed like a server's password, and go only to its own hosts: those in
// its manifest and those of the addresses the listener typed into its form.

export type AddonSource = Extract<RemoteSource, { type: 'addon' }>;

/**
 * What is sealed: the password and sign-in fields, and the headers and query parameters the library
 * last asked for (a Subsonic server's token is in the address; `webQuery` stands in for the headers
 * where the app can't send any).
 */
export type AddonLogin = {
  passwords: Settings;
  headers: RequestHeaders;
  query: QueryParams;
  webQuery: QueryParams;
};

const EMPTY_LOGIN: AddonLogin = { passwords: {}, headers: {}, query: {}, webQuery: {} };

export const addonRootLocation = (key: string) => `addon-source:${key}`;

const strings = (value: unknown): Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'),
      )
    : {};

/** The opened login; empty when there is none or this device can't open it. */
export function addonLogin(remote: AddonSource): AddonLogin {
  if (!remote.secret) return EMPTY_LOGIN;
  try {
    const parsed = JSON.parse(remote.secret) as {
      passwords?: unknown;
      headers?: unknown;
      query?: unknown;
      webQuery?: unknown;
    };
    return {
      passwords: strings(parsed.passwords),
      headers: strings(parsed.headers),
      query: strings(parsed.query),
      webQuery: strings(parsed.webQuery),
    };
  } catch {
    return EMPTY_LOGIN;
  }
}

export const withAddonLogin = (remote: AddonSource, login: AddonLogin): AddonSource => ({
  ...remote,
  secret: JSON.stringify(login),
});

/** Every setting the add-on's `library` call gets: the plain fields and the passwords. */
export const addonSettings = (remote: AddonSource): Settings => ({
  ...remote.settings,
  ...addonLogin(remote).passwords,
});

/**
 * A new or changed add-on server from the listener's form, with password and sign-in fields kept
 * apart so they are sealed.
 */
export function addonSource(args: {
  addonUrl: string;
  manifest: Manifest;
  key: string;
  settings: Settings;
  headers?: RequestHeaders;
  query?: QueryParams;
  webQuery?: QueryParams;
  /** The installed file's fingerprint; leave it out for a bundled add-on. */
  codeSha?: string;
  /** The profile whose places are kept with the server, for an add-on that keeps them. */
  profileId?: string;
}): AddonSource {
  const fields = args.manifest.settings ?? [];
  const secret = new Set(
    fields.filter((f) => f.type === 'password' || f.type === 'signin').map((f) => f.key),
  );
  const plain: Settings = {};
  const passwords: Settings = {};
  for (const field of fields) {
    const value = args.settings[field.key] ?? '';
    if (secret.has(field.key)) passwords[field.key] = value;
    else plain[field.key] = value;
  }
  const [host] = settingHosts(fields, plain);
  return {
    type: 'addon',
    addonUrl: args.addonUrl,
    key: args.key,
    name: host ? `${args.manifest.name} · ${host}` : args.manifest.name,
    settings: plain,
    secret: JSON.stringify({
      passwords,
      headers: args.headers ?? {},
      query: args.query ?? {},
      webQuery: args.webQuery ?? {},
    }),
    ...(args.codeSha ? { codeSha: args.codeSha } : {}),
    ...(args.profileId ? { profileId: args.profileId } : {}),
  };
}

/**
 * Whether the add-on's code is still the one the login was entered for: `current` is the
 * installed file's fingerprint, or null for a bundled add-on (it comes with the app).
 */
export const sameAddonCode = (remote: AddonSource, current: string | null): boolean =>
  (remote.codeSha ?? null) === current;

/** The hosts this server's add-on may reach: its manifest's and those its settings grant. */
export function addonSourceHosts(manifest: Manifest, settings: Settings): string[] {
  return [...(manifest.sandbox?.hosts ?? []), ...settingHosts(manifest.settings ?? [], settings)];
}

/**
 * The headers to send with a request for `url`: all of them when it goes to one of the add-on's
 * hosts, none otherwise, so a login never follows a link somewhere else.
 */
export function headersFor(
  url: string,
  headers: Record<string, string>,
  hosts: string[],
): Record<string, string> {
  if (Object.keys(headers).length === 0 || !hostAllowed(url, hosts)) return {};
  return { ...headers };
}

/**
 * `url` with the login's query parameters added, when it goes to one of the add-on's hosts; as it
 * is otherwise. Parameters the address already has are replaced, so a stored address can't pin
 * another login.
 */
export function withQuery(url: string, query: Record<string, string>, hosts: string[]): string {
  if (Object.keys(query).length === 0 || !hostAllowed(url, hosts)) return url;
  const parsed = new URL(url);
  for (const [name, value] of Object.entries(query)) parsed.searchParams.set(name, value);
  return parsed.href;
}

/**
 * How the app fetches one of an add-on server's files: the stored address with the login's query
 * added, and its headers, both only on the add-on's own hosts. Where the app can't send headers
 * (`canSendHeaders` false: a browser's audio element), the library's `webQuery` (revision 7) goes
 * into the address instead. `private`: the address carries a login, so it goes nowhere else.
 */
export function addonFileAccess(
  uri: string,
  login: Pick<AddonLogin, 'headers' | 'query' | 'webQuery'>,
  hosts: string[],
  canSendHeaders: boolean,
): { uri: string; headers: Record<string, string>; private?: true } {
  const instead = !canSendHeaders && Object.keys(login.webQuery).length > 0;
  const query = instead ? { ...login.query, ...login.webQuery } : login.query;
  const address = withQuery(uri, query, hosts);
  return {
    uri: address,
    headers: instead ? {} : headersFor(uri, login.headers, hosts),
    ...(address !== uri ? { private: true as const } : {}),
  };
}

/**
 * The one set of headers that plays a book's files. The player and the downloader send one set
 * for the whole book, so when its files don't all get the same headers, none are sent.
 */
export function sharedHeaders(
  access: { headers: Record<string, string> }[],
): Record<string, string> {
  const [first] = access;
  if (!first) return {};
  const key = (h: Record<string, string>) => JSON.stringify(Object.entries(h).sort());
  const wanted = key(first.headers);
  return access.every((a) => key(a.headers) === wanted) ? first.headers : {};
}

export type AddonScan = {
  listed: ListedFile[];
  /** For files the add-on gave a length for; the rest are read like a WebDAV server's. */
  tags: Map<string, FileTags>;
  /** Tags given for a file that is read anyway, for what its own tags lack (see `fillTags`). */
  hints: Map<string, TagHints>;
  /** Cover addresses by book location: the folder's, and the file's for a single-file book. */
  covers: Map<string, string>;
  /** Files and covers left out because they point at a host the add-on may not reach. */
  refused: number;
  /** The listener's places as the source keeps them, by file location (revision 6). */
  places: RemotePlace[];
  /** What the add-on says about each file's book (revision 12): series, description, language. */
  kinds: Map<string, ServerKinds>;
};

/**
 * Turns an add-on's library listing into the shape a folder scan has. Only addresses on the
 * add-on's own hosts are kept: anything the app fetches for it, a file or a cover, could otherwise
 * carry its settings to somewhere else.
 */
export function addonLibraryScan(
  rootLocation: string,
  response: LibraryResponse,
  hosts: string[],
): AddonScan {
  const listed: ListedFile[] = [];
  const tags = new Map<string, FileTags>();
  const hints = new Map<string, TagHints>();
  const covers = new Map<string, string>();
  const places: RemotePlace[] = [];
  const kinds = new Map<string, ServerKinds>();
  const seen = new Set<string>();
  let refused = 0;
  for (const file of response.files) {
    if (!hostAllowed(file.url, hosts)) {
      refused++;
      continue;
    }
    // A download address elsewhere would get the login too; the file then downloads from `url`.
    const downloadUri =
      file.downloadUrl && hostAllowed(file.downloadUrl, hosts) ? file.downloadUrl : null;
    const location = `${rootLocation}/${file.path}`;
    if (seen.has(location)) continue;
    seen.add(location);
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    listed.push({
      location,
      relPath: file.path,
      name,
      size: file.size ?? 0,
      modifiedAt: file.modifiedAt ?? 0,
      uri: file.url,
      ...(downloadUri ? { downloadUri } : {}),
      ...(file.ref ? { ref: file.ref } : {}),
    });
    const kind = serverKinds(file);
    if (kind) kinds.set(location, kind);
    if (file.place) {
      places.push({
        fileLocation: location,
        positionMs: file.place.positionMs,
        played: file.place.played === true,
        at: file.place.at,
      });
    }
    if (file.durationMs !== undefined) {
      tags.set(location, {
        durationMs: file.durationMs,
        title: file.title ?? null,
        album: file.album ?? null,
        artist: file.artist ?? null,
        albumArtist: file.albumArtist ?? null,
        coverPath: null,
        chapters: file.chapters ?? [],
        ids: file.ids ? normalizeIds(file.ids) : null,
      });
    } else if (file.title || file.album || file.artist || file.albumArtist || file.ids) {
      hints.set(location, {
        title: file.title ?? null,
        album: file.album ?? null,
        artist: file.artist ?? null,
        albumArtist: file.albumArtist ?? null,
        ids: file.ids ? normalizeIds(file.ids) : null,
      });
    }
    if (file.cover) {
      if (!hostAllowed(file.cover, hosts)) {
        refused++;
        continue;
      }
      const folder = location.slice(0, location.lastIndexOf('/'));
      if (!covers.has(folder)) covers.set(folder, file.cover);
      covers.set(location, file.cover);
    }
  }
  return { listed, tags, hints, covers, refused, places, kinds };
}

/** The series, description and language a library file names, or null when it names none. */
function serverKinds(file: LibraryResponse['files'][number]): ServerKinds | null {
  const kind: ServerKinds = {};
  const series = formatSeries(file.series);
  if (series) kind.series = series;
  const description = file.description?.trim();
  if (description) kind.description = description;
  const language = file.language?.trim();
  if (language) kind.language = language;
  return Object.keys(kind).length > 0 ? kind : null;
}

export type TagHints = Pick<FileTags, 'title' | 'album' | 'artist' | 'albumArtist' | 'ids'>;

/**
 * A file's own tags, with the add-on's for what they lack: a browser reads only the length, so
 * without these the first file of a Subsonic or Plex book would be named after its file.
 */
export function fillTags(read: FileTags, hints: TagHints | undefined): FileTags {
  if (!hints) return read;
  return {
    ...read,
    title: read.title ?? hints.title,
    album: read.album ?? hints.album,
    artist: read.artist ?? hints.artist,
    albumArtist: read.albumArtist ?? hints.albumArtist,
    ...(read.ids || hints.ids ? { ids: read.ids ?? hints.ids ?? null } : {}),
  };
}

/**
 * What the add-on's `place` handler gets when the listener is at `positionMs` in the book's file
 * at `location` (revision 6): that file and every file of the book, by the path the library listed
 * them under and the address without the login. Null when the files are not this server's.
 */
export function addonPlaceReport(
  rootLocation: string,
  files: { location: string; uri: string; durationMs?: number; ref?: string | null }[],
  at: { location: string; positionMs: number; when: number; finished: boolean },
): PlaceReport | null {
  const prefix = `${rootLocation}/`;
  const listed = files.flatMap((f) =>
    f.location.startsWith(prefix)
      ? [
          {
            location: f.location,
            path: f.location.slice(prefix.length),
            url: f.uri,
            // Revision 12: the length the app knows and the add-on's own note.
            ...(f.durationMs !== undefined && f.durationMs > 0
              ? { durationMs: Math.round(f.durationMs) }
              : {}),
            ...(f.ref ? { ref: f.ref } : {}),
          },
        ]
      : [],
  );
  if (listed.length === 0 || listed.length !== files.length) return null;
  const current = listed.find((f) => f.location === at.location);
  if (!current) return null;
  const strip = (f: (typeof listed)[number]) => {
    const { location, ...reported } = f;
    void location;
    return reported;
  };
  return {
    file: strip(current),
    files: listed.map(strip),
    positionMs: Math.max(0, Math.round(at.positionMs)),
    at: at.when,
    finished: at.finished,
  };
}

/**
 * The server with the settings a library listing handed back (revision 11), such as a Plex
 * server's new address; null when nothing changes. They are taken like a sign-in's: for the
 * form's own fields, and address fields that grant a host only with `hosts`, which the app gives
 * the add-ons that come with it. A name the app made from the old address follows the new one.
 */
export function withListedSettings(
  remote: AddonSource,
  manifest: Manifest,
  listed: LibraryResponse['settings'],
  options: { hosts: boolean },
): AddonSource | null {
  if (!listed) return null;
  const fields = manifest.settings ?? [];
  const current = addonSettings(remote);
  const next = applySignin(fields, current, { settings: listed }, { hosts: options.hosts });
  if (fields.every((f) => (next[f.key] ?? '') === (current[f.key] ?? ''))) return null;
  const login = addonLogin(remote);
  const rebuild = (settings: Settings) =>
    addonSource({
      addonUrl: remote.addonUrl,
      manifest,
      key: remote.key,
      settings,
      headers: login.headers,
      query: login.query,
      webQuery: login.webQuery,
      ...(remote.codeSha ? { codeSha: remote.codeSha } : {}),
      ...(remote.profileId ? { profileId: remote.profileId } : {}),
    });
  const updated = rebuild(next);
  const named = remote.name === rebuild(current).name;
  return { ...remote, ...updated, name: named ? updated.name : remote.name };
}

/**
 * What the add-on's `locate` handler gets before a book streams (revision 11): the book's files by
 * the path the library listed them under and their listed address. Null when the files are not
 * all this server's.
 */
export function addonLocateRequest(
  rootLocation: string,
  files: { location: string; uri: string }[],
): LocateRequest | null {
  const prefix = `${rootLocation}/`;
  if (files.length === 0 || files.some((f) => !f.location.startsWith(prefix))) return null;
  return { files: files.map((f) => ({ path: f.location.slice(prefix.length), url: f.uri })) };
}

/**
 * Where each listed address streams from now, by the address it was listed with, from the add-on's
 * `locate` answer: the new address, or null for a file it left out or moved off its own hosts,
 * which then streams without the login.
 */
export function locatedAddresses(
  request: LocateRequest,
  response: LocateResponse,
  hosts: string[],
): Map<string, string | null> {
  const byPath = new Map(response.files.map((f) => [f.path, f.url]));
  const located = new Map<string, string | null>();
  for (const file of request.files) {
    const url = byPath.get(file.path);
    located.set(file.url, url !== undefined && hostAllowed(url, hosts) ? url : null);
  }
  return located;
}
