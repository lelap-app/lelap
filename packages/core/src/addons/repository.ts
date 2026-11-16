import { Manifest } from '@lelap/sdk';
import { asc, eq, sql } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { addons, removedAddons } from '../schema';
import { type Fetcher, fetchManifest, type InstalledAddon } from './client';

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
      const parsed = Manifest.safeParse(manifest);
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

/** Removes an add-on; a default one is remembered so it is not installed again. */
export function removeAddon(db: Db, url: string, now: number): void {
  db.transaction((tx) => {
    const row = tx.select().from(addons).where(eq(addons.url, url)).get();
    if (!row) return;
    tx.delete(addons).where(eq(addons.url, url)).run();
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
