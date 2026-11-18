import type { Manifest, Settings } from '@lelap/sdk';
import { eq } from 'drizzle-orm';

import type { Db } from '../db';
import { scrobblerSettings } from '../schema';
import { isSealed, secretBox } from '../secrets';

// The settings of a scrobbler inside the app (M61, protocol revision 8), such as the Open Library
// reading log's archive.org keys. They live in a table of their own on this device, every field
// sealed with the device's key (an access key is half a login), and reach only that add-on's
// `scrobble` calls. Nothing here is synced, exported or written to diagnostics, and nothing is
// written at all where the device can't seal it.

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

/** Thrown when the device has no key store to seal with; nothing was kept. */
export class CannotSealError extends Error {
  constructor() {
    super('This device can’t seal the settings, so they were not kept.');
  }
}

/** Keeps a scrobbler's settings, every field sealed; throws `CannotSealError` without a key store. */
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
  const box = secretBox();
  // Without a key store the values would land in the database as they are, and in backups.
  if (!box.sealing) throw new CannotSealError();
  const values: Settings = {};
  for (const field of args.manifest.settings ?? [])
    values[field.key] = args.settings[field.key] ?? '';
  const row = {
    // Kept empty: every field is sealed.
    settings: '{}',
    secret: box.seal(JSON.stringify(values)),
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
  /**
   * Enter them again: a backup restored on another phone, another file under the add-on's ID, or
   * values that were never sealed (they are wiped).
   */
  | { state: 'again' }
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
  if (!isSealed(row.secret) || row.settings !== '{}') {
    // Whatever was kept unsealed goes, so it can't sit in the database or a backup.
    if (row.secret !== '' || row.settings !== '{}')
      db.update(scrobblerSettings)
        .set({ settings: '{}', secret: '' })
        .where(eq(scrobblerSettings.url, url))
        .run();
    return { state: 'again' };
  }
  const opened = secretBox().open(row.secret);
  if (opened === null || (row.codeSha ?? null) !== codeSha) return { state: 'again' };
  return { state: 'ok', settings: parse(opened) };
}

export function removeAddonSettings(db: Db, url: string): void {
  db.delete(scrobblerSettings).where(eq(scrobblerSettings.url, url)).run();
}

/**
 * What a scrobbler's sandbox gets: the hosts in its manifest and its settings, plus `client` (the
 * User-Agent to send). `server` is a development build's stand-in for the add-on's service; only
 * then does the sandbox reach one more host, the stand-in's, with its port.
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
        const port = url.port || (url.protocol === 'https:' ? '443' : '80');
        hosts.push(`${url.hostname}:${port}`);
        out.server = url.origin;
      }
    } catch {
      // Not an address: no stand-in.
    }
  }
  return { hosts, settings: out };
}

/**
 * The stand-in a build points scrobblers at: only outside production, so a release build never
 * sends a listener's keys anywhere but the add-on's own hosts.
 */
export function scrobblerStandIn(
  nodeEnv: string | undefined,
  value: string | undefined,
): string | null {
  return nodeEnv !== 'production' && value ? value : null;
}
