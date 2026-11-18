import type { Manifest, Settings } from '@lelap/sdk';
import { eq } from 'drizzle-orm';

import type { Db } from '../db';
import { scrobblerSettings } from '../schema';
import { secretBox } from '../secrets';

// The settings of a scrobbler inside the app (M61, protocol revision 8), such as the Open Library
// reading log's archive.org keys. They live in a table of their own on this device, password
// fields sealed with the device's key like a server's password, and reach only that add-on's
// `scrobble` calls. Nothing here is synced, exported or written to diagnostics.

const strings = (value: unknown): Settings =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'),
      )
    : {};

function parse(text: string): Settings {
  try {
    return strings(JSON.parse(text));
  } catch {
    return {};
  }
}

/** Keeps a scrobbler's settings, sealing its password fields. */
export function saveAddonSettings(
  db: Db,
  args: {
    url: string;
    manifest: Manifest;
    settings: Settings;
    /** The installed file's fingerprint; null for a bundled add-on. */
    codeSha: string | null;
    now: number;
  },
): void {
  const plain: Settings = {};
  const secret: Settings = {};
  for (const field of args.manifest.settings ?? []) {
    const value = args.settings[field.key] ?? '';
    if (field.type === 'password' || field.type === 'signin') secret[field.key] = value;
    else plain[field.key] = value;
  }
  const row = {
    settings: JSON.stringify(plain),
    secret: secretBox().seal(JSON.stringify(secret)),
    codeSha: args.codeSha,
    updatedAt: args.now,
  };
  db.insert(scrobblerSettings)
    .values({ url: args.url, ...row })
    .onConflictDoUpdate({ target: scrobblerSettings.url, set: row })
    .run();
}

export type StoredAddonSettings =
  | { state: 'none' }
  /** A backup restored on another phone, or another file under the add-on's ID: enter them again. */
  | { state: 'again'; settings: Settings }
  | { state: 'ok'; settings: Settings };

/**
 * A scrobbler's settings, opened. `codeSha` is the installed file's fingerprint now, or null for a
 * bundled add-on; settings entered for other code are not handed to it.
 */
export function loadAddonSettings(
  db: Db,
  url: string,
  codeSha: string | null,
): StoredAddonSettings {
  const row = db.select().from(scrobblerSettings).where(eq(scrobblerSettings.url, url)).get();
  if (!row) return { state: 'none' };
  const plain = parse(row.settings);
  const opened = secretBox().open(row.secret);
  if (opened === null || (row.codeSha ?? null) !== codeSha)
    return { state: 'again', settings: plain };
  return { state: 'ok', settings: { ...plain, ...parse(opened) } };
}

export function removeAddonSettings(db: Db, url: string): void {
  db.delete(scrobblerSettings).where(eq(scrobblerSettings.url, url)).run();
}

/**
 * What a scrobbler's sandbox gets: the hosts in its manifest and its settings, plus `client` (the
 * User-Agent to send). `server` is a development build's stand-in for the add-on's service; only
 * then does the sandbox reach one more host, the stand-in's.
 */
export function scrobblerCall(
  manifest: Manifest,
  settings: Settings,
  extra: { client: string; server?: string | null },
): { hosts: string[]; settings: Settings } {
  const hosts = [...(manifest.sandbox?.hosts ?? [])];
  const out: Settings = { ...settings, client: extra.client };
  if (extra.server) {
    try {
      const url = new URL(extra.server);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        hosts.push(url.host);
        out.server = url.origin;
      }
    } catch {
      // Not an address: no stand-in.
    }
  }
  return { hosts, settings: out };
}
