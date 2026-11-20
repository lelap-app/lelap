import type { Manifest } from '@lelap/sdk';
import { and, asc, eq, like, sql } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import {
  addons,
  books,
  localAddonCode,
  scrobblerSettings,
  profiles,
  removedAddons,
  scrobbleOutbox,
  settings,
} from '../schema';
import { type Fetcher, fetchManifest, type InstalledAddon } from './client';
import { readManifest } from './manifest';
import { pruneStreamHeaders } from './streamHeaders';

/** Installed add-ons in the user's order. Rows whose stored manifest no longer parses are skipped. */
export function listAddons(db: Db): InstalledAddon[] {
  return db
    .select()
    .from(addons)
    .orderBy(asc(addons.position))
    .all()
    .flatMap((row) => {
      let manifest: unknown;
      try {
        manifest = JSON.parse(row.manifest);
      } catch {
        return [];
      }
      const parsed = readManifest(manifest);
      return parsed.success
        ? [{ id: row.id, url: row.url, manifest: parsed.data, builtin: row.builtin }]
        : [];
    });
}

export function installAddon(
  db: Db,
  args: { url: string; manifest: Manifest; builtin?: boolean; now: number; newId: IdGenerator },
): void {
  const { url, manifest, builtin = false, now, newId } = args;
  db.transaction((tx) => {
    const last = tx
      .select({ position: sql<number>`coalesce(max(${addons.position}), -1)` })
      .from(addons)
      .get();
    tx.insert(addons)
      .values({
        id: newId(),
        url,
        manifest: JSON.stringify(manifest),
        position: (last?.position ?? -1) + 1,
        builtin,
        installedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: addons.url,
        set: { manifest: JSON.stringify(manifest), updatedAt: now },
      })
      .run();
    tx.delete(removedAddons).where(eq(removedAddons.url, url)).run();
  });
}

/**
 * Points an installed add-on at a new manifest URL, such as the one its configure page made after
 * the listener changed a setting or signed in. It keeps its place, and books, source choices,
 * profiles and unsent scrobbles follow it to the new URL.
 */
export function replaceAddonUrl(
  db: Db,
  args: { oldUrl: string; newUrl: string; manifest: Manifest; now: number },
): void {
  const { oldUrl, newUrl, manifest, now } = args;
  if (oldUrl === newUrl) {
    db.update(addons)
      .set({ manifest: JSON.stringify(manifest), updatedAt: now })
      .where(eq(addons.url, oldUrl))
      .run();
    return;
  }
  db.transaction((tx) => {
    const taken = tx.select({ id: addons.id }).from(addons).where(eq(addons.url, newUrl)).get();
    if (taken) {
      tx.delete(addons).where(eq(addons.url, oldUrl)).run();
      tx.update(addons)
        .set({ manifest: JSON.stringify(manifest), updatedAt: now })
        .where(eq(addons.url, newUrl))
        .run();
    } else {
      tx.update(addons)
        .set({ url: newUrl, manifest: JSON.stringify(manifest), updatedAt: now })
        .where(eq(addons.url, oldUrl))
        .run();
    }

    for (const book of tx
      .select({ id: books.id, addonItem: books.addonItem })
      .from(books)
      .where(eq(books.source, 'addon'))
      .all()) {
      if (book.addonItem?.addonUrl !== oldUrl) continue;
      tx.update(books)
        .set({ addonItem: { ...book.addonItem, addonUrl: newUrl }, updatedAt: now })
        .where(eq(books.id, book.id))
        .run();
    }

    for (const row of tx.select().from(settings).where(like(settings.key, 'source:%')).all()) {
      let value: unknown;
      try {
        value = JSON.parse(row.value);
      } catch {
        continue;
      }
      if (typeof value !== 'object' || value === null) continue;
      if ((value as { addonUrl?: unknown }).addonUrl !== oldUrl) continue;
      tx.update(settings)
        .set({ value: JSON.stringify({ ...value, addonUrl: newUrl }), updatedAt: now })
        .where(and(eq(settings.profileId, row.profileId), eq(settings.key, row.key)))
        .run();
    }

    for (const profile of tx.select().from(profiles).all()) {
      if (!profile.hiddenAddons.includes(oldUrl)) continue;
      const hidden = [...new Set(profile.hiddenAddons.map((u) => (u === oldUrl ? newUrl : u)))];
      tx.update(profiles)
        .set({ hiddenAddons: hidden, updatedAt: now })
        .where(eq(profiles.id, profile.id))
        .run();
    }

    tx.update(scrobbleOutbox)
      .set({ addonUrl: newUrl })
      .where(eq(scrobbleOutbox.addonUrl, oldUrl))
      .run();
  });
}

/** The installed add-on with this manifest ID, if any. */
export function findAddonById(db: Db, manifestId: string): InstalledAddon | null {
  return listAddons(db).find((a) => a.manifest.id === manifestId) ?? null;
}

/** Removes an add-on; a default one is remembered so it is not installed again. */
export function removeAddon(db: Db, url: string, now: number): void {
  db.transaction((tx) => {
    const row = tx.select().from(addons).where(eq(addons.url, url)).get();
    if (!row) return;
    tx.delete(addons).where(eq(addons.url, url)).run();
    // An add-on that ran inside the app takes its code with it, and a scrobbler its settings.
    tx.delete(localAddonCode).where(eq(localAddonCode.url, url)).run();
    tx.delete(scrobblerSettings).where(eq(scrobblerSettings.url, url)).run();
    if (row.builtin) {
      tx.insert(removedAddons)
        .values({ url, removedAt: now, updatedAt: now })
        .onConflictDoNothing()
        .run();
    }
  });
}

/**
 * Installs the default add-ons the user has not removed and refreshes every stored manifest.
 * Add-ons that cannot be reached keep their stored manifest; returns the URLs that failed.
 */
export async function syncAddons(
  db: Db,
  fetcher: Fetcher,
  defaults: string[],
  now: number,
  newId: IdGenerator,
): Promise<string[]> {
  const removed = new Set(
    db
      .select()
      .from(removedAddons)
      .all()
      .map((r) => r.url),
  );
  const installed = db.select({ url: addons.url, builtin: addons.builtin }).from(addons).all();
  const builtin = new Map(installed.map((a) => [a.url, a.builtin]));
  const urls = [
    ...defaults.filter((url) => !removed.has(url) && !builtin.has(url)),
    ...installed.map((a) => a.url),
  ];
  // Run on every start, so rows a device left behind with foreign keys off don't stay.
  try {
    pruneStreamHeaders(db);
  } catch {
    // Tidying only: the add-ons still sync.
  }
  const failed: string[] = [];
  // In order, so defaults keep their configured order on first start.
  for (const url of urls) {
    try {
      const manifest = await fetchManifest(fetcher, url);
      installAddon(db, { url, manifest, builtin: builtin.get(url) ?? true, now, newId });
    } catch {
      failed.push(url);
    }
  }
  return failed;
}
