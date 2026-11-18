import {
  type LibraryResponse,
  type Manifest,
  normalizeIds,
  type RequestHeaders,
  settingHosts,
  type Settings,
} from '@lelap/sdk';

import { hostAllowed } from '../addons/local';
import type { FileTags, ListedFile } from '../library/scan';
import type { RemoteSource } from '../schema';

// An add-on inside the app used as a library source (M57). Its settings and the headers it asks
// for stay on the phone, sealed like a server's password, and go only to its own hosts: those in
// its manifest and those of the addresses the listener typed into its form.

export type AddonSource = Extract<RemoteSource, { type: 'addon' }>;

/** What is sealed: the password fields and the headers the library last asked for. */
export type AddonLogin = { passwords: Settings; headers: RequestHeaders };

const EMPTY_LOGIN: AddonLogin = { passwords: {}, headers: {} };

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
    const parsed = JSON.parse(remote.secret) as { passwords?: unknown; headers?: unknown };
    return { passwords: strings(parsed.passwords), headers: strings(parsed.headers) };
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
 * A new or changed add-on server from the listener's form, with password fields kept apart so
 * they are sealed.
 */
export function addonSource(args: {
  addonUrl: string;
  manifest: Manifest;
  key: string;
  settings: Settings;
  headers?: RequestHeaders;
  /** The installed file's fingerprint; leave it out for a bundled add-on. */
  codeSha?: string;
}): AddonSource {
  const fields = args.manifest.settings ?? [];
  const secret = new Set(fields.filter((f) => f.type === 'password').map((f) => f.key));
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
    secret: JSON.stringify({ passwords, headers: args.headers ?? {} }),
    ...(args.codeSha ? { codeSha: args.codeSha } : {}),
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
  /** Cover addresses by book location: the folder's, and the file's for a single-file book. */
  covers: Map<string, string>;
  /** Files and covers left out because they point at a host the add-on may not reach. */
  refused: number;
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
  const covers = new Map<string, string>();
  const seen = new Set<string>();
  let refused = 0;
  for (const file of response.files) {
    if (!hostAllowed(file.url, hosts)) {
      refused++;
      continue;
    }
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
    });
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
  return { listed, tags, covers, refused };
}
