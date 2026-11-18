import type { Edition, Meta } from '@lelap/sdk';
import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { settings } from '../schema';

// Editions on the item page (M66, protocol revision 9). The listener's choice of edition is kept on
// this device per profile, in the settings table under keys `getSettings` ignores, like the source
// choice; it changes what the page shows and which IDs add-ons are asked for audio by.

const editionKey = (type: string, id: string) => `edition:${type}:${id}`;

/** The edition this profile chose for a work, as its `key`, if any. */
export function getEditionChoice(
  db: Db,
  profileId: string,
  type: string,
  id: string,
): string | null {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.profileId, profileId), eq(settings.key, editionKey(type, id))))
    .get();
  if (!row) return null;
  try {
    const value: unknown = JSON.parse(row.value);
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the edition this profile chose for a work; null forgets it. */
export function setEditionChoice(
  db: Db,
  profileId: string,
  type: string,
  id: string,
  key: string | null,
  now: number,
): void {
  const where = and(eq(settings.profileId, profileId), eq(settings.key, editionKey(type, id)));
  if (key === null) {
    db.delete(settings).where(where).run();
    return;
  }
  const value = JSON.stringify(key);
  db.insert(settings)
    .values({ profileId, key: editionKey(type, id), value, updatedAt: now })
    .onConflictDoUpdate({
      target: [settings.profileId, settings.key],
      set: { value, updatedAt: now },
    })
    .run();
}

/** The chosen edition among the meta's, or null when there is none or it is gone. */
export function chosenEdition(meta: Meta | undefined, key: string | null): Edition | null {
  if (!meta?.editions || key === null) return null;
  return meta.editions.find((e) => e.key === key) ?? null;
}

/** The IDs that name one edition rather than the work; another edition's are left out. */
const EDITION_IDS = new Set(['asin', 'isbn', 'isbn_13', 'isbn_10']);

/**
 * The meta as the item page shows it with an edition chosen: the edition's cover, year,
 * narrators, length and language, and its IDs, so add-ons that know it by its ASIN or ISBN are
 * asked by those. The meta's own narrators, length, chapters and edition IDs describe one edition
 * (the one with the meta's ASIN); for any other they are left out where the edition has none.
 */
export function withEdition(meta: Meta, edition: Edition | null): Meta {
  if (!edition) return meta;
  const asin = meta.externalIds?.asin;
  const same = asin !== undefined && edition.externalIds?.asin === asin;
  const { chapters, narrators, durationMs, externalIds: workIds, ...rest } = meta;
  const externalIds: Record<string, string> = {};
  for (const [prefix, value] of Object.entries(workIds ?? {}))
    if (same || !EDITION_IDS.has(prefix)) externalIds[prefix] = value;
  Object.assign(externalIds, edition.externalIds);
  const length = edition.durationMs ?? (same ? durationMs : undefined);
  const readers = edition.narrators?.length ? edition.narrators : same ? narrators : undefined;
  // Chapters fit a recording of the meta's length only.
  const fits = same && (edition.durationMs === undefined || edition.durationMs === durationMs);
  return {
    ...rest,
    ...(edition.cover ? { cover: edition.cover } : {}),
    ...(edition.year ? { year: edition.year } : {}),
    ...(edition.language ? { language: edition.language } : {}),
    ...(readers?.length ? { narrators: readers } : {}),
    ...(length !== undefined ? { durationMs: length } : {}),
    ...(chapters && fits ? { chapters } : {}),
    ...(Object.keys(externalIds).length > 0 ? { externalIds } : {}),
  };
}
