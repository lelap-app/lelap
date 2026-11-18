import { z } from 'zod';

import { listAddons } from './addons/repository';
import type { Db } from './db';
import type { IdGenerator } from './ids';
import { applyOps, collectOps, type Op } from './sync/ops';

// A full export is the same set of changes sync sends, unencrypted, plus the installed add-ons.
// Importing applies them like a sync from another device: per row, the newer change wins, so an
// import merges with what is already here instead of replacing it.

export const BACKUP_FORMAT = 'lelap-library';

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: number;
  /** Manifest URLs of the add-ons that were installed, built-in ones left out. */
  addons: string[];
  changes: Op[];
};

/**
 * Everything on this device: profiles, places, bookmarks, lists, tags, hidden books,
 * subscriptions, add-ons.
 */
export function exportLibrary(db: Db, now: number): Backup {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: now,
    addons: listAddons(db)
      .filter((a) => !a.builtin)
      .map((a) => a.url),
    changes: collectOps(db, -1),
  };
}

// The changes themselves are checked by `applyOps`, which skips what it can't place.
const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  exportedAt: z.number(),
  addons: z.array(z.string().url()),
  changes: z.array(z.object({ type: z.string(), key: z.string(), at: z.number() }).passthrough()),
});

export type ImportResult = {
  changes: number;
  /** Add-ons from the file that are not installed here; the app installs them. */
  addons: string[];
};

/** Reads an export; throws a readable error when the file is not one. */
export function parseBackup(text: string): Backup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Lelap export.');
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success)
    throw new Error('This file is not a Lelap export, or it is from a newer version.');
  return parsed.data as Backup;
}

export function importLibrary(
  db: Db,
  backup: Backup,
  now: number,
  newId: IdGenerator,
): ImportResult {
  applyOps(db, backup.changes, now, newId);
  const installed = new Set(listAddons(db).map((a) => a.url));
  return {
    changes: backup.changes.length,
    addons: backup.addons.filter((url) => !installed.has(url)),
  };
}
